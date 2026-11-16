// Quadro da missão (funções puras, sem React nem rede): transforma `mission` (+ `tiers`, `usage`) no view-model da página Missões de cima para baixo.
// Reaproveita as funções de missions-view.js (estado das etapas, aprovações, detalhe) sem copiá-las nem alterá-las. Só dado REAL: o que o servidor não informa
// (modelo, esforço, papel, onda de missões antigas) vira "não informado" ou um valor calculado e DECLARADO como tal; nunca se inventa modelo, custo nem resultado.
//
// Comportamento por tipo de missão (`board.kind`):
//   plan   — o ciclo tem plano: ondas por `wave` (ou calculadas de `dependsOn`), uma etapa por cartão.
//   rounds — ciclo SEM plano (o Planner decide uma rodada por vez): cada rodada é um cartão, uma por onda (sequência). Não há total: o progresso conta rodadas concluídas.
//   tasks  — sem ciclo, só tarefas manuais: cada tarefa é um cartão (ondas por `dependsOn`).
//   none   — sem ciclo e sem tarefas: tela de espera ("ainda não começou"); a ação Iniciar fica no cabeçalho.
import { DASH, buildWorkflow, controlItems, cycleActions, missionState, missionUsage, nodeDetail, stepsOf } from './missions-view.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const clip = (s, n) => String(s ?? '').slice(0, n);

export const NOT_INFORMED = 'não informado';

// Mesmos nomes do servidor (server/tiers.js). Valor fora da lista é tratado como ausente.
export const TIER_NAMES = Object.freeze(['leve', 'padrao', 'profunda']);
export const DEFAULT_TIER = 'padrao';
export const TIER_LABEL = Object.freeze({ leve: 'leve', padrao: 'padrão', profunda: 'profunda' });
export const ROLE_LABEL = Object.freeze({ implementacao: 'Implementação', testes: 'Testes', revisao: 'Revisão', docs: 'Documentação', analise: 'Análise' });
export const DEFAULT_ROLE = 'implementacao';
export const SOURCE_LABEL = Object.freeze({ planner: 'definido pelo Planner', default: 'padrão', pinned: 'fixado por você', escalated: 'escalado após falha' });
export const EFFORT_LABEL = Object.freeze({ low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo' });
const SOURCES = Object.keys(SOURCE_LABEL);

export const isTier = (x) => typeof x === 'string' && TIER_NAMES.includes(x);
export const roleLabel = (r) => ROLE_LABEL[r] ?? ROLE_LABEL[DEFAULT_ROLE];
export const effortLabel = (e) => (str(e) ? EFFORT_LABEL[e] ?? e : NOT_INFORMED);

/** Estado do cartão (rótulo fino, em português) a partir do estado do nó e do status bruto da etapa. */
export function stepStateLabel(state, status) {
  if (state === 'approval') return 'Aguardando sua aprovação';
  if (state === 'cancelled') return 'Cancelada';
  if (state === 'working') return 'Em execução';
  if (state === 'completed') return 'Concluída';
  if (state === 'attention') return status === 'failed' ? 'Falhou' : status === 'unverified' ? 'Sem verificação do sistema' : status === 'interrupted' ? 'Interrompida' : 'Atenção';
  return 'Na fila';
}

/**
 * Onda de cada etapa: 1 + a maior onda das dependências (1 = sem dependências), como o servidor. Dependência desconhecida é ignorada; ciclo não trava (vale 1).
 * Entrada: [{ id, dependsOn }]. Saída: Map id -> onda.
 */
export function computeWaves(items) {
  const byId = new Map(arr(items).map((s) => [s.id, s]));
  const memo = new Map();
  const visit = (id, stack) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 1;
    stack.add(id);
    const deps = arr(byId.get(id)?.dependsOn).filter((d) => byId.has(d));
    const w = 1 + Math.max(0, ...deps.map((d) => visit(d, stack)));
    stack.delete(id); memo.set(id, w);
    return w;
  };
  for (const s of byId.values()) visit(s.id, new Set());
  return memo;
}

const posInt = (v) => (Number.isInteger(v) && v >= 1 ? v : null);

/**
 * Rota de um cartão: { tier, tierLabel, model, effort, source, sourceLabel, known }. Prioridade:
 *  1. `route` gravada pelo servidor (da última rodada ou resolvida);
 *  2. etapa que ainda não rodou: nível do Planner/fixado + a tabela efetiva do servidor (`tiers`), como PREVISÃO (modelo só se a tabela foi informada);
 *  3. etapa que já rodou sem rota gravada (missão antiga): nível "padrão" e modelo/esforço "não informado", porque o que rodou não foi registrado.
 */
export function routeView({ route, tier, pin, ran = false, tiers = null }) {
  const r = obj(route);
  const table = obj(tiers);
  const make = (t, model, effort, source, known) => ({ tier: t, tierLabel: TIER_LABEL[t], model: str(model), effort: str(effort), source, sourceLabel: SOURCE_LABEL[source], known });
  if (isTier(r.tier) && str(r.model)) return make(r.tier, r.model, r.effort, SOURCES.includes(r.source) ? r.source : 'default', true);
  const t = isTier(pin) ? pin : isTier(tier) ? tier : DEFAULT_TIER;
  const source = isTier(pin) ? 'pinned' : isTier(tier) ? 'planner' : 'default';
  const row = !ran && isTier(t) ? obj(table[t]) : {};
  return make(t, row.model, row.effort, source, !!str(row.model));
}

/** Papel (rótulo) de uma etapa: `role` válido, senão implementação (como o servidor). */
const roleOf = (role) => (typeof role === 'string' && ROLE_LABEL[role] ? role : DEFAULT_ROLE);

const pendingCycleApprovals = (c) => arr(c?.approvals).filter((a) => a?.status === 'pending');

/** Etapas do quadro (uma por cartão), na ordem do plano/rodadas/tarefas, já com onda, rota, estado e aprovação. */
function boardSteps(m, tiers) {
  const c = m?.cycle, raw = stepsOf(m);
  const nodes = new Map(buildWorkflow(m).nodes.filter((n) => n.kind === 'step').map((n) => [n.stepKey, n])); // squad fica de fora da tela: só o grafo do ciclo
  const approvalItems = controlItems(m).filter((i) => i.kind === 'approval');
  const planRaw = new Map(arr(c?.plan?.steps).map((s) => [s.id, s]));
  const roundsRaw = new Map(arr(c?.rounds).map((r) => [`round-${r.n}`, r]));
  const pins = obj(c?.plan?.pins);
  const calc = computeWaves(raw.map((s) => ({ id: s.id, dependsOn: s.dependsOn })));
  const cycleOpen = !!c && !['completed', 'cancelled', 'limit_reached'].includes(c.status);

  return raw.map((s, idx) => {
    const node = nodes.get(s.id) ?? null, p = planRaw.get(s.id) ?? null, rd = roundsRaw.get(s.id) ?? null;
    const state = node?.state ?? 'idle', attempts = node?.attempts ?? 0;
    const wave = s.source === 'rodada' ? idx + 1 : posInt(p?.wave) ?? calc.get(s.id) ?? 1;
    const role = roleOf(p?.role ?? rd?.role);
    const route = routeView({ route: p?.route ?? rd?.route, tier: p?.tier, pin: pins[s.id], ran: attempts > 0 || ['running', 'completed', 'failed', 'unverified', 'interrupted'].includes(s.status), tiers });
    const approval = node?.approvalId ? approvalItems.find((i) => i.id === node.approvalId && i.scope === 'cycle') ?? null : null;
    const pin = isTier(pins[s.id]) ? pins[s.id] : null;
    return {
      id: s.id, nodeId: node?.id ?? `step:${s.id}`, title: s.title, source: s.source, role, roleLabel: roleLabel(role), roleKnown: !!(p?.role ?? rd?.role),
      tier: route.tier, route, routeSource: route.source, state, status: s.status, stateLabel: stepStateLabel(state, s.status),
      approval, attempts, wave, waveKnown: !!posInt(p?.wave), deps: s.dependsOn, uncertain: !!s.uncertain, pin,
      canPin: s.source === 'plano' && s.status === 'queued' && state !== 'approval' && cycleOpen,
      instructions: s.instructions, acceptance: s.acceptance, expectedFiles: s.expectedFiles,
    };
  });
}

/** Ondas: [{ n, label, steps, parallel, state: pending|active|done|attention, link, out }]. `link` = conector que ENTRA na onda e `out` = o que SAI dela rumo à seguinte (idle | done | active; null na última): é o `out` que o trilho vertical desenha. */
export function groupWaves(steps) {
  const by = new Map();
  for (const s of steps) { const l = by.get(s.wave) ?? []; l.push(s); by.set(s.wave, l); }
  const waves = [...by.keys()].sort((a, b) => a - b).map((n) => {
    const list = by.get(n);
    const state = list.some((s) => s.state === 'attention') ? 'attention' : list.every((s) => s.state === 'completed') ? 'done' : list.some((s) => s.state === 'working' || s.state === 'approval' || s.state === 'completed') ? 'active' : 'pending';
    return { n, label: `Onda ${n}`, steps: list, parallel: list.length, state, link: 'idle' };
  });
  waves.forEach((w, i) => {
    if (!i) return;
    const prev = waves[i - 1];
    w.link = prev.state === 'done' ? (w.steps.some((s) => s.state === 'working' || s.state === 'approval') ? 'active' : 'done') : 'idle';
  });
  waves.forEach((w, i) => { w.out = waves[i + 1]?.link ?? null; });
  return waves;
}

/** Marcador de progresso de uma etapa: done (✓) | current (●) | attention | next (○). */
export const markerOf = (s) => (s.state === 'completed' ? 'done' : s.state === 'working' || s.state === 'approval' ? 'current' : s.state === 'attention' ? 'attention' : 'next');

function progressOf(m, steps, kind) {
  const c = m?.cycle, state = missionState(m);
  const done = steps.filter((s) => s.state === 'completed').length;
  const total = kind === 'plan' || kind === 'tasks' ? steps.length : null;
  const items = steps.map((s) => ({ id: s.id, title: s.title, marker: markerOf(s), stateLabel: s.stateLabel, wave: s.wave }));
  const current = steps.filter((s) => s.state === 'working' || s.state === 'approval');
  const attention = steps.filter((s) => s.state === 'attention');
  const next = steps.filter((s) => s.state === 'idle').map((s) => ({ id: s.id, title: s.title }));
  const q = (t) => `“${t}”`;
  let headline;
  if (state === 'cancelled') headline = 'A missão foi cancelada.';
  else if (state === 'completed') headline = total ? 'Todas as etapas foram concluídas.' : 'A missão foi concluída.';
  else if (current.some((s) => s.state === 'approval')) headline = `Aguardando a sua aprovação em ${q(current.find((s) => s.state === 'approval').title)}.`;
  else if (current.length) headline = `Agora: ${current.map((s) => q(s.title)).join(' e ')}.${next.length ? ` Depois: ${q(next[0].title)}.` : ''}`;
  else if (attention.length) headline = `${q(attention[0].title)} precisa da sua atenção.`;
  else if (next.length && kind !== 'rounds') headline = `Próxima etapa: ${q(next[0].title)}.`;
  else if (c?.status === 'planning') headline = 'O Planner está montando o próximo passo.';
  else if (!c && !steps.length) headline = 'A missão ainda não começou.';
  else headline = steps.length ? 'Sem etapa em andamento.' : 'Nenhuma etapa ainda.';
  const pct = state === 'completed' ? 100 : total ? Math.round((done / total) * 100) : null;
  return { done, total, pct, unit: kind === 'rounds' ? 'rodadas' : kind === 'tasks' ? 'tarefas' : 'etapas', current: current[0]?.id ?? null, currentIds: current.map((s) => s.id), next, items, headline };
}

const ASSURANCE = Object.freeze({
  verified: { label: 'Verificada pelo sistema', tone: 'ok', hint: 'A evidência da última rodada foi confirmada pelas verificações reais do workspace.' },
  'self-declared': { label: 'Autodeclarada', tone: 'warn', hint: 'Sem evidência verificada pelo sistema: vale o que foi declarado, não o que foi provado.' },
});

/** Arquivos alterados nas rodadas do ciclo (relatório do sistema), sem repetição, até `limit`. */
export function deliveryFiles(m, limit = 40) {
  const seen = new Set();
  for (const r of arr(m?.cycle?.rounds)) for (const f of arr(r?.report?.filesChanged)) { const p = typeof f === 'string' ? f : f?.path; if (str(p)) seen.add(clip(p, 300)); }
  return [...seen].slice(0, limit);
}

/**
 * Oferta de aceitação humana SEM evidência (rota accept-unverified): só ciclo bloqueado pelo Planner, sem aprovação pendente, cuja última rodada tem evidência
 * `inconclusive`. Evidência `failed` nunca pode ser aceita. Devolve os dados que o servidor exige no corpo, ou null.
 */
export function acceptanceOffer(m) {
  const c = m?.cycle, last = arr(c?.rounds).at(-1), ev = last?.report?.evidence;
  if (!c || c.status !== 'blocked' || c.blockedCode !== 'planner_blocked' || pendingCycleApprovals(c).length) return null;
  if (!last || ev?.level !== 'inconclusive' || !str(c.id)) return null;
  return { cycleId: c.id, round: last.n, evidenceLevel: 'inconclusive', reasons: arr(ev.reasons).slice(0, 5).map((x) => clip(x, 240)) };
}
/** Corpo da aceitação (o servidor exige `confirm: true` e um motivo de 10 a 500 caracteres úteis). null enquanto o motivo for curto demais. */
export function acceptanceBody(offer, reason) {
  const text = String(reason ?? '').replace(/\r\n?/g, '\n').trim();
  if (!offer || text.replace(/\s/g, '').length < 10 || text.length > 500) return null;
  return { cycleId: offer.cycleId, round: offer.round, evidenceLevel: offer.evidenceLevel, reason: text, confirm: true };
}

function deliveryOf(m) {
  const c = m?.cycle, state = missionState(m);
  const completed = state === 'completed' || c?.status === 'completed';
  const a = completed ? ASSURANCE[c?.assurance] ?? null : null;
  const closedBy = c?.closedBy === 'system' || c?.closedBy === 'planner' ? c.closedBy : null;
  const acceptedByUser = c?.acceptance?.by === 'user';
  return {
    state: state === 'cancelled' ? 'cancelled' : completed ? 'ready' : c?.status === 'blocked' || state === 'attention' ? 'blocked' : 'pending',
    assurance: completed ? str(c?.assurance) : null,
    assuranceLabel: !completed ? null : acceptedByUser ? 'Aceita por uma pessoa, sem evidência verificada' : a?.label ?? NOT_INFORMED,
    assuranceTone: !completed ? null : acceptedByUser ? 'warn' : a?.tone ?? null,
    assuranceHint: !completed ? null : acceptedByUser ? 'Você aceitou a conclusão explicitamente; o sistema não verificou o resultado.' : a?.hint ?? null,
    summary: completed && str(c?.finalSummary) ? clip(c.finalSummary, 1200) : null,
    files: completed ? deliveryFiles(m) : [],
    closedBy,
    closedByLabel: closedBy === 'system' ? 'Fechada automaticamente: todas as etapas tinham evidência verificada pelo sistema.' : closedBy === 'planner' ? 'Fechada pela decisão do Planner.' : null,
    offer: acceptanceOffer(m),
  };
}

/**
 * Quadro completo da missão. `tiers` = /api/state.orchestration.tiers (opcional); `usage` = /api/state.usage (opcional).
 * { kind, empty, note, waves, steps, progress, delivery, attention, usage, objective, workspaceId }
 */
export function buildBoard(m, { tiers = null, usage = null } = {}) {
  const c = m?.cycle;
  const kind = arr(c?.plan?.steps).length ? 'plan' : arr(c?.rounds).length ? 'rounds' : arr(m?.tasks).length ? 'tasks' : 'none';
  const steps = kind === 'none' ? [] : boardSteps(m, tiers);
  const matched = new Set(steps.map((s) => s.approval?.id).filter(Boolean));
  // o que pede você e NÃO está num cartão (aprovação sem etapa, tarefa manual, decisão registrada, falha ou bloqueio): faixa curta acima do plano
  const attention = controlItems(m).filter((i) => !(i.kind === 'approval' && matched.has(i.id)));
  const note = kind === 'rounds' ? 'Sem plano: o Planner decide uma rodada por vez, então não há etapas futuras para mostrar.'
    : kind === 'tasks' ? 'Missão sem ciclo: estas são as tarefas criadas manualmente.'
      : kind === 'none' ? (c?.status === 'planning' ? 'O Planner está montando o plano.' : c ? 'Ainda não há etapas.' : 'A missão ainda não começou. Use Iniciar para o FORGE planejar e executar.') : null;
  return {
    kind, empty: kind === 'none', note, steps, waves: groupWaves(steps), progress: progressOf(m, steps, kind), delivery: deliveryOf(m), attention,
    usage: usage ? missionUsage(usage, m?.id) : null, actions: cycleActions(m), objective: str(m?.objective), workspaceId: m?.workspaceId ?? null,
  };
}

/**
 * Modelo da gaveta de um cartão. Detalhe técnico (fatos e log final) vem de `nodeDetail` (não copiado) e fica SÓ em `technical`.
 * O agente é o Executor do ciclo; modelo e esforço são os da rota (nunca os de um terminal).
 */
export function drawerModel(m, board, stepId) {
  const step = board?.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const d = nodeDetail(m, step.nodeId, {}) ?? {};
  const titleOf = (id) => board.steps.find((s) => s.id === id)?.title ?? id;
  return {
    id: step.id, title: step.title, role: step.role, roleLabel: step.roleLabel, state: step.state, stateLabel: step.stateLabel, status: step.status,
    agent: { name: 'Executor', providerLabel: 'Claude Code', model: step.route.model ?? NOT_INFORMED, effort: step.route.effort ? effortLabel(step.route.effort) : NOT_INFORMED, effortRaw: step.route.effort },
    route: step.route, wave: step.wave, attempts: step.attempts, uncertain: step.uncertain,
    instructions: d.instructions ?? step.instructions ?? null, acceptance: arr(d.acceptance), expectedFiles: arr(step.expectedFiles),
    deps: step.deps.map((id) => ({ id, title: titleOf(id) })),
    approval: step.approval, evidence: d.evidence ?? null, files: arr(d.files), errors: arr(d.errors),
    canPin: step.canPin, pin: step.pin,
    technical: { facts: arr(d.facts), activity: arr(d.activity) },
  };
}

/** Corpo do pin: 'auto' remove a fixação (null). Valor desconhecido = null (não envia nada inválido). */
export function pinBody(value) {
  if (value === 'auto') return { tier: null };
  return isTier(value) ? { tier: value } : null;
}
export const pinUrl = (missionId, stepId) => `/api/missions/${encodeURIComponent(missionId)}/cycle/steps/${encodeURIComponent(stepId)}/tier`;

// ---------- briefing (chat) ----------
const POLICY_NOTE = Object.freeze({ approval_required: 'Vai pedir a sua aprovação durante a execução.', deny: 'Esta etapa será bloqueada pela política do workspace.' });

/** Etapas da proposta do chat agrupadas em ondas (a proposta não traz `wave`: calculada de `dependsOn`), com rota e aviso de política. */
export function proposalBoard(proposal, { tiers = null } = {}) {
  const raw = arr(proposal?.steps);
  const calc = computeWaves(raw.map((s) => ({ id: s.id, dependsOn: s.dependsOn })));
  const policy = new Map(arr(proposal?.policy).map((p) => [p.stepId, p]));
  const steps = raw.map((s) => {
    const route = routeView({ route: s.route, tier: s.tier, tiers });
    const pol = policy.get(s.id);
    return { id: s.id, title: clip(s.title, 120), role: roleOf(s.role), roleLabel: roleLabel(s.role), route, wave: calc.get(s.id) ?? 1, deps: arr(s.dependsOn), acceptance: arr(s.acceptance).map((x) => clip(x, 200)), policyNote: POLICY_NOTE[pol?.decision] ?? null, blocked: pol?.decision === 'deny', state: 'idle' };
  });
  return { steps, waves: groupWaves(steps) };
}

/** O que a tela de briefing pode fazer agora, a partir de GET /api/chat. */
export function briefingState(view, { sending = false } = {}) {
  const v = obj(view);
  const p = v.proposal && typeof v.proposal === 'object' ? v.proposal : null;
  const proposed = p?.status === 'proposed' ? p : null;
  const blocked = !!str(v.workspaceProblem) || !v.workspace;
  const busy = sending || v.busy === true;
  return {
    messages: arr(v.messages), proposal: proposed, approving: p?.status === 'approved', workspace: v.workspace ?? null, workspaceProblem: str(v.workspaceProblem),
    canSend: !blocked && !busy && p?.status !== 'approved', canApprove: !!proposed && !busy && !blocked,
    busy, canReset: arr(v.messages).length > 0 && !busy && p?.status !== 'approved', phase: str(v.phase),
  };
}

/** Corpo de approve: o limite de rodadas precisa cobrir as etapas (cada etapa usa uma rodada); nunca passa do máximo do servidor. null se não cabe. */
export function approveBody(view) {
  const p = view?.proposal;
  if (!p || p.status !== 'proposed' || typeof p.id !== 'string') return null;
  const steps = arr(p.steps).length, base = Number.isInteger(view.maxIterations) ? view.maxIterations : null, hard = Number.isInteger(view.hardMax) ? view.hardMax : null;
  if (!steps || base === null) return { proposalId: p.id }; // o servidor aplica o limite padrão
  // +1 de folga: a retentativa automática de uma etapa (plan.js retryCandidate) só ocorre se sobrar uma rodada além das etapas pendentes; o teto é o máximo do servidor
  const need = Math.min(Math.max(base, steps + 1), hard ?? Infinity);
  if (need < steps) return null;
  return need > base ? { proposalId: p.id, maxIterations: need } : { proposalId: p.id };
}

export { DASH };
