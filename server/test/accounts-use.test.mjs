// Uso da conta certa por TODO `claude` iniciado pelo FORGE: ambiente do PTY, retomada/fork, histórico, leitura de transcrições (conversas e consumo).
// PTY simulado, CLI falsa, ORCH_DATA_DIR temporário. Nunca o Claude real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-acc-use-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
const { uid } = await import('../store.js');
const A = await import('../accounts.js');
const T = await import('../terminals.js');
const { createUsageReader } = await import('../terminal-usage.js');
const { createConversationStore } = await import('../conversations.js');
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const wsDir = path.join(tmp, 'ws'); fs.mkdirSync(wsDir);
const UUID = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
function fakePty() {
  const spawned = []; let pid = 1_800_000_000;
  const lib = { spawn(file, args, opts) {
    const p = { pid: ++pid, file, args, opts, written: [], dataCb: null, exitCb: null, onData(cb) { p.dataCb = cb; }, onExit(cb) { p.exitCb = cb; }, write(d) { p.written.push(d); }, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } };
    spawned.push(p); return p;
  } };
  return { lib, spawned };
}
let n = 0, rowSeq = 0x100;
function world(over = {}) {
  const k = ++n, dataDir = path.join(tmp, `data${k}`), sysConf = path.join(tmp, `sysconf${k}`); fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(sysConf, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws' }, workspaces: [{ id: 'ws', name: 'ws', path: wsDir }] }, f = fakePty(); let seq = 0, mgr = null;
  const accounts = A.createAccounts({ db, dataDir, persist: () => {}, uid, unavailable: true, isInUse: (id) => mgr?.usesAccount(id) === true });
  const usage = createUsageReader({ configDir: sysConf, missMs: 0 });
  mgr = T.createTerminalManager({ db, accounts, ptyLib: f.lib, usage, inspectConfig: async () => [], persist: () => {}, resolveCommand: () => ({ file: 'C:/fake/claude.exe', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, newSessionId: () => UUID(++seq), ...over });
  const mk = (label = 'Conta') => { const r = accounts.create({ provider: 'claude', label }); assert.equal(r.ok, true); return r.account; };
  // Conta do computador (machine): com `unavailable: true` o accounts.create({ home: 'machine' }) exige a CLI, então a linha entra direto no banco.
  const machine = (provider = 'claude', label = provider) => { const row = { id: `acc_${String(++rowSeq).padStart(8, '0')}`, provider, label, home: 'machine', createdAt: '2026-01-01T00:00:00.000Z' }; (db.accounts ??= []).push(row); return row; };
  return { k, db, f, accounts, mgr, usage, sysConf, mk, machine, dir: (id) => accounts.configDirOf(id) };
}
const transcript = (configDir, id, lines = ['{"type":"user"}']) => { const d = path.join(configDir, 'projects', 'proj'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${id}.jsonl`), `${lines.join('\n')}\n`); };
const usageLine = (id, out) => JSON.stringify({ type: 'assistant', uuid: `u${id}`, message: { id: `m${id}`, model: 'm', usage: { input_tokens: 1, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
const withEnv = async (vars, fn) => { const old = {}; for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; process.env[k] = v; } try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };

test('PTY: conta do computador mantém o ambiente do processo (CLAUDE_CONFIG_DIR e chave); conta do FORGE recebe a pasta dela e perde as variáveis de autenticação do ambiente', async () => {
  await withEnv({ CLAUDE_CONFIG_DIR: path.join(tmp, 'sentinela'), ANTHROPIC_API_KEY: 'k-sistema' }, async () => {
    const w = world(); const m = w.machine(); const a = w.mk();
    let r = await w.mgr.create({ role: 'builder' }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_required'], 'duas contas e nenhuma escolhida: não há conta padrão'); assert.equal(w.f.spawned.length, 0);
    r = await w.mgr.create({ role: 'builder', accountId: m.id }); assert.equal(r.ok, true, r.error); let e = w.f.spawned[0].opts.env;
    assert.equal(e.CLAUDE_CONFIG_DIR, path.join(tmp, 'sentinela'), 'valeu o ambiente do processo'); assert.equal(e.ANTHROPIC_API_KEY, 'k-sistema'); assert.equal(r.session.accountId, m.id);
    r = await w.mgr.create({ role: 'builder', accountId: a.id }); assert.equal(r.ok, true, r.error); e = w.f.spawned[1].opts.env;
    assert.equal(e.CLAUDE_CONFIG_DIR, w.dir(a.id)); assert.equal(e.ANTHROPIC_API_KEY, undefined, 'a chave do ambiente não sobrepõe o login da conta'); assert.equal(r.session.accountId, a.id);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, path.join(tmp, 'sentinela'), 'process.env não foi alterado'); assert.equal(process.env.ANTHROPIC_API_KEY, 'k-sistema');
  });
});

test('PTY: sem accountId a ÚNICA conta do provider é usada e lembrada; várias => account_required; accountId inválido/inexistente/de outro provider => erro sem abrir processo', async () => {
  const w = world(); const a = w.mk();
  let r = await w.mgr.create({ role: 'builder' }); assert.equal(r.ok, true, r.error); assert.equal(r.session.accountId, a.id); assert.equal(w.f.spawned[0].opts.env.CLAUDE_CONFIG_DIR, w.dir(a.id));
  assert.equal(w.db.settings.lastAccountByProvider.claude, a.id, 'a conta usada fica lembrada para a pré-seleção');
  const b = w.mk('Outra'); const before = w.f.spawned.length;
  r = await w.mgr.create({ role: 'builder' }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_required'], 'duas contas: nada é escolhido sozinho');
  const cx = w.machine('codex'); // conta de OUTRO provider
  const table = [['acc_deadbeef', 404, 'account_not_found'], ['../x', 404, 'account_not_found'], ['ACC_00000000', 404, 'account_not_found'], ['', 404, 'account_not_found'], ['system', 404, 'account_not_found'], [7, 400, 'account_not_found'], [{}, 400, 'account_not_found'], [cx.id, 400, 'account_provider_mismatch']];
  for (const [bad, st, code] of table) { const x = await w.mgr.create({ role: 'builder', accountId: bad }); assert.deepEqual([x.ok, x.status, x.code], [false, st, code], JSON.stringify(bad)); }
  assert.equal(w.f.spawned.length, before, 'nenhum processo para conta inválida'); assert.equal(w.db.settings.lastAccountByProvider.claude, a.id, 'a falha não mexe na pré-seleção');
  r = await w.mgr.create({ role: 'builder', accountId: b.id }); assert.equal(r.ok, true, r.error); assert.equal(w.db.settings.lastAccountByProvider.claude, b.id);
});

test('registro e histórico levam o accountId REAL; sessão antiga (sem o campo ou "system") vale como a conta do computador, ou null se não houver', async () => {
  const w = world(); const a = w.mk(); const m = w.machine(); await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout', accountId: m.id });
  assert.deepEqual(w.db.terminalSessions.map((r) => r.accountId), [a.id, m.id]); assert.deepEqual(w.mgr.history().map((h) => h.accountId).sort(), [a.id, m.id].sort()); assert.deepEqual(w.mgr.list().map((s) => s.accountId), [a.id, m.id]);
  const rec = w.db.terminalSessions[1], hOf = () => w.mgr.history().find((h) => h.id === rec.id).accountId;
  delete rec.accountId; assert.equal(hOf(), m.id, 'sem o campo: conta do computador'); rec.accountId = 'system'; assert.equal(hOf(), m.id, '"system" também'); assert.equal(w.mgr.recordInfo(rec.id).accountId, m.id);
  w.db.accounts = w.db.accounts.filter((x) => x.id !== m.id); assert.equal(hOf(), null, 'sem conta do computador: null, nunca uma conta qualquer'); assert.equal(w.mgr.recordInfo(rec.id).accountId, null);
});

test('retomar e bifurcar usam o accountId do REGISTRO (mesmo com outra conta lembrada); a conta removida bloqueia com mensagem clara', async () => {
  const w = world({ transcriptExists: () => true }); const a = w.mk(); const outra = w.mk('Outra'); w.accounts.remember('claude', outra.id);
  const c = await w.mgr.create({ role: 'builder', accountId: a.id }); w.f.spawned[0].exit(0); const rec = w.db.terminalSessions[0];
  let r = await w.mgr.resume({ recordId: rec.id }); assert.equal(r.ok, true, r.error); assert.equal(w.f.spawned[1].opts.env.CLAUDE_CONFIG_DIR, w.dir(a.id), 'retomada na conta do registro'); assert.deepEqual(w.f.spawned[1].args.slice(0, 2), ['--resume', rec.claudeSessionId]);
  assert.equal(r.session.accountId, a.id); w.f.spawned[1].exit(0);
  r = await w.mgr.resume({ recordId: rec.id, fork: true }); assert.equal(r.ok, true, r.error); assert.equal(w.f.spawned[2].opts.env.CLAUDE_CONFIG_DIR, w.dir(a.id)); assert.equal(w.db.terminalSessions.at(-1).accountId, a.id, 'o fork fica na mesma conta'); w.f.spawned[2].exit(0);
  // conta removida: não retoma em outra conta
  w.db.accounts = []; const before = w.f.spawned.length;
  const h = w.mgr.history().find((x) => x.id === rec.id); assert.deepEqual([h.resumable, h.blockedReason], [false, 'account_missing']); assert.match(h.blockedMessage, /conta/i);
  r = await w.mgr.resume({ recordId: rec.id }); assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'account_missing']); r = await w.mgr.resume({ recordId: rec.id, fork: true }); assert.equal(r.code, 'account_missing');
  assert.equal(w.f.spawned.length, before, 'nada foi aberto'); assert.ok(c.ok);
});

test('registro antigo sem accountId é retomado na conta do computador; sem ela => account_missing; uma conta removida DEPOIS da checagem (corrida) impede o spawn', async () => {
  const w = world({ transcriptExists: () => true }); const a = w.mk(); const m = w.machine(); w.accounts.remember('claude', a.id);
  await w.mgr.create({ role: 'builder', accountId: m.id }); w.f.spawned[0].exit(0); const rec = w.db.terminalSessions[0]; delete rec.accountId;
  const r = await w.mgr.resume({ recordId: rec.id }); assert.equal(r.ok, true, r.error); assert.equal(w.f.spawned[1].opts.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR, 'conta do computador, não a lembrada'); assert.equal(r.session.accountId, m.id); assert.equal(rec.accountId, m.id, 'o registro é curado na retomada');
  w.f.spawned[1].exit(0);
  // sem conta do computador do provider: não cai em outra conta
  delete rec.accountId; w.db.accounts = w.db.accounts.filter((x) => x.id !== m.id); const n0 = w.f.spawned.length;
  const x = await w.mgr.resume({ recordId: rec.id }); assert.deepEqual([x.ok, x.status, x.code], [false, 409, 'account_missing']); assert.equal(w.f.spawned.length, n0);
  // corrida: a conta some durante a inspeção assíncrona do projeto
  const w2 = world(); const b = w2.mk(); let removed = false;
  const mgr2 = T.createTerminalManager({ db: w2.db, accounts: w2.accounts, ptyLib: w2.f.lib, persist: () => {}, resolveCommand: () => ({ file: 'x', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, inspectConfig: async () => { w2.db.accounts = []; removed = true; return []; } });
  const y = await mgr2.create({ role: 'builder', accountId: b.id }); assert.equal(removed, true); assert.deepEqual([y.ok, y.status, y.code], [false, 409, 'account_missing']); assert.equal(w2.f.spawned.length, 0);
});

test('remover conta com terminal rodando => 409 (usesAccount); depois que o terminal encerra, remove', async () => {
  const w = world(); const a = w.mk(); await w.mgr.create({ role: 'builder', accountId: a.id });
  assert.equal(w.mgr.usesAccount(a.id), true); assert.equal(w.mgr.usesAccount('system'), false); assert.equal(w.mgr.usesAccount(null), false);
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.status, r.code], [409, 'account_in_use']); assert.equal(w.db.accounts.length, 1);
  w.f.spawned[0].exit(0); assert.equal(w.mgr.usesAccount(a.id), false); assert.equal((await w.accounts.remove(a.id)).ok, true);
});

test('transcrição (histórico/retomada) é procurada na pasta da conta DO REGISTRO, nunca na global; a conta do computador lê a pasta padrão do processo', async () => {
  const w = world(); const a = w.mk(); const m = w.machine('claude', 'Computador');
  await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout', accountId: m.id }); w.f.spawned.forEach((p) => p.exit(0));
  const [ra, rs] = w.db.terminalSessions;
  transcript(w.dir(a.id), ra.claudeSessionId); transcript(w.sysConf, rs.claudeSessionId);
  let h = Object.fromEntries(w.mgr.history().map((x) => [x.id, x])); assert.deepEqual([h[ra.id].resumable, h[rs.id].resumable], [true, true]);
  // a transcrição da conta aparece só na pasta GLOBAL: o registro da conta NÃO a encontra
  fs.rmSync(path.join(w.dir(a.id), 'projects'), { recursive: true }); transcript(w.sysConf, ra.claudeSessionId);
  h = Object.fromEntries(w.mgr.history().map((x) => [x.id, x])); assert.deepEqual([h[ra.id].resumable, h[ra.id].blockedReason], [false, 'transcript_missing']); assert.equal(h[rs.id].resumable, true);
  assert.equal((await w.mgr.resume({ recordId: ra.id })).code, 'transcript_missing');
  // e ao contrário: a da conta do computador só na pasta da conta isolada
  fs.rmSync(path.join(w.sysConf, 'projects', 'proj', `${rs.claudeSessionId}.jsonl`)); transcript(w.dir(a.id), rs.claudeSessionId);
  assert.equal(w.mgr.history().find((x) => x.id === rs.id).blockedReason, 'transcript_missing');
});

test('consumo (tokens) do pane é lido na pasta da conta da sessão', async () => {
  const w = world(); const a = w.mk(); const m = w.machine(); await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout', accountId: m.id });
  const [ra, rs] = w.db.terminalSessions; transcript(w.dir(a.id), ra.claudeSessionId, [usageLine(1, 10)]); transcript(w.sysConf, rs.claudeSessionId, [usageLine(2, 99)]);
  const u = Object.fromEntries(w.mgr.list().map((s) => [s.accountId, s.usage])); assert.equal(u[a.id].output, 10); assert.equal(u[m.id].output, 99);
  assert.equal(w.usage.read(ra.claudeSessionId, w.dir(a.id)).output, 10); assert.equal(w.usage.has(ra.claudeSessionId, w.dir(a.id)), true); assert.equal(w.usage.has(ra.claudeSessionId), false, 'sem a pasta da conta, a global não tem');
  assert.deepEqual([...w.usage.present([ra.claudeSessionId], w.dir(a.id))], [ra.claudeSessionId]); assert.equal(w.usage.present([ra.claudeSessionId]).size, 0);
});

test('conversas: sync lê o transcript na pasta da conta do registro; conta removida não cai na pasta global', () => {
  const w = world(); const a = w.mk(); const hist = path.join(tmp, `hist${w.k}`);
  const store = createConversationStore({ dir: hist, configDir: w.sysConf, configDirOf: (id) => w.accounts.configDirOf(id) });
  const msg = (t) => JSON.stringify({ type: 'user', message: { content: t }, timestamp: '2026-01-01T00:00:00Z' });
  transcript(w.dir(a.id), UUID(7), [msg('mensagem da conta')]); transcript(w.sysConf, UUID(8), [msg('mensagem do sistema')]);
  const rec = (id, claude, accountId) => ({ id, workspaceId: 'ws', claudeSessionId: claude, title: 't', role: 'builder', accountId });
  assert.equal(store.sync(rec('ses_00000001', UUID(7), a.id)).ok, true); assert.equal(store.read('ws', 'ses_00000001').messages[0].t, 'mensagem da conta');
  assert.equal(store.sync(rec('ses_00000002', UUID(8), undefined)).ok, true); assert.equal(store.read('ws', 'ses_00000002').messages[0].t, 'mensagem do sistema', 'sem accountId = conta do computador (pasta padrão)');
  assert.equal(store.sync(rec('ses_00000003', UUID(8), a.id)).reason, 'sem_transcricao', 'a conta não enxerga o transcript da pasta global');
  assert.equal(store.sync(rec('ses_00000004', UUID(7), 'system')).reason, 'sem_transcricao', 'a conta do computador não enxerga o da conta isolada');
  w.db.accounts = []; assert.equal(store.sync(rec('ses_00000005', UUID(7), a.id)).reason, 'sem_transcricao', 'conta removida: não cai na global');
  // sem configDirOf o comportamento é o de sempre (pasta única)
  const plain = createConversationStore({ dir: path.join(tmp, `hist-plain${w.k}`), configDir: w.sysConf }); assert.equal(plain.sync(rec('ses_00000006', UUID(8), undefined)).ok, true);
});
