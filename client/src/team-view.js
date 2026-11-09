// Equipe do workspace (presets). PURO: só nomes, composição e contas sobre as sessões reais; nada aqui abre ou fecha terminal.
// Os ids (duo, squad, full) vêm de antes e são os que ficam gravados; só o RÓTULO mudou (o squad de quatro agora se chama "Squad"). `builder` é o preset de um único Construtor.
export const PRESETS = Object.freeze([
  Object.freeze({ id: 'duo', label: 'Dupla', roles: Object.freeze(['builder', 'reviewer']) }),
  Object.freeze({ id: 'squad', label: 'Squad', roles: Object.freeze(['maestro', 'builder', 'builder', 'reviewer']) }),
  Object.freeze({ id: 'full', label: 'Squad de 6', roles: Object.freeze(['maestro', 'scout', 'builder', 'builder', 'builder', 'reviewer']) }),
  Object.freeze({ id: 'builder', label: 'Construtor', roles: Object.freeze(['builder']) }),
]);
export const PRESET_IDS = Object.freeze(PRESETS.map((p) => p.id));
export const isPresetId = (id) => typeof id === 'string' && PRESET_IDS.includes(id);
export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;

/** Papéis que faltam para completar o preset, dado o que já está rodando (multiconjunto: 2 Construtores pedidos, 1 rodando = falta 1). Nunca sugere fechar nada. */
export function missingRoles(presetRoles, liveRoles) {
  const have = new Map();
  for (const r of liveRoles ?? []) have.set(r, (have.get(r) ?? 0) + 1);
  const out = [];
  for (const r of presetRoles ?? []) { const n = have.get(r) ?? 0; if (n > 0) have.set(r, n - 1); else out.push(r); }
  return out;
}

/** Papéis em excesso em relação ao preset (informativo: nunca são encerrados sozinhos). */
export function extraRoles(presetRoles, liveRoles) { return missingRoles(liveRoles, presetRoles); }

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Texto de impacto de trocar de preset, ANTES de executar. `live` = terminais ativos do workspace; `labelOf(role)` = rótulo do papel; `room` = vagas livres.
 * Trocar o preset nunca encerra processo: só abre o que falta (dentro do limite).
 */
export function changeImpact({ from, to, liveRoles = [], labelOf = (r) => r, room = Infinity }) {
  const target = presetById(to); if (!target) return null;
  const miss = missingRoles(target.roles, liveRoles), open = miss.slice(0, Math.max(0, room)), skipped = miss.length - open.length;
  const names = (list) => list.map(labelOf).join(', ');
  const lines = [from ? `Alterar a equipe de "${presetById(from)?.label ?? from}" para "${target.label}"?` : `Definir a equipe deste workspace como "${target.label}"?`];
  if (liveRoles.length) lines.push(`Os ${plural(liveRoles.length, 'terminal ativo continua', 'terminais ativos continuam')} rodando: nenhum processo, sessão ou worktree é encerrado.`);
  lines.push(open.length ? `Serão abertos ${plural(open.length, 'terminal novo', 'terminais novos')} para completar: ${names(open)}.` : 'Nenhum terminal novo é necessário.');
  if (skipped > 0) lines.push(`${plural(skipped, 'terminal não cabe', 'terminais não cabem')} no limite e ficará de fora.`);
  return { text: lines.join('\n\n'), open, skipped, needsConfirm: liveRoles.length > 0 };
}

/**
 * Equipe de um workspace sem preset gravado, a partir dos papéis dos terminais que ele já tem: se bate EXATAMENTE com um preset, é esse; senão devolve null (equipe "personalizada").
 * É só leitura: nada é gravado nem aberto. Serve para a barra não oferecer a configuração inicial a quem já tem terminais.
 */
export function inferTeam(roles = []) {
  const key = (a) => [...a].sort().join(',');
  const k = key(Array.isArray(roles) ? roles : []);
  return PRESETS.find((p) => key(p.roles) === k)?.id ?? null;
}

// ---- Equipe mista: um agente por vaga do preset (Claude Code e Codex na mesma equipe, abertos de uma vez) ----
/** Papéis que coordenam, revisam ou investigam; os demais (Construtor) constroem. Usado só pelos atalhos de mistura. */
export const LEAD_ROLES = Object.freeze(['maestro', 'reviewer', 'scout']);
/** Atalhos de distribuição dos agentes. `claude-leads`: Claude Code coordena e revisa, Codex constrói (e o inverso em `codex-leads`). */
export const MIXES = Object.freeze([
  Object.freeze({ id: 'all-claude', label: 'Todos Claude Code', needs: ['claude'] }),
  Object.freeze({ id: 'all-codex', label: 'Todos Codex', needs: ['codex'] }),
  Object.freeze({ id: 'claude-leads', label: 'Claude lidera e revisa, Codex constrói', needs: ['claude', 'codex'] }),
  Object.freeze({ id: 'codex-leads', label: 'Codex lidera e revisa, Claude constrói', needs: ['claude', 'codex'] }),
]);
export const mixById = (id) => MIXES.find((m) => m.id === id) ?? null;

/** Agente de cada vaga (na ordem de `roles`) para um atalho. Atalho desconhecido: tudo no `fallback`. */
export function mixAgents(roles, mixId, fallback = 'claude') {
  const list = Array.isArray(roles) ? roles : [];
  if (mixId === 'all-claude') return list.map(() => 'claude');
  if (mixId === 'all-codex') return list.map(() => 'codex');
  if (mixId === 'claude-leads') return list.map((r) => (LEAD_ROLES.includes(r) ? 'claude' : 'codex'));
  if (mixId === 'codex-leads') return list.map((r) => (LEAD_ROLES.includes(r) ? 'codex' : 'claude'));
  return list.map(() => fallback);
}

/** Atalhos oferecidos: só os que usam provedores instalados (`available` = ids). */
export const availableMixes = (available = []) => MIXES.filter((m) => m.needs.every((id) => available.includes(id)));

/** Atalho inicial: a mistura Claude lidera/Codex constrói quando os dois existem; senão tudo no único provedor disponível. */
export function defaultMix(available = []) {
  if (available.includes('claude') && available.includes('codex')) return 'claude-leads';
  return available.includes('codex') && !available.includes('claude') ? 'all-codex' : 'all-claude';
}

/** O plano é abrível? Cada vaga com um agente disponível e o total cabe nas vagas livres. */
export function composeProblem(agents, available = [], room = Infinity) {
  const list = Array.isArray(agents) ? agents : [];
  if (!list.length) return 'Escolha uma equipe.';
  if (list.length > room) return `A equipe precisa de ${list.length} vagas e há ${Math.max(0, room)} livres.`;
  const bad = list.find((a) => !available.includes(a));
  return bad ? `O agente "${bad}" não está disponível.` : null;
}

/** Resumo curto: "2 Claude Code, 2 Codex CLI" (ordem de primeira aparição). */
export function mixSummary(agents, labelOf = (id) => id) {
  const count = new Map();
  for (const a of agents ?? []) count.set(a, (count.get(a) ?? 0) + 1);
  return [...count].map(([id, n]) => `${n} ${labelOf(id)}`).join(', ');
}
