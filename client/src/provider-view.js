// Estado de um provider (CLI de agente) para a interface, só a partir do que o servidor informa em GET /api/terminals (`providers`) e GET /api/accounts (`providers`).
// PURO (sem React, sem rede). Nada é presumido: sem `auth` o login é desconhecido e o texto diz só o que se sabe ("instalado"). O login do Claude Code é tratado em Configurações > Contas.

/**
 * @param {{available?:boolean, auth?:{known?:boolean, loggedIn?:boolean|null}}|null|undefined} p provider como o servidor devolve
 * @returns {{kind:'ok'|'bad'|'off', text:string}}
 */
export function providerStatus(p) {
  if (!p) return { kind: 'off', text: 'indisponível' };
  if (p.available === false) return { kind: 'off', text: 'não instalado' };
  if (p.auth?.known === true && p.auth.loggedIn === false) return { kind: 'bad', text: 'não conectado' };
  if (p.auth?.known === true && p.auth.loggedIn === true) return { kind: 'ok', text: 'conectado' };
  return { kind: 'ok', text: 'instalado' };
}

/** Provider pelo id na lista do servidor (ou undefined). */
export const providerById = (list, id) => (Array.isArray(list) ? list.find((p) => p && p.id === id) : undefined);

/**
 * Cartão do Codex na aba Contas: estado e orientação. O login é do próprio Codex CLI (o FORGE não o faz nem gerencia várias contas dele).
 * @returns {{kind:'ok'|'bad'|'off', text:string, detail:string}}
 */
export function codexAccountState(p) {
  const s = providerStatus(p);
  if (!p) return { ...s, detail: 'Não foi possível consultar o Codex CLI.' };
  if (p.available === false) return { ...s, detail: 'Instale com "npm i -g @openai/codex" e entre com "codex login" num terminal.' };
  if (s.text === 'conectado') return { ...s, detail: 'O Codex usa o login do próprio Codex CLI, em todos os terminais Codex. O FORGE não gerencia várias contas dele.' };
  if (s.text === 'não conectado') return { ...s, detail: 'Rode "codex login" num terminal e atualize esta tela. O FORGE não faz o login do Codex.' };
  return { ...s, text: 'login não verificado', detail: 'O Codex CLI está instalado, mas não foi possível confirmar o login. Rode "codex login status" num terminal.' };
}
