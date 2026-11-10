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

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** Opções fechadas de cada provedor: { <id>: { models:[{id,label}], efforts:[{id,label}] } } (cópia nova; vai para a interface). */
export function providerOptions() {
  const out = {};
  for (const id of providerIds()) { const o = PROVIDERS[id].options; out[id] = { models: (o?.models ?? []).map((m) => ({ id: m.id, label: m.label })), efforts: (o?.efforts ?? []).map((e) => ({ id: e.id, label: e.label })) }; }
  return out;
}
const inList = (list, v) => typeof v === 'string' && (list ?? []).some((x) => x.id === v);
/**
 * Valida model/effort de UMA vaga/terminal contra as listas FECHADAS do provedor. `undefined`/`null` = omitido (padrão da CLI). Qualquer outra coisa (texto fora da lista, vazio, número, objeto) é recusada:
 * nada que não esteja na lista chega à linha de comando. Devolve { value: { model?, effort? } } ou { error, field }.
 */
export function validateChoice(providerId, { model, effort } = {}) {
  if (!isProvider(providerId)) return { error: 'Provedor inválido.', field: 'provider' };
  const o = PROVIDERS[providerId].options, value = {};
  if (model !== undefined && model !== null) { if (!inList(o?.models, model)) return { error: `model inválido para ${PROVIDERS[providerId].label}.`, field: 'model' }; value.model = model; }
  if (effort !== undefined && effort !== null) { if (!inList(o?.efforts, effort)) return { error: `effort inválido para ${PROVIDERS[providerId].label}.`, field: 'effort' }; value.effort = effort; }
  return { value };
}
/** Leitura TOLERANTE (banco/registro antigo): devolve só o model/effort ainda válidos para o provedor; o resto é ignorado em silêncio. */
export function tolerantChoice(providerId, src) {
  if (!isObj(src) || !isProvider(providerId)) return {};
  const o = PROVIDERS[providerId].options, out = {};
  if (inList(o?.models, src.model)) out.model = src.model;
  if (inList(o?.efforts, src.effort)) out.effort = src.effort;
  return out;
}
export { claudeProvider, codexProvider };
