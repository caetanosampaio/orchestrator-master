// Squads: equipes nomeadas e reutilizáveis (papel + agente de cada vaga, com skills e uma instrução do time). PURO (sem React, sem rede): os times prontos do servidor, o rascunho do editor e validações.
// Times novos entram só por Configurações > Times prontos (nada vem fixo no Cockpit). Os salvos e os prontos (`presets`) vêm de GET /api/team-templates.
import { presetById, mixAgents, LEAD_ROLES, inferTeam, mixSummary } from './team-view.js';

export const MAX_SLOTS = 12, MAX_NAME = 40, MAX_SQUADS = 24, MAX_INSTRUCTION = 1500, MAX_SLOT_SKILLS = 8;
const norm = (s) => String(s ?? '').toLocaleLowerCase('pt-BR');
const cleanName = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim();
/** A mesma limpeza que o servidor faz na instrução do time (cleanLine de harness.js): ela vira uma linha só, sem os caracteres que o shell interpretaria. */
export const cleanInstruction = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}&|<>^%"`]+/gu, ' ').replace(/ {2,}/g, ' ').trim();
const TEMPLATE_ID_RE = /^tpl_[0-9a-f]{8}$/, PRESET_ID_RE = /^preset:[a-z0-9-]{1,40}$/;
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * A vaga recebe skills? Só quem tem a capacidade `plugins` no servidor (hoje: Claude Code sim, Codex CLI não). Se a lista de agentes informar a capacidade, ela manda;
 * senão vale a regra conhecida (Codex não recebe). Nunca decide pelo servidor: ele valida de novo e recusa vaga Codex com skills.
 */
export function takesSkills(providerId, providers = null) {
  const p = Array.isArray(providers) ? providers.find((x) => x?.id === providerId) : null;
  if (typeof p?.capabilities?.plugins === 'boolean') return p.capabilities.plugins;
  return providerId !== 'codex';
}
const skillList = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x))].slice(0, MAX_SLOT_SKILLS);
/** Skills que a vaga leva de fato (para mostrar): vaga Codex nunca tem. */
export const slotSkills = (slot) => (takesSkills(slot?.provider) ? skillList(slot?.skills) : []);

/**
 * Times prontos do FORGE (`presets` do GET /api/team-templates, só leitura): normaliza o que o servidor mandou e devolve cópias novas (quem recebe pode mexer sem afetar as outras telas).
 * Entrada estranha some em silêncio (servidor antigo sem `presets` = lista vazia). Não são excluíveis; "instalar" cria um time seu a partir deles.
 */
export function readyTeams(presets) {
  const out = [], ids = new Set();
  for (const p of Array.isArray(presets) ? presets : []) {
    if (!p || typeof p.id !== 'string' || !PRESET_ID_RE.test(p.id) || ids.has(p.id) || !text(p.name, MAX_NAME) || !Array.isArray(p.slots) || !p.slots.length) continue;
    const slots = p.slots.filter((s) => s && typeof s.role === 'string' && typeof s.provider === 'string').map(slotOf);
    if (slots.length !== p.slots.length) continue; // vaga quebrada: o time inteiro fica de fora (abrir só parte dele confundiria)
    ids.add(p.id);
    const instruction = cleanInstruction(p.instruction).slice(0, MAX_INSTRUCTION);
    out.push({ id: p.id, name: text(p.name, MAX_NAME), tagline: text(p.tagline, 300), about: text(p.about, 1200), ...(instruction ? { instruction } : {}), builtin: true, curated: true, slots });
  }
  return out;
}
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

/** Vaga limpa para enviar ao servidor ou editar: `model`, `effort` e `skills` só existem quando escolhidos ("Padrão" e lista vazia = ausente). Vaga Codex nunca leva skills (o servidor recusaria). */
export const slotOf = (s) => {
  const skills = takesSkills(s.provider) ? skillList(s.skills) : [];
  return { role: s.role, provider: s.provider, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(skills.length ? { skills } : {}) };
};
export const cleanSlots = (slots) => (Array.isArray(slots) ? slots : []).map(slotOf);

/**
 * Corpo do POST/PUT /api/team-templates a partir do rascunho: { name, slots, instruction? }. `previous` = o time salvo que está sendo editado (para saber se a instrução foi apagada:
 * no PUT, `instruction: null` remove). `catalogIds` = ids do catálogo de skills (quando já lido): skill que saiu do catálogo não vai ao servidor.
 */
export function templateBody(draft, { previous = null, catalogIds = null } = {}) {
  const known = catalogIds ? new Set(catalogIds) : null;
  const slots = cleanSlots(draft?.slots).map((s) => {
    if (!known || !s.skills) return s;
    const { skills, ...rest } = s, keep = skills.filter((id) => known.has(id));
    return keep.length ? { ...rest, skills: keep } : rest;
  });
  const instruction = cleanInstruction(draft?.instruction).slice(0, MAX_INSTRUCTION);
  return { name: cleanName(draft?.name), slots, ...(instruction ? { instruction } : previous?.instruction ? { instruction: null } : {}) };
}

/** Id do time para o servidor achar as skills e a instrução de cada vaga: time salvo (tpl_…) ou pronto (preset:…). Qualquer outra coisa = sem time (o terminal abre só com o papel). */
export const templateIdOf = (squad) => (typeof squad?.id === 'string' && (TEMPLATE_ID_RE.test(squad.id) || PRESET_ID_RE.test(squad.id)) ? squad.id : null);

/**
 * O que o cockpit precisa para abrir um squad: papéis e agentes na ordem das vagas, e o preset gravado como equipe do workspace quando bate exatamente com um (`teamId`, o layout).
 * `templateId` + `slotIndexes` (0..n-1) vão em cada POST /api/terminals: o servidor confere a vaga e aplica as skills e a instrução do time. `models` e `efforts` (um valor por vaga,
 * na mesma ordem; vazio = padrão do agente) só entram quando alguma vaga os define.
 */
export function launchPlan(squad) {
  const slots = Array.isArray(squad?.slots) ? squad.slots : [];
  const roles = slots.map((s) => s.role);
  return {
    roles, providers: slots.map((s) => s.provider), teamId: roles.length ? inferTeam(roles) : null,
    templateId: templateIdOf(squad), slotIndexes: slots.map((_, i) => i),
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

// ---- rascunho do editor: { id, name, instruction, slots[{role,provider,model?,effort?,skills?}], mix } ----
/** Rascunho a partir de um preset (ou 'empty') aplicando um atalho de distribuição (`mix`); `available` = ids dos provedores instalados. */
export function draftFromPreset(presetId, mix, available = []) {
  const roles = presetId === 'empty' ? [] : (presetById(presetId)?.roles ?? []);
  const agents = mixAgents(roles, mix, available[0] ?? 'claude');
  return { id: null, name: '', instruction: '', slots: roles.map((role, i) => ({ role, provider: agents[i] })), mix };
}
/** Rascunho para editar um squad salvo (muda o próprio) ou usar um embutido como ponto de partida (salva como novo: id nulo, sem nome). A instrução e as skills das vagas vêm junto. */
export function draftFromSquad(squad) {
  return { id: squad?.builtin ? null : (squad?.id ?? null), name: squad?.builtin ? '' : (squad?.name ?? ''), instruction: typeof squad?.instruction === 'string' ? squad.instruction : '', slots: cleanSlots(squad?.slots), mix: 'custom' };
}
/** Rascunho para DUPLICAR: as mesmas vagas, sem id (salva como novo) e com o nome "… (cópia)" cortado no limite. */
export function draftFromCopy(squad) {
  const d = draftFromSquad({ ...squad, builtin: false });
  return { ...d, id: null, name: cleanName(`${squad?.name ?? ''} (cópia)`).slice(0, MAX_NAME).trim() };
}
export const withSlot = (draft, i, patch) => ({ ...draft, mix: 'custom', slots: draft.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
/** Vaga com outro agente: modelo e esforço zeram (as listas mudam de um agente para outro); as skills ficam só se o agente novo as recebe (para o Codex, saem). */
const reprovider = (s, provider) => {
  if (s.provider === provider) return s;
  const skills = takesSkills(provider) ? skillList(s.skills) : [];
  return { role: s.role, provider, ...(skills.length ? { skills } : {}) };
};
export const withProvider = (draft, i, provider) => ({ ...draft, mix: 'custom', slots: draft.slots.map((s, k) => (k === i ? reprovider(s, provider) : s)) });
/** Marca ou desmarca uma skill da vaga `i` (até MAX_SLOT_SKILLS). Vaga que não recebe skills, ou lista cheia, devolve o mesmo rascunho. */
export function withSlotSkill(draft, i, skillId, max = MAX_SLOT_SKILLS) {
  const s = draft?.slots?.[i];
  if (!s || typeof skillId !== 'string' || !skillId || !takesSkills(s.provider)) return draft;
  const cur = skillList(s.skills);
  if (!cur.includes(skillId) && cur.length >= max) return draft;
  const next = cur.includes(skillId) ? cur.filter((x) => x !== skillId) : [...cur, skillId];
  const { skills: _old, ...rest } = s;
  return { ...draft, slots: draft.slots.map((x, k) => (k === i ? (next.length ? { ...rest, skills: next } : rest) : x)) };
}
/** Problema da instrução do time (ou null): até MAX_INSTRUCTION caracteres depois da mesma limpeza do servidor. */
export function instructionProblem(textValue) {
  return cleanInstruction(textValue).length > MAX_INSTRUCTION ? `A instrução do time tem no máximo ${MAX_INSTRUCTION} caracteres.` : null;
}
export const removeSlot = (draft, i) => ({ ...draft, mix: 'custom', slots: draft.slots.filter((_, k) => k !== i) });
export function addSlot(draft, available = [], role = 'builder') {
  if (draft.slots.length >= MAX_SLOTS) return draft;
  return { ...draft, mix: 'custom', slots: [...draft.slots, { role, provider: available[0] ?? 'claude' }] };
}
/** Aplica um atalho de distribuição de agentes mantendo os papéis. */
export function applyMix(draft, mixId, available = []) {
  const agents = mixAgents(draft.slots.map((s) => s.role), mixId, available[0] ?? 'claude');
  return { ...draft, mix: mixId, slots: draft.slots.map((s, i) => reprovider(s, agents[i])) }; // trocar de agente zera modelo e esforço (e tira as skills se o agente novo não as recebe)
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
  return instructionProblem(draft.instruction);
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
