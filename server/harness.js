// "Quem faz cada tarefa": para cada TIPO de tarefa, qual IA faz, com qual modelo, quanto ela pensa, com quais skills e com qual agente (instrução). Mais o Maestro (o "piloto"): a IA, o modelo e o esforço dele.
//
// O que é guardado (db.harness, só o que o usuário MUDOU; o resto é o padrão de fábrica deste arquivo):
//   { pilot: { provider?, model?, effort?, reserveModel?, agentId? }, rows: { <tipo>: { provider?, model?, effort?, skills?, agentId? } }, agents: [{ id, name, instruction, createdAt, updatedAt }] }
//
// O que isso FAZ de verdade:
//   - Maestro: terminal novo com papel `maestro` abre com o modelo e o esforço do piloto (quando ninguém escolheu outros e a IA é a do piloto) e, se houver agente do piloto, a instrução dele entra no prompt do papel
//     (`terminalDefaults`, usado por terminals.js). Terminais já abertos não mudam.
//   - Ajudantes: o Maestro lê a tabela pela ferramenta MCP `list_routes` e manda `task_type` em `send_task`; o servidor acrescenta à tarefa o tipo, as skills e o agente da linha (`taskHint`) e avisa se o pane de destino
//     não é a IA recomendada. Nada é imposto: a aprovação humana das tarefas continua valendo.
//   - Skills: só as do catálogo de loadouts.js (texto fixo); o agente é texto do usuário, limpo de controles e de caracteres que quebram a linha de comando.
// Tudo que chega pela API é validado de forma ESTRITA (listas fechadas de IA/modelo/esforço/skills); leitura do banco é tolerante; falha ao gravar desfaz o estado parcial e responde 500.
import * as store from './store.js';
import { now, uid } from './store.js';
import { providerIds, providerOptions, validateChoice, isProvider, getProvider } from './providers/index.js';
import { SKILLS, isSkillId, ROLE_DEFAULTS, skillsFor } from './loadouts.js';

export const MAX_AGENTS = 20, MAX_NAME = 40, MAX_INSTRUCTION = 1500, MAX_ROW_SKILLS = 6, MAX_CODE = 96 * 1024;
const AGENT_ID_RE = /^agt_[0-9a-f]{8}$/;
export const CODE_PREFIX = 'forge-harness:1:';

const row = (id, label, group, role, provider, model, effort, skills = []) => Object.freeze({ id, label, group, role, provider, model, effort, skills: Object.freeze(skills) });
const BUILD = ['implementar-em-passos-pequenos', 'relato-de-conclusao'], REVIEW = ['revisar-alteracoes', 'relato-de-conclusao'], MAP = ['mapear-codigo', 'relato-de-conclusao'];
/** Padrão de fábrica: tipos de tarefa por grupo, com a IA, o modelo, o esforço e as skills de cada um. `role` = o papel do squad que costuma fazer aquele tipo. */
export const TASK_TYPES = Object.freeze([
  row('fix-bug', 'Consertar um defeito', 'Desenvolvimento', 'builder', 'claude', 'sonnet', 'medium', BUILD),
  row('new-feature', 'Fazer uma parte nova', 'Desenvolvimento', 'builder', 'claude', 'sonnet', 'medium', BUILD),
  row('tools', 'Ferramentas e scripts', 'Desenvolvimento', 'builder', 'codex', 'gpt-5-codex', 'medium', ['implementar-em-passos-pequenos']),
  row('release', 'Publicar uma versão', 'Desenvolvimento', 'builder', 'claude', 'sonnet', 'high', ['relato-de-conclusao']),
  row('review-code', 'Revisar o trabalho de outro', 'Desenvolvimento', 'reviewer', 'claude', 'sonnet', 'medium', REVIEW),
  row('map-code', 'Entender um código', 'Investigação', 'scout', 'claude', 'haiku', 'medium', ['mapear-codigo']),
  row('find-cause', 'Achar a causa de um erro', 'Investigação', 'scout', 'claude', 'opus', 'high', MAP),
  row('map-risks', 'Mapear os riscos de uma mudança', 'Investigação', 'scout', 'claude', 'sonnet', 'medium', ['mapear-codigo']),
  row('write-tests', 'Escrever testes', 'Testes e segurança', 'builder', 'codex', 'gpt-5-codex', 'medium', ['implementar-em-passos-pequenos']),
  row('security', 'Revisar a segurança', 'Testes e segurança', 'reviewer', 'claude', 'opus', 'max', REVIEW),
  row('make-page', 'Fazer uma página', 'Páginas e design', 'builder', 'codex', 'gpt-5-codex', 'medium', ['implementar-em-passos-pequenos']),
  row('copy-page', 'Copiar uma página que já existe', 'Páginas e design', 'builder', 'claude', 'sonnet', 'medium', ['implementar-em-passos-pequenos']),
  row('copy-style', 'Tirar o estilo de um site', 'Páginas e design', 'scout', 'claude', 'opus', 'high', ['mapear-codigo']),
  row('review-text', 'Revisar um texto', 'Texto', 'reviewer', 'claude', 'haiku', 'low', []),
  row('write-text', 'Escrever', 'Texto', 'builder', 'claude', 'sonnet', 'medium', ['relato-de-conclusao']),
  row('docs', 'Documentar', 'Texto', 'builder', 'claude', 'haiku', 'low', []),
]);
export const TASK_IDS = Object.freeze(TASK_TYPES.map((t) => t.id));
export const GROUPS = Object.freeze([...new Set(TASK_TYPES.map((t) => t.group))]);
export const PILOT_DEFAULT = Object.freeze({ provider: 'claude', model: 'opus', effort: 'high', reserveModel: 'sonnet', agentId: null });
const PILOT_KEYS = ['provider', 'model', 'effort', 'reserveModel', 'agentId'], ROW_KEYS = ['provider', 'model', 'effort', 'skills', 'agentId'];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const typeOf = (id) => TASK_TYPES.find((t) => t.id === id) ?? null;
const norm = (s) => s.toLocaleLowerCase('pt-BR');
// Texto do usuário que vai para a linha de comando ou para outro terminal: sem controles, sem ESC e sem & | < > ^ % " (a linha de comando do Windows os trata como especiais).
// Exportada: a instrução do time (team-templates.js) usa a MESMA regra, porque também vai para a linha de comando.
// eslint-disable-next-line no-control-regex
export const cleanLine = (v, max) => String(v ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}&|<>^%"`]+/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);
const optionIds = (providerId, kind) => (providerOptions()[providerId]?.[kind] ?? []).map((x) => x.id);

// ---------- leitura tolerante do banco ----------
function readAgents(db) {
  const raw = Array.isArray(db?.harness?.agents) ? db.harness.agents : [], out = [], ids = new Set();
  for (const a of raw) {
    if (!isObj(a) || typeof a.id !== 'string' || !AGENT_ID_RE.test(a.id) || ids.has(a.id) || typeof a.name !== 'string' || typeof a.instruction !== 'string') continue;
    const name = cleanLine(a.name, MAX_NAME), instruction = cleanLine(a.instruction, MAX_INSTRUCTION);
    if (!name || !instruction) continue;
    ids.add(a.id); out.push({ id: a.id, name, instruction, createdAt: typeof a.createdAt === 'string' ? a.createdAt : null, updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : null });
  }
  return out.slice(0, MAX_AGENTS);
}
/** Só campos conhecidos e ainda válidos (modelo/esforço/skills/agente que já não existem somem em silêncio: o padrão volta a valer). */
function readOverride(src, keys, agents) {
  if (!isObj(src)) return {};
  const o = {};
  for (const k of keys) if (src[k] !== undefined && src[k] !== null) o[k] = src[k];
  if (o.provider !== undefined && !isProvider(o.provider)) delete o.provider;
  if (o.agentId !== undefined && !agents.some((a) => a.id === o.agentId)) delete o.agentId;
  if (o.skills !== undefined && !(Array.isArray(o.skills) && o.skills.length <= MAX_ROW_SKILLS && o.skills.every(isSkillId))) delete o.skills;
  return o;
}
export function readHarness(db) {
  const agents = readAgents(db), h = isObj(db?.harness) ? db.harness : {};
  const rows = {};
  if (isObj(h.rows)) for (const id of TASK_IDS) { const o = readOverride(h.rows[id], ROW_KEYS, agents); if (Object.keys(o).length) rows[id] = o; }
  return { pilot: readOverride(h.pilot, PILOT_KEYS, agents), rows, agents };
}

// ---------- efetivo (padrão + o que o usuário mudou), com a escolha conferida contra as listas atuais ----------
const FALLBACK = Object.freeze({ claude: Object.freeze({ model: 'sonnet', effort: 'medium' }), codex: Object.freeze({ model: 'gpt-5-codex', effort: 'medium' }) }); // ao trocar de IA, o modelo e o esforço de uma opção média dela
function settleChoice(base, over) {
  const provider = over.provider ?? base.provider, same = provider === base.provider;
  const dflt = same ? { model: base.model, effort: base.effort } : (FALLBACK[provider] ?? {});
  const c = validateChoice(provider, { model: over.model ?? dflt.model, effort: over.effort ?? dflt.effort });
  if (!c.error) return { provider, model: c.value.model ?? null, effort: c.value.effort ?? null };
  const f = validateChoice(provider, dflt); // o que o usuário escolheu já não existe: volta ao padrão da IA
  return { provider, model: f.error ? null : (f.value.model ?? null), effort: f.error ? null : (f.value.effort ?? null) };
}
export function effectivePilot(h) {
  const o = h.pilot ?? {}, choice = settleChoice(PILOT_DEFAULT, o);
  const reserve = validateChoice(choice.provider, { model: o.reserveModel ?? PILOT_DEFAULT.reserveModel });
  return { ...choice, reserveModel: reserve.error ? null : (reserve.value.model ?? null), agentId: o.agentId ?? null };
}
export function effectiveRow(type, h) {
  const o = h.rows?.[type.id] ?? {}, choice = settleChoice(type, o);
  return { ...choice, skills: o.skills ?? [...type.skills], agentId: o.agentId ?? null };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Visão completa para a tela (GET /api/harness). */
export function harnessView(db) {
  const h = readHarness(db);
  const rows = TASK_TYPES.map((t) => {
    const eff = effectiveRow(t, h), def = { provider: t.provider, model: t.model, effort: t.effort, skills: [...t.skills], agentId: null };
    return { id: t.id, label: t.label, group: t.group, role: t.role, effective: eff, defaults: def, customized: !same(eff, def) };
  });
  const pilotDef = { ...PILOT_DEFAULT }, pilot = effectivePilot(h);
  return {
    pilot: { effective: pilot, defaults: pilotDef, customized: !same(pilot, pilotDef), skills: skillsFor('maestro', db?.settings) },
    groups: [...GROUPS], rows, agents: h.agents, providers: providerIds(), options: providerOptions(),
    skills: Object.values(SKILLS).map((s) => ({ id: s.name, description: s.description })), roleSkills: Object.fromEntries(Object.keys(ROLE_DEFAULTS).map((r) => [r, skillsFor(r, db?.settings)])),
    limits: { maxAgents: MAX_AGENTS, maxName: MAX_NAME, maxInstruction: MAX_INSTRUCTION, maxRowSkills: MAX_ROW_SKILLS },
  };
}

// ---------- validação ESTRITA do que chega pela API ----------
function checkKeys(b, allowed) {
  if (!isObj(b)) return 'O corpo deve ser um objeto.';
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  return extra.length ? `Propriedades não permitidas: ${extra.join(', ')}.` : null;
}
/** Valida um pedaço do piloto/linha. `null` em um campo = volta ao padrão. Devolve { patch } (campo -> valor ou null) ou { error }. */
function validatePatch(b, keys, { agents, isPilot }) {
  const bad = checkKeys(b, keys); if (bad) return { error: bad };
  const patch = {};
  for (const k of keys) {
    if (b[k] === undefined) continue;
    const v = b[k];
    if (v === null) { patch[k] = null; continue; }
    if (k === 'provider') { if (!isProvider(v)) return { error: 'IA inválida: use uma das instaladas na lista de agentes.' }; }
    else if (k === 'agentId') { if (typeof v !== 'string' || !agents.some((a) => a.id === v)) return { error: 'Agente não encontrado.' }; }
    else if (k === 'skills') { if (!Array.isArray(v) || v.length > MAX_ROW_SKILLS || !v.every(isSkillId) || new Set(v).size !== v.length) return { error: `skills deve ser uma lista de até ${MAX_ROW_SKILLS} ids do catálogo, sem repetir.` }; }
    else if (typeof v !== 'string') return { error: `${k} inválido.` };
    patch[k] = v;
  }
  if (!Object.keys(patch).length) return { error: 'Informe ao menos um campo.' };
  return { patch, isPilot };
}
/** Junta o patch ao que já está guardado (null remove) e confere o resultado: modelo, esforço e reserva precisam existir para a IA escolhida. */
function applyPatch(cur, patch, base, { pilot = false } = {}) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]; else next[k] = v;
  if (patch.provider !== undefined && patch.model === undefined && cur.model !== undefined && patch.provider !== (cur.provider ?? base.provider)) delete next.model; // trocar de IA zera o modelo e o esforço antigos
  if (patch.provider !== undefined && patch.effort === undefined && cur.effort !== undefined && patch.provider !== (cur.provider ?? base.provider)) delete next.effort;
  if (pilot && patch.provider !== undefined && patch.reserveModel === undefined && cur.reserveModel !== undefined && patch.provider !== (cur.provider ?? base.provider)) delete next.reserveModel;
  const provider = next.provider ?? base.provider;
  const c = validateChoice(provider, { model: next.model, effort: next.effort });
  if (c.error) return { error: c.error };
  if (pilot && next.reserveModel !== undefined && !optionIds(provider, 'models').includes(next.reserveModel)) return { error: 'reserveModel não está entre os modelos da IA escolhida.' };
  if (provider !== base.provider && next.model === undefined && !optionIds(provider, 'models').length) return { error: 'Esta IA não tem lista de modelos.' };
  return { next };
}

/** Código de compartilhamento: o que o usuário mudou, em texto (JSON em base64). Nada de segredo entra: só a tabela, o piloto e os agentes. */
export function exportCode(db) {
  const h = readHarness(db);
  return CODE_PREFIX + Buffer.from(JSON.stringify({ pilot: h.pilot, rows: h.rows, agents: h.agents.map(({ id, name, instruction }) => ({ id, name, instruction })) }), 'utf8').toString('base64url');
}
/** Valida um código recebido por inteiro, com as mesmas regras da API. Devolve { harness } (pronto para gravar) ou { error }. Os ids de agente são refeitos: o código nunca escolhe ids no banco. */
export function parseCode(code) {
  if (typeof code !== 'string' || code.length > MAX_CODE || !code.startsWith(CODE_PREFIX)) return { error: 'Código inválido: ele começa com "forge-harness:1:".' };
  let j; try { j = JSON.parse(Buffer.from(code.slice(CODE_PREFIX.length), 'base64url').toString('utf8')); } catch { return { error: 'Código inválido: não foi possível ler.' }; }
  if (!isObj(j) || checkKeys(j, ['pilot', 'rows', 'agents'])) return { error: 'Código inválido: formato desconhecido.' };
  const agentsIn = Array.isArray(j.agents) ? j.agents : [];
  if (agentsIn.length > MAX_AGENTS) return { error: `O código tem agentes demais (máximo ${MAX_AGENTS}).` };
  const idMap = new Map(), agents = [], names = new Set();
  for (const a of agentsIn) {
    if (!isObj(a) || typeof a.name !== 'string' || typeof a.instruction !== 'string') return { error: 'Código inválido: agente mal formado.' };
    const name = cleanLine(a.name, MAX_NAME), instruction = cleanLine(a.instruction, MAX_INSTRUCTION);
    if (!name || !instruction || names.has(norm(name))) return { error: 'Código inválido: agente sem nome, sem instrução ou com nome repetido.' };
    let id; do { id = uid('agt'); } while (!AGENT_ID_RE.test(id) || agents.some((x) => x.id === id));
    names.add(norm(name)); idMap.set(a.id, id); agents.push({ id, name, instruction, createdAt: now(), updatedAt: now() });
  }
  const remap = (o) => (o && o.agentId !== undefined ? { ...o, agentId: idMap.get(o.agentId) ?? null } : o);
  const check = (o, keys, base, pilot) => {
    if (o === undefined) return { next: {} };
    if (!isObj(o)) return { error: 'Código inválido: seção mal formada.' };
    const m = remap(o), patch = {}; for (const k of Object.keys(m)) patch[k] = m[k];
    const v = validatePatch(patch, keys, { agents, isPilot: pilot }); if (v.error && Object.keys(patch).length) return { error: `Código inválido: ${v.error}` };
    return applyPatch({}, v.patch ?? {}, base, { pilot });
  };
  const pilot = check(j.pilot, PILOT_KEYS, PILOT_DEFAULT, true); if (pilot.error) return { error: pilot.error };
  const rows = {};
  if (j.rows !== undefined) {
    if (!isObj(j.rows)) return { error: 'Código inválido: tabela mal formada.' };
    for (const [id, o] of Object.entries(j.rows)) {
      const t = typeOf(id); if (!t) return { error: `Código inválido: tipo de tarefa desconhecido (${String(id).slice(0, 30)}).` };
      const r = check(o, ROW_KEYS, t, false); if (r.error) return { error: r.error };
      if (Object.keys(r.next).length) rows[id] = r.next;
    }
  }
  return { harness: { pilot: pilot.next, rows, agents } };
}

// ---------- o que a tabela FAZ ----------
/** Padrões para um terminal novo (terminals.js): o Maestro abre com o modelo e o esforço do piloto, e com a instrução do agente dele. Só vale na criação, nunca na retomada. */
export function terminalDefaults(db, role, providerId) {
  if (role !== 'maestro') return {};
  const h = readHarness(db), p = effectivePilot(h), out = {};
  if (p.provider === providerId) { if (p.model) out.model = p.model; if (p.effort) out.effort = p.effort; }
  const a = h.agents.find((x) => x.id === p.agentId); if (a) out.extraPrompt = a.instruction;
  return out;
}
/**
 * A tabela como o Maestro enxerga (ferramenta MCP list_routes). Só dados nossos e do usuário; nada de caminho nem de credencial. Enxuta de propósito: grupo (só da tela) e skills por linha
 * ficam de fora (o hint que o servidor acrescenta à tarefa já leva tipo, skills e agente); `role` fica porque diz que papel de pane faz o tipo; `agent` só aparece quando a linha tem um.
 */
export function routesForMaestro(db) {
  const v = harnessView(db), ag = new Map(v.agents.map((a) => [a.id, a]));
  return {
    pilot: { provider: v.pilot.effective.provider, model: v.pilot.effective.model, effort: v.pilot.effective.effort, reserve_model: v.pilot.effective.reserveModel },
    task_types: v.rows.map((r) => { const agent = ag.get(r.effective.agentId)?.name; return { task_type: r.id, label: r.label, role: r.role, provider: r.effective.provider, model: r.effective.model, effort: r.effective.effort, ...(agent ? { agent } : {}) }; }),
  };
}
/** Uma linha da tabela para o send_task (ou null se o tipo não existe). */
export function routeFor(db, taskType) {
  const t = typeOf(taskType); if (!t) return null;
  const h = readHarness(db), eff = effectiveRow(t, h), a = h.agents.find((x) => x.id === eff.agentId) ?? null;
  return { id: t.id, label: t.label, role: t.role, provider: eff.provider, model: eff.model, effort: eff.effort, skills: eff.skills, agent: a ? { name: a.name, instruction: a.instruction } : null };
}
// Teto do hint: cabe a instrução inteira do agente (MAX_INSTRUCTION) mais o nome dele, o tipo e até MAX_ROW_SKILLS skills; a instrução nunca é cortada.
export const TASK_HINT_MAX = 1900;
/**
 * Texto que o servidor acrescenta à tarefa entregue: o tipo, as skills e o agente, sem caracteres de controle. `target` = o pane de destino (peek de terminals.js):
 * só entram como /squad:<id> as skills da linha que ESSE pane realmente tem (`target.skills`); pane sem plugins (Codex) ou sem a lista não recebe menção a /squad:.
 */
export function taskHint(route, target = null) {
  if (!route) return '';
  const parts = [`tipo: ${route.label}`];
  const plugins = isProvider(target?.provider) && getProvider(target.provider).capabilities?.plugins === true;
  const has = plugins && Array.isArray(target?.skills) ? target.skills : [];
  const skills = (route.skills ?? []).filter((s) => has.includes(s));
  if (skills.length) parts.push(`skills: ${skills.map((s) => `/squad:${s}`).join(' ')}`);
  if (route.agent) parts.push(`agente ${route.agent.name}: ${route.agent.instruction}`);
  return ` [${cleanLine(parts.join(' · '), TASK_HINT_MAX)}]`;
}

export function setupHarness(app, { db }) {
  const fail = (res, status, error) => res.status(status).json({ error });
  const cur = () => readHarness(db);
  /** Grava o harness novo; falha ao gravar devolve o banco ao que era. */
  const commit = (res, next) => {
    const had = Object.hasOwn(db, 'harness'), prev = db.harness;
    try { db.harness = { pilot: next.pilot, rows: next.rows, agents: next.agents }; store.saveOrThrow(); return true; } catch {
      if (had) db.harness = prev; else delete db.harness;
      fail(res, 500, 'Não foi possível gravar: o banco não pôde ser gravado; nada foi alterado.'); return false;
    }
  };
  const view = () => harnessView(db);

  app.get('/api/harness', (req, res) => res.json(view()));

  app.put('/api/harness/pilot', (req, res) => {
    const h = cur(), v = validatePatch(req.body, PILOT_KEYS, { agents: h.agents, isPilot: true }); if (v.error) return fail(res, 400, v.error);
    const r = applyPatch(h.pilot, v.patch, PILOT_DEFAULT, { pilot: true }); if (r.error) return fail(res, 400, r.error);
    if (!commit(res, { ...h, pilot: r.next })) return undefined;
    return res.json(view());
  });
  app.delete('/api/harness/pilot', (req, res) => { const h = cur(); if (!commit(res, { ...h, pilot: {} })) return undefined; return res.json(view()); });

  app.put('/api/harness/rows/:id', (req, res) => {
    const t = typeOf(req.params.id); if (!t) return fail(res, 404, 'Tipo de tarefa não encontrado.');
    const h = cur(), v = validatePatch(req.body, ROW_KEYS, { agents: h.agents, isPilot: false }); if (v.error) return fail(res, 400, v.error);
    const r = applyPatch(h.rows[t.id] ?? {}, v.patch, t, { pilot: false }); if (r.error) return fail(res, 400, r.error);
    const rows = { ...h.rows }; if (Object.keys(r.next).length) rows[t.id] = r.next; else delete rows[t.id];
    if (!commit(res, { ...h, rows })) return undefined;
    return res.json(view());
  });
  app.delete('/api/harness/rows/:id', (req, res) => {
    const t = typeOf(req.params.id); if (!t) return fail(res, 404, 'Tipo de tarefa não encontrado.');
    const h = cur(), rows = { ...h.rows }; delete rows[t.id];
    if (!commit(res, { ...h, rows })) return undefined;
    return res.json(view());
  });
  app.delete('/api/harness/rows', (req, res) => { const h = cur(); if (!commit(res, { ...h, rows: {} })) return undefined; return res.json(view()); });

  // agentes do usuário (nome + instrução)
  const agentBody = (b, partial) => {
    const bad = checkKeys(b, ['name', 'instruction']); if (bad) return { error: bad };
    const out = {};
    if (b.name !== undefined || !partial) { const n = typeof b.name === 'string' ? cleanLine(b.name, MAX_NAME + 1) : ''; if (!n || n.length > MAX_NAME) return { error: `Dê um nome ao agente (1 a ${MAX_NAME} caracteres).` }; out.name = n; }
    if (b.instruction !== undefined || !partial) { const i = typeof b.instruction === 'string' ? cleanLine(b.instruction, MAX_INSTRUCTION + 1) : ''; if (!i || i.length > MAX_INSTRUCTION) return { error: `A instrução precisa ter de 1 a ${MAX_INSTRUCTION} caracteres.` }; out.instruction = i; }
    if (partial && !Object.keys(out).length) return { error: 'Informe name e/ou instruction.' };
    return { value: out };
  };
  app.post('/api/harness/agents', (req, res) => {
    const h = cur(), v = agentBody(req.body, false); if (v.error) return fail(res, 400, v.error);
    if (h.agents.length >= MAX_AGENTS) return fail(res, 409, `Limite de ${MAX_AGENTS} agentes atingido: exclua um antes de criar outro.`);
    if (h.agents.some((a) => norm(a.name) === norm(v.value.name))) return fail(res, 409, 'Já existe um agente com esse nome.');
    let id; do { id = uid('agt'); } while (!AGENT_ID_RE.test(id) || h.agents.some((a) => a.id === id));
    const a = { id, ...v.value, createdAt: now(), updatedAt: now() };
    if (!commit(res, { ...h, agents: [...h.agents, a] })) return undefined;
    return res.status(201).json({ agent: a });
  });
  app.put('/api/harness/agents/:id', (req, res) => {
    if (!AGENT_ID_RE.test(req.params.id)) return fail(res, 404, 'Agente não encontrado.');
    const h = cur(), i = h.agents.findIndex((a) => a.id === req.params.id); if (i < 0) return fail(res, 404, 'Agente não encontrado.');
    const v = agentBody(req.body, true); if (v.error) return fail(res, 400, v.error);
    if (v.value.name !== undefined && h.agents.some((a) => a.id !== h.agents[i].id && norm(a.name) === norm(v.value.name))) return fail(res, 409, 'Já existe um agente com esse nome.');
    const a = { ...h.agents[i], ...v.value, updatedAt: now() };
    if (!commit(res, { ...h, agents: h.agents.map((x, k) => (k === i ? a : x)) })) return undefined;
    return res.json({ agent: a });
  });
  app.delete('/api/harness/agents/:id', (req, res) => {
    if (!AGENT_ID_RE.test(req.params.id)) return fail(res, 404, 'Agente não encontrado.');
    const h = cur(); if (!h.agents.some((a) => a.id === req.params.id)) return fail(res, 404, 'Agente não encontrado.');
    const id = req.params.id, strip = (o) => { if (o.agentId !== id) return o; const { agentId, ...rest } = o; return rest; }; // quem usava o agente volta ao padrão
    const rows = {}; for (const [k, o] of Object.entries(h.rows)) { const n = strip(o); if (Object.keys(n).length) rows[k] = n; }
    if (!commit(res, { pilot: strip(h.pilot), rows, agents: h.agents.filter((a) => a.id !== id) })) return undefined;
    return res.json({ removed: id });
  });

  // compartilhar: o código da configuração (copiar) e importar (colar)
  app.get('/api/harness/export', (req, res) => res.json({ code: exportCode(db) }));
  app.post('/api/harness/import', (req, res) => {
    const bad = checkKeys(req.body, ['code']); if (bad) return fail(res, 400, bad);
    const p = parseCode(req.body.code); if (p.error) return fail(res, 400, p.error);
    if (!commit(res, p.harness)) return undefined;
    return res.json(view());
  });
}
