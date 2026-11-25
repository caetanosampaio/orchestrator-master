// Provedor Gemini CLI (`gemini`, pacote npm @google/gemini-cli): o que é específico dele num terminal interativo (pane). Mesma interface do claude.js/codex.js.
//
// NÍVEL 2 (terminal + Maestro). Conferido contra a documentação oficial (geminicli.com/docs, jun/2026) e o código-fonte (settingsSchema.ts, settings.ts, hookRunner.ts),
// NÃO contra a CLI instalada (sem ela nesta máquina):
//   - modelo: `-m <alias>` (auto, pro, flash, flash-lite); aprovação: `--approval-mode default|auto_edit|yolo|plan` (`plan` = só planeja, não edita);
//   - retomada existe (`--resume <uuid|latest>`), mas o id é escolhido pelo próprio Gemini: o FORGE não tem como reabrir a sessão certa, então fica desligada (capabilities);
//   - estado do agente: o título do terminal (`ui.dynamicWindowTitle`, ligado por padrão) mostra "Ready ◇", "Action Required ✋" e "Working ✦" (oscState abaixo);
//   - COORDENAÇÃO sem tocar na configuração do usuário nem no projeto: cada pane recebe um arquivo de PADRÕES DO SISTEMA próprio (GEMINI_CLI_SYSTEM_DEFAULTS_PATH, a camada de MENOR
//     precedência) numa pasta do FORGE. `mcpServers` é mesclado por nome (SHALLOW_MERGE) e os hooks somados (CONCAT) com os do usuário. O servidor MCP do FORGE vai com
//     `Authorization: Bearer ${FORGE_MCP_TOKEN}`: o Gemini troca a variável ao ler o arquivo, então o TOKEN fica só no ambiente do processo, nunca em arquivo; `trust: true` dispensa a
//     confirmação das ferramentas do FORGE. O PAPEL chega por um hook BeforeAgent (gemini-role-hook.mjs), uma vez por sessão, como contexto extra do turno.
//   - NÃO VERIFICADO (mcpVerified: false): o Maestro só manda tarefa a este pane depois que ele SE CONECTA de fato ao MCP do FORGE (maestro.js). Se o mecanismo falhar na
//     prática, o pane fica como terminal livre, sem tarefa presa. O planejador de missão fica de fora (planner: false): no modo `plan` as ferramentas MCP podem ser bloqueadas.
//   - plano gratuito: a documentação avisa que, desde 18/06/2026, contas gratuitas e Google One usam a Antigravity CLI; o Gemini CLI segue com chave de API ou plano pago.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOnPath, withoutClaudeEnv, frozenList } from './cli-path.js';

export const MCP_TOKEN_ENV = 'FORGE_MCP_TOKEN'; // o mesmo nome do Codex: o terminals.js põe o token só no ambiente do pane
export const HOOK_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gemini-role-hook.mjs');
const SERVER_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Caminhos que entram na linha de comando do hook (shell do Gemini): com aspas, crase, $, % ou controle o hook não é registrado (o pane abre igual, só sem o papel).
// Inclui as aspas tipográficas (U+2018–U+201F): o PowerShell trata “ ” „ como " e ‘ ’ ‚ ‛ como ', e elas fechariam a string do caminho.
const UNSAFE_PATH = /["'`$%!\u0000-\u001f\u007f‘-‟]/; // eslint-disable-line no-control-regex

/**
 * Linha de comando do hook do papel. POSIX (sh): caminhos entre aspas duplas. Windows: HIPÓTESE (não verificada) de que o shell do hook é o PowerShell (o hookRunner acrescenta o
 * tratamento de $LASTEXITCODE dele), então a chamada leva `& ` na frente. Barras normais nos dois. null = algum caminho inseguro.
 */
export function roleHookCommand({ node, script = HOOK_SCRIPT, roleFile, platform = process.platform }) {
  const parts = [node, script, roleFile].map((x) => String(x ?? '').replace(/\\/g, '/'));
  if (parts.some((x) => !x || UNSAFE_PATH.test(x))) return null;
  const line = parts.map((x) => `"${x}"`).join(' ');
  return platform === 'win32' ? `& ${line}` : line;
}

/**
 * Arquivos do pane (escritos pelo terminals.js numa pasta só dele, 0600, apagada quando o terminal acaba) e o ambiente que aponta para eles.
 * `mcp` = { url, serverName } (sem o token: ele vai no ambiente); `prompt` = papel + instrução do time; `node` = executável que roda o hook.
 */
export function geminiPaneFiles({ dir, prompt = '', mcp = null, node = process.execPath, platform = process.platform }) {
  const files = {}, settings = {};
  if (mcp && SERVER_KEY_RE.test(String(mcp.serverName)) && /^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/.test(String(mcp.url))) {
    settings.mcpServers = { [mcp.serverName]: { httpUrl: mcp.url, headers: { Authorization: `Bearer \${${MCP_TOKEN_ENV}}` }, trust: true, timeout: 20000 } };
  }
  if (typeof prompt === 'string' && prompt.trim()) {
    const roleFile = path.join(dir, 'papel.txt');
    const command = roleHookCommand({ node, roleFile, platform });
    if (command) { files['papel.txt'] = prompt.trim(); settings.hooks = { BeforeAgent: [{ hooks: [{ type: 'command', name: 'forge-papel', command, timeout: 5000 }] }] }; }
  }
  if (!Object.keys(settings).length) return { files: {}, env: {} };
  files['settings.json'] = JSON.stringify(settings, null, 2);
  return { files, env: { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(dir, 'settings.json') } };
}

export const resolveGemini = (opts = {}) => resolveOnPath(['gemini'], opts);

// O título do terminal anuncia o estado com um símbolo (documentado: Ready ◇, Action Required ✋, Working ✦). HIPÓTESE: o texto exato do título pode mudar entre versões, por isso só o
// SÍMBOLO conta; título sem nenhum deles é ignorado. OSC 0 (ícone + título) ou 2 (título), terminado por BEL ou ESC \.
const TITLE_RE = /\x1b\][02];([^\x07\x1b]{0,300})(?:\x07|\x1b\\)/g;
const stateOfTitle = (t) => (t.includes('✋') ? 'waiting' : t.includes('✦') ? 'running' : t.includes('◇') ? 'idle' : null);
/** Estado mais recente anunciado no título (ou null). `carry` = resto da leitura anterior (sequência cortada entre dois pedaços); devolve o novo `carry`. */
export function geminiOscState(data, carry = '') {
  const text = carry + String(data);
  let state = null;
  for (const m of text.matchAll(TITLE_RE)) state = stateOfTitle(m[1]) ?? state;
  const open = Math.max(text.lastIndexOf('\x1b]0;'), text.lastIndexOf('\x1b]2;'));
  return { state, carry: open >= 0 && text.length - open < 320 && !/(?:\x07|\x1b\\)/.test(text.slice(open)) ? text.slice(open) : '' };
}

// Lista FECHADA: só os apelidos documentados (o Gemini escolhe a versão do modelo por trás de cada um). Sem níveis de esforço na CLI.
export const GEMINI_OPTIONS = Object.freeze({
  models: frozenList([['auto', 'Automático'], ['pro', 'Pro'], ['flash', 'Flash'], ['flash-lite', 'Flash Lite']]),
  efforts: frozenList([]),
});

export const geminiProvider = Object.freeze({
  id: 'gemini',
  label: 'Gemini CLI',
  resolve: resolveGemini,
  options: GEMINI_OPTIONS,
  oscState: geminiOscState,
  notFoundMessage: 'O Gemini CLI não foi encontrado no PATH (instale com "npm i -g @google/gemini-cli" e entre na sua conta ao abrir o gemini).',
  install: 'npm i -g @google/gemini-cli',
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: true, mcpVerified: false, readOnly: true, planner: false }),
  mcpTransport: 'env', mcpTokenEnv: MCP_TOKEN_ENV, // credencial do Maestro só no ambiente do processo
  paneFiles: geminiPaneFiles,
  // HIPÓTESE (não verificada sem a CLI): o TUI aceita colagem entre colchetes, como o Codex; o Enter segue separado.
  submit: Object.freeze({ bracketed: true, delayMs: 300 }),
  // Configuração de projeto que o Gemini carrega e que executa coisas (hooks, servidores MCP, comandos): toda a pasta .gemini; qualquer arquivo não versionado ou alterado pede confirmação.
  projectConfig: Object.freeze({ files: Object.freeze([]), dirs: Object.freeze(['.gemini']) }),
  envFor: withoutClaudeEnv,
  /** Argumentos do pane (sempre sessão nova). `readOnly` (planejador) usa o modo `plan`; `fullAccess` (só o true estrito) usa `yolo`; o resto pede aprovação (`default`). */
  paneArgs({ mode = 'new', model = null, fullAccess = false, readOnly = false } = {}) {
    if (mode !== 'new') throw new Error('O Gemini CLI não oferece retomada nem bifurcação neste adaptador.');
    const approval = readOnly === true ? 'plan' : fullAccess === true ? 'yolo' : 'default';
    const args = ['--approval-mode', approval];
    if (model) args.push('-m', model); // já validado contra a lista fechada: só [a-z-]
    return args;
  },
});
