// Unidade: validateDir (workspaces.js). (Os testes de policy/executor/stream do ciclo antigo saíram com ele.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDir } from '../workspaces.js';

test('validateDir: relativo, UNC, raiz e inexistente são recusados', () => {
  assert.equal(validateDir('relativo/x').ok, false);
  assert.equal(validateDir('\\\\servidor\\share').ok, false);
  assert.equal(validateDir('C:\\').ok, false);
  assert.equal(validateDir('C:\\nao\\existe\\mesmo').ok, false);
  assert.equal(validateDir(process.cwd()).ok, true);
  assert.equal(validateDir(undefined).ok, false);
});
