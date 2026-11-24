// Integração com o index.js REAL (executor e CLI de contas FALSOS): migração v2 no boot, rotas /api/accounts*, token de sessão, login ponta a ponta, prereqs.login e remoção.
// ORCH_DATA_DIR e porta próprios; o db.json real não é tocado (o teste confere).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), BOOT = path.join(here, 'accounts-boot.mjs');
const REAL_DB = path.resolve(here, '..', '..', 'data', 'db.json');
const stat = () => (fs.existsSync(REAL_DB) ? `${fs.statSync(REAL_DB).mtimeMs}:${fs.statSync(REAL_DB).size}` : 'ausente');
const TOKEN = 'Tk3n_'.repeat(8);
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-acc-boot-')));
const children = new Set();
after(async () => { for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } } await new Promise((r) => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true }); });
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function boot(port, dir, env) {
  assert.ok(fs.realpathSync.native(path.dirname(dir)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste tem que ficar no diretório temporário');
  const child = spawn(process.execPath, [BOOT], { env: { ...process.env, PORT: String(port), ORCH_DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child); let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  return { child, out: () => out, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}
const waitUp = async (b) => { for (let i = 0; i < 100; i++) { if (/FORGE API em/.test(b.out())) return true; await Promise.race([sleep(100), b.exited]); } return false; };
const raw = (port, { method = 'GET', target, headers = {}, body }) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* sem JSON */ } resolve({ status: res.statusCode, text: s, json }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

test('index.js real: o boot vincula a conta do computador; /api/accounts* exigem o token (GET inclusive); login ponta a ponta; remoção apaga só a pasta da conta', async () => {
  const realBefore = stat();
  const dir = path.join(root, 'data'), sys = path.join(root, 'sys'); fs.mkdirSync(dir); fs.mkdirSync(sys);
  const port = await freePort(), b = boot(port, dir, { ORCH_API_TOKEN: TOKEN, FAKE_SYSTEM_DIR: sys, FAKE_LOGIN_MODE: 'auto', FAKE_AUTH_LOG: path.join(root, 'calls.jsonl') }), origin = `http://127.0.0.1:${port}`;
  const T = { origin, 'x-orch-token': TOKEN }, call = (target, o = {}) => raw(port, { target, ...o });
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    for (const [m, p] of [['GET', '/api/accounts'], ['GET', '/api/accounts/acc_00000000/login'], ['POST', '/api/accounts'], ['PATCH', '/api/accounts/acc_00000000'], ['DELETE', '/api/accounts/acc_00000000']]) assert.equal((await call(p, { method: m, body: m === 'POST' ? { provider: 'claude', label: 'x' } : undefined, headers: { origin } })).status, 403, `${m} ${p} sem token`);
    // o boot (migração v2) vinculou o Claude do computador: CLI "instalada" (falsa), sem conta virtual
    let r = await call('/api/accounts', { headers: T }); assert.equal(r.status, 200); assert.deepEqual(r.json.accounts.map((a) => [a.provider, a.home, a.label, a.status.checked, a.status.loggedIn]), [['claude', 'machine', 'Claude Code', true, false]]); assert.equal(r.json.providers[0].available, true);
    const mid = r.json.accounts[0].id; assert.match(mid, /^acc_[0-9a-f]{8}$/); assert.equal('defaultId' in r.json, false);
    assert.equal(JSON.stringify(r.json).includes('NAO-PODE-SAIR'), false);
    // prereqs.login: alguma conta conectada? A do computador existe, ainda sem login
    r = await call('/api/state'); assert.deepEqual([r.json.prereqs.login.known, r.json.prereqs.login.loggedIn], [true, false]); assert.ok(!/@/.test(r.json.prereqs.login.detail));
    r = await call('/api/accounts', { method: 'POST', headers: T, body: { provider: 'claude', label: 'Trabalho' } }); assert.equal(r.status, 201); const id = r.json.id; assert.equal(fs.existsSync(path.join(dir, 'accounts', id, 'claude')), true);
    assert.equal((await call('/api/accounts', { method: 'POST', headers: T, body: { provider: 'codex', label: 'x' } })).json.code, 'provider_unavailable');
    assert.equal((await call(`/api/accounts/${id}/default`, { method: 'POST', headers: T, body: {} })).status, 404, 'não há mais conta padrão');
    r = await call(`/api/accounts/${id}`, { method: 'PATCH', headers: T, body: { label: 'Trabalho 2' } }); assert.deepEqual([r.status, r.json.label], [200, 'Trabalho 2']);
    // login (CLI falsa em modo `auto`: termina sozinha e grava o "login" na pasta da conta)
    assert.equal((await call(`/api/accounts/${id}/login`, { method: 'POST', headers: T, body: { method: 'console' } })).status, 202);
    let s; for (let i = 0; i < 100; i++) { s = (await call(`/api/accounts/${id}/login`, { headers: T })).json; if (s.state !== 'running') break; await sleep(100); }
    assert.equal(s.state, 'done', JSON.stringify(s)); assert.ok(s.url && s.url.startsWith('https://claude.ai/'));
    r = await call('/api/accounts', { headers: T }); const acc = r.json.accounts.find((a) => a.id === id); assert.deepEqual([acc.home, acc.status.loggedIn, acc.status.email, acc.status.plan], ['forge', true, 'pessoa@example.test', 'pro']);
    const calls = fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); assert.deepEqual(calls.find((c) => c.cmd === 'login').args, ['auth', 'login', '--console']); assert.equal(calls.find((c) => c.cmd === 'login').dir, path.join(dir, 'accounts', id, 'claude'));
    // persistência: db.accounts e db.accountsModel do banco TEMPORÁRIO; nada de conta padrão
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); assert.deepEqual(saved.accounts.map((a) => [a.id, a.home]), [[mid, 'machine'], [id, 'forge']]); assert.equal('defaultAccountId' in saved.settings, false);
    assert.deepEqual([saved.accountsModel.v, saved.accountsModel.machineIds, saved.accountsModel.adopted], [2, { claude: mid }, { claude: true }]);
    // remoção
    assert.equal((await call('/api/accounts/system', { method: 'DELETE', headers: T })).status, 404);
    r = await call(`/api/accounts/${id}`, { method: 'DELETE', headers: T }); assert.equal(r.status, 200); assert.equal(fs.existsSync(path.join(dir, 'accounts', id)), false); assert.equal(fs.existsSync(path.join(dir, 'accounts')), true);
    assert.deepEqual((await call('/api/accounts', { headers: T })).json.accounts.map((a) => a.id), [mid]);
    assert.ok(!b.out().includes(TOKEN), 'o token não vai para o log');
  } finally { b.child.kill('SIGKILL'); await b.exited; }
  assert.equal(stat(), realBefore, 'o db.json real não foi tocado');
});

test('index.js real SEM token: rotas de contas seguem só a proteção de Host/Origin (mutação sem Origin => 403)', async () => {
  const dir = path.join(root, 'data2'), sys = path.join(root, 'sys2'); fs.mkdirSync(dir); fs.mkdirSync(sys);
  const port = await freePort(), b = boot(port, dir, { FAKE_SYSTEM_DIR: sys }), origin = `http://127.0.0.1:${port}`;
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    assert.equal((await raw(port, { target: '/api/accounts' })).status, 200);
    assert.equal((await raw(port, { target: '/api/accounts', method: 'POST', body: { provider: 'claude', label: 'x' } })).status, 403);
    assert.equal((await raw(port, { target: '/api/accounts', method: 'POST', body: { provider: 'claude', label: 'x' }, headers: { origin } })).status, 201);
  } finally { b.child.kill('SIGKILL'); await b.exited; }
});

test('/api/state NÃO espera o status frio: responde em < 3 s com login desconhecido e, com o cache quente, devolve o valor real', async () => {
  const dir = path.join(root, 'data3'), sys = path.join(root, 'sys3'); fs.mkdirSync(dir); fs.mkdirSync(sys);
  const port = await freePort(), b = boot(port, dir, { FAKE_SYSTEM_DIR: sys, FAKE_STATUS_SLEEP: '3000' });
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    const t0 = Date.now(); let r = await raw(port, { target: '/api/state' }); const took = Date.now() - t0;
    assert.equal(r.status, 200); assert.ok(took < 3000, `demorou ${took} ms`); assert.deepEqual(r.json.prereqs.login, { known: false, loggedIn: null, detail: '' });
    await sleep(3500); // a consulta em segundo plano terminou e aqueceu o cache
    const t1 = Date.now(); r = await raw(port, { target: '/api/state' }); assert.ok(Date.now() - t1 < 1400, 'com cache quente responde na hora');
    assert.deepEqual([r.json.prereqs.login.known, r.json.prereqs.login.loggedIn], [true, false]);
    assert.ok(!/UnhandledPromiseRejection|rejeição não tratada/.test(b.out()), b.out());
  } finally { b.child.kill('SIGKILL'); await b.exited; }
});

test('/api/state?fresh=1 invalida o status de TODAS as contas: um login feito fora do FORGE aparece sem esperar os 45 s', async () => {
  const dir = path.join(root, 'data4'), sys = path.join(root, 'sys4'); fs.mkdirSync(dir); fs.mkdirSync(sys);
  const port = await freePort(), b = boot(port, dir, { FAKE_SYSTEM_DIR: sys });
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    const login = async (q = '') => (await raw(port, { target: `/api/state${q}` })).json.prereqs.login;
    assert.equal((await login()).loggedIn, false);
    fs.writeFileSync(path.join(sys, 'fake-login.json'), '{}'); // login feito fora do FORGE
    assert.equal((await login()).loggedIn, false, 'cache de 45 s: ainda não vê');
    assert.deepEqual(await login('?fresh=1'), { known: true, loggedIn: true, detail: 'Conta conectada: Claude Code.' });
    assert.equal((await login()).loggedIn, true);
  } finally { b.child.kill('SIGKILL'); await b.exited; }
});

test('migração v2 no boot com banco legado: cópia ÚNICA antes de alterar, referências antigas reescritas, defaultAccountId intacto; 2º boot não muda nada', async () => {
  const realBefore = stat();
  const dir = path.join(root, 'data5'), sys = path.join(root, 'sys5'); fs.mkdirSync(dir); fs.mkdirSync(sys);
  const old = { version: 1, settings: { activeWorkspaceId: null, openWorkspaceIds: [], activeTopicIds: {}, defaultAccountId: 'system' }, workspaces: [], topics: [], activity: [], flows: [], flowRuns: [],
    accounts: [{ id: 'acc_0000a001', provider: 'claude', label: 'Antiga', createdAt: '2026-01-01T00:00:00.000Z' }] };
  const legacy = `${JSON.stringify(old, null, 2)}\n`; fs.writeFileSync(path.join(dir, 'db.json'), legacy);
  const port = await freePort(); let b = boot(port, dir, { FAKE_SYSTEM_DIR: sys });
  let mid;
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    // cópia = banco do instante da migração (o boot já pode ter gravado outra coisa antes, como o Maestro): o que importa é o estado de contas ANTES da migração
    const bak = JSON.parse(fs.readFileSync(path.join(dir, 'db.json.pre-accounts-v2'), 'utf8'));
    assert.deepEqual([bak.accounts, bak.settings.defaultAccountId, 'accountsModel' in bak, 'lastAccountByProvider' in bak.settings], [old.accounts, 'system', false, false], 'cópia de segurança = contas ANTES da migração');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const machine = saved.accounts.find((a) => a.home === 'machine'); mid = machine.id;
    assert.deepEqual([machine.provider, machine.label], ['claude', 'Claude Code']);
    assert.deepEqual(saved.accounts.find((a) => a.id === 'acc_0000a001'), old.accounts[0], 'linha antiga intacta (sem home = forge)');
    assert.equal(saved.settings.defaultAccountId, 'system', 'defaultAccountId nunca é apagado (só ignorado)'); assert.deepEqual(saved.settings.lastAccountByProvider, { claude: mid }, 'pré-seleção semeada');
    assert.equal(saved.accountsModel.v, 2);
    const r = await raw(port, { target: '/api/accounts' }); assert.deepEqual(r.json.accounts.map((a) => [a.id, a.home]), [['acc_0000a001', 'forge'], [mid, 'machine']]);
  } finally { b.child.kill('SIGKILL'); await b.exited; }
  // 2º boot: idempotente (nenhuma linha nova; a cópia não é sobrescrita)
  fs.writeFileSync(path.join(dir, 'db.json.pre-accounts-v2'), legacy); const before2 = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  b = boot(await freePort(), dir, { FAKE_SYSTEM_DIR: sys });
  try {
    assert.ok(await waitUp(b), `servidor não subiu:\n${b.out()}`);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); assert.equal(saved.accounts.filter((a) => a.home === 'machine').length, 1); assert.equal(saved.accounts.find((a) => a.home === 'machine').id, mid);
    assert.deepEqual(JSON.parse(before2).accounts, saved.accounts);
    assert.equal(fs.readFileSync(path.join(dir, 'db.json.pre-accounts-v2'), 'utf8'), legacy);
  } finally { b.child.kill('SIGKILL'); await b.exited; }
  assert.equal(stat(), realBefore, 'o db.json real não foi tocado');
});
