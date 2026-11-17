// Missions v2: rotas HTTP /api/flows (setupFlows) em porta e banco TEMPORÁRIOS (ORCH_DATA_DIR), com terminais e Maestro simulados (nenhum Claude/Codex real, nunca a 4317).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-routes-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const DB_FILE = path.join(process.env.ORCH_DATA_DIR, 'db.json');
const { default: express } = await import('express');
const store = await import('../store.js');
const F = await import('../flows.js');
const { apiGuard } = await import('../origin-guard.js');

const hex = (n) => n.toString(16).padStart(8, '0');
let db, server, base, flows, failPersist = false, tn = 0;
const terms = new Map(), tasks = new Map(), created = [];
const terminals = {
  async create(o) { created.push(o); const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { state: 'idle', at: '2026-11-10T10:00:00.000Z' } }); return { ok: true, status: 201, session: { id } }; },
  peek: (id) => terms.get(id) ?? null, close: (id) => { const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
  count: () => [...terms.values()].filter((t) => t.status === 'running').length, providers: () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
};
const maestro = { dispatch: () => { const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); return { ok: true, taskId: id }; }, taskState: (id) => tasks.get(id) ?? null };
const disk = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const call = (url, method = 'GET', body, headers = {}) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const jr = async (r) => { const text = await r.text(); return { status: r.status, j: text ? JSON.parse(text) : null }; };
const body = (over = {}) => ({ workspaceId: 'ws_1', title: 'Minha missão', goal: 'Construir X', steps: [{ id: 's1', title: 'Passo 1', prompt: 'Faça 1', provider: 'claude', role: 'builder' }, { id: 's2', title: 'Passo 2', prompt: 'Faça 2', provider: 'codex', role: 'reviewer', model: 'gpt-5', effort: 'high', dependsOn: ['s1'] }], ...over });

before(async () => {
  db = store.load();
  const wsDir = path.join(root, 'proj'); fs.mkdirSync(wsDir);
  db.workspaces.push({ id: 'ws_1', name: 'proj', path: wsDir });
  // run órfão de um servidor anterior: o boot (setupFlows) o converte em failed e grava
  db.flows = [{ id: 'flow_0000beef', workspaceId: 'ws_1', title: 'Antiga', goal: '', kind: 'project', fullAccess: false, maxParallel: 1, schedule: null, steps: [{ id: 's1', title: 'A', prompt: 'a', provider: 'claude', role: 'builder', model: null, effort: null, dependsOn: [], continueFrom: null }], createdAt: 't', updatedAt: 't', archived: false }];
  db.flowRuns = [{ id: 'run_0000beef', flowId: 'flow_0000beef', status: 'running', startedAt: 't', finishedAt: null, trigger: 'manual', error: null, ownedTerminalIds: [], steps: [{ stepId: 's1', title: 'A', status: 'running', terminalId: 'term_deadbeef', taskId: 'task_deadbeef', startedAt: 't', finishedAt: null, summary: null, error: null }] }];
  store.saveOrThrow();
  const app = express();
  app.use('/api', apiGuard); app.use(express.json({ limit: '100kb' }));
  flows = F.setupFlows(app, { db, terminals, maestro, persist: () => { if (failPersist) throw new Error('disco'); store.saveOrThrow(); }, pollMs: 0 });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { flows.stop(); await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

test('boot: run `running` órfão virou failed (com motivo) e isso foi gravado no disco', async () => {
  const r = await jr(await call('/api/flows/flow_0000beef/runs/run_0000beef')); assert.equal(r.status, 200);
  assert.equal(r.j.status, 'failed'); assert.match(r.j.error, /Servidor reiniciado/); assert.equal(r.j.steps[0].status, 'failed'); assert.ok(!('ownedTerminalIds' in r.j));
  assert.equal(disk().flowRuns[0].status, 'failed');
});

test('Host/Origin: mutações sem Origin ou com Origin externo são recusadas (403) e nada é criado; leitura com Origin externo também', async () => {
  const n = db.flows.length;
  const noOrigin = await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) }); assert.equal(noOrigin.status, 403);
  assert.equal((await call('/api/flows', 'POST', body(), { origin: 'http://evil.example' })).status, 403);
  assert.equal((await call('/api/flows', 'GET', undefined, { origin: 'http://evil.example' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const rq = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/flows', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }); rq.on('error', reject); rq.end(); }); // fetch não deixa trocar o Host
  assert.equal(hostStatus, 403, 'Host que não é local (DNS rebinding)');
  assert.equal(db.flows.length, n);
});

let flowId;
test('POST /api/flows: 201 com id do servidor, persistido; a lista traz workspaceName, lastRun e activeRun', async () => {
  const r = await jr(await call('/api/flows', 'POST', body()));
  assert.equal(r.status, 201); const f = r.j; flowId = f.id;
  assert.match(f.id, /^flow_[0-9a-f]{8}$/); assert.deepEqual([f.workspaceId, f.title, f.goal, f.kind, f.fullAccess, f.maxParallel, f.schedule, f.archived], ['ws_1', 'Minha missão', 'Construir X', 'project', false, 1, null, false]);
  assert.ok(f.createdAt && f.updatedAt); assert.equal(f.workspaceName, 'proj'); assert.equal(f.lastRun, null); assert.equal(f.activeRun, null);
  assert.deepEqual(f.steps[1], { id: 's2', title: 'Passo 2', prompt: 'Faça 2', provider: 'codex', role: 'reviewer', model: 'gpt-5', effort: 'high', dependsOn: ['s1'], continueFrom: null });
  assert.equal(disk().flows.find((x) => x.id === f.id).title, 'Minha missão');
  const list = await jr(await call('/api/flows')); assert.equal(list.status, 200); assert.equal(list.j.length, 2);
  const mine = list.j.find((x) => x.id === f.id); assert.equal(mine.workspaceName, 'proj'); assert.equal(mine.lastRun, null);
  assert.equal(list.j.find((x) => x.id === 'flow_0000beef').lastRun.status, 'failed');
  assert.equal((await jr(await call(`/api/flows/${f.id}`))).j.id, f.id);
});

test('POST /api/flows: validação (400 em português): id vindo do cliente, caminho/comando, ciclo, dependência desconhecida, workspace inexistente, fullAccess não booleano', async () => {
  const bad = async (b, re) => { const r = await jr(await call('/api/flows', 'POST', b)); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 100)); assert.match(r.j.error, re); };
  await bad(body({ id: 'flow_00000001' }), /não permitidas/);
  await bad(body({ cwd: '/etc' }), /não permitidas/);
  await bad(body({ steps: [{ title: 'x', prompt: 'y', provider: 'claude', role: 'builder', command: 'rm -rf /' }] }), /não permitidas/);
  await bad(body({ workspaceId: 'ws_nao_existe' }), /Espaço de trabalho não encontrado/);
  await bad(body({ fullAccess: 'true' }), /fullAccess/); await bad(body({ fullAccess: 1 }), /fullAccess/);
  await bad(body({ steps: [{ id: 's1', title: 'a', prompt: 'a', provider: 'claude', role: 'builder', dependsOn: ['s2'] }, { id: 's2', title: 'b', prompt: 'b', provider: 'claude', role: 'builder', dependsOn: ['s1'] }] }), /ciclo/);
  await bad(body({ steps: [{ id: 's1', title: 'a', prompt: 'a', provider: 'claude', role: 'builder', dependsOn: ['s7'] }] }), /não existe/);
  await bad(body({ steps: [{ title: 'a', prompt: 'a', provider: 'gemini', role: 'builder' }] }), /provider/);
  await bad(body({ steps: [{ title: 'a', prompt: 'a', provider: 'claude', role: 'maestro' }] }), /role/);
  await bad(body({ steps: [] }), /1 a 12/); await bad(body({ maxParallel: 9 }), /maxParallel/); await bad(body({ title: '' }), /title/);
  const arr = await jr(await call('/api/flows', 'POST', [1])); assert.equal(arr.status, 400);
  const raw = await fetch(`${base}/api/flows`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{nao e json' }); assert.equal(raw.status, 400);
  assert.equal(db.flows.length, 2, 'nada foi criado');
});

test('PATCH /api/flows/:id: edita título, objetivo, etapas, fullAccess, maxParallel e archived; campos não editáveis e ids inválidos são recusados', async () => {
  const r = await jr(await call(`/api/flows/${flowId}`, 'PATCH', { title: 'Novo título', goal: 'Outro', maxParallel: 2, fullAccess: true, steps: [{ id: 's1', title: 'Só um', prompt: 'p', provider: 'claude', role: 'scout' }] }));
  assert.equal(r.status, 200); assert.deepEqual([r.j.title, r.j.goal, r.j.maxParallel, r.j.fullAccess, r.j.steps.length, r.j.workspaceId], ['Novo título', 'Outro', 2, true, 1, 'ws_1']);
  assert.ok(Date.parse(r.j.updatedAt) >= Date.parse(r.j.createdAt)); assert.equal(disk().flows.find((x) => x.id === flowId).fullAccess, true);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { workspaceId: 'ws_9' }))).status, 400);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { kind: 'automation' }))).status, 400);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', {}))).status, 400);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { fullAccess: 'true' }))).status, 400);
  assert.equal((await jr(await call('/api/flows/flow_00000000', 'PATCH', { title: 'x' }))).status, 404);
  for (const id of ['x', '..%2Fdb', 'flow_ZZZZZZZZ']) assert.equal((await jr(await call(`/api/flows/${id}`))).status, 404, id);
  assert.equal(db.flows.find((x) => x.id === flowId).title, 'Novo título');
  await call(`/api/flows/${flowId}`, 'PATCH', { fullAccess: false });
});

test('POST /api/flows/:id/runs: 201, 409 se já houver run ativo, e o run progride pelo runner (tick); GET runs/run; PATCH e DELETE com run ativo = 409', async () => {
  const r = await jr(await call(`/api/flows/${flowId}/runs`, 'POST')); assert.equal(r.status, 201);
  const run = r.j; assert.match(run.id, /^run_[0-9a-f]{8}$/); assert.deepEqual([run.flowId, run.status, run.trigger, run.finishedAt], [flowId, 'running', 'manual', null]);
  assert.deepEqual(Object.keys(run.steps[0]).sort(), ['error', 'finishedAt', 'startedAt', 'status', 'stepId', 'summary', 'taskId', 'terminalId', 'title']);
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs`, 'POST'))).status, 409);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { title: 'x' }))).status, 409); assert.equal((await jr(await call(`/api/flows/${flowId}`, 'DELETE'))).status, 409);
  await flows.tick();
  const got = await jr(await call(`/api/flows/${flowId}/runs/${run.id}`)); assert.equal(got.status, 200); assert.equal(got.j.steps[0].status, 'running'); assert.match(got.j.steps[0].terminalId, /^term_/); assert.match(got.j.steps[0].taskId, /^task_/);
  assert.equal(created.at(-1).workspaceId, 'ws_1'); assert.equal(created.at(-1).fullAccess, false);
  const list = await jr(await call(`/api/flows/${flowId}/runs`)); assert.equal(list.status, 200); assert.equal(list.j.length, 1); assert.equal(list.j[0].id, run.id);
  assert.equal((await jr(await call('/api/flows'))).j.find((x) => x.id === flowId).activeRun.id, run.id);
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs/run_00000000`))).status, 404);
  assert.equal((await jr(await call(`/api/flows/flow_0000beef/runs/${run.id}`))).status, 404, 'o run pertence a outra missão');
  tasks.get(got.j.steps[0].taskId).status = 'done'; tasks.get(got.j.steps[0].taskId).summary = 'ok'; await flows.tick();
  const mid = (await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j; assert.equal(mid.status, 'completed', 'a missão ficou com 1 etapa depois da edição');
});

test('cancelar: POST .../cancel devolve o run cancelado, fecha o terminal do run; cancelar de novo = 409; ids inválidos = 404', async () => {
  const run = (await jr(await call(`/api/flows/${flowId}/runs`, 'POST'))).j; await flows.tick();
  const tid = (await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j.steps[0].terminalId;
  const r = await jr(await call(`/api/flows/${flowId}/runs/${run.id}/cancel`, 'POST')); assert.equal(r.status, 200); assert.equal(r.j.status, 'cancelled'); assert.equal(r.j.steps[0].status, 'cancelled');
  assert.equal(terms.get(tid).status, 'exited'); assert.equal(disk().flowRuns.find((x) => x.id === run.id).status, 'cancelled');
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs/${run.id}/cancel`, 'POST'))).status, 409);
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs/run_00000000/cancel`, 'POST'))).status, 404); assert.equal((await jr(await call(`/api/flows/nada/runs/${run.id}/cancel`, 'POST'))).status, 404);
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs/${run.id}/cancel`, 'POST', undefined, { origin: 'http://evil.example' }))).status, 403);
});

test('falha de persistência: 500 em português e NADA muda (criar, editar, remover, iniciar run, cancelar)', async () => {
  const snap = structuredClone({ flows: db.flows, runs: db.flowRuns });
  failPersist = true;
  try {
    for (const [url, method, b] of [['/api/flows', 'POST', body()], [`/api/flows/${flowId}`, 'PATCH', { title: 'zzz' }], [`/api/flows/${flowId}`, 'DELETE'], [`/api/flows/${flowId}/runs`, 'POST']]) {
      const r = await jr(await call(url, method, b)); assert.equal(r.status, 500, `${method} ${url}`); assert.match(r.j.error, /banco não pôde ser gravado; nada foi alterado/);
    }
  } finally { failPersist = false; }
  assert.deepEqual({ flows: db.flows, runs: db.flowRuns }, snap);
  const run = (await jr(await call(`/api/flows/${flowId}/runs`, 'POST'))).j; await flows.tick();
  failPersist = true; const c = await jr(await call(`/api/flows/${flowId}/runs/${run.id}/cancel`, 'POST')); failPersist = false;
  assert.equal(c.status, 500); assert.equal((await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j.status, 'running');
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs/${run.id}/cancel`, 'POST'))).status, 200);
});

test('DELETE: 204, remove a missão e os runs dela (também no disco); depois 404', async () => {
  const n = db.flowRuns.filter((r) => r.flowId === flowId).length; assert.ok(n >= 2);
  const r = await call(`/api/flows/${flowId}`, 'DELETE'); assert.equal(r.status, 204); assert.equal(await r.text(), '');
  assert.ok(!db.flowRuns.some((x) => x.flowId === flowId)); assert.ok(!disk().flows.some((x) => x.id === flowId) && !disk().flowRuns.some((x) => x.flowId === flowId));
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'DELETE'))).status, 404);
  assert.equal((await jr(await call(`/api/flows/${flowId}/runs`))).status, 404);
});

test('iniciar run recusado: missão arquivada e provedor sem terminal disponível (409); a missão antiga continua intacta', async () => {
  const f = (await jr(await call('/api/flows', 'POST', body()))).j;
  await call(`/api/flows/${f.id}`, 'PATCH', { archived: true }); assert.equal((await jr(await call(`/api/flows/${f.id}/runs`, 'POST'))).status, 409);
  await call(`/api/flows/${f.id}`, 'PATCH', { archived: false });
  const orig = terminals.count; terminals.count = () => 50; const r = await jr(await call(`/api/flows/${f.id}/runs`, 'POST')); terminals.count = orig;
  assert.equal(r.status, 409); assert.match(r.j.error, /Sem terminais disponíveis/);
  assert.equal(db.flowRuns.filter((x) => x.flowId === f.id).length, 0);
});
