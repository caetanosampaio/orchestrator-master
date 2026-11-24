#!/usr/bin/env node
// Hook BeforeAgent do Gemini CLI (registrado pelo FORGE no arquivo de padrões do sistema do pane: providers/gemini.js > paneFiles). Entrega o PAPEL do terminal (construtor, revisor…)
// como contexto extra do turno: o Gemini acrescenta `hookSpecificOutput.additionalContext` ao pedido (documentado em geminicli.com/docs/hooks/reference; conferido no hookRunner.ts).
// Uma vez por sessão do Gemini (GEMINI_SESSION_ID, que o próprio Gemini passa ao hook): o texto fica no histórico da conversa e não se repete a cada turno. Nunca bloqueia o agente:
// qualquer erro sai com `{}` e código 0. Uso: node gemini-role-hook.mjs <arquivo do papel>
import fs from 'node:fs';

const MAX = 8000; // o papel + a instrução do time cabem folgados; acima disso é corte, nunca leitura sem limite
const quiet = () => { process.stdout.write('{}'); process.exit(0); };

try {
  const file = process.argv[2];
  if (typeof file !== 'string' || !file) quiet();
  const sid = String(process.env.GEMINI_SESSION_ID ?? 'sem-sessao').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'sem-sessao';
  const marker = `${file}.${sid}.entregue`;
  if (fs.existsSync(marker)) quiet(); // já entregue nesta sessão
  const text = fs.readFileSync(file, 'utf8').slice(0, MAX).trim();
  if (!text) quiet();
  try { fs.writeFileSync(marker, '', { mode: 0o600 }); } catch { /* sem a marca, entrega de novo no próximo turno: melhor que não entregar */ }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: `[Instrução do FORGE para este terminal] ${text}` } }));
  process.exit(0);
} catch { quiet(); }
