// Perfis declarativos de agentes do Executor (uma tabela protegida; hoje só `code`). O orquestrador escolhe o perfil por tarefa (task.agent); os
// argumentos da CLI saem DAQUI (via exec-profile.js) e de mais nenhum lugar. `code` é o Executor com as ferramentas do terminal e o PERFIL DE PERMISSÃO do workspace:
// `default` (acceptEdits + comandos pré-aprovados; o resto é negado) ou `bypass` (opt-in do usuário). O perfil vem do workspace, nunca do Planner nem da tarefa.
// Novos perfis de agente só entram aqui, com ferramentas e permissões explícitas e testadas.
import { executorArgs } from './exec-profile.js';

export const DEFAULT_AGENT = 'code';
export const AGENTS = Object.freeze({
  code: Object.freeze({
    role: 'implementa e modifica código dentro do workspace',
    args: Object.freeze(executorArgs('default')), // perfil padrão (o mais restrito)
    bypassArgs: Object.freeze(executorArgs('bypass')), // só quando o workspace foi ligado ao modo sem confirmação pelo usuário
  }),
});
export const AGENT_NAMES = Object.freeze(Object.keys(AGENTS));

/** O nome é um perfil cadastrado? (Object.hasOwn: `__proto__`, `constructor` e afins nunca passam.) */
export const isAgent = (name) => typeof name === 'string' && Object.hasOwn(AGENTS, name);

/**
 * Argumentos da CLI do agente (cópia nova a cada chamada). Sem nome = agente padrão. Lança Error se o agente não existe.
 * `profile`: perfil de permissão do workspace; SÓ a string exata 'bypass' liga o modo sem confirmação, qualquer outra coisa (ausente, inválida) é `default` (fail-safe).
 */
export function agentArgs(name = DEFAULT_AGENT, opts = null) {
  if (!isAgent(name)) throw new Error(`Perfil de agente desconhecido: ${typeof name === 'string' ? name.slice(0, 40) : typeof name}`);
  return [...(opts?.profile === 'bypass' ? AGENTS[name].bypassArgs : AGENTS[name].args)];
}
