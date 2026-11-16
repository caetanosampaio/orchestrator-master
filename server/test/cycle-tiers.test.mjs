// Níveis de modelo (tiers) no ciclo: wave/route derivados em syncPlan, pins em planProblem, padrões de orquestração, rota gravada na rodada e na tarefa, argumentos reais da CLI,
// escalonamento na retentativa (o pin nunca sobe), compatibilidade com missões antigas e prompts do Planner. Banco TEMPORÁRIO, workspace TEMPORÁRIO COM Git, CLI FALSA,
// Planner e verificador SIMULADOS. Nenhum modelo é chamado.
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

const { default: express } = await import('express');
const store = await import('../store.js');
const { createExecutor } = await import('../executor/index.js');
const { setupExecution } = await import('../execution.js');
const { createCycle } = await import('../cycle.js');
const { syncPlan, planProblem, newPlan, wavesOf, stepRoute, resolveOrchestration } = await import('../plan.js');
const { TIERS, resolveRoute } = await import('../tiers.js');
const { BASE_ARGS, executorArgs } = await import('../exec-profile.js');

let db, executor, startTaskRun, execStarts = 0, base = 0, verRuns = 0, verBase = 0, seq = 0;
let verStatus = () => 'pass', onStart = null, argsSeen = [], prompts = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERIFS = [{ id: 'test', script: 'test', command: 'node --test', required: true, timeoutMs: 60000 }];
before(() => {
  db = store.load(); db.missions = []; db.workspaces = [{ id: 'ws', name: 'ws', path: wsDir, verifications: VERIFS }]; store.saveOrThrow();
  const real = createExecutor({ command: process.execPath, prefixArgs: [FAKE], args: [] });
  executor = new Proxy(real, { get: (t, k) => (k === 'start' ? (o) => { execStarts++; argsSeen.push(o.args ?? null); prompts.push(o.prompt); onStart?.(execStarts - base); return t.start(o); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  ({ startTaskRun } = setupExecution(express(), { db, executor }));
});
after(async () => { for (const k of ['ORCH_TIER_LEVE', 'ORCH_TIER_PADRAO', 'ORCH_TIER_PROFUNDA']) delete process.env[k]; await sleep(500); fs.rmSync(tmp, { recursive: true, force: true }); });

function resetWs() { for (const f of fs.readdirSync(wsDir)) if (f !== '.git') fs.rmSync(path.join(wsDir, f), { recursive: true, force: true }); }
const scripted = (answers) => { const calls = []; return { calls, busy: () => false, cancel: async () => {}, describeTier: () => null, decide: async ({ prompt }) => { calls.push(prompt); const x = answers.shift(); return x === undefined ? { error: 'roteiro acabou' } : { text: x }; } }; };
const verifier = () => ({ isBusy: () => false, stop: async () => ({ stopped: false }),
  run: async (w, item) => { verRuns++; const st = verStatus(verRuns - verBase); return { id: item.id, script: item.script, required: item.required, command: `npm run ${item.script}`, source: 'backend', status: st, exitCode: st === 'pass' ? 0 : 1, durationMs: 5, outputTail: st === 'pass' ? '' : 'falhou', truncated: false, reason: st === 'pass' ? null : 'Terminou com código 1' }; } });
const mk = (planner, { retries = 0, multi = true } = {}) => createCycle({ db, executor, planner, startTaskRun, verifier: verifier(), listFiles: () => ['LEIAME.md'], multiStep: multi, stepRetries: retries, persistRetryMs: [1] });
const mkMission = () => { const m = { id: `t${++seq}`, demo: false, title: `Missão T${seq}`, objective: 'obj', workspaceId: 'ws', createdAt: 'T0', tasks: [] }; db.missions.push(m); return m; };
async function run(answers, { retries = 0, multi = true, max = 6, ver = () => 'pass', start = null } = {}) {
  resetWs(); argsSeen = []; prompts = []; verStatus = ver; verBase = verRuns; base = execStarts; onStart = start;
  const m = mkMission(), planner = scripted(answers), cy = mk(planner, { retries, multi });
  assert.equal((await cy.start(m.id, max)).status, 202); await cy.idle(); onStart = null;
  return { m, c: m.cycle, cy, planner };
}
const step = (id, deps = [], extra = {}) => ({ id, title: `Etapa ${id}`, instructions: `MODE:produce FILE:${id}.txt ${id}`, acceptance: [`${id}.txt existe e foi gerado nesta etapa`], expectedFiles: [`${id}.txt`], dependsOn: deps, ...extra });
const planAns = (steps) => JSON.stringify({ decision: 'plan', rationale: 'dividir em etapas', steps });
const done = () => JSON.stringify({ decision: 'complete', rationale: 'ok', evidence: ['verificação real aprovada'] });
const blockedAns = () => JSON.stringify({ decision: 'blocked', rationale: 'preciso de ajuda', blockedReason: 'decisão humana' });
const modelOf = (args) => args[args.indexOf('--model') + 1], effortOf = (args) => args[args.indexOf('--effort') + 1];

// =====================================================================================================================
// Parte pura: wave, route, pins, padrões
// =====================================================================================================================
const defs = (list) => list.map(([id, dependsOn, extra = {}]) => ({ id, title: id, instructions: 'i', acceptance: ['a'], dependsOn, ...extra }));

test('wavesOf: 1 + profundidade no DAG de dependsOn; dependência desconhecida e CICLO não travam nem lançam', () => {
  const w = wavesOf(defs([['a', []], ['b', ['a']], ['c', ['a']], ['d', ['b', 'c']], ['e', []]]));
  assert.deepEqual([...w], [['a', 1], ['b', 2], ['c', 2], ['d', 3], ['e', 1]]);
  const bad = wavesOf(defs([['a', ['b']], ['b', ['a']], ['c', ['zzz']], ['d', ['d']]]));
  for (const v of bad.values()) assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, `onda finita: ${v}`);
  assert.equal(bad.get('c'), 1, 'dependência inexistente é ignorada');
  assert.doesNotThrow(() => wavesOf([null, 5, { id: 'x' }, { id: 'y', dependsOn: 'não é lista' }, { id: 'z', dependsOn: [1, null] }]));
});

test('syncPlan: copia wave e route (rodada > pin > tier do Planner > padrão), é idempotente e não toca no que o Planner definiu', () => {
  const c = { rounds: [], plan: { id: 'pl', createdAt: 'T', rationale: 'r', pins: { c: 'profunda', b: 'leve' }, steps: defs([['a', []], ['b', ['a'], { tier: 'padrao' }], ['c', ['b'], { tier: 'leve', role: 'revisao' }], ['d', ['c'], { tier: 'profunda' }]]).map((s) => ({ ...s, status: 'queued', round: null, taskId: null })) } };
  syncPlan(c);
  const [a, b, cc, d] = c.plan.steps;
  assert.deepEqual([a.wave, b.wave, cc.wave, d.wave], [1, 2, 3, 4]);
  assert.deepEqual([a.route.tier, a.route.source], ['padrao', 'default']); assert.equal(a.route.model, TIERS.padrao.model);
  assert.deepEqual([b.route.tier, b.route.source], ['leve', 'pinned'], 'o pin vence o nível do Planner');
  assert.deepEqual([cc.route.tier, cc.route.source], ['profunda', 'pinned']);
  assert.deepEqual([d.route.tier, d.route.source, d.route.model, d.route.effort], ['profunda', 'planner', TIERS.profunda.model, TIERS.profunda.effort]);
  assert.deepEqual([cc.role, cc.tier], ['revisao', 'leve'], 'role/tier definidos pelo Planner ficam como estão');
  const snap = JSON.stringify(c.plan); syncPlan(c); assert.equal(JSON.stringify(c.plan), snap, 'idempotente');
  // a rota USADA na última rodada vale mais do que o que o pin diria agora
  const used = { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'escalated' };
  c.rounds = [{ n: 1, planId: 'pl', stepId: 'a', status: 'running', taskId: 't1', route: used }]; syncPlan(c);
  assert.deepEqual(c.plan.steps[0].route, used); assert.notEqual(c.plan.steps[0].route, used, 'cópia, não a mesma referência');
});

test('missão ANTIGA (sem tier/role/pins e rodadas sem route): segue como padrao/default e o plano continua válido', () => {
  const c = { rounds: [{ n: 1, planId: 'pl', stepId: 'a', status: 'succeeded', taskId: 't1', phase: 'done', verification: 'passed', report: { status: 'success', verifications: [], evidence: { level: 'verified' } }, integrity: { status: 'clean', changes: [], pending: [] }, decision: null }],
    plan: { id: 'pl', createdAt: 'T', rationale: 'r', steps: defs([['a', []], ['b', ['a']]]).map((s) => ({ ...s, status: 'queued', round: null, taskId: null })) } };
  syncPlan(c);
  assert.equal(c.plan.steps[0].route, undefined, 'etapa que já rodou sem rota gravada: o modelo usado é desconhecido e NUNCA é inventado');
  assert.deepEqual([c.plan.steps[1].route.tier, c.plan.steps[1].route.source, c.plan.steps[1].route.model], ['padrao', 'default', TIERS.padrao.model], 'etapa ainda na fila: a rota que SERÁ usada');
  assert.equal(c.plan.steps[0].status, 'completed'); assert.deepEqual(c.plan.steps.map((s) => s.wave), [1, 2]);
  assert.equal(planProblem(c), null, 'wave/route derivados são removidos antes de revalidar; plano sem pins é válido');
});

test('planProblem: wave/route derivados nunca invalidam; role/tier inválidos invalidam; pins são validados (objeto simples, ids existentes, só nomes de nível)', () => {
  const mkc = (extra = {}, stepExtra = {}) => ({ rounds: [], plan: { id: 'pl', createdAt: 'T', rationale: 'r', ...extra, steps: defs([['a', [], stepExtra], ['b', ['a']]]).map((s) => ({ ...s, status: 'queued', round: null, taskId: null })) } });
  assert.equal(planProblem(mkc()), null);
  assert.equal(planProblem(mkc({ pins: { b: 'leve', a: 'profunda' } }, { role: 'docs', tier: 'leve' })), null, 'pins válidos + role/tier válidos');
  assert.equal(planProblem(mkc({ pins: {} })), null);
  for (const pins of [[], 'leve', 7, null, { zzz: 'leve' }, { a: 'claude-opus-5-5' }, { a: 'ultra' }, { a: null }, { a: 3 }]) assert.match(planProblem(mkc({ pins })) ?? '', /pins/, JSON.stringify(pins));
  assert.match(planProblem(mkc({}, { tier: 'ultra' })), /tier/); assert.match(planProblem(mkc({}, { role: 'hacker' })), /role/);
  const injected = mkc(); injected.plan.steps[0].route = { model: 'x' }; injected.plan.steps[0].wave = 'qualquer'; assert.equal(planProblem(injected), null, 'o derivado é sobrescrito, nunca confiado');
  const c = mkc({ pins: { a: 'leve' } }); assert.equal(planProblem(c), null); assert.equal(c.plan.steps[0].route.source, 'pinned');
});

test('resolveOrchestration: padrão = plano ligado + 1 retentativa; ambiente > configurações > padrão; off/0 continuam desligando', () => {
  const o = (env, settings) => resolveOrchestration({ env, settings });
  assert.deepEqual(o({}, {}), { planMode: true, stepRetries: 1, autoClose: true, source: { planMode: 'default', stepRetries: 'default', autoClose: 'default' } });
  assert.deepEqual(o({ ORCH_CYCLE_PLAN: 'off' }, {}), { planMode: false, stepRetries: 1, autoClose: true, source: { planMode: 'env', stepRetries: 'default', autoClose: 'default' } });
  assert.deepEqual(o({ ORCH_CYCLE_MAX_STEP_RETRIES: '0' }, {}), { planMode: true, stepRetries: 0, autoClose: true, source: { planMode: 'default', stepRetries: 'env', autoClose: 'default' } });
  assert.equal(o({ ORCH_CYCLE_MAX_STEP_RETRIES: 'off' }, {}).stepRetries, 0);
  assert.deepEqual(o({}, { planMode: false, stepRetries: 0 }), { planMode: false, stepRetries: 0, autoClose: true, source: { planMode: 'settings', stepRetries: 'settings', autoClose: 'default' } });
  assert.deepEqual(o({ ORCH_CYCLE_PLAN: 'on', ORCH_CYCLE_MAX_STEP_RETRIES: '2' }, { planMode: false, stepRetries: 0 }), { planMode: true, stepRetries: 2, autoClose: true, source: { planMode: 'env', stepRetries: 'env', autoClose: 'default' } });
});

test('stepRoute: pin só vale como chave PRÓPRIA do plano; nome de modelo no pin é ignorado; a tabela de ambiente é respeitada', () => {
  assert.equal(stepRoute({ pins: JSON.parse('{"__proto__":"profunda"}') }, { id: 'constructor' }).source, 'default');
  assert.equal(stepRoute({ pins: { a: 'claude-opus-5-5' } }, { id: 'a', tier: 'leve' }).tier, 'leve', 'pin que não é nome de nível não vale');
  assert.equal(stepRoute(null, { tier: 'profunda' }).model, TIERS.profunda.model);
  assert.equal(stepRoute(null, null).tier, 'padrao');
  process.env.ORCH_TIER_LEVE = 'meu-modelo:high';
  try { const r = stepRoute(null, { tier: 'leve' }); assert.deepEqual([r.model, r.effort], ['meu-modelo', 'high']); } finally { delete process.env.ORCH_TIER_LEVE; }
  process.env.ORCH_TIER_LEVE = 'inválido!:low';
  try { assert.equal(stepRoute(null, { tier: 'leve' }).model, TIERS.leve.model, 'ambiente inválido depois do boot: cai na tabela protegida, nunca lança'); } finally { delete process.env.ORCH_TIER_LEVE; }
});

// =====================================================================================================================
// Integração: laço real do ciclo
// =====================================================================================================================
test('rodada e tarefa gravam a rota e o papel; a CLI recebe --model/--effort da tabela logo depois de BASE_ARGS; o plano mostra wave e route', async () => {
  const x = await run([planAns([step('s1', [], { role: 'testes', tier: 'leve' }), step('s2', ['s1']), step('s3', ['s2'], { role: 'analise', tier: 'profunda' })]), done()]);
  assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.c.rounds.length, 3);
  const exp = [['leve', 'planner', 'testes'], ['padrao', 'default', 'implementacao'], ['profunda', 'planner', 'analise']];
  x.c.rounds.forEach((r, i) => {
    assert.deepEqual([r.route.tier, r.route.source, r.role], exp[i], `rodada ${i + 1}`);
    assert.deepEqual([r.route.model, r.route.effort], [TIERS[exp[i][0]].model, TIERS[exp[i][0]].effort]);
    const t = x.m.tasks.find((k) => k.id === r.taskId); assert.deepEqual(t.route, r.route, 'a tarefa leva a MESMA rota'); assert.notEqual(t.route, r.route);
    const args = argsSeen[i]; assert.ok(Array.isArray(args), 'a CLI recebeu os argumentos do perfil, não os do executor'); assert.equal(args.indexOf('--model'), BASE_ARGS.length);
    assert.deepEqual(args.slice(BASE_ARGS.length, BASE_ARGS.length + 4), ['--model', TIERS[exp[i][0]].model, '--effort', TIERS[exp[i][0]].effort]); assert.equal(args.at(-1), executorArgs('default').at(-1), 'allowedTools (variádica) continua por último'); assert.deepEqual(args.slice(0, BASE_ARGS.length), [...BASE_ARGS]);
  });
  assert.deepEqual(x.c.plan.steps.map((s) => [s.wave, s.route.tier, s.route.source]), [[1, 'leve', 'planner'], [2, 'padrao', 'default'], [3, 'profunda', 'planner']]);
  assert.equal(planProblem(x.c), null); assert.deepEqual(x.c.plan.steps.map((s) => s.role ?? null), ['testes', null, 'analise'], 'o papel ausente continua ausente na DEFINIÇÃO (o rótulo padrão vai só na rodada)');
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.ORCH_DATA_DIR, 'db.json'), 'utf8')).missions.find((m) => m.id === x.m.id);
  assert.deepEqual(disk.cycle.rounds.map((r) => r.route.tier), ['leve', 'padrao', 'profunda']); assert.deepEqual(disk.cycle.plan.steps.map((s) => s.wave), [1, 2, 3]);
});

test('tarefa avulsa (continue, sem plano): padrao/default e papel implementacao; tabela de ambiente (ORCH_TIER_*) vale e chega à CLI', async () => {
  process.env.ORCH_TIER_PADRAO = 'modelo-teste:high';
  try {
    const t = { decision: 'continue', rationale: 'r', task: { title: 'Avulsa', instructions: 'MODE:produce FILE:av.txt av', acceptance: ['av.txt existe e foi gerado'], expectedFiles: ['av.txt'] } };
    const x = await run([JSON.stringify(t), done()]);
    assert.equal(x.c.status, 'completed', x.c.blockedReason);
    assert.deepEqual([x.c.rounds[0].route.tier, x.c.rounds[0].route.source, x.c.rounds[0].route.model, x.c.rounds[0].route.effort, x.c.rounds[0].role], ['padrao', 'default', 'modelo-teste', 'high', 'implementacao']);
    assert.deepEqual([modelOf(argsSeen[0]), effortOf(argsSeen[0])], ['modelo-teste', 'high']);
  } finally { delete process.env.ORCH_TIER_PADRAO; }
});

test('rota não resolvível na CLI (ambiente de níveis inválido depois do boot): a CLI NÃO é iniciada com nome livre; o ciclo para como nas demais falhas de início', async () => {
  process.env.ORCH_TIER_PROFUNDA = 'ruim com espaço:high';
  try {
    const x = await run([planAns([step('a', [], { tier: 'leve' })])]);
    assert.equal(x.c.status, 'blocked'); assert.equal(x.c.blockedCode, 'cannot_start'); assert.equal(execStarts - base, 0, 'nenhuma CLI iniciada');
    assert.match(x.c.blockedReason, /ORCH_TIER_PROFUNDA inválido/);
  } finally { delete process.env.ORCH_TIER_PROFUNDA; }
});

const failFirst = (k) => (k === 2 ? 'fail' : 'pass'); // 1ª verificação (etapa s1) passa; a 2ª (s2, 1ª tentativa) reprova; a retentativa passa

test('escalonamento: a retentativa (tentativa 2) sobe UM nível (padrao -> profunda), a CLI recebe o novo modelo e a rota fica na rodada e na etapa', async () => {
  const x = await run([planAns([step('s1'), step('s2', ['s1'])]), done()], { retries: 1, ver: failFirst });
  assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.deepEqual(x.c.rounds.map((r) => r.stepId), ['s1', 's2', 's2']);
  assert.deepEqual(x.c.rounds.map((r) => [r.route.tier, r.route.source]), [['padrao', 'default'], ['padrao', 'default'], ['profunda', 'escalated']]);
  assert.deepEqual([modelOf(argsSeen[2]), effortOf(argsSeen[2])], [TIERS.profunda.model, TIERS.profunda.effort]); assert.equal(modelOf(argsSeen[1]), TIERS.padrao.model);
  assert.deepEqual(x.m.tasks.map((t) => t.route.tier), ['padrao', 'padrao', 'profunda']);
  assert.deepEqual(x.c.plan.steps.map((s) => s.route.tier), ['padrao', 'profunda'], 'step.route = rota da ÚLTIMA rodada');
  assert.equal(planProblem(x.c), null);
});

test('escalonamento a partir do nível do Planner: leve -> padrao; profunda não passa do teto', async () => {
  const a = await run([planAns([step('s1', [], { tier: 'leve' })]), done()], { retries: 1, ver: (k) => (k === 1 ? 'fail' : 'pass') });
  assert.deepEqual(a.c.rounds.map((r) => [r.route.tier, r.route.source]), [['leve', 'planner'], ['padrao', 'escalated']]);
  const b = await run([planAns([step('s1', [], { tier: 'profunda' })]), done()], { retries: 1, ver: (k) => (k === 1 ? 'fail' : 'pass') });
  assert.deepEqual(b.c.rounds.map((r) => [r.route.tier, r.route.source]), [['profunda', 'planner'], ['profunda', 'planner']], 'no teto não sobe nem muda de origem');
});

test('pin do usuário (gravado enquanto a etapa está queued) vale na 1ª rodada e NUNCA sobe na retentativa; o resto do plano segue o escalonamento', async () => {
  const pinS2 = (n) => { if (n === 1) { const c = db.missions.at(-1).cycle; c.plan.pins = { s2: 'leve' }; } }; // o que POST .../tier faz com s2 ainda queued (s1 está sendo executada)
  const x = await run([planAns([step('s1'), step('s2', ['s1'], { tier: 'profunda' }), step('s3', ['s2'])]), done()], { retries: 1, ver: failFirst, start: pinS2 });
  assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.deepEqual(x.c.rounds.map((r) => r.stepId), ['s1', 's2', 's2', 's3']);
  assert.deepEqual(x.c.rounds.map((r) => [r.route.tier, r.route.source]), [['padrao', 'default'], ['leve', 'pinned'], ['leve', 'pinned'], ['padrao', 'default']], 'o pin vence o tier do Planner e a retentativa não o sobe');
  assert.deepEqual([modelOf(argsSeen[1]), modelOf(argsSeen[2])], [TIERS.leve.model, TIERS.leve.model]);
  assert.equal(planProblem(x.c), null, 'plan.pins não invalida o plano'); assert.deepEqual(x.c.plan.pins, { s2: 'leve' });
});

test('o Planner VÊ nível, modelo e esforço de cada etapa em PLANO ATUAL (no fim da linha) e é ensinado a escolher o MENOR nível', async () => {
  const x = await run([planAns([step('s1', [], { tier: 'leve', role: 'docs' }), step('s2', ['s1'])]), blockedAns()], { ver: () => 'fail' }); // s1 falha: o Planner é consultado de novo
  const p2 = x.planner.calls[1];
  assert.match(p2, /\[s1\] Etapa s1 \| estado: failed \(rodada 1\) .*\| depende de: nada \| nível: leve \(claude-haiku-5-5\/low, planner\) \| papel: docs/);
  assert.match(p2, /\[s2\] Etapa s2 \| estado: queued \| depende de: s1 \| nível: padrao \(claude-sonnet-5-5\/medium, default\)/);
  assert.match(p2, /sugira um "tier" maior/);
  const p1 = x.planner.calls[0];
  for (const re of [/"role":"implementacao","tier":"padrao"/, /MENOR nível/, /leve = mudança mecânica ou localizada/, /profunda = arquitetura, bug de causa obscura, segurança/, /Em dúvida, padrao/, /NÃO concede ferramenta nem permissão/, /PRIMEIRA consulta/]) assert.match(p1, re, String(re));
  assert.match(p1, /implementacao \| testes \| revisao \| docs \| analise/);
});

test('ORCH_CYCLE_PLAN=off / planMode=false: o Planner não vê plano, role nem tier e o fluxo é o antigo (continue/complete)', async () => {
  const cont = JSON.stringify({ decision: 'continue', rationale: 'r', task: { title: 'Avulsa', instructions: 'MODE:produce FILE:av.txt av', acceptance: ['av.txt existe e foi gerado'], expectedFiles: ['av.txt'] } });
  const x = await run([cont, done()], { multi: false });
  assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.c.plan, undefined);
  for (const p of x.planner.calls) { assert.doesNotMatch(p, /"decision":"plan"/); assert.doesNotMatch(p, /"tier"/); assert.doesNotMatch(p, /PRIMEIRA consulta/); }
  assert.deepEqual([x.c.rounds[0].route.tier, x.c.rounds[0].role], ['padrao', 'implementacao'], 'a rota padrão continua valendo no fluxo antigo');
  const y = await run([planAns([step('s1')]), blockedAns(), blockedAns()], { multi: false });
  assert.equal(y.c.plan, undefined, '"plan" com o modo desligado é recusado');
  assert.deepEqual(resolveOrchestration({ env: { ORCH_CYCLE_PLAN: 'off' }, settings: {} }).planMode, false);
});

test('resolveRoute e a etapa gravada concordam: o que a prévia mostra (sem rodada) é o que a 1ª rodada usa', async () => {
  const x = await run([planAns([step('s1', [], { tier: 'profunda' })]), done()]);
  assert.deepEqual(resolveRoute({ tier: 'profunda', table: TIERS }), { tier: 'profunda', ...TIERS.profunda, source: 'planner' });
  assert.deepEqual(x.c.rounds[0].route, { tier: 'profunda', ...TIERS.profunda, source: 'planner' });
  const fresh = newPlan({ id: 'p', at: 'T', rationale: 'r', steps: [step('s1', [], { tier: 'profunda' })] }); const c = { rounds: [], plan: fresh }; syncPlan(c);
  assert.deepEqual(fresh.steps[0].route, x.c.rounds[0].route);
});
