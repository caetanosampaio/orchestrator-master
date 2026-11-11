// Skills no cliente: lógica pura sobre o que GET /api/loadouts (o catálogo e o que cada papel recebe) e GET /api/harness (a tabela "Quem faz cada tarefa") devolvem. Sem React, sem rede.
// Só existem as skills do catálogo do servidor (texto fixo, em loadouts.js): nada aqui inventa skill.
export const ROLE_ORDER = Object.freeze(['maestro', 'builder', 'reviewer', 'scout']);
/** Como o agente chama a skill no Claude Code: /squad:<id>. */
export const callName = (id) => `/squad:${id}`;

const roleKeys = (loadouts) => { const keys = Object.keys(loadouts?.roles ?? {}); return [...ROLE_ORDER.filter((r) => keys.includes(r)), ...keys.filter((r) => !ROLE_ORDER.includes(r))]; };
/** Os papéis que recebem a skill ao abrir um terminal, na ordem de exibição. */
export const rolesLoading = (loadouts, id) => roleKeys(loadouts).filter((r) => loadouts.roles[r]?.skills?.includes(id));
/** Os tipos de tarefa da tabela que citam a skill (só os efetivos: o que vale hoje). */
export const tasksUsing = (rows, id) => (Array.isArray(rows) ? rows : []).filter((r) => r?.effective?.skills?.includes(id)).map((r) => ({ id: r.id, label: r.label }));
/** Marca ou desmarca uma skill de um papel respeitando o limite; devolve a lista nova (ou null se estouraria o limite). */
export function toggleSkill(list, id, max = Infinity) {
  const cur = Array.isArray(list) ? list : [];
  if (cur.includes(id)) return cur.filter((x) => x !== id);
  return cur.length >= max ? null : [...cur, id];
}
/** O que difere do padrão do papel: { added: [...], removed: [...] }. */
export function diffFromDefault(role) {
  const cur = role?.skills ?? [], def = role?.defaults ?? [];
  return { added: cur.filter((s) => !def.includes(s)), removed: def.filter((s) => !cur.includes(s)) };
}
/** Primeira frase da descrição (para a linha compacta). */
export function firstSentence(text, max = 150) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim(), m = /^.*?[.!?](?=\s|$)/.exec(t), s = m ? m[0] : t;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
/** Skills do catálogo, só as que o papel recebe (`role` nulo = todas). */
export function filterByRole(skills, loadouts, role = null) {
  const list = Array.isArray(skills) ? skills : [];
  return role ? list.filter((s) => loadouts?.roles?.[role]?.skills?.includes(s.id)) : list;
}
// ---- grupo e origem de cada skill (catalog.skills[]: { id, description, body, group, source, license, origin }) ----
export const SKILL_GROUPS = Object.freeze([Object.freeze({ id: 'processo', label: 'Processo' }), Object.freeze({ id: 'dominio', label: 'Domínio' })]);
/** Grupo da skill: 'dominio' só quando o servidor diz; qualquer outro valor (ou servidor antigo, sem o campo) vale 'processo'. */
export const skillGroup = (s) => (s?.group === 'dominio' ? 'dominio' : 'processo');
export const groupLabel = (g) => SKILL_GROUPS.find((x) => x.id === g)?.label ?? 'Processo';
const line = (v, max) => (typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** De onde a skill veio: as vendorizadas (cópia de um projeto de terceiros) mostram a origem e a licença; as do FORGE, nada a mais. */
export function skillSource(s) {
  const vendored = s?.source === 'vendored';
  return { vendored, origin: vendored ? (line(s.origin, 200) || null) : null, license: vendored ? (line(s.license, 60) || null) : null };
}
/** O catálogo para os seletores (sem o texto longo): só entradas com id, na ordem do servidor. */
export const catalogSkills = (loadouts) => (Array.isArray(loadouts?.catalog?.skills) ? loadouts.catalog.skills : [])
  .filter((s) => s && typeof s.id === 'string' && s.id)
  .map((s) => ({ id: s.id, description: typeof s.description === 'string' ? s.description : '', group: skillGroup(s), ...skillSource(s) }));
/** As skills separadas por grupo, na ordem Processo e Domínio; grupo vazio não aparece. */
export function groupSkills(skills) {
  const list = Array.isArray(skills) ? skills.filter((s) => s && typeof s.id === 'string') : [];
  return SKILL_GROUPS.map((g) => ({ id: g.id, label: g.label, skills: list.filter((s) => skillGroup(s) === g.id) })).filter((g) => g.skills.length > 0);
}

/** Números do topo: quantas skills, quantos papéis, quantas a tabela cita e quantos papéis foram personalizados. */
export function summary(loadouts, rows) {
  const skills = loadouts?.catalog?.skills ?? [], roles = roleKeys(loadouts);
  return {
    skills: skills.length, roles: roles.length,
    inTable: skills.filter((s) => tasksUsing(rows, s.id).length > 0).length,
    customized: roles.filter((r) => loadouts.roles[r]?.customized).length,
  };
}
