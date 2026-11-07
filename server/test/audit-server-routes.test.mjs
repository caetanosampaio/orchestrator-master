// Auditoria do servidor: rotas async com proteção (500 em JSON e servidor vivo), contrato aditivo `prereqs` e rollback das rotas de missão/tarefa.
// Servidor REAL (server/index.js via audit-server-boot.mjs) em processo filho, SEMPRE com ORCH_DATA_DIR temporário e porta livre própria. Nenhum modelo é chamado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-server-boot.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-audit-routes-'));
const children = new Set();
after(async () => { for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } } await new Promise((r) => setTimeout(r, 400)); fs.rmSync(root, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
let n = 0;
async function boot(extraEnv = {}) {
  const dir = path.join(root, `d${++n}`); fs.mkdirSync(dir);
  assert.ok(dir.startsWith(os.tmpdir()));
  const port = await freePort();
  const child = spawn(process.execPath, [BOOT], { env: { ...process.env, PORT: String(port), ORCH_DATA_DIR: dir, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  for (let i = 0; i < 100 && !/FORGE API em/.test(out); i++) await Promise.race([new Promise((r) => setTimeout(r, 100)), exited]);
  assert.match(out, /FORGE API em/, `o servidor não subiu: ${out}`);
  const base = `http://127.0.0.1:${port}`;
  const call = (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { child, dir, base, call, out: () => out, exited };
}

test('rotas async (/api/state, /api/agents, /api/workspaces/:id/git): exceção vira 500 em JSON e o servidor segue respondendo', async () => {
  const flag = path.join(root, 'boom'), wsDir = path.join(root, 'ws'); fs.mkdirSync(wsDir);
  const s = await boot({ AUDIT_BOOM: flag });
  const ws = await (await s.call('POST', '/api/workspaces', { path: wsDir })).json();
  assert.ok(ws.id);
  fs.writeFileSync(flag, 'x');
  for (const p of ['/api/state', '/api/agents', `/api/workspaces/${ws.id}/git`]) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 500, p); assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), { error: 'Erro interno.' }); // sem detalhes do erro
  }
  assert.equal((await s.call('GET', '/api/workspaces')).status, 200, 'o servidor continua vivo');
  fs.rmSync(flag);
  assert.equal((await s.call('GET', '/api/state')).status, 200, 'sem a falha, a rota volta ao normal');
  assert.equal((await s.call('GET', '/api/agents')).status, 200);
  assert.equal(s.child.exitCode, null, 'o processo não caiu');
});

test('prereqs em /api/state: Git e Claude disponíveis (comandos injetados) e contrato aditivo preservado', async () => {
  const gitScript = path.join(root, 'fake-git.mjs'); fs.writeFileSync(gitScript, "console.log('git version 9.9.9.windows.1');");
  const s = await boot({ AUDIT_GIT: gitScript });
  const st = await (await s.call('GET', '/api/state')).json();
  assert.deepEqual(Object.keys(st.prereqs).sort(), ['claude', 'git', 'login']); // login entrou depois, de forma aditiva
  assert.deepEqual(st.prereqs.git, { available: true, version: '9.9.9.windows.1', detail: 'Git detectado.' });
  assert.equal(st.prereqs.claude.available, true); assert.equal(st.prereqs.claude.version, '0.0.0-fake (teste)'); assert.equal(typeof st.prereqs.claude.detail, 'string');
  assert.ok(st.executor && st.planner && st.counts && st.settings && st.persistence, 'campos existentes continuam lá');
  assert.equal(st.executor.connected, true);
});

test('prereqs em /api/state: Git ausente traz a mensagem de instalação e disponível=false', async () => {
  const s = await boot({ AUDIT_GIT: 'missing' });
  const st = await (await s.call('GET', '/api/state')).json();
  assert.deepEqual(st.prereqs.git, { available: false, version: null, detail: 'Git não encontrado no PATH. Instale em https://git-scm.com/downloads' });
  assert.equal(st.prereqs.claude.available, true);
});

test('missão e tarefa: gravação que falha desfaz o estado em memória (500 e nada alterado); sem falha tudo funciona', async () => {
  const s = await boot();
  const list = async () => (await (await s.call('GET', '/api/missions')).json());
  const m = await (await s.call('POST', '/api/missions', { title: 'Missão A' })).json();
  const t1 = await (await s.call('POST', `/api/missions/${m.id}/tasks`, { title: 'T1' })).json();
  const t2 = await (await s.call('POST', `/api/missions/${m.id}/tasks`, { title: 'T2', dependsOn: [t1.id] })).json();
  assert.deepEqual(t2.dependsOn, [t1.id]);
  const tmpDir = path.join(s.dir, 'db.json.tmp');
  fs.mkdirSync(tmpDir); // EISDIR: o save() falha de verdade
  try {
    // criar missão
    let r = await s.call('POST', '/api/missions', { title: 'Missão B' });
    assert.equal(r.status, 500); assert.match((await r.json()).error, /nada foi alterado/);
    assert.deepEqual((await list()).map((x) => x.title), ['Missão A']);
    // criar tarefa
    r = await s.call('POST', `/api/missions/${m.id}/tasks`, { title: 'T3' });
    assert.equal(r.status, 500);
    assert.deepEqual((await list())[0].tasks.map((t) => t.title), ['T1', 'T2']);
    // remover tarefa (T1: T2 depende dela; a dependência precisa voltar)
    r = await s.call('DELETE', `/api/missions/${m.id}/tasks/${t1.id}`);
    assert.equal(r.status, 500);
    const after1 = (await list())[0].tasks;
    assert.deepEqual(after1.map((t) => t.title), ['T1', 'T2']); assert.deepEqual(after1[1].dependsOn, [t1.id]);
    // remover missão
    r = await s.call('DELETE', `/api/missions/${m.id}`);
    assert.equal(r.status, 500);
    assert.equal((await list()).length, 1);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  // armazenamento normalizado: as mesmas operações funcionam
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}/tasks/${t1.id}`)).status, 204);
  assert.deepEqual((await list())[0].tasks.map((t) => [t.title, t.dependsOn.length]), [['T2', 0]]);
  assert.equal((await s.call('POST', '/api/missions', { title: 'Missão C' })).status, 201);
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}`)).status, 204);
  assert.deepEqual((await list()).map((x) => x.title), ['Missão C']);
});
