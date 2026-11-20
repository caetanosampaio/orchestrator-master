// Terminal de etapa de missão (Missions v2) DENTRO do worktree já criado para a etapa: 2º parâmetro interno `create(opts, { flowWorktreeId })`; `worktreeId` dentro de `opts`
// continua ignorado (como sempre). Repositórios Git REAIS e temporários,
// gerenciador de worktrees REAL, PTY simulado. Prova: cwd = pasta do worktree; só registro com `flow`, do mesmo workspace, utilizável e sem outro terminal; exclusivo com
// isolate/squadId; a rota HTTP não repassa o campo; o worktree é liberado ao terminar; retomada e reabertura voltam ao MESMO worktree; a configuração de projeto é
// inspecionada na pasta do worktree.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flowwt-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data'); // ANTES de importar o store: nunca o banco real
const store = await import('../store.js');
const W = await import('../worktrees.js');
const T = await import('../terminals.js');
const { inspectProjectConfig } = await import('../project-config.js');
const db = store.load(); db.missions = []; db.workspaces = []; db.worktrees = []; db.terminalSessions = []; store.saveOrThrow();
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const G = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const mkRepo = (name) => { const r = path.join(tmp, name); fs.mkdirSync(r); G(r, 'init', '-q', '-b', 'main'); G(r, 'config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(r, 'a.txt'), 'a\n'); G(r, 'add', '-A'); G(r, 'commit', '-q', '-m', 'base'); return r; };
const repo = mkRepo('repo'), repo2 = mkRepo('repo2');
const ws1 = { id: 'ws1', name: 'ws1', path: repo, verifications: [] }, ws2 = { id: 'ws2', name: 'ws2', path: repo2, verifications: [] };
db.workspaces.push(ws1, ws2); db.settings = { ...(db.settings ?? {}), activeWorkspaceId: 'ws1' }; store.saveOrThrow();
const RUN = 'run_0000abcd', BRANCH = `orch/${RUN}`;
const commit = G(repo, 'rev-parse', 'HEAD'); G(repo, 'branch', BRANCH, commit); // branch da missão, sem checkout (a pasta do usuário não muda)
const wtm = W.createWorktreeManager({ db, root: path.join(tmp, 'wts') });

const spawned = []; let pid = 1_900_900_000;
const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, kill() {}, exit(code = 0) { p.exitCb?.({ exitCode: code }); } }; spawned.push(p); return p; } };
const inspected = []; // pastas que a checagem de configuração de projeto olhou (delegando para a inspeção REAL)
const ctl = { killConfirmed: true, alive: true };
const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: 'x', args: [], viaShell: false }), killTree() {}, waitFor: () => ctl.killConfirmed, pidIsAlive: () => ctl.alive, sweepMs: 0,
  worktrees: wtm, transcriptExists: () => true, inspectConfig: async (dir, opts) => { inspected.push(dir); return inspectProjectConfig(dir, opts); } });

let step = 0;
/** Worktree de etapa de missão como o runner cria: da ponta da branch da missão, com `flow`. */
async function flowWt() {
  const r = await wtm.create({ mission: { id: RUN }, workspace: ws1, from: { branch: BRANCH, commit }, flow: { runId: RUN, stepId: `s${++step}` } });
  assert.equal(r.ok, true, r.error); assert.ok(r.record.flow); return r.record;
}
/** Como o runner de missões abre o terminal da etapa: a opção interna vem no 2º parâmetro do create (a rota HTTP nunca o passa). */
const inWt = (wtId, opts = {}) => mgr.create(opts, { flowWorktreeId: wtId });
/** Como o runner de missões retoma a sessão da etapa: DEPOIS de conferir a cópia (configAudit), com `{ audited: true }` no 2º parâmetro (a rota HTTP nunca o passa). */
const asRunner = (opts) => mgr.resume(opts, { audited: true });
const recOf = (sessionId) => db.terminalSessions.find((x) => x.terminalId === sessionId);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const mainHead = () => G(repo, 'rev-parse', 'HEAD'), mainStatus = () => G(repo, 'status', '--porcelain', '-uall');

test('o terminal da etapa roda NA PASTA do worktree da missão: sessão e registro gravam worktreeId, o worktree fica em uso e não há chave de squad', async () => {
  const head0 = mainHead(), wt = await flowWt(); inspected.length = 0;
  const r = await inWt(wt.id, { role: 'builder', workspaceId: 'ws1' });
  assert.equal(r.ok, true, r.error); assert.equal(r.status, 201);
  assert.equal(r.session.worktreeId, wt.id); assert.ok(same(r.session.cwd, wt.path)); assert.ok(same(spawned.at(-1).opts.cwd, wt.path), 'o processo nasce na pasta do worktree');
  assert.equal(r.session.branch, wt.branch); assert.equal(r.session.squadId, null, 'worktree de missão não vira squad');
  const rec = recOf(r.session.id); assert.equal(rec.worktreeId, wt.id); assert.ok(same(rec.cwd, wt.path)); assert.notEqual(rec.sharedWorktree, true);
  assert.equal(wtm.get(wt.id).state, 'in_use'); assert.equal(wtm.get(wt.id).current.taskId, r.session.id);
  assert.deepEqual(inspected.map((d) => same(d, wt.path)), [true], 'a configuração de projeto é inspecionada na pasta do worktree');
  // ninguém se anexa a ele como squad (a sessão não tem chave): squadId inventado é recusado como sempre
  const sq = await mgr.create({ isolate: true, squadId: 'sq_00000000' }); assert.equal(sq.code, 'squad_not_found');
  mgr.close(r.session.id);
  assert.equal(mainHead(), head0); assert.equal(mainStatus(), '', 'a pasta do usuário não mudou');
});

test('`worktreeId` dentro de opts (sem o 2º parâmetro) é IGNORADO, mesmo apontando para um worktree de missão válido: abre na pasta do workspace e o worktree não fica em uso', async () => {
  const wt = await flowWt(); inspected.length = 0;
  const r = await mgr.create({ role: 'builder', workspaceId: 'ws1', worktreeId: wt.id });
  assert.equal(r.ok, true, r.error); assert.equal(r.session.worktreeId, null); assert.ok(same(r.session.cwd, repo)); assert.ok(same(spawned.at(-1).opts.cwd, repo));
  assert.equal(recOf(r.session.id).worktreeId, null); assert.equal(wtm.get(wt.id).state, 'ready', 'o worktree da etapa não foi marcado em uso');
  assert.deepEqual(inspected.map((d) => same(d, repo)), [true], 'a inspeção olhou a pasta do workspace');
  const also = await mgr.create({ worktreeId: wt.id }, {}); assert.equal(also.ok, true, also.error); assert.equal(also.session.worktreeId, null, '2º parâmetro vazio também não liga nada');
  const inside = await inWt(wt.id); assert.equal(inside.ok, true, 'com terminais comuns abertos na pasta, o worktree continua livre para a etapa'); assert.equal(inside.session.worktreeId, wt.id);
  for (const x of [r, also, inside]) mgr.close(x.session.id);
});

test('ao terminar (processo sai ou fechamento) o worktree volta a "terminado"; nada é removido', async () => {
  const wt = await flowWt();
  const a = await inWt(wt.id); assert.equal(a.ok, true, a.error);
  fs.writeFileSync(path.join(wt.path, 'trabalho.txt'), 'x\n');
  spawned.at(-1).exit(0);
  assert.equal(wtm.get(wt.id).state, 'finished'); assert.equal(recOf(a.session.id).state, 'exited'); assert.ok(fs.existsSync(path.join(wt.path, 'trabalho.txt')));
  mgr.close(a.session.id);
  const b = await inWt(wt.id); assert.equal(b.ok, true, 'terminou: o worktree pode receber outro terminal');
  mgr.close(b.session.id); assert.equal(wtm.get(wt.id).state, 'finished'); assert.ok(fs.existsSync(wt.path));
});

test('recusas: formato, inexistente, sem flow, outro workspace, estado/operação inválidos; nenhuma abre terminal', async () => {
  const wt = await flowWt(), count0 = mgr.count(), spawned0 = spawned.length, wts0 = wtm.list().length;
  let r = await inWt(42); assert.deepEqual([r.status, r.code], [400, 'worktree_invalid']);
  r = await inWt('../x'); assert.deepEqual([r.status, r.code], [400, 'worktree_invalid']);
  r = await inWt('wt_deadbeef'); assert.deepEqual([r.status, r.code], [409, 'worktree_missing']);
  const plain = await wtm.create({ mission: { id: 'm_semflow' }, workspace: ws1 }); assert.equal(plain.ok, true, plain.error);
  r = await inWt(plain.record.id); assert.deepEqual([r.status, r.code], [409, 'worktree_not_flow'], 'worktree de terminal/ciclo não serve');
  r = await inWt(wt.id, { workspaceId: 'ws2' }); assert.deepEqual([r.status, r.code, r.reason], [409, 'worktree_invalid', 'workspace']);
  const rec = db.worktrees.find((x) => x.id === wt.id);
  rec.state = 'failed'; r = await inWt(wt.id); assert.deepEqual([r.status, r.code, r.reason], [409, 'worktree_invalid', 'state']); rec.state = 'ready';
  rec.op = { kind: 'snapshot', at: store.now() }; r = await inWt(wt.id); assert.deepEqual([r.status, r.code, r.reason], [409, 'worktree_invalid', 'op']); rec.op = null;
  assert.equal(mgr.count(), count0); assert.equal(spawned.length, spawned0, 'nenhum processo nasceu'); assert.equal(wtm.list().length, wts0 + 1, 'nenhum worktree além do criado pelo próprio teste');
  assert.equal(wtm.get(wt.id).state, 'ready', 'as recusas não marcam o worktree em uso');
});

test('flowWorktreeId é exclusivo com isolate (inclusive "auto") e com squadId: 400 sem nenhum efeito', async () => {
  const wt = await flowWt(), wts0 = wtm.list().length, spawned0 = spawned.length;
  for (const extra of [{ isolate: true }, { isolate: 'auto' }, { squadId: 'sq_00000000' }, { isolate: false, squadId: 'sq_x' }]) {
    const r = await inWt(wt.id, extra); assert.deepEqual([r.status, r.code], [400, 'worktree_exclusive'], JSON.stringify(extra));
  }
  const ok = await inWt(wt.id, { isolate: false, squadId: null }); assert.equal(ok.ok, true, 'isolate false e squadId null não são combinação');
  mgr.close(ok.session.id);
  assert.equal(wtm.list().length, wts0); assert.equal(spawned.length, spawned0 + 1);
});

test('um terminal por worktree de etapa: outro vivo, criação simultânea e processo retido (encerramento não confirmado) recusam com worktree_in_use', async () => {
  const wt = await flowWt();
  const a = await inWt(wt.id); assert.equal(a.ok, true, a.error);
  const b = await inWt(wt.id); assert.deepEqual([b.status, b.code], [409, 'worktree_in_use']);
  mgr.close(a.session.id);
  const [x, y] = await Promise.all([inWt(wt.id), inWt(wt.id)]);
  assert.equal([x, y].filter((r) => r.ok).length, 1, 'só uma das criações simultâneas passa'); assert.equal([x, y].find((r) => !r.ok).code, 'worktree_in_use');
  const live = [x, y].find((r) => r.ok).session;
  ctl.killConfirmed = false; mgr.close(live.id); ctl.killConfirmed = true; // o processo pode estar vivo: fica retido
  assert.equal(wtm.get(wt.id).state, 'in_use', 'retido: o worktree continua em uso');
  const z = await inWt(wt.id); assert.deepEqual([z.status, z.code], [409, 'worktree_in_use']);
  ctl.alive = false; // morte confirmada: o retido sai e o worktree é liberado
  const w = await inWt(wt.id); assert.equal(w.ok, true, w.error); ctl.alive = true;
  mgr.close(w.session.id);
});

test('a rota HTTP POST /api/terminals nunca passa o 2º parâmetro interno nem repassa worktreeId/flowWorktreeId/fullAccess do corpo', async () => {
  const routes = new Map(), app = { get(p, h) { routes.set(`GET ${p}`, h); }, post(p, h) { routes.set(`POST ${p}`, h); } };
  const calls = []; const fake = { create: async (...args) => { calls.push(args); return { ok: true, status: 201, session: { id: 'term_00000000' } }; } };
  T.setupTerminals(app, { manager: fake });
  const handler = routes.get('POST /api/terminals'); assert.ok(handler);
  const res = await new Promise((resolve) => { const r = { code: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; resolve(r); } }; handler({ method: 'POST', url: '/api/terminals', body: { role: 'builder', worktreeId: 'wt_0000abcd', flowWorktreeId: 'wt_0000abcd', fullAccess: true, isolate: false } }, r, () => {}); });
  assert.equal(res.code, 201); assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1, 'a rota chama create só com opts (sem o parâmetro interno)');
  const [o] = calls[0]; for (const k of ['worktreeId', 'flowWorktreeId', 'fullAccess']) assert.ok(!(k in o), `${k} do corpo é descartado`);
});

test('retomada (pelo runner, com audited): resume e resume com reopen voltam ao MESMO worktree de etapa (inspeção na pasta dele); ocupado por outro terminal = worktree_busy', async () => {
  const wt = await flowWt();
  const a = await inWt(wt.id); assert.equal(a.ok, true, a.error); const recId = a.session.recordId;
  mgr.close(a.session.id); assert.equal(wtm.get(wt.id).state, 'finished');
  inspected.length = 0;
  const back = await asRunner({ recordId: recId }); assert.equal(back.ok, true, back.error);
  assert.equal(back.session.worktreeId, wt.id); assert.ok(same(back.session.cwd, wt.path)); assert.ok(same(spawned.at(-1).opts.cwd, wt.path)); assert.ok(spawned.at(-1).args.includes('--resume'));
  assert.equal(back.session.squadId, null); assert.equal(wtm.get(wt.id).state, 'in_use'); assert.ok(inspected.length >= 1 && inspected.every((d) => same(d, wt.path)));
  // reabertura: o servidor "parou" com o terminal aberto -> registro interrompido -> terminal NOVO no mesmo worktree
  mgr.killAllSync(); assert.equal(db.terminalSessions.find((x) => x.id === recId).state, 'interrupted'); assert.equal(wtm.get(wt.id).state, 'finished');
  const re = await asRunner({ recordId: recId, reopen: true }); assert.equal(re.ok, true, re.error);
  assert.equal(re.session.worktreeId, wt.id); assert.ok(same(re.session.cwd, wt.path)); assert.notEqual(re.session.recordId, recId); assert.ok(!spawned.at(-1).args.includes('--resume'));
  assert.equal(recOf(re.session.id).worktreeId, wt.id, 'o registro novo continua apontando para o worktree (próxima retomada)');
  // com o terminal reaberto vivo no worktree, outra sessão da mesma etapa não retoma nele
  const other = await inWt((await flowWt()).id); // sessão de outra etapa só para ter um registro qualquer
  mgr.close(other.session.id);
  const oldRec = db.terminalSessions.find((x) => x.id === other.session.recordId); const save = { worktreeId: oldRec.worktreeId, cwd: oldRec.cwd };
  Object.assign(oldRec, { worktreeId: wt.id, cwd: wt.path }); // aponta para o worktree ocupado
  const busy = await asRunner({ recordId: oldRec.id }); assert.deepEqual([busy.status, busy.code], [409, 'worktree_busy']);
  Object.assign(oldRec, save);
  mgr.close(re.session.id);
  // retido (encerramento não confirmado) também bloqueia a retomada no worktree da etapa
  const c = await inWt(wt.id); assert.equal(c.ok, true, c.error);
  ctl.killConfirmed = false; mgr.close(c.session.id); ctl.killConfirmed = true;
  Object.assign(oldRec, { worktreeId: wt.id, cwd: wt.path });
  const held = await asRunner({ recordId: oldRec.id }); assert.deepEqual([held.status, held.code], [409, 'worktree_busy']);
  ctl.alive = false; const freed = await asRunner({ recordId: oldRec.id }); ctl.alive = true;
  assert.equal(freed.ok, true, freed.error); assert.equal(freed.session.worktreeId, wt.id);
  Object.assign(oldRec, save); mgr.close(freed.session.id);
});

test('configuração de projeto: inspecionada na pasta do WORKTREE (não na do workspace); sem confirmação = 409, com confirmação explícita abre', async () => {
  const wt = await flowWt(), hooks = JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo oi' }] }] } });
  // config não revisada só no workspace principal: o terminal da etapa (no worktree) não é afetado; o terminal comum na pasta é
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), hooks);
  try {
    const plainWs = await mgr.create({}); assert.deepEqual([plainWs.status, plainWs.code], [409, 'project_config_unreviewed'], 'controle: a pasta do workspace tem config');
    const step = await inWt(wt.id); assert.equal(step.ok, true, step.error); mgr.close(step.session.id);
  } finally { fs.rmSync(path.join(repo, '.claude'), { recursive: true, force: true }); }
  // config gravada no worktree por uma etapa anterior (não versionada): recusa até a confirmação explícita
  fs.mkdirSync(path.join(wt.path, '.claude'), { recursive: true }); fs.writeFileSync(path.join(wt.path, '.claude', 'settings.json'), hooks);
  const spawned0 = spawned.length;
  const r = await inWt(wt.id); assert.deepEqual([r.status, r.code], [409, 'project_config_unreviewed']);
  assert.equal(r.files[0].path, '.claude/settings.json'); assert.match(r.error, /worktree desta etapa/); assert.equal(spawned.length, spawned0); assert.equal(wtm.get(wt.id).state, 'finished', 'a recusa não marca o worktree em uso');
  const ack = await inWt(wt.id, { acknowledgeProjectConfig: true }); assert.equal(ack.ok, true, ack.error); assert.ok(same(ack.session.cwd, wt.path));
  mgr.close(ack.session.id);
  // a retomada pelo runner (audited) também inspeciona a pasta do worktree; sem audited nem chega à inspeção
  const back = await asRunner({ recordId: ack.session.recordId }); assert.deepEqual([back.status, back.code], [409, 'project_config_unreviewed']);
  const direct = await mgr.resume({ recordId: ack.session.recordId, acknowledgeProjectConfig: true }); assert.deepEqual([direct.status, direct.code], [409, 'flow_copy_resume'], 'nem a confirmação abre sem a conferência da missão');
  assert.equal(spawned.length, spawned0 + 1, 'só o terminal confirmado nasceu');
});

// ---------- N1 (re-revisão de segurança): sessão de cópia de etapa só reabre pelo runner, depois da conferência da cópia ----------
test('N1: sessão de cópia de etapa SEM { audited: true }: resume, fork e reopen → 409 flow_copy_resume, sem processo nem inspeção; o histórico não a oferece; com audited abre', async () => {
  const wt = await flowWt();
  const a = await inWt(wt.id); assert.equal(a.ok, true, a.error); const recId = a.session.recordId;
  mgr.close(a.session.id);
  const spawned0 = spawned.length, count0 = mgr.count(); inspected.length = 0;
  const refuse = async (opts, extra, label) => {
    const r = extra === undefined ? await mgr.resume(opts) : await mgr.resume(opts, extra);
    assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'flow_copy_resume'], label); assert.match(r.error, /etapa de missão: retome pela missão \(botão Retomar\)/, label);
  };
  for (const [opts, extra, label] of [
    [{ recordId: recId }, undefined, 'resume'], [{ recordId: recId, fork: true }, undefined, 'fork'], [{ recordId: recId, acknowledgeProjectConfig: true }, undefined, 'com confirmação'],
    [{ recordId: recId, audited: true }, undefined, 'audited dentro de opts é ignorado'], [{ recordId: recId }, {}, '2º parâmetro vazio'], [{ recordId: recId }, { audited: 'true' }, 'audited não booleano'],
    [{ recordId: recId }, { audited: 1 }, 'audited 1'], [{ recordId: recId, fork: true }, { audited: false }, 'fork com audited false'],
  ]) await refuse(opts, extra, label);
  assert.equal(spawned.length, spawned0, 'nenhum processo nasceu'); assert.equal(mgr.count(), count0); assert.deepEqual(inspected, [], 'a recusa vem antes de qualquer inspeção');
  assert.equal(wtm.get(wt.id).state, 'finished', 'as recusas não marcam a cópia em uso');
  const h = mgr.history().find((x) => x.id === recId);
  assert.deepEqual([h.resumable, h.reopenable, h.blockedReason], [false, false, 'flow_copy_resume']); assert.match(h.blockedMessage, /retome pela missão/);
  // com audited (o runner, depois do configAudit) abre na cópia
  const back = await asRunner({ recordId: recId }); assert.equal(back.ok, true, back.error); assert.equal(back.session.worktreeId, wt.id); assert.ok(same(spawned.at(-1).opts.cwd, wt.path));
  // reabertura: o servidor "parou" com ela aberta → interrompida; o cliente não a restaura (resumable/reopenable falsos) e a rota recusa
  mgr.killAllSync(); assert.equal(db.terminalSessions.find((x) => x.id === recId).state, 'interrupted');
  const hi = mgr.history().find((x) => x.id === recId);
  assert.deepEqual([hi.state, hi.resumable, hi.reopenable, hi.blockedReason], ['interrupted', false, false, 'flow_copy_resume'], 'a restauração automática do cliente não a pega');
  const sp1 = spawned.length;
  await refuse({ recordId: recId, reopen: true }, undefined, 'reopen'); await refuse({ recordId: recId, reopen: true, fork: true }, undefined, 'reopen+fork');
  assert.equal(spawned.length, sp1);
  const re = await asRunner({ recordId: recId, reopen: true }); assert.equal(re.ok, true, re.error); assert.equal(re.session.worktreeId, wt.id); assert.notEqual(re.session.recordId, recId);
  // o registro novo (mesma cópia) continua protegido
  mgr.close(re.session.id); await refuse({ recordId: re.session.recordId }, undefined, 'registro novo da reabertura');
});

test('N1: a rota HTTP POST /api/terminals/resume nunca passa o 2º parâmetro interno nem repassa audited/flowWorktreeId do corpo', async () => {
  const routes = new Map(), app = { get(p, h) { routes.set(`GET ${p}`, h); }, post(p, h) { routes.set(`POST ${p}`, h); } };
  const calls = []; const fake = { resume: async (...args) => { calls.push(args); return { ok: true, status: 201, session: { id: 'term_00000000' } }; } };
  T.setupTerminals(app, { manager: fake });
  const handler = routes.get('POST /api/terminals/resume'); assert.ok(handler);
  const res = await new Promise((resolve) => { const r = { code: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; resolve(r); } }; handler({ method: 'POST', url: '/api/terminals/resume', body: { recordId: 'ses_0000abcd', audited: true, flowWorktreeId: 'wt_0000abcd', fullAccess: true } }, r, () => {}); });
  assert.equal(res.code, 201); assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1, 'a rota chama resume só com opts (sem o parâmetro interno)');
  const [o] = calls[0]; assert.equal(o.recordId, 'ses_0000abcd'); for (const k of ['audited', 'flowWorktreeId', 'fullAccess']) assert.ok(!(k in o), `${k} do corpo é descartado`);
});

test('N1: sessão na pasta do workspace e de worktree de terminal (isolate) continuam retomáveis como antes, sem audited', async () => {
  const plain = await mgr.create({ role: 'builder' }); assert.equal(plain.ok, true, plain.error); mgr.close(plain.session.id);
  const iso = await mgr.create({ role: 'builder', isolate: true }); assert.equal(iso.ok, true, iso.error); assert.ok(iso.session.worktreeId); mgr.close(iso.session.id);
  assert.ok(!db.worktrees.find((x) => x.id === iso.session.worktreeId).flow, 'controle: worktree de terminal, sem flow');
  for (const s of [plain.session, iso.session]) {
    const h = mgr.history().find((x) => x.id === s.recordId); assert.equal(h.resumable, true, h.blockedReason); assert.equal(h.blockedReason, null);
  }
  const p2 = await mgr.resume({ recordId: plain.session.recordId }); assert.equal(p2.ok, true, p2.error); assert.ok(same(p2.session.cwd, repo)); mgr.close(p2.session.id);
  const i2 = await mgr.resume({ recordId: iso.session.recordId }); assert.equal(i2.ok, true, i2.error); assert.equal(i2.session.worktreeId, iso.session.worktreeId); mgr.close(i2.session.id);
  const f2 = await mgr.resume({ recordId: plain.session.recordId, fork: true }); assert.equal(f2.ok, true, f2.error); assert.notEqual(f2.session.recordId, plain.session.recordId); mgr.close(f2.session.id);
});
