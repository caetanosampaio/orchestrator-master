// Capacidade de terminais simultâneos: o servidor aceita até MAX_SESSIONS (50) e recusa o seguinte com 409; fechar um libera uma vaga.
// PTY SIMULADO e dados em pasta temporária: nunca toca no db.json real nem abre processo de verdade.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-capacity-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const T = await import('../terminals.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function world() {
  const spawned = []; let pid = 1_940_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }),
    inspectConfig: async () => [], sweepMs: 0, usage: null, persist: () => {}, accounts: null });
  return { spawned, mgr };
}

test('capacidade: o limite do servidor é de 50 terminais simultâneos', () => {
  assert.equal(T.MAX_SESSIONS, 50);
});

test('capacidade: abre 50 terminais, recusa o 51º com 409 e uma vaga liberada volta a aceitar', async () => {
  const w = world();
  for (let i = 0; i < T.MAX_SESSIONS; i++) {
    const r = await w.mgr.create({ role: 'builder', provider: i % 2 ? 'codex' : 'claude' });
    assert.equal(r.status, 201, `terminal ${i + 1}: ${r.error}`);
  }
  assert.equal(w.spawned.length, T.MAX_SESSIONS);
  const over = await w.mgr.create({ role: 'builder' });
  assert.equal(over.status, 409); assert.match(over.error, /Limite de 50 terminais/);
  assert.equal(w.spawned.length, T.MAX_SESSIONS, 'o 51º não chegou a abrir processo');
  w.spawned[0].exit(0);
  const again = await w.mgr.create({ role: 'builder' });
  assert.equal(again.status, 201, again.error);
});
