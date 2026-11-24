// Ajudante de teste (não é um *.test.mjs): sobe o servidor REAL (server/index.js) com a sonda do Claude FALSA (fake-cli.mjs) e a CLI FALSA de contas (fake-claude-auth.mjs), pela costura em processo
// (globalThis.__ORCH_TEST_DEPS__). Sempre com ORCH_DATA_DIR temporário e PORT próprios, definidos por quem o inicia. O Claude Code real nunca é executado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { createClaudeProbe } = await import('../claude-probe.js');
globalThis.__ORCH_TEST_DEPS__ = {
  claudeProbe: createClaudeProbe({ command: process.execPath, prefixArgs: [path.join(here, 'fake-cli.mjs')] }),
  accountsCli: { command: process.execPath, prefixArgs: [path.join(here, 'fake-claude-auth.mjs')], detect: { codex: () => false } }, // Codex ausente: a migração do boot não depende do PATH da máquina
};
await import('../index.js');
