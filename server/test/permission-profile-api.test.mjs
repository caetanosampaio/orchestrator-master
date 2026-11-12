// Perfil de permissão do Executor por workspace: rotas GET/PUT, auditoria durável, rollback e criação sem o campo.
// Parte 1 (em processo): permission-profile.js montado num express próprio, com ORCH_DATA_DIR temporário. Parte 2: servidor REAL (server/index.js) como processo filho,
// com ORCH_DATA_DIR temporário e porta livre; nenhum modelo é chamado e o banco real e o servidor ativo nunca são tocados.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-permprofile-'));
const dataDir = path.join(root, 'inproc'); fs.mkdirSync(dataDir);
process.env.ORCH_DATA_DIR = dataDir; // ANTES de importar o store: o banco deste processo é o temporário
const store = await import('../store.js');
const { setupPermissionProfile, MAX_AUDIT } = await import('../permission-profile.js');
const { WARNING, DEFAULT_ALLOW } = await import('../exec-profile.js');
const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

const servers = new Set(), children = new Set();
after(async () => {
  for (const s of servers) s.close();
  for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } }
  await new Promise((r) => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true });
});

const db = store.load();
const ws = (id) => { const w = { id, name: `proj-${id}`, path: path.join(root, id), hasGit: false, hasPackageJson: false, createdAt: store.now() }; db.workspaces.push(w); return w; };
const A = ws('ws_aaaaaaaa'), B = ws('ws_bbbbbbbb');

async function serve(tokenActive) {
  const app = express(); app.use(express.json());
  setupPermissionProfile(app, { db, tokenActive });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); servers.add(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    get: async (id) => { const r = await fetch(`${base}/api/workspaces/${id}/permission-profile`); return { status: r.status, body: await r.json() }; },
    put: async (id, body) => { const r = await fetch(`${base}/api/workspaces/${id}/permission-profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; },
  };
}
const ON = { profile: 'bypass', confirm: true, warningVersion: WARNING.version };
const NOTOKEN = { ...ON, acknowledgeNoToken: true };
const reset = (w) => { delete w.permissionProfile; delete w.permissionProfileAt; db.permissionAudit = undefined; delete db.permissionAudit; db.missions = db.missions.filter((m) => !m.id.startsWith('perm_')); };

test('GET: estado padrão (banco antigo, sem permissionAudit nem campo no workspace) tem o formato do contrato', async () => {
  reset(A); const api = await serve(false);
  const r = await api.get(A.id);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['audit', 'canEnable', 'defaultAllow', 'profile', 'since', 'tokenProtected', 'warning']);
  assert.deepEqual([r.body.profile, r.body.since, r.body.tokenProtected, r.body.canEnable, r.body.audit], ['default', null, false, true, []]);
  assert.deepEqual(r.body.defaultAllow, [...DEFAULT_ALLOW]);
  assert.deepEqual(r.body.warning, { version: WARNING.version, text: WARNING.text, noTokenText: WARNING.noTokenText });
  assert.equal((await serve(true).then((x) => x.get(A.id))).body.tokenProtected, true);
  assert.equal(db.permissionAudit, undefined, 'a lista é criada de forma preguiçosa: ler não cria nada');
});

test('404: workspace inexistente (GET e PUT)', async () => {
  const api = await serve(false);
  assert.equal((await api.get('ws_nope')).status, 404);
  assert.equal((await api.put('ws_nope', NOTOKEN)).status, 404);
  assert.equal((await api.get('__proto__')).status, 404);
});

test('PUT 400: profile inválido, sem confirm, versão do aviso errada/ausente, e SEM token ativo sem acknowledgeNoToken', async () => {
  reset(A); const api = await serve(false);
  for (const profile of [undefined, null, 'admin', 'BYPASS', true, ['bypass'], { a: 1 }]) { const r = await api.put(A.id, { ...NOTOKEN, profile }); assert.deepEqual([r.status, r.body.code], [400, 'invalid_profile'], JSON.stringify(profile)); }
  for (const confirm of [undefined, false, 'true', 1]) { const r = await api.put(A.id, { ...NOTOKEN, confirm }); assert.deepEqual([r.status, r.body.code], [400, 'confirm_required'], String(confirm)); }
  for (const warningVersion of [undefined, WARNING.version + 1, String(WARNING.version), 0]) { const r = await api.put(A.id, { ...NOTOKEN, warningVersion }); assert.deepEqual([r.status, r.body.code], [400, 'warning_version'], String(warningVersion)); }
  for (const acknowledgeNoToken of [undefined, false, 'true', 1]) { const r = await api.put(A.id, { ...ON, acknowledgeNoToken }); assert.deepEqual([r.status, r.body.code], [400, 'no_token_ack_required'], String(acknowledgeNoToken)); }
  assert.deepEqual([A.permissionProfile, db.permissionAudit], [undefined, undefined], 'nenhuma recusa altera o estado');
  assert.deepEqual([(await api.put(A.id, [])).status, (await api.put(A.id, {})).status], [400, 400], 'corpo que não é objeto ou vazio');
});

test('PUT bypass sem token com acknowledgeNoToken: grava, audita com tokenGuarded:false e espelha na atividade (sem texto livre do cliente)', async () => {
  reset(A); const api = await serve(false); const act = db.activity.length;
  const r = await api.put(A.id, { ...NOTOKEN, reason: 'texto livre do cliente', by: 'maestro', tokenGuarded: true, from: 'bypass' });
  assert.equal(r.status, 200); assert.deepEqual([r.body.profile, r.body.canEnable, r.body.tokenProtected], ['bypass', true, false]);
  assert.equal(A.permissionProfile, 'bypass'); assert.equal(typeof A.permissionProfileAt, 'string'); assert.equal(r.body.since, A.permissionProfileAt);
  assert.equal(db.permissionAudit.length, 1);
  const e = db.permissionAudit[0];
  assert.deepEqual(Object.keys(e).sort(), ['at', 'by', 'from', 'id', 'to', 'tokenGuarded', 'warningVersion', 'workspaceId', 'workspaceName']);
  assert.deepEqual([e.workspaceId, e.workspaceName, e.from, e.to, e.by, e.tokenGuarded, e.warningVersion], [A.id, A.name, 'default', 'bypass', 'user', false, WARNING.version]);
  assert.deepEqual(r.body.audit, [e]); assert.ok(!JSON.stringify(db.permissionAudit).includes('texto livre'));
  assert.equal(db.activity.length, act + 1); assert.equal(db.activity[0].type, 'workspace'); assert.equal(db.activity[0].workspaceId, A.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')).permissionAudit.length, 1, 'durável: está no db.json');
});

test('PUT bypass com token ativo: não exige acknowledgeNoToken e audita tokenGuarded:true; desligar não exige confirmação e a ordem é do mais recente ao mais antigo', async () => {
  reset(A); const api = await serve(true);
  const on = await api.put(A.id, ON); assert.equal(on.status, 200); assert.equal(on.body.tokenProtected, true); assert.equal(db.permissionAudit[0].tokenGuarded, true);
  const same = await api.put(A.id, ON); assert.equal(same.status, 200); assert.equal(db.permissionAudit.length, 1, 'mesmo perfil: sem entrada nova');
  const off = await api.put(A.id, { profile: 'default' }); assert.equal(off.status, 200); assert.equal(off.body.profile, 'default');
  assert.equal(A.permissionProfile, 'default'); assert.equal(off.body.notice, undefined);
  assert.deepEqual(off.body.audit.map((e) => [e.from, e.to]), [['bypass', 'default'], ['default', 'bypass']]);
  assert.deepEqual((await api.get(A.id)).body.audit, off.body.audit);
});

test('a auditoria é filtrada por workspace e fica limitada a 500 entradas; a GET devolve as últimas 20', async () => {
  reset(A); reset(B); const api = await serve(false);
  const old = (i, wid) => ({ id: `pa_${i}`, at: `2025-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, workspaceId: wid, workspaceName: 'x', from: 'default', to: 'bypass', by: 'user', tokenGuarded: false, warningVersion: 1 });
  db.permissionAudit = Array.from({ length: MAX_AUDIT }, (_, i) => old(i, i % 2 ? B.id : A.id));
  assert.equal((await api.get(A.id)).body.audit.length, 20); assert.ok((await api.get(A.id)).body.audit.every((e) => e.workspaceId === A.id));
  assert.equal((await api.put(A.id, NOTOKEN)).status, 200);
  assert.equal(db.permissionAudit.length, MAX_AUDIT, 'o limite vale'); assert.equal(db.permissionAudit[0].id, 'pa_1', 'a mais antiga saiu'); assert.equal(db.permissionAudit.at(-1).to, 'bypass');
  db.permissionAudit.push({ lixo: true }, null, 'x'); assert.equal((await api.get(A.id)).status, 200, 'registro malformado no disco não quebra a leitura');
});

test('campo malformado no workspace = padrão (fail-safe) na GET', async () => {
  const api = await serve(false);
  for (const v of ['BYPASS', 'bypass ', true, 1, {}, ['bypass'], null, 'default', 'x']) { reset(A); A.permissionProfile = v; assert.equal((await api.get(A.id)).body.profile, 'default', JSON.stringify(v)); }
  reset(A); A.permissionProfile = 'bypass'; assert.equal((await api.get(A.id)).body.profile, 'bypass');
});

test('409 ao LIGAR com ciclo planning/running ou tarefa rodando no workspace; GET mostra canEnable:false/active_cycle; desligar sempre pode (com aviso)', async () => {
  const api = await serve(false);
  const mission = (extra) => ({ id: `perm_${Math.random().toString(16).slice(2)}`, workspaceId: A.id, title: 't', tasks: [], ...extra });
  for (const m of [mission({ cycle: { status: 'planning', rounds: [] } }), mission({ cycle: { status: 'running', rounds: [] } }), mission({ tasks: [{ id: 'tk', status: 'running' }] })]) {
    reset(A); db.missions.push(m);
    const g = await api.get(A.id); assert.deepEqual([g.body.canEnable, g.body.reason], [false, 'active_cycle']);
    const r = await api.put(A.id, NOTOKEN); assert.deepEqual([r.status, r.body.code], [409, 'active_cycle']);
    assert.deepEqual([A.permissionProfile, db.permissionAudit], [undefined, undefined]);
    A.permissionProfile = 'bypass'; // já ligado (ex.: ligado antes): desligar é permitido e avisa
    const off = await api.put(A.id, { profile: 'default' }); assert.equal(off.status, 200); assert.equal(off.body.profile, 'default'); assert.match(off.body.notice, /não é interrompida/);
  }
  reset(A); db.missions.push(mission({ workspaceId: B.id, cycle: { status: 'running', rounds: [] } }), mission({ cycle: { status: 'completed', rounds: [] } }), mission({ cycle: { status: 'blocked', rounds: [] } }));
  assert.equal((await api.put(A.id, NOTOKEN)).status, 200, 'ciclo de OUTRO workspace, concluído ou bloqueado não impede');
});

test('rollback atômico: falha de gravação => 500, campo, data e auditoria restaurados, sem espelho na atividade; depois que o disco volta, funciona', async () => {
  reset(A); const api = await serve(false);
  fs.mkdirSync(path.join(dataDir, 'db.json.tmp')); // EISDIR: erro real de gravação
  const wsLog = () => db.activity.filter((x) => x.type === 'workspace').length; let act = wsLog();
  const r = await api.put(A.id, NOTOKEN); assert.deepEqual([r.status, r.body.code], [500, 'persistence_failed']);
  assert.ok(!Object.hasOwn(A, 'permissionProfile') && !Object.hasOwn(A, 'permissionProfileAt') && !Object.hasOwn(db, 'permissionAudit'), 'estado original (campos ausentes)');
  assert.equal(wsLog(), act, 'sem espelho na atividade'); assert.equal((await api.get(A.id)).body.profile, 'default');
  fs.rmSync(path.join(dataDir, 'db.json.tmp'), { recursive: true, force: true });
  assert.equal((await api.put(A.id, NOTOKEN)).status, 200); const before = JSON.stringify([A.permissionProfile, A.permissionProfileAt, db.permissionAudit]);
  fs.mkdirSync(path.join(dataDir, 'db.json.tmp')); act = wsLog();
  assert.equal((await api.put(A.id, { profile: 'default' })).status, 500);
  assert.equal(JSON.stringify([A.permissionProfile, A.permissionProfileAt, db.permissionAudit]), before, 'voltou exatamente ao estado anterior (bypass, mesma data, mesma auditoria)'); assert.equal(wsLog(), act);
  fs.rmSync(path.join(dataDir, 'db.json.tmp'), { recursive: true, force: true });
  assert.equal((await api.put(A.id, { profile: 'default' })).status, 200);
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

test('servidor real sem token: POST /api/workspaces IGNORA permissionProfile; PUT exige Origin, pede o reconhecimento sem token e grava no db.json', async () => {
  const dir = path.join(root, 'real1'); fs.mkdirSync(dir); const wsDir = path.join(root, 'proj1'); fs.mkdirSync(wsDir);
  const port = await freePort(), b = boot(port, dir), base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const c = await call(base, '/api/workspaces', 'POST', { path: wsDir, permissionProfile: 'bypass', permissionProfileAt: '2020-01-01T00:00:00Z', permissionAudit: [{ x: 1 }] });
    assert.equal(c.status, 201); assert.ok(!('permissionProfile' in c.body) && !('permissionProfileAt' in c.body), 'o workspace novo nunca nasce com perfil');
    const id = c.body.id, url = `/api/workspaces/${id}/permission-profile`;
    assert.equal((await call(base, '/api/workspaces')).body.some((w) => 'permissionProfile' in w), false);
    const g = await call(base, url); assert.deepEqual([g.status, g.body.profile, g.body.tokenProtected], [200, 'default', false]);

    const noOrigin = await fetch(base + url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ON, acknowledgeNoToken: true }) });
    assert.equal(noOrigin.status, 403, 'mutante sem Origin é recusado pelo apiGuard'); assert.equal((await call(base, url)).body.profile, 'default');
    const need = await call(base, url, 'PUT', ON); assert.deepEqual([need.status, need.body.code], [400, 'no_token_ack_required']);
    const ok = await call(base, url, 'PUT', { ...ON, acknowledgeNoToken: true }); assert.deepEqual([ok.status, ok.body.profile, ok.body.audit[0].tokenGuarded], [200, 'bypass', false]);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(disk.workspaces.find((w) => w.id === id).permissionProfile, 'bypass'); assert.equal(disk.permissionAudit.length, 1);
    assert.equal((await call(base, `/api/workspaces/${id}/rename`, 'POST', { displayName: 'x', permissionProfile: 'default' })).body.permissionProfile, 'bypass', 'outras rotas não mexem no campo');
    assert.equal((await call(base, url, 'PUT', { profile: 'default' })).body.profile, 'default');
  } finally { b.child.kill(); await b.exited; }
});

test('servidor real com token de sessão: PUT sem o cabeçalho => 403; GET segue aberto e informa tokenProtected; com o token, bypass não exige acknowledgeNoToken e audita tokenGuarded:true', async () => {
  const dir = path.join(root, 'real2'); fs.mkdirSync(dir); const wsDir = path.join(root, 'proj2'); fs.mkdirSync(wsDir);
  const token = 'tok_' + 'a1B2c3D4'.repeat(5), port = await freePort(), b = boot(port, dir, { ORCH_API_TOKEN: token }), base = `http://127.0.0.1:${port}`, H = { 'x-orch-token': token };
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const c = await call(base, '/api/workspaces', 'POST', { path: wsDir }, H); assert.equal(c.status, 201);
    const url = `/api/workspaces/${c.body.id}/permission-profile`;
    const g = await call(base, url); assert.deepEqual([g.status, g.body.tokenProtected], [200, true]);
    const denied = await call(base, url, 'PUT', { ...ON, acknowledgeNoToken: true }); assert.equal(denied.status, 403, 'mesmo com acknowledgeNoToken, sem o token da interface não passa'); assert.equal((await call(base, url)).body.profile, 'default');
    const ok = await call(base, url, 'PUT', ON, H); assert.deepEqual([ok.status, ok.body.profile, ok.body.audit[0].tokenGuarded], [200, 'bypass', true]);
  } finally { b.child.kill(); await b.exited; }
});
