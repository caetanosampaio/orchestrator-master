// Ajudante de teste (não é um *.test.mjs): sobe o servidor REAL (server/index.js) com a CLI FALSA e costuras de falha, pela costura em processo (globalThis.__ORCH_TEST_DEPS__).
// Sempre com ORCH_DATA_DIR temporário e PORT próprios, definidos por quem o inicia. Nenhum modelo é chamado.
//   AUDIT_BOOM=<arquivo>  : enquanto o arquivo existir, executor.probe() lança (prova que /api/state e /api/agents não derrubam o servidor).
//                          (idem para o gitInfo da rota /api/workspaces/:id/git)
//   AUDIT_GIT=<script.mjs>: Git falso (node + script); AUDIT_GIT=missing: Git inexistente.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { createExecutor } = await import('../executor/index.js');
const { createGitProbe } = await import('../prereqs.js');

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-cli.mjs');
const executor = createExecutor({ command: process.execPath, prefixArgs: [FAKE], args: [] });
const realProbe = executor.probe;
if (process.env.AUDIT_BOOM) executor.probe = async () => { if (fs.existsSync(process.env.AUDIT_BOOM)) throw new Error('probe explodiu (simulado)'); return realProbe(); };
const gitProbe = process.env.AUDIT_GIT === 'missing' ? createGitProbe({ command: 'git-que-nao-existe-forge-audit' })
  : process.env.AUDIT_GIT ? createGitProbe({ command: process.execPath, prefixArgs: [process.env.AUDIT_GIT] }) : undefined;
globalThis.__ORCH_TEST_DEPS__ = { executor, ...(process.env.AUDIT_BOOM ? { gitInfo: async () => { if (fs.existsSync(process.env.AUDIT_BOOM)) throw new Error('git explodiu (simulado)'); return { isRepo: false }; } } : {}), ...(gitProbe ? { gitProbe } : {}) };
await import('../index.js');
