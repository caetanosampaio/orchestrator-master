// launchSpec no wrapper `.cmd` do Windows: argumentos que precisam de espaço/parênteses/`*` (regras de permissão como `Bash(npm run test:*)`) só passam ENTRE ASPAS e
// com um conjunto fechado de caracteres; qualquer metacaractere do cmd.exe é recusado. Só monta a linha de comando: nenhum processo é iniciado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchSpec, shellSafeArgs, cmdLineArgs } from '../claude-cli.js';
import { executorArgs } from '../exec-profile.js';

const cmd = () => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\x\\claude.cmd'], viaShell: true });
const spec = (args) => launchSpec({ injected: false }, args, { resolve: cmd });

test('regra com espaço, parênteses e `*` vai entre aspas duplas, e o restante da linha não muda', () => {
  const sp = spec(['-p', '--allowedTools', 'Bash(npm run test:*)', 'Bash(git branch --show-current)']);
  assert.equal(sp.verbatim, true); assert.equal(sp.file, 'cmd.exe'); assert.deepEqual(sp.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(sp.args[3], '""C:\\x\\claude.cmd" -p --allowedTools "Bash(npm run test:*)" "Bash(git branch --show-current)""');
  assert.equal(spec(['auth', 'login', '--console']).args[3], '""C:\\x\\claude.cmd" auth login --console"', 'argumentos simples continuam sem aspas (comportamento de sempre)');
});

test('o perfil `default` completo (executorArgs) é aceito no caminho .cmd; o `bypass` também', () => {
  for (const p of ['default', 'bypass']) { const sp = spec(executorArgs(p)); assert.equal(sp.error, undefined, p); assert.equal(sp.verbatim, true); }
  const line = spec(executorArgs('default')).args[3];
  for (const r of ['"Bash(npm test:*)"', '"Bash(npm run build:*)"', '"Bash(node --test:*)"', '"Bash(git status:*)"', '"Bash(git branch --show-current)"']) assert.ok(line.includes(` ${r}`), r);
  assert.match(line, / --disallowedTools WebFetch WebSearch --allowedTools "Bash\(/);
});

test('metacaracteres do cmd.exe, aspas, quebras de linha e barra invertida final são recusados (mesmo dentro do argumento entre aspas)', () => {
  const bad = ['Bash(npm test) & calc', 'Bash(a|b)', 'Bash(a>b)', 'Bash(a<b)', 'Bash(a^b)', 'Bash(%PATH%)', 'Bash(a!b)', 'Bash("x")', 'Bash(a"b)', 'Bash(a\nb)', 'Bash(a\rb)', 'Bash(a;b)', 'Bash($(x))', 'Bash(`x`)', 'Bash(a\\', 'a b\\', 'x y ', '(a b)', ' a b', '*', '(', 'á b', '', 'a&b c'];
  for (const a of bad) { const r = spec(['-p', a]); assert.match(r.error ?? '', /Argumento recusado/, JSON.stringify(a)); assert.equal(r.file, undefined); }
  assert.match(spec(['--allowedTools', 'Bash(npm run test:*)', 'x&calc']).error, /Argumento recusado/, 'um argumento ruim recusa a linha inteira');
  assert.match(spec([42]).error, /Argumento recusado/); assert.match(spec([null]).error, /Argumento recusado/);
});

test('aceita só a forma `Ferramenta(especificação)` com o conjunto fechado [A-Za-z0-9 ._:,=()*/\\-] entre aspas', () => {
  for (const a of ['Bash(npm run test:*)', 'Bash(git log:*)', 'Read(src/**)', 'Edit(C:\\work\\proj\\*)', 'mcp__srv__tool']) assert.ok(cmdLineArgs([a]), a);
  for (const a of ['a b', 'Bash npm test', '(npm test)', '1Bash(x)', 'Bash(x) y']) assert.equal(cmdLineArgs([a]), null, `texto livre com espaço continua recusado: ${a}`);
  assert.deepEqual(cmdLineArgs(['-p', 'Bash(npm test:*)']), ['-p', '"Bash(npm test:*)"']); assert.equal(cmdLineArgs(['Bash(x)', '$x']), null);
});

test('o validador original não mudou (shellSafeArgs ainda recusa espaço/parênteses) e o caminho sem shell/injetado não passa por aqui', () => {
  assert.equal(shellSafeArgs(['Bash(npm run test:*)']), false); assert.equal(shellSafeArgs(['auth', 'status']), true);
  const direct = launchSpec({ injected: false }, ['Bash(npm run test:*)'], { resolve: () => ({ file: 'C:\\x\\claude.exe', args: [], viaShell: false }) });
  assert.deepEqual([direct.verbatim, direct.args], [false, ['Bash(npm run test:*)']], '.exe: argv direto, sem aspas nem shell');
  const inj = launchSpec({ injected: true, command: 'node', prefixArgs: ['x.mjs'] }, ['Bash(a b)'], {}); assert.deepEqual(inj, { file: 'node', args: ['x.mjs', 'Bash(a b)'], verbatim: false });
});
