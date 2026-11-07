// Contas do Claude Code: modelo, validações, conta padrão, remoção segura (links), status (cache/dedupe), rotas, token de sessão e prereqs.login.
// CLI FALSA (fake-claude-auth.mjs) injetada; ORCH_DATA_DIR temporário; nunca o Claude real, nunca o banco real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-acc-model-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
const { default: express } = await import('express');
const { uid } = await import('../store.js');
const A = await import('../accounts.js');
const { createLoginManager } = await import('../account-login.js');
const { probeLogin, prereqsOf } = await import('../prereqs.js');
const { createTokenGuard, TOKEN_HEADER } = await import('../session-token.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude-auth.mjs');
let n = 0;
/** Mundo isolado: banco em memória, pasta de dados própria, CLI falsa com log de chamadas. */
function world(over = {}) {
  const k = ++n, dataDir = path.join(tmp, `data${k}`), sysDir = path.join(tmp, `sys${k}`), logFile = path.join(tmp, `calls${k}.jsonl`);
  fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(sysDir, { recursive: true });
  const db = { settings: {} }, st = { failPersist: false, persists: 0, extraEnv: {}, inUse: new Set() };
  const persist = () => { st.persists++; if (st.failPersist) throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); };
  const env = () => ({ ...process.env, FAKE_AUTH_LOG: logFile, FAKE_SYSTEM_DIR: sysDir, ...st.extraEnv });
  const logins = { active: null };
  const accounts = A.createAccounts({ db, dataDir, persist, uid, command: process.execPath, prefixArgs: [FAKE], env, isInUse: (id) => st.inUse.has(id), isLoginActive: (id) => logins.active?.isActive(id) === true, ...over });
  const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { k, dataDir, sysDir, db, st, accounts, logins, calls, accDir: (id) => path.join(dataDir, 'accounts', id), env };
}
const mk = (w, label = 'Pessoal') => { const r = w.accounts.create({ provider: 'claude', label }); assert.equal(r.ok, true, r.error); return r.account; };
const markLoggedIn = (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'fake-login.json'), '{}'); };
const linkDir = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('label: 1 a 60 caracteres depois de aparar, sem caracteres de controle', () => {
  assert.deepEqual(A.validateLabel('  Trabalho  '), { ok: true, label: 'Trabalho' });
  assert.equal(A.validateLabel('a'.repeat(60)).ok, true);
  for (const bad of ['', '   ', 'a'.repeat(61), 'a\nb', 'a\u0000b', 'tab\taqui', 'x\u001b[31m', 'fim\n', '\u007f', 'a\u2028b', null, undefined, 42, {}, ['a']]) assert.equal(A.validateLabel(bad).ok, false, JSON.stringify(bad));
  assert.equal(A.validateLabel(`  ${'a'.repeat(60)}  `).ok, true, 'o limite vale DEPOIS de aparar');
});

test('criar: id gerado pelo servidor, pasta <dados>/accounts/<id>/claude (0700 fora do Windows), só os campos do contrato, 201', () => {
  const w = world(); const r = w.accounts.create({ provider: 'claude', label: '  Minha conta  ' });
  assert.equal(r.status, 201); assert.match(r.account.id, /^acc_[0-9a-f]{8}$/); assert.deepEqual(Object.keys(r.account).sort(), ['createdAt', 'id', 'label', 'provider']); assert.equal(r.account.label, 'Minha conta');
  const dir = path.join(w.accDir(r.account.id), 'claude'); assert.equal(w.accounts.configDirOf(r.account.id), dir); assert.equal(fs.statSync(dir).isDirectory(), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(w.db.accounts.map((a) => a.id), [r.account.id]); assert.equal(w.st.persists, 1);
  assert.equal(w.accounts.configDirOf('system'), null, 'Sistema não sobrescreve CLAUDE_CONFIG_DIR');
  assert.equal(w.accounts.list().some((a) => a.id === 'system'), false, 'Sistema é virtual: não é gravada');
});

test('criar: provedores e rótulos inválidos são recusados sem efeito; codex/desconhecido => provider_unavailable', () => {
  const w = world();
  for (const provider of ['codex', 'openai', '', undefined, null, 7, '__proto__']) { const r = w.accounts.create({ provider, label: 'x' }); assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'provider_unavailable'], String(provider)); }
  for (const label of ['', ' ', 'a'.repeat(61), 'a\nb', undefined, 5]) assert.equal(w.accounts.create({ provider: 'claude', label }).status, 400);
  assert.equal(w.db.accounts, undefined); assert.equal(w.st.persists, 0); assert.equal(fs.existsSync(path.join(w.dataDir, 'accounts')), false, 'nada foi criado em disco');
});

test('criar: limite de 10 contas; ids distintos', () => {
  const w = world(); const ids = new Set();
  for (let i = 0; i < 10; i++) ids.add(mk(w, `c${i}`).id);
  assert.equal(ids.size, 10); const r = w.accounts.create({ provider: 'claude', label: 'onze' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'accounts_limit']); assert.equal(w.db.accounts.length, 10);
});

test('criar: falha ao gravar o banco desfaz tudo (lista, campo e pasta)', () => {
  const w = world(); w.st.failPersist = true; const r = w.accounts.create({ provider: 'claude', label: 'x' });
  assert.deepEqual([r.ok, r.status], [false, 500]); assert.equal(w.db.accounts, undefined); assert.deepEqual(fs.readdirSync(path.join(w.dataDir, 'accounts')), []);
  w.st.failPersist = false; const a = mk(w); w.st.failPersist = true; assert.equal(w.accounts.create({ provider: 'claude', label: 'y' }).ok, false); assert.deepEqual(w.db.accounts.map((x) => x.id), [a.id], 'a conta existente continua');
});

test('conta padrão: system por padrão; define por id existente ou system; id desconhecido 404; falha de gravação reverte', () => {
  const w = world(); const a = mk(w);
  assert.equal(w.accounts.defaultId(), 'system');
  assert.equal(w.accounts.setDefault(a.id).ok, true); assert.equal(w.accounts.defaultId(), a.id); assert.equal(w.db.settings.defaultAccountId, a.id);
  assert.equal(w.accounts.setDefault('acc_deadbeef').status, 404); assert.equal(w.accounts.setDefault('../x').status, 404); assert.equal(w.accounts.setDefault(undefined).status, 404); assert.equal(w.accounts.defaultId(), a.id);
  w.st.failPersist = true; assert.equal(w.accounts.setDefault('system').status, 500); assert.equal(w.accounts.defaultId(), a.id, 'rollback');
  w.st.failPersist = false; assert.equal(w.accounts.setDefault('system').ok, true); assert.equal(w.accounts.defaultId(), 'system');
  w.db.settings.defaultAccountId = 'acc_00000000'; assert.equal(w.accounts.defaultId(), 'system', 'padrão apontando para conta inexistente cai em system');
});

test('listView: Sistema primeiro, flags, provedores (codex em breve) e status SÓ com os campos do contrato (nada do resto da saída da CLI)', async () => {
  const w = world(); const a = mk(w, 'Trabalho'); markLoggedIn(path.join(w.accDir(a.id), 'claude')); w.accounts.setDefault(a.id);
  const v = await w.accounts.listView();
  assert.deepEqual(v.accounts.map((x) => [x.id, x.system, x.isDefault]), [['system', true, false], [a.id, false, true]]); assert.equal(v.defaultId, a.id);
  assert.deepEqual(v.providers, [{ id: 'claude', label: 'Claude Code', canLogin: true, available: true }, { id: 'codex', label: 'Codex', available: false, comingSoon: true }]);
  assert.deepEqual(Object.keys(v.accounts[1].status).sort(), ['authMethod', 'checked', 'email', 'error', 'loggedIn', 'loginExpiresAt', 'orgName', 'subscriptionType']);
  assert.deepEqual(v.accounts[1].status, { checked: true, loggedIn: true, authMethod: 'claude.ai', email: 'pessoa@example.test', orgName: 'Org Teste', subscriptionType: 'pro', loginExpiresAt: '2030-01-01T00:00:00.000Z', error: null });
  assert.equal(JSON.stringify(v).includes('NAO-PODE-SAIR'), false); assert.equal(JSON.stringify(v).includes('configDirectory'), false);
  assert.equal(v.accounts[0].status.loggedIn, false, 'Sistema sem login (pasta do sistema falsa vazia)'); assert.equal(v.accounts[0].status.checked, true);
  // cada pasta é consultada com o CLAUDE_CONFIG_DIR dela; o Sistema, sem sobrescrever
  const st = w.calls().filter((c) => c.cmd === 'status'); assert.deepEqual(st.map((c) => c.dir).sort(), [null, path.join(w.accDir(a.id), 'claude')].sort());
});

test('status: cache de ~45 s por pasta, chamadas simultâneas deduplicadas e invalidação', async () => {
  const w = world(); w.st.extraEnv.FAKE_STATUS_SLEEP = '300'; const a = mk(w);
  const rs = await Promise.all([1, 2, 3, 4].map(() => w.accounts.statusOf(a.id))); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 1, 'uma consulta para 4 pedidos simultâneos'); assert.ok(rs.every((r) => r === rs[0]));
  await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 1, 'cache');
  await w.accounts.statusOf('system'); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 2, 'outra pasta, outra consulta');
  w.accounts.invalidate(a.id); await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 3);
  // invalidar DURANTE uma consulta: o resultado antigo não entra no cache
  w.accounts.invalidate(a.id); const slow = w.accounts.statusOf(a.id); w.accounts.invalidate(a.id); await slow; await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 5);
});

test('status: Claude Code ausente, saída que não é JSON e tempo esgotado => checked:false com erro curto (sem saída bruta)', async () => {
  let w = world({ unavailable: true }); let s = await w.accounts.statusOf('system'); assert.deepEqual(s, { checked: false, loggedIn: null, authMethod: null, email: null, orgName: null, subscriptionType: null, loginExpiresAt: null, error: 'Claude Code não encontrado' });
  assert.equal((await w.accounts.listView()).providers[0].available, false);
  w = world({ command: path.join(tmp, 'nao-existe.exe'), prefixArgs: [] }); s = await w.accounts.statusOf('system'); assert.equal(s.checked, false); assert.equal(s.error, 'Claude Code não encontrado');
  w = world(); w.st.extraEnv.FAKE_STATUS_GARBAGE = '1'; s = await w.accounts.statusOf('system'); assert.equal(s.checked, false); assert.ok(!/nao e json/.test(s.error));
  w = world({ statusTimeoutMs: 300 }); w.st.extraEnv.FAKE_STATUS_SLEEP = '5000'; const t0 = Date.now(); s = await w.accounts.statusOf('system'); assert.ok(Date.now() - t0 < 4000); assert.equal(s.checked, false); assert.match(s.error, /Tempo esgotado/);
});

test('remover: recusa Sistema (400) e conta desconhecida (404); conta em uso por terminal (409) não muda nada', async () => {
  const w = world(); const a = mk(w);
  assert.deepEqual((({ status, code }) => ({ status, code }))(await w.accounts.remove('system')), { status: 400, code: 'system_account' });
  assert.equal((await w.accounts.remove('acc_deadbeef')).status, 404); assert.equal((await w.accounts.remove('../etc')).status, 404);
  w.st.inUse.add(a.id); const r = await w.accounts.remove(a.id); assert.deepEqual([r.status, r.code], [409, 'account_in_use']); assert.match(r.error, /terminal em execução/);
  assert.equal(w.db.accounts.length, 1); assert.equal(fs.existsSync(w.accDir(a.id)), true); assert.equal(w.calls().some((c) => c.cmd === 'logout'), false, 'nem logout');
});

test('remover: logout com a pasta da conta, DEPOIS apaga só <dados>/accounts/<id>; a padrão volta a system; outras contas intactas', async () => {
  const w = world(); const a = mk(w, 'A'), b = mk(w, 'B'); markLoggedIn(path.join(w.accDir(a.id), 'claude')); w.accounts.setDefault(a.id);
  const sibling = path.join(w.accDir(b.id), 'claude', 'marca.txt'); fs.writeFileSync(sibling, 'fica');
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.folderRemoved], [true, true]);
  const lo = w.calls().filter((c) => c.cmd === 'logout'); assert.equal(lo.length, 1); assert.equal(lo[0].dir, path.join(w.accDir(a.id), 'claude'));
  assert.equal(fs.existsSync(w.accDir(a.id)), false); assert.equal(fs.readFileSync(sibling, 'utf8'), 'fica'); assert.deepEqual(w.db.accounts.map((x) => x.id), [b.id]); assert.equal(w.accounts.defaultId(), 'system'); assert.equal(w.db.settings.defaultAccountId, 'system');
  assert.equal(fs.existsSync(path.join(w.dataDir, 'accounts')), true, 'a pasta accounts/ continua');
});

test('remover: falha ao gravar o banco => rollback (conta, padrão e pasta continuam)', async () => {
  const w = world(); const a = mk(w); w.accounts.setDefault(a.id); w.st.failPersist = true;
  const r = await w.accounts.remove(a.id); assert.equal(r.status, 500); assert.deepEqual(w.db.accounts.map((x) => x.id), [a.id]); assert.equal(w.accounts.defaultId(), a.id); assert.equal(fs.existsSync(path.join(w.accDir(a.id), 'claude')), true);
});

test('remover NÃO segue link simbólico/junction: a pasta da conta é um link para uma pasta-isca => recusa e a isca fica intacta', async () => {
  const w = world(); const a = mk(w); const decoy = path.join(tmp, `isca${w.k}`); fs.mkdirSync(path.join(decoy, 'sub'), { recursive: true }); fs.writeFileSync(path.join(decoy, 'sub', 'dado.txt'), 'importante');
  fs.rmSync(w.accDir(a.id), { recursive: true }); linkDir(decoy, w.accDir(a.id));
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.status, r.code], [false, 500, 'unsafe_dir']);
  assert.equal(fs.readFileSync(path.join(decoy, 'sub', 'dado.txt'), 'utf8'), 'importante'); assert.equal(w.db.accounts.length, 1, 'a conta continua cadastrada'); assert.equal(w.calls().some((c) => c.cmd === 'logout'), false);
  fs.unlinkSync(w.accDir(a.id)); // remove só o link (rmdir do junction), nunca o alvo
  assert.equal(fs.existsSync(path.join(decoy, 'sub', 'dado.txt')), true);
});

test('remover: link DENTRO da pasta da conta (para fora) é removido como link; o alvo fora continua intacto', async () => {
  const w = world(); const a = mk(w); const decoy = path.join(tmp, `isca-in${w.k}`); fs.mkdirSync(decoy, { recursive: true }); fs.writeFileSync(path.join(decoy, 'dado.txt'), 'importante');
  linkDir(decoy, path.join(w.accDir(a.id), 'claude', 'evil'));
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.folderRemoved], [true, true]);
  assert.equal(fs.existsSync(w.accDir(a.id)), false); assert.equal(fs.readFileSync(path.join(decoy, 'dado.txt'), 'utf8'), 'importante');
});

test('remover: accounts/ que é um link para fora da pasta de dados => recusa; ids fora do padrão nunca passam pela inspeção', async () => {
  const w = world(); const a = mk(w); const outside = path.join(tmp, `fora${w.k}`); fs.mkdirSync(path.join(outside, a.id, 'claude'), { recursive: true }); fs.writeFileSync(path.join(outside, a.id, 'dado.txt'), 'x');
  fs.rmSync(path.join(w.dataDir, 'accounts'), { recursive: true }); linkDir(outside, path.join(w.dataDir, 'accounts'));
  assert.equal((await w.accounts.remove(a.id)).code, 'unsafe_dir'); assert.equal(fs.existsSync(path.join(outside, a.id, 'dado.txt')), true);
  fs.unlinkSync(path.join(w.dataDir, 'accounts'));
  for (const id of ['..', '.', 'system', 'acc_xyz', 'acc_1234567', 'acc_123456789', 'ACC_12345678', 'acc_12345678/..', 'acc_1234567g', '', null, undefined, 5]) assert.equal(w.accounts.inspectDir(id).ok, false, String(id));
});

test('db.accounts com entradas malformadas é ignorado (id fora do padrão nunca vira caminho)', () => {
  const w = world(); w.db.accounts = [{ id: '../../x', provider: 'claude', label: 'm' }, null, { id: 'acc_00000001', provider: 'claude', label: 'ok', createdAt: 'x' }];
  assert.deepEqual(w.accounts.list().map((a) => a.id), ['acc_00000001']); assert.equal(w.accounts.exists('../../x'), false);
  assert.equal(w.accounts.configDirOf('../../x').includes('..'), false, 'conta desconhecida: pasta inexistente, não um caminho do cliente');
  assert.notEqual(w.accounts.configDirOf('acc_deadbeef'), null, 'removida/desconhecida NUNCA cai na pasta global (null)');
});

// ---- rotas ----
async function serve(w, { token = null, logins = null } = {}) {
  const lm = logins ?? createLoginManager({ accounts: w.accounts, command: process.execPath, prefixArgs: [FAKE], env: w.env }); w.logins.active = lm;
  const app = express(); if (token) app.use('/api', createTokenGuard(token)); app.use(express.json());
  A.setupAccounts(app, { accounts: w.accounts, logins: lm });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* sem corpo */ } return { status: r.status, body: j }; };
  return { call, close: () => server.close() };
}

test('rotas: contrato de GET/POST/default/DELETE', async () => {
  const w = world(); const s = await serve(w);
  try {
    let r = await s.call('GET', '/api/accounts'); assert.equal(r.status, 200); assert.deepEqual(r.body.accounts.map((x) => x.id), ['system']); assert.equal(r.body.defaultId, 'system'); assert.equal(r.body.providers.length, 2);
    r = await s.call('POST', '/api/accounts', { provider: 'codex', label: 'x' }); assert.deepEqual([r.status, r.body.code], [400, 'provider_unavailable']); assert.equal(typeof r.body.error, 'string');
    r = await s.call('POST', '/api/accounts', { provider: 'claude', label: '' }); assert.equal(r.status, 400);
    r = await s.call('POST', '/api/accounts', 'texto-puro'); assert.equal(r.status, 400);
    r = await s.call('POST', '/api/accounts', { provider: 'claude', label: 'Pessoal' }); assert.equal(r.status, 201); const id = r.body.id; assert.match(id, /^acc_[0-9a-f]{8}$/); assert.equal(r.body.label, 'Pessoal');
    r = await s.call('POST', `/api/accounts/${id}/default`, {}); assert.deepEqual([r.status, r.body.defaultId], [200, id]);
    r = await s.call('POST', '/api/accounts/acc_deadbeef/default', {}); assert.equal(r.status, 404);
    r = await s.call('POST', '/api/accounts/..%2F..%2Fx/default', {}); assert.equal(r.status, 404);
    r = await s.call('DELETE', '/api/accounts/system'); assert.deepEqual([r.status, r.body.code], [400, 'system_account']);
    r = await s.call('DELETE', `/api/accounts/${id}`); assert.deepEqual([r.status, r.body.ok], [200, true]);
    r = await s.call('GET', '/api/accounts'); assert.deepEqual([r.body.accounts.length, r.body.defaultId], [1, 'system']);
    r = await s.call('DELETE', `/api/accounts/${id}`); assert.equal(r.status, 404);
    r = await s.call('GET', '/api/accounts/xyz/login'); assert.equal(r.status, 404);
  } finally { s.close(); }
});

test('token de sessão: com token configurado, TODAS as rotas /api/accounts* (GET inclusive) exigem o header; sem token configurado nada muda', async () => {
  const TOKEN = 'T0ken_'.repeat(8); const w = world(); const s = await serve(w, { token: TOKEN });
  try {
    const H = { [TOKEN_HEADER]: TOKEN }, id = 'acc_00000000';
    for (const [m, p] of [['GET', '/api/accounts'], ['GET', '/api/accounts/'], ['GET', `/api/accounts/${id}/login`], ['GET', '/api/accounts/system/login'], ['POST', '/api/accounts'], ['POST', `/api/accounts/${id}/default`], ['DELETE', `/api/accounts/${id}`], ['POST', `/api/accounts/${id}/login`], ['POST', `/api/accounts/${id}/login/input`], ['POST', `/api/accounts/${id}/login/cancel`]]) {
      assert.equal((await s.call(m, p, m === 'GET' ? undefined : {})).status, 403, `${m} ${p} sem token`);
      assert.equal((await s.call(m, p, m === 'GET' ? undefined : {}, { [TOKEN_HEADER]: 'errado' })).status, 403, `${m} ${p} token errado`);
    }
    assert.equal((await s.call('GET', '/api/accounts', undefined, H)).status, 200);
    assert.equal((await s.call('POST', '/api/accounts', { provider: 'claude', label: 'ok' }, H)).status, 201);
  } finally { s.close(); }
});

test('prereqs.login: estado da CONTA PADRÃO via claude auth status; variáveis de ambiente valem só na conta Sistema; detail nunca traz e-mail', async () => {
  const w = world(); const noEnv = {};
  let l = await probeLogin({ env: noEnv, accounts: w.accounts }); assert.equal(l.known, true); assert.equal(l.loggedIn, false); assert.match(l.detail, /Contas/);
  markLoggedIn(w.sysDir); w.accounts.invalidate('system'); l = await probeLogin({ env: noEnv, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, true]); assert.ok(!/@|example/.test(l.detail));
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) { const w2 = world(); l = await probeLogin({ env: { [k]: '1' }, accounts: w2.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, true], k); assert.equal(w2.calls().length, 0, 'nem consulta a CLI'); }
  const a = mk(w); w.accounts.setDefault(a.id); l = await probeLogin({ env: { ANTHROPIC_API_KEY: 'k' }, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, false], 'conta do FORGE: a chave do ambiente não vale (é removida do filho)');
  const wm = world({ unavailable: true }); l = await probeLogin({ env: noEnv, accounts: wm.accounts }); assert.deepEqual([l.known, l.loggedIn], [false, null]);
  const wg = world(); wg.st.extraEnv.FAKE_STATUS_GARBAGE = '1'; l = await probeLogin({ env: noEnv, accounts: wg.accounts }); assert.deepEqual([l.known, l.loggedIn], [false, null]);
  assert.deepEqual(prereqsOf({ available: true, version: '1' }, { available: true, version: '2', detail: 'ok' }, l).login, { known: false, loggedIn: null, detail: l.detail }, 'formato de prereqs preservado');
});

// ---- correções pós-revisão ----
test('remover a conta PADRÃO com Executor/Planner ocupados => 409 account_in_use (nada muda); ocioso => remove e avisa defaultChangedTo; não padrão não é bloqueada', async () => {
  const flag = { busy: true }; const w = world({ isCycleBusy: () => flag.busy }); const a = mk(w, 'A'), b = mk(w, 'B'); w.accounts.setDefault(a.id);
  let r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_in_use']); assert.match(r.error, /conta padrão.*ciclo autônomo/);
  assert.equal(w.db.accounts.length, 2); assert.equal(fs.existsSync(w.accDir(a.id)), true); assert.equal(w.accounts.defaultId(), a.id); assert.equal(w.calls().some((c) => c.cmd === 'logout'), false);
  r = await w.accounts.remove(b.id); assert.deepEqual([r.ok, r.defaultChangedTo], [true, undefined], 'conta que não é a padrão: liberada mesmo ocupado');
  flag.busy = false; r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.folderRemoved, r.defaultChangedTo], [true, true, 'system']); assert.equal(w.accounts.defaultId(), 'system');
});

test('remover a padrão quando o ciclo fica ocupado DURANTE o logout => 409 e nada é apagado', async () => {
  const flag = { busy: false }; const w = world({ isCycleBusy: () => flag.busy }); const a = mk(w); w.accounts.setDefault(a.id); w.st.extraEnv.FAKE_STATUS_SLEEP = '0';
  const run = w.accounts.runAuth; // o logout é a única chamada assíncrona: liga o "ocupado" no meio dela
  const p = w.accounts.remove(a.id); flag.busy = true; const r = await p;
  assert.deepEqual([r.ok, r.status], [false, 409]); assert.equal(w.db.accounts.length, 1); assert.equal(fs.existsSync(w.accDir(a.id)), true); assert.ok(run);
});

test('rota DELETE da padrão devolve defaultChangedTo e folderRemoved; ?status=0 não executa a CLI; ?fresh=1 invalida o cache', async () => {
  const w = world(); const a = mk(w); w.accounts.setDefault(a.id); const s = await serve(w);
  try {
    const nStatus = () => w.calls().filter((c) => c.cmd === 'status').length;
    let r = await s.call('GET', '/api/accounts?status=0'); assert.equal(r.status, 200); assert.equal(nStatus(), 0, 'nenhuma chamada à CLI');
    const empty = { checked: false, loggedIn: null, authMethod: null, email: null, orgName: null, subscriptionType: null, loginExpiresAt: null, error: null };
    assert.deepEqual(r.body.accounts.map((x) => x.status), [empty, empty]); assert.deepEqual(r.body.accounts.map((x) => [x.id, x.isDefault]), [['system', false], [a.id, true]]); assert.equal(r.body.defaultId, a.id);
    r = await s.call('GET', '/api/accounts'); assert.equal(nStatus(), 2); assert.equal(r.body.accounts[0].status.checked, true);
    await s.call('GET', '/api/accounts'); assert.equal(nStatus(), 2, 'cache');
    await s.call('GET', '/api/accounts?fresh=1'); assert.equal(nStatus(), 4, 'fresh=1 consulta de novo todas as contas');
    r = await s.call('DELETE', `/api/accounts/${a.id}`); assert.deepEqual([r.status, r.body.ok, r.body.folderRemoved, r.body.defaultChangedTo], [200, true, true, 'system']);
    const b = mk(w); r = await s.call('DELETE', `/api/accounts/${b.id}`); assert.equal('defaultChangedTo' in r.body, false);
  } finally { s.close(); }
});

test('envForAccount: conta do FORGE perde também Bedrock/Vertex/BASE_URL/CUSTOM_HEADERS (sem diferenciar maiúsculas); a conta Sistema herda tudo', async () => {
  const { envForAccount } = await import('../claude-cli.js');
  const base = { ANTHROPIC_API_KEY: 'a', Anthropic_Auth_Token: 'b', CLAUDE_CODE_OAUTH_TOKEN: 'c', CLAUDE_CODE_USE_BEDROCK: '1', claude_code_use_vertex: '1', ANTHROPIC_BASE_URL: 'https://x', anthropic_custom_headers: 'h: v', PATH: 'p', OUTRA: 'ok' };
  const e = envForAccount(base, '/pasta/conta'); assert.deepEqual(Object.keys(e).sort(), ['CLAUDE_CONFIG_DIR', 'OUTRA', 'PATH']); assert.equal(e.CLAUDE_CONFIG_DIR, '/pasta/conta');
  assert.deepEqual(envForAccount(base, null), base, 'Sistema: ambiente como está'); assert.equal(base.ANTHROPIC_API_KEY, 'a', 'o original não é alterado');
});

test('"Verificar novamente": reset das sondas do Git e do executor força nova consulta (sem reset, o cache vale)', async () => {
  const { createGitProbe } = await import('../prereqs.js'); const { createExecutor } = await import('../executor/index.js');
  const counter = path.join(tmp, 'sondas.txt'); fs.writeFileSync(counter, '');
  const script = path.join(tmp, 'sonda.mjs'); fs.writeFileSync(script, "import fs from 'node:fs'; fs.appendFileSync(process.env.SONDA_LOG, 'x'); console.log('git version 1.0');");
  const old = process.env.SONDA_LOG; process.env.SONDA_LOG = counter;
  try {
    const n = () => fs.readFileSync(counter, 'utf8').length;
    const git = createGitProbe({ command: process.execPath, prefixArgs: [script] }); await git(); await git(); assert.equal(n(), 1); git.reset(); await git(); assert.equal(n(), 2);
    const ex = createExecutor({ command: process.execPath, prefixArgs: [script], args: [] }); await ex.probe(); await ex.probe(); assert.equal(n(), 3); ex.resetProbe(); await ex.probe(); assert.equal(n(), 4);
  } finally { if (old === undefined) delete process.env.SONDA_LOG; else process.env.SONDA_LOG = old; }
});
