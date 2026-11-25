// Terminais no modelo v2 de contas (etapa 4 do plano Contas v2): conta escolhida por provider (accounts.resolveFor), tabela de erros, pré-seleção (remember),
// Codex com conta, registro antigo traduzido para a conta do computador DO PROVIDER, conversas com `db`. PTY simulado, CLI falsa, ORCH_DATA_DIR temporário. Nunca CLI real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-t4-acc-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
const { uid } = await import('../store.js');
const A = await import('../accounts.js');
const T = await import('../terminals.js');
const { createConversationStore } = await import('../conversations.js');
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const wsDir = path.join(tmp, 'ws'); fs.mkdirSync(wsDir);
const UUID = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const withEnv = async (vars, fn) => { const old = {}; for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
// conta do computador do Codex SEM CODEX_HOME: a pasta padrão sai da pasta pessoal, que aponta para um temporário (o models_cache.json lido ao abrir o pane nunca é o do ~/.codex real)
const FAKE_HOME = { HOME: path.join(tmp, 'home'), USERPROFILE: path.join(tmp, 'home') };

let n = 0, rowSeq = 0x200;
/** Mundo de teste: contas reais (accounts.js) com as linhas inseridas direto no banco (com `unavailable: true` o create({ home: 'machine' }) exigiria a CLI). */
function world({ over = {}, accountsOpts = {}, spawn = null } = {}) {
  const k = ++n, dataDir = path.join(tmp, `data${k}`); fs.mkdirSync(dataDir, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws' }, workspaces: [{ id: 'ws', name: 'ws', path: wsDir }] };
  const spawned = [], trusted = [], statusIds = []; let pid = 1_900_000_000, seq = 0, mgr = null, saves = 0;
  const lib = { spawn(file, args, opts) { if (spawn) spawn(file, args, opts); const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const accounts = A.createAccounts({ db, dataDir, persist: () => { saves++; }, uid, unavailable: true, isInUse: (id) => mgr?.usesAccount(id) === true, ...accountsOpts });
  mgr = T.createTerminalManager({ db, accounts, ptyLib: lib, inspectConfig: async () => [], persist: () => { saves++; }, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => UUID(++seq), transcriptExists: () => true, trustFolders: (i) => trusted.push(i), statusLine: { settingsFileFor: (id) => { statusIds.push(id); return null; } }, ...over });
  const row = (provider, home, label = `${provider}-${home}`) => { const r = { id: `acc_${String(++rowSeq).padStart(8, '0')}`, provider, label, home, createdAt: '2026-01-01T00:00:00.000Z' }; (db.accounts ??= []).push(r); return r; };
  const mkForge = (label = 'Isolada') => { const r = accounts.create({ provider: 'claude', label }); assert.equal(r.ok, true); return r.account; };
  return { k, db, accounts, mgr, spawned, trusted, statusIds, row, mkForge, saves: () => saves, dir: (id) => accounts.configDirOf(id) };
}
/** Fotografia do que um pedido recusado NÃO pode mexer. */
const snap = (w) => JSON.stringify({ t: w.db.terminalSessions ?? null, s: w.db.settings, n: w.spawned.length });

test('tabela de códigos do create (Claude): cada recusa traz status e code do accounts.resolveFor, sem abrir processo e sem gravar nada', async () => {
  const w = world(); const m = w.row('claude', 'machine'); const f = w.mkForge(); const cx = w.row('codex', 'machine');
  const mgr = w.mgr; const before = snap(w); const saves0 = w.saves();
  const cases = [
    [7, 400, 'account_not_found'], [{}, 400, 'account_not_found'], [['acc_x'], 400, 'account_not_found'], [true, 400, 'account_not_found'],
    ['', 404, 'account_not_found'], ['system', 404, 'account_not_found'], ['../x', 404, 'account_not_found'], ['acc_deadbeef', 404, 'account_not_found'], [m.id.toUpperCase(), 404, 'account_not_found'],
    [cx.id, 400, 'account_provider_mismatch'],
  ];
  for (const [bad, st, code] of cases) {
    const r = await mgr.create({ role: 'builder', accountId: bad });
    assert.deepEqual([r.ok, r.status, r.code], [false, st, code], JSON.stringify(bad)); assert.equal(typeof r.error, 'string');
  }
  const r2 = await mgr.create({ role: 'builder' }); assert.deepEqual([r2.ok, r2.status, r2.code], [false, 409, 'account_required'], 'várias contas e nenhuma pedida');
  assert.equal(snap(w), before, 'nada aberto, nada gravado'); assert.equal(w.saves(), saves0, 'nenhuma gravação'); assert.equal(w.trusted.length, 0); assert.equal(w.statusIds.length, 0);
  assert.ok(m && f);
});

test('create: sem nenhuma conta do provider => 409 no_account (Claude e Codex); só contas do OUTRO provider também', async () => {
  const w = world();
  for (const provider of ['claude', 'codex']) { const r = await w.mgr.create({ role: 'builder', provider }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'no_account'], provider); }
  w.row('claude', 'machine');
  const c = await w.mgr.create({ role: 'builder', provider: 'codex' }); assert.deepEqual([c.status, c.code], [409, 'no_account'], 'conta do Claude não serve ao Codex');
  assert.equal(w.spawned.length, 0); assert.equal(w.db.terminalSessions, undefined); assert.equal(w.db.settings.lastAccountByProvider, undefined);
});

test('create: conta em REMOÇÃO => 409 account_missing; conta que some entre a resolução e o spawn => 409 account_missing; nenhum processo', async () => {
  const w = world(); const f = w.mkForge(); const other = w.mkForge('Outra');
  const removing = w.accounts.remove(f.id); // a pasta isolada existe: o remove suspende no logout, com a conta já marcada "em remoção"
  const r = await w.mgr.create({ role: 'builder', accountId: f.id }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_missing']);
  assert.equal((await removing).ok, true); assert.equal(w.spawned.length, 0);
  // corrida: a conta some durante a inspeção assíncrona do projeto (depois do resolveFor)
  const w2 = world({ over: { inspectConfig: async () => { w2.db.accounts = []; return []; } } }); const g = w2.mkForge();
  const x = await w2.mgr.create({ role: 'builder', accountId: g.id }); assert.deepEqual([x.ok, x.status, x.code], [false, 409, 'account_missing']);
  assert.equal(w2.spawned.length, 0); assert.equal(w2.db.settings.lastAccountByProvider, undefined, 'não lembra uma conta que não abriu'); assert.ok(other);
});

test('create: conta ISOLADA sabidamente desconectada (status em cache com loggedIn:false) pedida => 409 account_disconnected; a do computador nunca é bloqueada pelo cache; isoladas todas desconectadas => no_account', async () => {
  const run = (file, args, opts, cb) => { setImmediate(() => cb(Object.assign(new Error('não logado'), { code: 1 }), JSON.stringify({ loggedIn: false }))); return { pid: undefined }; };
  const w = world({ accountsOpts: { unavailable: false, command: '/fake/claude', run, statusTtlMs: 60_000 } });
  const m = w.row('claude', 'machine'); const f = w.mkForge();
  // ainda sem consulta: o cache está vazio, a conta vale como utilizável (só leitura de cache)
  assert.equal(w.accounts.knownDisconnected(f.id), false);
  const st = await w.accounts.statusOf(f.id); assert.equal(st.loggedIn, false); assert.equal(w.accounts.knownDisconnected(f.id), true);
  const before = snap(w);
  const r = await w.mgr.create({ role: 'builder', accountId: f.id }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_disconnected']); assert.match(r.error, /desconectada/i);
  assert.equal(snap(w), before, 'nada aberto nem gravado');
  // sem pedido: a desconectada não conta; sobra só a machine (cujo status não foi consultado) => é escolhida sozinha
  const ok = await w.mgr.create({ role: 'builder' }); assert.equal(ok.ok, true, ok.error); assert.equal(ok.session.accountId, m.id);
  // a conta do computador pode autenticar por variável de ambiente (chave de API, Bedrock, Vertex): mesmo com `loggedIn:false` em cache, nunca é bloqueada
  await w.accounts.statusOf(m.id); assert.equal(w.accounts.knownDisconnected(m.id), false);
  const mOk = await w.mgr.create({ role: 'builder', accountId: m.id }); assert.equal(mOk.ok, true, mOk.error); assert.equal(mOk.session.accountId, m.id);
  // só isoladas, todas sabidamente desconectadas => no_account (sem abrir nada)
  const w2 = world({ accountsOpts: { unavailable: false, command: '/fake/claude', run, statusTtlMs: 60_000 } });
  const f1 = w2.mkForge('A'), f2 = w2.mkForge('B'); await w2.accounts.statusOf(f1.id); await w2.accounts.statusOf(f2.id);
  const before2 = snap(w2); const none = await w2.mgr.create({ role: 'builder' }); assert.deepEqual([none.status, none.code], [409, 'no_account']); assert.match(none.error, /desconectadas/);
  assert.equal(snap(w2), before2, 'nada aberto nem gravado');
});

test('create: falha ao preparar o ambiente da conta => 500 account_env, sem processo, sem registro e sem lembrar a conta', async () => {
  const w = world(); const f = w.mkForge();
  const boom = { ...w.accounts, configDirOf: () => { throw new Error('disco'); } };
  const mgr = T.createTerminalManager({ db: w.db, accounts: boom, ptyLib: { spawn() { throw new Error('não deveria abrir'); } }, persist: () => {}, inspectConfig: async () => [], resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true });
  const r = await mgr.create({ role: 'builder', accountId: f.id }); assert.deepEqual([r.ok, r.status, r.code], [false, 500, 'account_env']);
  assert.equal(w.db.terminalSessions, undefined); assert.equal(w.db.settings.lastAccountByProvider, undefined);
});

test('remember: depois de abrir grava lastAccountByProvider[provider]; falha ANTES do spawn (ou o spawn lançar) não grava', async () => {
  const w = world(); const a = w.mkForge('A'); const b = w.mkForge('B');
  const bad = await w.mgr.create({ role: 'builder', accountId: 'acc_deadbeef' }); assert.equal(bad.ok, false); assert.equal(w.db.settings.lastAccountByProvider, undefined);
  let r = await w.mgr.create({ role: 'builder', accountId: a.id }); assert.equal(r.ok, true, r.error); assert.deepEqual(w.db.settings.lastAccountByProvider, { claude: a.id });
  r = await w.mgr.create({ role: 'builder', accountId: b.id }); assert.equal(r.ok, true, r.error); assert.equal(w.db.settings.lastAccountByProvider.claude, b.id);
  assert.equal(w.accounts.lastUsed('claude'), b.id);
  // o Codex tem a própria entrada, sem mexer na do Claude
  const cx = w.row('codex', 'machine'); r = await w.mgr.create({ role: 'builder', provider: 'codex' }); assert.equal(r.ok, true, r.error);
  assert.deepEqual(w.db.settings.lastAccountByProvider, { claude: b.id, codex: cx.id });
  // spawn que lança: nada lembrado
  const w2 = world({ spawn: () => { throw new Error('sem pty'); } }); const c = w2.mkForge();
  const x = await w2.mgr.create({ role: 'builder', accountId: c.id }); assert.deepEqual([x.ok, x.status], [false, 500]); assert.equal(w2.db.settings.lastAccountByProvider, undefined); assert.equal(w2.db.terminalSessions, undefined);
});

test('Codex exige conta do Codex: conta do Claude no pane Codex => account_provider_mismatch; conta do Codex no pane Claude também; sessão e histórico levam o id real', async () => {
  const w = world(); const cl = w.row('claude', 'machine'); const cx = w.row('codex', 'machine');
  let r = await w.mgr.create({ role: 'builder', provider: 'codex', accountId: cl.id }); assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'account_provider_mismatch']);
  r = await w.mgr.create({ role: 'builder', provider: 'claude', accountId: cx.id }); assert.deepEqual([r.status, r.code], [400, 'account_provider_mismatch']);
  assert.equal(w.spawned.length, 0);
  r = await w.mgr.create({ role: 'builder', provider: 'codex' }); assert.equal(r.ok, true, r.error); assert.equal(r.session.accountId, cx.id, 'única conta do Codex é escolhida');
  assert.equal(w.mgr.list()[0].accountId, cx.id); assert.equal(w.mgr.history()[0].accountId, cx.id); assert.equal(w.db.terminalSessions[0].accountId, cx.id);
  assert.equal(w.mgr.recordInfo(w.db.terminalSessions[0].id).accountId, cx.id); assert.equal(w.mgr.usesAccount(cx.id), true); assert.equal(w.mgr.usesAccount(cl.id), false);
});

test('Codex: conta do computador não ganha CODEX_HOME; conta isolada recebe CODEX_HOME da pasta dela e perde OPENAI_API_KEY/CODEX_API_KEY/OPENAI_BASE_URL', async () => {
  await withEnv({ CODEX_HOME: undefined, ...FAKE_HOME, OPENAI_API_KEY: 'k-openai', CODEX_API_KEY: 'k-codex', OPENAI_BASE_URL: 'https://x.invalid' }, async () => {
    const w = world(); const m = w.row('codex', 'machine'); const iso = w.row('codex', 'forge', 'Isolada');
    let r = await w.mgr.create({ role: 'builder', provider: 'codex', accountId: m.id }); assert.equal(r.ok, true, r.error);
    let e = w.spawned[0].opts.env; assert.equal(e.CODEX_HOME, undefined, 'conta do computador: sem CODEX_HOME'); assert.equal(e.OPENAI_API_KEY, 'k-openai', 'a conta do computador mantém o ambiente de sempre');
    assert.equal(w.trusted[0].configDir, null); assert.equal(w.trusted[0].provider, 'codex');
    r = await w.mgr.create({ role: 'builder', provider: 'codex', accountId: iso.id }); assert.equal(r.ok, true, r.error); e = w.spawned[1].opts.env;
    assert.equal(e.CODEX_HOME, w.dir(iso.id)); assert.equal(path.basename(e.CODEX_HOME), 'codex'); assert.ok(e.CODEX_HOME.includes(iso.id));
    for (const k of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']) assert.equal(e[k], undefined, k);
    assert.equal(w.trusted[1].configDir, w.dir(iso.id)); assert.equal(r.session.accountId, iso.id);
    assert.equal(process.env.OPENAI_API_KEY, 'k-openai', 'process.env não foi alterado'); assert.equal(process.env.CODEX_HOME, undefined);
  });
});

test('Claude: o id real vai à status line e a confiança de pasta leva a pasta da conta (isolada) ou null (computador)', async () => {
  const w = world(); const m = w.row('claude', 'machine'); const f = w.mkForge();
  await w.mgr.create({ role: 'builder', accountId: m.id }); await w.mgr.create({ role: 'builder', accountId: f.id });
  assert.deepEqual(w.statusIds, [m.id, f.id]); assert.deepEqual(w.trusted.map((t) => t.configDir), [null, w.dir(f.id)]); assert.deepEqual(w.trusted.map((t) => t.provider), ['claude', 'claude']);
});

test('sem módulo de contas: accountId é ignorado, sessão e registro com accountId null, ambiente do processo', async () => {
  const spawned = []; const lib = { spawn(f, a, o) { const p = { pid: 1_950_000_000 + spawned.length, opts: o, onData() {}, onExit() {}, write() {}, resize() {} }; spawned.push(p); return p; } };
  const db = { settings: { activeWorkspaceId: 'ws' }, workspaces: [{ id: 'ws', name: 'ws', path: wsDir }] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, inspectConfig: async () => [], persist: () => {}, resolveCommand: () => ({ file: '/x', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, newSessionId: () => UUID(1) });
  const r = await mgr.create({ role: 'builder', accountId: 'acc_99999999' }); assert.equal(r.ok, true, r.error); assert.equal(r.session.accountId, null); assert.equal(db.terminalSessions[0].accountId, null);
  assert.equal(mgr.list()[0].accountId, null); assert.equal(mgr.history()[0].accountId, null); assert.equal(db.settings.lastAccountByProvider, undefined);
});

test('registro antigo do CODEX (\'system\' ou sem campo) é reaberto na conta do computador do CODEX, nunca na do Claude; sem ela => account_missing', async () => {
  await withEnv({ CODEX_HOME: undefined, ...FAKE_HOME }, async () => {
    const w = world(); const cl = w.row('claude', 'machine'); const cx = w.row('codex', 'machine');
    const base = { provider: 'codex', role: 'builder', workspaceId: 'ws', cwd: wsDir, state: 'interrupted', interruptedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' };
    w.db.terminalSessions = [{ ...base, id: 'ses_aaaaaaaa', accountId: 'system', claudeSessionId: UUID(91) }, { ...base, id: 'ses_bbbbbbbb', claudeSessionId: UUID(92) }];
    for (const h of w.mgr.history()) assert.equal(h.accountId, cx.id, `${h.id}: a do Codex, nunca ${cl.id}`);
    assert.equal(w.mgr.recordInfo('ses_aaaaaaaa').accountId, cx.id);
    let r = await w.mgr.resume({ recordId: 'ses_aaaaaaaa', reopen: true }); assert.equal(r.ok, true, r.error); assert.equal(r.session.accountId, cx.id); assert.equal(w.spawned[0].file, '/fake/codex');
    assert.equal(w.spawned[0].opts.env.CODEX_HOME, undefined, 'conta do computador do Codex');
    r = await w.mgr.resume({ recordId: 'ses_bbbbbbbb', reopen: true }); assert.equal(r.ok, true, r.error); assert.equal(r.session.accountId, cx.id);
    // sem a conta do Codex: a do Claude NÃO serve
    const w2 = world(); w2.row('claude', 'machine');
    w2.db.terminalSessions = [{ ...base, id: 'ses_cccccccc', accountId: 'system', claudeSessionId: UUID(93) }];
    const h = w2.mgr.history()[0]; assert.deepEqual([h.accountId, h.reopenable], [null, false], 'sem a conta do Codex nem reabrir');
    const x = await w2.mgr.resume({ recordId: 'ses_cccccccc', reopen: true }); assert.deepEqual([x.ok, x.status, x.code], [false, 409, 'account_missing']); assert.equal(w2.spawned.length, 0);
  });
});

test('registro com conta ausente, removida ou de OUTRO provider => 409 account_missing (retomar, bifurcar e reabrir), sem abrir processo', async () => {
  const w = world(); const cl = w.row('claude', 'machine'); const cx = w.row('codex', 'machine'); const f = w.mkForge();
  const c = await w.mgr.create({ role: 'builder', accountId: f.id }); assert.equal(c.ok, true, c.error); w.spawned[0].exit(0); const rec = w.db.terminalSessions[0]; const n0 = w.spawned.length;
  rec.state = 'interrupted'; rec.interruptedAt = rec.endedAt ?? '2026-01-01T00:00:00.000Z'; // reabrir só vale para sessão interrompida
  rec.accountId = cx.id; // conta de outro provider
  for (const opts of [{}, { fork: true }, { reopen: true }]) { const r = await w.mgr.resume({ recordId: rec.id, ...opts }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_missing'], JSON.stringify(opts)); }
  rec.accountId = 'acc_deadbeef'; assert.equal((await w.mgr.resume({ recordId: rec.id })).code, 'account_missing'); // nunca existiu
  rec.accountId = 7; assert.equal((await w.mgr.resume({ recordId: rec.id })).code, 'account_missing'); // lixo no registro
  assert.equal(w.spawned.length, n0); assert.ok(cl);
  rec.accountId = f.id; const ok = await w.mgr.resume({ recordId: rec.id }); assert.equal(ok.ok, true, ok.error); assert.equal(ok.session.accountId, f.id);
});

test('conversations: com `db`, registro legado (sem campo ou "system") lê a pasta da conta do computador; registro de conta isolada lê a pasta dela; conta de outro id não enxerga', () => {
  const w = world(); const m = w.row('claude', 'machine'); const f = w.mkForge('Isolada');
  const machineHome = path.join(tmp, `machine-home${w.k}`), sys = path.join(tmp, `sys${w.k}`); 
  const put = (dir, id, text) => { const d = path.join(dir, 'projects', 'p'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${id}.jsonl`), `${JSON.stringify({ type: 'user', message: { content: text }, timestamp: '2026-01-01T00:00:00Z' })}\n`); };
  put(w.dir(f.id), UUID(1), 'da isolada'); put(machineHome, UUID(2), 'do computador'); put(sys, UUID(3), 'da pasta padrão');
  // a pasta da conta do computador é DISTINTA da padrão do store para provar de onde vem a leitura (em produção o configDirOf dela é null = a padrão)
  const configDirOf = (id) => (id === m.id ? machineHome : w.dir(id));
  const mk = (withDb) => createConversationStore({ dir: path.join(tmp, `hist${w.k}-${withDb}`), configDir: sys, configDirOf, ...(withDb ? { db: w.db } : {}) });
  const rec = (id, c, accountId) => ({ id, workspaceId: 'ws', claudeSessionId: c, title: 't', role: 'builder', ...(accountId === undefined ? {} : { accountId }) });
  const s = mk(true), read = (id) => s.read('ws', id).messages[0].t;
  assert.equal(s.sync(rec('ses_00000001', UUID(1), f.id)).ok, true); assert.equal(read('ses_00000001'), 'da isolada');
  assert.equal(s.sync(rec('ses_00000002', UUID(2), 'system')).ok, true); assert.equal(read('ses_00000002'), 'do computador', '"system" resolve para a conta do computador');
  assert.equal(s.sync(rec('ses_00000003', UUID(2), undefined)).ok, true); assert.equal(read('ses_00000003'), 'do computador', 'sem o campo também');
  assert.equal(s.sync(rec('ses_00000004', UUID(1), m.id)).reason, 'sem_transcricao', 'a conta do computador não enxerga o transcript da isolada');
  assert.equal(s.sync(rec('ses_00000005', UUID(2), f.id)).reason, 'sem_transcricao', 'a isolada não enxerga o do computador');
  assert.equal(s.sync(rec('ses_00000006', UUID(3), 'system')).reason, 'sem_transcricao', 'a pasta padrão não é lida quando a conta do computador existe');
  assert.equal(s.sync(rec('ses_00000007', UUID(1), 'acc_deadbeef')).reason, 'sem_transcricao', 'id desconhecido: pasta inexistente da conta, nunca a global');
  // sem `db` o registro legado cai na pasta padrão do processo (em produção é a mesma da conta do computador)
  const plain = mk(false); assert.equal(plain.sync(rec('ses_00000008', UUID(3), 'system')).ok, true); assert.equal(plain.read('ws', 'ses_00000008').messages[0].t, 'da pasta padrão');
  // com `db` mas sem conta do computador do provider: também a pasta padrão (nunca a de outra conta)
  const w3 = world(); const only = w3.mkForge(); const s3 = createConversationStore({ dir: path.join(tmp, `hist3-${w3.k}`), configDir: sys, configDirOf: (id) => w3.dir(id), db: w3.db });
  assert.equal(s3.sync(rec('ses_00000009', UUID(3), 'system')).ok, true); assert.equal(s3.read('ws', 'ses_00000009').messages[0].t, 'da pasta padrão'); assert.ok(only);
});
