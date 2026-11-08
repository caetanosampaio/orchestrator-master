// Provedor Codex CLI: o que é específico do `codex` num terminal interativo (pane). Mesma interface do claude.js; o terminals.js só conhece essa interface.
//
// Diferenças em relação ao Claude Code (verificadas contra o codex-cli 0.167.0, sem login e sem rede):
//   - NÃO aceita id de sessão escolhido por quem chama: o id interno do FORGE (agentSessionId) é só uma chave nossa; por isso o pane do Codex não é retomável nem bifurcável (capabilities);
//   - o MCP do Maestro entra por `-c mcp_servers.<nome>.*` e o token vai SÓ no ambiente do processo (`bearer_token_env_var`): nenhum arquivo é escrito e nada vai para ~/.codex;
//   - o prompt do papel vai em `developer_instructions`; não há plugins (loadouts) nem hooks de estado ligados ainda (capabilities), então a tela cai na leitura pela saída;
//   - `--no-alt-screen` mantém a saída no fluxo normal do terminal, que é o que o `read_pane_output` do Maestro consegue ler.
import fs from 'node:fs';
import path from 'node:path';

/** Codex no PATH (arquivo real, nunca por shell). `.cmd`/`.bat` (npm no Windows) precisam do cmd.exe. null se não achar. */
export function resolveCodex({ env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex'];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d.replace(/^"|"$/g, ''), n);
    try { if (fs.statSync(f).isFile()) return /\.(cmd|bat)$/i.test(f) ? { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f], viaShell: true } : { file: f, args: [], viaShell: false }; } catch { /* próximo */ }
  }
  return null;
}

export const MCP_TOKEN_ENV = 'FORGE_MCP_TOKEN';
const SERVER_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/; // chave TOML simples: o nome do servidor (forge_<hex>) sempre cabe aqui; qualquer outra coisa não vira argumento
// Variáveis do Claude Code que não fazem sentido no Codex (e a sessão pai do Claude que abriu o servidor).
const DROP_ENV = /^(CLAUDE_|ANTHROPIC_)/i;

/** Valor TOML de texto: entre aspas (JSON é um subconjunto válido de string TOML). Num wrapper .cmd (cmd.exe) as aspas quebram a linha de comando: vai o texto cru, que o Codex aceita como literal. */
const tomlStr = (v, quote) => (quote ? JSON.stringify(String(v)) : String(v));

export const codexProvider = Object.freeze({
  id: 'codex',
  label: 'Codex CLI',
  resolve: resolveCodex,
  notFoundMessage: 'O Codex CLI não foi encontrado no PATH (instale com "npm i -g @openai/codex" e faça "codex login").',
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false }),
  mcpTransport: 'env', mcpTokenEnv: MCP_TOKEN_ENV, // credencial do Maestro só no ambiente do processo
  // O TUI do Codex detecta colagem em rajada; o bloco vai entre marcadores de colagem entre colchetes e o Enter segue separado.
  submit: Object.freeze({ bracketed: true, delayMs: 300 }),
  // Configuração de projeto que o Codex carrega e executa: toda a pasta .codex (config.toml, hooks.json…); sem parser TOML, qualquer arquivo não versionado ou alterado pede confirmação.
  projectConfig: Object.freeze({ files: Object.freeze([]), dirs: Object.freeze(['.codex']) }),
  /** Ambiente do filho: o do processo, sem variáveis do Claude. O token do Maestro é acrescentado pelo terminals.js (só no ambiente do PTY). */
  envFor(base) {
    const env = { ...base };
    for (const k of Object.keys(env)) if (DROP_ENV.test(k)) delete env[k];
    return env;
  },
  /**
   * Argumentos do pane (sempre sessão nova). `mcp` = { url, serverName } quando o pane tem coordenação; o token vai no ambiente (MCP_TOKEN_ENV), nunca na linha de comando.
   * `quote: false` é para wrapper .cmd. As ferramentas do Maestro são pré-aprovadas só nesse servidor (default_tools_approval_mode), como o --allowedTools do Claude;
   * a aprovação humana das TAREFAS continua no próprio Maestro (send_task fica pendente até o usuário decidir).
   */
  paneArgs({ mode = 'new', prompt, mcp = null, quote = true, trustDir = null }) {
    if (mode !== 'new') throw new Error('O Codex CLI não oferece retomada nem bifurcação neste adaptador.');
    const args = ['--no-alt-screen', '-s', 'workspace-write', '-a', 'on-request'];
    // Confiança da pasta SÓ para este processo (o Codex não pergunta "confiar nesta pasta?"): nada é gravado no config do usuário. A chave usa aspas simples (literal TOML), que valem até no cmd.exe;
    // pasta com aspa simples, controle ou metacaractere do cmd.exe fica sem o argumento (a pergunta aparece normalmente).
    if (typeof trustDir === 'string' && trustDir && !/['\u0000-\u001f]/.test(trustDir) && (quote || !/[&|<>^%"!]/.test(trustDir))) args.push('-c', `projects.'${trustDir}'.trust_level='trusted'`);
    if (prompt) args.push('-c', `developer_instructions=${tomlStr(prompt, quote)}`);
    if (mcp && SERVER_KEY_RE.test(String(mcp.serverName)) && mcp.url) {
      const k = `mcp_servers.${mcp.serverName}`;
      args.push('-c', `${k}.url=${tomlStr(mcp.url, quote)}`, '-c', `${k}.bearer_token_env_var=${tomlStr(MCP_TOKEN_ENV, quote)}`, '-c', `${k}.default_tools_approval_mode=${tomlStr('approve', quote)}`, '-c', `${k}.startup_timeout_sec=20`);
    }
    return args;
  },
});
