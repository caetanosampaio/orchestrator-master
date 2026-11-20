// Git da missão (Missions v2, fatia F5): Git REAL em repositórios temporários e gerenciador de worktrees REAL. Prova que a branch da missão nunca entra em checkout,
// que as etapas integram só por plumbing (ff, merge, conflito, CAS), que a guarda de configuração/sensíveis bloqueia sem confirmação, que a pasta do usuário só muda
// na integração final (e só limpa), que o diário é gravado antes de cada efeito (falha de gravação = nada executado) e que settle concilia pelo Git real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flowgit-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const store = await import('../store.js');
const W = await import('../worktrees.js');
const { createFlowGit, isGuardedPath, missionBranchFor, ackCovers } = await import('../flow-git.js');
const db = store.load(); db.missions = []; db.workspaces = []; db.worktrees = []; db.flows = []; db.flowRuns = []; store.saveOrThrow();
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const G = (cwd, args, env = {}) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } }).trim();
const wtm = W.createWorktreeManager({ db, root: path.join(tmp, 'wts') });

// persist contável, com falha condicional e gancho (para mudar o Git "entre o diário e o efeito")
const P = { calls: 0, failIf: null, hook: null };
const persist = () => {
  P.calls++;
  if (P.hook) { const h = P.hook; P.hook = null; h(); }
  if (P.failIf?.()) throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' });
  store.saveOrThrow();
};
const fg = createFlowGit({ db, worktrees: wtm, persist });

let seq = 0;
const hex8 = () => (0x10000000 + Math.floor(Math.random() * 0xefffffff)).toString(16).slice(0, 8);
function makeRepo(name, files = { 'a.txt': 'a\n' }) {
  const repo = path.join(tmp, `${name}-${++seq}`); fs.mkdirSync(repo);
  G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); }
  G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}
const headOf = (repo) => G(repo, ['rev-parse', 'HEAD']);
const statusOf = (repo) => G(repo, ['status', '--porcelain', '-uall']);
const branchOf = (repo) => G(repo, ['symbolic-ref', '--short', 'HEAD']);
const refOf = (repo, b) => { try { return G(repo, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]); } catch { return null; } };
/** Commit sobre `parent` só com plumbing (nenhuma pasta tocada): simula alguém movendo a branch por fora. `mode` 120000 = link simbólico (o conteúdo é o alvo). */
function commitOn(repo, parent, file, content, msg, mode = '100644') {
  const idx = path.join(tmp, `idx-${Math.random().toString(16).slice(2)}`), env = { GIT_INDEX_FILE: idx };
  try {
    G(repo, ['read-tree', parent], env);
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: content, encoding: 'utf8', windowsHide: true }).trim();
    G(repo, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file}`], env);
    return G(repo, ['commit-tree', G(repo, ['write-tree'], env), '-p', parent, '-m', msg]);
  } finally { fs.rmSync(idx, { force: true }); }
}

/** Repositório + workspace + flow + run com a branch da missão criada. */
async function mission(name, { steps = ['s1', 's2'], files } = {}) {
  const repo = makeRepo(name, files);
  const ws = { id: `ws_${hex8()}`, name, path: repo, verifications: [] }; db.workspaces.push(ws);
  const flow = { id: `flow_${hex8()}`, workspaceId: ws.id }; db.flows.push(flow);
  const run = { id: `run_${hex8()}`, flowId: flow.id, status: 'running', git: null, steps: steps.map((s) => ({ stepId: s, title: `Etapa ${s}`, status: 'running' })) };
  db.flowRuns.push(run);
  const p = await fg.probe(ws); assert.equal(p.mode, 'git', p.reason);
  const c = await fg.createMissionBranch(run, p); assert.equal(c.ok, true, c.error);
  const user = { head: headOf(repo), status: statusOf(repo) };
  const intact = (msg = 'a pasta do usuário não mudou') => { assert.equal(headOf(repo), user.head, msg); assert.equal(branchOf(repo), 'main', msg); assert.equal(statusOf(repo), user.status, msg); };
  const step = (id) => run.steps.find((s) => s.stepId === id);
  const wtPath = (id) => db.worktrees.find((w) => w.id === step(id).worktreeId).path;
  const write = (id, file, content) => { const f = path.join(wtPath(id), file); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  const open = async (id) => { const r = await fg.stepWorktree(run, step(id)); assert.equal(r.ok, true, r.error); return r; };
  return { repo, ws, flow, run, p, user, intact, step, wtPath, write, open, tipRef: () => refOf(repo, run.git.branch) };
}

test('isGuardedPath e missionBranchFor', () => {
  for (const f of ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'pkg/.mcp.json', '.claude/agents/x.md', '.claude/skills/a/SKILL.md', '.claude/hooks/x.js', '.env', '.env.local', 'sub/.ENV', 'certs/server.pem', 'a.key', 'id_rsa', 'id_rsa.pub', '.ssh/id_ed25519', 'x.pfx', '.netrc', '.git-credentials'])
    assert.equal(isGuardedPath(f), true, f);
  // I2: famílias novas, em qualquer profundidade e sem caixa (no Windows `claude.md` é o CLAUDE.md)
  for (const f of ['.codex/config.toml', 'pkg/.codex/hooks.json', '.vscode/tasks.json', 'a/.vscode/settings.json', '.cursor/rules/x.mdc', '.gemini/settings.json', '.devcontainer/devcontainer.json', '.husky/pre-commit', '.githooks/post-checkout',
    '.github/workflows/ci.yml', 'sub/.github/workflows/x.yaml', '.gitattributes', 'lib/.gitattributes', '.gitmodules', 'lefthook.yml', 'lefthook.yaml', 'pkg/lefthook.yml', '.pre-commit-config.yaml', '.npmrc', 'web/.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs',
    'CLAUDE.md', 'claude.md', 'docs/CLAUDE.md', 'AGENTS.md', 'pkg/agents.md',
    'CLAUDE~1/settings.json', 'src/PROGRA~2/x.js', 'AGENTS~1.MD'])
    assert.equal(isGuardedPath(f), true, f);
  // N4: dev container de arquivo único, lefthook local/oculto, actions/hooks do GitHub e configuração de outros agentes/IDEs, em qualquer profundidade e sem caixa
  for (const f of ['.devcontainer.json', 'pkg/.DEVCONTAINER.JSON', 'lefthook-local.yml', 'a/b/Lefthook-Local.yml', '.lefthook.yml', 'sub/.lefthook.yml',
    '.github/actions/setup/action.yml', 'pkg/.github/actions/x/action.yaml', '.GitHub/Actions/a.yml', '.github/hooks/hooks.json', 'sub/.github/hooks/pre.json',
    'GEMINI.md', 'gemini.md', 'docs/Gemini.MD', '.cursorrules', 'web/.CursorRules', '.clinerules', 'a/.clinerules', '.windsurf/rules/x.md', 'pkg/.Windsurf/workflows/y.md',
    '.windsurfrules', 'x/.windsurfrules', '.aider.conf.yml', 'sub/.AIDER.CONF.YML', '.idea/workspace.xml', 'mod/.idea/runConfigurations/r.xml'])
    assert.equal(isGuardedPath(f), true, f);
  for (const f of ['a.txt', 'src/env.js', 'README.md', 'keys.txt', 'monkey.js', 'docs/settings.json', '', 'package.json', '.github/ISSUE_TEMPLATE/bug.md', 'codex/notes.md', 'my.claude.md', 'vscode.txt', 'lefthook.yml.bak', 'a~b.txt',
    'devcontainer.json', 'my.gemini.md', 'cursorrules.txt', 'idea/x.xml', 'src/actions/a.yml', 'github/hooks/x.json', 'windsurf/notes.md', 'aider.conf.yml', '.github/actions.md', '.idea.txt'])
    assert.equal(isGuardedPath(f), false, f);
  assert.equal(ackCovers(['.env', '.mcp.json'], ['.mcp.json', '.env', 'outro']), true);
  assert.equal(ackCovers(['.env', '.mcp.json'], ['.env']), false); assert.equal(ackCovers(['.env'], null), false); assert.equal(ackCovers(['.env'], ['.ENV']), false, 'a lista é a que o usuário viu, exata');
  assert.equal(missionBranchFor('run_0a1b2c3d'), 'orch/run_0a1b2c3d');
  for (const id of ['run_0A1B2C3D', 'run_123', 'x_0a1b2c3d', '../run_0a1b2c3d', null]) assert.equal(missionBranchFor(id), null, String(id));
});

test('probe: git, pasta (sem repositório, sem commit, HEAD destacado, subpasta, worktree vinculado) e desconhecido (Git sem resposta / pasta inexistente)', async () => {
  const repo = makeRepo('probe');
  const p = await fg.probe({ path: repo });
  assert.deepEqual(p, { mode: 'git', repoPath: repo, baseBranch: 'main', baseCommit: headOf(repo) });
  const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain);
  assert.equal((await fg.probe({ path: plain })).mode, 'folder');
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty); G(empty, ['init', '-q', '-b', 'main']);
  const e = await fg.probe({ path: empty }); assert.equal(e.mode, 'folder'); assert.match(e.reason, /nenhum commit/);
  fs.mkdirSync(path.join(repo, 'sub')); fs.writeFileSync(path.join(repo, 'sub', 'k.txt'), 'k'); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'sub']);
  const s = await fg.probe({ path: path.join(repo, 'sub') }); assert.equal(s.mode, 'folder'); assert.match(s.reason, /raiz/);
  const linked = path.join(tmp, 'linked'); G(repo, ['worktree', 'add', '-q', '-b', 'outra', linked]);
  const l = await fg.probe({ path: linked }); assert.equal(l.mode, 'folder'); assert.match(l.reason, /worktree vinculado/);
  G(repo, ['checkout', '-q', '--detach']);
  const d = await fg.probe({ path: repo }); assert.equal(d.mode, 'folder'); assert.match(d.reason, /HEAD destacado/);
  G(repo, ['checkout', '-q', 'main']);
  const dead = createFlowGit({ db, worktrees: wtm, persist, runGit: async () => ({ code: -1, out: '', err: 'git ausente', failed: true, timedOut: false }) });
  const u = await dead.probe({ path: repo }); assert.equal(u.mode, 'unknown'); assert.match(u.reason, /git ausente/);
  const slow = createFlowGit({ db, worktrees: wtm, persist, runGit: async () => ({ code: -1, out: '', err: '', failed: true, timedOut: true }) });
  assert.equal((await slow.probe({ path: repo })).mode, 'unknown');
  assert.equal((await fg.probe({ path: path.join(tmp, 'nao-existe') })).mode, 'unknown');
});

test('createMissionBranch: branch derivada do run.id SEM checkout; diário antes; falha de gravação = nada criado; repetir/ids inválidos recusados', async () => {
  const m = await mission('branch');
  const g = m.run.git;
  assert.equal(g.branch, `orch/${m.run.id}`); assert.equal(g.mode, 'git'); assert.equal(g.state, 'ready'); assert.equal(g.tip, m.p.baseCommit); assert.equal(g.baseCommit, m.p.baseCommit);
  assert.equal(g.baseBranch, 'main'); assert.equal(g.repoPath, m.repo); assert.deepEqual([g.op, g.integration, g.pending, g.leftovers], [null, null, null, []]);
  assert.equal(m.tipRef(), m.p.baseCommit); assert.equal(branchOf(m.repo), 'main', 'a branch da missão nunca entra em checkout'); m.intact();
  assert.equal((await fg.createMissionBranch(m.run, m.p)).code, 'already_created');
  // falha ao gravar o diário: a branch NÃO é criada e run.git volta ao que era
  const repo = makeRepo('branch-fail'); const run = { id: `run_${hex8()}`, steps: [], git: null };
  const p = await fg.probe({ path: repo });
  P.failIf = () => run.git?.state === 'creating';
  try { const r = await fg.createMissionBranch(run, p); assert.equal(r.ok, false); assert.equal(r.code, 'persistence_failed'); } finally { P.failIf = null; }
  assert.equal(run.git, null); assert.equal(refOf(repo, `orch/${run.id}`), null, 'nenhuma branch criada');
  assert.equal((await fg.createMissionBranch({ id: 'run_XYZ', git: null }, p)).code, 'invalid_run');
  assert.equal((await fg.createMissionBranch({ id: `run_${hex8()}`, git: null }, { ...p, baseCommit: 'HEAD' })).code, 'invalid_base');
  assert.equal((await fg.createMissionBranch({ id: `run_${hex8()}`, git: null }, { ...p, baseBranch: '-x' })).code, 'invalid_base');
  // base pendente gravada em run.git (sem passar o probe)
  const run2 = { id: `run_${hex8()}`, steps: [], git: { mode: 'pending', ...p } };
  const c2 = await fg.createMissionBranch(run2); assert.equal(c2.ok, true, c2.error); assert.equal(refOf(repo, run2.git.branch), p.baseCommit);
});

test('duas etapas em paralelo com arquivos diferentes: uma integra por fast-forward, a outra por merge (commit-tree); a ponta tem as duas; a pasta do usuário não muda', async () => {
  const m = await mission('paralelo');
  fs.writeFileSync(path.join(m.repo, 'do-usuario.txt'), 'rascunho'); m.user.status = statusOf(m.repo); // alteração NÃO commitada do usuário em outro arquivo
  await m.open('s1'); await m.open('s2');
  assert.match(m.step('s1').branch, /^orch\/wt_[0-9a-f]{8}$/); assert.notEqual(m.step('s1').worktreeId, m.step('s2').worktreeId);
  assert.ok(!fs.existsSync(path.join(m.wtPath('s1'), 'do-usuario.txt')), 'a alteração do usuário não entra na missão');
  m.write('s1', 'um.txt', '1\n'); m.write('s2', 'dois.txt', '2\n');
  const base = m.run.git.tip;
  const r1 = await fg.integrateStep(m.run, m.step('s1')); assert.equal(r1.ok, true, r1.error); assert.equal(r1.state, 'integrated'); assert.equal(r1.fastForward, true);
  assert.equal(m.run.git.tip, m.step('s1').commit, 'fast-forward: a ponta é o commit da etapa'); assert.equal(m.tipRef(), m.run.git.tip);
  assert.deepEqual([m.step('s1').integration.from, m.step('s1').integration.to], [base, m.run.git.tip]);
  const r2 = await fg.integrateStep(m.run, m.step('s2')); assert.equal(r2.ok, true, r2.error); assert.equal(r2.state, 'integrated'); assert.equal(r2.fastForward, false);
  const tip = m.run.git.tip; assert.equal(m.tipRef(), tip);
  assert.deepEqual(G(m.repo, ['rev-list', '--parents', '-n', '1', tip]).split(' ').slice(1), [m.step('s1').commit, m.step('s2').commit], 'merge com dois pais');
  assert.match(G(m.repo, ['log', '-1', '--format=%s%n%an', tip]), new RegExp(`^Integra etapa s2 na missão orch/${m.run.id}\nFORGE$`));
  assert.deepEqual(G(m.repo, ['ls-tree', '--name-only', tip]).split('\n').sort(), ['a.txt', 'dois.txt', 'um.txt']);
  // repetir não muda nada
  const again = await fg.integrateStep(m.run, m.step('s2')); assert.deepEqual([again.ok, again.state], [true, 'integrated']); assert.equal(m.run.git.tip, tip);
  // etapa sem nada novo: empty
  m.run.steps.push({ stepId: 's3', title: 'vazia', status: 'running' }); await m.open('s3');
  const r3 = await fg.integrateStep(m.run, m.step('s3')); assert.deepEqual([r3.ok, r3.state], [true, 'empty']); assert.equal(m.run.git.tip, tip);
  m.intact('HEAD e status do usuário intactos durante o run');
  // refreshForContinue: o worktree de s1 avança (ff) até a ponta e passa a servir s4
  m.run.steps.push({ stepId: 's4', title: 'continua', status: 'running' });
  const rf = await fg.refreshForContinue(m.run, m.step('s1').worktreeId, m.step('s4')); assert.equal(rf.ok, true, rf.error); assert.equal(rf.head, tip);
  assert.equal(m.step('s4').worktreeId, m.step('s1').worktreeId); assert.deepEqual(db.worktrees.find((w) => w.id === m.step('s1').worktreeId).flow.stepIds, ['s1', 's4']);
  assert.ok(fs.existsSync(path.join(m.wtPath('s1'), 'dois.txt')));
  // a integração final exige a pasta limpa: com o rascunho do usuário é recusada sem efeito
  const fin = await fg.integrateFinal(m.run, { by: 'auto' }); assert.equal(fin.ok, false); assert.equal(fin.code, 'target_dirty');
  assert.equal(m.run.git.op, null); assert.equal(m.run.git.integration, null); assert.ok(m.run.git.pending.reasons.some((x) => x.code === 'target_dirty')); m.intact();
  fs.rmSync(path.join(m.repo, 'do-usuario.txt'));
  const ok = await fg.integrateFinal(m.run, { by: 'auto' }); assert.equal(ok.ok, true, ok.error); assert.equal(ok.mode, 'ff');
  assert.equal(headOf(m.repo), tip, 'só aqui a pasta do usuário muda'); assert.equal(statusOf(m.repo), ''); assert.equal(branchOf(m.repo), 'main');
  const it = m.run.git.integration;
  assert.deepEqual([it.by, it.mode, it.from, it.to, it.missionTip, it.policy], ['auto', 'ff', m.user.head, tip, tip, 'autoIntegrate']); assert.match(it.digest, /^[0-9a-f]{32,}$/);
  assert.equal(m.run.git.op, null); assert.equal(m.run.git.pending, null);
  assert.ok(db.activity.some((x) => x.type === 'flow' && x.message.includes(`orch/${m.run.id} integrada em main`)), 'registro auditável na atividade');
  const rep = await fg.integrateFinal(m.run, { by: 'user' }); assert.equal(rep.ok, true); assert.equal(rep.repeated, true);
  // limpeza: worktrees saem (trabalho integrado) e a branch da missão também (contida na main)
  const cl = await fg.cleanupRun(m.run); assert.equal(cl.ok, true, cl.error);
  assert.deepEqual(cl.leftovers, []); assert.equal(cl.branchDeleted, true); assert.equal(m.tipRef(), null); assert.ok(m.run.git.cleanedAt);
  for (const s of ['s1', 's2', 's3']) { const w = db.worktrees.find((x) => x.id === m.step(s).worktreeId); assert.equal(w.state, 'removed', s); assert.ok(!fs.existsSync(w.path)); }
});

test('conflito (mesmo arquivo): conflict com a lista, a branch da missão não se move', async () => {
  const m = await mission('conflito');
  await m.open('s1'); await m.open('s2');
  m.write('s1', 'a.txt', 'versao 1\n'); m.write('s2', 'a.txt', 'versao 2\n');
  assert.equal((await fg.integrateStep(m.run, m.step('s1'))).state, 'integrated');
  const tip = m.run.git.tip;
  const r = await fg.integrateStep(m.run, m.step('s2'));
  assert.equal(r.ok, false); assert.equal(r.state, 'conflict'); assert.equal(r.code, 'conflict'); assert.deepEqual(r.integration.conflicts, ['a.txt']);
  assert.equal(m.tipRef(), tip); assert.equal(m.run.git.tip, tip); assert.ok(m.step('s2').commit, 'o trabalho da etapa foi commitado no worktree dela');
  m.intact();
});

test('CAS: a ponta mudou por fora (antes da checagem ou entre o diário e o update-ref) => erro sem efeito', async () => {
  const m = await mission('cas');
  await m.open('s1'); m.write('s1', 'x.txt', 'x\n');
  const tip = m.run.git.tip;
  // entre o diário e o update-ref: o gancho do persist move a ref
  const outsider = commitOn(m.repo, tip, 'fora.txt', 'fora\n', 'alguém mexeu');
  // o primeiro persist é do commitStep; o gancho se rearma até o diário estar gravado
  const hookOnJournal = () => { const s = m.step('s1'); if (s.integration?.state === 'integrating') G(m.repo, ['update-ref', `refs/heads/${m.run.git.branch}`, outsider, tip]); else P.hook = hookOnJournal; };
  P.hook = hookOnJournal;
  const r = await fg.integrateStep(m.run, m.step('s1')); P.hook = null;
  assert.equal(r.ok, false); assert.equal(r.state, 'error'); assert.equal(r.code, 'mission_branch_changed');
  assert.equal(m.tipRef(), outsider, 'o CAS falhou: a ref ficou com o valor de fora'); assert.equal(m.run.git.tip, tip, 'a ponta registrada não mudou');
  // a ref já diferente da ponta registrada antes da checagem: erro sem diário
  const calls = P.calls;
  const s = await fg.integrateStep(m.run, m.step('s1')); assert.equal(s.state, 'error'); assert.equal(s.code, 'mission_branch_changed'); assert.match(s.integration.error, /mudou fora do FORGE/);
  assert.equal(m.tipRef(), outsider); assert.ok(P.calls - calls <= 2);
  m.intact();
});

test('branch da missão em checkout em algum worktree => blocked sem mexer na ref; liberada, integra', async () => {
  const m = await mission('checkout');
  await m.open('s1'); m.write('s1', 'y.txt', 'y\n');
  const other = path.join(tmp, `co-${hex8()}`); G(m.repo, ['worktree', 'add', '-q', other, m.run.git.branch]);
  const tip = m.run.git.tip;
  try {
    const r = await fg.integrateStep(m.run, m.step('s1'));
    assert.equal(r.ok, false); assert.equal(r.state, 'blocked'); assert.equal(r.code, 'branch_checked_out'); assert.match(r.integration.error, /checkout/);
    assert.equal(m.tipRef(), tip);
  } finally { G(m.repo, ['worktree', 'remove', other]); }
  const ok = await fg.integrateStep(m.run, m.step('s1')); assert.equal(ok.state, 'integrated', ok.error);
  m.intact();
});

test('guarda: .claude/settings.json, .mcp.json e .env => blocked com a lista; passa com acknowledgeProjectConfig; a final automática exige confirmação do usuário', async () => {
  const m = await mission('guarda', { steps: ['s1'] });
  await m.open('s1');
  m.write('s1', '.claude/settings.json', '{"hooks":{}}\n'); m.write('s1', '.mcp.json', '{}\n'); m.write('s1', '.env', 'X=1\n'); m.write('s1', 'ok.txt', 'ok\n');
  const tip = m.run.git.tip;
  const r = await fg.integrateStep(m.run, m.step('s1'));
  assert.equal(r.state, 'blocked'); assert.equal(r.code, 'project_config_changed'); assert.deepEqual([...r.integration.files].sort(), ['.claude/settings.json', '.env', '.mcp.json']);
  assert.equal(r.integration.reason, 'project_config_changed', 'C3: o motivo sai na integração da etapa');
  assert.equal(m.tipRef(), tip);
  // C1: ack sem lista (ou com lista que não cobre tudo) continua bloqueado
  const noList = await fg.integrateStep(m.run, m.step('s1'), { acknowledgeProjectConfig: true });
  assert.equal(noList.state, 'blocked'); assert.equal(m.tipRef(), tip);
  const partial = await fg.integrateStep(m.run, m.step('s1'), { acknowledgeProjectConfig: true, acknowledgedFiles: ['.env', '.mcp.json'] });
  assert.equal(partial.state, 'blocked'); assert.match(partial.integration.error, /lista mudou/); assert.equal(m.tipRef(), tip);
  // a lista vista; depois dela o agente grava outro arquivo guardado: a confirmação não vale e a lista nova volta
  const seen = [...partial.integration.files];
  m.write('s1', '.vscode/tasks.json', '{}\n');
  const stale = await fg.integrateStep(m.run, m.step('s1'), { acknowledgeProjectConfig: true, acknowledgedFiles: seen });
  assert.equal(stale.state, 'blocked'); assert.equal(stale.code, 'project_config_changed'); assert.ok(stale.integration.files.includes('.vscode/tasks.json')); assert.equal(m.tipRef(), tip);
  const ok = await fg.integrateStep(m.run, m.step('s1'), { acknowledgeProjectConfig: true, acknowledgedFiles: [...stale.integration.files, 'extra-que-nao-existe'] });
  assert.equal(ok.state, 'integrated', ok.integration?.error); assert.equal(ok.integration.acknowledged, true); assert.equal(m.tipRef(), m.run.git.tip);
  assert.ok(db.activity.some((x) => x.type === 'flow' && /etapa s1 integrada com a confirmação do usuário para 4 arquivo/.test(x.message)), 'a confirmação vai para o log');
  const files = ['.claude/settings.json', '.env', '.mcp.json', '.vscode/tasks.json'];
  // final: automática nunca aceita a confirmação; o usuário pode confirmar, mas só com a lista inteira
  const auto = await fg.integrateFinal(m.run, { by: 'auto', acknowledgeProjectConfig: true, acknowledgedFiles: files });
  assert.equal(auto.ok, false); assert.equal(auto.code, 'project_config_changed'); assert.deepEqual([...auto.files].sort(), files); m.intact();
  const a = await fg.assessFinal(m.run); assert.equal(a.result, 'invalid'); assert.ok(a.reasons.some((x) => x.code === 'project_config_changed'));
  const short = await fg.integrateFinal(m.run, { by: 'user', acknowledgeProjectConfig: true, acknowledgedFiles: files.slice(1) });
  assert.equal(short.ok, false); assert.equal(short.code, 'project_config_changed'); assert.match(short.error, /não cobre a lista atual/); m.intact();
  assert.equal((await fg.integrateFinal(m.run, { by: 'user', acknowledgeProjectConfig: true })).code, 'project_config_changed', 'sem lista não vale'); m.intact();
  const user = await fg.integrateFinal(m.run, { by: 'user', acknowledgeProjectConfig: true, acknowledgedFiles: files });
  assert.equal(user.ok, true, user.error); assert.equal(user.mode, 'ff'); assert.equal(m.run.git.integration.by, 'user'); assert.equal(m.run.git.integration.policy, 'user');
  assert.deepEqual([...m.run.git.integration.acknowledgedFiles].sort(), files);
  assert.equal(headOf(m.repo), m.run.git.tip);
});

test('I2: link simbólico (modo 120000) entra na lista guardada mesmo com nome comum; arquivos comuns não', async () => {
  const m = await mission('symlink', { steps: ['s1'] });
  const tip = m.run.git.tip;
  const withLink = commitOn(m.repo, tip, 'docs/leia.txt', '../.git/config', 'link', '120000');
  const plain = commitOn(m.repo, withLink, 'b.txt', 'b\n', 'comum');
  G(m.repo, ['update-ref', `refs/heads/${m.run.git.branch}`, plain, tip]); m.run.git.tip = plain;
  const a = await fg.assessFinal(m.run);
  assert.deepEqual(a.files, ['docs/leia.txt'], 'o link simbólico é guardado; o arquivo comum não');
  assert.ok(a.reasons.some((x) => x.code === 'project_config_changed' && /links simbólicos/.test(x.message)));
  m.intact();
});

test('I1: configAudit lista o que a cópia tem de próprio (commitado, sujo, não rastreado, link) e só libera a cópia limpa; Git sem resposta não libera', async () => {
  const m = await mission('audit', { steps: ['s1', 's2'] });
  await m.open('s1'); await m.open('s2');
  const id1 = m.step('s1').worktreeId;
  assert.deepEqual(await fg.configAudit(m.run, id1), { ok: true, files: [] }, 'cópia recém-criada da ponta: nada');
  m.write('s1', 'src/a.js', 'ok\n');
  assert.deepEqual(await fg.configAudit(m.run, id1), { ok: true, files: [] }, 'arquivo comum não bloqueia');
  // o agente COMMITA a configuração na cópia (o terminals.js a veria como "versionada no HEAD")
  m.write('s1', '.claude/settings.json', '{"hooks":{"Stop":[]}}\n');
  const wt1 = m.wtPath('s1'); G(wt1, ['add', '-A']); G(wt1, ['commit', '-q', '-m', 'agente']);
  const c = await fg.configAudit(m.run, id1);
  assert.equal(c.ok, false); assert.equal(c.code, 'project_config_unreviewed'); assert.deepEqual(c.files, ['.claude/settings.json']); assert.match(c.error, /\.claude\/settings\.json.*revis/);
  // sujo + não rastreado em outra cópia
  m.write('s2', 'AGENTS.md', 'faça X\n'); m.write('s2', '.husky/pre-commit', 'rm -rf /\n'); fs.writeFileSync(path.join(m.wtPath('s2'), 'a.txt'), 'mudou\n');
  const d = await fg.configAudit(m.run, m.step('s2').worktreeId);
  assert.equal(d.code, 'project_config_unreviewed'); assert.deepEqual([...d.files].sort(), ['.husky/pre-commit', 'AGENTS.md']);
  // link simbólico não rastreado (quando o sistema permite criar um)
  let linked = false; try { fs.symlinkSync(path.join(m.wtPath('s2'), 'a.txt'), path.join(m.wtPath('s2'), 'atalho.txt')); linked = true; } catch { /* sem permissão para links no Windows */ }
  if (linked) assert.ok((await fg.configAudit(m.run, m.step('s2').worktreeId)).files.includes('atalho.txt'), 'link simbólico não rastreado é guardado');
  // link commitado (plumbing): o modo 120000 aparece no diff da cópia
  const wt2b = await mission('audit-link', { steps: ['s1'] }); await wt2b.open('s1');
  const p = wt2b.wtPath('s1'), head = G(p, ['rev-parse', 'HEAD']);
  const lk = commitOn(wt2b.repo, head, 'notas.txt', 'a.txt', 'link', '120000');
  G(p, ['update-ref', `refs/heads/${wt2b.step('s1').branch}`, lk, head]); G(p, ['read-tree', 'HEAD']);
  assert.ok((await fg.configAudit(wt2b.run, wt2b.step('s1').worktreeId)).files.includes('notas.txt'));
  // cópia de outra missão, registro inexistente, Git sem resposta
  assert.equal((await fg.configAudit(m.run, wt2b.step('s1').worktreeId)).code, 'worktree_missing');
  assert.equal((await fg.configAudit(m.run, 'wt_00000000')).code, 'worktree_missing');
  const dead = createFlowGit({ db, worktrees: wtm, persist, runGit: async () => ({ code: -1, out: '', err: 'git ausente', failed: true, timedOut: false }) });
  const u = await dead.configAudit(m.run, id1); assert.equal(u.ok, false); assert.equal(u.code, 'git_unknown'); assert.match(u.error, /não foi aberto/);
  m.intact();
});

test('final: branch trocada, conflito com a branch do usuário e merge (commit-tree com 2 pais) quando não é fast-forward', async () => {
  const m = await mission('final-merge', { steps: ['s1'] });
  await m.open('s1'); m.write('s1', 'missao.txt', 'm\n');
  assert.equal((await fg.integrateStep(m.run, m.step('s1'))).state, 'integrated');
  const tip = m.run.git.tip;
  // branch trocada
  G(m.repo, ['checkout', '-q', '-b', 'outra']);
  const br = await fg.integrateFinal(m.run, { by: 'auto' }); assert.equal(br.code, 'target_branch_changed'); assert.equal(branchOf(m.repo), 'outra'); assert.equal(m.run.git.op, null);
  G(m.repo, ['checkout', '-q', 'main']);
  // o usuário commitou algo depois do início: merge
  fs.writeFileSync(path.join(m.repo, 'usuario.txt'), 'u\n'); G(m.repo, ['add', '-A']); G(m.repo, ['commit', '-q', '-m', 'trabalho do usuário']);
  const userHead = headOf(m.repo);
  const a = await fg.assessFinal(m.run);
  assert.equal(a.result, 'mergeable'); assert.equal(a.ffPossible, false); assert.equal(a.targetHead, userHead); assert.match(a.digest, /^[0-9a-f]{32,}$/); assert.ok(a.mergeTree);
  assert.equal(headOf(m.repo), userHead, 'avaliar não muda nada');
  const ok = await fg.integrateFinal(m.run, { by: 'user' }); assert.equal(ok.ok, true, ok.error); assert.equal(ok.mode, 'merge');
  const h = headOf(m.repo); assert.deepEqual(G(m.repo, ['rev-list', '--parents', '-n', '1', h]).split(' ').slice(1), [userHead, tip]);
  assert.equal(G(m.repo, ['log', '-1', '--format=%s']), `Integra missão orch/${m.run.id} em main`); assert.equal(statusOf(m.repo), '');
  assert.deepEqual([m.run.git.integration.from, m.run.git.integration.to, m.run.git.integration.missionTip], [userHead, h, tip]);
  // conflito na final
  const c = await mission('final-conflito', { steps: ['s1'] });
  await c.open('s1'); c.write('s1', 'a.txt', 'da missão\n'); await fg.integrateStep(c.run, c.step('s1'));
  fs.writeFileSync(path.join(c.repo, 'a.txt'), 'do usuário\n'); G(c.repo, ['commit', '-q', '-am', 'usuário']); const ch = headOf(c.repo);
  const cf = await fg.integrateFinal(c.run, { by: 'auto' }); assert.equal(cf.ok, false); assert.equal(cf.code, 'conflict'); assert.deepEqual(cf.conflicts, ['a.txt']);
  assert.equal(headOf(c.repo), ch); assert.equal(statusOf(c.repo), ''); assert.equal(c.run.git.integration, null);
});

test('final: already (ponta já contida) e empty (nada produzido) não mexem na pasta', async () => {
  const m = await mission('already', { steps: ['s1'] });
  await m.open('s1'); m.write('s1', 'z.txt', 'z\n'); await fg.integrateStep(m.run, m.step('s1'));
  G(m.repo, ['merge', '-q', '--ff-only', m.run.git.tip]); const h = headOf(m.repo);
  fs.writeFileSync(path.join(m.repo, 'sujo.txt'), 's'); // sujeira não importa: a pasta não muda
  const a = await fg.assessFinal(m.run); assert.equal(a.already, true); assert.equal(a.result, 'mergeable');
  const r = await fg.integrateFinal(m.run, { by: 'auto' }); assert.equal(r.ok, true, r.error); assert.equal(r.mode, 'already');
  assert.equal(headOf(m.repo), h); assert.equal(statusOf(m.repo), '?? sujo.txt'); assert.deepEqual([m.run.git.integration.from, m.run.git.integration.to], [h, h]);
  const e = await mission('empty', { steps: ['s1'] });
  const ea = await fg.assessFinal(e.run); assert.equal(ea.empty, true);
  const er = await fg.integrateFinal(e.run, { by: 'auto' }); assert.equal(er.ok, true, er.error); assert.equal(er.mode, 'empty'); e.intact();
});

test('falha de persistência ANTES do efeito: integrateStep e integrateFinal não executam nada e a memória volta ao que era', async () => {
  const m = await mission('persist', { steps: ['s1'] });
  await m.open('s1'); m.write('s1', 'p.txt', 'p\n');
  const tip = m.run.git.tip;
  P.failIf = () => m.step('s1').integration?.state === 'integrating';
  try { const r = await fg.integrateStep(m.run, m.step('s1')); assert.equal(r.ok, false); assert.equal(r.code, 'persistence_failed'); } finally { P.failIf = null; }
  assert.equal(m.tipRef(), tip, 'a ref não foi tocada'); assert.equal(m.run.git.tip, tip); assert.equal(m.step('s1').integration, undefined, 'estado de antes');
  assert.equal((await fg.integrateStep(m.run, m.step('s1'))).state, 'integrated');
  P.failIf = () => !!m.run.git.op;
  try { const f = await fg.integrateFinal(m.run, { by: 'auto' }); assert.equal(f.ok, false); assert.equal(f.code, 'persistence_failed'); } finally { P.failIf = null; }
  assert.equal(m.run.git.op, null); assert.equal(m.run.git.integration, null); m.intact('a pasta do usuário não mudou');
});

test('settle depois de "queda": diários de criação, de etapa e da integração final conciliados só pelo Git real', async () => {
  // criação: branch existe => ready; não existe => volta a "pending"
  const repo = makeRepo('settle-create'); const p = await fg.probe({ path: repo });
  const mk = () => { const id = `run_${hex8()}`; return { id, steps: [], git: { mode: 'git', fallbackReason: null, repoPath: p.repoPath, baseBranch: 'main', baseCommit: p.baseCommit, branch: `orch/${id}`, tip: p.baseCommit, state: 'creating', op: null, integration: null, pending: null, leftovers: [] } }; };
  const done = mk(); G(repo, ['branch', done.git.branch, p.baseCommit]);
  const s1 = await fg.settle(done); assert.deepEqual(s1.changed, ['branch_ready']); assert.equal(done.git.state, 'ready');
  const lost = mk(); const s2 = await fg.settle(lost); assert.deepEqual(s2.changed, ['branch_absent']); assert.equal(lost.git.mode, 'pending'); assert.equal(lost.git.branch, null);
  // etapa "integrating": efeito feito / não feito / ref em outro valor
  const m = await mission('settle-step', { steps: ['a', 'b', 'c'] });
  const tip = m.run.git.tip, x = commitOn(m.repo, tip, 'x.txt', 'x\n', 'x'), y = commitOn(m.repo, tip, 'y.txt', 'y\n', 'y');
  m.step('a').integration = { state: 'integrating', from: tip, to: x, conflicts: [], files: [], error: null, at: 't' };
  G(m.repo, ['update-ref', `refs/heads/${m.run.git.branch}`, x, tip]); // o efeito aconteceu antes da queda
  const sa = await fg.settle(m.run); assert.deepEqual(sa.changed, ['step_integrated:a']); assert.equal(m.step('a').integration.state, 'integrated'); assert.equal(m.run.git.tip, x);
  m.step('b').integration = { state: 'integrating', from: x, to: y, conflicts: [], files: [], error: null, at: 't' }; // efeito não aconteceu
  const sb = await fg.settle(m.run); assert.deepEqual(sb.changed, ['step_pending:b']); assert.equal(m.step('b').integration.state, 'pending'); assert.equal(m.run.git.tip, x);
  m.step('c').integration = { state: 'integrating', from: tip, to: y, conflicts: [], files: [], error: null, at: 't' }; // ref em x: nem from nem to
  const sc = await fg.settle(m.run); assert.deepEqual(sc.changed, ['step_error:c']); assert.equal(m.step('c').integration.state, 'error');
  assert.equal(m.tipRef(), x, 'settle não move refs');
  // integração final: HEAD == newCommit => registrada; == oldHead => op limpo; outro => inconsistent
  const oldHead = headOf(m.repo);
  m.run.git.op = { kind: 'final_integrate', at: 't', oldHead, newCommit: x, by: 'auto', mode: 'ff', digest: 'd'.repeat(32), missionTip: x, policy: 'autoIntegrate' };
  const sn = await fg.settle(m.run); assert.deepEqual(sn.changed, ['final_unchanged']); assert.equal(m.run.git.op, null); assert.equal(m.run.git.integration, null);
  m.run.git.op = { kind: 'final_integrate', at: 't', oldHead, newCommit: x, by: 'auto', mode: 'ff', digest: 'd'.repeat(32), missionTip: x, policy: 'autoIntegrate' };
  G(m.repo, ['merge', '-q', '--ff-only', x]); // o merge aconteceu antes da queda
  const sf = await fg.settle(m.run); assert.deepEqual(sf.changed, ['final_integrated']); assert.equal(m.run.git.op, null);
  assert.deepEqual([m.run.git.integration.by, m.run.git.integration.mode, m.run.git.integration.to, m.run.git.integration.digest], ['auto', 'ff', x, 'd'.repeat(32)]);
  m.run.git.integration = null;
  m.run.git.op = { kind: 'final_integrate', at: 't', oldHead, newCommit: y, by: 'user', mode: 'merge', digest: 'e'.repeat(32), missionTip: y, policy: 'user' };
  const si = await fg.settle(m.run); assert.deepEqual(si.changed, ['final_inconsistent']); assert.equal(m.run.git.state, 'inconsistent'); assert.equal(m.run.git.op, null);
  assert.equal(headOf(m.repo), x, 'nada foi desfeito');
  // Git sem resposta: nada muda
  const dead = createFlowGit({ db, worktrees: wtm, persist, runGit: async () => ({ code: -1, out: '', err: 'git ausente', failed: true, timedOut: false }) });
  m.step('b').integration = { state: 'integrating', from: x, to: y, conflicts: [], files: [], error: null, at: 't' };
  const su = await dead.settle(m.run); assert.match(su.unverified, /git ausente/); assert.equal(m.step('b').integration.state, 'integrating');
});

test('discard e cleanupRun seguros: trabalho não integrado vira leftover; a branch só sai com deleteBranch', async () => {
  const m = await mission('discard');
  await m.open('s1'); await m.open('s2');
  m.write('s1', 'i.txt', 'i\n'); assert.equal((await fg.integrateStep(m.run, m.step('s1'))).state, 'integrated');
  m.write('s2', 'n.txt', 'n\n'); assert.equal((await fg.commitStep(m.run, m.step('s2'))).committed, true); // commitado, NÃO integrado
  // cleanupRun sem integração final: a branch da missão não está na main => fica
  const cl = await fg.cleanupRun(m.run); assert.equal(cl.ok, true);
  assert.equal(cl.branchDeleted, false); assert.ok(m.tipRef(), 'branch da missão mantida');
  assert.deepEqual(cl.leftovers.map((x) => x.worktreeId), [m.step('s2').worktreeId]); assert.match(cl.leftovers[0].reason, /NÃO integrados/);
  assert.ok(fs.existsSync(m.wtPath('s2')), 'o trabalho não integrado não foi removido');
  assert.equal(db.worktrees.find((w) => w.id === m.step('s1').worktreeId).state, 'removed');
  const d1 = await fg.discard(m.run); assert.equal(d1.ok, true); assert.equal(d1.branchDeleted, false); assert.ok(m.tipRef()); assert.ok(m.run.git.discardedAt);
  assert.equal(d1.leftovers.length, 1); assert.ok(fs.existsSync(m.wtPath('s2')));
  const d2 = await fg.discard(m.run, { deleteBranch: true }); assert.equal(d2.ok, true); assert.equal(d2.branchDeleted, true); assert.equal(m.tipRef(), null);
  assert.equal(d2.leftovers.length, 1, 'o worktree com trabalho continua'); assert.ok(fs.existsSync(path.join(m.wtPath('s2'), 'n.txt')));
  m.intact();
});
