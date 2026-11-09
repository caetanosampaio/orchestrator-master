// Processos no Windows: contraparte dos testes POSIX (posix-process.test.mjs), para que cada sistema tenha a sua cobertura. No Windows não há zumbi e o `taskkill /T` mata a árvore.
// Só toca processos criados por estes testes (`node -e setInterval`).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const { pidAlive } = await import('../instance-lock.js');
const { killTreeSync, waitGone, processStartedAt, descendantsOf } = await import('../orphans.js');

const skip = process.platform === 'win32' ? false : 'só se aplica ao Windows';
const SLEEP = 'setInterval(() => {}, 1000)';
const spawned = new Set();
after(() => { for (const pid of spawned) { try { process.kill(pid); } catch { /* já encerrado */ } } });

function sleeper(code = SLEEP) {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  spawned.add(child.pid);
  return { pid: child.pid, out: () => new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim())))) };
}

test('pidAlive: o próprio processo, um filho vivo e um PID inexistente', { skip }, () => {
  const s = sleeper();
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(s.pid), true);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
  killTreeSync(s.pid);
});

test('killTreeSync (taskkill /T): encerra o filho E o neto', { skip }, async () => {
  const s = sleeper(`const g = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(SLEEP)}], { stdio: 'ignore', windowsHide: true }); console.log(g.pid); ${SLEEP}`);
  const grandchild = await s.out();
  spawned.add(grandchild);
  assert.ok(pidAlive(s.pid) && pidAlive(grandchild));
  killTreeSync(s.pid);
  assert.equal(waitGone(s.pid, 5000), true);
  assert.equal(waitGone(grandchild, 5000), true, 'o neto também foi encerrado');
});

test('killTreeSync: PID inválido ou inexistente não lança', { skip }, () => {
  for (const pid of [0, -1, 1.5, NaN, undefined, 2 ** 22 + 12345]) killTreeSync(pid);
});

test('processStartedAt: hora de início de um processo vivo (perto de agora); null para PID inválido ou inexistente', { skip }, () => {
  const s = sleeper();
  const t = processStartedAt(s.pid);
  assert.ok(Number.isFinite(t) && Math.abs(Date.now() - t) < 60_000, `hora de início plausível (${t})`);
  assert.equal(processStartedAt(0), null);
  assert.equal(processStartedAt(2 ** 22 + 12345), null);
  killTreeSync(s.pid);
});

test('descendantsOf: sem `ps` no Windows devolve [] (a árvore é encerrada pelo taskkill /T)', { skip }, () => {
  assert.deepEqual(descendantsOf(process.pid), []);
});
