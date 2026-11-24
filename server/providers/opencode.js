// Provedor OpenCode (`opencode`): o que é específico dele num terminal interativo (pane). Mesma interface do claude.js/codex.js.
//
// NÍVEL 1 (só terminal). Conferido contra a documentação oficial (opencode.ai/docs, V2, jun/2026), NÃO contra a CLI instalada (sem ela nesta máquina):
//   - `--standalone` = servidor privado do próprio processo. Sem ele o TUI usa o serviço COMPARTILHADO em segundo plano, que vive fora do pane: fechar o terminal não pararia o agente.
//   - modelo: `--model` só está documentado no `opencode run` (não no TUI), então o FORGE não escolhe modelo: vale o do próprio OpenCode (lista vazia = "padrão da CLI").
//   - PERMISSÕES: seguem a configuração do usuário no próprio OpenCode, e a política base documentada é PERMITIR tudo. Não há flag de somente leitura nem de acesso total, então
//     o FORGE não abre o planejador (readOnly: false; terminals.js recusa) e o "acesso total" não muda nada aqui. A interface avisa isso (permissionsNote).
//   - SEM coordenação (mcp: false): o MCP do Maestro e o papel só entrariam por arquivo de configuração (as variáveis OPENCODE_CONFIG* não estão na documentação V2).
import { resolveOnPath, withoutClaudeEnv, frozenList } from './cli-path.js';

export const resolveOpencode = (opts = {}) => resolveOnPath(['opencode'], opts);

export const OPENCODE_OPTIONS = Object.freeze({ models: frozenList([]), efforts: frozenList([]) });
export const OPENCODE_PERMISSIONS_NOTE = 'As permissões seguem a configuração do próprio OpenCode (por padrão ele não pede confirmação). O FORGE não abre o OpenCode como planejador.';

export const opencodeProvider = Object.freeze({
  id: 'opencode',
  label: 'OpenCode',
  resolve: resolveOpencode,
  options: OPENCODE_OPTIONS,
  notFoundMessage: 'O OpenCode não foi encontrado no PATH (instale com "npm i -g opencode-ai" ou pelo site opencode.ai e conecte um provedor com "opencode auth login").',
  install: 'npm i -g opencode-ai',
  permissionsNote: OPENCODE_PERMISSIONS_NOTE,
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: false, readOnly: false }),
  // HIPÓTESE (não verificada sem a CLI): o TUI aceita colagem entre colchetes; o Enter segue separado.
  submit: Object.freeze({ bracketed: true, delayMs: 300 }),
  // opencode.json(c) na raiz e a pasta .opencode (config, agentes, PLUGINS em JS/TS que rodam no processo). Qualquer chave conta (`keys: '*'`): o detector de chaves é o do Claude Code.
  projectConfig: Object.freeze({ files: Object.freeze(['opencode.json', 'opencode.jsonc']), dirs: Object.freeze(['.opencode']), keys: '*' }),
  envFor: withoutClaudeEnv,
  /** Argumentos do pane (sempre sessão nova). Somente leitura não é garantido por esta CLI: recusa (o terminals.js já barra antes, pela capacidade `readOnly`). */
  paneArgs({ mode = 'new', readOnly = false } = {}) {
    if (mode !== 'new') throw new Error('O OpenCode não oferece retomada nem bifurcação neste adaptador.');
    if (readOnly === true) throw new Error('O OpenCode não garante somente leitura.');
    return ['--standalone'];
  },
});
