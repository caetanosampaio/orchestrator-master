// Níveis de modelo/esforço (tiers.js): tabela protegida, overrides de ambiente, resolveRoute, routeArgs e a chegada de task.route à CLI (execution.js).
// Puro, exceto o último teste (Express/CLI falsa, banco e workspace TEMPORÁRIOS; o servidor real nunca é tocado).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-tiers-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const wsDir = path.join(tmp, 'workspace'); fs.mkdirSync(wsDir); execFileSync('git', ['init', '-q'], { cwd: wsDir });
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-cli.mjs');

const T = await import('../tiers.js');
const { ROLES, DEFAULT_ROLE, TIER_NAMES, DEFAULT_TIER, TIERS, isRole, isTier, tiersFromEnv, resolveRoute, routeArgs } = T;
const { plannerArgs, PLANNER_EFFORTS } = await import('../planner.js');

after(async () => { await new Promise((r) => setTimeout(r, 300)); fs.rmSync(tmp, { recursive: true, force: true }); });

test('tabela: enums, valores do contrato e congelamento profundo', () => {
  assert.deepEqual([...ROLES], ['implementacao', 'testes', 'revisao', 'docs', 'analise']); assert.equal(DEFAULT_ROLE, 'implementacao');
  assert.deepEqual([...TIER_NAMES], ['leve', 'padrao', 'profunda']); assert.equal(DEFAULT_TIER, 'padrao');
  assert.deepEqual(TIERS, { leve: { model: 'claude-haiku-5-5', effort: 'low' }, padrao: { model: 'claude-sonnet-5-5', effort: 'medium' }, profunda: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.ok(Object.isFrozen(TIERS) && Object.isFrozen(ROLES) && Object.isFrozen(TIER_NAMES));
  for (const n of TIER_NAMES) assert.ok(Object.isFrozen(TIERS[n]), n);
  assert.throws(() => { TIERS.padrao.model = 'x'; }, TypeError); assert.throws(() => { TIERS.extra = {}; }, TypeError); assert.throws(() => { ROLES.push('x'); }, TypeError);
  assert.equal(TIERS.padrao.model, 'claude-sonnet-5-5');
});

test('isRole / isTier: só as strings exatas dos enums', () => {
  for (const r of ROLES) assert.equal(isRole(r), true, r);
  for (const t of TIER_NAMES) assert.equal(isTier(t), true, t);
  for (const x of ['Leve', 'LEVE', ' leve', 'leve ', 'fast', '', '__proto__', 'constructor', 'toString', null, undefined, 0, 1, true, {}, ['leve'], 'padrão']) { assert.equal(isTier(x), false, String(x)); assert.equal(isRole(x), false, String(x)); }
  assert.equal(isRole('Docs'), false); assert.equal(isRole('implementação'), false);
});

test('tiersFromEnv: sem variáveis = a tabela padrão; overrides válidos entram; vazio é ignorado', () => {
  assert.deepEqual(tiersFromEnv({}), TIERS); assert.deepEqual(tiersFromEnv({ ORCH_TIER_LEVE: '', ORCH_TIER_PADRAO: '   ' }), TIERS);
  const t = tiersFromEnv({ ORCH_TIER_LEVE: 'meu-modelo.1:max', ORCH_TIER_PROFUNDA: ' claude-x[1m]:xhigh ' });
  assert.deepEqual(t.leve, { model: 'meu-modelo.1', effort: 'max' }); assert.deepEqual(t.profunda, { model: 'claude-x[1m]', effort: 'xhigh' }); assert.deepEqual(t.padrao, TIERS.padrao);
  assert.ok(Object.isFrozen(t) && Object.isFrozen(t.leve));
  assert.deepEqual(tiersFromEnv({ ORCH_TIER_PADRAO: 'a:b:high' }).padrao, { model: 'a:b', effort: 'high' }, 'o esforço é o que vem depois do ÚLTIMO ":"');
  assert.deepEqual(tiersFromEnv(), tiersFromEnv(process.env), 'sem argumento lê process.env');
});

test('tiersFromEnv: valor inválido lança Error em português com o nome da variável (o servidor não sobe)', () => {
  const bad = { ORCH_TIER_LEVE: ['semesforco', 'm:', ':low', 'm:ultra', 'm:LOW', '-m:low', '.m:low', 'm m:low', 'm;rm:low', 'm\n:low', `${'a'.repeat(65)}:low`, '--model:low', 'm:low:', 'm:low high'] };
  for (const v of bad.ORCH_TIER_LEVE) assert.throws(() => tiersFromEnv({ ORCH_TIER_LEVE: v }), /ORCH_TIER_LEVE inválido/, JSON.stringify(v));
  assert.throws(() => tiersFromEnv({ ORCH_TIER_PADRAO: 'x' }), /ORCH_TIER_PADRAO inválido/); assert.throws(() => tiersFromEnv({ ORCH_TIER_PROFUNDA: 'x:nada' }), /ORCH_TIER_PROFUNDA inválido/);
  assert.doesNotThrow(() => tiersFromEnv({ ORCH_TIER_LEVE: `${'a'.repeat(64)}:low` }));
});

test('as regras de modelo/esforço de tiers.js coincidem com as de planner.js (exemplos aceitos e recusados iguais)', () => {
  const models = ['claude-haiku-5-5', 'a', 'A.b_c:d[1m]-x', '9x', 'a'.repeat(64), 'a'.repeat(65), '', '-x', '.x', '_x', ':x', '[x', 'a b', 'a/b', 'a;b', 'a$b', 'ação', '--model', 'x\ny'];
  for (const m of models) {
    if (m === '') continue; // vazio: no Planner significa "padrão da CLI"; aqui vira erro de formato (sempre exige modelo)
    const planner = (() => { try { plannerArgs({ model: m }); return true; } catch { return false; } })();
    const tier = (() => { try { tiersFromEnv({ ORCH_TIER_LEVE: `${m}:low` }); return true; } catch { return false; } })();
    assert.equal(tier, planner, `modelo ${JSON.stringify(m)}`);
  }
  assert.deepEqual([...T.TIER_EFFORTS], PLANNER_EFFORTS);
  for (const e of [...PLANNER_EFFORTS, 'ultra', 'LOW', '', 'lo w']) { // (espaço nas pontas do valor inteiro é aparado na leitura do ambiente, por isso não entra aqui)
    const planner = (() => { try { plannerArgs({ effort: e }); return true; } catch { return false; } })();
    const tier = (() => { try { tiersFromEnv({ ORCH_TIER_LEVE: `m:${e}` }); return true; } catch { return false; } })();
    if (e === '') assert.equal(tier, false); else assert.equal(tier, planner, `esforço ${JSON.stringify(e)}`);
  }
});

test('resolveRoute: padrões e origem (planner | default)', () => {
  assert.deepEqual(resolveRoute({}), { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' });
  assert.deepEqual(resolveRoute(), { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' });
  assert.deepEqual(resolveRoute({ tier: 'leve' }), { tier: 'leve', model: 'claude-haiku-5-5', effort: 'low', source: 'planner' });
  assert.deepEqual(resolveRoute({ tier: 'profunda', attempt: 1 }), { tier: 'profunda', model: 'claude-opus-5-5', effort: 'high', source: 'planner' });
  assert.equal(resolveRoute({ tier: 'padrao', attempt: 0 }).source, 'planner'); assert.equal(resolveRoute({ tier: 'leve', attempt: -3 }).tier, 'leve');
});

test('resolveRoute: pin vence o tier do plano e nunca sobe, mesmo em tentativas seguintes', () => {
  for (const attempt of [1, 2, 3, 9]) {
    const r = resolveRoute({ tier: 'profunda', pin: 'leve', attempt }); assert.deepEqual(r, { tier: 'leve', model: 'claude-haiku-5-5', effort: 'low', source: 'pinned' }, `attempt ${attempt}`);
  }
  assert.equal(resolveRoute({ pin: 'profunda' }).source, 'pinned'); assert.equal(resolveRoute({ tier: 'leve', pin: 'padrao', attempt: 2 }).tier, 'padrao');
  assert.deepEqual(resolveRoute({ tier: 'leve', pin: 'inexistente' }), resolveRoute({ tier: 'leve' }), 'pin inválido é ignorado');
  assert.deepEqual(resolveRoute({ tier: 'leve', pin: null }), resolveRoute({ tier: 'leve' }));
});

test('resolveRoute: escalonamento sobe um nível por consulta (attempt > 1) com teto em profunda', () => {
  assert.deepEqual(resolveRoute({ tier: 'leve', attempt: 2 }), { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'escalated' });
  assert.deepEqual(resolveRoute({ tier: 'padrao', attempt: 2 }), { tier: 'profunda', model: 'claude-opus-5-5', effort: 'high', source: 'escalated' });
  assert.equal(resolveRoute({ attempt: 2 }).tier, 'profunda', 'sem tier parte de padrao'); assert.equal(resolveRoute({ attempt: 2 }).source, 'escalated');
  assert.equal(resolveRoute({ tier: 'leve', attempt: 5 }).tier, 'padrao', 'um nível por chamada, não por tentativa acumulada');
  assert.equal(resolveRoute({ tier: 'profunda', attempt: 2 }).source, 'planner', 'no teto não sobe e a origem é a do tier');
  assert.equal(resolveRoute({ tier: 'profunda', attempt: 3 }).tier, 'profunda');
  for (const a of ['2', NaN, undefined, null, Infinity]) { if (a === Infinity) continue; assert.equal(resolveRoute({ tier: 'leve', attempt: a }).source, 'planner', String(a)); }
});

test('resolveRoute: tier inválido (banco editado à mão) vira padrao/default e NUNCA devolve modelo fora da tabela', () => {
  const models = new Set(Object.values(TIERS).map((x) => x.model));
  for (const tier of ['gpt-4', 'Leve', '', '__proto__', 'constructor', 'toString', 5, true, {}, [], 'claude-opus-5-5']) {
    for (const attempt of [1, 2]) {
      const r = resolveRoute({ tier, attempt }); assert.ok(models.has(r.model), `${String(tier)}/${attempt}`);
      assert.equal(r.tier, attempt > 1 ? 'profunda' : 'padrao'); assert.equal(r.source, attempt > 1 ? 'escalated' : 'default');
    }
  }
});

test('resolveRoute: determinismo (mesma entrada, mesma saída) e uso de uma tabela efetiva alternativa', () => {
  for (let i = 0; i < 5; i++) assert.deepEqual(resolveRoute({ tier: 'leve', attempt: 2 }), resolveRoute({ tier: 'leve', attempt: 2 }));
  const table = tiersFromEnv({ ORCH_TIER_LEVE: 'm-leve:max' });
  assert.deepEqual(resolveRoute({ tier: 'leve', table }), { tier: 'leve', model: 'm-leve', effort: 'max', source: 'planner' });
  assert.deepEqual(resolveRoute({ tier: 'leve', attempt: 2, table }), { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'escalated' });
});

test('routeArgs: devolve --model/--effort do par da tabela e recusa qualquer par fora dela', () => {
  assert.deepEqual(routeArgs({ model: 'claude-haiku-5-5', effort: 'low' }), ['--model', 'claude-haiku-5-5', '--effort', 'low']);
  for (const n of TIER_NAMES) assert.deepEqual(routeArgs(resolveRoute({ tier: n })), ['--model', TIERS[n].model, '--effort', TIERS[n].effort]);
  assert.deepEqual(routeArgs(resolveRoute({ tier: 'padrao' })), ['--model', 'claude-sonnet-5-5', '--effort', 'medium'], 'ignora campos extras (tier/source)');
  const out = [{ model: 'claude-haiku-5-5', effort: 'high' }, { model: 'claude-opus-5-5', effort: 'low' }, { model: 'outro', effort: 'low' }, { model: '--dangerously-skip-permissions', effort: 'low' }, { model: 'claude-haiku-5-5' }, { effort: 'low' }, {}, null, undefined, 'claude-haiku-5-5', 5, [], { model: ['claude-haiku-5-5'], effort: 'low' }, { model: 'claude-haiku-5-5 ', effort: 'low' }];
  for (const r of out) assert.throws(() => routeArgs(r), /Rota de modelo inválida/, JSON.stringify(r));
});

test('routeArgs: com override de ambiente aceita o par da tabela efetiva (e o padrão); com `table` explícita só vale a dela; nenhum nome livre chega ao argv', () => {
  const keep = process.env.ORCH_TIER_LEVE;
  try {
    process.env.ORCH_TIER_LEVE = 'modelo-custom:max';
    assert.deepEqual(routeArgs({ model: 'modelo-custom', effort: 'max' }), ['--model', 'modelo-custom', '--effort', 'max']);
    assert.deepEqual(routeArgs({ model: 'claude-haiku-5-5', effort: 'low' }).slice(1, 2), ['claude-haiku-5-5']);
    assert.throws(() => routeArgs({ model: 'modelo-custom', effort: 'low' }), /Rota de modelo inválida/);
  } finally { if (keep === undefined) delete process.env.ORCH_TIER_LEVE; else process.env.ORCH_TIER_LEVE = keep; }
  const table = tiersFromEnv({ ORCH_TIER_LEVE: 'so-nesta:low' });
  assert.deepEqual(routeArgs({ model: 'so-nesta', effort: 'low' }, table), ['--model', 'so-nesta', '--effort', 'low']);
  assert.throws(() => routeArgs({ model: 'claude-sonnet-5-5', effort: 'medium' }, { leve: { model: 'x', effort: 'low' } }), /Rota de modelo inválida/);
  assert.throws(() => routeArgs({ model: 'so-nesta', effort: 'low' }), /Rota de modelo inválida/, 'sem a tabela explícita, fora de TIERS e do ambiente');
  // varredura: tudo que resolveRoute produz para qualquer entrada só carrega modelos da tabela
  const allowed = new Set(Object.values(TIERS).flatMap((x) => [x.model, x.effort]));
  for (const tier of [...TIER_NAMES, 'x', undefined]) for (const pin of [...TIER_NAMES, 'y', null]) for (const attempt of [1, 2, 3]) {
    const a = routeArgs(resolveRoute({ tier, pin, attempt })); assert.deepEqual(a.filter((_, i) => i % 2 === 0), ['--model', '--effort']); assert.ok(a.filter((_, i) => i % 2 === 1).every((v) => allowed.has(v)));
  }
});

// ---------- execution.js: task.route chega ao executor.start({ args }) ----------
const { default: express } = await import('express');
const store = await import('../store.js');
const { createExecutor } = await import('../executor/index.js');
const { setupExecution } = await import('../execution.js');
const { executorArgs, BASE_ARGS } = await import('../exec-profile.js');
const { agentArgs } = await import('../agents.js');
const { killTreeSync } = await import('../orphans.js');

let db, seq = 0; const spawned = new Set();
before(() => { db = store.load(); db.missions = []; db.workspaces = [{ id: 'ws', name: 'ws', path: wsDir }]; });
after(() => { for (const pid of spawned) killTreeSync(pid); });

/** Executor real (CLI falsa) que registra as opções de cada start(). */
function rig() {
  const executor = createExecutor({ command: process.execPath, prefixArgs: [FAKE], args: [] }), calls = [], realStart = executor.start;
  executor.start = (o) => { calls.push(o); const h = realStart(o); spawned.add(h.pid); return h; };
  return { executor, calls };
}
const mkTask = (extra = {}) => ({ id: `t${++seq}`, title: `tarefa ${seq}`, status: 'queued', authorized: true, dependsOn: [], report: '', files: [], log: [], instructions: 'MODE:ok teste', ...extra });
const mkMission = (tasks) => { const m = { id: `m${++seq}`, demo: false, title: 'M', objective: 'o', workspaceId: 'ws', createdAt: '2026-01-01T00:00:00.000Z', tasks }; db.missions.push(m); return m; };
const settle = (p, ms = 15_000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);

test('execution: task.route (com agent) chega ao start() logo após BASE_ARGS, no perfil padrão e no bypass; sem route o comportamento é o de hoje', async () => {
  const route = resolveRoute({ tier: 'leve' });
  for (const profile of ['default', 'bypass']) {
    db.workspaces[0].permissionProfile = profile;
    const { executor, calls } = rig(), { startTaskRun } = setupExecution(express(), { db, executor });
    const t = mkTask({ agent: 'code', route }), m = mkMission([t]);
    const r = await startTaskRun(m, t); assert.equal(r.ok, true, JSON.stringify(r)); await settle(r.finished);
    assert.deepEqual(calls[0].args, agentArgs('code', { profile, route }), profile);
    assert.deepEqual(calls[0].args.slice(BASE_ARGS.length, BASE_ARGS.length + 4), ['--model', 'claude-haiku-5-5', '--effort', 'low']); assert.equal(calls[0].args.indexOf('--permission-mode'), BASE_ARGS.length + 4);
    if (profile === 'default') assert.ok(calls[0].args.includes('--allowedTools') && calls[0].args.lastIndexOf('--allowedTools') > calls[0].args.indexOf('--effort'));
    // sem route: idêntico ao de hoje (agent => argumentos do perfil; manual no padrão => nenhum `args` próprio)
    const t2 = mkTask(profile === 'default' ? { agent: 'code' } : {}); m.tasks.push(t2);
    const r2 = await startTaskRun(m, t2); assert.equal(r2.ok, true); await settle(r2.finished);
    assert.deepEqual(calls[1].args, executorArgs(profile)); assert.ok(!calls[1].args.includes('--model'));
  }
  db.workspaces[0].permissionProfile = 'default';
  const { executor, calls } = rig(), { startTaskRun } = setupExecution(express(), { db, executor });
  const manual = mkTask(), m = mkMission([manual]); const r = await startTaskRun(m, manual); await settle(r.finished);
  assert.equal('args' in calls[0], false, 'tarefa manual sem route e perfil padrão: o executor usa os próprios argumentos');
});

test('execution: task.route sem agent usa o agente padrão; route fora da tabela NUNCA inicia a CLI', async () => {
  const { executor, calls } = rig(), { startTaskRun } = setupExecution(express(), { db, executor });
  const ok = mkTask({ route: resolveRoute({ tier: 'profunda' }) }), m = mkMission([ok]);
  const r = await startTaskRun(m, ok); assert.equal(r.ok, true); await settle(r.finished);
  assert.deepEqual(calls[0].args, agentArgs('code', { route: resolveRoute({ tier: 'profunda' }) }));
  for (const route of [{ model: 'qualquer-modelo', effort: 'low' }, { model: 'claude-haiku-5-5', effort: 'high' }, { model: '--x', effort: 'low' }]) {
    const t = mkTask({ route }); m.tasks.push(t);
    const bad = await startTaskRun(m, t); assert.equal(bad.ok, false); assert.match(bad.reason, /Rota de modelo inválida/); assert.equal(calls.length, 1, 'a CLI não foi iniciada'); assert.equal(executor.isBusy(), false);
  }
});
