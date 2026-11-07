// Ajudante de teste (não é um *.test.mjs): sobe o servidor REAL (server/index.js) com o executor FALSO e a CLI FALSA de contas (fake-claude-auth.mjs), pela costura em processo
// (globalThis.__ORCH_TEST_DEPS__). Sempre com ORCH_DATA_DIR temporário e PORT próprios, definidos por quem o inicia. O Claude Code real nunca é executado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { createExecutor } = await import('../executor/index.js');
globalThis.__ORCH_TEST_DEPS__ = {
  executor: createExecutor({ command: process.execPath, prefixArgs: [path.join(here, 'fake-cli.mjs')], args: [] }),
  accountsCli: { command: process.execPath, prefixArgs: [path.join(here, 'fake-claude-auth.mjs')] },
};
await import('../index.js');
