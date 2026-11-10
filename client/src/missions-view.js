// Visão da página Missões (funções puras, sem React nem rede). Tudo vem de dados REAIS do servidor (/api/missions, /api/state.usage, /api/terminals, /api/activity):
// nada é simulado. O que o servidor não informa vira "—" ou "não informado", nunca um número ou uma causa inventados.
//
// Camadas do servidor (mission-status.js): missão | ciclo (mission.cycle.status) | rodada (round.status / round.verification) | execução (task.status).
import { cycleApprovalPending } from './op-state.js';

export const DASH = '—';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clip = (s, n) => String(s ?? '').slice(0, n);
const fmtWhen = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : DASH; };

/** Estado de uma rodada como etapa, igual ao servidor (plan.js): só evidência `verified` do SISTEMA conclui; inconclusiva ou ausente de verificação não vale. */
export function roundStepStatus(r) {
  if (!r) return 'queued';
  if (r.status === 'running') return 'running';
  if (r.status === 'interrupted') return 'interrupted';
  if (r.status !== 'succeeded') return 'failed';
  if (r.verification === undefined && r.phase !== 'done') return 'running';
  const v = r.report?.verificationsInterrupted ? 'skipped' : r.verification ?? 'none';
  if (v !== 'passed' && v !== 'none') return 'failed';
  const ev = r.report?.evidence;
  if (!ev) return 'completed';
  return ev.level === 'verified' ? 'completed' : ev.level === 'failed' ? 'failed' : 'unverified';
}

// ---------- estado da missão (os mesmos 6 grupos/ícones dos terminais do Cockpit) ----------
/** Ordem dos grupos na sidebar: o que pede você vem primeiro. */
export const MISSION_STATES = Object.freeze(['approval', 'attention', 'working', 'idle', 'completed', 'cancelled']);
/** `tone` é o tom do ícone `WsIcon` (idle | work | wait | err | done | cancel): o mesmo vocabulário visual de cor do Cockpit. */
export const STATE_META = Object.freeze({
  idle: { label: 'Ociosa', group: 'Ociosas', tone: 'idle', hint: 'Ainda não começou' },
  working: { label: 'Trabalhando', group: 'Trabalhando', tone: 'work', hint: 'Há um agente executando' },
  completed: { label: 'Concluída', group: 'Concluídas', tone: 'done', hint: 'Terminou' },
  attention: { label: 'Atenção', group: 'Atenção', tone: 'err', hint: 'Falhou, foi interrompida ou está bloqueada' },
  approval: { label: 'Aprovação', group: 'Aguardando aprovação', tone: 'wait', hint: 'Espera uma decisão sua' },
  cancelled: { label: 'Cancelada', group: 'Canceladas', tone: 'cancel', hint: 'Encerrada por você' },
});

/** idle | working | completed | attention | approval | cancelled. `m.status` é o derivado do servidor (missionStatus); aprovação pendente do ciclo manda sobre o resto. */
export function missionState(m) {
  if (!m) return 'idle';
  if (cycleApprovalPending(m)) return 'approval';
  switch (m.status) {
    case 'running': return 'working';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    case 'awaiting_approval': return 'approval';
    case 'failed': case 'interrupted': case 'blocked': case 'limit_reached': return 'attention';
    default: return 'idle'; // queued ou sem estado
  }
}

/** Por que a missão está em "atenção": só o que o servidor registrou (código/razão do bloqueio, última falha). */
export function attentionReason(m) {
  const c = m?.cycle;
  if (c?.status === 'blocked') return clip(c.blockedReason || c.blockedCode || 'Ciclo bloqueado.', 300);
  if (c?.status === 'limit_reached') return 'O limite de rodadas do ciclo foi atingido.';
  const t = arr(m?.tasks).filter((x) => x.status === 'failed' || x.status === 'interrupted').at(-1);
  return t ? clip(t.error || `${t.title}: ${t.status === 'interrupted' ? 'interrompida' : 'falhou'}.`, 300) : null;
}

// ---------- progresso, duração, custo ----------
/** { done, total, pct (0..100 ou null se desconhecido), basis }. Plano = etapas concluídas; sem plano, rodadas ou tarefas manuais. Concluída = 100%. */
export function missionProgress(m) {
  const state = missionState(m), c = m?.cycle, steps = arr(c?.plan?.steps);
  let r;
  if (steps.length) r = { done: steps.filter((s) => s.status === 'completed').length, total: steps.length, basis: 'etapas' };
  else if (arr(c?.rounds).length) r = { done: arr(c.rounds).filter((x) => roundStepStatus(x) === 'completed').length, total: null, basis: 'rodadas' };
  else if (arr(m?.tasks).length) r = { done: arr(m.tasks).filter((t) => t.status === 'completed').length, total: m.tasks.length, basis: 'tarefas' };
  else r = { done: 0, total: null, basis: null };
  const pct = state === 'completed' ? 100 : r.total ? Math.round((r.done / r.total) * 100) : null;
  return { ...r, pct };
}

/** Duração em ms: do início do ciclo (ou da criação) até o fim (ou agora, se ainda ativa). null se não começou. */
export function missionDuration(m, now = Date.now()) {
  const c = m?.cycle, start = Date.parse(c?.startedAt ?? ''), end = Date.parse(c?.finishedAt ?? '');
  if (!Number.isFinite(start)) return null;
  const active = c && ['planning', 'running'].includes(c.status);
  const stop = Number.isFinite(end) ? end : active ? now : null;
  return stop === null ? null : Math.max(0, stop - start);
}
export function fmtDuration(ms) {
  if (!isNum(ms)) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min`;
}

/** Custo estimado e tokens da missão (de /api/state.usage.byMission). Custo ausente = null (nunca US$ 0 inventado). */
export function missionUsage(usage, missionId) {
  const mu = arr(usage?.byMission).find((x) => x?.missionId === missionId);
  const t = mu?.total;
  if (!t) return { costUsd: null, tokens: null, planner: null, executor: null };
  const sum = (b) => { const v = ['input', 'output'].map((f) => b?.[f]).filter(isNum); return v.length ? v.reduce((a, c) => a + c, 0) : null; };
  return { costUsd: isNum(t.costUsd) ? t.costUsd : null, tokens: sum(t), planner: sum(mu.byAgent?.planner), executor: sum(mu.byAgent?.executor), partial: isNum(t.provisional) && t.provisional > 0 };
}

// ---------- equipe ----------
/**
 * Equipe da missão: Planner e Executor (hoje sempre Claude Code; o modelo só é informado pelo servidor nas sessões de terminal) + os agentes dos terminais do workspace.
 * `sessions` = /api/terminals.sessions. Terminal encerrado não entra. Modelo ausente = null.
 */
export function missionTeam(m, sessions = [], { stateOf = null } = {}) {
  const ws = arr(sessions).filter((s) => s && s.workspaceId === m?.workspaceId && s.status === 'running');
  const core = [
    { id: 'planner', name: 'Planner', role: 'Decide a próxima etapa', provider: 'claude', providerLabel: 'Claude Code', model: null, source: 'ciclo' },
    { id: 'executor', name: 'Executor', role: 'Executa uma etapa por vez', provider: 'claude', providerLabel: 'Claude Code', model: null, source: 'ciclo' }, // o modelo do ciclo roda em processo próprio: o servidor não o informa, então NÃO se copia o de um terminal
  ];
  const terms = ws.map((s) => ({ id: s.id, name: s.title || s.roleLabel || s.role, role: s.roleLabel || s.role || 'agente', provider: s.provider ?? 'claude', providerLabel: s.providerLabel || (s.provider === 'codex' ? 'Codex CLI' : 'Claude Code'), model: s.usage?.model ?? null, state: stateOf ? stateOf(s) : s.agent?.state ?? null, source: 'terminal' }));
  return [...core, ...terms];
}

// ---------- agrupamento da sidebar ----------
/** [{ state, meta, items }] só dos grupos com missões, na ordem de MISSION_STATES; dentro, a mais recente primeiro. */
export function groupMissions(missions, { workspaces = [], query = '' } = {}) {
  const wsName = new Map(arr(workspaces).map((w) => [w.id, String(w.displayName || w.name || '').trim() || w.id]));
  const q = String(query).trim().toLowerCase();
  const rows = arr(missions).filter((m) => m && m.id).map((m) => ({ m, state: missionState(m), workspace: wsName.get(m.workspaceId) ?? null, progress: missionProgress(m) }))
    .filter((r) => !q || `${r.m.title} ${r.workspace ?? ''}`.toLowerCase().includes(q));
  return MISSION_STATES.map((state) => ({ state, meta: STATE_META[state], items: rows.filter((r) => r.state === state).sort((a, b) => String(b.m.createdAt ?? '').localeCompare(String(a.m.createdAt ?? ''))) })).filter((g) => g.items.length);
}

// ---------- workflow ----------
export const NODE_STATES = Object.freeze(['idle', 'working', 'completed', 'attention', 'approval', 'cancelled']);
export const NODE_STATE_LABEL = Object.freeze({ idle: 'na fila', working: 'trabalhando', completed: 'concluída', attention: 'atenção', approval: 'aguardando aprovação', cancelled: 'cancelada' });
const STEP_TO_NODE = { queued: 'idle', running: 'working', completed: 'completed', failed: 'attention', interrupted: 'attention', unverified: 'attention', awaiting_approval: 'approval' };
const VERIF_LABEL = { passed: 'verificada', failed: 'falhou', blocked: 'bloqueada', skipped: 'não rodou', none: 'sem verificações' };

/** Etapa da rodada: estado da EXECUÇÃO do Executor e das VERIFICAÇÕES reais do sistema (round.verification), separados de propósito. */
export function roundStages(round) {
  if (!round) return { exec: { state: 'idle', label: 'na fila' }, verify: { state: 'idle', label: 'aguardando' } };
  const exec = round.status === 'running' ? { state: 'working', label: 'executando' }
    : round.status === 'succeeded' ? { state: 'completed', label: 'executada' }
      : round.status === 'interrupted' ? { state: 'attention', label: 'interrompida' } : { state: 'attention', label: 'falhou' };
  let verify;
  if (round.status === 'running') verify = { state: 'idle', label: 'aguardando' };
  else if (round.phase === 'verifying') verify = { state: 'working', label: 'verificando' };
  else {
    const v = round.report?.verificationsInterrupted ? 'skipped' : round.verification ?? null;
    verify = v === 'passed' ? { state: 'completed', label: VERIF_LABEL.passed }
      : v === 'failed' || v === 'blocked' ? { state: 'attention', label: VERIF_LABEL[v] }
        : v ? { state: 'idle', label: VERIF_LABEL[v] ?? v } : { state: round.phase === 'done' ? 'idle' : 'idle', label: 'sem leitura' };
  }
  return { exec, verify };
}

const lastRound = (c, step) => arr(c?.rounds).filter((r) => (step.stepId ? r.stepId === step.stepId && r.planId === c.plan?.id : r.taskId === step.taskId)).at(-1) ?? null;

/** Etapas do workflow: plano (se houver), senão as rodadas, senão as tarefas manuais. */
export function stepsOf(m) {
  const c = m?.cycle, plan = arr(c?.plan?.steps);
  if (plan.length) return plan.map((s) => ({ id: s.id, title: clip(s.title, 120), dependsOn: arr(s.dependsOn), status: s.status ?? 'queued', stepId: s.id, taskId: s.taskId ?? null, instructions: s.instructions ?? null, acceptance: arr(s.acceptance), expectedFiles: arr(s.expectedFiles), uncertain: !!s.uncertain, source: 'plano' }));
  const rounds = arr(c?.rounds);
  if (rounds.length) return rounds.map((r, i) => ({ id: `round-${r.n}`, title: clip(r.plan?.title ?? `Rodada ${r.n}`, 120), dependsOn: i ? [`round-${rounds[i - 1].n}`] : [], status: roundStepStatus(r), stepId: null, taskId: r.taskId ?? null, instructions: r.plan?.instructions ?? null, acceptance: arr(r.plan?.acceptance), expectedFiles: [], uncertain: false, source: 'rodada' }));
  return arr(m?.tasks).map((t) => ({ id: t.id, title: clip(t.title, 120), dependsOn: arr(t.dependsOn), status: t.status ?? 'queued', stepId: null, taskId: t.id, instructions: t.instructions ?? null, acceptance: arr(t.acceptance), expectedFiles: [], uncertain: false, source: 'tarefa' }));
}

/** Aprovações pendentes do ciclo, por rodada. */
const pendingApprovals = (c) => arr(c?.approvals).filter((a) => a?.status === 'pending');

/**
 * Grafo do workflow: Missão -> Planner -> etapas (em paralelo quando não dependem entre si) -> Entrega.
 * Cada nó: { id, kind: mission|planner|step|delivery, title, state, col, row, stages? }. Cada aresta: { id, from, to, state: idle|active|done|wait|err }.
 * `col` cresce pela profundidade de dependência; `row` é centrado por coluna (etapas independentes ficam em linhas distintas = tarefas paralelas).
 */
export function buildWorkflow(m) {
  const c = m?.cycle, state = missionState(m), steps = stepsOf(m), pend = pendingApprovals(c);
  const nodes = [], edges = [];
  const nid = (id) => `step:${id}`; // o Planner aceita ids como "mission", "planner" ou "delivery": o prefixo evita colisão com os nós fixos
  const started = !!(c || arr(m?.tasks).length);

  const depth = new Map();
  const visit = (s, stack = new Set()) => {
    if (depth.has(s.id)) return depth.get(s.id);
    if (stack.has(s.id)) return 0; // dependência circular: não trava o desenho
    stack.add(s.id);
    const d = Math.max(-1, ...s.dependsOn.map((id) => { const p = steps.find((x) => x.id === id); return p ? visit(p, stack) : -1; })) + 1;
    stack.delete(s.id); depth.set(s.id, d); return d;
  };
  steps.forEach((s) => visit(s));
  const maxDepth = steps.length ? Math.max(...steps.map((s) => depth.get(s.id))) : -1;

  const plannerState = c?.status === 'planning' ? 'working' : c?.status === 'blocked' && String(c.blockedCode ?? '').startsWith('planner') ? 'attention' : (c?.plan || arr(c?.rounds).length) ? 'completed' : c ? 'completed' : 'idle';
  const deliveryState = state === 'cancelled' ? 'cancelled' : state === 'completed' ? 'completed' : c?.status === 'completed' ? 'completed'
    : steps.length && steps.every((s) => s.status === 'completed') && c && ['planning', 'running'].includes(c.status) ? 'working' : 'idle';

  nodes.push({ id: 'mission', kind: 'mission', title: 'Missão', subtitle: clip(m?.title, 60), state: started ? 'completed' : 'idle', col: 0 });
  nodes.push({ id: 'planner', kind: 'planner', title: 'Planner', subtitle: c?.plan ? `${steps.length} etapa(s)` : c ? 'decide a cada rodada' : null, state: plannerState, col: 1, plannerCalls: c?.plannerCalls ?? null });

  const stepNodes = steps.map((s) => {
    const round = lastRound(c, s), stages = roundStages(round);
    // a solicitação nasce ANTES da rodada (round = próxima) e carrega stepId/planId: é por eles que se liga à etapa
    const approval = s.stepId ? pend.find((a) => a.stepId === s.stepId && a.planId === c?.plan?.id) ?? null : null;
    let st = STEP_TO_NODE[s.status] ?? 'idle';
    if (approval) st = 'approval';
    else if (state === 'cancelled' && (st === 'idle' || st === 'working')) st = 'cancelled';
    const attempts = arr(c?.rounds).filter((r) => (s.stepId ? r.stepId === s.stepId && r.planId === c.plan?.id : r.taskId === s.taskId)).length;
    return { id: nid(s.id), stepKey: s.id, taskId: round?.taskId ?? s.taskId ?? null, kind: 'step', title: s.title, state: st, col: 2 + depth.get(s.id), stages: round ? stages : { exec: { state: st === 'idle' ? 'idle' : stages.exec.state, label: st === 'idle' ? 'na fila' : stages.exec.label }, verify: stages.verify }, round: round?.n ?? null, attempts, uncertain: s.uncertain, approvalId: approval?.id ?? null, source: s.source };
  });
  nodes.push(...stepNodes);
  const matched = new Set(stepNodes.map((n) => n.approvalId).filter(Boolean)), loose = pend.find((a) => !matched.has(a.id)); // pendente sem etapa (ciclo sem plano): quem espera é o Planner
  if (loose) { const pn = nodes.find((n) => n.id === 'planner'); pn.state = 'approval'; pn.approvalId = loose.id; }
  nodes.push({ id: 'delivery', kind: 'delivery', title: 'Entrega', subtitle: deliveryState === 'completed' ? 'relatório pronto' : null, state: deliveryState, col: (steps.length ? maxDepth + 3 : 2) });

  // linhas: cada coluna é centrada na altura da maior coluna
  const byCol = new Map();
  for (const n of nodes) { const l = byCol.get(n.col) ?? []; l.push(n); byCol.set(n.col, l); }
  const rows = Math.max(1, ...[...byCol.values()].map((l) => l.length));
  for (const l of byCol.values()) l.forEach((n, i) => { n.row = i + (rows - l.length) / 2; });

  const stateOf = (id) => nodes.find((n) => n.id === id)?.state;
  const edge = (from, to) => {
    const a = stateOf(from), b = stateOf(to);
    edges.push({ id: `${from}>${to}`, from, to, state: b === 'working' ? 'active' : b === 'approval' ? 'wait' : b === 'attention' ? 'err' : a === 'completed' && b === 'completed' ? 'done' : 'idle' });
  };
  edge('mission', 'planner');
  const rootIds = steps.filter((s) => !s.dependsOn.some((d) => steps.some((x) => x.id === d))).map((s) => s.id);
  if (steps.length) {
    for (const id of rootIds) edge('planner', nid(id));
    for (const s of steps) for (const d of s.dependsOn) if (steps.some((x) => x.id === d)) edge(nid(d), nid(s.id));
    const hasChild = new Set(steps.flatMap((s) => s.dependsOn));
    for (const s of steps) if (!hasChild.has(s.id)) edge(nid(s.id), 'delivery');
  } else edge('planner', 'delivery');
  return { nodes, edges, cols: Math.max(...nodes.map((n) => n.col)) + 1, rows };
}

/** Resumo do pipeline: etapas, fases (colunas de etapas), quantas executando, quantas na fila e a maior fase (etapas sem dependência entre si). */
export function parallelInfo(wf) {
  const steps = wf.nodes.filter((n) => n.kind === 'step');
  const lanes = steps.reduce((a, n) => { a[n.col] = (a[n.col] ?? 0) + 1; return a; }, {});
  return { running: steps.filter((n) => n.state === 'working').length, queued: steps.filter((n) => n.state === 'idle').length, maxLane: Math.max(1, ...Object.values(lanes)), steps: steps.length, phases: Object.keys(lanes).length };
}

// ---------- detalhes de um nó ----------
/** Detalhe de um nó do workflow: agente, atividade (final do log), evidências (relatório da rodada) e aprovações. Só o que está gravado. */
export function nodeDetail(m, nodeId, { sessions = [], activity = [] } = {}) {
  const wf = buildWorkflow(m), node = wf.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const c = m?.cycle, team = missionTeam(m, sessions);
  const out = { id: node.id, kind: node.kind, title: node.title, state: node.state, agent: null, activity: [], evidence: null, files: [], errors: [], approval: null, instructions: null, acceptance: [], facts: [] };
  const mine = arr(activity).filter((a) => a?.missionId === m?.id);
  const approvalOf = (id) => { const a = arr(c?.approvals).find((x) => x.id === id); return a ? { id: a.id, round: a.round, createdAt: a.createdAt, digest: typeof a.digest === 'string' ? a.digest : null, action: obj(a.action), rules: arr(a.rules).map((r) => clip(r?.id ?? r?.reason ?? r, 80)) } : null; };
  if (node.approvalId) out.approval = approvalOf(node.approvalId);
  if (node.kind === 'mission') { out.facts = [['Objetivo', m?.objective || DASH], ['Criada', fmtWhen(m?.createdAt)]]; out.activity = mine.slice(0, 8).map((a) => a.message); return out; }
  if (node.kind === 'planner') {
    out.agent = team.find((a) => a.id === 'planner');
    out.facts = [['Chamadas ao Planner', isNum(c?.plannerCalls) ? String(c.plannerCalls) : DASH], ['Plano', c?.plan ? `${arr(c.plan.steps).length} etapa(s)` : 'sem plano (decide a cada rodada)']];
    if (c?.plan?.rationale) out.facts.push(['Raciocínio', clip(c.plan.rationale, 400)]);
    out.activity = mine.filter((a) => a.agent === 'planner').slice(0, 8).map((a) => a.message);
    if (c?.status === 'blocked' && String(c.blockedCode ?? '').startsWith('planner')) out.errors.push(clip(c.blockedReason ?? c.blockedCode, 300));
    return out;
  }
  if (node.kind === 'delivery') {
    out.facts = [['Estado do ciclo', c?.status ?? DASH], ['Resumo final', c?.finalSummary ? clip(c.finalSummary, 500) : DASH]];
    if (c?.assurance) out.facts.push(['Garantia', String(c.assurance)]); // ex.: aceitação humana sem evidência verificada
    if (c?.status === 'blocked') out.errors.push(clip(c.blockedReason ?? c.blockedCode, 300));
    out.activity = mine.slice(0, 8).map((a) => a.message);
    return out;
  }
  const step = stepsOf(m).find((s) => s.id === node.stepKey), round = step ? lastRound(c, step) : null, task = arr(m?.tasks).find((t) => t.id === (round?.taskId ?? step?.taskId));
  out.agent = team.find((a) => a.id === 'executor');
  out.instructions = step?.instructions ? clip(step.instructions, 1200) : null;
  out.acceptance = arr(step?.acceptance).map((x) => clip(x, 200));
  out.facts = [['Rodada', round ? `#${round.n}${node.attempts > 1 ? ` (${node.attempts} tentativas)` : ''}` : DASH], ['Execução', node.stages.exec.label], ['Verificações', node.stages.verify.label]];
  if (round?.startedAt) out.facts.push(['Início', fmtWhen(round.startedAt)]);
  if (round?.finishedAt) out.facts.push(['Fim', fmtWhen(round.finishedAt)]);
  out.activity = arr(task?.log).slice(-12).map((l) => clip(l, 240));
  const rep = round?.report ?? null;
  if (rep) {
    const ev = rep.evidence ?? null;
    out.evidence = {
      level: ev?.level ?? null, reasons: arr(ev?.reasons).map((r) => clip(r, 240)),
      verifications: arr(rep.verifications).map((v) => ({ id: v.id ?? v.script ?? '?', status: v.status ?? '?', command: v.command ? clip(v.command, 120) : null })),
      summary: rep.summary ? clip(rep.summary, 600) : null,
    };
    out.files = arr(rep.filesChanged).slice(0, 40).map((f) => (typeof f === 'string' ? f : f?.path)).filter(Boolean);
    out.errors.push(...arr(rep.errors).slice(0, 5).map((e) => clip(typeof e === 'string' ? e : e?.message, 240)), ...arr(rep.blockers).slice(0, 3).map((e) => clip(e, 240)));
  }
  if (task?.error) out.errors.push(clip(task.error, 300));
  out.errors = [...new Set(out.errors.filter(Boolean))];
  return out;
}

/** Itens de ação do painel de controle: aprovações pendentes (ciclo e tarefas manuais), falhas, e o que dá para fazer agora. */
export function controlItems(m) {
  const c = m?.cycle, items = [];
  for (const a of pendingApprovals(c)) items.push({ kind: 'approval', id: a.id, scope: 'cycle', digest: typeof a.digest === 'string' ? a.digest : null, title: `Aprovar a rodada ${a.round}`, detail: clip(a.action?.title ?? a.action?.summary ?? a.action?.rationale ?? 'Ação que exige aprovação humana.', 240), action: obj(a.action), rules: arr(a.rules).map((r) => clip(r?.id ?? r?.reason ?? r, 80)) });
  for (const t of arr(m?.tasks)) if (t.status === 'awaiting_approval') items.push({ kind: 'approval', id: t.id, scope: 'task', title: `Aprovar: ${clip(t.title, 80)}`, detail: clip(t.report || t.instructions || '', 240) });
  if (c?.status === 'blocked' && c.blockedCode === 'approval_required' && !pendingApprovals(c).length) {
    // a decisão foi registrada, mas aprovar NÃO executa: o ciclo só segue ao retomar (o servidor guarda a decisão para a próxima rodada)
    const last = arr(c.approvals).filter((a) => a?.decidedAt).sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt))).at(-1);
    items.push({ kind: 'resume', id: 'resume', title: 'Decisão registrada', detail: `${last?.status === 'rejected' ? 'Ação rejeitada' : 'Ação aprovada'}: ela ainda NÃO foi executada. Use “Retomar” para o ciclo seguir.` });
    return items;
  }
  const why = attentionReason(m);
  if (why && missionState(m) === 'attention') items.push({ kind: 'failure', id: 'failure', title: 'Falha ou bloqueio', detail: why });
  return items;
}

/** Ações do ciclo disponíveis agora (espelham o que o servidor aceita: start só sem ciclo ativo; cancel só com ciclo ativo; resume só bloqueado/limite). */
export function cycleActions(m) {
  const s = m?.cycle?.status;
  return {
    start: !m?.cycle || ['completed', 'cancelled', 'limit_reached'].includes(s),
    cancel: ['planning', 'running', 'blocked'].includes(s), // o servidor também cancela um ciclo bloqueado
    resume: s === 'blocked' && !cycleApprovalPending(m), // com aprovação PENDENTE se decide; decidida, retoma
    remove: !(['planning', 'running'].includes(s) || arr(m?.tasks).some((t) => t.status === 'running')),
  };
}

/** Linha de atividade da missão (de /api/activity), a mais recente primeiro. */
export function missionFeed(activity, missionId, limit = 40) {
  return arr(activity).filter((a) => a?.missionId === missionId).slice(0, limit).map((a) => ({ id: a.id, at: a.at, type: a.type, message: clip(a.message, 240), agent: a.agent ?? null }));
}

/** Id do nó do workflow que corresponde a uma tarefa (pelo `taskId` da etapa), ou null. */
export const nodeIdForTask = (wf, taskId) => wf?.nodes.find((n) => n.kind === 'step' && n.taskId === taskId)?.id ?? null;
