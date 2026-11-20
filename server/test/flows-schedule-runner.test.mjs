// Missions v2 (fatia 2): agenda das automações ligada ao gerente de missões (flows.js schedulerPort + createFlowScheduler REAL de flow-schedule.js).
// Terminais e Maestro SIMULADOS, relógio e temporizadores injetados, banco em memória (persist falso) e ORCH_DATA_DIR temporário: nenhum processo, porta, Claude ou Codex real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-sched-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const F = await import('../flows.js');
const { createFlowScheduler, CHECK_MS } = await import('../flow-schedule.js');

const hex = (n) => n.toString(16).padStart(8, '0');
const READY = { state: 'idle', at: '2026-11-10T10:00:00.000Z' };
const T0 = Date.parse('2026-11-10T10:00:00.000Z'), H = 3_600_000, MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const S = { id: 's1', title: 'Etapa', prompt: 'Faça a rotina', provider: 'claude', role: 'builder' };
const fakeApp = { get() {}, post() {}, patch() {}, delete() {} }; // setupFlows só registra rotas: aqui não há HTTP

/** Mundo simulado. `setup: true` monta pelo setupFlows (ligação real do agendador); senão createFlows + createFlowScheduler com a porta (com um gancho para falhar a próxima gravação do estado). */
function world({ db: dbOver = {}, setup = false, scheduler } = {}) {
  const db = { settings: {}, workspaces: [{ id: 'ws_1', name: 'Projeto', path: '/x' }], flows: [], flowRuns: [], ...dbOver };
  const terms = new Map(), created = [], tasks = new Map(), runnerTimers = [], schedTimers = [], cleared = [], errors = [];
  let tn = 0, un = 0, failPersist = 0;
  const w = { db, created, tasks, runnerTimers, schedTimers, cleared, errors, clock: T0, failNextSave: false, persists: 0 };
  w.advance = (ms) => { w.clock += ms; };
  w.failPersist = (n = 1) => { failPersist = n; };
  w.terminals = {
    async create(o) { created.push(o); const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { ...READY } }); return { ok: true, status: 201, session: { id } }; },
    peek: (id) => terms.get(id) ?? null,
    close: (id) => { const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
    count: () => [...terms.values()].filter((t) => t.status === 'running').length,
    providers: () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
  };
  w.maestro = {
    dispatch() { const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); return { ok: true, taskId: id }; },
    taskState: (id) => tasks.get(id) ?? null,
  };
  const persist = () => { w.persists++; if (failPersist > 0) { failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  const schedSet = (fn, ms) => { const t = { fn, ms, unref() {} }; schedTimers.push(t); return t; };
  const schedClear = (t) => { cleared.push(t); const i = schedTimers.indexOf(t); if (i >= 0) schedTimers.splice(i, 1); };
  const deps = {
    db, terminals: w.terminals, maestro: w.maestro, persist, now: () => iso(w.clock), uid: (p) => `${p}_${hex(++un)}`,
    setTimer: (fn) => { const t = { fn, unref() {} }; runnerTimers.push(t); return t; }, clearTimer: (t) => { const i = runnerTimers.indexOf(t); if (i >= 0) runnerTimers.splice(i, 1); }, onError: () => {},
  };
  if (setup) {
    // relógio do agendador: o do gerente (deps.now em ISO), sem `now` próprio; temporizadores falsos
    w.flows = F.setupFlows(fakeApp, { ...deps, scheduler: scheduler ?? { setTimer: schedSet, clearTimer: schedClear, onError: (e) => errors.push(e) } });
    w.sched = w.flows.scheduler;
  } else {
    w.flows = F.createFlows(deps);
    w.port = w.flows.schedulerPort();
    const port = { ...w.port, saveScheduleState: (id, next) => { if (w.failNextSave) { w.failNextSave = false; w.failPersist(1); } return w.port.saveScheduleState(id, next); } };
    w.sched = createFlowScheduler({ flows: port, now: () => w.clock, setTimer: schedSet, clearTimer: schedClear, onError: (e) => errors.push(e) });
  }
  w.raw = (id = w.flow.id) => db.flows.find((f) => f.id === id);
  w.view = (id = w.flow.id) => w.flows.get(id).body;
  w.runsOf = (id = w.flow.id) => db.flowRuns.filter((r) => r.flowId === id);
  w.makeAuto = (schedule = { kind: 'interval', everyHours: 1 }, extra = {}) => {
    const r = w.flows.create({ workspaceId: 'ws_1', title: 'Rotina', goal: '', kind: 'automation', schedule, steps: [S], ...extra });
    assert.equal(r.ok, true, r.error); w.flow = r.body; return r.body;
  };
  return w;
}

test('horário vence: o agendador inicia um run com trigger schedule e scheduledFor; grava lastRunId/lastSlotAt e o próximo horário; nunca dispara duas vezes', async () => {
  const w = world();
  const f = w.makeAuto();
  assert.deepEqual([f.kind, f.schedule, f.autoIntegrate, f.nextRunAt, f.scheduleSkips], ['automation', { enabled: true, kind: 'interval', everyHours: 1 }, true, iso(T0 + H), []]);
  assert.equal('scheduleState' in f, false, 'o estado interno da agenda não sai na API');
  assert.deepEqual(w.raw().scheduleState, { anchorAt: iso(T0), nextRunAt: iso(T0 + H), lastSlotAt: null, lastRunId: null, skips: [] });
  w.sched.start();
  assert.equal(w.schedTimers.length, 1); assert.equal(w.schedTimers[0].ms, CHECK_MS);
  await w.sched.tick(); assert.equal(w.runsOf().length, 0, 'antes do horário nada roda');
  w.advance(H + 5000); await w.sched.tick();
  const runs = w.runsOf(); assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].trigger, runs[0].scheduledFor, runs[0].status], ['schedule', iso(T0 + H), 'running']);
  await w.flows.tick(); assert.equal(w.created.length, 1, 'o run segue pelo runner normal (terminal aberto para a etapa)');
  const st = w.raw().scheduleState;
  assert.deepEqual([st.lastRunId, st.lastSlotAt, st.nextRunAt, st.skips.length], [runs[0].id, iso(T0 + H), iso(T0 + 2 * H), 0]);
  assert.equal(w.view().nextRunAt, iso(T0 + 2 * H));
  await w.sched.tick(); assert.equal(w.runsOf().length, 1, 'mesmo horário não dispara de novo');
  assert.equal(w.port.countActiveScheduled(), 1); assert.equal(w.port.hasActiveRun(f.id), true);
  w.sched.stop(); assert.equal(w.schedTimers.length, 0);
});

test('run ativo no horário = pulo active_run (registrado e visível no GET); run manual não conta no limite de agendados; falha ao iniciar = start_failed', async () => {
  const w = world();
  const f = w.makeAuto();
  const manual = w.flows.startRun(f.id); assert.equal(manual.status, 201);
  assert.equal(w.port.countActiveScheduled(), 0, 'run manual não é de agenda');
  w.advance(H); await w.sched.tick();
  assert.equal(w.runsOf().length, 1, 'nenhum run novo');
  const v = w.view(); assert.equal(v.scheduleSkips.length, 1);
  assert.deepEqual([v.scheduleSkips[0].reason, v.scheduleSkips[0].slotAt, v.nextRunAt], ['active_run', iso(T0 + H), iso(T0 + 2 * H)]);
  assert.match(v.scheduleSkips[0].message, /execução ativa/);
  assert.equal(w.flows.cancelRun(f.id, manual.body.id).status, 200);
  // sem terminais livres: o startRun recusa (409) e o agendador registra o motivo
  w.terminals.count = () => 99;
  w.advance(H); await w.sched.tick();
  assert.equal(w.runsOf().length, 1);
  const sk = w.view().scheduleSkips; assert.deepEqual(sk.map((x) => x.reason), ['start_failed', 'active_run'], 'mais recente primeiro');
  assert.match(sk[0].message, /Sem terminais disponíveis/);
});

test('missão arquivada = pulo archived; workspace removido = workspace_missing; missão excluída sai da agenda e nada dispara', async () => {
  const w = world();
  const f = w.makeAuto();
  assert.equal(w.flows.update(f.id, { archived: true }).status, 200);
  w.advance(H + 1000); await w.sched.tick();
  assert.equal(w.runsOf().length, 0); assert.equal(w.view().scheduleSkips[0].reason, 'archived');
  assert.equal(w.flows.update(f.id, { archived: false }).status, 200);
  const keep = w.db.workspaces; w.db.workspaces = [];
  w.advance(H); await w.sched.tick();
  assert.equal(w.runsOf().length, 0); assert.equal(w.view().scheduleSkips[0].reason, 'workspace_missing');
  w.db.workspaces = keep;
  assert.equal(w.flows.remove(f.id).status, 204);
  assert.deepEqual(w.port.scheduled(), []);
  w.advance(5 * H); await w.sched.tick();
  assert.equal(w.db.flowRuns.length, 0); assert.deepEqual(w.errors, []);
});

test('editar a agenda recalcula nextRunAt a partir de agora; editar outro campo mantém a cadência; com run ativo só schedule/autoIntegrate passam (o resto 409)', async () => {
  const w = world();
  const f = w.makeAuto();
  w.advance(30 * MIN);
  const e1 = w.flows.update(f.id, { schedule: { kind: 'interval', everyHours: 2 } }); assert.equal(e1.status, 200, e1.error);
  assert.equal(e1.body.nextRunAt, iso(T0 + 30 * MIN + 2 * H)); assert.equal(w.raw().scheduleState.anchorAt, iso(T0 + 30 * MIN));
  w.advance(10 * MIN);
  const before = structuredClone(w.raw().scheduleState);
  assert.equal(w.flows.update(f.id, { title: 'Outro nome', schedule: { enabled: true, kind: 'interval', everyHours: 2 } }).status, 200, 'mesmo corpo de agenda (o cliente sempre manda)');
  assert.deepEqual(w.raw().scheduleState, before, 'agenda igual: a âncora do intervalo não muda');
  const off = w.flows.update(f.id, { schedule: { enabled: false, kind: 'interval', everyHours: 2 } }); assert.equal(off.status, 200);
  assert.equal(off.body.nextRunAt, null); assert.equal(w.raw().scheduleState.nextRunAt, null);
  const on = w.flows.update(f.id, { schedule: { kind: 'daily', time: '09:00' } }); assert.equal(on.status, 200);
  assert.ok(Date.parse(on.body.nextRunAt) > w.clock && Date.parse(on.body.nextRunAt) <= w.clock + 24 * H, on.body.nextRunAt);
  // run ativo
  const run = w.flows.startRun(f.id).body;
  const full = { kind: 'automation', title: 'Rotina', goal: '', fullAccess: false, maxParallel: 1, schedule: { kind: 'interval', everyHours: 3 }, autoIntegrate: true, steps: [S] };
  for (const b of [{ title: 'x' }, full, { schedule: null, title: 'x' }, { kind: 'automation', schedule: null }]) assert.equal(w.flows.update(f.id, b).status, 409, JSON.stringify(b).slice(0, 60));
  const r3 = w.flows.update(f.id, { schedule: { kind: 'interval', everyHours: 3 } }); assert.equal(r3.status, 200, r3.error);
  assert.equal(r3.body.nextRunAt, iso(w.clock + 3 * H)); assert.equal(r3.body.activeRun.id, run.id);
  const ai = w.flows.update(f.id, { autoIntegrate: false }); assert.equal(ai.status, 200); assert.equal(ai.body.autoIntegrate, false);
  assert.equal(w.flows.update(f.id, { schedule: { kind: 'interval', everyHours: 0 } }).status, 400, 'validação vale também com run ativo');
  assert.equal(w.flows.cancelRun(f.id, run.id).status, 200);
  // virar projeto: sem schedule: null = 400 e nada muda; com schedule: null = agenda zerada e fora da lista do agendador
  const snap = structuredClone(w.raw());
  const k1 = w.flows.update(f.id, { kind: 'project' }); assert.equal(k1.status, 400); assert.match(k1.error, /schedule: null/);
  assert.deepEqual(w.raw(), snap);
  const k2 = w.flows.update(f.id, { kind: 'project', schedule: null }); assert.equal(k2.status, 200);
  assert.deepEqual([k2.body.kind, k2.body.schedule, k2.body.nextRunAt], ['project', null, null]);
  assert.deepEqual(w.port.scheduled(), []);
  // e voltar a ser automação com agenda
  const k3 = w.flows.update(f.id, { kind: 'automation', schedule: { kind: 'interval', everyHours: 1 } }); assert.equal(k3.status, 200);
  assert.equal(k3.body.nextRunAt, iso(w.clock + H));
});

test('GET: nextRunAt, scheduleSkips (últimos 5, mais recente primeiro, só campos públicos) e autoIntegrate efetivo; missão antiga sem os campos continua válida', () => {
  const skips = Array.from({ length: 7 }, (_, i) => ({ slotAt: iso(T0 - (7 - i) * H), reason: 'missed', message: `m${i}`, at: iso(T0 - (7 - i) * H + MIN), interno: 'x' }));
  skips[6].count = 3;
  const old = { id: 'flow_0000a0a0', workspaceId: 'ws_1', title: 'Antiga', goal: '', kind: 'project', fullAccess: false, maxParallel: 1, steps: [{ ...S, model: null, effort: null, dependsOn: [], continueFrom: null }], createdAt: 't', updatedAt: 't', archived: false };
  const auto = { ...old, id: 'flow_0000b0b0', title: 'Auto', kind: 'automation', schedule: { enabled: true, kind: 'interval', everyHours: 1 }, autoIntegrate: false, scheduleState: { anchorAt: iso(T0), nextRunAt: iso(T0 + H), lastSlotAt: null, lastRunId: 'run_00000001', skips } };
  const w = world({ db: { flows: [old, auto] } });
  const [a, b] = w.flows.list();
  assert.deepEqual([a.autoIntegrate, a.nextRunAt, a.scheduleSkips, 'schedule' in a], [true, null, [], false], 'antiga: autoIntegrate ausente = true');
  assert.deepEqual([b.autoIntegrate, b.nextRunAt], [false, iso(T0 + H)]);
  assert.deepEqual(b.scheduleSkips.map((s) => s.message), ['m6', 'm5', 'm4', 'm3', 'm2']);
  assert.deepEqual(b.scheduleSkips[0], { slotAt: iso(T0 - H), reason: 'missed', message: 'm6', count: 3, at: iso(T0 - H + MIN) });
  assert.ok(!('scheduleState' in b) && !('lastRunId' in b) && !b.scheduleSkips.some((s) => 'interno' in s));
  assert.equal(w.flows.update(old.id, { title: 'Editada' }).status, 200, 'missão antiga edita normalmente');
  assert.equal('scheduleState' in w.raw(old.id), false, 'sem agenda nada é criado');
  // agenda desligada não mostra próximo horário mesmo com estado antigo no banco
  auto.schedule = { ...auto.schedule, enabled: false };
  assert.equal(w.flows.get(auto.id).body.nextRunAt, null);
});

test('boot (setupFlows): horário vencido vira UM pulo missed com count, nada é iniciado; estado velho de projeto é zerado; stop para o agendador e o runner', async () => {
  const sched = { enabled: true, kind: 'interval', everyHours: 1 };
  const base = { workspaceId: 'ws_1', goal: '', fullAccess: false, maxParallel: 1, steps: [{ ...S, model: null, effort: null, dependsOn: [], continueFrom: null }], createdAt: 't', updatedAt: 't', archived: false };
  const flows = () => [
    { ...base, id: 'flow_000000a1', title: 'Auto', kind: 'automation', schedule: sched, scheduleState: { anchorAt: iso(T0 - 5 * H), nextRunAt: iso(T0 - 3 * H), lastSlotAt: null, lastRunId: null, skips: [] } },
    { ...base, id: 'flow_000000a2', title: 'Ex-automação', kind: 'project', schedule: null, scheduleState: { anchorAt: iso(T0 - 5 * H), nextRunAt: iso(T0 - H), lastSlotAt: null, lastRunId: null, skips: [] } },
  ];
  const orphan = { id: 'run_000000a1', flowId: 'flow_000000a1', status: 'running', trigger: 'schedule', scheduledFor: iso(T0 - 4 * H), startedAt: iso(T0 - 4 * H), finishedAt: null, error: null, ownedTerminalIds: [], steps: [{ stepId: 's1', title: 'Etapa', status: 'running', terminalId: 'term_dead', taskId: 'task_dead', startedAt: 't', finishedAt: null, summary: null, error: null }] };
  const w = world({ db: { flows: flows(), flowRuns: [structuredClone(orphan)] }, setup: true });
  w.flow = { id: 'flow_000000a1' };
  // o boot rodou em T0 (relógio do gerente): horários vencidos T0-3h, T0-2h, T0-1h e T0 = 4; o próximo é T0+1h
  assert.equal(w.db.flowRuns.length, 1); assert.equal(w.db.flowRuns[0].status, 'interrupted', 'recover antes do agendador');
  assert.equal(w.created.length, 0, 'nada iniciado no boot');
  const st = w.raw().scheduleState;
  assert.equal(st.skips.length, 1); assert.deepEqual([st.skips[0].reason, st.skips[0].count, st.skips[0].slotAt], ['missed', 4, iso(T0 - 3 * H)]);
  assert.match(st.skips[0].message, /4 horários perdidos enquanto o FORGE estava fechado/);
  assert.deepEqual([st.lastSlotAt, st.nextRunAt, st.lastRunId], [iso(T0), iso(T0 + H), null]);
  assert.equal(w.raw('flow_000000a2').scheduleState.nextRunAt, null, 'projeto com nextRunAt velho foi zerado');
  assert.equal(w.schedTimers.length, 1, 'start() liga o temporizador uma vez');
  assert.equal(w.flows.startRun('flow_000000a1').status, 409, 'o run interrompido continua bloqueando (só o usuário retoma)');
  w.flows.stop();
  assert.equal(w.schedTimers.length, 0); assert.equal(w.cleared.length, 1);
  // sem agendador (testes de rota): nada é tocado no boot e não há temporizador
  const off = world({ db: { flows: flows(), flowRuns: [] }, setup: true, scheduler: false });
  assert.equal(off.flows.scheduler, null); assert.equal(off.schedTimers.length, 0);
  assert.equal(off.raw('flow_000000a1').scheduleState.skips.length, 0); assert.equal(off.raw('flow_000000a1').scheduleState.nextRunAt, iso(T0 - 3 * H));
  off.flows.stop();
});

test('falha de gravação do scheduleState: a memória é desfeita (porta, criar, editar) e o agendador regrava sem iniciar outro run', async () => {
  const w = world();
  const f = w.makeAuto();
  // porta: lança e não deixa estado parcial
  const before = structuredClone(w.raw().scheduleState);
  w.failPersist(1);
  assert.throws(() => w.port.saveScheduleState(f.id, { ...before, nextRunAt: null }), /disco cheio/);
  assert.deepEqual(w.raw().scheduleState, before);
  const legacy = { id: 'flow_0000c0c0', workspaceId: 'ws_1', title: 'X', goal: '', kind: 'project', fullAccess: false, maxParallel: 1, steps: [{ ...S, model: null, effort: null, dependsOn: [], continueFrom: null }], createdAt: 't', updatedAt: 't', archived: false };
  w.db.flows.push(legacy);
  w.failPersist(1); assert.throws(() => w.port.saveScheduleState(legacy.id, before));
  assert.equal('scheduleState' in legacy, false, 'campo que não existia não fica para trás');
  assert.throws(() => w.port.saveScheduleState('flow_ffffffff', before), /não encontrada/);
  // editar a agenda sem gravar: 500 e nada muda
  const snap = structuredClone(w.raw());
  w.failPersist(1);
  const e = w.flows.update(f.id, { schedule: { kind: 'interval', everyHours: 5 } }); assert.equal(e.status, 500); assert.match(e.error, /nada foi alterado/);
  assert.deepEqual(w.raw(), snap);
  // criar automação sem gravar: 500 e nenhuma missão nova
  const n = w.db.flows.length; w.failPersist(1);
  assert.equal(w.flows.create({ workspaceId: 'ws_1', title: 'Y', kind: 'automation', schedule: { kind: 'interval', everyHours: 1 }, steps: [S] }).status, 500);
  assert.equal(w.db.flows.length, n);
  // agendador: o run inicia, mas o estado não grava -> memória desfeita; o próximo tick só regrava (nenhum run a mais)
  w.advance(H + 1000);
  w.failNextSave = true; await w.sched.tick();
  assert.equal(w.runsOf().length, 1); const runId = w.runsOf()[0].id;
  assert.deepEqual([w.raw().scheduleState.lastRunId, w.raw().scheduleState.nextRunAt], [null, iso(T0 + H)], 'falhou ao gravar: a memória não ficou com o estado novo');
  assert.equal(w.errors.length, 1);
  await w.sched.tick();
  assert.equal(w.runsOf().length, 1, 'nenhum disparo duplo');
  assert.deepEqual([w.raw().scheduleState.lastRunId, w.raw().scheduleState.lastSlotAt, w.raw().scheduleState.nextRunAt], [runId, iso(T0 + H), iso(T0 + 2 * H)]);
});
