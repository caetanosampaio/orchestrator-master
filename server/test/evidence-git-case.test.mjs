// evidence.js (reduzido a isSkippedDir/isGitName/SKIP_DIRS): `.git` sem distinção de caixa (e com ponto/espaço/fluxo final, ou nome curto 8.3 do NTFS) é o diretório interno do Git.
// (safeRelPath, snapshotWorkspace e scopeSnapshot saíram com o ciclo antigo.)
import test from 'node:test';
import assert from 'node:assert/strict';

const { isGitName, isSkippedDir } = await import('../evidence.js');

test('isGitName: .git em qualquer caixa e com ponto/espaço/fluxo final; .github e afins não', () => {
  for (const x of ['.git', '.GIT', '.Git', '.git.', '.git ', '.git. .', '.GIT::$INDEX_ALLOCATION']) assert.equal(isGitName(x), true, x);
  for (const x of ['.github', '.gitignore', '.gitattributes', '.gitkeep', 'git', 'x.git', '.git2', '.gi', '', null, undefined]) assert.equal(isGitName(x), false, String(x));
  assert.equal(isSkippedDir('.GIT'), true); assert.equal(isSkippedDir('node_modules'), true); assert.equal(isSkippedDir('src'), false); assert.equal(isSkippedDir('.github'), false);
});

test('nome curto 8.3 do NTFS (GIT~1) é tratado como .git; nomes parecidos não', () => {
  for (const x of ['GIT~1', 'git~1', '.GIT~1', 'GIT~12']) assert.equal(isGitName(x), true, x);
  for (const x of ['git~', 'git~a', 'gitx~1', 'mygit~1', 'GITHUB~1']) assert.equal(isGitName(x), false, x);
  assert.equal(isSkippedDir('GIT~1'), true);
});
