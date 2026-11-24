// Provedor Cursor CLI (`cursor-agent` / `agent`): o que é específico dele num terminal interativo (pane). Mesma interface do claude.js/codex.js.
//
// NÍVEL 1 (só terminal). Conferido contra a documentação oficial (cursor.com/docs/cli, jun/2026), NÃO contra a CLI instalada (sem ela nesta máquina):
//   - o executável documentado é `agent` (instalado em ~/.local/bin). "agent" é um nome genérico: só vale se o arquivo real for do Cursor (caminho com "cursor");
//     `cursor-agent` (nome antigo) vem primeiro;
//   - modelo: `--model <id>` (só "auto" é certo sem a conta: a lista real vem de `agent models`); aprovação: `--force` aprova os comandos (acesso total);
//     `--mode ask` = só perguntas, sem editar (planejador);
//   - SEM coordenação (mcp: false): o MCP do Cursor só lê arquivos (.cursor/mcp.json do projeto ou ~/.cursor/mcp.json); o FORGE não grava na sua configuração.
import fs from 'node:fs';
import { resolveOnPath, withoutClaudeEnv, frozenList } from './cli-path.js';

/** `cursor-agent` no PATH, senão `agent` desde que o arquivo real (link resolvido) seja do Cursor. */
export function resolveCursor(opts = {}) {
  const named = resolveOnPath(['cursor-agent'], opts);
  if (named) return named;
  const generic = resolveOnPath(['agent'], opts);
  if (!generic) return null;
  const file = generic.viaShell ? generic.args.at(-1) : generic.file;
  let real = file; try { real = fs.realpathSync(file); } catch { /* fica o caminho do PATH */ }
  return /cursor/i.test(real) ? generic : null;
}

export const CURSOR_OPTIONS = Object.freeze({ models: frozenList([['auto', 'Automático']]), efforts: frozenList([]) });

export const cursorProvider = Object.freeze({
  id: 'cursor',
  label: 'Cursor CLI',
  resolve: resolveCursor,
  options: CURSOR_OPTIONS,
  notFoundMessage: 'O Cursor CLI não foi encontrado no PATH (instale pelo site do Cursor, com "curl https://cursor.com/install -fsS | bash", e entre com "agent login").',
  install: 'curl https://cursor.com/install -fsS | bash',
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: false, readOnly: true }),
  // HIPÓTESE (não verificada sem a CLI): o TUI aceita colagem entre colchetes; o Enter segue separado.
  submit: Object.freeze({ bracketed: true, delayMs: 300 }),
  // .cursor (mcp.json, cli.json com permissões, regras): qualquer arquivo não versionado ou alterado pede confirmação.
  projectConfig: Object.freeze({ files: Object.freeze([]), dirs: Object.freeze(['.cursor']) }),
  envFor: withoutClaudeEnv,
  /** Argumentos do pane (sempre sessão nova). `readOnly` -> `--mode ask` (e nunca `--force`); `fullAccess` (só o true estrito) -> `--force`. */
  paneArgs({ mode = 'new', model = null, fullAccess = false, readOnly = false } = {}) {
    if (mode !== 'new') throw new Error('O Cursor CLI não oferece retomada nem bifurcação neste adaptador.');
    const args = [];
    if (readOnly === true) args.push('--mode', 'ask');
    else if (fullAccess === true) args.push('--force');
    if (model) args.push('--model', model);
    return args;
  },
});
