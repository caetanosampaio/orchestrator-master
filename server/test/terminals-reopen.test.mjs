// Reabertura de terminais que ESTAVAM abertos quando o servidor parou mas não têm conversa para retomar (nunca receberam uma mensagem, ou o provedor não retoma, como o Codex):
// voltam como terminal NOVO com o mesmo papel, título, agente, conta e worktree, para a equipe (dupla, squad) voltar inteira. PTY SIMULADO, banco em memória.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-reopen-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const T = await import('../terminals.js');
const H = await import('../../client/src/session-history.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function world(over = {}) {
  const spawned = []; let pid = 1_940_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const wsDir = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(wsDir, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: wsDir }], worktrees: [], topics: [] };
  const withTranscript = new Set();
  const mk = (extra = {}) => T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }), inspectConfig: async () => [], sweepMs: 0,
    usage: { read: () => null, has: () => false, forget() {} }, transcriptExists: (id) => withTranscript.has(id), persist: () => {}, ...over, ...extra });
  return { spawned, db, mk, mgr: mk(), wsDir, withTranscript };
}
/** Simula "o servidor parou": encerra o manager atual (registros ficam interrompidos) e sobe outro sobre o MESMO banco. */
function restart(w) { w.mgr.killAllSync(); w.mgr = w.mk(); return w.mgr; }
const rowOf = (mgr, recId) => mgr.history().find((h) => h.id === recId);

test('reabrir: sessão sem transcrição não é retomável mas é reabrível; reopen abre um terminal NOVO (mesmo papel/título/agente), não --resume, e a antiga não volta a ser restaurada', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', title: 'Meu construtor' }); const recId = a.session.recordId;
  restart(w);
  const h = rowOf(w.mgr, recId);
  assert.equal(h.state, 'interrupted'); assert.equal(h.resumable, false); assert.equal(h.blockedReason, 'transcript_missing'); assert.equal(h.reopenable, true);
  const plain = await w.mgr.resume({ recordId: recId }); assert.equal(plain.status, 409); assert.equal(plain.code, 'transcript_missing');
  const r = await w.mgr.resume({ recordId: recId, reopen: true });
  assert.equal(r.status, 201, r.error); assert.equal(r.session.title, 'Meu construtor'); assert.equal(r.session.role, 'builder'); assert.equal(r.session.provider, 'claude');
  const args = w.spawned.at(-1).args; assert.ok(args.includes('--session-id') && !args.includes('--resume'), args.join(' '));
  assert.notEqual(r.session.recordId, recId); assert.equal(w.db.terminalSessions.find((x) => x.id === recId).supersededBy, r.session.recordId);
  const after = rowOf(w.mgr, recId); assert.equal(after.reopenable, false); assert.equal(after.blockedReason, 'superseded');
  assert.equal((await w.mgr.resume({ recordId: recId, reopen: true })).status, 409, 'não reabre duas vezes');
});

test('reabrir: sessão COM transcrição continua sendo retomada normalmente (--resume), sem reopen', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'reviewer' }); w.withTranscript.add(w.db.terminalSessions[0].claudeSessionId);
  restart(w);
  const h = rowOf(w.mgr, a.session.recordId); assert.equal(h.resumable, true); assert.equal(h.reopenable, false);
  const r = await w.mgr.resume({ recordId: a.session.recordId }); assert.equal(r.status, 201); assert.ok(w.spawned.at(-1).args.includes('--resume'));
});

test('reabrir: Codex nunca é retomável, mas volta como Codex novo; o Claude do mesmo squad volta junto', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder', provider: 'codex' }); const k = await w.mgr.create({ role: 'builder', provider: 'claude' });
  restart(w);
  const hc = rowOf(w.mgr, c.session.recordId), hk = rowOf(w.mgr, k.session.recordId);
  assert.deepEqual([hc.blockedReason, hc.reopenable, hk.blockedReason, hk.reopenable], ['provider_no_resume', true, 'transcript_missing', true]);
  const rc = await w.mgr.resume({ recordId: c.session.recordId, reopen: true }); assert.equal(rc.status, 201, rc.error); assert.equal(rc.session.provider, 'codex'); assert.equal(w.spawned.at(-1).file, '/fake/codex');
  assert.ok(!w.spawned.at(-1).args.includes('--resume'));
});

test('reabrir: só quem ESTAVA aberto (interrompido) pode ser reaberto; terminal fechado pelo usuário, não', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder' }); w.mgr.close(a.session.id);
  const h = rowOf(w.mgr, a.session.recordId); assert.equal(h.state, 'exited');
  const r = await w.mgr.resume({ recordId: a.session.recordId, reopen: true }); assert.equal(r.status, 409); assert.equal(r.code, 'not_reopenable');
});

test('reabrir: o worktree do terminal é reaproveitado (o trabalho em andamento fica na mesma branch); worktree sumido bloqueia a reabertura', async () => {
  const w = world();
  const wtDir = path.join(tmp, `wt-${Math.random().toString(16).slice(2)}`); fs.mkdirSync(wtDir);
  w.db.worktrees = [{ id: 'wt1', workspaceId: 'ws1', state: 'ready', path: wtDir, branch: 'orch/wt1' }];
  const wtApi = { create: async () => ({ ok: true, record: w.db.worktrees[0] }), markInUse() {}, release() {} };
  let m = w.mk({ worktrees: wtApi });
  const a = await m.create({ role: 'builder', isolate: true }); assert.equal(a.status, 201, a.error); assert.equal(a.session.worktreeId, 'wt1');
  m.killAllSync(); m = w.mk({ worktrees: wtApi });
  const r = await m.resume({ recordId: a.session.recordId, reopen: true });
  assert.equal(r.status, 201, r.error); assert.equal(r.session.worktreeId, 'wt1'); assert.equal(r.session.cwd, wtDir); assert.equal(r.session.branch, 'orch/wt1');
  m.killAllSync(); m = w.mk({ worktrees: wtApi }); w.db.worktrees = [];
  assert.equal(rowOf(m, r.session.recordId).reopenable, false);
  const bad = await m.resume({ recordId: r.session.recordId, reopen: true }); assert.equal(bad.status, 409); assert.equal(bad.code, 'worktree_missing');
});

test('restauração automática (cliente): a equipe inteira volta — dupla e squad, retomáveis e reabríveis juntos, na ordem da grade, respeitando as vagas', async () => {
  const w = world();
  const sessions = [await w.mgr.create({ role: 'maestro', title: 'M' }), await w.mgr.create({ role: 'builder', title: 'B1' }), await w.mgr.create({ role: 'builder', provider: 'codex', title: 'B2' }), await w.mgr.create({ role: 'reviewer', title: 'R' })];
  w.withTranscript.add(w.db.terminalSessions[0].claudeSessionId); // só o maestro chegou a conversar
  restart(w);
  const rows = H.historyRows({ history: w.mgr.history(), workspaceId: 'ws1' });
  assert.equal(rows.restore.length, 4, 'os 4 estavam abertos e voltam, não só o que tem conversa');
  assert.deepEqual(rows.restore.map((r) => [r.title, r.resumable, r.reopen]).sort(), [['B1', false, true], ['B2', false, true], ['M', true, false], ['R', false, true]]);
  const fresh = H.lastShutdownRestore(rows.restore); assert.equal(fresh.length, 4);
  const plan = H.restorePlan(fresh, 3); assert.equal(plan.open.length, 3); assert.equal(plan.skipped.length, 1, 'sem vaga para todos: o resto é informado');
  for (const r of H.restorePlan(fresh, 10).open) { const res = await w.mgr.resume(H.resumeBody({ recordId: r.id, reopen: r.reopen })); assert.equal(res.status, 201, `${r.title}: ${res.error}`); }
  assert.deepEqual(w.mgr.list().map((s) => s.title).sort(), ['B1', 'B2', 'M', 'R']); assert.equal(w.mgr.list().find((s) => s.title === 'B2').provider, 'codex');
  assert.equal(sessions.length, 4);
  // depois de tudo reaberto, nada sobra para a próxima restauração além do que está vivo
  restart(w);
  const again = H.historyRows({ history: w.mgr.history(), workspaceId: 'ws1' });
  assert.equal(again.restore.length, 4, 'a próxima restauração traz a equipe atual, não duplicatas das antigas');
});

test('cliente: resumeBody só manda reopen quando é reabertura (e nunca junto com fork); restore sem o campo reopenable segue como antes', () => {
  assert.deepEqual(H.resumeBody({ recordId: 'ses_aaaaaaaa' }), { recordId: 'ses_aaaaaaaa', fork: false, cols: 120, rows: 32 });
  assert.deepEqual(H.resumeBody({ recordId: 'ses_aaaaaaaa', reopen: true, fork: true }), { recordId: 'ses_aaaaaaaa', fork: false, reopen: true, cols: 120, rows: 32 });
  const old = H.historyRows({ history: [{ id: 'ses_aaaaaaaa', workspaceId: 'w', state: 'interrupted', resumable: false, blockedReason: 'transcript_missing' }], workspaceId: 'w' });
  assert.equal(old.restore.length, 0, 'servidor antigo (sem reopenable): continua não restaurando');
});
