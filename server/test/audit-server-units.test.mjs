// Auditoria do servidor (unidades): trava de instância com PID reaproveitado, terminais interrompidos com `endedAt`, probe sem duplicação e `claude.cmd` no Windows.
// Tudo em diretório TEMPORÁRIO (ORCH_DATA_DIR e PATH próprios); nenhuma CLI real, nenhum banco real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-audit-units-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { acquireInstanceLock, lockPathFor } = await import('../instance-lock.js');
const { createTerminalManager } = await import('../terminals.js');
const { createExecutor } = await import('../executor/index.js');
const { executorArgs } = await import('../exec-profile.js');
const { createGitProbe, GIT_MISSING } = await import('../prereqs.js');
const realPath = process.env.PATH ?? process.env.Path;
after(() => { process.env.PATH = realPath; fs.rmSync(tmp, { recursive: true, force: true }); });

// ---------- tarefa 5: trava de instância e PID reaproveitado ----------
let n = 0;
const newDir = () => { const d = path.join(tmp, `lock${++n}`); fs.mkdirSync(d); return d; };
const LIVE = 4242, alive = (pid) => pid === LIVE;
const plant = (d, startedMs) => fs.writeFileSync(lockPathFor(d), JSON.stringify({ pid: LIVE, startedAt: new Date(startedMs).toISOString(), token: 'antiga' }));
const bootTime = 0; // sistema "ligado" desde sempre: só o critério novo pode tornar a trava obsoleta

test('trava: dono "vivo" que nasceu DEPOIS da trava (PID reaproveitado) é obsoleto e a nova instância assume', () => {
  const d = newDir(), lockedAt = Date.now() - 10 * 60_000; plant(d, lockedAt);
  const lock = acquireInstanceLock({ dir: d, pid: 999, isAlive: alive, bootTime, startedAtOf: () => Date.now() - 60_000 });
  assert.equal(lock.ok, true); assert.equal(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid, 999);
});

test('trava: dono vivo legítimo (nasceu antes/na margem) e hora de início desconhecida NUNCA são declarados obsoletos', () => {
  const lockedAt = Date.now() - 10 * 60_000;
  const casos = { 'anterior à trava': () => lockedAt - 2_000, 'dentro da margem': () => lockedAt + 3_000, 'desconhecida (null)': () => null, 'consulta lança': () => { throw new Error('falhou'); }, 'NaN': () => NaN };
  for (const [nome, startedAtOf] of Object.entries(casos)) {
    const d = newDir(); plant(d, lockedAt);
    const lock = acquireInstanceLock({ dir: d, pid: 999, isAlive: alive, bootTime, startedAtOf });
    assert.equal(lock.ok, false, nome); assert.equal(JSON.parse(fs.readFileSync(lockPathFor(d), 'utf8')).token, 'antiga', `${nome}: a trava original ficou intacta`);
  }
});

test('trava: dono morto continua obsoleto (comportamento anterior) e a hora de início não é consultada', () => {
  const d = newDir(); fs.writeFileSync(lockPathFor(d), JSON.stringify({ pid: 4243, startedAt: new Date().toISOString(), token: 'x' }));
  let consultas = 0;
  assert.equal(acquireInstanceLock({ dir: d, pid: 999, isAlive: alive, bootTime, startedAtOf: () => { consultas++; return null; } }).ok, true);
  assert.equal(consultas, 0);
});

test('trava com consulta REAL: o processo atual, dono legítimo da própria trava, não é considerado reaproveitado', () => {
  const d = newDir(); plant(d, Date.now()); fs.writeFileSync(lockPathFor(d), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: 'minha' }));
  assert.equal(acquireInstanceLock({ dir: d, pid: process.pid + 1 }).ok, false, 'este processo está vivo e nasceu antes da trava');
});

// ---------- tarefa 6: terminais interrompidos no boot ganham endedAt ----------
test('boot do gerenciador de terminais: registros "running" viram "interrupted" com endedAt = interruptedAt (e os demais ficam intactos)', () => {
  let persisted = 0;
  const db = { settings: {}, workspaces: [], worktrees: [], terminalSessions: [
    { id: 'ses_00000001', state: 'running', endedAt: null, exitCode: null },
    { id: 'ses_00000002', state: 'exited', endedAt: '2026-01-01T00:00:00.000Z', exitCode: 0 },
  ] };
  createTerminalManager({ db, ptyLib: { spawn() { throw new Error('não usado'); } }, persist: () => { persisted++; }, now: () => '2026-11-07T12:00:00.000Z', track: () => ({ release() {} }) });
  const [a, b] = db.terminalSessions;
  assert.deepEqual([a.state, a.closedReason, a.interruptedAt, a.endedAt], ['interrupted', 'crash', '2026-11-07T12:00:00.000Z', '2026-11-07T12:00:00.000Z']);
  assert.deepEqual([b.state, b.endedAt, b.interruptedAt], ['exited', '2026-01-01T00:00:00.000Z', undefined]);
  assert.equal(persisted, 1);
});

// ---------- tarefa 3: probe sem duplicação ----------
test('probe: chamadas simultâneas compartilham UMA execução de `--version` e o cache de 15 s continua valendo', async () => {
  const counter = path.join(tmp, 'count.txt'), script = path.join(tmp, 'ver.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(counter)}, 'x'); setTimeout(() => console.log('1.2.3 (fake)'), 300);`);
  const ex = createExecutor({ command: process.execPath, prefixArgs: [script], args: [] });
  const [a, b, c] = await Promise.all([ex.probe(), ex.probe(), ex.probe()]);
  assert.equal(fs.readFileSync(counter, 'utf8').length, 1, 'uma única chamada');
  assert.deepEqual([a.available, a.version], [true, '1.2.3 (fake)']); assert.equal(a, b); assert.equal(b, c);
  await ex.probe(); assert.equal(fs.readFileSync(counter, 'utf8').length, 1, 'cache de 15 s');
});

test('probe de Git: ausente = mensagem de instalação; presente = versão; chamadas simultâneas deduplicadas', async () => {
  const gone = await createGitProbe({ command: path.join(tmp, 'nao-existe-git') })();
  assert.deepEqual(gone, { available: false, version: null, detail: GIT_MISSING });
  const counter = path.join(tmp, 'gcount.txt'), script = path.join(tmp, 'git.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(counter)}, 'x'); setTimeout(() => console.log('git version 2.50.0'), 200);`);
  const probe = createGitProbe({ command: process.execPath, prefixArgs: [script] });
  const [a, b] = await Promise.all([probe(), probe()]); await probe();
  assert.equal(fs.readFileSync(counter, 'utf8').length, 1); assert.equal(a, b); assert.deepEqual([a.available, a.version], [true, '2.50.0']);
});

// ---------- tarefa 2: claude.cmd (só Windows) ----------
test('claude.cmd no PATH (Windows): probe e execução funcionam; só argumentos da lista permitida chegam ao argv; prompt por stdin; argumento perigoso é recusado', { skip: process.platform !== 'win32' }, async () => {
  const dir = path.join(tmp, 'bin com espaco'); fs.mkdirSync(dir);
  const argsFile = path.join(tmp, 'argv.json'), stdinFile = path.join(tmp, 'stdin.txt'), pwned = path.join(tmp, 'PWNED.txt');
  const script = path.join(dir, 'fake.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('7.7.7 (Claude Code fake)'); process.exit(0); }
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(a)); fs.writeFileSync(${JSON.stringify(stdinFile)}, input);
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })); });`);
  fs.writeFileSync(path.join(dir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  process.env.PATH = `${dir}${path.delimiter}${realPath}`;
  const ex = createExecutor(); // padrão: resolve como os terminais
  const p = await ex.probe();
  assert.deepEqual([p.available, p.version], [true, '7.7.7 (Claude Code fake)']);

  const prompt = 'Tarefa com & | " ^ % <> caracteres especiais no prompt';
  const h = ex.start({ missionId: 'm', taskId: 't', cwd: tmp, prompt, onLine: () => {} });
  const r = await h.done;
  assert.equal(r.status, 'completed', r.error);
  // O perfil padrão leva regras `Bash(npm test:*)` (parênteses, espaço e asterisco): no wrapper .cmd elas só passam ENTRE ASPAS DUPLAS (claude-cli.js) e chegam inteiras ao argv.
  assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')), executorArgs('default'), 'o argv do createExecutor() padrão é exatamente o do perfil padrão (executorArgs)');
  assert.equal(fs.readFileSync(stdinFile, 'utf8'), prompt, 'o prompt vai por stdin, intacto');

  // modelo/esforço do Planner (valores válidos) passam; qualquer coisa fora da lista permitida é recusada ANTES de iniciar
  const ok = ex.start({ missionId: 'm', taskId: 't', cwd: tmp, prompt: 'x', onLine: () => {}, args: ['-p', '--model', 'claude-opus-4[1m]', '--effort', 'high'] });
  assert.equal((await ok.done).status, 'completed');
  assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, 'utf8')), ['-p', '--model', 'claude-opus-4[1m]', '--effort', 'high']);
  for (const evil of ['x&echo>' + pwned, 'x|echo', 'a b', '"x"', 'x^y', '%PATH%', 'x\nwhoami', '$(x)', ';x']) {
    assert.throws(() => ex.start({ missionId: 'm', taskId: 't', cwd: tmp, prompt: 'x', onLine: () => {}, args: ['-p', '--model', evil] }), TypeError, JSON.stringify(evil));
  }
  assert.equal(fs.existsSync(pwned), false, 'nada foi interpretado pelo cmd.exe');
  assert.equal(ex.isBusy(), false, 'a recusa não deixa o executor ocupado');
});
