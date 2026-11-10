// Modelo e esforço por terminal (opcionais): listas FECHADAS por provedor, 400 fora da lista, repasse à CLI como argumentos de um array (sem shell) e reabertura.
// PTY SIMULADO (nenhum Claude/Codex real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-modeleffort-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { default: express } = await import('express');
const P = await import('../providers/index.js');
const { claudeProvider } = await import('../providers/claude.js');
const { codexProvider } = await import('../providers/codex.js');
const T = await import('../terminals.js');
const { apiGuard } = await import('../origin-guard.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws);
function world() {
  const spawned = []; let pid = 1_920_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => [], persist: () => {} });
  return { spawned, db, mgr };
}
const after_ = (args, flag) => args[args.indexOf(flag) + 1];

test('opções: listas fechadas por provedor, congeladas, e providerOptions() devolve cópia { models, efforts } com { id, label }', () => {
  const o = P.providerOptions();
  assert.deepEqual(Object.keys(o).sort(), ['claude', 'codex']);
  for (const id of ['claude', 'codex']) {
    assert.ok(o[id].models.length >= 1 && o[id].efforts.length >= 1);
    for (const x of [...o[id].models, ...o[id].efforts]) assert.deepEqual(Object.keys(x).sort(), ['id', 'label']);
  }
  assert.ok(Object.isFrozen(claudeProvider.options) && Object.isFrozen(claudeProvider.options.models) && Object.isFrozen(codexProvider.options.efforts));
  o.claude.models.length = 0; assert.ok(P.providerOptions().claude.models.length >= 1, 'alterar a cópia não altera o servidor');
});

test('validateChoice: omitido vale; fora da lista, vazio, não-texto e `__proto__` são recusados; valor de um provedor não vale no outro', () => {
  assert.deepEqual(P.validateChoice('claude', {}).value, {});
  assert.deepEqual(P.validateChoice('claude', { model: null, effort: undefined }).value, {});
  assert.deepEqual(P.validateChoice('claude', { model: 'opus', effort: 'high' }).value, { model: 'opus', effort: 'high' });
  assert.equal(P.validateChoice('claude', { model: 'gpt-5' }).field, 'model');
  assert.equal(P.validateChoice('codex', { model: 'opus' }).field, 'model');
  assert.equal(P.validateChoice('claude', { effort: 'max' }).value.effort, 'max');
  assert.equal(P.validateChoice('codex', { effort: 'max' }).field, 'effort', 'max não existe no Codex');
  for (const bad of ['', ' opus', 'opus --dangerously-skip-permissions', '__proto__', 'constructor', 7, false, {}, ['opus']]) assert.equal(P.validateChoice('claude', { model: bad }).field, 'model', JSON.stringify(bad));
  assert.equal(P.validateChoice('gemini', {}).field, 'provider');
  assert.deepEqual(P.tolerantChoice('claude', { model: 'opus', effort: 'nope' }), { model: 'opus' });
  assert.deepEqual(P.tolerantChoice('claude', null), {});
});

test('claude.paneArgs: --model e --effort só na sessão nova, antes de plugin/MCP; sem eles nada muda; retomada não repassa', () => {
  const base = { prompt: 'p', label: 'L', sessionId: 'sid' };
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', ...base }), ['--append-system-prompt', 'p', '--name', 'L', '--session-id', 'sid']);
  const a = claudeProvider.paneArgs({ mode: 'new', ...base, model: 'opus', effort: 'high', pluginDir: '/pl', mcp: { configPath: '/c.json', serverName: 'f' } });
  assert.equal(after_(a, '--model'), 'opus'); assert.equal(after_(a, '--effort'), 'high');
  assert.ok(a.indexOf('--effort') < a.indexOf('--plugin-dir') && a.indexOf('--effort') < a.indexOf('--mcp-config'));
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', ...base, model: 'sonnet' }).slice(-2), ['--model', 'sonnet']);
  const r = claudeProvider.paneArgs({ mode: 'resume', resumeSessionId: 'old', model: 'opus', effort: 'high' });
  assert.ok(!r.includes('--model') && !r.includes('--effort'));
});

test('codex.paneArgs: -m e -c model_reasoning_effort; wrapper .cmd (quote:false) sem aspas; sem eles nada muda', () => {
  const none = codexProvider.paneArgs({ prompt: 'x' });
  assert.ok(!none.includes('-m') && !none.some((x) => /model_reasoning_effort/.test(x)));
  const a = codexProvider.paneArgs({ prompt: 'x', model: 'gpt-5-codex', effort: 'high' });
  assert.equal(after_(a, '-m'), 'gpt-5-codex');
  assert.ok(a.some((x, i) => a[i - 1] === '-c' && x === 'model_reasoning_effort="high"'));
  assert.ok(codexProvider.paneArgs({ prompt: 'x', effort: 'low', quote: false }).includes('model_reasoning_effort=low'));
});

test('create: repassa model/effort ao PTY como argumentos separados (Claude e Codex), registra no histórico e mostra na sessão', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder', model: 'opus', effort: 'high' });
  assert.equal(c.ok, true, c.error);
  const pc = w.spawned.at(-1); assert.equal(pc.file, '/fake/claude'); assert.ok(Array.isArray(pc.args));
  assert.equal(after_(pc.args, '--model'), 'opus'); assert.equal(after_(pc.args, '--effort'), 'high');
  assert.equal(c.session.model, 'opus'); assert.equal(c.session.effort, 'high');
  assert.equal(w.db.terminalSessions.at(-1).model, 'opus');
  const x = await w.mgr.create({ role: 'reviewer', provider: 'codex', model: 'gpt-5', effort: 'xhigh' });
  assert.equal(x.ok, true, x.error);
  const px = w.spawned.at(-1); assert.equal(px.file, '/fake/codex');
  assert.equal(after_(px.args, '-m'), 'gpt-5'); assert.ok(px.args.includes('model_reasoning_effort="xhigh"'));
  // omitido = padrão da CLI: nenhuma flag e campos nulos
  const d = await w.mgr.create({ role: 'scout' });
  const pd = w.spawned.at(-1); assert.ok(!pd.args.includes('--model') && !pd.args.includes('--effort'));
  assert.equal(d.session.model, null); assert.equal(d.session.effort, null); assert.ok(!('model' in w.db.terminalSessions.at(-1)));
});

test('create: model/effort fora da lista do provedor => 400 sem abrir processo', async () => {
  const w = world();
  const bad = async (o, code) => { const r = await w.mgr.create({ role: 'builder', ...o }); assert.equal(r.ok, false, JSON.stringify(o)); assert.equal(r.status, 400); assert.equal(r.code, code); };
  await bad({ model: 'gpt-5' }, 'model_invalid'); // modelo do Codex no Claude
  await bad({ provider: 'codex', model: 'opus' }, 'model_invalid');
  await bad({ provider: 'codex', effort: 'max' }, 'effort_invalid');
  await bad({ effort: 'enorme' }, 'effort_invalid');
  await bad({ model: '--dangerously-skip-permissions' }, 'model_invalid');
  await bad({ model: '' }, 'model_invalid');
  await bad({ model: false }, 'model_invalid');
  await bad({ effort: 3 }, 'effort_invalid');
  assert.equal(w.spawned.length, 0, 'nenhum processo foi aberto'); assert.equal(w.mgr.count(), 0);
});

test('reabrir (provedor sem retomada): a escolha de modelo/esforço gravada volta; valor que já não vale é ignorado em silêncio', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder', provider: 'codex', model: 'gpt-5', effort: 'high' }); assert.equal(c.ok, true, c.error);
  const rec = w.db.terminalSessions.at(-1); w.spawned.at(-1).exit(0); rec.state = 'interrupted';
  const r = await w.mgr.resume({ recordId: rec.id, reopen: true }); assert.equal(r.ok, true, r.error);
  const p = w.spawned.at(-1); assert.equal(after_(p.args, '-m'), 'gpt-5'); assert.ok(p.args.includes('model_reasoning_effort="high"'));
  const rec2 = w.db.terminalSessions.at(-1); rec2.model = 'modelo-removido'; w.spawned.at(-1).exit(0); rec2.state = 'interrupted';
  const r2 = await w.mgr.resume({ recordId: rec2.id, reopen: true }); assert.equal(r2.ok, true, r2.error);
  assert.ok(!w.spawned.at(-1).args.includes('-m'));
});

test('rota POST /api/terminals: aceita model/effort, recusa não-texto e fora da lista com 400 e code', async () => {
  const w = world(), app = express(); app.use('/api', apiGuard); app.use(express.json());
  T.setupTerminals(app, { manager: w.mgr });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }), base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = async (body) => { const r = await fetch(`${base}/api/terminals`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
    const ok = await post({ role: 'builder', model: 'haiku', effort: 'low' });
    assert.equal(ok.status, 201, JSON.stringify(ok.j)); assert.equal(ok.j.session.model, 'haiku'); assert.equal(after_(w.spawned.at(-1).args, '--effort'), 'low');
    const b1 = await post({ role: 'builder', model: 'inexistente' }); assert.equal(b1.status, 400); assert.equal(b1.j.code, 'model_invalid');
    const b2 = await post({ role: 'builder', effort: { x: 1 } }); assert.equal(b2.status, 400); assert.equal(b2.j.code, 'effort_invalid');
    const b3 = await post({ role: 'builder', provider: 'codex', model: ['gpt-5'] }); assert.equal(b3.status, 400);
    const n = await post({ role: 'builder', model: null, effort: null }); assert.equal(n.status, 201, 'null = omitido');
    assert.equal(w.spawned.length, 2);
  } finally { await new Promise((r) => server.close(r)); }
});
