// Perfil de permissão do Executor da missão por workspace: `default` (acceptEdits + lista de comandos pré-aprovados; o resto é negado, pois ninguém responde sem tela)
// ou `bypass` (bypassPermissions, OPT-IN por workspace). Este módulo só DEFINE os argumentos e os textos; a escrita do perfil é da rota do usuário (permission-profile.js) e
// nunca vem do Planner, do Maestro, do chat nem da criação do workspace. Nada aqui executa processo.
//
// ----- CONFIRMADO com `claude --help` (v2.1.322, somente leitura; nenhuma missão nem chamada ao modelo) -----
//  - `--permission-mode <mode>` aceita: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.
//  - `--permission-prompts <none|host>`: com `none`, tudo o que pediria permissão é negado sozinho; "o modo de permissão decide o resto".
//  - `--allowedTools, --allowed-tools <tools...>` e `--disallowedTools, --disallowed-tools <tools...>`: variádicas, "lista separada por vírgula ou espaço" (ex.: "Bash(git *) Edit").
//    Por isso `--allowedTools` vai POR ÚLTIMO (o prompt segue por stdin e não é consumido por ela) e cada regra é um argumento próprio.
//  - `--setting-sources <sources>` aceita user, project, local (separados por vírgula). Usamos só `user`: hooks e permissões do repositório de um cliente não são confiáveis.
//  - `--tools <tools...>`: "default" = conjunto padrão (terminal). NÃO é passado aqui: sem `--tools` vale o conjunto padrão.
//  - Existe `--dangerously-skip-permissions` (nunca usado) e `--allow-dangerously-skip-permissions` ("habilita bypass como opção"; também NÃO usado aqui, ver hipótese 1).
// ----- HIPÓTESES NÃO VERIFICADAS (não há como rodar o claude real nestes testes; ajustar SÓ em executorArgs/DEFAULT_ALLOW se a CLI divergir) -----
//  1. `--permission-mode bypassPermissions` em `-p` funciona sem `--allow-dangerously-skip-permissions`. Se a CLI recusar, a rodada falha ou fica needs_approval (falha fechada): nunca executa mais que o perfil.
//  2. A semântica de `Bash(x:*)` (prefixo legado, com ":*") e de comando composto (`a && b`, pipes) não foi observada; se a regra for mais larga ou mais estreita que o esperado, só o perfil `default` é afetado.
//  3. As regras allow de ~/.claude/settings.json (fonte `user`) SOMAM-se às de --allowedTools; uma regra allow do usuário pode liberar mais do que DEFAULT_ALLOW (é a configuração dele).
//  4. `--disallowedTools WebFetch WebSearch` bloqueia mesmo com `acceptEdits`, e a negação vence uma regra allow.
import { ALLOWED_SCRIPTS } from './verify.js';

export const PROFILES = Object.freeze(['default', 'bypass']);

/** 'bypass' SOMENTE se o campo for exatamente a string 'bypass'; qualquer outra coisa (ausente, malformada, tipo errado, workspace nulo) = 'default' (fail-safe). */
export const profileOf = (ws) => (ws !== null && typeof ws === 'object' && Object.hasOwn(ws, 'permissionProfile') && ws.permissionProfile === 'bypass' ? 'bypass' : 'default'); // hasOwn: uma propriedade herdada (poluição de protótipo) não liga o bypass

// Sem `--permission-mode` e sem ferramentas: isso é decidido por perfil em executorArgs. `project` NÃO entra em --setting-sources.
export const BASE_ARGS = Object.freeze(['-p', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'none', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'user']);

// Pré-aprovados no perfil `default`: testes/build/lint do projeto (mesma fonte de verify.js) e git SOMENTE leitura. Fora de propósito: install, npx, curl, rm, push.
export const DEFAULT_ALLOW = Object.freeze([
  'Bash(npm test:*)',
  ...ALLOWED_SCRIPTS.map((s) => `Bash(npm run ${s}:*)`),
  'Bash(node --test:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch --show-current)',
]);

/** Argumentos da CLI do Executor para o perfil. Perfil desconhecido = default. Devolve uma cópia nova a cada chamada. */
export function executorArgs(profile) {
  if (profile === 'bypass') return [...BASE_ARGS, '--permission-mode', 'bypassPermissions'];
  return [...BASE_ARGS, '--permission-mode', 'acceptEdits', '--disallowedTools', 'WebFetch', 'WebSearch', '--allowedTools', ...DEFAULT_ALLOW]; // variádica: por último
}

/** Texto (PT-BR) do que o Executor pode e não pode no perfil; entra nos prompts do Planner, do chat e do Executor. */
export function executorLimitsText(profile) {
  if (profile === 'bypass') {
    return 'Perfil de permissão deste workspace: SEM CONFIRMAÇÃO (bypass, ligado pelo usuário). O Executor edita arquivos, roda comandos no terminal, acessa a rede e instala pacotes sem pedir confirmação, '
      + 'com as permissões do usuário no Windows. Continuam exigindo aprovação humana por etapa: arquivos sensíveis ou de segredos, instalação de dependências, push, deploy, publicação e outros efeitos externos, e ações destrutivas. '
      + 'O worktree isolado, quando usado, NÃO é uma fronteira de segurança neste perfil. A verificação real e o portão de conclusão continuam valendo.';
  }
  return 'Perfil de permissão deste workspace: PADRÃO. O Executor edita arquivos do workspace e roda apenas comandos pré-aprovados: '
    + `testes e verificações (${DEFAULT_ALLOW.filter((r) => r.startsWith('Bash(npm') || r.startsWith('Bash(node')).map((r) => r.slice(5, -1).replace(/:\*$/, '')).join(', ')}) e git somente leitura (status, diff, log, show). `
    + 'Qualquer outro comando, a rede (WebFetch, WebSearch, curl), instalar dependências, push, deploy e apagar fora do workspace são negados automaticamente, pois ninguém responde a pedidos de permissão durante a missão. '
    + 'Se a tarefa precisar disso, a etapa deve ser bloqueada com o motivo, não contornada.';
}

export const WARNING = Object.freeze({
  version: 1,
  text: 'Ao ligar o modo sem confirmação, o agente das missões deste workspace roda comandos, acessa a rede e instala pacotes sem pedir confirmação, com as permissões do seu usuário no Windows. '
    + 'Vale só para missões neste workspace (os terminais têm as próprias permissões). Pedidos de push, deploy e instalação ainda pedem a sua aprovação por etapa. '
    + 'O worktree isolado NÃO é uma fronteira de segurança sob este modo: o agente pode alcançar arquivos fora dele. Você pode desligar quando quiser (uma execução em andamento não é interrompida).',
  noTokenText: 'Este servidor está aberto sem o token de sessão do aplicativo desktop. Sem ele, um processo local, inclusive o próprio agente, consegue forjar a chamada à API e ligar o próprio modo sem confirmação '
    + 'ou aprovar as próprias etapas; não há proteção real contra isso. Só ligue se aceitar esse risco.',
});
