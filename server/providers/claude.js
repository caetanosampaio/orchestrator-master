// Provedor Claude Code: TUDO o que é específico da CLI `claude` num terminal interativo (pane) fica aqui: onde ela está, como ela é iniciada e retomada.
// O terminals.js só conhece a interface do provedor (ver providers/index.js), nunca os argumentos da CLI. Nada aqui vem do cliente.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { killTreeSync } from '../orphans.js';

/** Claude Code no PATH (arquivo real, nunca por shell). `.cmd`/`.bat` precisam do cmd.exe. null se não achar. */
export function resolveClaude({ env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d.replace(/^"|"$/g, ''), n);
    try { if (fs.statSync(f).isFile()) return /\.(cmd|bat)$/i.test(f) ? { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f], viaShell: true } : { file: f, args: [], viaShell: false }; } catch { /* próximo */ }
  }
  return null;
}

// Listas FECHADAS de modelo e esforço que o servidor aceita (nunca texto livre na linha de comando). Modelos por apelido (a CLI resolve para o mais recente); esforço = `--effort` do Claude Code (verificado no 2.1.322).
const frozenList = (items) => Object.freeze(items.map(([id, label]) => Object.freeze({ id, label })));
export const CLAUDE_OPTIONS = Object.freeze({
  models: frozenList([['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']]),
  efforts: frozenList([['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto'], ['xhigh', 'Muito alto'], ['max', 'Máximo']]),
});

/** Ferramentas de edição do Claude Code bloqueadas no pane somente leitura (--disallowedTools). Nomes fixos, sem caracteres especiais: valem também pelo cmd.exe. */
export const READ_ONLY_DENIED = Object.freeze(['Edit', 'Write', 'NotebookEdit']);

// ---- Conta (contrato `account`, ver providers/index.js) ----
// Fonte ÚNICA das regras de conta do Claude: accounts.js, account-login.js e claude-cli.js (envForAccount) consomem daqui. A única cópia que resta é a lista de argumentos
// simples (CMD_SAFE_ARG, igual a SHELL_SAFE_ARG de claude-cli.js): não é importada de lá porque claude-cli.js importa ESTE arquivo (ciclo). Mudou lá, mude aqui.

// Variáveis que SOBREPÕEM o login de uma conta isolada: numa pasta própria a CLI tem de usar o login DAQUELA conta, não uma chave do ambiente.
const CLAUDE_AUTH_ENV = Object.freeze(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']);
export const CLAUDE_HOME_ENV = 'CLAUDE_CONFIG_DIR';
export const CLAUDE_NOT_FOUND_STATUS = 'Claude Code não encontrado'; // mesmo texto que accounts.js monta (`${label} não encontrado`): a interface já o conhece

/**
 * Ambiente do `claude` de uma conta. `home` null = conta da máquina: o ambiente do processo como está (inclusive chave de API/Bedrock/Vertex, que a CLI usa).
 * `home` = pasta isolada: CLAUDE_CONFIG_DIR apontando para ela e SEM as variáveis de autenticação do ambiente (senão elas "ganhariam" do login da conta).
 */
export function claudeAccountEnv(base = process.env, home = null) {
  const env = { ...base };
  if (typeof home !== 'string' || !home) return env;
  for (const k of Object.keys(env)) if (CLAUDE_AUTH_ENV.includes(k.toUpperCase())) delete env[k];
  env[CLAUDE_HOME_ENV] = home;
  return env;
}

// Só argumentos simples (os de `claude auth` são fixos): no wrapper .cmd nada que o cmd.exe interprete chega à linha de comando.
const CMD_SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._:,=\[\]\/-]*$|^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/;
/** Como iniciar `claude <args>` sem shell: { file, args, verbatim } | { error } | null (CLI ausente). `.cmd` vai pelo cmd.exe com aspas externas, como o `/s` exige. */
function claudeCommand(extraArgs, { resolve = resolveClaude, env = process.env } = {}) {
  let r; try { r = resolve({ env }); } catch { r = null; }
  if (!r) return null;
  if (!extraArgs.every((a) => typeof a === 'string' && CMD_SAFE_ARG.test(a))) return { error: 'Argumento recusado para o Claude Code.' };
  if (!r.viaShell) return { file: r.file, args: [...r.args, ...extraArgs], verbatim: false };
  const script = r.args?.at(-1);
  if (typeof script !== 'string' || !script || /[%"^&|<>!\r\n]/.test(script)) return { error: 'O caminho do claude.cmd contém caracteres que o cmd.exe interpretaria; instale o Claude Code em outro caminho.' };
  return { file: r.file, args: ['/d', '/s', '/c', `"${[`"${script}"`, ...extraArgs].join(' ')}"`], verbatim: true };
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const clean = (v, max) => (typeof v === 'string' && !CONTROL.test(v) ? v.trim().slice(0, max) || null : null);
const emptyStatus = (error = null) => ({ checked: false, loggedIn: null, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error });

/** JSON de `claude auth status` -> só os campos do contrato, com tipos conferidos (a saída da CLI é dado não confiável). null se não é o formato esperado. `plan` = subscriptionType. */
export function normalizeClaudeStatus(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.loggedIn !== 'boolean') return null;
  const expires = o.loginExpiresAt;
  return {
    checked: true, loggedIn: o.loggedIn, plan: clean(o.subscriptionType, 60), authMethod: clean(o.authMethod, 40), email: clean(o.email, 200), orgName: clean(o.orgName, 200),
    loginExpiresAt: typeof expires === 'string' ? clean(expires, 40) : (typeof expires === 'number' && Number.isFinite(expires) && Math.abs(expires) < 8.64e15 ? new Date(expires).toISOString() : null), error: null,
  };
}

/**
 * Estado de login de UMA conta, numa única consulta (sem cache: quem chama decide; accounts.js tem o seu). Nunca lança nem rejeita.
 * ctx: { home (pasta isolada | null = conta da máquina), env (ambiente BASE; a regra da conta é aplicada aqui), run (assinatura do execFile; testes), resolve, timeoutMs, killTree }.
 */
function claudeStatus({ home = null, env = process.env, run = execFile, resolve = resolveClaude, timeoutMs = 8000, killTree = killTreeSync } = {}) {
  return new Promise((done) => {
    const spec = claudeCommand(['auth', 'status'], { resolve, env });
    if (!spec) return done(emptyStatus(CLAUDE_NOT_FOUND_STATUS));
    if (spec.error) return done(emptyStatus('Não foi possível consultar o Claude Code com segurança.'));
    let child = null;
    try {
      child = run(spec.file, spec.args, { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: spec.verbatim, env: claudeAccountEnv(env, home), maxBuffer: 256 * 1024, encoding: 'utf8' }, (err, stdout) => {
        // `claude auth status` sai com código != 0 quando não há login, mas ainda imprime o JSON: o que vale é o JSON.
        let parsed = null; try { parsed = JSON.parse(String(stdout ?? '')); } catch { /* abaixo */ }
        const st = normalizeClaudeStatus(parsed);
        if (st) return done(st);
        if (err?.code === 'ENOENT') return done(emptyStatus(CLAUDE_NOT_FOUND_STATUS));
        if (err?.killed || err?.signal || err?.code === 'ETIMEDOUT') {
          // No wrapper .cmd o execFile encerra só o cmd.exe; o `claude` neto ficaria vivo (mesma razão da sonda do Codex).
          if (err?.killed && spec.verbatim) { try { killTree(child?.pid); } catch { /* informativo */ } }
          return done(emptyStatus('Tempo esgotado ao consultar o Claude Code.'));
        }
        done(emptyStatus('Não foi possível consultar o estado do login.'));
      });
    } catch { done(emptyStatus('Não foi possível consultar o estado do login.')); }
  });
}

// Métodos de `claude auth login` (lista FECHADA): nada de --email nem argumento vindo do cliente.
const LOGIN_METHOD_ARGS = Object.freeze({ claudeai: Object.freeze(['--claudeai']), console: Object.freeze(['--console']), sso: Object.freeze(['--sso']) });

/** Como iniciar `claude auth login` de uma conta: { file, args, verbatim, env } ou { error, code }. Quem inicia (account-login.js) segue responsável pelo processo, timeout e saída. */
function claudeLoginSpec({ method = 'claudeai', home = null, env = process.env, resolve = resolveClaude } = {}) {
  if (typeof method !== 'string' || !Object.hasOwn(LOGIN_METHOD_ARGS, method)) return { error: 'Método de login inválido. Use claudeai, console ou sso.', code: 'invalid_method' };
  const spec = claudeCommand(['auth', 'login', ...LOGIN_METHOD_ARGS[method]], { resolve, env });
  if (!spec) return { error: `${CLAUDE_NOT_FOUND_STATUS}.`, code: 'not_found' };
  if (spec.error) return { error: spec.error, code: 'unsafe' };
  return { ...spec, env: claudeAccountEnv(env, home) };
}

/** Como iniciar `claude auth logout` de uma conta isolada (melhor esforço ao remover): { file, args, verbatim, env } | { error, code } | null (CLI ausente). */
function claudeLogoutSpec({ home = null, env = process.env, resolve = resolveClaude } = {}) {
  const spec = claudeCommand(['auth', 'logout'], { resolve, env });
  if (!spec) return null;
  if (spec.error) return { error: spec.error, code: 'unsafe' };
  return { ...spec, env: claudeAccountEnv(env, home) };
}

export const claudeAccount = Object.freeze({
  label: 'Claude Code',
  note: 'Cada conta do Claude Code tem uma pasta de configuração própria e o login é feito aqui no FORGE ("claude auth login").',
  homeEnv: CLAUDE_HOME_ENV,
  detect(env = process.env) { try { return !!resolveClaude({ env }); } catch { return false; } },
  status: claudeStatus,
  env: claudeAccountEnv,
  canLogin: true,
  loginMethods: Object.freeze(Object.keys(LOGIN_METHOD_ARGS)),
  loginSpec: claudeLoginSpec,
  logoutSpec: claudeLogoutSpec,
  // Ponto de extensão dos limites da conta. Hoje as fontes do Claude (status line do FORGE gravando o limite real e a API de uso lida com o token da conta) vivem em
  // rate-limits.js e usage-api.js e dependem do estado do servidor (gravações por conta, cache, desligamento por variável): continuam lá. Devolve null até a etapa que as trouxer.
  limits: async () => null,
});

export const claudeProvider = Object.freeze({
  id: 'claude',
  label: 'Claude Code',
  resolve: resolveClaude,
  options: CLAUDE_OPTIONS,
  account: claudeAccount, // contrato de conta (providers/index.js > accountSpecOf)
  notFoundMessage: 'Claude Code não foi encontrado no PATH.',
  // O que a CLI sabe fazer; o terminals.js só liga o recurso quando o provedor declara a capacidade.
  capabilities: Object.freeze({ resume: true, fork: true, hooks: true, plugins: true, accounts: true, transcript: true, statusLine: true }),
  mcpTransport: 'file', // credencial do Maestro em arquivo (--mcp-config)
  // Variáveis acrescentadas ao ambiente do pane (só se o ambiente ainda não define a variável: quem quiser outro valor exporta antes). CLAUDE_CODE_NO_FLICKER=1 liga o renderer em tela cheia
  // (alt-screen, preenche o terminal). Sem isto o Claude Code o DESLIGA SOZINHO na máquina quando um lançamento "não terminou de iniciar" (acontece quando o servidor reinicia e mata os panes
  // durante a partida) e os panes seguintes abrem no modo clássico, sem preencher o terminal, até alguém rodar /tui fullscreen em cada um. A variável vence essa desativação automática.
  paneEnv: Object.freeze({ CLAUDE_CODE_NO_FLICKER: '1' }),
  // Como uma tarefa do Maestro é entregue: o texto vai como bloco (o Claude Code o trata como colagem) e o Enter segue separado, `delayMs` depois.
  submit: Object.freeze({ bracketed: false, delayMs: process.platform === 'win32' ? 200 : 500 }), // macOS/Linux: com 200 ms o Enter chegava ainda dentro da janela de colagem e era engolido (o texto ficava no campo)
  /**
   * Argumentos do pane. mode: 'new' (--session-id fixo, papel e nome), 'resume' (mesma sessão) ou 'fork' (cópia com UUID novo; a original fica intacta).
   * Na retomada o Claude Code restaura histórico, prompt de sistema, nome e permission mode: NÃO se repassa nada disso.
   * `mcp` = { configPath, serverName } quando o pane tem coordenação (Maestro); sem ele, nenhum argumento de MCP.
   * `pluginDir` = plugin de sessão com as skills do papel (loadouts.js); vale também na retomada, porque o plugin não faz parte da sessão gravada.
   *   Vem ANTES dos argumentos de MCP: `--mcp-config` e `--allowedTools` aceitam vários valores e um argumento depois deles seria lido como valor.
   */
  paneArgs({ mode, prompt, label, sessionId, resumeSessionId, mcp = null, pluginDir = null, settingsFile = null, model = null, effort = null, fullAccess = false, readOnly = false }) {
    // `readOnly` (papel somente leitura, hoje o planejador; decidido no terminals.js a partir do PAPEL, nunca do cliente): as ferramentas de edição do Claude Code ficam BLOQUEADAS na própria CLI
    // (--disallowedTools tira as ferramentas do agente) e o acesso total nunca liga, mesmo se alguém passar fullAccess.
    // LIMITE: o Bash continua disponível (pedindo permissão, como em qualquer pane sem acesso total); um comando de shell aprovado pelo usuário ainda pode alterar arquivos.
    const ro = readOnly === true, full = fullAccess === true && !ro;
    // `settingsFile` = arquivo JSON com a status line do FORGE (rate-limits.js), que grava o limite real da conta. Vale nos três modos, junto do plugin e ANTES do MCP; sem ele, nenhum argumento.
    const pluginArgs = [...(pluginDir ? ['--plugin-dir', pluginDir] : []), ...(settingsFile ? ['--settings', settingsFile] : [])];
    // --disallowedTools é variádico (como --mcp-config/--allowedTools): fica no grupo FINAL, logo antes do MCP; o que vem depois dele é sempre outra flag (ou nada), então nenhum argumento é engolido.
    const roArgs = ro ? ['--disallowedTools', ...READ_ONLY_DENIED] : [];
    const mcpArgs = mcp ? ['--mcp-config', mcp.configPath, '--allowedTools', `mcp__${mcp.serverName ?? 'forge'}`] : [];
    // `model`/`effort` (já validados contra as listas fechadas, ver providers/index.js) só valem na sessão NOVA: retomada e fork herdam o modelo da sessão gravada. Vão ANTES de plugin/MCP (que aceitam vários valores).
    // `fullAccess` ("acesso total" da missão): SÓ o booleano true estrito liga o modo sem confirmação de permissão. Vale também na retomada/fork, mas só quando a sessão gravada JÁ tinha acesso total (terminals.js):
    // o Claude Code não restaura o bypass sozinho. Flag sem valor: não engole o argumento seguinte.
    const modelArgs = [...(full ? ['--dangerously-skip-permissions'] : []), ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])];
    if (mode === 'new') return ['--append-system-prompt', prompt, '--name', label, '--session-id', sessionId, ...modelArgs, ...pluginArgs, ...roArgs, ...mcpArgs];
    return ['--resume', resumeSessionId, ...(mode === 'fork' ? ['--fork-session', '--session-id', sessionId] : []), ...(full ? ['--dangerously-skip-permissions'] : []), ...pluginArgs, ...roArgs, ...mcpArgs];
  },
});
