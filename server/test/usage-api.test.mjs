// Uso real da conta no provedor (server/usage-api.js + integração em rate-limits.js). Tudo com fetch FALSO e pastas TEMPORÁRIAS:
// nenhuma credencial real é lida, nenhuma rede é usada, nenhum ~/.claude, ~/.codex, data/ ou porta 4317 é tocado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-usageapi-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const U = await import('../usage-api.js');
const RL = await import('../rate-limits.js');
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const T0 = Date.parse('2026-11-10T12:00:00.000Z'), iso = (ms) => new Date(ms).toISOString();
let n = 0; const mk = () => { const d = path.join(root, `d${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const SECRET = 'sk-ant-oat01-SEGREDO-NAO-VAZAR';
const claudeCreds = (dir, over = {}) => fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: 'r-SEGREDO', expiresAt: T0 + 3600_000, subscriptionType: 'pro', ...over } }));
const codexAuth = (dir, over = {}) => fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: SECRET, refresh_token: 'r-SEGREDO', account_id: 'acct-123', ...over } }));
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const claudeBody = (five = 12, seven = 34) => ({ five_hour: { utilization: five, resets_at: iso(T0 + 3600_000) }, seven_day: { utilization: seven, resets_at: iso(T0 + 86400_000) } });
const codexBody = () => ({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 18000, reset_at: Math.floor(T0 / 1000) + 3600 }, secondary_window: { used_percent: 16, limit_window_seconds: 604800, reset_at: Math.floor(T0 / 1000) + 86400 } } });
const api = (over) => U.createUsageApi({ now: () => T0, env: () => ({}), ...over });

test('Claude: lê o token só do arquivo da conta, chama o host fixo com redirect bloqueado e devolve as duas janelas', async () => {
  const d = mk(); claudeCreds(d); let call;
  const r = await api({ credsDirOf: () => d, fetchFn: async (url, opt) => { call = { url, opt }; return resp(200, claudeBody()); } }).claude('system');
  assert.equal(r.ok, true); assert.equal(r.session.usedPct, 12); assert.equal(r.week.usedPct, 34); assert.equal(r.week.windowMinutes, 10080); assert.equal(r.planType, 'pro');
  assert.equal(call.url, U.CLAUDE_USAGE_URL); assert.match(call.url, /^https:\/\/api\.anthropic\.com\//); assert.equal(call.opt.redirect, 'error'); assert.ok(call.opt.signal);
  assert.equal(call.opt.headers.Authorization, `Bearer ${SECRET}`);
  assert.ok(!JSON.stringify(r).includes('SEGREDO'), 'o resultado não carrega token');
});

test('Claude: sem credencial, token vencido, link no lugar do arquivo e arquivo enorme não chamam a rede', async () => {
  let calls = 0; const f = async () => { calls++; return resp(200, claudeBody()); };
  const none = mk(); assert.deepEqual(await api({ credsDirOf: () => none, fetchFn: f }).claude('x'), { ok: false, reason: 'sem-credencial' });
  const exp = mk(); claudeCreds(exp, { expiresAt: T0 + 1000 }); assert.deepEqual(await api({ credsDirOf: () => exp, fetchFn: f }).claude('x'), { ok: false, reason: 'token-expirado' });
  const big = mk(); fs.writeFileSync(path.join(big, '.credentials.json'), 'x'.repeat(300_000)); assert.equal((await api({ credsDirOf: () => big, fetchFn: f }).claude('x')).reason, 'sem-credencial');
  const lnk = mk(), alvo = path.join(mk(), 'real.json'); fs.writeFileSync(alvo, JSON.stringify({ claudeAiOauth: { accessToken: SECRET } }));
  let linked = false; try { fs.symlinkSync(alvo, path.join(lnk, '.credentials.json')); linked = true; } catch { /* sem permissão de link no Windows */ }
  if (linked) assert.equal((await api({ credsDirOf: () => lnk, fetchFn: f }).claude('x')).reason, 'sem-credencial');
  assert.equal(calls, 0);
});

test('Claude: 401/403, 429, 500, rede, JSON inválido e formato estranho viram motivos fixos, sem vazar token', async () => {
  const d = mk(); claudeCreds(d);
  const t = async (f) => api({ credsDirOf: () => d, fetchFn: f }).claude('x');
  assert.equal((await t(async () => resp(401, 'Bearer ' + SECRET))).reason, 'nao-autorizado');
  assert.equal((await t(async () => resp(403, {}))).reason, 'nao-autorizado');
  assert.equal((await t(async () => resp(429, {}))).reason, 'limitado');
  assert.equal((await t(async () => resp(500, {}))).reason, 'http');
  assert.equal((await t(async () => { throw new Error(`falha com ${SECRET}`); })).reason, 'rede');
  assert.equal((await t(async () => resp(200, 'não é json'))).reason, 'formato');
  assert.equal((await t(async () => resp(200, []))).reason, 'formato');
  assert.equal((await t(async () => resp(200, { five_hour: { utilization: 'x', resets_at: 'y' } }))).reason, 'formato');
  for (const r of [await t(async () => { throw new Error(SECRET); }), await t(async () => resp(401, SECRET))]) assert.ok(!JSON.stringify(r).includes('SEGREDO'));
});

test('parseClaudeUsage: limita 0..100 e descarta janela já vencida; uma janela só é aceita', () => {
  const p = U.parseClaudeUsage({ five_hour: { utilization: 250, resets_at: iso(T0 + 1000) }, seven_day: { utilization: 5, resets_at: iso(T0 - 1000) } }, T0);
  assert.equal(p.session.usedPct, 100); assert.equal(p.week, null);
  assert.equal(U.parseClaudeUsage({}, T0), null);
});

test('Codex: usa auth.json + ChatGPT-Account-Id, host fixo, e classifica a janela pela duração', async () => {
  const h = mk(); codexAuth(h); let call;
  const r = await api({ codexHome: h, fetchFn: async (url, opt) => { call = { url, opt }; return resp(200, codexBody()); } }).codex();
  assert.equal(r.ok, true); assert.equal(r.session.usedPct, 2); assert.equal(r.week.usedPct, 16); assert.equal(r.planType, 'plus');
  assert.equal(call.url, U.CODEX_USAGE_URL); assert.equal(call.opt.redirect, 'error'); assert.equal(call.opt.headers['ChatGPT-Account-Id'], 'acct-123');
  const inv = codexBody(); [inv.rate_limit.primary_window, inv.rate_limit.secondary_window] = [inv.rate_limit.secondary_window, inv.rate_limit.primary_window];
  const r2 = await api({ codexHome: h, fetchFn: async () => resp(200, inv) }).codex(); assert.equal(r2.session.usedPct, 2); assert.equal(r2.week.usedPct, 16, 'a ordem das janelas não importa');
  codexAuth(h, { account_id: 'ruim\r\nX: y' }); let hd; await api({ codexHome: h, fetchFn: async (u, o) => { hd = o.headers; return resp(200, codexBody()); } }).codex(); assert.equal(hd['ChatGPT-Account-Id'], undefined, 'account_id estranho não vai em cabeçalho');
  assert.equal((await api({ codexHome: mk(), fetchFn: async () => resp(200, codexBody()) }).codex()).reason, 'sem-credencial');
});

// ---------- integração com rate-limits.js ----------
function world({ claude, codex, accountList = [], env = {}, ttl = 30_000, clock = { t: T0 } } = {}) {
  const dir = mk(), sysCfg = mk();
  const calls = { claude: [], codex: 0 };
  const usageApi = { claude: async (id) => { calls.claude.push(id); return typeof claude === 'function' ? claude(id) : claude ?? { ok: false, reason: 'sem-credencial' }; }, codex: async () => { calls.codex++; return typeof codex === 'function' ? codex() : codex ?? { ok: false, reason: 'sem-credencial' }; } };
  const accounts = { list: () => accountList, configDirOf: () => null, available: () => true, statusOf: async () => ({ checked: true, loggedIn: true }) };
  const rl = RL.createRateLimits({ db: { terminalSessions: [] }, accounts, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: sysCfg, ...env }), now: () => clock.t, memoMs: 0, connectedTtlMs: 0, usageApi, apiTtlMs: ttl, codexReader: { read: () => null }, codexAuth: async () => ({ known: true, loggedIn: true }) });
  return { rl, calls, clock };
}
const acc = (v, p, id) => v.providers.find((x) => x.provider === p).accounts.find((a) => a.id === id);
const flush = () => new Promise((r) => setTimeout(r, 25));
const ok = (five = 12, seven = 34, plan = 'pro') => ({ ok: true, planType: plan, session: { usedPct: five, resetsAt: iso(T0 + 3600_000), windowMinutes: 300 }, week: { usedPct: seven, resetsAt: iso(T0 + 86400_000), windowMinutes: 10080 } });

test('integração: a 1ª chamada dispara a consulta em segundo plano; a seguinte já traz source "api" (Claude e Codex)', async () => {
  const w = world({ claude: ok(), codex: ok(3, 17, 'plus') });
  const v1 = w.rl.view(); assert.equal(acc(v1, 'claude', 'system').source, 'sem-dados', 'view() nunca espera a rede'); await flush();
  const v2 = w.rl.view();
  const c = acc(v2, 'claude', 'system'), x = acc(v2, 'codex', 'codex');
  assert.equal(c.source, 'api'); assert.equal(c.session.usedPct, 12); assert.equal(c.week.usedPct, 34); assert.equal(c.plan, 'pro');
  assert.equal(x.source, 'api'); assert.equal(x.week.usedPct, 17); assert.equal(x.plan, 'plus');
  assert.ok(!JSON.stringify(v2).includes('SEGREDO'));
});

test('integração: respeita o intervalo (TTL) e reconsulta depois dele, acompanhando o gasto novo', async () => {
  let pct = 10; const w = world({ claude: () => ok(pct, 20) });
  w.rl.view(); await flush(); w.rl.view(); w.rl.view(); assert.equal(w.calls.claude.length, 1, 'chamadas dentro do TTL não consultam de novo');
  pct = 45; w.clock.t += 31_000; w.rl.view(); await flush();
  assert.equal(w.calls.claude.length, 2);
  w.clock.t -= 0; assert.equal(acc(w.rl.view(), 'claude', 'system').session.usedPct, 45);
});

test('integração: falha/429 recua (sem martelar), cai nas fontes locais e volta quando a API volta; dado velho (>5 min) não vale', async () => {
  let mode = 'fail'; const w = world({ claude: () => (mode === 'fail' ? { ok: false, reason: 'rede' } : mode === 'limit' ? { ok: false, reason: 'limitado' } : ok()) });
  w.rl.view(); await flush(); assert.equal(acc(w.rl.view(), 'claude', 'system').source, 'sem-dados');
  w.clock.t += 31_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 1, 'recuo exponencial: 31 s depois ainda não reconsulta');
  w.clock.t += 120_000; mode = 'ok'; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 2);
  assert.equal(acc(w.rl.view(), 'claude', 'system').source, 'api');
  mode = 'fail'; w.clock.t += 6 * 60_000; // leitura mais velha que 5 min deixa de valer
  assert.notEqual(acc(w.rl.view(), 'claude', 'system').source, 'api');
  const w2 = world({ claude: () => ({ ok: false, reason: 'limitado' }) }); w2.rl.view(); await flush(); w2.clock.t += 200_000; w2.rl.view(); await flush(); assert.equal(w2.calls.claude.length, 1, '429 espera ~5 min');
});

test('integração: ORCH_LIMITS_API=off, e ausência de usageApi, não consultam nada', async () => {
  const off = world({ claude: ok(), env: { ORCH_LIMITS_API: 'off' } }); off.rl.view(); await flush(); off.rl.view();
  assert.equal(off.calls.claude.length + off.calls.codex, 0); assert.notEqual(acc(off.rl.view(), 'claude', 'system').source, 'api');
  const rl = RL.createRateLimits({ db: { terminalSessions: [] }, dir: mk(), script: null, codexHome: mk(), env: () => ({}), now: () => T0, memoMs: 0, codexReader: { read: () => null } });
  assert.notEqual(acc(rl.view(), 'claude', 'system')?.source, 'api');
});

test('integração: cada conta consulta a SUA pasta de login; conta removida esquece o estado', async () => {
  const list = [{ id: 'acc_aaaaaaaa', provider: 'claude', label: 'Trabalho' }];
  const w = world({ claude: (id) => ok(id === 'system' ? 5 : 77), accountList: list });
  w.rl.view(); await flush(); const v = w.rl.view();
  assert.equal(acc(v, 'claude', 'system').session.usedPct, 5); assert.equal(acc(v, 'claude', 'acc_aaaaaaaa').session.usedPct, 77);
  const before = w.rl.stats().apiEntries; list.length = 0; w.rl.view(); assert.ok(w.rl.stats().apiEntries < before);
});

test('integração: consulta que trava é descartada depois do tempo limite e o resultado tardio é ignorado', async () => {
  const releases = []; const w = world({ claude: () => new Promise((r) => { releases.push(r); }) });
  w.rl.view(); await flush(); w.clock.t += 16_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 1, 'o descarte por timeout recua em vez de reconsultar na hora');
  w.clock.t += 61_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 2);
  releases[1](ok(99, 99)); await flush(); releases[0](ok(1, 1)); await flush(); // a 1ª (descartada) resolve TARDE
  assert.equal(acc(w.rl.view(), 'claude', 'system').session.usedPct, 99, 'o resultado tardio não sobrescreve');
});

test('Claude: se a pasta da conta gerenciada não puder ser resolvida, NUNCA cai no login do Sistema', async () => {
  const sys = mk(); claudeCreds(sys); let calls = 0;
  const u = api({ credsDirOf: () => { throw new Error('x'); }, env: () => ({ CLAUDE_CONFIG_DIR: sys }), fetchFn: async () => { calls++; return resp(200, claudeBody()); } });
  assert.deepEqual(await u.claude('acc_aaaaaaaa'), { ok: false, reason: 'sem-credencial' }); assert.equal(calls, 0);
  assert.equal((await u.claude('system')).ok, true, 'o Sistema usa o padrão');
});

test('Claude: corpo declarado maior que o limite é recusado sem ler', async () => {
  const d = mk(); claudeCreds(d); let read = false;
  const r = await api({ credsDirOf: () => d, fetchFn: async () => ({ status: 200, ok: true, headers: { get: () => '99999999' }, text: async () => { read = true; return '{}'; } }) }).claude('x');
  assert.equal(r.reason, 'formato'); assert.equal(read, false);
});

test('integração: credencial ausente/vencida reconsulta em intervalo fixo (leitura local), sem recuo de 10 min', async () => {
  let mode = 'exp'; const w = world({ claude: () => (mode === 'exp' ? { ok: false, reason: 'token-expirado' } : ok()) });
  w.rl.view(); await flush(); mode = 'ok'; w.clock.t += 31_000; w.rl.view(); await flush();
  assert.equal(acc(w.rl.view(), 'claude', 'system').source, 'api');
});

test('integração: com a API falhando, o dado LOCAL (arquivo do hook) volta a valer, com os valores locais', async () => {
  const w = world({ claude: { ok: false, reason: 'rede' } }); const sid = '00000000-0000-4000-8000-000000000001';
  const rl = RL.createRateLimits({ db: { terminalSessions: [{ provider: 'claude', accountId: 'system', claudeSessionId: sid, state: 'running' }] }, dir: w.rl.__dir ?? mk(), script: null, codexHome: mk(), env: () => ({}), now: () => T0, memoMs: 0, codexReader: { read: () => null }, usageApi: { claude: async () => ({ ok: false, reason: 'rede' }), codex: async () => ({ ok: false, reason: 'rede' }) }, apiTtlMs: 30_000 });
  rl.view(); await flush(); assert.notEqual(acc(rl.view(), 'claude', 'system').source, 'api');
});
