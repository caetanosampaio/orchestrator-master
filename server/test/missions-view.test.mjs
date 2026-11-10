// Visão da página Missões (client/src/missions-view.js): estados, progresso, custo, equipe, agrupamento e o grafo do workflow, só a partir de dados do servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionState, STATE_META, MISSION_STATES, missionProgress, missionDuration, fmtDuration, missionUsage, missionTeam, groupMissions, buildWorkflow, roundStages, nodeDetail, controlItems, cycleActions, parallelInfo, missionFeed, attentionReason, roundStepStatus, nodeIdForTask } from '../../client/src/missions-view.js';

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
  assert.equal(d.agent.id, 'executor'); assert.equal(d.activity.length, 12); assert.equal(d.activity.at(-1), 'l19');
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
