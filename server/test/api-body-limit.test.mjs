// Corpo grande demais responde 413 com mensagem clara (não "Erro interno"); JSON malformado continua 400 "JSON inválido.".
// Servidor REAL (server/index.js via audit-server-boot.mjs, sonda do Claude falsa) como processo filho, SEMPRE com ORCH_DATA_DIR temporário e porta livre.
// (Antes vivia em task-decision-persistence.test.mjs, junto da aprovação de tarefas do ciclo antigo, que foi removido.)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-server-boot.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-body-limit-'));
const children = new Set();
after(async () => { for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } } await new Promise((r) => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
function boot(port, dir) {
  assert.ok(fs.realpathSync.native(path.dirname(dir)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste tem que ficar no diretório temporário');
  const child = spawn(process.execPath, [BOOT], { env: { ...process.env, PORT: String(port), ORCH_DATA_DIR: dir, ORCH_API_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  return { child, out: () => out, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}
const waitUp = async (b) => { for (let i = 0; i < 80; i++) { if (/FORGE API em/.test(b.out())) return true; await Promise.race([new Promise((r) => setTimeout(r, 100)), b.exited]); } return false; };

test('corpo acima de 100 KB responde 413 com mensagem clara (não "Erro interno"); JSON inválido continua 400', async () => {
  const dir = path.join(root, 'd1'); fs.mkdirSync(dir);
  const port = await freePort(), b = boot(port, dir), base = `http://127.0.0.1:${port}`;
  const post = (body) => fetch(`${base}/api/workspaces/validate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body });
  try {
    assert.equal(await waitUp(b), true, `o servidor não subiu: ${b.out()}`);
    const r = await post(JSON.stringify({ path: 'x'.repeat(150 * 1024) }));
    assert.equal(r.status, 413); assert.match((await r.json()).error, /grande demais/);
    const bad = await post('{nope');
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'JSON inválido.', 'o erro de JSON continua igual');
  } finally { b.child.kill(); }
});
