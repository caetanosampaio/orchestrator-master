// P4: processos filhos órfãos (orphans.js, shutdown.js e o boot do servidor real via childProcesses). Só são tocados processos CRIADOS POR ESTES TESTES (filhos `node -e setInterval`); nenhum processo do usuário,
// nenhuma CLI real, nenhum modelo. Banco TEMPORÁRIO.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-orphan-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');

const { reclaimOrphans, processStartedAt, killTreeSync, START_TOLERANCE_MS } = await import('../orphans.js');
const { pidAlive } = await import('../instance-lock.js');
const { installShutdown } = await import('../shutdown.js');

const spawned = new Set();
after(async () => { for (const pid of spawned) killTreeSync(pid); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(tmp, { recursive: true, force: true }); });

const SLEEP = 'setInterval(() => {}, 1000)';
/** Filho controlado pelo teste (fica vivo até ser encerrado). */
function sleeper(code = SLEEP) {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  spawned.add(child.pid);
  assert.notEqual(child.pid, process.pid);
  const exited = new Promise((r) => child.on('exit', r));
  return { child, pid: child.pid, startedAt: new Date().toISOString(), exited, out: () => new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim()))) };
}
const deadPid = async () => { const s = sleeper('0'); await s.exited; return s.pid; };
const settle = async (p, ms = 10_000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('o processo não encerrou a tempo')), ms))]);

test('reclaimOrphans: gone, killed, reused, unverified e kill_failed, sem tocar no que não é comprovadamente a execução abandonada', () => {
  const T = Date.parse('2026-01-01T10:00:00Z'), calls = [];
  const make = (over) => ({ alive: () => true, startedAtOf: () => T + 1000, kill: (pid) => calls.push(pid), wait: () => true, ...over });
  const run = (c, tools) => reclaimOrphans([c], make(tools))[0];
  assert.equal(run({ pid: 10, startedAt: new Date(T).toISOString() }, { alive: () => false }).outcome, 'gone'); assert.deepEqual(calls, []);
  assert.equal(run({ pid: 11, startedAt: new Date(T).toISOString() }).outcome, 'killed'); assert.deepEqual(calls, [11]);
  const limite = run({ pid: 12, startedAt: T }, { startedAtOf: () => T + START_TOLERANCE_MS }); assert.equal(limite.outcome, 'killed', 'no limite da tolerância ainda é a mesma execução');
  calls.length = 0;
  assert.equal(run({ pid: 13, startedAt: T }, { startedAtOf: () => T + START_TOLERANCE_MS + 1 }).outcome, 'reused');
  assert.equal(run({ pid: 14, startedAt: T }, { startedAtOf: () => T - 3_600_000 }).outcome, 'reused');
  assert.equal(run({ pid: 15, startedAt: T }, { startedAtOf: () => null }).outcome, 'unverified');
  assert.equal(run({ pid: 16, startedAt: undefined }).outcome, 'unverified'); assert.equal(run({ pid: 17, startedAt: 'lixo' }).outcome, 'unverified');
  for (const pid of [null, 0, -3, 1.5, '12']) assert.equal(run({ pid, startedAt: T }).outcome, 'gone', `PID inválido não é um processo: ${pid}`);
  assert.equal(run({ pid: 19, startedAt: T }, { startedAtOf: () => null }).expectedStart, T, 'unverified com startedAt válido guarda o início esperado (confirmável depois)');
  assert.equal(run({ pid: 20, startedAt: 'lixo' }).expectedStart, null);
  assert.deepEqual(calls, [], 'nada foi encerrado nos casos não comprovados');
  assert.equal(run({ pid: 18, startedAt: T }, { wait: () => false }).outcome, 'kill_failed'); assert.deepEqual(calls, [18]);
});

// ---- processos reais controlados pelo teste -----------------------------------------------------------
test('processStartedAt: hora de criação do processo real; processo inexistente => null', async () => {
  const s = sleeper();
  const t = processStartedAt(s.pid);
  assert.ok(Math.abs(t - Date.now()) < 30_000, `hora de criação plausível (${t})`);
  assert.equal(processStartedAt(await deadPid()), null); assert.equal(processStartedAt(null), null);
  killTreeSync(s.pid); await settle(s.exited);
});


test('installShutdown: sinais e saída encerram o filho, liberam a trava e saem com o código certo, mesmo se encerrar o filho falhar', () => {
  const mk = (killFails = false) => {
    const proc = new EventEmitter(), log = [];
    const child = { killActiveSync: () => { log.push('kill'); if (killFails) throw new Error('boom'); } }, lock = { release: () => log.push('release') };
    installShutdown({ lock, children: [child], proc, exit: (c) => log.push(`exit:${c}`) });
    return { proc, log };
  };
  const quiet = console.error; console.error = () => {};
  try {
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 143], ['SIGBREAK', 143]]) { const { proc, log } = mk(); proc.emit(sig); assert.deepEqual(log, ['kill', 'release', `exit:${code}`], sig); }
    const f = mk(true); f.proc.emit('SIGINT'); assert.deepEqual(f.log, ['kill', 'release', 'exit:130'], 'a falha ao encerrar o filho não impede liberar a trava nem sair');
    const e = mk(); e.proc.emit('exit'); assert.deepEqual(e.log, ['kill'], 'no evento exit só o filho é encerrado (a trava tem o próprio handler)');
    const none = new EventEmitter(); installShutdown({ lock: null, proc: none, exit() {} }); assert.doesNotThrow(() => { none.emit('SIGTERM'); none.emit('exit'); });
  } finally { console.error = quiet; }
});


test('ponta a ponta: o servidor REAL (index.js, banco temporário) encerra no boot o filho órfão registrado por uma queda', async () => {
  const { default: net } = await import('node:net');
  const dir = fs.mkdtempSync(path.join(tmp, 'srv-')), s = sleeper();
  assert.ok(fs.realpathSync.native(path.dirname(dir)).startsWith(fs.realpathSync.native(os.tmpdir())), 'o banco do teste fica no diretório temporário');
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ version: 1, settings: { activeWorkspaceId: null }, workspaces: [], activity: [], childProcesses: [{ id: 'proc_o', kind: 'preparer', pid: s.pid, startedAt: s.startedAt }] }, null, 2));
  const port = await new Promise((r) => { const l = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = l.address(); l.close(() => r(p)); }); });
  const srv = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js')], { env: { ...process.env, ORCH_DATA_DIR: dir, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  spawned.add(srv.pid); let out = ''; srv.stdout.on('data', (c) => { out += c; }); srv.stderr.on('data', (c) => { out += c; });
  try {
    await settle(new Promise((resolve, reject) => { const iv = setInterval(() => { if (/FORGE API em/.test(out)) { clearInterval(iv); resolve(); } }, 25); srv.on('exit', () => { clearInterval(iv); reject(new Error(`o servidor encerrou: ${out}`)); }); }), 25_000);
    assert.equal(pidAlive(s.pid), false, 'o órfão foi encerrado pelo boot do servidor'); await settle(s.exited);
  } finally { srv.kill(); await new Promise((r) => srv.on('exit', r)); }
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.deepEqual(saved.childProcesses ?? [], [], 'o registro do órfão saiu do disco');
});

test('evento exit REAL: o encerramento do filho é tentado ANTES de a trava de instância ser liberada (e ela é liberada depois)', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'order-')), record = path.join(dir, 'order.json');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lockMod = pathToFileURL(path.join(here, '..', 'instance-lock.js')).href, shutMod = pathToFileURL(path.join(here, '..', 'shutdown.js')).href;
  const code = `import fs from 'node:fs';
    import { acquireInstanceLock, lockPathFor } from ${JSON.stringify(lockMod)};
    import { installShutdown } from ${JSON.stringify(shutMod)};
    const dir = ${JSON.stringify(dir)}, lock = acquireInstanceLock({ dir, autoRelease: true });
    if (!lock.ok) process.exit(9);
    // mesma ordem do servidor: a trava registra o listener de exit primeiro; depois o shutdown
    installShutdown({ lock, children: [{ killActiveSync: () => fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ lockExistedWhenKilling: fs.existsSync(lockPathFor(dir)) })) }] });
    process.exit(0);`;
  const code_ = await new Promise((resolve) => { const c = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore', windowsHide: true }); spawned.add(c.pid); c.on('exit', resolve); });
  assert.equal(code_, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), { lockExistedWhenKilling: true }, 'o filho foi encerrado com a trava ainda de pé');
  assert.equal(fs.existsSync(path.join(dir, 'server.lock')), false, 'e a trava foi liberada depois');
});
