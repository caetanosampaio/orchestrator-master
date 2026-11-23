// Migração do modelo de contas v2 (account-compat.js): adoção das contas `machine`, reescrita de `system` pelo provider do registro,
// semente da pré-seleção, idempotência, cópia de segurança, reversão, leitura tolerante e tradução das chaves de limites.
// Funções puras: nenhum arquivo, nenhum banco real, nenhuma CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../account-compat.js';

const { migrateAccountsV2: migrate, reverseAccountsV2: reverse, resolveLegacyAccountId: resolve, translateLimitKeys: translate } = C;
const AT = '2026-11-23T12:00:00.000Z';
const now = () => AT;
/** Gerador determinístico: acc_00000001, acc_00000002, ... */
const seqUid = () => { let n = 0; return (p) => `${p}_${(++n).toString(16).padStart(8, '0')}`; };
const FORGE = Object.freeze({ id: 'acc_aaaaaaaa', provider: 'claude', label: 'Trabalho', createdAt: '2026-01-01T00:00:00.000Z' });
const rec = (id, over = {}) => ({ id, terminalId: `term_${id}`, claudeSessionId: null, role: 'builder', workspaceId: 'ws_00000001', state: 'exited', ...over });

/** Banco no formato antigo: `system` em registros do Claude (com e sem provider) e do Codex, uma conta nomeada do Claude. */
const legacyDb = () => ({
  settings: { defaultAccountId: 'system', theme: 'escuro' },
  accounts: [{ ...FORGE }],
  workspaces: [{ id: 'ws_00000001' }],
  terminalSessions: [
    rec('ses_1', { provider: 'claude', accountId: 'system' }),
    rec('ses_2', { provider: 'codex', accountId: 'system' }),
    rec('ses_3', { provider: 'claude', accountId: FORGE.id }),
    rec('ses_4', { accountId: 'system' }), // registro antigo sem provider = Claude
  ],
});
const byId = (db, id) => db.terminalSessions.find((r) => r.id === id);
const machineOf = (db, p) => db.accounts.find((a) => a.home === 'machine' && a.provider === p);

test('constantes legadas e regex exportados', () => {
  assert.equal(C.LEGACY_SYSTEM_ID, 'system');
  assert.deepEqual({ ...C.LEGACY_LIMIT_KEYS }, { claude: 'claude:system', codex: 'codex' });
  assert.ok(C.ACCOUNT_ID_RE.test('acc_0123abcd')); assert.ok(!C.ACCOUNT_ID_RE.test('system')); assert.ok(!C.ACCOUNT_ID_RE.test('acc_0123ABCD'));
  assert.ok(C.LIMIT_KEY_RE.test('claude:acc_0123abcd')); assert.ok(C.LIMIT_KEY_RE.test('codex:acc_0123abcd'));
  for (const k of ['claude:system', 'codex', 'Claude:acc_0123abcd', 'claude:acc_0123abc', ':acc_0123abcd', `${'a'.repeat(21)}:acc_0123abcd`]) assert.ok(!C.LIMIT_KEY_RE.test(k), k);
  assert.equal(C.accountHome({ ...FORGE }), 'forge', 'linha antiga sem home é forge');
  assert.equal(C.accountHome({ ...FORGE, home: 'machine' }), 'machine');
});

test('banco antigo: system do Claude vai para a machine do Claude e o do Codex para a machine do Codex', () => {
  const db = legacyDb();
  const r = migrate(db, { installed: {}, uid: seqUid(), now });
  assert.equal(r.changed, true); assert.equal(r.rewritten, 3); assert.deepEqual(r.adopted.sort(), ['claude', 'codex']);
  const claude = machineOf(db, 'claude'), codex = machineOf(db, 'codex');
  assert.ok(claude && codex); assert.notEqual(claude.id, codex.id);
  assert.deepEqual(claude, { id: claude.id, provider: 'claude', label: 'Claude Code', home: 'machine', createdAt: AT });
  assert.deepEqual(codex, { id: codex.id, provider: 'codex', label: 'Codex CLI', home: 'machine', createdAt: AT });
  assert.equal(byId(db, 'ses_1').accountId, claude.id);
  assert.equal(byId(db, 'ses_2').accountId, codex.id, 'registro do Codex NUNCA vai para a conta do Claude');
  assert.equal(byId(db, 'ses_3').accountId, FORGE.id, 'conta nomeada intacta');
  assert.equal(byId(db, 'ses_4').accountId, claude.id, 'sem provider = Claude');
  assert.equal(byId(db, 'ses_4').provider, undefined, 'a migração não inventa o campo provider');
  assert.deepEqual(db.accountsModel, { v: 2, at: AT, adopted: { claude: true, codex: true }, machineIds: { claude: claude.id, codex: codex.id } });
  assert.deepEqual(r.map, { claude: claude.id, codex: codex.id });
  assert.ok(!JSON.stringify(db.terminalSessions).includes('"system"'), 'nenhum registro aponta mais para system');
});

test('conta forge existente é preservada intacta (sem ganhar campos) e nenhuma linha é duplicada', () => {
  const db = legacyDb(); db.accounts.push({ id: 'acc_bbbbbbbb', provider: 'claude', label: 'Pessoal', createdAt: '2026-02-01T00:00:00.000Z', extra: { x: 1 } });
  const before = structuredClone(db.accounts);
  migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now });
  assert.deepEqual(db.accounts.slice(0, 2), before);
  assert.equal(db.accounts.length, 4);
  assert.equal(new Set(db.accounts.map((a) => a.id)).size, 4);
});

test('registros sem accountId vão para a machine do provider do registro', () => {
  const db = { settings: {}, terminalSessions: [rec('a', { provider: 'claude' }), rec('b', { provider: 'codex' }), rec('c', { provider: 'codex', accountId: null })] };
  const r = migrate(db, { uid: seqUid(), now });
  assert.equal(r.rewritten, 3);
  assert.equal(byId(db, 'a').accountId, db.accountsModel.machineIds.claude);
  assert.equal(byId(db, 'b').accountId, db.accountsModel.machineIds.codex);
  assert.equal(byId(db, 'c').accountId, db.accountsModel.machineIds.codex);
});

test('registro com provider inválido ou que não é objeto não é tocado', () => {
  const db = { settings: {}, terminalSessions: [rec('a', { provider: 42, accountId: 'system' }), rec('b', { provider: 'Não Vale', accountId: 'system' }), null, 'lixo'] };
  const before = structuredClone(db);
  const r = migrate(db, { uid: seqUid(), now });
  assert.equal(r.changed, false); assert.deepEqual(db, before);
});

test('defaultAccountId "system": não é apagado nem reescrito; garante a machine do Claude e semeia lastAccountByProvider', () => {
  const db = { settings: { defaultAccountId: 'system' } }; // sem registros e sem CLI instalado: a escolha antiga já basta
  const r = migrate(db, { installed: {}, uid: seqUid(), now });
  assert.equal(r.changed, true); assert.deepEqual(r.adopted, ['claude']); assert.deepEqual(r.seeded, ['claude']);
  assert.equal(db.settings.defaultAccountId, 'system');
  assert.equal(db.accounts.length, 1); assert.equal(db.accounts[0].provider, 'claude');
  assert.deepEqual(db.settings.lastAccountByProvider, { claude: db.accounts[0].id });
});

test('defaultAccountId "acc_x": semeia o provider da conta e não cria machine sem motivo', () => {
  const db = { settings: { defaultAccountId: FORGE.id }, accounts: [{ ...FORGE }] };
  const r = migrate(db, { uid: seqUid(), now });
  assert.equal(r.changed, true); assert.deepEqual(r.created, []); assert.deepEqual(r.seeded, ['claude']);
  assert.equal(db.settings.defaultAccountId, FORGE.id);
  assert.deepEqual(db.settings.lastAccountByProvider, { claude: FORGE.id });
  assert.deepEqual(db.accounts, [{ ...FORGE }]);
  // conta de outro provider
  const db2 = { settings: { defaultAccountId: 'acc_cccccccc' }, accounts: [{ id: 'acc_cccccccc', provider: 'codex', label: 'X', createdAt: AT }] };
  migrate(db2, { uid: seqUid(), now });
  assert.deepEqual(db2.settings.lastAccountByProvider, { codex: 'acc_cccccccc' });
  // id que não existe mais: nada a semear
  const db3 = { settings: { defaultAccountId: 'acc_dddddddd' }, accounts: [] };
  const before = structuredClone(db3);
  assert.equal(migrate(db3, { uid: seqUid(), now }).changed, false); assert.deepEqual(db3, before);
});

test('defaultAccountId ausente: sem semente; escolha já existente em lastAccountByProvider não é sobrescrita', () => {
  const db = { settings: {} };
  migrate(db, { installed: { claude: true }, uid: seqUid(), now });
  assert.equal(db.settings.lastAccountByProvider, undefined);
  const db2 = { settings: { defaultAccountId: 'system', lastAccountByProvider: { claude: FORGE.id } }, accounts: [{ ...FORGE }] };
  const r = migrate(db2, { uid: seqUid(), now });
  assert.deepEqual(r.seeded, []); assert.deepEqual(db2.settings.lastAccountByProvider, { claude: FORGE.id });
});

test('idempotente: o segundo boot não altera nada (db idêntico, changed:false, sem backup)', () => {
  const db = legacyDb();
  let calls = 0; const backup = () => { calls++; };
  migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now, backup });
  assert.equal(calls, 1);
  const snap = structuredClone(db);
  const r = migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now: () => '2030-01-01T00:00:00.000Z', backup });
  assert.equal(r.changed, false); assert.equal(r.rewritten, 0); assert.deepEqual(r.adopted, []);
  assert.deepEqual(db, snap); assert.equal(calls, 1);
  assert.deepEqual(r.map, snap.accountsModel.machineIds);
});

test('instalação limpa sem nenhum CLI: nada muda e a lista fica vazia', () => {
  const db = { settings: {}, workspaces: [] };
  const before = structuredClone(db);
  let calls = 0;
  const r = migrate(db, { installed: { claude: false, codex: false }, uid: seqUid(), now, backup: () => calls++ });
  assert.deepEqual(r, { changed: false, adopted: [], created: [], rewritten: 0, seeded: [], map: {} });
  assert.deepEqual(db, before); assert.equal(calls, 0);
  assert.equal(db.accounts, undefined); assert.equal(db.accountsModel, undefined);
});

test('só Claude, só Codex e os dois instalados', () => {
  const only = (installed) => { const db = { settings: {} }; const r = migrate(db, { installed, uid: seqUid(), now }); return { db, r }; };
  let { db, r } = only({ claude: true });
  assert.deepEqual(db.accounts.map((a) => [a.provider, a.label, a.home]), [['claude', 'Claude Code', 'machine']]); assert.deepEqual(r.adopted, ['claude']);
  ({ db, r } = only({ codex: true }));
  assert.deepEqual(db.accounts.map((a) => [a.provider, a.label, a.home]), [['codex', 'Codex CLI', 'machine']]); assert.deepEqual(db.accountsModel.adopted, { codex: true });
  ({ db, r } = only({ claude: true, codex: true }));
  assert.deepEqual(db.accounts.map((a) => a.provider).sort(), ['claude', 'codex']); assert.equal(r.created.length, 2);
});

test('CLI instalado depois: só o novo provider é adotado; adoção acontece uma vez só', () => {
  const db = { settings: {} };
  migrate(db, { installed: { claude: true }, uid: seqUid(), now });
  const claudeRow = structuredClone(db.accounts[0]);
  const r = migrate(db, { installed: { claude: true, codex: true }, uid: () => 'acc_0000abcd', now });
  assert.deepEqual(r.adopted, ['codex']); assert.deepEqual(db.accounts[0], claudeRow);
  assert.deepEqual(db.accountsModel.machineIds, { claude: claudeRow.id, codex: 'acc_0000abcd' });
  // o usuário remove a conta machine do Codex: com o CLI ainda instalado ela NÃO volta sozinha
  db.accounts = db.accounts.filter((a) => a.provider !== 'codex');
  const snap = structuredClone(db);
  assert.equal(migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now }).changed, false);
  assert.deepEqual(db, snap);
});

test('defaultAccountId "system" com a machine do Claude já removida: não recria nem semeia id inexistente', () => {
  const db = { settings: { defaultAccountId: 'system' } };
  migrate(db, { uid: seqUid(), now });
  db.accounts = []; delete db.settings.lastAccountByProvider;
  const snap = structuredClone(db);
  assert.equal(migrate(db, { installed: { claude: true }, uid: seqUid(), now }).changed, false);
  assert.deepEqual(db, snap);
});

test('referência legada nova com a machine registrada removida: recria a linha com o MESMO id', () => {
  const db = { settings: {}, accounts: [], accountsModel: { v: 2, at: AT, adopted: { claude: true }, machineIds: { claude: 'acc_11111111' } }, terminalSessions: [rec('a', { accountId: 'system' })] };
  const r = migrate(db, { uid: seqUid(), now });
  assert.deepEqual(r.created, ['acc_11111111']); assert.equal(byId(db, 'a').accountId, 'acc_11111111');
  assert.equal(db.accounts[0].home, 'machine');
});

test('provider desconhecido usa o id como rótulo; chaves inválidas e valores não-true são ignorados', () => {
  const db = { settings: {} };
  const r = migrate(db, { installed: { gemini: true, 'Kimi CLI': true, cursor: 'sim', codex: 1 }, uid: seqUid(), now });
  assert.deepEqual(r.adopted, ['gemini']); assert.deepEqual(db.accounts.map((a) => [a.provider, a.label]), [['gemini', 'gemini']]);
});

test('backup: chamado UMA vez, antes da primeira alteração; se lançar, o banco fica intacto', () => {
  const db = legacyDb(); const original = structuredClone(db);
  const seen = [];
  migrate(db, { installed: { claude: true }, uid: seqUid(), now, backup: () => seen.push(structuredClone(db)) });
  assert.equal(seen.length, 1); assert.deepEqual(seen[0], original, 'no momento do backup nada tinha sido alterado');
  const db2 = legacyDb(); const before2 = structuredClone(db2);
  assert.throws(() => migrate(db2, { uid: seqUid(), now, backup: () => { throw new Error('disco cheio'); } }), /disco cheio/);
  assert.deepEqual(db2, before2);
});

test('reverseAccountsV2 devolve o estado original', () => {
  const db = legacyDb(); db.terminalSessions.push(rec('ses_5', { provider: 'codex', accountId: 'system' }));
  const original = structuredClone(db);
  migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now });
  const r = reverse(db);
  assert.equal(r.changed, true); assert.equal(r.restored, 4); assert.equal(r.removed.length, 2);
  assert.deepEqual(db, original);
  // ida e volta de novo: a migração refaz o mesmo resultado
  migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now });
  assert.equal(byId(db, 'ses_2').accountId, db.accountsModel.machineIds.codex);
});

test('reverseAccountsV2: registro sem accountId volta como "system" (equivalente); sem modelo v2 não faz nada', () => {
  const db = { settings: {}, terminalSessions: [rec('a', { provider: 'codex' })] };
  migrate(db, { uid: seqUid(), now });
  reverse(db);
  assert.equal(byId(db, 'a').accountId, 'system'); assert.equal(db.accountsModel, undefined); assert.deepEqual(db.accounts, []);
  const plain = legacyDb(); const before = structuredClone(plain);
  assert.deepEqual(reverse(plain), { changed: false, restored: 0, removed: [] }); assert.deepEqual(plain, before);
  assert.deepEqual(reverse(null), { changed: false, restored: 0, removed: [] });
});

test('db sem db.accounts (e entrada que não é objeto)', () => {
  const db = { settings: { defaultAccountId: 'system' }, terminalSessions: [rec('a', { provider: 'codex', accountId: 'system' })] };
  const r = migrate(db, { uid: seqUid(), now });
  assert.ok(Array.isArray(db.accounts)); assert.equal(db.accounts.length, 2); assert.equal(r.changed, true);
  for (const bad of [null, undefined, 42, 'db', []]) assert.equal(migrate(bad, { uid: seqUid(), now }).changed, false);
  const noSettings = { terminalSessions: [] };
  assert.equal(migrate(noSettings, { uid: seqUid(), now }).changed, false); assert.deepEqual(noSettings, { terminalSessions: [] });
});

test('ids gerados não colidem com contas existentes, entre si, nem aceitam formato inválido', () => {
  const db = legacyDb();
  const seq = [FORGE.id, 'system', 'acc_XYZ', 'acc_00000001', 'acc_00000001', 'acc_00000002'];
  const r = migrate(db, { uid: () => seq.shift(), now });
  assert.deepEqual(r.created.sort(), ['acc_00000001', 'acc_00000002']);
  assert.equal(new Set(db.accounts.map((a) => a.id)).size, db.accounts.length);
  const db2 = legacyDb(); const before = structuredClone(db2);
  assert.throws(() => migrate(db2, { uid: () => 'invalido', now }), /id de conta/);
  assert.deepEqual(db2, before, 'falha ao gerar id acontece antes de qualquer alteração');
});

test('resolveLegacyAccountId: system/ausente -> machine do provider; id novo passa; lixo -> null', () => {
  const db = legacyDb();
  migrate(db, { installed: { claude: true, codex: true }, uid: seqUid(), now });
  const { claude, codex } = db.accountsModel.machineIds;
  assert.equal(resolve(db, 'system', 'claude'), claude);
  assert.equal(resolve(db, undefined, undefined), claude, 'sem provider = Claude');
  assert.equal(resolve(db, null, 'codex'), codex);
  assert.equal(resolve(db, 'system', 'codex'), codex, 'o Codex nunca cai na conta do Claude');
  assert.equal(resolve(db, FORGE.id, 'claude'), FORGE.id);
  assert.equal(resolve(db, 'system', 'gemini'), null, 'provider sem conta machine');
  assert.equal(resolve(db, 'lixo', 'claude'), null);
  assert.equal(resolve(db, 'system', 'Não Vale'), null);
  assert.equal(resolve(null, 'system', 'claude'), null);
  // migração só em memória sem modelo gravado: cai na linha machine do provider
  const mem = { accounts: [{ id: 'acc_12345678', provider: 'codex', label: 'Codex CLI', home: 'machine', createdAt: AT }] };
  assert.equal(resolve(mem, 'system', 'codex'), 'acc_12345678');
  assert.equal(resolve(mem, 'system', 'claude'), null);
});

test('translateLimitKeys: legadas viram chaves novas, novas passam, lixo sai; função pura', () => {
  const ids = { claude: 'acc_0000000a', codex: 'acc_0000000b' };
  const v1 = { fiveHour: 1 }, v2 = { fiveHour: 2 }, v3 = { fiveHour: 3 };
  const input = { 'claude:system': v1, codex: v2, 'claude:acc_aaaaaaaa': v3, lixo: 1, 'claude:acc_XYZ': 2, __proto__x: 3, 'gemini:acc_cccccccc': v1 };
  const snap = structuredClone(input);
  const out = translate(input, ids);
  assert.deepEqual(out, { 'claude:acc_0000000a': v1, 'codex:acc_0000000b': v2, 'claude:acc_aaaaaaaa': v3, 'gemini:acc_cccccccc': v1 });
  assert.notEqual(out, input); assert.deepEqual(input, snap);
  // chave nova já presente vence a tradução da legada
  assert.deepEqual(translate({ 'claude:system': v1, 'claude:acc_0000000a': v2 }, ids), { 'claude:acc_0000000a': v2 });
  // sem conta machine correspondente a legada sai
  assert.deepEqual(translate({ 'claude:system': v1, codex: v2 }, { claude: 'acc_0000000a' }), { 'claude:acc_0000000a': v1 });
  assert.deepEqual(translate({ 'claude:system': v1 }, { claude: 'system' }), {});
  for (const bad of [null, undefined, 'x', 42, []]) assert.deepEqual(translate(bad, ids), {});
  assert.deepEqual(translate({ codex: v2 }, null), {});
  assert.equal(C.limitKey('codex', 'acc_0000000b'), 'codex:acc_0000000b'); assert.equal(C.limitKey('codex', 'system'), null);
});
