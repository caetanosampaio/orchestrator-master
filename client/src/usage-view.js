// Tokens exibidos dentro da caixa de cada agente do Cockpit (funções puras, sem React).
// Regra de ouro: valor ausente aparece como "—", nunca como zero inventado. Nada aqui estima, nem calcula saldo ou limite.

export const DASH = '—';
const nf = new Intl.NumberFormat('pt-BR');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const FIELDS = ['input', 'output', 'cacheCreation', 'cacheRead'];

export const fmtTokens = (v) => (isNum(v) ? nf.format(v) : DASH);

/** O backend já envia o agregado novo? (um servidor antigo devolve só { costUsd, runs }) */
export const hasTotals = (usage) => !!usage && typeof usage === 'object' && !!usage.total && typeof usage.total === 'object';

/**
 * Tokens de um agente ('planner' | 'executor') na missão indicada, a partir de /api/state.usage.byMission (o servidor já deduplica:
 * o total final de uma execução substitui o provisório, e cada chamada do Planner conta uma vez). O número é a soma do que a CLI reportou
 * (entrada + saída + cache de criação + cache de leitura); campos não reportados ficam de fora e, sem nenhum, o texto é "—".
 * `partial`: há consumo ainda provisório (execução em andamento ou encerrada sem o resultado final).
 * @returns {{text:string, partial:boolean}}
 */
export function agentTokens(usage, missionId, agent) {
  const none = { text: DASH, partial: false };
  if (!hasTotals(usage) || !Array.isArray(usage.byMission) || missionId == null) return none;
  const t = usage.byMission.find((m) => m.missionId === missionId)?.byAgent?.[agent];
  if (!t || !t.entries) return none;
  const known = FIELDS.map((f) => t[f]).filter(isNum);
  if (!known.length) return none;
  return { text: fmtTokens(known.reduce((a, b) => a + b, 0)), partial: isNum(t.provisional) && t.provisional > 0 };
}

// ---- Terminais interativos (panes do Cockpit) ----
// `usage` de cada pane vem de /api/terminals (lido do transcript do Claude Code): { input, output, cacheWrite, cacheRead, total, turns, model, costUsd|null } ou null.
// Custo ausente (sem tabela de preços) é "—", nunca US$ 0.

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const fmtUsd = (v) => (isNum(v) ? usd.format(v) : DASH);

/**
 * Tokens de um pane como o TERMINAL os mostra ao vivo: entrada + saída (no Claude Code, o `↓ N tokens` do turno é a saída; a mesma convenção do Codex). O contexto em cache fica de fora:
 * o cache GRAVADO (~24 mil de instruções do sistema a cada sessão nova) e o cache LIDO (~50 mil relidos a cada resposta) faziam um simples `pwd` parecer 100 mil tokens. Eles aparecem no tooltip.
 * Servidor antigo (sem `io`) cai em entrada + saída; sem elas, no total.
 */
export function newTokens(u) {
  if (!u || typeof u !== 'object') return null;
  if (isNum(u.io)) return u.io;
  if (isNum(u.input) && isNum(u.output)) return u.input + u.output;
  return isNum(u.total) ? u.total : null;
}

/** Texto do pane: { tokens, cost, title } (title = detalhamento para o tooltip). */
export function paneUsage(usage) {
  if (!usage || newTokens(usage) === null) return { tokens: DASH, cost: DASH, title: 'Sem consumo registrado ainda (o arquivo da sessão aparece depois da primeira resposta).' };
  const title = `Tokens (como o terminal mostra): entrada ${fmtTokens(usage.input)} · saída ${fmtTokens(usage.output)} | contexto em cache, fora da conta: gravado ${fmtTokens(usage.cacheWrite)} · lido ${fmtTokens(usage.cacheRead)} (relido a cada resposta) · ${usage.turns} ${usage.turns === 1 ? 'resposta' : 'respostas'}${usage.model ? ` · ${usage.model}` : ''}`;
  return { tokens: fmtTokens(newTokens(usage)), cost: fmtUsd(usage.costUsd), title };
}

/**
 * Total do squad (todos os panes listados). Tokens: soma dos panes que já têm consumo. Custo: só quando TODOS os panes com consumo têm custo conhecido;
 * senão é "—" (`partialCost` diz que há custo conhecido em parte dos panes, sem somar como se fosse o total).
 */
export function squadUsage(sessions) {
  const withUsage = (Array.isArray(sessions) ? sessions : []).map((s) => s?.usage).filter((u) => u && newTokens(u) !== null);
  if (!withUsage.length) return { tokens: DASH, cost: DASH, panes: 0, partialCost: false };
  const known = withUsage.filter((u) => isNum(u.costUsd));
  return { tokens: fmtTokens(withUsage.reduce((a, u) => a + newTokens(u), 0)), cost: known.length === withUsage.length ? fmtUsd(known.reduce((a, u) => a + u.costUsd, 0)) : DASH, panes: withUsage.length, partialCost: known.length > 0 && known.length < withUsage.length };
}
