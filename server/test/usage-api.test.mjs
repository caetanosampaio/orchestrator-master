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
// Modelo v2: M = Claude do computador, F = Claude isolada (FORGE), CX = Codex do computador. Não existe conta 'system'.
const M = 'acc_11111111', F = 'acc_aaaaaaaa', CX = 'acc_33333333';
const M_ROW = { id: M, provider: 'claude', label: 'Claude Code', home: 'machine' }, F_ROW = { id: F, provider: 'claude', label: 'Trabalho', home: 'forge' }, CX_ROW = { id: CX, provider: 'codex', label: 'Codex CLI', home: 'machine' };
const SECRET = 'sk-ant-oat01-SEGREDO-NAO-VAZAR';
const claudeCreds = (dir, over = {}) => fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: 'r-SEGREDO', expiresAt: T0 + 3600_000, subscriptionType: 'pro', ...over } }));
const codexAuth = (dir, over = {}) => fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: SECRET, refresh_token: 'r-SEGREDO', account_id: 'acct-123', ...over } }));
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const claudeBody = (five = 12, seven = 34) => ({ five_hour: { utilization: five, resets_at: iso(T0 + 3600_000) }, seven_day: { utilization: seven, resets_at: iso(T0 + 86400_000) } });
const codexBody = () => ({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 2, limit_window_seconds: 18000, reset_at: Math.floor(T0 / 1000) + 3600 }, secondary_window: { used_percent: 16, limit_window_seconds: 604800, reset_at: Math.floor(T0 / 1000) + 86400 } } });
const api = (over) => U.createUsageApi({ now: () => T0, env: () => ({}), ...over });

test('Claude: lê o token só do arquivo da conta, chama o host fixo com redirect bloqueado e devolve as duas janelas', async () => {
  const d = mk(); claudeCreds(d); let call;
  const r = await api({ credsDirOf: () => d, fetchFn: async (url, opt) => { call = { url, opt }; return resp(200, claudeBody()); } }).claude(F);
  assert.equal(r.ok, true); assert.equal(r.session.usedPct, 12); assert.equal(r.week.usedPct, 34); assert.equal(r.week.windowMinutes, 10080); assert.equal(r.planType, 'pro');
  assert.equal(call.url, U.CLAUDE_USAGE_URL); assert.match(call.url, /^https:\/\/api\.anthropic\.com\//); assert.equal(call.opt.redirect, 'error'); assert.ok(call.opt.signal);
  assert.equal(call.opt.headers.Authorization, `Bearer ${SECRET}`);
  assert.ok(!JSON.stringify(r).includes('SEGREDO'), 'o resultado não carrega token');
});

test('Claude: sem credencial, token vencido, link no lugar do arquivo e arquivo enorme não chamam a rede', async () => {
  let calls = 0; const f = async () => { calls++; return resp(200, claudeBody()); };
  const none = mk(); assert.deepEqual(await api({ credsDirOf: () => none, fetchFn: f }).claude(F), { ok: false, reason: 'sem-credencial' });
  const exp = mk(); claudeCreds(exp, { expiresAt: T0 + 1000 }); assert.deepEqual(await api({ credsDirOf: () => exp, fetchFn: f }).claude(F), { ok: false, reason: 'token-expirado' });
  const big = mk(); fs.writeFileSync(path.join(big, '.credentials.json'), 'x'.repeat(300_000)); assert.equal((await api({ credsDirOf: () => big, fetchFn: f }).claude(F)).reason, 'sem-credencial');
  const lnk = mk(), alvo = path.join(mk(), 'real.json'); fs.writeFileSync(alvo, JSON.stringify({ claudeAiOauth: { accessToken: SECRET } }));
  let linked = false; try { fs.symlinkSync(alvo, path.join(lnk, '.credentials.json')); linked = true; } catch { /* sem permissão de link no Windows */ }
  if (linked) assert.equal((await api({ credsDirOf: () => lnk, fetchFn: f }).claude(F)).reason, 'sem-credencial');
  assert.equal(calls, 0);
});

test('Claude: 401/403, 429, 500, rede, JSON inválido e formato estranho viram motivos fixos, sem vazar token', async () => {
  const d = mk(); claudeCreds(d);
  const t = async (f) => api({ credsDirOf: () => d, fetchFn: f }).claude(F);
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

test('Codex: usa auth.json + ChatGPT-Account-Id, host fixo, e classifica a janela pela duração (conta do computador: pasta padrão; conta isolada: a própria)', async () => {
  const h = mk(); codexAuth(h); let call; const mach = (id, p) => p === 'codex';
  const r = await api({ codexHome: h, isMachine: mach, fetchFn: async (url, opt) => { call = { url, opt }; return resp(200, codexBody()); } }).codex(CX);
  assert.equal(r.ok, true); assert.equal(r.session.usedPct, 2); assert.equal(r.week.usedPct, 16); assert.equal(r.planType, 'plus');
  assert.equal(call.url, U.CODEX_USAGE_URL); assert.equal(call.opt.redirect, 'error'); assert.equal(call.opt.headers['ChatGPT-Account-Id'], 'acct-123');
  const inv = codexBody(); [inv.rate_limit.primary_window, inv.rate_limit.secondary_window] = [inv.rate_limit.secondary_window, inv.rate_limit.primary_window];
  const r2 = await api({ codexHome: h, isMachine: mach, fetchFn: async () => resp(200, inv) }).codex(CX); assert.equal(r2.session.usedPct, 2); assert.equal(r2.week.usedPct, 16, 'a ordem das janelas não importa');
  codexAuth(h, { account_id: 'ruim\r\nX: y' }); let hd; await api({ codexHome: h, isMachine: mach, fetchFn: async (u, o) => { hd = o.headers; return resp(200, codexBody()); } }).codex(CX); assert.equal(hd['ChatGPT-Account-Id'], undefined, 'account_id estranho não vai em cabeçalho');
  assert.equal((await api({ codexHome: mk(), isMachine: mach, fetchFn: async () => resp(200, codexBody()) }).codex(CX)).reason, 'sem-credencial');
  // conta isolada do Codex: credsDirOf(id, provider) dá a pasta; sem isMachine e sem pasta, NUNCA cai no CODEX_HOME do computador
  const iso1 = mk(); codexAuth(iso1); let seen; const ri = await api({ codexHome: h, credsDirOf: (id, p) => { seen = [id, p]; return iso1; }, fetchFn: async () => resp(200, codexBody()) }).codex('acc_dddddddd');
  assert.equal(ri.ok, true); assert.deepEqual(seen, ['acc_dddddddd', 'codex']);
  let calls = 0; const f = async () => { calls++; return resp(200, codexBody()); };
  assert.deepEqual(await api({ codexHome: h, fetchFn: f }).codex(CX), { ok: false, reason: 'sem-credencial' }, 'padrão de isMachine é falso: nenhuma conta usa o login do computador sem dizer');
  assert.deepEqual(await api({ codexHome: h, credsDirOf: () => null, fetchFn: f }).codex('acc_dddddddd'), { ok: false, reason: 'sem-credencial' }); assert.equal(calls, 0);
});

// ---------- integração com rate-limits.js ----------
function world({ claude, codex, accountList = [M_ROW, CX_ROW], env = {}, ttl = 30_000, clock = { t: T0 } } = {}) {
  const dir = mk(), sysCfg = mk();
  const calls = { claude: [], codex: [] };
  const usageApi = { claude: async (id) => { calls.claude.push(id); return typeof claude === 'function' ? claude(id) : claude ?? { ok: false, reason: 'sem-credencial' }; }, codex: async (id) => { calls.codex.push(id); return typeof codex === 'function' ? codex(id) : codex ?? { ok: false, reason: 'sem-credencial' }; } };
  const accounts = { list: () => accountList, configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) };
  const rl = RL.createRateLimits({ db: { terminalSessions: [], accounts: accountList }, accounts, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: sysCfg, ...env }), now: () => clock.t, memoMs: 0, connectedTtlMs: 0, usageApi, apiTtlMs: ttl, codexReader: { read: () => null } });
  return { rl, calls, clock };
}
const acc = (v, p, id) => v.providers.find((x) => x.provider === p).accounts.find((a) => a.id === id);
const flush = () => new Promise((r) => setTimeout(r, 25));
const ok = (five = 12, seven = 34, plan = 'pro') => ({ ok: true, planType: plan, session: { usedPct: five, resetsAt: iso(T0 + 3600_000), windowMinutes: 300 }, week: { usedPct: seven, resetsAt: iso(T0 + 86400_000), windowMinutes: 10080 } });

test('integração: a 1ª chamada dispara a consulta em segundo plano; a seguinte já traz source "api" (Claude e Codex)', async () => {
  const w = world({ claude: ok(), codex: ok(3, 17, 'plus') });
  const v1 = w.rl.view(); assert.equal(acc(v1, 'claude', M).source, 'sem-dados', 'view() nunca espera a rede'); await flush();
  const v2 = w.rl.view();
  const c = acc(v2, 'claude', M), x = acc(v2, 'codex', CX);
  assert.equal(c.source, 'api'); assert.equal(c.session.usedPct, 12); assert.equal(c.week.usedPct, 34); assert.equal(c.plan, 'pro');
  assert.equal(x.source, 'api'); assert.equal(x.week.usedPct, 17); assert.equal(x.plan, 'plus');
  assert.ok(!JSON.stringify(v2).includes('SEGREDO'));
  assert.deepEqual(w.calls.claude, [M], 'usageApi.claude recebe o id REAL da conta'); assert.deepEqual(w.calls.codex, [CX], 'usageApi.codex recebe o id REAL da conta (antes não recebia nada)');
});

test('integração: respeita o intervalo (TTL) e reconsulta depois dele, acompanhando o gasto novo', async () => {
  let pct = 10; const w = world({ claude: () => ok(pct, 20) });
  w.rl.view(); await flush(); w.rl.view(); w.rl.view(); assert.equal(w.calls.claude.length, 1, 'chamadas dentro do TTL não consultam de novo');
  pct = 45; w.clock.t += 31_000; w.rl.view(); await flush();
  assert.equal(w.calls.claude.length, 2);
  w.clock.t -= 0; assert.equal(acc(w.rl.view(), 'claude', M).session.usedPct, 45);
});

test('integração: falha/429 recua (sem martelar), cai nas fontes locais e volta quando a API volta; dado velho (>5 min) vira última leitura (não é descartado)', async () => {
  let mode = 'fail'; const w = world({ claude: () => (mode === 'fail' ? { ok: false, reason: 'rede' } : mode === 'limit' ? { ok: false, reason: 'limitado' } : ok()) });
  w.rl.view(); await flush(); assert.equal(acc(w.rl.view(), 'claude', M).source, 'sem-dados');
  w.clock.t += 31_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 1, 'recuo exponencial: 31 s depois ainda não reconsulta');
  w.clock.t += 120_000; mode = 'ok'; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 2);
  assert.equal(acc(w.rl.view(), 'claude', M).source, 'api');
  mode = 'fail'; w.clock.t += 6 * 60_000; // leitura mais velha que 5 min deixa de ser "api" (leitura recente), mas o valor continua como última leitura
  assert.equal(acc(w.rl.view(), 'claude', M).source, 'ultima-leitura'); assert.equal(acc(w.rl.view(), 'claude', M).session.usedPct, 12);
  const w2 = world({ claude: () => ({ ok: false, reason: 'limitado' }) }); w2.rl.view(); await flush(); w2.clock.t += 200_000; w2.rl.view(); await flush(); assert.equal(w2.calls.claude.length, 1, '429 espera ~5 min');
});

test('integração: ORCH_LIMITS_API=off, e ausência de usageApi, não consultam nada', async () => {
  const off = world({ claude: ok(), env: { ORCH_LIMITS_API: 'off' } }); off.rl.view(); await flush(); off.rl.view();
  assert.equal(off.calls.claude.length + off.calls.codex.length, 0); assert.equal(acc(off.rl.view(), 'claude', M).source, 'sem-dados');
  const rl = RL.createRateLimits({ db: { terminalSessions: [], accounts: [M_ROW] }, accounts: { list: () => [M_ROW], configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) }, dir: mk(), script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: mk() }), now: () => T0, memoMs: 0, codexReader: { read: () => null } });
  assert.equal(acc(rl.view(), 'claude', M).source, 'sem-dados', 'sem usageApi a conta existe e a fonte nunca é "api"');
});

test('integração: cada conta consulta a SUA pasta de login; conta removida esquece o estado', async () => {
  const list = [M_ROW, F_ROW];
  const w = world({ claude: (id) => ok(id === M ? 5 : 77), accountList: list });
  w.rl.view(); await flush(); const v = w.rl.view();
  assert.equal(acc(v, 'claude', M).session.usedPct, 5); assert.equal(acc(v, 'claude', F).session.usedPct, 77); assert.deepEqual([...w.calls.claude].sort(), [M, F].sort());
  const before = w.rl.stats().apiEntries; list.length = 0; w.rl.view(); assert.ok(w.rl.stats().apiEntries < before);
});

test('integração: consulta que trava é descartada depois do tempo limite e o resultado tardio é ignorado', async () => {
  const releases = []; const w = world({ claude: () => new Promise((r) => { releases.push(r); }) });
  w.rl.view(); await flush(); w.clock.t += 16_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 1, 'o descarte por timeout recua em vez de reconsultar na hora');
  w.clock.t += 61_000; w.rl.view(); await flush(); assert.equal(w.calls.claude.length, 2);
  releases[1](ok(99, 99)); await flush(); releases[0](ok(1, 1)); await flush(); // a 1ª (descartada) resolve TARDE
  assert.equal(acc(w.rl.view(), 'claude', M).session.usedPct, 99, 'o resultado tardio não sobrescreve');
});

test('Claude: se a pasta da conta isolada não puder ser resolvida, NUNCA cai no login do computador; só a conta do computador DO PROVIDER usa a pasta padrão', async () => {
  const sys = mk(); claudeCreds(sys); const cx = mk(); codexAuth(cx); let calls = 0;
  const u = api({ credsDirOf: () => { throw new Error('x'); }, isMachine: (id, p) => (id === M && p === 'claude') || (id === CX && p === 'codex'), codexHome: cx, env: () => ({ CLAUDE_CONFIG_DIR: sys }), fetchFn: async () => { calls++; return resp(200, { ...claudeBody(), ...codexBody() }); } });
  assert.deepEqual(await u.claude(F), { ok: false, reason: 'sem-credencial' }); assert.equal(calls, 0, 'isolada sem pasta: nada na rede');
  for (const id of [undefined, null, 'system', 'acc_dddddddd', '', 42]) assert.deepEqual(await u.claude(id), { ok: false, reason: 'sem-credencial' }, `claude(${JSON.stringify(id)})`);
  assert.deepEqual(await u.codex(M), { ok: false, reason: 'sem-credencial' }, 'M é a conta do computador do CLAUDE: não vale como do Codex');
  assert.deepEqual(await u.claude(CX), { ok: false, reason: 'sem-credencial' }, 'CX é a conta do computador do CODEX: não vale como do Claude'); assert.equal(calls, 0);
  assert.equal((await u.claude(M)).ok, true, 'a conta do computador do Claude usa o padrão'); assert.equal((await u.codex(CX)).ok, true, 'a conta do computador do Codex usa o codexHome'); assert.equal(calls, 2);
  const boom = api({ credsDirOf: () => '', isMachine: () => { throw new Error('y'); }, fetchFn: async () => { calls++; return resp(200, claudeBody()); } });
  assert.deepEqual(await boom.claude(M), { ok: false, reason: 'sem-credencial' }, 'isMachine que lança = não é a do computador; pasta vazia = sem credencial'); assert.equal(calls, 2);
});

test('Claude: corpo declarado maior que o limite é recusado sem ler', async () => {
  const d = mk(); claudeCreds(d); let read = false;
  const r = await api({ credsDirOf: () => d, fetchFn: async () => ({ status: 200, ok: true, headers: { get: () => '99999999' }, text: async () => { read = true; return '{}'; } }) }).claude(F);
  assert.equal(r.reason, 'formato'); assert.equal(read, false);
});

test('integração: credencial ausente/vencida reconsulta em intervalo fixo (leitura local), sem recuo de 10 min', async () => {
  let mode = 'exp'; const w = world({ claude: () => (mode === 'exp' ? { ok: false, reason: 'token-expirado' } : ok()) });
  w.rl.view(); await flush(); mode = 'ok'; w.clock.t += 31_000; w.rl.view(); await flush();
  assert.equal(acc(w.rl.view(), 'claude', M).source, 'api');
});

test('integração: com a API falhando, o dado LOCAL (arquivo do hook) volta a valer, com os valores locais', async () => {
  const sid = '00000000-0000-4000-8000-000000000001', dir = mk(), sec = Math.floor(T0 / 1000);
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify({ at: iso(T0 - 1000), fiveHour: { usedPct: 21, resetsAt: sec + 3600 }, sevenDay: { usedPct: 43, resetsAt: sec + 86400 } }));
  const rl = RL.createRateLimits({ db: { terminalSessions: [{ provider: 'claude', accountId: M, claudeSessionId: sid, state: 'running' }], accounts: [M_ROW] }, accounts: { list: () => [M_ROW], configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) }, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: mk() }), now: () => T0, memoMs: 0, codexReader: { read: () => null }, usageApi: { claude: async () => ({ ok: false, reason: 'rede' }), codex: async () => ({ ok: false, reason: 'rede' }) }, apiTtlMs: 30_000 });
  rl.view(); await flush(); const a = acc(rl.view(), 'claude', M); assert.deepEqual([a.source, a.session.usedPct, a.week.usedPct], ['statusline', 21, 43]);
});
