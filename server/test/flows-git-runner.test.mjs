// Missions v2 (fatia 2, F7/F9): MODO GIT do runner de missões com Git REAL em repositórios temporários, gerenciador de worktrees REAL e flow-git REAL; terminais e Maestro SIMULADOS
// (o terminal falso honra `flowWorktreeId`: abre "dentro" do worktree e o teste simula o agente escrevendo arquivos nessa pasta). Relógio e temporizadores injetados; banco temporário
// (ORCH_DATA_DIR antes de importar store.js). Nenhum Claude/Codex real, nenhuma porta, nunca a pasta do projeto.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-git-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const store = await import('../store.js');
const W = await import('../worktrees.js');
const { createFlowGit } = await import('../flow-git.js');
const F = await import('../flows.js');
const gdb = store.load(); gdb.missions = []; store.saveOrThrow(); // o gerenciador de worktrees grava pelo store (banco temporário)
after(() => { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }); // no Windows a remoção pode esbarrar num arquivo recém-fechado pelo Git

const G = (cwd, args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const hex = (n) => n.toString(16).padStart(8, '0');
const T0 = Date.parse('2026-11-19T10:00:00.000Z');
let seq = 0;
function makeRepo(files = { 'a.txt': 'a\n' }) {
  const repo = path.join(tmp, `repo-${++seq}`); fs.mkdirSync(repo);
  G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); }
  G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}
const headOf = (repo) => G(repo, ['rev-parse', 'HEAD']);
const statusOf = (repo) => G(repo, ['status', '--porcelain', '-uall']);
const branchOf = (repo) => G(repo, ['symbolic-ref', '--short', 'HEAD']);
const refOf = (repo, b) => { try { return G(repo, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]); } catch { return null; } };
const showAt = (repo, rev, f) => { try { return execFileSync('git', ['show', `${rev}:${f}`], { cwd: repo, encoding: 'utf8', windowsHide: true }); } catch { return null; } };
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };

/**
 * Mundo: repositório (ou pasta sem Git), workspace, banco PRÓPRIO (dois mundos nunca dividem o runner), gerenciador de worktrees e flow-git reais, terminais/Maestro falsos.
 * `db`/`records`/`repo` permitem "reiniciar o servidor" com uma cópia do banco e o mesmo registro de sessões do gerenciador de terminais.
 */
function world(opts = {}) {
  const n = ++seq;
  let repo = opts.repo;
  if (!repo) { if (opts.git === false) { repo = path.join(tmp, `plain-${n}`); fs.mkdirSync(repo); fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); } else repo = makeRepo(opts.files); }
  const db = opts.db ?? { settings: {}, missions: [], workspaces: [{ id: `ws_${hex(n)}`, name: 'proj', path: repo, verifications: [] }], worktrees: [], flows: [], flowRuns: [] };
  const ws = db.workspaces[0];
  const wtm = W.createWorktreeManager({ db, root: path.join(tmp, `wts-${n}`) });
  const terms = new Map(), created = [], tasks = new Map(), dispatches = [], timers = [], resumeCalls = [], resumeExtras = [], errors = [];
  const records = opts.records ?? new Map(); // registro das sessões (o terminals.json do gerenciador real)
  let tn = opts.base ?? 0, kn = opts.base ?? 0;
  const w = { repo, db, ws, wtm, terms, created, tasks, dispatches, timers, resumeCalls, resumeExtras, errors, records, clock: opts.clock ?? T0, persists: 0, failPersist: 0, fault: null };
  // `inUse`: como o gerenciador REAL de terminais, o terminal aberto numa cópia a marca "em uso" (worktrees.markInUse) e o último a sair a devolve (release): a limpeza recusa cópia em uso
  const inUse = opts.inUse === true;
  const open = (o, cwd, wtId) => {
    const id = `term_${hex(++tn)}`, recordId = `ses_${hex(tn)}`;
    terms.set(id, { id, status: 'running', agent: { state: 'idle', at: '2026-11-19T10:00:00.000Z' }, role: o.role, cwd, worktreeId: wtId });
    records.set(recordId, { cwd, worktreeId: wtId, args: structuredClone(o) });
    if (inUse && wtId) wtm.markInUse(wtId, { round: 0, taskId: id });
    return { id, recordId };
  };
  const exit = (t) => { if (t.status !== 'running') return; t.status = 'exited'; if (inUse && t.worktreeId && ![...terms.values()].some((x) => x.status === 'running' && x.worktreeId === t.worktreeId)) wtm.release(t.worktreeId, 'terminal_ended'); };
  w.exit = (id) => exit(terms.get(id));
  const wtBlock = (wtId) => {
    const r = db.worktrees.find((x) => x.id === wtId);
    if (!r) return { ok: false, status: 409, code: 'worktree_missing', error: 'O worktree informado não existe.' };
    if (!r.flow) return { ok: false, status: 409, code: 'worktree_not_flow', error: 'Este worktree não pertence a uma etapa de missão.' };
    const why = W.worktreeProblem(r, ws.id); if (why) return { ok: false, status: 409, code: 'worktree_invalid', error: `worktree não utilizável (${why})` };
    if ([...terms.values()].some((t) => t.status === 'running' && t.worktreeId === wtId)) return { ok: false, status: 409, code: 'worktree_in_use', error: 'Outro terminal já usa este worktree.' };
    return null;
  };
  w.terminals = {
    async create(o, extra) {
      created.push({ o: structuredClone(o), extra: extra === undefined ? undefined : structuredClone(extra) });
      const wtId = extra?.flowWorktreeId ?? null;
      if (wtId !== null) { const no = wtBlock(wtId); if (no) return no; }
      const s = open(o, wtId ? db.worktrees.find((x) => x.id === wtId).path : ws.path, wtId);
      return { ok: true, status: 201, session: { id: s.id, recordId: s.recordId } };
    },
    resume: opts.noResume ? undefined : async (o, extra) => {
      resumeCalls.push(structuredClone(o)); resumeExtras.push(extra === undefined ? undefined : structuredClone(extra));
      const rec = records.get(o.recordId); if (!rec) return { ok: false, status: 404, code: 'not_found', error: 'Sessão não encontrada.' };
      if (rec.worktreeId) { const r = db.worktrees.find((x) => x.id === rec.worktreeId); if (!r || W.worktreeProblem(r, ws.id)) return { ok: false, status: 409, code: 'worktree_invalid', error: 'O worktree desta sessão não está mais utilizável.' }; }
      // como o real (N1): sessão de cópia de etapa só reabre com o 2º parâmetro interno `audited` (o runner o passa depois de conferir a cópia)
      if (rec.worktreeId && db.worktrees.find((x) => x.id === rec.worktreeId)?.flow && extra?.audited !== true) return { ok: false, status: 409, code: 'flow_copy_resume', error: 'Esta sessão é de uma etapa de missão: retome pela missão.' };
      const s = open(rec.args, rec.cwd, rec.worktreeId); // o mesmo lugar gravado no registro (reopen = terminal novo ali; continue = mesma conversa)
      return { ok: true, status: 201, session: { id: s.id, recordId: o.reopen ? s.recordId : o.recordId } };
    },
    recordInfo: opts.noRecordInfo ? undefined : (id) => { const r = records.get(id); return r ? { id, workspaceId: ws.id, worktreeId: r.worktreeId ?? null } : null; },
    peek: (id) => terms.get(id) ?? null,
    close: (id) => { const t = terms.get(id); if (t) exit(t); return { ok: true }; },
    count: () => [...terms.values()].filter((t) => t.status === 'running').length,
    providers: () => [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }],
  };
  w.maestro = {
    dispatch(d) { const id = `task_${hex(++kn)}`; tasks.set(id, { status: 'delivered', summary: null, note: null }); dispatches.push({ ...d, taskId: id }); return { ok: true, taskId: id }; },
    taskState: (id) => tasks.get(id) ?? null,
  };
  w.persist = () => { w.persists++; if (w.failPersist > 0) { w.failPersist--; throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); } };
  // Git REAL com falha injetável (`w.fault(args)` true = "o Git não respondeu" naquela chamada): só as chamadas do flow-git; o gerenciador de worktrees usa o Git direto
  const runGit = (cwd, args, o) => (w.fault?.(args) ? Promise.resolve({ code: -1, out: '', err: 'git travado (teste)', failed: true, timedOut: false }) : W.git(cwd, args, o));
  w.flowGit = createFlowGit({ db, worktrees: wtm, persist: w.persist, runGit });
  w.flows = F.createFlows({ db, terminals: w.terminals, maestro: w.maestro, flowGit: w.flowGit, persist: w.persist, now: () => new Date(w.clock).toISOString(), uid: store.uid,
    setTimer: (fn) => { const t = { fn, unref() {} }; timers.push(t); return t; }, clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, onError: (e) => errors.push(e), ...(opts.deps ?? {}) });
  w.tick = async () => { w.clock += 1000; await w.flows.tick(); };
  w.make = (steps, extra = {}) => { const r = w.flows.create({ workspaceId: ws.id, title: 'Missão G', goal: 'Meta G', steps, ...extra }); assert.equal(r.ok, true, r.error); w.flow = r.body; return r.body; };
  w.start = async (steps, extra) => { w.make(steps, extra); const r = w.flows.startRun(w.flow.id); assert.equal(r.ok, true, r.error); w.run = r.body; await w.flows.tick(); return w.raw(); };
  w.raw = () => db.flowRuns.find((r) => r.id === w.run.id);
  w.rs = (id) => w.raw().steps.find((s) => s.stepId === id);
  w.view = () => w.flows.getRun(w.flow.id, w.run.id).body;
  w.statuses = () => w.raw().steps.map((s) => s.status);
  w.cwd = (id) => terms.get(w.rs(id).terminalId).cwd;
  w.write = (id, f, c) => { const p = path.join(w.cwd(id), f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w.done = (id, summary = `feito ${id}`) => { Object.assign(tasks.get(w.rs(id).taskId), { status: 'done', summary }); };
  w.branch = () => w.raw().git.branch;
  w.wt = (id) => db.worktrees.find((x) => x.id === w.rs(id).worktreeId);
  /** A pasta do usuário (HEAD, branch e status) continua exatamente como no início. */
  w.snapUser = () => { w.user = { head: headOf(repo), branch: branchOf(repo), status: statusOf(repo) }; };
  w.intact = (msg = 'a pasta do usuário não mudou durante o run') => { assert.equal(headOf(repo), w.user.head, msg); assert.equal(branchOf(repo), w.user.branch, msg); assert.equal(statusOf(repo), w.user.status, msg); };
  /** Modo Git: NENHUM terminal foi aberto sem worktree da etapa (nunca na pasta do usuário). */
  w.noFolderTerminals = () => { assert.ok(created.length > 0); for (const c of created) assert.match(String(c.extra?.flowWorktreeId), /^wt_[0-9a-f]{8}$/, 'terminal de etapa sem flowWorktreeId em modo Git'); };
  return w;
}
/** "Reinicia o servidor": banco copiado (`mutate` simula o que a queda deixou), terminais novos (nenhum vivo), mesmo registro de sessões; recover() executado. */
function reboot(w, { mutate = null, ...opts } = {}) {
  const db = structuredClone(w.db); if (mutate) mutate(db);
  const w2 = world({ repo: w.repo, db, records: w.records, base: 0x100 + (++seq), clock: w.clock, ...opts });
  w2.flow = w.flow; w2.run = w.run; w2.user = w.user; w2.recovered = w2.flows.recover();
  return w2;
}
const B = (id, over = {}) => ({ id, title: `Etapa ${id}`, prompt: `Faça ${id}`, provider: 'claude', role: 'builder', ...over });
const R = (id, over = {}) => B(id, { role: 'scout', ...over });

test('workspace sem Git: modo pasta com o motivo, Construtores serializados na pasta do workspace, terminal sem worktree e sem aviso de cópia isolada', async () => {
  const w = world({ git: false });
  const run = await w.start([B('s1'), B('s2')], { maxParallel: 2 });
  assert.equal(run.git.mode, 'folder'); assert.match(run.git.fallbackReason, /reposit/i);
  assert.deepEqual(w.statuses(), ['running', 'pending'], 'dois Construtores na mesma pasta não rodam juntos');
  assert.equal(w.created.length, 1); assert.equal(w.created[0].extra, undefined, 'modo pasta: create sem o 2º parâmetro'); assert.equal(w.cwd('s1'), w.repo);
  assert.doesNotMatch(w.dispatches[0].text, /cópia isolada/);
  w.done('s1'); await w.tick(); assert.deepEqual(w.statuses(), ['completed', 'running']); assert.equal(w.rs('s1').integration, undefined);
  w.done('s2'); await w.tick(); assert.equal(w.raw().status, 'completed'); assert.equal(w.view().git.mode, 'folder');
  assert.match(w.view().git.fallbackReason, /reposit/i, 'o motivo do modo pasta sai na API (o cliente mostra)');
  assert.match(w.flows.list().find((f) => f.id === w.flow.id).lastRun.git.fallbackReason, /reposit/i);
});

test('paralelo: dois Construtores em worktrees próprios (sem serializar), integrados na branch da missão; o dependente enxerga os dois; a pasta do usuário (suja) não muda e a alteração dela não entra; integração final espera a pasta limpa (target_dirty) e Integrar pelo usuário', async () => {
  const w = world({ files: { 'a.txt': 'a\n' } });
  fs.writeFileSync(path.join(w.repo, 'a.txt'), 'mudança do usuário\n'); // alteração NÃO commitada do usuário
  w.snapUser();
  const run = await w.start([B('s1'), B('s2'), B('s3', { dependsOn: ['s1', 's2'] })], { maxParallel: 2 });
  assert.equal(run.git.mode, 'git'); assert.equal(run.git.branch, `orch/${run.id}`); assert.equal(run.git.baseBranch, 'main'); assert.equal(run.git.tip, w.user.head); assert.equal(run.git.state, 'ready');
  assert.equal(refOf(w.repo, run.git.branch), w.user.head, 'branch da missão criada sem checkout');
  assert.deepEqual(w.statuses(), ['running', 'running', 'pending'], 'modo Git: Construtores em paralelo');
  assert.notEqual(w.cwd('s1'), w.cwd('s2')); for (const s of ['s1', 's2']) { assert.notEqual(w.cwd(s), w.repo); assert.equal(w.wt(s).flow.runId, run.id); assert.equal(w.wt(s).baseBranch, run.git.branch); }
  assert.equal(read(w.cwd('s1'), 'a.txt'), 'a\n', 'a cópia parte da branch da missão, sem a alteração não commitada do usuário');
  assert.match(w.dispatches[0].text, /cópia isolada.*não troque de branch nem faça merge/);
  w.intact();
  w.write('s1', 'b.txt', 'B\n'); w.write('s2', 'c.txt', 'C\n');
  w.done('s1'); await w.tick(); w.done('s2'); await w.tick();
  const r1 = w.raw();
  assert.deepEqual([w.rs('s1').integration.state, w.rs('s2').integration.state], ['integrated', 'integrated']);
  assert.equal(showAt(w.repo, r1.git.branch, 'b.txt'), 'B\n'); assert.equal(showAt(w.repo, r1.git.branch, 'c.txt'), 'C\n');
  assert.equal(refOf(w.repo, r1.git.branch), r1.git.tip);
  assert.equal(w.rs('s3').status, 'running'); assert.equal(read(w.cwd('s3'), 'b.txt'), 'B\n'); assert.equal(read(w.cwd('s3'), 'c.txt'), 'C\n'); assert.equal(read(w.cwd('s3'), 'a.txt'), 'a\n');
  assert.match(w.dispatches.at(-1).text, /Resultado anterior de "Etapa s1"/, 'os resumos das dependências continuam indo no texto');
  w.intact();
  w.write('s3', 'd.txt', 'D\n'); w.done('s3'); await w.tick();
  const r2 = w.raw();
  assert.equal(r2.status, 'ready_to_integrate'); assert.ok(r2.git.pending.reasons.some((x) => x.code === 'target_dirty'), JSON.stringify(r2.git.pending)); assert.match(r2.error, /Integração automática não feita/);
  assert.equal(showAt(w.repo, r2.git.branch, 'a.txt'), 'a\n', 'a alteração do usuário não entrou na missão');
  w.intact('integração automática recusada: a pasta continua igual');
  const dirty = await w.flows.integrateRun(w.flow.id, run.id, {}); assert.equal(dirty.status, 409); assert.equal(dirty.code, 'target_dirty'); w.intact();
  assert.equal((await w.flows.integrateRun(w.flow.id, run.id, { acknowledgeProjectConfig: 'sim' })).status, 400);
  assert.equal((await w.flows.integrateRun(w.flow.id, run.id, { force: true })).status, 400);
  G(w.repo, ['checkout', '--', 'a.txt']); // o usuário limpa a pasta
  const ok = await w.flows.integrateRun(w.flow.id, run.id, {});
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.body.status, 'completed');
  const gi = ok.body.git.integration; assert.deepEqual([gi.by, gi.mode, gi.policy], ['user', 'ff', 'user']); assert.match(gi.digest, /^[0-9a-f]{32}$/);
  assert.equal(headOf(w.repo), r2.git.tip); assert.equal(statusOf(w.repo), ''); for (const [f, c] of [['b.txt', 'B\n'], ['c.txt', 'C\n'], ['d.txt', 'D\n']]) assert.equal(read(w.repo, f), c);
  assert.ok(!('repoPath' in ok.body.git)); assert.ok(ok.body.steps.every((s) => !('worktreePath' in s) && !('recordId' in s)));
  for (const id of w.raw().ownedTerminalIds) assert.equal(w.terms.get(id).status, 'exited', 'terminais ociosos fechados');
  assert.ok(w.db.worktrees.filter((x) => x.flow?.runId === run.id).every((x) => x.state === 'removed'), 'cópias removidas');
  assert.deepEqual(w.raw().git.leftovers, []); assert.equal(w.raw().git.branchDeleted, true); assert.equal(refOf(w.repo, run.git.branch), null);
  assert.equal((await w.flows.integrateRun(w.flow.id, run.id, {})).code, 'not_ready');
  w.noFolderTerminals();
});

test('fim com autoIntegrate: Batedor sem alterações = empty; pasta do usuário recebe os arquivos, run completed com by auto + digest; terminal ocioso fecha e o que trabalha fica; cópias limpas', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1'), R('s2', { dependsOn: ['s1'] })]);
  w.write('s1', 'x.txt', 'X\n'); w.done('s1'); await w.tick();
  assert.equal(w.rs('s1').integration.state, 'integrated'); assert.equal(w.rs('s2').status, 'running'); assert.equal(read(w.cwd('s2'), 'x.txt'), 'X\n', 'o Batedor lê a ponta da missão');
  w.intact();
  const t2 = w.rs('s2').terminalId;
  w.done('s2'); w.terms.get(t2).agent = { state: 'running', at: 'x' }; await w.tick(); // o agente de s2 voltou a trabalhar depois do report_done
  const r = w.raw();
  assert.equal(w.rs('s2').integration.state, 'empty');
  assert.equal(r.status, 'completed', r.error); assert.deepEqual([r.git.integration.by, r.git.integration.policy, r.git.integration.mode], ['auto', 'autoIntegrate', 'ff']); assert.match(r.git.integration.digest, /^[0-9a-f]{32}$/);
  assert.equal(headOf(w.repo), r.git.tip); assert.equal(read(w.repo, 'x.txt'), 'X\n'); assert.equal(statusOf(w.repo), '');
  assert.equal(w.terms.get(w.rs('s1').terminalId).status, 'exited', 'ocioso fecha'); assert.equal(w.terms.get(t2).status, 'running', 'quem trabalha fica');
  assert.equal(w.wt('s1').state, 'removed'); assert.ok(Array.isArray(r.git.leftovers)); assert.ok(r.git.cleanedAt);
  assert.ok(gdb.activity.some((a) => a.type === 'flow' && a.runId === run.id && /integrada em main .*automática/.test(a.message)), 'a integração automática foi registrada no log');
  w.noFolderTerminals();
});

test('continueFrom em modo Git: terminal anterior vivo = mesmo terminal e mesmo worktree avançado até a ponta; terminal anterior morto = terminal novo no worktree da anterior', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1'), B('s2', { dependsOn: ['s1'], continueFrom: 's1' }), R('s3'), B('s4', { dependsOn: ['s2', 's3'], continueFrom: 's2' })], { maxParallel: 2 });
  w.write('s3', 'r.txt', 'R\n'); w.done('s3'); w.write('s1', 'k.txt', '1\n'); w.done('s1'); await w.tick(); // s3 integra antes: a ponta da missão anda além do worktree de s1
  assert.equal(w.rs('s2').status, 'running'); assert.equal(w.rs('s2').terminalId, w.rs('s1').terminalId, 'terminal vivo reaproveitado');
  assert.equal(w.rs('s2').worktreeId, w.rs('s1').worktreeId); assert.equal(read(w.cwd('s2'), 'r.txt'), 'R\n', 'o worktree avançou até a ponta (fast-forward)');
  assert.deepEqual(w.wt('s2').flow.stepIds, ['s1', 's2']);
  w.write('s2', 'k.txt', '2\n'); w.done('s2'); w.terms.get(w.rs('s2').terminalId).status = 'exited'; await w.tick(); // o terminal morreu depois do report_done
  assert.equal(w.rs('s2').integration.state, 'integrated'); assert.equal(w.rs('s4').status, 'running');
  assert.notEqual(w.rs('s4').terminalId, w.rs('s2').terminalId, 'terminal novo'); assert.equal(w.rs('s4').worktreeId, w.rs('s2').worktreeId); assert.equal(w.created.at(-1).extra.flowWorktreeId, w.rs('s2').worktreeId);
  assert.equal(read(w.cwd('s4'), 'k.txt'), '2\n');
  w.done('s4'); await w.tick();
  assert.equal(w.raw().status, 'completed', w.raw().error); assert.equal(read(w.repo, 'k.txt'), '2\n'); assert.equal(read(w.repo, 'r.txt'), 'R\n');
  w.noFolderTerminals(); void run;
});

test('conflito: a 2ª etapa a integrar conflita; nada novo começa (nem a independente); retry sem resolver = 409; resolvido no worktree, retry integra e as próximas começam', async () => {
  const w = world({ files: { 'a.txt': 'base\n' } }); w.snapUser();
  const run = await w.start([B('s1'), B('s2'), B('s3', { dependsOn: ['s2'] }), R('s4')], { maxParallel: 2 });
  assert.deepEqual(w.statuses(), ['running', 'running', 'pending', 'pending']);
  w.write('s1', 'a.txt', 's1\n'); w.write('s2', 'a.txt', 's2\n');
  w.done('s1'); w.done('s2'); await w.tick(); // as duas terminam no mesmo passo: s1 integra primeiro (ordem de conclusão) e s2 conflita antes de qualquer etapa nova começar
  assert.equal(w.rs('s1').integration.state, 'integrated'); const i2 = w.rs('s2').integration;
  assert.equal(i2.state, 'conflict'); assert.deepEqual(i2.conflicts, ['a.txt']);
  assert.deepEqual(w.statuses(), ['completed', 'completed', 'pending', 'pending'], 'conflito segura TODAS as etapas novas');
  await w.tick(); assert.deepEqual(w.statuses(), ['completed', 'completed', 'pending', 'pending']); assert.equal(w.raw().status, 'running');
  const v = w.view(); assert.equal(v.steps[1].worktreePath, w.wt('s2').path, 'o caminho do worktree aparece só na etapa com conflito'); assert.ok(!('worktreePath' in v.steps[0])); assert.ok(!('repoPath' in v.git));
  const url = (s, b) => w.flows.stepIntegration(w.flow.id, run.id, s, b);
  assert.equal((await url('s2', { action: 'merge' })).status, 400); assert.equal((await url('s2', { action: 'retry', x: 1 })).status, 400); assert.equal((await url('s2', { action: 'retry', acknowledgeProjectConfig: 1 })).status, 400);
  assert.equal((await url('s9', { action: 'retry' })).status, 404); assert.equal((await url('s1', { action: 'retry' })).code, 'not_blocked');
  const again = await url('s2', { action: 'retry' }); assert.equal(again.status, 409); assert.equal(again.code, 'conflict'); assert.deepEqual(again.extra.conflicts, ['a.txt']);
  // o usuário resolve no worktree da etapa (merge da ponta da missão mantendo a versão da etapa)
  G(w.wt('s2').path, ['merge', '--no-edit', '-q', '-X', 'ours', w.raw().git.tip]);
  const ok = await url('s2', { action: 'retry' }); assert.equal(ok.status, 200, ok.error); assert.equal(w.rs('s2').integration.state, 'integrated');
  await w.tick();
  assert.deepEqual(w.statuses(), ['completed', 'completed', 'running', 'running']); assert.equal(read(w.cwd('s3'), 'a.txt'), 's2\n');
  assert.equal(showAt(w.repo, w.raw().git.branch, 'a.txt'), 's2\n');
  w.intact(); w.noFolderTerminals();
});

test('descartar a etapa em conflito: falha com discardedBy user, dependentes pulados, run falha como hoje; Descartar o run falho mantém o status, a branch e as cópias com trabalho', async () => {
  const w = world({ files: { 'a.txt': 'base\n' } }); w.snapUser();
  const run = await w.start([B('s1'), B('s2'), B('s3', { dependsOn: ['s2'] })], { maxParallel: 2 });
  w.write('s1', 'a.txt', 's1\n'); w.write('s2', 'a.txt', 's2\n'); w.done('s1'); await w.tick(); w.done('s2'); await w.tick();
  assert.equal(w.rs('s2').integration.state, 'conflict');
  const d = await w.flows.stepIntegration(w.flow.id, run.id, 's2', { action: 'discard' });
  assert.equal(d.status, 200); const s2 = d.body.steps[1]; assert.deepEqual([s2.status, s2.discardedBy, s2.integration.state], ['failed', 'user', 'none']); assert.ok(!('worktreePath' in s2));
  await w.tick();
  assert.deepEqual(w.statuses(), ['completed', 'failed', 'skipped']); assert.equal(w.raw().status, 'failed'); assert.match(w.raw().error, /Etapa s2/);
  w.intact();
  const branch = w.branch(); assert.ok(refOf(w.repo, branch), 'a branch da missão fica');
  assert.equal((await w.flows.discardRun(w.flow.id, run.id, { deleteBranch: 1 })).status, 400);
  const dr = await w.flows.discardRun(w.flow.id, run.id, { deleteBranch: false });
  assert.equal(dr.status, 200, dr.error); assert.equal(dr.body.status, 'failed', 'cancelled/failed mantêm o status'); assert.ok(dr.body.git.discardedAt); assert.equal(dr.body.git.branchDeleted, false);
  assert.ok(refOf(w.repo, branch)); assert.equal(w.wt('s1').state, 'removed', 'cópia integrada sai');
  assert.ok(dr.body.git.leftovers.some((x) => x.worktreeId === w.rs('s2').worktreeId), 'cópia com trabalho não integrado fica (leftover)');
  assert.equal((await w.flows.discardRun(w.flow.id, run.id, {})).code, 'already_discarded');
  w.intact(); w.noFolderTerminals();
});

test('autoIntegrate false: ready_to_integrate com o diagnóstico (assessFinal); Descartar com deleteBranch apaga a branch, run discarded e a pasta do usuário intocada', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')], { autoIntegrate: false });
  w.write('s1', 'n.txt', 'N\n'); w.done('s1'); await w.tick();
  const r = w.raw();
  assert.equal(r.status, 'ready_to_integrate'); assert.equal(r.error, null); assert.deepEqual(r.git.pending.reasons, []); assert.ok(r.git.pending.checkedAt); assert.equal(r.git.integration, null);
  assert.equal(w.flows.cancelRun(w.flow.id, run.id).status, 409);
  assert.equal((await w.flows.cleanupRunCopies(w.flow.id, run.id, {})).code, 'not_ready');
  w.intact();
  const tid = w.rs('s1').terminalId;
  const d = await w.flows.discardRun(w.flow.id, run.id, { deleteBranch: true });
  assert.equal(d.status, 200, d.error); assert.equal(d.body.status, 'discarded'); assert.equal(d.body.git.branchDeleted, true); assert.ok(d.body.finishedAt);
  assert.equal(refOf(w.repo, r.git.branch), null); assert.equal(w.wt('s1').state, 'removed'); assert.equal(w.terms.get(tid).status, 'exited');
  assert.equal(read(w.repo, 'n.txt'), null); w.intact();
  assert.equal((await w.flows.integrateRun(w.flow.id, run.id, {})).code, 'not_ready');
  assert.equal(w.flows.startRun(w.flow.id).ok, true, 'discarded não bloqueia um run novo');
});

test('configuração executável (.claude/settings.json): integração da etapa bloqueada; retry só passa com ack; a final automática nunca reconhece sozinha; Integrar com ack (by user)', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')]);
  w.write('s1', '.claude/settings.json', '{"hooks":{}}\n'); w.done('s1'); await w.tick();
  const i = w.rs('s1').integration; assert.equal(i.state, 'blocked'); assert.deepEqual(i.files, ['.claude/settings.json']); assert.equal(w.raw().status, 'running');
  assert.equal(w.view().steps[0].worktreePath, w.wt('s1').path);
  assert.equal(w.view().steps[0].integration.reason, 'project_config_changed', 'C3: o motivo sai na API');
  const no = await w.flows.stepIntegration(w.flow.id, run.id, 's1', { action: 'retry' }); assert.equal(no.code, 'project_config_changed'); assert.deepEqual(no.extra.files, ['.claude/settings.json']);
  // C1: confirmação sem a lista = 400; lista vista e o agente grava outro arquivo guardado depois = 409 com a lista nova e a etapa continua blocked
  assert.equal((await w.flows.stepIntegration(w.flow.id, run.id, 's1', { action: 'retry', acknowledgeProjectConfig: true })).status, 400);
  assert.equal((await w.flows.stepIntegration(w.flow.id, run.id, 's1', { action: 'retry', acknowledgedFiles: ['.claude/settings.json'] })).status, 400);
  w.write('s1', '.mcp.json', '{"mcpServers":{}}\n');
  const stale = await w.flows.stepIntegration(w.flow.id, run.id, 's1', { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: no.extra.files });
  assert.equal(stale.status, 409); assert.equal(stale.code, 'project_config_changed'); assert.deepEqual([...stale.extra.files].sort(), ['.claude/settings.json', '.mcp.json']); assert.equal(w.rs('s1').integration.state, 'blocked');
  const yes = await w.flows.stepIntegration(w.flow.id, run.id, 's1', { action: 'retry', acknowledgeProjectConfig: true, acknowledgedFiles: stale.extra.files }); assert.equal(yes.status, 200, yes.error); assert.equal(w.rs('s1').integration.state, 'integrated');
  await w.tick();
  const r = w.raw(); assert.equal(r.status, 'ready_to_integrate'); assert.ok(r.git.pending.reasons.some((x) => x.code === 'project_config_changed')); assert.equal(r.git.integration, null, 'by auto nunca reconhece configuração');
  w.intact();
  const f = await w.flows.integrateRun(w.flow.id, run.id, {}); assert.equal(f.code, 'project_config_changed'); assert.deepEqual([...f.extra.files].sort(), ['.claude/settings.json', '.mcp.json']); w.intact();
  assert.equal((await w.flows.integrateRun(w.flow.id, run.id, { acknowledgeProjectConfig: true })).status, 400, 'sem a lista = 400');
  const part = await w.flows.integrateRun(w.flow.id, run.id, { acknowledgeProjectConfig: true, acknowledgedFiles: ['.claude/settings.json'] });
  assert.equal(part.status, 409); assert.equal(part.code, 'project_config_changed'); assert.equal(w.raw().status, 'ready_to_integrate'); w.intact();
  const ok = await w.flows.integrateRun(w.flow.id, run.id, { acknowledgeProjectConfig: true, acknowledgedFiles: f.extra.files });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.body.git.integration.by, 'user'); assert.deepEqual([...ok.body.git.integration.acknowledgedFiles].sort(), ['.claude/settings.json', '.mcp.json']);
  assert.equal(read(w.repo, '.claude/settings.json'), '{"hooks":{}}\n');
});

test('queda no meio da integração da etapa: recover → interrupted; recoverGit concilia pelo Git (integrating → integrated); Retomar reabre a etapa no worktree dela (mesma conversa) com o trabalho parcial', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1'), B('s2', { dependsOn: ['s1'] })]);
  w.write('s1', 'f1.txt', '1\n'); w.done('s1'); await w.tick();
  assert.equal(w.rs('s1').integration.state, 'integrated'); assert.equal(w.rs('s2').status, 'running'); assert.ok(w.rs('s2').taskId);
  const wt2 = w.wt('s2'); w.write('s2', 'f2.txt', 'parcial\n');
  // a ref da missão já está em `to`, mas o servidor caiu antes de gravar o resultado: o diário ficou `integrating`
  const w2 = reboot(w, { mutate: (db) => { const s1 = db.flowRuns.find((r) => r.id === run.id).steps[0]; s1.integration = { ...s1.integration, state: 'integrating' }; } });
  assert.equal(w2.recovered, 1); assert.equal(w2.raw().status, 'interrupted'); assert.deepEqual([w2.rs('s2').status, w2.rs('s2').delivered], ['interrupted', true]);
  assert.equal(w2.created.length + w2.resumeCalls.length, 0, 'nada é reaberto no boot');
  assert.equal(await w2.flows.recoverGit(), 1); assert.equal(w2.rs('s1').integration.state, 'integrated'); assert.equal(w2.raw().status, 'interrupted', 'a conciliação não retoma nada');
  const res = await w2.flows.resumeRun(w.flow.id, run.id, {}); assert.equal(res.status, 200, res.error); assert.equal(res.body.status, 'running');
  await w2.tick();
  assert.deepEqual(w2.resumeCalls[0], { recordId: w.rs('s2').recordId }); assert.equal(w2.rs('s2').resumeMode, 'continue');
  assert.equal(w2.cwd('s2'), wt2.path, 'reaberta no worktree da etapa'); assert.equal(read(w2.cwd('s2'), 'f2.txt'), 'parcial\n');
  w2.done('s2'); await w2.tick();
  assert.equal(w2.raw().status, 'completed', w2.raw().error); assert.equal(read(w.repo, 'f2.txt'), 'parcial\n'); assert.equal(read(w.repo, 'f1.txt'), '1\n');
});

test('retomada pelo create: worktree da etapa ainda utilizável = terminal novo NELE (flowWorktreeId); inutilizável = cópia nova da ponta com a perda anotada; branch da missão sumiu = 409 mission_branch_missing', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')]);
  w.write('s1', 'p.txt', 'parcial\n');
  const old = w.wt('s1');
  // (a) sem interface de retomada: create no MESMO worktree
  const a = reboot(w, { noResume: true });
  assert.equal((await a.flows.resumeRun(w.flow.id, run.id)).status, 200); await a.tick();
  assert.equal(a.created.length, 1); assert.equal(a.created[0].extra.flowWorktreeId, old.id); assert.equal(a.cwd('s1'), old.path); assert.equal(a.rs('s1').resumeMode, 'restart');
  assert.match(a.dispatches[0].text, /Retomada: pode haver trabalho parcial.*cópia isolada/);
  // (b) o registro do worktree ficou inutilizável: worktree NOVO da ponta, a etapa anota que o parcial não veio
  const b = reboot(w, { noResume: true, mutate: (db) => { db.worktrees.find((x) => x.id === old.id).state = 'failed'; } });
  assert.equal((await b.flows.resumeRun(w.flow.id, run.id)).status, 200); await b.tick();
  assert.notEqual(b.rs('s1').worktreeId, old.id); assert.equal(b.created.at(-1).extra.flowWorktreeId, b.rs('s1').worktreeId); assert.equal(read(b.cwd('s1'), 'p.txt'), null);
  assert.match(b.rs('s1').note, /cópia nova.*não veio junto/); assert.equal(read(old.path, 'p.txt'), 'parcial\n', 'nada foi apagado');
  // (c) operação em andamento no worktree: a etapa falha sem apagar nada
  const c = reboot(w, { noResume: true, mutate: (db) => { db.worktrees.find((x) => x.id === old.id).op = { kind: 'cleanup', at: 't' }; } });
  assert.equal((await c.flows.resumeRun(w.flow.id, run.id)).status, 200); await c.tick();
  assert.equal(c.rs('s1').status, 'failed'); assert.match(c.rs('s1').error, /operação em andamento/); assert.equal(c.created.length, 0); assert.ok(fs.existsSync(old.path));
  // (d) a branch da missão sumiu: 409 e o run continua interrompido
  const d = reboot(w);
  G(w.repo, ['branch', '-D', w.branch()]);
  const r = await d.flows.resumeRun(w.flow.id, run.id, {}); assert.equal(r.status, 409); assert.equal(r.code, 'mission_branch_missing'); assert.equal(d.raw().status, 'interrupted');
  w.intact();
  for (const x of [a, b]) x.noFolderTerminals();
});

test('queda no meio da integração final: recoverGit concilia pelo HEAD real (merge feito = completed com by e digest do diário; pasta inalterada = ready_to_integrate)', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')], { autoIntegrate: false });
  w.write('s1', 'z.txt', 'Z\n'); w.done('s1'); await w.tick();
  assert.equal(w.raw().status, 'ready_to_integrate');
  const tip = w.raw().git.tip, oldHead = headOf(w.repo);
  const crash = (db) => { const r = db.flowRuns.find((x) => x.id === run.id); r.status = 'running'; r.git.op = { kind: 'final_integrate', at: 't', oldHead, newCommit: tip, by: 'auto', mode: 'ff', digest: 'd'.repeat(32), missionTip: tip, policy: 'autoIntegrate' }; };
  // (a) caiu antes do merge: a pasta não mudou
  const a = reboot(w, { mutate: crash });
  assert.equal(a.raw().status, 'interrupted'); assert.equal(await a.flows.recoverGit(), 1);
  assert.equal(a.raw().status, 'ready_to_integrate'); assert.equal(a.raw().git.op, null); assert.match(a.raw().error, /pasta não mudou/); assert.equal(headOf(w.repo), oldHead);
  // (b) caiu depois do merge: o Git mostra o HEAD novo
  G(w.repo, ['merge', '--ff-only', '-q', tip]);
  const b = reboot(w, { mutate: crash });
  assert.equal(await b.flows.recoverGit(), 1);
  const r = b.raw(); assert.equal(r.status, 'completed'); assert.deepEqual([r.git.integration.by, r.git.integration.from, r.git.integration.to, r.git.integration.digest], ['auto', oldHead, tip, 'd'.repeat(32)]);
  assert.equal(r.git.op, null); assert.equal(b.wt('s1').state, 'removed');
});

test('poda dos 200 runs: run com branch não apagada ou com cópias que sobraram fica; sem outro candidato, sai e vai para o log', () => {
  const w = world({ git: false });
  w.make([B('s1')]);
  const old = (i, git = null) => ({ id: `run_${hex(0xa0000000 + i)}`, flowId: w.flow.id, status: 'completed', steps: [], git });
  w.db.flowRuns = Array.from({ length: F.MAX_RUNS }, (_, i) => old(i, i < 2 ? { mode: 'git', branch: `orch/run_${hex(0xa0000000 + i)}`, branchDeleted: false, leftovers: [] } : i === 2 ? { mode: 'git', branch: 'x', branchDeleted: true, leftovers: [{ worktreeId: 'wt_1', reason: 'r' }] } : null));
  assert.equal(w.flows.startRun(w.flow.id).ok, true);
  const ids = w.db.flowRuns.map((r) => r.id);
  assert.equal(ids.length, F.MAX_RUNS); for (const i of [0, 1, 2]) assert.ok(ids.includes(old(i).id), `run ${i} com Git fica`); assert.ok(!ids.includes(old(3).id), 'o mais antigo sem Git sai');
  w.flows.cancelRun(w.flow.id, w.db.flowRuns.at(-1).id);
  w.db.flowRuns = Array.from({ length: F.MAX_RUNS }, (_, i) => old(i, { mode: 'git', branch: `orch/run_${hex(0xa0000000 + i)}`, branchDeleted: false, leftovers: [] }));
  assert.equal(w.flows.startRun(w.flow.id).ok, true);
  assert.ok(!w.db.flowRuns.some((r) => r.id === old(0).id), 'sem outro candidato, o mais antigo sai mesmo com branch');
  assert.ok(JSON.stringify(gdb).includes(`Execução ${old(0).id} saiu do histórico`), 'e fica registrado no log');
});

// ---------- correções das revisões (I1, C2, código 3 e 4, opcionais 1 e O3) ----------
test('I1: o agente commitou .claude/settings.json na cópia: a retomada (continue, reopen e create) NÃO abre terminal nela e a etapa falha com a lista; a cópia limpa reabre', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1'), B('s2')], { maxParallel: 2 });
  w.write('s1', '.claude/settings.json', '{"hooks":{"SessionStart":[]}}\n');
  const p1 = w.cwd('s1'); G(p1, ['add', '-A']); G(p1, ['commit', '-q', '-m', 'agente']); // para o terminals.js isto estaria "versionado no HEAD"
  const wt1 = w.rs('s1').worktreeId, rec1 = w.rs('s1').recordId;
  const check = async (x, label) => {
    const r = await x.flows.resumeRun(w.flow.id, run.id, {}); assert.equal(r.status, 200, r.error); await x.tick();
    const s1 = x.rs('s1');
    assert.equal(s1.status, 'failed', label); assert.match(s1.error, /\.claude\/settings\.json/, label); assert.match(s1.error, /revis/, label); assert.equal(s1.resumePending, false);
    assert.ok(!x.created.some((c) => c.extra?.flowWorktreeId === wt1), `${label}: nenhum terminal novo na cópia de s1`);
    assert.ok(!x.resumeCalls.some((c) => c.recordId === rec1), `${label}: o registro de s1 não foi reaberto`);
    assert.equal(s1.worktreeId, wt1, `${label}: nada de cópia nova para fugir da revisão`);
    assert.equal(x.rs('s2').status, 'running', `${label}: a cópia limpa reabre`); assert.ok(x.rs('s2').terminalId);
  };
  await check(reboot(w), 'continue');
  await check(reboot(w, { mutate: (db) => { for (const s of db.flowRuns.find((r) => r.id === run.id).steps) s.taskId = null; } }), 'reopen');
  await check(reboot(w, { noResume: true }), 'create');
  w.intact();
});

test('I1: Git sem resposta na conferência da cópia = a retomada não abre o terminal e a etapa falha com o motivo', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')]);
  const x = reboot(w, { noResume: true });
  const r = await x.flows.resumeRun(w.flow.id, run.id, {}); assert.equal(r.status, 200, r.error);
  x.fault = (args) => args[0] === 'diff' || args[0] === 'status';
  await x.tick();
  assert.equal(x.rs('s1').status, 'failed'); assert.match(x.rs('s1').error, /conferir a cópia.*não foi aberto/); assert.equal(x.created.length, 0);
});

test('C2: run falho com terminais vivos (cópias "em uso"): Descartar fecha o ocioso ANTES e limpa a cópia dele; a do terminal ocupado vira leftover; Limpar depois de ele parar remove; already_discarded não impede Limpar', async () => {
  const w = world({ inUse: true }); w.snapUser();
  const run = await w.start([B('s1'), B('s2'), B('s3', { dependsOn: ['s2'] })], { maxParallel: 2 });
  assert.deepEqual([w.wt('s1').state, w.wt('s2').state], ['in_use', 'in_use'], 'o terminal marca a cópia em uso, como o real');
  const t1 = w.rs('s1').terminalId, t2 = w.rs('s2').terminalId, wt2 = w.rs('s2').worktreeId;
  w.write('s1', 'um.txt', '1\n'); w.done('s1');
  Object.assign(w.tasks.get(w.rs('s2').taskId), { status: 'failed', note: 'quebrou' }); w.terms.get(t2).agent = { state: 'running', at: 'x' }; // s2 falha, mas o agente segue trabalhando
  await w.tick();
  assert.equal(w.raw().status, 'failed'); assert.deepEqual(w.statuses(), ['completed', 'failed', 'skipped']); assert.equal(w.rs('s1').integration.state, 'integrated');
  assert.equal(w.terms.get(t1).status, 'running', 'o run falho deixa os terminais'); assert.equal(w.wt('s1').state, 'in_use');
  assert.equal((await w.flows.cleanupRunCopies(w.flow.id, run.id, {})).code, 'nothing_to_clean', 'sem Descartar ainda não há leftovers');
  const d = await w.flows.discardRun(w.flow.id, run.id, {});
  assert.equal(d.status, 200, d.error); assert.equal(d.body.status, 'failed');
  assert.equal(w.terms.get(t1).status, 'exited', 'o ocioso fechou antes da limpeza'); assert.equal(w.wt('s1').state, 'removed', 'e a cópia dele saiu (antes ficava presa em uso)');
  assert.equal(w.terms.get(t2).status, 'running', 'quem trabalha fica'); assert.deepEqual(d.body.git.leftovers.map((x) => x.worktreeId), [wt2]); assert.match(d.body.git.leftovers[0].reason, /em uso/);
  assert.equal((await w.flows.discardRun(w.flow.id, run.id, {})).code, 'already_discarded');
  const busy = await w.flows.cleanupRunCopies(w.flow.id, run.id, {}); assert.equal(busy.status, 200, busy.error); assert.deepEqual(busy.body.git.leftovers.map((x) => x.worktreeId), [wt2], 'ainda ocupado: continua listado');
  w.terms.get(t2).agent = { state: 'idle', at: 'y' }; // o agente parou
  const ok = await w.flows.cleanupRunCopies(w.flow.id, run.id, {});
  assert.equal(ok.status, 200, ok.error); assert.deepEqual(ok.body.git.leftovers, []); assert.equal(w.terms.get(t2).status, 'exited'); assert.equal(w.db.worktrees.find((x) => x.id === wt2).state, 'removed');
  assert.ok(refOf(w.repo, run.git.branch), 'run não integrado: Limpar não apaga a branch da missão'); assert.equal(ok.body.git.branchDeleted, false);
  assert.equal((await w.flows.cleanupRunCopies(w.flow.id, run.id, {})).code, 'nothing_to_clean');
  w.intact();
});

test('C2: Limpar aceita cancelled/discarded com leftovers e recusa run ativo (not_ready); cancelar fecha os terminais e Descartar limpa', async () => {
  const w = world({ inUse: true }); w.snapUser();
  const run = await w.start([B('s1')], { autoIntegrate: false });
  w.write('s1', 'p.txt', 'parcial\n'); // trabalho não commitado: a cópia não sai
  assert.equal((await w.flows.cleanupRunCopies(w.flow.id, run.id, {})).code, 'not_ready', 'run em andamento');
  assert.equal(w.flows.cancelRun(w.flow.id, run.id).status, 200); assert.equal(w.wt('s1').state, 'finished', 'cancelar fechou o terminal e devolveu a cópia');
  const d = await w.flows.discardRun(w.flow.id, run.id, {}); assert.equal(d.status, 200, d.error); assert.equal(d.body.status, 'cancelled');
  assert.equal(d.body.git.leftovers.length, 1); assert.match(d.body.git.leftovers[0].reason, /não commitadas/);
  fs.rmSync(path.join(w.wt('s1').path, 'p.txt')); // o usuário recupera/descarta o arquivo
  const c = await w.flows.cleanupRunCopies(w.flow.id, run.id, {}); assert.equal(c.status, 200, c.error); assert.deepEqual(c.body.git.leftovers, []); assert.equal(w.wt('s1').state, 'removed');
  w.intact();
});

test('código 3: o Git não responde logo depois do update-ref de uma etapa: a etapa seguinte NÃO vira erro; o passo seguinte concilia (settle) e integra as duas', async () => {
  const w = world(); w.snapUser();
  await w.start([B('s1'), B('s2')], { maxParallel: 2 });
  w.write('s1', 'x.txt', 'X\n'); w.write('s2', 'y.txt', 'Y\n');
  let armed = false, fails = 1;
  w.fault = (args) => { if (args[0] === 'update-ref') { armed = true; return false; } if (armed && fails > 0 && args[0] === 'rev-parse') { fails--; return true; } return false; };
  w.done('s1'); w.done('s2'); await w.tick();
  assert.equal(w.rs('s1').integration.state, 'integrating', 'o efeito ficou sem confirmação');
  assert.equal(w.rs('s2').integration.state, 'pending', 'a próxima etapa espera a conciliação em vez de virar erro');
  assert.equal(w.raw().status, 'running');
  w.fault = null; await w.tick();
  assert.deepEqual([w.rs('s1').integration.state, w.rs('s2').integration.state], ['integrated', 'integrated']);
  assert.equal(w.raw().status, 'completed', w.raw().error); assert.equal(read(w.repo, 'x.txt'), 'X\n'); assert.equal(read(w.repo, 'y.txt'), 'Y\n');
});

test('código 4: cancelar durante a retomada ou a conciliação = 409 busy; com o diário da integração final gravado também', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')], { autoIntegrate: false });
  // (a) durante a retomada (settle dentro do mutex do run)
  const a = reboot(w);
  let release; const gate = new Promise((r) => { release = r; });
  const orig = a.flowGit.settle; a.flowGit.settle = async (r) => { await gate; return orig(r); };
  const p = a.flows.resumeRun(w.flow.id, run.id, {});
  const c = a.flows.cancelRun(w.flow.id, run.id); assert.equal(c.status, 409); assert.equal(c.code, 'busy'); assert.equal(a.raw().status, 'interrupted');
  release(); assert.equal((await p).status, 200); assert.equal(a.flows.cancelRun(w.flow.id, run.id).status, 200, 'terminada a retomada, cancela');
  // (b) diário da integração final gravado: o próprio diário e a conciliação (recoverGit) em curso
  w.write('s1', 'z.txt', 'Z\n'); w.done('s1'); await w.tick(); assert.equal(w.raw().status, 'ready_to_integrate');
  const tip = w.raw().git.tip, oldHead = headOf(w.repo);
  const op = () => ({ kind: 'final_integrate', at: 't', oldHead, newCommit: tip, by: 'auto', mode: 'ff', digest: 'd'.repeat(32), missionTip: tip, policy: 'autoIntegrate' });
  const b = reboot(w, { mutate: (db) => { const r = db.flowRuns.find((x) => x.id === run.id); r.status = 'running'; r.git.op = op(); } });
  assert.equal(b.flows.cancelRun(w.flow.id, run.id).code, 'busy', 'diário da integração final gravado');
  let rel2; const gate2 = new Promise((r) => { rel2 = r; });
  const o2 = b.flowGit.settle; b.flowGit.settle = async (r) => { await gate2; return o2(r); };
  const rg = b.flows.recoverGit();
  b.raw().git.op = null; // mesmo sem o diário, a conciliação em curso segura o cancelamento
  assert.equal(b.flows.cancelRun(w.flow.id, run.id).code, 'busy', 'durante a conciliação');
  b.raw().git.op = op();
  rel2(); assert.equal(await rg, 1); assert.equal(b.raw().status, 'ready_to_integrate');
});

test('opcional 1: o Git não responde depois de gravar o diário da branch da missão: o passo seguinte concilia (settle) e o run segue; sem resposta em 3 passos, falha com o motivo', async () => {
  const countSettles = (x) => { const s = { n: 0, at: [] }; const orig = x.flowGit.settle; x.flowGit.settle = async (r) => { s.n++; s.at.push(r.git?.state); return orig(r); }; return s; };
  const w = world(); w.snapUser(); const ws = countSettles(w);
  let armed = false, fails = 1;
  w.fault = (args) => { if (args[0] === 'branch' && args[1] === '--no-track') { armed = true; return false; } if (armed && fails > 0 && args[0] === 'rev-parse') { fails--; return true; } return false; };
  w.make([B('s1')]); w.run = w.flows.startRun(w.flow.id).body;
  await w.flows.tick(); // o startRun já pediu um passo: aqui são dois (preparar → git_unknown com o diário; conciliar → pronta)
  assert.equal(w.raw().status, 'running', w.raw().error); assert.deepEqual(ws.at, ['creating'], 'uma conciliação, no passo seguinte ao git_unknown');
  assert.equal(w.raw().git.state, 'ready'); assert.equal(w.rs('s1').status, 'running'); assert.equal(refOf(w.repo, w.branch()), w.user.head);
  assert.equal(w.created.length, 1); w.noFolderTerminals();
  // sem resposta sempre: falha depois de 3 conciliações, sem abrir terminal
  const x = world(); const xs = countSettles(x);
  let armed2 = false; x.fault = (args) => { if (args[0] === 'branch' && args[1] === '--no-track') { armed2 = true; return false; } return armed2 && args[0] === 'rev-parse'; };
  await x.start([B('s1')]);
  for (let i = 0; i < 6 && x.raw().status === 'running'; i++) { assert.equal(x.raw().git.state, 'creating'); await x.tick(); }
  assert.equal(x.raw().status, 'failed'); assert.equal(xs.n, 3); assert.match(x.raw().error, /não respondeu em 3 tentativas/); assert.equal(x.created.length, 0);
  w.intact();
});

test('O3: a branch da missão nunca chegou a ser criada (settle → branch_absent) e a base mudou: a missão parte da base nova com rebasedFrom visível e registro no log', async () => {
  const w = world();
  const oldHead = headOf(w.repo);
  let armed = false;
  w.fault = (args) => { if (args[0] === 'branch' && args[1] === '--no-track') { armed = true; return true; } return armed && args[0] === 'rev-parse'; }; // o `git branch` "travou" e não rodou
  const run = await w.start([B('s1')]);
  assert.equal(run.git.state, 'creating'); assert.equal(refOf(w.repo, `orch/${run.id}`), null);
  w.fault = null;
  fs.writeFileSync(path.join(w.repo, 'novo.txt'), 'n\n'); G(w.repo, ['add', '-A']); G(w.repo, ['commit', '-q', '-m', 'trabalho do usuário']); const newHead = headOf(w.repo);
  await w.tick(); assert.equal(w.raw().git.mode, 'pending', 'settle: a branch nunca existiu');
  await w.tick();
  const g = w.raw().git;
  assert.equal(g.mode, 'git'); assert.equal(g.state, 'ready'); assert.equal(g.baseCommit, newHead); assert.equal(g.tip, newHead); assert.equal(refOf(w.repo, g.branch), newHead);
  assert.deepEqual([g.rebasedFrom.baseBranch, g.rebasedFrom.baseCommit], ['main', oldHead]); assert.ok(g.rebasedFrom.at);
  assert.deepEqual(w.view().git.rebasedFrom, g.rebasedFrom, 'a nota sai na API');
  assert.equal(w.rs('s1').status, 'running');
  assert.ok(gdb.activity.some((a) => a.type === 'flow' && a.runId === run.id && /a base mudou/.test(a.message)), 'registrado no log');
});

// ---------- re-revisão de segurança (N1, N2) ----------
test('N1: a retomada em modo Git reabre a sessão da cópia com o 2º parâmetro interno { audited: true } (continue e reopen), sempre DEPOIS da conferência da cópia', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1')]); await w.tick();
  assert.ok(w.rs('s1').taskId, 'a etapa recebeu a tarefa');
  const rec1 = w.rs('s1').recordId, wt1 = w.rs('s1').worktreeId;
  const order = (x) => { const log = []; const audit = x.flowGit.configAudit, resume = x.terminals.resume; x.flowGit.configAudit = async (...a) => { log.push('audit'); return audit(...a); }; x.terminals.resume = async (...a) => { log.push('resume'); return resume(...a); }; return log; };
  const a = reboot(w); const la = order(a);
  assert.equal((await a.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await a.tick();
  assert.deepEqual(a.resumeCalls, [{ recordId: rec1 }]); assert.deepEqual(a.resumeExtras, [{ audited: true }], 'continue: audited só no 2º parâmetro (nunca dentro de opts)');
  assert.equal(a.rs('s1').resumeMode, 'continue'); assert.equal(a.cwd('s1'), w.wt('s1').path); assert.deepEqual(la.slice(0, 2), ['audit', 'resume'], 'conferiu antes de reabrir');
  const b = reboot(w, { mutate: (db) => { for (const s of db.flowRuns.find((r) => r.id === run.id).steps) s.taskId = null; } }); const lb = order(b);
  assert.equal((await b.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await b.tick();
  assert.deepEqual(b.resumeCalls, [{ recordId: rec1, reopen: true }]); assert.deepEqual(b.resumeExtras, [{ audited: true }], 'reopen também');
  assert.equal(b.rs('s1').resumeMode, 'restart'); assert.equal(b.rs('s1').worktreeId, wt1); assert.deepEqual(lb.slice(0, 2), ['audit', 'resume']);
  assert.equal(a.created.length + b.created.length, 0, 'nenhum terminal pelo create: o registro da cópia foi reaberto');
  w.intact();
});

test('N1: modo pasta continua chamando terminals.resume só com opts (sem o 2º parâmetro)', async () => {
  const w = world({ git: false });
  const run = await w.start([B('s1')]); await w.tick();
  const rec1 = w.rs('s1').recordId;
  const a = reboot(w);
  assert.equal((await a.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await a.tick();
  assert.deepEqual(a.resumeCalls, [{ recordId: rec1 }]); assert.deepEqual(a.resumeExtras, [undefined]); assert.equal(a.rs('s1').resumeMode, 'continue');
});

test('N2: registro de sessão de OUTRA cópia (ou sem como ler o registro) não é reaberto: a etapa vai direto ao create na cópia dela, conferida', async () => {
  const w = world(); w.snapUser();
  const run = await w.start([B('s1'), B('s2')], { maxParallel: 2 }); await w.tick();
  const wt1 = w.rs('s1').worktreeId, wt2 = w.rs('s2').worktreeId, rec2 = w.rs('s2').recordId;
  assert.notEqual(wt1, wt2);
  // o registro de s1 passa a ser o da sessão de s2 (que vive na cópia de s2)
  const a = reboot(w, { mutate: (db) => { db.flowRuns.find((r) => r.id === run.id).steps.find((s) => s.stepId === 's1').recordId = rec2; } });
  assert.equal((await a.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await a.tick();
  assert.equal(a.resumeCalls.filter((c) => c.recordId === rec2).length, 1, 'só s2 reabre o registro dela; s1 não o usa');
  assert.equal(a.rs('s2').resumeMode, 'continue'); assert.equal(a.cwd('s2'), w.wt('s2').path);
  assert.deepEqual(a.created.map((c) => c.extra?.flowWorktreeId), [wt1], 's1 abriu pelo create na cópia DELA');
  assert.equal(a.rs('s1').resumeMode, 'restart'); assert.equal(a.rs('s1').worktreeId, wt1); assert.equal(a.cwd('s1'), w.wt('s1').path); assert.notEqual(a.rs('s1').recordId, rec2);
  // interface sem a leitura do registro: falha fechada, as duas etapas vão ao create (cada uma na sua cópia)
  const b = reboot(w, { noRecordInfo: true });
  assert.equal((await b.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await b.tick();
  assert.equal(b.resumeCalls.length, 0); assert.deepEqual(b.created.map((c) => c.extra?.flowWorktreeId), [wt1, wt2]);
  assert.deepEqual([b.rs('s1').status, b.rs('s2').status], ['running', 'running']);
  // registro que sumiu do gerenciador: idem
  const c = reboot(w, { mutate: (db) => { db.flowRuns.find((r) => r.id === run.id).steps.find((s) => s.stepId === 's1').recordId = 'ses_ffffffff'; } });
  assert.equal((await c.flows.resumeRun(w.flow.id, run.id, {})).status, 200); await c.tick();
  assert.ok(!c.resumeCalls.some((x) => x.recordId === 'ses_ffffffff')); assert.deepEqual(c.created.map((x) => x.extra?.flowWorktreeId), [wt1]);
  for (const x of [a, b, c]) x.noFolderTerminals();
  w.intact();
});
