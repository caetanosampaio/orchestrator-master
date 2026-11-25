// Provedor GitHub Copilot CLI (`copilot`, npm @github/copilot). NÍVEL 2 PARCIAL (terminal + Maestro nas vagas que RECEBEM tarefas).
// Conferido contra a documentação oficial (docs.github.com/en/copilot/reference/copilot-cli-reference, nov/2026), NÃO contra a CLI instalada:
//   - `--model auto` (a lista real só aparece no /model da sessão); `--allow-all` (= --yolo) libera ferramentas, caminhos e URLs (acesso total). O modo `plan` não é
//     documentado como somente leitura: não abre o planejador;
//   - COORDENAÇÃO sem tocar na configuração do usuário: `--additional-mcp-config=@<arquivo>` acrescenta o servidor do FORGE SÓ nesta sessão, e
//     COPILOT_CUSTOM_INSTRUCTIONS_DIRS carrega o papel (*.instructions.md) de uma pasta. Os dois arquivos ficam na pasta do pane (0700/0600, apagada no fim); o arquivo do MCP
//     leva o token do terminal, como o --mcp-config do Claude Code (a expansão de variáveis não é documentada para essa flag).
//   - Não verificada com a CLI real (mcpVerified: false): o Maestro só manda tarefa depois que o pane se conecta de fato. Sem estado do agente (state: false): não é Maestro
//     nem etapa de missão.
import path from 'node:path';
import { cliProvider } from './cli-path.js';

const SERVER_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/, MCP_URL_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/, TOKEN_RE = /^[0-9a-f]{48}$/;

/** Arquivos do pane: o servidor MCP do FORGE (formato do mcp-config.json do Copilot) e o papel; o ambiente e o argumento que apontam para eles. */
export function copilotPaneFiles({ dir, prompt = '', mcp = null }) {
  const files = {}, env = {}, args = [];
  if (mcp && SERVER_KEY_RE.test(String(mcp.serverName)) && MCP_URL_RE.test(String(mcp.url)) && TOKEN_RE.test(String(mcp.token))) {
    files['mcp.json'] = JSON.stringify({ mcpServers: { [mcp.serverName]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` }, tools: ['*'] } } });
    args.push(`--additional-mcp-config=@${path.join(dir, 'mcp.json')}`);
  }
  if (typeof prompt === 'string' && prompt.trim()) { files['forge.instructions.md'] = `${prompt.trim()}\n`; env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS = dir; }
  return { files, env, args };
}

export const copilotProvider = cliProvider({
  id: 'copilot', label: 'Copilot CLI', names: ['copilot'],
  install: 'npm install -g @github/copilot',
  models: [['auto', 'Automático']],
  capabilities: { mcp: true, mcpVerified: false, state: false },
  projectDirs: ['.github/hooks'], projectFiles: ['.mcp.json', '.github/mcp.json'],
  extra: { mcpTransport: 'env', mcpTokenEnv: 'FORGE_MCP_TOKEN', paneFiles: copilotPaneFiles }, // credencial emitida sem arquivo do Maestro; o arquivo do pane é escrito aqui
  paneArgs: ({ model, fullAccess }) => [...(fullAccess ? ['--allow-all'] : []), ...(model ? ['--model', model] : [])],
});
