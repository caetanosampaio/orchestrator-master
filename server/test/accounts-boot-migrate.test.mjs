// Migração v2 no boot (accounts.js > migrateAtBoot) e cópia única do banco (createDbBackup): falha de cópia ou de gravação desfaz TUDO em memória
// (padrão saveOrThrow + rollback); a cópia é feita uma vez só e nunca sobrescrita. Banco em memória e pasta temporária própria; nenhuma CLI.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-acc-bootmig-')));
process.env.ORCH_DATA_DIR ??= path.join(tmp, 'store'); // nenhum import abaixo toca o store, mas nunca o banco real
const { migrateAtBoot, createDbBackup, BACKUP_NAME } = await import('../accounts.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const AT = '2026-11-23T12:00:00.000Z';
const seqUid = () => { let n = 0; return (p) => `${p}_${(++n).toString(16).padStart(8, '0')}`; };
const legacyDb = () => ({
  settings: { defaultAccountId: 'system', theme: 'escuro' },
  accounts: [{ id: 'acc_aaaaaaaa', provider: 'claude', label: 'Trabalho', createdAt: '2026-01-01T00:00:00.000Z' }],
  terminalSessions: [
    { id: 'ses_00000001', provider: 'claude', accountId: 'system', state: 'exited' },
    { id: 'ses_00000002', state: 'exited' }, // sem provider nem accountId (registro bem antigo)
    { id: 'ses_00000003', provider: 'codex', accountId: 'system', state: 'exited' },
  ],
});
const opts = (over = {}) => ({ installed: { claude: true, codex: true }, uid: seqUid(), now: () => AT, backup: () => {}, ...over });

test('migrateAtBoot: aplica e grava; relatório com o que foi criado e reescrito', () => {
  const db = legacyDb(); let persists = 0, backups = 0;
  const r = migrateAtBoot({ db, persist: () => { persists++; }, ...opts({ backup: () => { backups++; } }) });
  assert.equal(r.changed, true); assert.equal(r.error, undefined); assert.deepEqual([persists, backups], [1, 1]);
  assert.equal(r.created.length, 2); assert.equal(r.rewritten, 3);
  assert.notEqual(db.terminalSessions[2].accountId, db.terminalSessions[0].accountId, 'o registro do Codex vai para a conta do Codex');
  const again = migrateAtBoot({ db, persist: () => { persists++; }, ...opts({ backup: () => { backups++; } }) });
  assert.equal(again.changed, false); assert.deepEqual([persists, backups], [1, 1], 'idempotente: sem gravação nem cópia');
});

test('migrateAtBoot: falha de GRAVAÇÃO desfaz tudo em memória (contas, accountsModel, pré-seleção e cada accountId, inclusive o ausente)', () => {
  const db = legacyDb(), before = structuredClone(db); const logs = [];
  const r = migrateAtBoot({ db, persist: () => { throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); }, log: (m) => logs.push(m), ...opts() });
  assert.equal(r.changed, false); assert.equal(r.error, 'ENOSPC');
  assert.deepEqual(db, before, 'banco idêntico ao de antes');
  assert.equal(Object.hasOwn(db.terminalSessions[1], 'accountId'), false, 'campo que não existia continua não existindo');
  assert.match(logs.join('\n'), /próximo boot/);
});

test('migrateAtBoot: falha da CÓPIA de segurança => nada é alterado e nada é gravado', () => {
  const db = legacyDb(), before = structuredClone(db); let persists = 0;
  const r = migrateAtBoot({ db, persist: () => { persists++; }, ...opts({ backup: () => { throw Object.assign(new Error('sem permissão'), { code: 'EACCES' }); } }) });
  assert.deepEqual([r.changed, r.error, persists], [false, 'EACCES', 0]); assert.deepEqual(db, before);
});

test('createDbBackup: copia o db.json UMA vez (nunca sobrescreve); sem db.json não faz nada', () => {
  const dir = path.join(tmp, 'bk'); fs.mkdirSync(dir);
  const backup = createDbBackup(dir), bak = path.join(dir, BACKUP_NAME);
  backup(); assert.equal(fs.existsSync(bak), false, 'banco novo: nada a copiar');
  fs.writeFileSync(path.join(dir, 'db.json'), '{"v":1}'); backup(); assert.equal(fs.readFileSync(bak, 'utf8'), '{"v":1}');
  fs.writeFileSync(path.join(dir, 'db.json'), '{"v":2}'); backup(); assert.equal(fs.readFileSync(bak, 'utf8'), '{"v":1}', 'a 1ª cópia fica');
});
