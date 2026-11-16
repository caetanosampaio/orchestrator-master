// Fechamento automático (B3): com TODAS as etapas do plano concluídas pela evidência "verified" do sistema, o SERVIDOR conclui o ciclo sem consultar o Planner, pelo MESMO gate de
// conclusão (semanticProblem) e pela MESMA finalização da decisão "complete" do Planner. Qualquer dúvida cai no Planner como sempre. Banco TEMPORÁRIO, workspace TEMPORÁRIO COM Git,
// CLI FALSA, Planner e verificador SIMULADOS. Nenhum modelo é chamado.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-autoclose-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const DB_FILE = path.join(process.env.ORCH_DATA_DIR, 'db.json'), BLOCK_TMP = `${DB_FILE}.tmp`; // diretório no lugar do .tmp => EISDIR (erro NÃO transitório)
const wsDir = path.join(tmp, 'workspace'); fs.mkdirSync(wsDir); execFileSync('git', ['init', '-q'], { cwd: wsDir });
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-cli.mjs');

const { default: express } = await import('express');
const store = await import('../store.js');
const { createExecutor } = await import('../executor/index.js');
const { setupExecution } = await import('../execution.js');
const { createCycle } = await import('../cycle.js');
const { autoCloseCandidate, autoCloseFromEnv, resolveOrchestration, AUTO_CLOSE_RATIONALE } = await import('../plan.js');
const { validateDecision } = await import('../cycle-schema.js');

let db, executor, startTaskRun, execStarts = 0, seq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERIFS = [{ id: 'test', script: 'test', command: 'node --test', required: true, timeoutMs: 60000 }];
before(() => {
  db = store.load(); db.missions = []; db.workspaces = [{ id: 'ws', name: 'ws', path: wsDir, verifications: VERIFS }]; store.saveOrThrow();
  const real = createExecutor({ command: process.execPath, prefixArgs: [FAKE], args: [] });
  executor = new Proxy(real, { get: (t, k) => (k === 'start' ? (o) => { execStarts++; return t.start(o); } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  ({ startTaskRun } = setupExecution(express(), { db, executor }));
});
after(async () => { await sleep(500); fs.rmSync(tmp, { recursive: true, force: true }); });

function resetWs() { for (const f of fs.readdirSync(wsDir)) if (f !== '.git') fs.rmSync(path.join(wsDir, f), { recursive: true, force: true }); }
const scripted = (answers) => { const calls = []; return { calls, busy: () => false, cancel: async () => {}, describeTier: () => null, decide: async ({ prompt }) => { calls.push(prompt); const x = answers.shift(); return x === undefined ? { error: 'roteiro acabou' } : { text: x }; } }; };
const verifier = () => ({ isBusy: () => false, stop: async () => ({ stopped: false }),
  run: async (w, item) => ({ id: item.id, script: item.script, required: item.required, command: `npm run ${item.script}`, source: 'backend', status: 'pass', exitCode: 0, durationMs: 5, outputTail: '', truncated: false, reason: null }) });
const mk = (planner, { auto = true, limits = null } = {}) => createCycle({ db, executor, planner, startTaskRun, verifier: verifier(), listFiles: () => ['LEIAME.md'], multiStep: true, stepRetries: 0, autoClose: auto, limits, persistRetryMs: [1] });
const mkMission = () => { const m = { id: `a${++seq}`, demo: false, title: `Missão A${seq}`, objective: 'obj', workspaceId: 'ws', createdAt: 'T0', tasks: [] }; db.missions.push(m); return m; };
async function run(answers, { auto = true, max = 6, limits = null, mode = 'produce' } = {}) {
  resetWs();
  const m = mkMission(), planner = scripted(answers), cy = mk(planner, { auto, limits });
  assert.equal((await cy.start(m.id, max)).status, 202); await cy.idle();
  return { m, c: m.cycle, cy, planner, mode };
}
const step = (id, deps = [], mode = 'produce') => ({ id, title: `Etapa ${id}`, instructions: `MODE:${mode} FILE:${id}.txt ${id}`, acceptance: [`${id}.txt existe e foi gerado nesta etapa`], expectedFiles: [`${id}.txt`], dependsOn: deps });
const planAns = (steps) => JSON.stringify({ decision: 'plan', rationale: 'dividir em etapas', steps });
const done = () => JSON.stringify({ decision: 'complete', rationale: 'o Planner concluiu', evidence: ['verificação real aprovada'] });
const blockedAns = () => JSON.stringify({ decision: 'blocked', rationale: 'preciso de ajuda', blockedReason: 'decisão humana' });
const onDisk = (m) => JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).missions.find((x) => x.id === m.id);
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// =====================================================================================================================
// Configuração: padrão, precedência e valor inválido
// =====================================================================================================================
test('resolveOrchestration.autoClose: padrão ligado; env (on/off) > settings > padrão; vazio = não definido; settings inválido é ignorado; env inválido lança', () => {
  const o = (env, settings) => resolveOrchestration({ env, settings });
  assert.equal(o({}, {}).autoClose, true); assert.equal(o({}, {}).source.autoClose, 'default');
  assert.deepEqual([o({ ORCH_CYCLE_AUTO_CLOSE: 'off' }, {}).autoClose, o({ ORCH_CYCLE_AUTO_CLOSE: 'off' }, {}).source.autoClose], [false, 'env']);
  assert.deepEqual([o({ ORCH_CYCLE_AUTO_CLOSE: 'ON ' }, { autoClose: false }).autoClose, o({ ORCH_CYCLE_AUTO_CLOSE: 'on' }, { autoClose: false }).source.autoClose], [true, 'env'], 'o ambiente vence as configurações');
  assert.deepEqual([o({ ORCH_CYCLE_AUTO_CLOSE: 'off' }, { autoClose: true }).autoClose], [false]);
  assert.deepEqual([o({}, { autoClose: false }).autoClose, o({}, { autoClose: false }).source.autoClose], [false, 'settings']);
  assert.deepEqual([o({}, { autoClose: true }).autoClose, o({}, { autoClose: true }).source.autoClose], [true, 'settings']);
  assert.deepEqual([o({ ORCH_CYCLE_AUTO_CLOSE: '  ' }, { autoClose: false }).autoClose, o({ ORCH_CYCLE_AUTO_CLOSE: '' }, { autoClose: false }).source.autoClose], [false, 'settings'], 'vazio = não definido');
  for (const bad of ['yes', '1', 'true', 'talvez', 'false']) { assert.throws(() => autoCloseFromEnv({ ORCH_CYCLE_AUTO_CLOSE: bad }), /ORCH_CYCLE_AUTO_CLOSE inválido/, bad); assert.throws(() => o({ ORCH_CYCLE_AUTO_CLOSE: bad }, {}), /ORCH_CYCLE_AUTO_CLOSE inválido/, bad); }
  for (const bad of ['sim', 1, 0, null, 'false', {}]) assert.equal(o({}, { autoClose: bad }).autoClose, true, `configuração persistida inválida é ignorada: ${JSON.stringify(bad)}`);
  assert.equal(autoCloseFromEnv({}), undefined);
  assert.equal(o({}, null).autoClose, true);
  // os campos antigos continuam como estavam
  assert.deepEqual([o({}, {}).planMode, o({}, {}).stepRetries], [true, 1]);
});

// =====================================================================================================================
// autoCloseCandidate (puro): só com TODAS as etapas completed + evidência "verified"
// =====================================================================================================================
const mkRound = (n, stepId, over = {}) => ({ n, planId: 'pl', stepId, status: 'succeeded', taskId: `t${n}`, phase: 'done', verification: 'passed', report: { status: 'success', summary: 's', verifications: [{ id: 'test', script: 'test', status: 'pass' }], evidence: { level: 'verified', basis: 'real_verification+expected_files', system: { expectedFiles: [{ path: `${stepId}.txt`, ok: true }] } } }, integrity: { status: 'clean', changes: [], pending: [] }, decision: null, ...over });
const mkCycle = (ids, rounds) => ({ rounds, plan: { id: 'pl', createdAt: 'T', rationale: 'r', steps: ids.map((id) => ({ id, title: `Etapa ${id}`, instructions: 'i', acceptance: ['a'], dependsOn: [], status: 'queued', round: null, taskId: null })) } });

test('autoCloseCandidate: todas verificadas => decisão "complete" válida pelo schema do Planner; 1 item de evidência por etapa, curtos e sem caracteres de controle', () => {
  const c = mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b')]);
  const r = autoCloseCandidate(c);
  assert.equal(r.ok, true); assert.equal(r.decision.decision, 'complete'); assert.equal(r.decision.rationale, AUTO_CLOSE_RATIONALE);
  assert.equal(r.decision.rationale, 'Fechamento automático: todas as etapas concluídas com evidência verificada.');
  assert.equal(r.decision.evidence.length, 2); assert.match(r.decision.evidence[0], /^Etapa a, rodada 1: .*verificações reais aprovadas: test.*arquivos esperados conferidos: a\.txt/);
  const v = validateDecision(JSON.stringify(r.decision)); assert.equal(v.ok, true, v.error); assert.deepEqual(v.value, r.decision);
});

test('autoCloseCandidate: etapa unverified/failed/queued/running, evidência não verified, SEM evidência (rodada antiga) ou sem rodada => NÃO é candidato', () => {
  const lvl = (level) => mkRound(2, 'b', { report: { status: 'success', verifications: [], evidence: { level } } });
  const cases = {
    'unverified (evidência inconclusiva)': mkCycle(['a', 'b'], [mkRound(1, 'a'), lvl('inconclusive')]),
    'failed (evidência falhou)': mkCycle(['a', 'b'], [mkRound(1, 'a'), lvl('failed')]),
    'etapa sem rodada (queued)': mkCycle(['a', 'b'], [mkRound(1, 'a')]),
    'rodada em andamento': mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b', { status: 'running', phase: 'executing' })]),
    'execução falhou': mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b', { status: 'failed' })]),
    'interrompida': mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b', { status: 'interrupted' })]),
    'rodada ANTIGA sem evidência (M8 anterior)': mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b', { report: { status: 'success', verifications: [{ id: 'test', script: 'test', status: 'pass' }] } })]),
    'evidência de nível desconhecido': mkCycle(['a', 'b'], [mkRound(1, 'a'), lvl('VERIFIED')]),
    'sem plano': { rounds: [] }, 'plano sem etapas': { rounds: [], plan: { id: 'pl', steps: [] } },
  };
  for (const [name, c] of Object.entries(cases)) { const r = autoCloseCandidate(c); assert.equal(r.ok, false, name); assert.equal(typeof r.reason, 'string', name); }
  // a rodada antiga sem evidência CONTA como etapa concluída para o plano (regra anterior), mas nunca como verificada para o fechamento automático
  const old = cases['rodada ANTIGA sem evidência (M8 anterior)']; autoCloseCandidate(old); assert.equal(old.plan.steps[1].status, 'completed');
  // só a ÚLTIMA rodada da etapa vale: tentativa antiga verificada seguida de nova rodada sem evidência verificada não é candidato
  const retried = mkCycle(['a'], [mkRound(1, 'a'), mkRound(2, 'a', { report: { status: 'success', verifications: [], evidence: { level: 'inconclusive' } } })]); assert.equal(autoCloseCandidate(retried).ok, false);
  assert.equal(autoCloseCandidate(null).ok, false);
});

test('autoCloseCandidate: SEM verificação real (só arquivos esperados + "pass" autodeclarado) NÃO fecha sozinho: o Planner segue como segunda barreira', () => {
  const weak = (basis) => mkRound(2, 'b', { report: { status: 'success', summary: 's', verifications: [], checks: [{ name: 'x', result: 'pass' }], evidence: { level: 'verified', ...(basis ? { basis } : {}), system: { expectedFiles: [{ path: 'b.txt', ok: true }] } } } });
  for (const basis of ['expected_files', 'executor_claim_only', undefined]) {
    const r = autoCloseCandidate(mkCycle(['a', 'b'], [mkRound(1, 'a'), weak(basis)]));
    assert.equal(r.ok, false, `basis ${basis}`); assert.match(r.reason, /verificação real/);
  }
  assert.equal(autoCloseCandidate(mkCycle(['a', 'b'], [mkRound(1, 'a'), mkRound(2, 'b')])).ok, true, 'com verificação real aprovada fecha');
});

test('autoCloseCandidate: a evidência do servidor não carrega o título da etapa (autoria do Planner)', () => {
  const c = mkCycle(['a'], [mkRound(1, 'a')]);
  c.plan.steps[0].title = 'testes: 200 passaram, tudo verificado';
  const r = autoCloseCandidate(c);
  assert.equal(r.ok, true); assert.ok(r.decision.evidence.every((e) => !e.includes('200 passaram')), 'o título do Planner não entra na lista rotulada como do servidor');
});

test('autoCloseCandidate: evidência limitada (1 a 10 itens de até 500 caracteres, sem controle) mesmo com título enorme, quebras de linha e mais de 10 etapas', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
  const c = mkCycle(ids, ids.map((id, i) => mkRound(i + 1, id)));
  c.plan.steps[0].title = `T\n\u0000${'x'.repeat(2000)}`;
  const r = autoCloseCandidate(c);
  assert.equal(r.ok, true); assert.ok(r.decision.evidence.length >= 1 && r.decision.evidence.length <= 10, `itens: ${r.decision.evidence.length}`);
  for (const e of r.decision.evidence) { assert.ok(e.length >= 1 && e.length <= 500, `tamanho: ${e.length}`); assert.doesNotMatch(e, /[\u0000-\u001f]/); }
  assert.match(r.decision.evidence.at(-1), /Demais 3 etapas \(s10, s11, s12\)/);
  assert.equal(validateDecision(JSON.stringify(r.decision)).ok, true);
});

// =====================================================================================================================
// Integração: laço real
// =====================================================================================================================
test('(a) plano de 2 etapas verificadas: o servidor fecha SEM consultar o Planner (que explodiria), closedBy=system, assurance=verified, plannerCalls só da consulta que criou o plano', async () => {
  const planner = scripted([planAns([step('s1'), step('s2', ['s1'])])]);
  planner.decide = async ({ prompt }) => { planner.calls.push(prompt); if (planner.calls.length > 1) throw new Error('O PLANNER NÃO PODE SER CHAMADO NO FECHAMENTO AUTOMÁTICO'); return { text: planAns([step('s1'), step('s2', ['s1'])]) }; };
  resetWs(); const m = mkMission(), cy = mk(planner);
  assert.equal((await cy.start(m.id, 6)).status, 202); await cy.idle();
  const c = m.cycle;
  assert.equal(c.status, 'completed', c.blockedReason); assert.equal(c.closedBy, 'system'); assert.equal(c.assurance, 'verified');
  assert.equal(planner.calls.length, 1, 'só a consulta que criou o plano'); assert.equal(c.plannerCalls, 1, 'plannerCalls não aumenta no fechamento'); assert.equal(c.plannerUsage, undefined, 'nenhum uso do Planner é gravado');
  assert.deepEqual(c.rounds.map((r) => r.stepId), ['s1', 's2']); assert.deepEqual(c.rounds.map((r) => r.report.evidence.level), ['verified', 'verified']);
  assert.equal(c.finalSummary, AUTO_CLOSE_RATIONALE); assert.equal(c.evidence.length, 2); assert.ok(c.evidence.every((e) => typeof e === 'string' && e.length >= 1 && e.length <= 500));
  assert.equal(c.rounds.at(-1).decision.decision, 'complete'); assert.equal(c.rounds.at(-1).decision.by, 'system'); assert.equal(c.rounds.at(-1).decision.rationale, AUTO_CLOSE_RATIONALE); assert.ok(c.rounds.at(-1).decision.at);
  assert.equal(c.rounds[0].decision, null, 'só a última rodada leva a decisão');
  assert.ok(c.finishedAt); assert.ok(c.deliveryContext, 'contexto da entrega gravado');
  const d = onDisk(m).cycle; assert.deepEqual([d.status, d.closedBy, d.assurance, d.plannerCalls], ['completed', 'system', 'verified', 1], 'gravado em disco');
  assert.ok(db.activity.some((a) => a.missionId === m.id && /Fechamento automático pelo servidor/.test(a.message)), 'a atividade diz que foi o servidor');
  assert.ok(!db.activity.some((a) => a.missionId === m.id && /Planner declarou a missão concluída/.test(a.message)));
});

test('(h) o fechamento automático preserva TODO efeito do "complete" do Planner: mesmos campos do ciclo, contexto da entrega, garantia e estado final; só autoria e resumo mudam', async () => {
  const sys = await run([planAns([step('s1'), step('s2', ['s1'])])], { auto: true });
  const pl = await run([planAns([step('s1'), step('s2', ['s1'])]), done()], { auto: false });
  assert.equal(sys.c.status, 'completed', sys.c.blockedReason); assert.equal(pl.c.status, 'completed', pl.c.blockedReason);
  assert.deepEqual(Object.keys(sys.c).sort(), Object.keys(pl.c).sort(), 'mesmo conjunto de campos no ciclo');
  assert.deepEqual([sys.c.closedBy, pl.c.closedBy], ['system', 'planner']);
  assert.deepEqual([sys.c.rounds.at(-1).decision.by, pl.c.rounds.at(-1).decision.by], ['system', 'planner']);
  assert.deepEqual(Object.keys(sys.c.rounds.at(-1).decision).sort(), Object.keys(pl.c.rounds.at(-1).decision).sort());
  assert.deepEqual([sys.c.assurance, pl.c.assurance], ['verified', 'verified']);
  assert.deepEqual(Object.keys(sys.c.deliveryContext).sort(), Object.keys(pl.c.deliveryContext).sort(), 'o contexto histórico da entrega é gravado do mesmo jeito');
  assert.equal(sys.c.delivery, undefined); assert.equal(pl.c.delivery, undefined);
  assert.equal(typeof sys.c.finalSummary, 'string'); assert.ok(Array.isArray(sys.c.evidence) && sys.c.evidence.length >= 1);
  assert.deepEqual([sys.c.blockedCode ?? null, sys.c.blockedReason ?? null], [pl.c.blockedCode ?? null, pl.c.blockedReason ?? null]);
  assert.deepEqual([sys.c.rounds.length, pl.c.rounds.length], [2, 2]);
  assert.deepEqual([sys.c.plannerCalls, pl.c.plannerCalls], [1, 2], 'o Planner paga uma consulta a mais só para dizer "complete"');
  assert.deepEqual(sys.c.plan.steps.map((s) => s.status), ['completed', 'completed']);
});

test('caminho do Planner intacto: com autoClose desligado o Planner é consultado, closedBy=planner e a decisão da rodada leva by=planner (e só a "complete" ganha esse campo)', async () => {
  const x = await run([planAns([step('s1'), step('s2', ['s1'])]), done()], { auto: false });
  assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.c.closedBy, 'planner'); assert.equal(x.planner.calls.length, 2); assert.equal(x.c.plannerCalls, 2);
  assert.equal(x.c.finalSummary, 'o Planner concluiu'); assert.deepEqual(x.c.evidence, ['verificação real aprovada']);
  assert.deepEqual([x.c.rounds.at(-1).decision.decision, x.c.rounds.at(-1).decision.by], ['complete', 'planner']);
  assert.ok(db.activity.some((a) => a.missionId === x.m.id && /Planner declarou a missão concluída/.test(a.message) && a.agent === 'planner'));
  const y = await run([planAns([step('s1')]), blockedAns()], { auto: false });
  assert.equal(y.c.blockedCode, 'planner_blocked'); assert.equal(y.c.closedBy, undefined, 'ciclo bloqueado não tem closedBy'); assert.equal(y.c.rounds.at(-1).decision.by, undefined);
});

test('(c) autoClose desligado por env=off ou settings=false: fluxo antigo (Planner consultado, closedBy=planner); env=on vence settings=false', async () => {
  const via = (env, settings) => ({ auto: resolveOrchestration({ env, settings }).autoClose });
  const a = await run([planAns([step('s1')]), done()], via({ ORCH_CYCLE_AUTO_CLOSE: 'off' }, {}));
  const b = await run([planAns([step('s1')]), done()], via({}, { autoClose: false }));
  for (const x of [a, b]) { assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.planner.calls.length, 2, 'o Planner foi consultado'); assert.equal(x.c.closedBy, 'planner'); }
  const c = await run([planAns([step('s1')]), done()], via({ ORCH_CYCLE_AUTO_CLOSE: 'on' }, { autoClose: false }));
  assert.equal(c.c.status, 'completed'); assert.equal(c.planner.calls.length, 1); assert.equal(c.c.closedBy, 'system');
  // o padrão de createCycle (sem a opção) é o fluxo antigo: quem liga é a configuração efetiva do servidor
  resetWs(); const m = mkMission(), planner = scripted([planAns([step('s1')]), done()]);
  const cy = createCycle({ db, executor, planner, startTaskRun, verifier: verifier(), listFiles: () => ['LEIAME.md'], multiStep: true, persistRetryMs: [1] });
  assert.equal((await cy.start(m.id, 4)).status, 202); await cy.idle(); assert.equal(m.cycle.closedBy, 'planner'); assert.equal(planner.calls.length, 2);
});

test('(b) etapa que NÃO foi comprovada (arquivo esperado não produzido): não fecha sozinho; o Planner é consultado como hoje', async () => {
  const x = await run([planAns([step('s1', [], 'nofile')]), blockedAns()]);
  assert.equal(x.c.rounds[0].report.evidence.level, 'failed'); assert.equal(x.c.plan.steps[0].status, 'failed');
  assert.equal(x.planner.calls.length, 2, 'o Planner foi consultado'); assert.equal(x.c.status, 'blocked'); assert.equal(x.c.blockedCode, 'planner_blocked'); assert.equal(x.c.closedBy, undefined);
  assert.notEqual(x.c.assurance, 'verified');
});

test('(b) etapa unverified (testes alterados e não revisados): o ciclo para para revisão humana, sem fechar nem consultar o Planner', async () => {
  const x = await run([planAns([step('s1', [], 'edittest'), step('s2', ['s1'])]), done()]);
  assert.equal(x.c.plan.steps[0].status, 'unverified'); assert.equal(x.c.status, 'blocked'); assert.equal(x.c.blockedCode, 'integrity_review');
  assert.equal(x.c.closedBy, undefined); assert.equal(x.c.assurance, undefined); assert.equal(x.planner.calls.length, 1); assert.equal(execStarts > 0, true);
});

// Cria um ciclo concluído de forma real, mas PARADO no bloqueio do Planner ("blocked"), para mexer no estado gravado e retomar com o fechamento automático ligado.
async function blockedAfterSteps() {
  const x = await run([planAns([step('s1'), step('s2', ['s1'])]), blockedAns()], { auto: false });
  assert.equal(x.c.blockedCode, 'planner_blocked', x.c.blockedReason); assert.deepEqual(x.c.plan.steps.map((s) => s.status), ['completed', 'completed']);
  return x;
}
const resumeWith = async (x, answers, { limits = null } = {}) => { const planner = scripted(answers), cy = mk(planner, { auto: true, limits }); await quiet(async () => { assert.equal((await cy.resume(x.m.id)).status, 202); await cy.idle(); }); return { planner, cy }; };

test('(i) o Planner já decidiu "blocked" sobre esta rodada: a retomada NÃO a fecha por cima dele; o Planner é consultado de novo', async () => {
  const x = await blockedAfterSteps();
  assert.equal(x.c.rounds.at(-1).decision.decision, 'blocked');
  const r = await resumeWith(x, [done()]);
  assert.equal(r.planner.calls.length, 1, 'o Planner foi consultado'); assert.equal(x.c.status, 'completed'); assert.equal(x.c.closedBy, 'planner');
});

test('(f) rodada ANTIGA sem evidência: não fecha sozinha (nunca vale como verificada); o Planner decide como antes', async () => {
  const x = await blockedAfterSteps();
  for (const r of x.c.rounds) { delete r.report.evidence; delete r.decision; } // forma anterior ao M8: sem parecer do sistema e sem decisão registrada
  const r = await resumeWith(x, [done()]);
  assert.equal(r.planner.calls.length, 1, 'o Planner foi consultado'); assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.c.closedBy, 'planner'); assert.equal(x.c.assurance, 'self-declared');
});

test('o mesmo ciclo parado, COM evidência verificada e sem decisão do Planner sobre a rodada: a retomada fecha pelo servidor (controle do teste anterior)', async () => {
  const x = await blockedAfterSteps();
  for (const r of x.c.rounds) delete r.decision;
  const r = await resumeWith(x, []);
  assert.equal(r.planner.calls.length, 0); assert.equal(x.c.status, 'completed', x.c.blockedReason); assert.equal(x.c.closedBy, 'system'); assert.equal(x.c.assurance, 'verified');
});

test('(g) semanticProblem recusa (verificação real configurada que não rodou na última rodada): não fecha sozinho; o Planner é consultado (e o gate dele também recusa)', async () => {
  const x = await blockedAfterSteps();
  for (const r of x.c.rounds) delete r.decision;
  const ws = db.workspaces.find((w) => w.id === 'ws'), before = ws.verifications;
  ws.verifications = [...before, { id: 'lint', script: 'lint', command: 'node -e 0', required: false, timeoutMs: 1000 }]; // configurada depois: não consta no relatório da rodada
  try {
    const r = await resumeWith(x, [blockedAns()]);
    assert.equal(r.planner.calls.length, 1, 'o Planner foi consultado'); assert.notEqual(x.c.status, 'completed'); assert.equal(x.c.closedBy, undefined); assert.equal(x.c.blockedCode, 'planner_blocked');
  } finally { ws.verifications = before; }
});

test('integridade pendente (testes alterados sem revisão): o fechamento automático não acontece', async () => {
  const x = await blockedAfterSteps();
  for (const r of x.c.rounds) delete r.decision;
  x.c.integrity.pending = [{ path: 'tests/x.test.js', change: 'created', round: 2 }];
  const r = await resumeWith(x, [blockedAns()]);
  assert.equal(r.planner.calls.length, 1); assert.notEqual(x.c.status, 'completed'); assert.equal(x.c.closedBy, undefined);
});

test('limite de chamadas ao Planner já atingido: o fechamento automático não contorna o controle (cai no caminho normal, que aponta o limite)', async () => {
  const x = await blockedAfterSteps();
  for (const r of x.c.rounds) delete r.decision;
  let reads = 0; // a retomada lê o limite uma vez (e passa); o limite "estoura" depois, já dentro do laço
  const limits = { get maxPlannerCalls() { return ++reads === 1 ? null : 1; }, maxEstimatedCostUsd: null };
  const r = await resumeWith(x, [done()], { limits });
  assert.ok(reads >= 2, 'o laço consultou o limite'); assert.equal(r.planner.calls.length, 0); assert.notEqual(x.c.status, 'completed'); assert.equal(x.c.closedBy, undefined); assert.equal(x.c.blockedCode, 'planner_call_cap');
});

test('(e) falha de gravação durante o fechamento: rollback de TODOS os campos, ciclo NÃO fica "completed"; ao normalizar o disco e retomar, fecha pelo servidor sem consultar o Planner', async () => {
  let armed = true;
  const limits = { get maxPlannerCalls() { const c = db.missions.at(-1)?.cycle; if (armed && c && c.rounds.length === 2 && c.rounds[1].phase === 'done' && c.status === 'running') { armed = false; fs.mkdirSync(BLOCK_TMP); } return null; }, maxEstimatedCostUsd: null }; // o disco "quebra" logo antes da gravação da conclusão
  const planner = scripted([planAns([step('s1'), step('s2', ['s1'])])]);
  resetWs(); const m = mkMission(), cy = mk(planner, { limits });
  try { await quiet(async () => { assert.equal((await cy.start(m.id, 6)).status, 202); await cy.idle(); }); } finally { fs.rmSync(BLOCK_TMP, { recursive: true, force: true }); }
  const c = m.cycle;
  assert.equal(armed, false, 'o disco foi quebrado no ponto esperado');
  assert.equal(c.status, 'blocked'); assert.equal(c.blockedCode, 'persistence_failed');
  assert.equal(c.closedBy, undefined, 'closedBy desfeito'); assert.ok(!('closedBy' in c)); assert.ok(c.finalSummary == null && c.evidence == null && c.assurance == null, 'campos finais voltaram ao valor anterior (vazio)');
  assert.equal(c.rounds.at(-1).decision, null, 'a decisão da rodada voltou ao valor anterior'); assert.ok(!c.deliveryContext, 'contexto da entrega desfeito'); assert.ok(!c.finishedAt);
  assert.ok(!db.activity.some((a) => a.missionId === m.id && /Fechamento automático pelo servidor/.test(a.message)), 'nada foi anunciado como concluído');
  assert.equal(planner.calls.length, 1); assert.equal(c.plannerCalls, 1);
  assert.equal((await cy.resume(m.id)).status, 202); await cy.idle(); // disco normalizado: reconcilia e retoma
  assert.equal(c.status, 'completed', c.blockedReason); assert.equal(c.closedBy, 'system'); assert.equal(planner.calls.length, 1, 'o Planner nunca foi consultado'); assert.equal(execStarts > 0, true);
  assert.equal(onDisk(m).cycle.closedBy, 'system');
});

test('o fechamento automático também vale para ciclo de UMA etapa e não toca em plano sem etapas concluídas: com a etapa falha o ciclo segue o fluxo normal', async () => {
  const a = await run([planAns([step('s1')])]);
  assert.equal(a.c.status, 'completed', a.c.blockedReason); assert.equal(a.c.closedBy, 'system'); assert.equal(a.planner.calls.length, 1); assert.equal(a.c.evidence.length, 1);
  const b = await run([planAns([step('s1'), step('s2', ['s1'], 'nofile')]), blockedAns()]);
  assert.equal(b.c.blockedCode, 'planner_blocked'); assert.equal(b.c.closedBy, undefined); assert.equal(b.planner.calls.length, 2);
});
