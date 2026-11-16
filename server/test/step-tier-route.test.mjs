// Rota de fixação (pin) do nível de uma etapa: POST /api/missions/:id/cycle/steps/:stepId/tier { tier: leve|padrao|profunda|null }.
// Parte 1 (em processo): step-tier.js num express próprio, ORCH_DATA_DIR temporário. Parte 2: servidor REAL (server/index.js) como processo filho, com ORCH_DATA_DIR temporário,
// porta livre e token de sessão; nenhum modelo é chamado e o banco real e o servidor ativo nunca são tocados.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-steptier-'));
const dataDir = path.join(root, 'inproc'); fs.mkdirSync(dataDir);
process.env.ORCH_DATA_DIR = dataDir; // ANTES de importar o store: o banco deste processo é o temporário
const store = await import('../store.js');
const { setupStepTier } = await import('../step-tier.js');
const { planProblem, syncPlan } = await import('../plan.js');
const { TIERS } = await import('../tiers.js');
const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const servers = new Set(), children = new Set();
after(async () => {
  for (const s of servers) s.close();
  for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } }
  await new Promise((r) => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true });
});

const db = store.load();
const def = (id, extra = {}) => ({ id, title: `Etapa ${id}`, instructions: `faça ${id}`, acceptance: [`${id} existe`], dependsOn: [], ...extra });
const okRound = (n, stepId) => ({ n, status: 'succeeded', taskId: `t${n}`, planId: 'pl', stepId, phase: 'done', verification: 'passed', report: { status: 'success', verifications: [], evidence: { level: 'verified' } }, integrity: { status: 'clean', changes: [], pending: [] }, decision: null });
function seed(status = 'blocked') {
  const rounds = [okRound(1, 'done1'), { n: 2, status: 'running', taskId: 't2', planId: 'pl', stepId: 'run1', report: null }, { ...okRound(3, 'fail1'), status: 'failed', verification: 'none' }];
  const steps = [def('q1'), def('q2', { tier: 'profunda' }), def('done1'), def('run1'), def('fail1')].map((s) => ({ ...s, status: 'queued', round: null, taskId: null }));
  const m = { id: `m${db.missions.length + 1}`, demo: false, title: 'M', objective: 'o', workspaceId: 'ws', createdAt: 'T0', tasks: [], cycle: { id: 'cyc', status, maxIterations: 6, rounds, plan: { id: 'pl', createdAt: 'T0', rationale: 'r', steps } } };
  syncPlan(m.cycle); db.missions.push(m); return m;
}
const serve = async () => {
  const app = express(); app.use(express.json()); setupStepTier(app, { db });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); servers.add(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return (id, stepId, body, raw) => fetch(`${base}/api/missions/${id}/cycle/steps/${stepId}/tier`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
};
const stepOf = (m, id) => m.cycle.plan.steps.find((s) => s.id === id);

test('fixar: etapa queued aceita o nível; responde ok/stepId/tier/route (resolvido no servidor), grava no plano e no disco e NÃO invalida o plano', async () => {
  const post = await serve(), m = seed();
  assert.equal(stepOf(m, 'q1').route.source, 'default');
  const r = await post(m.id, 'q1', { tier: 'leve' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, stepId: 'q1', tier: 'leve', route: { tier: 'leve', model: TIERS.leve.model, effort: TIERS.leve.effort, source: 'pinned' } });
  assert.deepEqual(m.cycle.plan.pins, { q1: 'leve' }); assert.equal(stepOf(m, 'q1').route.source, 'pinned', 'o derivado já reflete o pin');
  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')).missions.find((x) => x.id === m.id);
  assert.deepEqual(disk.cycle.plan.pins, { q1: 'leve' }); assert.equal(planProblem(m.cycle), null, 'plan.pins não gera plan_invalid');
  const r2 = await post(m.id, 'q2', { tier: 'padrao' }); assert.deepEqual([r2.status, r2.body.route.tier, r2.body.route.source], [200, 'padrao', 'pinned'], 'o pin vence o nível do Planner (profunda)');
  assert.deepEqual(m.cycle.plan.pins, { q1: 'leve', q2: 'padrao' }); assert.equal(planProblem(m.cycle), null);
  const again = await post(m.id, 'q1', { tier: 'leve' }); assert.deepEqual([again.status, again.body.route.source], [200, 'pinned'], 'idempotente');
});

test('null remove a fixação (volta ao nível do Planner/padrão); remover o que não existe é inofensivo; o último pin removido some de plan.pins', async () => {
  const post = await serve(), m = seed();
  await post(m.id, 'q1', { tier: 'profunda' }); await post(m.id, 'q2', { tier: 'leve' });
  const r = await post(m.id, 'q2', { tier: null }); assert.deepEqual([r.status, r.body.ok, r.body.tier, r.body.route.tier, r.body.route.source], [200, true, null, 'profunda', 'planner']);
  assert.deepEqual(m.cycle.plan.pins, { q1: 'profunda' }); assert.equal(stepOf(m, 'q2').route.source, 'planner');
  assert.equal((await post(m.id, 'q1', { tier: null })).status, 200); assert.ok(!('pins' in m.cycle.plan), 'sem pins, a chave some (plano idêntico ao antigo)');
  const none = await post(m.id, 'q1', { tier: null }); assert.deepEqual([none.status, none.body.route.source], [200, 'default']); assert.equal(planProblem(m.cycle), null);
});

test('400: corpo inválido (tier ausente, desconhecido, NOME DE MODELO, tipo errado, corpo não objeto); nada muda', async () => {
  const post = await serve(), m = seed(), before = JSON.stringify(m);
  for (const body of [{}, { tier: 'ultra' }, { tier: 'claude-opus-5-5' }, { tier: 'claude-opus-5-5:high' }, { tier: '' }, { tier: 5 }, { tier: true }, { tier: ['leve'] }, { tier: { name: 'leve' } }, { tier: 'LEVE' }, { model: 'claude-opus-5-5' }, []]) {
    const r = await post(m.id, 'q1', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.body.error, /tier/); assert.deepEqual(Object.keys(r.body), ['error']);
  }
  assert.equal((await post(m.id, 'q1', undefined, '{json quebrado')).status, 400, 'JSON malformado: o parser do express responde 400');
  assert.equal(JSON.stringify(m), before);
});

test('só aceita o NOME do nível: campos extras (model, effort) no corpo são ignorados e a rota vem da tabela protegida', async () => {
  const post = await serve(), m = seed();
  const r = await post(m.id, 'q1', { tier: 'leve', model: 'modelo-livre', effort: 'max', route: { model: 'x' } });
  assert.equal(r.status, 200); assert.deepEqual([r.body.route.model, r.body.route.effort], [TIERS.leve.model, TIERS.leve.effort]);
  assert.deepEqual(m.cycle.plan.pins, { q1: 'leve' }); assert.ok(!JSON.stringify(m.cycle.plan.pins).includes('modelo-livre'));
});

test('404: missão, ciclo, plano e etapa inexistentes; sempre { error } em português', async () => {
  const post = await serve(), m = seed(), nocycle = { id: 'sem-ciclo', tasks: [] }, noplan = { id: 'sem-plano', tasks: [], cycle: { id: 'c', status: 'blocked', rounds: [] } };
  db.missions.push(nocycle, noplan);
  for (const [id, stepId] of [['inexistente', 'q1'], [nocycle.id, 'q1'], [noplan.id, 'q1'], [m.id, 'nao-existe'], [m.id, '__proto__'], [m.id, 'constructor']]) {
    const r = await post(id, stepId, { tier: 'leve' }); assert.equal(r.status, 404, `${id}/${stepId}`); assert.deepEqual(Object.keys(r.body), ['error']); assert.match(r.body.error, /não|Não/);
  }
  assert.ok(!('pins' in m.cycle.plan));
});

test('409: só etapa queued — running, completed e failed são recusadas; ciclo concluído ou cancelado também; nada é gravado', async () => {
  const post = await serve(), m = seed(), before = JSON.stringify(m);
  assert.deepEqual(['done1', 'run1', 'fail1'].map((id) => stepOf(m, id).status), ['completed', 'running', 'failed']);
  for (const id of ['done1', 'run1', 'fail1']) { const r = await post(m.id, id, { tier: 'profunda' }); assert.equal(r.status, 409, id); assert.match(r.body.error, /queued|ainda não foi executada/); }
  assert.equal(JSON.stringify(m), before);
  for (const status of ['completed', 'cancelled']) { const c = seed(status); const r = await post(c.id, 'q1', { tier: 'leve' }); assert.equal(r.status, 409, status); assert.match(r.body.error, /terminou/); assert.ok(!('pins' in c.cycle.plan)); }
  const lim = seed('limit_reached'); assert.equal((await post(lim.id, 'q1', { tier: 'leve' })).status, 200, 'limit_reached é retomável: a etapa ainda queued pode receber o pin');
});

test('409: com o ciclo em "planning" o Planner pode substituir o plano (e levar o pin junto): a fixação é recusada e nada é gravado', async () => {
  const post = await serve(), c = seed('planning'), before = JSON.stringify(c);
  const r = await post(c.id, 'q1', { tier: 'leve' });
  assert.equal(r.status, 409); assert.match(r.body.error, /Planner/); assert.equal(JSON.stringify(c), before);
});

test('o estado da etapa é o DERIVADO das rodadas gravadas: uma etapa que começou a rodar deixa de aceitar o pin', async () => {
  const post = await serve(), m = seed();
  assert.equal((await post(m.id, 'q1', { tier: 'leve' })).status, 200);
  m.cycle.rounds.push({ n: 4, status: 'running', taskId: 't4', planId: 'pl', stepId: 'q1', report: null, route: { tier: 'leve', model: TIERS.leve.model, effort: TIERS.leve.effort, source: 'pinned' } }); // a rodada nasce SEM passar pelo campo step.status gravado
  const r = await post(m.id, 'q1', { tier: 'profunda' }); assert.equal(r.status, 409); assert.deepEqual(m.cycle.plan.pins, { q1: 'leve' });
});

test('persistência atômica: se o banco não pode ser gravado, 500, o pin e a rota derivada voltam EXATAMENTE ao que eram (inclusive "sem pins") e depois funciona', async () => {
  const post = await serve(), m = seed(), blocker = path.join(dataDir, 'db.json.tmp');
  const before = JSON.stringify(m);
  fs.mkdirSync(blocker); // um DIRETÓRIO no lugar do arquivo temporário: a gravação falha com erro real
  try {
    const r = await post(m.id, 'q1', { tier: 'leve' }); assert.equal(r.status, 500); assert.deepEqual(Object.keys(r.body), ['error']); assert.match(r.body.error, /nada foi alterado/);
    assert.equal(JSON.stringify(m), before, 'voltou exatamente ao estado anterior'); assert.ok(!('pins' in m.cycle.plan));
    fs.rmSync(blocker, { recursive: true, force: true });
    assert.equal((await post(m.id, 'q1', { tier: 'leve' })).status, 200);
    fs.mkdirSync(blocker); const mid = JSON.stringify(m);
    const r2 = await post(m.id, 'q1', { tier: 'profunda' }); assert.equal(r2.status, 500);
    assert.equal(JSON.stringify(m), mid, 'com um pin anterior, volta ao pin anterior'); assert.deepEqual(m.cycle.plan.pins, { q1: 'leve' });
    const r3 = await post(m.id, 'q1', { tier: null }); assert.equal(r3.status, 500); assert.equal(JSON.stringify(m), mid, 'remover também é desfeito');
  } finally { fs.rmSync(blocker, { recursive: true, force: true }); }
});

test('plan_invalid não ocorre por causa de pins: um plano com pins válidos passa por planProblem; pins adulterados (banco editado) são recusados por planProblem', async () => {
  const post = await serve(), m = seed();
  await post(m.id, 'q1', { tier: 'leve' }); await post(m.id, 'q2', { tier: 'profunda' });
  assert.equal(planProblem(m.cycle), null);
  m.cycle.plan.pins.q1 = 'claude-opus-5-5'; assert.match(planProblem(m.cycle), /pins/);
  m.cycle.plan.pins = { q1: 'leve', fantasma: 'leve' }; assert.match(planProblem(m.cycle), /pins/);
});

// ---------------- servidor real ----------------
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
function boot(port, dir, env = {}) {
  const child = spawn(process.execPath, [INDEX], { env: { ...process.env, ...env, PORT: String(port), ORCH_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  return { child, out: () => out, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}
const waitUp = async (b) => { for (let i = 0; i < 100; i++) { if (/FORGE API em/.test(b.out())) return true; await Promise.race([new Promise((r) => setTimeout(r, 100)), b.exited]); } return false; };
const ORIGIN = 'http://localhost:5173';
const call = async (base, p, method = 'GET', body, headers = {}) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(method === 'GET' ? {} : { origin: ORIGIN }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

test('servidor real com token de sessão: sem o cabeçalho 403 (nada muda), sem Origin 403, com o token 200 e gravado; GET /api/state expõe orchestration.tiers e os padrões novos', async () => {
  const m = seed(); store.saveOrThrow();
  const dir = path.join(root, 'real1'); fs.mkdirSync(dir); fs.copyFileSync(path.join(dataDir, 'db.json'), path.join(dir, 'db.json'));
  const token = 'tok_' + 'a1B2c3D4'.repeat(5), port = await freePort(), b = boot(port, dir, { ORCH_API_TOKEN: token, ORCH_CYCLE_PLAN: '', ORCH_CYCLE_MAX_STEP_RETRIES: '', ORCH_TIER_LEVE: 'modelo-x:low' }), base = `http://127.0.0.1:${port}`, H = { 'x-orch-token': token };
  const url = `/api/missions/${m.id}/cycle/steps/q1/tier`;
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const o = (await call(base, '/api/state')).body.orchestration;
    assert.deepEqual([o.planMode, o.stepRetries, o.source], [true, 1, { planMode: 'default', stepRetries: 'default', autoClose: 'default' }]);
    assert.deepEqual(o.tiers, { leve: { model: 'modelo-x', effort: 'low' }, padrao: { ...TIERS.padrao }, profunda: { ...TIERS.profunda } }, 'tabela EFETIVA (com o override de ambiente)');
    const denied = await call(base, url, 'POST', { tier: 'leve' }); assert.equal(denied.status, 403, 'sem o token da interface não passa');
    const noOrigin = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ tier: 'leve' }) }); assert.equal(noOrigin.status, 403, 'mutante sem Origin é recusado pelo apiGuard');
    const evil = await call(base, url, 'POST', { tier: 'leve' }, { ...H, origin: 'http://evil.example' }); assert.equal(evil.status, 403);
    const get = await call(base, `/api/missions/${m.id}`, 'GET', undefined, H); assert.equal(get.status, 200); assert.ok(!('pins' in get.body.cycle.plan), 'nenhuma tentativa recusada gravou algo');
    const ok = await call(base, url, 'POST', { tier: 'leve' }, H); assert.deepEqual([ok.status, ok.body.ok, ok.body.route.tier, ok.body.route.model], [200, true, 'leve', 'modelo-x']);
    const after = (await call(base, `/api/missions/${m.id}`, 'GET', undefined, H)).body; assert.deepEqual(after.cycle.plan.pins, { q1: 'leve' }); assert.equal(after.cycle.plan.steps.find((s) => s.id === 'q1').route.source, 'pinned');
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).missions.find((x) => x.id === m.id); assert.deepEqual(disk.cycle.plan.pins, { q1: 'leve' }, 'gravado no db.json do servidor');
    assert.equal((await call(base, `/api/missions/${m.id}/cycle/steps/run1/tier`, 'POST', { tier: 'leve' }, H)).status, 409);
    assert.equal((await call(base, `/api/missions/${m.id}/cycle/steps/q1/tier`, 'POST', { tier: 'claude-opus-5-5' }, H)).status, 400);
  } finally { b.child.kill(); await b.exited; }
});

test('servidor real sem token: a rota segue exigindo Origin válido (apiGuard); ORCH_TIER_* inválido impede o boot sem tocar no diretório de dados', async () => {
  const m = seed(); store.saveOrThrow();
  const dir = path.join(root, 'real2'); fs.mkdirSync(dir); fs.copyFileSync(path.join(dataDir, 'db.json'), path.join(dir, 'db.json'));
  const port = await freePort(), b = boot(port, dir, { ORCH_API_TOKEN: '' }), base = `http://127.0.0.1:${port}`, url = `/api/missions/${m.id}/cycle/steps/q1/tier`;
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const noOrigin = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: 'leve' }) }); assert.equal(noOrigin.status, 403);
    assert.equal((await call(base, url, 'POST', { tier: 'profunda' })).status, 200);
    assert.deepEqual((await call(base, '/api/state')).body.orchestration.tiers, { leve: { ...TIERS.leve }, padrao: { ...TIERS.padrao }, profunda: { ...TIERS.profunda } });
  } finally { b.child.kill(); await b.exited; }
  for (const env of [{ ORCH_TIER_LEVE: 'sem-esforco' }, { ORCH_TIER_PADRAO: 'modelo:ultra' }, { ORCH_TIER_PROFUNDA: '--flag:high' }]) {
    const empty = path.join(root, `bad-${Object.keys(env)[0]}`); fs.mkdirSync(empty);
    const bad = boot(await freePort(), empty, env), code = await Promise.race([bad.exited, new Promise((r) => setTimeout(() => r('preso'), 15000))]);
    if (code === 'preso') bad.child.kill();
    assert.notEqual(code, 'preso', JSON.stringify(env)); assert.notEqual(code, 0, JSON.stringify(env)); assert.match(bad.out(), /ORCH_TIER_/); assert.deepEqual(fs.readdirSync(empty), [], 'nada foi criado no diretório de dados');
  }
});
