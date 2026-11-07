// Uso da conta certa por TODO `claude` iniciado pelo FORGE: ambiente do PTY, retomada/fork, histórico, leitura de transcrições (conversas e consumo) e ciclo autônomo (executor/planner).
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
const { createExecutor } = await import('../executor/index.js');
const { setClaudeEnvProvider } = await import('../claude-cli.js');
after(() => { setClaudeEnvProvider(null); fs.rmSync(tmp, { recursive: true, force: true }); });

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
let n = 0;
function world(over = {}) {
  const k = ++n, dataDir = path.join(tmp, `data${k}`), sysConf = path.join(tmp, `sysconf${k}`); fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(sysConf, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws' }, workspaces: [{ id: 'ws', name: 'ws', path: wsDir }] }, f = fakePty(); let seq = 0, mgr = null;
  const accounts = A.createAccounts({ db, dataDir, persist: () => {}, uid, unavailable: true, isInUse: (id) => mgr?.usesAccount(id) === true });
  const usage = createUsageReader({ configDir: sysConf, missMs: 0 });
  mgr = T.createTerminalManager({ db, accounts, ptyLib: f.lib, usage, inspectConfig: async () => [], persist: () => {}, resolveCommand: () => ({ file: 'C:/fake/claude.exe', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, newSessionId: () => UUID(++seq), ...over });
  const mk = (label = 'Conta') => { const r = accounts.create({ provider: 'claude', label }); assert.equal(r.ok, true); return r.account; };
  return { k, db, f, accounts, mgr, usage, sysConf, mk, dir: (id) => accounts.configDirOf(id) };
}
const transcript = (configDir, id, lines = ['{"type":"user"}']) => { const d = path.join(configDir, 'projects', 'proj'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${id}.jsonl`), `${lines.join('\n')}\n`); };
const usageLine = (id, out) => JSON.stringify({ type: 'assistant', uuid: `u${id}`, message: { id: `m${id}`, model: 'm', usage: { input_tokens: 1, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
const withEnv = async (vars, fn) => { const old = {}; for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; process.env[k] = v; } try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };

test('PTY: conta Sistema NÃO sobrescreve CLAUDE_CONFIG_DIR; conta do FORGE recebe a pasta dela e perde as variáveis de autenticação do ambiente', async () => {
  await withEnv({ CLAUDE_CONFIG_DIR: path.join(tmp, 'sentinela'), ANTHROPIC_API_KEY: 'k-sistema' }, async () => {
    const w = world(); const a = w.mk();
    let r = await w.mgr.create({ role: 'builder' }); assert.equal(r.ok, true, r.error); let e = w.f.spawned[0].opts.env;
    assert.equal(e.CLAUDE_CONFIG_DIR, path.join(tmp, 'sentinela'), 'valeu o ambiente do processo'); assert.equal(e.ANTHROPIC_API_KEY, 'k-sistema'); assert.equal(r.session.accountId, 'system');
    r = await w.mgr.create({ role: 'builder', accountId: a.id }); assert.equal(r.ok, true, r.error); e = w.f.spawned[1].opts.env;
    assert.equal(e.CLAUDE_CONFIG_DIR, w.dir(a.id)); assert.equal(e.ANTHROPIC_API_KEY, undefined, 'a chave do ambiente não sobrepõe o login da conta'); assert.equal(r.session.accountId, a.id);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, path.join(tmp, 'sentinela'), 'process.env não foi alterado'); assert.equal(process.env.ANTHROPIC_API_KEY, 'k-sistema');
  });
});

test('PTY: sem accountId vale a conta PADRÃO; accountId inexistente ou inválido => 400 sem abrir processo', async () => {
  const w = world(); const a = w.mk(); w.accounts.setDefault(a.id);
  let r = await w.mgr.create({ role: 'builder' }); assert.equal(r.session.accountId, a.id); assert.equal(w.f.spawned[0].opts.env.CLAUDE_CONFIG_DIR, w.dir(a.id));
  r = await w.mgr.create({ role: 'builder', accountId: 'system' }); assert.equal(r.session.accountId, 'system');
  for (const bad of ['acc_deadbeef', '../x', 'ACC_00000000', 7, {}, '']) { const x = await w.mgr.create({ role: 'builder', accountId: bad }); assert.deepEqual([x.ok, x.status, x.code], [false, 400, 'account_not_found'], JSON.stringify(bad)); }
  assert.equal(w.f.spawned.length, 2, 'nenhum processo para conta inválida');
});

test('registro e histórico levam accountId; sessão antiga (sem o campo) vale como Sistema', async () => {
  const w = world(); const a = w.mk(); await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout' });
  assert.deepEqual(w.db.terminalSessions.map((r) => r.accountId), [a.id, 'system']); assert.deepEqual(w.mgr.history().map((h) => h.accountId).sort(), [a.id, 'system'].sort()); assert.deepEqual(w.mgr.list().map((s) => s.accountId), [a.id, 'system']);
  delete w.db.terminalSessions[1].accountId; assert.equal(w.mgr.history().find((h) => h.id === w.db.terminalSessions[1].id).accountId, 'system');
});

test('retomar e bifurcar usam o accountId do REGISTRO (mesmo com outra conta padrão); a conta removida bloqueia com mensagem clara', async () => {
  const w = world({ transcriptExists: () => true }); const a = w.mk(); w.accounts.setDefault('system');
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

test('registro antigo sem accountId é retomado na conta Sistema; uma conta removida DEPOIS da checagem (corrida) impede o spawn', async () => {
  const w = world({ transcriptExists: () => true }); const a = w.mk();
  await w.mgr.create({ role: 'builder' }); w.f.spawned[0].exit(0); delete w.db.terminalSessions[0].accountId; w.accounts.setDefault(a.id);
  const r = await w.mgr.resume({ recordId: w.db.terminalSessions[0].id }); assert.equal(r.ok, true, r.error); assert.equal(w.f.spawned[1].opts.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR, 'Sistema, não a padrão'); assert.equal(r.session.accountId, 'system');
  // corrida: a conta some durante a inspeção assíncrona do projeto
  const w2 = world(); const b = w2.mk(); let removed = false;
  const mgr2 = T.createTerminalManager({ db: w2.db, accounts: w2.accounts, ptyLib: w2.f.lib, persist: () => {}, resolveCommand: () => ({ file: 'x', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, inspectConfig: async () => { w2.db.accounts = []; removed = true; return []; } });
  const x = await mgr2.create({ role: 'builder', accountId: b.id }); assert.equal(removed, true); assert.deepEqual([x.ok, x.status, x.code], [false, 409, 'account_missing']); assert.equal(w2.f.spawned.length, 0);
});

test('remover conta com terminal rodando => 409 (usesAccount); depois que o terminal encerra, remove', async () => {
  const w = world(); const a = w.mk(); await w.mgr.create({ role: 'builder', accountId: a.id });
  assert.equal(w.mgr.usesAccount(a.id), true); assert.equal(w.mgr.usesAccount('system'), false);
  const r = await w.accounts.remove(a.id); assert.deepEqual([r.status, r.code], [409, 'account_in_use']); assert.equal(w.db.accounts.length, 1);
  w.f.spawned[0].exit(0); assert.equal(w.mgr.usesAccount(a.id), false); assert.equal((await w.accounts.remove(a.id)).ok, true);
});

test('transcrição (histórico/retomada) é procurada na pasta da conta DO REGISTRO, nunca na global', async () => {
  const w = world(); const a = w.mk();
  await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout' }); w.f.spawned.forEach((p) => p.exit(0));
  const [ra, rs] = w.db.terminalSessions;
  transcript(w.dir(a.id), ra.claudeSessionId); transcript(w.sysConf, rs.claudeSessionId);
  let h = Object.fromEntries(w.mgr.history().map((x) => [x.id, x])); assert.deepEqual([h[ra.id].resumable, h[rs.id].resumable], [true, true]);
  // a transcrição da conta aparece só na pasta GLOBAL: o registro da conta NÃO a encontra
  fs.rmSync(path.join(w.dir(a.id), 'projects'), { recursive: true }); transcript(w.sysConf, ra.claudeSessionId);
  h = Object.fromEntries(w.mgr.history().map((x) => [x.id, x])); assert.deepEqual([h[ra.id].resumable, h[ra.id].blockedReason], [false, 'transcript_missing']); assert.equal(h[rs.id].resumable, true);
  assert.equal((await w.mgr.resume({ recordId: ra.id })).code, 'transcript_missing');
  // e ao contrário: a do Sistema só na pasta da conta
  fs.rmSync(path.join(w.sysConf, 'projects', 'proj', `${rs.claudeSessionId}.jsonl`)); transcript(w.dir(a.id), rs.claudeSessionId);
  assert.equal(w.mgr.history().find((x) => x.id === rs.id).blockedReason, 'transcript_missing');
});

test('consumo (tokens) do pane é lido na pasta da conta da sessão', async () => {
  const w = world(); const a = w.mk(); await w.mgr.create({ role: 'builder', accountId: a.id }); await w.mgr.create({ role: 'scout' });
  const [ra, rs] = w.db.terminalSessions; transcript(w.dir(a.id), ra.claudeSessionId, [usageLine(1, 10)]); transcript(w.sysConf, rs.claudeSessionId, [usageLine(2, 99)]);
  const u = Object.fromEntries(w.mgr.list().map((s) => [s.accountId, s.usage])); assert.equal(u[a.id].output, 10); assert.equal(u.system.output, 99);
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
  assert.equal(store.sync(rec('ses_00000002', UUID(8), undefined)).ok, true); assert.equal(store.read('ws', 'ses_00000002').messages[0].t, 'mensagem do sistema', 'sem accountId = Sistema');
  assert.equal(store.sync(rec('ses_00000003', UUID(8), a.id)).reason, 'sem_transcricao', 'a conta não enxerga o transcript da pasta global');
  assert.equal(store.sync(rec('ses_00000004', UUID(7), 'system')).reason, 'sem_transcricao', 'o Sistema não enxerga o da conta');
  w.db.accounts = []; assert.equal(store.sync(rec('ses_00000005', UUID(7), a.id)).reason, 'sem_transcricao', 'conta removida: não cai na global');
  // sem configDirOf o comportamento é o de sempre (pasta única)
  const plain = createConversationStore({ dir: path.join(tmp, `hist-plain${w.k}`), configDir: w.sysConf }); assert.equal(plain.sync(rec('ses_00000006', UUID(8), undefined)).ok, true);
});

test('executor/planner do ciclo: o ambiente do filho vem da conta padrão NO MOMENTO da execução (opção env e provedor global)', async () => {
  const script = "process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({d:process.env.CLAUDE_CONFIG_DIR??null,k:process.env.ANTHROPIC_API_KEY??null}),total_cost_usd:0,duration_ms:1,num_turns:1}))})";
  const w = world(); const a = w.mk();
  const run = async (ex) => { const h = ex.start({ missionId: 'm', taskId: 't', cwd: wsDir, prompt: 'x', onLine: () => {} }); const r = await h.done; assert.equal(r.status, 'completed', r.error); return JSON.parse(r.result.text); };
  await withEnv({ CLAUDE_CONFIG_DIR: path.join(tmp, 'sentinela'), ANTHROPIC_API_KEY: 'k-sistema' }, async () => {
    const ex = createExecutor({ command: process.execPath, prefixArgs: ['-e', script, '--'], args: [], env: () => w.accounts.envOf(w.accounts.defaultId()) });
    assert.deepEqual(await run(ex), { d: path.join(tmp, 'sentinela'), k: 'k-sistema' }, 'padrão = Sistema: ambiente do processo');
    w.accounts.setDefault(a.id); assert.deepEqual(await run(ex), { d: w.dir(a.id), k: null }, 'trocou a padrão: a próxima execução já usa a nova conta');
    // provedor global (é o que o Planner usa, via createExecutor sem opções de ambiente)
    setClaudeEnvProvider(() => w.accounts.envOf(w.accounts.defaultId()));
    const planner = createExecutor({ command: process.execPath, prefixArgs: ['-e', script, '--'], args: [] }); assert.deepEqual(await run(planner), { d: w.dir(a.id), k: null });
    w.accounts.setDefault('system'); assert.equal((await run(planner)).d, path.join(tmp, 'sentinela'));
    setClaudeEnvProvider(null); assert.equal((await run(planner)).k, 'k-sistema', 'sem provedor: process.env, como sempre');
  });
});
