// Agenda das automações (server/flow-schedule.js): funções puras e agendador com relógio, timers e `flows` falsos. Nenhum tempo real, nenhum servidor, nenhum banco.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Segurança: se algo importar store.js por engano, ele nunca aponta para data/ do usuário.
if (!process.env.ORCH_DATA_DIR) process.env.ORCH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flow-schedule-'));

const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { validateSchedule, nextRunAt, describeSchedule, readScheduleState, freshScheduleState, createFlowScheduler, MAX_SKIPS } = await import('../flow-schedule.js');

const H = 3_600_000, MIN = 60_000;
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime(); // horário LOCAL (mês 1..12)
const iso = (ms) => new Date(ms).toISOString();

// ---------- validateSchedule ----------
test('validateSchedule: null/ausente, formatos válidos e normalização', () => {
  assert.deepEqual(validateSchedule(null, 'automation'), { value: null });
  assert.deepEqual(validateSchedule(undefined, 'project'), { value: null });
  assert.deepEqual(validateSchedule(null, 'project'), { value: null });
  assert.deepEqual(validateSchedule({ kind: 'interval', everyHours: 4 }, 'automation'), { value: { enabled: true, kind: 'interval', everyHours: 4 } });
  assert.deepEqual(validateSchedule({ enabled: false, kind: 'interval', everyHours: 1 }, 'automation'), { value: { enabled: false, kind: 'interval', everyHours: 1 } });
  assert.deepEqual(validateSchedule({ kind: 'interval', everyHours: 168 }, 'automation').value.everyHours, 168);
  assert.deepEqual(validateSchedule({ enabled: true, kind: 'daily', time: '00:00' }, 'automation'), { value: { enabled: true, kind: 'daily', time: '00:00' } });
  assert.equal(validateSchedule({ kind: 'daily', time: '23:59' }, 'automation').value.time, '23:59');
  assert.deepEqual(validateSchedule({ kind: 'weekly', days: [3, 0, 6], time: '08:30' }, 'automation'), { value: { enabled: true, kind: 'weekly', days: [0, 3, 6], time: '08:30' } });
  assert.deepEqual(validateSchedule({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '08:30' }, 'automation').value.days, [0, 1, 2, 3, 4, 5, 6]);
});

test('validateSchedule: recusa limites, formatos, chaves extras e agenda em missão de projeto', () => {
  const bad = (raw, kind = 'automation') => { const r = validateSchedule(raw, kind); assert.ok(r.error, `devia recusar ${JSON.stringify(raw)}`); assert.equal(r.value, undefined); return r.error; };
  assert.match(bad({ kind: 'interval', everyHours: 4 }, 'project'), /automação/);
  assert.ok(validateSchedule({ kind: 'daily', time: '09:00' }, undefined).error); // kind do flow ausente não é automação
  bad([]); bad('a cada 4 h'); bad(4);
  bad({ kind: 'monthly', time: '09:00' }); bad({ everyHours: 4 });
  for (const h of [0, 169, 1.5, '4', -1, null, Infinity]) bad({ kind: 'interval', everyHours: h });
  for (const t of ['9:00', '24:00', '12:60', '12:5', ' 09:00', '09:00 ', 900, null]) bad({ kind: 'daily', time: t });
  bad({ kind: 'daily' });
  bad({ kind: 'weekly', days: [], time: '08:00' });
  bad({ kind: 'weekly', days: [1, 1], time: '08:00' });
  bad({ kind: 'weekly', days: [7], time: '08:00' });
  bad({ kind: 'weekly', days: [-1], time: '08:00' });
  bad({ kind: 'weekly', days: [1.5], time: '08:00' });
  bad({ kind: 'weekly', days: ['1'], time: '08:00' });
  bad({ kind: 'weekly', days: 1, time: '08:00' });
  bad({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6, 0], time: '08:00' });
  bad({ kind: 'weekly', days: [1], time: '25:00' });
  bad({ kind: 'interval', everyHours: 4, enabled: 'sim' });
  assert.match(bad({ kind: 'interval', everyHours: 4, time: '09:00' }), /não permitidas/);
  assert.match(bad({ kind: 'daily', time: '09:00', days: [1] }), /não permitidas/);
  assert.match(bad({ kind: 'weekly', days: [1], time: '09:00', tz: 'UTC' }), /não permitidas/);
});

// ---------- nextRunAt ----------
test('nextRunAt interval: âncora + k*N, estritamente depois de fromMs', () => {
  const s = { enabled: true, kind: 'interval', everyHours: 4 }, A = at(2026, 11, 19, 10, 7);
  assert.equal(nextRunAt(s, A, A), A + 4 * H); // fromMs == âncora: o próximo, não ela
  assert.equal(nextRunAt(s, A + 4 * H, A), A + 8 * H); // exatamente no horário: o seguinte
  assert.equal(nextRunAt(s, A + 4 * H - 1, A), A + 4 * H);
  assert.equal(nextRunAt(s, A + 30 * H, A), A + 32 * H);
  assert.equal(nextRunAt(s, A - 5 * H, A), A - 4 * H); // âncora no futuro: k negativo continua alinhado
  assert.equal(nextRunAt(s, A, undefined), A + 4 * H); // sem âncora = fromMs
  assert.equal(nextRunAt({ ...s, enabled: false }, A, A), null);
  assert.equal(nextRunAt(null, A, A), null);
  assert.equal(nextRunAt({ kind: 'interval', everyHours: 0 }, A, A), null); // inválida
  assert.equal(nextRunAt(s, NaN, A), null);
});

test('nextRunAt daily: mesmo dia, horário exato, virada de dia, de mês e de ano', () => {
  const s = { enabled: true, kind: 'daily', time: '09:00' };
  assert.equal(nextRunAt(s, at(2026, 11, 19, 8, 0)), at(2026, 11, 19, 9, 0));
  assert.equal(nextRunAt(s, at(2026, 11, 19, 9, 0)), at(2026, 11, 20, 9, 0)); // exatamente no horário
  assert.equal(nextRunAt(s, at(2026, 11, 19, 9, 0) - 1), at(2026, 11, 19, 9, 0));
  assert.equal(nextRunAt({ ...s, time: '00:15' }, at(2026, 11, 19, 23, 30)), at(2026, 11, 20, 0, 15));
  assert.equal(nextRunAt(s, at(2026, 11, 30, 10, 0)), at(2026, 12, 1, 9, 0));
  assert.equal(nextRunAt({ ...s, time: '23:59' }, at(2026, 12, 31, 23, 59)), at(2027, 1, 1, 23, 59));
  assert.equal(nextRunAt({ ...s, enabled: false }, at(2026, 11, 19, 8, 0)), null);
});

test('nextRunAt weekly: próximo dia da lista, horário exato e virada de semana', () => {
  assert.equal(new Date(at(2026, 11, 19)).getDay(), 4); // 19/11/2026 é quinta-feira
  const s = { enabled: true, kind: 'weekly', days: [0, 3], time: '08:30' }; // dom, qua
  assert.equal(nextRunAt(s, at(2026, 11, 19, 10, 0)), at(2026, 11, 22, 8, 30)); // qui -> dom
  assert.equal(nextRunAt(s, at(2026, 11, 22, 8, 30)), at(2026, 11, 25, 8, 30)); // exatamente no horário de dom -> qua
  assert.equal(nextRunAt(s, at(2026, 11, 22, 8, 0)), at(2026, 11, 22, 8, 30)); // mesmo dia, antes do horário
  assert.equal(nextRunAt({ ...s, days: [3] }, at(2026, 11, 25, 9, 0)), at(2026, 12, 2, 8, 30)); // qua depois do horário -> qua da semana seguinte
  assert.equal(nextRunAt({ ...s, days: [0], time: '00:00' }, at(2026, 11, 28, 23, 0)), at(2026, 11, 29, 0, 0)); // sáb -> dom (virada de semana)
  assert.equal(nextRunAt({ ...s, days: [4] }, at(2026, 11, 19, 8, 30)), at(2026, 11, 26, 8, 30)); // único dia, exatamente no horário: 7 dias depois
  assert.equal(nextRunAt({ ...s, days: [5] }, at(2026, 12, 31, 12, 0)), at(2027, 1, 1, 8, 30)); // virada de ano (01/01/2027 é sexta)
});

test('describeSchedule e readScheduleState', () => {
  assert.equal(describeSchedule({ enabled: true, kind: 'interval', everyHours: 4 }), 'a cada 4 h');
  assert.equal(describeSchedule({ kind: 'daily', time: '09:00' }), 'diário às 09:00');
  assert.equal(describeSchedule({ kind: 'weekly', days: [3, 0], time: '08:30' }), 'dom, qua às 08:30');
  assert.equal(describeSchedule({ enabled: false, kind: 'daily', time: '09:00' }), 'desligada');
  assert.equal(describeSchedule(null), 'sem agenda');
  assert.deepEqual(readScheduleState(undefined), { anchorAt: null, nextRunAt: null, lastSlotAt: null, lastRunId: null, skips: [] });
  const r = readScheduleState({ anchorAt: 'lixo', nextRunAt: iso(0), skips: [{ reason: 'xyz' }, 3, { slotAt: iso(0), reason: 'limit', message: 'm', at: iso(0) }] });
  assert.equal(r.anchorAt, null); assert.equal(r.nextRunAt, iso(0)); assert.equal(r.skips.length, 1);
  const f = freshScheduleState({ kind: 'interval', everyHours: 2 }, 1000 * H, { lastRunId: 'run_aaaaaaaa', skips: [] });
  assert.deepEqual(f, { anchorAt: iso(1000 * H), nextRunAt: iso(1002 * H), lastSlotAt: null, lastRunId: 'run_aaaaaaaa', skips: [] });
  assert.equal(freshScheduleState(null, 1000 * H).nextRunAt, null);
});

// ---------- agendador ----------
/** `flows` falso: estados gravados em memória (cópia), contadores e falhas programáveis. */
function harness({ flows: list, start = 0, states = {}, opts = {} } = {}) {
  let T = start;
  const st = new Map(Object.entries(states).map(([k, v]) => [k, structuredClone(v)]));
  const fake = {
    active: new Set(), workspaces: new Set(['ws_1']), scheduledActive: 0, failSave: 0, startResult: null, starts: [], saves: 0, errors: [], runN: 0,
    scheduled() { return list.map((flow) => ({ flow, state: st.get(flow.id) })); },
    hasActiveRun(id) { return fake.active.has(id); },
    workspaceExists(ws) { return fake.workspaces.has(ws); },
    countActiveScheduled() { return fake.scheduledActive; },
    startScheduled(id, slot) { fake.starts.push({ id, slot, at: T }); if (fake.startResult) return fake.startResult(id, slot); fake.runN++; return { ok: true, runId: `run_${String(fake.runN).padStart(8, '0')}` }; },
    saveScheduleState(id, next) { if (fake.failSave > 0) { fake.failSave--; throw new Error('disco cheio'); } fake.saves++; st.set(id, structuredClone(next)); },
  };
  const timers = [], cleared = [];
  const sched = createFlowScheduler({
    flows: fake, now: () => T,
    setTimer: (fn, ms) => { const h = { fn, ms, unrefed: false, unref() { h.unrefed = true; } }; timers.push(h); return h; },
    clearTimer: (h) => cleared.push(h),
    onError: (e) => fake.errors.push(e), ...opts,
  });
  return { sched, fake, state: (id) => st.get(id), setState: (id, v) => st.set(id, structuredClone(v)), set: (ms) => { T = ms; }, now: () => T, timers, cleared };
}
const flowI = (id = 'flow_00000001', schedule = { enabled: true, kind: 'interval', everyHours: 1 }, extra = {}) => ({ id, kind: 'automation', schedule, archived: false, workspaceId: 'ws_1', ...extra });
const A = at(2026, 11, 19, 10, 0); // âncora

test('boot com horário vencido: UM pulo missed com count, nada iniciado, próximo calculado de agora', () => {
  const h = harness({ flows: [flowI()], start: A + 3 * H + 30 * MIN, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] } } });
  h.sched.boot();
  const s = h.state('flow_00000001');
  assert.equal(h.fake.starts.length, 0);
  assert.equal(s.skips.length, 1);
  assert.equal(s.skips[0].reason, 'missed'); assert.equal(s.skips[0].count, 3); assert.equal(s.skips[0].slotAt, iso(A + H));
  assert.match(s.skips[0].message, /3 horários perdidos/);
  assert.equal(s.lastSlotAt, iso(A + 3 * H));
  assert.equal(s.nextRunAt, iso(A + 4 * H));
  assert.equal(s.anchorAt, iso(A)); // a cadência é mantida
});

test('boot: horário vencido dentro da tolerância também é pulado (nada roda no boot) e o tick seguinte não o dispara', async () => {
  const h = harness({ flows: [flowI()], start: A + H + 10_000, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] } } });
  h.sched.start(); // start() faz o boot se ainda não foi feito
  assert.equal(h.fake.starts.length, 0);
  assert.equal(h.state('flow_00000001').skips[0].count, 1);
  assert.match(h.state('flow_00000001').skips[0].message, /estava fechado/);
  h.set(A + H + 40_000); await h.sched.tick();
  assert.equal(h.fake.starts.length, 0);
  assert.equal(h.state('flow_00000001').nextRunAt, iso(A + 2 * H));
});

test('boot: sem estado inicializa (âncora = agora); horário futuro não muda; agenda desligada zera nextRunAt', () => {
  const daily = flowI('flow_00000002', { enabled: true, kind: 'daily', time: '09:00' });
  const off = flowI('flow_00000003', { enabled: false, kind: 'interval', everyHours: 2 });
  const fut = { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] };
  const h = harness({ flows: [flowI(), daily, off], start: A + 10 * MIN, states: { flow_00000002: fut, flow_00000003: { ...fut } } });
  h.sched.boot();
  assert.deepEqual(h.state('flow_00000001'), { anchorAt: iso(A + 10 * MIN), nextRunAt: iso(A + 70 * MIN), lastSlotAt: null, lastRunId: null, skips: [] });
  assert.deepEqual(h.state('flow_00000002'), fut);
  assert.equal(h.state('flow_00000003').nextRunAt, null);
  assert.equal(h.fake.starts.length, 0);
});

test('tick dispara no horário: grava lastSlotAt/lastRunId e o próximo; o mesmo horário não dispara de novo', async () => {
  const h = harness({ flows: [flowI()], start: A, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] } } });
  h.sched.boot();
  await h.sched.tick(); assert.equal(h.fake.starts.length, 0); // ainda não venceu
  h.set(A + H + 5000); await h.sched.tick();
  assert.deepEqual(h.fake.starts.map((s) => [s.id, s.slot]), [['flow_00000001', iso(A + H)]]);
  const s = h.state('flow_00000001');
  assert.equal(s.lastSlotAt, iso(A + H)); assert.equal(s.lastRunId, 'run_00000001'); assert.equal(s.nextRunAt, iso(A + 2 * H)); assert.equal(s.skips.length, 0);
  await h.sched.tick(); await h.sched.tick();
  assert.equal(h.fake.starts.length, 1);
  h.set(A + 2 * H); await h.sched.tick(); // exatamente no horário
  assert.equal(h.fake.starts.length, 2); assert.equal(h.state('flow_00000001').lastRunId, 'run_00000002');
});

test('tolerância: até graceMs dispara; depois disso vira missed', async () => {
  const st = { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] };
  const h1 = harness({ flows: [flowI()], start: A + H + 120_000, states: { flow_00000001: st } });
  await h1.sched.tick();
  assert.equal(h1.fake.starts.length, 1);
  const h2 = harness({ flows: [flowI()], start: A + H + 120_001, states: { flow_00000001: st } });
  await h2.sched.tick();
  assert.equal(h2.fake.starts.length, 0);
  const s = h2.state('flow_00000001');
  assert.equal(s.skips[0].reason, 'missed'); assert.equal(s.skips[0].count, 1); assert.match(s.skips[0].message, /não foi verificada a tempo/);
  assert.equal(s.lastSlotAt, iso(A + H)); assert.equal(s.nextRunAt, iso(A + 2 * H));
});

test('pulos: archived, workspace_missing, active_run, limit e start_failed; nada iniciado e o próximo é calculado', async () => {
  const cases = [
    ['archived', (h, f) => { f.archived = true; }],
    ['workspace_missing', (h) => { h.fake.workspaces.clear(); }],
    ['active_run', (h) => { h.fake.active.add('flow_00000001'); }],
    ['limit', (h) => { h.fake.scheduledActive = 3; }],
  ];
  for (const [reason, prep] of cases) {
    const f = flowI();
    const h = harness({ flows: [f], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: 'run_99999999', skips: [] } } });
    prep(h, f);
    await h.sched.tick();
    const s = h.state('flow_00000001');
    assert.equal(h.fake.starts.length, 0, reason);
    assert.equal(s.skips.length, 1, reason); assert.equal(s.skips[0].reason, reason);
    assert.equal(s.skips[0].slotAt, iso(A + H)); assert.equal(s.skips[0].at, iso(A + H)); assert.ok(s.skips[0].message);
    assert.equal(s.nextRunAt, iso(A + 2 * H)); assert.equal(s.lastSlotAt, iso(A + H)); assert.equal(s.lastRunId, 'run_99999999');
  }
  // limite configurável: 2 ativos com máximo 3 ainda dispara
  const ok = harness({ flows: [flowI()], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  ok.fake.scheduledActive = 2; await ok.sched.tick(); assert.equal(ok.fake.starts.length, 1);
  // start_failed com a mensagem do flows
  const h = harness({ flows: [flowI()], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  h.fake.startResult = () => ({ ok: false, error: 'Provedor indisponível.' });
  await h.sched.tick();
  const s = h.state('flow_00000001');
  assert.equal(h.fake.starts.length, 1);
  assert.deepEqual(s.skips.map((k) => [k.reason, k.message]), [['start_failed', 'Provedor indisponível.']]);
  assert.equal(s.lastRunId, null); assert.equal(s.nextRunAt, iso(A + 2 * H));
  await h.sched.tick(); assert.equal(h.fake.starts.length, 1);
  // startScheduled que lança = start_failed genérico, sem vazar o erro interno
  const hx = harness({ flows: [flowI()], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  hx.fake.startResult = () => { throw new Error('ENOENT C:\\segredo'); };
  await hx.sched.tick();
  assert.equal(hx.state('flow_00000001').skips[0].reason, 'start_failed');
  assert.doesNotMatch(hx.state('flow_00000001').skips[0].message, /segredo/);
  assert.equal(hx.fake.errors.length, 1);
});

test('sem disparo duplo quando saveScheduleState falha depois de iniciar o run', async () => {
  const h = harness({ flows: [flowI()], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: null, lastRunId: null, skips: [] } } });
  h.fake.failSave = 1;
  await h.sched.tick();
  assert.equal(h.fake.starts.length, 1);
  assert.equal(h.fake.errors.length, 1);
  assert.equal(h.state('flow_00000001').nextRunAt, iso(A + H)); // não aplicado
  h.fake.active.add('flow_00000001'); // o run iniciado continua ativo: nem por isso vira active_run
  h.set(A + H + 30_000); await h.sched.tick();
  assert.equal(h.fake.starts.length, 1);
  const s = h.state('flow_00000001');
  assert.equal(s.lastRunId, 'run_00000001'); assert.equal(s.lastSlotAt, iso(A + H)); assert.equal(s.nextRunAt, iso(A + 2 * H)); assert.equal(s.skips.length, 0);
  h.set(A + 10 * MIN + H); await h.sched.tick(); assert.equal(h.fake.starts.length, 1);
});

test('gravação de pulo que falha é regravada sem reavaliar (mesmo depois da tolerância)', async () => {
  const h = harness({ flows: [flowI()], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  h.fake.active.add('flow_00000001'); h.fake.failSave = 2;
  await h.sched.tick(); h.set(A + H + 30_000); await h.sched.tick();
  assert.equal(h.state('flow_00000001').nextRunAt, iso(A + H));
  h.fake.active.clear(); h.set(A + H + 200_000); await h.sched.tick();
  const s = h.state('flow_00000001');
  assert.equal(h.fake.starts.length, 0);
  assert.deepEqual(s.skips.map((k) => k.reason), ['active_run']);
  assert.equal(h.fake.errors.length, 2);
});

test('lastSlotAt impede tratar o mesmo horário de novo (estado inconsistente só avança)', async () => {
  const h = harness({ flows: [flowI()], start: A + H + 5000, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: iso(A + H), lastRunId: 'run_00000077', skips: [] } } });
  await h.sched.tick();
  assert.equal(h.fake.starts.length, 0);
  assert.equal(h.state('flow_00000001').nextRunAt, iso(A + 2 * H));
  assert.equal(h.state('flow_00000001').skips.length, 0);
});

test('agenda desligada: nextRunAt null e nada dispara', async () => {
  const f = flowI();
  const h = harness({ flows: [f], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  f.schedule = { ...f.schedule, enabled: false };
  await h.sched.tick();
  assert.equal(h.state('flow_00000001').nextRunAt, null);
  h.set(A + 50 * H); await h.sched.tick();
  assert.equal(h.fake.starts.length, 0);
  assert.equal(h.state('flow_00000001').skips.length, 0);
  // flow de projeto com agenda velha também não dispara
  const p = flowI('flow_00000009', { enabled: true, kind: 'interval', everyHours: 1 }, { kind: 'project' });
  const hp = harness({ flows: [p], start: A + H, states: { flow_00000009: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  await hp.sched.tick();
  assert.equal(hp.fake.starts.length, 0); assert.equal(hp.state('flow_00000009').nextRunAt, null);
});

test('refresh recalcula a partir de agora (âncora = agora) e mantém histórico; desligar zera', async () => {
  const f = flowI(), skips = [{ slotAt: iso(A), reason: 'limit', message: 'x', at: iso(A) }];
  const h = harness({ flows: [f], start: A + 30 * MIN, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), lastSlotAt: iso(A), lastRunId: 'run_00000005', skips } } });
  f.schedule = { enabled: true, kind: 'interval', everyHours: 4 };
  const r = h.sched.refresh('flow_00000001');
  assert.deepEqual(r, { anchorAt: iso(A + 30 * MIN), nextRunAt: iso(A + 4 * H + 30 * MIN), lastSlotAt: iso(A), lastRunId: 'run_00000005', skips });
  assert.deepEqual(h.state('flow_00000001'), r);
  h.set(A + H + 5000); await h.sched.tick(); assert.equal(h.fake.starts.length, 0); // o horário antigo não vale mais
  f.schedule = { enabled: true, kind: 'daily', time: '09:00' };
  assert.equal(h.sched.refresh('flow_00000001').nextRunAt, iso(at(2026, 11, 20, 9, 0)));
  f.schedule = { ...f.schedule, enabled: false };
  assert.equal(h.sched.refresh('flow_00000001').nextRunAt, null);
  assert.equal(h.sched.refresh('flow_ffffffff'), null); // fora de scheduled()
  h.fake.failSave = 1;
  assert.throws(() => h.sched.refresh('flow_00000001'), /disco cheio/);
});

test('refresh durante um início assíncrono mantém o horário novo e registra o run', async () => {
  const f = flowI();
  const h = harness({ flows: [f], start: A + H, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  let release; h.fake.startResult = () => new Promise((res) => { release = () => res({ ok: true, runId: 'run_0000abcd' }); });
  const p = h.sched.tick();
  await Promise.resolve();
  f.schedule = { enabled: true, kind: 'interval', everyHours: 6 };
  h.sched.refresh('flow_00000001');
  release(); await p;
  const s = h.state('flow_00000001');
  assert.equal(s.nextRunAt, iso(A + 7 * H)); assert.equal(s.anchorAt, iso(A + H));
  assert.equal(s.lastRunId, 'run_0000abcd'); assert.equal(s.lastSlotAt, iso(A + H));
});

test('start/stop: timer com checkMs e unref, o callback roda o tick, stop limpa', async () => {
  const h = harness({ flows: [flowI()], start: A, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } }, opts: { checkMs: 5000 } });
  h.sched.start(); h.sched.start();
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 5000); assert.equal(h.timers[0].unrefed, true);
  h.set(A + H); h.timers[0].fn(); await h.sched.tick();
  assert.equal(h.fake.starts.length, 1);
  h.sched.stop(); h.sched.stop();
  assert.deepEqual(h.cleared, [h.timers[0]]);
  h.sched.start(); assert.equal(h.timers.length, 2); // reinicia sem refazer o boot
  h.sched.stop();
});

test('no máximo 20 pulos: os mais antigos saem', async () => {
  const h = harness({ flows: [flowI()], start: A, states: { flow_00000001: { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] } } });
  h.fake.active.add('flow_00000001');
  for (let k = 1; k <= 25; k++) { h.set(A + k * H); await h.sched.tick(); }
  const s = h.state('flow_00000001');
  assert.equal(MAX_SKIPS, 20);
  assert.equal(s.skips.length, 20);
  assert.equal(s.skips[0].slotAt, iso(A + 6 * H)); assert.equal(s.skips[19].slotAt, iso(A + 25 * H));
  assert.equal(h.fake.starts.length, 0);
});

test('falha num flow não impede os outros (onError)', async () => {
  const fa = flowI('flow_0000000a'), fb = flowI('flow_0000000b');
  const st = { anchorAt: iso(A), nextRunAt: iso(A + H), skips: [] };
  const h = harness({ flows: [fa, fb], start: A + H, states: { flow_0000000a: st, flow_0000000b: st } });
  const orig = h.fake.hasActiveRun;
  h.fake.hasActiveRun = (id) => { if (id === 'flow_0000000a') throw new Error('quebrou'); return orig(id); };
  await h.sched.tick();
  assert.deepEqual(h.fake.starts.map((s) => s.id), ['flow_0000000b']);
  assert.equal(h.fake.errors.length, 1); assert.match(h.fake.errors[0].message, /quebrou/);
  // scheduled() que lança: tick não rejeita
  h.fake.scheduled = () => { throw new Error('sem banco'); };
  await h.sched.tick(); assert.equal(h.fake.errors.length, 2);
});

test('weekly no agendador: dispara no dia certo e pula para o próximo dia da lista', async () => {
  const f = flowI('flow_00000004', { enabled: true, kind: 'weekly', days: [0, 3], time: '08:30' });
  const h = harness({ flows: [f], start: at(2026, 11, 19, 10, 0) });
  h.sched.boot();
  assert.equal(h.state('flow_00000004').nextRunAt, iso(at(2026, 11, 22, 8, 30)));
  h.set(at(2026, 11, 22, 8, 31)); await h.sched.tick();
  assert.equal(h.fake.starts.length, 1); assert.equal(h.fake.starts[0].slot, iso(at(2026, 11, 22, 8, 30)));
  assert.equal(h.state('flow_00000004').nextRunAt, iso(at(2026, 11, 25, 8, 30)));
});
