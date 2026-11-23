// Envio do resultado da missão ao remoto (server/flow-push.js). Git REAL em repositórios temporários; o "remoto" é um repositório bare numa pasta temporária (sem rede, sem GitHub).
// Banco: nenhum (o módulo só recebe o run). ORCH_DATA_DIR temporário mesmo assim, por garantia.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flow-push-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const P = await import('../flow-push.js');
after(() => { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const G = (cwd, args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
let seq = 0;
/** Repositório local com `main` acompanhando origin/main (um bare temporário) e o primeiro commit já enviado. */
async function setup() {
  const n = ++seq, bare = path.join(tmp, `remote-${n}.git`), repo = path.join(tmp, `repo-${n}`);
  fs.mkdirSync(bare); G(bare, ['init', '-q', '--bare', '-b', 'main']);
  fs.mkdirSync(repo); G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
  G(repo, ['remote', 'add', 'origin', bare]); G(repo, ['push', '-q', '-u', 'origin', 'main']);
  await snap(repo); // o destino gravado no início da execução, como o flows.js faz
  return { repo, bare, base: G(repo, ['rev-parse', 'HEAD']) };
}
const commit = (repo, file, msg = `commit ${file}`) => { fs.writeFileSync(path.join(repo, file), `${file}\n`); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', msg]); return G(repo, ['rev-parse', 'HEAD']); };
const remoteHead = (bare) => G(bare, ['rev-parse', 'main']);
const targets = new Map(); // destino gravado no INÍCIO (antes de mudar qualquer coisa), por repositório
const snap = async (repo) => { const t = await mk().target(repo, 'main'); const v = t.ok ? { remote: t.remote, mergeRef: t.mergeRef, urlHash: t.urlHash } : null; targets.set(repo, v); return v; };
const runOf = (repo, baseCommit, to, over = {}) => ({ id: 'run_00000001', status: 'completed', git: { mode: 'git', repoPath: repo, baseBranch: 'main', baseCommit, tip: to, pushTarget: targets.get(repo) ?? null, integration: { by: 'user', mode: 'ff', from: baseCommit, to } }, ...over });
const codes = (a) => a.reasons.map((x) => x.code);
const mk = () => P.createFlowPush({ allowProtocols: 'file' }); // o remoto dos testes é uma pasta (file); o padrão real só aceita https e ssh

test('caminho feliz: avalia (commits da missão, destino origin/main, digest) e envia SÓ o commit integrado; repetir é seguro (já enviado)', async () => {
  const { repo, bare, base } = await setup();
  const c1 = commit(repo, 'm1.txt', 'Etapa s1'), c2 = commit(repo, 'm2.txt', 'Integra etapa s1');
  const fp = mk(), run = runOf(repo, base, c2);
  const a = await fp.assess(run);
  assert.deepEqual(codes(a), []); assert.equal(a.remote, 'origin'); assert.equal(a.branch, 'origin/main'); assert.equal(a.mergeRef, 'refs/heads/main');
  assert.equal(a.from, base); assert.equal(a.to, c2); assert.deepEqual(a.commits.map((c) => c.subject), ['Integra etapa s1', 'Etapa s1']); assert.equal(a.more, 0); assert.match(a.digest, /^[0-9a-f]{32}$/);
  assert.equal(remoteHead(bare), base, 'avaliar não envia nada');
  const r = await fp.push(run, { by: 'auto' });
  assert.equal(r.ok, true, r.error); assert.equal(r.state, 'pushed'); assert.equal(remoteHead(bare), c2);
  // um commit local DEPOIS da integração não vai junto (o refspec é o sha integrado)
  const later = commit(repo, 'depois.txt');
  const again = await fp.push(runOf(repo, base, c2), { by: 'auto' });
  assert.equal(again.ok, true); assert.equal(again.already, true); assert.equal(remoteHead(bare), c2); assert.notEqual(remoteHead(bare), later);
  assert.ok(c1);
});

test('remoto com commits que você não tem: recusa (sem --force, sem pull automático) e o remoto fica intacto', async () => {
  const { repo, bare, base } = await setup();
  const other = path.join(tmp, `other-${seq}`); G(tmp, ['clone', '-q', bare, other]); G(other, ['config', 'core.autocrlf', 'false']);
  const theirs = commit(other, 'deles.txt'); G(other, ['push', '-q', 'origin', 'main']);
  const mine = commit(repo, 'meu.txt');
  const fp = mk(), run = runOf(repo, base, mine);
  const a = await fp.assess(run); assert.deepEqual(codes(a), ['remote_ahead']);
  for (const by of ['auto', 'user']) { const r = await fp.push(run, { by, expect: a.digest }); assert.equal(r.ok, false); assert.equal(r.code, 'remote_ahead'); }
  assert.equal(remoteHead(bare), theirs, 'o trabalho de outra pessoa continua no remoto');
});

test('commits locais não enviados ANTES da missão: o automático não envia; o manual envia só com o digest da lista que você viu', async () => {
  const { repo, bare, base } = await setup();
  const pre = commit(repo, 'antes.txt', 'meu commit não enviado'), m = commit(repo, 'missao.txt', 'Integra missão');
  const fp = mk(), run = runOf(repo, pre, m); // a missão começou depois de `pre`, que nunca foi enviado
  const a = await fp.assess(run);
  assert.deepEqual(codes(a), ['local_unpushed']); assert.deepEqual(a.commits.map((c) => c.subject), ['Integra missão', 'meu commit não enviado'], 'a lista mostra tudo o que iria');
  const auto = await fp.push(run, { by: 'auto' }); assert.equal(auto.ok, false); assert.equal(auto.code, 'local_unpushed'); assert.equal(remoteHead(bare), base);
  const wrong = await fp.push(run, { by: 'user', expect: '0'.repeat(32) }); assert.equal(wrong.ok, false); assert.equal(wrong.code, 'changed'); assert.equal(remoteHead(bare), base);
  const none = await fp.push(run, { by: 'user' }); assert.equal(none.code, 'changed', 'manual sem digest não envia');
  const ok = await fp.push(run, { by: 'user', expect: a.digest }); assert.equal(ok.ok, true, ok.error); assert.equal(remoteHead(bare), m);
});

test('recusas de regra: sem branch remota configurada, branch remota inexistente, commit integrado fora da sua branch, execução não integrada ou vazia', async () => {
  const fp = mk();
  // sem upstream
  const s1 = await setup(); G(s1.repo, ['branch', '--unset-upstream']); const t1 = commit(s1.repo, 'x.txt');
  assert.deepEqual(codes(await fp.assess(runOf(s1.repo, s1.base, t1))), ['no_upstream']);
  // upstream apontando para branch que não existe no remoto
  const s2 = await setup(); G(s2.repo, ['config', 'branch.main.merge', 'refs/heads/nao-existe']); await snap(s2.repo); const t2 = commit(s2.repo, 'x.txt'); // destino já assim no início
  const a2 = await fp.assess(runOf(s2.repo, s2.base, t2)); assert.deepEqual(codes(a2), ['no_remote_branch']);
  assert.equal((await fp.push(runOf(s2.repo, s2.base, t2), { by: 'user', expect: a2.digest })).code, 'no_remote_branch'); assert.equal(G(s2.bare, ['branch', '--list', 'nao-existe']), '', 'não cria branch no remoto');
  // você desfez a integração depois (reset): o commit integrado não está mais na branch
  const s3 = await setup(); const t3 = commit(s3.repo, 'x.txt'); G(s3.repo, ['reset', '-q', '--hard', s3.base]);
  assert.deepEqual(codes(await fp.assess(runOf(s3.repo, s3.base, t3))), ['branch_moved']);
  // não integrada / vazia / modo pasta
  const s4 = await setup(); const t4 = commit(s4.repo, 'x.txt');
  assert.deepEqual(codes(await fp.assess(runOf(s4.repo, s4.base, t4, { status: 'ready_to_integrate' }))), ['not_integrated']);
  const empty = runOf(s4.repo, s4.base, s4.base); empty.git.integration.mode = 'empty'; assert.deepEqual(codes(await fp.assess(empty)), ['nothing']);
  assert.deepEqual(codes(await fp.assess({ id: 'run_1', status: 'completed', git: null })), ['not_integrated']);
  assert.equal(remoteHead(s4.bare), s4.base);
  assert.equal((await fp.push(runOf(s4.repo, s4.base, t4), { by: 'qualquer' })).code, 'invalid_request');
});

test('hooks do repositório NÃO rodam no envio (pre-push plantado não executa)', async () => {
  const { repo, bare, base } = await setup();
  const marker = path.join(tmp, `hook-rodou-${seq}`);
  fs.writeFileSync(path.join(repo, '.git', 'hooks', 'pre-push'), `#!/bin/sh\necho x > "${marker.replace(/\\/g, '/')}"\nexit 1\n`, { mode: 0o755 });
  const to = commit(repo, 'x.txt');
  const r = await mk().push(runOf(repo, base, to), { by: 'auto' });
  assert.equal(r.ok, true, r.error); assert.equal(fs.existsSync(marker), false, 'o hook não rodou'); assert.equal(remoteHead(bare), to);
});

test('remoto inacessível: falha sem pedir login e sem vazar credencial da URL na mensagem', async () => {
  const { repo, base } = await setup();
  G(repo, ['remote', 'set-url', 'origin', 'https://usuario:segredo123@127.0.0.1:9/x.git']);
  const to = commit(repo, 'x.txt');
  const a = await mk().assess(runOf(repo, base, to));
  assert.deepEqual(codes(a), ['target_changed'], 'a URL mudou depois do início: não consulta o remoto'); const msg = a.reasons.map((x) => x.message).join(' | ');
  assert.ok(!msg.includes('segredo123') && !msg.includes('usuario:'), msg);
});

test('scrubGitText: credenciais em URL e tokens do GitHub somem; controles e tamanho limitados', () => {
  const s = P.scrubGitText('fatal: https://eu:ghp_ABCDEFGHIJKLMNOPQRSTUV123456@github.com/x.git e github_pat_11AAAAAAAAAAAAAAAAAAAA_bbbb\x1b[31m e ghs_ZZZZZZZZZZZZZZZZZZZZ');
  assert.ok(!/ghp_|github_pat_|ghs_|eu:/.test(s), s); assert.match(s, /https:\/\/\*\*\*@github\.com/); assert.ok(!/\x1b/.test(s));
  assert.ok(P.scrubGitText('x'.repeat(1000)).length <= 400);
  assert.deepEqual(P.pushBlocking({ reasons: [{ code: 'local_unpushed' }, { code: 'remote_ahead' }] }, 'user').map((x) => x.code), ['remote_ahead']);
  assert.deepEqual(P.pushBlocking({ reasons: [{ code: 'local_unpushed' }] }, 'auto').map((x) => x.code), ['local_unpushed']);
});

// ---------- correções da revisão de segurança ----------
test('commits que NÃO são da missão (integração por merge com um commit seu): o automático recusa (foreign_commits); o manual mostra e envia com o digest', async () => {
  const { repo, bare, base } = await setup();
  const mine = commit(repo, 'meu-durante.txt', 'meu commit durante a missão'); // você commitou na main enquanto a missão rodava
  G(repo, ['checkout', '-q', '-b', 'missao', base]); const tip = commit(repo, 'missao.txt', 'Etapa s1'); G(repo, ['checkout', '-q', 'main']);
  G(repo, ['merge', '-q', '--no-ff', '--no-edit', 'missao']); const merged = G(repo, ['rev-parse', 'HEAD']);
  const run = runOf(repo, base, merged); run.git.tip = tip; run.git.integration.mode = 'merge';
  const fp = mk(), a = await fp.assess(run);
  assert.deepEqual(codes(a), ['foreign_commits']); assert.ok(a.commits.some((c) => c.subject === 'meu commit durante a missão'), 'a lista mostra o seu commit');
  const auto = await fp.push(run, { by: 'auto' }); assert.deepEqual([auto.ok, auto.code], [false, 'foreign_commits']); assert.equal(remoteHead(bare), base);
  const ok = await fp.push(run, { by: 'user', expect: a.digest }); assert.equal(ok.ok, true, ok.error); assert.equal(remoteHead(bare), merged); assert.ok(mine);
});

test('destino mudou depois do início (um agente trocou a URL do remoto ou pôs um pushurl/insteadOf): o automático recusa e a URL nova aparece, sem credencial', async () => {
  const { repo, bare, base } = await setup();
  const evil = path.join(tmp, `evil-${seq}.git`); fs.mkdirSync(evil); G(evil, ['init', '-q', '--bare', '-b', 'main']); G(repo, ['push', '-q', evil, 'main']);
  G(repo, ['remote', 'set-url', 'origin', evil]);
  const to = commit(repo, 'x.txt'), fp = mk(), a = await fp.assess(runOf(repo, base, to));
  assert.ok(codes(a).includes('target_changed')); assert.ok(a.url.includes(`evil-${seq}.git`), a.url);
  const auto = await fp.push(runOf(repo, base, to), { by: 'auto' }); assert.equal(auto.code, 'target_changed');
  assert.equal(G(evil, ['rev-parse', 'main']), base, 'nada foi para o remoto trocado'); assert.equal(remoteHead(bare), base);
  // pushurl/insteadOf também mudam a URL EFETIVA de envio, e são configuração "insegura"
  const fwd = (p) => p.split(path.sep).join('/');
  const s = await setup(); G(s.repo, ['config', `url.${fwd(evil)}.pushInsteadOf`, fwd(s.bare)]); const t2 = commit(s.repo, 'y.txt');
  const b = await fp.assess(runOf(s.repo, s.base, t2)); assert.ok(codes(b).includes('unsafe_config'), JSON.stringify(b.reasons));
  // execução sem o destino gravado no início: o automático não envia
  const s3 = await setup(); const t3 = commit(s3.repo, 'z.txt'); const r3 = runOf(s3.repo, s3.base, t3); delete r3.git.pushTarget;
  assert.ok(codes(await fp.assess(r3)).includes('target_unknown')); assert.equal((await fp.push(r3, { by: 'auto' })).code, 'target_unknown');
});

test('configuração local que executa comando (core.sshCommand, credential.helper): o automático não envia; o manual avisa com as chaves', async () => {
  const { repo, bare, base } = await setup();
  G(repo, ['config', 'core.sshCommand', 'ssh -o ProxyCommand=calc']); G(repo, ['config', 'credential.helper', '!echo x']);
  const to = commit(repo, 'x.txt'), fp = mk(), a = await fp.assess(runOf(repo, base, to));
  const u = a.reasons.find((r) => r.code === 'unsafe_config'); assert.ok(u); assert.match(u.message, /core\.sshcommand/i); assert.match(u.message, /credential\.helper/i);
  assert.equal((await fp.push(runOf(repo, base, to), { by: 'auto' })).code, 'unsafe_config'); assert.equal(remoteHead(bare), base);
});

test('configuração insegura ou destino trocado: assess/push NÃO executam o comando nem falam com o remoto (sentinela em core.sshCommand)', async () => {
  const fwd = (p) => p.split(path.sep).join('/');
  for (const modo of ['unsafe', 'target']) {
    const { repo, base } = await setup(); const marker = path.join(tmp, `ssh-rodou-${modo}-${seq}`);
    const sentinela = `echo x > "${fwd(marker)}"; exit 1 #`;
    if (modo === 'unsafe') { G(repo, ['remote', 'set-url', 'origin', 'ssh://example.invalid/x.git']); await snap(repo); G(repo, ['config', 'core.sshCommand', sentinela]); }
    else { G(repo, ['config', 'core.sshCommand', sentinela]); G(repo, ['remote', 'set-url', 'origin', 'ssh://example.invalid/outro.git']); }
    const to = commit(repo, 'x.txt'), fp = P.createFlowPush({ allowProtocols: 'ssh' }), run = runOf(repo, base, to);
    const a = await fp.assess(run);
    assert.ok(codes(a).includes(modo === 'unsafe' ? 'unsafe_config' : 'target_changed'), JSON.stringify(a.reasons));
    assert.ok(!codes(a).includes('remote_unknown'), 'não consultou o remoto'); assert.equal(a.from, null);
    for (const by of ['auto', 'user']) { const r = await fp.push(run, { by, expect: a.digest }); assert.equal(r.ok, false); assert.ok(['unsafe_config', 'target_changed'].includes(r.code), r.code); }
    assert.equal(fs.existsSync(marker), false, `o comando do agente (${modo}) não pode rodar`);
  }
});

test('[remote rejected] (branch protegida/hook do servidor) não vira "remoto à frente"; remoto à frente que já contém o commit integrado = já enviado', async () => {
  const { repo, bare, base } = await setup();
  const to = commit(repo, 'x.txt');
  fs.writeFileSync(path.join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "protected branch hook declined" >&2\nexit 1\n', { mode: 0o755 });
  const r = await mk().push(runOf(repo, base, to), { by: 'auto' });
  assert.equal(r.ok, false); assert.equal(r.code, 'push_failed', r.error); assert.equal(remoteHead(bare), base);
  fs.rmSync(path.join(bare, 'hooks', 'pre-receive'));
  assert.equal((await mk().push(runOf(repo, base, to), { by: 'auto' })).ok, true);
  const more = commit(repo, 'depois.txt'); G(repo, ['push', '-q', 'origin', 'main']); assert.equal(remoteHead(bare), more);
  const a = await mk().assess(runOf(repo, base, to)); assert.equal(a.already, true, JSON.stringify(a.reasons)); assert.deepEqual(codes(a), []);
});

test('nenhuma tag vai junto, nem com push.followTags ligado na configuração', async () => {
  const { repo, bare, base } = await setup();
  const to = commit(repo, 'x.txt'); G(repo, ['tag', '-a', 'v9', '-m', 'versão', to]); G(repo, ['config', 'push.followTags', 'true']);
  await snap(repo); // a chave acima não é "insegura": o destino segue o mesmo
  const r = await mk().push(runOf(repo, base, to), { by: 'auto' }); assert.equal(r.ok, true, r.error);
  assert.equal(remoteHead(bare), to); assert.equal(G(bare, ['tag', '--list']), '', 'a tag não foi enviada');
});

test('protocolos: o padrão real só aceita https e ssh (remoto file:// ou pasta é recusado com motivo claro); remoto não cadastrado = sem upstream', async () => {
  const { repo, base } = await setup();
  const to = commit(repo, 'x.txt');
  const a = await P.createFlowPush().assess(runOf(repo, base, to)); // sem liberar file
  assert.deepEqual(codes(a), ['remote_unknown']); assert.match(a.reasons[0].message, /só envia por https ou ssh/);
  const s = await setup(); G(s.repo, ['config', 'branch.main.remote', 'fantasma']); await snap(s.repo);
  assert.deepEqual(codes(await mk().assess(runOf(s.repo, s.base, commit(s.repo, 'y.txt')))), ['no_upstream']);
  assert.equal(P.ALLOWED_PROTOCOLS, 'https:ssh');
});

test('scrubGitText: senha com @ no meio e token do GitLab também somem', () => {
  const s = P.scrubGitText('https://eu:pa@ss@host.com/x.git token glpat-ABCDEFGHIJKLMNOPQRST');
  assert.ok(!/pa@ss|ss@host|glpat-/.test(s), s); assert.match(s, /https:\/\/\*\*\*@host\.com/);
});
