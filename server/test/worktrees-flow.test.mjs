// Worktrees das etapas da Missions v2 (fatia F1): Git REAL em repositório temporário. Prova que create({ from, flow }) parte da ponta da branch da missão (sem checkout),
// que commitFlowWork/fastForwardFlow só mexem na branch do worktree, que o gate estrito de integrate() continua recusando (cycle_missing) e que a pasta do usuário não muda.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-wtflow-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const store = await import('../store.js');
const W = await import('../worktrees.js');
const db = store.load(); db.missions = []; db.workspaces = []; db.worktrees = []; store.saveOrThrow();
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const G = (cwd, args, env = {}) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } }).trim();
const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo);
G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
const ws = { id: 'ws1', name: 'ws1', path: repo, verifications: [] }; db.workspaces.push(ws);
const wtm = W.createWorktreeManager({ db, root: path.join(tmp, 'wts') });

const RUN_BRANCH = 'orch/run_0000abcd';
const mainHead = () => G(repo, ['rev-parse', 'HEAD']), mainStatus = () => G(repo, ['status', '--porcelain', '-uall']), mainBranch = () => G(repo, ['symbolic-ref', '--short', 'HEAD']);
const refOf = (b) => G(repo, ['rev-parse', `refs/heads/${b}`]);
/** Commit novo sobre `parent` com um arquivo a mais, montado só com plumbing (índice temporário): nenhuma pasta de trabalho é tocada. */
function commitOn(parent, file, content, msg) {
  const idx = path.join(tmp, `idx-${Math.random().toString(16).slice(2)}`), env = { GIT_INDEX_FILE: idx };
  try {
    G(repo, ['read-tree', parent], env);
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: content, encoding: 'utf8', windowsHide: true }).trim();
    G(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], env);
    const tree = G(repo, ['write-tree'], env);
    return G(repo, ['commit-tree', tree, '-p', parent, '-m', msg]);
  } finally { fs.rmSync(idx, { force: true }); }
}
const head0 = mainHead();
const runTip0 = commitOn(head0, 'missao.txt', 'missao\n', 'trabalho da missão');
G(repo, ['branch', RUN_BRANCH, runTip0]); // branch da missão criada SEM checkout
const mission = { id: 'run_0000abcd' };
const fromTip = (commit = refOf(RUN_BRANCH)) => ({ branch: RUN_BRANCH, commit });
const assertUserFolderIntact = () => { assert.equal(mainHead(), head0, 'o HEAD do repositório principal não mudou'); assert.equal(mainBranch(), 'main', 'a branch do repositório principal não mudou'); assert.equal(mainStatus(), '', 'o repositório principal continua limpo'); };

test('exports do módulo: lock compartilhado, chave do repositório, resolveRepo, identidade e consultas de estado', async () => {
  assert.equal(typeof W.withRepoLock, 'function'); assert.equal(typeof W.repoKey, 'function');
  if (process.platform === 'win32') assert.equal(W.repoKey(repo.toUpperCase()), W.repoKey(repo), 'no Windows a chave ignora a caixa');
  assert.equal(W.repoKey(repo), W.repoKey(`${repo}${path.sep}`), 'caminho normalizado');
  assert.deepEqual(W.GIT_IDENT, { GIT_AUTHOR_NAME: 'FORGE', GIT_AUTHOR_EMAIL: 'forge@localhost', GIT_COMMITTER_NAME: 'FORGE', GIT_COMMITTER_EMAIL: 'forge@localhost' }); assert.ok(Object.isFrozen(W.GIT_IDENT));
  const rr = await W.resolveRepo(repo); assert.equal(rr.branch, 'main'); assert.equal(rr.commit, head0); assert.equal(rr.key, W.repoKey(repo));
  assert.deepEqual(await W.dirtyStateOf(repo), { state: 'clean', files: [], reason: null });
  assert.deepEqual(await W.probeHeadOf(repo), { known: true, head: head0, reason: null });
  const failing = async () => ({ code: -1, out: '', err: 'git ausente', failed: true, timedOut: false });
  assert.equal((await W.dirtyStateOf(repo, failing)).state, 'unknown', 'Git sem resposta nunca vale como limpo');
  assert.deepEqual(await W.probeHeadOf(repo, failing), { known: false, head: null, reason: 'git ausente' });
  fs.writeFileSync(path.join(repo, 'sujo.txt'), 'x'); try { const d = await W.dirtyStateOf(repo); assert.equal(d.state, 'dirty'); assert.equal(d.files.length, 1); } finally { fs.rmSync(path.join(repo, 'sujo.txt')); }
  assertUserFolderIntact();
});

test('create sem from: idêntico ao comportamento original (base = HEAD da branch do workspace, sem campo flow)', async () => {
  const c = await wtm.create({ mission: { id: 'm1' }, workspace: ws }); assert.equal(c.ok, true, c.error);
  const r = c.record;
  assert.match(r.id, /^wt_[0-9a-f]{8}$/); assert.equal(r.branch, `orch/${r.id}`); assert.equal(r.state, 'ready'); assert.equal(r.op, null);
  assert.equal(r.baseBranch, 'main'); assert.equal(r.baseCommit, head0); assert.equal(r.headCommit, head0); assert.equal(r.baseDirty, false);
  assert.ok(!('flow' in r), 'sem flow informado o campo não é gravado'); assert.equal(wtm.describe(r).flow, null);
  assert.equal(G(r.path, ['rev-parse', 'HEAD']), head0); assert.ok(!fs.existsSync(path.join(r.path, 'missao.txt')));
  assertUserFolderIntact();
});

test('create com from: parte da ponta da branch da missão (sem checkout), grava base e flow; a pasta do usuário não muda', async () => {
  const c = await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's1' } }); assert.equal(c.ok, true, c.error);
  const r = c.record;
  assert.match(r.branch, /^orch\/wt_[0-9a-f]{8}$/); assert.equal(r.state, 'ready'); assert.equal(r.missionId, 'run_0000abcd');
  assert.equal(r.baseBranch, RUN_BRANCH); assert.equal(r.baseCommit, runTip0); assert.equal(r.headCommit, runTip0); assert.equal(r.baseDirty, false);
  assert.deepEqual(r.flow, { runId: 'run_0000abcd', stepIds: ['s1'] }); assert.deepEqual(wtm.describe(r).flow, { runId: 'run_0000abcd', stepIds: ['s1'] });
  assert.equal(G(r.path, ['rev-parse', 'HEAD']), runTip0); assert.equal(fs.readFileSync(path.join(r.path, 'missao.txt'), 'utf8'), 'missao\n');
  assert.deepEqual(await wtm.inspect(r), [], 'o registro passa na validação');
  assert.equal(refOf(RUN_BRANCH), runTip0, 'a branch da missão não foi movida');
  assertUserFolderIntact();
  // com a pasta do usuário suja o worktree da etapa continua saindo da branch da missão (e não marca baseDirty)
  fs.writeFileSync(path.join(repo, 'local.txt'), 'do usuário');
  try { const d = await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's9' } }); assert.equal(d.ok, true, d.error); assert.equal(d.record.baseDirty, false); assert.ok(!fs.existsSync(path.join(d.record.path, 'local.txt'))); }
  finally { fs.rmSync(path.join(repo, 'local.txt')); }
});

test('create com from: ref divergente => 409 sem criar nada; branch fora do padrão ou dados inválidos => 400', async () => {
  const before = db.worktrees.length, dirs = fs.existsSync(path.join(tmp, 'wts')) ? fs.readdirSync(path.join(tmp, 'wts')).length : 0;
  const moved = await wtm.create({ mission, workspace: ws, from: fromTip(head0), flow: { runId: 'run_0000abcd', stepId: 's2' } });
  assert.equal(moved.ok, false); assert.equal(moved.status, 409); assert.equal(moved.code, 'base_moved'); assert.match(moved.error, /não no commit esperado/);
  const missing = await wtm.create({ mission, workspace: ws, from: { branch: 'orch/run_ffffffff', commit: runTip0 } });
  assert.equal(missing.status, 409); assert.equal(missing.code, 'base_missing');
  for (const from of [{ branch: 'main', commit: head0 }, { branch: 'orch/wt_0000abcd', commit: runTip0 }, { branch: 'orch/run_0000abcd/../x', commit: runTip0 }, { branch: '-orch/run_0000abcd', commit: runTip0 }, { branch: RUN_BRANCH, commit: 'HEAD' }, { branch: RUN_BRANCH, commit: runTip0.slice(0, 12) }]) {
    const r = await wtm.create({ mission, workspace: ws, from }); assert.equal(r.status, 400, JSON.stringify(from)); assert.equal(r.code, 'invalid_base');
  }
  for (const flow of [{ runId: '../x', stepId: 's1' }, { runId: 'run_0000abcd' }, { runId: 'run_0000abcd', stepId: 'a b' }, { runId: 123, stepId: 's1' }, { runId: 'run_0000abcd', stepId: null }]) {
    const r = await wtm.create({ mission, workspace: ws, from: fromTip(), flow }); assert.equal(r.status, 400, JSON.stringify(flow)); assert.equal(r.code, 'invalid_flow');
  }
  assert.equal(db.worktrees.length, before, 'nenhum registro novo'); assert.equal(fs.existsSync(path.join(tmp, 'wts')) ? fs.readdirSync(path.join(tmp, 'wts')).length : 0, dirs, 'nenhuma pasta nova');
  assert.equal(refOf(RUN_BRANCH), runTip0); assertUserFolderIntact();
});

test('commitFlowWork: em uso com alterações commita na branch do worktree (identidade FORGE, mensagem de uma linha); limpo não commita', async () => {
  const r = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's3' } })).record;
  assert.equal(wtm.markInUse(r.id, { round: 1, taskId: 't1' }), true); assert.equal(wtm.get(r.id).state, 'in_use');
  fs.writeFileSync(path.join(r.path, 'etapa.txt'), 'feito\n'); fs.mkdirSync(path.join(r.path, 'sub')); fs.writeFileSync(path.join(r.path, 'sub', 'b.txt'), 'b\n');
  const c = await wtm.commitFlowWork(r.id, { message: `linha 1\r\nlinha 2\u0007 ${'x'.repeat(400)}` }); assert.equal(c.ok, true, c.error);
  assert.equal(c.committed, true); assert.match(c.head, /^[0-9a-f]{40,64}$/); assert.notEqual(c.head, runTip0); assert.equal(wtm.get(r.id).headCommit, c.head);
  assert.equal(G(r.path, ['rev-parse', 'HEAD^']), runTip0, 'o commit parte da ponta da missão');
  assert.equal(G(repo, ['rev-parse', `refs/heads/${r.branch}`]), c.head, 'o commit está na branch do worktree');
  const subject = G(r.path, ['log', '-1', '--format=%s']), [an, ae, cn] = G(r.path, ['log', '-1', '--format=%an%n%ae%n%cn']).split('\n');
  assert.ok(subject.startsWith('linha 1 linha 2 x')); assert.ok(subject.length <= 200, `assunto com ${subject.length}`); assert.ok(!/[\r\n\u0007]/.test(subject));
  assert.deepEqual([an, ae, cn], ['FORGE', 'forge@localhost', 'FORGE']);
  assert.equal(G(r.path, ['status', '--porcelain', '-uall']), '', 'tudo foi commitado');
  assert.ok(wtm.get(r.id).history.some((h) => h.event === 'flow_commit'));
  const again = await wtm.commitFlowWork(r.id, { message: 'nada' }); assert.equal(again.ok, true, again.error); assert.deepEqual([again.committed, again.head], [false, c.head]);
  const def = await (async () => { fs.writeFileSync(path.join(r.path, 'outro.txt'), 'o\n'); return wtm.commitFlowWork(r.id); })(); assert.equal(def.committed, true);
  assert.match(G(r.path, ['log', '-1', '--format=%s']), /Etapa s3 do run run_0000abcd/);
  assert.equal(refOf(RUN_BRANCH), runTip0, 'a branch da missão não foi movida'); assertUserFolderIntact();
});

test('commitFlowWork e fastForwardFlow recusam registro sem flow, com operação em andamento ou em estado não utilizável', async () => {
  const plain = (await wtm.create({ mission: { id: 'm2' }, workspace: ws })).record;
  fs.writeFileSync(path.join(plain.path, 'x.txt'), 'x');
  const a = await wtm.commitFlowWork(plain.id, { message: 'x' }); assert.equal(a.ok, false); assert.equal(a.status, 409); assert.equal(a.code, 'not_flow');
  const b = await wtm.fastForwardFlow(plain.id, runTip0); assert.equal(b.status, 409); assert.equal(b.code, 'not_flow');
  assert.equal(G(plain.path, ['rev-parse', 'HEAD']), head0, 'nada foi commitado'); assert.ok(fs.existsSync(path.join(plain.path, 'x.txt')));
  assert.equal((await wtm.commitFlowWork('wt_ffffffff')).status, 404); assert.equal((await wtm.fastForwardFlow('wt_ffffffff', runTip0)).status, 404);
  const f = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's4' } })).record;
  f.op = { kind: 'cleanup', at: 'x' }; try { assert.equal((await wtm.commitFlowWork(f.id)).code, 'worktree_busy'); assert.equal((await wtm.fastForwardFlow(f.id, runTip0)).code, 'worktree_busy'); } finally { f.op = null; }
  f.state = 'integrated'; try { assert.equal((await wtm.commitFlowWork(f.id)).code, 'worktree_busy'); } finally { f.state = 'ready'; }
  assertUserFolderIntact();
});

test('fastForwardFlow: avança só por fast-forward com o worktree limpo; não-ff, sujo e commit inválido são recusados sem mudar nada', async () => {
  const w1 = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's5' } })).record;
  const w2 = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's6' } })).record;
  fs.writeFileSync(path.join(w1.path, 'w1.txt'), 'w1\n'); const c1 = await wtm.commitFlowWork(w1.id, { message: 'etapa s5' }); assert.equal(c1.committed, true);
  G(repo, ['update-ref', `refs/heads/${RUN_BRANCH}`, c1.head, runTip0]); // a "integração" da etapa s5 move a branch da missão (só plumbing)
  assert.equal((await wtm.fastForwardFlow(w2.id, 'nao-e-sha')).status, 400);
  assert.equal((await wtm.fastForwardFlow(w2.id, 'f'.repeat(40))).code, 'invalid_commit', 'commit inexistente');
  fs.writeFileSync(path.join(w2.path, 'pendente.txt'), 'p');
  const dirty = await wtm.fastForwardFlow(w2.id, c1.head); assert.equal(dirty.status, 409); assert.equal(dirty.code, 'worktree_dirty'); assert.equal(G(w2.path, ['rev-parse', 'HEAD']), runTip0);
  fs.rmSync(path.join(w2.path, 'pendente.txt'));
  const ff = await wtm.fastForwardFlow(w2.id, c1.head); assert.equal(ff.ok, true, ff.error); assert.deepEqual([ff.advanced, ff.head], [true, c1.head]);
  assert.equal(G(w2.path, ['rev-parse', 'HEAD']), c1.head); assert.equal(wtm.get(w2.id).headCommit, c1.head); assert.ok(fs.existsSync(path.join(w2.path, 'w1.txt')));
  assert.equal(G(w2.path, ['symbolic-ref', '--short', 'HEAD']), w2.branch, 'continua na branch do próprio worktree');
  const same = await wtm.fastForwardFlow(w2.id, c1.head); assert.deepEqual([same.ok, same.advanced], [true, false]);
  // w2 ganha trabalho próprio e w1 outro: avançar w2 até w1 não é fast-forward
  fs.writeFileSync(path.join(w2.path, 'w2.txt'), 'w2\n'); const c2 = await wtm.commitFlowWork(w2.id); assert.equal(c2.committed, true);
  fs.writeFileSync(path.join(w1.path, 'w1b.txt'), 'w1b\n'); const c1b = await wtm.commitFlowWork(w1.id); assert.equal(c1b.committed, true);
  const nff = await wtm.fastForwardFlow(w2.id, c1b.head); assert.equal(nff.ok, false); assert.equal(nff.status, 409); assert.equal(nff.code, 'not_fast_forward');
  assert.equal(G(w2.path, ['rev-parse', 'HEAD']), c2.head, 'nada mudou no worktree'); assert.equal(G(w2.path, ['status', '--porcelain', '-uall']), '');
  assert.equal(wtm.get(w2.id).state, 'ready'); assertUserFolderIntact();
});

test('gate estrito intacto: integrate() de um worktree de etapa continua 409 com cycle_missing e a branch do usuário não muda', async () => {
  const r = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's7' } })).record;
  fs.writeFileSync(path.join(r.path, 'g.txt'), 'g\n'); assert.equal((await wtm.commitFlowWork(r.id)).committed, true);
  const chk = await wtm.check(r.id); assert.equal(chk.ok, true); assert.equal(chk.attempt.result, 'invalid'); assert.ok(chk.attempt.problems.some((p) => p.code === 'cycle_missing'), JSON.stringify(chk.attempt.problems));
  const bad = await wtm.integrate(r.id, { digest: 'a'.repeat(32) }); assert.equal(bad.ok, false); assert.equal(bad.status, 409);
  assert.ok(bad.attempt.problems.some((p) => p.code === 'cycle_missing')); assert.match(bad.error, /Integração recusada/);
  assert.equal(wtm.get(r.id).state, 'ready'); assertUserFolderIntact();
});

test('o lock exportado é o MESMO do gerenciador: commitFlowWork espera quem segura withRepoLock(repoKey(repo))', async () => {
  const r = (await wtm.create({ mission, workspace: ws, from: fromTip(), flow: { runId: 'run_0000abcd', stepId: 's8' } })).record;
  fs.writeFileSync(path.join(r.path, 'l.txt'), 'l\n');
  const order = [];
  const held = W.withRepoLock(W.repoKey(repo), async () => { await new Promise((res) => setTimeout(res, 150)); order.push('lock'); });
  const commit = wtm.commitFlowWork(r.id).then((x) => { order.push('commit'); return x; });
  const [, c] = await Promise.all([held, commit]);
  assert.equal(c.committed, true); assert.deepEqual(order, ['lock', 'commit']);
  assertUserFolderIntact();
});
