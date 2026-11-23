// M1: rastreamento, encerramento e recuperação dos processos filhos registrados (db.childProcesses: preparer, terminal, login).
// Isolamento: banco em diretório TEMPORÁRIO (ORCH_DATA_DIR antes de qualquer import), nenhum modelo, nenhum servidor real. Só são tocados processos
// CRIADOS POR ESTES TESTES (dormentes, `node -e`). (Os testes do Planner/Verificador/Executor saíram com o ciclo antigo.)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-childreg-'));
const DATA = path.join(tmp, 'data');
process.env.ORCH_DATA_DIR = DATA;
assert.ok(fs.realpathSync.native(path.dirname(DATA)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste tem que ficar no diretório temporário');

const store = await import('../store.js');
const { createChildRegistry, CHILD_KEY } = await import('../child-registry.js');
const { installShutdown } = await import('../shutdown.js');
const { createProcTracker } = await import('./proc-identity.mjs');

// Identidade dos PIDs (proc-identity.mjs): o Windows reaproveita PIDs em segundos, então "o PID está vivo" pode ser OUTRO processo e encerrar "o PID registrado"
// pode matar um processo alheio. `pidAlive` aqui é verdadeiro só para o processo ORIGINAL (PID reaproveitado conta como encerrado) e o cleanup/`kill` só
// encerram o original. Quem registra um PID DEPOIS de o processo poder ter morrido passa o instante em que ele comprovadamente existia (`add(pid, startedAt)`).
const spawned = createProcTracker();
const pidAlive = (pid) => spawned.isAlive(pid);
after(async () => { spawned.cleanup(); await new Promise((r) => setTimeout(r, 700)); fs.rmSync(tmp, { recursive: true, force: true }); });

const SLEEP = 'setInterval(() => {}, 1000)';
const until = async (fn, ms = 10_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };
const settle = (p, ms = 10_000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('não terminou a tempo')), ms))]);
const quiet = (fn) => { const q = console.error; console.error = () => {}; try { return fn(); } finally { console.error = q; } };

store.load();
const diskRecords = () => JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'))[CHILD_KEY] ?? [];
/** Filho controlado pelo teste (fica vivo até ser encerrado), com a hora de início de quem o criou, como o registro do servidor. */
function sleeper() {
  const child = spawn(process.execPath, ['-e', SLEEP], { stdio: 'ignore', windowsHide: true });
  const startedAt = new Date().toISOString(); spawned.add(child.pid, startedAt); assert.notEqual(child.pid, process.pid);
  return { pid: child.pid, startedAt, exited: new Promise((r) => child.on('exit', r)) };
}
function plant(kind, s, extra = {}) { (store.get()[CHILD_KEY] ??= []).push({ id: `proc_${kind}_${s.pid}`, kind, pid: s.pid, startedAt: s.startedAt, ...extra }); store.save(); }

// ---- registro (unidade) ---------------------------------------------------------------------------------------
test('track grava o PID no disco (com tipo e hora de início) e release o apaga; release é idempotente e tipo/PID inválidos são tratados', async () => {
  const reg = createChildRegistry();
  const tr = reg.track('preparer', 4242, { worktreeId: 'w1' });
  const onDisk = diskRecords();
  assert.equal(onDisk.length, 1); assert.equal(onDisk[0].kind, 'preparer'); assert.equal(onDisk[0].pid, 4242); assert.equal(onDisk[0].worktreeId, 'w1');
  assert.ok(Number.isFinite(Date.parse(onDisk[0].startedAt)), 'hora de início válida');
  tr.release(); tr.release();
  assert.equal(store.get()[CHILD_KEY].length, 0); assert.ok(await until(() => diskRecords().length === 0), 'a remoção também chega ao disco');
  assert.throws(() => reg.track('executor', 1), TypeError, 'o tipo "executor" não existe mais');
  for (const pid of [undefined, null, 0, -1, 1.5, '7']) { const t = reg.track('preparer', pid); assert.equal(t.pid, null); t.release(); }
  assert.equal(store.get()[CHILD_KEY].length, 0, 'sem PID válido não se registra nada');
});

test('track: falha real ao gravar => lança e NÃO deixa registro em memória; registros de processos já mortos são podados', async () => {
  const bad = createChildRegistry({ store: { ...store, save() { throw Object.assign(new Error('disco'), { code: 'EIO' }); } } });
  assert.throws(() => bad.track('preparer', 4243), (e) => e.code === 'EIO');
  assert.equal(store.get()[CHILD_KEY].length, 0);
  const dead = sleeper(); spawned.kill(dead.pid); await settle(dead.exited);
  store.get()[CHILD_KEY].push({ id: 'proc_velho', kind: 'preparer', pid: dead.pid, startedAt: dead.startedAt });
  const reg = createChildRegistry(); const t = reg.track('preparer', process.pid);
  assert.deepEqual(store.get()[CHILD_KEY].map((r) => r.pid), [process.pid], 'o registro do processo morto saiu'); t.release();
});

// ---- reclaim no boot ------------------------------------------------------------------------------------------
test('boot: filho órfão (mesma identidade) é ENCERRADO, o registro sai e a atividade é registrada', async () => {
  const s = sleeper(); plant('preparer', s, { worktreeId: 'w1' });
  const results = createChildRegistry().reclaim();
  assert.equal(results.length, 1); assert.equal(results[0].outcome, 'killed');
  assert.equal(pidAlive(s.pid), false); await settle(s.exited);
  assert.equal(store.get()[CHILD_KEY].length, 0);
  assert.ok(store.get().activity.some((a) => a.orphan === 'killed' && a.process === 'preparer'), 'registrado na atividade');
});

test('boot: a ÁRVORE inteira do filho órfão é encerrada (pai -> neto)', async () => {
  // o neto.pid existe antes de ter conteúdo: sem esperar o PID, Number('') dava 0 sob carga
  const code = `const g = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(SLEEP)}], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(path.join(tmp, 'neto.pid'))}, String(g.pid)); ${SLEEP}`;
  const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore', windowsHide: true }); spawned.add(child.pid);
  const startedAt = new Date().toISOString(), exited = new Promise((r) => child.on('exit', r));
  assert.ok(await until(() => fs.existsSync(path.join(tmp, 'neto.pid')) && fs.readFileSync(path.join(tmp, 'neto.pid'), 'utf8').length > 0)); const grandchild = Number(fs.readFileSync(path.join(tmp, 'neto.pid'), 'utf8')); spawned.add(grandchild);
  plant('preparer', { pid: child.pid, startedAt });
  createChildRegistry().reclaim();
  assert.equal(pidAlive(child.pid), false); assert.equal(pidAlive(grandchild), false, 'o neto também'); await settle(exited);
});

test('boot: processo já encerrado => registro limpo; PID reaproveitado por OUTRO processo NÃO é encerrado e não bloqueia', async () => {
  const dead = sleeper(); spawned.kill(dead.pid); await settle(dead.exited);
  const other = sleeper();
  plant('preparer', dead); plant('terminal', { pid: other.pid, startedAt: new Date(Date.now() - 3_600_000).toISOString() }); // "o registro é de 1 h atrás": este processo é outro
  const results = createChildRegistry().reclaim();
  assert.deepEqual(results.map((r) => r.outcome), ['gone', 'reused']);
  assert.equal(pidAlive(other.pid), true, 'o processo alheio continua vivo');
  assert.equal(store.get()[CHILD_KEY].length, 0); spawned.kill(other.pid); await settle(other.exited);
});

test('boot: identidade NÃO confirmável => nada é encerrado e o registro é mantido; no boot seguinte (identidade confirmável) é encerrado', async () => {
  const s = sleeper(); plant('preparer', s);
  const res = createChildRegistry({ orphanTools: { startedAtOf: () => null } }).reclaim();
  assert.equal(res[0].outcome, 'unverified'); assert.equal(pidAlive(s.pid), true, 'não foi encerrado');
  assert.equal(store.get()[CHILD_KEY].length, 1, 'o registro fica para ser reavaliado'); assert.equal(diskRecords().length, 1);
  const res2 = createChildRegistry().reclaim();
  assert.equal(res2[0].outcome, 'killed'); assert.equal(pidAlive(s.pid), false); await settle(s.exited);
  assert.equal(store.get()[CHILD_KEY].length, 0);
});

test('boot: falha ao encerrar (kill_failed) => registro mantido; o boot seguinte o encerra', async () => {
  const s = sleeper(); plant('preparer', s);
  const res = createChildRegistry({ orphanTools: { kill: () => {}, wait: () => false } }).reclaim();
  assert.equal(res[0].outcome, 'kill_failed'); assert.equal(pidAlive(s.pid), true); assert.equal(store.get()[CHILD_KEY].length, 1);
  assert.equal(createChildRegistry().reclaim()[0].outcome, 'killed'); await settle(s.exited);
  assert.equal(store.get()[CHILD_KEY].length, 0, 'o registro sai quando o processo não existe mais');
});

test('check (preparer): processo vivo bloqueia sem ser encerrado; morto/reaproveitado libera e apaga o registro', async () => {
  const live = sleeper(), dead = sleeper(); spawned.kill(dead.pid); await settle(dead.exited);
  plant('preparer', live, { worktreeId: 'wa' }); plant('preparer', dead, { worktreeId: 'wb' });
  const reg = createChildRegistry();
  const a = reg.check('wa'); assert.equal(a.blocking.length, 1); assert.equal(pidAlive(live.pid), true, 'check nunca encerra nada');
  const b = reg.check('wb'); assert.equal(b.blocking.length, 0); assert.equal(b.released.length, 1);
  assert.deepEqual(reg.check('inexistente'), { blocking: [], released: [] });
  assert.equal(store.get()[CHILD_KEY].filter((r) => r.worktreeId === 'wb').length, 0);
  store.get()[CHILD_KEY] = []; spawned.kill(live.pid); await settle(live.exited);
});

test('boot: banco antigo (sem o campo), registros malformados e lista vazia não quebram o boot', () => {
  delete store.get()[CHILD_KEY];
  assert.deepEqual(createChildRegistry().reclaim(), []);
  store.get()[CHILD_KEY] = [null, 'lixo', { kind: 'preparer' }, { kind: 'terminal', pid: 'x', startedAt: 'y' }];
  assert.doesNotThrow(() => quiet(() => createChildRegistry().reclaim()));
  assert.equal(store.get()[CHILD_KEY].length, 0);
  store.get()[CHILD_KEY] = 'não é lista'; assert.doesNotThrow(() => createChildRegistry().reclaim()); assert.ok(Array.isArray(store.get()[CHILD_KEY]));
});

// ---- encerramento do servidor ---------------------------------------------------------------------------------
test('installShutdown: filhos são encerrados na ordem, antes do flush e da trava; um que falha não impede os outros; sem `children` nada muda', () => {
  const rig = (children, killThrows) => {
    const proc = new EventEmitter(), log = [];
    const mk = (n) => ({ killActiveSync: () => { log.push(n); if (killThrows === n) throw new Error('falhou'); } });
    installShutdown({ lock: { release: () => log.push('release') }, children: children?.map(mk), store: { flush: () => log.push('flush') }, proc, exit: (c) => log.push(`exit:${c}`) });
    return { proc, log };
  };
  const a = rig(['a', 'b']); a.proc.emit('SIGINT'); assert.deepEqual(a.log, ['a', 'b', 'flush', 'release', 'exit:130']);
  const b = rig(['a', 'b'], 'a'); quiet(() => b.proc.emit('SIGTERM')); assert.deepEqual(b.log, ['a', 'b', 'flush', 'release', 'exit:143']);
  const c = rig(undefined); c.proc.emit('exit', 0); assert.deepEqual(c.log, ['flush']);
  const d = rig(['a']); d.proc.emit('exit', 1); assert.deepEqual(d.log, ['a'], 'saída anormal: filhos encerrados, sem flush');
});
