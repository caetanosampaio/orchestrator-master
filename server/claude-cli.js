// Como iniciar a CLI `claude` com segurança, compartilhado pela sonda (claude-probe.js), pelas contas (status/login/logout) e pelos terminais. Nada aqui vem do cliente.
import { resolveClaude } from './providers/claude.js';

// Segurança do caminho `.cmd` (instalação do Claude Code via npm no Windows): o cmd.exe interpreta & | < > ^ % ! " ( ) e espaços. Os argumentos que chegam
// ao argv são SÓ os fixos da sonda (`--version`, claude-probe.js) e os de `claude auth` (lista fechada em providers/claude.js); o cwd não é argumento. Mesmo assim, por defesa em profundidade, no caminho .cmd todo argumento precisa passar nesta lista permitida; senão a execução é recusada.
const SHELL_SAFE_ARG = /^[A-Za-z0-9][A-Za-z0-9._:,=\[\]\/-]*$|^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/;
export const shellSafeArgs = (list) => list.every((a) => typeof a === 'string' && SHELL_SAFE_ARG.test(a));

// Regras de permissão `Ferramenta(especificação)` como `Bash(npm run test:*)` precisam de espaço, parênteses e `*`: só esta forma é aceita ENTRE ASPAS DUPLAS, com um conjunto fechado de
// caracteres e sem nenhum metacaractere do cmd.exe (& | < > ^ % ! ") nem aspas. Dentro de aspas duplas o cmd.exe não interpreta ( ) * nem espaços. Terminar em `)` também impede que uma barra invertida
// FINAL escape a aspa de fechamento na análise do argv do Windows. Um texto qualquer com espaço (ex.: `a b`) continua recusado. O argumento que já passa em SHELL_SAFE_ARG segue SEM aspas, como sempre.
const QUOTED_ARG = /^[A-Za-z][A-Za-z0-9_]*\([A-Za-z0-9 ._:,=()*\/\\-]+\)$/;
const quotable = (a) => typeof a === 'string' && QUOTED_ARG.test(a);
/** Linha de comando do wrapper .cmd: cada argumento simples como está; o que exige aspas, entre aspas. null se algum argumento é recusado. */
export function cmdLineArgs(list) {
  const out = [];
  for (const a of list) {
    if (typeof a !== 'string') return null;
    if (SHELL_SAFE_ARG.test(a)) out.push(a);
    else if (quotable(a)) out.push(`"${a}"`);
    else return null;
  }
  return out;
}

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
  const parts = cmdLineArgs(extraArgs);
  if (!parts) return { error: 'Argumento recusado: o Claude Code é um wrapper .cmd e só aceita argumentos simples (sem caracteres especiais do shell).' };
  if (/[%"^&|<>!\r\n]/.test(script)) return { error: 'O caminho do claude.cmd contém caracteres que o cmd.exe interpretaria; instale o Claude Code em outro caminho.' };
  return { file: r.file, args: ['/d', '/s', '/c', `"${[`"${script}"`, ...parts].join(' ')}"`], verbatim: true };
}

// Ambiente do `claude` de uma conta: a regra vive no bloco `account` do provider (providers/claude.js > claudeAccountEnv). Mantido com o nome antigo para o terminals.js (etapa 4).
// `configDir` null = conta da máquina (ambiente do processo como está); pasta = CLAUDE_CONFIG_DIR dela e sem as variáveis de autenticação do ambiente.
export { claudeAccountEnv as envForAccount } from './providers/claude.js';
