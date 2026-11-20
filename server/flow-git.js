// Git da MISSÃO (Missions v2, fatia 2): branch da missão `orch/run_xxxxxxxx` (nunca em checkout), worktree por etapa, integração das etapas na branch da missão
// SÓ por plumbing (merge-tree/commit-tree/update-ref com compare-and-swap) e integração final na pasta do usuário por `merge --ff-only`.
// Regras: nada vem do cliente (todos os argumentos do Git são montados aqui com valores validados); tudo que mexe em ref ou pasta roda dentro de
// withRepoLock(repoKey(repoPath)), o MESMO lock do gerenciador de worktrees; o diário é gravado ANTES de cada efeito (se não gravar, o efeito não roda e a
// memória volta ao que era); depois do efeito a memória segue o Git real. "O Git não respondeu" nunca vale como limpo nem como sucesso.
// Atenção ao lock: os métodos do gerenciador (create/commitFlowWork/fastForwardFlow/cleanup) pegam o MESMO lock; chamá-los de dentro de withRepoLock travaria.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { CONFIG_FILES, CONFIG_DIRS } from './project-config.js';
import { providerIds, getProvider } from './providers/index.js';
import { git, withRepoLock, repoKey, resolveRepo, GIT_IDENT, dirtyStateOf, probeHeadOf, worktreeProblem } from './worktrees.js';

const SHA_RE = /^[0-9a-f]{40,64}$/;
const RUN_ID_RE = /^run_([0-9a-f]{8})$/;
const MISSION_BRANCH_RE = /^orch\/run_[0-9a-f]{8}$/;
const WT_BRANCH_RE = /^orch\/wt_[0-9a-f]{8}$/;
const STEP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// branch do usuário: vem do próprio Git (symbolic-ref), mas ainda assim nunca pode virar opção nem conter controle/espaço
const USER_BRANCH_RE = /^(?!-)(?!.*\.\.)[^\s\u0000-\u001f\u007f~^:?*[\\]{1,200}$/;
const RETRYABLE = new Set(['none', 'pending', 'conflict', 'blocked', 'error']);

const lines = (s) => String(s ?? '').split(/\r?\n/).filter(Boolean);
const clip = (s, n = 300) => String(s ?? '').slice(0, n);
const why = (x) => (x?.timedOut ? 'tempo esgotado' : clip(x?.err, 120) || 'falha ao executar o Git');
const errText = (e) => e?.code || e?.message || 'erro';
const short = (sha) => String(sha ?? '').slice(0, 12);

/** Branch da missão derivada do id do run (`run_<8 hex>` → `orch/run_<8 hex>`); null se o id não tiver o formato. */
export function missionBranchFor(runId) {
  const m = RUN_ID_RE.exec(String(runId ?? ''));
  return m ? `orch/run_${m[1]}` : null;
}

// ---------- guarda de configuração executável e arquivos sensíveis ----------
// POR QUÊ: a missão integra sozinha (autoIntegrate) e abre terminais de agentes nas cópias; o que estiver nestes caminhos pode executar comandos ou instruir um agente
// ao abrir o projeto (configuração das CLIs e dos editores, hooks do Git e dos gerenciadores de pacote, filtros do .gitattributes, submódulos, CI) ou guarda segredos.
// Alterar qualquer um exige a revisão explícita do usuário antes de integrar e impede abrir terminal na cópia sem essa revisão. Em qualquer profundidade (monorepos).
// Comparação sem caixa: no Windows `.ENV` e `.env` (e `claude.md` e `CLAUDE.md`) são o mesmo arquivo.
// Também guardados: entrada de link simbólico (modo 120000: o alvo pode ser qualquer arquivo; decidido em changedEntries/configAudit) e componentes no formato 8.3 do
// Windows (`CLAUDE~1`), que apontam para um nome longo que a lista não veria.
// LIMITE CONHECIDO: scripts de `package.json` (postinstall etc.) NÃO são marcados por caminho: o arquivo muda em quase toda etapa e a guarda viraria ruído; a cópia
// nunca roda instalação sozinha e a integração final não executa scripts.
const CFG_FILES = [...new Set([
  ...CONFIG_FILES,
  ...providerIds().flatMap((id) => getProvider(id).projectConfig?.files ?? []), // configuração de projeto de TODOS os provedores (hoje: Claude pelo padrão, Codex só pastas)
  '.gitattributes', '.gitmodules', 'lefthook.yml', 'lefthook.yaml', '.pre-commit-config.yaml', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', 'claude.md', 'agents.md',
  // N4: dev container de arquivo único, variantes locais/ocultas do lefthook e instruções/configuração de outros agentes e editores (Gemini, Cursor, Cline, Windsurf, Aider)
  '.devcontainer.json', 'lefthook-local.yml', '.lefthook.yml', 'gemini.md', '.cursorrules', '.clinerules', '.windsurfrules', '.aider.conf.yml',
].map((f) => f.toLowerCase()))];
const CFG_DIRS = [...new Set([
  ...CONFIG_DIRS, '.claude',
  ...providerIds().flatMap((id) => getProvider(id).projectConfig?.dirs ?? []),
  '.codex', '.vscode', '.cursor', '.gemini', '.devcontainer', '.husky', '.githooks', '.github/workflows',
  '.github/actions', '.github/hooks', '.windsurf', '.idea', // N4: actions locais do CI, hooks de agente do GitHub, regras do Windsurf e configuração de execução das IDEs JetBrains
].map((d) => d.toLowerCase()))];
const SENSITIVE_BASE = [/^\.env/, /\.pem$/, /\.key$/, /^id_rsa/, /^id_ed25519/, /^id_ecdsa/, /^id_dsa/, /\.p12$/, /\.pfx$/, /^\.netrc$/, /^\.git-credentials$/];
const SHORT_NAME_RE = /~\d/; // nome curto 8.3 do Windows (ex.: CLAUDE~1)
/** Teto da lista de arquivos guardados mostrada (e aceita de volta em acknowledgedFiles). */
export const MAX_GUARDED_LISTED = 200;
/** true = alterar este caminho exige confirmação explícita do usuário antes de integrar. Em qualquer pasta do repositório (monorepos). */
export function isGuardedPath(file) {
  const p = String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (!p) return false;
  const wrapped = `/${p}`;
  if (CFG_FILES.some((f) => wrapped.endsWith(`/${f}`))) return true;
  if (CFG_DIRS.some((d) => wrapped.includes(`/${d}/`))) return true;
  const parts = p.split('/');
  if (parts.some((c) => SHORT_NAME_RE.test(c))) return true;
  return SENSITIVE_BASE.some((re) => re.test(parts.at(-1)));
}
/** Confirmação do usuário vale só se TODO arquivo guardado recalculado agora estiver na lista que ele viu (`acknowledgedFiles`). */
export function ackCovers(guarded, acknowledgedFiles) {
  if (!Array.isArray(acknowledgedFiles)) return false;
  const seen = new Set(acknowledgedFiles.filter((f) => typeof f === 'string'));
  return guarded.every((f) => seen.has(f));
}

export function createFlowGit({ db, worktrees, runGit = git, now = store.now, uid = store.uid, persist = store.saveOrThrow } = {}) {
  void uid; // reservado no contrato (identificadores de auditoria); nada aqui precisa gerar ids
  const G = runGit;
  const lock = (repoPath, fn) => withRepoLock(repoKey(repoPath), fn);
  const tryPersist = () => { try { persist(); return null; } catch (e) { return e; } };
  const guardedAll = new WeakMap(); // avaliação (assessFinal) -> lista COMPLETA de arquivos guardados; fica fora do objeto devolvido
  const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra });
  const log = (message, extra = {}) => { try { store.log('flow', message, extra); } catch { /* sem banco carregado */ } };

  /** run.git utilizável para operar: modo git, campos validados. Devolve null (ok) ou a recusa. */
  function gitProblem(run) {
    const g = run?.git;
    if (!g || g.mode !== 'git') return fail('not_ready', 'A missão não está em modo Git.');
    if (!MISSION_BRANCH_RE.test(String(g.branch)) || g.branch !== missionBranchFor(run.id)) return fail('not_ready', 'A branch da missão registrada é inválida.');
    if (!SHA_RE.test(String(g.tip)) || !SHA_RE.test(String(g.baseCommit))) return fail('not_ready', 'Os commits registrados da missão são inválidos.');
    if (!USER_BRANCH_RE.test(String(g.baseBranch))) return fail('not_ready', 'A branch-base registrada é inválida.');
    if (typeof g.repoPath !== 'string' || !g.repoPath) return fail('not_ready', 'O repositório da missão não está registrado.');
    if (g.state === 'creating') return fail('not_ready', 'A criação da branch da missão não foi concluída; concilie (settle) antes.');
    return null;
  }
  /** Valor da ref `refs/heads/<branch>`: { known, sha } (sha null = não existe). */
  async function refOf(repoPath, branch) {
    const r = await G(repoPath, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]);
    if (r.failed) return { known: false, sha: null, reason: why(r) };
    const v = r.out.trim();
    return { known: true, sha: r.code === 0 && SHA_RE.test(v) ? v : null };
  }
  /** 0 = ancestral, 1 = não é, null = o Git não respondeu/erro. */
  async function isAncestor(repoPath, a, b) {
    const r = await G(repoPath, ['merge-base', '--is-ancestor', a, b]);
    if (r.failed) return null;
    return r.code === 0 ? true : r.code === 1 ? false : null;
  }
  /**
   * Arquivos alterados com o modo (sem detecção de renomeação: renomear `.env` mostra o nome antigo e o novo). `range` = ['a...b'] ou [a, b]. `--raw -z` traz
   * `:<modo antigo> <modo novo> <sha> <sha> <status>\0<caminho>\0`; modo 120000 (antes ou depois) = link simbólico. Saída fora desse formato = desconhecido.
   * Devolve { known, files, guarded } (guarded = caminhos guardados ou links simbólicos, lista COMPLETA).
   */
  async function changedFiles(repoPath, range) {
    const r = await G(repoPath, ['diff', '--raw', '--no-abbrev', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', '-z', ...range, '--']);
    if (r.failed || r.code !== 0) return { known: false, files: [], guarded: [], reason: r.failed ? why(r) : clip(r.err, 160) };
    const tok = String(r.out).split('\0'), files = [], guarded = [];
    for (let i = 0; i < tok.length; i++) {
      if (!tok[i]) continue;
      const meta = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ [A-Z][0-9]*$/.exec(tok[i]);
      const file = tok[i + 1];
      if (!meta || !file) return { known: false, files: [], guarded: [], reason: 'a saída do git diff não está no formato esperado' };
      i++;
      files.push(file);
      if (meta[1] === '120000' || meta[2] === '120000' || isGuardedPath(file)) guarded.push(file);
    }
    return { known: true, files, guarded };
  }
  const listText = (files) => `${files.slice(0, 5).join(', ')}${files.length > 5 ? `, … (${files.length} no total)` : ''}`;
  /** merge-tree só grava objetos (nunca refs, índice ou pasta). { tree, conflicts } ou { error }. */
  async function mergeTree(repoPath, ours, theirs) {
    const mt = await G(repoPath, ['merge-tree', '--write-tree', '--no-messages', '--name-only', ours, theirs]);
    const ls = lines(mt.out);
    if (!mt.failed && mt.code === 0 && SHA_RE.test(ls[0] ?? '')) return { tree: ls[0], conflicts: [] };
    if (!mt.failed && mt.code === 1) return { tree: SHA_RE.test(ls[0] ?? '') ? ls[0] : null, conflicts: [...new Set(ls.slice(1))].slice(0, 50) };
    return { error: mt.failed ? `o Git não respondeu (${why(mt)})` : `merge-tree falhou: ${clip(mt.err, 160)}`, unknown: !!mt.failed };
  }
  /** Branch em checkout em QUALQUER worktree do repositório (inclusive o principal)? { known, checkedOut, path }. */
  async function checkedOut(repoPath, branch) {
    const l = await G(repoPath, ['worktree', 'list', '--porcelain']);
    if (l.failed || l.code !== 0) return { known: false, reason: l.failed ? why(l) : clip(l.err, 160) };
    for (const blk of String(l.out).split(/\r?\n\r?\n/)) {
      const ls = lines(blk);
      if (ls.includes(`branch refs/heads/${branch}`)) return { known: true, checkedOut: true, path: ls.find((x) => x.startsWith('worktree '))?.slice(9) ?? null };
    }
    return { known: true, checkedOut: false };
  }
  const workspaceOf = (run) => {
    const f = (db.flows ?? []).find((x) => x.id === run.flowId);
    return f ? (db.workspaces ?? []).find((w) => w.id === f.workspaceId) ?? null : null;
  };
  const recordOf = (id) => (db.worktrees ?? []).find((w) => w.id === id) ?? null;
  const ownRecord = (run, id) => { const r = recordOf(id); return r && r.flow?.runId === run.id && repoKey(r.repoPath) === repoKey(run.git.repoPath) && WT_BRANCH_RE.test(String(r.branch)) ? r : null; };

  // ---------- probe ----------
  /** Modo do workspace. `unknown` = o Git não respondeu (ou a pasta sumiu): quem chama FALHA o run, nunca cai no modo pasta. */
  async function probe(ws) {
    if (!ws?.path || !fs.existsSync(ws.path)) return { mode: 'unknown', reason: 'a pasta do workspace não existe' };
    const r = await resolveRepo(ws.path, G);
    if (r.error) return r.unknown ? { mode: 'unknown', reason: r.error } : { mode: 'folder', reason: r.error };
    if (!USER_BRANCH_RE.test(r.branch)) return { mode: 'folder', reason: `a branch atual ("${clip(r.branch, 60)}") tem um nome que o FORGE não usa com segurança` };
    // o paralelo depende de `merge-tree --write-tree` (Git 2.38+); sem ele a integração das etapas nunca funcionaria
    const cap = await G(r.path, ['merge-tree', '--write-tree', '--no-messages', r.commit, r.commit]);
    if (cap.failed) return { mode: 'unknown', reason: `não foi possível consultar o Git (${why(cap)})` };
    if (cap.code !== 0) return { mode: 'folder', reason: 'a versão do Git não tem "merge-tree --write-tree" (exige Git 2.38 ou mais novo)' };
    return { mode: 'git', repoPath: r.path, baseBranch: r.branch, baseCommit: r.commit };
  }

  // ---------- branch da missão ----------
  /** `git branch orch/run_x <baseCommit>` SEM checkout. Base: `base` (resultado do probe) ou os campos de run.git (ex.: `mode: 'pending'` com repoPath/baseBranch/baseCommit). */
  async function createMissionBranch(run, base = null) {
    const src = base ?? run?.git ?? {};
    const branch = missionBranchFor(run?.id);
    if (!branch) return fail('invalid_run', 'Identificador do run fora do formato esperado; a branch da missão não foi criada.');
    if (run.git?.mode === 'git' && run.git.state === 'ready') return fail('already_created', 'A branch da missão já foi criada.');
    const { repoPath, baseBranch, baseCommit } = src;
    if (typeof repoPath !== 'string' || !repoPath || !USER_BRANCH_RE.test(String(baseBranch)) || !SHA_RE.test(String(baseCommit))) return fail('invalid_base', 'Base da missão inválida (repositório, branch ou commit); a branch da missão não foi criada.');
    return lock(repoPath, async () => {
      const cm = await G(repoPath, ['rev-parse', '--verify', '-q', `${baseCommit}^{commit}`]);
      if (cm.failed) return fail('git_unknown', `Não foi possível consultar o Git (${why(cm)}); a branch da missão não foi criada.`);
      if (cm.code !== 0 || cm.out.trim() !== baseCommit) return fail('invalid_base', 'O commit-base da missão não existe no repositório; a branch da missão não foi criada.');
      const ex = await refOf(repoPath, branch);
      if (!ex.known) return fail('git_unknown', `Não foi possível consultar o Git (${ex.reason}); a branch da missão não foi criada.`);
      if (ex.sha) return fail('branch_exists', `A branch "${branch}" já existe no repositório; nada foi alterado.`);
      const prev = run.git;
      // `rebasedFrom` (nota visível: a base mudou depois de uma criação que não chegou a acontecer) atravessa a recriação do objeto
      run.git = { mode: 'git', fallbackReason: null, repoPath, baseBranch, baseCommit, branch, tip: baseCommit, state: 'creating', op: null, integration: null, pending: null, leftovers: [], ...(prev?.rebasedFrom ? { rebasedFrom: prev.rebasedFrom } : {}) };
      const pe = tryPersist();
      if (pe) { run.git = prev; return fail('persistence_failed', `O banco não pôde ser gravado (${errText(pe)}); a branch da missão NÃO foi criada.`); }
      const br = await G(repoPath, ['branch', '--no-track', branch, baseCommit]); // `git branch` nunca faz checkout
      const after = await refOf(repoPath, branch);
      if (!after.known) return fail('git_unknown', `O Git não respondeu depois de criar a branch (${after.reason}); a conciliação (settle) decide pelo Git real.`);
      if (after.sha === baseCommit) {
        run.git = { ...run.git, state: 'ready' };
        const pe2 = tryPersist();
        return { ok: true, git: run.git, persisted: !pe2 };
      }
      if (!after.sha) { run.git = prev; tryPersist(); return fail('branch_failed', `Não foi possível criar a branch da missão: ${clip(br.err, 200) || 'erro do Git'}.`); }
      run.git = { ...run.git, state: 'inconsistent' }; tryPersist();
      return fail('inconsistent', `A branch "${branch}" ficou em ${short(after.sha)}, não no commit-base esperado; nada foi desfeito.`);
    });
  }

  // ---------- worktree da etapa ----------
  /** Worktree novo da etapa, criado da ponta ATUAL da branch da missão (o gerenciador confere a ref dentro do lock). */
  async function stepWorktree(run, rs, workspace = null) {
    const no = gitProblem(run); if (no) return no;
    if (!STEP_ID_RE.test(String(rs?.stepId))) return fail('invalid_step', 'Etapa inválida.');
    const ws = workspace ?? workspaceOf(run);
    if (!ws?.path) return fail('workspace_missing', 'O workspace da missão não foi encontrado.');
    const real = (() => { try { return fs.realpathSync.native(ws.path); } catch { return null; } })();
    if (!real || repoKey(real) !== repoKey(run.git.repoPath)) return fail('workspace_changed', 'O workspace não é mais o repositório da missão.');
    const c = await worktrees.create({ mission: { id: run.id }, workspace: ws, from: { branch: run.git.branch, commit: run.git.tip }, flow: { runId: run.id, stepId: rs.stepId } });
    if (!c.ok) return fail(c.code ?? 'worktree_failed', c.error, { status: c.status });
    rs.worktreeId = c.record.id; rs.branch = c.record.branch; // o worktree existe: a memória segue a realidade mesmo se a gravação falhar
    const pe = tryPersist();
    return { ok: true, record: c.record, worktreeId: c.record.id, branch: c.record.branch, persisted: !pe };
  }

  /** Etapa com continueFrom que reaproveita o worktree de uma anterior: avança o worktree até a ponta da missão (só fast-forward, limpo). Com `rs`, liga a etapa ao worktree. */
  async function refreshForContinue(run, wtId, rs = null) {
    const no = gitProblem(run); if (no) return no;
    const r = ownRecord(run, wtId);
    if (!r) return fail('worktree_missing', 'O worktree a reaproveitar não pertence a esta missão.');
    if (rs && !STEP_ID_RE.test(String(rs.stepId))) return fail('invalid_step', 'Etapa inválida.');
    const ff = await worktrees.fastForwardFlow(wtId, run.git.tip);
    if (!ff.ok) return fail(ff.code ?? 'fast_forward_failed', ff.error, { status: ff.status });
    if (rs) {
      rs.worktreeId = r.id; rs.branch = r.branch;
      if (!r.flow.stepIds.includes(rs.stepId)) r.flow = { ...r.flow, stepIds: [...r.flow.stepIds, rs.stepId] };
      tryPersist();
    }
    return { ok: true, advanced: !!ff.advanced, head: ff.head };
  }

  /**
   * I1: conferência ANTES de abrir/reabrir um terminal na cópia de uma etapa. O terminals.js considera revisada a configuração que está no HEAD da pasta; numa cópia de missão
   * o agente pode ter COMMITADO `.claude/settings.json` (ou hooks, `.mcp.json`…) ali, e o próximo terminal o executaria. Lista o que a cópia tem de próprio em relação à ponta
   * da missão (`<tip>...HEAD`, com modo: link simbólico conta) mais o que está sujo/não rastreado (`status -uall`) e aplica isGuardedPath. Somente leitura.
   * Devolve { ok: true, files: [] } (pode abrir) ou a recusa: `project_config_unreviewed` (+files), `git_unknown` (Git sem resposta: não abre), `worktree_missing`/`worktree_unusable`
   * (a cópia não serve: quem chama segue para outra cópia). Arquivos IGNORADOS pelo .gitignore não entram aqui: os de configuração do provedor seguem na inspeção do terminals.js.
   */
  async function configAudit(run, wtId) {
    const no = gitProblem(run); if (no) return no;
    const r = typeof wtId === 'string' ? ownRecord(run, wtId) : null;
    if (!r) return fail('worktree_missing', 'A cópia desta etapa não pertence a esta missão.');
    const bad = worktreeProblem(r, r.workspaceId);
    if (bad) return fail('worktree_unusable', `A cópia desta etapa (${r.id}) não está utilizável (${bad}).`);
    const unknown = (reason) => fail('git_unknown', `Não foi possível conferir a cópia desta etapa (${r.id}): ${reason}. O terminal não foi aberto.`);
    const ch = await changedFiles(r.path, [`${run.git.tip}...HEAD`]);
    if (!ch.known) return unknown(`o Git não listou o que ela tem de próprio (${ch.reason})`);
    const found = new Set(ch.guarded);
    const st = await G(r.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
    if (st.failed || st.code !== 0) return unknown(`o git status não respondeu (${st.failed ? why(st) : clip(st.err, 160)})`);
    const out = String(st.out ?? '');
    if (out && !out.endsWith('\0')) return unknown('a saída do git status veio incompleta');
    for (const ent of out.split('\0').filter(Boolean)) {
      if (!/^[ MTADRCU?!]{2} ./.test(ent)) return unknown('a saída do git status não está no formato esperado');
      const rel = ent.slice(3);
      let link = false; try { link = fs.lstatSync(path.join(r.path, ...rel.split('/'))).isSymbolicLink(); } catch { /* apagado: só o nome conta */ }
      if (link || isGuardedPath(rel)) found.add(rel);
    }
    const files = [...found];
    if (!files.length) return { ok: true, files: [] };
    return fail('project_config_unreviewed', `A cópia desta etapa (${r.id}) tem configuração executável, arquivos sensíveis ou links simbólicos que o agente alterou e que ainda não foram revisados (${listText(files)}). Revise-os na cópia: o FORGE não abre terminal nela sem a sua revisão e não confirma nada sozinho.`, { files: files.slice(0, MAX_GUARDED_LISTED) });
  }

  /** Commit do trabalho da etapa NA BRANCH DO WORKTREE (limpo = nada a commitar). Grava rs.commit. */
  async function commitStep(run, rs, { message = '' } = {}) {
    const no = gitProblem(run); if (no) return no;
    const r = rs?.worktreeId ? ownRecord(run, rs.worktreeId) : null;
    if (!r) return fail('worktree_missing', 'A etapa não tem um worktree desta missão.');
    const c = await worktrees.commitFlowWork(r.id, { message });
    if (!c.ok) return fail(c.code ?? 'commit_failed', c.error, { status: c.status });
    rs.commit = c.head; tryPersist();
    return { ok: true, committed: c.committed, head: c.head };
  }

  // ---------- integração da etapa na branch da missão (só plumbing) ----------
  /**
   * Integra a etapa na branch da missão. Devolve { ok, state, integration, code?, error? }; ok = integrated|empty. Nenhuma pasta de trabalho é tocada.
   * Confirmação de configuração/sensíveis (C1): só vale com `acknowledgeProjectConfig: true` E se TODO arquivo guardado recalculado agora estiver em `acknowledgedFiles`
   * (a lista que o usuário viu); arquivo novo depois da lista = continua `blocked` com a lista atual.
   */
  async function integrateStep(run, rs, { acknowledgeProjectConfig = false, acknowledgedFiles = null } = {}) {
    const no = gitProblem(run); if (no) return no;
    if (run.git.op) return fail('not_ready', 'Há uma integração final em andamento; nada foi alterado.');
    const cur = rs?.integration?.state ?? 'none';
    if (cur === 'integrated' || cur === 'empty') return { ok: true, state: cur, integration: rs.integration };
    if (cur === 'integrating') return fail('not_ready', 'A integração anterior desta etapa não foi conciliada (settle); nada foi alterado.', { state: cur });
    if (!RETRYABLE.has(cur)) return fail('not_ready', `Estado de integração inesperado ("${clip(cur, 30)}").`, { state: cur });
    const { repoPath, branch } = run.git;
    const keepInt = rs.integration;
    /** Grava um estado SEM efeito no Git: se a gravação falhar, a memória volta ao que era. O `reason` (C3) = o código da recusa, para o cliente distinguir. */
    const settleState = (integration, extra = {}) => {
      if (extra.code && !integration.reason && !['integrated', 'empty'].includes(integration.state)) integration = { ...integration, reason: extra.code };
      rs.integration = integration;
      const pe = tryPersist();
      if (pe) { rs.integration = keepInt; return fail('persistence_failed', `O banco não pôde ser gravado (${errText(pe)}); o estado da integração não mudou.`, { state: cur }); }
      return { ok: ['integrated', 'empty'].includes(integration.state), state: integration.state, integration, ...extra };
    };
    const mark = (state, fields = {}) => ({ state, from: run.git.tip, to: null, conflicts: [], files: [], error: null, at: now(), ...fields });

    const r = rs?.worktreeId ? ownRecord(run, rs.worktreeId) : null;
    if (!r) return settleState(mark('error', { error: 'a etapa não tem um worktree desta missão' }), { code: 'worktree_missing' });
    // (b) commit do trabalho pendente (FORA do lock da missão: o gerenciador usa o mesmo lock)
    const title = clip(String(rs.title ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(), 120);
    const cm = await commitStep(run, rs, { message: `Etapa ${rs.stepId}${title ? `: ${title}` : ''} (${branch})` });
    if (!cm.ok) return settleState(mark('error', { error: clip(`não foi possível commitar o trabalho da etapa: ${cm.error}`) }), { code: cm.code });

    return lock(repoPath, async () => {
      const tip = run.git.tip; // lida DENTRO do lock: outra etapa pode ter acabado de integrar
      const ref = await refOf(repoPath, branch);
      if (!ref.known) return settleState(mark('error', { error: `o Git não respondeu (${ref.reason})` }), { code: 'git_unknown' });
      if (ref.sha !== tip) return settleState(mark('error', { error: ref.sha ? `a branch da missão está em ${short(ref.sha)}, não na ponta registrada ${short(tip)} (mudou fora do FORGE)` : 'a branch da missão não existe mais' }), { code: 'mission_branch_changed' });
      // (a) a branch da missão nunca pode estar em checkout: mover a ref deixaria aquela pasta inconsistente
      const co = await checkedOut(repoPath, branch);
      if (!co.known) return settleState(mark('error', { error: `o Git não respondeu (${co.reason})` }), { code: 'git_unknown' });
      if (co.checkedOut) return settleState(mark('blocked', { error: 'a branch da missão está em checkout em outra pasta do repositório; troque a branch daquela pasta e tente de novo' /* sem o caminho absoluto: este texto sai na API */, reason: 'branch_checked_out' }), { code: 'branch_checked_out' });
      const hd = await refOf(repoPath, r.branch);
      if (!hd.known) return settleState(mark('error', { error: `o Git não respondeu (${hd.reason})` }), { code: 'git_unknown' });
      if (!hd.sha) return settleState(mark('error', { error: 'a branch do worktree da etapa não existe mais' }), { code: 'worktree_missing' });
      const head = hd.sha;
      // ancestral da ponta: nada de novo
      const inTip = await isAncestor(repoPath, head, tip);
      if (inTip === null) return settleState(mark('error', { error: 'não foi possível comparar os commits' }), { code: 'git_unknown' });
      if (inTip) return settleState(mark('empty', { to: tip }));
      // (c) guarda de configuração executável / arquivos sensíveis
      const ch = await changedFiles(repoPath, [`${tip}...${head}`]);
      if (!ch.known) return settleState(mark('error', { error: `não foi possível listar os arquivos alterados (${ch.reason})` }), { code: 'git_unknown' });
      const guarded = ch.guarded; // lista COMPLETA: a confirmação confere todos, a visão mostra até MAX_GUARDED_LISTED
      const ack = guarded.length > 0 && acknowledgeProjectConfig === true && ackCovers(guarded, acknowledgedFiles);
      if (guarded.length && !ack) return settleState(mark('blocked', { files: guarded.slice(0, MAX_GUARDED_LISTED), reason: 'project_config_changed', error: `a etapa alterou configuração executável, arquivos sensíveis ou links simbólicos (${listText(guarded)}); integre só depois de revisar e confirmar${acknowledgeProjectConfig === true ? ' (a lista mudou depois da sua confirmação: confira de novo)' : ''}` }), { code: 'project_config_changed' });
      // (d) fast-forward ou merge montado por plumbing
      const ff = await isAncestor(repoPath, tip, head);
      if (ff === null) return settleState(mark('error', { error: 'não foi possível comparar os commits' }), { code: 'git_unknown' });
      let next = head;
      if (!ff) {
        const mt = await mergeTree(repoPath, tip, head);
        if (mt.error) return settleState(mark('error', { error: mt.error }), { code: mt.unknown ? 'git_unknown' : 'merge_check_failed' });
        if (mt.conflicts.length) return settleState(mark('conflict', { conflicts: mt.conflicts, error: `conflito com o que já foi integrado na missão (${mt.conflicts.slice(0, 5).join(', ')}${mt.conflicts.length > 5 ? ', …' : ''})` }), { code: 'conflict' });
        const ct = await G(repoPath, ['commit-tree', mt.tree, '-p', tip, '-p', head, '-m', `Integra etapa ${rs.stepId} na missão ${branch}`], { env: GIT_IDENT });
        if (ct.failed || ct.code !== 0 || !SHA_RE.test(ct.out.trim())) return settleState(mark('error', { error: `não foi possível montar o commit de integração (${ct.failed ? why(ct) : clip(ct.err, 160)})` }), { code: ct.failed ? 'git_unknown' : 'merge_failed' });
        next = ct.out.trim();
      }
      // (e) diário ANTES do efeito; se não gravar, a ref não é tocada
      const journal = mark('integrating', { to: next, files: guarded.slice(0, MAX_GUARDED_LISTED), ...(guarded.length ? { acknowledged: true } : {}) });
      rs.integration = journal;
      const pe = tryPersist();
      if (pe) { rs.integration = keepInt; return fail('persistence_failed', `O banco não pôde ser gravado (${errText(pe)}); a integração NÃO foi feita e a branch da missão não mudou.`, { state: cur }); }
      const up = await G(repoPath, ['update-ref', '-m', `FORGE: integra etapa ${rs.stepId}`, `refs/heads/${branch}`, next, tip]); // compare-and-swap: só move se a ref ainda está na ponta antiga
      const now2 = await refOf(repoPath, branch);
      if (!now2.known) { tryPersist(); return fail('git_unknown', `O Git não respondeu depois da integração (${now2.reason}); a conciliação (settle) decide pelo Git real.`, { state: 'integrating', integration: rs.integration }); }
      if (now2.sha === next) {
        rs.integration = { ...journal, state: 'integrated', at: now() }; run.git.tip = next;
        const pe2 = tryPersist();
        if (guarded.length) log(`Missão ${branch}: etapa ${rs.stepId} integrada com a confirmação do usuário para ${guarded.length} arquivo(s) de configuração/sensível(is): ${listText(guarded)}.`, { runId: run.id });
        return { ok: true, state: 'integrated', integration: rs.integration, tip: next, fastForward: !!ff, persisted: !pe2 };
      }
      if (now2.sha === tip) {
        rs.integration = { ...journal, state: 'pending', to: null, error: clip(`a branch da missão não foi atualizada: ${clip(up.err, 160) || 'erro do Git'}`) }; tryPersist();
        return { ok: false, code: 'update_failed', state: 'pending', integration: rs.integration, error: rs.integration.error };
      }
      rs.integration = { ...journal, state: 'error', reason: 'mission_branch_changed', error: now2.sha ? `a branch da missão mudou fora do FORGE para ${short(now2.sha)}; nada foi desfeito` : 'a branch da missão sumiu durante a integração' }; tryPersist();
      return { ok: false, code: 'mission_branch_changed', state: 'error', integration: rs.integration, error: rs.integration.error };
    });
  }

  // ---------- integração final na pasta do usuário ----------
  /** Avaliação SÓ de leitura (merge-tree grava objetos, nunca refs/índice/pasta). Sem lock próprio: integrateFinal a chama dentro do lock. */
  async function assessFinal(run) {
    const reasons = [], add = (code, message) => { if (!reasons.some((x) => x.code === code && x.message === message)) reasons.push({ code, message }); };
    const a = { result: 'invalid', reasons, conflicts: [], files: [], digest: null, ffPossible: false, mergeTree: null, targetHead: null, already: false, empty: false };
    const done = () => {
      a.result = a.conflicts.length ? 'conflict' : reasons.length ? 'invalid' : 'mergeable';
      const g = run.git ?? {};
      a.digest = crypto.createHash('sha256').update(JSON.stringify([run.id, g.repoPath ?? null, g.baseBranch ?? null, a.targetHead, g.tip ?? null, a.mergeTree])).digest('hex').slice(0, 32);
      return a;
    };
    const no = gitProblem(run); if (no) { add('not_ready', no.error); return done(); }
    if (run.git.op) { add('not_ready', `há uma operação em andamento (${run.git.op.kind}); concilie antes`); return done(); }
    const { repoPath, baseBranch, baseCommit, tip, branch } = run.git;
    const ref = await refOf(repoPath, branch);
    if (!ref.known) { add('git_unknown', `não foi possível consultar a branch da missão (${ref.reason})`); return done(); }
    if (!ref.sha) { add('not_ready', 'a branch da missão não existe mais'); return done(); }
    if (ref.sha !== tip) { add('not_ready', `a branch da missão está em ${short(ref.sha)}, não na ponta registrada ${short(tip)}`); return done(); }
    const repo = await resolveRepo(repoPath, G);
    if (repo.error) {
      if (repo.unknown) add('git_unknown', repo.error);
      else if (/HEAD destacado/.test(repo.error)) add('target_branch_changed', `a pasta do usuário não está mais em "${baseBranch}" (${repo.error})`);
      else add('not_ready', repo.error);
      return done();
    }
    a.targetHead = repo.commit;
    if (tip === baseCommit) { a.empty = true; return done(); } // nada foi produzido: não há o que integrar nem por que olhar a pasta
    if (repo.branch !== baseBranch) { add('target_branch_changed', `a pasta do usuário agora está na branch "${repo.branch}", não em "${baseBranch}"`); return done(); }
    const already = await isAncestor(repoPath, tip, repo.commit);
    if (already === null) { add('git_unknown', 'não foi possível comparar a ponta da missão com a branch do usuário'); return done(); }
    if (already) { a.already = true; return done(); } // já contido: a pasta não muda, então sujeira e configuração não importam
    const st = await dirtyStateOf(repoPath, G);
    if (st.state === 'dirty') add('target_dirty', `a pasta do usuário tem ${st.files.length} alteração(ões) não commitadas; a integração só ocorre com ela limpa`);
    else if (st.state === 'unknown') add('git_unknown', `não foi possível determinar o estado da pasta do usuário (${st.reason})`);
    const ch = await changedFiles(repoPath, [baseCommit, tip]);
    if (!ch.known) add('git_unknown', `não foi possível listar os arquivos alterados pela missão (${ch.reason})`);
    else {
      guardedAll.set(a, ch.guarded); // lista COMPLETA (interna): a confirmação do usuário precisa cobrir todos
      a.files = ch.guarded.slice(0, MAX_GUARDED_LISTED);
      if (a.files.length) add('project_config_changed', `a missão alterou configuração executável, arquivos sensíveis ou links simbólicos (${listText(ch.guarded)}); a integração exige confirmação explícita`);
    }
    const ff = await isAncestor(repoPath, repo.commit, tip);
    if (ff === null) { add('git_unknown', 'não foi possível comparar os commits'); return done(); }
    a.ffPossible = ff;
    const mt = await mergeTree(repoPath, repo.commit, tip);
    if (mt.error) add(mt.unknown ? 'git_unknown' : 'not_ready', mt.error);
    else {
      a.mergeTree = mt.tree; a.conflicts = mt.conflicts;
      if (mt.conflicts.length) add('conflict', `a missão conflita com a branch "${baseBranch}" (${mt.conflicts.slice(0, 5).join(', ')}${mt.conflicts.length > 5 ? ', …' : ''})`);
    }
    return done();
  }

  const CODE_ORDER = ['git_unknown', 'not_ready', 'conflict', 'target_branch_changed', 'target_dirty', 'project_config_changed'];
  /**
   * Integra a missão na branch atual do workspace. `by: 'auto'` nunca aceita a confirmação de configuração (só clique do usuário). A confirmação (C1) só vale se TODOS os
   * arquivos guardados recalculados agora estiverem em `acknowledgedFiles` (a lista que o usuário viu); senão continua recusada com a lista atual.
   */
  async function integrateFinal(run, { by, acknowledgeProjectConfig = false, acknowledgedFiles = null } = {}) {
    if (by !== 'auto' && by !== 'user') return fail('invalid_request', 'Origem da integração inválida.');
    const wantsAck = by === 'user' && acknowledgeProjectConfig === true;
    const no = gitProblem(run); if (no) return no;
    if (run.git.integration) return { ok: true, integration: run.git.integration, mode: run.git.integration.mode, repeated: true };
    return lock(run.git.repoPath, async () => {
      const a = await assessFinal(run);
      const all = guardedAll.get(a) ?? a.files;
      const ack = wantsAck && all.length > 0 && ackCovers(all, acknowledgedFiles);
      const blocking = a.reasons.filter((x) => !(ack && x.code === 'project_config_changed'));
      const { repoPath, baseBranch, tip, branch } = run.git;
      if (blocking.length) {
        const code = CODE_ORDER.find((c) => blocking.some((x) => x.code === c)) ?? blocking[0].code;
        run.git.pending = { reasons: a.reasons, conflicts: a.conflicts, files: a.files, checkedAt: now() }; tryPersist(); // diagnóstico (sem efeito no Git)
        const stale = wantsAck && !ack && blocking.some((x) => x.code === 'project_config_changed') ? ' A sua confirmação não cobre a lista atual de arquivos: confira de novo.' : '';
        return fail(code, `Integração recusada: ${blocking.map((x) => x.message).join('; ')}. Nada foi alterado.${stale}`, { reasons: a.reasons, conflicts: a.conflicts, files: a.files, assessment: a });
      }
      const policy = by === 'auto' ? 'autoIntegrate' : 'user';
      const keep = { integration: run.git.integration, pending: run.git.pending, op: run.git.op, state: run.git.state };
      const restore = () => Object.assign(run.git, keep);
      const record = (mode, from, to) => ({ by, mode, at: now(), from, to, missionTip: tip, digest: a.digest, policy, ...(ack ? { acknowledgedFiles: all.slice(0, MAX_GUARDED_LISTED) } : {}) });
      if (a.empty || a.already) { // nada muda na pasta do usuário: só o registro
        const mode = a.empty ? 'empty' : 'already';
        run.git.integration = record(mode, a.targetHead, a.targetHead); run.git.pending = null; if (run.git.state === 'inconsistent') run.git.state = 'ready';
        const pe = tryPersist();
        if (pe) { restore(); return fail('persistence_failed', `O banco não pôde ser gravado (${errText(pe)}); nada foi registrado.`); }
        log(`Missão ${branch}: integração final "${mode}" (${by === 'auto' ? 'automática' : 'pelo usuário'}); a pasta não precisou mudar.`, { runId: run.id, digest: a.digest });
        return { ok: true, integration: run.git.integration, mode };
      }
      let newCommit = tip;
      if (!a.ffPossible) {
        const ct = await G(repoPath, ['commit-tree', a.mergeTree, '-p', a.targetHead, '-p', tip, '-m', `Integra missão ${branch} em ${baseBranch}`], { env: GIT_IDENT });
        if (ct.failed || ct.code !== 0 || !SHA_RE.test(ct.out.trim())) return fail(ct.failed ? 'git_unknown' : 'merge_failed', `Não foi possível montar o commit de integração (${ct.failed ? why(ct) : clip(ct.err, 160)}); nada foi alterado.`);
        newCommit = ct.out.trim();
      }
      const mode = a.ffPossible ? 'ff' : 'merge';
      // diário ANTES de tocar a pasta do usuário
      run.git.op = { kind: 'final_integrate', at: now(), oldHead: a.targetHead, newCommit, by, mode, digest: a.digest, missionTip: tip, policy };
      const pe = tryPersist();
      if (pe) { restore(); return fail('persistence_failed', `O banco não pôde ser gravado (${errText(pe)}); a integração NÃO foi iniciada e a pasta do usuário não mudou.`); }
      const mg = await G(repoPath, ['merge', '--ff-only', '--no-edit', newCommit]); // hooks desligados pelo runGit (core.hooksPath inexistente)
      const hp = await probeHeadOf(repoPath, G), st = await dirtyStateOf(repoPath, G);
      const br = await G(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']);
      const onBase = !br.failed && br.code === 0 && br.out.trim() === baseBranch;
      const op = run.git.op;
      if (hp.known && hp.head === newCommit && st.state === 'clean' && onBase) {
        run.git.op = null; run.git.pending = null; if (run.git.state === 'inconsistent') run.git.state = 'ready';
        run.git.integration = record(mode, op.oldHead, newCommit);
        tryPersist();
        log(`Missão ${branch} integrada em ${baseBranch} (${mode}, ${by === 'auto' ? 'automática pela política autoIntegrate' : 'pelo usuário'}): ${short(op.oldHead)} → ${short(newCommit)}.`, { runId: run.id, digest: a.digest });
        return { ok: true, integration: run.git.integration, mode };
      }
      if (hp.known && hp.head === op.oldHead && st.state === 'clean' && onBase) {
        run.git.op = null; tryPersist();
        return fail('merge_failed', `A integração falhou e a pasta do usuário ficou exatamente como estava: ${clip(mg.err, 200) || 'erro do Git'}`);
      }
      run.git.op = null; run.git.state = 'inconsistent';
      run.git.inconsistency = { at: now(), reason: clip(`HEAD ${hp.known ? short(hp.head) || 'ilegível' : `desconhecido (${hp.reason})`}, pasta ${st.state}, branch ${onBase ? baseBranch : 'outra ou desconhecida'}; esperado ${short(newCommit)} limpo em ${baseBranch}`) };
      tryPersist();
      log(`Missão ${branch}: integração final terminou em estado INESPERADO (${run.git.inconsistency.reason}); nada foi desfeito.`, { runId: run.id });
      return fail('inconsistent', 'A integração terminou em um estado INESPERADO da pasta do usuário; nada foi desfeito automaticamente. Inspecione o repositório antes de qualquer outra ação.', { status: 500 });
    });
  }

  // ---------- limpeza e descarte (regras seguras do gerenciador) ----------
  /** Remove os worktrees do run pelas regras do cleanup() (nunca trabalho não integrado); o que não sair vai para `leftovers`. */
  async function cleanWorktrees(run) {
    const leftovers = [];
    for (const r of [...(db.worktrees ?? [])]) {
      if (r.flow?.runId !== run.id || r.state === 'removed') continue;
      if (r.state === 'failed' && !fs.existsSync(r.path)) continue; // criação falhou sem deixar nada
      let res;
      try { res = await worktrees.cleanup(r.id); } catch (e) { res = { ok: false, error: `erro inesperado (${clip(e?.message, 120)})` }; }
      if (!res?.ok) leftovers.push({ worktreeId: r.id, reason: clip(res?.error ?? 'não removido', 300) });
    }
    return leftovers;
  }
  /**
   * Depois da integração final: limpa worktrees e apaga a branch da missão SÓ se ela estiver contida na branch-base (`branch -d`). `keepBranch: true` (limpeza de cópias de um run
   * que não foi integrado: falhou, cancelado ou descartado) só refaz a remoção segura das cópias: a branch fica como o usuário a deixou.
   */
  async function cleanupRun(run, { keepBranch = false } = {}) {
    const no = gitProblem(run); if (no) return no;
    if (run.git.op) return fail('not_ready', 'Há uma operação em andamento; nada foi removido.');
    const leftovers = await cleanWorktrees(run);
    const { repoPath, branch, baseBranch } = run.git;
    if (keepBranch === true) {
      run.git.leftovers = leftovers; run.git.cleanedAt = now();
      const pe = tryPersist();
      return { ok: true, leftovers, branchDeleted: run.git.branchDeleted === true, persisted: !pe };
    }
    const out = await lock(repoPath, async () => {
      const ref = await refOf(repoPath, branch);
      if (!ref.known) return { branchDeleted: false, branchNote: `o Git não respondeu (${ref.reason})` };
      if (!ref.sha) return { branchDeleted: true };
      const base = await refOf(repoPath, baseBranch);
      if (!base.known || !base.sha) return { branchDeleted: false, branchNote: 'a branch-base não pôde ser lida' };
      const anc = await isAncestor(repoPath, ref.sha, base.sha);
      if (!anc) return { branchDeleted: false, branchNote: anc === null ? 'não foi possível comparar com a branch-base' : 'a branch da missão tem commits não integrados' };
      await G(repoPath, ['branch', '-d', branch]); // -d: o Git ainda recusa se não estiver integrada
      const after = await refOf(repoPath, branch);
      return { branchDeleted: after.known && !after.sha, ...(after.known && after.sha ? { branchNote: 'o Git recusou apagar a branch' } : {}) };
    });
    run.git.leftovers = leftovers; run.git.branchDeleted = out.branchDeleted; run.git.cleanedAt = now();
    const pe = tryPersist();
    return { ok: true, leftovers, branchDeleted: out.branchDeleted, ...(out.branchNote ? { branchNote: out.branchNote } : {}), persisted: !pe };
  }
  /** Descartar: worktrees pelas regras seguras; branch da missão só com `deleteBranch: true` (`branch -D`, nunca se estiver em checkout). */
  async function discard(run, { deleteBranch = false } = {}) {
    const no = gitProblem(run); if (no) return no;
    if (run.git.op) return fail('not_ready', 'Há uma operação em andamento; nada foi removido.');
    const leftovers = await cleanWorktrees(run);
    const { repoPath, branch } = run.git;
    let branchDeleted = !!run.git.branchDeleted, branchNote = null;
    if (deleteBranch === true) {
      const out = await lock(repoPath, async () => {
        const ref = await refOf(repoPath, branch);
        if (!ref.known) return { deleted: false, note: `o Git não respondeu (${ref.reason})` };
        if (!ref.sha) return { deleted: true };
        const co = await checkedOut(repoPath, branch);
        if (!co.known) return { deleted: false, note: `o Git não respondeu (${co.reason})` };
        if (co.checkedOut) return { deleted: false, note: `a branch está em checkout em "${clip(co.path, 200)}"` };
        await G(repoPath, ['branch', '-D', branch]); // pedido explícito do usuário (caixa "apagar também a branch")
        const after = await refOf(repoPath, branch);
        return { deleted: after.known && !after.sha, note: after.known && after.sha ? 'o Git recusou apagar a branch' : null };
      });
      branchDeleted = out.deleted; branchNote = out.note ?? null;
    }
    run.git.leftovers = leftovers; run.git.branchDeleted = branchDeleted; run.git.discardedAt = now();
    const pe = tryPersist();
    if (branchDeleted && deleteBranch === true) log(`Missão ${branch} descartada; branch apagada a pedido do usuário.`, { runId: run.id });
    return { ok: true, leftovers, branchDeleted, ...(branchNote ? { branchNote } : {}), persisted: !pe };
  }

  // ---------- conciliação depois de queda (só pelo Git real) ----------
  /** Resolve os diários pendentes do run. `unverified` = o Git não respondeu: o diário fica como estava para tentar de novo depois. */
  async function settle(run) {
    const g = run?.git;
    if (!g || g.mode !== 'git') return { ok: true, changed: [] };
    const branch = missionBranchFor(run.id);
    if (!branch || g.branch !== branch || typeof g.repoPath !== 'string') return fail('not_ready', 'Dados Git do run inválidos; nada foi conciliado.');
    return lock(g.repoPath, async () => {
      const changed = [], unverified = [];
      if (g.state === 'creating') {
        const ref = await refOf(g.repoPath, branch);
        if (!ref.known) unverified.push(`branch da missão: ${ref.reason}`);
        else if (ref.sha && ref.sha === g.baseCommit) { g.state = 'ready'; g.tip = g.baseCommit; changed.push('branch_ready'); }
        else if (!ref.sha) { run.git = { ...g, mode: 'pending', branch: null, tip: null, state: null }; changed.push('branch_absent'); } // a branch nunca foi criada: volta a "preparar Git"
        else { g.state = 'inconsistent'; g.inconsistency = { at: now(), reason: `a branch da missão existe em ${short(ref.sha)}, não no commit-base` }; changed.push('branch_inconsistent'); }
      }
      const gg = run.git;
      if (gg.mode === 'git' && gg.state !== 'creating') {
        let ref = null;
        for (const rs of run.steps ?? []) {
          if (rs?.integration?.state !== 'integrating') continue;
          ref ??= await refOf(gg.repoPath, branch);
          if (!ref.known) { unverified.push(`etapa ${rs.stepId}: ${ref.reason}`); continue; }
          const j = rs.integration;
          if (ref.sha && ref.sha === j.to) { rs.integration = { ...j, state: 'integrated', at: now() }; gg.tip = j.to; changed.push(`step_integrated:${rs.stepId}`); }
          else if (ref.sha && ref.sha === j.from) { rs.integration = { ...j, state: 'pending', to: null, error: 'a integração foi interrompida pelo reinício e será refeita' }; changed.push(`step_pending:${rs.stepId}`); }
          else { rs.integration = { ...j, state: 'error', reason: 'mission_branch_changed', error: ref.sha ? `depois do reinício a branch da missão está em ${short(ref.sha)}, fora do esperado; nada foi desfeito` : 'a branch da missão não existe mais' }; changed.push(`step_error:${rs.stepId}`); }
        }
        const op = gg.op;
        if (op?.kind === 'final_integrate') {
          const hp = await probeHeadOf(gg.repoPath, G);
          if (!hp.known) unverified.push(`pasta do usuário: ${hp.reason}`);
          else if (hp.head === op.newCommit) {
            gg.integration = { by: op.by ?? 'user', mode: op.mode ?? 'ff', at: now(), from: op.oldHead, to: op.newCommit, missionTip: op.missionTip ?? gg.tip, digest: op.digest ?? null, policy: op.policy ?? (op.by === 'auto' ? 'autoIntegrate' : 'user') };
            gg.op = null; gg.pending = null; changed.push('final_integrated');
            log(`Missão ${branch}: integração final confirmada pelo Git depois do reinício (${short(op.oldHead)} → ${short(op.newCommit)}).`, { runId: run.id, digest: op.digest ?? null });
          } else if (hp.head === op.oldHead) { gg.op = null; changed.push('final_unchanged'); }
          else { gg.op = null; gg.state = 'inconsistent'; gg.inconsistency = { at: now(), reason: `depois do reinício o HEAD do usuário está em ${short(hp.head) || 'ilegível'}, nem antes nem depois da integração` }; changed.push('final_inconsistent'); }
        }
      }
      const pe = changed.length ? tryPersist() : null;
      return { ok: true, changed, ...(unverified.length ? { unverified: unverified.join('; ') } : {}), persisted: !pe };
    });
  }

  return { probe, createMissionBranch, stepWorktree, refreshForContinue, configAudit, commitStep, integrateStep, assessFinal, integrateFinal, cleanupRun, discard, settle };
}
