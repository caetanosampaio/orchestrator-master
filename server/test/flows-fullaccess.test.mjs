// Missions v2: opção `fullAccess` dos terminais ("acesso total": sobe sem pedir confirmação de permissão). Só o booleano `true` estrito liga; vale em sessão nova e, quando a sessão gravada já tinha acesso total, também na retomada/reabertura (o Claude Code não restaura o bypass);
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
function world(extra = {}) {
  const spawned = []; let pid = 1_930_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => [], persist: () => {}, ...extra });
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
  // retomada/fork: o Claude Code NÃO restaura o bypass, então o FORGE o repassa quando a sessão gravada tinha acesso total (e só com `true` estrito)
  for (const mode of ['resume', 'fork']) {
    const on = claudeProvider.paneArgs({ mode, resumeSessionId: 'old', sessionId: 'sid', fullAccess: true, pluginDir: '/pl' });
    assert.ok(on.includes(CLAUDE_FLAG), mode); assert.ok(on.indexOf(CLAUDE_FLAG) < on.indexOf('--plugin-dir'), `${mode}: a flag vem antes de plugin/MCP`); assert.equal(on[0], '--resume');
    for (const v of [false, undefined, null, 'true', 1, {}, [true]]) assert.ok(!claudeProvider.paneArgs({ mode, resumeSessionId: 'old', sessionId: 'sid', fullAccess: v }).includes(CLAUDE_FLAG), `${mode} ${JSON.stringify(v)}`);
  }
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

test('o registro da sessão grava `fullAccess` só quando a sessão teve acesso total; o histórico para a interface não o expõe', async () => {
  const w = world(); const c = await w.mgr.create({ role: 'builder', fullAccess: true }); assert.equal(c.ok, true);
  assert.equal(w.db.terminalSessions[0].fullAccess, true, 'o registro lembra o acesso total (para a retomada)');
  const d = await w.mgr.create({ role: 'builder' }); assert.equal(d.ok, true);
  assert.ok(!('fullAccess' in w.db.terminalSessions[1]), 'sessão comum: nada gravado');
  assert.ok(!JSON.stringify(w.mgr.history()).includes('fullAccess'));
});

test('reabrir um terminal de missão (servidor parou com ele aberto) mantém o acesso total; o de uma sessão comum continua sem', async () => {
  const w = world();
  const full = await w.mgr.create({ role: 'builder', fullAccess: true }), plain = await w.mgr.create({ role: 'builder' }); assert.ok(full.ok && plain.ok);
  for (const sp of w.spawned.slice(0, 2)) sp.exit(0); // o processo acabou (simula o servidor parar com os terminais abertos)
  for (const r of w.db.terminalSessions) { r.state = 'interrupted'; r.endedAt = new Date().toISOString(); }
  const rf = await w.mgr.resume({ recordId: w.db.terminalSessions[0].id, reopen: true }); assert.equal(rf.ok, true, rf.error);
  assert.ok(w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'o terminal reaberto sobe com a flag'); assert.equal(rf.session.fullAccess, true);
  const rp = await w.mgr.resume({ recordId: w.db.terminalSessions[1].id, reopen: true }); assert.equal(rp.ok, true, rp.error);
  assert.ok(!w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'sessão comum reaberta não ganha acesso total'); assert.ok(!rp.session.fullAccess);
  const fresh = w.db.terminalSessions.find((r) => r.id !== w.db.terminalSessions[0].id && r.fullAccess === true); assert.ok(fresh, 'a sessão nova também lembra o acesso total');
});

test('Maestro autônomo ligado: todo terminal que abre agora (Cockpit ou missão) sobe com acesso total; desligado, só quem pediu; o corpo da rota continua sem poder ligar', async () => {
  const st = { on: true };
  const w = world({ autoFullAccess: () => st.on });
  const a = await w.mgr.create({ role: 'builder' }); assert.equal(a.ok, true, a.error);
  assert.ok(w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'claude comum abre com a flag'); assert.equal(a.session.fullAccess, true); assert.ok(!('fullAccess' in w.db.terminalSessions[0]), 'o que o autônomo liga não é gravado: vale o estado do autônomo a cada abertura');
  const x = await w.mgr.create({ role: 'builder', provider: 'codex' }); assert.equal(x.ok, true, x.error);
  assert.ok(w.spawned.at(-1).args.includes(CODEX_FLAG), 'codex novo também'); assert.equal(x.session.fullAccess, true);
  st.on = false;
  const b = await w.mgr.create({ role: 'builder' }); assert.equal(b.ok, true, b.error);
  assert.ok(!w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'desligado: sem a flag'); assert.equal(b.session.fullAccess, false); assert.ok(!('fullAccess' in w.db.terminalSessions[2]));
  assert.equal(w.mgr.get(a.session.id).fullAccess, true, 'o terminal que já estava aberto não muda de modo');
  const c = await w.mgr.create({ role: 'builder', fullAccess: true }); assert.equal(c.ok, true); assert.ok(w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'a missão com acesso total continua independente do autônomo');
});

test('autoFullAccess com defeito (lança) ou devolvendo algo que não é true estrito nunca liga o acesso total', async () => {
  for (const fn of [() => { throw new Error('x'); }, () => 'true', () => 1, () => ({}), () => undefined, () => null]) {
    const w = world({ autoFullAccess: fn }); const r = await w.mgr.create({ role: 'builder' }); assert.equal(r.ok, true, r.error);
    assert.ok(!w.spawned.at(-1).args.includes(CLAUDE_FLAG)); assert.equal(r.session.fullAccess, false);
  }
});

test('Maestro autônomo e a reabertura: sessão comum reaberta com o autônomo ligado ganha acesso total; com ele desligado, reabrir de novo NÃO herda (só o opt-in explícito persiste)', async () => {
  const st = { on: false };
  const w = world({ autoFullAccess: () => st.on });
  const plain = await w.mgr.create({ role: 'builder' }); assert.ok(plain.ok);
  w.spawned.at(-1).exit(0); const rec = w.db.terminalSessions[0]; rec.state = 'interrupted'; rec.endedAt = new Date().toISOString();
  st.on = true;
  const r = await w.mgr.resume({ recordId: rec.id, reopen: true }); assert.equal(r.ok, true, r.error);
  assert.ok(w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'reaberto com o autônomo ligado: acesso total'); assert.equal(r.session.fullAccess, true);
  assert.ok(!('fullAccess' in w.db.terminalSessions.find((x) => x.id === rec.id)), 'o registro da sessão comum continua sem acesso total gravado');
  // desliga o autônomo e reabre a nova sessão de novo: nada foi gravado, então não herda
  w.spawned.at(-1).exit(0); const again = w.db.terminalSessions.find((x) => x.id === r.session.recordId); again.state = 'interrupted'; again.endedAt = new Date().toISOString();
  st.on = false;
  const r2 = await w.mgr.resume({ recordId: again.id, reopen: true }); assert.equal(r2.ok, true, r2.error);
  assert.ok(!w.spawned.at(-1).args.includes(CLAUDE_FLAG), 'autônomo desligado: reaberta sem acesso total'); assert.ok(!r2.session.fullAccess);
});

test('Codex: reabrir um registro com acesso total explícito mantém a flag; retomar ou bifurcar o Codex é recusado sem abrir processo (nunca recebe a flag)', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder', provider: 'codex', fullAccess: true }); assert.equal(c.ok, true, c.error);
  assert.equal(w.db.terminalSessions[0].fullAccess, true, 'opt-in explícito fica gravado');
  w.spawned.at(-1).exit(0); const rec = w.db.terminalSessions[0]; rec.state = 'interrupted'; rec.endedAt = new Date().toISOString();
  const before = w.spawned.length;
  for (const opts of [{ recordId: rec.id }, { recordId: rec.id, fork: true }]) { const r = await w.mgr.resume(opts); assert.equal(r.ok, false, JSON.stringify(opts)); }
  assert.equal(w.spawned.length, before, 'nenhum processo aberto na retomada/fork do Codex');
  const ro = await w.mgr.resume({ recordId: rec.id, reopen: true }); assert.equal(ro.ok, true, ro.error);
  assert.ok(w.spawned.at(-1).args.includes(CODEX_FLAG), 'reabrir (sessão nova) mantém a flag do Codex'); assert.equal(ro.session.fullAccess, true);
});
