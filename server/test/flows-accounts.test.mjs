// Contas v2, etapa 7 (Missões, lado do servidor): `flow.accounts` (seletor por provider), `run.accounts` (resolvido no início, antes de qualquer efeito), `accountId` no terminal da etapa,
// retomadas com a conta fixada, briefing do planejador, pulo da agenda registrado e o snapshot de consumo da etapa quando o runner fecha o terminal.
// Módulo de contas REAL (accounts.js, só o banco em memória e uma pasta de dados temporária: nenhuma CLI é chamada), terminais e Maestro SIMULADOS, relógio e temporizadores injetados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-accounts-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const F = await import('../flows.js');
const { createAccounts } = await import('../accounts.js');
const { createFlowScheduler } = await import('../flow-schedule.js');
const { LEGACY_SYSTEM_ID } = await import('../account-compat.js'); // a referência antiga à conta virtual (o literal só existe em account-compat.js)
const { default: express } = await import('express');

const hex = (n) => n.toString(16).padStart(8, '0');
const READY = { state: 'idle', at: '2026-11-10T10:00:00.000Z' };
const C1 = 'acc_0000c001', C2 = 'acc_0000c002', X1 = 'acc_0000d001';
const ROWS = { c1: { id: C1, provider: 'claude', label: 'Pessoal', home: 'machine', createdAt: 't' }, c2: { id: C2, provider: 'claude', label: 'Trabalho', home: 'forge', createdAt: 't' }, x1: { id: X1, provider: 'codex', label: 'Codex', home: 'machine', createdAt: 't' } };
let seq = 0;

/** `rows`: linhas de db.accounts; `disconnected`: ids que o resolveFor trata como sabidamente desconectados (o cache real só vem da CLI). */
function world({ rows = [ROWS.c1, ROWS.x1], disconnected = new Set(), noAccounts = false, db: dbOver = {} } = {}) {
  const n = ++seq;
  const db = { settings: {}, workspaces: [{ id: 'ws_1', name: 'Projeto', path: '/x' }], flows: [], flowRuns: [], accounts: structuredClone(rows), ...dbOver };
  const terms = new Map(), created = [], closed = [], dispatches = [], tasks = new Map(), timers = [];
  let tn = 0, un = 0, clock = Date.parse('2026-11-10T10:00:00.000Z'), failPersist = 0;
  const w = { db, terms, created, closed, dispatches, tasks, timers, disconnected, failPersist: (k = 1) => { failPersist = k; }, advance: (ms) => { clock += ms; }, clock: () => clock };
  const persist = () => { if (failPersist > 0) { failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  const dataDir = path.join(tmp, `d${n}`); fs.mkdirSync(dataDir, { recursive: true });
  const real = createAccounts({ db, dataDir, persist, detect: { claude: () => true, codex: () => true } });
  w.accounts = noAccounts ? null : { ...real, resolveFor: (p, id) => (typeof id === 'string' && disconnected.has(id) ? { ok: false, status: 409, error: 'A conta está desconectada: faça o login em Contas.', code: 'account_disconnected' } : real.resolveFor(p, id)) };
  w.terminals = {
    // como o terminals.js real: a conta é resolvida pelo resolveFor (a pedida ou a única), com o status/code dele na recusa; a sessão grava a conta usada
    async create(o) {
      created.push(structuredClone(o));
      let acc = null;
      if (w.accounts) { const r = w.accounts.resolveFor(o.provider ?? 'claude', o.accountId); if (!r.ok) return { ok: false, status: r.status, error: r.error, code: r.code }; acc = r.account.id; }
      const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { ...READY }, role: o.role, workspaceId: o.workspaceId, accountId: acc, usage: null }); return { ok: true, status: 201, session: { id } };
    },
    peek: (id) => { const t = terms.get(id); return t ? { id: t.id, role: t.role, status: t.status, agent: t.status === 'running' ? t.agent : null } : null; },
    get: (id) => { const t = terms.get(id); return t && t.status === 'running' ? { ...t } : null; }, // fechado sai da lista (o consumo some junto, como no real)
    readOutput: () => '', write: () => ({ ok: true }),
    close: (id) => { closed.push(id); const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
    count: () => [...terms.values()].filter((t) => t.status === 'running').length,
    providers: () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
  };
  w.maestro = {
    dispatch(d) { const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); dispatches.push({ ...d, taskId: id }); return { ok: true, taskId: id }; },
    taskState: (id) => tasks.get(id) ?? null,
  };
  w.deps = { db, terminals: w.terminals, maestro: w.maestro, accounts: w.accounts, persist, now: () => new Date(clock).toISOString(), uid: (p) => `${p}_${hex(++un)}`, setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, onError: () => {} };
  w.flows = F.createFlows(w.deps);
  w.make = (steps, extra = {}) => { const r = w.flows.create({ workspaceId: 'ws_1', title: 'Missão', goal: 'Meta', steps, ...extra }); assert.equal(r.ok, true, r.error); w.flow = r.body; return r.body; };
  w.start = async (steps, extra) => { w.make(steps, extra); const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body; await w.flows.tick(); return w.raw(); };
  w.raw = () => db.flowRuns.find((r) => r.id === w.run.id);
  w.rs = (id) => w.raw().steps.find((s) => s.stepId === id);
  w.done = (id, summary = 'feito') => Object.assign(tasks.get(w.rs(id).taskId), { status: 'done', summary });
  return w;
}
const S = (id, over = {}) => ({ id, title: `Etapa ${id}`, prompt: `Faça ${id}`, provider: 'claude', role: 'builder', ...over });

test('validateFlowAccounts: formato fechado (provider conhecido -> acc_ de 8 hex); nulo, {} e valores nulos = sem escolha; nada que pareça caminho ou a conta virtual antiga passa', () => {
  for (const v of [undefined, null, {}, { claude: null }]) assert.deepEqual(F.validateFlowAccounts(v), { value: null });
  assert.deepEqual(F.validateFlowAccounts({ claude: C1, codex: X1 }), { value: { claude: C1, codex: X1 } });
  for (const bad of ['x', 1, [], [C1], true]) assert.match(F.validateFlowAccounts(bad).error, /accounts deve ser um objeto/);
  assert.match(F.validateFlowAccounts({ xpto: C1 }).error, /provedor desconhecido/);
  assert.match(F.validateFlowAccounts({ __proto__: null, cursor: C1 }).error, /Cursor CLI não usa contas do FORGE/, 'IA real sem bloco de contas');
  assert.match(F.validateFlowAccounts({ gemini: C1 }).error, /Gemini CLI não usa contas do FORGE/);
  for (const id of [LEGACY_SYSTEM_ID, 'acc_0000C001', 'acc_123', '../acc_0000c001', 'acc_0000c001/../x', 42, {}, '']) assert.match(F.validateFlowAccounts({ claude: id }).error, /accounts\.claude deve ser o identificador/, String(id));
});

test('validateFlowInput: conta só para provider usado pelas etapas (400); editar as etapas poda a escolha de provider que saiu; accounts fica fora dos campos editáveis com run ativo', () => {
  const steps = [S('s1')];
  assert.match(F.validateFlowInput({ workspaceId: 'ws_1', title: 'T', steps, accounts: { codex: X1 } }, { create: true }).error, /nenhuma etapa usa codex/);
  assert.deepEqual(F.validateFlowInput({ workspaceId: 'ws_1', title: 'T', steps, accounts: { claude: C1 } }, { create: true }).value.accounts, { claude: C1 });
  assert.equal(F.validateFlowInput({ workspaceId: 'ws_1', title: 'T', steps }, { create: true }).value.accounts, null, 'ausente = regra do resolveFor');
  const current = { kind: 'project', steps: [S('s1'), S('s2', { provider: 'codex', role: 'reviewer' })], accounts: { claude: C1, codex: X1 } };
  assert.deepEqual(F.validateFlowInput({ steps: [S('s1')] }, { create: false, current }).value.accounts, { claude: C1 }, 'o Codex saiu das etapas: a escolha dele sai junto');
  assert.equal(F.validateFlowInput({ steps: [S('s1', { provider: 'codex', role: 'reviewer' })] }, { create: false, current: { ...current, accounts: { claude: C1 } } }).value.accounts, null);
  assert.equal(F.validateFlowInput({ title: 'Outro' }, { create: false, current }).value.accounts, undefined, 'sem mexer nas etapas, a escolha fica');
  assert.match(F.validateFlowInput({ accounts: { xpto: C1 } }, { create: false, current }).error, /provedor desconhecido/);
  assert.ok(!F.RUN_SAFE_PATCH_KEYS.includes('accounts')); assert.equal(F.runSafePatch({ accounts: { claude: C1 } }), false); assert.equal(F.runSafePatch({ schedule: null, accounts: null }), false);
});

test('create/update: conta inexistente (404 vira 400 account_not_found) ou de outro provider (400 account_provider_mismatch); válida aparece na visão; com run ativo mudar a conta é 409', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2, ROWS.x1] });
  const bad = w.flows.create({ workspaceId: 'ws_1', title: 'T', steps: [S('s1')], accounts: { claude: 'acc_0000ffff' } });
  assert.deepEqual([bad.status, bad.code, bad.extra?.provider], [400, 'account_not_found', 'claude']); assert.equal(w.db.flows.length, 0);
  const mis = w.flows.create({ workspaceId: 'ws_1', title: 'T', steps: [S('s1')], accounts: { claude: X1 } });
  assert.deepEqual([mis.status, mis.code], [400, 'account_provider_mismatch']); assert.equal(w.db.flows.length, 0);
  const f = w.make([S('s1'), S('s2', { provider: 'codex', role: 'reviewer' })], { accounts: { claude: C2 } });
  assert.deepEqual(f.accounts, { claude: C2 }); assert.deepEqual(w.flows.get(f.id).body.accounts, { claude: C2 });
  const up = w.flows.update(f.id, { accounts: { claude: C1, codex: X1 } }); assert.equal(up.status, 200, up.error); assert.deepEqual(up.body.accounts, { claude: C1, codex: X1 });
  assert.equal(w.flows.update(f.id, { accounts: { codex: C1 } }).code, 'account_provider_mismatch');
  w.failPersist(1); const pf = w.flows.update(f.id, { accounts: null }); assert.equal(pf.status, 500); assert.deepEqual(w.flows.get(f.id).body.accounts, { claude: C1, codex: X1 }, 'sem gravar, nada muda');
  const r = w.flows.startRun(f.id); assert.equal(r.status, 201, r.error);
  const busy = w.flows.update(f.id, { accounts: { claude: C2 } }); assert.equal(busy.status, 409, 'a conta de um run em andamento não muda');
  assert.deepEqual(w.flows.get(f.id).body.accounts, { claude: C1, codex: X1 });
  // banco editado à mão: formato inválido vale como "sem escolha"
  w.db.flows[0].accounts = { claude: '../../etc' }; assert.equal(w.flows.get(f.id).body.accounts, null);
});

test('startRun: resolve a conta de CADA provider antes de qualquer efeito e grava run.accounts; o terminal da etapa recebe o accountId fixado', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2, ROWS.x1] });
  await w.start([S('s1'), S('s2', { provider: 'codex', role: 'reviewer', dependsOn: ['s1'] })], { accounts: { claude: C2 } });
  assert.deepEqual(w.raw().accounts, { claude: C2, codex: X1 }, 'Claude: a escolhida; Codex: a única do provider');
  assert.deepEqual(w.flows.getRun(w.flow.id, w.run.id).body.accounts, { claude: C2, codex: X1 }, 'run.accounts sai na visão');
  assert.equal(w.created[0].accountId, C2); assert.equal(w.terms.get(w.rs('s1').terminalId).accountId, C2);
  w.done('s1'); await w.flows.tick();
  assert.equal(w.created[1].provider, 'codex'); assert.equal(w.created[1].accountId, X1, 'a conta resolvida no início, não a regra de agora');
});

test('startRun recusado por conta: 409 com code e provider, nenhum run, nenhum terminal e nada gravado (account_required, no_account, account_not_found, account_disconnected)', async () => {
  const two = world({ rows: [ROWS.c1, ROWS.c2] });
  two.make([S('s1')]);
  const r1 = two.flows.startRun(two.flow.id);
  assert.deepEqual([r1.status, r1.code, r1.extra?.provider], [409, 'account_required', 'claude']); assert.match(r1.error, /^Há mais de uma conta do Claude Code: .*Escolha a conta deste provedor na missão/); // o provedor aparece UMA vez (o texto do resolveFor já o cita)
  assert.equal(two.db.flowRuns.length, 0); assert.equal(two.created.length, 0);

  const none = world({ rows: [ROWS.c1] }); none.make([S('s1'), S('s2', { provider: 'codex', role: 'reviewer' })]);
  const r2 = none.flows.startRun(none.flow.id); assert.deepEqual([r2.status, r2.code, r2.extra?.provider], [409, 'no_account', 'codex']); assert.match(r2.error, /Nenhuma conta do Codex/); assert.equal(none.db.flowRuns.length, 0);

  const gone = world({ rows: [ROWS.c1, ROWS.c2] }); gone.make([S('s1')], { accounts: { claude: C2 } });
  gone.db.accounts = gone.db.accounts.filter((a) => a.id !== C2); // desvinculada depois de escolhida
  const r3 = gone.flows.startRun(gone.flow.id); assert.deepEqual([r3.status, r3.code], [409, 'account_not_found'], 'o pedido é válido: o que mudou foi o estado'); assert.match(r3.error, /não existe mais/);

  const off = world({ rows: [ROWS.c1], disconnected: new Set([C1]) }); off.make([S('s1')], { accounts: { claude: C1 } });
  const r4 = off.flows.startRun(off.flow.id); assert.deepEqual([r4.status, r4.code], [409, 'account_disconnected']); assert.equal(off.db.flowRuns.length, 0);
  // a CLI ausente vem antes da conta (sem a CLI não há conta do computador adotada)
  none.terminals.providers = () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: false }];
  assert.match(none.flows.startRun(none.flow.id).error, /Codex CLI não está disponível/);
});

test('startRun: falha de gravação desfaz tudo (sem run e sem conta fixada em lugar nenhum); sem módulo de contas o terminal nasce sem accountId (regra do terminals.js)', async () => {
  const w = world(); w.make([S('s1')]);
  w.failPersist(1); const r = w.flows.startRun(w.flow.id); assert.equal(r.status, 500); assert.equal(w.db.flowRuns.length, 0);
  const legacy = world({ noAccounts: true });
  await legacy.start([S('s1')]);
  assert.equal(legacy.raw().accounts, null); assert.ok(!('accountId' in legacy.created[0]), 'createArgs igual ao de antes');
});

test('retomada: usa a conta FIXADA no run; conta removida ou desconectada = 409 com code e o run continua interrompido; run antigo sem accounts resolve e fixa ao retomar', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2] });
  await w.start([S('s1'), S('s2', { dependsOn: ['s1'] })], { accounts: { claude: C2 } });
  assert.equal(w.flows.recover(), 1); assert.equal(w.raw().status, 'interrupted');
  // a missão não muda com o run ativo; a conta fixada é a referência
  const keep = w.db.accounts; w.db.accounts = keep.filter((a) => a.id !== C2);
  const r1 = await w.flows.resumeRun(w.flow.id, w.run.id); assert.deepEqual([r1.status, r1.code, r1.extra?.provider], [409, 'account_not_found', 'claude']); assert.equal(w.raw().status, 'interrupted');
  assert.match(r1.error, /cancele-a e inicie de novo/); assert.doesNotMatch(r1.error, /Editar missão/, 'com run ativo a missão não pode ser editada: a dica não pode mandar editar');
  w.db.accounts = keep; w.disconnected.add(C2);
  const r2 = await w.flows.resumeRun(w.flow.id, w.run.id); assert.deepEqual([r2.status, r2.code], [409, 'account_disconnected']); assert.equal(w.raw().status, 'interrupted');
  w.disconnected.delete(C2);
  const n = w.created.length;
  const ok = await w.flows.resumeRun(w.flow.id, w.run.id); assert.equal(ok.status, 200, ok.error); await w.flows.tick();
  assert.equal(w.created.length, n + 1); assert.equal(w.created.at(-1).accountId, C2, 'terminal novo da retomada (sem terminals.resume) com a conta do run');
  w.done('s1'); await w.flows.tick(); assert.equal(w.created.at(-1).accountId, C2, 'a etapa seguinte também');

  const old = world({ rows: [ROWS.c1] });
  await old.start([S('s1')]); delete old.raw().accounts; old.flows.recover(); // run de antes da etapa 7
  const ro = await old.flows.resumeRun(old.flow.id, old.run.id); assert.equal(ro.status, 200, ro.error);
  assert.deepEqual(old.raw().accounts, { claude: C1 }, 'resolvida e fixada na retomada');
  const old2 = world({ rows: [ROWS.c1, ROWS.c2] }); await old2.start([S('s1')], { accounts: { claude: C1 } }); delete old2.raw().accounts; old2.flows.recover();
  old2.db.flows[0].accounts = null; // sem escolha na missão e duas contas
  const ra = await old2.flows.resumeRun(old2.flow.id, old2.run.id); assert.deepEqual([ra.status, ra.code], [409, 'account_required']); assert.equal(old2.raw().status, 'interrupted');
  assert.match(ra.error, /cancele-a e inicie de novo/); assert.doesNotMatch(ra.error, /Editar missão/);
  // no INÍCIO a dica continua mandando escolher na missão, e o nome do provedor não sai repetido
  const st = world({ rows: [ROWS.c1, ROWS.c2] }); st.make([S('s1')]); const rs0 = st.flows.startRun(st.flow.id);
  assert.deepEqual([rs0.status, rs0.code], [409, 'account_required']); assert.match(rs0.error, /Editar missão/); assert.doesNotMatch(rs0.error, /^Claude Code: .*Claude Code/, 'sem "Claude Code: Há mais de uma conta do Claude Code"');
});

test('decisão continue com o terminal encerrado: confere a conta fixada antes de mudar a etapa (desconectada = 409 e a etapa segue esperando)', async () => {
  const w = world();
  await w.start([S('s1')]);
  Object.assign(w.tasks.get(w.rs('s1').taskId), { status: 'done', auto: true, summary: 'parou' }); await w.flows.tick();
  assert.equal(w.rs('s1').unconfirmed, true);
  w.terms.get(w.rs('s1').terminalId).status = 'exited'; await w.flows.tick();
  w.disconnected.add(C1);
  const r = w.flows.decideStep(w.flow.id, w.run.id, 's1', { decision: 'continue' }); assert.deepEqual([r.status, r.code], [409, 'account_disconnected']);
  assert.deepEqual([w.rs('s1').status, w.rs('s1').unconfirmed], ['waiting', true]);
  w.disconnected.delete(C1);
  const ok = w.flows.decideStep(w.flow.id, w.run.id, 's1', { decision: 'continue' }); assert.equal(ok.status, 200, ok.error);
  await w.flows.tick(); assert.equal(w.created.at(-1).accountId, C1);
});

test('planejador: propose_mission com accounts é recusado (nunca escolhe conta); briefing repassa a conta escolhida pelo usuário e devolve a recusa de conta com code e provider', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2, ROWS.x1] });
  const bad = await w.flows.openBriefing({ workspaceId: 'ws_1', accountId: LEGACY_SYSTEM_ID }); assert.deepEqual([bad.status, bad.code], [400, 'account_not_found']);
  assert.equal((await w.flows.openBriefing({ workspaceId: 'ws_1', accountId: '../x' })).status, 400);
  assert.equal(w.created.length, 0);
  const two = await w.flows.openBriefing({ workspaceId: 'ws_1' });
  assert.deepEqual([two.status, two.code, two.extra?.provider], [409, 'account_required', 'claude']); assert.match(two.error, /mais de uma conta/);
  const ok = await w.flows.openBriefing({ workspaceId: 'ws_1', accountId: C2 }); assert.equal(ok.status, 201, ok.error);
  assert.equal(w.created.at(-1).accountId, C2); assert.equal(w.created.at(-1).role, 'planner');
  const mis = await w.flows.openBriefing({ workspaceId: 'ws_1', provider: 'codex', accountId: C1 }); assert.deepEqual([mis.status, mis.code], [400, 'account_provider_mismatch']);
  const cx = await w.flows.openBriefing({ workspaceId: 'ws_1', provider: 'codex' }); assert.equal(cx.status, 201, 'Codex: a única conta dele'); assert.equal(w.created.at(-1).accountId, undefined);
  const caller = { terminalId: ok.body.terminalId, role: 'planner' };
  const mission = { title: 'Proposta', steps: [S('s1')] };
  const p = w.flows.plannerPort().propose(caller, { ...mission, accounts: { claude: C1 } });
  assert.equal(p.ok, false); assert.match(p.error, /Propriedades não permitidas: accounts.*as contas só o usuário define/);
  const good = w.flows.plannerPort().propose(caller, mission); assert.equal(good.ok, true, good.error);
  assert.equal(w.flows.listProposals()[0].flow.accounts, null, 'a proposta nunca traz conta');
  assert.match(w.flows.plannerPort().options(caller).options.notes.join(' '), /Não envie accounts/);
});

test('agenda: startRun recusado por conta vira pulo `start_failed` REGISTRADO com a mensagem (provider e o que fazer); nada é iniciado', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2] });
  const T0 = w.clock();
  const f = w.make([S('s1')], { kind: 'automation', schedule: { enabled: true, kind: 'interval', everyHours: 1 } });
  const port = w.flows.schedulerPort();
  const sched = createFlowScheduler({ flows: port, now: () => w.clock(), setTimer: () => ({ unref() {} }), clearTimer: () => {}, onError: () => {} });
  w.advance(3_600_000 + 1000); await sched.tick();
  const st = w.db.flows.find((x) => x.id === f.id).scheduleState;
  assert.equal(w.db.flowRuns.length, 0); assert.equal(w.created.length, 0);
  const skip = st.skips.at(-1); assert.equal(skip.reason, 'start_failed'); assert.match(skip.message, /Há mais de uma conta do Claude Code.*Editar missão/);
  assert.equal(skip.slotAt, new Date(T0 + 3_600_000).toISOString());
  assert.match(w.flows.get(f.id).body.scheduleSkips[0].message, /mais de uma conta/, 'o pulo aparece na visão da missão');
  const direct = port.startScheduled(f.id, new Date(w.clock()).toISOString()); assert.deepEqual([direct.ok, direct.code], [false, 'account_required']);
});

test('consumo da etapa: gravado na conclusão e ANTES de fechar no cancelamento (o número não some com o terminal); snapshot pequeno e validado, sem caminho nem id de sessão', async () => {
  const w = world();
  await w.start([S('s1'), S('s2', { dependsOn: ['s1'] })]);
  const t1 = w.rs('s1').terminalId;
  w.terms.get(t1).usage = { input: 1200, output: 340.4, cacheWrite: 50, cacheRead: 9000, total: 10590, io: 1540, turns: 4, model: 'claude-sonnet-4-5', costUsd: 0.0123456789, claudeSessionId: '11111111-2222-3333-4444-555555555555', file: '/home/u/.claude/projects/x.jsonl' };
  assert.equal(w.rs('s1').usage, undefined, 'em andamento: o cliente lê o terminal vivo');
  w.done('s1'); await w.flows.tick();
  const u1 = w.rs('s1').usage;
  assert.deepEqual(u1, { input: 1200, output: 340, cacheWrite: 50, cacheRead: 9000, total: 10590, io: 1540, turns: 4, model: 'claude-sonnet-4-5', costUsd: 0.012346, accountId: C1, terminalId: t1, at: u1.at });
  assert.ok(!JSON.stringify(w.raw()).includes('11111111-2222') && !JSON.stringify(w.raw()).includes('.jsonl'), 'nada do id da sessão nem do caminho da transcrição');
  const t2 = w.rs('s2').terminalId;
  w.terms.get(t2).usage = { input: 10, output: 5, cacheWrite: 0, cacheRead: 0, total: 15, io: 15, turns: 1, model: '../../etc/passwd x', costUsd: -1 };
  w.terms.get(t1).usage = { ...w.terms.get(t1).usage, input: 1300, io: 1640, total: 10690 };
  const c = w.flows.cancelRun(w.flow.id, w.run.id); assert.equal(c.status, 200);
  assert.deepEqual(w.closed.sort(), [t1, t2].sort(), 'cancelar fecha os terminais do run');
  assert.equal(w.rs('s1').usage.io, 1640, 'o último número antes de fechar');
  const u2 = w.rs('s2').usage; assert.equal(u2.io, 15); assert.equal(u2.model, null, 'modelo fora do formato não passa'); assert.equal(u2.costUsd, null, 'custo inválido = desconhecido');
  assert.equal(c.body.steps.find((s) => s.stepId === 's2').usage.io, 15, 'sai na visão do run');
});

test('consumo da etapa: sem leitura (provider sem transcrição, terminal já fechado, valor inválido) nada é gravado e o snapshot anterior nunca é apagado; cancelamento sem gravar desfaz o snapshot', async () => {
  const w = world();
  await w.start([S('s1', { provider: 'codex', role: 'reviewer' })]);
  w.done('s1'); await w.flows.tick();
  assert.equal(w.rs('s1').status, 'completed'); assert.equal(w.rs('s1').usage, undefined, 'Codex sem consumo legível: nada inventado');
  const w2 = world();
  await w2.start([S('s1')]);
  const t = w2.rs('s1').terminalId;
  w2.terms.get(t).usage = { input: 5, output: 5, io: 10 };
  w2.failPersist(1); assert.equal(w2.flows.cancelRun(w2.flow.id, w2.run.id).status, 500);
  assert.equal(w2.rs('s1').usage, undefined, 'rollback: o snapshot sai junto'); assert.equal(w2.raw().status, 'running'); assert.equal(w2.closed.length, 0);
  w2.terms.get(t).usage = { input: 'muito', output: 5 };
  assert.equal(w2.flows.cancelRun(w2.flow.id, w2.run.id).status, 200); assert.equal(w2.rs('s1').usage, undefined, 'número inválido não vira snapshot');
  // o usuário fechou o terminal da etapa concluída: o fim do run (que regrava o consumo de todas) não apaga o snapshot dela
  const w3 = world();
  await w3.start([S('s1'), S('s2', { dependsOn: ['s1'] })]);
  const a = w3.rs('s1').terminalId; w3.terms.get(a).usage = { input: 40, output: 2, cacheWrite: 0, cacheRead: 0, total: 42, io: 42, turns: 1, model: null, costUsd: null };
  w3.done('s1'); await w3.flows.tick(); assert.equal(w3.rs('s1').usage.io, 42);
  w3.terms.get(a).status = 'exited';
  w3.done('s2'); await w3.flows.tick();
  assert.equal(w3.raw().status, 'completed'); assert.equal(w3.rs('s1').usage.io, 42, 'o snapshot anterior fica');
});

test('consumo da etapa: etapa reaberta com OUTRO terminal não troca o número gravado por um total menor; leitura sem turnos (transcrição vazia) nunca sobrescreve', async () => {
  const w = world();
  await w.start([S('s1'), S('s2', { dependsOn: ['s1'] })]);
  const a = w.rs('s1').terminalId; w.terms.get(a).usage = { input: 40, output: 2, cacheWrite: 0, cacheRead: 0, total: 42, io: 42, turns: 3, model: null, costUsd: null };
  w.done('s1'); await w.flows.tick(); assert.deepEqual([w.rs('s1').usage.io, w.rs('s1').usage.terminalId], [42, a]);
  // a etapa passa a apontar para um terminal NOVO (sessão nova) com consumo parcial menor: o snapshot do anterior fica
  const b = 'term_0000beef'; w.terms.set(b, { id: b, status: 'running', agent: { ...READY }, role: 'builder', workspaceId: 'ws_1', accountId: C1, usage: { input: 5, output: 1, total: 6, io: 6, turns: 1 } });
  w.rs('s1').terminalId = b;
  // o mesmo terminal de antes com a transcrição zerada (turns 0) também não sobrescreve a etapa 2 depois de um número bom
  const c = w.rs('s2').terminalId; w.terms.get(c).usage = { input: 9, output: 1, total: 10, io: 10, turns: 1 };
  assert.equal(w.flows.cancelRun(w.flow.id, w.run.id).status, 200);
  assert.deepEqual([w.rs('s1').usage.io, w.rs('s1').usage.terminalId], [42, a], 'total menor de outro terminal não apaga o consumo anterior');
  assert.equal(w.rs('s2').usage.io, 10);
  // agora o caso sem turnos, isolado: número bom gravado e depois leitura vazia do MESMO terminal
  const z = world(); await z.start([S('s1'), S('s2', { dependsOn: ['s1'] })]); const t = z.rs('s1').terminalId;
  z.terms.get(t).usage = { input: 7, output: 3, total: 10, io: 10, turns: 2 }; z.done('s1'); await z.flows.tick(); assert.equal(z.rs('s1').usage.io, 10);
  z.terms.get(t).usage = { input: 0, output: 0, total: 0, io: 0, turns: 0 }; // o terminal da etapa 1 segue aberto, agora com leitura vazia
  z.done('s2'); await z.flows.tick(); assert.equal(z.raw().status, 'completed', 'o fim do run regrava o consumo de todas as etapas');
  assert.equal(z.rs('s1').usage.io, 10, 'leitura vazia não troca o número bom');
});

test('rotas: POST /api/flows/:id/runs com recusa de conta responde { error, code, provider }; POST /api/flows aceita accounts e valida', async () => {
  const w = world({ rows: [ROWS.c1, ROWS.c2] });
  const app = express(); app.use(express.json());
  const fl = F.setupFlows(app, { ...w.deps, scheduler: false, pollMs: 0 });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (url, method, body) => { const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); return { status: r.status, j: text ? JSON.parse(text) : null }; };
  try {
    const bad = await call('/api/flows', 'POST', { workspaceId: 'ws_1', title: 'T', steps: [S('s1')], accounts: { claude: LEGACY_SYSTEM_ID } });
    assert.equal(bad.status, 400); assert.match(bad.j.error, /accounts\.claude/);
    const nf = await call('/api/flows', 'POST', { workspaceId: 'ws_1', title: 'T', steps: [S('s1')], accounts: { claude: 'acc_0000ffff' } });
    assert.deepEqual([nf.status, nf.j.code, nf.j.provider], [400, 'account_not_found', 'claude']);
    const made = await call('/api/flows', 'POST', { workspaceId: 'ws_1', title: 'T', steps: [S('s1')] }); assert.equal(made.status, 201); assert.equal(made.j.accounts, null);
    const r = await call(`/api/flows/${made.j.id}/runs`, 'POST');
    assert.equal(r.status, 409); assert.deepEqual([r.j.code, r.j.provider], ['account_required', 'claude']); assert.match(r.j.error, /mais de uma conta/);
    const p = await call(`/api/flows/${made.j.id}`, 'PATCH', { accounts: { claude: C1 } }); assert.equal(p.status, 200); assert.deepEqual(p.j.accounts, { claude: C1 });
    const ok = await call(`/api/flows/${made.j.id}/runs`, 'POST'); assert.equal(ok.status, 201); assert.deepEqual(ok.j.accounts, { claude: C1 });
  } finally { fl.stop(); await new Promise((r) => server.close(r)); }
});
