// Verificação opcional da missão (flow-verify.js): Git REAL em repositório temporário, ORCH_DATA_DIR temporário e process.execPath como executável.
// Prova: passa, falha (fim da saída), timeout (processo morto), executável inexistente, saída enorme, cópia removida, pasta do usuário intacta e validação dos args.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flowverify-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.FORGE_TEST_TOKEN = 'segredo-super-secreto-123';
const { createFlowVerify, validateVerifyCommand } = await import('../flow-verify.js');
after(() => { delete process.env.FORGE_TEST_TOKEN; fs.rmSync(tmp, { recursive: true, force: true }); });

const G = (cwd, args) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const NODE = process.execPath;
const pidFile = path.join(tmp, 'hang.pid');

const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo);
const SCRIPTS = {
  'ok.js': "console.log('tudo certo'); console.log('cwd=' + process.cwd());",
  'fail.js': "for (let i = 1; i <= 800; i++) console.log('linha ' + i); console.error('ERRO FINAL: quebrou aqui'); process.exitCode = 3;", // exitCode, não exit(): no Linux o exit() corta o stdout ainda pendente no pipe
  'hang.js': "require('fs').writeFileSync(process.argv[2], String(process.pid)); console.log('iniciou'); setInterval(() => {}, 1000);",
  'big.js': "const chunk = 'x'.repeat(1024) + '\\n'; setInterval(() => { for (let i = 0; i < 64; i++) process.stdout.write(chunk); }, 1); setTimeout(() => process.stdout.write('NUNCA-CHEGA'), 60000);",
  'env.js': "console.log('seg=' + process.env.FORGE_TEST_TOKEN + ' ci=' + process.env.CI); console.log('token=abcdef123456 http://u:p4ss@host/x');",
};
G(repo, ['init', '-q', '-b', 'main']); G(repo, ['config', 'core.autocrlf', 'false']);
for (const [f, c] of Object.entries(SCRIPTS)) fs.writeFileSync(path.join(repo, f), c);
fs.writeFileSync(path.join(repo, 'marcador.txt'), 'v1\n');
G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'base']);
const SHA = G(repo, ['rev-parse', 'HEAD']);

const tmpRoot = path.join(tmp, 'copias'); fs.mkdirSync(tmpRoot);
const fv = createFlowVerify({ tmpRoot, timeoutScale: 0.05, maxOutputBytes: 64 * 1024 }); // 10 s viram 0,5 s
const leftovers = () => fs.readdirSync(tmpRoot);
const snapshot = () => ({ refs: G(repo, ['for-each-ref']), status: G(repo, ['status', '--porcelain']), worktrees: G(repo, ['worktree', 'list']), head: G(repo, ['rev-parse', 'HEAD']), branches: G(repo, ['branch', '--list']) });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const SHAPE = ['at', 'command', 'durationMs', 'exitCode', 'outputTail', 'status', 'truncated'];

test('validateVerifyCommand: nulo, padrão de 300 s e normalização', () => {
  assert.deepEqual(validateVerifyCommand(null), { value: null });
  assert.deepEqual(validateVerifyCommand(undefined), { value: null });
  assert.deepEqual(validateVerifyCommand({ args: ['npm', 'test'] }), { value: { args: ['npm', 'test'], timeoutSec: 300 } });
  assert.deepEqual(validateVerifyCommand({ args: ['npm', 'test'], timeoutSec: 10, extra: 1 }), { value: { args: ['npm', 'test'], timeoutSec: 10 } });
  assert.equal(validateVerifyCommand({ args: ['x'], timeoutSec: 1800 }).value.timeoutSec, 1800);
  assert.equal(validateVerifyCommand({ args: Array(16).fill('a') }).value.args.length, 16);
  assert.equal(validateVerifyCommand({ args: ['a'.repeat(200)] }).value.args[0].length, 200);
});

test('validateVerifyCommand: rejeita args e timeout inválidos', () => {
  const bad = [
    'texto', 5, [], { }, { args: [] }, { args: 'npm test' }, { args: Array(17).fill('a') }, { args: [''] }, { args: ['   '] }, { args: [5] }, { args: [null] },
    { args: ['a'.repeat(201)] }, { args: ['ok', 'a\nb'] }, { args: ['ok', 'a\u0000b'] }, { args: ['ok\r'] }, { args: ['ok', 'a\u007fb'] },
    { args: ['a'], timeoutSec: 9 }, { args: ['a'], timeoutSec: 1801 }, { args: ['a'], timeoutSec: 10.5 }, { args: ['a'], timeoutSec: '60' }, { args: ['a'], timeoutSec: NaN },
  ];
  for (const b of bad) assert.ok(validateVerifyCommand(b).error, `deveria rejeitar ${JSON.stringify(b)}`);
  assert.equal(validateVerifyCommand({ args: ['ok', 'tem espaço', 'e "aspas"'] }).error, undefined); // espaços e aspas são só texto (sem shell)
});

test('passa: código 0, formato do resultado, cópia no commit certo e removida', async () => {
  const r = await fv.run(repo, SHA, { args: [NODE, 'ok.js'] });
  assert.equal(r.status, 'pass'); assert.equal(r.exitCode, 0);
  assert.deepEqual(Object.keys(r).sort(), SHAPE);
  assert.ok(r.outputTail.includes('tudo certo'));
  assert.ok(r.command.endsWith('ok.js') && r.command.includes(' '));
  assert.ok(Number.isFinite(r.durationMs) && r.durationMs >= 0);
  assert.ok(!Number.isNaN(Date.parse(r.at)));
  assert.equal(r.truncated, false);
  const cwd = r.outputTail.match(/cwd=(.+)/)[1].trim();
  assert.ok(path.resolve(cwd).toLowerCase().startsWith(path.resolve(tmpRoot).toLowerCase()), 'executou numa cópia dentro de tmpRoot');
  assert.notEqual(path.resolve(cwd).toLowerCase(), path.resolve(repo).toLowerCase(), 'nunca no repositório do usuário');
  assert.equal(fs.existsSync(cwd), false, 'a cópia foi apagada');
  assert.deepEqual(leftovers(), []);
});

test('a cópia fica no commit pedido (e não no que está no repositório hoje)', async () => {
  fs.writeFileSync(path.join(repo, 'check.js'), "console.log('marcador=' + require('fs').readFileSync('marcador.txt', 'utf8').trim());");
  G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'v1 + check']);
  const sha1 = G(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo, 'marcador.txt'), 'v2\n'); G(repo, ['commit', '-q', '-am', 'v2']);
  const r = await fv.run(repo, sha1, { args: [NODE, 'check.js'] });
  assert.equal(r.status, 'pass');
  assert.match(r.outputTail, /marcador=v1/);
});

test('falha: código ≠ 0 e só o FIM da saída, limitado a 4000', async () => {
  const r = await fv.run(repo, SHA, { args: [NODE, 'fail.js'] });
  assert.equal(r.status, 'fail'); assert.equal(r.exitCode, 3);
  assert.ok(r.outputTail.length <= 4000);
  assert.equal(r.truncated, true);
  assert.ok(r.outputTail.includes('ERRO FINAL: quebrou aqui'));
  assert.ok(r.outputTail.includes('linha 800'));
  assert.ok(!r.outputTail.includes('linha 1\n'), 'o começo da saída foi cortado');
  assert.deepEqual(leftovers(), []);
});

test('timeout: status timeout, processo morto, cópia apagada', async () => {
  fs.rmSync(pidFile, { force: true });
  const r = await fv.run(repo, SHA, { args: [NODE, 'hang.js', pidFile], timeoutSec: 10 });
  assert.equal(r.status, 'timeout'); assert.equal(r.exitCode, null);
  assert.match(r.outputTail, /iniciou/);
  assert.match(r.outputTail, /tempo máximo/);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(alive(pid), false, 'o processo foi encerrado');
  assert.deepEqual(leftovers(), [], 'a cópia foi apagada também após o timeout');
});

test('executável inexistente: error em português e cópia apagada', async () => {
  const r = await fv.run(repo, SHA, { args: ['forge-programa-que-nao-existe-xyz', '--x'] });
  assert.equal(r.status, 'error'); assert.equal(r.exitCode, null);
  assert.match(r.outputTail, /Execut[aá]vel n[aã]o encontrado/);
  assert.deepEqual(leftovers(), []);
});

test('.cmd/.bat no Windows: error claro, sem clonar nem executar', async () => {
  const win = createFlowVerify({ tmpRoot, platform: 'win32' });
  const r = await win.run(repo, SHA, { args: ['build.cmd', 'x'] });
  assert.equal(r.status, 'error');
  assert.match(r.outputTail, /\.cmd\/\.bat/); assert.match(r.outputTail, /shell/);
  assert.deepEqual(leftovers(), []);
});

test('saída enorme: processo encerrado no teto, resultado pequeno, cópia apagada', async () => {
  const r = await fv.run(repo, SHA, { args: [NODE, 'big.js'] });
  assert.equal(r.status, 'fail'); assert.equal(r.exitCode, null);
  assert.equal(r.truncated, true);
  assert.ok(r.outputTail.length <= 4000);
  assert.match(r.outputTail, /passou de 65536 bytes/);
  assert.ok(!r.outputTail.includes('NUNCA-CHEGA'));
  assert.deepEqual(leftovers(), []);
});

test('ambiente sem segredos, CI=1 e segredos ocultados na saída', async () => {
  const r = await fv.run(repo, SHA, { args: [NODE, 'env.js'] });
  assert.equal(r.status, 'pass');
  assert.match(r.outputTail, /seg=undefined ci=1/);
  assert.ok(!r.outputTail.includes('abcdef123456')); assert.ok(!r.outputTail.includes('p4ss'));
  assert.ok(!r.outputTail.includes('segredo-super-secreto'));
});

test('ambiente por LISTA PERMITIDA: variáveis fora da lista (URL com senha, NODE_OPTIONS, PAT) não chegam ao comando; PATH e a pasta temporária sim', async () => {
  const set = { FORGE_TEST_CONN: 'postgres://u:senhaXYZ@h/db', FORGE_TEST_PAT: 'ghx_abc', NODE_OPTIONS: '--no-warnings', FORGE_TEST_WEBHOOK: 'https://hooks.exemplo/abc', JAVA_HOME: 'C:\\jdk-teste', ProgramW6432: 'C:\\Program Files', TMPDIR: os.tmpdir() }; // TMPDIR explícito: no Linux do CI nenhuma variável de pasta temporária vem definida
  const old = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  try {
    fs.writeFileSync(path.join(repo, 'env2.js'), "const k=['FORGE_TEST_CONN','FORGE_TEST_PAT','NODE_OPTIONS','FORGE_TEST_WEBHOOK'].filter((x)=>process.env[x]!==undefined); console.log('vazou=' + JSON.stringify(k) + ' java=' + process.env.JAVA_HOME + ' path=' + Boolean(process.env.PATH||process.env.Path) + ' tmp=' + Boolean(process.env.TEMP||process.env.TMPDIR||process.env.TMP));");
    G(repo, ['add', '-A']); G(repo, ['commit', '-q', '-m', 'env2']);
    const sha = G(repo, ['rev-parse', 'HEAD']);
    const r = await fv.run(repo, sha, { args: [NODE, 'env2.js'] });
    assert.equal(r.status, 'pass', r.outputTail); assert.match(r.outputTail, /vazou=\[\] java=C:\\jdk-teste path=true tmp=true/);
  } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('a pasta e o repositório do usuário ficam intactos (sem worktree, branch, ref nem arquivo)', async () => {
  const antes = snapshot();
  const arquivos = fs.readdirSync(repo).sort();
  const gitDir = path.join(repo, '.git');
  const ramos = fs.readdirSync(path.join(gitDir, 'refs', 'heads')).sort();
  for (const args of [[NODE, 'ok.js'], [NODE, 'fail.js'], ['forge-nao-existe-xyz']]) await fv.run(repo, SHA, { args });
  await fv.run(repo, SHA, { args: [NODE, 'hang.js', pidFile], timeoutSec: 10 });
  assert.deepEqual(snapshot(), antes);
  assert.deepEqual(fs.readdirSync(repo).sort(), arquivos);
  assert.deepEqual(fs.readdirSync(path.join(gitDir, 'refs', 'heads')).sort(), ramos);
  assert.equal(fs.existsSync(path.join(gitDir, 'worktrees')), false);
  assert.equal(G(repo, ['remote']), '');
  assert.deepEqual(leftovers(), []);
});

test('entradas inválidas e falhas do Git viram error (nunca lança) e não deixam cópia', async () => {
  const bad = [
    await fv.run(repo, SHA, { args: [] }),
    await fv.run(repo, SHA, { args: [NODE, 'ok.js'], timeoutSec: 5 }),
    await fv.run(repo, 'main', { args: [NODE, 'ok.js'] }),
    await fv.run(repo, '0'.repeat(40), { args: [NODE, 'ok.js'] }), // SHA bem formado mas inexistente
    await fv.run(path.join(tmp, 'nao-e-repo'), SHA, { args: [NODE, 'ok.js'] }),
    await fv.run(undefined, SHA, { args: [NODE, 'ok.js'] }),
    await fv.run(repo, SHA, undefined),
  ];
  for (const r of bad) { assert.equal(r.status, 'error'); assert.deepEqual(Object.keys(r).sort(), SHAPE); assert.ok(r.outputTail.length > 0); }
  assert.match(bad[3].outputTail, /posicionar a cópia/);
  assert.match(bad[4].outputTail, /cópia isolada/);
  assert.deepEqual(leftovers(), []);
  const falho = createFlowVerify({ tmpRoot, runGit: async () => { throw new Error('git sumiu'); } });
  const r = await falho.run(repo, SHA, { args: [NODE, 'ok.js'] });
  assert.equal(r.status, 'error'); assert.match(r.outputTail, /git sumiu/);
  assert.deepEqual(leftovers(), []);
});

test('signal abortado: o processo é encerrado, status error "Verificação cancelada." e a cópia apagada; já abortado antes = nem clona', async () => {
  const pf = path.join(tmp, 'hang-abort.pid'); fs.rmSync(pf, { force: true });
  const ac = new AbortController();
  const p = fv.run(repo, SHA, { args: [NODE, 'hang.js', pf], timeoutSec: 1800, signal: ac.signal });
  for (let i = 0; i < 100 && !fs.existsSync(pf); i++) await new Promise((res) => setTimeout(res, 50));
  const pid = Number(fs.readFileSync(pf, 'utf8')); assert.ok(pid > 0);
  ac.abort();
  const r = await p;
  assert.equal(r.status, 'error'); assert.equal(r.exitCode, null); assert.match(r.outputTail, /Verificação cancelada/); assert.match(r.outputTail, /iniciou/);
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(alive(pid), false, 'o processo foi encerrado');
  assert.deepEqual(leftovers(), [], 'a cópia foi apagada também após cancelar');
  const pre = new AbortController(); pre.abort();
  let clones = 0;
  const fv2 = createFlowVerify({ tmpRoot, runGit: async () => { clones++; return { code: 1, err: 'não deveria' }; } });
  const r2 = await fv2.run(repo, SHA, { args: [NODE, 'ok.js'], signal: pre.signal });
  assert.equal(r2.status, 'error'); assert.match(r2.outputTail, /Verificação cancelada/); assert.equal(clones, 0); assert.deepEqual(leftovers(), []);
});
