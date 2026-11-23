// evidence.js foi reduzido a SKIP_DIRS / isGitName / isSkippedDir (diretórios que nenhuma varredura de arquivos deve percorrer).
// (Os testes de categoryOf, snapshot, buildEvidence e critérios saíram com o ciclo antigo.)
import test from 'node:test';
import assert from 'node:assert/strict';

const { SKIP_DIRS, isSkippedDir } = await import('../evidence.js');

test('SKIP_DIRS: dependências, saídas de build, caches e .git são pulados; código comum não', () => {
  for (const d of ['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', '__pycache__', '.venv', 'target']) { assert.equal(SKIP_DIRS.has(d), true, d); assert.equal(isSkippedDir(d), true, d); }
  for (const d of ['src', 'server', 'client', 'test', '.github', 'lib']) assert.equal(isSkippedDir(d), false, d);
});
