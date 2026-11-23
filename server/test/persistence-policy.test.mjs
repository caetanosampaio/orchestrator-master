// M2: política de falhas de persistência (store.js): saveOrThrow/incidente, e a interação com o registro de processos filhos (child-registry).
// Isolamento: banco em diretório TEMPORÁRIO (ORCH_DATA_DIR antes de qualquer import); nenhum modelo, nenhum servidor. As falhas são simuladas só dentro deste processo:
//   EISDIR : um DIRETÓRIO no lugar de db.json.tmp => save() LANÇA (erro real, não transitório) e o db.json antigo permanece no disco;
//   EBUSY  : rename/escrita de db.json falham sempre => esgota as tentativas transitórias do save(), que devolve false (db.json antigo permanece).
// (Os testes de persistência do ciclo antigo saíram com ele.)
import test, { mock, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-persist-'));
const DATA = path.join(tmp, 'data');
process.env.ORCH_DATA_DIR = DATA;
assert.ok(fs.realpathSync.native(path.dirname(DATA)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste tem que ficar no diretório temporário');

const store = await import('../store.js');
const { createChildRegistry, CHILD_KEY } = await import('../child-registry.js');
const { installShutdown } = await import('../shutdown.js');
const { createProcTracker } = await import('./proc-identity.mjs');

// Identidade dos PIDs (proc-identity.mjs): o Windows reaproveita PIDs em segundos; `pidAlive` é verdadeiro só para o processo ORIGINAL e o cleanup só encerra o original.
const spawned = createProcTracker();
const pidAlive = (pid) => spawned.isAlive(pid);
after(async () => { mock.restoreAll(); fs.rmSync(path.join(DATA, 'db.json.tmp'), { recursive: true, force: true }); spawned.cleanup(); await new Promise((r) => setTimeout(r, 800)); fs.rmSync(tmp, { recursive: true, force: true }); });

const db = store.load();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (p, ms = 30_000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms))]);
const quiet = () => mock.method(console, 'error', () => {});
const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
const TMPDIR = path.join(DATA, 'db.json.tmp');
beforeEach(() => { mock.restoreAll(); fs.rmSync(TMPDIR, { recursive: true, force: true }); }); // um caso que falha no meio não pode deixar o disco quebrado para o seguinte
/** save() passa a LANÇAR EISDIR (erro real); devolve a função que normaliza o disco. */
const eisdir = () => { fs.mkdirSync(TMPDIR, { recursive: true }); return () => fs.rmSync(TMPDIR, { recursive: true, force: true }); };
/** Gravações de db.json falham SEMPRE com EBUSY (transitório): save() esgota as tentativas e devolve false. Devolve a função que normaliza. */
function busy() {
  const rr = fs.renameSync, rw = fs.writeFileSync, boom = () => { throw Object.assign(new Error('EBUSY: simulado'), { code: 'EBUSY' }); };
  mock.method(fs, 'renameSync', (a, b, ...r) => (String(b).endsWith('db.json') ? boom() : rr(a, b, ...r)));
  mock.method(fs, 'writeFileSync', (p, ...r) => (String(p).endsWith('db.json') ? boom() : rw(p, ...r)));
  return () => mock.restoreAll();
}
const SLEEP = 'setInterval(() => {}, 1000)';
function sleeper() {
  const child = spawn(process.execPath, ['-e', SLEEP], { stdio: 'ignore', windowsHide: true });
  const startedAt = new Date().toISOString(); spawned.add(child.pid, startedAt);
  return { pid: child.pid, startedAt, exited: new Promise((r) => child.on('exit', r)) };
}

test('store: saveOrThrow confirma; false vira PersistenceError e erro real sai marcado; o incidente sobrevive à recuperação', () => {
  quiet();
  assert.equal(store.saveOrThrow(), true);
  const heal = busy();
  assert.equal(store.save(), false, 'transitório esgotado: save() só devolve false');
  assert.throws(() => store.saveOrThrow(), (e) => e instanceof store.PersistenceError && e.persistence === true && e.code === 'EBUSY' && /EBUSY/.test(e.message));
  assert.equal(store.persistenceStatus().ok, false);
  const inc = store.persistenceIncident(); assert.equal(inc.error, 'EBUSY'); assert.ok(inc.failures >= 2); assert.equal(inc.recoveredAt, null); assert.ok(inc.failedAt);
  heal();
  assert.equal(store.saveOrThrow(), true); assert.equal(store.persistenceStatus().ok, true, 'a gravação seguinte reconcilia (grava o estado inteiro)');
  const after_ = store.persistenceIncident(); assert.equal(after_.error, 'EBUSY', 'o rastro NÃO é apagado pela recuperação'); assert.ok(after_.recoveredAt); assert.ok(after_.failures >= inc.failures);
  assert.ok(db.activity.some((a) => a.persistence === 'failed') && db.activity.some((a) => a.persistence === 'restored'));
  const fix = eisdir();
  assert.throws(() => store.saveOrThrow(), (e) => e.code === 'EISDIR' && e.persistence === true && !(e instanceof store.PersistenceError), 'erro real: o mesmo erro, só marcado');
  fix(); assert.equal(store.saveOrThrow(), true);
  mock.restoreAll();
});

test('queda durante a falha de persistência: o boot relê o último estado gravado (nunca um estado não gravado) e o .bak segue válido', () => {
  quiet();
  store.log('execution', 'marca-gravada'); store.saveOrThrow();
  store.log('execution', 'marca-gravada-2'); store.saveOrThrow(); // o .bak só nasce na gravação seguinte
  const fix = eisdir();
  store.log('execution', 'marca-nao-gravada');
  assert.throws(() => store.saveOrThrow(), (e) => e.code === 'EISDIR');
  fix(); mock.restoreAll();
  const db2 = store.load();
  assert.ok(db2.activity.some((a) => JSON.stringify(a).includes('marca-gravada-2')), 'o que estava gravado voltou');
  assert.ok(!db2.activity.some((a) => JSON.stringify(a).includes('marca-nao-gravada')), 'o que não foi gravado não existe depois da "queda"');
  const baked = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json.bak'), 'utf8'));
  assert.equal(store.validateDb(baked), null, 'o .bak continua sendo um estado válido');
});

// ---- interação com o registro de processos filhos (M1) ---------------------------------------------------------------------------
test('M1: registro do PID com save()==false => lança (a operação falha) e nada fica registrado em memória', () => {
  quiet();
  const reg = createChildRegistry();
  const heal = busy();
  assert.throws(() => reg.track('preparer', process.pid), (e) => e.persistence === true && e.code === 'EBUSY');
  assert.equal(store.get()[CHILD_KEY].length, 0, 'nada ficou registrado em memória');
  heal(); mock.restoreAll();
});

test('M1: boot com a gravação falhando — reclaim não lança, o órfão é encerrado e, como o registro antigo ficou no disco, o boot seguinte o trata como "já encerrado"', async () => {
  quiet();
  store.get()[CHILD_KEY] = []; store.save();
  const s = sleeper();
  (store.get()[CHILD_KEY] ??= []).push({ id: 'proc_o', kind: 'preparer', pid: s.pid, startedAt: s.startedAt }); store.save();
  const heal = busy();
  const res = createChildRegistry().reclaim();
  assert.equal(res[0].outcome, 'killed'); await settle(s.exited); assert.equal(pidAlive(s.pid), false);
  assert.equal(disk()[CHILD_KEY].length, 1, 'a remoção não chegou ao disco (gravação falhando)');
  heal(); mock.restoreAll();
  store.load();                                                                           // "boot seguinte": relê o disco
  const again = createChildRegistry().reclaim();
  assert.deepEqual(again.map((x) => x.outcome), ['gone']); assert.equal(store.get()[CHILD_KEY].length, 0); assert.equal(disk()[CHILD_KEY].length, 0);
});

test('M1: shutdown com a gravação falhando — os filhos são encerrados, nada lança, o flush não impede a liberação da trava', async () => {
  quiet();
  store.get()[CHILD_KEY] = []; store.save();
  const reg = createChildRegistry();
  const owners = [sleeper(), sleeper()].map((s) => { const tr = reg.track('preparer', s.pid); return { s, killActiveSync: () => { spawned.kill(s.pid); tr.release(); } }; });
  assert.equal(store.get()[CHILD_KEY].length, 2);
  const heal = busy(), proc = new EventEmitter(), log = [];
  installShutdown({ lock: { release: () => log.push('release') }, children: owners, store: { flush: () => { log.push('flush'); return store.flush(); } }, proc, exit: (c) => log.push(`exit:${c}`) });
  assert.doesNotThrow(() => proc.emit('SIGTERM'));
  assert.deepEqual(log, ['flush', 'release', 'exit:143']);
  for (const o of owners) { await settle(o.s.exited); assert.equal(pidAlive(o.s.pid), false); }
  assert.equal(store.get()[CHILD_KEY].length, 0, 'processos comprovadamente encerrados saem do registro em memória');
  assert.equal(disk()[CHILD_KEY].length, 2, 'o disco (que não aceitou gravar) ainda tem os registros: no próximo boot os PIDs não existem mais => "gone"');
  heal(); mock.restoreAll(); await sleep(50);
});
