// Modelo de VISÃO das missões v2 (flows). PURO (sem React, sem rede): só organiza e rotula o que /api/flows devolve (contrato em docs/missions-v2-spec.md).
// Nada é simulado: dado ausente vira "não informado" (ou "—" onde cabe um traço). O estado de cada etapa vem do run real; sem run, a etapa está "na fila" e a lista mostra "—/m".
// Testado em server/test/flows-view.test.mjs.

export const NOT_INFORMED = 'não informado';
export const DASH = '—';
export const MAX_STEPS = 12, MAX_TITLE = 120, MAX_TEXT = 2000;

const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// ---------- rótulos ----------
/** Estado de uma etapa do run. `tone` escolhe a cor (idle, work, wait, ok, err, skip, cancel). `waiting` é o destaque "aguardando você". */
export const STEP_STATE_META = Object.freeze({
  pending: { label: 'na fila', tone: 'idle' },
  running: { label: 'trabalhando', tone: 'work' },
  waiting: { label: 'aguardando você', tone: 'wait' },
  completed: { label: 'concluída', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' },
  skipped: { label: 'pulada', tone: 'skip' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
});
export const RUN_STATE_META = Object.freeze({
  running: { label: 'em execução', tone: 'work' },
  completed: { label: 'concluída', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
});
/** Estado da MISSÃO na lista (derivado do run ativo ou do último). Ordem = prioridade de exibição (quem pede você vem antes). */
export const FLOW_STATES = Object.freeze(['waiting', 'running', 'failed', 'idle', 'completed', 'cancelled']);
export const FLOW_STATE_META = Object.freeze({
  waiting: { label: 'aguardando você', tone: 'wait' },
  running: { label: 'em execução', tone: 'work' },
  failed: { label: 'falhou', tone: 'err' },
  idle: { label: 'sem execução', tone: 'idle' },
  completed: { label: 'concluída', tone: 'ok' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
});
export const KIND_LABEL = Object.freeze({ project: 'projeto', automation: 'automação' });
export const PROVIDER_LABEL = Object.freeze({ claude: 'Claude Code', codex: 'Codex CLI' });
export const PROVIDERS = Object.freeze(['claude', 'codex']);
/** Reserva para quando /api/terminals ainda não respondeu: os papéis do servidor (terminals.js). O que vale é a lista real recebida em `roles`. */
export const FALLBACK_ROLES = Object.freeze([
  { id: 'builder', label: 'Construtor' }, { id: 'reviewer', label: 'Revisor' }, { id: 'scout', label: 'Batedor' }, { id: 'maestro', label: 'Maestro' },
]);

export const providerLabel = (id) => PROVIDER_LABEL[id] ?? (id ? String(id) : NOT_INFORMED);
export function roleLabel(id, roles = FALLBACK_ROLES) {
  if (!id) return NOT_INFORMED;
  return arr(roles).find((r) => r?.id === id)?.label ?? FALLBACK_ROLES.find((r) => r.id === id)?.label ?? String(id);
}
export const stepMeta = (state) => STEP_STATE_META[state] ?? { label: state ? String(state) : NOT_INFORMED, tone: 'idle' };

// ---------- tempo ----------
export function fmtDuration(ms) {
  if (!isNum(ms)) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min`;
}
/** Data curta no fuso do usuário ("16/11 14:05"); ausente ou inválida = "não informado". */
export function fmtWhen(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return NOT_INFORMED;
  return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
/** Duração em ms entre início e fim; sem fim, só corre (até `now`) enquanto `live`. Sem início = null. */
export function spanMs(startedAt, finishedAt, live, now = Date.now()) {
  const a = Date.parse(startedAt ?? ''), b = Date.parse(finishedAt ?? '');
  if (!Number.isFinite(a)) return null;
  const stop = Number.isFinite(b) ? b : live ? now : null;
  return stop === null ? null : Math.max(0, stop - a);
}
export const runDuration = (run, now) => (run ? spanMs(run.startedAt, run.finishedAt, run.status === 'running', now) : null);

// ---------- run, estado e progresso ----------
/** O run que a tela mostra: o ativo, senão o último. */
export const currentRun = (flow) => flow?.activeRun ?? flow?.lastRun ?? null;
export const runSteps = (run) => arr(run?.steps);
const runStep = (run, id) => runSteps(run).find((s) => s?.stepId === id) ?? null;

/** Estado da missão: `waiting` só enquanto o run está ativo e alguma etapa espera você (sinal real do servidor). Sem run = idle. */
export function flowState(flow) {
  const run = currentRun(flow);
  if (!run) return 'idle';
  if (run.status === 'running') return runSteps(run).some((s) => s?.status === 'waiting') ? 'waiting' : 'running';
  return FLOW_STATE_META[run.status] ? run.status : 'idle';
}

/**
 * Resumo para o indicador de Missões na barra lateral (visível em qualquer página). `state`: waiting (alguma etapa espera você) > working (run ativo) > failed / done
 * (run que terminou depois de `seenAt`, ou seja, enquanto você olhava outra página; some ao abrir Missões) > null (nada a mostrar). Só estado real de /api/flows.
 */
export function flowsActivity(flows, { seenAt = 0 } = {}) {
  const c = { working: 0, waiting: 0, failed: 0, done: 0 };
  for (const f of arr(flows)) {
    if (!f || f.archived) continue;
    const st = flowState(f);
    if (st === 'running') c.working++;
    else if (st === 'waiting') c.waiting++;
    else if ((st === 'failed' || st === 'completed') && ts(currentRun(f)?.finishedAt) > seenAt) c[st === 'failed' ? 'failed' : 'done']++;
  }
  const state = c.waiting ? 'waiting' : c.working ? 'working' : c.failed ? 'failed' : c.done ? 'done' : null;
  const n = (k, one, many) => (c[k] ? [`${c[k]} ${c[k] === 1 ? one : many}`] : []);
  const parts = [...n('waiting', 'missão aguardando você', 'missões aguardando você'), ...n('working', 'missão em execução', 'missões em execução'), ...n('failed', 'missão falhou', 'missões falharam'), ...n('done', 'missão concluída', 'missões concluídas')];
  return { state, count: c.waiting || c.working || c.failed || c.done, ...c, title: parts.join(' · ') };
}

/** { done, total, pct, label, hasRun }. `total` = etapas da definição; `done` = etapas `completed` do run. Sem run: done/pct nulos e label "—/m". */
export function flowProgress(flow, run = currentRun(flow)) {
  const total = arr(flow?.steps).length || runSteps(run).length;
  if (!total) return { done: null, total: 0, pct: null, label: NOT_INFORMED, hasRun: !!run };
  if (!run) return { done: null, total, pct: null, label: `${DASH}/${total}`, hasRun: false };
  const done = runSteps(run).filter((s) => s?.status === 'completed').length;
  return { done, total, pct: Math.round((done / total) * 100), label: `${done}/${total}`, hasRun: true };
}

/** Etapas esperando o usuário no run ativo (para o aviso no topo e o atalho de abrir o terminal). */
export function waitingSteps(flow) {
  const run = flow?.activeRun ?? null;
  if (!run || run.status !== 'running') return [];
  const defs = new Map(arr(flow.steps).map((s) => [s.id, s]));
  return runSteps(run).filter((s) => s?.status === 'waiting').map((s) => ({ stepId: s.stepId, title: defs.get(s.stepId)?.title ?? s.stepId, terminalId: s.terminalId ?? null, startedAt: s.startedAt ?? null }));
}

// ---------- lista ----------
const ts = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : 0; };
const wsNameOf = (flow, workspaces) => str(flow?.workspaceName).trim() || arr(workspaces).find((w) => w?.id === flow?.workspaceId)?.displayName || arr(workspaces).find((w) => w?.id === flow?.workspaceId)?.name || null;

/** Linhas da lista já ordenadas (quem pede você primeiro, depois recência). Arquivadas ficam de fora. */
export function flowRows(flows, { workspaces = [], query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return arr(flows).filter((f) => f?.id && !f.archived).map((flow) => {
    const state = flowState(flow);
    return { flow, id: flow.id, state, meta: FLOW_STATE_META[state], progress: flowProgress(flow), workspace: wsNameOf(flow, workspaces), kind: KIND_LABEL[flow.kind] ?? NOT_INFORMED };
  }).filter((r) => !q || `${r.flow.title ?? ''} ${r.workspace ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => FLOW_STATES.indexOf(a.state) - FLOW_STATES.indexOf(b.state) || ts(b.flow.updatedAt ?? b.flow.createdAt) - ts(a.flow.updatedAt ?? a.flow.createdAt));
}
/** Lista agrupada por workspace (grupos por nome; dentro, a ordem de `flowRows`). */
export function groupFlows(flows, opts = {}) {
  const groups = new Map();
  for (const r of flowRows(flows, opts)) {
    const key = r.flow.workspaceId ?? '';
    if (!groups.has(key)) groups.set(key, { key, name: r.workspace ?? 'sem workspace', items: [] });
    groups.get(key).items.push(r);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
/** Missão a abrir quando nada está selecionado: a primeira da ordem de prioridade (aguardando você > em execução > ...). */
export const pickFlowId = (flows, opts) => flowRows(flows, opts)[0]?.id ?? null;

// ---------- workflow ----------
function depths(steps) {
  const by = new Map(steps.map((s) => [s.id, s])), memo = new Map(), busy = new Set();
  const depth = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (busy.has(id)) return 0; // ciclo (o servidor recusa; aqui só não trava)
    busy.add(id);
    const ds = arr(by.get(id)?.dependsOn).filter((d) => by.has(d) && d !== id);
    const v = ds.length ? 1 + Math.max(...ds.map(depth)) : 0;
    busy.delete(id); memo.set(id, v);
    return v;
  };
  return new Map(steps.map((s) => [s.id, depth(s.id)]));
}
const firstLine = (t) => clip(String(t ?? '').split('\n').find((l) => l.trim()) ?? '', 90);

function nodeLine(def, st) {
  switch (st.state) {
    case 'running': return { line: firstLine(def.prompt) || null, lineKind: 'task' };
    case 'waiting': return { line: 'o agente espera a sua resposta no terminal', lineKind: 'wait' };
    case 'completed': return st.summary ? { line: clip(st.summary, 110), lineKind: 'summary' } : { line: 'sem resumo informado', lineKind: 'note' };
    case 'failed': return { line: clip(st.error, 110) || 'falhou sem motivo informado', lineKind: 'error' };
    case 'skipped': return { line: 'pulada: uma etapa da qual depende falhou', lineKind: 'note' };
    case 'cancelled': return { line: 'cancelada junto com a missão', lineKind: 'note' };
    default: return { line: null, lineKind: null };
  }
}

/**
 * Nós e arestas do workflow. Coluna = profundidade na cadeia de dependências (ramos paralelos ficam na mesma coluna); linha = ordem da definição.
 * O último nó é a ENTREGA, ligada às etapas finais (as que ninguém espera). Estado de cada nó = o do run (sem run, tudo `pending`).
 */
export function buildWorkflow(flow, run = currentRun(flow), { roles = FALLBACK_ROLES } = {}) {
  const steps = arr(flow?.steps).filter((s) => s?.id);
  if (!steps.length) return { nodes: [], edges: [], columns: [], hasRun: !!run };
  const depth = depths(steps), ids = new Set(steps.map((s) => s.id)), rowIn = new Map();
  const nodes = steps.map((def) => {
    const col = depth.get(def.id) ?? 0, row = rowIn.get(col) ?? 0; rowIn.set(col, row + 1);
    const rs = runStep(run, def.id), state = rs?.status && STEP_STATE_META[rs.status] ? rs.status : 'pending', meta = STEP_STATE_META[state];
    const st = { state, summary: rs?.summary, error: rs?.error };
    return {
      id: def.id, kind: 'step', col, row, title: str(def.title) || def.id, state, stateLabel: meta.label, tone: meta.tone, waiting: state === 'waiting',
      agent: { provider: def.provider ?? null, providerLabel: providerLabel(def.provider), role: def.role ?? null, roleLabel: roleLabel(def.role, roles), model: def.model || null, effort: def.effort || null },
      terminalId: rs?.terminalId ?? null, ...nodeLine(def, st),
    };
  });
  const stateOf = new Map(nodes.map((n) => [n.id, n.state]));
  const edges = [];
  for (const def of steps) {
    for (const from of arr(def.dependsOn).filter((d) => ids.has(d) && d !== def.id)) {
      const a = stateOf.get(from), b = stateOf.get(def.id);
      const state = b === 'running' ? 'active' : b === 'waiting' ? 'wait' : a === 'completed' ? 'done' : a === 'failed' ? 'err' : 'idle';
      edges.push({ id: `${from}->${def.id}`, from, to: def.id, state, reuse: def.continueFrom === from });
    }
  }
  const needed = new Set(steps.flatMap((s) => arr(s.dependsOn)));
  const leaves = nodes.filter((n) => !needed.has(n.id));
  const rstatus = run?.status, dState = !run ? 'pending' : rstatus === 'completed' ? 'completed' : rstatus === 'failed' ? 'failed' : rstatus === 'cancelled' ? 'cancelled' : 'pending';
  const dMeta = STEP_STATE_META[dState];
  const dLine = dState === 'completed' ? 'todas as etapas concluídas' : dState === 'failed' ? 'o run terminou com falha' : dState === 'cancelled' ? 'o run foi cancelado' : null;
  nodes.push({ id: 'delivery', kind: 'delivery', col: Math.max(...nodes.map((n) => n.col)) + 1, row: 0, title: 'Entrega', state: dState, stateLabel: dMeta.label, tone: dMeta.tone, waiting: false, agent: null, terminalId: null, line: dLine, lineKind: dLine ? 'note' : null });
  for (const l of leaves) edges.push({ id: `${l.id}->delivery`, from: l.id, to: 'delivery', state: l.state === 'completed' ? 'done' : l.state === 'failed' ? 'err' : 'idle', reuse: false });
  return { nodes, edges, columns: workflowColumns(nodes), hasRun: !!run };
}

/**
 * Conector do workflow de CIMA PARA BAIXO: sai do centro da base do nó de origem (x1, y1), desce até a linha `my` (o corredor entre as fases), anda na horizontal
 * e desce até o topo do nó de destino (x2, y2). Cantos arredondados de raio até `r`; no mesmo eixo vira uma reta vertical.
 */
export function edgePathDown(x1, y1, x2, y2, my, r = 6) {
  const dx = x2 - x1;
  if (Math.abs(dx) < 1) return `M ${x1} ${y1} V ${y2}`;
  const k = Math.min(r, Math.abs(dx) / 2, Math.max(0, (my - y1) / 2), Math.max(0, (y2 - my))), s = Math.sign(dx);
  return `M ${x1} ${y1} V ${my - k} Q ${x1} ${my} ${x1 + s * k} ${my} H ${x2 - s * k} Q ${x2} ${my} ${x2} ${my + k} V ${y2}`;
}

/** Colunas (fases) para desenhar: cada uma com seus nós, quantas etapas paralelas há e quantas trabalham/esperam agora. */
export function workflowColumns(nodes) {
  const by = new Map();
  for (const n of arr(nodes)) { const l = by.get(n.col) ?? []; l.push(n); by.set(n.col, l); }
  let phase = 0;
  return [...by.keys()].sort((a, b) => a - b).map((col, i) => {
    const list = by.get(col).slice().sort((a, b) => a.row - b.row), steps = list.filter((n) => n.kind === 'step');
    return { col, index: i + 1, label: steps.length ? `Fase ${++phase}` : 'Entrega', list, parallel: steps.length, live: steps.filter((n) => n.state === 'running' || n.state === 'waiting').length };
  });
}

// ---------- detalhe do nó (painel lateral) ----------
export function nodeDetail(flow, run, nodeId, { now = Date.now(), roles = FALLBACK_ROLES } = {}) {
  const steps = arr(flow?.steps);
  if (nodeId === 'delivery') {
    if (!steps.length) return null;
    const rs = runSteps(run), count = (s) => rs.filter((x) => x?.status === s).length;
    const wf = buildWorkflow(flow, run, { roles }), n = wf.nodes.find((x) => x.id === 'delivery');
    const defs = new Map(steps.map((s) => [s.id, s]));
    return {
      kind: 'delivery', id: 'delivery', title: 'Entrega', state: n.state, stateLabel: n.stateLabel, tone: n.tone, hasRun: !!run,
      counts: { total: steps.length, completed: count('completed'), failed: count('failed'), skipped: count('skipped'), cancelled: count('cancelled') },
      failures: rs.filter((x) => x?.status === 'failed').map((x) => ({ id: x.stepId, title: defs.get(x.stepId)?.title ?? x.stepId, error: x.error ?? null })),
      startedAt: run?.startedAt ?? null, finishedAt: run?.finishedAt ?? null, durationMs: runDuration(run, now), runStatus: run?.status ?? null,
    };
  }
  const def = steps.find((s) => s.id === nodeId);
  if (!def) return null;
  const rs = runStep(run, nodeId), state = rs?.status && STEP_STATE_META[rs.status] ? rs.status : 'pending', meta = STEP_STATE_META[state];
  const title = (id) => steps.find((s) => s.id === id)?.title ?? id;
  const live = state === 'running' || state === 'waiting';
  return {
    kind: 'step', id: def.id, title: str(def.title) || def.id, state, stateLabel: meta.label, tone: meta.tone, hasRun: !!run,
    agent: { providerLabel: providerLabel(def.provider), roleLabel: roleLabel(def.role, roles), model: def.model || null, effort: def.effort || null },
    prompt: str(def.prompt) || null,
    dependsOn: arr(def.dependsOn).map((id) => ({ id, title: title(id) })),
    continueFrom: def.continueFrom ? { id: def.continueFrom, title: title(def.continueFrom) } : null,
    summary: rs?.summary ?? null, error: rs?.error ?? null,
    startedAt: rs?.startedAt ?? null, finishedAt: rs?.finishedAt ?? null, durationMs: rs ? spanMs(rs.startedAt, rs.finishedAt, live, now) : null,
    terminalId: rs?.terminalId ?? null, taskId: rs?.taskId ?? null,
    canOpenTerminal: !!rs?.terminalId, terminalLive: live,
    terminalHint: !rs?.terminalId ? 'Esta etapa ainda não abriu um terminal.' : live ? null : 'A etapa terminou; o terminal pode já ter sido encerrado.',
  };
}

// ---------- histórico de runs ----------
export function historyRows(runs, flow, { now = Date.now() } = {}) {
  return arr(runs).filter((r) => r?.id).map((run) => {
    const meta = RUN_STATE_META[run.status] ?? { label: run.status ? String(run.status) : NOT_INFORMED, tone: 'idle' };
    const p = flowProgress(flow, run), failed = runSteps(run).find((s) => s?.status === 'failed');
    return { id: run.id, status: run.status, label: meta.label, tone: meta.tone, startedAt: run.startedAt ?? null, durationMs: runDuration(run, now), progress: p.label, reason: failed ? clip(failed.error, 140) || null : null };
  });
}

// ---------- falhas de rede / rota ----------
/** Mensagem clara para a tela. `ctx`: 'list' (a lista inteira) ou 'item' (uma missão). Servidor antigo sem as rotas responde 404. */
export function describeFailure(err, ctx = 'list') {
  const status = err?.status;
  if (status === undefined || status === null) return { kind: 'offline', message: 'Não foi possível falar com o servidor do FORGE. Confira se ele está rodando; o último estado conhecido continua na tela.' };
  if (status === 404 && ctx === 'list') return { kind: 'unavailable', message: 'As missões novas ainda não existem neste servidor (a rota /api/flows não foi encontrada). Atualize o FORGE e reinicie o servidor.' };
  if (status === 404) return { kind: 'notfound', message: 'Missão não encontrada. Ela pode ter sido removida; a lista será atualizada.' };
  if (status === 409) return { kind: 'conflict', message: err?.message || 'Ação recusada: já existe uma execução ativa.' };
  return { kind: 'error', message: err?.message || `Erro ${status}` };
}

// ---------- rascunho do formulário "Nova missão" ----------
/** Etapa do editor. `key` é local (estável na edição); os ids s1..sN só nascem em `draftToBody`. */
const blankStep = (key, deps = []) => ({ key, title: '', prompt: '', provider: 'claude', role: 'builder', model: '', effort: '', dependsOn: deps, continueFrom: '' });
export function emptyDraft({ workspaceId = '' } = {}) {
  return { workspaceId, title: '', goal: '', fullAccess: false, maxParallel: 1, steps: [blankStep('k1')], nextKey: 2 };
}
/** Nova etapa ao fim; por padrão depende da anterior (sequência), e o usuário desmarca para criar um ramo paralelo. */
export function addStep(draft) {
  if (draft.steps.length >= MAX_STEPS) return draft;
  const last = draft.steps.at(-1);
  return { ...draft, steps: [...draft.steps, blankStep(`k${draft.nextKey}`, last ? [last.key] : [])], nextKey: draft.nextKey + 1 };
}
/** Remove a etapa e limpa as referências a ela (dependências e "continuar do terminal de"). Nunca deixa o rascunho sem etapas. */
export function removeStep(draft, key) {
  if (draft.steps.length <= 1) return draft;
  return { ...draft, steps: draft.steps.filter((s) => s.key !== key).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== key), continueFrom: s.continueFrom === key ? '' : s.continueFrom })) };
}
export const patchStep = (draft, key, patch) => ({ ...draft, steps: draft.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
/** Chaves de todas as etapas das quais `key` depende, direta ou indiretamente (a cadeia onde "continuar do terminal de" pode apontar). */
export function ancestorKeys(draft, key) {
  const by = new Map(draft.steps.map((s) => [s.key, s])), out = new Set(), stack = [...(by.get(key)?.dependsOn ?? [])];
  while (stack.length) { const k = stack.pop(); if (out.has(k) || !by.has(k)) continue; out.add(k); stack.push(...by.get(k).dependsOn); }
  return out;
}
/** Marca/desmarca uma dependência; se a cadeia deixar de conter o `continueFrom`, ele é limpo. */
export function toggleDependency(draft, key, depKey) {
  const s = draft.steps.find((x) => x.key === key);
  if (!s || depKey === key) return draft;
  const deps = s.dependsOn.includes(depKey) ? s.dependsOn.filter((d) => d !== depKey) : [...s.dependsOn, depKey];
  let next = patchStep(draft, key, { dependsOn: deps });
  // quem depende desta etapa também pode perder o ancestral do `continueFrom`
  next = { ...next, steps: next.steps.map((x) => (x.continueFrom && !ancestorKeys(next, x.key).has(x.continueFrom) ? { ...x, continueFrom: '' } : x)) };
  return next;
}
export function flowToDraft(flow) {
  const steps = arr(flow?.steps), keyOf = new Map(steps.map((s, i) => [s.id, `k${i + 1}`]));
  return {
    workspaceId: flow?.workspaceId ?? '', title: str(flow?.title), goal: str(flow?.goal), fullAccess: flow?.fullAccess === true, maxParallel: Math.min(4, Math.max(1, Number(flow?.maxParallel) || 1)),
    steps: steps.length ? steps.map((s) => ({ key: keyOf.get(s.id), title: str(s.title), prompt: str(s.prompt), provider: s.provider ?? 'claude', role: s.role ?? 'builder', model: s.model ?? '', effort: s.effort ?? '', dependsOn: arr(s.dependsOn).map((d) => keyOf.get(d)).filter(Boolean), continueFrom: s.continueFrom ? keyOf.get(s.continueFrom) ?? '' : '' })) : [blankStep('k1')],
    nextKey: steps.length + 1,
  };
}

/** Confere o rascunho como o servidor confere (o servidor continua sendo a palavra final). { ok, errors: [{ field, key?, message }], byStep: { [key]: [mensagem] } } */
export function validateDraft(draft, { mode = 'create' } = {}) {
  const errors = [], byStep = {};
  const add = (field, message, key) => { errors.push({ field, ...(key ? { key } : {}), message }); if (key) (byStep[key] ??= []).push(message); };
  const title = str(draft?.title).trim();
  if (!title) add('title', 'Dê um nome à missão.'); else if (title.length > MAX_TITLE) add('title', `O nome passa de ${MAX_TITLE} caracteres.`);
  if (str(draft?.goal).length > MAX_TEXT) add('goal', `O objetivo passa de ${MAX_TEXT} caracteres.`);
  if (mode === 'create' && !draft?.workspaceId) add('workspaceId', 'Escolha o workspace onde a missão vai rodar.');
  if (![1, 2, 3, 4].includes(Number(draft?.maxParallel))) add('maxParallel', 'O paralelismo vai de 1 a 4.');
  const steps = arr(draft?.steps);
  if (!steps.length) add('steps', 'Adicione ao menos uma etapa.');
  if (steps.length > MAX_STEPS) add('steps', `No máximo ${MAX_STEPS} etapas por missão.`);
  const index = new Map(steps.map((s, i) => [s.key, i]));
  steps.forEach((s, i) => {
    const n = i + 1;
    if (!str(s.title).trim()) add('step.title', `Etapa ${n}: dê um título.`, s.key); else if (s.title.trim().length > MAX_TITLE) add('step.title', `Etapa ${n}: o título passa de ${MAX_TITLE} caracteres.`, s.key);
    if (!str(s.prompt).trim()) add('step.prompt', `Etapa ${n}: escreva o que o agente deve fazer.`, s.key); else if (s.prompt.length > MAX_TEXT) add('step.prompt', `Etapa ${n}: o texto passa de ${MAX_TEXT} caracteres.`, s.key);
    if (!PROVIDERS.includes(s.provider)) add('step.provider', `Etapa ${n}: escolha o agente (Claude ou Codex).`, s.key);
    if (!s.role) add('step.role', `Etapa ${n}: escolha o papel.`, s.key);
    for (const d of arr(s.dependsOn)) if (!index.has(d) || index.get(d) >= i) add('step.dependsOn', `Etapa ${n}: só pode depender de etapas anteriores da lista.`, s.key);
    if (s.continueFrom && !ancestorKeys(draft, s.key).has(s.continueFrom)) add('step.continueFrom', `Etapa ${n}: só pode continuar o terminal de uma etapa da sua cadeia de dependências.`, s.key);
  });
  return { ok: errors.length === 0, errors, byStep };
}

/** Corpo de POST/PATCH /api/flows. Vazio de modelo/esforço = null (padrão do agente). `fullAccess` só vai `true` se o usuário marcou (booleano estrito). PATCH não leva workspace nem tipo. */
export function draftToBody(draft, { mode = 'create' } = {}) {
  const ids = new Map(arr(draft.steps).map((s, i) => [s.key, `s${i + 1}`]));
  const body = {
    title: str(draft.title).trim(), goal: str(draft.goal).trim(), fullAccess: draft.fullAccess === true, maxParallel: Number(draft.maxParallel) || 1,
    steps: arr(draft.steps).map((s) => ({
      id: ids.get(s.key), title: str(s.title).trim(), prompt: str(s.prompt).trim(), provider: s.provider, role: s.role, model: s.model || null, effort: s.effort || null,
      dependsOn: arr(s.dependsOn).map((d) => ids.get(d)).filter(Boolean), continueFrom: s.continueFrom ? ids.get(s.continueFrom) ?? null : null,
    })),
  };
  return mode === 'create' ? { workspaceId: draft.workspaceId, kind: 'project', ...body } : body;
}
