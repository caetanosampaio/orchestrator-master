// Envio (push) do resultado de uma missão para o remoto, DEPOIS da integração final. Nunca roda sozinho daqui: flows.js decide quando (automático só com a opção da missão
// e a verificação aprovada; manual pelo botão, atado à lista que você viu).
//
// O que é enviado, e nada além:
//   - o commit EXATO da integração final (`run.git.integration.to`) para a branch que a sua já acompanha (branch.<base>.remote / branch.<base>.merge). Nenhuma outra branch, nenhuma tag
//     (--no-follow-tags), nenhum submódulo;
//   - nunca --force: remoto com commits que você não tem = recusado (nada de pull/rebase automático);
//   - sem branch remota configurada, remoto não cadastrado ou branch remota que não existe ainda = recusado (não cria branch no remoto);
//   - só por https ou ssh (GIT_ALLOW_PROTOCOL: bloqueia ext::, file:// e afins, mesmo se a configuração do repositório os liberar).
// Recusas que o ENVIO AUTOMÁTICO respeita e o MANUAL mostra com aviso (você vê a lista e confirma; USER_OK):
//   - local_unpushed: a sua branch tinha commits não enviados ANTES da missão (iriam junto);
//   - foreign_commits: o commit integrado não é a ponta verificada da missão (integração por merge ou "já estava": entram commits que não são da missão);
//   - target_unknown: o destino do envio não foi gravado no início da execução (confira o remoto).
// Recusas para os DOIS (sem consultar o remoto: o ls-remote executaria a configuração do agente ou falaria com a URL trocada):
//   - target_changed: o destino (remoto, branch, URL de envio) não é o gravado no início da execução, antes de qualquer agente rodar;
//   - unsafe_config: a configuração LOCAL do repositório tem chaves que executam comandos ou redirecionam o envio (core.sshCommand, credential.*, pushurl, insteadOf, include...).
// Credenciais: as do Git da máquina, sem janela de login (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never) e com tempo limite. O FORGE não lê nem grava token; a URL guardada e mostrada
// passa por scrubGitText (sem usuário:senha@), e a comparação usa só um hash dela. Hooks desligados como em todo Git do FORGE (worktrees.js).

import crypto from 'node:crypto';
import { git as realGit } from './worktrees.js';

export const PUSH_TIMEOUT_MS = 90_000, REMOTE_TIMEOUT_MS = 30_000, MAX_PUSH_COMMITS = 50;
export const ALLOWED_PROTOCOLS = 'https:ssh';
const SHA_RE = /^[0-9a-f]{40,64}$/;
const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/; // nome de remoto (nunca começa com "-": não vira opção do Git)
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
// tags, submódulos e assinatura nunca vão junto, seja qual for a configuração do usuário (ou de um agente)
const NET_ARGS = ['-c', 'credential.interactive=false', '-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', '-c', 'push.gpgSign=false'];
// chaves da configuração LOCAL que executam comandos ou mudam o destino do envio: com qualquer uma, o automático não envia (o manual avisa)
const UNSAFE_KEY_RE = /^(?:core\.(?:sshcommand|gitproxy|askpass|alternaterefscommand)|credential\..+|remote\.[^.]+\.(?:pushurl|uploadpack|receivepack|proxy|vcs)|url\..+\.(?:insteadof|pushinsteadof)|include\.path|includeif\..+|protocol\..+|http\..*(?:proxy|sslcainfo|sslbackend)|gpg\..+)$/i;
// motivos que NÃO bloqueiam o envio manual (você vê a lista e o aviso e confirma)
// (target_changed e unsafe_config NÃO estão aqui: sem consultar o remoto não há o que confirmar, e o envio seria às cegas)
const USER_OK = new Set(['local_unpushed', 'foreign_commits', 'target_unknown']);
/** Motivos que impedem enviar agora, para quem envia (`auto` respeita todos; `user` aceita os de USER_OK). */
export const pushBlocking = (a, by) => (Array.isArray(a?.reasons) ? a.reasons : []).filter((x) => !(by === 'user' && USER_OK.has(x.code)));

/** Texto do Git sem credencial: usuário:senha@ em URLs (até o último @ antes do caminho) e tokens conhecidos viram ***; sem controles; curto. */
export function scrubGitText(s, max = 400) {
  return String(s ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1***@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,})\b/g, '***')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/ {2,}/g, ' ').trim().slice(0, max);
}
const short = (sha) => String(sha ?? '').slice(0, 12);
const out = (r) => String(r?.out ?? '').trim();
const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

/**
 * `runGit(cwd, args, { env, timeout })` no formato de worktrees.git: { code, out, err, failed, timedOut }. `now` para o carimbo. `allowProtocols`: só os testes trocam (remoto bare local = 'file').
 * target(repo, base): destino do envio, só configuração LOCAL (sem rede), para gravar no início do run. assess(run): só leitura (inclui `git ls-remote`). push(run, { by, expect }): envia.
 */
export function createFlowPush({ runGit = realGit, now = () => new Date().toISOString(), allowProtocols = ALLOWED_PROTOCOLS } = {}) {
  const NET_ENV = Object.freeze({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ALLOW_PROTOCOL: allowProtocols });
  const G = (repo, args, opts) => runGit(repo, args, opts);
  const net = (repo, args, timeout) => G(repo, [...NET_ARGS, ...args], { env: NET_ENV, timeout });
  async function ancestor(repo, a, b) { const r = await G(repo, ['merge-base', '--is-ancestor', a, b]); return r.failed ? null : r.code === 0 ? true : r.code === 1 ? false : null; }
  async function hasCommit(repo, sha) { const r = await G(repo, ['cat-file', '-e', `${sha}^{commit}`]); return r.failed ? null : r.code === 0; }
  const netError = (r) => (r.timedOut ? 'o remoto não respondeu a tempo' : /not allowed|transport .* not allowed/i.test(r.err ?? '') ? `o FORGE só envia por ${allowProtocols.replace(/:/g, ' ou ')}` : scrubGitText(r.err) || 'não foi possível consultar o remoto');

  /**
   * Destino do envio pela configuração LOCAL: { ok: true, remote, mergeRef, branch, url (sem credencial), urlHash, unsafe: [chaves] } ou { ok: false, code, message }. Sem rede.
   * `remote.<nome>.url` precisa existir (um nome sem remoto cadastrado o Git trataria como caminho).
   */
  async function target(repo, base) {
    if (typeof repo !== 'string' || !repo || typeof base !== 'string' || !BRANCH_RE.test(base)) return { ok: false, code: 'not_integrated', message: 'a integração gravada está incompleta' };
    const rm = await G(repo, ['config', '--get', `branch.${base}.remote`]), mg = await G(repo, ['config', '--get', `branch.${base}.merge`]);
    if (rm.failed || mg.failed) return { ok: false, code: 'git_unknown', message: 'o Git não respondeu ao ler a configuração da branch' };
    const remote = out(rm), mergeRef = out(mg);
    if (!remote || remote === '.' || !REMOTE_RE.test(remote) || !/^refs\/heads\//.test(mergeRef) || !BRANCH_RE.test(mergeRef.slice('refs/heads/'.length))) {
      return { ok: false, code: 'no_upstream', message: `a branch "${base}" não acompanha uma branch remota (configure com git push -u)` };
    }
    const cfgUrl = await G(repo, ['config', '--get', `remote.${remote}.url`]);
    if (cfgUrl.failed) return { ok: false, code: 'git_unknown', message: 'o Git não respondeu ao ler o remoto' };
    if (cfgUrl.code !== 0 || !out(cfgUrl)) return { ok: false, code: 'no_upstream', message: `o remoto "${remote}" não está cadastrado neste repositório` };
    const pu = await G(repo, ['remote', 'get-url', '--push', remote]); // URL EFETIVA de envio (já com pushurl/insteadOf aplicados)
    if (pu.failed || pu.code !== 0 || !out(pu)) return { ok: false, code: 'git_unknown', message: 'não foi possível ler a URL de envio do remoto' };
    const raw = out(pu).split(/\r?\n/)[0];
    const loc = await G(repo, ['config', '--local', '--name-only', '--list']);
    const unsafe = loc.failed || loc.code !== 0 ? ['(configuração local ilegível)'] : [...new Set(out(loc).split(/\r?\n/).map((k) => k.trim()).filter((k) => UNSAFE_KEY_RE.test(k)))].slice(0, 20);
    return { ok: true, remote, mergeRef, branch: `${remote}/${mergeRef.slice('refs/heads/'.length)}`, url: scrubGitText(raw, 300), urlHash: hashOf(raw), unsafe };
  }

  /** Ref da branch no remoto agora: { known, sha } (sha null = não existe lá) ou { known: false, error }. */
  async function remoteSha(repo, remote, mergeRef) {
    const r = await net(repo, ['ls-remote', '--refs', remote, mergeRef], REMOTE_TIMEOUT_MS);
    if (r.failed || r.code !== 0) return { known: false, error: netError(r) };
    const line = out(r).split(/\r?\n/).find((l) => l.endsWith(`\t${mergeRef}`)) ?? '';
    const sha = line.split('\t')[0];
    return { known: true, sha: SHA_RE.test(sha) ? sha : null };
  }

  /**
   * Avaliação SÓ de leitura. { remote, branch, mergeRef, url, from, to, commits, more, reasons: [{ code, message }], already, digest }.
   * `digest` amarra o envio manual ao que você viu (remoto, branch, URL de envio, ponta remota, commit enviado e os avisos).
   */
  async function assess(run) {
    const reasons = [], add = (code, message) => reasons.push({ code, message });
    const a = { remote: null, branch: null, mergeRef: null, url: null, from: null, to: null, commits: [], more: 0, reasons, already: false, digest: null };
    let urlHash = null;
    // os códigos dos avisos entram no digest: um aviso novo entre a prévia e o clique invalida o que você viu
    const done = () => { a.digest = hashOf(JSON.stringify([run?.id ?? null, a.remote, a.mergeRef, urlHash, a.from, a.to, reasons.map((x) => x.code).sort()])); return a; };
    const g = run?.git, integ = g?.integration;
    if (run?.status !== 'completed' || !g || g.mode !== 'git' || !integ || typeof integ !== 'object') { add('not_integrated', 'a execução ainda não foi integrada na sua branch'); return done(); }
    if (integ.mode === 'empty') { add('nothing', 'a missão não produziu alterações: não há o que enviar'); return done(); }
    const repo = g.repoPath, base = g.baseBranch, to = integ.to;
    if (typeof to !== 'string' || !SHA_RE.test(to)) { add('not_integrated', 'a integração gravada está incompleta'); return done(); }
    const t = await target(repo, base);
    if (!t.ok) { add(t.code, t.message); return done(); }
    Object.assign(a, { remote: t.remote, mergeRef: t.mergeRef, branch: t.branch, url: t.url, to }); urlHash = t.urlHash;
    // o commit integrado ainda está na sua branch? (você pode ter desfeito a integração depois)
    const head = await G(repo, ['rev-parse', '--verify', '-q', `refs/heads/${base}^{commit}`]);
    if (head.failed) { add('git_unknown', 'o Git não respondeu ao ler a sua branch'); return done(); }
    const inBase = SHA_RE.test(out(head)) ? await ancestor(repo, to, out(head)) : false;
    if (inBase === null) { add('git_unknown', 'não foi possível comparar o commit integrado com a sua branch'); return done(); }
    if (!inBase) { add('branch_moved', `o commit integrado (${short(to)}) não está mais na branch "${base}"`); return done(); }
    // avisos de origem (bloqueiam só o automático): destino diferente do gravado no início, configuração local perigosa, commit integrado que não é a ponta da missão
    const snap = g.pushTarget;
    if (!snap || typeof snap !== 'object' || typeof snap.urlHash !== 'string') add('target_unknown', 'o destino do envio não foi gravado no início desta execução: confira o remoto antes de enviar');
    else if (snap.urlHash !== t.urlHash || snap.remote !== t.remote || snap.mergeRef !== t.mergeRef) add('target_changed', `o destino do envio mudou durante a execução (agora: ${t.branch} em ${t.url}); confira se é mesmo o seu remoto`);
    if (t.unsafe.length) add('unsafe_config', `a configuração local do repositório tem chaves que executam comandos ou mudam o destino do envio (${t.unsafe.join(', ')}); confira-as e remova-as antes de enviar`);
    // destino trocado ou configuração que executa comando: NÃO consulta o remoto (o ls-remote executaria core.sshCommand/credential.helper de um agente, ou falaria com a URL trocada)
    if (reasons.some((x) => x.code === 'target_changed' || x.code === 'unsafe_config')) return done();
    if (typeof g.tip === 'string' && to !== g.tip) add('foreign_commits', 'o commit integrado inclui commits da sua branch que não são da missão (integração por merge ou a branch já estava à frente): eles iriam junto e não foram verificados');
    const rs = await remoteSha(repo, t.remote, t.mergeRef);
    if (!rs.known) { add('remote_unknown', `não foi possível consultar ${t.branch}: ${rs.error}`); return done(); }
    if (!rs.sha) { add('no_remote_branch', `${t.branch} não existe no remoto (o FORGE não cria branch remota)`); return done(); }
    a.from = rs.sha;
    if (rs.sha === to) { a.already = true; return done(); }
    const have = await hasCommit(repo, rs.sha);
    if (have && (await ancestor(repo, to, rs.sha)) === true) { a.already = true; return done(); } // o remoto já contém o commit integrado (e talvez mais)
    const ff = have ? await ancestor(repo, rs.sha, to) : false;
    if (have === null || ff === null) { add('git_unknown', 'não foi possível comparar com o remoto'); return done(); }
    if (!ff) { add('remote_ahead', `${t.branch} tem commits que a sua branch não tem: atualize-a (pull) e envie de novo`); return done(); }
    const bc = g.baseCommit;
    if (typeof bc === 'string' && SHA_RE.test(bc) && bc !== rs.sha) {
      const sent = await ancestor(repo, bc, rs.sha); // tudo até o início da missão já estava no remoto?
      if (sent === null) { add('git_unknown', 'não foi possível comparar o início da missão com o remoto'); return done(); }
      if (!sent) add('local_unpushed', `a branch "${base}" já tinha commits não enviados antes da missão: eles iriam junto`);
    }
    const log = await G(repo, ['log', '--format=%H%x09%s', `${rs.sha}..${to}`]);
    if (log.failed || log.code !== 0) { add('git_unknown', 'não foi possível listar os commits a enviar'); return done(); }
    const all = out(log).split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { sha: l.slice(0, i), subject: scrubGitText(l.slice(i + 1), 160) }; }).filter((c) => SHA_RE.test(c.sha));
    a.commits = all.slice(0, MAX_PUSH_COMMITS).map((c) => ({ sha: short(c.sha), subject: c.subject })); a.more = Math.max(0, all.length - MAX_PUSH_COMMITS);
    return done();
  }

  /**
   * Envia. `by`: 'auto' | 'user'. Manual exige `expect` = digest da avaliação que você viu (mudou = recusa com a avaliação nova). Resultado:
   * { ok: true, state: 'pushed', ...avaliação } ou { ok: false, code, error, assessment }. Envio confirmado relendo o remoto.
   */
  async function push(run, { by, expect = null } = {}) {
    if (by !== 'auto' && by !== 'user') return { ok: false, code: 'invalid_request', error: 'Origem do envio inválida.' };
    const a = await assess(run);
    const blocking = pushBlocking(a, by);
    if (blocking.length) return { ok: false, code: blocking[0].code, error: blocking.map((x) => x.message).join('; '), assessment: a };
    if (a.already) return { ok: true, state: 'pushed', already: true, ...a };
    if (by === 'user' && expect !== a.digest) return { ok: false, code: 'changed', error: 'O que seria enviado mudou desde que você abriu a confirmação: confira a lista nova.', assessment: a };
    // refspec explícito: o commit integrado (sha) para a branch remota; sem "+" (nunca força); sem tags, submódulos nem assinatura
    const r = await net(run.git.repoPath, ['push', '--porcelain', '--no-verify', '--no-follow-tags', '--recurse-submodules=no', '--no-signed', a.remote, `${a.to}:${a.mergeRef}`], PUSH_TIMEOUT_MS);
    if (r.failed || r.code !== 0) {
      const text = scrubGitText(`${r.err} ${r.out}`);
      const code = r.timedOut ? 'timeout' : /\[rejected\]|non-fast-forward|fetch first/i.test(text) /* "[remote rejected]" não casa: é recusa do servidor, não remoto à frente */ ? 'remote_ahead' : /authentication|could not read username|permission denied|\b40[13]\b|access denied/i.test(text) ? 'auth' : 'push_failed';
      const why = code === 'timeout' ? 'o remoto não respondeu a tempo' : code === 'remote_ahead' ? `${a.branch} recebeu commits novos: atualize a sua branch e envie de novo` : code === 'auth' ? `o remoto recusou as credenciais do Git desta máquina (${text || 'sem detalhe'})` : text || 'o Git não informou o motivo';
      return { ok: false, code, error: `Envio não feito: ${why}.`, assessment: a };
    }
    const check = await remoteSha(run.git.repoPath, a.remote, a.mergeRef);
    if (!check.known || check.sha !== a.to) return { ok: false, code: 'unconfirmed', error: `O Git terminou sem erro, mas ${a.branch} não confirmou o commit ${short(a.to)}${check.known ? '' : ` (${check.error})`}. Confira e tente de novo.`, assessment: a };
    return { ok: true, state: 'pushed', at: now(), ...a };
  }

  return { target, assess, push };
}
