// Ajudante de teste (não é um *.test.mjs): sobe o servidor REAL (server/index.js) com a sonda do Claude FALSA e costuras de falha, pela costura em processo (globalThis.__ORCH_TEST_DEPS__).
// Sempre com ORCH_DATA_DIR temporário e PORT próprios, definidos por quem o inicia. Nenhum modelo é chamado.
//   AUDIT_BOOM=<arquivo>  : enquanto o arquivo existir, a sonda do Claude lança (prova que /api/state não derruba o servidor).
//                          (idem para o gitInfo da rota /api/workspaces/:id/git)
//   AUDIT_GIT=<script.mjs>: Git falso (node + script); AUDIT_GIT=missing: Git inexistente.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { createClaudeProbe } = await import('../claude-probe.js');
const { createGitProbe } = await import('../prereqs.js');

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-cli.mjs');
const realProbe = createClaudeProbe({ command: process.execPath, prefixArgs: [FAKE] });
const claudeProbe = !process.env.AUDIT_BOOM ? realProbe
  : Object.assign(async () => { if (fs.existsSync(process.env.AUDIT_BOOM)) throw new Error('probe explodiu (simulado)'); return realProbe(); }, { reset: realProbe.reset, cachedAvailability: realProbe.cachedAvailability });
const gitProbe = process.env.AUDIT_GIT === 'missing' ? createGitProbe({ command: 'git-que-nao-existe-forge-audit' })
  : process.env.AUDIT_GIT ? createGitProbe({ command: process.execPath, prefixArgs: [process.env.AUDIT_GIT] }) : undefined;
globalThis.__ORCH_TEST_DEPS__ = { claudeProbe, ...(process.env.AUDIT_BOOM ? { gitInfo: async () => { if (fs.existsSync(process.env.AUDIT_BOOM)) throw new Error('git explodiu (simulado)'); return { isRepo: false }; } } : {}), ...(gitProbe ? { gitProbe } : {}) };
await import('../index.js');
