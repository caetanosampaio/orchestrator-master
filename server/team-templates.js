// Squads salvos ("modelos de equipe"): uma equipe NOMEADA e reutilizável, com o papel, o agente (provedor) e, opcionalmente, o modelo, o esforço e as skills de domínio de cada vaga
// ({ role, provider, model?, effort?, skills? }; omitido = padrão), e uma instrução do time (opcional) que vai para todos os terminais dele. Abrir um squad abre todos os terminais de uma vez.
// Guardados em db.teamTemplates (globais, valem para qualquer workspace). Tudo que chega pela API é validado de forma ESTRITA (papel, provedor, modelo, esforço e skills vêm de listas fechadas do servidor);
// leitura do banco é tolerante (banco antigo, editado à mão ou corrompido nunca derruba nada). Falha ao gravar desfaz o estado parcial e responde 500.
// Os times prontos do FORGE (team-presets.js) vão junto no GET, só para leitura.
import * as store from './store.js';
import { now, uid } from './store.js';
import { ROLES } from './terminals.js';
import { isProvider, getProvider, providerOptions, validateChoice, tolerantChoice } from './providers/index.js';
import { isSkillId } from './loadouts.js';
import { cleanLine } from './harness.js';
import { TEAM_PRESETS, presetById } from './team-presets.js';

export const MAX_TEMPLATES = 24, MAX_SLOTS = 12, MAX_NAME = 40, MAX_INSTRUCTION = 1500, MAX_SLOT_SKILLS = 8;
const ID_RE = /^tpl_[0-9a-f]{8}$/;
const SLOT_KEYS = ['role', 'provider', 'model', 'effort', 'skills'], BODY_KEYS = ['name', 'slots', 'instruction'];
export const NO_SKILLS_PROVIDER = 'O Codex CLI ainda não recebe skills: tire as skills desta vaga ou use o Claude Code.';
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cleanName = (s) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim();
const norm = (s) => s.toLocaleLowerCase('pt-BR');
const roleOk = (r) => typeof r === 'string' && Object.hasOwn(ROLES, r);
/** O provedor carrega skills (plugins)? Hoje só o Claude Code. */
export const providerTakesSkills = (p) => isProvider(p) && getProvider(p).capabilities?.plugins === true;

/** Vagas ESTRITAS (papel, provedor, model, effort e skills de listas fechadas; os opcionais só entram na vaga se informados) -> { slots } ou { error }. */
function cleanSlots(slots) {
  const generic = { error: `slots deve ser uma lista de 1 a ${MAX_SLOTS} vagas { role, provider, model?, effort?, skills? } com papel e provedor válidos.` };
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) return generic;
  const out = [];
  for (const [i, s] of slots.entries()) {
    if (!isObj(s) || !roleOk(s.role) || !isProvider(s.provider)) return generic;
    const extra = Object.keys(s).filter((k) => !SLOT_KEYS.includes(k));
    if (extra.length) return { error: `slots[${i}]: propriedades não permitidas: ${extra.map((k) => k.slice(0, 40)).join(', ')}.` };
    const c = validateChoice(s.provider, s);
    if (c.error) return { error: `slots[${i}]: ${c.field} não está entre as opções do provedor ${s.provider} (veja options em GET /api/team-templates).` };
    let skills = [];
    if (s.skills !== undefined && s.skills !== null) {
      if (!Array.isArray(s.skills) || s.skills.length > MAX_SLOT_SKILLS || !s.skills.every(isSkillId) || new Set(s.skills).size !== s.skills.length) return { error: `slots[${i}]: skills deve ser uma lista de até ${MAX_SLOT_SKILLS} ids do catálogo (GET /api/loadouts), sem repetir.` };
      skills = s.skills;
    }
    if (skills.length && !providerTakesSkills(s.provider)) return { error: `slots[${i}]: ${NO_SKILLS_PROVIDER}` };
    out.push({ role: s.role, provider: s.provider, ...c.value, ...(skills.length ? { skills: [...skills] } : {}) });
  }
  return { slots: out };
}

/** Skills na leitura TOLERANTE: só ids do catálogo, sem repetir, até o limite; provedor sem plugins não leva nenhuma. */
function readSkills(provider, skills) {
  if (!Array.isArray(skills) || !providerTakesSkills(provider)) return [];
  const out = [];
  for (const id of skills) if (isSkillId(id) && !out.includes(id)) out.push(id);
  return out.slice(0, MAX_SLOT_SKILLS);
}
/** Vagas na leitura TOLERANTE: papel/provedor inválidos descartam a lista; model/effort/skills que já não valem (ou ausentes, banco antigo) apenas saem da vaga, o squad continua utilizável. */
function readSlots(slots) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) return null;
  const out = [];
  for (const s of slots) {
    if (!isObj(s) || !roleOk(s.role) || !isProvider(s.provider)) return null;
    const skills = readSkills(s.provider, s.skills);
    out.push({ role: s.role, provider: s.provider, ...tolerantChoice(s.provider, s), ...(skills.length ? { skills } : {}) });
  }
  return out;
}
/** Instrução do time na leitura tolerante: texto limpo de 1 a MAX_INSTRUCTION caracteres, ou nada. */
function readInstruction(v) {
  if (typeof v !== 'string') return null;
  const t = cleanLine(v, MAX_INSTRUCTION + 1);
  return t && t.length <= MAX_INSTRUCTION ? t : null;
}

/** Leitura TOLERANTE do banco: só entram modelos inteiramente válidos; o resto é ignorado em silêncio. */
export function readTemplates(db) {
  const raw = Array.isArray(db?.teamTemplates) ? db.teamTemplates : [];
  const out = [], ids = new Set();
  for (const t of raw) {
    if (!isObj(t) || typeof t.id !== 'string' || !ID_RE.test(t.id) || ids.has(t.id) || typeof t.name !== 'string') continue;
    const name = cleanName(t.name).slice(0, MAX_NAME), slots = readSlots(t.slots), instruction = readInstruction(t.instruction);
    if (!name || !slots) continue;
    ids.add(t.id);
    out.push({ id: t.id, name, slots, ...(instruction ? { instruction } : {}), createdAt: typeof t.createdAt === 'string' ? t.createdAt : null, updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : null });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

/** Time por id: um salvo (tpl_xxxxxxxx, lido do banco de forma tolerante) ou um pronto (preset:<slug>). null se não existe. Usado ao abrir terminais (terminals.js). */
export function findTeam(db, id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('preset:')) return presetById(id);
  return ID_RE.test(id) ? readTemplates(db).find((t) => t.id === id) ?? null : null;
}

/**
 * Validação ESTRITA do corpo (POST completo; PUT parcial). Devolve { value } ou { error }. Propriedade desconhecida é recusada, nunca ignorada.
 * `instruction`: vazia depois de limpa = ausente; no PUT, `null` ou "" vira `value.instruction = null` (REMOVE a instrução gravada).
 */
export function validateTemplateBody(b, { partial = false } = {}) {
  if (!isObj(b)) return { error: 'O corpo deve ser um objeto com name e slots.' };
  const extra = Object.keys(b).filter((k) => !BODY_KEYS.includes(k));
  if (extra.length) return { error: `Propriedades não permitidas: ${extra.map((k) => k.slice(0, 40)).join(', ')}.` };
  const value = {};
  if (b.name !== undefined || !partial) {
    if (typeof b.name !== 'string') return { error: 'name deve ser um texto.' };
    const name = cleanName(b.name);
    if (!name || name.length > MAX_NAME) return { error: `name deve ter de 1 a ${MAX_NAME} caracteres.` };
    value.name = name;
  }
  if (b.slots !== undefined || !partial) {
    const r = cleanSlots(b.slots);
    if (r.error) return { error: r.error };
    value.slots = r.slots;
  }
  if (b.instruction !== undefined) {
    if (b.instruction !== null && typeof b.instruction !== 'string') return { error: 'instruction deve ser um texto.' };
    const t = b.instruction === null ? '' : cleanLine(b.instruction, MAX_INSTRUCTION + 1);
    if (t.length > MAX_INSTRUCTION) return { error: `instruction deve ter até ${MAX_INSTRUCTION} caracteres.` };
    if (t) value.instruction = t; else if (partial) value.instruction = null;
  }
  if (partial && !Object.keys(value).length) return { error: 'Informe name, slots e/ou instruction.' };
  return { value };
}

/** GET/POST /api/team-templates, PUT/DELETE /api/team-templates/:id. */
export function setupTeamTemplates(app, { db }) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const list = () => readTemplates(db);
  const taken = (name, exceptId = null) => list().some((t) => t.id !== exceptId && norm(t.name) === norm(name));
  /** Grava a lista nova; se falhar, devolve o banco ao que era (nada fica pela metade). */
  const commit = (res, next) => {
    const had = Object.hasOwn(db, 'teamTemplates'), prev = db.teamTemplates;
    try { db.teamTemplates = next; store.saveOrThrow(); return true; } catch {
      if (had) db.teamTemplates = prev; else delete db.teamTemplates;
      fail(res, 500, 'Não foi possível gravar o squad: o banco não pôde ser gravado; nada foi alterado.'); return false;
    }
  };

  app.get('/api/team-templates', (req, res) => res.json({ templates: list(), presets: TEAM_PRESETS, options: providerOptions(), limits: { maxTemplates: MAX_TEMPLATES, maxSlots: MAX_SLOTS, maxName: MAX_NAME, maxInstruction: MAX_INSTRUCTION, maxSlotSkills: MAX_SLOT_SKILLS } }));

  app.post('/api/team-templates', (req, res) => {
    const v = validateTemplateBody(req.body); if (v.error) return fail(res, 400, v.error);
    const cur = list();
    if (cur.length >= MAX_TEMPLATES) return fail(res, 409, `Limite de ${MAX_TEMPLATES} squads atingido: exclua um antes de salvar outro.`);
    if (taken(v.value.name)) return fail(res, 409, 'Já existe um squad com esse nome.');
    let id; do { id = uid('tpl'); } while (!ID_RE.test(id) || cur.some((t) => t.id === id));
    const t = { id, name: v.value.name, slots: v.value.slots, ...(v.value.instruction ? { instruction: v.value.instruction } : {}), createdAt: now(), updatedAt: now() };
    if (!commit(res, [...cur, t])) return undefined;
    return res.status(201).json({ template: t });
  });

  app.put('/api/team-templates/:id', (req, res) => {
    if (!ID_RE.test(req.params.id)) return fail(res, 404, 'Squad não encontrado.');
    const cur = list(), i = cur.findIndex((t) => t.id === req.params.id);
    if (i < 0) return fail(res, 404, 'Squad não encontrado.');
    const v = validateTemplateBody(req.body, { partial: true }); if (v.error) return fail(res, 400, v.error);
    if (v.value.name !== undefined && taken(v.value.name, cur[i].id)) return fail(res, 409, 'Já existe um squad com esse nome.');
    const t = { ...cur[i], ...v.value, updatedAt: now() };
    if (t.instruction === null) delete t.instruction; // `instruction: null` ou "" no PUT remove a instrução
    if (!commit(res, cur.map((x, k) => (k === i ? t : x)))) return undefined;
    return res.json({ template: t });
  });

  app.delete('/api/team-templates/:id', (req, res) => {
    if (!ID_RE.test(req.params.id)) return fail(res, 404, 'Squad não encontrado.');
    const cur = list();
    if (!cur.some((t) => t.id === req.params.id)) return fail(res, 404, 'Squad não encontrado.');
    if (!commit(res, cur.filter((t) => t.id !== req.params.id))) return undefined;
    return res.json({ removed: req.params.id });
  });
}
