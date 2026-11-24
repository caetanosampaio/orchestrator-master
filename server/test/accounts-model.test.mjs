// Contas (modelo v2, sem conta virtual nem conta padrão): validações, conta do computador, renomear, resolveFor, última usada, remoção segura (links), status (cache/dedupe), rotas, token de sessão e prereqs.login.
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
const { probeLogin, prereqsOf, NO_ACCOUNT_DETAIL } = await import('../prereqs.js');
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
  const accounts = A.createAccounts({ db, dataDir, persist, uid, command: process.execPath, prefixArgs: [FAKE], env, isInUse: (id) => st.inUse.has(id), isLoginActive: (id) => logins.active?.isActive(id) === true, detect: { codex: () => false }, ...over }); // Codex ausente por padrão: o teste não depende do PATH da máquina
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

const mkMachine = (w, label) => { const r = w.accounts.create({ provider: 'claude', home: 'machine', ...(label ? { label } : {}) }); assert.equal(r.ok, true, r.error); return r.account; };
/** Codex FALSO pela costura de ctx do bloco `account`: `codex login status` sai 0 (conectado) ou 1 (desconectado); nunca o Codex real. */
const fakeCodex = (state) => ({
  detect: { codex: () => true },
  providerCtx: { codex: { resolve: () => ({ file: 'codex-falso', args: [], viaShell: false }), run: (file, args, opts, cb) => { state.calls.push(args); setImmediate(() => cb(state.loggedIn ? null : Object.assign(new Error('x'), { code: 1 }))); return { pid: undefined }; } } },
});

test('criar: id gerado pelo servidor, pasta <dados>/accounts/<id>/claude (0700 fora do Windows), só os campos do contrato, 201', () => {
  const w = world(); const r = w.accounts.create({ provider: 'claude', label: '  Minha conta  ' });
  assert.equal(r.status, 201); assert.match(r.account.id, /^acc_[0-9a-f]{8}$/); assert.deepEqual(Object.keys(r.account).sort(), ['createdAt', 'home', 'id', 'label', 'provider']); assert.equal(r.account.label, 'Minha conta'); assert.equal(r.account.home, 'forge');
  const dir = path.join(w.accDir(r.account.id), 'claude'); assert.equal(w.accounts.configDirOf(r.account.id), dir); assert.equal(fs.statSync(dir).isDirectory(), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(w.db.accounts.map((a) => a.id), [r.account.id]); assert.equal(w.db.accounts[0].home, 'forge'); assert.equal(w.st.persists, 1);
  assert.equal(w.accounts.list().some((a) => a.id === 'system'), false, 'não existe conta virtual');
});

test('criar: provedores e rótulos inválidos são recusados sem efeito; Codex não tem conta isolada pelo FORGE (login é do próprio Codex)', () => {
  const w = world();
  for (const provider of ['codex', 'openai', '', undefined, null, 7, '__proto__', 'constructor']) { const r = w.accounts.create({ provider, label: 'x' }); assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'provider_unavailable'], String(provider)); }
  assert.match(w.accounts.create({ provider: 'codex', label: 'x' }).error, /codex login/, 'a nota do provider explica o porquê');
  for (const label of ['', ' ', 'a'.repeat(61), 'a\nb', undefined, 5]) assert.equal(w.accounts.create({ provider: 'claude', label }).status, 400);
  for (const home of ['', 'sistema', 'MACHINE', null, 1]) assert.deepEqual([w.accounts.create({ provider: 'claude', label: 'x', home }).code], ['invalid_home'], String(home));
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

test('conta do computador: sem pasta, rótulo semente, uma por provider, exige a CLI; desvincular não faz logout e o id volta ao vincular de novo', async () => {
  const w = world(); const m = mkMachine(w);
  assert.deepEqual([m.home, m.label, m.provider], ['machine', 'Claude Code', 'claude']); assert.equal(w.accounts.configDirOf(m.id), null, 'ambiente do processo');
  assert.equal(fs.existsSync(path.join(w.dataDir, 'accounts')), false, 'nenhuma pasta criada');
  assert.deepEqual(w.db.accountsModel.machineIds, { claude: m.id }); assert.equal(w.db.accountsModel.adopted.claude, true);
  assert.deepEqual([w.accounts.create({ provider: 'claude', home: 'machine' }).code], ['machine_exists']);
  markLoggedIn(w.sysDir);
  const r = await w.accounts.remove(m.id); assert.deepEqual([r.ok, r.unlinked, r.folderRemoved], [true, true, false]);
  assert.equal(w.calls().some((c) => c.cmd === 'logout'), false, 'desvincular NUNCA faz logout do computador'); assert.equal(fs.existsSync(path.join(w.sysDir, 'fake-login.json')), true);
  const again = mkMachine(w, 'Meu Mac'); assert.deepEqual([again.id, again.label], [m.id, 'Meu Mac'], 'mesmo id: limites e sessões antigas continuam valendo');
  const u = world({ unavailable: true }); assert.deepEqual([u.accounts.create({ provider: 'claude', home: 'machine' }).code], ['cli_missing']);
  const c = world({ detect: { codex: () => false } }); assert.deepEqual([c.accounts.create({ provider: 'codex', home: 'machine' }).code], ['cli_missing']);
  const st = { calls: [], loggedIn: true }; const cx = world(fakeCodex(st)); const mc = cx.accounts.create({ provider: 'codex', home: 'machine' });
  assert.deepEqual([mc.ok, mc.account.label, mc.account.home], [true, 'Codex CLI', 'machine'], 'Codex: só a conta do computador');
});

test('conta do computador: falha ao gravar desfaz a linha e o accountsModel', () => {
  const w = world(); w.st.failPersist = true; const r = w.accounts.create({ provider: 'claude', home: 'machine' });
  assert.deepEqual([r.ok, r.status], [false, 500]); assert.equal(w.db.accounts, undefined); assert.equal(w.db.accountsModel, undefined);
});

test('renomear: só o rótulo; inválido 400; desconhecida 404; falha de gravação reverte', () => {
  const w = world(); const a = mk(w, 'Antes');
  let r = w.accounts.rename(a.id, '  Depois '); assert.deepEqual([r.ok, r.account.label], [true, 'Depois']); assert.equal(w.db.accounts[0].label, 'Depois');
  for (const bad of ['', 'a\nb', 'a'.repeat(61), undefined, 3]) assert.equal(w.accounts.rename(a.id, bad).status, 400);
  for (const id of ['acc_deadbeef', 'system', '../x', undefined]) assert.equal(w.accounts.rename(id, 'x').status, 404, String(id));
  w.st.failPersist = true; r = w.accounts.rename(a.id, 'Falha'); assert.equal(r.status, 500); assert.equal(w.db.accounts[0].label, 'Depois', 'rollback');
});

test('resolveFor: a pedida (do provider, conectada) ou a ÚNICA; várias = account_required; nenhuma = no_account', async () => {
  const w = world();
  assert.deepEqual([w.accounts.resolveFor('claude').code], ['no_account']);
  for (const p of ['openai', '__proto__', undefined, 7]) assert.equal(w.accounts.resolveFor(p).code, 'provider_unavailable', String(p));
  const a = mk(w, 'A'); assert.equal(w.accounts.resolveFor('claude').account.id, a.id, 'a única');
  const b = mk(w, 'B'); let r = w.accounts.resolveFor('claude'); assert.deepEqual([r.status, r.code], [409, 'account_required']);
  assert.equal(w.accounts.resolveFor('claude', b.id).account.id, b.id);
  assert.deepEqual([w.accounts.resolveFor('claude', 'acc_deadbeef').status, w.accounts.resolveFor('claude', 'system').status], [404, 404]);
  assert.equal(w.accounts.resolveFor('claude', 5).status, 400);
  // desconectada SABIDA (status em cache): a pedida é recusada; sem pedido, sobra a outra
  markLoggedIn(path.join(w.accDir(b.id), 'claude')); await w.accounts.statusOf(a.id); await w.accounts.statusOf(b.id);
  r = w.accounts.resolveFor('claude', a.id); assert.deepEqual([r.status, r.code], [409, 'account_disconnected']);
  assert.equal(w.accounts.resolveFor('claude').account.id, b.id, 'só uma conectada: ela é a escolhida');
  fs.rmSync(path.join(w.accDir(b.id), 'claude', 'fake-login.json')); await w.accounts.freshStatus(b.id);
  r = w.accounts.resolveFor('claude'); assert.deepEqual([r.code], ['no_account']); assert.match(r.error, /desconectadas/);
});

test('resolveFor: conta de OUTRO provider é recusada (account_provider_mismatch)', () => {
  const st = { calls: [], loggedIn: true }; const w = world(fakeCodex(st)); const a = mk(w); const c = w.accounts.create({ provider: 'codex', home: 'machine' }).account;
  assert.equal(w.accounts.resolveFor('codex', a.id).code, 'account_provider_mismatch'); assert.equal(w.accounts.resolveFor('claude', c.id).code, 'account_provider_mismatch');
  assert.equal(w.accounts.resolveFor('codex').account.id, c.id);
});

test('última usada por provider: remember/lastUsed; conta de outro provider ou inexistente não grava; remover limpa; falha de gravação desfaz', async () => {
  const w = world(); const a = mk(w, 'A'), b = mk(w, 'B');
  assert.equal(w.accounts.lastUsed('claude'), null);
  assert.equal(w.accounts.remember('claude', a.id), true); assert.deepEqual(w.db.settings.lastAccountByProvider, { claude: a.id }); assert.equal(w.accounts.lastUsed('claude'), a.id);
  assert.equal(w.accounts.remember('codex', a.id), false); assert.equal(w.accounts.remember('claude', 'acc_deadbeef'), false);
  w.st.failPersist = true; assert.equal(w.accounts.remember('claude', b.id), false); assert.equal(w.accounts.lastUsed('claude'), a.id, 'rollback'); w.st.failPersist = false;
  await w.accounts.remove(a.id); assert.equal(w.accounts.lastUsed('claude'), null); assert.equal(Object.hasOwn(w.db.settings.lastAccountByProvider, 'claude'), false);
});

test('listView: campos do contrato v2 (sem system/isDefault/defaultId), providers do registro e status SÓ com os campos do contrato', async () => {
  const st = { calls: [], loggedIn: false }; const w = world(fakeCodex(st));
  const m = mkMachine(w); const a = mk(w, 'Trabalho'); markLoggedIn(path.join(w.accDir(a.id), 'claude')); const c = w.accounts.create({ provider: 'codex', home: 'machine' }).account;
  const v = await w.accounts.listView();
  assert.deepEqual(Object.keys(v).sort(), ['accounts', 'lastUsed', 'providers']);
  assert.deepEqual(v.lastUsed, { claude: null, codex: null }, 'nenhuma usada ainda');
  w.accounts.remember('claude', a.id); assert.deepEqual((await w.accounts.listView({ status: false })).lastUsed, { claude: a.id, codex: null }, 'a última usada de cada provider');
  assert.deepEqual(v.accounts.map((x) => [x.id, x.provider, x.providerLabel, x.home, x.canLogin]), [[m.id, 'claude', 'Claude Code', 'machine', true], [a.id, 'claude', 'Claude Code', 'forge', true], [c.id, 'codex', 'Codex CLI', 'machine', false]]);
  assert.deepEqual(Object.keys(v.accounts[1]).sort(), ['canLogin', 'createdAt', 'home', 'id', 'label', 'provider', 'providerLabel', 'status']);
  assert.deepEqual(v.providers.map((p) => [p.id, p.label, p.canLogin, p.isolated, p.available]), [['claude', 'Claude Code', true, true, true], ['codex', 'Codex CLI', false, true, true]]);
  assert.match(v.providers[1].note, /codex login/);
  assert.deepEqual(v.accounts[1].status, { checked: true, loggedIn: true, plan: 'pro', authMethod: 'claude.ai', email: 'pessoa@example.test', orgName: 'Org Teste', loginExpiresAt: '2030-01-01T00:00:00.000Z', error: null });
  assert.equal(JSON.stringify(v).includes('NAO-PODE-SAIR'), false); assert.equal(JSON.stringify(v).includes('configDirectory'), false); assert.equal(JSON.stringify(v).includes('subscriptionType'), false);
  assert.deepEqual([v.accounts[0].status.checked, v.accounts[0].status.loggedIn], [true, false], 'computador sem login (pasta do sistema falsa vazia)');
  assert.deepEqual([v.accounts[2].status.checked, v.accounts[2].status.loggedIn, v.accounts[2].status.plan], [true, false, null], 'Codex: `codex login status` saiu 1');
  // cada pasta é consultada com o CLAUDE_CONFIG_DIR dela; a do computador, sem sobrescrever
  assert.deepEqual(w.calls().filter((x) => x.cmd === 'status').map((x) => x.dir).sort(), [null, path.join(w.accDir(a.id), 'claude')].sort());
  const off = world(); assert.equal((await off.accounts.listView()).providers[1].available, false, 'sem a CLI do Codex');
  st.calls.length = 0; await w.accounts.listView({ status: false }); assert.equal(st.calls.length, 0, 'status:false não consulta CLI nenhuma');
});

test('status: cache de ~45 s por conta, chamadas simultâneas deduplicadas e invalidação', async () => {
  const w = world(); w.st.extraEnv.FAKE_STATUS_SLEEP = '300'; const a = mk(w); const m = mkMachine(w);
  const rs = await Promise.all([1, 2, 3, 4].map(() => w.accounts.statusOf(a.id))); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 1, 'uma consulta para 4 pedidos simultâneos'); assert.ok(rs.every((r) => r === rs[0]));
  await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 1, 'cache');
  await w.accounts.statusOf(m.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 2, 'outra conta, outra consulta');
  w.accounts.invalidate(a.id); await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 3);
  // invalidar DURANTE uma consulta: o resultado antigo não entra no cache
  w.accounts.invalidate(a.id); const slow = w.accounts.statusOf(a.id); w.accounts.invalidate(a.id); await slow; await w.accounts.statusOf(a.id); assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 5);
  assert.equal((await w.accounts.statusOf('acc_deadbeef')).error, 'Conta não encontrada.');
});

test('status: CLI ausente, saída que não é JSON e tempo esgotado => checked:false com erro curto (sem saída bruta)', async () => {
  let w = world({ unavailable: true }); w.db.accounts = [{ id: 'acc_0000aaaa', provider: 'claude', label: 'x', home: 'machine', createdAt: 'x' }];
  let s = await w.accounts.statusOf('acc_0000aaaa'); assert.deepEqual(s, { checked: false, loggedIn: null, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error: 'Claude Code não encontrado' });
  assert.equal((await w.accounts.listView()).providers[0].available, false);
  w = world({ command: path.join(tmp, 'nao-existe.exe'), prefixArgs: [] }); let a = mk(w); s = await w.accounts.statusOf(a.id); assert.equal(s.checked, false); assert.equal(s.error, 'Claude Code não encontrado');
  w = world(); w.st.extraEnv.FAKE_STATUS_GARBAGE = '1'; a = mk(w); s = await w.accounts.statusOf(a.id); assert.equal(s.checked, false); assert.ok(!/nao e json/.test(s.error));
  w = world({ statusTimeoutMs: 300 }); w.st.extraEnv.FAKE_STATUS_SLEEP = '5000'; a = mk(w); const t0 = Date.now(); s = await w.accounts.statusOf(a.id); assert.ok(Date.now() - t0 < 4000); assert.equal(s.checked, false); assert.match(s.error, /Tempo esgotado/);
});

test('remover: conta desconhecida (404, inclusive o antigo id virtual); conta em uso por terminal (409) não muda nada', async () => {
  const w = world(); const a = mk(w);
  for (const id of ['system', 'acc_deadbeef', '../etc']) assert.equal((await w.accounts.remove(id)).status, 404, id);
  w.st.inUse.add(a.id); const r = await w.accounts.remove(a.id); assert.deepEqual([r.status, r.code], [409, 'account_in_use']); assert.match(r.error, /terminal em execução/);
  assert.equal(w.db.accounts.length, 1); assert.equal(fs.existsSync(w.accDir(a.id)), true); assert.equal(w.calls().some((c) => c.cmd === 'logout'), false, 'nem logout');
});

test('remover: logout com a pasta da conta, DEPOIS apaga só <dados>/accounts/<id>; outras contas intactas', async () => {
  const w = world(); const a = mk(w, 'A'), b = mk(w, 'B'); markLoggedIn(path.join(w.accDir(a.id), 'claude'));
  const sibling = path.join(w.accDir(b.id), 'claude', 'marca.txt'); fs.writeFileSync(sibling, 'fica');
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.ok, r.unlinked, r.folderRemoved], [true, false, true]);
  const lo = w.calls().filter((c) => c.cmd === 'logout'); assert.equal(lo.length, 1); assert.equal(lo[0].dir, path.join(w.accDir(a.id), 'claude'));
  assert.equal(fs.existsSync(w.accDir(a.id)), false); assert.equal(fs.readFileSync(sibling, 'utf8'), 'fica'); assert.deepEqual(w.db.accounts.map((x) => x.id), [b.id]);
  assert.equal(fs.existsSync(path.join(w.dataDir, 'accounts')), true, 'a pasta accounts/ continua');
});

test('remover: falha ao gravar o banco => rollback (conta, última usada e pasta continuam)', async () => {
  const w = world(); const a = mk(w); w.accounts.remember('claude', a.id); w.st.failPersist = true;
  const r = await w.accounts.remove(a.id); assert.equal(r.status, 500); assert.deepEqual(w.db.accounts.map((x) => x.id), [a.id]); assert.equal(w.accounts.lastUsed('claude'), a.id); assert.equal(fs.existsSync(path.join(w.accDir(a.id), 'claude')), true);
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

test('db.accounts: linha de provider sem bloco `account` não aparece (e não quebra nada); linha antiga sem `home` vale forge', () => {
  const w = world(); w.db.accounts = [{ id: 'acc_00000002', provider: 'kimi', label: 'futuro', home: 'machine', createdAt: 'x' }, { id: 'acc_00000003', provider: 'claude', label: 'antiga', createdAt: 'x' }];
  assert.deepEqual(w.accounts.list().map((a) => [a.id, a.home]), [['acc_00000003', 'forge']]); assert.equal(w.accounts.exists('acc_00000002'), false);
  assert.equal(w.accounts.configDirOf('acc_00000003'), path.join(w.accDir('acc_00000003'), 'claude'), 'pasta de sempre: <dados>/accounts/<id>/claude');
});

// ---- rotas ----
async function serve(w, { token = null, logins = null } = {}) {
  const lm = logins ?? createLoginManager({ accounts: w.accounts, env: w.env }); w.logins.active = lm;
  const app = express(); if (token) app.use('/api', createTokenGuard(token)); app.use(express.json());
  A.setupAccounts(app, { accounts: w.accounts, logins: lm });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* sem corpo */ } return { status: r.status, body: j }; };
  return { call, close: () => server.close() };
}

test('rotas: contrato de GET/POST/PATCH/DELETE; a rota de conta padrão não existe mais', async () => {
  const w = world(); const s = await serve(w);
  try {
    let r = await s.call('GET', '/api/accounts'); assert.equal(r.status, 200); assert.deepEqual(r.body.accounts, []); assert.equal('defaultId' in r.body, false); assert.equal(r.body.providers.length, 2);
    r = await s.call('POST', '/api/accounts', { provider: 'codex', label: 'x' }); assert.deepEqual([r.status, r.body.code], [400, 'provider_unavailable']); assert.equal(typeof r.body.error, 'string');
    r = await s.call('POST', '/api/accounts', { provider: 'claude', label: '' }); assert.equal(r.status, 400);
    r = await s.call('POST', '/api/accounts', 'texto-puro'); assert.equal(r.status, 400);
    r = await s.call('POST', '/api/accounts', { provider: 'claude', home: 'machine' }); assert.deepEqual([r.status, r.body.home, r.body.label], [201, 'machine', 'Claude Code']); const mid = r.body.id;
    r = await s.call('POST', '/api/accounts', { provider: 'claude', label: 'Pessoal' }); assert.equal(r.status, 201); const id = r.body.id; assert.match(id, /^acc_[0-9a-f]{8}$/); assert.deepEqual([r.body.label, r.body.home], ['Pessoal', 'forge']);
    r = await s.call('PATCH', `/api/accounts/${id}`, { label: 'Trabalho' }); assert.deepEqual([r.status, r.body.label], [200, 'Trabalho']);
    r = await s.call('PATCH', `/api/accounts/${id}`, { label: '' }); assert.equal(r.status, 400);
    r = await s.call('PATCH', '/api/accounts/acc_deadbeef', { label: 'x' }); assert.equal(r.status, 404);
    r = await s.call('PATCH', '/api/accounts/..%2F..%2Fx', { label: 'x' }); assert.equal(r.status, 404);
    r = await s.call('POST', `/api/accounts/${id}/default`, {}); assert.equal(r.status, 404, 'rota antiga removida');
    r = await s.call('DELETE', '/api/accounts/system'); assert.equal(r.status, 404);
    r = await s.call('DELETE', `/api/accounts/${id}`); assert.deepEqual([r.status, r.body.ok, r.body.unlinked, r.body.folderRemoved], [200, true, false, true]);
    r = await s.call('DELETE', `/api/accounts/${mid}`); assert.deepEqual([r.status, r.body.unlinked, r.body.folderRemoved], [200, true, false]);
    r = await s.call('GET', '/api/accounts'); assert.equal(r.body.accounts.length, 0);
    r = await s.call('DELETE', `/api/accounts/${id}`); assert.equal(r.status, 404);
    r = await s.call('GET', '/api/accounts/xyz/login'); assert.equal(r.status, 404);
    r = await s.call('GET', '/api/accounts/system/login'); assert.equal(r.status, 404);
  } finally { s.close(); }
});

test('token de sessão: com token configurado, TODAS as rotas /api/accounts* (GET inclusive) exigem o header; sem token configurado nada muda', async () => {
  const TOKEN = 'T0ken_'.repeat(8); const w = world(); const s = await serve(w, { token: TOKEN });
  try {
    const H = { [TOKEN_HEADER]: TOKEN }, id = 'acc_00000000';
    for (const [m, p] of [['GET', '/api/accounts'], ['GET', '/api/accounts/'], ['GET', `/api/accounts/${id}/login`], ['POST', '/api/accounts'], ['PATCH', `/api/accounts/${id}`], ['DELETE', `/api/accounts/${id}`], ['POST', `/api/accounts/${id}/login`], ['POST', `/api/accounts/${id}/login/input`], ['POST', `/api/accounts/${id}/login/cancel`]]) {
      assert.equal((await s.call(m, p, m === 'GET' ? undefined : {})).status, 403, `${m} ${p} sem token`);
      assert.equal((await s.call(m, p, m === 'GET' ? undefined : {}, { [TOKEN_HEADER]: 'errado' })).status, 403, `${m} ${p} token errado`);
    }
    assert.equal((await s.call('GET', '/api/accounts', undefined, H)).status, 200);
    assert.equal((await s.call('POST', '/api/accounts', { provider: 'claude', label: 'ok' }, H)).status, 201);
  } finally { s.close(); }
});

test('prereqs.login: ALGUMA conta conectada de algum provider (agnóstico); variável de ambiente vale só na conta do computador do Claude; detail nunca traz e-mail nem rótulo', async () => {
  const noEnv = {};
  let w = world(); let l = await probeLogin({ env: noEnv, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, false], 'sem conta nenhuma'); assert.equal(l.detail, NO_ACCOUNT_DETAIL);
  const m = mkMachine(w); const a = mk(w, 'Conta Secreta');
  l = await probeLogin({ env: noEnv, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, false], 'contas sem login'); assert.match(l.detail, /Contas/);
  markLoggedIn(path.join(w.accDir(a.id), 'claude')); w.accounts.invalidate(a.id);
  l = await probeLogin({ env: noEnv, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn, l.detail], [true, true, 'Conta conectada: Claude Code.'], 'basta UMA conta (a isolada) conectada');
  assert.ok(!/@|example|Secreta|Org/.test(l.detail), 'sem e-mail, organização nem rótulo');
  // chave de API no ambiente: vale para a conta do COMPUTADOR do Claude (sem consultar a CLI dela); nunca para a isolada
  w = world(); const m2 = mkMachine(w); const before = w.calls().length;
  l = await probeLogin({ env: { ANTHROPIC_API_KEY: 'k' }, accounts: w.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, true]); assert.match(l.detail, /variável de ambiente/); assert.equal(w.calls().length, before, 'nem consulta a CLI');
  const wi = world(); mk(wi); l = await probeLogin({ env: { ANTHROPIC_API_KEY: 'k' }, accounts: wi.accounts }); assert.deepEqual([l.known, l.loggedIn], [true, false], 'conta isolada: a chave do ambiente não vale (é removida do filho)');
  // Codex conectado sozinho já basta (FORGE agnóstico)
  const st = { calls: [], loggedIn: true }; const wc = world(fakeCodex(st)); wc.accounts.create({ provider: 'codex', home: 'machine' }); mk(wc);
  l = await probeLogin({ env: noEnv, accounts: wc.accounts }); assert.deepEqual([l.known, l.loggedIn, l.detail], [true, true, 'Conta conectada: Codex CLI.']);
  // inconclusivo (CLI ausente ou saída ilegível) e ninguém conectado => desconhecido
  const wm = world({ unavailable: true }); wm.db.accounts = [{ id: 'acc_0000aaaa', provider: 'claude', label: 'x', home: 'machine', createdAt: 'x' }];
  l = await probeLogin({ env: noEnv, accounts: wm.accounts }); assert.deepEqual([l.known, l.loggedIn], [false, null]); assert.equal(l.detail, 'Claude Code não encontrado');
  const wg = world(); mk(wg); wg.st.extraEnv.FAKE_STATUS_GARBAGE = '1'; l = await probeLogin({ env: noEnv, accounts: wg.accounts }); assert.deepEqual([l.known, l.loggedIn], [false, null]);
  assert.deepEqual(await probeLogin({ accounts: null }), { known: false, loggedIn: null, detail: 'Não foi possível consultar o login das contas.' });
  assert.deepEqual(prereqsOf({ available: true, version: '1' }, { available: true, version: '2', detail: 'ok' }, l).login, { known: false, loggedIn: null, detail: l.detail }, 'formato de prereqs preservado');
  void m; void m2;
});

test('prereqs.login: responde ASSIM QUE uma conta aparece conectada (a lenta não vira "desconhecido"); uma "não conectada" definitiva não é mascarada por conta sem resposta', async () => {
  const rows = [{ id: 'acc_00000001', provider: 'claude', home: 'machine' }, { id: 'acc_00000002', provider: 'codex', home: 'machine' }];
  const fake = (byId) => ({ list: () => rows, statusOf: (id) => byId[id]() });
  const slow = () => new Promise((r) => setTimeout(() => r({ checked: true, loggedIn: false }), 3000));
  let t0 = Date.now(); let l = await probeLogin({ env: {}, accounts: fake({ acc_00000001: slow, acc_00000002: async () => ({ checked: true, loggedIn: true }) }) });
  assert.deepEqual([l.known, l.loggedIn, l.detail], [true, true, 'Conta conectada: Codex CLI.']); assert.ok(Date.now() - t0 < 1000, `esperou a conta lenta (${Date.now() - t0} ms)`);
  l = await probeLogin({ env: {}, accounts: fake({ acc_00000001: async () => ({ checked: true, loggedIn: false }), acc_00000002: async () => ({ checked: false, loggedIn: null, error: 'Codex CLI não encontrado' }) }) });
  assert.deepEqual([l.known, l.loggedIn, l.detail], [true, false, NO_ACCOUNT_DETAIL], 'a CLI ausente de uma conta não esconde que a outra precisa de login');
  l = await probeLogin({ env: {}, accounts: fake({ acc_00000001: async () => { throw new Error('x'); }, acc_00000002: async () => ({ checked: false, loggedIn: null, error: 'Codex CLI não encontrado' }) }) });
  assert.deepEqual([l.known, l.loggedIn, l.detail], [false, null, 'Codex CLI não encontrado'], 'todas sem resposta: desconhecido');
});

test('rota: ?status=0 não executa a CLI; ?fresh=1 invalida o cache de todas as contas', async () => {
  const w = world(); const a = mk(w); mkMachine(w); const s = await serve(w);
  try {
    const nStatus = () => w.calls().filter((c) => c.cmd === 'status').length;
    let r = await s.call('GET', '/api/accounts?status=0'); assert.equal(r.status, 200); assert.equal(nStatus(), 0, 'nenhuma chamada à CLI');
    const empty = { checked: false, loggedIn: null, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error: null };
    assert.deepEqual(r.body.accounts.map((x) => x.status), [empty, empty]); assert.equal(r.body.accounts[0].id, a.id);
    r = await s.call('GET', '/api/accounts'); assert.equal(nStatus(), 2); assert.equal(r.body.accounts[0].status.checked, true);
    await s.call('GET', '/api/accounts'); assert.equal(nStatus(), 2, 'cache');
    await s.call('GET', '/api/accounts?fresh=1'); assert.equal(nStatus(), 4, 'fresh=1 consulta de novo todas as contas');
  } finally { s.close(); }
});

test('envForAccount: conta do FORGE perde também Bedrock/Vertex/BASE_URL/CUSTOM_HEADERS (sem diferenciar maiúsculas); a conta Sistema herda tudo', async () => {
  const { envForAccount } = await import('../claude-cli.js');
  const base = { ANTHROPIC_API_KEY: 'a', Anthropic_Auth_Token: 'b', CLAUDE_CODE_OAUTH_TOKEN: 'c', CLAUDE_CODE_USE_BEDROCK: '1', claude_code_use_vertex: '1', ANTHROPIC_BASE_URL: 'https://x', anthropic_custom_headers: 'h: v', PATH: 'p', OUTRA: 'ok' };
  const e = envForAccount(base, '/pasta/conta'); assert.deepEqual(Object.keys(e).sort(), ['CLAUDE_CONFIG_DIR', 'OUTRA', 'PATH']); assert.equal(e.CLAUDE_CONFIG_DIR, '/pasta/conta');
  assert.deepEqual(envForAccount(base, null), base, 'Sistema: ambiente como está'); assert.equal(base.ANTHROPIC_API_KEY, 'a', 'o original não é alterado');
});

test('"Verificar novamente": reset das sondas do Git e do Claude força nova consulta (sem reset, o cache vale)', async () => {
  const { createGitProbe } = await import('../prereqs.js'); const { createClaudeProbe } = await import('../claude-probe.js');
  const counter = path.join(tmp, 'sondas.txt'); fs.writeFileSync(counter, '');
  const script = path.join(tmp, 'sonda.mjs'); fs.writeFileSync(script, "import fs from 'node:fs'; fs.appendFileSync(process.env.SONDA_LOG, 'x'); console.log('git version 1.0');");
  const old = process.env.SONDA_LOG; process.env.SONDA_LOG = counter;
  try {
    const n = () => fs.readFileSync(counter, 'utf8').length;
    const git = createGitProbe({ command: process.execPath, prefixArgs: [script] }); await git(); await git(); assert.equal(n(), 1); git.reset(); await git(); assert.equal(n(), 2);
    const claude = createClaudeProbe({ command: process.execPath, prefixArgs: [script] }); await claude(); await claude(); assert.equal(n(), 3); claude.reset(); await claude(); assert.equal(n(), 4);
  } finally { if (old === undefined) delete process.env.SONDA_LOG; else process.env.SONDA_LOG = old; }
});
