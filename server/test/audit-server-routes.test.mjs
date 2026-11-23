// Auditoria do servidor: rotas async com proteção (500 em JSON e servidor vivo), contrato aditivo `prereqs`/`executor` de /api/state e rollback das rotas de missão (Missions v2, /api/flows).
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
  assert.ok(fs.realpathSync.native(path.dirname(dir)).startsWith(fs.realpathSync.native(os.tmpdir())));
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

test('rotas async (/api/state, /api/workspaces/:id/git): exceção vira 500 em JSON e o servidor segue respondendo', async () => {
  const flag = path.join(root, 'boom'), wsDir = path.join(root, 'ws'); fs.mkdirSync(wsDir);
  const s = await boot({ AUDIT_BOOM: flag });
  const ws = await (await s.call('POST', '/api/workspaces', { path: wsDir })).json();
  assert.ok(ws.id);
  fs.writeFileSync(flag, 'x');
  for (const p of ['/api/state', `/api/workspaces/${ws.id}/git`]) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 500, p); assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await r.json(), { error: 'Erro interno.' }); // sem detalhes do erro
  }
  assert.equal((await s.call('GET', '/api/workspaces')).status, 200, 'o servidor continua vivo');
  assert.equal((await s.call('GET', '/api/flows')).status, 200, 'as Missões v2 seguem respondendo');
  fs.rmSync(flag);
  assert.equal((await s.call('GET', '/api/state')).status, 200, 'sem a falha, a rota volta ao normal');
  assert.equal((await s.call('GET', `/api/workspaces/${ws.id}/git`)).status, 200);
  assert.equal(s.child.exitCode, null, 'o processo não caiu');
});

test('prereqs em /api/state: Git e Claude disponíveis (comandos injetados) e contrato aditivo preservado', async () => {
  const gitScript = path.join(root, 'fake-git.mjs'); fs.writeFileSync(gitScript, "console.log('git version 9.9.9.windows.1');");
  const s = await boot({ AUDIT_GIT: gitScript });
  const st = await (await s.call('GET', '/api/state')).json();
  assert.deepEqual(Object.keys(st.prereqs).sort(), ['claude', 'git', 'login']); // login entrou depois, de forma aditiva
  assert.deepEqual(st.prereqs.git, { available: true, version: '9.9.9.windows.1', detail: 'Git detectado.' });
  assert.deepEqual(st.prereqs.claude, { available: true, version: '0.0.0-fake (teste)', detail: 'Claude Code detectado.' });
  assert.ok(st.executor && st.settings && st.persistence && st.worktrees, 'campos existentes continuam lá');
  // `executor` mantém o shape de sonda: id/connected + o resultado da sonda (claude-probe.js) espalhado (sem busy/current: o executor do ciclo antigo foi removido)
  assert.deepEqual(st.executor, { id: 'claude-code', connected: true, available: true, version: '0.0.0-fake (teste)', detail: 'Claude Code detectado e pronto para executar tarefas autorizadas' });
  const fresh = await (await s.call('GET', '/api/state?fresh=1')).json(); // "Verificar novamente" consulta a sonda de novo e devolve o mesmo contrato
  assert.deepEqual(fresh.prereqs.claude, st.prereqs.claude); assert.deepEqual(fresh.executor, st.executor);
});

test('contrato de /api/state sem o ciclo antigo: só os campos vivos; /api/missions e /api/chat respondem 404 (GET e POST com Origin)', async () => {
  const s = await boot();
  const st = await (await s.call('GET', '/api/state')).json();
  for (const k of ['planner', 'counts', 'system', 'missions', 'tasks', 'cycle', 'chat', 'limits', 'usage', 'demo']) assert.equal(k in st, false, `/api/state não devolve mais "${k}"`);
  for (const k of ['prereqs', 'executor', 'persistence', 'persistenceIncident', 'settings', 'worktrees', 'activeWorkspace', 'openWorkspaceIds', 'topics', 'activeTopicIds']) assert.equal(k in st, true, `/api/state mantém "${k}"`);
  assert.deepEqual(Object.keys(st.worktrees).sort(), ['items', 'unregistered']);
  for (const p of ['/api/missions', '/api/missions/m1', '/api/chat', '/api/chat/message', '/api/events']) {
    for (const method of ['GET', 'POST']) assert.equal((await s.call(method, p, method === 'POST' ? {} : undefined)).status, 404, `${method} ${p}`);
  }
});

test('prereqs em /api/state: Git ausente traz a mensagem de instalação e disponível=false', async () => {
  const s = await boot({ AUDIT_GIT: 'missing' });
  const st = await (await s.call('GET', '/api/state')).json();
  assert.deepEqual(st.prereqs.git, { available: false, version: null, detail: 'Git não encontrado no PATH. Instale em https://git-scm.com/downloads' });
  assert.equal(st.prereqs.claude.available, true);
});

test('missões (Missions v2, /api/flows): gravação que falha desfaz o estado em memória (500 e nada alterado); sem falha tudo funciona', async () => {
  const s = await boot();
  const wsDir = path.join(s.dir, 'ws'); fs.mkdirSync(wsDir);
  const ws = await (await s.call('POST', '/api/workspaces', { path: wsDir })).json(); assert.ok(ws.id);
  const body = (title) => ({ workspaceId: ws.id, title, goal: 'Meta de teste', steps: [{ id: 's1', title: 'Etapa s1', prompt: 'Faça s1', provider: 'claude', role: 'builder' }] });
  const list = async () => (await (await s.call('GET', '/api/flows')).json());
  let r = await s.call('POST', '/api/flows', body('Missão A')); assert.equal(r.status, 201);
  const a = await r.json();
  const tmpDir = path.join(s.dir, 'db.json.tmp');
  fs.mkdirSync(tmpDir); // EISDIR: o save() falha de verdade
  try {
    // criar
    r = await s.call('POST', '/api/flows', body('Missão B'));
    assert.equal(r.status, 500); assert.match((await r.json()).error, /nada foi alterado/);
    assert.deepEqual((await list()).map((x) => x.title), ['Missão A']);
    // alterar
    r = await s.call('PATCH', `/api/flows/${a.id}`, { title: 'Missão A2' });
    assert.equal(r.status, 500); assert.match((await r.json()).error, /nada foi alterado/);
    assert.deepEqual((await list()).map((x) => x.title), ['Missão A']);
    // remover
    r = await s.call('DELETE', `/api/flows/${a.id}`);
    assert.equal(r.status, 500); assert.match((await r.json()).error, /nada foi alterado/);
    assert.equal((await list()).length, 1);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
  // armazenamento normalizado: as mesmas operações funcionam
  r = await s.call('PATCH', `/api/flows/${a.id}`, { title: 'Missão A2' }); assert.equal(r.status, 200); assert.equal((await r.json()).title, 'Missão A2');
  assert.equal((await s.call('POST', '/api/flows', body('Missão C'))).status, 201);
  assert.equal((await s.call('DELETE', `/api/flows/${a.id}`)).status, 204);
  assert.deepEqual((await list()).map((x) => x.title), ['Missão C']);
});
