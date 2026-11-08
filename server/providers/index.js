// Registro de provedores de agentes (CLIs). Claude Code e Codex CLI.
//
// Interface de um provedor (tudo fixo no servidor; nada vem do cliente):
//   id          : identificador estável, gravado nas sessões ('claude')
//   label       : nome para a interface
//   resolve()   : { file, args, viaShell } da CLI no PATH, ou null se não estiver instalada
//   paneArgs()  : argumentos do terminal interativo para new | resume | fork (ver claude.js)
//   capabilities: { resume, fork, hooks, plugins, accounts }; submit: { bracketed, delayMs } (entrega de tarefas do Maestro); notFoundMessage; projectConfig/envFor (opcionais)
import { claudeProvider } from './claude.js';
import { codexProvider } from './codex.js';

export const DEFAULT_PROVIDER = 'claude';
const PROVIDERS = Object.freeze({ [claudeProvider.id]: claudeProvider, [codexProvider.id]: codexProvider });

export const providerIds = () => Object.keys(PROVIDERS);
/** O id é um provedor cadastrado? (Object.hasOwn: `__proto__`, `constructor` e afins nunca passam.) */
export const isProvider = (id) => typeof id === 'string' && Object.hasOwn(PROVIDERS, id);
/** Provedor pelo id; sem id (sessões antigas, gravadas antes de existir o campo) vale o padrão. Lança Error se o id não existe. */
export function getProvider(id = DEFAULT_PROVIDER) {
  if (!isProvider(id)) throw new Error(`Provedor desconhecido: ${typeof id === 'string' ? id.slice(0, 40) : typeof id}`);
  return PROVIDERS[id];
}
export { claudeProvider, codexProvider };
