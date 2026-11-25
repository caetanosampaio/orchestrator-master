// Provedor Cursor CLI (`cursor-agent` / `agent`): o que é específico dele num terminal interativo (pane). Mesma interface do claude.js/codex.js.
//
// NÍVEL 2 PARCIAL (terminal + Maestro nas vagas que RECEBEM tarefas). Conferido contra a documentação oficial (cursor.com/docs/cli, jun/2026), NÃO contra a CLI instalada:
//   - o executável documentado é `agent` (instalado em ~/.local/bin). "agent" é um nome genérico: só vale se o arquivo real for do Cursor (caminho com "cursor");
//     `cursor-agent` (nome antigo) vem primeiro;
//   - modelo: `--model <id>` (só "auto" é certo sem a conta: a lista real vem de `agent models`); aprovação: `--force` aprova os comandos (acesso total);
//     `--mode ask` = só perguntas, sem editar (planejador);
//   - COORDENAÇÃO: o MCP do Cursor só lê arquivos; com a autorização do usuário, o FORGE grava UMA entrada sem porta nem token no ~/.cursor/mcp.json (cursor-mcp.js) e o pane
//     recebe o endereço e o token só no ambiente (FORGE_MCP_URL, FORGE_MCP_TOKEN). Não verificada com a CLI real (mcpVerified: false): o Maestro só manda tarefa depois que o pane se
//     conecta de fato. Na primeira vez o Cursor pode pedir para aprovar o servidor "forge-maestro" no próprio terminal (sem --approve-mcps, que aprovaria TODOS, inclusive os do projeto).
//   - SEM o papel (rolePrompt: false: não há flag nem variável para instruções extras) e SEM estado do agente (state: false): não é Maestro nem etapa de missão; entra em times nas
//     vagas que recebem tarefas (cada tarefa já diz como avisar o fim com report_done).
import fs from 'node:fs';
import { resolveOnPath, withoutClaudeEnv, frozenList } from './cli-path.js';
import { ensureCursorMcpEntry } from '../cursor-mcp.js';

export const MCP_TOKEN_ENV = 'FORGE_MCP_TOKEN', MCP_URL_ENV = 'FORGE_MCP_URL';
const MCP_URL_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/;

/** `cursor-agent` no PATH, senão `agent` desde que o arquivo real (link resolvido) seja do Cursor. */
export function resolveCursor(opts = {}) {
  const named = resolveOnPath(['cursor-agent'], opts);
  if (named) return named;
  const generic = resolveOnPath(['agent'], opts);
  if (!generic) return null;
  const file = generic.viaShell ? generic.args.at(-1) : generic.file;
  let real = file; try { real = fs.realpathSync(file); } catch { /* fica o caminho do PATH */ }
  // Um trecho do caminho real tem de SER do Cursor (pasta `cursor`, `.cursor`, `cursor-agent`, `cursor_agent`, `cursor-cli`, `Cursor.app` ou o executável `cursor-agent`), não só conter a
  // palavra: `…\cursor-projects\bin\agent` não vale. É heurística contra outro `agent` qualquer no PATH, não fronteira de confiança (o PATH já é do usuário).
  return real.split(/[\\/]+/).some((seg) => /^\.?cursor([-_]?(agent|cli))?(\.(cmd|bat|exe|ps1|js|mjs|app))?$/i.test(seg)) ? generic : null;
}

export const CURSOR_OPTIONS = Object.freeze({ models: frozenList([['auto', 'Automático']]), efforts: frozenList([]) });

export const cursorProvider = Object.freeze({
  id: 'cursor',
  label: 'Cursor CLI',
  resolve: resolveCursor,
  options: CURSOR_OPTIONS,
  notFoundMessage: 'O Cursor CLI não foi encontrado no PATH (instale pelo site do Cursor, com "curl https://cursor.com/install -fsS | bash", e entre com "agent login").',
  install: 'curl https://cursor.com/install -fsS | bash',
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: true, mcpVerified: false, readOnly: true, planner: false, state: false, rolePrompt: false }),
  mcpTransport: 'env', mcpTokenEnv: MCP_TOKEN_ENV, // credencial do Maestro só no ambiente do processo
  /** Antes do spawn: a entrada global do FORGE no ~/.cursor/mcp.json (só com coordenação pedida). Falha = o pane abre sem a coordenação (o Maestro o trata como livre). */
  prepare({ mcp = null, homeDir } = {}) { return mcp?.url ? ensureCursorMcpEntry({ homeDir }) : { ok: true, changed: false }; },
  /** O endereço do MCP do FORGE vai no ambiente (a entrada global usa ${env:FORGE_MCP_URL}); sem arquivos por pane. */
  paneFiles({ mcp = null } = {}) { return { files: {}, env: mcp?.url && MCP_URL_RE.test(String(mcp.url)) ? { [MCP_URL_ENV]: String(mcp.url) } : {} }; },
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
