// Catálogo das IAs (agentes) que aparecem no FORGE: as INTEGRADAS (rodam nos terminais: Claude Code e Codex CLI) e as que ainda NÃO são integradas e só aparecem para acompanhar o que pode vir.
// PURO (sem React, sem rede). O que roda de verdade vem de GET /api/terminals (`providers`); este catálogo só dá nome e cor aos mascotes, e `integrated` nunca é presumido pela interface.
const ai = (id, label, color, extra = {}) => Object.freeze({ id, label, color, integrated: false, ...extra });
export const CATALOG = Object.freeze([
  ai('claude', 'Claude', '#e8603a', { integrated: true, full: 'Claude Code' }),
  ai('codex', 'Codex', '#3fe0bd', { integrated: true, full: 'Codex CLI' }),
  ai('antigravity', 'Antigravity', '#38aaea'), ai('gemini', 'Gemini', '#3b6fe6'),
  ai('kimi', 'Kimi', '#6f48e0'), ai('kiro', 'Kiro', '#a448dc'), ai('cursor', 'Cursor', '#7490ad'),
  ai('copilot', 'Copilot', '#9580b0'), ai('grok', 'Grok', '#a98f7a'), ai('opencode', 'OpenCode', '#80b295'),
]);
/** O mascote do próprio FORGE, o Forjador (arte própria em forge-mascot.js): não é uma IA, é a marca. */
export const FORGE_MASCOT = Object.freeze({ id: 'forge', label: 'FORGE', color: '#ee5a2e', integrated: false, brand: true });

export const catalogById = (id) => CATALOG.find((x) => x.id === id) ?? (id === FORGE_MASCOT.id ? FORGE_MASCOT : null);
export const catalogColor = (id) => catalogById(id)?.color ?? null;
export const integratedIds = () => CATALOG.filter((x) => x.integrated).map((x) => x.id);
/** As IAs ainda sem integração (para a lista "Para ligar"). `known` = ids que o SERVIDOR já integra (GET /api/terminals > providers): essas saem daqui mesmo sem `integrated` no catálogo. */
export const plannedAis = (known = []) => CATALOG.filter((x) => !x.integrated && !(Array.isArray(known) && known.includes(x.id)));
/** Nome completo para exibir: o do catálogo ("Claude Code"), senão o que o servidor informou, senão o próprio id. */
export const aiName = (id, serverLabel = null) => catalogById(id)?.full || serverLabel || catalogById(id)?.label || String(id);
/** Só o nome da IA, sem o produto ("Claude", "Codex"): o de Configurações > Suas IAs. IA fora do catálogo: o nome do servidor sem " CLI" no fim, senão o id. */
export const aiShortName = (id, serverLabel = null) => catalogById(id)?.label || (typeof serverLabel === 'string' && serverLabel.trim() ? serverLabel.trim().replace(/\s+CLI$/i, '') : String(id));
