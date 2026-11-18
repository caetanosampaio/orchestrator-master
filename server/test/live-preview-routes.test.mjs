// Rotas /api/live/preview (POST e GET) montadas num Express mínimo com o apiGuard e o token de sessão REAIS e um banco injetado (nenhum db.json é tocado).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-liveroutes-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'orch-data');
const { default: express } = await import('express');
const { apiGuard } = await import('../origin-guard.js');
const { createTokenGuard, TOKEN_HEADER } = await import('../session-token.js');
const { createPreviewManager, setupLivePreview } = await import('../live-preview.js');
const { FRAME_SOURCES } = await import('../csp.js');

const TOKEN = 'T'.repeat(16) + 'k9_-'.repeat(8);
const mkdir = (name, files = {}) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); for (const [r, c] of Object.entries(files)) { const f = path.join(d, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } return d; };
const db = { workspaces: [
  { id: 'ws_withsite', name: 'a', path: mkdir('a', { 'site/index.html': '<h1>site</h1>', 'site/app.js': '1' }) },
  { id: 'ws_noindex', name: 'b', path: mkdir('b', { 'leia.txt': 'x' }) },
  { id: 'ws_gone', name: 'c', path: path.join(tmp, 'nao-existe') },
] };
let manager, server, base, port;
before(async () => {
  manager = createPreviewManager({ db, dataDir: path.join(tmp, 'orch-data') });
  const app = express();
  app.use('/api', apiGuard); app.use('/api', createTokenGuard(TOKEN)); app.use(express.json({ limit: '100kb' }));
  setupLivePreview(app, { db, manager });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  port = server.address().port; base = `http://127.0.0.1:${port}`; good = { origin: base, [TOKEN_HEADER]: TOKEN };
});
after(async () => { await manager.close(); server.close(); server.closeAllConnections?.(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = (target, { method = 'GET', body, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
  const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const r = http.request({ host: '127.0.0.1', port, method, path: target, agent: false, headers: { host: `127.0.0.1:${port}`, ...(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* não é JSON */ } resolve({ status: res.statusCode, text: s, json, headers: res.headers }); });
  });
  r.on('error', reject); if (data !== undefined) r.write(data); r.end();
});
let good = null; // montado depois que a porta existe
const post = (body, headers = good) => call('/api/live/preview', { method: 'POST', body, headers });

test('POST: sem Origin, Origin de outra porta/host, Sec-Fetch-Site same-site/cross-site e token ausente/errado => 403 e NENHUM listener nasce', async () => {
  const b = { workspaceId: 'ws_withsite' };
  assert.equal((await post(b, { [TOKEN_HEADER]: TOKEN })).status, 403, 'sem Origin');
  for (const origin of [`http://127.0.0.1:${port + 1}`, 'http://evil.example', `http://localhost:${port + 1}`, 'null']) assert.equal((await post(b, { origin, [TOKEN_HEADER]: TOKEN })).status, 403, origin);
  for (const site of ['same-site', 'cross-site']) assert.equal((await post(b, { ...good, 'sec-fetch-site': site })).status, 403, site);
  assert.equal((await post(b, { origin: base })).status, 403, 'sem token'); assert.equal((await post(b, { origin: base, [TOKEN_HEADER]: 'x'.repeat(40) })).status, 403, 'token errado');
  assert.equal((await post(b, { ...good, host: 'evil.com' })).status, 403, 'Host forjado');
  assert.equal(manager.listeners().length, 0, 'nada foi ligado pelas requisições recusadas');
});

test('GET /api/live/preview também exige o token (e recusa página de outra origem)', async () => {
  const q = '/api/live/preview?workspaceId=ws_withsite';
  assert.equal((await call(q)).status, 403, 'sem token'); assert.equal((await call(q, { headers: { [TOKEN_HEADER]: 'errado' } })).status, 403);
  assert.equal((await call(q, { headers: { ...good, 'sec-fetch-site': 'same-site' } })).status, 403, 'página do preview (outra origem) com o token injetado: recusada pelo apiGuard');
  assert.equal((await call(q, { headers: { [TOKEN_HEADER]: TOKEN, origin: 'http://127.0.0.1:59999' } })).status, 403, 'Origin da porta do preview não é a interface');
  assert.equal((await call(q, { headers: { [TOKEN_HEADER]: TOKEN } })).status, 200);
  assert.equal((await call('/api/live/preview', { method: 'PUT', body: {}, headers: good })).status, 404, 'só GET e POST existem');
});

test('POST: workspace inexistente => 404; corpo inválido, chave extra e id malformado => 400', async () => {
  const r = await post({ workspaceId: 'ws_naoexiste' }); assert.equal(r.status, 404); assert.deepEqual(r.json, { error: 'Workspace não encontrado.' });
  for (const body of [{}, { workspaceId: 'ws_withsite', extra: 1 }, { workspaceId: 'ws_withsite', path: 'C:\\' }, { workspaceId: 42 }, { workspaceId: ['ws_withsite'] }, { workspaceId: '../x' }, { workspaceId: '' }, { workspaceId: 'a'.repeat(65) }, [], 'texto', null, { workspaceId: { $ne: 1 } }]) {
    const x = await post(body); assert.equal(x.status, 400, JSON.stringify(body)); if (x.json) assert.match(x.json.error, /Corpo inválido/); // texto/null puros: o body-parser estrito já recusa (400)
  }
  assert.equal((await call('/api/live/preview', { method: 'POST', raw: '{nao-json', headers: good })).status, 400);
});

test('POST: sem index.html => available:false (sem listener); com site/index.html => contrato completo, sem caminho absoluto, porta diferente da API', async () => {
  let r = await post({ workspaceId: 'ws_noindex' }); assert.equal(r.status, 200); assert.deepEqual(r.json, { available: false, reason: 'no-index' });
  r = await post({ workspaceId: 'ws_gone' }); assert.equal(r.status, 200); assert.deepEqual(r.json, { available: false, reason: 'workspace-missing' });
  assert.equal(manager.listeners().length, 0);
  r = await post({ workspaceId: 'ws_withsite' }); assert.equal(r.status, 200); const j = r.json;
  assert.deepEqual(Object.keys(j).sort(), ['available', 'docroot', 'entry', 'files', 'path', 'port', 'startedAt', 'truncated', 'version']);
  assert.equal(j.available, true); assert.equal(j.docroot, 'site'); assert.equal(j.entry, 'index.html'); assert.equal(j.path, '/'); assert.equal(j.files, 2); assert.equal(j.truncated, false);
  assert.notEqual(j.port, port, 'o preview NÃO usa a porta da API (origem diferente)'); assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(!r.text.includes(tmp) && !/[A-Za-z]:\\/.test(r.text) && !r.text.includes(os.tmpdir()), 'nenhum caminho absoluto');
  const page = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: j.port, path: '/', agent: false, headers: { host: `127.0.0.1:${j.port}` } }, (x) => { let s = ''; x.on('data', (c) => { s += c; }); x.on('end', () => res({ status: x.statusCode, s })); }).on('error', rej));
  assert.equal(page.status, 200); assert.equal(page.s, '<h1>site</h1>');
  const again = await post({ workspaceId: 'ws_withsite' }); assert.equal(again.json.port, j.port, 'chamar de novo reaproveita o listener');
});

test('GET: sem efeito colateral (não liga listener), 400 sem/ com workspaceId inválido, 404 desconhecido; running reflete o listener', async () => {
  await manager.close(); // recomeça: o manager fechado não liga mais, então usa um novo abaixo
  const m2 = createPreviewManager({ db, dataDir: path.join(tmp, 'orch-data') });
  const app = express(); app.use('/api', apiGuard); app.use('/api', createTokenGuard(TOKEN)); app.use(express.json()); setupLivePreview(app, { db, manager: m2 });
  const s2 = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const p2 = s2.address().port;
  const c = (t, o = {}) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: p2, method: o.method ?? 'GET', path: t, agent: false, headers: { host: `127.0.0.1:${p2}`, origin: `http://127.0.0.1:${p2}`, [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' } }, (x) => { let s = ''; x.on('data', (d) => { s += d; }); x.on('end', () => res({ status: x.statusCode, json: s ? JSON.parse(s) : null })); }); r.on('error', rej); if (o.body) r.write(JSON.stringify(o.body)); r.end(); });
  try {
    const g = await c('/api/live/preview?workspaceId=ws_withsite'); assert.equal(g.status, 200);
    assert.deepEqual(g.json, { running: false, available: true, port: null, docroot: 'site', version: null, files: 0, truncated: false }); assert.equal(m2.listeners().length, 0, 'GET não inicia listener');
    assert.deepEqual((await c('/api/live/preview?workspaceId=ws_noindex')).json, { running: false, available: false, port: null, docroot: null, version: null, files: 0, truncated: false });
    for (const q of ['', '?workspaceId=', '?workspaceId=a%20b', '?workspaceId[a]=1', '?workspaceId=ws_a&workspaceId=ws_b', `?workspaceId=${'a'.repeat(65)}`]) assert.equal((await c(`/api/live/preview${q}`)).status, 400, q);
    assert.equal((await c('/api/live/preview?workspaceId=ws_naoexiste')).status, 404);
    const p = await c('/api/live/preview', { method: 'POST', body: { workspaceId: 'ws_withsite' } }); assert.equal(p.status, 200);
    const g2 = await c('/api/live/preview?workspaceId=ws_withsite'); assert.equal(g2.json.running, true); assert.equal(g2.json.port, p.json.port); assert.equal(g2.json.version, p.json.version); assert.equal(g2.json.files, 2);
    assert.ok(!JSON.stringify(g2.json).includes(tmp));
  } finally { await m2.close(); s2.close(); s2.closeAllConnections?.(); }
});

test('trava de regressão: a CSP da interface (FRAME_SOURCES) permite emoldurar http://127.0.0.1:* e http://localhost:*', () => {
  assert.ok(FRAME_SOURCES.includes('http://127.0.0.1:*')); assert.ok(FRAME_SOURCES.includes('http://localhost:*'));
});
