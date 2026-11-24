// Provedor Gemini CLI (`gemini`, pacote npm @google/gemini-cli): o que é específico dele num terminal interativo (pane). Mesma interface do claude.js/codex.js.
//
// NÍVEL 1 (só terminal). Conferido contra a documentação oficial (geminicli.com/docs, jun/2026), NÃO contra a CLI instalada (sem ela nesta máquina):
//   - modelo: `-m <alias>` (auto, pro, flash, flash-lite); aprovação: `--approval-mode default|auto_edit|yolo|plan` (`plan` = só planeja, não edita);
//   - retomada existe (`--resume <uuid|latest>`), mas o id é escolhido pelo próprio Gemini: o FORGE não tem como reabrir a sessão certa, então fica desligada (capabilities);
//   - estado do agente: o título do terminal (`ui.dynamicWindowTitle`, ligado por padrão) mostra "Ready ◇", "Action Required ✋" e "Working ✦" (oscState abaixo);
//   - SEM coordenação (mcp: false): o MCP do Maestro só entraria por arquivo de configuração e o papel só pelo prompt de sistema INTEIRO (GEMINI_SYSTEM_MD substitui tudo);
//     por isso o pane abre como agente livre, sem o papel e sem o Maestro. Missões e times ficam de fora até a coordenação ser verificada com a CLI real.
//   - plano gratuito: a documentação avisa que, desde 18/06/2026, contas gratuitas e Google One usam a Antigravity CLI; o Gemini CLI segue com chave de API ou plano pago.
import { resolveOnPath, withoutClaudeEnv, frozenList } from './cli-path.js';

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
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: false, readOnly: true }),
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
