// Visão das missões v2 (client/src/flows-view.js): lista, progresso n/m, estado do run, nós e arestas do workflow, detalhe do nó, duração e rascunho do formulário.
// Só dados fabricados no formato da spec (docs/missions-v2-spec.md); nada de servidor, banco real ou CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOT_INFORMED, FLOW_STATES, FLOW_STATE_META, STEP_STATE_META, currentRun, flowState, flowProgress, waitingSteps, flowRows, groupFlows, pickFlowId,
  flowsActivity, edgePathDown, buildWorkflow, workflowColumns, nodeDetail, historyRows, fmtDuration, fmtWhen, spanMs, runDuration, describeFailure, roleLabel, providerLabel,
  emptyDraft, addStep, removeStep, patchStep, toggleDependency, ancestorKeys, flowToDraft, validateDraft, draftToBody, MAX_STEPS,
} from '../../client/src/flows-view.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = '2026-11-16T10:00:00.000Z';
const def = (id, o = {}) => ({ id, title: `Etapa ${id}`, prompt: `Faça ${id}\nsegunda linha`, provider: 'claude', role: 'builder', model: null, effort: null, dependsOn: [], continueFrom: null, ...o });
const rs = (stepId, status, o = {}) => ({ stepId, status, terminalId: null, taskId: null, startedAt: null, finishedAt: null, summary: null, error: null, ...o });
const run = (steps, o = {}) => ({ id: 'run_1', flowId: 'flow_1', status: 'running', startedAt: T0, finishedAt: null, trigger: 'manual', steps, ...o });
const flow = (o = {}) => ({
  id: 'flow_1', workspaceId: 'ws_1', workspaceName: 'Projeto', title: 'Missão', goal: 'Fazer X', kind: 'project', fullAccess: false, maxParallel: 2, schedule: null, archived: false,
  createdAt: T0, updatedAt: T0, steps: [def('s1'), def('s2', { dependsOn: ['s1'] }), def('s3', { dependsOn: ['s1'] }), def('s4', { dependsOn: ['s2', 's3'] })], lastRun: null, activeRun: null, ...o,
});

test('estado da missão: sem run = idle; waiting só com run ativo e etapa esperando; terminais seguem o status do run', () => {
  assert.equal(flowState(flow()), 'idle');
  assert.equal(flowState(null), 'idle');
  const act = (steps) => flow({ activeRun: run(steps) });
  assert.equal(flowState(act([rs('s1', 'running')])), 'running');
  assert.equal(flowState(act([rs('s1', 'completed'), rs('s2', 'waiting'), rs('s3', 'running')])), 'waiting');
  for (const s of ['completed', 'failed', 'cancelled']) assert.equal(flowState(flow({ lastRun: run([rs('s1', 'completed')], { status: s, finishedAt: T0 }) })), s);
  // um `waiting` esquecido num run já finalizado não pode acender "aguardando você"
  assert.equal(flowState(flow({ lastRun: run([rs('s1', 'waiting')], { status: 'failed', finishedAt: T0 }) })), 'failed');
  assert.equal(flowState(flow({ lastRun: run([], { status: 'estranho' }) })), 'idle');
  assert.deepEqual(new Set(FLOW_STATES), new Set(Object.keys(FLOW_STATE_META)));
  assert.equal(FLOW_STATE_META.waiting.label, 'aguardando você');
  assert.equal(STEP_STATE_META.waiting.label, 'aguardando você');
});

test('currentRun prefere o ativo; progresso n/m usa as etapas da definição e só as completed do run', () => {
  const a = run([rs('s1', 'completed')]), l = run([rs('s1', 'completed'), rs('s2', 'completed'), rs('s3', 'failed')], { id: 'run_0', status: 'failed' });
  assert.equal(currentRun(flow({ activeRun: a, lastRun: l })), a);
  assert.equal(currentRun(flow({ lastRun: l })), l);
  assert.equal(currentRun(flow()), null);
  const p = flowProgress(flow({ lastRun: l }));
  assert.deepEqual([p.done, p.total, p.pct, p.label, p.hasRun], [2, 4, 50, '2/4', true]);
  // sem run: nada de "0/4" inventado, só um traço
  const n = flowProgress(flow());
  assert.deepEqual([n.done, n.pct, n.label, n.hasRun], [null, null, '—/4', false]);
  assert.equal(flowProgress({ steps: [] }).label, NOT_INFORMED);
  assert.equal(flowProgress(flow({ activeRun: run([rs('s1', 'completed'), rs('s2', 'completed'), rs('s3', 'completed'), rs('s4', 'completed')], { status: 'completed' }) })).pct, 100);
});

test('waitingSteps: só do run ativo, com título e terminal reais (terminal ausente = null)', () => {
  const f = flow({ activeRun: run([rs('s1', 'completed'), rs('s2', 'waiting', { terminalId: 'term_9', startedAt: T0 }), rs('s3', 'waiting')]) });
  assert.deepEqual(waitingSteps(f).map((w) => [w.stepId, w.title, w.terminalId]), [['s2', 'Etapa s2', 'term_9'], ['s3', 'Etapa s3', null]]);
  assert.deepEqual(waitingSteps(flow({ lastRun: run([rs('s2', 'waiting')], { status: 'failed' }) })), []);
  assert.deepEqual(waitingSteps(flow()), []);
});

test('lista: arquivadas fora, quem pede você primeiro, depois recência; busca por título e workspace; grupos por workspace', () => {
  const a = flow({ id: 'a', title: 'Alfa', updatedAt: '2026-11-10T00:00:00Z' });
  const b = flow({ id: 'b', title: 'Beta', updatedAt: '2026-11-12T00:00:00Z', lastRun: run([rs('s1', 'completed')], { status: 'completed' }) });
  const c = flow({ id: 'c', title: 'Gama', updatedAt: '2026-11-11T00:00:00Z', activeRun: run([rs('s1', 'waiting')]) });
  const d = flow({ id: 'd', title: 'Delta', updatedAt: '2026-11-13T00:00:00Z', activeRun: run([rs('s1', 'running')]) });
  const arq = flow({ id: 'x', title: 'Velha', archived: true });
  assert.deepEqual(flowRows([a, b, c, d, arq]).map((r) => r.id), ['c', 'd', 'a', 'b']);
  assert.equal(pickFlowId([a, b, c, d]), 'c');
  assert.equal(pickFlowId([]), null);
  assert.deepEqual(flowRows([a, b, c, d], { query: 'gam' }).map((r) => r.id), ['c']);
  assert.deepEqual(flowRows([a], { query: 'projeto' }).map((r) => r.id), ['a']);
  const r = flowRows([c])[0];
  assert.deepEqual([r.state, r.meta.label, r.progress.label, r.kind, r.workspace], ['waiting', 'aguardando você', '0/4', 'projeto', 'Projeto']);
  const other = flow({ id: 'o', workspaceId: 'ws_2', workspaceName: 'Antes', title: 'Outra' });
  const g = groupFlows([a, other, c]);
  assert.deepEqual(g.map((x) => x.name), ['Antes', 'Projeto']);
  assert.deepEqual(g[1].items.map((x) => x.id), ['c', 'a']);
  // nome do workspace ausente na resposta: usa a lista de workspaces; sem nenhum, "sem workspace"
  const bare = { ...a, workspaceName: undefined };
  assert.equal(flowRows([bare], { workspaces: [{ id: 'ws_1', displayName: 'Do store' }] })[0].workspace, 'Do store');
  assert.equal(groupFlows([bare])[0].name, 'sem workspace');
});

test('workflow: coluna = profundidade; ramos paralelos na mesma coluna; entrega ligada às etapas finais', () => {
  const wf = buildWorkflow(flow());
  const col = (id) => wf.nodes.find((n) => n.id === id).col;
  assert.deepEqual(['s1', 's2', 's3', 's4', 'delivery'].map(col), [0, 1, 1, 2, 3]);
  assert.deepEqual(wf.nodes.filter((n) => n.col === 1).map((n) => [n.id, n.row]), [['s2', 0], ['s3', 1]]);
  assert.deepEqual(wf.edges.map((e) => e.id).sort(), ['s1->s2', 's1->s3', 's2->s4', 's3->s4', 's4->delivery']);
  assert.deepEqual(wf.columns.map((c) => [c.label, c.parallel]), [['Fase 1', 1], ['Fase 2', 2], ['Fase 3', 1], ['Entrega', 0]]);
  // sem run: tudo na fila, entrega pendente, e nenhum texto de andamento inventado
  assert.ok(wf.nodes.every((n) => n.state === 'pending' && n.line === null && n.terminalId === null));
  assert.equal(wf.hasRun, false);
  // duas etapas finais: a entrega recebe as duas
  const f2 = flow({ steps: [def('a'), def('b'), def('c', { dependsOn: ['a'] })] });
  assert.deepEqual(buildWorkflow(f2).edges.filter((e) => e.to === 'delivery').map((e) => e.from).sort(), ['b', 'c']);
  assert.deepEqual(buildWorkflow(flow({ steps: [] })), { nodes: [], edges: [], columns: [], hasRun: false });
});

test('workflow: estado, linha e agente de cada nó vêm do run e da definição ("não informado" onde falta)', () => {
  const f = flow({ steps: [def('s1', { model: 'opus', effort: 'high' }), def('s2', { provider: 'codex', role: 'reviewer', dependsOn: ['s1'] }), def('s3', { dependsOn: ['s1'] }), def('s4', { dependsOn: ['s2', 's3'] })],
    activeRun: run([rs('s1', 'completed', { summary: 'Feito o login' }), rs('s2', 'waiting', { terminalId: 'term_2' }), rs('s3', 'running', { terminalId: 'term_3' }), rs('s4', 'pending')]) });
  const wf = buildWorkflow(f), n = (id) => wf.nodes.find((x) => x.id === id);
  assert.deepEqual([n('s1').state, n('s1').line, n('s1').lineKind], ['completed', 'Feito o login', 'summary']);
  assert.deepEqual([n('s1').agent.model, n('s1').agent.effort, n('s1').agent.providerLabel, n('s1').agent.roleLabel], ['opus', 'high', 'Claude Code', 'Construtor']);
  assert.deepEqual([n('s2').state, n('s2').stateLabel, n('s2').waiting, n('s2').terminalId, n('s2').agent.providerLabel, n('s2').agent.roleLabel], ['waiting', 'aguardando você', true, 'term_2', 'Codex CLI', 'Revisor']);
  assert.equal(n('s2').agent.model, null); // a tela escreve "não informado"; aqui continua null
  assert.deepEqual([n('s3').state, n('s3').line], ['running', 'Faça s3']); // a "tarefa atual" é a 1ª linha do texto real da etapa
  assert.deepEqual([n('s4').state, n('delivery').state], ['pending', 'pending']);
  // arestas pelo estado do destino/origem
  const e = (id) => wf.edges.find((x) => x.id === id).state;
  assert.deepEqual([e('s1->s2'), e('s1->s3'), e('s2->s4')], ['wait', 'active', 'idle']);
  assert.equal(wf.columns[1].live, 2);
});

test('workflow: falha pula dependentes e a entrega falha; concluído conclui a entrega; cancelado cancela', () => {
  const f = flow({ lastRun: run([rs('s1', 'completed'), rs('s2', 'failed', { error: 'tarefa falhou' }), rs('s3', 'completed'), rs('s4', 'skipped')], { status: 'failed', finishedAt: T0 }) });
  const wf = buildWorkflow(f), n = (id) => wf.nodes.find((x) => x.id === id);
  assert.deepEqual([n('s2').state, n('s2').line, n('s2').lineKind, n('s4').state, n('delivery').state, n('delivery').stateLabel], ['failed', 'tarefa falhou', 'error', 'skipped', 'failed', 'falhou']);
  assert.equal(wf.edges.find((x) => x.id === 's2->s4').state, 'err');
  assert.equal(buildWorkflow(flow({ lastRun: run([rs('s1', 'failed')], { status: 'failed' }) })).nodes.find((x) => x.id === 's1').line, 'falhou sem motivo informado');
  const ok = buildWorkflow(flow({ lastRun: run(['s1', 's2', 's3', 's4'].map((s) => rs(s, 'completed')), { status: 'completed', finishedAt: T0 }) }));
  assert.equal(ok.nodes.find((x) => x.id === 'delivery').state, 'completed');
  assert.equal(ok.nodes.find((x) => x.id === 's1').line, 'sem resumo informado');
  const cx = buildWorkflow(flow({ lastRun: run([rs('s1', 'cancelled')], { status: 'cancelled', finishedAt: T0 }) }));
  assert.equal(cx.nodes.find((x) => x.id === 'delivery').state, 'cancelled');
  assert.equal(cx.nodes.find((x) => x.id === 's2').state, 'pending'); // sem linha no run = na fila
  // status desconhecido do servidor não quebra: cai em "na fila"
  assert.equal(buildWorkflow(flow({ activeRun: run([rs('s1', 'bizarro')]) })).nodes[0].state, 'pending');
});

test('workflow: continueFrom marca a aresta como reaproveitamento; ciclo e dependência desconhecida não travam', () => {
  const f = flow({ steps: [def('s1'), def('s2', { dependsOn: ['s1'], continueFrom: 's1' })] });
  assert.equal(buildWorkflow(f).edges.find((e) => e.id === 's1->s2').reuse, true);
  const cyc = flow({ steps: [def('a', { dependsOn: ['b'] }), def('b', { dependsOn: ['a'] }), def('c', { dependsOn: ['zzz', 'c'] })] });
  const wf = buildWorkflow(cyc);
  assert.equal(wf.nodes.length, 4);
  assert.ok(wf.edges.every((e) => e.from !== 'zzz'));
  assert.ok(wf.nodes.every((n) => Number.isInteger(n.col)));
});

test('colunas do workflow: ordenadas, com fase numerada só para etapas', () => {
  const cols = workflowColumns([{ id: 'b', kind: 'step', col: 1, row: 1, state: 'running' }, { id: 'a', kind: 'step', col: 1, row: 0, state: 'waiting' }, { id: 'd', kind: 'delivery', col: 2, row: 0, state: 'pending' }]);
  assert.deepEqual(cols.map((c) => [c.label, c.list.map((n) => n.id), c.parallel, c.live]), [['Fase 1', ['a', 'b'], 2, 2], ['Entrega', ['d'], 0, 0]]);
  assert.deepEqual(workflowColumns(null), []);
});

test('detalhe do nó (etapa): texto, resumo/erro, tempos e terminal só com dado real', () => {
  const now = Date.parse(T0) + 90_000;
  const f = flow({ steps: [def('s1', { model: 'opus' }), def('s2', { dependsOn: ['s1'], continueFrom: 's1' })],
    activeRun: run([rs('s1', 'completed', { terminalId: 'term_1', startedAt: T0, finishedAt: '2026-11-16T10:01:00.000Z', summary: 'ok', taskId: 'task_1' }), rs('s2', 'waiting', { terminalId: 'term_1', startedAt: '2026-11-16T10:01:00.000Z' })]) });
  const d1 = nodeDetail(f, f.activeRun, 's1', { now });
  assert.deepEqual([d1.kind, d1.state, d1.summary, d1.error, d1.durationMs, d1.terminalId, d1.canOpenTerminal, d1.terminalLive], ['step', 'completed', 'ok', null, 60_000, 'term_1', true, false]);
  assert.match(d1.terminalHint, /pode já ter sido encerrado/);
  assert.equal(d1.agent.model, 'opus');
  assert.ok(d1.prompt.startsWith('Faça s1'));
  const d2 = nodeDetail(f, f.activeRun, 's2', { now });
  assert.deepEqual([d2.state, d2.durationMs, d2.terminalLive, d2.terminalHint, d2.dependsOn, d2.continueFrom], ['waiting', 30_000, true, null, [{ id: 's1', title: 'Etapa s1' }], { id: 's1', title: 'Etapa s1' }]);
  // sem run: sem terminal, sem tempos
  const d0 = nodeDetail(flow(), null, 's1');
  assert.deepEqual([d0.state, d0.hasRun, d0.canOpenTerminal, d0.durationMs, d0.startedAt, d0.agent.effort], ['pending', false, false, null, null, null]);
  assert.match(d0.terminalHint, /ainda não abriu um terminal/);
  assert.equal(nodeDetail(flow(), null, 'nao_existe'), null);
  // etapa terminada sem `finishedAt` não "corre" para sempre
  const stale = nodeDetail(flow(), run([rs('s1', 'failed', { startedAt: T0, error: 'x' })], { status: 'failed' }), 's1', { now });
  assert.equal(stale.durationMs, null); assert.equal(stale.error, 'x');
});

test('detalhe da entrega: contagens e falhas do run', () => {
  const f = flow({ lastRun: run([rs('s1', 'completed'), rs('s2', 'failed', { error: 'quebrou' }), rs('s3', 'completed'), rs('s4', 'skipped')], { status: 'failed', startedAt: T0, finishedAt: '2026-11-16T10:02:00.000Z' }) });
  const d = nodeDetail(f, f.lastRun, 'delivery');
  assert.deepEqual(d.counts, { total: 4, completed: 2, failed: 1, skipped: 1, cancelled: 0 });
  assert.deepEqual(d.failures, [{ id: 's2', title: 'Etapa s2', error: 'quebrou' }]);
  assert.deepEqual([d.state, d.durationMs, d.runStatus], ['failed', 120_000, 'failed']);
  assert.equal(nodeDetail(flow(), null, 'delivery').hasRun, false);
});

test('tempo: duração, formatação e data; ausente nunca vira zero', () => {
  assert.equal(fmtDuration(null), '—'); assert.equal(fmtDuration(undefined), '—'); assert.equal(fmtDuration(NaN), '—');
  assert.equal(fmtDuration(0), '0s'); assert.equal(fmtDuration(45_000), '45s'); assert.equal(fmtDuration(125_000), '2min 05s'); assert.equal(fmtDuration(3_725_000), '1h 02min');
  assert.equal(fmtWhen(null), NOT_INFORMED); assert.equal(fmtWhen('lixo'), NOT_INFORMED);
  assert.match(fmtWhen(T0), /^\d{2}\/\d{2}.*\d{2}:\d{2}$/);
  const now = Date.parse(T0) + 5_000;
  assert.equal(spanMs(T0, null, true, now), 5_000);
  assert.equal(spanMs(T0, null, false, now), null);
  assert.equal(spanMs(null, null, true, now), null);
  assert.equal(spanMs(T0, '2026-11-16T10:00:03.000Z', true, now), 3_000);
  assert.equal(runDuration(run([]), now), 5_000);
  assert.equal(runDuration(run([], { status: 'failed' }), now), null);
  assert.equal(runDuration(null, now), null);
});

test('histórico dos runs: estado, progresso n/m, duração e o motivo da primeira falha', () => {
  const f = flow();
  const rows = historyRows([
    run([rs('s1', 'completed'), rs('s2', 'failed', { error: 'deu ruim' })], { id: 'run_2', status: 'failed', finishedAt: '2026-11-16T10:01:00.000Z' }),
    run([rs('s1', 'completed'), rs('s2', 'completed'), rs('s3', 'completed'), rs('s4', 'completed')], { id: 'run_1', status: 'completed', finishedAt: '2026-11-16T10:03:00.000Z' }),
  ], f, { now: Date.parse(T0) });
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.progress, r.durationMs, r.reason]), [['run_2', 'falhou', '1/4', 60_000, 'deu ruim'], ['run_1', 'concluída', '4/4', 180_000, null]]);
  assert.deepEqual(historyRows(null, f), []);
  assert.equal(historyRows([run([], { status: 'novo' })], f)[0].label, 'novo');
});

test('rótulos: provedor e papel (lista real do servidor vence; reserva conhecida; senão o próprio id)', () => {
  assert.equal(providerLabel('claude'), 'Claude Code'); assert.equal(providerLabel('codex'), 'Codex CLI'); assert.equal(providerLabel(null), NOT_INFORMED); assert.equal(providerLabel('outro'), 'outro');
  assert.equal(roleLabel('builder'), 'Construtor'); assert.equal(roleLabel('builder', [{ id: 'builder', label: 'Dev' }]), 'Dev'); assert.equal(roleLabel('x'), 'x'); assert.equal(roleLabel(null), NOT_INFORMED);
});

test('falhas de rede/rota viram mensagens claras (servidor fora, 404 da lista, 404 do item, 409, outros)', () => {
  assert.equal(describeFailure(new TypeError('Failed to fetch')).kind, 'offline');
  assert.match(describeFailure(new TypeError('x')).message, /servidor do FORGE/);
  const e = (status, message) => Object.assign(new Error(message ?? `Erro ${status}`), { status });
  assert.equal(describeFailure(e(404), 'list').kind, 'unavailable');
  assert.match(describeFailure(e(404), 'list').message, /\/api\/flows/);
  assert.equal(describeFailure(e(404), 'item').kind, 'notfound');
  assert.deepEqual(describeFailure(e(409, 'Já existe uma execução ativa.')), { kind: 'conflict', message: 'Já existe uma execução ativa.' });
  assert.deepEqual(describeFailure(e(400, 'título inválido')), { kind: 'error', message: 'título inválido' });
});

test('rascunho: começa com uma etapa; adicionar encadeia na anterior; remover limpa referências e nunca zera', () => {
  let d = emptyDraft({ workspaceId: 'ws_1' });
  assert.deepEqual([d.steps.length, d.workspaceId, d.fullAccess, d.maxParallel], [1, 'ws_1', false, 1]); // acesso total nasce DESLIGADO
  d = addStep(d); d = addStep(d);
  assert.deepEqual(d.steps.map((s) => [s.key, s.dependsOn]), [['k1', []], ['k2', ['k1']], ['k3', ['k2']]]);
  d = patchStep(d, 'k3', { continueFrom: 'k1' });
  d = toggleDependency(d, 'k3', 'k1');
  assert.deepEqual(d.steps[2].dependsOn, ['k2', 'k1']);
  d = removeStep(d, 'k1');
  assert.deepEqual(d.steps.map((s) => [s.key, s.dependsOn, s.continueFrom]), [['k2', [], ''], ['k3', ['k2'], '']]);
  assert.equal(removeStep(removeStep(d, 'k2'), 'k3').steps.length, 1);
  let big = emptyDraft(); for (let i = 0; i < 20; i++) big = addStep(big);
  assert.equal(big.steps.length, MAX_STEPS);
});

test('rascunho: cadeia de ancestrais e limpeza do "continuar o terminal de" ao desmarcar a dependência', () => {
  let d = emptyDraft(); d = addStep(d); d = addStep(d); // k1 <- k2 <- k3
  assert.deepEqual([...ancestorKeys(d, 'k3')].sort(), ['k1', 'k2']);
  d = patchStep(d, 'k3', { continueFrom: 'k1' });
  d = toggleDependency(d, 'k2', 'k1'); // k2 deixa de depender de k1: k1 sai da cadeia de k3
  assert.equal(d.steps[2].continueFrom, '');
  assert.deepEqual(toggleDependency(d, 'k2', 'k2'), d); // não depende de si mesma
});

test('validação do rascunho: espelha as regras do servidor, com mensagens por campo e por etapa', () => {
  let d = emptyDraft({ workspaceId: '' });
  let v = validateDraft(d);
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors.map((e) => e.field).sort(), ['step.prompt', 'step.title', 'title', 'workspaceId']);
  assert.deepEqual(v.byStep.k1.length, 2);
  d = { ...d, workspaceId: 'ws_1', title: 'M' }; d = patchStep(d, 'k1', { title: 'A', prompt: 'faça' });
  assert.equal(validateDraft(d).ok, true);
  assert.equal(validateDraft({ ...d, workspaceId: '' }, { mode: 'edit' }).ok, true); // editar não troca o workspace
  assert.equal(validateDraft({ ...d, title: 'x'.repeat(121) }).errors[0].field, 'title');
  assert.equal(validateDraft({ ...d, goal: 'x'.repeat(2001) }).errors[0].field, 'goal');
  assert.equal(validateDraft({ ...d, maxParallel: 5 }).errors[0].field, 'maxParallel');
  assert.equal(validateDraft({ ...d, steps: [] }).errors[0].field, 'steps');
  const bad = patchStep(d, 'k1', { provider: 'gemini' });
  assert.equal(validateDraft(bad).errors[0].field, 'step.provider');
  // dependência só para etapas anteriores da lista (isso também impede ciclos); continueFrom só na cadeia
  let e = addStep(d); e = patchStep(e, 'k2', { title: 'B', prompt: 'p' });
  assert.equal(validateDraft(patchStep(e, 'k1', { dependsOn: ['k2'] })).errors[0].field, 'step.dependsOn');
  assert.equal(validateDraft(patchStep(e, 'k2', { continueFrom: 'k1' })).ok, true);
  assert.equal(validateDraft(patchStep(patchStep(e, 'k2', { dependsOn: [] }), 'k2', { continueFrom: 'k1' })).errors[0].field, 'step.continueFrom');
});

test('corpo da API: ids s1..sN, vazio vira null, fullAccess só booleano estrito, PATCH sem workspace/tipo', () => {
  let d = emptyDraft({ workspaceId: 'ws_1' }); d = { ...d, title: '  Missão  ', goal: ' obj ', maxParallel: 2 };
  d = patchStep(d, 'k1', { title: ' A ', prompt: ' faça A ', model: 'opus', effort: '' });
  d = addStep(d); d = patchStep(d, 'k2', { title: 'B', prompt: 'faça B', provider: 'codex', role: 'reviewer', continueFrom: 'k1' });
  const body = draftToBody(d);
  assert.deepEqual(body, {
    workspaceId: 'ws_1', kind: 'project', title: 'Missão', goal: 'obj', fullAccess: false, maxParallel: 2,
    steps: [
      { id: 's1', title: 'A', prompt: 'faça A', provider: 'claude', role: 'builder', model: 'opus', effort: null, dependsOn: [], continueFrom: null },
      { id: 's2', title: 'B', prompt: 'faça B', provider: 'codex', role: 'reviewer', model: null, effort: null, dependsOn: ['s1'], continueFrom: 's1' },
    ],
  });
  assert.equal(draftToBody({ ...d, fullAccess: 'true' }).fullAccess, false); // texto nunca liga o acesso total
  assert.equal(draftToBody({ ...d, fullAccess: true }).fullAccess, true);
  const patch = draftToBody(d, { mode: 'edit' });
  assert.ok(!('workspaceId' in patch) && !('kind' in patch));
});

test('editar: flowToDraft e draftToBody fazem ida e volta sem perder dependências nem terminal reaproveitado', () => {
  const f = flow({ fullAccess: true, maxParallel: 3, steps: [def('s1', { model: 'sonnet' }), def('s2', { dependsOn: ['s1'], continueFrom: 's1', effort: 'low' }), def('s3', { dependsOn: ['s1'] })] });
  const d = flowToDraft(f);
  assert.deepEqual([d.title, d.fullAccess, d.maxParallel, d.workspaceId], ['Missão', true, 3, 'ws_1']);
  assert.equal(validateDraft(d, { mode: 'edit' }).ok, true);
  const body = draftToBody(d, { mode: 'edit' });
  assert.deepEqual(body.steps.map((s) => [s.id, s.dependsOn, s.continueFrom, s.model, s.effort]), [['s1', [], null, 'sonnet', null], ['s2', ['s1'], 's1', null, 'low'], ['s3', ['s1'], null, null, null]]);
  assert.equal(body.fullAccess, true);
  // novo passo depois de carregar não colide com as chaves existentes
  assert.equal(addStep(d).steps.at(-1).key, 'k4');
  assert.equal(flowToDraft(null).steps.length, 1);
});

test('estilo e componentes: sem brilho, movimento respeita data-motion e o aviso de acesso total está no formulário', () => {
  const css = fs.readFileSync(path.join(here, '../../client/src/flows.css'), 'utf8');
  assert.ok(!/(box-shadow|text-shadow|drop-shadow|filter)\s*[:(]/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'flows.css não pode ter brilho');
  assert.ok(!/#ef4444|#dc2626|rgba\(239, ?68, ?68/i.test(css), 'sem o vermelho vivo');
  for (const m of css.matchAll(/animation:/g)) { // toda animação está dentro de um bloco que respeita movimento reduzido
    const before = css.slice(0, m.index), openAt = before.lastIndexOf('@media');
    assert.ok(openAt >= 0 && /prefers-reduced-motion: no-preference/.test(before.slice(openAt)), 'animação fora do bloco de movimento permitido');
  }
  assert.match(css, /html:not\(\[data-motion="reduced"\]\)/);
  const form = fs.readFileSync(path.join(here, '../../client/src/components/FlowForm.jsx'), 'utf8');
  assert.match(form, /SEM pedir confirmação e pode editar arquivos e executar comandos no seu computador/);
  assert.match(form, /aria-describedby="fl-access-warn"/);
  const panel = fs.readFileSync(path.join(here, '../../client/src/components/FlowSidePanel.jsx'), 'utf8');
  assert.match(panel, /'Escape'/);
});

test('indicador da barra lateral: aguardando > trabalhando > falhou/concluída (só depois de seenAt); arquivada e sem run não contam', () => {
  const T1 = '2026-11-16T11:00:00.000Z', seen = Date.parse(T0);
  const working = flow({ id: 'a', activeRun: run([rs('s1', 'running')]) });
  const waiting = flow({ id: 'b', activeRun: run([rs('s1', 'waiting')]) });
  const done = flow({ id: 'c', lastRun: run([rs('s1', 'completed')], { status: 'completed', finishedAt: T1 }) });
  const failed = flow({ id: 'd', lastRun: run([rs('s1', 'failed')], { status: 'failed', finishedAt: T1 }) });
  assert.deepEqual(flowsActivity(null), { state: null, count: 0, working: 0, waiting: 0, failed: 0, done: 0, title: '' });
  assert.equal(flowsActivity([flow()]).state, null, 'sem run = nada a mostrar');
  const a = flowsActivity([working], { seenAt: seen });
  assert.equal(a.state, 'working'); assert.equal(a.count, 1); assert.equal(a.title, '1 missão em execução');
  const b = flowsActivity([working, waiting, done], { seenAt: seen });
  assert.equal(b.state, 'waiting', 'quem pede você vence'); assert.equal(b.title, '1 missão aguardando você · 1 missão em execução · 1 missão concluída');
  assert.equal(flowsActivity([done], { seenAt: seen }).state, 'done');
  assert.equal(flowsActivity([done, failed], { seenAt: seen }).state, 'failed', 'falha vence a conclusão');
  assert.equal(flowsActivity([done, failed], { seenAt: Date.parse(T1) }).state, null, 'já vista (seenAt >= fim do run): some');
  assert.equal(flowsActivity([done, failed], { seenAt: Infinity }).state, null, 'na página Missões nada é pendente');
  assert.equal(flowsActivity([flow({ archived: true, activeRun: run([rs('s1', 'running')]) })]).state, null, 'arquivada não conta');
  assert.equal(flowsActivity([working], { seenAt: Infinity }).state, 'working', 'trabalhando aparece sempre, mesmo na página');
  assert.equal(flowsActivity([working, flow({ id: 'e', activeRun: run([rs('s1', 'running')]) })]).title, '2 missões em execução');
});

test('a barra lateral mostra o estado das Missões (flows) em qualquer página; um só polling serve a página e a sidebar', () => {
  const src = (f) => fs.readFileSync(path.join(here, '../../client/src', f), 'utf8');
  const app = src('App.jsx'), sb = src('components/Sidebar.jsx'), page = src('pages/Missions.jsx');
  for (const t of ['const flowsData = useFlows({ intervalMs: 2500 })', 'flows: flowsData.flows, flowsSeenAt', '<Missions onOpenCockpit={openCockpit} data={flowsData} stream={termStream} />']) assert.ok(app.includes(t), t);
  for (const t of ["flowsActivity(flows, { seenAt: view === 'missions' ? Infinity : flowsSeenAt })", '<StatusGlyph state={fa.state}', 'role="status" aria-label={fa.title}']) assert.ok(sb.includes(t), t);
  assert.ok(!page.includes("from '../use-flows.js'") && !page.includes('useFlows('), 'a página recebe os dados do App (sem um segundo polling)');
});

test('conector do workflow: desce da base do pai, anda na horizontal no corredor e desce ao topo do filho (nunca sai de lado)', () => {
  assert.equal(edgePathDown(100, 50, 100, 120, 100), 'M 100 50 V 120', 'mesmo eixo: reta vertical');
  const d = edgePathDown(100, 50, 300, 120, 98);
  assert.ok(d.startsWith('M 100 50 V '), 'começa descendo da base do pai'); assert.ok(d.includes(' H '), 'anda na horizontal no corredor'); assert.ok(d.endsWith('V 120'), 'termina descendo até o topo do filho');
  assert.ok(!/H 100 /.test(d.slice(0, 12)), 'não sai na horizontal logo na origem');
  const left = edgePathDown(300, 50, 100, 120, 98);
  assert.ok(left.includes(' H ') && left.endsWith('V 120'), 'filho à esquerda também desce');
  assert.ok(!d.includes('NaN') && !left.includes('NaN') && !edgePathDown(100, 50, 101, 52, 51).includes('NaN'), 'sem NaN mesmo com pouco espaço');
});

test('FlowWorkflow desenha as fases uma abaixo da outra (sem rolagem lateral nem conector saindo do lado direito do nó)', () => {
  const w = fs.readFileSync(path.join(here, '../../client/src/components/FlowWorkflow.jsx'), 'utf8'), css = fs.readFileSync(path.join(here, '../../client/src/flows.css'), 'utf8');
  assert.ok(w.includes('edgePathDown(') && w.includes('y1 = a.y + a.h') && !w.includes('scrollLeft') && !w.includes("from './MissionWorkflow.jsx'"));
  assert.ok(/.fl-wf .mwf-stage { flex-direction: column;/.test(css) && css.includes('.fl-phase-nodes'));
});
