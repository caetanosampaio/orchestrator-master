// resolveNpmCli (npm-cli.js): onde fica o npm-cli.js que acompanha o Node; consumidores das Missões v2 importam do módulo novo.
// Só lógica pura e leitura de arquivos do repositório; nenhum banco, nenhum processo.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveNpmCli } from '../npm-cli.js';

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('instalação do Windows: npm ao lado do node.exe', () => {
  const exe = path.join('C:', 'nodejs', 'node.exe');
  const want = path.join('C:', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.equal(resolveNpmCli({ execPath: exe, exists: (p) => p === want }), want);
});

test('Linux/macOS: npm em ../lib/node_modules; o caminho ao lado do executável tem prioridade', () => {
  const exe = path.join('/usr', 'local', 'bin', 'node');
  const lib = path.join(path.dirname(exe), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const side = path.join(path.dirname(exe), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.equal(resolveNpmCli({ execPath: exe, exists: (p) => p === lib }), lib);
  assert.equal(resolveNpmCli({ execPath: exe, exists: (p) => p === lib || p === side }), side);
});

test('sem npm: null', () => {
  assert.equal(resolveNpmCli({ execPath: path.join('x', 'node'), exists: () => false }), null);
});

test('padrão (este Node): o caminho devolvido existe, ou null', () => {
  const p = resolveNpmCli();
  assert.ok(p === null || (fs.existsSync(p) && p.endsWith('npm-cli.js')));
});

test('worktrees.js e flow-verify.js importam de npm-cli.js; o verify.js do ciclo antigo não existe mais', () => {
  for (const f of ['worktrees.js', 'flow-verify.js']) {
    const src = fs.readFileSync(path.join(serverDir, f), 'utf8');
    assert.match(src, /import \{ resolveNpmCli \} from '\.\/npm-cli\.js';/, f);
    assert.doesNotMatch(src, /from '\.\/verify\.js'/, `${f} não depende de verify.js`);
  }
  assert.equal(fs.existsSync(path.join(serverDir, 'verify.js')), false, 'verify.js (ciclo antigo) foi removido');
});
