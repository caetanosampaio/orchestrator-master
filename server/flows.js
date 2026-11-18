// Missions v2 (fatia 1): missões de PROJETO executadas em etapas por agentes de CLI em terminais reais (os mesmos PTY do Cockpit). Definição = flow (db.flows); execução = run (db.flowRuns).
// O ciclo antigo (cycle.js, plan.js, policy.js, delivery.js, planner.js, executor/) NÃO é usado aqui e db.missions não é tocado.
//
// O que o servidor decide (nada disto vem do corpo da requisição):
//   - ids (flow_/run_ gerados aqui; as etapas usam rótulos locais s1..s99, só para o dependsOn), o comando e o diretório dos terminais (sempre os de terminals.js, a partir do workspace cadastrado);
//   - provedor, papel, modelo e esforço só de listas fechadas; o DAG é validado (sem ciclo, sem dependência desconhecida); `fullAccess` só vale com o booleano `true` estrito;
//   - um run ativo por missão; o cancelamento fecha SÓ os terminais que este run criou (`ownedTerminalIds`); um run `running` que sobrou de um servidor anterior vira `failed` (nunca é retomado às cegas).
//
// Execução: um runner único (tick periódico, injetável) percorre os runs ativos. A etapa pronta (dependências `completed`, respeitando `maxParallel`) ganha um terminal (ou reaproveita o de `continueFrom`,
// se ainda vivo) e o texto é entregue pelo MESMO caminho do Maestro (`maestro.dispatch`: espera o agente ficar livre e nunca digita sobre um pedido de permissão). A etapa só é `completed` quando a tarefa do Maestro
// termina de verdade (report_done do agente ou relatório automático); `waiting` vem do estado real do agente (hooks/OSC), nunca é inventado.
//
// Persistência: saveOrThrow + rollback do estado parcial. Transições que dependem só do estado observado ou ANTES de um efeito colateral são desfeitas se o banco não gravar (o próximo tick refaz). Depois de um efeito
// que não se desfaz (terminal criado, tarefa entregue) o estado em memória segue a realidade e a gravação é tentada de novo na próxima mutação (store.save grava o banco inteiro).
import * as store from './store.js';
import { ROLES, MAX_SESSIONS } from './terminals.js';
import { isProvider, validateChoice } from './providers/index.js';
import { cleanLine, MAX_TASK_TEXT } from './maestro.js';

export const MAX_STEPS = 12, MAX_FLOWS = 50, MAX_RUNS = 200, MAX_PARALLEL = 4, MAX_TITLE = 120, MAX_GOAL = 2000, MAX_PROMPT = 2000, MAX_RUNS_LISTED = 20;
export const POLL_MS = 1000, DISPATCH_WAIT_MS = 30 * 60 * 1000, MIN_GOAL_CONTEXT = 60;
export const KINDS = Object.freeze(['project', 'automation']);
export const STEP_ROLES = Object.freeze(Object.keys(ROLES).filter((r) => r !== 'maestro')); // o Maestro não recebe tarefas (maestro.js): não é papel de etapa
const FLOW_ID_RE = /^flow_[0-9a-f]{8}$/, RUN_ID_RE = /^run_[0-9a-f]{8}$/, STEP_ID_RE = /^s[1-9][0-9]?$/;
const FAILED_TASK = new Set(['failed', 'expired', 'rejected']);
const ACTIVE_STEP = new Set(['running', 'waiting']);
const DEAD_DEP = new Set(['failed', 'skipped', 'cancelled']);
// "Confiar nesta pasta?" do Claude Code: o terminal de uma missão é aberto NA pasta do workspace que o usuário cadastrou e mandou trabalhar, então o FORGE responde "sim" sozinho (Enter na opção
// padrão, "Yes, I trust this folder"). Só vale para terminais criados por um run e só enquanto a etapa ainda não foi entregue; o texto precisa estar nas ÚLTIMAS linhas da tela (um aviso antigo
// que ficou no histórico não conta) e há poucas tentativas espaçadas (nunca vira laço de Enter).
const TRUST_TAIL = 900, TRUST_MAX_TRIES = 3, TRUST_RETRY_MS = 3000;
const TRUST_RE = /do you trust the files in this folder|trust (?:the files in )?this folder|is this a project you created or one you trust|yes, i trust/i;
const OTHER_DIALOG_RE = /bypass permissions|yes, i accept|mcp server|new mcp|\.mcp\.json/i; // "No, exit" NÃO entra: é a segunda opção da própria pergunta de confiança
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[@-Z\\-_=>]/g;
/** A pergunta de confiança de pasta está na tela AGORA? (olha só o fim da saída, sem ANSI e com espaços colapsados) */
export function trustPromptShown(raw) {
  const tail = String(raw ?? '').replace(ANSI_RE, ' ').replace(/\s+/g, ' ').slice(-TRUST_TAIL);
  return TRUST_RE.test(tail) && !OTHER_DIALOG_RE.test(tail); // se a tela cita outro diálogo (bypass, aceite, servidor MCP), a pergunta de confiança já passou: nunca se aperta Enter nele
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clip = (v, n) => { const s = String(v ?? ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const fail = (status, error) => ({ ok: false, status, error });
const okv = (status, body) => ({ ok: true, status, body });
const PERSIST_ERROR = 'o banco não pôde ser gravado; nada foi alterado.';

// ---------- validação ----------
const FLOW_CREATE_KEYS = ['workspaceId', 'title', 'goal', 'kind', 'fullAccess', 'maxParallel', 'schedule', 'steps'];
const FLOW_PATCH_KEYS = ['title', 'goal', 'fullAccess', 'maxParallel', 'archived', 'steps'];
const STEP_KEYS = ['id', 'title', 'prompt', 'provider', 'role', 'model', 'effort', 'dependsOn', 'continueFrom'];
const unknownKeys = (o, allowed) => Object.keys(o).filter((k) => !allowed.includes(k));

/** Texto de uma linha (título) ou de várias (objetivo, prompt): trim, tamanho e sem caracteres de controle. Devolve { value } ou { error }. */
function text(v, label, { max, required, multiline = false }) {
  if (v === undefined || v === null) return required ? { error: `${label} é obrigatório.` } : { value: '' };
  if (typeof v !== 'string') return { error: `${label} deve ser um texto.` };
  const t = v.trim();
  if (required && !t) return { error: `${label} é obrigatório.` };
  if (t.length > max) return { error: `${label} passa de ${max} caracteres.` };
  if ((multiline ? t.replace(/[\n\r\t]/g, ' ') : t).match(/[\p{Cc}\p{Zl}\p{Zp}]/u)) return { error: `${label} tem caracteres de controle.` };
  return { value: t };
}

/** Ancestrais (dependências transitivas) de cada etapa; `byId`: id -> etapa. Seguro mesmo com ciclo (conjunto de visitados). */
function ancestorsOf(id, byId) {
  const seen = new Set(), stack = [...(byId.get(id)?.dependsOn ?? [])];
  while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); stack.push(...(byId.get(x)?.dependsOn ?? [])); }
  return seen;
}
/** true se o grafo de dependências tem ciclo (algoritmo de Kahn). */
function hasCycle(steps) {
  const indeg = new Map(steps.map((s) => [s.id, s.dependsOn.length])), out = new Map(steps.map((s) => [s.id, []]));
  for (const s of steps) for (const d of s.dependsOn) out.get(d).push(s.id);
  const q = [...indeg].filter(([, n]) => n === 0).map(([id]) => id); let done = 0;
  while (q.length) { const id = q.pop(); done++; for (const n of out.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) q.push(n); } }
  return done !== steps.length;
}

/** Valida e normaliza as etapas. Devolve { steps } (ids, dependências e continueFrom conferidos) ou { error } em português. */
export function validateSteps(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STEPS) return { error: `steps deve ser uma lista de 1 a ${MAX_STEPS} etapas.` };
  const ids = [], used = new Set();
  for (const [i, s] of raw.entries()) {
    const at = `Etapa ${i + 1}`;
    if (!isObj(s)) return { error: `${at}: deve ser um objeto.` };
    const extra = unknownKeys(s, STEP_KEYS); if (extra.length) return { error: `${at}: propriedades não permitidas (${extra.join(', ').slice(0, 80)}).` };
    if (s.id !== undefined && s.id !== null) {
      if (typeof s.id !== 'string' || !STEP_ID_RE.test(s.id)) return { error: `${at}: id inválido (use s1 a s99).` };
      if (used.has(s.id)) return { error: `${at}: id repetido (${s.id}).` };
      used.add(s.id); ids.push(s.id);
    } else ids.push(null);
  }
  let n = 1; for (let i = 0; i < ids.length; i++) if (ids[i] === null) { while (used.has(`s${n}`)) n++; ids[i] = `s${n}`; used.add(ids[i]); }
  const steps = [];
  for (const [i, s] of raw.entries()) {
    const at = `Etapa ${i + 1}`;
    const title = text(s.title, `${at}: título`, { max: MAX_TITLE, required: true }); if (title.error) return title;
    const prompt = text(s.prompt, `${at}: prompt`, { max: MAX_PROMPT, required: true, multiline: true }); if (prompt.error) return prompt;
    if (!isProvider(s.provider)) return { error: `${at}: provider inválido.` };
    if (typeof s.role !== 'string' || !STEP_ROLES.includes(s.role)) return { error: `${at}: role inválido. Use um destes: ${STEP_ROLES.join(', ')}.` };
    const choice = validateChoice(s.provider, { model: s.model, effort: s.effort }); if (choice.error) return { error: `${at}: ${choice.error}` };
    if (s.dependsOn !== undefined && s.dependsOn !== null && (!Array.isArray(s.dependsOn) || s.dependsOn.length > MAX_STEPS - 1 || s.dependsOn.some((d) => typeof d !== 'string'))) return { error: `${at}: dependsOn deve ser uma lista de ids de etapa.` };
    const dependsOn = s.dependsOn ?? [];
    for (const d of dependsOn) { if (!used.has(d)) return { error: `${at}: depende de uma etapa que não existe (${String(d).slice(0, 20)}).` }; if (d === ids[i]) return { error: `${at}: não pode depender de si mesma.` }; }
    if (new Set(dependsOn).size !== dependsOn.length) return { error: `${at}: dependências repetidas.` };
    if (s.continueFrom !== undefined && s.continueFrom !== null && typeof s.continueFrom !== 'string') return { error: `${at}: continueFrom deve ser o id de uma etapa.` };
    steps.push({ id: ids[i], title: title.value, prompt: prompt.value, provider: s.provider, role: s.role, model: choice.value.model ?? null, effort: choice.value.effort ?? null, dependsOn: [...dependsOn], continueFrom: s.continueFrom ?? null });
  }
  if (hasCycle(steps)) return { error: 'As dependências formam um ciclo: o fluxo de etapas precisa terminar.' };
  const byId = new Map(steps.map((s) => [s.id, s])), targets = new Set();
  for (const [i, s] of steps.entries()) {
    if (s.continueFrom === null) continue;
    const at = `Etapa ${i + 1}`, from = byId.get(s.continueFrom);
    if (!from) return { error: `${at}: continueFrom aponta para uma etapa que não existe.` };
    if (!ancestorsOf(s.id, byId).has(from.id)) return { error: `${at}: continueFrom deve apontar para uma etapa anterior da cadeia de dependências.` };
    if (targets.has(from.id)) return { error: `${at}: outra etapa já continua a partir de ${from.id}; o terminal não pode ser dividido.` };
    targets.add(from.id);
    if (from.provider !== s.provider || from.role !== s.role || from.model !== s.model || from.effort !== s.effort) return { error: `${at}: para continuar o terminal de ${from.id}, o agente (provider, role, model, effort) precisa ser o mesmo.` };
  }
  return { steps };
}

/** Valida o corpo de criação (create) ou de edição (parcial). Devolve { value } (só os campos presentes na edição) ou { error }. */
export function validateFlowInput(body, { create }) {
  if (!isObj(body)) return { error: 'O corpo da requisição deve ser um objeto JSON.' };
  const extra = unknownKeys(body, create ? FLOW_CREATE_KEYS : FLOW_PATCH_KEYS); if (extra.length) return { error: `Propriedades não permitidas: ${extra.join(', ').slice(0, 80)}.` };
  const v = {};
  if (create || body.title !== undefined) { const t = text(body.title, 'title', { max: MAX_TITLE, required: true }); if (t.error) return t; v.title = t.value; }
  if (create || body.goal !== undefined) { const g = text(body.goal, 'goal', { max: MAX_GOAL, required: false, multiline: true }); if (g.error) return g; v.goal = g.value; }
  if (create || body.fullAccess !== undefined) { if (body.fullAccess !== undefined && typeof body.fullAccess !== 'boolean') return { error: 'fullAccess deve ser verdadeiro ou falso.' }; v.fullAccess = body.fullAccess === true; }
  if (create || body.maxParallel !== undefined) {
    const p = body.maxParallel ?? 1;
    if (!Number.isInteger(p) || p < 1 || p > MAX_PARALLEL) return { error: `maxParallel deve ser um inteiro de 1 a ${MAX_PARALLEL}.` };
    v.maxParallel = p;
  }
  if (create) {
    if (typeof body.workspaceId !== 'string' || !body.workspaceId || body.workspaceId.length > 80) return { error: 'workspaceId deve ser o identificador de um espaço de trabalho.' };
    v.workspaceId = body.workspaceId;
    const kind = body.kind ?? 'project'; if (!KINDS.includes(kind)) return { error: `kind deve ser um destes: ${KINDS.join(', ')}.` }; v.kind = kind;
    if (body.schedule !== undefined && body.schedule !== null) return { error: 'schedule ainda não é suportado (reservado para uma fatia futura).' };
  }
  if (!create && body.archived !== undefined) { if (typeof body.archived !== 'boolean') return { error: 'archived deve ser verdadeiro ou falso.' }; v.archived = body.archived; }
  if (create || body.steps !== undefined) { const s = validateSteps(body.steps); if (s.error) return s; v.steps = s.steps; }
  if (!create && !Object.keys(v).length) return { error: 'Nada para alterar: informe ao menos um campo.' };
  return { value: v };
}

/**
 * Texto entregue ao agente = contexto da missão + a etapa. Limite do Maestro: MAX_TASK_TEXT contando o contexto. REGRA (determinística): o prompt da etapa NUNCA é cortado. O contexto é reduzido em
 * degraus: (1) título + objetivo inteiro; (2) objetivo cortado com "…" (no mínimo MIN_GOAL_CONTEXT caracteres dele); (3) só o título da missão. Se nem assim cabe, a etapa é recusada com erro claro.
 * Quebras de linha viram espaço (o Maestro entrega UMA linha, ver maestro.js cleanLine). Devolve { ok: true, text } ou { ok: false, error }.
 */
export function composeStepText(flow, step) {
  const title = cleanLine(flow.title, MAX_TITLE), goal = cleanLine(flow.goal, MAX_GOAL), stitle = cleanLine(step.title, MAX_TITLE), prompt = cleanLine(step.prompt, MAX_PROMPT + 1);
  const head = (g) => `[Missão: ${title}${g ? ` | Objetivo: ${g}` : ''}] Etapa "${stitle}": `;
  const full = head(goal) + prompt;
  if (full.length <= MAX_TASK_TEXT) return { ok: true, text: full };
  const room = MAX_TASK_TEXT - head('').length - ' | Objetivo: '.length - prompt.length;
  if (goal && room >= MIN_GOAL_CONTEXT) return { ok: true, text: head(`${goal.slice(0, room - 1).trimEnd()}…`) + prompt };
  const bare = head('') + prompt;
  if (bare.length <= MAX_TASK_TEXT) return { ok: true, text: bare };
  return { ok: false, error: `O texto da etapa "${stitle}" (${prompt.length} caracteres) mais o contexto mínimo da missão passa do limite de ${MAX_TASK_TEXT} caracteres. Encurte o prompt da etapa.` };
}

// ---------- gerente ----------
/**
 * `terminals`: o gerente de terminais (create, get/peek, close, count, providers); `maestro`: dispatch e taskState (maestro.js). `persist` lança se o banco não gravar (padrão store.saveOrThrow).
 * `setTimer`/`clearTimer`/`now`/`uid`/`pollMs`/`dispatchWaitMs`/`maxSessions` são injetáveis para os testes (sem processos nem relógio reais).
 */
export function createFlows({ db, terminals, maestro, persist = store.saveOrThrow, now = store.now, uid = store.uid, setTimer = setInterval, clearTimer = clearInterval, pollMs = POLL_MS, dispatchWaitMs = DISPATCH_WAIT_MS, maxSessions = MAX_SESSIONS, onError = (e) => console.error('[flows]', e?.code || e?.message || e) } = {}) {
  // bancos antigos não têm as coleções; leitura tolerante: só ficam objetos com id no formato do servidor
  const clean = (list, re) => (Array.isArray(list) ? list.filter((x) => isObj(x) && typeof x.id === 'string' && re.test(x.id)) : []);
  db.flows = clean(db.flows, FLOW_ID_RE); db.flowRuns = clean(db.flowRuns, RUN_ID_RE);
  const flows = () => db.flows, runs = () => db.flowRuns;
  const flowById = (id) => (typeof id === 'string' && FLOW_ID_RE.test(id) ? flows().find((f) => f.id === id) ?? null : null);
  const runOf = (flowId, id) => (typeof id === 'string' && RUN_ID_RE.test(id) ? runs().find((r) => r.id === id && r.flowId === flowId) ?? null : null);
  const activeRunOf = (flowId) => runs().find((r) => r.flowId === flowId && r.status === 'running') ?? null;
  const ms = () => Date.parse(now()) || Date.now();
  const peekT = (id) => { try { return (terminals.peek ? terminals.peek(id) : terminals.get(id)) ?? null; } catch { return null; } };
  const trustTries = new Map(); // terminalId -> { n, at }: respostas já enviadas à pergunta de confiança
  /** Responde "sim" à pergunta de confiança de pasta de um terminal desta missão que ainda não recebeu a etapa. Melhor esforço: nunca lança. */
  function autoTrust(tid) {
    if (typeof terminals.readOutput !== 'function' || typeof terminals.write !== 'function') return;
    const tr = trustTries.get(tid) ?? { n: 0, at: 0, seen: null };
    if (tr.n >= TRUST_MAX_TRIES || (tr.n > 0 && ms() - tr.at < TRUST_RETRY_MS)) return;
    let out = ''; try { out = terminals.readOutput(tid, TRUST_TAIL * 2) ?? ''; } catch { return; }
    if (!trustPromptShown(out)) return;
    const tail = String(out).slice(-TRUST_TAIL);
    if (tr.n > 0 && tail !== tr.seen) return; // a tela mudou depois do Enter: a pergunta foi respondida e o que está aberto agora pode ser OUTRO diálogo (ex.: aceite do bypass, cuja opção padrão é sair)
    trustTries.set(tid, { n: tr.n + 1, at: ms(), seen: tail });
    try { terminals.write(tid, '\r'); } catch { /* o próximo tick tenta de novo (até o limite) */ }
  }
  const wsOf = (id) => (db.workspaces ?? []).find((w) => w && w.id === id) ?? null;

  const runView = (r) => { const { ownedTerminalIds, ...rest } = structuredClone(r); return rest; };
  const flowView = (f) => {
    const mine = runs().filter((r) => r.flowId === f.id), last = mine.at(-1) ?? null, active = mine.find((r) => r.status === 'running') ?? null, ws = wsOf(f.workspaceId);
    return { ...structuredClone(f), workspaceName: ws ? (ws.displayName || ws.name || null) : null, lastRun: last ? runView(last) : null, activeRun: active ? runView(active) : null };
  };

  /** Snapshot SUPERFICIAL do objeto e das etapas (as referências continuam as mesmas depois de desfazer); listas internas são sempre trocadas por cópias, nunca alteradas no lugar. */
  function apply(run, fn, { rollback = true } = {}) {
    const objs = [run, ...run.steps], snaps = objs.map((o) => ({ ...o }));
    fn();
    try { persist(); return true; } catch (e) {
      if (rollback) for (const [i, o] of objs.entries()) { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, snaps[i]); }
      else onError(e); // efeito já ocorrido: a memória segue a realidade e a próxima gravação leva tudo
      return false;
    }
  }

  // ---------- CRUD ----------
  const list = () => flows().map(flowView);
  function create(body) {
    const v = validateFlowInput(body, { create: true }); if (v.error) return fail(400, v.error);
    if (!wsOf(v.value.workspaceId)) return fail(400, 'Espaço de trabalho não encontrado.');
    if (flows().length >= MAX_FLOWS) return fail(409, `Limite de ${MAX_FLOWS} missões atingido; remova alguma antes de criar outra.`);
    const t = now(), f = { id: uid('flow'), workspaceId: v.value.workspaceId, title: v.value.title, goal: v.value.goal, kind: v.value.kind, fullAccess: v.value.fullAccess, maxParallel: v.value.maxParallel, schedule: null, steps: v.value.steps, createdAt: t, updatedAt: t, archived: false };
    flows().push(f);
    try { persist(); } catch { flows().pop(); return fail(500, `Não foi possível criar a missão: ${PERSIST_ERROR}`); }
    return okv(201, flowView(f));
  }
  function update(id, body) {
    const f = flowById(id); if (!f) return fail(404, 'Missão não encontrada.');
    if (activeRunOf(f.id)) return fail(409, 'Há uma execução em andamento nesta missão: cancele-a ou espere terminar.');
    const v = validateFlowInput(body, { create: false }); if (v.error) return fail(400, v.error);
    const i = flows().indexOf(f), next = { ...f, ...v.value, updatedAt: now() };
    flows()[i] = next;
    try { persist(); } catch { flows()[i] = f; return fail(500, `Não foi possível alterar a missão: ${PERSIST_ERROR}`); }
    return okv(200, flowView(next));
  }
  function remove(id) {
    const f = flowById(id); if (!f) return fail(404, 'Missão não encontrada.');
    if (activeRunOf(f.id)) return fail(409, 'Há uma execução em andamento nesta missão: cancele-a ou espere terminar.');
    const prevFlows = db.flows, prevRuns = db.flowRuns;
    db.flows = prevFlows.filter((x) => x !== f); db.flowRuns = prevRuns.filter((r) => r.flowId !== f.id);
    try { persist(); } catch { db.flows = prevFlows; db.flowRuns = prevRuns; return fail(500, `Não foi possível remover a missão: ${PERSIST_ERROR}`); }
    return okv(204, null);
  }
  function get(id) { const f = flowById(id); return f ? okv(200, flowView(f)) : fail(404, 'Missão não encontrada.'); }

  // ---------- runs ----------
  function startRun(flowId) {
    const f = flowById(flowId); if (!f) return fail(404, 'Missão não encontrada.');
    if (f.archived) return fail(409, 'Esta missão está arquivada: desarquive-a antes de executar.');
    if (activeRunOf(f.id)) return fail(409, 'Já há uma execução em andamento nesta missão.');
    if (!wsOf(f.workspaceId)) return fail(409, 'O espaço de trabalho desta missão não existe mais.');
    for (const s of f.steps) { const c = composeStepText(f, s); if (!c.ok) return fail(400, c.error); }
    let provs = []; try { provs = terminals.providers?.() ?? []; } catch { provs = []; }
    for (const id of new Set(f.steps.map((s) => s.provider))) { const p = provs.find((x) => x.id === id); if (p && p.available === false) return fail(409, `${p.label ?? id} não está disponível neste computador (não foi encontrado no PATH).`); }
    let count = 0; try { count = terminals.count(); } catch { count = 0; }
    if (count >= maxSessions) return fail(409, `Sem terminais disponíveis: o limite de ${maxSessions} terminais simultâneos foi atingido. Feche algum e tente de novo.`);
    const run = { id: uid('run'), flowId: f.id, status: 'running', startedAt: now(), finishedAt: null, trigger: 'manual', error: null, ownedTerminalIds: [], steps: f.steps.map((s) => ({ stepId: s.id, title: s.title, status: 'pending', terminalId: null, taskId: null, startedAt: null, finishedAt: null, summary: null, error: null })) };
    const prev = db.flowRuns;
    let next = [...prev, run];
    while (next.length > MAX_RUNS) { const i = next.findIndex((r) => r.status !== 'running'); if (i < 0) break; next.splice(i, 1); } // os mais antigos JÁ finalizados saem
    db.flowRuns = next;
    try { persist(); } catch { db.flowRuns = prev; return fail(500, `Não foi possível iniciar a execução: ${PERSIST_ERROR}`); }
    ensureTimer(); void tick();
    return okv(201, runView(run));
  }
  function listRuns(flowId) {
    const f = flowById(flowId); if (!f) return fail(404, 'Missão não encontrada.');
    return okv(200, runs().filter((r) => r.flowId === f.id).slice(-MAX_RUNS_LISTED).reverse().map(runView));
  }
  function getRun(flowId, runId) {
    const f = flowById(flowId); if (!f) return fail(404, 'Missão não encontrada.');
    const r = runOf(f.id, runId); return r ? okv(200, runView(r)) : fail(404, 'Execução não encontrada.');
  }
  function cancelRun(flowId, runId) {
    const f = flowById(flowId); if (!f) return fail(404, 'Missão não encontrada.');
    const run = runOf(f.id, runId); if (!run) return fail(404, 'Execução não encontrada.');
    if (run.status !== 'running') return fail(409, `A execução já terminou (${run.status}).`);
    const owned = [...(run.ownedTerminalIds ?? [])];
    const ok = apply(run, () => {
      const t = now(); run.status = 'cancelled'; run.finishedAt = t; run.error = 'Cancelada pelo usuário.';
      for (const rs of run.steps) { if (rs.status === 'pending') rs.status = 'cancelled'; else if (ACTIVE_STEP.has(rs.status)) { rs.status = 'cancelled'; rs.finishedAt = t; } }
    });
    if (!ok) return fail(500, `Não foi possível cancelar a execução: ${PERSIST_ERROR}`);
    for (const id of owned) closeTerminal(id); // só os criados por este run; os que o usuário abriu nunca entram aqui
    return okv(200, runView(run));
  }
  function closeTerminal(id) { try { if (peekT(id)?.status === 'running') terminals.close(id); } catch { /* já encerrado */ } }

  // ---------- runner ----------
  const failStep = (run, rs, error) => apply(run, () => { rs.status = 'failed'; rs.finishedAt = now(); rs.error = clip(error, 500) || 'A etapa falhou.'; });
  const stepDef = (flow, id) => flow.steps.find((s) => s.id === id);

  /** Entrega a etapa ao terminal pelo Maestro. Ocupado/aguardando permissão = tenta de novo no próximo tick, até dispatchWaitMs desde o início da etapa. */
  function tryDispatch(run, rs, flow) {
    const step = stepDef(flow, rs.stepId);
    const c = composeStepText(flow, step); if (!c.ok) return failStep(run, rs, c.error);
    const r = maestro.dispatch({ to: rs.terminalId, text: c.text, from: null, source: 'flow' });
    if (r.ok) return apply(run, () => { rs.taskId = r.taskId; }, { rollback: false });
    if (!r.transient) return failStep(run, rs, `Não foi possível entregar a etapa ao agente: ${r.error}`);
    if (ms() - Date.parse(rs.startedAt) > dispatchWaitMs) return failStep(run, rs, `O agente não ficou livre para receber a etapa em ${Math.round(dispatchWaitMs / 60000)} minutos (${r.error})`);
    return true;
  }

  /** Observa uma etapa em andamento: conclui, falha ou atualiza running/waiting a partir do estado REAL (tarefa do Maestro e terminal). */
  function observe(run, rs, flow) {
    if (!rs.terminalId) return failStep(run, rs, 'A etapa ficou sem terminal (estado inconsistente).');
    if (rs.taskId) {
      const ts = maestro.taskState(rs.taskId);
      if (!ts) return failStep(run, rs, 'A tarefa desta etapa não foi encontrada no Maestro.');
      if (ts.status === 'done') return apply(run, () => { rs.status = 'completed'; rs.finishedAt = now(); rs.summary = clip(ts.summary || 'Concluída sem resumo.', 2000); rs.error = null; });
      if (FAILED_TASK.has(ts.status)) return failStep(run, rs, ts.note || 'A tarefa do agente falhou.');
    }
    const t = peekT(rs.terminalId);
    if (!t || t.status !== 'running') return failStep(run, rs, rs.taskId ? 'O terminal terminou antes do fim da etapa.' : 'O terminal terminou antes de receber a etapa.');
    if (rs.taskId) trustTries.delete(rs.terminalId);
    if (!rs.taskId) { autoTrust(rs.terminalId); tryDispatch(run, rs, flow); if (!ACTIVE_STEP.has(rs.status)) return false; } // sem gravar a falha (rollback) o estado volta e o próximo tick repete
    const want = t.agent?.state === 'waiting' ? 'waiting' : 'running'; // sinal real do agente (hooks/OSC); sem ele fica 'running'
    return rs.status === want ? true : apply(run, () => { rs.status = want; });
  }

  async function startStep(run, rs, flow) {
    const step = stepDef(flow, rs.stepId);
    if (!apply(run, () => { rs.status = 'running'; rs.startedAt = now(); })) return; // antes de qualquer efeito: se não gravou, desfaz e o próximo tick tenta de novo
    let tid = null;
    if (step.continueFrom) { const prev = run.steps.find((x) => x.stepId === step.continueFrom); if (prev?.terminalId && peekT(prev.terminalId)?.status === 'running') tid = prev.terminalId; } // terminal da etapa anterior ainda vivo; senão abre um novo
    if (!tid) {
      let r;
      try { r = await terminals.create({ workspaceId: flow.workspaceId, role: step.role, provider: step.provider, model: step.model, effort: step.effort, title: step.title, fullAccess: flow.fullAccess === true }); }
      catch (e) { r = { ok: false, error: String(e?.message ?? e).slice(0, 160) }; }
      if (run.status !== 'running') { if (r?.ok) closeTerminal(r.session.id); return; } // cancelado durante a criação: o terminal nasceu tarde, é deste run e fecha
      if (!r?.ok) { failStep(run, rs, `Não foi possível abrir o terminal: ${r?.error ?? 'erro desconhecido'}`); return; }
      tid = r.session.id;
      apply(run, () => { run.ownedTerminalIds = [...(run.ownedTerminalIds ?? []), tid]; rs.terminalId = tid; }, { rollback: false });
    } else apply(run, () => { rs.terminalId = tid; }, { rollback: false });
    tryDispatch(run, rs, flow); // um terminal recém-aberto quase nunca está pronto: o dispatch costuma esperar o próximo tick
  }

  async function advance(run) {
    const flow = flowById(run.flowId);
    if (!flow) { apply(run, () => { run.status = 'failed'; run.finishedAt = now(); run.error = 'A missão não existe mais.'; for (const rs of run.steps) if (!['completed', 'failed', 'skipped', 'cancelled'].includes(rs.status)) { rs.status = 'cancelled'; rs.finishedAt = now(); } }, { rollback: false }); return; }
    for (const rs of run.steps) if (run.status === 'running' && ACTIVE_STEP.has(rs.status)) observe(run, rs, flow);
    if (run.status !== 'running') return;
    // dependente de falha (ou de quem foi pulado) é pulado; repete até estabilizar
    const dead = run.steps.filter((rs) => rs.status === 'pending' && stepDef(flow, rs.stepId).dependsOn.some((d) => DEAD_DEP.has(run.steps.find((x) => x.stepId === d)?.status)));
    if (dead.length) {
      const skipAll = () => { let changed = true; while (changed) { changed = false; for (const rs of run.steps) { if (rs.status !== 'pending') continue; const bad = stepDef(flow, rs.stepId).dependsOn.find((d) => DEAD_DEP.has(run.steps.find((x) => x.stepId === d)?.status)); if (bad) { rs.status = 'skipped'; rs.finishedAt = now(); rs.error = `Pulada: a etapa ${bad} não foi concluída.`; changed = true; } } } };
      apply(run, skipAll);
    }
    const busy = () => run.steps.filter((rs) => ACTIVE_STEP.has(rs.status)).length;
    for (const rs of run.steps) {
      if (run.status !== 'running') return;
      if (rs.status !== 'pending' || busy() >= flow.maxParallel) continue;
      if (!stepDef(flow, rs.stepId).dependsOn.every((d) => run.steps.find((x) => x.stepId === d)?.status === 'completed')) continue;
      await startStep(run, rs, flow);
    }
    if (run.status !== 'running') return;
    if (!run.steps.some((rs) => rs.status === 'pending' || ACTIVE_STEP.has(rs.status))) {
      const allOk = run.steps.every((rs) => rs.status === 'completed'), bad = run.steps.find((rs) => rs.status === 'failed');
      apply(run, () => { run.status = allOk ? 'completed' : 'failed'; run.finishedAt = now(); run.error = allOk ? null : clip(bad ? `A etapa "${bad.title}" falhou: ${bad.error}` : 'Uma ou mais etapas não foram concluídas.', 500); });
    }
  }

  let running = false, again = false, currentTick = Promise.resolve(), timer = null;
  async function loop() {
    running = true;
    try {
      do {
        again = false;
        for (const run of runs().filter((r) => r.status === 'running')) {
          try { await advance(run); } catch (e) { onError(e); if (run.status === 'running') apply(run, () => { run.status = 'failed'; run.finishedAt = now(); run.error = 'Erro interno ao executar a missão.'; for (const rs of run.steps) if (ACTIVE_STEP.has(rs.status) || rs.status === 'pending') { rs.status = 'failed'; rs.finishedAt = now(); rs.error = 'Erro interno.'; } }, { rollback: false }); }
        }
      } while (again);
    } finally { running = false; if (!runs().some((r) => r.status === 'running')) stopTimer(); }
  }
  /** Um passo do runner (também chamado pelo temporizador). Chamadas durante um passo em curso pedem mais um passo e devolvem o mesmo processamento. */
  function tick() { if (running) { again = true; return currentTick; } currentTick = loop(); return currentTick; }
  function ensureTimer() { if (timer || !(pollMs > 0)) return; timer = setTimer(() => { void tick(); }, pollMs); try { timer?.unref?.(); } catch { /* fake dos testes */ } }
  function stopTimer() { if (!timer) return; try { clearTimer(timer); } catch { /* já limpo */ } timer = null; }

  /**
   * Boot: run `running` que sobrou de um servidor anterior não é retomado às cegas (os terminais morreram com ele, ou o boot os reclama): vira `failed` com motivo. Se o banco não gravar,
   * a conversão fica em memória e a próxima gravação a leva (o boot não pode quebrar por isso).
   */
  function recover() {
    let n = 0;
    for (const run of runs()) {
      if (run.status !== 'running') continue;
      n++;
      const t = now();
      for (const rs of run.steps) { if (ACTIVE_STEP.has(rs.status)) { rs.status = 'failed'; rs.finishedAt = t; rs.error = 'Servidor reiniciado durante a etapa.'; } else if (rs.status === 'pending') { rs.status = 'skipped'; rs.finishedAt = t; rs.error = 'Não executada: servidor reiniciado.'; } }
      run.status = 'failed'; run.finishedAt = t; run.error = 'Servidor reiniciado: a execução foi interrompida e não é retomada automaticamente.'; run.ownedTerminalIds = [];
    }
    if (n) { try { persist(); } catch (e) { onError(e); } }
    return n;
  }

  return { list, get, create, update, remove, startRun, listRuns, getRun, cancelRun, tick, recover, stop: stopTimer };
}

// ---------- rotas ----------
/** Monta o gerente e as rotas /api/flows (a checagem de Host/Origin é a do apiGuard, aplicado a /api pelo index.js). Devolve o gerente (recover já executado). */
export function setupFlows(app, deps) {
  const flows = createFlows(deps);
  flows.recover();
  const send = (res, r) => { if (!r.ok) return res.status(r.status).json({ error: r.error }); return r.status === 204 ? res.status(204).end() : res.status(r.status).json(r.body); };
  app.get('/api/flows', (req, res) => res.json(flows.list()));
  app.post('/api/flows', (req, res) => send(res, flows.create(req.body)));
  app.get('/api/flows/:id', (req, res) => send(res, flows.get(req.params.id)));
  app.patch('/api/flows/:id', (req, res) => send(res, flows.update(req.params.id, req.body)));
  app.delete('/api/flows/:id', (req, res) => send(res, flows.remove(req.params.id)));
  app.post('/api/flows/:id/runs', (req, res) => send(res, flows.startRun(req.params.id)));
  app.get('/api/flows/:id/runs', (req, res) => send(res, flows.listRuns(req.params.id)));
  app.get('/api/flows/:id/runs/:runId', (req, res) => send(res, flows.getRun(req.params.id, req.params.runId)));
  app.post('/api/flows/:id/runs/:runId/cancel', (req, res) => send(res, flows.cancelRun(req.params.id, req.params.runId)));
  return flows;
}
