// Missions v2: envio ao remoto DEPOIS da integração final (flows.js + flow-push.js). Git REAL em repositórios temporários, com um "remoto" bare numa pasta temporária (sem rede);
// worktrees e flow-git REAIS; terminais, Maestro e VERIFICADOR falsos. Banco temporário (ORCH_DATA_DIR antes de importar store.js); nunca a pasta do projeto.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-push-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const store = await import('../store.js');
const W = await import('../worktrees.js');
const { createFlowGit } = await import('../flow-git.js');
const F = await import('../flows.js');
const P = await import('../flow-push.js');
const pushFile = () => P.createFlowPush({ allowProtocols: 'file' }); // o remoto dos testes é uma pasta (file); o padrão real só aceita https e ssh
const gdb = store.load(); gdb.missions = []; store.saveOrThrow();
after(() => { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const G = (cwd, args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const hex = (n) => n.toString(16).padStart(8, '0');
const T0 = Date.parse('2026-11-20T10:00:00.000Z');
let seq = 0;
function makeRepo() {
  const n = ++seq, repo = path.join(tmp, `repo-${n}`), bare = path.join(tmp, `remote-${n}.git`);
  fs.mkdirSync(bare); G(bare, ['init', '-q', '--bare', '-b', 'main']);
  fs.mkdirSync(repo); G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
  G(repo, ['remote', 'add', 'origin', bare]); G(repo, ['push', '-q', '-u', 'origin', 'main']);
  return { repo, bare };
}
const PASS = { status: 'pass', command: 'npm test', exitCode: 0, durationMs: 12, outputTail: 'ok', truncated: false, at: '2026-11-20T10:00:05.000Z' };
const FAIL = { status: 'fail', command: 'npm test', exitCode: 1, durationMs: 30, outputTail: 'not ok 1', truncated: false, at: '2026-11-20T10:00:05.000Z' };
const CMD = { args: ['npm', 'test'], timeoutSec: 120 };

function world() {
  const n = ++seq, { repo, bare } = makeRepo();
  const db = { settings: {}, missions: [], workspaces: [{ id: `ws_${hex(n)}`, name: 'proj', path: repo, verifications: [] }], worktrees: [], flows: [], flowRuns: [] };
  const ws = db.workspaces[0], wtm = W.createWorktreeManager({ db, root: path.join(tmp, `wts-${n}`) });
  const terms = new Map(), tasks = new Map(), errors = [];
  let tn = 0, kn = 0;
  const w = { repo, bare, db, ws, terms, tasks, errors, clock: T0, failPersist: 0, verify: async () => PASS };
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
  w.maestro = { dispatch() { const id = `task_${hex(++kn)}`; tasks.set(id, { status: 'delivered', summary: null }); return { ok: true, taskId: id }; }, taskState: (id) => tasks.get(id) ?? null };
  w.persist = () => { if (w.failPersist > 0) { w.failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  w.flowGit = createFlowGit({ db, worktrees: wtm, persist: w.persist });
  w.flows = F.createFlows({ db, terminals: w.terminals, maestro: w.maestro, flowGit: w.flowGit, flowVerify: { run: (...a) => w.verify(...a) }, flowPush: pushFile(), persist: w.persist, now: () => new Date(w.clock).toISOString(), uid: store.uid, pollMs: 0, onError: (e) => errors.push(e) });
  w.tick = async () => { w.clock += 1000; await w.flows.tick(); };
  w.raw = () => db.flowRuns.find((r) => r.id === w.run.id);
  w.remoteHead = () => G(bare, ['rev-parse', 'main']);
  w.localHead = () => G(repo, ['rev-parse', 'main']);
  /** Cria a missão, roda a etapa s1 (escreve um arquivo na cópia e chama report_done) e dá o passo que termina o run. */
  w.finish = async (extra = {}) => {
    const c = w.flows.create({ workspaceId: ws.id, title: 'Missão P', goal: 'Meta P', steps: [{ id: 's1', title: 'Etapa s1', prompt: 'Faça s1', provider: 'claude', role: 'builder' }], ...extra });
    assert.equal(c.ok, true, c.error); w.flow = c.body;
    const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body;
    await w.flows.tick();
    fs.writeFileSync(path.join(terms.get(w.raw().steps[0].terminalId).cwd, 'n.txt'), 'N\n');
    Object.assign(tasks.get(w.raw().steps[0].taskId), { status: 'done', summary: 'feito s1' });
    await w.tick(); await w.flows.pushIdle();
  };
  return w;
}

test('autoPush + verificação aprovada + integração automática: o commit integrado vai para origin/main, sem nenhuma ação sua', async () => {
  const w = world(), before = w.remoteHead();
  await w.finish({ verifyCommand: CMD, autoPush: true });
  const r = w.raw();
  assert.equal(r.status, 'completed', r.error); assert.equal(r.git.integration.by, 'auto');
  assert.equal(r.git.push.state, 'pushed', JSON.stringify(r.git.push)); assert.equal(r.git.push.by, 'auto'); assert.equal(r.git.push.branch, 'origin/main');
  assert.equal(r.git.push.from, before); assert.equal(r.git.push.to, r.git.integration.to); assert.equal(w.remoteHead(), r.git.integration.to); assert.equal(w.remoteHead(), w.localHead());
  assert.ok(r.git.push.commits.length >= 1);
  assert.equal(w.flows.getRun(w.flow.id, w.run.id).body.git.push.state, 'pushed', 'a visão leva o envio');
  assert.equal(w.flows.get(w.flow.id).body.autoPush, true);
});

test('verificação FALHOU e você integrou por cima: o automático NÃO envia (blocked); Enviar agora, com a prévia, envia', async () => {
  const w = world(), before = w.remoteHead();
  w.verify = async () => FAIL;
  await w.finish({ verifyCommand: CMD, autoPush: true });
  assert.equal(w.raw().status, 'ready_to_integrate');
  const i = await w.flows.integrateRun(w.flow.id, w.run.id, {}); assert.equal(i.status, 200, i.error); await w.flows.pushIdle();
  let r = w.raw(); assert.equal(r.status, 'completed'); assert.deepEqual([r.git.push.state, r.git.push.code], ['blocked', 'verify_not_passed']); assert.equal(w.remoteHead(), before);
  const p = await w.flows.pushPreview(w.flow.id, w.run.id); assert.equal(p.status, 200, p.error);
  assert.equal(p.body.canPush, true); assert.equal(p.body.branch, 'origin/main'); assert.match(p.body.digest, /^[0-9a-f]{32}$/); assert.ok(p.body.commits.length >= 1); assert.equal(w.remoteHead(), before, 'a prévia não envia');
  const s = await w.flows.pushNow(w.flow.id, w.run.id, { expect: p.body.digest }); assert.equal(s.status, 200, s.error);
  r = w.raw(); assert.deepEqual([r.git.push.state, r.git.push.by], ['pushed', 'user']); assert.equal(w.remoteHead(), r.git.integration.to);
});

test('um envio que já deu certo NÃO é apagado por uma nova tentativa que falha (o commit continua no remoto)', async () => {
  const w = world();
  await w.finish({ verifyCommand: CMD, autoPush: true });
  const before = structuredClone(w.raw().git.push); assert.equal(before.state, 'pushed');
  G(w.repo, ['remote', 'set-url', 'origin', path.join(tmp, 'outro-remoto.git')]); // destino trocado depois: o novo envio é recusado (target_changed)
  const p = await w.flows.pushPreview(w.flow.id, w.run.id); assert.equal(p.status, 200, p.error);
  const s = await w.flows.pushNow(w.flow.id, w.run.id, { expect: p.body.digest });
  assert.equal(s.status, 409); assert.equal(s.code, 'target_changed');
  assert.deepEqual(w.raw().git.push, before, 'o registro "enviado" continua igual');
  assert.equal(w.remoteHead(), w.raw().git.integration.to);
});

test('sem autoPush: integra e NÃO envia; o envio manual continua disponível', async () => {
  const w = world(), before = w.remoteHead();
  await w.finish({ verifyCommand: CMD });
  const r = w.raw(); assert.equal(r.status, 'completed'); assert.equal(r.git.push, undefined); assert.equal(w.remoteHead(), before);
  assert.equal(w.flows.get(w.flow.id).body.autoPush, false);
  const p = await w.flows.pushPreview(w.flow.id, w.run.id); assert.equal(p.body.canPush, true);
});

test('Enviar agora: corpo inválido = 400; execução não integrada = 409; digest diferente = 409 sem enviar e sem mudar o registro; dois cliques juntos = um envio só', async () => {
  const w = world(), before = w.remoteHead();
  w.verify = async () => FAIL;
  await w.finish({ verifyCommand: CMD });
  for (const b of [undefined, null, {}, { expect: 'x' }, { expect: 'a'.repeat(32), extra: 1 }]) assert.equal((await w.flows.pushNow(w.flow.id, w.run.id, b)).status, 400, JSON.stringify(b));
  assert.equal((await w.flows.pushNow(w.flow.id, w.run.id, { expect: 'a'.repeat(32) })).code, 'not_integrated', 'ready_to_integrate ainda não envia');
  assert.equal((await w.flows.pushPreview(w.flow.id, w.run.id)).status, 409);
  assert.equal((await w.flows.integrateRun(w.flow.id, w.run.id, {})).status, 200); await w.flows.pushIdle();
  const wrong = await w.flows.pushNow(w.flow.id, w.run.id, { expect: 'a'.repeat(32) });
  assert.equal(wrong.status, 409); assert.equal(wrong.code, 'changed'); assert.equal(w.raw().git.push, undefined, 'registro intacto'); assert.equal(w.remoteHead(), before);
  const { digest } = (await w.flows.pushPreview(w.flow.id, w.run.id)).body;
  const [a, b] = await Promise.all([w.flows.pushNow(w.flow.id, w.run.id, { expect: digest }), w.flows.pushNow(w.flow.id, w.run.id, { expect: digest })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]); assert.equal([a, b].find((x) => x.status === 409).code, 'busy');
  assert.equal(w.remoteHead(), w.raw().git.integration.to);
  // de novo, já enviado: a prévia diz que não há o que enviar
  const again = (await w.flows.pushPreview(w.flow.id, w.run.id)).body; assert.deepEqual([again.already, again.canPush], [true, false]);
});

test('banco que não grava a marca de envio: nada é enviado (500)', async () => {
  const w = world(), before = w.remoteHead();
  await w.finish({ verifyCommand: CMD });
  const { digest } = (await w.flows.pushPreview(w.flow.id, w.run.id)).body;
  w.failPersist = 1; const r = await w.flows.pushNow(w.flow.id, w.run.id, { expect: digest });
  assert.equal(r.status, 500); assert.equal(w.remoteHead(), before); assert.equal(w.raw().git.push, undefined);
});

test('reinício no meio de um envio: o boot marca "falhou, confira" (sem mudar a contagem de execuções interrompidas) e Enviar agora continua possível', async () => {
  const w = world();
  await w.finish({ verifyCommand: CMD });
  w.raw().git.push = { state: 'pushing', by: 'user', at: 'x' };
  const w2 = F.createFlows({ db: w.db, terminals: w.terminals, maestro: w.maestro, flowGit: w.flowGit, flowPush: pushFile(), persist: () => {}, now: () => new Date(T0).toISOString(), uid: store.uid, pollMs: 0, onError: () => {} });
  assert.equal(w2.recover(), 0);
  assert.deepEqual([w.raw().git.push.state, w.raw().git.push.code], ['failed', 'interrupted']); assert.match(w.raw().git.push.error, /reiniciou durante o envio/);
  const p = await w2.pushPreview(w.flow.id, w.run.id); assert.equal(p.body.canPush, true);
});

test('validação: autoPush é booleano estrito, exige comando de verificação, não some calado ao tirar a verificação e pode mudar com a execução ativa', () => {
  const V = (body, opts) => F.validateFlowInput(body, opts);
  const base = { workspaceId: 'ws_1', title: 'M', steps: [{ id: 's1', title: 'A', prompt: 'p', provider: 'claude', role: 'builder' }] };
  assert.equal(V({ ...base }, { create: true }).value.autoPush, false, 'padrão desligado');
  assert.match(V({ ...base, autoPush: true }, { create: true }).error, /exige um comando de verificação/);
  assert.equal(V({ ...base, autoPush: true, verifyCommand: CMD }, { create: true }).value.autoPush, true);
  assert.match(V({ ...base, autoPush: 'sim', verifyCommand: CMD }, { create: true }).error, /autoPush deve ser/);
  const cur = { kind: 'project', autoPush: true, verifyCommand: CMD };
  assert.match(V({ verifyCommand: null }, { create: false, current: cur }).error, /desligue também o envio automático/);
  assert.equal(V({ verifyCommand: null, autoPush: false }, { create: false, current: cur }).error, undefined);
  assert.equal(V({ autoPush: true }, { create: false, current: { kind: 'project', verifyCommand: CMD } }).error, undefined);
  assert.match(V({ autoPush: true }, { create: false, current: { kind: 'project', verifyCommand: null } }).error, /exige/);
  assert.equal(F.runSafePatch({ autoPush: true }), true, 'pode mudar com a execução ativa');
});

// ---------- correções da revisão de segurança (de ponta a ponta) ----------
/** Roda a missão até antes do passo final; `during` acontece com a etapa já feita (você commita, um agente muda o remoto...). */
async function finishWith(w, extra, during) {
  const c = w.flows.create({ workspaceId: w.ws.id, title: 'Missão P', goal: 'Meta P', steps: [{ id: 's1', title: 'Etapa s1', prompt: 'Faça s1', provider: 'claude', role: 'builder' }], ...extra });
  assert.equal(c.ok, true, c.error); w.flow = c.body;
  const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body;
  await w.flows.tick();
  fs.writeFileSync(path.join(w.terms.get(w.raw().steps[0].terminalId).cwd, 'n.txt'), 'N\n');
  Object.assign(w.tasks.get(w.raw().steps[0].taskId), { status: 'done', summary: 'feito s1' });
  await during();
  await w.tick(); await w.flows.pushIdle();
}

test('o destino do envio é gravado no INÍCIO da execução (antes de qualquer agente rodar), sem credencial na URL', async () => {
  const w = world();
  await finishWith(w, { verifyCommand: CMD, autoPush: true }, async () => {
    const t = w.raw().git.pushTarget; assert.ok(t, 'gravado já durante a execução');
    assert.deepEqual([t.remote, t.mergeRef, t.branch], ['origin', 'refs/heads/main', 'origin/main']); assert.match(t.urlHash, /^[0-9a-f]{32}$/); assert.ok(t.url.includes('remote-'));
  });
  assert.equal(w.raw().git.push.state, 'pushed');
});

test('você commitou na main durante a missão (integração por merge): o automático NÃO envia o seu commit não verificado; o manual mostra e envia', async () => {
  const w = world(), before = w.remoteHead();
  await finishWith(w, { verifyCommand: CMD, autoPush: true }, async () => {
    fs.writeFileSync(path.join(w.repo, 'meu.txt'), 'meu\n'); G(w.repo, ['add', '-A']); G(w.repo, ['commit', '-q', '-m', 'meu commit durante a missão']);
  });
  let r = w.raw(); assert.equal(r.status, 'completed', r.error); assert.equal(r.git.integration.mode, 'merge');
  assert.deepEqual([r.git.push.state, r.git.push.code], ['blocked', 'foreign_commits']); assert.equal(w.remoteHead(), before, 'nada saiu');
  const p = (await w.flows.pushPreview(w.flow.id, w.run.id)).body;
  assert.equal(p.canPush, true); assert.ok(p.reasons.some((x) => x.code === 'foreign_commits')); assert.ok(p.commits.some((c) => c.subject === 'meu commit durante a missão'));
  assert.equal((await w.flows.pushNow(w.flow.id, w.run.id, { expect: p.digest })).status, 200);
  r = w.raw(); assert.deepEqual([r.git.push.state, r.git.push.by], ['pushed', 'user']); assert.equal(w.remoteHead(), r.git.integration.to);
});

test('um agente trocou a URL do remoto durante a missão: o automático NÃO envia (target_changed) e o remoto trocado não recebe nada', async () => {
  const w = world(), before = w.remoteHead();
  const evil = path.join(tmp, `evil-${seq}.git`); fs.mkdirSync(evil); G(evil, ['init', '-q', '--bare', '-b', 'main']); G(w.repo, ['push', '-q', evil, 'main']);
  await finishWith(w, { verifyCommand: CMD, autoPush: true }, async () => { G(w.repo, ['remote', 'set-url', 'origin', evil]); });
  const r = w.raw(); assert.equal(r.status, 'completed', r.error);
  assert.deepEqual([r.git.push.state, r.git.push.code], ['blocked', 'target_changed']); assert.match(r.git.push.error, /destino do envio mudou/);
  assert.equal(G(evil, ['rev-parse', 'main']), before, 'o remoto trocado não recebeu nada'); assert.equal(w.remoteHead(), before);
});
