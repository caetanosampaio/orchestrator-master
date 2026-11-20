// Missions v2: comando de verificação opcional ANTES da integração final (flows.js finishGit). Git REAL em repositórios temporários, gerenciador de worktrees e flow-git REAIS;
// terminais, Maestro e o VERIFICADOR são falsos (nenhum processo de verificação real roda aqui). Banco temporário (ORCH_DATA_DIR antes de importar store.js); nunca a pasta do projeto.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-verify-gate-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const store = await import('../store.js');
const W = await import('../worktrees.js');
const { createFlowGit } = await import('../flow-git.js');
const F = await import('../flows.js');
const gdb = store.load(); gdb.missions = []; store.saveOrThrow();
after(() => { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const G = (cwd, args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const hex = (n) => n.toString(16).padStart(8, '0');
const T0 = Date.parse('2026-11-20T10:00:00.000Z');
let seq = 0;
function makeRepo() {
  const repo = path.join(tmp, `repo-${++seq}`); fs.mkdirSync(repo);
  G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}
const headOf = (repo) => G(repo, ['rev-parse', 'HEAD']);
const statusOf = (repo) => G(repo, ['status', '--porcelain', '-uall']);
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
const PASS = { status: 'pass', command: 'npm test', exitCode: 0, durationMs: 12, outputTail: 'ok 3 testes', truncated: false, at: '2026-11-20T10:00:05.000Z' };
const FAIL = { status: 'fail', command: 'npm test', exitCode: 1, durationMs: 30, outputTail: 'not ok 2 - soma\n# fail 1', truncated: false, at: '2026-11-20T10:00:05.000Z' };

/** Mundo mínimo: repositório, workspace, banco próprio, worktrees e flow-git reais; terminais/Maestro falsos; verificador falso (`w.verify` decide o resultado de cada chamada). */
function world(opts = {}) {
  const n = ++seq;
  const repo = opts.repo ?? makeRepo();
  const db = opts.db ?? { settings: {}, missions: [], workspaces: [{ id: `ws_${hex(n)}`, name: 'proj', path: repo, verifications: [] }], worktrees: [], flows: [], flowRuns: [] };
  const ws = db.workspaces[0];
  const wtm = W.createWorktreeManager({ db, root: path.join(tmp, `wts-${n}`) });
  const terms = new Map(), tasks = new Map(), calls = [], errors = [];
  let tn = 0, kn = 0;
  const w = { repo, db, ws, terms, tasks, calls, errors, clock: T0, failPersist: 0, verify: async () => PASS };
  w.terminals = {
    async create(o, extra) {
      const wtId = extra?.flowWorktreeId ?? null, id = `term_${hex(++tn)}`;
      terms.set(id, { id, status: 'running', agent: { state: 'idle' }, role: o.role, cwd: wtId ? db.worktrees.find((x) => x.id === wtId).path : ws.path, worktreeId: wtId });
      return { ok: true, status: 201, session: { id, recordId: `ses_${hex(tn)}` } };
    },
    peek: (id) => terms.get(id) ?? null,
    close: (id) => { const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
    count: () => [...terms.values()].filter((t) => t.status === 'running').length,
    providers: () => [{ id: 'claude', label: 'Claude Code', available: true }],
  };
  w.maestro = {
    dispatch() { const id = `task_${hex(++kn)}`; tasks.set(id, { status: 'delivered', summary: null }); return { ok: true, taskId: id }; },
    taskState: (id) => tasks.get(id) ?? null,
  };
  // `w.persistHook` (opcional) decide se a gravação falha olhando o estado que seria gravado
  w.persist = () => { if (w.failPersist > 0 || w.persistHook?.() === true) { if (w.failPersist > 0) w.failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  w.flowVerify = { run: (repoPath, sha, o) => { calls.push({ repoPath, sha, args: o.args, timeoutSec: o.timeoutSec, signal: o.signal }); return w.verify(repoPath, sha, o); } };
  w.flowGit = createFlowGit({ db, worktrees: wtm, persist: w.persist });
  w.flows = F.createFlows({ db, terminals: w.terminals, maestro: w.maestro, flowGit: w.flowGit, flowVerify: w.flowVerify, persist: w.persist, now: () => new Date(w.clock).toISOString(), uid: store.uid, pollMs: 0, onError: (e) => errors.push(e) });
  w.tick = async () => { w.clock += 1000; await w.flows.tick(); };
  w.raw = () => db.flowRuns.find((r) => r.id === w.run.id);
  w.rs = (id) => w.raw().steps.find((s) => s.stepId === id);
  /** Cria a missão, inicia o run, o agente da etapa s1 escreve um arquivo na cópia e chama report_done. Não dá o passo seguinte (quem chama decide). */
  w.startDone = async (extra = {}) => {
    const c = w.flows.create({ workspaceId: ws.id, title: 'Missão V', goal: 'Meta V', steps: [{ id: 's1', title: 'Etapa s1', prompt: 'Faça s1', provider: 'claude', role: 'builder' }], ...extra });
    assert.equal(c.ok, true, c.error); w.flow = c.body;
    const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body;
    await w.flows.tick();
    assert.equal(w.rs('s1').status, 'running');
    fs.writeFileSync(path.join(terms.get(w.rs('s1').terminalId).cwd, 'n.txt'), 'N\n');
    Object.assign(tasks.get(w.rs('s1').taskId), { status: 'done', summary: 'feito s1' });
  };
  w.snapUser = () => { w.user = { head: headOf(repo), status: statusOf(repo) }; };
  w.intact = (msg = 'nada foi integrado na pasta do usuário') => { assert.equal(headOf(repo), w.user.head, msg); assert.equal(statusOf(repo), w.user.status, msg); assert.equal(read(repo, 'n.txt'), null, msg); };
  return w;
}
const CMD = { args: ['npm', 'test'], timeoutSec: 120 };

test('sem comando de verificação: igual a antes (o verificador nunca é chamado; integra com autoIntegrate)', async () => {
  const w = world();
  await w.startDone();
  await w.tick();
  const r = w.raw();
  assert.equal(r.status, 'completed', r.error); assert.equal(read(w.repo, 'n.txt'), 'N\n');
  assert.equal(w.calls.length, 0); assert.equal(r.git.verification, undefined); assert.equal(r.git.verifying, undefined);
  assert.equal(w.flows.get(w.flow.id).body.verifyCommand, null);
});

test('passou: verifica a PONTA da branch da missão no repositório e integra (autoIntegrate); o resultado fica em run.git.verification', async () => {
  const w = world();
  await w.startDone({ verifyCommand: CMD });
  w.verify = async (repoPath, sha) => { // na hora da verificação: a marca está gravada e a pasta do usuário ainda não mudou
    assert.equal(w.raw().git.verifying.command, 'npm test'); assert.ok(w.raw().git.verifying.startedAt); assert.equal(read(w.repo, 'n.txt'), null);
    assert.equal(sha, w.raw().git.tip); assert.equal(G(repoPath, ['show', `${sha}:n.txt`]), 'N');
    return PASS;
  };
  w.snapUser();
  await w.tick();
  const r = w.raw();
  assert.equal(w.calls.length, 1); assert.equal(w.calls[0].repoPath, w.repo); assert.deepEqual(w.calls[0].args, ['npm', 'test']); assert.equal(w.calls[0].timeoutSec, 120);
  assert.equal(r.status, 'completed', r.error); assert.equal(read(w.repo, 'n.txt'), 'N\n'); assert.equal(r.git.integration.by, 'auto');
  assert.deepEqual(r.git.verification, { ...PASS, tip: w.calls[0].sha }); assert.equal(r.git.verifying, undefined);
  assert.deepEqual(w.flows.getRun(w.flow.id, w.run.id).body.git.verification.status, 'pass', 'a visão leva a verificação');
});

test('passou com autoIntegrate false: ready_to_integrate sem erro e com o diagnóstico (fluxo de sempre)', async () => {
  const w = world();
  await w.startDone({ verifyCommand: CMD, autoIntegrate: false });
  w.snapUser();
  await w.tick();
  const r = w.raw();
  assert.equal(r.status, 'ready_to_integrate'); assert.equal(r.error, null); assert.equal(r.git.verification.status, 'pass'); assert.ok(r.git.pending.checkedAt);
  w.intact();
});

test('não passou (fail, timeout, error): ready_to_integrate com "Verificação falhou:" e a saída, SEM integrar mesmo com autoIntegrate; Integrar manual continua liberado', async () => {
  const cases = [
    [FAIL, /código 1/],
    [{ ...FAIL, status: 'timeout', exitCode: null, outputTail: 'rodando...\n[tempo máximo excedido (120 s); processo encerrado]' }, /tempo máximo/],
    [{ ...FAIL, status: 'error', exitCode: null, outputTail: 'Executável não encontrado: "npm".' }, /Executável não encontrado/],
  ];
  for (const [res, re] of cases) {
    const w = world();
    await w.startDone({ verifyCommand: CMD });
    w.verify = async () => res;
    w.snapUser();
    await w.tick();
    const r = w.raw();
    assert.equal(r.status, 'ready_to_integrate', res.status); assert.match(r.error, /^Verificação falhou: /); assert.match(r.error, re);
    assert.equal(r.git.verification.status, res.status); assert.equal(r.git.verification.outputTail, res.outputTail); assert.equal(r.git.verification.tip, w.calls[0].sha);
    assert.equal(r.git.verifying, undefined); assert.ok(r.git.pending.checkedAt, 'diagnóstico para o Integrar'); assert.equal(r.git.integration, null);
    w.intact();
    await w.tick(); assert.equal(w.calls.length, 1, 'parado em ready_to_integrate: não verifica de novo nem integra'); w.intact();
    // Integrar pelo usuário NÃO é bloqueado pela verificação
    const i = await w.flows.integrateRun(w.flow.id, w.run.id, {});
    assert.equal(i.status, 200, i.error); assert.equal(i.body.status, 'completed'); assert.equal(read(w.repo, 'n.txt'), 'N\n'); assert.equal(w.raw().git.integration.by, 'user');
  }
});

test('verificador que lança ou devolve lixo: tratado como error (nunca integra)', async () => {
  for (const verify of [async () => { throw new Error('quebrou'); }, async () => null, async () => ({ status: 'ok?' })]) {
    const w = world();
    await w.startDone({ verifyCommand: CMD });
    w.verify = verify; w.snapUser();
    await w.tick();
    const r = w.raw();
    assert.equal(r.status, 'ready_to_integrate'); assert.match(r.error, /^Verificação falhou: /); assert.equal(r.git.verification.status, 'error');
    w.intact();
  }
});

test('cancelar durante a verificação: o processo é encerrado (signal abortado), o run fica cancelado e nada é integrado', async () => {
  const w = world();
  await w.startDone({ verifyCommand: CMD });
  let started; const inside = new Promise((res) => { started = res; });
  w.verify = (repoPath, sha, o) => new Promise((resolve) => { started(); o.signal.addEventListener('abort', () => resolve({ ...FAIL, status: 'error', exitCode: null, outputTail: 'Verificação cancelada.' })); });
  w.snapUser();
  const t = w.tick();
  await inside;
  assert.equal(w.raw().status, 'running'); assert.ok(w.raw().git.verifying);
  const c = w.flows.cancelRun(w.flow.id, w.run.id);
  assert.equal(c.status, 200, c.error); assert.equal(c.body.status, 'cancelled');
  assert.equal(w.calls[0].signal.aborted, true, 'cancelar aborta o verificador');
  await t;
  const r = w.raw();
  assert.equal(r.status, 'cancelled'); assert.equal(r.error, 'Cancelada pelo usuário.'); assert.equal(r.git.verifying, undefined); assert.equal(r.git.integration, null);
  await w.tick(); w.intact(); assert.equal(w.calls.length, 1);
});

test('reinício no meio da verificação: recover → ready_to_integrate sem integrar (nunca integra sem verificar); o verificador não roda de novo', async () => {
  const w = world();
  await w.startDone({ verifyCommand: CMD });
  let started; const inside = new Promise((res) => { started = res; });
  w.verify = () => { started(); return new Promise(() => {}); }; // "trava": o servidor cai antes de terminar
  w.snapUser();
  void w.tick();
  await inside;
  assert.ok(w.raw().git.verifying);
  // "reinicia o servidor": banco copiado (com a marca gravada), gerente novo
  const db2 = structuredClone(w.db);
  const w2 = world({ repo: w.repo, db: db2 }); w2.run = w.run; w2.flow = w.flow; w2.user = w.user;
  assert.equal(w2.flows.recover(), 1);
  const r = w2.raw();
  assert.equal(r.status, 'ready_to_integrate'); assert.match(r.error, /^Verificação falhou: o servidor reiniciou/);
  assert.equal(r.git.verifying, undefined); assert.equal(r.git.verification.status, 'error'); assert.equal(r.git.verification.command, 'npm test'); assert.equal(r.git.verification.tip, r.git.tip);
  assert.deepEqual(r.ownedTerminalIds, []);
  await w2.tick(); assert.equal(w2.calls.length, 0); w2.intact();
});

test('persistência: sem gravar a marca, o verificador não roda (o passo seguinte tenta); sem gravar o resultado, nada integra e o passo seguinte verifica de novo', async () => {
  const w = world();
  await w.startDone({ verifyCommand: CMD });
  w.snapUser();
  // 1) falha a gravação da marca (verifying sem resultado, antes de o verificador rodar)
  let failedMark = false;
  w.persistHook = () => { const g = w.raw().git; if (!failedMark && g?.verifying && w.calls.length === 0) { failedMark = true; return true; } return false; };
  await w.tick();
  assert.equal(failedMark, true); assert.equal(w.calls.length, 0, 'sem a marca gravada o verificador não roda');
  assert.equal(w.raw().status, 'running'); assert.equal(w.raw().git.verifying, undefined, 'rollback da marca'); w.intact();
  // 2) falha a gravação do RESULTADO: nada integra; a marca continua e o passo seguinte verifica de novo e integra
  let failedResult = false;
  w.persistHook = () => { const g = w.raw().git; if (!failedResult && g?.verification) { failedResult = true; return true; } return false; };
  await w.tick();
  assert.equal(failedResult, true); assert.equal(w.calls.length, 1); assert.equal(w.raw().status, 'running'); assert.ok(w.raw().git.verifying, 'a marca continua (rollback do resultado)'); w.intact();
  await w.tick();
  assert.equal(w.calls.length, 2); assert.equal(w.raw().status, 'completed', w.raw().error); assert.equal(read(w.repo, 'n.txt'), 'N\n');
});
