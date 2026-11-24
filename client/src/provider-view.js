// Estado de um provider (CLI de agente) para a interface, só a partir do que o servidor informa em GET /api/terminals (`providers`) e GET /api/accounts (`providers`).
// PURO (sem React, sem rede). Nada é presumido: sem `auth` o login é desconhecido e o texto diz só o que se sabe ("instalado"). O login de cada conta é tratado em Configurações > Contas.

import { CATALOG, catalogColor } from './provider-catalog.js';

/**
 * Estado de um provider, do mais forte ao mais fraco: não instalado > não conectado > ATIVO (há terminais dele em uso: `active` > 0) > conectado (login feito, sem terminais) > instalado (login desconhecido).
 * @param {{available?:boolean, active?:number, auth?:{known?:boolean, loggedIn?:boolean|null}}|null|undefined} p provider (linha de providerSummary ou item do servidor)
 * @returns {{kind:'ok'|'bad'|'off', text:string}}
 */
export function providerStatus(p) {
  if (!p) return { kind: 'off', text: 'indisponível' };
  if (p.available === false) return { kind: 'off', text: 'não instalado' };
  if (p.auth?.known === true && p.auth.loggedIn === false) return { kind: 'bad', text: 'não conectado' };
  if (Number(p.active) > 0) return { kind: 'ok', text: 'ativo' };
  if (p.auth?.known === true && p.auth.loggedIn === true) return { kind: 'ok', text: 'conectado' };
  return { kind: 'ok', text: 'instalado' };
}

/**
 * Dá a cada provider o estado de login das CONTAS dele (GET /api/accounts com status): alguma conectada = conectado; todas verificadas e desconectadas = não conectado.
 * Sem contas verificadas do provider (ou sem a lista), o provider segue como veio (o Codex ainda tem a sonda própria de /api/terminals).
 */
export function withAccountsLogin(providers, accounts) {
  if (!Array.isArray(providers) || !Array.isArray(accounts)) return providers;
  return providers.map((p) => {
    if (!p) return p;
    const mine = accounts.filter((a) => a && (a.provider ?? 'claude') === p.id && a.status?.checked === true && typeof a.status.loggedIn === 'boolean');
    if (!mine.length) return p;
    const on = mine.some((a) => a.status.loggedIn === true);
    if (!on && mine.length < accounts.filter((a) => a && (a.provider ?? 'claude') === p.id).length) return p; // há conta ainda sem resposta: não afirma "não conectado"
    return { ...p, auth: { known: true, loggedIn: on } };
  });
}

/** Provider pelo id na lista do servidor (ou undefined). */
export const providerById = (list, id) => (Array.isArray(list) ? list.find((p) => p && p.id === id) : undefined);

/** Cor de identidade de cada IA (o mascote e os selos usam esta): vem do catálogo (provider-catalog.js); IA desconhecida fica em cinza. */
export const PROVIDER_COLORS = Object.freeze(Object.fromEntries(CATALOG.filter((x) => x.integrated).map((x) => [x.id, x.color])));
export const providerColor = (id) => catalogColor(id) ?? '#9aa3b2';
