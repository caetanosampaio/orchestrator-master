// Missions v2: gerente e runner de missões (flows.js) com terminais e Maestro SIMULADOS, relógio e temporizadores injetados (nenhum processo, Claude ou Codex real).
// Cobre sequência, paralelismo (maxParallel), falha que pula dependentes, cancelamento, etapa `waiting`, continueFrom, reinício do servidor, limites e rollback de persistência.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-runner-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const F = await import('../flows.js');

const hex = (n) => n.toString(16).padStart(8, '0');
const READY = { state: 'idle', at: '2026-11-10T10:00:00.000Z' };

function world(over = {}) {
  const db = { settings: {}, workspaces: [{ id: 'ws_1', name: 'Projeto', path: '/x' }], flows: [], flowRuns: [], ...(over.db ?? {}) };
  const terms = new Map(), created = [], closed = [], dispatches = [], tasks = new Map(), timers = [];
  let tn = 0, un = 0, clock = Date.parse('2026-11-10T10:00:00.000Z'), persists = 0, failPersist = 0, skipPersist = 0, createGate = null;
  const w = {
    db, terms, created, closed, dispatches, tasks, timers,
    busy: new Set(), outputs: new Map(), writes: [], refuse: null, failCreate: null, providers: [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
    get persists() { return persists; }, failPersist: (n = 1, skip = 0) => { failPersist = n; skipPersist = skip; }, gateCreate: () => { let release; createGate = new Promise((r) => { release = r; }); return () => { createGate = null; release(); }; },
    advance: (ms) => { clock += ms; },
  };
  w.terminals = {
    async create(o) {
      created.push(o);
      if (createGate) await createGate;
      if (w.failCreate) return { ok: false, status: 409, error: w.failCreate };
      const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { ...READY }, role: o.role }); return { ok: true, status: 201, session: { id } };
    },
    peek: (id) => terms.get(id) ?? null,
    readOutput: (id) => w.outputs.get(id) ?? '',
    write: (id, d) => { w.writes.push([id, d]); return { ok: true }; },
    close: (id) => { closed.push(id); const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
    count: () => [...terms.values()].filter((t) => t.status === 'running').length,
    providers: () => w.providers,
  };
  w.maestro = {
    dispatch(d) {
      if (w.refuse) return { ok: false, error: w.refuse };
      if (w.busy.has(d.to) || terms.get(d.to)?.agent?.state === 'waiting') return { ok: false, transient: true, error: 'O terminal de destino ainda não está pronto: ele estava ocupado.' };
      const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); dispatches.push({ ...d, taskId: id }); return { ok: true, taskId: id };
    },
    taskState: (id) => tasks.get(id) ?? null,
  };
  w.persist = () => { persists++; if (skipPersist > 0) { skipPersist--; return; } if (failPersist > 0) { failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  w.flows = F.createFlows({ db, terminals: w.terminals, maestro: w.maestro, persist: w.persist, now: () => new Date(clock).toISOString(), uid: (p) => `${p}_${hex(++un)}`, setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, onError: () => {}, ...over.deps });
  w.done = (taskId, summary = 'feito') => { Object.assign(tasks.get(taskId), { status: 'done', summary }); };
  w.taskFail = (taskId, status = 'failed', note = 'A tarefa falhou.') => { Object.assign(tasks.get(taskId), { status, note }); };
  w.tick = () => w.flows.tick();
  w.step = (id, runId) => (w.flows.getRun(w.flow.id, runId ?? w.run.id).body.steps.find((s) => s.stepId === id));
  w.runView = () => w.flows.getRun(w.flow.id, w.run.id).body;
  w.make = (steps, extra = {}) => { const r = w.flows.create({ workspaceId: 'ws_1', title: 'Missão X', goal: 'Meta Y', steps, ...extra }); assert.equal(r.ok, true, r.error); w.flow = r.body; return r.body; };
  w.start = async (steps, extra) => { w.make(steps, extra); const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body; await w.tick(); return w.runView(); };
  return w;
}
const S = (id, over = {}) => ({ id, title: `Etapa ${id}`, prompt: `Faça ${id}`, provider: 'claude', role: 'builder', ...over });
const statuses = (w) => w.runView().steps.map((s) => s.status);

test('sequência: cada etapa só começa depois que a anterior TERMINA de verdade; terminal, contexto e resumo corretos; run completa', async () => {
  const w = world();
  await w.start([S('s1', { model: 'opus', effort: 'high' }), S('s2', { dependsOn: ['s1'], role: 'reviewer', provider: 'codex' }), S('s3', { dependsOn: ['s2'] })]);
  assert.deepEqual(statuses(w), ['running', 'pending', 'pending']);
  assert.equal(w.created.length, 1);
  assert.deepEqual(w.created[0], { workspaceId: 'ws_1', role: 'builder', provider: 'claude', model: 'opus', effort: 'high', title: 'Etapa s1', fullAccess: false });
  assert.equal(w.dispatches.length, 1); assert.equal(w.dispatches[0].text, '[Missão: Missão X | Objetivo: Meta Y] Etapa "Etapa s1": Faça s1'); assert.equal(w.dispatches[0].from, null); assert.equal(w.dispatches[0].source, 'flow');
  assert.equal(w.step('s1').taskId, w.dispatches[0].taskId); assert.equal(w.step('s1').terminalId, 'term_' + hex(1));
  await w.tick(); assert.deepEqual(statuses(w), ['running', 'pending', 'pending'], 'sem o fim da tarefa nada avança');
  w.done(w.step('s1').taskId, 'Criei a.txt'); await w.tick();
  assert.deepEqual(statuses(w), ['completed', 'running', 'pending']); assert.equal(w.step('s1').summary, 'Criei a.txt'); assert.ok(w.step('s1').finishedAt);
  assert.equal(w.created.length, 2); assert.equal(w.created[1].provider, 'codex'); assert.equal(w.created[1].role, 'reviewer');
  w.done(w.step('s2').taskId); await w.tick(); assert.deepEqual(statuses(w), ['completed', 'completed', 'running']);
  assert.equal(w.runView().status, 'running');
  w.done(w.step('s3').taskId, 'x'.repeat(5000)); await w.tick();
  const run = w.runView(); assert.deepEqual([run.status, run.error], ['completed', null]); assert.ok(run.finishedAt);
  assert.ok(w.step('s3').summary.length <= 2000, 'resumo limitado');
  assert.equal(w.closed.length, 0, 'os terminais ficam abertos para o usuário');
  assert.equal(w.timers.length, 0, 'o temporizador é desligado quando não há run ativo');
});

test('paralelismo: etapas independentes respeitam maxParallel; a etapa de junção espera todas', async () => {
  const w = world();
  await w.start([S('s1'), S('s2'), S('s3'), S('s4', { dependsOn: ['s1', 's2', 's3'] })], { maxParallel: 2 });
  const active = () => w.runView().steps.filter((s) => s.status === 'running' || s.status === 'waiting').length;
  assert.deepEqual(statuses(w), ['running', 'running', 'pending', 'pending']); assert.equal(active(), 2);
  w.done(w.step('s1').taskId); await w.tick();
  assert.deepEqual(statuses(w), ['completed', 'running', 'running', 'pending']); assert.equal(active(), 2);
  w.done(w.step('s3').taskId); await w.tick(); assert.deepEqual(statuses(w), ['completed', 'running', 'completed', 'pending']);
  w.done(w.step('s2').taskId); await w.tick(); assert.deepEqual(statuses(w), ['completed', 'completed', 'completed', 'running']);
  w.done(w.step('s4').taskId); await w.tick(); assert.equal(w.runView().status, 'completed');
  // com maxParallel 1 as independentes saem uma por vez, na ordem
  const w1 = world(); await w1.start([S('s1'), S('s2')]);
  assert.deepEqual(statuses(w1), ['running', 'pending']); w1.done(w1.step('s1').taskId); await w1.tick(); assert.deepEqual(statuses(w1), ['completed', 'running']);
  // com 4 e três independentes: as três saem juntas
  const w4 = world(); await w4.start([S('s1'), S('s2'), S('s3')], { maxParallel: 4 }); assert.deepEqual(statuses(w4), ['running', 'running', 'running']); assert.equal(w4.created.length, 3);
});

test('falha pula os dependentes (também os indiretos) e deixa as independentes terminarem; o run vira failed com o motivo', async () => {
  const w = world();
  await w.start([S('s1'), S('s2', { dependsOn: ['s1'] }), S('s3', { dependsOn: ['s2'] }), S('s4'), S('s5', { dependsOn: ['s4'] })], { maxParallel: 2 });
  assert.deepEqual(statuses(w), ['running', 'pending', 'pending', 'running', 'pending']);
  w.taskFail(w.step('s1').taskId, 'failed', 'O terminal acabou antes de concluir a tarefa.'); await w.tick();
  assert.deepEqual(statuses(w), ['failed', 'skipped', 'skipped', 'running', 'pending']);
  assert.equal(w.step('s1').error, 'O terminal acabou antes de concluir a tarefa.'); assert.match(w.step('s2').error, /Pulada.*s1/); assert.match(w.step('s3').error, /Pulada.*s2/);
  assert.equal(w.runView().status, 'running', 'ainda há trabalho independente');
  w.done(w.step('s4').taskId); await w.tick(); assert.deepEqual(statuses(w), ['failed', 'skipped', 'skipped', 'completed', 'running']);
  w.done(w.step('s5').taskId); await w.tick();
  const run = w.runView(); assert.equal(run.status, 'failed'); assert.match(run.error, /Etapa s1.*falhou.*terminal acabou/); assert.ok(run.finishedAt);
  for (const st of ['expired', 'rejected']) { const x = world(); await x.start([S('s1')]); x.taskFail(x.step('s1').taskId, st, 'Sem decisão.'); await x.tick(); assert.equal(x.step('s1').status, 'failed', st); }
});

test('falhas reais: tarefa perdida, terminal que acaba (antes e depois da entrega), criação do terminal recusada, entrega recusada, entrega que nunca sai', async () => {
  let w = world(); await w.start([S('s1')]); w.tasks.delete(w.step('s1').taskId); await w.tick(); assert.match(w.step('s1').error, /não foi encontrada/);
  w = world(); await w.start([S('s1')]); w.terms.get(w.step('s1').terminalId).status = 'exited'; await w.tick(); assert.match(w.step('s1').error, /terminal terminou antes do fim/); assert.equal(w.runView().status, 'failed');
  w = world(); w.busy.add('term_' + hex(1)); await w.start([S('s1')]); assert.equal(w.step('s1').taskId, null); w.terms.get(w.step('s1').terminalId).status = 'exited'; await w.tick(); assert.match(w.step('s1').error, /antes de receber a etapa/);
  w = world(); w.failCreate = 'Limite de 50 terminais simultâneos atingido; feche algum antes de abrir outro.'; await w.start([S('s1'), S('s2', { dependsOn: ['s1'] })]);
  assert.deepEqual(statuses(w), ['failed', 'skipped']); assert.match(w.step('s1').error, /Não foi possível abrir o terminal: Limite de 50/); assert.equal(w.runView().status, 'failed'); assert.equal(w.dispatches.length, 0);
  w = world(); w.refuse = 'O terminal de destino não está ativo.'; await w.start([S('s1')]); assert.match(w.step('s1').error, /Não foi possível entregar a etapa.*não está ativo/);
  // entrega que nunca sai (terminal ocupado) falha depois de dispatchWaitMs
  w = world({ deps: { dispatchWaitMs: 60_000 } }); w.busy.add('term_' + hex(1)); await w.start([S('s1')]);
  w.advance(30_000); await w.tick(); assert.equal(w.step('s1').status, 'running'); assert.equal(w.dispatches.length, 0);
  w.advance(31_000); await w.tick(); assert.equal(w.step('s1').status, 'failed'); assert.match(w.step('s1').error, /não ficou livre.*1 minutos/);
  w = world(); w.terminals.create = async () => { throw new Error('explodiu'); }; await w.start([S('s1')]); assert.match(w.step('s1').error, /explodiu/);
});

test('etapa `waiting`: reflete o estado REAL do agente (permissão pendente) e volta a `running`; entrega adiada enquanto aguarda', async () => {
  const w = world();
  // o terminal recém-aberto já está aguardando uma permissão: a etapa não é entregue e aparece como waiting
  const orig = w.terminals.create; w.terminals.create = async (o) => { const r = await orig(o); w.terms.get(r.session.id).agent = { state: 'waiting', at: READY.at }; return r; };
  await w.start([S('s1')]);
  assert.equal(w.step('s1').status, 'waiting'); assert.equal(w.step('s1').taskId, null); assert.equal(w.dispatches.length, 0);
  w.terms.get(w.step('s1').terminalId).agent = { state: 'idle', at: READY.at }; await w.tick();
  assert.equal(w.step('s1').status, 'running'); assert.ok(w.step('s1').taskId);
  w.terms.get(w.step('s1').terminalId).agent = { state: 'waiting', at: READY.at }; await w.tick();
  assert.equal(w.step('s1').status, 'waiting', 'agente pediu permissão durante a tarefa'); assert.equal(w.runView().status, 'running');
  w.terms.get(w.step('s1').terminalId).agent = { state: 'running', at: READY.at }; await w.tick(); assert.equal(w.step('s1').status, 'running');
  // sem estado (agent nulo) nunca é "waiting"
  w.terms.get(w.step('s1').terminalId).agent = null; await w.tick(); assert.equal(w.step('s1').status, 'running');
  w.done(w.step('s1').taskId); await w.tick(); assert.equal(w.runView().status, 'completed');
});

test('entrega transitória (terminal ocupado) é repetida a cada tick até sair', async () => {
  const w = world(); w.busy.add('term_' + hex(1));
  await w.start([S('s1')]); assert.equal(w.step('s1').taskId, null); assert.equal(w.step('s1').status, 'running');
  await w.tick(); assert.equal(w.dispatches.length, 0);
  w.busy.clear(); await w.tick(); assert.equal(w.dispatches.length, 1); assert.ok(w.step('s1').taskId);
  assert.equal(w.created.length, 1, 'o terminal é aberto uma vez só');
});

test('continueFrom: reaproveita o terminal da etapa anterior (um só terminal, duas tarefas); se ele morreu, abre um novo', async () => {
  const w = world();
  await w.start([S('s1'), S('s2', { dependsOn: ['s1'], continueFrom: 's1' })]);
  w.done(w.step('s1').taskId); await w.tick();
  assert.equal(w.created.length, 1); assert.equal(w.step('s2').terminalId, w.step('s1').terminalId); assert.equal(w.dispatches.length, 2); assert.equal(w.dispatches[1].to, w.dispatches[0].to);
  assert.notEqual(w.step('s2').taskId, w.step('s1').taskId);
  w.done(w.step('s2').taskId); await w.tick(); assert.equal(w.runView().status, 'completed');
  const x = world(); await x.start([S('s1'), S('s2', { dependsOn: ['s1'], continueFrom: 's1' })]);
  x.done(x.step('s1').taskId); x.terms.get(x.step('s1').terminalId).status = 'exited'; await x.tick();
  assert.equal(x.created.length, 2, 'o terminal anterior morreu: abre um novo'); assert.notEqual(x.step('s2').terminalId, x.step('s1').terminalId); assert.equal(x.step('s2').status, 'running');
  // cadeia de três
  const y = world(); await y.start([S('s1'), S('s2', { dependsOn: ['s1'], continueFrom: 's1' }), S('s3', { dependsOn: ['s2'], continueFrom: 's2' })]);
  y.done(y.step('s1').taskId); await y.tick(); y.done(y.step('s2').taskId); await y.tick();
  assert.equal(y.created.length, 1); assert.equal(y.step('s3').terminalId, y.step('s1').terminalId);
});

test('cancelar: run e etapas em andamento/pendentes viram cancelled, fecha SÓ os terminais deste run e o temporizador para', async () => {
  const w = world();
  w.terms.set('term_ffffffff', { id: 'term_ffffffff', status: 'running', agent: READY }); // terminal que o usuário abriu
  await w.start([S('s1'), S('s2'), S('s3', { dependsOn: ['s1'] }), S('s4', { dependsOn: ['s2'] })], { maxParallel: 2 });
  w.done(w.step('s2').taskId); await w.tick(); // s2 concluída, s4 e s1 em andamento, s3 pendente
  assert.deepEqual(statuses(w), ['running', 'completed', 'pending', 'running']);
  const mine = [w.step('s1').terminalId, w.step('s2').terminalId, w.step('s4').terminalId];
  const r = w.flows.cancelRun(w.flow.id, w.run.id);
  assert.equal(r.ok, true); assert.equal(r.body.status, 'cancelled'); assert.ok(r.body.finishedAt); assert.match(r.body.error, /Cancelada/);
  assert.deepEqual(r.body.steps.map((s) => s.status), ['cancelled', 'completed', 'cancelled', 'cancelled'], 'concluída continua concluída');
  assert.deepEqual([...w.closed].sort(), [...mine].sort().filter((id) => w.terms.get(id)), 'só os terminais criados por este run');
  assert.ok(!w.closed.includes('term_ffffffff')); assert.equal(w.terms.get('term_ffffffff').status, 'running');
  await w.tick(); assert.deepEqual(w.runView().steps.map((s) => s.status), ['cancelled', 'completed', 'cancelled', 'cancelled'], 'o runner não retoma nada'); assert.equal(w.timers.length, 0);
  assert.equal(w.flows.cancelRun(w.flow.id, w.run.id).status, 409, 'já terminou');
  assert.equal(w.flows.cancelRun(w.flow.id, 'run_00000000').status, 404); assert.equal(w.flows.cancelRun('flow_00000000', w.run.id).status, 404); assert.equal(w.flows.cancelRun(w.flow.id, '../x').status, 404);
  assert.equal(w.flows.startRun(w.flow.id).status, 201, 'depois de cancelado pode iniciar outro run');
});

test('cancelar durante a criação do terminal: o terminal que nasce depois do cancelamento é fechado (era deste run) e nada é entregue', async () => {
  const w = world(); const release = w.gateCreate();
  w.make([S('s1')]); w.run = w.flows.startRun(w.flow.id).body; const p = w.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.created.length, 1);
  assert.equal(w.flows.cancelRun(w.flow.id, w.run.id).status, 200);
  release(); await p;
  assert.deepEqual(w.closed, ['term_' + hex(1)]); assert.equal(w.dispatches.length, 0); assert.equal(w.runView().status, 'cancelled'); assert.equal(w.runView().steps[0].status, 'cancelled');
});

test('run ativo único por missão; editar/remover com run ativo = 409; arquivada não executa; depois do fim tudo volta ao normal', async () => {
  const w = await (async () => { const x = world(); await x.start([S('s1')]); return x; })();
  assert.equal(w.flows.startRun(w.flow.id).status, 409);
  assert.equal(w.flows.update(w.flow.id, { title: 'Outro' }).status, 409); assert.equal(w.flows.remove(w.flow.id).status, 409);
  assert.equal(w.flows.list()[0].activeRun.id, w.run.id); assert.equal(w.flows.list()[0].lastRun.id, w.run.id);
  w.done(w.step('s1').taskId); await w.tick();
  const l = w.flows.list()[0]; assert.equal(l.activeRun, null); assert.equal(l.lastRun.status, 'completed'); assert.equal(l.workspaceName, 'Projeto');
  assert.equal(w.flows.update(w.flow.id, { archived: true }).status, 200); assert.equal(w.flows.startRun(w.flow.id).status, 409);
  assert.equal(w.flows.update(w.flow.id, { archived: false, title: 'Outro' }).body.title, 'Outro');
  const second = w.flows.startRun(w.flow.id); assert.equal(second.status, 201); assert.notEqual(second.body.id, w.run.id);
  assert.equal(w.flows.listRuns(w.flow.id).body.length, 2); assert.equal(w.flows.listRuns(w.flow.id).body[0].id, second.body.id, 'mais recente primeiro');
  assert.equal(w.flows.cancelRun(w.flow.id, second.body.id).status, 200);
  assert.equal(w.flows.remove(w.flow.id).status, 204); assert.deepEqual(w.db.flowRuns, [], 'os runs saem junto'); assert.equal(w.flows.get(w.flow.id).status, 404);
});

test('início do run: espaço de trabalho removido, provedor indisponível, limite de terminais, texto da etapa longo demais; run não vaza `ownedTerminalIds`', async () => {
  const w = world(); w.make([S('s1')]);
  w.providers = [{ id: 'claude', label: 'Claude Code', available: false }]; let r = w.flows.startRun(w.flow.id); assert.equal(r.status, 409); assert.match(r.error, /Claude Code não está disponível/);
  w.providers = [{ id: 'claude', label: 'Claude Code', available: true }];
  const w2 = world({ deps: { maxSessions: 1 } }); w2.make([S('s1')]); w2.terms.set('term_aaaaaaaa', { id: 'term_aaaaaaaa', status: 'running' });
  r = w2.flows.startRun(w2.flow.id); assert.equal(r.status, 409); assert.match(r.error, /Sem terminais disponíveis/); assert.equal(w2.db.flowRuns.length, 0);
  w.db.workspaces.length = 0; r = w.flows.startRun(w.flow.id); assert.equal(r.status, 409); assert.match(r.error, /espaço de trabalho/);
  const w3 = world(); w3.make([S('s1', { prompt: 'p'.repeat(2000) })]); r = w3.flows.startRun(w3.flow.id); assert.equal(r.status, 400); assert.match(r.error, /Encurte o prompt/); assert.equal(w3.db.flowRuns.length, 0);
  const w4 = world(); await w4.start([S('s1')]); assert.ok(!('ownedTerminalIds' in w4.runView())); assert.deepEqual(w4.db.flowRuns[0].ownedTerminalIds, ['term_' + hex(1)]);
});

test('acesso total: só o flow com `fullAccess === true` pede o terminal sem confirmação; o padrão nunca', async () => {
  const a = world(); await a.start([S('s1')], { fullAccess: true }); assert.equal(a.created[0].fullAccess, true);
  const b = world(); await b.start([S('s1')], { fullAccess: false }); assert.equal(b.created[0].fullAccess, false);
  const c = world(); await c.start([S('s1')]); assert.equal(c.created[0].fullAccess, false);
  const d = world(); d.make([S('s1')]); d.db.flows[0].fullAccess = 'true'; d.flows.startRun(d.flow.id); await d.tick(); assert.equal(d.created[0].fullAccess, false, 'valor corrompido no banco não liga');
  assert.equal(world().flows.create({ workspaceId: 'ws_1', title: 'x', fullAccess: 1, steps: [S('s1')] }).status, 400);
});

test('reinício do servidor: run `running` órfão vira failed com o motivo (nunca retomado); concluídas e outros runs intactos; persistido', async () => {
  const w = world(); await w.start([S('s1'), S('s2', { dependsOn: ['s1'] }), S('s3')], { maxParallel: 2 });
  w.done(w.step('s3').taskId); await w.tick();
  const done = w.flows.create({ workspaceId: 'ws_1', title: 'Outra', steps: [S('s1')] }).body;
  w.db.flowRuns.push({ id: 'run_0000feed', flowId: done.id, status: 'completed', startedAt: 'a', finishedAt: 'b', trigger: 'manual', error: null, steps: [] });
  const before = w.persists;
  const w2 = world({ db: { flows: structuredClone(w.db.flows), flowRuns: structuredClone(w.db.flowRuns) } }); // novo processo: nenhum terminal vivo
  assert.equal(w2.flows.recover(), 1); assert.ok(w2.persists > 0);
  const run = w2.db.flowRuns.find((r) => r.id === w.run.id);
  assert.equal(run.status, 'failed'); assert.match(run.error, /Servidor reiniciado/); assert.ok(run.finishedAt);
  assert.deepEqual(run.steps.map((s) => s.status), ['failed', 'skipped', 'completed'], 'a etapa que terminou continua concluída');
  assert.match(run.steps[0].error, /reiniciado/); assert.match(run.steps[1].error, /reiniciado/);
  assert.equal(w2.db.flowRuns.find((r) => r.id === 'run_0000feed').status, 'completed');
  await w2.tick(); assert.equal(w2.created.length, 0, 'nada é retomado às cegas'); assert.equal(w2.flows.recover(), 0);
  assert.equal(w2.flows.startRun(w.flow.id).status, 201, 'não há mais run ativo: pode iniciar de novo'); assert.ok(before >= 0);
  // falha ao gravar no boot não derruba: a conversão fica em memória
  const w3 = world({ db: { flows: structuredClone(w.db.flows), flowRuns: structuredClone(w.db.flowRuns) } }); w3.failPersist(1); assert.equal(w3.flows.recover(), 1);
  assert.equal(w3.db.flowRuns.find((r) => r.id === w.run.id).status, 'failed');
});

test('leitura tolerante: coleções ausentes viram [] e registros sem id válido são ignorados', () => {
  const db = { settings: {}, workspaces: [], flows: [{ id: 'x' }, null, 5, { id: 'flow_0000abcd', steps: [] }], flowRuns: 'lixo' };
  const f = F.createFlows({ db, terminals: {}, maestro: {}, persist: () => {} });
  assert.deepEqual(db.flows.map((x) => x.id), ['flow_0000abcd']); assert.deepEqual(db.flowRuns, []);
  const db2 = { settings: {}, workspaces: [] }; F.createFlows({ db: db2, terminals: {}, maestro: {}, persist: () => {} }); assert.deepEqual([db2.flows, db2.flowRuns], [[], []]);
  assert.equal(f.list().length, 1);
});

test('rollback de persistência: criar/editar/remover/iniciar/cancelar com o banco falhando não deixam estado parcial', async () => {
  const w = world();
  w.failPersist(1); let r = w.flows.create({ workspaceId: 'ws_1', title: 'x', steps: [S('s1')] }); assert.equal(r.status, 500); assert.match(r.error, /nada foi alterado/); assert.equal(w.db.flows.length, 0);
  w.make([S('s1')]); const snap = structuredClone(w.db.flows);
  w.failPersist(1); r = w.flows.update(w.flow.id, { title: 'Novo' }); assert.equal(r.status, 500); assert.deepEqual(w.db.flows, snap);
  w.failPersist(1); r = w.flows.remove(w.flow.id); assert.equal(r.status, 500); assert.deepEqual(w.db.flows, snap);
  w.failPersist(1); r = w.flows.startRun(w.flow.id); assert.equal(r.status, 500); assert.deepEqual(w.db.flowRuns, []); assert.equal(w.timers.length, 0);
  // inclusive a remoção que leva os runs junto
  w.run = w.flows.startRun(w.flow.id).body; await w.tick(); w.done(w.step('s1').taskId); await w.tick();
  const runs = structuredClone(w.db.flowRuns); w.failPersist(1); assert.equal(w.flows.remove(w.flow.id).status, 500); assert.deepEqual(w.db.flowRuns, runs); assert.equal(w.db.flows.length, 1);
  // cancelar: se não gravou, o run continua ativo e NENHUM terminal é fechado
  const x = world(); await x.start([S('s1')]); x.failPersist(1);
  r = x.flows.cancelRun(x.flow.id, x.run.id); assert.equal(r.status, 500); assert.equal(x.runView().status, 'running'); assert.equal(x.runView().steps[0].status, 'running'); assert.deepEqual(x.closed, []);
  assert.equal(x.flows.cancelRun(x.flow.id, x.run.id).status, 200); assert.equal(x.closed.length, 1);
});

test('rollback no runner: transição que não gravou é desfeita e refeita no tick seguinte, sem terminal duplicado nem etapa presa', async () => {
  const w = world(); w.make([S('s1')]);
  // gravações do startRun: 1 = criação do run, 2 = marcar a etapa como running (feita no 1º passo do runner). A 2ª falha: nada de terminal, etapa continua pending
  w.failPersist(1, 1); w.run = w.flows.startRun(w.flow.id).body; // o 1º passo do runner roda de forma síncrona até o 1º await
  assert.equal(w.created.length, 0); assert.equal(w.step('s1').status, 'pending'); assert.equal(w.step('s1').startedAt, null);
  await w.tick(); assert.equal(w.step('s1').status, 'running'); assert.equal(w.created.length, 1); assert.equal(w.dispatches.length, 1);
  // a conclusão não gravou: volta a running (o estado real é relido) e conclui no tick seguinte
  w.done(w.step('s1').taskId, 'ok'); w.failPersist(1); await w.tick();
  assert.equal(w.step('s1').status, 'running'); assert.equal(w.step('s1').summary, null); assert.equal(w.runView().status, 'running');
  await w.tick(); assert.equal(w.step('s1').status, 'completed'); assert.equal(w.runView().status, 'completed');
  // depois de o terminal existir, uma falha de gravação mantém a realidade em memória (nunca cria um 2º terminal nem entrega duas vezes)
  const x = world(); x.make([S('s1')]); x.failPersist(1, 2); x.run = x.flows.startRun(x.flow.id).body; await x.tick(); await x.tick();
  assert.equal(x.created.length, 1); assert.equal(x.dispatches.length, 1); assert.equal(x.step('s1').terminalId, 'term_' + hex(1)); assert.ok(x.step('s1').taskId);
});

test('limites: 50 missões; 200 runs guardados (os mais antigos JÁ finalizados saem, run ativo nunca)', async () => {
  const w = world();
  for (let i = 0; i < F.MAX_FLOWS; i++) assert.equal(w.flows.create({ workspaceId: 'ws_1', title: `F${i}`, steps: [S('s1')] }).status, 201);
  const r = w.flows.create({ workspaceId: 'ws_1', title: 'extra', steps: [S('s1')] }); assert.equal(r.status, 409); assert.match(r.error, /Limite de 50/);
  assert.equal(w.flows.create({ workspaceId: 'ws_nao_existe', title: 'x', steps: [S('s1')] }).status, 400, 'workspace inexistente');
  const f = w.db.flows[0];
  for (let i = 0; i < F.MAX_RUNS; i++) w.db.flowRuns.push({ id: `run_${hex(0x1000 + i)}`, flowId: f.id, status: 'completed', startedAt: `t${i}`, finishedAt: 't', trigger: 'manual', error: null, steps: [] });
  assert.equal(w.db.flowRuns.length, 200);
  const s = w.flows.startRun(f.id); assert.equal(s.status, 201);
  assert.equal(w.db.flowRuns.length, 200); assert.ok(!w.db.flowRuns.some((x) => x.id === `run_${hex(0x1000)}`), 'o mais antigo saiu'); assert.ok(w.db.flowRuns.some((x) => x.id === s.body.id));
  assert.equal(w.flows.listRuns(f.id).body.length, F.MAX_RUNS_LISTED, 'no máximo 20 runs na listagem'); assert.equal(w.flows.listRuns(f.id).body[0].id, s.body.id);
});

test('erro inesperado no runner marca só aquele run como failed (não derruba os outros nem fica em laço)', async () => {
  const w = world(); w.make([S('s1')]); const a = w.flows.startRun(w.flow.id).body; w.run = a; await w.tick();
  const g = w.flows.create({ workspaceId: 'ws_1', title: 'B', steps: [S('s1')] }).body; const b = w.flows.startRun(g.id).body; await w.tick();
  const aTask = w.runView().steps[0].taskId, orig = w.maestro.taskState; w.maestro.taskState = (id) => { if (id === aTask) throw new Error('bug'); return orig(id); };
  await w.tick();
  const byId = Object.fromEntries(w.db.flowRuns.map((r) => [r.id, r])); assert.equal(byId[a.id].status, 'failed'); assert.match(byId[a.id].error, /Erro interno/); assert.equal(byId[a.id].steps[0].status, 'failed');
  assert.equal(byId[b.id].status, 'running'); w.maestro.taskState = orig;
  const bTask = byId[b.id].steps[0].taskId; w.done(bTask); await w.tick(); assert.equal(w.db.flowRuns.find((r) => r.id === b.id).status, 'completed');
});

test('temporizador injetado: iniciado com o run, dispara o tick e é desligado sozinho ao terminar', async () => {
  const w = world(); w.make([S('s1')]); w.run = w.flows.startRun(w.flow.id).body; await w.tick();
  assert.equal(w.timers.length, 1);
  w.done(w.step('s1').taskId); w.timers[0].fn(); await w.tick();
  assert.equal(w.runView().status, 'completed'); assert.equal(w.timers.length, 0);
  const sem = world({ deps: { pollMs: 0 } }); sem.make([S('s1')]); sem.flows.startRun(sem.flow.id); await sem.tick(); assert.equal(sem.timers.length, 0, 'pollMs 0: sem temporizador (só tick manual)');
});
