// Squads salvos ("modelos de equipe"): uma equipe NOMEADA e reutilizável, com o papel, o agente (provedor) e, opcionalmente, o modelo e o esforço de cada vaga ({ role, provider, model?, effort? }; omitido = padrão da CLI). Abrir um squad abre todos os terminais de uma vez.
// Guardados em db.teamTemplates (globais, valem para qualquer workspace). Tudo que chega pela API é validado de forma ESTRITA (papel e provedor vêm de listas fechadas do servidor);
// leitura do banco é tolerante (banco antigo, editado à mão ou corrompido nunca derruba nada). Falha ao gravar desfaz o estado parcial e responde 500.
import * as store from './store.js';
import { now, uid } from './store.js';
import { ROLES } from './terminals.js';
import { isProvider, providerOptions, validateChoice, tolerantChoice } from './providers/index.js';

export const MAX_TEMPLATES = 24, MAX_SLOTS = 12, MAX_NAME = 40;
const ID_RE = /^tpl_[0-9a-f]{8}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const cleanName = (s) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/ {2,}/g, ' ').trim();
const norm = (s) => s.toLocaleLowerCase('pt-BR');
const roleOk = (r) => typeof r === 'string' && Object.hasOwn(ROLES, r);

/** Vagas ESTRITAS (papel, provedor, model e effort de listas fechadas; model/effort só entram na vaga se informados) -> { slots } ou { error }. */
function cleanSlots(slots) {
  const generic = { error: `slots deve ser uma lista de 1 a ${MAX_SLOTS} vagas { role, provider, model?, effort? } com papel e provedor válidos.` };
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) return generic;
  const out = [];
  for (const [i, s] of slots.entries()) {
    if (!isObj(s) || !roleOk(s.role) || !isProvider(s.provider)) return generic;
    const c = validateChoice(s.provider, s);
    if (c.error) return { error: `slots[${i}]: ${c.field} não está entre as opções do provedor ${s.provider} (veja options em GET /api/team-templates).` };
    out.push({ role: s.role, provider: s.provider, ...c.value });
  }
  return { slots: out };
}

/** Vagas na leitura TOLERANTE: papel/provedor inválidos descartam a lista; model/effort que já não valem (ou ausentes, banco antigo) apenas saem da vaga, o squad continua utilizável. */
function readSlots(slots) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) return null;
  const out = [];
  for (const s of slots) { if (!isObj(s) || !roleOk(s.role) || !isProvider(s.provider)) return null; out.push({ role: s.role, provider: s.provider, ...tolerantChoice(s.provider, s) }); }
  return out;
}

/** Leitura TOLERANTE do banco: só entram modelos inteiramente válidos; o resto é ignorado em silêncio. */
export function readTemplates(db) {
  const raw = Array.isArray(db?.teamTemplates) ? db.teamTemplates : [];
  const out = [], ids = new Set();
  for (const t of raw) {
    if (!isObj(t) || typeof t.id !== 'string' || !ID_RE.test(t.id) || ids.has(t.id) || typeof t.name !== 'string') continue;
    const name = cleanName(t.name).slice(0, MAX_NAME), slots = readSlots(t.slots);
    if (!name || !slots) continue;
    ids.add(t.id);
    out.push({ id: t.id, name, slots, createdAt: typeof t.createdAt === 'string' ? t.createdAt : null, updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : null });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

/** Validação ESTRITA do corpo (POST completo; PUT parcial). Devolve { value } ou { error }. Propriedade desconhecida é recusada, nunca ignorada. */
export function validateTemplateBody(b, { partial = false } = {}) {
  if (!isObj(b)) return { error: 'O corpo deve ser um objeto com name e slots.' };
  const extra = Object.keys(b).filter((k) => k !== 'name' && k !== 'slots');
  if (extra.length) return { error: `Propriedades não permitidas: ${extra.join(', ')}.` };
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
  if (partial && !Object.keys(value).length) return { error: 'Informe name e/ou slots.' };
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

  app.get('/api/team-templates', (req, res) => res.json({ templates: list(), options: providerOptions(), limits: { maxTemplates: MAX_TEMPLATES, maxSlots: MAX_SLOTS, maxName: MAX_NAME } }));

  app.post('/api/team-templates', (req, res) => {
    const v = validateTemplateBody(req.body); if (v.error) return fail(res, 400, v.error);
    const cur = list();
    if (cur.length >= MAX_TEMPLATES) return fail(res, 409, `Limite de ${MAX_TEMPLATES} squads atingido: exclua um antes de salvar outro.`);
    if (taken(v.value.name)) return fail(res, 409, 'Já existe um squad com esse nome.');
    let id; do { id = uid('tpl'); } while (!ID_RE.test(id) || cur.some((t) => t.id === id));
    const t = { id, name: v.value.name, slots: v.value.slots, createdAt: now(), updatedAt: now() };
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
