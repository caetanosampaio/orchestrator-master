// Squads: equipes nomeadas e reutilizáveis (papel + agente de cada vaga). PURO (sem React, sem rede): os times prontos do FORGE, o rascunho do editor e validações. Times novos entram só por Configurações > Times prontos (nada vem fixo no Cockpit). Os salvos vêm de /api/team-templates.
import { presetById, mixAgents, LEAD_ROLES, inferTeam, mixSummary } from './team-view.js';

export const MAX_SLOTS = 12, MAX_NAME = 40, MAX_SQUADS = 24;
const norm = (s) => String(s ?? '').toLocaleLowerCase('pt-BR');
const cleanName = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim();

/**
 * Times prontos do FORGE (opcionais, para instalar): HOJE SÃO DOIS, os dois mistos (Claude Code e Codex CLI) e com funções diferentes. Cada um diz o que faz e já traz o agente, o modelo e o esforço de cada vaga (ids das listas fechadas do servidor, ver providers/*.js; um teste confere cada vaga contra a
 * validação estrita da API). Podem usar Claude Code, Codex CLI ou os dois: `squadMissing` diz o que falta instalar. Não são excluíveis; "usar como base" cria uma equipe sua a partir delas.
 */
const vaga = (role, provider, model, effort, n = 1) => Array.from({ length: n }, () => Object.freeze({ role, provider, model, effort }));
const curated = (id, name, tagline, about, slots) => Object.freeze({ id: `builtin:forge-${id}`, name, tagline, about, builtin: true, curated: true, slots: Object.freeze(slots) });
const CURATED = Object.freeze([
  curated('code-build', 'Construção de código', 'O Claude planeja e revisa; dois Codex escrevem o código em paralelo.',
    'Use para implementar algo de ponta a ponta. O Maestro (Claude) divide a tarefa, dois Construtores (Codex) trabalham ao mesmo tempo e o Revisor (Claude) confere o resultado antes de você integrar.',
    [...vaga('maestro', 'claude', 'opus', 'high'), ...vaga('builder', 'codex', 'gpt-5-codex', 'medium', 2), ...vaga('reviewer', 'claude', 'opus', 'high')]),
  curated('audit', 'Revisão e segurança', 'Duas IAs revisam de forma independente: uma de cada, e o que as duas apontam é o que mais pesa.',
    'Use para auditar uma branch ou um pull request. O Batedor (Codex) mapeia o que mudou e os dois Revisores, um Claude e um Codex, procuram defeitos, regressões e falhas de segurança sem ver a opinião um do outro. Ninguém aqui edita arquivos.',
    [...vaga('maestro', 'claude', 'opus', 'high'), ...vaga('scout', 'codex', 'gpt-5', 'medium'), ...vaga('reviewer', 'claude', 'opus', 'max'), ...vaga('reviewer', 'codex', 'gpt-5', 'high')]),
]);
/** As equipes por objetivo (cópias novas: quem recebe pode mexer sem afetar as outras telas). */
export const curatedSquads = () => CURATED.map((s) => ({ ...s, slots: s.slots.map((v) => ({ ...v })) }));
/** Agentes que a equipe usa, sem repetir. */
export const squadProviders = (squad) => [...new Set((Array.isArray(squad?.slots) ? squad.slots : []).map((s) => s.provider))];
/** Agentes da equipe que NÃO estão instalados (`available` = ids dos instalados): vazio = pode ser aberta. */
export const squadMissing = (squad, available = []) => squadProviders(squad).filter((id) => !available.includes(id));

/** Texto de um time: o que ele faz (`tagline`) e quando usar (`about`). Os times prontos já trazem os dois; os seus só têm o que você escreveu (nada). */
export function describeSquad(squad) {
  return { tagline: squad?.tagline ?? null, about: squad?.about ?? null };
}
/** Nome do modelo/esforço de uma vaga para exibir: o rótulo da lista do servidor (`options`), o próprio id quando não está na lista, ou "padrão" quando a vaga não define. */
export function slotChoiceLabels(slot, options) {
  const o = slotOptions(options, slot?.provider);
  const find = (list, id) => (id ? (list ?? []).find((x) => x.id === id)?.label ?? id : null);
  return { model: find(o?.models, slot?.model) ?? 'Modelo padrão', effort: find(o?.efforts, slot?.effort) ?? 'Esforço padrão', modelSet: !!slot?.model, effortSet: !!slot?.effort };
}

/** Nome livre entre os seus times: o próprio nome, ou "Nome (2)", "Nome (3)"… (sem estourar o limite de caracteres). */
export function uniqueName(name, squads = []) {
  const base = cleanName(name).slice(0, MAX_NAME).trim(), taken = new Set((Array.isArray(squads) ? squads : []).map((s) => norm(s.name)));
  if (!base || !taken.has(norm(base))) return base;
  for (let n = 2; n < 100; n++) { const suf = ` (${n})`, cand = `${base.slice(0, MAX_NAME - suf.length).trim()}${suf}`; if (!taken.has(norm(cand))) return cand; }
  return base;
}
/** Rascunho para INSTALAR um time pronto: as vagas dele (com modelo e esforço) e um nome livre; salva como time NOVO e seu, e dá para mudar tudo antes. */
export function draftForInstall(squad, squads = []) {
  return { ...draftFromSquad(squad), name: uniqueName(squad?.name, squads) };
}
/** Já existe um time seu com o nome desse time pronto (só informativo: instalar de novo é possível, com outro nome). */
export const isInstalled = (squad, squads = []) => (Array.isArray(squads) ? squads : []).some((s) => norm(s.name) === norm(squad?.name));

/** Vaga limpa para enviar ao servidor ou editar: `model` e `effort` só existem quando escolhidos ("Padrão" = ausente). */
export const slotOf = (s) => ({ role: s.role, provider: s.provider, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}) });
export const cleanSlots = (slots) => (Array.isArray(slots) ? slots : []).map(slotOf);

/**
 * O que o cockpit precisa para abrir um squad: papéis e agentes na ordem das vagas, e o preset gravado como equipe do workspace quando bate exatamente com um.
 * `models` e `efforts` (um valor por vaga, na mesma ordem; vazio = padrão do agente) só entram quando alguma vaga os define.
 */
export function launchPlan(squad) {
  const slots = Array.isArray(squad?.slots) ? squad.slots : [];
  const roles = slots.map((s) => s.role);
  return {
    roles, providers: slots.map((s) => s.provider), teamId: roles.length ? inferTeam(roles) : null,
    ...(slots.some((s) => s.model) ? { models: slots.map((s) => s.model || null) } : {}),
    ...(slots.some((s) => s.effort) ? { efforts: slots.map((s) => s.effort || null) } : {}),
  };
}

/** Modelos e níveis de esforço oferecidos para um agente (`options` do GET /api/team-templates), ou null quando o servidor não informa (servidor antigo: sem os seletores). */
export function slotOptions(options, providerId) {
  const o = options && typeof options === 'object' ? options[providerId] : null;
  if (!o || typeof o !== 'object') return null;
  const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && x.id) : []);
  const models = list(o.models), efforts = list(o.efforts);
  return models.length || efforts.length ? { models, efforts } : null;
}

/** "4 terminais · 2 Claude Code, 2 Codex CLI". */
export const squadSummary = (slots, labelOf = (id) => id) => {
  const list = Array.isArray(slots) ? slots : [];
  return `${list.length} ${list.length === 1 ? 'terminal' : 'terminais'} · ${mixSummary(list.map((s) => s.provider), labelOf)}`;
};

// ---- rascunho do editor: { id, name, slots[{role,provider}], mix } ----
/** Rascunho a partir de um preset (ou 'empty') aplicando um atalho de distribuição (`mix`); `available` = ids dos provedores instalados. */
export function draftFromPreset(presetId, mix, available = []) {
  const roles = presetId === 'empty' ? [] : (presetById(presetId)?.roles ?? []);
  const agents = mixAgents(roles, mix, available[0] ?? 'claude');
  return { id: null, name: '', slots: roles.map((role, i) => ({ role, provider: agents[i] })), mix };
}
/** Rascunho para editar um squad salvo (muda o próprio) ou usar um embutido como ponto de partida (salva como novo: id nulo, sem nome). */
export function draftFromSquad(squad) {
  return { id: squad?.builtin ? null : (squad?.id ?? null), name: squad?.builtin ? '' : (squad?.name ?? ''), slots: cleanSlots(squad?.slots), mix: 'custom' };
}
/** Rascunho para DUPLICAR: as mesmas vagas, sem id (salva como novo) e com o nome "… (cópia)" cortado no limite. */
export function draftFromCopy(squad) {
  const d = draftFromSquad({ ...squad, builtin: false });
  return { ...d, id: null, name: cleanName(`${squad?.name ?? ''} (cópia)`).slice(0, MAX_NAME).trim() };
}
export const withSlot = (draft, i, patch) => ({ ...draft, mix: 'custom', slots: draft.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
/** Trocar o agente de uma vaga zera modelo e esforço: as listas mudam de um agente para outro. */
export const withProvider = (draft, i, provider) => ({ ...draft, mix: 'custom', slots: draft.slots.map((s, k) => (k === i ? (s.provider === provider ? s : { role: s.role, provider }) : s)) });
export const removeSlot = (draft, i) => ({ ...draft, mix: 'custom', slots: draft.slots.filter((_, k) => k !== i) });
export function addSlot(draft, available = [], role = 'builder') {
  if (draft.slots.length >= MAX_SLOTS) return draft;
  return { ...draft, mix: 'custom', slots: [...draft.slots, { role, provider: available[0] ?? 'claude' }] };
}
/** Aplica um atalho de distribuição de agentes mantendo os papéis. */
export function applyMix(draft, mixId, available = []) {
  const agents = mixAgents(draft.slots.map((s) => s.role), mixId, available[0] ?? 'claude');
  return { ...draft, mix: mixId, slots: draft.slots.map((s, i) => (agents[i] === s.provider ? s : { role: s.role, provider: agents[i] })) }; // trocar de agente zera modelo e esforço
}

/** Problema que impede de ABRIR o rascunho agora (ou null): precisa de vagas, agentes disponíveis e espaço. */
export function draftOpenProblem(draft, { available = [], room = Infinity } = {}) {
  const slots = draft?.slots ?? [];
  if (!slots.length) return 'Adicione ao menos uma vaga.';
  if (slots.length > MAX_SLOTS) return `Um squad tem no máximo ${MAX_SLOTS} vagas.`;
  if (slots.length > room) return `O squad precisa de ${slots.length} vagas e há ${Math.max(0, room)} livres.`;
  const bad = slots.find((s) => !available.includes(s.provider));
  return bad ? `O agente "${bad.provider}" não está disponível.` : null;
}
/** Problema que impede de SALVAR (ou null): as regras de abrir (menos o espaço livre) mais o nome (1 a 40 caracteres, único, sem diferenciar maiúsculas). `names` = nomes já usados (os do próprio squad editado saem pelo id). */
export function draftSaveProblem(draft, { available = [], squads = [] } = {}) {
  const open = draftOpenProblem(draft, { available });
  if (open) return open;
  const name = cleanName(draft.name);
  if (!name) return 'Dê um nome ao squad para salvar.';
  if (name.length > MAX_NAME) return `O nome tem no máximo ${MAX_NAME} caracteres.`;
  if (squads.some((s) => s.id !== draft.id && norm(s.name) === norm(name))) return 'Já existe um squad com esse nome.';
  if (!draft.id && squads.length >= MAX_SQUADS) return `Limite de ${MAX_SQUADS} squads atingido: exclua um antes de salvar outro.`;
  return null;
}

// ---- trocar o preset de uma equipe que JÁ existe: o agente de cada vaga nova acompanha o que a equipe atual faz ----
const providerOfSession = (s) => (typeof s?.provider === 'string' && s.provider ? s.provider : 'claude'); // sessões antigas valem Claude Code
const majority = (arr) => { const n = new Map(); for (const a of arr) n.set(a, (n.get(a) ?? 0) + 1); let best = null, k = 0; for (const [a, c] of n) if (c > k) { best = a; k = c; } return best; };

/**
 * Agente sugerido para cada vaga NOVA (`roles`), a partir dos terminais ativos (`live`):
 *  1) já existe terminal do mesmo papel: o agente dele (o da maioria);
 *  2) a equipe usa um agente só: esse mesmo;
 *  3) equipe mista: o agente de quem faz o mesmo tipo de trabalho (coordenar/revisar/investigar x construir);
 *  4) sem pista: `fallback` (o agente padrão das preferências).
 * Ex.: Dupla mista (Construtor Codex + Revisor Claude) indo para Squad: o Construtor novo vem em Codex e o Maestro em Claude.
 */
export function inferAgents(roles, live = [], fallback = 'claude') {
  const running = (Array.isArray(live) ? live : []).filter((s) => s && s.status === 'running');
  const byRole = new Map();
  for (const s of running) byRole.set(s.role, [...(byRole.get(s.role) ?? []), providerOfSession(s)]);
  const all = running.map(providerOfSession), uniform = new Set(all).size === 1 ? all[0] : null;
  const leads = running.filter((s) => LEAD_ROLES.includes(s.role)).map(providerOfSession), builds = running.filter((s) => !LEAD_ROLES.includes(s.role)).map(providerOfSession);
  return (Array.isArray(roles) ? roles : []).map((r) => {
    if (byRole.has(r)) return majority(byRole.get(r));
    if (uniform) return uniform;
    const pool = LEAD_ROLES.includes(r) ? leads : builds;
    return pool.length ? majority(pool) : fallback;
  });
}

// ---- trocar o preset de uma equipe que JÁ existe: o que fica, o que fecha e o que abre ----
const countBy = (roles) => { const m = new Map(); for (const r of roles) m.set(r, (m.get(r) ?? 0) + 1); return m; };
const busyRank = (s, stateOf) => (['working', 'waiting'].includes(stateOf?.(s)) ? 0 : 1);

/**
 * Plano para a equipe passar a ser exatamente `presetRoles`: por papel, FICAM os terminais necessários (em atividade primeiro, depois os mais antigos), os que sobram
 * FECHAM (inclui papéis que o preset não tem) e os papéis que faltam ABREM. `live` = sessões da equipe; `stateOf(s)` = estado exibido (working, waiting, idle...).
 * Ex.: Squad (Maestro, Construtor x2, Revisor) indo para Dupla (Construtor, Revisor): fecha o Maestro e um Construtor, nada abre.
 */
export function teamChangePlan(presetRoles, live = [], stateOf = null) {
  const running = (Array.isArray(live) ? live : []).filter((s) => s && s.status === 'running');
  const roles = Array.isArray(presetRoles) ? presetRoles : [];
  const needed = countBy(roles), byRole = new Map();
  running.forEach((s, i) => byRole.set(s.role, [...(byRole.get(s.role) ?? []), { s, i }]));
  const keep = [], close = [];
  for (const [role, list] of byRole) {
    const sorted = [...list].sort((a, b) => busyRank(a.s, stateOf) - busyRank(b.s, stateOf) || a.i - b.i), n = needed.get(role) ?? 0;
    sorted.forEach((x, k) => (k < n ? keep : close).push(x.s));
  }
  const openRoles = [];
  for (const [role, n] of needed) for (let k = (byRole.get(role) ?? []).length; k < n; k++) openRoles.push(role);
  openRoles.sort((a, b) => roles.indexOf(a) - roles.indexOf(b));
  return { keep, close, openRoles };
}

/**
 * Recalcula o que abrir quando o usuário troca "manter/fechar" de um terminal. `closeIds` = ids marcados para fechar. `over` lista papéis em que ele manteria MAIS do que a equipe nova tem
 * (inclusive papel que ela não tem): enquanto houver `over`, o plano não pode ser aplicado.
 */
export function applyCloseChoice(presetRoles, live = [], closeIds = []) {
  const running = (Array.isArray(live) ? live : []).filter((s) => s && s.status === 'running');
  const roles = Array.isArray(presetRoles) ? presetRoles : [], needed = countBy(roles);
  const kept = running.filter((s) => !closeIds.includes(s.id)), have = countBy(kept.map((s) => s.role));
  const over = [...have].filter(([role, n]) => n > (needed.get(role) ?? 0)).map(([role, n]) => ({ role, have: n, max: needed.get(role) ?? 0 }));
  const openRoles = [];
  for (const [role, n] of needed) for (let k = have.get(role) ?? 0; k < n; k++) openRoles.push(role);
  openRoles.sort((a, b) => roles.indexOf(a) - roles.indexOf(b));
  return { kept, closing: running.filter((s) => closeIds.includes(s.id)), openRoles, over };
}
