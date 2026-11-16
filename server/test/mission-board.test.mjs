// Quadro da missão (client/src/mission-board.js): view-model da página Missões de cima para baixo (ondas, progresso, entrega, gaveta, briefing).
// Funções puras, sem rede: nada aqui sobe servidor nem toca em dados reais.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBoard, computeWaves, groupWaves, routeView, drawerModel, pinBody, pinUrl, acceptanceOffer, acceptanceBody, proposalBoard, briefingState, approveBody,
  stepStateLabel, effortLabel, deliveryFiles, NOT_INFORMED, TIER_LABEL,
} from '../../client/src/mission-board.js';

const TIERS = { leve: { model: 'claude-haiku-5-5', effort: 'low' }, padrao: { model: 'claude-sonnet-5-5', effort: 'medium' }, profunda: { model: 'claude-opus-5-5', effort: 'high' } };
const route = (tier, source = 'planner') => ({ tier, model: TIERS[tier].model, effort: TIERS[tier].effort, source });
const step = (id, o = {}) => ({ id, title: `Etapa ${id.toUpperCase()}`, instructions: `Fazer ${id}`, acceptance: [`${id} existe`], dependsOn: [], agent: 'code', status: 'queued', round: null, taskId: null, ...o });
const cycle = (o = {}) => ({ id: 'cyc_1', status: 'running', maxIterations: 6, rounds: [], approvals: [], plannerCalls: 1, startedAt: '2026-11-10T10:00:00Z', finishedAt: null, ...o });
const mission = (o = {}) => ({ id: 'mis_1', title: 'Missão', objective: 'Fazer X', workspaceId: 'ws_1', createdAt: '2026-11-10T10:00:00Z', status: 'running', tasks: [], ...o });
const round = (n, stepId, o = {}) => ({ n, stepId, planId: 'plan_1', taskId: `task_${n}`, status: 'succeeded', phase: 'done', verification: 'passed', report: { evidence: { level: 'verified' }, filesChanged: [`src/${stepId}.js`], summary: 'feito' }, ...o });
const plan = (steps, o = {}) => ({ id: 'plan_1', rationale: 'porque sim', steps, ...o });

// Plano de 3 ondas: A -> (B, C em paralelo) -> D
const steps4 = (st = {}) => [
  step('a', { status: st.a ?? 'queued', wave: 1, role: 'analise', tier: 'leve', route: route('leve') }),
  step('b', { status: st.b ?? 'queued', wave: 2, dependsOn: ['a'], role: 'implementacao', tier: 'padrao', route: route('padrao') }),
  step('c', { status: st.c ?? 'queued', wave: 2, dependsOn: ['a'], role: 'testes', tier: 'profunda', route: route('profunda') }),
  step('d', { status: st.d ?? 'queued', wave: 3, dependsOn: ['b', 'c'], role: 'revisao', route: route('padrao', 'default') }),
];
const planMission = (st = {}, o = {}, c = {}) => mission({ cycle: cycle({ plan: plan(steps4(st)), ...c }), ...o });

test('missão sem ciclo e sem tarefas: tela de espera, sem etapas, sem total', () => {
  const b = buildBoard(mission({ status: 'queued' }));
  assert.equal(b.kind, 'none'); assert.equal(b.empty, true);
  assert.deepEqual(b.waves, []); assert.equal(b.progress.total, null); assert.equal(b.progress.pct, null);
  assert.equal(b.progress.headline, 'A missão ainda não começou.');
  assert.equal(b.actions.start, true);
  assert.match(b.note, /Iniciar/);
  assert.equal(b.delivery.state, 'pending'); assert.equal(b.delivery.assurance, null); assert.equal(b.delivery.assuranceLabel, null);
  assert.equal(buildBoard(null).kind, 'none', 'dado ausente não quebra');
  assert.equal(buildBoard(mission({ cycle: cycle({ status: 'planning' }) })).note, 'O Planner está montando o plano.');
});

test('plano com 2 ondas em paralelo: ondas, rotas reais, rótulos e conectores', () => {
  const b = buildBoard(planMission(), { tiers: TIERS });
  assert.equal(b.kind, 'plan');
  assert.deepEqual(b.waves.map((w) => [w.label, w.steps.map((s) => s.id), w.parallel]), [['Onda 1', ['a'], 1], ['Onda 2', ['b', 'c'], 2], ['Onda 3', ['d'], 1]]);
  const [a, bb, c, d] = b.steps;
  assert.deepEqual([a.roleLabel, a.route.tierLabel, a.route.model, a.route.effort, a.route.source], ['Análise', 'leve', 'claude-haiku-5-5', 'low', 'planner']);
  assert.deepEqual([bb.roleLabel, bb.route.model], ['Implementação', 'claude-sonnet-5-5']);
  assert.deepEqual([c.roleLabel, c.route.tierLabel, c.route.model], ['Testes', 'profunda', 'claude-opus-5-5']);
  assert.equal(d.route.source, 'default'); assert.equal(d.route.sourceLabel, 'padrão');
  assert.deepEqual(b.waves.map((w) => w.state), ['pending', 'pending', 'pending']);
  assert.deepEqual(b.waves.map((w) => w.link), ['idle', 'idle', 'idle']);
  assert.deepEqual(b.waves.map((w) => w.out), ['idle', 'idle', null], 'o trilho desenha o conector que SAI de cada onda; a última não tem');
  assert.deepEqual(b.steps.map((s) => s.stateLabel), ['Na fila', 'Na fila', 'Na fila', 'Na fila']);
  assert.equal(b.progress.headline, 'Próxima etapa: “Etapa A”.');
  assert.deepEqual(b.progress.next.map((n) => n.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(b.steps[3].deps, ['b', 'c']);
});

test('etapa em execução: destaque, conector ativo e a frase "Agora / Depois"', () => {
  const m = planMission({ a: 'completed', b: 'running' }, {}, { rounds: [round(1, 'a'), { n: 2, stepId: 'b', planId: 'plan_1', taskId: 'task_2', status: 'running', route: route('padrao') }] });
  const b = buildBoard(m, { tiers: TIERS });
  assert.equal(b.steps[1].state, 'working'); assert.equal(b.steps[1].stateLabel, 'Em execução');
  assert.equal(b.steps[0].state, 'completed');
  assert.deepEqual(b.waves.map((w) => w.state), ['done', 'active', 'pending']);
  assert.deepEqual(b.waves.map((w) => w.link), ['idle', 'active', 'idle'], 'o conector que entra na onda 2 está ativo; o da onda 3 ainda não');
  assert.deepEqual(b.waves.map((w) => w.out), ['active', 'idle', null]);
  assert.deepEqual([b.progress.done, b.progress.total, b.progress.pct, b.progress.current], [1, 4, 25, 'b']);
  assert.equal(b.progress.headline, 'Agora: “Etapa B”. Depois: “Etapa C”.');
  assert.deepEqual(b.progress.items.map((i) => i.marker), ['done', 'current', 'next', 'next']);
  assert.equal(b.steps[1].attempts, 1);
});

test('etapa concluída: ✓, conector desenhado até a próxima onda; tudo concluído = frase final', () => {
  const m = planMission({ a: 'completed' }, {}, { rounds: [round(1, 'a')] });
  const b = buildBoard(m, { tiers: TIERS });
  assert.equal(b.steps[0].stateLabel, 'Concluída');
  assert.equal(b.waves[0].state, 'done'); assert.equal(b.waves[1].link, 'done'); assert.equal(b.waves[0].out, 'done');
  const all = buildBoard(planMission({ a: 'completed', b: 'completed', c: 'completed', d: 'completed' }, { status: 'completed' }, { status: 'completed', rounds: [round(1, 'a'), round(2, 'b'), round(3, 'c'), round(4, 'd')] }));
  assert.equal(all.progress.headline, 'Todas as etapas foram concluídas.'); assert.equal(all.progress.pct, 100);
  assert.deepEqual(all.waves.map((w) => w.state), ['done', 'done', 'done']);
});

test('etapa unverified e falha: atenção, com rótulo próprio e sem dizer que concluiu', () => {
  const m = planMission({ a: 'completed', b: 'unverified', c: 'failed' }, { status: 'blocked' }, { status: 'blocked', blockedCode: 'planner_blocked', blockedReason: 'sem evidência', rounds: [round(1, 'a'), round(2, 'b', { report: { evidence: { level: 'inconclusive', reasons: ['nada rodou'] } } }), round(3, 'c', { status: 'failed' })] });
  const b = buildBoard(m, { tiers: TIERS });
  assert.deepEqual(b.steps.map((s) => s.state), ['completed', 'attention', 'attention', 'idle']);
  assert.equal(b.steps[1].stateLabel, 'Sem verificação do sistema'); assert.equal(b.steps[2].stateLabel, 'Falhou');
  assert.equal(b.waves[1].state, 'attention');
  assert.match(b.progress.headline, /precisa da sua atenção/);
  assert.deepEqual(b.progress.items.map((i) => i.marker), ['done', 'attention', 'attention', 'next']);
  assert.equal(b.progress.done, 1, 'inconclusiva não conta como concluída');
  assert.equal(b.attention.some((i) => i.kind === 'failure'), true, 'o bloqueio aparece na faixa de atenção, não como log');
  assert.equal(stepStateLabel('attention', 'interrupted'), 'Interrompida');
});

test('aprovação pendente: fica DENTRO do cartão da etapa e sai da faixa de atenção', () => {
  const approvals = [{ id: 'apr_1', status: 'pending', stepId: 'b', planId: 'plan_1', round: 2, digest: 'abc', action: { title: 'Instalar pacote' }, rules: [{ id: 'deps' }] }];
  const m = planMission({ a: 'completed' }, { status: 'blocked' }, { status: 'blocked', blockedCode: 'approval_required', approvals, rounds: [round(1, 'a')] });
  const b = buildBoard(m, { tiers: TIERS });
  const sb = b.steps.find((s) => s.id === 'b');
  assert.equal(sb.state, 'approval'); assert.equal(sb.stateLabel, 'Aguardando sua aprovação');
  assert.equal(sb.approval.id, 'apr_1'); assert.equal(sb.approval.digest, 'abc'); assert.equal(sb.approval.scope, 'cycle');
  assert.deepEqual(b.attention, [], 'já está no cartão');
  assert.match(b.progress.headline, /Aguardando a sua aprovação em “Etapa B”/);
  assert.equal(b.steps.find((s) => s.id === 'b').canPin, false, 'com aprovação pendente não oferece fixar nível');
  // aprovação sem etapa (ciclo sem plano) sobra na faixa
  const loose = buildBoard(mission({ status: 'blocked', cycle: cycle({ status: 'blocked', blockedCode: 'approval_required', approvals: [{ id: 'apr_2', status: 'pending', round: 1, digest: 'd', action: { title: 'x' } }], rounds: [{ n: 1, status: 'running' }] }) }));
  assert.equal(loose.attention.length, 1); assert.equal(loose.attention[0].id, 'apr_2');
});

test('missão ANTIGA sem route/wave/role/tier: onda calculada, nível "padrão", modelo só como previsão e nunca inventado', () => {
  const old = mission({ cycle: cycle({ plan: plan([step('a', { status: 'completed' }), step('b', { dependsOn: ['a'] }), step('c', { dependsOn: ['a'] }), step('d', { dependsOn: ['b', 'c'] })]), rounds: [round(1, 'a')] }) });
  const b = buildBoard(old, { tiers: TIERS });
  assert.deepEqual(b.steps.map((s) => s.wave), [1, 2, 2, 3]);
  assert.equal(b.steps[0].waveKnown, false);
  assert.deepEqual(b.steps.map((s) => s.role), ['implementacao', 'implementacao', 'implementacao', 'implementacao']);
  assert.equal(b.steps[0].roleKnown, false); assert.equal(b.steps[0].roleLabel, 'Implementação');
  for (const s of b.steps) { assert.equal(s.route.tier, 'padrao'); assert.equal(s.route.tierLabel, 'padrão'); assert.equal(s.route.source, 'default'); }
  assert.equal(b.steps[0].route.model, null, 'a etapa A já rodou sem rota gravada: o que rodou não foi registrado');
  assert.equal(b.steps[1].route.model, 'claude-sonnet-5-5', 'etapa na fila: previsão pela tabela efetiva do servidor');
  const semTabela = buildBoard(old);
  assert.equal(semTabela.steps[1].route.model, null); assert.equal(semTabela.steps[1].route.effort, null);
  assert.equal(drawerModel(old, semTabela, 'b').agent.model, NOT_INFORMED);
  assert.equal(drawerModel(old, semTabela, 'b').agent.effort, NOT_INFORMED);
  assert.equal(b.waves.length, 3);
});

test('fechamento: closedBy system/planner e garantia verificada, autodeclarada ou aceita por pessoa', () => {
  const done = (c) => mission({ status: 'completed', cycle: cycle({ status: 'completed', finishedAt: '2026-11-10T11:00:00Z', plan: plan(steps4({ a: 'completed', b: 'completed', c: 'completed', d: 'completed' })), rounds: [round(1, 'a'), round(2, 'b'), round(3, 'c'), round(4, 'd')], finalSummary: 'Tudo pronto.', ...c }) });
  const v = buildBoard(done({ assurance: 'verified', closedBy: 'system' })).delivery;
  assert.deepEqual([v.state, v.assurance, v.assuranceLabel, v.assuranceTone, v.closedBy], ['ready', 'verified', 'Verificada pelo sistema', 'ok', 'system']);
  assert.match(v.closedByLabel, /automaticamente/); assert.equal(v.summary, 'Tudo pronto.');
  assert.deepEqual(v.files, ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']);
  const p = buildBoard(done({ assurance: 'verified', closedBy: 'planner' })).delivery;
  assert.match(p.closedByLabel, /Planner/);
  const sd = buildBoard(done({ assurance: 'self-declared' })).delivery;
  assert.deepEqual([sd.assurance, sd.assuranceLabel, sd.assuranceTone, sd.closedBy, sd.closedByLabel], ['self-declared', 'Autodeclarada', 'warn', null, null]);
  assert.match(sd.assuranceHint, /Sem evidência verificada/);
  const acc = buildBoard(done({ assurance: 'self-declared', acceptance: { by: 'user', kind: 'unverified_acceptance' } })).delivery;
  assert.match(acc.assuranceLabel, /Aceita por uma pessoa/); assert.equal(acc.assuranceTone, 'warn');
  const none = buildBoard(done({})).delivery;
  assert.equal(none.assuranceLabel, NOT_INFORMED, 'concluída sem rótulo de garantia: "não informado", nunca "verificada"');
  assert.equal(none.assuranceTone, null);
  assert.equal(buildBoard(planMission()).delivery.assurance, null, 'sem entrega, sem garantia');
  assert.equal(buildBoard(mission({ status: 'cancelled', cycle: cycle({ status: 'cancelled' }) })).delivery.state, 'cancelled');
});

test('ciclo sem plano (rodadas): um cartão por rodada, em sequência, sem total e sem etapas futuras', () => {
  const m = mission({ cycle: cycle({ rounds: [
    { n: 1, status: 'succeeded', phase: 'done', verification: 'passed', report: { evidence: { level: 'verified' } }, plan: { title: 'Criar a base' }, role: 'implementacao', route: route('padrao') },
    { n: 2, status: 'running', plan: { title: 'Escrever testes' }, role: 'testes', route: route('leve', 'escalated') },
  ] }) });
  const b = buildBoard(m, { tiers: TIERS });
  assert.equal(b.kind, 'rounds'); assert.match(b.note, /Sem plano/);
  assert.deepEqual(b.waves.map((w) => [w.label, w.steps.map((s) => s.title)]), [['Onda 1', ['Criar a base']], ['Onda 2', ['Escrever testes']]]);
  assert.deepEqual([b.progress.done, b.progress.total, b.progress.pct, b.progress.unit], [1, null, null, 'rodadas']);
  assert.equal(b.steps[1].roleLabel, 'Testes'); assert.equal(b.steps[1].route.sourceLabel, 'escalado após falha'); assert.equal(b.steps[1].route.model, 'claude-haiku-5-5');
  assert.equal(b.steps[1].canPin, false, 'fixar nível só existe para etapas do plano');
  assert.equal(b.progress.headline, 'Agora: “Escrever testes”.');
  assert.deepEqual(b.progress.next, []);
});

test('missão só com tarefas manuais: ondas por dependsOn', () => {
  const m = mission({ status: 'queued', tasks: [{ id: 't1', title: 'Primeira', status: 'completed', dependsOn: [] }, { id: 't2', title: 'Segunda', status: 'queued', dependsOn: ['t1'] }] });
  const b = buildBoard(m);
  assert.equal(b.kind, 'tasks'); assert.deepEqual(b.waves.map((w) => w.steps.map((s) => s.id)), [['t1'], ['t2']]);
  assert.deepEqual([b.progress.done, b.progress.total, b.progress.unit], [1, 2, 'tarefas']);
});

test('rota do servidor vence; nível inválido vira padrão; pin só aparece como origem quando vem do servidor ou de plan.pins', () => {
  assert.deepEqual(routeView({ route: { tier: 'profunda', model: 'm-x', effort: 'xhigh', source: 'pinned' } }), { tier: 'profunda', tierLabel: 'profunda', model: 'm-x', effort: 'xhigh', source: 'pinned', sourceLabel: 'fixado por você', known: true });
  const bad = routeView({ tier: 'ultra', tiers: TIERS });
  assert.deepEqual([bad.tier, bad.source, bad.model], ['padrao', 'default', 'claude-sonnet-5-5']);
  assert.equal(routeView({ route: { tier: 'leve', model: 'a', effort: 'low', source: 'invalida' } }).source, 'default');
  assert.equal(routeView({ pin: 'leve', tiers: TIERS }).source, 'pinned');
  assert.equal(routeView({}).model, null);
  assert.equal(effortLabel('medium'), 'médio'); assert.equal(effortLabel(null), NOT_INFORMED); assert.equal(effortLabel('zzz'), 'zzz');
  assert.deepEqual(Object.keys(TIER_LABEL), ['leve', 'padrao', 'profunda']);
  // etapa fixada pelo usuário em plan.pins, sem route gravada ainda
  const m = mission({ cycle: cycle({ plan: plan([step('a', { tier: 'leve' })], { pins: { a: 'profunda' } }) }) });
  const s = buildBoard(m, { tiers: TIERS }).steps[0];
  assert.deepEqual([s.route.tier, s.route.source, s.route.model, s.pin], ['profunda', 'pinned', 'claude-opus-5-5', 'profunda']);
});

test('gaveta: nível/modelo/esforço, instruções, critérios, dependências, evidência; log técnico só em `technical`', () => {
  const m = mission({
    cycle: cycle({ status: 'blocked', plan: plan([step('a', { status: 'completed', route: route('leve'), role: 'docs', tier: 'leve', expectedFiles: ['README.md'] }), step('b', { status: 'unverified', dependsOn: ['a'], route: route('padrao'), tier: 'padrao', taskId: 'task_2' })]),
      rounds: [round(1, 'a'), round(2, 'b', { report: { evidence: { level: 'inconclusive', reasons: ['sem verificação'] }, summary: 'declarei', verifications: [{ id: 'test', status: 'pass', command: 'npm test' }], filesChanged: ['x.js'], errors: ['E1'] } })] }),
    tasks: [{ id: 'task_2', title: 't', status: 'completed', log: ['linha 1', 'linha 2'], error: 'falhou feio' }],
  });
  const b = buildBoard(m, { tiers: TIERS });
  const d = drawerModel(m, b, 'b');
  assert.deepEqual([d.agent.model, d.agent.effort, d.agent.effortRaw, d.route.tierLabel, d.roleLabel], ['claude-sonnet-5-5', 'médio', 'medium', 'padrão', 'Implementação']);
  assert.equal(d.instructions, 'Fazer b'); assert.deepEqual(d.acceptance, ['b existe']);
  assert.deepEqual(d.deps, [{ id: 'a', title: 'Etapa A' }]);
  assert.equal(d.evidence.level, 'inconclusive'); assert.deepEqual(d.evidence.verifications, [{ id: 'test', status: 'pass', command: 'npm test' }]);
  assert.deepEqual(d.files, ['x.js']); assert.ok(d.errors.includes('E1') && d.errors.includes('falhou feio'));
  assert.deepEqual(d.technical.activity, ['linha 1', 'linha 2']);
  assert.ok(d.technical.facts.some(([k]) => k === 'Rodada'));
  assert.equal('activity' in d, false, 'o log não vaza para o nível principal da gaveta');
  assert.deepEqual(drawerModel(m, b, 'a').expectedFiles, ['README.md']);
  assert.equal(drawerModel(m, b, 'nada'), null);
});

test('fixar nível: só etapa na fila de ciclo aberto; corpo e URL do pin', () => {
  const m = planMission({ a: 'completed', b: 'running' }, {}, { rounds: [round(1, 'a')] });
  const b = buildBoard(m, { tiers: TIERS });
  assert.deepEqual(b.steps.map((s) => s.canPin), [false, false, true, true]);
  assert.equal(drawerModel(m, b, 'c').canPin, true);
  const closed = buildBoard(planMission({}, { status: 'completed' }, { status: 'completed' }), { tiers: TIERS });
  assert.equal(closed.steps.some((s) => s.canPin), false, 'ciclo encerrado: o servidor responderia 409');
  assert.deepEqual(pinBody('leve'), { tier: 'leve' }); assert.deepEqual(pinBody('auto'), { tier: null });
  assert.equal(pinBody('ultra'), null); assert.equal(pinBody(undefined), null);
  assert.equal(pinUrl('mis_1', 's 1/x'), '/api/missions/mis_1/cycle/steps/s%201%2Fx/tier');
});

test('aceitação sem evidência: só inconclusiva, ciclo bloqueado pelo Planner e sem aprovação pendente; motivo curto não gera corpo', () => {
  const blocked = (ev, c = {}) => mission({ status: 'blocked', cycle: cycle({ status: 'blocked', blockedCode: 'planner_blocked', rounds: [round(1, 'a', { report: { evidence: ev } })], ...c }) });
  const offer = acceptanceOffer(blocked({ level: 'inconclusive', reasons: ['r1'] }));
  assert.deepEqual(offer, { cycleId: 'cyc_1', round: 1, evidenceLevel: 'inconclusive', reasons: ['r1'] });
  assert.equal(acceptanceOffer(blocked({ level: 'failed' })), null, 'falha nunca é aceitável');
  assert.equal(acceptanceOffer(blocked({ level: 'verified' })), null);
  assert.equal(acceptanceOffer(blocked({ level: 'inconclusive' }, { blockedCode: 'approval_required' })), null);
  assert.equal(acceptanceOffer(blocked({ level: 'inconclusive' }, { approvals: [{ id: 'a', status: 'pending' }] })), null);
  assert.equal(acceptanceBody(offer, 'curto'), null);
  assert.equal(acceptanceBody(offer, 'x'.repeat(501)), null);
  assert.deepEqual(acceptanceBody(offer, '  Revisei os arquivos à mão.  '), { cycleId: 'cyc_1', round: 1, evidenceLevel: 'inconclusive', reason: 'Revisei os arquivos à mão.', confirm: true });
  assert.equal(buildBoard(blocked({ level: 'inconclusive' })).delivery.offer.round, 1);
});

test('computeWaves e groupWaves: ciclo e dependência desconhecida não travam', () => {
  const w = computeWaves([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['fantasma'] }]);
  assert.ok([...w.values()].every((n) => n >= 1)); assert.equal(w.get('c'), 1);
  assert.deepEqual([...computeWaves([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b', 'a'] }]).values()], [1, 2, 3]);
  assert.deepEqual(groupWaves([]), []);
  assert.equal(deliveryFiles({ cycle: { rounds: [{ report: { filesChanged: ['a', { path: 'b' }, 'a', null] } }] } }).join(','), 'a,b');
});

test('briefing: proposta em ondas com modelo/esforço, política e limite de rodadas do approve', () => {
  const proposal = { id: 'prop_1', status: 'proposed', title: 'Login', objective: 'Corrigir login', steps: [
    { id: 's1', title: 'Ler o código', dependsOn: [], role: 'analise', tier: 'leve', route: route('leve') },
    { id: 's2', title: 'Corrigir', dependsOn: ['s1'], tier: 'profunda', route: route('profunda') },
    { id: 's3', title: 'Testar', dependsOn: ['s1'], role: 'testes' },
  ], policy: [{ stepId: 's2', decision: 'approval_required' }, { stepId: 's3', decision: 'deny' }] };
  const pb = proposalBoard(proposal, { tiers: TIERS });
  assert.deepEqual(pb.waves.map((w) => w.steps.map((s) => s.id)), [['s1'], ['s2', 's3']]);
  assert.equal(pb.steps[0].route.model, 'claude-haiku-5-5');
  assert.equal(pb.steps[2].route.tierLabel, 'padrão', 'sem tier na proposta: padrão');
  assert.match(pb.steps[1].policyNote, /aprovação/); assert.equal(pb.steps[2].blocked, true); assert.equal(pb.steps[0].policyNote, null);
  const view = { planMode: true, busy: false, workspace: { id: 'ws_1', name: 'Projeto' }, workspaceProblem: null, messages: [{ id: 'm1', role: 'user', text: 'oi' }], proposal, phase: 'proposal', maxIterations: 2, hardMax: 20 };
  const s = briefingState(view);
  assert.deepEqual([s.canSend, s.canApprove, s.canReset, s.workspace.name], [true, true, true, 'Projeto']);
  assert.deepEqual(approveBody(view), { proposalId: 'prop_1', maxIterations: 4 }, 'cada etapa usa uma rodada, mais 1 de folga para a retentativa automática: o limite sobe para cobrir o plano');
  assert.deepEqual(approveBody({ ...view, maxIterations: 8 }), { proposalId: 'prop_1' });
  assert.equal(approveBody({ ...view, maxIterations: 1, hardMax: 2 }), null, 'plano maior que o máximo do servidor não cabe');
  assert.equal(approveBody({ ...view, proposal: { ...proposal, status: 'approved' } }), null);
  const sem = briefingState({ ...view, workspace: null, workspaceProblem: 'Nenhum espaço de trabalho ativo' });
  assert.deepEqual([sem.canSend, sem.canApprove, sem.workspaceProblem], [false, false, 'Nenhum espaço de trabalho ativo']);
  assert.equal(briefingState(view, { sending: true }).canSend, false);
  assert.equal(briefingState({ ...view, busy: true }).canApprove, false);
  assert.equal(briefingState({ ...view, proposal: { ...proposal, status: 'approved' } }).approving, true);
  assert.deepEqual(briefingState(null).messages, []);
});

test('o quadro não altera a missão recebida', () => {
  const m = planMission({ a: 'completed', b: 'running' }, {}, { rounds: [round(1, 'a')] });
  const before = JSON.stringify(m);
  buildBoard(m, { tiers: TIERS, usage: { byMission: [] } }); drawerModel(m, buildBoard(m), 'a');
  assert.equal(JSON.stringify(m), before);
  assert.deepEqual(buildBoard(m, { usage: { byMission: [] } }).usage, { costUsd: null, tokens: null, planner: null, executor: null });
});
