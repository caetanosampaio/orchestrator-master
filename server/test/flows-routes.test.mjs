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
let db, server, base, flows, failPersist = false, tn = 0, schedNow = null;
const schedTimers = []; // temporizador do agendador das automações: falso (nenhum timer real); os testes chamam flows.scheduler.tick()
const terms = new Map(), tasks = new Map(), created = [];
const terminals = {
  async create(o) { created.push(o); const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { state: 'idle', at: '2026-11-10T10:00:00.000Z' } }); return { ok: true, status: 201, session: { id } }; },
  peek: (id) => terms.get(id) ?? null, close: (id) => { const t = terms.get(id); if (t) t.status = 'exited'; return { ok: true }; },
  count: () => [...terms.values()].filter((t) => t.status === 'running').length, providers: () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
};
const sent = []; // textos entregues pelo Maestro simulado
const maestro = { dispatch: (d) => { const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); sent.push({ ...d, taskId: id }); return { ok: true, taskId: id }; }, taskState: (id) => tasks.get(id) ?? null };
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
  flows = F.setupFlows(app, { db, terminals, maestro, persist: () => { if (failPersist) throw new Error('disco'); store.saveOrThrow(); }, pollMs: 0,
    scheduler: { now: () => schedNow ?? Date.now(), setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; schedTimers.push(t); return t; }, clearTimer: (t) => { const i = schedTimers.indexOf(t); if (i >= 0) schedTimers.splice(i, 1); }, onError: () => {} } });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { flows.stop(); await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

test('boot: run `running` órfão virou interrupted (com motivo, esperando Retomar), nada foi reaberto e isso foi gravado no disco', async () => {
  const r = await jr(await call('/api/flows/flow_0000beef/runs/run_0000beef')); assert.equal(r.status, 200);
  assert.equal(r.j.status, 'interrupted'); assert.match(r.j.error, /Servidor reiniciado.*Retomar/); assert.ok(r.j.interruptedAt); assert.equal(r.j.finishedAt, null); assert.ok(!('ownedTerminalIds' in r.j));
  assert.deepEqual([r.j.steps[0].status, r.j.steps[0].interruptedFrom, r.j.steps[0].delivered, r.j.steps[0].taskId], ['interrupted', 'running', true, null]);
  const saved = disk().flowRuns[0]; assert.equal(saved.status, 'interrupted'); assert.equal(saved.steps[0].status, 'interrupted');
  assert.equal(created.length, 0, 'nada é retomado sozinho no boot');
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
  const old = list.j.find((x) => x.id === 'flow_0000beef'); assert.equal(old.lastRun.status, 'interrupted'); assert.equal(old.activeRun.id, 'run_0000beef', 'interrompido conta como ativo');
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
  // fatia 2: kind passou a ser editável (automação sem agenda vale); tipo inexistente e agenda em projeto continuam 400
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { kind: 'cron' }))).status, 400);
  assert.equal((await jr(await call(`/api/flows/${flowId}`, 'PATCH', { schedule: { kind: 'daily', time: '09:00' } }))).status, 400);
  assert.equal(db.flows.find((x) => x.id === flowId).kind, 'project');
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

test('decisão sobre etapa que parou sem report_done: POST .../steps/:stepId/decision aceita (gravado no disco); inválida = 400, sem o estado certo = 409, ids = 404, Origin externo = 403', async () => {
  const run = (await jr(await call(`/api/flows/${flowId}/runs`, 'POST'))).j; await flows.tick();
  const url = (s = 's1', r = run.id, f = flowId) => `/api/flows/${f}/runs/${r}/steps/${s}/decision`;
  assert.equal((await jr(await call(url(), 'POST', { decision: 'accept' }))).status, 409, 'etapa trabalhando: nada a decidir');
  const step = (await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j.steps[0];
  Object.assign(tasks.get(step.taskId), { status: 'done', summary: 'Relatório automático (sem report_done), fim do terminal: ok?', auto: true }); await flows.tick();
  const mid = (await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j.steps[0]; assert.deepEqual([mid.status, mid.unconfirmed], ['waiting', true]);
  assert.equal((await jr(await call(url(), 'POST', { decision: 'sim' }))).status, 400);
  assert.equal((await jr(await call(url('s9'), 'POST', { decision: 'accept' }))).status, 404); assert.equal((await jr(await call(url('s1', 'run_00000000'), 'POST', { decision: 'accept' }))).status, 404);
  assert.equal((await jr(await call(url(), 'POST', { decision: 'accept' }, { origin: 'http://evil.example' }))).status, 403);
  const ok = await jr(await call(url(), 'POST', { decision: 'accept' })); assert.equal(ok.status, 200); assert.deepEqual([ok.j.steps[0].status, ok.j.steps[0].completedBy, ok.j.steps[0].decidedBy], ['completed', 'user', 'user']);
  const saved = disk().flowRuns.find((x) => x.id === run.id).steps[0]; assert.deepEqual([saved.status, saved.decidedBy], ['completed', 'user']); assert.ok(saved.decidedAt);
  await flows.tick(); assert.equal((await jr(await call(`/api/flows/${flowId}/runs/${run.id}`))).j.status, 'completed');
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

test('retomar: POST .../resume reabre o run interrompido do boot (terminal novo na pasta + texto de retomada), gravado no disco; Origin externo 403, corpo com chaves 400, ids 404, sem vagas/gravação/estado 409/500', async () => {
  const url = (r = 'run_0000beef', f = 'flow_0000beef') => `/api/flows/${f}/runs/${r}/resume`;
  const statusNow = () => db.flowRuns.find((x) => x.id === 'run_0000beef').status;
  assert.equal((await jr(await call(url(), 'POST', {}, { origin: 'http://evil.example' }))).status, 403);
  const noOrigin = await fetch(`${base}${url()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(noOrigin.status, 403);
  assert.equal(statusNow(), 'interrupted', 'nada mudou com a requisição recusada');
  assert.equal((await jr(await call(url('run_00000000'), 'POST', {}))).status, 404); assert.equal((await jr(await call(url('run_0000beef', 'flow_00000000'), 'POST', {}))).status, 404);
  assert.equal((await jr(await call(url('..%2Fx'), 'POST', {}))).status, 404);
  const extra = await jr(await call(url(), 'POST', { acknowledgeProjectConfig: true })); assert.equal(extra.status, 400); assert.match(extra.j.error, /corpo vazio/);
  const orig = terminals.count; terminals.count = () => 50; const full = await jr(await call(url(), 'POST', {})); terminals.count = orig;
  assert.equal(full.status, 409); assert.equal(full.j.code, 'no_slots'); assert.match(full.j.error, /Sem terminais disponíveis/);
  failPersist = true; const broken = await jr(await call(url(), 'POST', {})); failPersist = false;
  assert.equal(broken.status, 500); assert.match(broken.j.error, /nada foi alterado/); assert.equal(statusNow(), 'interrupted'); assert.equal(disk().flowRuns.find((x) => x.id === 'run_0000beef').status, 'interrupted');
  const n = created.length;
  const ok = await jr(await call(url(), 'POST')); assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.deepEqual([ok.j.status, ok.j.resumes, ok.j.error], ['running', 1, null]); assert.ok(ok.j.resumedAt); assert.ok(!('ownedTerminalIds' in ok.j));
  const second = await jr(await call(url(), 'POST', {})); assert.equal(second.status, 409, 'retomar duas vezes'); assert.ok(['busy', 'not_interrupted'].includes(second.j.code), second.j.code);
  await flows.tick();
  const got = (await jr(await call('/api/flows/flow_0000beef/runs/run_0000beef'))).j, st = got.steps[0];
  assert.equal(created.length, n + 1, 'um terminal novo (a interface simulada não tem resume: cai no create)'); assert.deepEqual(created.at(-1), { workspaceId: 'ws_1', role: 'builder', provider: 'claude', model: null, effort: null, title: 'A', fullAccess: false });
  assert.deepEqual([st.status, st.resumeMode, st.resumePending], ['running', 'restart', false]); assert.match(st.terminalId, /^term_/); assert.notEqual(st.terminalId, 'term_deadbeef'); assert.equal(terms.get(st.terminalId).status, 'running'); assert.ok(!('recordId' in st));
  assert.equal(sent.at(-1).text, '[Missão: Antiga] Etapa "A": a (Retomada: pode haver trabalho parcial desta etapa nesta pasta; confira antes de refazer.)'); assert.equal(st.taskId, sent.at(-1).taskId);
  const saved = disk().flowRuns.find((x) => x.id === 'run_0000beef'); assert.deepEqual([saved.status, saved.resumes, saved.steps[0].resumeMode], ['running', 1, 'restart']);
  Object.assign(tasks.get(st.taskId), { status: 'done', summary: 'ok' }); await flows.tick();
  assert.equal((await jr(await call('/api/flows/flow_0000beef/runs/run_0000beef'))).j.status, 'completed');
  const late = await jr(await call(url(), 'POST', {})); assert.equal(late.status, 409); assert.equal(late.j.code, 'not_interrupted');
});

// ---------- agenda das automações (fatia 2) ----------
const FV = await import('../../client/src/flows-view.js'); // o corpo que o cliente realmente manda (draftToBody / draftToScheduleBody)
const autoBody = (over = {}) => body({ kind: 'automation', schedule: { kind: 'interval', everyHours: 2 }, autoIntegrate: false, steps: [{ id: 's1', title: 'Rotina', prompt: 'Rode a rotina', provider: 'claude', role: 'builder' }], ...over });

let autoId;
test('agenda via HTTP: POST com schedule/autoIntegrate (201, nextRunAt, sem estado interno); agenda em projeto, formato inválido e autoIntegrate não booleano = 400', async () => {
  assert.equal(schedTimers.length, 1, 'o setupFlows ligou o agendador uma vez (temporizador injetado)');
  const bad = async (b, re) => { const r = await jr(await call('/api/flows', 'POST', b)); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 100)); assert.match(r.j.error, re); };
  const n = db.flows.length;
  await bad(body({ schedule: { kind: 'interval', everyHours: 2 } }), /automação/);
  await bad(autoBody({ schedule: { kind: 'interval', everyHours: 0 } }), /everyHours/);
  await bad(autoBody({ schedule: '0 * * * *' }), /schedule/);
  await bad(autoBody({ autoIntegrate: 'true' }), /autoIntegrate/);
  assert.equal(db.flows.length, n, 'nada foi criado');
  const t0 = Date.now(), r = await jr(await call('/api/flows', 'POST', autoBody())), t1 = Date.now();
  assert.equal(r.status, 201, JSON.stringify(r.j)); autoId = r.j.id;
  assert.deepEqual([r.j.kind, r.j.schedule, r.j.autoIntegrate, r.j.scheduleSkips], ['automation', { enabled: true, kind: 'interval', everyHours: 2 }, false, []]);
  const next = Date.parse(r.j.nextRunAt); assert.ok(next >= t0 + 2 * 3_600_000 - 1000 && next <= t1 + 2 * 3_600_000 + 1000, r.j.nextRunAt);
  assert.ok(!('scheduleState' in r.j));
  const saved = disk().flows.find((x) => x.id === autoId); assert.equal(saved.scheduleState.nextRunAt, r.j.nextRunAt); assert.equal(saved.autoIntegrate, false);
  const listed = (await jr(await call('/api/flows'))).j.find((x) => x.id === autoId); assert.deepEqual([listed.nextRunAt, listed.autoIntegrate, 'scheduleState' in listed], [r.j.nextRunAt, false, false]);
  const proj = (await jr(await call('/api/flows'))).j.find((x) => x.id === 'flow_0000beef'); assert.deepEqual([proj.nextRunAt, proj.scheduleSkips, proj.autoIntegrate], [null, [], true], 'missão antiga');
});

test('agenda via HTTP: PATCH com o corpo completo do cliente; horário vencido dispara run de agenda; com run ativo só schedule/autoIntegrate (o resto 409); mudar o tipo exige schedule null', async () => {
  const cur = (await jr(await call(`/api/flows/${autoId}`))).j;
  const draft = FV.flowToDraft(cur);
  const edit = await jr(await call(`/api/flows/${autoId}`, 'PATCH', FV.draftToBody({ ...draft, title: 'Rotina noturna' }, { mode: 'edit' })));
  assert.equal(edit.status, 200, JSON.stringify(edit.j)); assert.equal(edit.j.title, 'Rotina noturna'); assert.equal(edit.j.nextRunAt, cur.nextRunAt, 'mesma agenda: o próximo horário não muda');
  // o horário chega (relógio do agendador injetado) e o agendador inicia o run
  schedNow = Date.parse(cur.nextRunAt) + 1000;
  try { await flows.scheduler.tick(); } finally { schedNow = null; }
  const runs = (await jr(await call(`/api/flows/${autoId}/runs`))).j; assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].trigger, runs[0].scheduledFor, runs[0].status], ['schedule', cur.nextRunAt, 'running']);
  await flows.tick();
  // run ativo: corpo completo e campos comuns = 409; só agenda/integração = 200 (o próximo horário recalcula a partir de agora)
  assert.equal((await jr(await call(`/api/flows/${autoId}`, 'PATCH', FV.draftToBody(draft, { mode: 'edit' })))).status, 409);
  assert.equal((await jr(await call(`/api/flows/${autoId}`, 'PATCH', { title: 'x' }))).status, 409);
  assert.equal((await jr(await call(`/api/flows/${autoId}`, 'PATCH', { kind: 'project', schedule: null }))).status, 409);
  const t0 = Date.now();
  const sch = await jr(await call(`/api/flows/${autoId}`, 'PATCH', FV.draftToScheduleBody({ ...draft, autoIntegrate: true, schedule: { ...draft.schedule, kind: 'interval', everyHours: 5 } })));
  assert.equal(sch.status, 200, JSON.stringify(sch.j)); assert.deepEqual([sch.j.schedule.everyHours, sch.j.autoIntegrate, sch.j.activeRun.id], [5, true, runs[0].id]);
  assert.ok(Date.parse(sch.j.nextRunAt) >= t0 + 5 * 3_600_000 - 1000, sch.j.nextRunAt);
  assert.equal(disk().flows.find((x) => x.id === autoId).scheduleState.nextRunAt, sch.j.nextRunAt);
  assert.equal((await jr(await call(`/api/flows/${autoId}`, 'PATCH', { schedule: { kind: 'interval', everyHours: 999 } }))).status, 400);
  assert.equal((await jr(await call(`/api/flows/${autoId}/runs/${runs[0].id}/cancel`, 'POST'))).status, 200);
  // tipo: virar projeto sem zerar a agenda = 400 (nada muda); com schedule null = 200 e sem próximo horário
  const k1 = await jr(await call(`/api/flows/${autoId}`, 'PATCH', { kind: 'project' })); assert.equal(k1.status, 400); assert.match(k1.j.error, /schedule: null/);
  assert.equal(db.flows.find((x) => x.id === autoId).kind, 'automation');
  const k2 = await jr(await call(`/api/flows/${autoId}`, 'PATCH', FV.draftToBody({ ...FV.flowToDraft(sch.j), kind: 'project' }, { mode: 'edit' })));
  assert.equal(k2.status, 200, JSON.stringify(k2.j)); assert.deepEqual([k2.j.kind, k2.j.schedule, k2.j.nextRunAt], ['project', null, null]);
  assert.equal(disk().flows.find((x) => x.id === autoId).scheduleState.nextRunAt, null);
  // falha de gravação ao editar a agenda: 500 e nada muda
  const k3 = await jr(await call(`/api/flows/${autoId}`, 'PATCH', { kind: 'automation', schedule: { kind: 'daily', time: '09:00' } })); assert.equal(k3.status, 200); assert.ok(k3.j.nextRunAt);
  const snap = structuredClone(db.flows.find((x) => x.id === autoId));
  failPersist = true; const k4 = await jr(await call(`/api/flows/${autoId}`, 'PATCH', { schedule: { kind: 'interval', everyHours: 1 } })); failPersist = false;
  assert.equal(k4.status, 500); assert.deepEqual(db.flows.find((x) => x.id === autoId), snap);
});

// ---------- modo Git (fatia 2, F7): rotas integrate / discard / cleanup / integração da etapa ----------
// Servidor e banco PRÓPRIOS (outro runner, porta temporária 0) com um flowGit FALSO e programável: a lógica Git real é coberta em flows-git-runner.test.mjs; aqui só o contrato HTTP.
const SHA = (c) => c.repeat(40);
let gitSrv = null;
async function gitServer() {
  if (gitSrv) return gitSrv;
  const db2 = { settings: {}, workspaces: [{ id: 'ws_g', name: 'g', path: path.join(root, 'proj') }], worktrees: [], flows: [], flowRuns: [] };
  let wn = 0;
  const fg = {
    calls: [], stepPlan: [], finalPlan: [], leftovers: [], gate: null,
    async probe() { return { mode: 'git', repoPath: path.join(root, 'repo-secreto'), baseBranch: 'main', baseCommit: SHA('a') }; },
    async createMissionBranch(run, p) { run.git = { mode: 'git', fallbackReason: null, repoPath: p.repoPath, baseBranch: p.baseBranch, baseCommit: p.baseCommit, branch: `orch/${run.id}`, tip: p.baseCommit, state: 'ready', op: null, integration: null, pending: null, leftovers: [] }; return { ok: true, git: run.git }; },
    async stepWorktree(run, rs) { const id = `wt_${hex(0xc0000000 + ++wn)}`; db2.worktrees.push({ id, path: path.join(root, 'wts', id), flow: { runId: run.id, stepIds: [rs.stepId] } }); rs.worktreeId = id; rs.branch = `orch/${id}`; return { ok: true, worktreeId: id }; },
    async refreshForContinue() { return { ok: true }; },
    async configAudit(run, wtId) { fg.calls.push(['configAudit', wtId]); return { ok: true, files: [] }; },
    async integrateStep(run, rs, o = {}) {
      fg.calls.push(['integrateStep', rs.stepId, o.acknowledgeProjectConfig === true, o.acknowledgedFiles ?? null]);
      if ((fg.stepPlan.shift() ?? 'integrated') === 'integrated') { rs.integration = { state: 'integrated', from: run.git.tip, to: SHA('b'), conflicts: [], files: [], error: null, at: 't' }; run.git.tip = SHA('b'); return { ok: true, state: 'integrated', integration: rs.integration }; }
      rs.integration = { state: 'conflict', from: run.git.tip, to: null, conflicts: ['a.txt'], files: [], error: 'conflito com o que já foi integrado na missão (a.txt)', at: 't' };
      return { ok: false, code: 'conflict', state: 'conflict', integration: rs.integration, error: rs.integration.error };
    },
    async assessFinal() { return { reasons: [], conflicts: [], files: [] }; },
    async integrateFinal(run, o) {
      fg.calls.push(['integrateFinal', o.by, o.acknowledgeProjectConfig === true, o.acknowledgedFiles ?? null]);
      if (fg.gate) await fg.gate;
      const next = fg.finalPlan.shift() ?? 'ok';
      if (next === 'ok') { run.git.integration = { by: o.by, mode: 'ff', at: 't', from: SHA('a'), to: run.git.tip, missionTip: run.git.tip, digest: 'f'.repeat(32), policy: o.by === 'auto' ? 'autoIntegrate' : 'user' }; run.git.pending = null; return { ok: true, integration: run.git.integration }; }
      run.git.pending = { reasons: [{ code: next, message: 'motivo' }], conflicts: next === 'conflict' ? ['a.txt'] : [], files: next === 'project_config_changed' ? ['.mcp.json'] : [], checkedAt: 't' };
      return { ok: false, code: next, error: `Integração recusada: ${next}. Nada foi alterado.`, conflicts: run.git.pending.conflicts, files: run.git.pending.files };
    },
    async cleanupRun(run, o = {}) { fg.calls.push(['cleanupRun', o.keepBranch === true]); run.git.leftovers = [...fg.leftovers]; run.git.cleanedAt = 't'; if (o.keepBranch !== true) run.git.branchDeleted = !run.git.leftovers.length; return { ok: true, leftovers: run.git.leftovers }; },
    async discard(run, o) { fg.calls.push(['discard', o.deleteBranch === true]); run.git.leftovers = [...fg.leftovers]; run.git.branchDeleted = o.deleteBranch === true; run.git.discardedAt = 't'; return { ok: true, leftovers: run.git.leftovers }; },
    async settle() { return { ok: true, changed: [] }; },
  };
  const created2 = [];
  const terminals2 = { ...terminals, async create(o, x) { created2.push(x); return terminals.create(o); } };
  let failPersist2 = false;
  const app2 = express();
  app2.use('/api', apiGuard); app2.use(express.json({ limit: '100kb' }));
  const flows2 = F.setupFlows(app2, { db: db2, terminals: terminals2, maestro, flowGit: fg, persist: () => { if (failPersist2) throw new Error('disco'); }, pollMs: 0, scheduler: false });
  app2.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  const srv = await new Promise((r) => { const s = app2.listen(0, '127.0.0.1', () => r(s)); });
  const base2 = `http://127.0.0.1:${srv.address().port}`;
  const call2 = (url, method = 'GET', b, headers = {}) => fetch(`${base2}${url}`, { method, headers: { 'content-type': 'application/json', origin: base2, ...headers }, body: b === undefined ? undefined : JSON.stringify(b) });
  gitSrv = { db2, fg, created2, flows2, srv, call2, setFail: (v) => { failPersist2 = v; } };
  return gitSrv;
}
after(async () => { if (gitSrv) { gitSrv.flows2.stop(); await new Promise((r) => gitSrv.srv.close(r)); } });
const evil = { origin: 'http://evil.example' };

test('modo Git via HTTP: etapa em conflito (caminho do worktree só nela, sem repoPath) e POST .../steps/:stepId/integration: 403/404/400/409/500 e retry com ack 200', async () => {
  const { db2, fg, created2, flows2, call2, setFail } = await gitServer();
  const f = (await jr(await call2('/api/flows', 'POST', body({ workspaceId: 'ws_g', steps: [{ id: 's1', title: 'Passo 1', prompt: 'Faça 1', provider: 'claude', role: 'builder' }] })))).j;
  const run = (await jr(await call2(`/api/flows/${f.id}/runs`, 'POST'))).j; assert.deepEqual(run.git, { mode: 'pending' });
  await flows2.tick();
  const r1 = (await jr(await call2(`/api/flows/${f.id}/runs/${run.id}`))).j;
  assert.equal(r1.git.mode, 'git'); assert.equal(r1.git.branch, `orch/${run.id}`); assert.ok(!('repoPath' in r1.git)); assert.match(created2[0]?.flowWorktreeId ?? '', /^wt_/);
  assert.ok(!('worktreePath' in r1.steps[0]), 'sem conflito o caminho não aparece');
  fg.stepPlan.push('conflict'); Object.assign(tasks.get(r1.steps[0].taskId), { status: 'done', summary: 'ok' }); await flows2.tick();
  const r2 = (await jr(await call2(`/api/flows/${f.id}/runs/${run.id}`))).j;
  assert.equal(r2.status, 'running'); assert.equal(r2.steps[0].integration.state, 'conflict'); assert.equal(r2.steps[0].worktreePath, db2.worktrees[0].path); assert.ok(!JSON.stringify(r2).includes('repo-secreto'));
  const url = (s = 's1', r = run.id, fl = f.id) => `/api/flows/${fl}/runs/${r}/steps/${s}/integration`;
  assert.equal((await call2(url(), 'POST', { action: 'retry' }, evil)).status, 403);
  assert.equal((await jr(await call2(url('s9'), 'POST', { action: 'retry' }))).status, 404); assert.equal((await jr(await call2(url('s1', 'run_00000000'), 'POST', { action: 'retry' }))).status, 404); assert.equal((await jr(await call2(url('s1', run.id, 'flow_00000000'), 'POST', { action: 'retry' }))).status, 404);
  for (const b of [{ action: 'merge' }, { action: 'retry', branch: 'main' }, { action: 'retry', acknowledgeProjectConfig: 'true' }, {}]) assert.equal((await jr(await call2(url(), 'POST', b))).status, 400, JSON.stringify(b));
  // C1: a confirmação só vale junto com a lista vista (validação estrita)
  const longPath = 'a'.repeat(401), many = Array.from({ length: 201 }, (_, i) => `f${i}`), before = fg.calls.length;
  for (const b of [{ action: 'retry', acknowledgeProjectConfig: true }, { action: 'retry', acknowledgedFiles: ['.mcp.json'] }, { action: 'retry', acknowledgeProjectConfig: false, acknowledgedFiles: [] },
    { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: '.mcp.json' }, { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: [1] }, { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: [''] },
    { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: [longPath] }, { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: many }]) {
    const r = await jr(await call2(url(), 'POST', b)); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 120)); assert.match(r.j.error, /acknowledge/);
  }
  assert.equal(fg.calls.length, before, 'nada chegou ao Git');
  setFail(true); const broken = await jr(await call2(url(), 'POST', { action: 'discard' })); setFail(false);
  assert.equal(broken.status, 500); assert.equal(db2.flowRuns[0].steps[0].status, 'completed'); assert.equal(db2.flowRuns[0].steps[0].integration.state, 'conflict');
  fg.stepPlan.push('conflict');
  const c = await jr(await call2(url(), 'POST', { action: 'retry' })); assert.equal(c.status, 409); assert.equal(c.j.code, 'conflict'); assert.deepEqual(c.j.conflicts, ['a.txt']); assert.match(c.j.error, /conflito/);
  fg.finalPlan.push('target_dirty');
  const ok = await jr(await call2(url(), 'POST', { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: ['.mcp.json'] })); assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.steps[0].integration.state, 'integrated');
  assert.deepEqual(fg.calls.filter((x) => x[0] === 'integrateStep').at(-1), ['integrateStep', 's1', true, ['.mcp.json']]);
  assert.deepEqual(fg.calls.filter((x) => x[0] === 'integrateStep').slice(0, -1).map((x) => x[3]), [null, null], 'sem confirmação, nenhuma lista');
  assert.ok(fg.calls.some((x) => x[0] === 'configAudit' && /^wt_/.test(x[1])), 'I1: a cópia foi conferida antes de abrir o terminal');
  await flows2.tick(); // a rota já pediu um passo do runner (a etapa integrada libera o fim do run): espera ele
  const r3 = (await jr(await call2(`/api/flows/${f.id}/runs/${run.id}`))).j; assert.equal(r3.status, 'ready_to_integrate'); assert.equal(r3.git.pending.reasons[0].code, 'target_dirty');
  assert.equal((await jr(await call2(url(), 'POST', { action: 'retry' }))).j.code, 'not_running', 'fora de um run em andamento');
  assert.deepEqual(fg.calls.filter((x) => x[0] === 'integrateFinal').at(-1), ['integrateFinal', 'auto', false, null], 'a integração automática nunca reconhece configuração (nem lista)');
  gitSrv.flowId = f.id; gitSrv.runId = run.id;
});

test('modo Git via HTTP: POST .../integrate (403/404/400, 409 com code e files, busy, 200 completed by user, depois not_ready) e POST .../cleanup (leftovers)', async () => {
  const { fg, call2, flowId, runId } = await gitServer();
  const url = (r = runId, fl = flowId) => `/api/flows/${fl}/runs/${r}/integrate`;
  assert.equal((await call2(url(), 'POST', {}, evil)).status, 403);
  assert.equal((await jr(await call2(url('run_00000000'), 'POST', {}))).status, 404); assert.equal((await jr(await call2(url(runId, 'flow_00000000'), 'POST', {}))).status, 404);
  for (const b of [{ force: true }, { acknowledgeProjectConfig: 'sim' }, { acknowledgeProjectConfig: 1 }, [1], { acknowledgeProjectConfig: true }, { acknowledgedFiles: ['.mcp.json'] }, { acknowledgeProjectConfig: true, acknowledgedFiles: [null] },
    { acknowledgeProjectConfig: true, acknowledgedFiles: Array.from({ length: 201 }, (_, i) => `f${i}`) }, { acknowledgeProjectConfig: true, acknowledgedFiles: ['x'.repeat(401)] }, { acknowledgeProjectConfig: true, acknowledgedFiles: { 0: '.mcp.json' } }])
    assert.equal((await jr(await call2(url(), 'POST', b))).status, 400, JSON.stringify(b).slice(0, 120));
  assert.ok(!fg.calls.some((x) => x[0] === 'integrateFinal' && x[1] === 'user'), 'corpo inválido não chega ao Git');
  fg.finalPlan.push('project_config_changed');
  const pc = await jr(await call2(url(), 'POST', {})); assert.equal(pc.status, 409); assert.equal(pc.j.code, 'project_config_changed'); assert.deepEqual(pc.j.files, ['.mcp.json']);
  // ocupado: uma integração em curso e outra chegando = 409 busy
  let release; fg.gate = new Promise((r) => { release = r; }); fg.finalPlan.push('target_dirty');
  const first = call2(url(), 'POST', {});
  await new Promise((r) => setTimeout(r, 50));
  const busy = await jr(await call2(url(), 'POST', {})); assert.equal(busy.status, 409); assert.equal(busy.j.code, 'busy');
  fg.gate = null; release();
  const td = await jr(await first); assert.equal(td.status, 409); assert.equal(td.j.code, 'target_dirty');
  fg.leftovers = [{ worktreeId: 'wt_c0000001', reason: 'em uso' }];
  const ok = await jr(await call2(url(), 'POST', { acknowledgeProjectConfig: true, acknowledgedFiles: pc.j.files }));
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.status, 'completed'); assert.deepEqual([ok.j.git.integration.by, ok.j.git.leftovers.length], ['user', 1]);
  assert.deepEqual(fg.calls.filter((x) => x[0] === 'integrateFinal').at(-1), ['integrateFinal', 'user', true, ['.mcp.json']]); assert.deepEqual(fg.calls.filter((x) => x[0] === 'cleanupRun').at(-1), ['cleanupRun', false]);
  const again = await jr(await call2(url(), 'POST', {})); assert.equal(again.status, 409); assert.equal(again.j.code, 'not_ready');
  const cu = (r = runId) => `/api/flows/${flowId}/runs/${r}/cleanup`;
  assert.equal((await call2(cu(), 'POST', {}, evil)).status, 403); assert.equal((await jr(await call2(cu('run_00000000'), 'POST', {}))).status, 404);
  assert.equal((await jr(await call2(cu(), 'POST', { all: true }))).status, 400);
  fg.leftovers = [];
  const c1 = await jr(await call2(cu(), 'POST', {})); assert.equal(c1.status, 200, JSON.stringify(c1.j)); assert.deepEqual(c1.j.git.leftovers, []);
  assert.deepEqual(fg.calls.filter((x) => x[0] === 'cleanupRun').at(-1), ['cleanupRun', false], 'run integrado: a limpeza também tenta apagar a branch (se contida)');
  const c2 = await jr(await call2(cu(), 'POST', {})); assert.equal(c2.status, 409); assert.equal(c2.j.code, 'nothing_to_clean');
  const d = await jr(await call2(`/api/flows/${flowId}/runs/${runId}/discard`, 'POST', {})); assert.equal(d.status, 409); assert.equal(d.j.code, 'not_ready', 'run integrado não se descarta');
});

test('modo Git via HTTP: POST .../discard (ready_to_integrate → discarded; deleteBranch estrito; já descartado 409) e as rotas novas num run do modo pasta = 409', async () => {
  const { fg, call2, flows2, flowId } = await gitServer();
  assert.equal((await jr(await call2(`/api/flows/${flowId}`, 'PATCH', { autoIntegrate: false }))).status, 200);
  const run = (await jr(await call2(`/api/flows/${flowId}/runs`, 'POST'))).j; await flows2.tick();
  const s = (await jr(await call2(`/api/flows/${flowId}/runs/${run.id}`))).j.steps[0];
  assert.equal((await jr(await call2(`/api/flows/${flowId}/runs/${run.id}/cleanup`, 'POST', {}))).j.code, 'not_ready', 'C2: run em andamento não se limpa');
  Object.assign(tasks.get(s.taskId), { status: 'done', summary: 'ok' }); await flows2.tick();
  const r = (await jr(await call2(`/api/flows/${flowId}/runs/${run.id}`))).j; assert.equal(r.status, 'ready_to_integrate'); assert.deepEqual(r.git.pending.reasons, []); assert.equal(r.error, null);
  assert.equal((await jr(await call2(`/api/flows/${flowId}/runs/${run.id}/cleanup`, 'POST', {}))).j.code, 'not_ready', 'pronta para integrar: Integrar ou Descartar');
  const url = (rid = run.id) => `/api/flows/${flowId}/runs/${rid}/discard`;
  assert.equal((await call2(url(), 'POST', { deleteBranch: true }, evil)).status, 403); assert.equal((await jr(await call2(url('run_00000000'), 'POST', {}))).status, 404);
  for (const b of [{ deleteBranch: 'sim' }, { deleteBranch: true, path: '/' }]) assert.equal((await jr(await call2(url(), 'POST', b))).status, 400, JSON.stringify(b));
  fg.leftovers = [{ worktreeId: 'wt_c0000009', reason: 'O worktree está em uso' }]; // uma cópia ficou presa
  const ok = await jr(await call2(url(), 'POST', { deleteBranch: false })); assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.deepEqual([ok.j.status, ok.j.git.branchDeleted, !!ok.j.git.discardedAt, ok.j.git.leftovers.length], ['discarded', false, true, 1]); assert.deepEqual(fg.calls.filter((x) => x[0] === 'discard').at(-1), ['discard', false]);
  assert.equal(terms.get(s.terminalId).status, 'exited', 'o terminal ocioso fechou antes de limpar');
  const again = await jr(await call2(url(), 'POST', {})); assert.equal(again.status, 409); assert.equal(again.j.code, 'already_discarded');
  // C2: descartada com leftovers → Limpar refaz (sem mexer na branch); depois nada a limpar
  fg.leftovers = [];
  const cl = await jr(await call2(`/api/flows/${flowId}/runs/${run.id}/cleanup`, 'POST', {})); assert.equal(cl.status, 200, JSON.stringify(cl.j));
  assert.deepEqual([cl.j.status, cl.j.git.leftovers, cl.j.git.branchDeleted], ['discarded', [], false]); assert.deepEqual(fg.calls.filter((x) => x[0] === 'cleanupRun').at(-1), ['cleanupRun', true]);
  assert.equal((await jr(await call2(`/api/flows/${flowId}/runs/${run.id}/cleanup`, 'POST', {}))).j.code, 'nothing_to_clean');
  // run do modo pasta (servidor principal, sem flowGit): nada de Git para integrar, descartar ou limpar
  const old = 'run_0000beef', fl = 'flow_0000beef';
  assert.equal((await jr(await call(`/api/flows/${fl}/runs/${old}/integrate`, 'POST', {}))).j.code, 'not_ready');
  assert.equal((await jr(await call(`/api/flows/${fl}/runs/${old}/discard`, 'POST', {}))).j.code, 'not_git');
  assert.equal((await jr(await call(`/api/flows/${fl}/runs/${old}/cleanup`, 'POST', {}))).j.code, 'not_git');
  assert.equal((await jr(await call(`/api/flows/${fl}/runs/${old}/steps/s1/integration`, 'POST', { action: 'retry' }))).j.code, 'not_running');
});
