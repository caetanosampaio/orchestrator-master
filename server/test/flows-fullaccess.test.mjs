// Missions v2: opção `fullAccess` dos terminais ("acesso total": sobe sem pedir confirmação de permissão). Só o booleano `true` estrito liga; vale só em sessão NOVA;
// nunca vem do corpo de POST /api/terminals. PTY SIMULADO (nenhum Claude/Codex real), banco temporário (ORCH_DATA_DIR).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-full-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { default: express } = await import('express');
const { claudeProvider } = await import('../providers/claude.js');
const { codexProvider } = await import('../providers/codex.js');
const T = await import('../terminals.js');
const { apiGuard } = await import('../origin-guard.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLAUDE_FLAG = '--dangerously-skip-permissions', CODEX_FLAG = '--dangerously-bypass-approvals-and-sandbox';
const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws);
function world() {
  const spawned = []; let pid = 1_930_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => [], persist: () => {} });
  return { spawned, db, mgr };
}

test('claude.paneArgs: a flag só com `true` estrito, só na sessão nova, antes de plugin/MCP (que aceitam vários valores)', () => {
  const base = { prompt: 'p', label: 'L', sessionId: 'sid' };
  const on = claudeProvider.paneArgs({ mode: 'new', ...base, fullAccess: true, model: 'opus', pluginDir: '/pl', mcp: { configPath: '/c.json', serverName: 'f' } });
  assert.ok(on.includes(CLAUDE_FLAG)); assert.equal(on.filter((x) => x === CLAUDE_FLAG).length, 1);
  assert.ok(on.indexOf(CLAUDE_FLAG) < on.indexOf('--plugin-dir') && on.indexOf(CLAUDE_FLAG) < on.indexOf('--mcp-config'));
  assert.equal(on[on.indexOf(CLAUDE_FLAG) + 1], '--model', 'a flag não tem valor: o argumento seguinte continua sendo uma opção');
  for (const v of [false, undefined, null, 'true', 1, 'yes', {}, [], [true], 0, NaN]) assert.ok(!claudeProvider.paneArgs({ mode: 'new', ...base, fullAccess: v }).includes(CLAUDE_FLAG), JSON.stringify(v));
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', ...base }), ['--append-system-prompt', 'p', '--name', 'L', '--session-id', 'sid'], 'sem a opção nada muda');
  for (const mode of ['resume', 'fork']) assert.ok(!claudeProvider.paneArgs({ mode, resumeSessionId: 'old', sessionId: 'sid', fullAccess: true }).includes(CLAUDE_FLAG), mode);
});

test('codex.paneArgs: `true` estrito troca sandbox+aprovação pela flag exclusiva; qualquer outro valor mantém o modo padrão', () => {
  const on = codexProvider.paneArgs({ prompt: 'x', fullAccess: true });
  assert.ok(on.includes(CODEX_FLAG)); assert.ok(!on.includes('-s') && !on.includes('-a') && !on.includes('workspace-write') && !on.includes('on-request'), 'a flag é exclusiva de -s/-a na CLI');
  assert.deepEqual(on.slice(0, 3), ['--no-alt-screen', '--no-daemon', CODEX_FLAG]);
  const std = codexProvider.paneArgs({ prompt: 'x' });
  assert.deepEqual(std.slice(0, 6), ['--no-alt-screen', '--no-daemon', '-s', 'workspace-write', '-a', 'on-request']);
  for (const v of [false, undefined, null, 'true', 1, 'yes', {}, [], [true], 0]) { const a = codexProvider.paneArgs({ prompt: 'x', fullAccess: v }); assert.ok(!a.includes(CODEX_FLAG), JSON.stringify(v)); assert.deepEqual(a, std); }
  assert.throws(() => codexProvider.paneArgs({ mode: 'resume', prompt: 'x', fullAccess: true }), /retomada/);
  const full = codexProvider.paneArgs({ prompt: 'x', fullAccess: true, model: 'gpt-5', effort: 'high', mcp: { url: 'http://127.0.0.1:1/mcp', serverName: 'forge_abc123' }, trustDir: '/w' });
  assert.ok(full.includes(CODEX_FLAG) && full.includes('-m') && full.some((a) => a.startsWith('mcp_servers.forge_abc123.url')), 'MCP, modelo e confiança continuam');
});

test('terminals.create: fullAccess true chega à CLI de cada provedor e a sessão registra `fullAccess`; o padrão e o `false` nunca', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder', fullAccess: true }); assert.equal(c.ok, true, c.error);
  assert.ok(w.spawned.at(-1).args.includes(CLAUDE_FLAG)); assert.equal(c.session.fullAccess, true); assert.equal(w.mgr.get(c.session.id).fullAccess, true); assert.equal(w.mgr.list()[0].fullAccess, true);
  const x = await w.mgr.create({ role: 'builder', provider: 'codex', fullAccess: true }); assert.equal(x.ok, true, x.error);
  assert.ok(w.spawned.at(-1).args.includes(CODEX_FLAG)); assert.equal(x.session.fullAccess, true);
  for (const opts of [{}, { fullAccess: false }, { fullAccess: null }, { fullAccess: undefined }]) {
    for (const provider of ['claude', 'codex']) {
      const r = await w.mgr.create({ role: 'builder', provider, ...opts }); assert.equal(r.ok, true, r.error);
      const args = w.spawned.at(-1).args; assert.ok(!args.includes(CLAUDE_FLAG) && !args.includes(CODEX_FLAG), `${provider} ${JSON.stringify(opts)}`); assert.equal(r.session.fullAccess, false);
    }
  }
});

test('terminals.create: valor que não é booleano é RECUSADO (400) antes de qualquer efeito; nada é iniciado', async () => {
  const w = world(); const before = w.spawned.length;
  for (const v of ['true', 'yes', 1, 0, {}, [], [true], '']) {
    const r = await w.mgr.create({ role: 'builder', fullAccess: v });
    assert.equal(r.ok, false, JSON.stringify(v)); assert.equal(r.status, 400); assert.equal(r.code, 'fullAccess_invalid'); assert.match(r.error, /fullAccess/);
  }
  assert.equal(w.spawned.length, before); assert.equal(w.mgr.count(), 0);
});

test('o corpo de POST /api/terminals NUNCA liga o acesso total (a opção é interna, de quem monta a missão)', async () => {
  const w = world(); const app = express(); app.use('/api', apiGuard); app.use(express.json()); T.setupTerminals(app, { manager: w.mgr });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const v of [true, 'true', 1]) {
      const r = await fetch(`${base}/api/terminals`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ role: 'builder', fullAccess: v, acknowledgeProjectConfig: true }) });
      assert.equal(r.status, 201); const j = await r.json(); assert.equal(j.session.fullAccess, false, JSON.stringify(v));
      assert.ok(!w.spawned.at(-1).args.includes(CLAUDE_FLAG));
    }
  } finally { await new Promise((r) => srv.close(r)); }
});

test('o histórico de sessões não guarda `fullAccess` (reabrir/retomar nunca herda o acesso total)', async () => {
  const w = world(); const c = await w.mgr.create({ role: 'builder', fullAccess: true }); assert.equal(c.ok, true);
  assert.ok(!('fullAccess' in w.db.terminalSessions[0]), 'o registro só tem metadados antigos');
  assert.ok(!JSON.stringify(w.mgr.history()).includes('fullAccess'));
});
