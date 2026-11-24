// Provedores de agentes (server/providers): o adaptador do Claude Code gera EXATAMENTE os argumentos de sempre, o registro rejeita ids estranhos e o gerenciador de
// terminais grava o provedor na sessão, no histórico e na API. PTY SIMULADO (nenhum Claude real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-prov-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const P = await import('../providers/index.js');
const { claudeProvider, resolveClaude } = await import('../providers/claude.js');
const T = await import('../terminals.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SID = '00000000-0000-4000-8000-000000000001', OLD = '00000000-0000-4000-8000-000000000002';
const mcp = { configPath: '/tmp/x/mcp.json', serverName: 'orchestrator_abc123' };

test('registro: o padrão é o Claude Code; id desconhecido ou perigoso lança; sem id vale o padrão (sessões antigas)', () => {
  assert.equal(P.DEFAULT_PROVIDER, 'claude'); assert.deepEqual(P.providerIds(), ['claude', 'codex']);
  assert.equal(P.getProvider(), claudeProvider); assert.equal(P.getProvider('claude'), claudeProvider); assert.equal(P.getProvider(undefined), claudeProvider);
  for (const bad of ['', 'CODEX', 'CLAUDE', '__proto__', 'constructor', 'toString', null, 7, {}]) { assert.equal(P.isProvider(bad), false, String(bad)); if (bad !== undefined) assert.throws(() => P.getProvider(bad), /Provedor desconhecido/); }
  assert.ok(Object.isFrozen(claudeProvider));
});

test('claude.paneArgs: new, resume e fork geram os MESMOS argumentos de antes (com e sem MCP)', () => {
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', prompt: 'PAPEL', label: 'Construtor 1', sessionId: SID }), ['--append-system-prompt', 'PAPEL', '--name', 'Construtor 1', '--session-id', SID]);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', prompt: 'PAPEL', label: 'L', sessionId: SID, mcp }),
    ['--append-system-prompt', 'PAPEL', '--name', 'L', '--session-id', SID, '--mcp-config', '/tmp/x/mcp.json', '--allowedTools', 'mcp__orchestrator_abc123']);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'resume', sessionId: SID, resumeSessionId: OLD }), ['--resume', OLD]);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'resume', sessionId: SID, resumeSessionId: OLD, mcp }), ['--resume', OLD, '--mcp-config', '/tmp/x/mcp.json', '--allowedTools', 'mcp__orchestrator_abc123']);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'fork', sessionId: SID, resumeSessionId: OLD }), ['--resume', OLD, '--fork-session', '--session-id', SID]);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', prompt: 'P', label: 'L', sessionId: SID, mcp: { configPath: '/c.json' } }).slice(-1), ['mcp__forge'], 'sem serverName vale o nome padrão');
});

test('claude.paneArgs readOnly (planejador): --disallowedTools Edit Write NotebookEdit no grupo final, antes do MCP; nunca --dangerously-skip-permissions; sem readOnly nada muda', () => {
  const D = ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit'];
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', prompt: 'P', label: 'L', sessionId: SID, readOnly: true }), ['--append-system-prompt', 'P', '--name', 'L', '--session-id', SID, ...D]);
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'new', prompt: 'P', label: 'L', sessionId: SID, model: 'opus', effort: 'high', pluginDir: '/p', settingsFile: '/s.json', mcp, readOnly: true }),
    ['--append-system-prompt', 'P', '--name', 'L', '--session-id', SID, '--model', 'opus', '--effort', 'high', '--plugin-dir', '/p', '--settings', '/s.json', ...D, '--mcp-config', '/tmp/x/mcp.json', '--allowedTools', 'mcp__orchestrator_abc123']);
  // readOnly vence fullAccess (nem por engano o planejador sobe sem confirmação)
  for (const mode of ['new', 'resume', 'fork']) {
    const a = claudeProvider.paneArgs({ mode, prompt: 'P', label: 'L', sessionId: SID, resumeSessionId: OLD, mcp, fullAccess: true, readOnly: true });
    assert.ok(!a.includes('--dangerously-skip-permissions'), mode);
    const i = a.indexOf('--disallowedTools'); assert.deepEqual(a.slice(i, i + 4), D, mode); assert.equal(a[i + 4], '--mcp-config', mode);
  }
  assert.deepEqual(claudeProvider.paneArgs({ mode: 'resume', sessionId: SID, resumeSessionId: OLD, readOnly: true }), ['--resume', OLD, ...D]);
  // sem readOnly (todos os outros papéis): exatamente como antes, inclusive o acesso total
  for (const ro of [false, undefined, 'true', 1]) {
    const a = claudeProvider.paneArgs({ mode: 'new', prompt: 'P', label: 'L', sessionId: SID, mcp, fullAccess: true, readOnly: ro });
    assert.deepEqual(a, ['--append-system-prompt', 'P', '--name', 'L', '--session-id', SID, '--dangerously-skip-permissions', '--mcp-config', '/tmp/x/mcp.json', '--allowedTools', 'mcp__orchestrator_abc123'], String(ro));
  }
});

test('claude.resolve: acha o `claude` no PATH, ignora diretórios sem ele e o terminals.js continua exportando resolveClaude', () => {
  const dir = path.join(tmp, 'bin'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
  assert.deepEqual(resolveClaude({ env: { PATH: [path.join(tmp, 'vazio'), dir].join(path.delimiter) }, platform: 'linux' }), { file: path.join(dir, 'claude'), args: [], viaShell: false });
  assert.equal(resolveClaude({ env: { PATH: path.join(tmp, 'vazio') }, platform: 'linux' }), null);
  assert.equal(T.resolveClaude, resolveClaude); assert.equal(claudeProvider.resolve, resolveClaude);
});

function world() {
  const spawned = []; let pid = 1_900_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true,
    newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }), inspectConfig: async () => [], sweepMs: 0,
    usage: { read: () => null, has: () => true, forget() {} }, persist: () => {} });
  return { spawned, db, mgr };
}

test('terminais: a sessão, o registro, o histórico e a API trazem provider "claude"; a CLI recebe os argumentos do adaptador', async () => {
  const w = world(); const r = await w.mgr.create({ role: 'builder' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.session.provider, 'claude'); assert.equal(w.db.terminalSessions[0].provider, 'claude');
  assert.equal(w.mgr.history()[0].provider, 'claude'); assert.equal(w.mgr.list()[0].provider, 'claude'); assert.equal(w.mgr.get(r.session.id).provider, 'claude');
  const args = w.spawned[0].args; assert.equal(args[0], '--append-system-prompt'); assert.ok(args.includes('--session-id') && args.includes('--name'));
  assert.ok(!args.includes('--resume'));
});

test('terminais: sessão ANTIGA (sem o campo provider) é lida como claude e retomada com --resume', async () => {
  const w = world(); const r = await w.mgr.create({ role: 'builder' });
  w.spawned[0].exit(0); delete w.db.terminalSessions[0].provider; // simula o registro gravado antes de existir o campo
  assert.equal(w.mgr.history()[0].provider, 'claude');
  const again = await w.mgr.resume({ recordId: w.db.terminalSessions[0].id });
  assert.equal(again.ok, true, again.error); assert.equal(again.session.provider, 'claude');
  assert.deepEqual(w.spawned[1].args.slice(0, 2), ['--resume', w.db.terminalSessions[0].claudeSessionId]);
  assert.equal(r.session.provider, 'claude');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Contrato de CONTA por provedor (bloco `account` + accountSpecOf). `run` simula o execFile (último argumento = callback): nenhum `claude auth status` nem `codex` de verdade.
const { claudeAccountEnv } = await import('../providers/claude.js');
const { codexAccountEnv } = await import('../providers/codex.js');
const STATUS_KEYS = ['authMethod', 'checked', 'email', 'error', 'loggedIn', 'loginExpiresAt', 'orgName', 'plan'];
const fakeRun = (err, stdout = '', calls = []) => (file, args, opts, cb) => { calls.push({ file, args, opts }); setImmediate(() => cb(err, stdout)); return { pid: 4242 }; };
const errOf = (props) => Object.assign(new Error('x'), props);
const binSpec = { file: '/fake/cli', args: [], viaShell: false };

test('account: claude e codex declaram o bloco e cumprem o contrato (campos e tipos)', () => {
  assert.deepEqual(P.accountProviderIds(), ['claude', 'codex']);
  for (const [id, label, homeEnv, canLogin] of [['claude', 'Claude Code', 'CLAUDE_CONFIG_DIR', true], ['codex', 'Codex CLI', 'CODEX_HOME', false]]) {
    const s = P.accountSpecOf(id);
    assert.ok(s && Object.isFrozen(s), id);
    assert.equal(s.providerId, id); assert.equal(s.label, label); assert.equal(s.homeEnv, homeEnv); assert.equal(s.isolated, true); assert.equal(s.canLogin, canLogin);
    assert.equal(typeof s.note, 'string'); assert.ok(s.note.length > 0);
    for (const fn of ['detect', 'status', 'env', 'loginSpec', 'limits']) assert.equal(typeof s[fn], 'function', `${id}.${fn}`);
    assert.equal(s.detect({ PATH: path.join(tmp, 'vazio') }), false);
    assert.ok(P.getProvider(id).account);
  }
  assert.match(P.accountSpecOf('codex').note, /codex login/);
  assert.deepEqual([...P.accountSpecOf('claude').loginMethods], ['claudeai', 'console', 'sso']);
  for (const bad of ['', 'CLAUDE', '__proto__', 'constructor', 'toString', null, undefined, 7, {}]) assert.equal(P.accountSpecOf(bad), null, String(bad));
  const pub = P.accountProviders();
  assert.deepEqual(pub.map((p) => p.id), ['claude', 'codex']);
  for (const p of pub) for (const v of Object.values(p)) assert.notEqual(typeof v, 'function', 'a vista pública não leva funções');
});

test('account claude.status: logado com plano, não logado, JSON inválido, tempo esgotado, ENOENT e CLI ausente (só os campos do contrato)', async () => {
  const s = P.accountSpecOf('claude'), resolve = () => binSpec;
  const calls = [];
  const on = await s.status({ resolve, env: { PATH: 'x' }, run: fakeRun(null, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', orgName: 'Org', subscriptionType: 'max', loginExpiresAt: 1_900_000_000_000, accessToken: 'SEGREDO', refreshToken: 'SEGREDO2' }), calls) });
  assert.deepEqual(Object.keys(on).sort(), STATUS_KEYS);
  assert.deepEqual(on, { checked: true, loggedIn: true, plan: 'max', authMethod: 'claude.ai', email: 'a@b.c', orgName: 'Org', loginExpiresAt: new Date(1_900_000_000_000).toISOString(), error: null });
  assert.ok(!JSON.stringify(on).includes('SEGREDO'));
  assert.deepEqual(calls[0].args, ['auth', 'status']); assert.equal(calls[0].file, '/fake/cli'); assert.ok(calls[0].opts.timeout > 0); assert.notEqual(calls[0].opts.shell, true);
  // sem login: a CLI sai com código 1, mas o JSON vale
  const off = await s.status({ resolve, run: fakeRun(errOf({ code: 1 }), '{"loggedIn":false}') });
  assert.equal(off.checked, true); assert.equal(off.loggedIn, false); assert.equal(off.plan, null); assert.equal(off.error, null);
  // JSON inválido / formato inesperado: nada da saída da CLI é repassado
  for (const out of ['oops a@b.c token=XYZ', '[]', '{"loggedIn":"sim"}', '']) {
    const r = await s.status({ resolve, run: fakeRun(null, out) });
    assert.deepEqual(Object.keys(r).sort(), STATUS_KEYS); assert.equal(r.checked, false); assert.equal(r.loggedIn, null);
    assert.equal(r.error, 'Não foi possível consultar o estado do login.'); assert.ok(!JSON.stringify(r).includes('XYZ'));
  }
  // tempo esgotado e erro de execução
  for (const e of [errOf({ killed: true, signal: 'SIGTERM', code: null }), errOf({ code: 'ETIMEDOUT' })]) assert.equal((await s.status({ resolve, run: fakeRun(e, '') })).error, 'Tempo esgotado ao consultar o Claude Code.');
  assert.equal((await s.status({ resolve, run: fakeRun(errOf({ code: 'ENOENT' }), '') })).error, 'Claude Code não encontrado');
  // `run` que lança e CLI ausente: nunca rejeita
  assert.equal((await s.status({ resolve, run: () => { throw new Error('boom'); } })).checked, false);
  const none = await s.status({ resolve: () => null, run: () => assert.fail('não deve executar sem CLI') });
  assert.equal(none.checked, false); assert.equal(none.error, 'Claude Code não encontrado');
});

test('account claude.status: conta isolada roda com CLAUDE_CONFIG_DIR e sem as chaves do ambiente; conta da máquina mantém o ambiente', async () => {
  const s = P.accountSpecOf('claude'), calls = [], base = { PATH: 'x', ANTHROPIC_API_KEY: 'k', claude_code_oauth_token: 't' };
  await s.status({ home: '/contas/acc_1/claude', env: base, resolve: () => binSpec, run: fakeRun(null, '{"loggedIn":false}', calls) });
  await s.status({ home: null, env: base, resolve: () => binSpec, run: fakeRun(null, '{"loggedIn":false}', calls) });
  assert.equal(calls[0].opts.env.CLAUDE_CONFIG_DIR, '/contas/acc_1/claude'); assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined); assert.equal(calls[0].opts.env.claude_code_oauth_token, undefined);
  assert.deepEqual(calls[1].opts.env, base);
});

test('account env(): Claude da máquina mantém as variáveis de autenticação, conta isolada remove (sem mexer no ambiente base); Codex idem com CODEX_HOME e sem variáveis do Claude', () => {
  const base = Object.freeze({ PATH: 'p', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_BASE_URL: 'u', ANTHROPIC_CUSTOM_HEADERS: 'h', OPENAI_API_KEY: 'ok', CODEX_HOME: '/h' });
  const c = P.accountSpecOf('claude');
  assert.deepEqual(c.env(base, null), base); assert.deepEqual(c.env(base, ''), base); assert.notEqual(c.env(base, null), base, 'cópia nova');
  assert.deepEqual(c.env(base, '/acc/claude'), { PATH: 'p', OPENAI_API_KEY: 'ok', CODEX_HOME: '/h', CLAUDE_CONFIG_DIR: '/acc/claude' });
  assert.equal(claudeAccountEnv(base, '/acc/claude').CLAUDE_CONFIG_DIR, '/acc/claude');
  const x = P.accountSpecOf('codex');
  const machine = x.env(base, null);
  assert.equal(machine.OPENAI_API_KEY, 'ok'); assert.equal(machine.CODEX_HOME, '/h'); assert.ok(!Object.keys(machine).some((k) => /^(CLAUDE_|ANTHROPIC_)/.test(k)));
  assert.deepEqual(codexAccountEnv(base, '/acc/codex'), { PATH: 'p', CODEX_HOME: '/acc/codex' });
});

test('account codex.status: código 0 = logado, 1 = não logado, tempo esgotado = desconhecido; ambiente da conta; nunca repassa a saída da CLI', async () => {
  const s = P.accountSpecOf('codex'), calls = [];
  const on = await s.status({ home: '/acc/codex', env: { PATH: 'x', CLAUDE_CONFIG_DIR: '/c', OPENAI_API_KEY: 'k' }, resolve: () => binSpec, run: fakeRun(null, 'Logged in as a@b.c', calls) });
  assert.deepEqual(on, { checked: true, loggedIn: true, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error: null });
  assert.deepEqual(calls[0].args, ['login', 'status']); assert.equal(calls[0].opts.env.CODEX_HOME, '/acc/codex'); assert.equal(calls[0].opts.env.CLAUDE_CONFIG_DIR, undefined); assert.equal(calls[0].opts.env.OPENAI_API_KEY, undefined);
  const off = await s.status({ resolve: () => binSpec, run: fakeRun(errOf({ code: 1 }), 'Not logged in') });
  assert.equal(off.checked, true); assert.equal(off.loggedIn, false); assert.equal(off.error, null);
  const killed = [];
  const slow = await s.status({ resolve: () => binSpec, run: fakeRun(errOf({ killed: true, signal: 'SIGTERM', code: null })), killTree: (pid) => killed.push(pid) });
  assert.equal(slow.checked, false); assert.equal(slow.loggedIn, null); assert.match(slow.error, /não respondeu a tempo/); assert.deepEqual(killed, [4242]);
  const odd = await s.status({ resolve: () => binSpec, run: fakeRun(errOf({ code: 7 }), 'segredo') });
  assert.equal(odd.checked, false); assert.ok(!JSON.stringify(odd).includes('segredo'));
  const none = await s.status({ resolve: () => null, run: () => assert.fail('não deve executar sem CLI') });
  assert.equal(none.checked, false); assert.match(none.error, /não foi encontrado/);
  for (const r of [on, off, slow, odd, none]) assert.deepEqual(Object.keys(r).sort(), STATUS_KEYS);
});

test('account loginSpec: Claude monta `claude auth login` só com método da lista fechada e o ambiente da conta; Codex não faz login e devolve a nota', () => {
  const c = P.accountSpecOf('claude');
  const sp = c.loginSpec({ method: 'console', home: '/acc/claude', env: { PATH: 'x', ANTHROPIC_API_KEY: 'k' }, resolve: () => binSpec });
  assert.deepEqual({ file: sp.file, args: sp.args, verbatim: sp.verbatim }, { file: '/fake/cli', args: ['auth', 'login', '--console'], verbatim: false });
  assert.equal(sp.env.CLAUDE_CONFIG_DIR, '/acc/claude'); assert.equal(sp.env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(c.loginSpec({ resolve: () => binSpec }).args, ['auth', 'login', '--claudeai'], 'método padrão');
  for (const m of ['--email x', 'x', '__proto__', 7]) assert.equal(c.loginSpec({ method: m, resolve: () => binSpec }).code, 'invalid_method', String(m));
  assert.equal(c.loginSpec({ resolve: () => null }).code, 'not_found');
  // wrapper .cmd: cmd.exe com aspas externas; caminho com metacaractere é recusado
  const w = c.loginSpec({ resolve: () => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\Program Files\\npm\\claude.cmd'], viaShell: true }) });
  assert.deepEqual(w.args, ['/d', '/s', '/c', '""C:\\Program Files\\npm\\claude.cmd" auth login --claudeai"']); assert.equal(w.verbatim, true);
  assert.equal(c.loginSpec({ resolve: () => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\a&b\\claude.cmd'], viaShell: true }) }).code, 'unsafe');
  const x = P.accountSpecOf('codex').loginSpec({ home: null });
  assert.equal(x.code, 'login_unsupported'); assert.match(x.error, /codex login/); assert.equal(x.file, undefined);
});

test('account limits: Claude devolve null (fontes seguem em rate-limits.js); Codex delega ao leitor dos rollouts da pasta da conta (vazia = null)', async () => {
  assert.equal(await P.accountSpecOf('claude').limits({}), null);
  const home = path.join(tmp, 'codex-home'); fs.mkdirSync(home, { recursive: true });
  assert.equal(await P.accountSpecOf('codex').limits({ home }), null);
  const day = path.join(home, 'sessions', '2026', '11', '23'); fs.mkdirSync(day, { recursive: true });
  const resets = Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(path.join(day, 'rollout-2026-11-23T10-00-00-00000000-0000-4000-8000-000000000001.jsonl'),
    `${JSON.stringify({ timestamp: new Date().toISOString(), payload: { type: 'token_count', rate_limits: { plan_type: 'plus', primary: { used_percent: 42, window_minutes: 300, resets_at: resets } } } })}\n`);
  const l = await P.accountSpecOf('codex').limits({ home });
  assert.equal(l.planType, 'plus'); assert.equal(l.session.usedPct, 42); assert.equal(l.week, null);
});

test('account registro genérico: provedor FALSO entra só declarando o bloco; sem bloco ou com bloco inválido é tolerado; status filtrado e erros contidos', async () => {
  const calls = [];
  const fake = {
    id: 'fakeai', label: 'Fake AI',
    account: {
      label: 'Fake AI CLI', note: 'Rode "fake login".', homeEnv: null, canLogin: false,
      detect: () => true,
      status: async (ctx) => { calls.push(ctx); return { checked: true, loggedIn: true, plan: 'pro', email: 'e@x', token: 'SEGREDO', raw: 'saida da cli' }; },
      env: (base) => ({ ...base, FAKE: '1' }),
      limits: async () => ({ session: null, week: null }),
    },
  };
  const R = P.createAccountRegistry({
    fakeai: fake, semBloco: { id: 'semBloco', label: 'X' }, quebrado: { label: 'Q', account: { label: 'Q', detect: () => true } },
    lancador: { label: 'L', account: { ...fake.account, homeEnv: 'L_HOME', status: () => { throw new Error('boom'); }, detect: () => { throw new Error('boom'); }, limits: () => { throw new Error('x'); }, canLogin: true, loginSpec: () => { throw new Error('x'); } } },
    homeRuim: { label: 'H', account: { ...fake.account, homeEnv: 'a b; rm' } },
  });
  assert.deepEqual(R.ids(), ['fakeai', 'lancador']);
  for (const id of ['semBloco', 'quebrado', 'homeRuim', '__proto__', 'nada']) assert.equal(R.specOf(id), null, id);
  const s = R.specOf('fakeai');
  assert.equal(s.label, 'Fake AI CLI'); assert.equal(s.isolated, false); assert.equal(s.detect(), true);
  const st = await s.status({ env: { PATH: 'x' }, run: 'injetado' });
  assert.deepEqual(Object.keys(st).sort(), STATUS_KEYS); assert.equal(st.loggedIn, true); assert.equal(st.plan, 'pro');
  assert.ok(!JSON.stringify(st).includes('SEGREDO') && !JSON.stringify(st).includes('saida'));
  assert.equal(calls[0].run, 'injetado', 'o ctx chega ao provedor');
  // provedor sem isolamento: pedir uma pasta própria é erro explícito (nunca cai na conta da máquina em silêncio)
  assert.equal((await s.status({ home: '/x' })).checked, false); assert.throws(() => s.env({}, '/x'), /só tem a conta da máquina/);
  assert.deepEqual(s.env({ A: '1' }, null), { A: '1', FAKE: '1' });
  assert.deepEqual(s.loginSpec({}), { error: 'Rode "fake login".', code: 'login_unsupported' });
  assert.deepEqual(await s.limits({}), { session: null, week: null });
  assert.deepEqual(R.list(), [{ id: 'fakeai', label: 'Fake AI CLI', canLogin: false, isolated: false, note: 'Rode "fake login".' }, { id: 'lancador', label: 'Fake AI CLI', canLogin: true, isolated: true, note: 'Rode "fake login".' }]);
  // funções do provedor que lançam não derrubam quem chama
  const bad = R.specOf('lancador');
  assert.equal(bad.detect(), false); assert.equal((await bad.status({})).error, 'Não foi possível consultar o estado do login.'); assert.equal(await bad.limits({}), null); assert.equal(bad.loginSpec({}).code, 'login_error');
  // o registro real não foi tocado
  assert.deepEqual(P.accountProviderIds(), ['claude', 'codex']); assert.equal(P.accountSpecOf('fakeai'), null);
  assert.deepEqual(P.createAccountRegistry(null).ids(), []);
});

test('pickAccountStatus: tolera lixo e só devolve os campos do contrato', () => {
  for (const x of [null, 'x', [], 7]) { const r = P.pickAccountStatus(x); assert.deepEqual(Object.keys(r).sort(), STATUS_KEYS); assert.equal(r.checked, false); }
  const r = P.pickAccountStatus({ checked: false, loggedIn: true, email: 'a\u0000b', plan: 7, error: 'e' });
  assert.equal(r.loggedIn, null, 'loggedIn só vale com checked'); assert.equal(r.email, null); assert.equal(r.plan, null); assert.equal(r.error, 'e');
});

test('account logoutSpec: só de conta ISOLADA (a do computador nunca sofre logout); Claude monta `claude auth logout` no ambiente da conta; Codex não tem logout', () => {
  const c = P.accountSpecOf('claude');
  const sp = c.logoutSpec({ home: '/acc/claude', env: { PATH: 'x', ANTHROPIC_API_KEY: 'k' }, resolve: () => binSpec });
  assert.deepEqual({ file: sp.file, args: sp.args, verbatim: sp.verbatim }, { file: '/fake/cli', args: ['auth', 'logout'], verbatim: false });
  assert.equal(sp.env.CLAUDE_CONFIG_DIR, '/acc/claude'); assert.equal(sp.env.ANTHROPIC_API_KEY, undefined);
  for (const home of [null, undefined, '']) assert.equal(c.logoutSpec({ home, resolve: () => binSpec }), null, `home ${String(home)}: conta do computador`);
  assert.equal(c.logoutSpec({ home: '/acc/claude', resolve: () => null }), null, 'CLI ausente');
  assert.equal(c.logoutSpec({ home: '/acc/claude', resolve: () => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\a&b\\claude.cmd'], viaShell: true }) }).code, 'unsafe');
  assert.equal(P.accountSpecOf('codex').logoutSpec({ home: '/acc/codex' }), null);
});
