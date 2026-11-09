// Limite real de uso das contas (server/rate-limits.js + createCodexRateLimitsReader em codex-usage.js + --settings no pane do Claude + GET /api/limits).
// Tudo em pastas TEMPORÁRIAS (CLAUDE_CONFIG_DIR e CODEX_HOME falsos, ORCH_DATA_DIR temporário, porta livre): nenhum ~/.claude, ~/.codex, data/ ou porta 4317 é tocado; nenhum Claude/Codex real roda.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ratelim-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const RL = await import('../rate-limits.js');
const { createCodexRateLimitsReader, mapRateLimits } = await import('../codex-usage.js');
const { claudeProvider } = await import('../providers/claude.js');
const { codexProvider } = await import('../providers/codex.js');
const T = await import('../terminals.js');
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', 'claude-statusline-hook.mjs');
const T0 = Date.parse('2026-11-09T12:00:00.000Z'), SEC0 = Math.floor(T0 / 1000), iso = (ms) => new Date(ms).toISOString(), p2 = (n) => String(n).padStart(2, '0');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let dirN = 0; const mk = (name = 'd') => { const d = path.join(root, `${name}${++dirN}`); fs.mkdirSync(d, { recursive: true }); return d; };
const ACC = 'acc_aaaaaaaa', ACC2 = 'acc_bbbbbbbb';
const win = (pct, resetSec) => ({ usedPct: pct, resetsAt: resetSec });
function hookFile(dir, sid, { at = T0, five = win(20, SEC0 + 3600), seven = win(50, SEC0 + 86400) } = {}) {
  const file = path.join(dir, `${sid}.json`); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, `${JSON.stringify({ at: iso(at), fiveHour: five, sevenDay: seven })}\n`);
  const bump = new Date(Date.now() + 1000 * ++mtimeN); fs.utimesSync(file, bump, bump); // mtime sempre novo: o cache por tamanho+mtime não confunde reescritas do mesmo tamanho no mesmo instante
}
let mtimeN = 0;
const rec = (n, over = {}) => ({ id: `ses_${String(n).padStart(8, '0')}`, terminalId: `term_${String(n).padStart(8, '0')}`, provider: 'claude', accountId: 'system', claudeSessionId: uuid(n), role: 'builder', title: `t${n}`, workspaceId: 'ws_a', cwd: '/proj', state: 'exited', ...over });

/** Mundo do leitor: pastas temporárias e um módulo de contas falso. */
function world({ records = [], env = {}, accountList = [{ id: ACC, provider: 'claude', label: 'Trabalho' }], available = true, status = async () => ({ checked: true, loggedIn: true, subscriptionType: 'max' }), codexReader, codexAuth, now = () => T0, extra = {} } = {}) {
  const dir = mk('hooks'), sysCfg = mk('syscfg'), accCfg = mk('acccfg'), accCfg2 = mk('acccfg'), codexHome = mk('codex');
  const cfgOf = { [ACC]: accCfg, [ACC2]: accCfg2 };
  const accounts = { list: () => accountList, configDirOf: (id) => (id === 'system' ? null : cfgOf[id] ?? null), available: () => available, statusOf: status };
  const db = { terminalSessions: records };
  const e = { CLAUDE_CONFIG_DIR: sysCfg, ...env };
  const rl = RL.createRateLimits({ db, accounts, dir, script: SCRIPT, codexHome, codexReader, codexAuth, env: () => e, now, memoMs: 0, connectedTtlMs: 0, ...extra });
  return { rl, db, dir, sysCfg, accCfg, accCfg2, codexHome, accounts };
}
const accOf = (view, provider, id) => view.providers.find((p) => p.provider === provider).accounts.find((a) => a.id === id);
const tick = () => new Promise((r) => setTimeout(r, 20));

// ---------- Claude: arquivos do hook ----------
test('Claude: sem nenhuma sessão a conta é sem-dados; a lista tem Sistema + contas do FORGE e o Codex, no contrato', () => {
  const w = world(); const v = w.rl.view();
  assert.match(v.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(v.providers.map((p) => [p.provider, p.label]), [['claude', 'Claude Code'], ['codex', 'Codex CLI']]);
  assert.deepEqual(v.providers[0].accounts.map((a) => [a.id, a.label]), [['system', 'Sistema'], [ACC, 'Trabalho']]);
  assert.deepEqual(v.providers[1].accounts.map((a) => [a.id, a.label]), [['codex', 'Codex']]);
  for (const a of [...v.providers[0].accounts, ...v.providers[1].accounts]) assert.deepEqual(Object.keys(a), ['id', 'label', 'connected', 'plan', 'source', 'session', 'week', 'updatedAt']);
  assert.deepEqual(accOf(v, 'claude', 'system'), { id: 'system', label: 'Sistema', connected: null, plan: null, source: 'sem-dados', session: null, week: null, updatedAt: null });
});

test('Claude: duas sessões da mesma conta -> vale a janela mais nova (aqui coincide com o `at` mais novo); registro sem accountId é Sistema; contas não se misturam', () => {
  const w = world({ records: [rec(1, { accountId: undefined }), rec(2), rec(3, { accountId: ACC }), rec(4, { provider: 'codex' })] });
  hookFile(w.dir, uuid(1), { at: T0 - 60_000, five: win(10, SEC0 + 3000), seven: win(30, SEC0 + 80000) });
  hookFile(w.dir, uuid(2), { at: T0 - 5_000, five: win(25, SEC0 + 3500), seven: win(55, SEC0 + 85000) }); // mais nova
  hookFile(w.dir, uuid(3), { at: T0 - 1_000, five: win(99, SEC0 + 100), seven: win(98, SEC0 + 200) });
  hookFile(w.dir, uuid(4), { at: T0, five: win(77, SEC0 + 100), seven: win(77, SEC0 + 200) }); // sessão do Codex: não conta
  const v = w.rl.view(), sys = accOf(v, 'claude', 'system'), acc = accOf(v, 'claude', ACC);
  assert.equal(sys.source, 'statusline'); assert.deepEqual(sys.session, { usedPct: 25, resetsAt: iso((SEC0 + 3500) * 1000), windowMinutes: 300 }); assert.deepEqual(sys.week, { usedPct: 55, resetsAt: iso((SEC0 + 85000) * 1000), windowMinutes: 10080 });
  assert.equal(sys.updatedAt, iso(T0 - 5_000));
  assert.equal(acc.session.usedPct, 99); assert.equal(acc.week.usedPct, 98);
});

test('Claude: janela vencida (resetsAt passou) some; uma janela viva e outra vencida mostra só a viva; tudo vencido = sem-dados', () => {
  const w = world({ records: [rec(1)] });
  hookFile(w.dir, uuid(1), { five: win(40, SEC0 - 1), seven: win(60, SEC0 + 1000) });
  let a = accOf(w.rl.view(), 'claude', 'system'); assert.equal(a.session, null); assert.equal(a.week.usedPct, 60); assert.equal(a.source, 'statusline');
  hookFile(w.dir, uuid(1), { five: win(40, SEC0), seven: win(60, SEC0 - 500) }); // exatamente agora também conta como vencida
  a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.source, a.session, a.week, a.updatedAt], ['sem-dados', null, null, null]);
});

test('Claude: por janela, vale o arquivo mais novo que a tem (a janela vencida de uma sessão nova não esconde a viva de outra)', () => {
  const w = world({ records: [rec(1), rec(2)] });
  hookFile(w.dir, uuid(1), { at: T0 - 30_000, five: win(10, SEC0 + 1000), seven: win(20, SEC0 + 5000) });
  hookFile(w.dir, uuid(2), { at: T0 - 1_000, five: null, seven: win(25, SEC0 + 6000) });
  const a = accOf(w.rl.view(), 'claude', 'system'); assert.equal(a.session.usedPct, 10); assert.equal(a.week.usedPct, 25);
});

test('Claude: arquivo corrompido, enorme, com percentual absurdo, com `at` inválido ou no futuro é ignorado; usedPct sempre 0..100', () => {
  const w = world({ records: [rec(1), rec(2), rec(3), rec(4), rec(5)] });
  fs.writeFileSync(path.join(w.dir, `${uuid(1)}.json`), '{ lixo');
  fs.writeFileSync(path.join(w.dir, `${uuid(2)}.json`), JSON.stringify({ at: iso(T0), fiveHour: win(10, SEC0 + 100), pad: 'x'.repeat(10_000) })); // > 4 KB
  fs.writeFileSync(path.join(w.dir, `${uuid(3)}.json`), JSON.stringify({ at: 'ontem', fiveHour: win(10, SEC0 + 100) }));
  fs.writeFileSync(path.join(w.dir, `${uuid(4)}.json`), JSON.stringify({ at: iso(T0 + 3 * 3600_000), fiveHour: win(10, SEC0 + 100) }));
  assert.equal(accOf(w.rl.view(), 'claude', 'system').source, 'sem-dados');
  hookFile(w.dir, uuid(5), { five: win(1e9, SEC0 + 100), seven: win(-40, SEC0 + 100) });
  let a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.session.usedPct, a.week.usedPct], [100, 0]);
  hookFile(w.dir, uuid(5), { five: { usedPct: 'x', resetsAt: SEC0 + 100 }, seven: { usedPct: NaN, resetsAt: SEC0 + 100 } });
  a = accOf(w.rl.view(), 'claude', 'system'); assert.equal(a.source, 'sem-dados');
});

test('Claude: symlink no lugar do arquivo do hook não é seguido', (t) => {
  const w = world({ records: [rec(1)] });
  const target = path.join(mk('alvo'), 'x.json'); fs.writeFileSync(target, JSON.stringify({ at: iso(T0), fiveHour: win(5, SEC0 + 100), sevenDay: null }));
  try { fs.symlinkSync(target, path.join(w.dir, `${uuid(1)}.json`)); } catch { t.skip('sem permissão para criar link simbólico'); return; }
  assert.equal(accOf(w.rl.view(), 'claude', 'system').source, 'sem-dados');
});

test('Claude: só os últimos N registros da conta entram (mais os que estão rodando)', () => {
  const recs = [rec(1, { state: 'running' }), rec(2), rec(3), rec(4)];
  const w = world({ records: recs, extra: { maxRecordsPerAccount: 2 } });
  hookFile(w.dir, uuid(1), { at: T0 - 100, five: win(11, SEC0 + 100) }); hookFile(w.dir, uuid(2), { at: T0 - 50, five: win(22, SEC0 + 100) });
  assert.equal(accOf(w.rl.view(), 'claude', 'system').session.usedPct, 11, 'o registro rodando sempre conta, mesmo fora dos 2 últimos');
  const w2 = world({ records: [rec(1), rec(2), rec(3), rec(4)], extra: { maxRecordsPerAccount: 2 } });
  hookFile(w2.dir, uuid(1), { five: win(11, SEC0 + 100) });
  assert.equal(accOf(w2.rl.view(), 'claude', 'system').source, 'sem-dados', 'o 1º já saiu da janela de 2 e não roda');
});

test('Claude: registros inválidos no banco não derrubam (sem UUID, null, lixo)', () => {
  const w = world({ records: [null, 'x', { claudeSessionId: '../x' }, { claudeSessionId: 5 }, rec(1)] });
  hookFile(w.dir, uuid(1)); assert.equal(accOf(w.rl.view(), 'claude', 'system').source, 'statusline');
  assert.doesNotThrow(() => world({ records: undefined }).rl.view());
});

test('Claude: sem Claude Code instalado (accounts.available false) a lista do Claude fica vazia', () => {
  const w = world({ available: false }); assert.deepEqual(w.rl.view().providers[0].accounts, []);
  assert.equal(RL.createRateLimits({ db: {}, dir: mk(), script: SCRIPT, codexReader: { read: () => null }, now: () => T0 }).view().providers[0].accounts.length, 1, 'sem módulo de contas só o Sistema');
});

// ---------- status line própria / desligado ----------
test('status line própria no settings.json de usuário: source statusline-propria, sem janelas e SEM flag; só a existência da chave é usada', () => {
  const w = world({ records: [rec(1), rec(3, { accountId: ACC })] });
  hookFile(w.dir, uuid(1)); hookFile(w.dir, uuid(3));
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'meu-script' }, outra: 1 }));
  const v = w.rl.view(), s = accOf(v, 'claude', 'system');
  assert.deepEqual([s.source, s.session, s.week, s.updatedAt], ['statusline-propria', null, null, null]);
  assert.equal(accOf(v, 'claude', ACC).source, 'statusline', 'a outra conta tem a própria pasta de configuração');
  assert.equal(w.rl.settingsFileFor('system'), null); assert.ok(w.rl.settingsFileFor(ACC));
  fs.writeFileSync(path.join(w.accCfg, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'x' } }));
  assert.equal(accOf(w.rl.view(), 'claude', ACC).source, 'statusline-propria'); assert.equal(w.rl.settingsFileFor(ACC), null);
  assert.ok(!JSON.stringify(v).includes('meu-script'), 'nada do conteúdo do settings do usuário vaza');
});

test('settings.json do usuário sem statusLine, inválido, ausente, ou com statusLine null: a status line do FORGE é injetada; arquivo gigante: por precaução não', () => {
  const w = world();
  assert.ok(w.rl.settingsFileFor('system'), 'sem settings.json');
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), JSON.stringify({ model: 'x', hooks: {} })); assert.ok(w.rl.settingsFileFor('system'));
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), '{ quebrado'); assert.ok(w.rl.settingsFileFor('system'));
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), JSON.stringify({ statusLine: null })); assert.ok(w.rl.settingsFileFor('system'));
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), JSON.stringify({ x: 'y'.repeat(600_000) })); assert.equal(w.rl.settingsFileFor('system'), null);
  fs.writeFileSync(path.join(w.sysCfg, 'settings.json'), '[1]'); assert.ok(w.rl.settingsFileFor('system'));
});

test('ORCH_CLAUDE_STATUSLINE=off: source desligado, sem janelas e sem flag; qualquer outro valor liga', () => {
  const w = world({ records: [rec(1)], env: { ORCH_CLAUDE_STATUSLINE: 'off' } }); hookFile(w.dir, uuid(1));
  const a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.source, a.session, a.week], ['desligado', null, null]);
  assert.equal(w.rl.settingsFileFor('system'), null); assert.equal(w.rl.settingsFileFor(ACC), null);
  for (const v of ['OFF', ' off ']) assert.equal(world({ env: { ORCH_CLAUDE_STATUSLINE: v } }).rl.settingsFileFor('system'), null, v);
  for (const v of ['on', '1', '', 'false', 'no']) assert.ok(world({ env: { ORCH_CLAUDE_STATUSLINE: v } }).rl.settingsFileFor('system'), v);
  assert.equal(RL.statusLineEnabled({}), true); assert.equal(RL.statusLineEnabled({ ORCH_CLAUDE_STATUSLINE: 'off' }), false);
});

// ---------- arquivo de --settings e argumentos do pane ----------
test('arquivo de settings: JSON válido com statusLine.command entre aspas (barras normais, caminho com espaço), gravado de forma atômica e idempotente', () => {
  const dir = path.join(mk('com espaco'), 'sub dir');
  const rl = RL.createRateLimits({ db: {}, dir, script: SCRIPT, node: 'C:\\Program Files\\nodejs\\node.exe', codexReader: { read: () => null }, env: () => ({ CLAUDE_CONFIG_DIR: mk() }) });
  const f = rl.settingsFileFor('system'); assert.equal(f, path.join(dir, 'claude-settings.json'));
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(j), ['statusLine']); assert.equal(j.statusLine.type, 'command');
  assert.equal(j.statusLine.command, `"C:/Program Files/nodejs/node.exe" "${SCRIPT.replace(/\\/g, '/')}" "${dir.replace(/\\/g, '/')}"`);
  assert.ok(!j.statusLine.command.includes('\\'), 'sem barra invertida (o shell a consumiria)');
  const m = fs.statSync(f).mtimeMs; rl.settingsFileFor('system'); assert.equal(fs.statSync(f).mtimeMs, m, 'conteúdo igual: não regrava');
  fs.rmSync(f); assert.ok(rl.settingsFileFor('system') && fs.existsSync(f), 'apagado: recria');
  assert.deepEqual(fs.readdirSync(dir), ['claude-settings.json']);
});

test('caminhos com caracteres que quebrariam o shell (aspas, $, %, !, crase): a status line não é ligada (sem flag)', () => {
  assert.equal(RL.statusLineSettings({ node: '/usr/bin/node', script: '/a/b.mjs', dir: '/d' }).statusLine.command, '"/usr/bin/node" "/a/b.mjs" "/d"');
  for (const bad of ['/x"y', '/x$y', '/x%y', '/x!y', '/x`y', '/x\ny', '']) {
    assert.equal(RL.statusLineSettings({ node: '/n', script: '/s', dir: bad }), null, JSON.stringify(bad));
    assert.equal(RL.statusLineSettings({ node: bad, script: '/s', dir: '/d' }), null);
  }
  const rl = RL.createRateLimits({ db: {}, dir: path.join(mk(), 'a$b'), script: SCRIPT, codexReader: { read: () => null }, env: () => ({ CLAUDE_CONFIG_DIR: mk() }) });
  assert.equal(rl.settingsFileFor('system'), null);
  assert.equal(RL.createRateLimits({ db: {}, dir: mk(), codexReader: { read: () => null } }).settingsFileFor('system'), null, 'sem script não há flag');
});

test('claude.paneArgs: --settings <arquivo> nos três modos, antes do MCP; sem arquivo, argumentos idênticos aos de antes', () => {
  const SID = uuid(9), OLD = uuid(8), mcp = { configPath: '/m.json', serverName: 'o' };
  for (const [mode, extra] of [['new', { prompt: 'P', label: 'L' }], ['resume', { resumeSessionId: OLD }], ['fork', { resumeSessionId: OLD }]]) {
    const base = { mode, sessionId: SID, ...extra }, plain = claudeProvider.paneArgs(base);
    assert.ok(!plain.includes('--settings'), `${mode}: sem arquivo não há flag`);
    const a = claudeProvider.paneArgs({ ...base, settingsFile: '/s/c s.json', pluginDir: '/p', mcp });
    const i = a.indexOf('--settings'); assert.ok(i >= 0, mode); assert.equal(a[i + 1], '/s/c s.json');
    assert.ok(i < a.indexOf('--mcp-config') && i < a.indexOf('--allowedTools'), `${mode}: antes dos argumentos variádicos de MCP`);
    assert.deepEqual(claudeProvider.paneArgs({ ...base, settingsFile: '/s.json' }).filter((x) => x !== '--settings' && x !== '/s.json'), plain, `${mode}: o resto não muda`);
  }
  assert.equal(claudeProvider.capabilities.statusLine, true); assert.notEqual(codexProvider.capabilities?.statusLine, true);
  assert.ok(!codexProvider.paneArgs({ prompt: 'x', settingsFile: '/s.json' }).includes('--settings'), 'o Codex ignora');
});

function termWorld(statusLine, accounts = null) {
  const spawned = []; let pid = 1_950_000_000, n = 100;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = mk('ws'), wdb = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db: wdb, ptyLib: lib, statusLine, accounts, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true,
    newSessionId: () => uuid(++n), mcp: null, track: () => ({ release() {} }), inspectConfig: async () => [], sweepMs: 0, usage: { read: () => null, has: () => true, forget() {} }, persist: () => {} });
  return { spawned, wdb, mgr };
}
const settingsArg = (args) => { const i = args.indexOf('--settings'); return i < 0 ? null : args[i + 1]; };

test('terminal: novo, retomada e fork do Claude abrem com --settings quando a status line está ligada', async () => {
  const w0 = world(), tw = termWorld(w0.rl);
  const r = await tw.mgr.create({ role: 'builder' }); assert.equal(r.ok, true, r.error);
  const f = settingsArg(tw.spawned[0].args); assert.equal(f, path.join(w0.dir, 'claude-settings.json'));
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).statusLine.type, 'command');
  tw.spawned[0].exit(0); const recd = tw.wdb.terminalSessions[0];
  assert.equal((await tw.mgr.resume({ recordId: recd.id })).ok, true); assert.equal(settingsArg(tw.spawned[1].args), f); assert.equal(tw.spawned[1].args[0], '--resume');
  tw.spawned[1].exit(0);
  assert.equal((await tw.mgr.resume({ recordId: recd.id, fork: true })).ok, true); assert.equal(settingsArg(tw.spawned[2].args), f); assert.ok(tw.spawned[2].args.includes('--fork-session'));
});

test('terminal: desligado por ORCH_CLAUDE_STATUSLINE=off, status line própria ou falha no módulo = abre igual, sem --settings; sem módulo nada muda', async () => {
  for (const [label, statusLine] of [['off', world({ env: { ORCH_CLAUDE_STATUSLINE: 'off' } }).rl], ['sem módulo', null], ['módulo que lança', { settingsFileFor() { throw new Error('boom'); } }]]) {
    const tw = termWorld(statusLine); const r = await tw.mgr.create({ role: 'builder' }); assert.equal(r.ok, true, `${label}: ${r.error}`); assert.equal(settingsArg(tw.spawned[0].args), null, label);
  }
  const own = world(); fs.writeFileSync(path.join(own.sysCfg, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'x' } }));
  const tw = termWorld(own.rl); await tw.mgr.create({ role: 'builder' }); assert.equal(settingsArg(tw.spawned[0].args), null);
});

test('terminal: a conta do pane decide (conta com statusLine própria não recebe; a outra recebe)', async () => {
  const w = world({ accountList: [{ id: ACC, provider: 'claude', label: 'A' }] });
  fs.writeFileSync(path.join(w.accCfg, 'settings.json'), JSON.stringify({ statusLine: 'x' }));
  const calls = []; const spy = { settingsFileFor: (id) => { calls.push(id); return w.rl.settingsFileFor(id); } };
  const tw = termWorld(spy, { ...w.accounts, usable: () => true, exists: () => true, defaultId: () => 'system', envOf: () => ({}), isInUse: () => false });
  await tw.mgr.create({ role: 'builder', accountId: ACC }); await tw.mgr.create({ role: 'builder', accountId: 'system' });
  assert.equal(settingsArg(tw.spawned[0].args), null); assert.ok(settingsArg(tw.spawned[1].args)); assert.deepEqual(calls, [ACC, 'system']);
});

// ---------- Codex ----------
function rollout(home, { ts = T0 - 3600_000, name = null, lines, mtime = null }) {
  const d = new Date(ts), dir = path.join(home, 'sessions', String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate())); fs.mkdirSync(dir, { recursive: true });
  const id = `019a0000-0000-4000-8000-${String(Math.floor(Math.random() * 1e11)).padStart(12, '0')}`;
  const f = path.join(dir, name ?? `rollout-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}-${id}.jsonl`);
  fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  if (mtime !== null) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}
const rlim = (over = {}) => ({ limit_id: 'codex', primary: { used_percent: 12, window_minutes: 300, resets_at: SEC0 + 1800 }, secondary: { used_percent: 40, window_minutes: 10080, resets_at: SEC0 + 86400 }, plan_type: 'plus', credits: null, ...over });
const tc = (at, rate_limits, info = { total_token_usage: { total_tokens: 1 } }) => ({ timestamp: iso(at), type: 'event_msg', payload: { type: 'token_count', info, rate_limits } });
const meta = { timestamp: iso(T0 - 3600_000), type: 'session_meta', payload: { id: 'x', timestamp: iso(T0 - 3600_000), cwd: '/proj' } };
const reader = (home, o = {}) => createCodexRateLimitsReader({ codexHome: home, now: () => T0, ...o });

test('Codex: o último evento do rollout vence; janelas por window_minutes; plano e instante do evento', () => {
  const h = mk('codex');
  rollout(h, { lines: [meta, tc(T0 - 600_000, rlim({ primary: { used_percent: 5, window_minutes: 300, resets_at: SEC0 + 1000 } })), tc(T0 - 60_000, rlim())] });
  const r = reader(h).read();
  assert.deepEqual(r.session, { usedPct: 12, resetsAt: iso((SEC0 + 1800) * 1000), windowMinutes: 300 }); assert.deepEqual(r.week, { usedPct: 40, resetsAt: iso((SEC0 + 86400) * 1000), windowMinutes: 10080 });
  assert.equal(r.planType, 'plus'); assert.equal(r.at, iso(T0 - 60_000));
});

test('Codex: token_count sem rate_limits (info só, rate_limits null) e linha parcial no final são pulados', () => {
  const h = mk('codex');
  const partial = JSON.stringify(tc(T0, rlim({ primary: { used_percent: 99, window_minutes: 300, resets_at: SEC0 + 1 } }))).slice(0, 90); // gravação em andamento
  rollout(h, { lines: [meta, tc(T0 - 120_000, rlim()), tc(T0 - 60_000, undefined), tc(T0 - 30_000, null, null), { timestamp: iso(T0), type: 'event_msg', payload: { type: 'agent_message', rate_limits: rlim({ primary: { used_percent: 1, window_minutes: 300, resets_at: SEC0 + 5 } }) } }, partial] });
  assert.equal(reader(h).read().session.usedPct, 12);
});

test('Codex: janelas pelo window_minutes, não pela chave (primary semanal / secondary 5 h); valores desconhecidos são ignorados; percentual limitado', () => {
  const h = mk('codex');
  rollout(h, { lines: [meta, tc(T0, rlim({ primary: { used_percent: 130, window_minutes: 10080, resets_at: SEC0 + 500 }, secondary: { used_percent: -3, window_minutes: 300, resets_at: SEC0 + 600 } }))] });
  let r = reader(h).read(); assert.equal(r.week.usedPct, 100); assert.equal(r.session.usedPct, 0);
  const h2 = mk('codex'); rollout(h2, { lines: [meta, tc(T0, rlim({ primary: { used_percent: 10, window_minutes: 1440, resets_at: SEC0 + 500 }, secondary: { used_percent: 20, window_minutes: 'x', resets_at: SEC0 + 600 } }))] });
  assert.equal(reader(h2).read(), null, 'evento sem nenhuma janela válida = sem dado');
  assert.deepEqual(mapRateLimits({ primary: { used_percent: 'a', window_minutes: 300, resets_at: SEC0 + 5 }, secondary: { used_percent: 1, window_minutes: 300, resets_at: 'b' } }, T0).session, null);
  assert.deepEqual(mapRateLimits({ primary: { used_percent: 10, window_minutes: 300, resets_at: (SEC0 + 100) * 1000 } }, T0).session.resetsAt, iso((SEC0 + 100) * 1000), 'epoch em ms é normalizado');
  for (const bad of [null, undefined, 'x', 5, []]) assert.deepEqual(mapRateLimits(bad, T0), { planType: null, session: null, week: null });
});

test('Codex: janela vencida por resets_at some (cada uma por si); plano continua', () => {
  const h = mk('codex');
  rollout(h, { lines: [meta, tc(T0, rlim({ primary: { used_percent: 12, window_minutes: 300, resets_at: SEC0 - 1 } }))] });
  const r = reader(h).read(); assert.equal(r.session, null); assert.equal(r.week.usedPct, 40); assert.equal(r.planType, 'plus');
  const w = world({ codexReader: { read: () => ({ planType: 'plus', session: null, week: null, at: iso(T0) }) } });
  assert.deepEqual(accOf(w.rl.view(), 'codex', 'codex'), { id: 'codex', label: 'Codex', connected: null, plan: 'plus', source: 'sem-dados', session: null, week: null, updatedAt: null });
});

test('Codex: vale o evento mais recente entre rollouts (por data do evento), e rollout novo sem rate_limits não esconde o anterior', () => {
  const h = mk('codex');
  rollout(h, { ts: T0 - 7200_000, lines: [meta, tc(T0 - 1000, rlim({ primary: { used_percent: 77, window_minutes: 300, resets_at: SEC0 + 1800 } }))], mtime: T0 - 1000 });
  rollout(h, { ts: T0 - 3600_000, lines: [meta, tc(T0 - 90_000, rlim({ primary: { used_percent: 11, window_minutes: 300, resets_at: SEC0 + 1800 } }))], mtime: T0 }); // mtime mais novo, evento mais velho
  assert.equal(reader(h).read().session.usedPct, 77, 'o evento mais recente de qualquer rollout');
  rollout(h, { ts: T0 - 60_000, lines: [meta, tc(T0 - 5, undefined)], mtime: T0 + 5000 }); // o rollout mais novo ainda não tem rate_limits
  assert.equal(reader(h).read().session.usedPct, 77);
});

test('Codex: rollout mais novo por mtime, em pastas de datas diferentes (sessão longa na pasta antiga); sem sessions ou sem rate_limits = null', () => {
  const h = mk('codex');
  assert.equal(reader(h).read(), null, 'sem a pasta sessions');
  rollout(h, { ts: T0 - 5 * 86400_000, lines: [meta, tc(T0 - 20_000, rlim({ primary: { used_percent: 33, window_minutes: 300, resets_at: SEC0 + 1800 } }))], mtime: T0 - 20_000 });
  rollout(h, { ts: T0 - 3600_000, lines: [meta, tc(T0 - 7200_000, rlim({ primary: { used_percent: 1, window_minutes: 300, resets_at: SEC0 + 1800 } }))], mtime: T0 - 7200_000 });
  assert.equal(reader(h).read().session.usedPct, 33);
  const h2 = mk('codex'); rollout(h2, { lines: [meta, tc(T0, undefined)] }); assert.equal(reader(h2).read(), null);
});

test('Codex: evento fora do final lido (saída enorme depois) é achado ampliando a janela; mudança no arquivo é relida (cache por tamanho+mtime)', () => {
  const h = mk('codex'), big = 'z'.repeat(2000);
  const f = rollout(h, { lines: [meta, tc(T0 - 1000, rlim()), ...Array.from({ length: 200 }, (_, i) => ({ timestamp: iso(T0), type: 'event_msg', payload: { type: 'agent_message', message: `${i}${big}` } }))] });
  const rd = reader(h, { tailBytes: 4096 }); assert.equal(rd.read().session.usedPct, 12);
  fs.appendFileSync(f, JSON.stringify(tc(T0, rlim({ primary: { used_percent: 60, window_minutes: 300, resets_at: SEC0 + 1800 } }))) + '\n');
  assert.equal(rd.read().session.usedPct, 60, 'arquivo cresceu: relido');
});

test('Codex: nome de arquivo inválido, symlink de arquivo e de pasta são ignorados; só arquivos comuns', (t) => {
  const h = mk('codex');
  rollout(h, { ts: T0 - 3600_000, name: 'rollout-x.jsonl', lines: [meta, tc(T0, rlim())] }); rollout(h, { ts: T0 - 3600_000, name: 'outra.txt', lines: [meta, tc(T0, rlim())] });
  assert.equal(reader(h).read(), null, 'nome fora do padrão rollout-<data>-<uuid>.jsonl');
  const ext = mk('externo'), file = path.join(ext, 'rollout-2026-11-09T10-00-00-019a0000-0000-4000-8000-000000000001.jsonl');
  fs.writeFileSync(file, [meta, tc(T0, rlim())].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const d = new Date(T0 - 3600_000), dayDir = path.join(h, 'sessions', String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate()));
  try { fs.symlinkSync(file, path.join(dayDir, path.basename(file))); } catch { /* sem permissão de link de arquivo: só o de pasta abaixo */ }
  assert.equal(reader(h).read(), null, 'link para arquivo de fora não é lido');
  // pasta do dia como junction/link para fora
  const h2 = mk('codex'); fs.mkdirSync(path.join(h2, 'sessions', '2026', '11'), { recursive: true });
  const outsideDay = mk('dia'); fs.copyFileSync(file, path.join(outsideDay, path.basename(file)));
  try { fs.symlinkSync(outsideDay, path.join(h2, 'sessions', '2026', '11', '09'), 'junction'); } catch { t.skip('sem permissão para criar junction'); return; }
  assert.equal(reader(h2).read(), null, 'pasta do dia que é link não é percorrida');
  const h3 = mk('codex'); try { fs.symlinkSync(mk('real'), path.join(h3, 'sessions'), 'junction'); } catch { return; }
  assert.equal(reader(h3).read(), null, 'sessions que é link não é percorrida');
});

test('Codex: pelo módulo, vira source rollout com plano e updatedAt do evento; connected vem da sonda (cache), plano do Claude do status em cache', async () => {
  const h = mk('codex');
  const w = world({ codexReader: reader(h), codexAuth: async () => ({ known: true, loggedIn: true, detail: 'x' }) });
  rollout(w.codexHome, { lines: [meta, tc(T0 - 60_000, rlim())] });
  const w2 = world({ codexReader: reader(w.codexHome), codexAuth: async () => ({ known: true, loggedIn: true, detail: 'texto com e-mail a@b.c' }) });
  let v = w2.rl.view(); let c = accOf(v, 'codex', 'codex');
  assert.deepEqual([c.source, c.plan, c.session.usedPct, c.week.usedPct, c.updatedAt, c.connected], ['rollout', 'plus', 12, 40, iso(T0 - 60_000), null], 'na 1ª chamada o login ainda não foi verificado: null');
  assert.equal(accOf(v, 'claude', 'system').connected, null);
  await tick(); v = w2.rl.view();
  assert.equal(accOf(v, 'codex', 'codex').connected, true); assert.equal(accOf(v, 'claude', 'system').connected, true); assert.equal(accOf(v, 'claude', 'system').plan, 'max');
  assert.ok(!JSON.stringify(v).includes('a@b.c'));
  const w3 = world({ codexAuth: async () => ({ known: false, loggedIn: null }), status: async () => ({ checked: false, loggedIn: null }), codexReader: { read: () => null } });
  w3.rl.view(); await tick(); const v3 = w3.rl.view();
  assert.equal(accOf(v3, 'codex', 'codex').connected, null); assert.equal(accOf(v3, 'claude', 'system').connected, null);
  const w4 = world({ codexAuth: async () => { throw new Error('x'); }, status: async () => { throw new Error('y'); }, codexReader: { read: () => { throw new Error('z'); } } });
  w4.rl.view(); await tick(); assert.doesNotThrow(() => w4.rl.view()); assert.equal(accOf(w4.rl.view(), 'codex', 'codex').source, 'sem-dados');
  let boom = 0; const w5 = world({ status: async () => { boom++; return { checked: true, loggedIn: false, subscriptionType: 'enterprise team' }; }, extra: { connectedTtlMs: 60_000 }, now: () => T0 });
  w5.rl.view(); await tick(); w5.rl.view(); w5.rl.view(); await tick(); assert.equal(boom, 2, 'a sonda de login roda no máximo 1 vez por TTL por conta (Sistema + 1 conta)');
  assert.equal(accOf(w5.rl.view(), 'claude', 'system').plan, null, 'plano com formato estranho vira null'); assert.equal(accOf(w5.rl.view(), 'claude', 'system').connected, false);
});

test('Claude: vale o dado mais novo pela PRÓPRIA janela (resetsAt maior; empate: usedPct maior), não o `at` do hook; `at` só desempata', () => {
  const w = world({ records: [rec(1), rec(2)] });
  hookFile(w.dir, uuid(1), { at: T0 - 1_000, five: win(90, SEC0 + 1000), seven: win(80, SEC0 + 5000) }); // `at` mais novo, mas repete uma janela anterior (resetsAt menor)
  hookFile(w.dir, uuid(2), { at: T0 - 60_000, five: win(5, SEC0 + 2000), seven: win(10, SEC0 + 6000) });
  let a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.session.usedPct, a.week.usedPct], [5, 10]);
  assert.equal(a.session.resetsAt, iso((SEC0 + 2000) * 1000));
  const w2 = world({ records: [rec(1), rec(2)] }); // mesma janela (mesmo resetsAt): o uso só cresce, vale o maior mesmo com `at` mais velho
  hookFile(w2.dir, uuid(1), { at: T0 - 1_000, five: win(20, SEC0 + 3000), seven: win(30, SEC0 + 9000) });
  hookFile(w2.dir, uuid(2), { at: T0 - 90_000, five: win(35, SEC0 + 3000), seven: win(30, SEC0 + 9000) });
  a = accOf(w2.rl.view(), 'claude', 'system'); assert.deepEqual([a.session.usedPct, a.week.usedPct], [35, 30]);
  assert.equal(a.updatedAt, iso(T0 - 1_000), 'updatedAt = o mais novo dos dois dados usados (semana empata e o `at` desempata)');
});

test('Claude: registro SEM accountId (ou null) é Sistema; registro de conta removida (fora da lista) não aparece nem contamina o Sistema', () => {
  const w = world({ records: [rec(1, { accountId: undefined }), rec(2, { accountId: null }), rec(3, { accountId: 'acc_cccccccc' })] });
  hookFile(w.dir, uuid(3), { at: T0, five: win(88, SEC0 + 100), seven: win(77, SEC0 + 100) }); // conta removida
  let v = w.rl.view(); assert.equal(accOf(v, 'claude', 'system').source, 'sem-dados'); assert.equal(accOf(v, 'claude', 'acc_cccccccc'), undefined);
  assert.deepEqual(v.providers[0].accounts.map((a) => a.id), ['system', ACC]);
  hookFile(w.dir, uuid(2), { at: T0 - 1000, five: win(12, SEC0 + 300), seven: win(34, SEC0 + 400) });
  v = w.rl.view(); assert.deepEqual([accOf(v, 'claude', 'system').source, accOf(v, 'claude', 'system').session.usedPct], ['statusline', 12], 'accountId null = Sistema');
  const w2 = world({ records: [rec(1, { accountId: undefined })] }); hookFile(w2.dir, uuid(1), { five: win(7, SEC0 + 300), seven: null });
  assert.equal(accOf(w2.rl.view(), 'claude', 'system').session.usedPct, 7, 'accountId ausente = Sistema');
});

test('writeSettingsFile: .tmp previsível plantado como symlink não é seguido (nome aleatório + wx); sem .tmp sobrando', (t) => {
  const dir = mk('cfg'), file = path.join(dir, 'claude-settings.json'), alvo = path.join(mk('alvo'), 'a.txt'); fs.writeFileSync(alvo, 'intacto');
  try { fs.symlinkSync(alvo, `${file}.${process.pid}.tmp`); } catch { t.skip('sem permissão para criar link simbólico'); return; }
  RL.writeSettingsFile(file, { a: 1 });
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'intacto'); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['claude-settings.json', `claude-settings.json.${process.pid}.tmp`].sort(), 'só o link plantado sobrou');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('dir/script relativos viram absolutos: o arquivo de settings e o comando da status line usam caminhos absolutos', () => {
  const rel = path.relative(process.cwd(), mk('rel')), relScript = path.relative(process.cwd(), SCRIPT);
  const rl = RL.createRateLimits({ db: {}, dir: rel, script: relScript, codexReader: { read: () => null }, env: () => ({ CLAUDE_CONFIG_DIR: mk() }) });
  const f = rl.settingsFileFor('system'); assert.ok(f && path.isAbsolute(f), f);
  const parts = [...JSON.parse(fs.readFileSync(f, 'utf8')).statusLine.command.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(parts.length, 3); for (const p of parts) assert.ok(path.isAbsolute(p), p);
  assert.equal(parts[2], path.resolve(rel).replace(/\\/g, '/'));
});

test('login em segundo plano: consulta que nunca resolve não prende o estado (timeout de 10 s) e o resultado tardio é ignorado; rejeição limpa o plano', async () => {
  let t = T0; const calls = [];
  const w = world({ accountList: [], now: () => t, codexReader: { read: () => null }, status: () => new Promise((res, rej) => calls.push({ res, rej })) });
  w.rl.view(); await tick(); assert.equal(calls.length, 1);
  t = T0 + 5000; w.rl.view(); await tick(); assert.equal(calls.length, 1, 'ainda pendente (< 10 s): não dispara outra');
  t = T0 + 11_000; w.rl.view(); await tick(); assert.equal(calls.length, 2, 'passou de 10 s: a consulta presa é descartada e uma nova começa');
  calls[0].res({ checked: true, loggedIn: true, subscriptionType: 'max' }); await tick();
  assert.equal(accOf(w.rl.view(), 'claude', 'system').connected, null, 'o resultado da consulta descartada é ignorado');
  calls[1].res({ checked: true, loggedIn: true, subscriptionType: 'max' }); await tick();
  let a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.connected, a.plan], [true, 'max']);
  await tick(); const last = calls.length - 1; assert.equal(last, 2, 'a leitura acima iniciou a consulta seguinte (TTL 0)'); calls[last].rej(new Error('falhou')); await tick();
  a = accOf(w.rl.view(), 'claude', 'system'); assert.deepEqual([a.connected, a.plan], [null, null], 'rejeição limpa também o plano');
});

test('login em segundo plano: estado de conta removida é esquecido (memória limitada)', () => {
  const list = [{ id: ACC, provider: 'claude', label: 'T' }];
  const w = world({ accountList: list }); w.rl.view(); assert.equal(w.rl.stats().connEntries, 2);
  list.length = 0; w.rl.view(); assert.equal(w.rl.stats().connEntries, 1);
});

test('Codex: `rate_limits: {}` (sem janelas válidas) não esconde o evento anterior que tinha janelas', () => {
  const h = mk('codex');
  rollout(h, { lines: [meta, tc(T0 - 120_000, rlim()), tc(T0 - 60_000, {}), tc(T0 - 30_000, { plan_type: 'plus' }), tc(T0 - 10_000, { primary: { used_percent: 'x' } })] });
  const r = reader(h).read(); assert.equal(r.session.usedPct, 12); assert.equal(r.week.usedPct, 40); assert.equal(r.at, iso(T0 - 120_000));
});

test('Codex: formato antigo `resets_in_seconds` = instante do evento + segundos; inválido, vencido ou sem data do evento = sem janela', () => {
  const h = mk('codex'), ev = T0 - 60_000;
  rollout(h, { lines: [meta, tc(ev, { plan_type: 'plus', primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 1800 }, secondary: { used_percent: 50, window_minutes: 10080, resets_in_seconds: 90_000 } })] });
  const r = reader(h).read(); assert.equal(r.session.usedPct, 20); assert.equal(r.session.resetsAt, iso(ev + 1_800_000)); assert.equal(r.week.resetsAt, iso(ev + 90_000_000));
  const old = mapRateLimits({ primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 10 } }, T0, ev); assert.equal(old.session, null, 'ev + 10 s já passou');
  for (const bad of [-5, 'x', null, 1e12, NaN]) assert.equal(mapRateLimits({ primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: bad } }, T0, ev).session, null, String(bad));
  assert.equal(mapRateLimits({ primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 1800 } }, T0).session, null, 'sem a data do evento não há como saber');
  assert.equal(mapRateLimits({ primary: { used_percent: 20, window_minutes: 300, resets_at: SEC0 + 100, resets_in_seconds: 5 } }, T0, ev).session.resetsAt, iso((SEC0 + 100) * 1000), 'resets_at tem precedência');
});

// Roda o comando REAL gerado (como o Claude Code o executa) num bash, com espaço e acento no node-stub, no script e na pasta de dados.
function findBash() {
  const cands = process.platform === 'win32' ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean).map((p) => path.join(p, 'Git', 'bin', 'bash.exe')) : ['bash'];
  for (const c of cands) { try { const r = spawnSync(c, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 10000, windowsHide: true }); if (r.status === 0 && r.stdout.trim() === 'ok') return c; } catch { /* próximo */ } }
  return null;
}
test('statusLine.command gerado EXECUTA de verdade no bash com espaço e acento nos caminhos (node-stub, script e pasta de dados)', (t) => {
  const bash = findBash(); if (!bash) { t.skip('bash não encontrado'); return; }
  const base = mk('ação com espaço '), stub = path.join(base, 'nó stub'), sdir = path.join(base, 'scrípt dir'), data = path.join(base, 'dádos limites');
  fs.mkdirSync(sdir, { recursive: true }); const script = path.join(sdir, 'claude-statusline-hook.mjs'); fs.copyFileSync(SCRIPT, script);
  fs.writeFileSync(stub, `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, '/')}" "$@"\n`); fs.chmodSync(stub, 0o755);
  const settings = RL.statusLineSettings({ node: stub, script, dir: data }); assert.ok(settings, 'caminhos com espaço e acento são aceitos');
  const sec = Math.floor(Date.now() / 1000), sid = uuid(42);
  const r = spawnSync(bash, ['-c', settings.statusLine.command], { input: JSON.stringify({ session_id: sid, rate_limits: { five_hour: { used_percentage: 12.3, resets_at: sec + 3600 }, seven_day: { used_percentage: 50, resets_at: sec + 86400 } } }), encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'FORGE · 5h 12% · semana 50%\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, `${sid}.json`), 'utf8')).fiveHour.usedPct, 12.3);
});

test('memo curto: chamadas dentro de ~2 s dividem o mesmo cálculo', () => {
  let t = T0; const w = world({ now: () => t, extra: { memoMs: 2000 } });
  const a = w.rl.view(); t += 1999; assert.equal(w.rl.view(), a); t += 2; assert.notEqual(w.rl.view(), a);
});

test('resposta: sem caminhos, UUIDs de sessão, ids de registro/terminal nem e-mails', () => {
  const w = world({ records: [rec(1), rec(2, { accountId: ACC })], codexReader: { read: () => ({ planType: 'plus', session: null, week: null, at: iso(T0) }) } });
  hookFile(w.dir, uuid(1)); hookFile(w.dir, uuid(2));
  const text = JSON.stringify(w.rl.view());
  for (const bad of [root, w.dir, uuid(1), uuid(2), 'ses_', 'term_', '@', 'claude-settings', 'rollout', '\\\\']) assert.ok(!text.includes(bad), `vazou ${bad}`);
});

test('sweep: só remove <uuid>.json (e .tmp órfão) antigos da pasta do hook', () => {
  const w = world({ now: () => T0 + 40 * 86400_000 }); hookFile(w.dir, uuid(1)); fs.writeFileSync(path.join(w.dir, 'claude-settings.json'), '{}'); fs.writeFileSync(path.join(w.dir, 'outro.txt'), 'x');
  const old = new Date(T0 - 1000); fs.utimesSync(path.join(w.dir, `${uuid(1)}.json`), old, old); fs.utimesSync(path.join(w.dir, 'claude-settings.json'), old, old);
  assert.equal(w.rl.sweep(), 1); assert.deepEqual(fs.readdirSync(w.dir).sort(), ['claude-settings.json', 'outro.txt']);
  assert.equal(RL.createRateLimits({ db: {}, dir: path.join(root, 'nao-existe'), codexReader: { read: () => null } }).sweep(), 0);
});

// ---------- servidor real: GET /api/limits ----------
const INDEX_BOOT = path.join(here, 'accounts-boot.mjs'); // servidor real com executor falso e a CLI falsa de contas (o Claude real nunca roda)
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawGet = (port, urlPath, headers) => new Promise((resolve, reject) => { const q = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }); q.on('error', reject); });
async function bootReal(env) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`, emptyPath = mk('path-vazio');
  const base = { ...process.env }; for (const k of Object.keys(base)) if (k.toUpperCase() === 'PATH') delete base[k]; // nenhum claude/codex do PATH pode ser executado
  const child = spawn(process.execPath, [INDEX_BOOT], { env: { ...base, PATH: emptyPath, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.on('exit', r));
  for (let i = 0; i < 100 && !/FORGE API em/.test(out); i++) await Promise.race([sleep(100), exited]);
  assert.match(out, /FORGE API em/, out);
  return { port, origin, stop: async () => { child.kill(); await exited; await sleep(300); } };
}

test('servidor real: GET /api/limits devolve o contrato completo, protegido por Host/Origin, sem caminhos/UUIDs', async () => {
  const data = mk('data'), cfg = mk('claude'), codexHome = mk('codex'), proj = mk('proj'), now = Date.now(), sec = Math.floor(now / 1000);
  fs.writeFileSync(path.join(cfg, 'fake-login.json'), '{}'); // a CLI falsa responde "conectado" (plano pro) para a conta Sistema
  const A = rec(1, { cwd: proj, workspaceId: 'ws_a' }), B = rec(2, { accountId: ACC, cwd: proj, workspaceId: 'ws_a' });
  fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ version: 1, settings: { activeWorkspaceId: null, requireApproval: true, showDemoData: false }, workspaces: [{ id: 'ws_a', name: 'a', path: proj }], missions: [], activity: [], accounts: [{ id: ACC, provider: 'claude', label: 'Trabalho', createdAt: iso(now) }], terminalSessions: [A, B] }));
  hookFile(path.join(data, 'rate-limits'), uuid(1), { at: now - 1000, five: win(23.4, sec + 3600), seven: win(41, sec + 86400) });
  rollout(codexHome, { ts: now - 3600_000, lines: [meta, tc(now - 2000, rlim({ primary: { used_percent: 9, window_minutes: 300, resets_at: sec + 1200 }, secondary: { used_percent: 31, window_minutes: 10080, resets_at: sec + 90000 } }))] });
  const s = await bootReal({ ORCH_DATA_DIR: data, CLAUDE_CONFIG_DIR: cfg, CODEX_HOME: codexHome });
  try {
    const ok = await rawGet(s.port, '/api/limits', { origin: s.origin }); assert.equal(ok.status, 200); assert.match(ok.headers['content-type'], /json/); assert.equal(ok.headers['cache-control'], 'no-store');
    const j = JSON.parse(ok.body); assert.deepEqual(Object.keys(j), ['updatedAt', 'providers']); assert.deepEqual(j.providers.map((p) => p.provider), ['claude', 'codex']);
    const sys = accOf(j, 'claude', 'system'), acc = accOf(j, 'claude', ACC), cx = accOf(j, 'codex', 'codex');
    assert.deepEqual([sys.label, sys.source, sys.session.usedPct, sys.week.usedPct, sys.session.windowMinutes, sys.week.windowMinutes], ['Sistema', 'statusline', 23.4, 41, 300, 10080]);
    assert.equal(sys.session.resetsAt, iso((sec + 3600) * 1000)); assert.equal(sys.updatedAt, iso(now - 1000));
    assert.deepEqual([acc.label, acc.source, acc.session, acc.week], ['Trabalho', 'sem-dados', null, null]);
    assert.deepEqual([cx.source, cx.plan, cx.session.usedPct, cx.week.usedPct], ['rollout', 'plus', 9, 31]);
    for (const bad of [data, cfg, codexHome, proj, uuid(1), uuid(2), 'ses_', 'term_', '.jsonl', 'claude-settings']) assert.ok(!ok.body.includes(bad), `vazou ${bad}`);
    assert.equal((await rawGet(s.port, '/api/limits', {})).status, 200, 'GET sem Origin é aceito, como nas demais leituras');
    assert.equal((await rawGet(s.port, '/api/limits', { origin: 'http://evil.example' })).status, 403, 'Origin de fora: recusado pelo apiGuard');
    assert.equal((await rawGet(s.port, '/api/limits', { host: 'evil.example' })).status, 403, 'Host de fora: recusado pelo apiGuard');
    await sleep(2300); // passa o memo de 2 s: o login (verificado em segundo plano na 1ª chamada) já aparece
    const again = JSON.parse((await rawGet(s.port, '/api/limits', { origin: s.origin })).body);
    assert.equal(accOf(again, 'claude', 'system').connected, true); assert.equal(accOf(again, 'claude', 'system').plan, 'pro');
  } finally { await s.stop(); }
});
