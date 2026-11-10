// Aprovar/rejeitar tarefa: com o disco quebrado a decisão NÃO fica só na memória (500 e estado anterior intacto); normalizado o disco, funciona.
// Também: corpo grande demais responde 413 com mensagem clara (antes era "Erro interno").
// Servidor REAL como processo filho, SEMPRE com ORCH_DATA_DIR temporário e porta livre; a falha é real (um DIRETÓRIO no lugar de db.json.tmp faz o save() lançar EISDIR).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-task-decision-'));
const children = new Set();
after(async () => { for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } } await new Promise((r) => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
function boot(port, dir) {
  assert.ok(fs.realpathSync.native(path.dirname(dir)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste tem que ficar no diretório temporário');
  const child = spawn(process.execPath, [INDEX], { env: { ...process.env, PORT: String(port), ORCH_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  return { child, out: () => out, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}
const waitUp = async (b) => { for (let i = 0; i < 80; i++) { if (/FORGE API em/.test(b.out())) return true; await Promise.race([new Promise((r) => setTimeout(r, 100)), b.exited]); } return false; };

const task = (id) => ({ id, title: `tarefa ${id}`, status: 'awaiting_approval', authorized: false, dependsOn: [], report: '', files: [], log: [] });

test('aprovar e rejeitar: disco quebrado => 500 e a tarefa continua aguardando; disco normal => decisão gravada', async () => {
  const dir = path.join(root, 'd1'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    version: 1, settings: { activeWorkspaceId: null, openWorkspaceIds: [], activeTopicIds: {}, requireApproval: true, showDemoData: true },
    workspaces: [], topics: [], activity: [],
    missions: [{ id: 'mis_decide', demo: false, title: 'M', objective: '', workspaceId: null, createdAt: new Date().toISOString(), tasks: [task('t_a'), task('t_r')] }],
  }));
  const port = await freePort(), b = boot(port, dir), base = `http://127.0.0.1:${port}`;
  const post = (p) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '{}' });
  const get = async (id) => (await (await fetch(`${base}/api/missions/mis_decide`)).json()).tasks.find((t) => t.id === id);
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);

    fs.mkdirSync(path.join(dir, 'db.json.tmp')); // EISDIR: erro real, não transitório
    const a1 = await post('/api/missions/mis_decide/tasks/t_a/approve');
    assert.equal(a1.status, 500, 'a decisão que não foi gravada não é apresentada como sucesso'); assert.match((await a1.json()).error, /nada foi alterado/);
    const r1 = await post('/api/missions/mis_decide/tasks/t_r/reject'); assert.equal(r1.status, 500);
    for (const id of ['t_a', 't_r']) {
      const t = await get(id);
      assert.equal(t.status, 'awaiting_approval', `${id} volta a aguardar aprovação`);
      assert.ok(!('rejected' in t) && !('decidedAt' in t), `${id}: nenhum campo da decisão sobra`);
    }

    fs.rmSync(path.join(dir, 'db.json.tmp'), { recursive: true, force: true });
    assert.equal((await post('/api/missions/mis_decide/tasks/t_a/approve')).status, 200);
    assert.equal((await post('/api/missions/mis_decide/tasks/t_r/reject')).status, 200);
    const a = await get('t_a'), r = await get('t_r');
    assert.equal(a.status, 'completed'); assert.equal(a.rejected, false); assert.ok(a.decidedAt);
    assert.equal(r.status, 'failed'); assert.equal(r.rejected, true);
    assert.equal((await post('/api/missions/mis_decide/tasks/t_a/approve')).status, 409, 'decidida: não decide de novo');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).missions[0].tasks;
    assert.deepEqual(onDisk.map((t) => t.status), ['completed', 'failed'], 'a decisão está no disco');
  } finally { b.child.kill(); }
});

test('corpo acima de 100 KB responde 413 com mensagem clara (não "Erro interno")', async () => {
  const dir = path.join(root, 'd2'); fs.mkdirSync(dir);
  const port = await freePort(), b = boot(port, dir), base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const r = await fetch(`${base}/api/missions`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ title: 'x'.repeat(150 * 1024) }) });
    assert.equal(r.status, 413); assert.match((await r.json()).error, /grande demais/);
    const bad = await fetch(`${base}/api/missions`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: '{nope' });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'JSON inválido.', 'o erro de JSON continua igual');
  } finally { b.child.kill(); }
});
