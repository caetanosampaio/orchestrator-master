// Como iniciar a CLI `claude` com segurança, compartilhado pelo executor, pelas contas (status/login/logout) e pelos terminais.
// Extraído de executor/index.js sem mudar o comportamento. Nada aqui vem do cliente.
import { resolveClaude } from './providers/claude.js';

// Segurança do caminho `.cmd` (instalação do Claude Code via npm no Windows): o cmd.exe interpreta & | < > ^ % ! " ( ) e espaços. Conclusão da auditoria: os argumentos que chegam
// ao argv são SÓ os fixos de CLAUDE_ARGS/agents.js, os do Planner (`--model <valor>` de MODEL_RE; `--effort` de lista fechada) e os de `claude auth` (lista fechada em accounts.js);
// o PROMPT vai por stdin e o cwd não é argumento. Mesmo assim, por defesa em profundidade, no caminho .cmd todo argumento precisa passar nesta lista permitida; senão a execução é recusada.
const SHELL_SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._:,=\[\]\/-]*$|^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/;
export const shellSafeArgs = (list) => list.every((a) => typeof a === 'string' && SHELL_SAFE_ARG.test(a));

/**
 * Como iniciar o `claude`. Com `command` injetado (testes) vale exatamente o que foi injetado, sem shell. No padrão usa a MESMA resolução dos terminais (providers/claude.js):
 * `claude.exe` direto ou, para `claude.cmd`/`.bat`, o cmd.exe com a linha de comando montada aqui (windowsVerbatimArguments) entre aspas externas, como o `/s` exige.
 * Retorna { file, args, verbatim } ou { error }; sem o binário no PATH cai no nome `claude` (o spawn falha e o erro é tratado como sempre).
 */
export function launchSpec({ injected, command, prefixArgs }, extraArgs, { resolve = resolveClaude } = {}) {
  if (injected) return { file: command, args: [...prefixArgs, ...extraArgs], verbatim: false };
  const r = resolve();
  if (!r) return { file: 'claude', args: extraArgs, verbatim: false };
  if (!r.viaShell) return { file: r.file, args: [...r.args, ...extraArgs], verbatim: false };
  const script = r.args[r.args.length - 1];
  if (!shellSafeArgs(extraArgs)) return { error: 'Argumento recusado: o Claude Code é um wrapper .cmd e só aceita argumentos simples (sem caracteres especiais do shell).' };
  if (/[%"^&|<>!\r\n]/.test(script)) return { error: 'O caminho do claude.cmd contém caracteres que o cmd.exe interpretaria; instale o Claude Code em outro caminho.' };
  return { file: r.file, args: ['/d', '/s', '/c', `"${[`"${script}"`, ...extraArgs].join(' ')}"`], verbatim: true };
}

// Variáveis que SOBREPÕEM o login de uma conta do FORGE: numa conta isolada (CLAUDE_CONFIG_DIR própria) a CLI tem de usar o login DAQUELA conta, não uma chave do ambiente.
const OVERRIDING_AUTH_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']; // provedor/endpoint/cabeçalhos do ambiente também desviariam a conta

/**
 * Ambiente do filho para uma conta. `configDir` null = conta "Sistema": vale o ambiente do processo, sem sobrescrever nada.
 * Conta do FORGE: CLAUDE_CONFIG_DIR = pasta da conta e sem as variáveis de autenticação do ambiente (senão elas "ganhariam" do login da conta).
 */
export function envForAccount(base, configDir) {
  const env = { ...base };
  if (typeof configDir !== 'string' || !configDir) return env;
  for (const k of Object.keys(env)) if (OVERRIDING_AUTH_ENV.includes(k.toUpperCase())) delete env[k];
  env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

// Ambiente padrão dos `claude` do ciclo autônomo (Executor e Planner): o index.js liga isto à CONTA PADRÃO, lida no momento de cada execução.
// Sem provedor (testes isolados) vale process.env, como sempre.
let envProvider = null;
export const setClaudeEnvProvider = (fn) => { envProvider = typeof fn === 'function' ? fn : null; };
export const claudeEnv = () => (envProvider ? envProvider() : process.env);
