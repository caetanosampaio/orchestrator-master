// Visão da página Missões (client/src/missions-view.js): estados, progresso, custo, equipe, agrupamento e o grafo do workflow, só a partir de dados do servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionState, STATE_META, MISSION_STATES, missionProgress, missionDuration, fmtDuration, missionUsage, missionTeam, groupMissions, buildWorkflow, roundStages, nodeDetail, controlItems, cycleActions, parallelInfo, missionFeed, attentionReason, roundStepStatus, nodeIdForTask, TASK_STATUS_LABEL } from '../../client/src/missions-view.js';

const step = (id, o = {}) => ({ id, title: `Etapa ${id}`, dependsOn: [], status: 'queued', round: null, taskId: null, ...o });
const mission = (o = {}) => ({ id: 'mis_1', title: 'Missão', objective: 'Fazer X', workspaceId: 'ws_1', createdAt: '2026-11-10T10:00:00Z', status: 'running', tasks: [], ...o });
const cycle = (o = {}) => ({ id: 'cyc_1', status: 'running', maxIterations: 5, rounds: [], approvals: [], plannerCalls: 2, startedAt: '2026-11-10T10:00:00Z', finishedAt: null, ...o });

test('missionState: os 6 grupos, com aprovação pendente mandando sobre o resto', () => {
  const m = (status, cyc) => mission({ status, ...(cyc ? { cycle: cyc } : {}) });
  assert.equal(missionState(m('queued')), 'idle');
  assert.equal(missionState(m('running')), 'working');
  assert.equal(missionState(m('completed')), 'completed');
  assert.equal(missionState(m('cancelled')), 'cancelled');
  assert.equal(missionState(m('awaiting_approval')), 'approval');
  for (const s of ['failed', 'interrupted', 'blocked', 'limit_reached']) assert.equal(missionState(m(s)), 'attention', s);
  assert.equal(missionState(m('blocked', cycle({ status: 'blocked', blockedCode: 'approval_required', approvals: [{ id: 'a', status: 'pending', round: 1 }] }))), 'approval');
  assert.equal(missionState(m('blocked', cycle({ status: 'blocked', blockedCode: 'planner_blocked' }))), 'attention');
  assert.equal(missionState(null), 'idle'); assert.equal(missionState({}), 'idle');
  assert.deepEqual(new Set(MISSION_STATES), new Set(Object.keys(STATE_META)));
  assert.equal(STATE_META.working.tone, 'work'); assert.equal(STATE_META.approval.tone, 'wait'); assert.equal(STATE_META.attention.tone, 'err');
});

test('progresso: etapas do plano; sem plano rodadas/tarefas; concluída = 100%; sem dado = null', () => {
  const p = missionProgress(mission({ cycle: cycle({ plan: { steps: [step('a', { status: 'completed' }), step('b', { status: 'running' }), step('c'), step('d')] } }) }));
  assert.deepEqual([p.done, p.total, p.pct, p.basis], [1, 4, 25, 'etapas']);
  const r = missionProgress(mission({ cycle: cycle({ rounds: [{ n: 1, status: 'succeeded', phase: 'done', verification: 'passed' }, { n: 2, status: 'running' }] }) }));
  assert.deepEqual([r.done, r.total, r.pct, r.basis], [1, null, null, 'rodadas']);
  const t = missionProgress(mission({ tasks: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'queued' }] }));
  assert.equal(t.pct, 50); assert.equal(t.basis, 'tarefas');
  assert.equal(missionProgress(mission({ status: 'completed', cycle: cycle({ status: 'completed', rounds: [{ n: 1, status: 'succeeded', phase: 'done', verification: 'passed' }] }) })).pct, 100);
  assert.equal(missionProgress(mission()).pct, null);
});

test('duração e custo: ativa conta até agora; custo ausente é null (nunca zero)', () => {
  const now = Date.parse('2026-11-10T10:05:30Z');
  assert.equal(missionDuration(mission({ cycle: cycle() }), now), 330_000);
  assert.equal(missionDuration(mission({ cycle: cycle({ status: 'completed', finishedAt: '2026-11-10T10:02:00Z' }) }), now), 120_000);
  assert.equal(missionDuration(mission(), now), null);
  assert.equal(missionDuration(mission({ cycle: cycle({ status: 'blocked' }) }), now), null, 'parada sem fim registrado: não inventa duração');
  assert.equal(fmtDuration(330_000), '5min 30s'); assert.equal(fmtDuration(45_000), '45s'); assert.equal(fmtDuration(3_900_000), '1h 05min'); assert.equal(fmtDuration(null), '—');
  const u = { byMission: [{ missionId: 'mis_1', total: { input: 10, output: 5, costUsd: 0.12, provisional: 0 }, byAgent: { planner: { input: 3, output: 1 }, executor: { input: 7, output: 4 } } }] };
  assert.deepEqual(missionUsage(u, 'mis_1'), { costUsd: 0.12, tokens: 15, planner: 4, executor: 11, partial: false });
  assert.equal(missionUsage(u, 'nada').costUsd, null); assert.equal(missionUsage(null, 'x').tokens, null);
  assert.equal(missionUsage({ byMission: [{ missionId: 'm', total: { input: 1, output: 1, costUsd: null } }] }, 'm').costUsd, null);
});

test('equipe: Planner e Executor + terminais RUNNING do workspace, com provedor e modelo reais', () => {
  const sessions = [
    { id: 't1', workspaceId: 'ws_1', status: 'running', provider: 'claude', providerLabel: 'Claude Code', role: 'builder', roleLabel: 'Builder', title: 'Builder', usage: { model: 'claude-sonnet-5-5' }, agent: { state: 'working' } },
    { id: 't2', workspaceId: 'ws_1', status: 'running', provider: 'codex', providerLabel: 'Codex CLI', role: 'reviewer', usage: null },
    { id: 't3', workspaceId: 'ws_1', status: 'exited', provider: 'claude', role: 'x' },
    { id: 't4', workspaceId: 'ws_outro', status: 'running', provider: 'claude', role: 'x' },
  ];
  const team = missionTeam(mission(), sessions);
  assert.deepEqual(team.map((a) => a.id), ['planner', 'executor', 't1', 't2']);
  assert.equal(team[0].model, null, 'o Planner roda em processo próprio: o modelo de um terminal NÃO é o dele');
  assert.equal(team[1].model, null); assert.equal(team[2].model, 'claude-sonnet-5-5', 'o modelo do terminal vale para o terminal');
  assert.equal(team[3].model, null); assert.equal(team[3].providerLabel, 'Codex CLI');
  assert.equal(missionTeam(mission(), [], {})[0].model, null);
  assert.equal(missionTeam(mission(), sessions, { stateOf: () => 'working' })[2].state, 'working');
});

test('groupMissions: só grupos com itens, urgentes primeiro, busca por nome/workspace', () => {
  const ms = [mission({ id: 'a', title: 'Alfa', status: 'completed', createdAt: '2026-11-01' }), mission({ id: 'b', title: 'Beta', status: 'awaiting_approval' }), mission({ id: 'c', title: 'Gama', status: 'running', workspaceId: 'ws_2' }), mission({ id: 'd', title: 'Delta', status: 'completed', createdAt: '2026-11-05' })];
  const ws = [{ id: 'ws_1', name: 'app' }, { id: 'ws_2', displayName: 'Site' }];
  const g = groupMissions(ms, { workspaces: ws });
  assert.deepEqual(g.map((x) => x.state), ['approval', 'working', 'completed']);
  assert.deepEqual(g.at(-1).items.map((r) => r.m.id), ['d', 'a'], 'mais recente primeiro');
  assert.equal(g[1].items[0].workspace, 'Site');
  assert.deepEqual(groupMissions(ms, { workspaces: ws, query: 'site' }).flatMap((x) => x.items.map((r) => r.m.id)), ['c']);
  assert.deepEqual(groupMissions(null), []);
});

const planWithParallel = () => cycle({
  plan: { id: 'plan_1', rationale: 'dividir', steps: [step('s1', { status: 'completed', round: 1, taskId: 'task_1' }), step('s2', { dependsOn: ['s1'], status: 'running', round: 2, taskId: 'task_2' }), step('s3', { dependsOn: ['s1'], status: 'queued' }), step('s4', { dependsOn: ['s2', 's3'] })] },
  rounds: [
    { n: 1, status: 'succeeded', phase: 'done', verification: 'passed', stepId: 's1', planId: 'plan_1', taskId: 'task_1', report: { status: 'completed', evidence: { level: 'verified', reasons: ['ok'] }, verifications: [{ id: 'test', status: 'pass', command: 'npm test' }], filesChanged: ['a.js', { path: 'b.js' }], summary: 'feito' } },
    { n: 2, status: 'running', phase: 'executing', stepId: 's2', planId: 'plan_1', taskId: 'task_2' },
  ],
});

test('workflow: Missão -> Planner -> etapas (paralelas por dependência) -> Entrega, com estados e arestas', () => {
  const m = mission({ cycle: planWithParallel(), tasks: [{ id: 'task_2', log: ['linha 1', 'linha 2'] }] });
  const wf = buildWorkflow(m), by = Object.fromEntries(wf.nodes.map((n) => [n.stepKey ?? n.id, n]));
  assert.deepEqual(wf.nodes.map((n) => n.id), ['mission', 'planner', 'step:s1', 'step:s2', 'step:s3', 'step:s4', 'delivery']);
  assert.deepEqual([by.mission.col, by.planner.col, by.s1.col, by.s2.col, by.s3.col, by.s4.col, by.delivery.col], [0, 1, 2, 3, 3, 4, 5]);
  assert.notEqual(by.s2.row, by.s3.row, 'tarefas paralelas em linhas distintas');
  assert.equal(by.s2.row + by.s3.row, 1, 'centradas');
  assert.deepEqual([by.s1.state, by.s2.state, by.s3.state, by.s4.state, by.delivery.state, by.planner.state], ['completed', 'working', 'idle', 'idle', 'idle', 'completed']);
  assert.equal(by.s1.stages.verify.state, 'completed'); assert.equal(by.s2.stages.exec.state, 'working');
  const e = Object.fromEntries(wf.edges.map((x) => [x.id, x.state]));
  assert.equal(e['planner>step:s1'], 'done'); assert.equal(e['step:s1>step:s2'], 'active'); assert.equal(e['step:s1>step:s3'], 'idle'); assert.ok(e['step:s4>delivery']);
  assert.deepEqual(parallelInfo(wf), { running: 1, queued: 2, maxLane: 2, steps: 4, phases: 3 });
  assert.deepEqual(parallelInfo(buildWorkflow(mission())), { running: 0, queued: 0, maxLane: 1, steps: 0, phases: 0 });
});

test('workflow: planner planejando, aprovação pendente na etapa, falha, cancelada e circular não trava', () => {
  assert.equal(buildWorkflow(mission({ cycle: cycle({ status: 'planning' }) })).nodes.find((n) => n.id === 'planner').state, 'working');
  // formato REAL do servidor: a solicitação nasce ANTES da rodada (round = rodadas+1) e leva stepId/planId da etapa que vai executar
  const c = planWithParallel(); c.status = 'blocked'; c.blockedCode = 'approval_required'; c.plan.steps[1].status = 'completed'; c.rounds[1] = { ...c.rounds[1], status: 'succeeded', phase: 'done', verification: 'passed' };
  c.approvals = [{ id: 'apr_1', status: 'pending', round: c.rounds.length + 1, stepId: 's3', planId: 'plan_1', digest: 'dg', action: { title: 'rodar script' }, rules: [{ id: 'R1' }] }];
  const m = mission({ status: 'blocked', cycle: c });
  const wfA = buildWorkflow(m), s3 = wfA.nodes.find((n) => n.stepKey === 's3');
  assert.equal(s3.state, 'approval'); assert.equal(s3.approvalId, 'apr_1');
  assert.deepEqual(wfA.nodes.filter((n) => n.state === 'approval').map((n) => n.id), ['step:s3'], 'só a etapa da aprovação');
  const det = nodeDetail(m, 'step:s3'); assert.equal(det.approval.digest, 'dg'); assert.deepEqual(det.approval.rules, ['R1']);
  // ciclo SEM plano: não há etapa para ligar, quem espera é o Planner
  const noPlan = mission({ status: 'blocked', cycle: cycle({ status: 'blocked', blockedCode: 'approval_required', rounds: [{ n: 1, status: 'succeeded', verification: 'passed', phase: 'done', taskId: 't1', plan: { title: 'A' } }], approvals: [{ id: 'apr_2', status: 'pending', round: 2, stepId: null, planId: null, digest: 'd2', action: { title: 'x' } }] }) });
  assert.equal(buildWorkflow(noPlan).nodes.find((n) => n.id === 'planner').state, 'approval'); assert.equal(nodeDetail(noPlan, 'planner').approval.id, 'apr_2');
  const items = controlItems(m);
  assert.deepEqual(items.map((i) => [i.kind, i.scope, i.digest, i.rules]), [['approval', 'cycle', 'dg', ['R1']]]);
  const f = planWithParallel(); f.plan.steps[1].status = 'failed'; f.rounds[1] = { ...f.rounds[1], status: 'failed', phase: 'done' };
  assert.equal(buildWorkflow(mission({ status: 'failed', cycle: f })).nodes.find((n) => n.stepKey === 's2').state, 'attention');
  const cancelled = buildWorkflow(mission({ status: 'cancelled', cycle: { ...planWithParallel(), status: 'cancelled' } })), cn = Object.fromEntries(cancelled.nodes.map((n) => [n.stepKey ?? n.id, n.state]));
  assert.equal(cn.s2, 'cancelled'); assert.equal(cn.s3, 'cancelled'); assert.equal(cn.s1, 'completed'); assert.equal(cn.delivery, 'cancelled');
  const loop = cycle({ plan: { steps: [step('x', { dependsOn: ['y'] }), step('y', { dependsOn: ['x'] })] } });
  assert.ok(buildWorkflow(mission({ cycle: loop })).nodes.length >= 4);
});

test('workflow sem plano: rodadas viram etapas em sequência; sem ciclo: tarefas manuais com dependências; vazio é válido', () => {
  const r = buildWorkflow(mission({ cycle: cycle({ rounds: [{ n: 1, status: 'succeeded', verification: 'passed', phase: 'done', taskId: 't1', plan: { title: 'A' } }, { n: 2, status: 'running', taskId: 't2', plan: { title: 'B' } }] }) }));
  assert.deepEqual(r.nodes.filter((n) => n.kind === 'step').map((n) => [n.title, n.state, n.col]), [['A', 'completed', 2], ['B', 'working', 3]]);
  const t = buildWorkflow(mission({ tasks: [{ id: 't1', title: 'um', status: 'completed', dependsOn: [] }, { id: 't2', title: 'dois', status: 'awaiting_approval', dependsOn: ['t1'] }] }));
  assert.equal(t.nodes.find((n) => n.stepKey === 't2').state, 'approval'); assert.equal(nodeIdForTask(t, 't2'), 'step:t2');
  assert.deepEqual(controlItems(mission({ tasks: [{ id: 't2', title: 'dois', status: 'awaiting_approval' }] })).map((i) => [i.kind, i.scope, i.id]), [['approval', 'task', 't2']]);
  const empty = buildWorkflow(mission());
  assert.deepEqual(empty.nodes.map((n) => n.id), ['mission', 'planner', 'delivery']); assert.equal(empty.nodes[0].state, 'idle'); assert.equal(empty.edges.length, 2);
  assert.doesNotThrow(() => buildWorkflow(null)); assert.doesNotThrow(() => buildWorkflow({}));
});

test('roundStages: execução e verificação são camadas separadas', () => {
  assert.equal(roundStages(null).exec.state, 'idle');
  assert.deepEqual(roundStages({ status: 'succeeded', verification: 'failed', phase: 'done' }), { exec: { state: 'completed', label: 'executada' }, verify: { state: 'attention', label: 'falhou' } });
  assert.equal(roundStages({ status: 'succeeded', phase: 'verifying' }).verify.state, 'working');
  assert.equal(roundStages({ status: 'running' }).verify.label, 'aguardando');
  assert.equal(roundStages({ status: 'succeeded', verification: 'passed', phase: 'done', report: { verificationsInterrupted: 'x' } }).verify.label, 'não rodou');
  assert.equal(roundStages({ status: 'interrupted' }).exec.state, 'attention');
});

test('nodeDetail: agente, atividade, evidências, arquivos e aprovação, só do que está gravado', () => {
  const m = mission({ cycle: planWithParallel(), tasks: [{ id: 'task_1', log: Array.from({ length: 20 }, (_, i) => `l${i}`), error: null }] });
  const d = nodeDetail(m, 'step:s1', { sessions: [], activity: [] });
  assert.equal(d.agent.name, 'Executor'); assert.equal(d.activity.length, 12); assert.equal(d.activity.at(-1), 'l19');
  assert.equal(d.evidence.level, 'verified'); assert.deepEqual(d.evidence.verifications, [{ id: 'test', status: 'pass', command: 'npm test' }]);
  assert.deepEqual(d.files, ['a.js', 'b.js']); assert.equal(d.evidence.summary, 'feito');
  assert.equal(nodeDetail(m, 'planner').facts[0][1], '2');
  assert.equal(nodeDetail(m, 'inexistente'), null);
  const act = [{ id: 'x', missionId: 'mis_1', message: 'Rodada 1 planejada', agent: 'planner', at: '2026-11-10T10:00:01Z' }, { id: 'y', missionId: 'outra', message: 'não é daqui' }];
  assert.deepEqual(nodeDetail(m, 'planner', { activity: act }).activity, ['Rodada 1 planejada']);
  assert.deepEqual(missionFeed(act, 'mis_1').map((x) => x.id), ['x']);
  const blocked = mission({ status: 'blocked', cycle: cycle({ status: 'blocked', blockedCode: 'planner_blocked', blockedReason: 'Planner sem saída' }) });
  assert.deepEqual(nodeDetail(blocked, 'planner').errors, ['Planner sem saída']); assert.equal(attentionReason(blocked), 'Planner sem saída');
});

test('cycleActions: espelham o que o servidor aceita', () => {
  assert.deepEqual(cycleActions(mission()), { start: true, cancel: false, resume: false, remove: true });
  assert.deepEqual(cycleActions(mission({ cycle: cycle() })), { start: false, cancel: true, resume: false, remove: false });
  assert.deepEqual(cycleActions(mission({ cycle: cycle({ status: 'blocked', blockedCode: 'executor_failures' }) })), { start: false, cancel: true, resume: true, remove: true });
  assert.equal(cycleActions(mission({ cycle: cycle({ status: 'completed' }) })).start, true);
});

test('etapa com id igual ao de um nó fixo (planner, mission, delivery) não colide', () => {
  const c = cycle({ plan: { id: 'plan_x', steps: [step('planner'), step('mission', { dependsOn: ['planner'] }), step('delivery', { dependsOn: ['mission'] })] } });
  const wf = buildWorkflow(mission({ cycle: c })), ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos'); assert.ok(ids.includes('step:planner') && ids.includes('step:delivery'));
  assert.equal(nodeDetail(mission({ cycle: c }), 'step:planner').kind, 'step'); assert.equal(nodeDetail(mission({ cycle: c }), 'planner').kind, 'planner');
});

test('sem plano, só evidência VERIFICADA conclui a etapa (como plan.js); inconclusiva/falha não conta no progresso', () => {
  const R = (n, ev, o = {}) => ({ n, status: 'succeeded', phase: 'done', verification: 'passed', taskId: 't' + n, plan: { title: 'R' + n }, report: ev ? { evidence: { level: ev } } : {}, ...o });
  assert.equal(roundStepStatus(R(1, 'verified')), 'completed'); assert.equal(roundStepStatus(R(1, null)), 'completed', 'rodada antiga sem evidência mantém a regra anterior');
  assert.equal(roundStepStatus(R(1, 'inconclusive')), 'unverified'); assert.equal(roundStepStatus(R(1, 'failed')), 'failed');
  assert.equal(roundStepStatus(R(1, 'verified', { verification: 'failed' })), 'failed'); assert.equal(roundStepStatus(R(1, 'verified', { verification: 'skipped' })), 'failed');
  assert.equal(roundStepStatus({ n: 1, status: 'succeeded', phase: 'verifying' }), 'running'); assert.equal(roundStepStatus({ status: 'interrupted' }), 'interrupted'); assert.equal(roundStepStatus(null), 'queued');
  const m = mission({ cycle: cycle({ rounds: [R(1, 'verified'), R(2, 'inconclusive')] }) });
  assert.equal(missionProgress(m).done, 1, 'a inconclusiva não avança o progresso');
  const wf = buildWorkflow(m); assert.deepEqual(wf.nodes.filter((n) => n.kind === 'step').map((n) => n.state), ['completed', 'attention']);
});

test('ciclo bloqueado em approval_required: pendente decide; decidida, só retomar (aprovar não executa); cancelar vale bloqueado; limit_reached permite novo ciclo', () => {
  const blocked = (approvals) => mission({ status: 'blocked', cycle: cycle({ status: 'blocked', blockedCode: 'approval_required', blockedReason: 'só será executada depois da sua aprovação', approvals }) });
  const pending = blocked([{ id: 'a1', status: 'pending', round: 2, digest: 'd', action: { title: 'x' } }]);
  assert.deepEqual(cycleActions(pending), { start: false, cancel: true, resume: false, remove: true });
  assert.deepEqual(controlItems(pending).map((i) => i.kind), ['approval']);
  const decided = blocked([{ id: 'a1', status: 'approved', decidedAt: '2026-11-10T10:05:00Z', round: 2, digest: 'd', action: { title: 'x' } }]);
  assert.equal(cycleActions(decided).resume, true, 'depois de decidir, o caminho é retomar');
  const items = controlItems(decided); assert.deepEqual(items.map((i) => i.kind), ['resume']); assert.match(items[0].detail, /NÃO foi executada/); assert.match(items[0].detail, /aprovada/);
  assert.match(controlItems(blocked([{ id: 'a1', status: 'rejected', decidedAt: '2026-11-10T10:05:00Z' }]))[0].detail, /rejeitada/);
  assert.equal(cycleActions(mission({ cycle: cycle({ status: 'limit_reached' }) })).start, true);
});

// ---------- workflow do squad: tarefas do Maestro (PARTE A do Mission Control) ----------
const sess = (id, o = {}) => ({ id, workspaceId: 'ws_1', status: 'running', provider: 'claude', providerLabel: 'Claude Code', role: 'builder', roleLabel: 'Construtor', title: `Pane ${id}`, model: 'claude-sonnet-5-5', effort: 'high', ...o });
const mt = (id, to, createdAt, o = {}) => ({ id, to, toRole: 'builder', toTitle: `Pane ${to}`, status: 'delivered', text: `Fazer ${id}\nsegunda linha`, taskType: null, summary: null, note: null, createdAt, doneAt: null, ...o });
const T0 = '2026-11-11T10:00:00.000Z', at = (s) => new Date(Date.parse(T0) + s * 1000).toISOString();
const sessions = [sess('p1'), sess('p2', { provider: 'codex', providerLabel: 'Codex CLI', model: null, effort: null, roleLabel: 'Revisor', role: 'reviewer' }), sess('pm', { role: 'maestro', roleLabel: 'Maestro', title: 'Maestro' }), sess('px', { workspaceId: 'ws_outro' })];
const squadWf = (tasks, o = {}) => buildWorkflow(mission(o.mission), { sessions: o.sessions ?? sessions, maestro: { autonomous: false, tasks } });
const taskNodes = (wf) => wf.nodes.filter((n) => n.kind === 'task');

test('squad: N tarefas paralelas = N ramos saindo do Maestro e chegando na Entrega', () => {
  const wf = squadWf([mt('a', 'p1', at(0)), mt('b', 'p2', at(5)), mt('c', 'p1', at(9))]);
  assert.deepEqual(wf.nodes.map((n) => n.id), ['mission', 'maestro', 'task:a', 'task:b', 'task:c', 'delivery']);
  assert.deepEqual(taskNodes(wf).map((n) => n.col), [2, 2, 2], 'mesma fase');
  assert.equal(new Set(taskNodes(wf).map((n) => n.row)).size, 3, 'linhas distintas');
  assert.deepEqual(wf.edges.filter((e) => e.from === 'maestro').map((e) => e.to), ['task:a', 'task:b', 'task:c']);
  assert.deepEqual(wf.edges.filter((e) => e.to === 'delivery').map((e) => e.from), ['task:a', 'task:b', 'task:c']);
  assert.equal(wf.edges.some((e) => e.from.startsWith('task:') && e.to.startsWith('task:')), false, 'sem dependência entre elas');
  assert.deepEqual(parallelInfo(wf), { running: 3, queued: 0, maxLane: 3, steps: 3, phases: 1 });
  assert.ok(wf.nodes.every((n) => n.source === 'squad'));
});

test('squad: sequência (uma concluída antes da próxima nascer) = linha reta, sem aresta redundante', () => {
  const wf = squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(10), summary: 'ok' }), mt('b', 'p2', at(20), { status: 'done', doneAt: at(30) }), mt('c', 'p1', at(40))]);
  assert.deepEqual(taskNodes(wf).map((n) => n.col), [2, 3, 4], 'fases em sequência');
  assert.equal(new Set(wf.nodes.map((n) => n.row)).size, 1, 'tudo na mesma linha');
  assert.deepEqual(wf.edges.map((e) => e.id), ['mission>maestro', 'maestro>task:a', 'task:a>task:b', 'task:b>task:c', 'task:c>delivery'], 'A->C não é desenhada: já passa por B');
  assert.equal(wf.nodes.find((n) => n.id === 'delivery').col, 5);
});

test('squad: ramos que se juntam (join) e dependência só por doneAt <= createdAt', () => {
  const wf = squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(10) }), mt('b', 'p2', at(2), { status: 'done', doneAt: at(12) }), mt('c', 'p1', at(20)), mt('d', 'p2', at(5))]);
  const col = Object.fromEntries(taskNodes(wf).map((n) => [n.taskId, n.col]));
  assert.deepEqual(col, { a: 2, b: 2, d: 2, c: 3 }, 'd nasceu antes de a/b terminarem: não depende deles');
  assert.deepEqual(wf.edges.filter((e) => e.to === 'task:c').map((e) => e.from).sort(), ['task:a', 'task:b']);
  const eq = squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(10) }), mt('b', 'p2', at(10))]);
  assert.ok(eq.edges.some((e) => e.id === 'task:a>task:b'), 'doneAt igual a createdAt conta como antes');
  const same = squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(0) }), mt('b', 'p2', at(0), { status: 'done', doneAt: at(0) })]);
  assert.equal(same.nodes.length, 5, 'timestamps iguais não fazem ciclo nem travam');
});

test('squad: status do Maestro -> estado do nó (pending=aprovação, entregue=trabalhando, done=concluída, recusada/expirada/falha=atenção)', () => {
  const wf = squadWf([mt('a', 'p1', at(0), { status: 'pending' }), mt('b', 'p1', at(1), { status: 'delivered' }), mt('c', 'p1', at(2), { status: 'done', doneAt: at(3) }), mt('d', 'p1', at(1), { status: 'rejected' }), mt('e', 'p1', at(1), { status: 'expired' }), mt('f', 'p1', at(1), { status: 'failed' }), mt('g', 'p1', at(1), { status: 'estranho' })]);
  const st = Object.fromEntries(taskNodes(wf).map((n) => [n.taskId, n.state]));
  assert.deepEqual(st, { a: 'approval', b: 'working', c: 'completed', d: 'attention', e: 'attention', f: 'attention', g: 'idle' });
  assert.deepEqual(Object.keys(TASK_STATUS_LABEL).sort(), ['delivered', 'done', 'expired', 'failed', 'pending', 'rejected']);
  const e = Object.fromEntries(wf.edges.map((x) => [x.id, x.state]));
  assert.equal(e['maestro>task:b'], 'active'); assert.equal(e['maestro>task:a'], 'wait'); assert.equal(e['maestro>task:d'], 'err');
  assert.equal(wf.nodes.find((n) => n.id === 'maestro').state, 'working', 'há tarefas em andamento');
  assert.equal(squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(1) })]).nodes.find((n) => n.id === 'delivery').state, 'completed');
  assert.equal(squadWf([mt('a', 'p1', at(0), { status: 'done', doneAt: at(1) })], { mission: { status: 'cancelled' } }).nodes.find((n) => n.id === 'delivery').state, 'cancelled');
});

test('squad: agent, currentTask e terminalId; ausente vira null (nada inventado)', () => {
  const wf = squadWf([mt('a', 'p1', at(0)), mt('b', 'p2', at(1), { status: 'done', doneAt: at(2), text: 'x'.repeat(300) }), mt('c', 'p1', at(40), { status: 'pending' })]);
  const a = wf.nodes.find((n) => n.id === 'task:a'), b = wf.nodes.find((n) => n.id === 'task:b'), c = wf.nodes.find((n) => n.id === 'task:c');
  assert.deepEqual(a.agent, { name: 'Pane p1', role: 'Construtor', provider: 'claude', providerLabel: 'Claude Code', model: 'claude-sonnet-5-5', effort: 'high' });
  assert.equal(a.terminalId, 'p1'); assert.equal(a.currentTask, 'Fazer a', 'primeira linha do texto, só quando trabalhando');
  assert.equal(b.agent.provider, 'codex'); assert.equal(b.agent.model, null); assert.equal(b.agent.effort, null, 'a sessão não informou: null');
  assert.equal(b.currentTask, null, 'concluída não tem tarefa atual'); assert.equal(c.currentTask, null, 'pendente também não');
  const long = squadWf([mt('z', 'p1', at(0), { text: 'y'.repeat(300) })]).nodes.find((n) => n.id === 'task:z');
  assert.equal(long.currentTask.length, 120);
  const maestro = wf.nodes.find((n) => n.id === 'maestro');
  assert.equal(maestro.agent.name, 'Maestro'); assert.equal(maestro.terminalId, 'pm'); assert.equal(maestro.kind, 'maestro');
  const gone = squadWf([mt('a', 'p1', at(0))], { sessions: [sess('p1', { status: 'exited' })] });
  assert.equal(gone.nodes.find((n) => n.id === 'task:a').terminalId, null, 'terminal encerrado não é aberto'); assert.equal(gone.nodes.find((n) => n.id === 'maestro').agent, null);
  const noUsage = squadWf([mt('a', 'p1', at(0))], { sessions: [sess('p1', { model: null, usage: { model: 'claude-x' } })] });
  assert.equal(noUsage.nodes.find((n) => n.id === 'task:a').agent.model, 'claude-x', 'sem model na sessão, usa o que o terminal reportou');
});

test('squad: só tarefas de panes do workspace da missão; sem nenhuma, cai no grafo do ciclo', () => {
  const wf = squadWf([mt('a', 'p1', at(0)), mt('outra', 'px', at(1)), mt('fantasma', 'nao-existe', at(2))]);
  assert.deepEqual(taskNodes(wf).map((n) => n.taskId), ['a']);
  for (const maestro of [null, { tasks: [] }, { tasks: [mt('so-outro', 'px', at(0))] }, { tasks: 'lixo' }]) {
    const f = buildWorkflow(mission({ cycle: planWithParallel() }), { sessions, maestro });
    assert.ok(f.nodes.some((n) => n.id === 'planner') && !f.nodes.some((n) => n.kind === 'maestro'), 'ciclo');
  }
  assert.doesNotThrow(() => buildWorkflow(mission(), { sessions: null, maestro: { tasks: [{ id: null }, null, 5] } }));
  assert.deepEqual(buildWorkflow(mission()).nodes.map((n) => n.id), ['mission', 'planner', 'delivery'], 'sem ctx: igual a antes');
});

test('ciclo (fallback): agent, currentTask, terminalId e source; modelo e esforço do Planner/Executor são null', () => {
  const wf = buildWorkflow(mission({ cycle: planWithParallel() }), { sessions, maestro: null });
  assert.ok(wf.nodes.every((n) => n.source === 'ciclo' && n.terminalId === null && 'agent' in n && 'currentTask' in n));
  const planner = wf.nodes.find((n) => n.id === 'planner'), s2 = wf.nodes.find((n) => n.id === 'step:s2'), s1 = wf.nodes.find((n) => n.id === 'step:s1');
  assert.deepEqual(planner.agent, { name: 'Planner', role: 'Decide a próxima etapa', provider: 'claude', providerLabel: 'Claude Code', model: null, effort: null });
  assert.equal(s2.agent.name, 'Executor'); assert.equal(s2.agent.model, null, 'o modelo do terminal não é o do ciclo'); assert.equal(s2.agent.effort, null);
  assert.equal(s2.currentTask, 'Etapa s2'); assert.equal(s1.currentTask, null, 'concluída não tem tarefa atual');
  assert.equal(wf.nodes.find((n) => n.id === 'mission').agent, null); assert.equal(wf.nodes.find((n) => n.id === 'delivery').agent, null);
  assert.equal(buildWorkflow(mission({ cycle: cycle({ status: 'planning' }) })).nodes.find((n) => n.id === 'planner').currentTask, 'Planejando a próxima etapa');
});

test('nodeDetail com ctx do Maestro: agent, terminalId, context e errors da tarefa; ciclo mantém campos e ganha os novos', () => {
  const tasks = [mt('a', 'p1', at(0), { status: 'done', doneAt: at(5), summary: 'Feito. Arquivos: a.js', taskType: 'new-feature' }), mt('b', 'p2', at(10), { status: 'failed', note: 'O terminal acabou antes de concluir a tarefa.' }), mt('c', 'p1', at(11), { status: 'rejected' })];
  const ctx = { sessions, maestro: { tasks }, activity: [] }, m = mission();
  const a = nodeDetail(m, 'task:a', ctx);
  assert.equal(a.agent.name, 'Pane p1'); assert.equal(a.terminalId, 'p1'); assert.match(a.context, /^Fazer a/); assert.deepEqual(a.errors, []);
  assert.ok(a.facts.some(([k, v]) => k === 'Estado' && v === 'concluída') && a.facts.some(([k]) => k === 'Resumo do agente'));
  assert.deepEqual(nodeDetail(m, 'task:b', ctx).errors, ['O terminal acabou antes de concluir a tarefa.']);
  assert.deepEqual(nodeDetail(m, 'task:c', ctx).errors, ['Recusada pelo usuário.']);
  assert.equal(nodeDetail(m, 'maestro', ctx).agent.name, 'Maestro'); assert.equal(nodeDetail(m, 'maestro', ctx).terminalId, 'pm');
  assert.equal(nodeDetail(m, 'task:zzz', ctx), null);
  assert.equal(nodeDetail(m, 'task:a', { sessions, activity: [] }), null, 'sem o ctx do Maestro, o nó da tarefa não existe');
  const cyc = mission({ cycle: planWithParallel(), tasks: [{ id: 'task_2', log: ['l'] }] }), d = nodeDetail(cyc, 'step:s2', { sessions, maestro: null });
  assert.equal(d.agent.name, 'Executor'); assert.equal(d.terminalId, null); assert.equal(d.context, d.instructions); assert.deepEqual(d.errors, []);
  assert.equal(nodeDetail(cyc, 'planner').agent.model, null); assert.equal(nodeDetail(cyc, 'mission').agent, null);
  assert.equal(nodeIdForTask(squadWf(tasks), 'a'), 'task:a');
});

// ---------- correções pós-revisão: filtro por tempo, payload real do /api/maestro e pane que sumiu ----------
test('squad: tarefa antiga (criada antes do início da missão) não vira nó; data ausente ou inválida não descarta', () => {
  const old = mt('velha', 'p1', '2026-11-09T09:00:00.000Z', { status: 'done', doneAt: '2026-11-09T09:30:00.000Z' }), now = mt('nova', 'p1', at(0));
  assert.deepEqual(taskNodes(squadWf([old, now])).map((n) => n.taskId), ['nova'], 'sem ciclo: corta pelo createdAt da missão (2026-11-10T10:00)');
  // com ciclo: vale cycle.startedAt (mais tarde que a criação da missão)
  const cyc = { mission: { cycle: cycle({ startedAt: at(100) }) } };
  assert.deepEqual(taskNodes(squadWf([mt('antes', 'p1', at(50)), mt('depois', 'p1', at(150))], cyc)).map((n) => n.taskId), ['depois']);
  assert.deepEqual(taskNodes(squadWf([mt('igual', 'p1', at(100))], cyc)).map((n) => n.taskId), ['igual'], 'criada no instante do início conta');
  // só tarefas antigas: o squad some e volta o grafo do ciclo
  const onlyOld = buildWorkflow(mission({ cycle: planWithParallel() }), { sessions, maestro: { tasks: [old] } });
  assert.ok(onlyOld.nodes.some((n) => n.id === 'planner') && !onlyOld.nodes.some((n) => n.kind === 'maestro'));
  // datas ausentes/inválidas
  assert.deepEqual(taskNodes(squadWf([mt('semdata', 'p1', null), mt('lixo', 'p1', 'nao-e-data')])).map((n) => n.taskId).sort(), ['lixo', 'semdata'], 'tarefa sem data válida não é descartada');
  assert.deepEqual(taskNodes(squadWf([old, now], { mission: { createdAt: undefined } })).map((n) => n.taskId).sort(), ['nova', 'velha'], 'missão sem data: nada é cortado');
  assert.deepEqual(taskNodes(squadWf([old], { mission: { createdAt: 'lixo' } })).map((n) => n.taskId), ['velha']);
});

test('squad: payload no formato REAL do snapshot de /api/maestro (JSON cru do store) — sequência vira linha reta', () => {
  const snapshot = JSON.parse(JSON.stringify({
    autonomous: true, autoPerMinute: 6,
    tasks: [ // server/maestro.js: snapshot() = tasks.slice(-50).reverse(): a MAIS RECENTE primeiro
      { id: 'task_c3', to: 'p1', toRole: 'builder', toTitle: 'Pane p1', status: 'delivered', text: 'Terceira: integrar', taskType: 'new-feature', summary: null, note: null, createdAt: at(300), from: 'pm', decidedBy: 'auto', decidedAt: at(301), doneAt: null },
      { id: 'task_b2', to: 'p2', toRole: 'reviewer', toTitle: 'Pane p2', status: 'done', text: 'Segunda: revisar', taskType: null, summary: 'Revisado, sem bloqueios.', note: null, createdAt: at(120), from: 'pm', decidedBy: 'user', decidedAt: at(125), doneAt: at(200) },
      { id: 'task_a1', to: 'p1', toRole: 'builder', toTitle: 'Pane p1', status: 'done', text: 'Primeira: implementar', taskType: 'new-feature', summary: 'Feito.', note: null, createdAt: at(0), from: 'pm', decidedBy: 'user', decidedAt: at(5), doneAt: at(100) },
    ],
  }));
  const wf = buildWorkflow(mission(), { sessions, maestro: snapshot });
  assert.deepEqual(taskNodes(wf).map((n) => [n.taskId, n.col, n.state]), [['task_a1', 2, 'completed'], ['task_b2', 3, 'completed'], ['task_c3', 4, 'working']], 'ordem de criação, não a do payload');
  assert.equal(new Set(wf.nodes.map((n) => n.row)).size, 1, 'linha reta');
  assert.deepEqual(wf.edges.map((e) => e.id), ['mission>maestro', 'maestro>task:task_a1', 'task:task_a1>task:task_b2', 'task:task_b2>task:task_c3', 'task:task_c3>delivery']);
  assert.equal(wf.edges.find((e) => e.id === 'task:task_b2>task:task_c3').state, 'active');
  assert.equal(nodeDetail(mission(), 'task:task_b2', { sessions, maestro: snapshot }).facts.find(([k]) => k === 'Resumo do agente')[1], 'Revisado, sem bloqueios.');
});

test('squad: pane que sumiu da lista — a tarefa fica se o remetente ou outra tarefa ligada a vincula ao workspace; sem pista, é descartada', () => {
  const gone = [sess('pm', { role: 'maestro', roleLabel: 'Maestro', title: 'Maestro' })]; // p1 foi fechado: não está mais em /api/terminals
  // (a) pane ainda na lista, mesmo encerrado (exited): fica, sem terminal para abrir
  const exited = squadWf([mt('a', 'p1', at(0), { from: 'pm' })], { sessions: [...gone, sess('p1', { status: 'exited' })] }).nodes.find((n) => n.id === 'task:a');
  assert.ok(exited); assert.equal(exited.terminalId, null); assert.equal(exited.agent.name, 'Pane p1');
  // (b) pane fechado, mas o remetente (Maestro do workspace) está na lista: a tarefa fica, sem agente nem terminal (null), com o destino gravado
  const wf = squadWf([mt('b', 'p1', at(0), { from: 'pm', status: 'done', doneAt: at(10) })], { sessions: gone });
  const b = wf.nodes.find((n) => n.id === 'task:b');
  assert.ok(b, 'tarefa de pane fechado mantida'); assert.equal(b.agent, null); assert.equal(b.terminalId, null); assert.equal(b.subtitle, 'Pane p1'); assert.equal(b.state, 'completed');
  assert.equal(nodeDetail(mission(), 'task:b', { sessions: gone, maestro: { tasks: [mt('b', 'p1', at(0), { from: 'pm' })] } }).agent, null);
  // (c) o MESMO `to` em outra tarefa já ligada (remetente que também fechou): fica
  const c = squadWf([mt('c1', 'p1', at(0), { from: 'pm', status: 'done', doneAt: at(5) }), mt('c2', 'p1', at(10), { from: 'pm-fechado' })], { sessions: gone });
  assert.deepEqual(taskNodes(c).map((n) => n.taskId), ['c1', 'c2']);
  // (d) sem pista nenhuma (pane e remetente desconhecidos): descartada, e o grafo volta a ser o do ciclo
  assert.deepEqual(taskNodes(squadWf([mt('d', 'p-desconhecido', at(0), { from: 'quem-sabe' })], { sessions: gone })), []);
  assert.ok(buildWorkflow(mission({ cycle: planWithParallel() }), { sessions: gone, maestro: { tasks: [mt('d', 'p-desconhecido', at(0))] } }).nodes.some((n) => n.id === 'planner'));
  // (e) pane de OUTRO workspace nunca é puxado, nem que o remetente seja do workspace
  assert.deepEqual(taskNodes(squadWf([mt('e', 'px', at(0), { from: 'pm' })], { sessions: [...gone, sess('px', { workspaceId: 'ws_outro' })] })), []);
});
