// Linha de comando de uma CLI iniciada por wrapper .cmd/.bat (os do npm: codex.cmd, gemini.cmd, opencode.cmd…) no Windows, para o node-pty.
//
// O wrapper roda por `cmd.exe /d /s /c <wrapper> <args…>`. Com `/s`, o cmd.exe tira a PRIMEIRA aspa da linha e a ÚLTIMA aspa da linha. O node-pty, recebendo os argumentos
// como lista, põe aspas em cada um que tem espaço: com o wrapper em `C:\Users\Joe Smith\AppData\Roaming\npm\codex.cmd` a linha vira `/c "C:\Users\Joe Smith\...\codex.cmd" a b`
// e o `/s` remove as aspas do CAMINHO (a última aspa da linha é a dele): o cmd.exe corta o caminho no espaço e responde "'C:\Users\Joe' não é reconhecido como um comando"
// (verificado com cmd.exe e node-pty reais, 25/11/2026). A forma que o `/s` pede é a linha INTEIRA entre aspas externas: `/c ""wrapper" a "b c""`. O node-pty usa uma string de
// argumentos literalmente (windowsPtyAgent > argsToCommandLine), então é ela que montamos aqui.
//
// Só entra em ação quando o caminho do wrapper tem espaço; sem espaço, a lista de argumentos do node-pty já funciona (verificado com os argumentos reais do Codex, inclusive
// `{'a'='b'}`, e com um caminho com espaço dentro de um argumento) e nada muda.
//
// Defesa em profundidade: os argumentos já chegam filtrados de quem os monta (cleanLine, listas fechadas, filtro dos arquivos do pane), mas este é o ponto que os entrega ao cmd.exe,
// então ele mesmo trata o que o cmd.exe interpretaria: `& | < > ^ ( )` ficam ENTRE ASPAS (ali ele não interpreta nada: verificado com o cmd.exe real) e `%`, aspa e controles são recusados.
// `/v:off` desliga a expansão atrasada para o `!` ser texto comum (sem ele, um registro do Windows que a ligue transformaria `!VAR!` num valor de variável).

const NEEDS_QUOTES = /[\s&|<>^()]/;
const HAS_SPACE = /\s/;
// `%` (o cmd.exe expande variáveis, mesmo entre aspas), aspa (fecharia a string) e controles: recusados no wrapper e nos argumentos. O `!` é texto comum com `/v:off`, mas continua
// recusado no CAMINHO do wrapper (como nos outros chamadores: claude-cli.js, codex.js) e `& | < > ^` também.
const FORBIDDEN = /["%\u0000-\u001f\u007f]/;
const FORBIDDEN_IN_SCRIPT = /["%!&|<>^\u0000-\u001f\u007f]/;

/** Um argumento no formato da linha de comando do Windows (CommandLineToArgvW): entre aspas se tiver espaço, metacaractere do cmd.exe ou for vazio; barras finais dobradas antes da aspa de fechamento. */
const quoteArg = (a) => (a === '' || NEEDS_QUOTES.test(a) ? `"${a.replace(/(\\+)$/, '$1$1')}"` : a);

/**
 * Argumentos para `pty.spawn(cmd.file, <resultado>)`. `cmd` = { file, args, viaShell } de `resolve()` do provedor; `args` = os argumentos da CLI.
 * Devolve a LISTA de sempre (`[...cmd.args, ...args]`) quando não há o que corrigir, uma STRING (linha de comando literal) quando o wrapper tem espaço no caminho,
 * ou `null` quando o wrapper ou algum argumento tem caractere que o cmd.exe interpretaria (quem chama recusa abrir o terminal, nunca tenta mesmo assim).
 */
export function shellPtyArgs(cmd, args) {
  const list = [...(cmd?.args ?? []), ...args];
  if (!cmd?.viaShell) return list;
  const base = cmd.args ?? [], script = base.at(-1);
  if (typeof script !== 'string' || !HAS_SPACE.test(script)) return list; // sem espaço no caminho: a lista do node-pty funciona
  if (base.length !== 4 || base[0] !== '/d' || base[1] !== '/s' || base[2] !== '/c') return null; // formato de resolve() que não conhecemos: não arrisca
  if (FORBIDDEN_IN_SCRIPT.test(script) || args.some((a) => typeof a !== 'string' || FORBIDDEN.test(a))) return null;
  return `/d /s /v:off /c "${[`"${script}"`, ...args.map(quoteArg)].join(' ')}"`;
}
