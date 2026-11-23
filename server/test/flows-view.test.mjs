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
import * as FV from '../../client/src/flows-view.js'; // fatia 2 (docs/missions-v2-fatia2.md, seções A, B e G)

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

test('corpo da API: ids s1..sN, vazio vira null, fullAccess só booleano estrito, PATCH sem workspace (tipo, agenda e autoIntegrate vão nos dois)', () => {
  let d = emptyDraft({ workspaceId: 'ws_1' }); d = { ...d, title: '  Missão  ', goal: ' obj ', maxParallel: 2 };
  d = patchStep(d, 'k1', { title: ' A ', prompt: ' faça A ', model: 'opus', effort: '' });
  d = addStep(d); d = patchStep(d, 'k2', { title: 'B', prompt: 'faça B', provider: 'codex', role: 'reviewer', continueFrom: 'k1' });
  const body = draftToBody(d);
  assert.deepEqual(body, {
    workspaceId: 'ws_1', kind: 'project', title: 'Missão', goal: 'obj', fullAccess: false, maxParallel: 2, schedule: null, autoIntegrate: true, autoPush: false, verifyCommand: null, // fatia 2: projeto não leva agenda; sem verificação = null
    steps: [
      { id: 's1', title: 'A', prompt: 'faça A', provider: 'claude', role: 'builder', model: 'opus', effort: null, dependsOn: [], continueFrom: null },
      { id: 's2', title: 'B', prompt: 'faça B', provider: 'codex', role: 'reviewer', model: null, effort: null, dependsOn: ['s1'], continueFrom: 's1' },
    ],
  });
  assert.equal(draftToBody({ ...d, fullAccess: 'true' }).fullAccess, false); // texto nunca liga o acesso total
  assert.equal(draftToBody({ ...d, fullAccess: true }).fullAccess, true);
  const patch = draftToBody(d, { mode: 'edit' });
  assert.ok(!('workspaceId' in patch)); // editar não troca o workspace
  assert.deepEqual([patch.kind, patch.schedule, patch.autoIntegrate], ['project', null, true]); // fatia 2: o PATCH aceita kind/schedule/autoIntegrate
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
  for (const t of ['const flowsData = useFlows({ intervalMs: 2500 })', 'flows: flowsData.flows, flowsSeenAt', '<Missions onOpenCockpit={openCockpit} data={flowsData} stream={termStream} ']) assert.ok(app.includes(t), t);
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

test('etapa que parou sem report_done (unconfirmed): rótulo próprio, aviso com runId e resumo, detalhe com decisão só no run ativo; quem concluiu aparece', async () => {
  const V = await import('../../client/src/flows-view.js');
  const un = rs('s2', 'waiting', { unconfirmed: true, terminalId: 'term_9', summary: 'Relatório automático: quer que eu continue?' });
  const f = flow({ activeRun: run([rs('s1', 'completed', { completedBy: 'user', decidedAt: T0 }), un, rs('s3', 'waiting')]) });
  assert.deepEqual(waitingSteps(f).map((w) => [w.stepId, w.unconfirmed, w.runId, w.summary]), [['s2', true, 'run_1', un.summary], ['s3', false, 'run_1', null]]);
  assert.equal(flowState(f), 'waiting', 'conta como aguardando você (sidebar e lista)');
  assert.deepEqual(V.runStepMeta(un), V.UNCONFIRMED_META); assert.deepEqual(V.runStepMeta(rs('s3', 'waiting')), STEP_STATE_META.waiting); assert.deepEqual(V.runStepMeta(undefined), STEP_STATE_META.pending);
  const node = buildWorkflow(f).nodes.find((n) => n.id === 's2');
  assert.deepEqual([node.state, node.stateLabel, node.waiting], ['waiting', 'confirme a conclusão', true]); assert.match(node.line, /parou sem confirmar/);
  const d = nodeDetail(f, f.activeRun, 's2'); assert.deepEqual([d.unconfirmed, d.canDecide, d.runId], [true, true, 'run_1']);
  assert.equal(nodeDetail(f, f.activeRun, 's1').completedBy, 'user'); assert.equal(nodeDetail(f, f.activeRun, 's3').canDecide, false);
  const ended = run([un], { status: 'failed' }); assert.equal(nodeDetail(flow({ lastRun: ended }), ended, 's2').canDecide, false, 'run terminado: nada a decidir');
  assert.equal(nodeDetail(f, f.activeRun, 's1').completedBy, 'user'); assert.equal(nodeDetail(flow({ activeRun: run([rs('s1', 'completed', { completedBy: '<x>' })]) }), null, 's1').completedBy, null);
});

test('decisão na tela: use-flows chama a rota de decisão; aviso e painel mostram Aceitar/Recusar só para a etapa sem confirmação; recusar pede confirmação', () => {
  const read = (p) => fs.readFileSync(path.join(here, '../../client/src', p), 'utf8');
  const hook = read('use-flows.js'), head = read('components/FlowHeader.jsx'), panel = read('components/FlowSidePanel.jsx'), page = read('pages/Missions.jsx'), form = read('components/FlowForm.jsx');
  assert.ok(hook.includes('/steps/${encodeURIComponent(stepId)}/decision`, { decision })'));
  assert.ok(head.includes('w.unconfirmed && onDecide && w.runId && <StepDecision') && head.includes('Aceitar como concluída') && head.includes('Recusar'));
  assert.ok(panel.includes('d.canDecide && onDecide && <StepDecision'));
  assert.ok(/decision === 'reject' && !window\.confirm\(/.test(page) && page.includes('onDecide={onDecide}'));
  assert.ok(form.includes('rodam uma por vez na pasta do workspace'), 'o formulário explica que Construtores não rodam juntos');
});

test('etapa sem confirmação com o agente ocupado (agentBusy): não pede decisão; aparece como trabalhando/permissão comum', async () => {
  const V = await import('../../client/src/flows-view.js');
  const busyWait = rs('s1', 'waiting', { unconfirmed: true, agentBusy: true, terminalId: 'term_1' }), busyRun = rs('s2', 'running', { unconfirmed: true, agentBusy: true });
  const f = flow({ activeRun: run([busyWait, busyRun]) });
  assert.deepEqual(waitingSteps(f).map((w) => [w.stepId, w.unconfirmed]), [['s1', false]], 'é um pedido de permissão, não a confirmação');
  assert.deepEqual(V.runStepMeta(busyWait), STEP_STATE_META.waiting); assert.deepEqual(V.runStepMeta(busyRun), STEP_STATE_META.running);
  assert.equal(nodeDetail(f, f.activeRun, 's1').canDecide, false); assert.equal(buildWorkflow(f).nodes.find((n) => n.id === 's1').unconfirmed, false);
  const wf = fs.readFileSync(path.join(here, '../../client/src/components/FlowWorkflow.jsx'), 'utf8'); assert.ok(wf.includes('n.waiting && !n.unconfirmed'), 'leitor de tela sem texto contraditório');
});

// ---------- etapa que parou no LIMITE de uso da conta (stopReason: 'limit', limitResets): Continuar é a ação principal ----------
test('parou no limite: LIMIT_META em runStepMeta, buildWorkflow e nodeDetail; linha do nó com e sem horário de reset', () => {
  const lim = rs('s2', 'waiting', { unconfirmed: true, stopReason: 'limit', limitResets: '3pm (America/Sao_Paulo)', terminalId: 'term_9', summary: "You've hit your limit · resets 3pm" });
  const f = flow({ activeRun: run([rs('s1', 'completed'), lim]) });
  assert.deepEqual(FV.LIMIT_META, { label: 'parou no limite', tone: 'wait' });
  assert.deepEqual(FV.runStepMeta(lim), FV.LIMIT_META);
  const node = buildWorkflow(f).nodes.find((n) => n.id === 's2');
  assert.deepEqual([node.state, node.stateLabel, node.tone, node.waiting, node.unconfirmed, node.limit, node.lineKind], ['waiting', 'parou no limite', 'wait', true, true, true, 'wait']);
  assert.equal(node.line, 'parou no limite da conta (reseta 3pm (America/Sao_Paulo)): clique em Continuar');
  const noReset = flow({ activeRun: run([rs('s1', 'completed'), { ...lim, limitResets: null }]) });
  assert.equal(buildWorkflow(noReset).nodes.find((n) => n.id === 's2').line, 'parou no limite da conta: clique em Continuar');
  const d = nodeDetail(f, f.activeRun, 's2');
  assert.deepEqual([d.stateLabel, d.tone, d.unconfirmed, d.canDecide, d.limit, d.limitResets, d.runId], ['parou no limite', 'wait', true, true, true, '3pm (America/Sao_Paulo)', 'run_1']);
  assert.deepEqual([nodeDetail(noReset, noReset.activeRun, 's2').limit, nodeDetail(noReset, noReset.activeRun, 's2').limitResets], [true, null]);
  // limite só vale com a etapa sem confirmação: agente ocupado, etapa rodando ou concluída não viram "parou no limite"
  for (const other of [{ ...lim, agentBusy: true }, { ...lim, status: 'running' }, { ...lim, status: 'completed' }, { ...lim, unconfirmed: false }]) {
    assert.notDeepEqual(FV.runStepMeta(other), FV.LIMIT_META, JSON.stringify([other.status, other.agentBusy, other.unconfirmed]));
    const g = flow({ activeRun: run([rs('s1', 'completed'), other]) });
    assert.deepEqual([nodeDetail(g, g.activeRun, 's2').limit, nodeDetail(g, g.activeRun, 's2').limitResets, buildWorkflow(g).nodes.find((n) => n.id === 's2').limit], [false, null, false]);
  }
});

test('parou no limite: waitingSteps leva limit e limitResets (texto curto do terminal; vazio, não-texto ou só espaços = null; longo é cortado)', () => {
  const at = (o) => waitingSteps(flow({ activeRun: run([rs('s2', 'waiting', { unconfirmed: true, stopReason: 'limit', ...o })]) }))[0];
  assert.deepEqual([at({ limitResets: '3pm (America/Sao_Paulo)' }).limit, at({ limitResets: '3pm (America/Sao_Paulo)' }).limitResets], [true, '3pm (America/Sao_Paulo)']);
  for (const v of [null, undefined, '', '   ', 42, {}, ['3pm'], true]) assert.equal(at({ limitResets: v }).limitResets, null, String(v));
  const long = at({ limitResets: `${'x'.repeat(200)}` }).limitResets;
  assert.ok(long.length <= FV.MAX_LIMIT_RESETS && long.endsWith('…'), 'cortado em ~60 caracteres');
  assert.equal(at({ limitResets: '  3pm\n(America/Sao_Paulo)  ' }).limitResets, '3pm (America/Sao_Paulo)', 'espaços e quebras viram um espaço só');
  // motivo desconhecido ou permissão: sem limite
  assert.deepEqual([at({ stopReason: 'other', limitResets: '3pm' }).limit, at({ stopReason: 'other', limitResets: '3pm' }).limitResets], [false, null]);
  const perm = waitingSteps(flow({ activeRun: run([rs('s2', 'waiting', { stopReason: 'limit', limitResets: '3pm' })]) }))[0];
  assert.deepEqual([perm.unconfirmed, perm.limit, perm.limitResets], [false, false, null], 'pedido de permissão não é parada no limite');
  // "Continuar" que não reabriu o terminal: o motivo do servidor vai para o cartão (curto); sem decisão pendente, não
  assert.equal(at({ error: 'Não foi possível reabrir o terminal da etapa: x' }).error, 'Não foi possível reabrir o terminal da etapa: x');
  assert.ok(at({ error: 'e'.repeat(900) }).error.length <= 300); for (const v of [null, '', '  ', 7]) assert.equal(at({ error: v }).error, null, String(v));
  assert.equal(waitingSteps(flow({ activeRun: run([rs('s2', 'waiting', { error: 'velho' })]) }))[0].error, null);
});

test('run antigo sem stopReason/limitResets: comportamento genérico (confirme a conclusão, linha "parou sem confirmar", sem limite)', () => {
  const old = rs('s2', 'waiting', { unconfirmed: true, terminalId: 'term_9', summary: 'Relatório automático' }); // sem os campos novos
  const f = flow({ activeRun: run([rs('s1', 'completed'), old]) });
  assert.deepEqual(FV.runStepMeta(old), FV.UNCONFIRMED_META);
  const node = buildWorkflow(f).nodes.find((n) => n.id === 's2');
  assert.deepEqual([node.stateLabel, node.limit], ['confirme a conclusão', false]);
  assert.match(node.line, /parou sem confirmar/); assert.doesNotMatch(node.line, /limite/);
  const w = waitingSteps(f)[0]; assert.deepEqual([w.unconfirmed, w.limit, w.limitResets], [true, false, null]);
  const d = nodeDetail(f, f.activeRun, 's2'); assert.deepEqual([d.stateLabel, d.limit, d.limitResets, d.canDecide], ['confirme a conclusão', false, null, true]);
  assert.equal(buildWorkflow(flow({ activeRun: run([rs('s1', 'completed'), { ...old, stopReason: null, limitResets: null }]) })).nodes.find((n) => n.id === 's2').stateLabel, 'confirme a conclusão', 'stopReason null = genérico');
});

test('parou no limite (tela): Continuar como ação principal no limite, "Pedir para continuar" no genérico; aceitar no limite pede confirmação; continuar não', () => {
  const read = (p) => fs.readFileSync(path.join(here, '../../client/src', p), 'utf8'); // readSrc é declarado mais abaixo no arquivo
  const head = read('components/FlowHeader.jsx'), panel = read('components/FlowSidePanel.jsx'), page = read('pages/Missions.jsx'), css = read('flows.css');
  assert.ok(head.includes("btn('continue', 'primary', 'Continuar'") && head.includes("btn('accept', '', 'Já terminou'"), 'limite: Continuar principal, Já terminou secundário');
  assert.ok(head.includes("btn('continue', '', 'Pedir para continuar'") && head.includes("btn('accept', 'primary', 'Aceitar como concluída'"), 'genérico: aceitar principal, continuar secundário');
  assert.ok(head.includes('limit={w.limit}') && head.includes('onDecide(w.runId, w.stepId, d, { limit: w.limit === true })') && head.includes('w.limitResets'), 'o aviso passa o limite adiante');
  assert.ok(head.includes('<details className="fl-tail">') && head.includes('Ver o fim do terminal') && head.includes('{w.summary}</pre>'), 'fim do terminal em texto puro, recolhido');
  assert.ok(!/dangerouslySetInnerHTML/.test(head + panel), 'texto do terminal nunca vira HTML');
  assert.ok(panel.includes('onDecide(d.runId, d.id, x, { limit: d.limit === true })') && panel.includes("'Fim do terminal (parou no limite)'"));
  assert.ok(/decision === 'accept' && opts\?\.limit === true && !window\.confirm\('O agente parou pelo limite da conta/.test(page), 'aceitar no limite pede confirmação');
  assert.ok(!/decision === 'continue' && !window\.confirm/.test(page) && page.includes("'Pedido enviado: o agente continua de onde parou.'"), 'continuar sem confirmação, com aviso de sucesso');
  assert.ok(css.includes('@keyframes fl-wait-edge') && css.includes('.fl-attn-card {') && css.includes('.fl-tail-pre {'), 'estilo dos cartões e da borda respirando');
});

// ---------- fatia 2: paralelo isolado, integração, retomada e agenda (dados no formato das seções A e B de docs/missions-v2-fatia2.md) ----------
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const gitOf = (o = {}) => ({ mode: 'git', fallbackReason: null, baseBranch: 'main', baseCommit: '1111111', branch: 'orch/run_1', tip: SHA, state: 'ready', op: null, integration: null, pending: null, leftovers: [], cleanedAt: null, branchDeleted: false, discardedAt: null, ...o });
const integ = (state, o = {}) => ({ state, from: null, to: null, conflicts: [], files: [], error: null, at: T0, ...o });

test('fatia 2: rótulos novos de run, missão e etapa; conflito vem antes de tudo na prioridade', () => {
  assert.deepEqual(FV.RUN_STATE_META.interrupted, { label: 'interrompida', tone: 'wait' });
  assert.deepEqual(FV.RUN_STATE_META.ready_to_integrate, { label: 'pronta para integrar', tone: 'wait' });
  assert.deepEqual(FV.RUN_STATE_META.discarded, { label: 'descartada', tone: 'cancel' });
  assert.deepEqual(STEP_STATE_META.interrupted, { label: 'interrompida', tone: 'wait' });
  assert.deepEqual(FLOW_STATE_META.conflict, { label: 'conflito na integração', tone: 'wait' });
  assert.equal(FLOW_STATE_META.interrupted.label, 'interrompida'); assert.equal(FLOW_STATE_META.ready_to_integrate.label, 'pronta para integrar'); assert.equal(FLOW_STATE_META.discarded.label, 'descartada');
  assert.deepEqual(FLOW_STATES.slice(0, 5), ['conflict', 'waiting', 'interrupted', 'ready_to_integrate', 'running'], 'quem pede você vem antes de quem só trabalha');
  assert.deepEqual(new Set(FLOW_STATES), new Set(Object.keys(FLOW_STATE_META)));
  assert.deepEqual([...FV.ACTIVE_RUN_STATES], ['running', 'interrupted', 'ready_to_integrate']);
  assert.equal(FV.isActiveRun({ status: 'interrupted' }), true); assert.equal(FV.isActiveRun({ status: 'completed' }), false); assert.equal(FV.isActiveRun(null), false);
});

test('fatia 2: flowState com conflito, interrompida, pronta para integrar e descartada; run antigo sem os campos fica igual', () => {
  for (const s of ['conflict', 'blocked', 'error']) assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed', { integration: integ(s) }), rs('s2', 'running')]) })), 'conflict', s);
  assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed', { integration: integ('conflict') }), rs('s2', 'waiting')]) })), 'conflict', 'conflito vence a espera');
  for (const s of ['none', 'pending', 'integrating', 'integrated', 'empty']) assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed', { integration: integ(s) }), rs('s2', 'running')]) })), 'running', s);
  assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed', { integration: integ('integrated') }), rs('s2', 'waiting')]) })), 'waiting');
  assert.equal(flowState(flow({ activeRun: run([rs('s1', 'interrupted', { interruptedFrom: 'running' })], { status: 'interrupted', interruptedAt: T0 }) })), 'interrupted');
  // interrompida com conflito: o primeiro passo é Retomar (as ações de integração exigem run `running`)
  assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed', { integration: integ('conflict') }), rs('s2', 'interrupted')], { status: 'interrupted' }) })), 'interrupted');
  assert.equal(flowState(flow({ activeRun: run([rs('s1', 'completed')], { status: 'ready_to_integrate', git: gitOf() }) })), 'ready_to_integrate');
  assert.equal(flowState(flow({ lastRun: run([rs('s1', 'completed')], { status: 'discarded', git: gitOf({ discardedAt: T0 }) }) })), 'discarded');
  // conflito num run já terminado não acende nada
  assert.equal(flowState(flow({ lastRun: run([rs('s1', 'completed', { integration: integ('conflict') })], { status: 'failed' }) })), 'failed');
  const mk = (id, o) => flow({ id, title: id, updatedAt: '2026-11-10T00:00:00Z', ...o });
  const rows = flowRows([
    mk('run', { activeRun: run([rs('s1', 'running')]) }), mk('ready', { activeRun: run([], { status: 'ready_to_integrate' }) }), mk('int', { activeRun: run([rs('s1', 'interrupted')], { status: 'interrupted' }) }),
    mk('wait', { activeRun: run([rs('s1', 'waiting')]) }), mk('conf', { activeRun: run([rs('s1', 'completed', { integration: integ('blocked') })]) }), mk('disc', { lastRun: run([], { status: 'discarded' }) }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['conf', 'wait', 'int', 'ready', 'run', 'disc']);
  assert.deepEqual(rows.map((r) => r.meta.label), ['conflito na integração', 'aguardando você', 'interrompida', 'pronta para integrar', 'em execução', 'descartada']);
});

test('fatia 2: runActions oferece só o que o servidor aceita em cada estado', () => {
  const act = (status, git = null, where = 'activeRun') => FV.runActions(flow({ [where]: run([], { status, git }) }));
  const pick = (a) => [a.canResume, a.canCancel, a.canIntegrate, a.canDiscard, a.canCleanup];
  assert.deepEqual(pick(FV.runActions(flow())), [false, false, false, false, false]);
  assert.equal(FV.runActions(flow()).runId, null);
  assert.deepEqual(pick(act('running')), [false, true, false, false, false]);
  assert.deepEqual(pick(act('interrupted')), [true, true, false, false, false]);
  assert.deepEqual(pick(act('ready_to_integrate', gitOf())), [false, false, true, true, false]);
  assert.equal(act('ready_to_integrate', gitOf()).runId, 'run_1');
  for (const s of ['cancelled', 'failed']) { // descartar só em modo Git e ainda não descartada
    assert.deepEqual(pick(act(s, gitOf(), 'lastRun')), [false, false, false, true, false], s);
    assert.equal(act(s, gitOf({ discardedAt: T0 }), 'lastRun').canDiscard, false, `${s} já descartada`);
    assert.equal(act(s, gitOf({ mode: 'folder' }), 'lastRun').canDiscard, false, `${s} modo pasta`);
    assert.equal(act(s, null, 'lastRun').canDiscard, false, `${s} run antigo`);
  }
  assert.equal(act('completed', gitOf({ leftovers: [{ worktreeId: 'wt_1', reason: 'sujo' }] }), 'lastRun').canCleanup, true);
  assert.equal(act('completed', gitOf(), 'lastRun').canCleanup, false);
  assert.equal(act('completed', null, 'lastRun').canCleanup, false);
  assert.deepEqual(pick(act('discarded', gitOf({ discardedAt: T0 }), 'lastRun')), [false, false, false, false, false]);
});

test('fatia 2: integrationInfo (final) e stepIntegration (por etapa)', () => {
  assert.equal(FV.integrationInfo(null), null);
  assert.equal(FV.integrationInfo(run([])), null, 'run antigo sem git');
  assert.equal(FV.integrationInfo(run([], { git: gitOf({ mode: 'folder' }) })), null, 'modo pasta');
  const auto = FV.integrationInfo(run([], { status: 'completed', git: gitOf({ integration: { by: 'auto', mode: 'ff', at: T0, from: '2222222', to: SHA, missionTip: SHA, digest: 'x', policy: {} } }) }));
  assert.deepEqual([auto.state, auto.by, auto.byLabel, auto.mode, auto.at, auto.commitShort, auto.label, auto.branch, auto.baseBranch], ['integrated', 'auto', 'automática', 'ff', T0, 'abcdef1', 'integrada automaticamente', 'orch/run_1', 'main']);
  assert.deepEqual([auto.reasons, auto.conflicts, auto.files, auto.needsAck], [[], [], [], false]);
  const user = FV.integrationInfo(run([], { status: 'completed', git: gitOf({ integration: { by: 'user', mode: 'merge', at: T0, to: 'zz' } }) }));
  assert.deepEqual([user.label, user.commitShort], ['integrada por você', null], 'sha inválido não vira commit');
  const pend = FV.integrationInfo(run([], { status: 'ready_to_integrate', git: gitOf({ pending: { reasons: [{ code: 'target_dirty', message: 'A pasta tem alterações não commitadas.' }, { code: 'project_config_changed', message: 'Configuração alterada.' }, null], conflicts: ['a.js', 3], files: ['package.json'], checkedAt: T0 } }) }));
  assert.deepEqual([pend.state, pend.label, pend.by, pend.commitShort, pend.needsAck, pend.conflicts, pend.files, pend.checkedAt], ['pending', 'pronta para integrar', null, null, true, ['a.js'], ['package.json'], T0]);
  assert.deepEqual(pend.reasons.map((r) => r.code), ['target_dirty', 'project_config_changed']);
  assert.equal(FV.integrationInfo(run([], { status: 'ready_to_integrate', git: gitOf() })).state, 'pending', 'pronta mesmo sem diagnóstico gravado');
  assert.equal(FV.integrationInfo(run([], { status: 'running', git: gitOf() })).state, 'none');

  assert.deepEqual(FV.stepIntegration(rs('s1', 'running')), { state: 'none', label: 'sem integração', tone: 'idle', reason: null, message: null, conflicts: [], files: [], error: null, at: null, needsAction: false, needsAck: false });
  assert.equal(FV.stepIntegration(null).state, 'none');
  const c = FV.stepIntegration(rs('s1', 'completed', { integration: integ('conflict', { conflicts: ['src/a.js', 'src/b.js'] }) }));
  assert.deepEqual([c.state, c.label, c.tone, c.conflicts, c.needsAction, c.needsAck], ['conflict', 'conflito na integração', 'wait', ['src/a.js', 'src/b.js'], true, false]);
  const b = FV.stepIntegration(rs('s1', 'completed', { integration: integ('blocked', { files: ['.env'] }) }));
  assert.deepEqual([b.needsAction, b.needsAck, b.files], [true, true, ['.env']]);
  const e = FV.stepIntegration(rs('s1', 'completed', { integration: integ('error', { error: 'git sem resposta' }) }));
  assert.deepEqual([e.tone, e.error, e.needsAction], ['err', 'git sem resposta', true]);
  assert.deepEqual([FV.stepIntegration(rs('s1', 'completed', { integration: integ('integrated') })).label, FV.stepIntegration(rs('s1', 'completed', { integration: integ('empty') })).tone], ['integrada', 'skip']);
  const unk = FV.stepIntegration(rs('s1', 'completed', { integration: integ('novo') }));
  assert.deepEqual([unk.label, unk.tone, unk.needsAction], ['novo', 'idle', false]);
  // aviso no topo: só no run ativo `running`, com caminho do worktree só se o servidor mandou
  const f = flow({ activeRun: run([rs('s1', 'completed', { integration: integ('conflict', { conflicts: ['x'] }), branch: 'orch/wt_1', worktreePath: 'C:/tmp/wt_1' }), rs('s2', 'completed', { integration: integ('error', { error: 'falhou' }) }), rs('s3', 'running')]) });
  assert.deepEqual(FV.integrationProblems(f).map((p) => [p.stepId, p.runId, p.title, p.state, p.worktreePath, p.branch]), [['s1', 'run_1', 'Etapa s1', 'conflict', 'C:/tmp/wt_1', 'orch/wt_1'], ['s2', 'run_1', 'Etapa s2', 'error', null, null]]);
  assert.deepEqual(FV.integrationProblems(flow({ activeRun: { ...f.activeRun, status: 'interrupted' } })), []);
  assert.deepEqual(FV.integrationProblems(flow()), []);
});

test('fatia 2: rótulos da agenda, próxima execução e pulos', () => {
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'interval', everyHours: 4 }), 'a cada 4 h');
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'daily', time: '09:00' }), 'diário às 09:00');
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'weekly', days: [3, 1], time: '08:30' }), 'seg, qua às 08:30');
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'weekly', days: [0, 6], time: '08:30' }), 'dom, sáb às 08:30');
  assert.equal(FV.scheduleLabel({ enabled: false, kind: 'daily', time: '09:00' }), 'desligada');
  assert.equal(FV.scheduleLabel(null), 'sem agenda'); assert.equal(FV.scheduleLabel(undefined), 'sem agenda');
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'daily', time: '25:00' }), NOT_INFORMED);
  assert.equal(FV.scheduleLabel({ enabled: true, kind: 'weekly', days: [], time: '08:30' }), NOT_INFORMED);
  assert.equal(FV.nextRunLabel(T0), fmtWhen(T0)); assert.match(FV.nextRunLabel(T0), /^\d{2}\/\d{2}.*\d{2}:\d{2}$/);
  assert.equal(FV.nextRunLabel(null), '—'); assert.equal(FV.nextRunLabel('lixo'), '—');
  assert.deepEqual(FV.skipRows(flow()), []); assert.deepEqual(FV.skipRows(null), []);
  const rows = FV.skipRows(flow({ scheduleSkips: [
    { slotAt: '2026-11-16T08:00:00.000Z', reason: 'missed', message: 'perdido', count: 3, at: T0 },
    { slotAt: '2026-11-16T09:00:00.000Z', reason: 'active_run', message: 'run ativo', at: T0 },
    { slotAt: '2026-11-15T09:00:00.000Z', reason: 'start_failed', at: T0 },
    { slotAt: '2026-11-14T09:00:00.000Z', reason: 'limit', at: T0 }, { slotAt: '2026-11-13T09:00:00.000Z', reason: 'archived', at: T0 },
    { slotAt: '2026-11-12T09:00:00.000Z', reason: 'workspace_missing', at: T0 }, { slotAt: '2026-11-11T09:00:00.000Z', reason: 'estranho', at: T0 }, null,
  ] }));
  assert.deepEqual(rows.map((r) => r.reason), ['active_run', 'missed', 'start_failed', 'limit', 'archived', 'workspace_missing', 'estranho'], 'mais recente primeiro');
  assert.match(rows[1].label, /horário perdido/); assert.deepEqual([rows[1].count, rows[1].countLabel, rows[1].message], [3, '3 horários', 'perdido']);
  assert.deepEqual([rows[0].count, rows[2].message], [null, null]);
  assert.match(rows[0].label, /execução anterior ainda estava ativa/); assert.match(rows[2].label, /não foi possível iniciar/); assert.match(rows[3].label, /limite/);
  assert.match(rows[4].label, /arquivada/); assert.match(rows[5].label, /workspace não existe/); assert.equal(rows[6].label, 'estranho');
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'chaves únicas para a lista');
  assert.match(rows[0].when, /^\d{2}\/\d{2}/);
});

test('fatia 2: rascunho da agenda espelha as regras do servidor', () => {
  const e = FV.emptySchedule();
  assert.deepEqual(e, { enabled: true, kind: 'daily', everyHours: 4, time: '09:00', days: [1, 2, 3, 4, 5] });
  assert.equal(FV.validateScheduleDraft(e).ok, true);
  assert.deepEqual(FV.scheduleToDraft(null), e);
  assert.deepEqual(FV.scheduleToDraft({ enabled: true, kind: 'interval', everyHours: 6 }), { ...e, kind: 'interval', everyHours: 6 });
  assert.deepEqual(FV.scheduleToDraft({ enabled: false, kind: 'weekly', days: [5, 1, 1], time: '07:15' }), { ...e, enabled: false, kind: 'weekly', days: [1, 5], time: '07:15' });
  const v = (o) => FV.validateScheduleDraft({ ...e, ...o }).errors.map((x) => x.field);
  assert.deepEqual(v({ kind: 'interval', everyHours: 1 }), []); assert.deepEqual(v({ kind: 'interval', everyHours: 168 }), []); assert.deepEqual(v({ kind: 'interval', everyHours: '12' }), []);
  for (const h of [0, 169, 1.5, '', null, 'x']) assert.deepEqual(v({ kind: 'interval', everyHours: h }), ['schedule.everyHours'], String(h));
  for (const t of ['9:00', '24:00', '12:60', '', 'aa:bb']) assert.deepEqual(v({ kind: 'daily', time: t }), ['schedule.time'], t);
  assert.deepEqual(v({ kind: 'daily', time: '23:59' }), []); assert.deepEqual(v({ kind: 'daily', time: '00:00' }), []);
  assert.deepEqual(v({ kind: 'weekly', days: [] }), ['schedule.days']); assert.deepEqual(v({ kind: 'weekly', days: [7] }), ['schedule.days']); assert.deepEqual(v({ kind: 'weekly', days: [0, 6] }), []);
  assert.deepEqual(v({ kind: 'monthly' }), ['schedule.kind']); assert.equal(FV.validateScheduleDraft(undefined).ok, false);
  // rascunho → API: só os campos do preset
  assert.deepEqual(FV.draftToSchedule({ ...e, kind: 'interval', everyHours: '8' }), { enabled: true, kind: 'interval', everyHours: 8 });
  assert.deepEqual(FV.draftToSchedule(e), { enabled: true, kind: 'daily', time: '09:00' });
  assert.deepEqual(FV.draftToSchedule({ ...e, kind: 'weekly', days: [3, 1, 3], enabled: 'true' }), { enabled: false, kind: 'weekly', days: [1, 3], time: '09:00' }, 'enabled estrito; dias únicos e ordenados');
  assert.deepEqual(FV.toggleScheduleDay({ ...e, days: [1, 5] }, 3).days, [1, 3, 5]); assert.deepEqual(FV.toggleScheduleDay({ ...e, days: [1, 5] }, 5).days, [1]);
});

test('fatia 2: rascunho do formulário com tipo, agenda e integração automática; corpo do POST/PATCH', () => {
  const base = emptyDraft({ workspaceId: 'ws_1' });
  assert.deepEqual([base.kind, base.autoIntegrate, base.schedule], ['project', true, FV.emptySchedule()]);
  assert.equal(emptyDraft({ kind: 'automation' }).kind, 'automation'); assert.equal(emptyDraft({ kind: 'lixo' }).kind, 'project');
  const d = patchStep({ ...base, title: 'Rotina' }, 'k1', { title: 'A', prompt: 'faça' });
  // agenda inválida só importa em automação
  const badSched = { ...d, schedule: { ...d.schedule, kind: 'interval', everyHours: 0 } };
  assert.equal(validateDraft(badSched).ok, true, 'projeto ignora a agenda');
  const av = validateDraft({ ...badSched, kind: 'automation' });
  assert.deepEqual([av.ok, av.errors.map((x) => x.field)], [false, ['schedule.everyHours']]);
  assert.equal(validateDraft({ ...d, kind: 'automation' }).ok, true);
  assert.deepEqual(validateDraft({ ...d, kind: 'outro' }).errors.map((x) => x.field), ['kind']);
  const { kind: _k, schedule: _s, autoIntegrate: _a, ...old } = d; assert.equal(validateDraft(old).ok, true, 'rascunho sem os campos novos continua válido');
  const auto = { ...d, kind: 'automation', schedule: { ...d.schedule, kind: 'weekly', days: [3, 1], time: '08:30' } };
  const cb = draftToBody(auto);
  assert.deepEqual([cb.workspaceId, cb.kind, cb.schedule, cb.autoIntegrate], ['ws_1', 'automation', { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' }, true]);
  const pb = draftToBody(auto, { mode: 'edit' });
  assert.deepEqual([('workspaceId' in pb), pb.kind, pb.schedule.kind], [false, 'automation', 'weekly']);
  assert.equal(draftToBody({ ...d, autoIntegrate: false }).autoIntegrate, false);
  assert.equal(draftToBody({ ...d, autoIntegrate: 'true' }).autoIntegrate, false, 'texto nunca liga a integração automática');
  assert.equal(draftToBody({ ...auto, kind: 'project' }).schedule, null, 'projeto não leva agenda');
  assert.deepEqual(FV.draftToScheduleBody(auto), { schedule: { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' }, autoIntegrate: true, autoPush: false });
  assert.deepEqual(FV.draftToScheduleBody({ ...d, autoIntegrate: false }), { schedule: null, autoIntegrate: false, autoPush: false });
  // editar: ida e volta
  const fd = flowToDraft(flow({ kind: 'automation', autoIntegrate: false, schedule: { enabled: true, kind: 'interval', everyHours: 4 } }));
  assert.deepEqual([fd.kind, fd.autoIntegrate, fd.schedule.kind, fd.schedule.everyHours], ['automation', false, 'interval', 4]);
  assert.deepEqual(draftToBody(fd, { mode: 'edit' }).schedule, { enabled: true, kind: 'interval', everyHours: 4 });
  // missão antiga sem os campos: projeto, integração automática ligada, agenda padrão no rascunho
  const legacy = flowToDraft({ ...flow(), autoIntegrate: undefined, schedule: undefined });
  assert.deepEqual([legacy.kind, legacy.autoIntegrate, legacy.schedule], ['project', true, FV.emptySchedule()]);
  assert.equal(draftToBody(legacy, { mode: 'edit' }).schedule, null);
});

test('fatia 2: indicador da barra lateral conta conflito, interrompida e pronta para integrar como "aguardando você"', () => {
  const conf = flow({ id: 'a', activeRun: run([rs('s1', 'completed', { integration: integ('conflict') }), rs('s2', 'running')]) });
  const intr = flow({ id: 'b', activeRun: run([rs('s1', 'interrupted')], { status: 'interrupted' }) });
  const ready = flow({ id: 'c', activeRun: run([rs('s1', 'completed')], { status: 'ready_to_integrate' }) });
  const ready2 = flow({ id: 'd', activeRun: run([rs('s1', 'completed')], { status: 'ready_to_integrate' }) });
  const wait = flow({ id: 'e', activeRun: run([rs('s1', 'waiting')]) });
  const work = flow({ id: 'f', activeRun: run([rs('s1', 'running')]) });
  assert.equal(flowsActivity([intr]).title, '1 missão interrompida');
  assert.equal(flowsActivity([ready]).title, '1 missão pronta para integrar');
  assert.equal(flowsActivity([conf]).title, '1 missão com conflito na integração');
  const all = flowsActivity([conf, intr, ready, ready2, wait, work]);
  assert.deepEqual([all.state, all.count, all.waiting, all.working], ['waiting', 5, 5, 1]);
  assert.equal(all.title, '1 missão com conflito na integração · 1 missão aguardando você · 1 missão interrompida · 2 missões prontas para integrar · 1 missão em execução');
  assert.deepEqual(Object.keys(all).sort(), ['count', 'done', 'failed', 'state', 'title', 'waiting', 'working'], 'formato do retorno não muda (a Sidebar usa)');
  assert.equal(flowsActivity([flow({ archived: true, activeRun: run([], { status: 'interrupted' }) })]).state, null);
  assert.equal(flowsActivity([flow({ lastRun: run([], { status: 'discarded', finishedAt: '2026-11-16T11:00:00.000Z' }) })]).state, null, 'descartada não acende nada');
});

test('fatia 2: workflow e detalhe com etapa interrompida, integração por nó e Entrega integrada ou pronta para integrar', () => {
  const f = flow({ activeRun: run([
    rs('s1', 'completed', { integration: integ('integrated'), branch: 'orch/wt_a', worktreeId: 'wt_a', commit: SHA }),
    rs('s2', 'interrupted', { interruptedFrom: 'running', terminalId: 'term_2', branch: 'orch/wt_b', worktreeId: 'wt_b', integration: integ('none') }),
    rs('s3', 'completed', { integration: integ('conflict', { conflicts: ['src/x.js'] }), worktreePath: 'C:/tmp/wt_c', worktreeId: 'wt_c', branch: 'orch/wt_c' }),
  ], { status: 'interrupted', git: gitOf() }) });
  const wf = buildWorkflow(f), n = (id) => wf.nodes.find((x) => x.id === id);
  assert.deepEqual([n('s2').state, n('s2').stateLabel, n('s2').tone, n('s2').line, n('s2').lineKind, n('s2').waiting], ['interrupted', 'interrompida', 'wait', 'interrompida pelo reinício do servidor: clique em Retomar', 'wait', false]);
  assert.equal(wf.edges.find((x) => x.id === 's1->s2').state, 'wait');
  assert.deepEqual([n('s1').integration.state, n('s3').integration.state, n('s3').integration.conflicts, n('s4').integration.state], ['integrated', 'conflict', ['src/x.js'], 'none']);
  assert.deepEqual([n('delivery').state, n('delivery').line], ['pending', null], 'run interrompido: entrega na fila');
  const d2 = nodeDetail(f, f.activeRun, 's2');
  assert.deepEqual([d2.state, d2.branch, d2.worktreeId, d2.integration.state, d2.terminalLive, ('worktreePath' in d2), d2.canResolveIntegration], ['interrupted', 'orch/wt_b', 'wt_b', 'none', false, false, false]);
  assert.match(d2.terminalHint, /Retomar/);
  const d3 = nodeDetail(f, f.activeRun, 's3');
  assert.deepEqual([d3.worktreePath, d3.integration.state, d3.canResolveIntegration], ['C:/tmp/wt_c', 'conflict', false], 'resolver só com o run em execução');
  const running = { ...f.activeRun, status: 'running' };
  assert.equal(nodeDetail(flow({ activeRun: running }), running, 's3').canResolveIntegration, true);
  // run antigo: campos novos vazios, sem caminho inventado
  const old = nodeDetail(flow(), run([rs('s1', 'completed')]), 's1');
  assert.deepEqual([old.branch, old.worktreeId, old.integration.state, ('worktreePath' in old)], [null, null, 'none', false]);
  // entrega integrada / pronta / descartada / concluída sem Git / sem alterações
  const done = run(['s1', 's2', 's3', 's4'].map((s) => rs(s, 'completed', { integration: integ('integrated') })), { status: 'completed', finishedAt: T0, git: gitOf({ integration: { by: 'auto', mode: 'ff', at: T0, to: SHA } }) });
  const dn = buildWorkflow(flow({ lastRun: done })).nodes.find((x) => x.id === 'delivery');
  assert.deepEqual([dn.state, dn.line, dn.integration.by], ['completed', 'integrada em main', 'auto']);
  const dd = nodeDetail(flow({ lastRun: done }), done, 'delivery');
  assert.deepEqual([dd.line, dd.integration.commitShort], ['integrada em main', 'abcdef1']);
  const ready = run([rs('s1', 'completed')], { status: 'ready_to_integrate', git: gitOf({ pending: { reasons: [{ code: 'target_dirty', message: 'pasta suja' }], conflicts: [], files: [], checkedAt: T0 } }) });
  const rn = buildWorkflow(flow({ activeRun: ready })).nodes.find((x) => x.id === 'delivery');
  assert.deepEqual([rn.state, rn.stateLabel, rn.tone, rn.line, rn.integration.reasons.length], ['ready_to_integrate', 'pronta para integrar', 'wait', 'pronta para integrar em main', 1]);
  const disc = buildWorkflow(flow({ lastRun: run([], { status: 'discarded', git: gitOf({ discardedAt: T0 }) }) })).nodes.find((x) => x.id === 'delivery');
  assert.deepEqual([disc.state, disc.stateLabel, disc.tone], ['discarded', 'descartada', 'cancel']);
  const legacy = buildWorkflow(flow({ lastRun: run(['s1', 's2', 's3', 's4'].map((s) => rs(s, 'completed')), { status: 'completed' }) })).nodes.find((x) => x.id === 'delivery');
  assert.deepEqual([legacy.line, legacy.integration], ['todas as etapas concluídas', null], 'run antigo: igual à fatia 1');
  const empty = run([], { status: 'completed', git: gitOf({ integration: { by: 'auto', mode: 'empty', at: T0 } }) });
  assert.equal(buildWorkflow(flow({ lastRun: empty })).nodes.find((x) => x.id === 'delivery').line, 'todas as etapas concluídas', 'sem alterações: nada foi integrado');
});

test('fatia 2: histórico com gatilho (manual/agenda) e integração resumida', () => {
  const rows = historyRows([
    run([], { id: 'run_3', status: 'completed', trigger: 'schedule', scheduledFor: T0, finishedAt: T0, git: gitOf({ integration: { by: 'user', mode: 'merge', at: T0, to: SHA } }) }),
    run([], { id: 'run_2', status: 'ready_to_integrate', git: gitOf() }),
    run([], { id: 'run_1', status: 'discarded', trigger: undefined, git: gitOf({ discardedAt: T0 }) }),
    run([], { id: 'run_0', status: 'completed' }),
  ], flow(), { now: Date.parse(T0) });
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.trigger]), [['run_3', 'concluída', 'agenda'], ['run_2', 'pronta para integrar', 'manual'], ['run_1', 'descartada', 'manual'], ['run_0', 'concluída', 'manual']]);
  assert.deepEqual(rows[0].integration, { state: 'integrated', label: 'integrada por você', by: 'user', mode: 'merge', at: T0, commitShort: 'abcdef1' });
  assert.deepEqual([rows[1].integration.state, rows[1].integration.label], ['pending', 'pronta para integrar']);
  assert.deepEqual([rows[2].integration, rows[3].integration], [null, null]);
});

// ---------- fatia 2: interface (checagens de código-fonte, como as da decisão acima) ----------
const readSrc = (p) => fs.readFileSync(path.join(here, '../../client/src', p), 'utf8');

test('fatia 2 (tela): use-flows chama as rotas novas; o ack só vai com confirmação explícita; PATCH da agenda leva só schedule/autoIntegrate; erro preserva code e files', () => {
  const hook = readSrc('use-flows.js');
  for (const t of ['/resume`, {})', '/integrate`, ackBody(opts))', '/discard`, { deleteBranch: deleteBranch === true })', '/cleanup`, {})',
    '/steps/${encodeURIComponent(stepId)}/integration`, { action, ...ackBody(opts) })']) assert.ok(hook.includes(t), t);
  assert.ok(/opts\?\.acknowledgeProjectConfig === true && Array\.isArray\(opts\.acknowledgedFiles\)\s*\? \{ acknowledgeProjectConfig: true, acknowledgedFiles: strList\(opts\.acknowledgedFiles\) \} : \{\}/.test(hook), 'ack só com true estrito e SEMPRE com a lista vista, nunca por padrão');
  assert.equal(hook.match(/acknowledgeProjectConfig: true/g).length, 1, 'nenhum outro lugar do hook liga o ack');
  assert.ok(hook.includes('{ schedule: body?.schedule ?? null, autoIntegrate: body?.autoIntegrate === true, autoPush: body?.autoPush === true }'), 'updateSchedule não repassa outros campos');
  assert.ok(hook.includes("typeof data.code === 'string' ? { code: data.code } : {}") && hook.includes('files: strList(data.files)'), 'a tela recebe code e a lista de arquivos do 409');
});

test('fatia 2 (tela): página só reenvia com ack depois do diálogo; descartar pede confirmação; Cancelar e Descartar etapa usam window.confirm', () => {
  const page = readSrc('pages/Missions.jsx'), head = readSrc('components/FlowHeader.jsx');
  assert.ok(page.includes("e?.code === 'project_config_changed'"), '409 project_config_changed abre a confirmação');
  assert.ok(page.includes('if (info?.needsAck) { askAck(') && page.includes('if (p.needsAck) { askAck('), 'bloqueio conhecido pergunta antes de tentar');
  // o ack só aparece no handler do diálogo (confirmAck)
  const acks = [...page.matchAll(/acknowledgeProjectConfig: true/g)].map((m) => m.index), at = page.indexOf('const confirmAck'), end = page.indexOf('const onDiscardStep');
  assert.ok(acks.length === 2 && acks.every((i) => i > at && i < end), 'ack só dentro de confirmAck');
  assert.ok(head.includes('disabled={!checked || !!busy}') && head.includes('Revisei esses arquivos e quero integrar mesmo assim.'), 'o botão do diálogo só libera com a caixa marcada');
  assert.ok(head.includes('configuração executável do projeto ou arquivos sensíveis'));
  assert.ok(/onDiscardStep = \(p\) => \{\s*if \(!flow \|\| !p\?\.runId \|\| !window\.confirm\(/.test(page), 'Descartar etapa pede confirmação');
  assert.ok(/!window\.confirm\('Cancelar a missão\?/.test(page), 'Cancelar pede confirmação');
  assert.ok(page.includes('<DiscardDialog') && head.includes('Apagar também a branch da missão') && head.includes('const [deleteBranch, setDeleteBranch] = useState(false)'), 'Descartar abre o diálogo com a caixa (desmarcada) de apagar a branch');
  assert.ok(page.includes('actions.discard(flow.id, d.runId, { deleteBranch: deleteBranch === true })'));
  assert.ok(page.includes('actions.discard(flow.id, ra.runId, { deleteBranch: false })'), 'Limpar cópias de run cancelado/falho nunca apaga a branch');
  assert.ok(/onCleanup = \(\) => \{[\s\S]*?window\.confirm\(/.test(page), 'Limpar cópias pede confirmação');
});

test('fatia 2 (tela): cabeçalho usa runActions e mostra chips de branch, integração automática, agenda e próxima execução', () => {
  const head = readSrc('components/FlowHeader.jsx');
  assert.ok(head.includes('runActions(flow)') && head.includes('integrationInfo(run)'));
  for (const t of ['ra.canResume &&', 'ra.canIntegrate &&', 'ra.canCancel &&', '(ra.canDiscard || ra.canCleanup)', '<span>Retomar</span>', '<span>Integrar</span>', '<span>Descartar</span>', '<span>Limpar cópias</span>']) assert.ok(head.includes(t), t);
  for (const t of ['branch {info.branch}', 'integração automática', 'próxima: {nextRunLabel(flow.nextRunAt)}', 'scheduleLabel(flow.schedule)', 'flow.autoIntegrate !== false']) assert.ok(head.includes(t), t);
  assert.ok(head.includes("auto ? 'Editar agenda' : 'Editar integração'") && head.includes('onEditSchedule'), 'com run ativo só agenda/integração podem mudar');
  // aviso: conflito com pasta e instrução, interrupção e pronta para integrar com motivos
  for (const t of ['Resolva os conflitos nessa pasta, commite e clique em Tentar de novo.', '<span>Tentar de novo</span>', '<span>Descartar etapa</span>', 'Missão interrompida', 'Pronta para integrar', 'ready.reasons.map']) assert.ok(head.includes(t), t);
  const page = readSrc('pages/Missions.jsx');
  assert.ok(page.includes('integrationProblems(flow)') && page.includes('problems={problems}') && page.includes('interrupted={!!ra?.canResume}') && page.includes('ready={readyInfo}'));
});

test('fatia 2 (tela): formulário com tipo, presets da agenda, avisos e integração automática; modo reduzido envia só a agenda', () => {
  const form = readSrc('components/FlowForm.jsx');
  for (const t of ['value="project"', 'value="automation"', "id: 'interval'", "id: 'daily'", "id: 'weekly'", 'WEEKDAY_SHORT.map', 'toggleScheduleDay(sd, day)', 'Agenda ligada', 'type="time"']) assert.ok(form.includes(t), t);
  assert.ok(form.includes('Roda só com o FORGE aberto; horários perdidos são pulados.'));
  assert.ok(form.includes('{!fullAccess && <p') && form.includes('Sem acesso total, a automação pode parar pedindo permissão sem ninguém olhando.'), 'aviso só sem acesso total');
  assert.ok(form.includes('Integrar automaticamente na sua branch quando terminar sem conflitos'));
  assert.ok(form.includes('Em workspace Git, cada etapa trabalha numa cópia isolada (só arquivos versionados; alterações não commitadas na sua pasta não entram). Sua pasta só muda na integração final, e só se estiver limpa.'));
  // briefing: o create passa a levar o proposalId (só da proposta carregada); o modo reduzido continua mandando só a agenda
  assert.ok(form.includes('validateScheduleDraft(draft.schedule)') && form.includes('reduced ? draftToScheduleBody(draft) : draftToBody(draft, { mode, proposalId: fromProposal ? proposal.id : null })'), 'modo reduzido: valida e envia só a agenda');
  const page = readSrc('pages/Missions.jsx');
  assert.ok(page.includes("form?.mode === 'schedule'") && page.includes('actions.updateSchedule(form.flow.id, body)'));
});

test('fatia 2 (tela): painel, workflow e histórico mostram integração, interrupção, gatilho e pulos da agenda', () => {
  const panel = readSrc('components/FlowSidePanel.jsx'), wf = readSrc('components/FlowWorkflow.jsx'), runs = readSrc('components/FlowRuns.jsx');
  assert.ok(panel.includes('d.canResolveIntegration') && panel.includes('<IntegrationProblem') && panel.includes("d.state === 'interrupted'"), 'etapa: resolver integração e dica de Retomar');
  for (const t of ["info.by === 'auto'", 'info?.commitShort', 'info?.mode', 'info?.at', 'd.line']) assert.ok(panel.includes(t), t);
  assert.ok(wf.includes("integrated: 'integrada'") && wf.includes("conflict: 'conflito'") && wf.includes("blocked: 'bloqueada'") && wf.includes("pending: 'pendente'"), 'selo de integração por nó');
  assert.ok(wf.includes("node.state === 'ready_to_integrate'"), 'entrega pronta para integrar destacada');
  assert.ok(runs.includes('<td>{r.trigger}</td>') && runs.includes('integrationText(r.integration)') && runs.includes('skipRows(flow)') && runs.includes('s.countLabel'));
  const css = readSrc('flows.css');
  assert.ok(css.includes('.fl-runs-wrap { overflow-x: auto;') && css.includes('.fl-wf .mwf-node.fl-ask'), 'tabela rola dentro do histórico; destaque sem brilho');
});

// ---------- revisão da fatia 2: ack atado à lista, limpeza de cópias, causa do bloqueio, modo pasta e política sem ninguém olhando ----------
test('revisão: runActions oferece Limpar cópias em run terminado de modo Git com sobras (último run), e escolhe descartar ou limpar', () => {
  const left = [{ worktreeId: 'wt_1', reason: 'terminal ainda aberto' }, { worktreeId: 'wt_2', reason: 'alterações não integradas' }];
  const last = (status, git) => FV.runActions(flow({ lastRun: run([], { status, git, finishedAt: T0 }) }));
  for (const s of ['completed', 'failed', 'cancelled', 'discarded']) {
    const a = last(s, gitOf({ leftovers: left, discardedAt: s === 'completed' ? null : T0 }));
    assert.deepEqual([a.canCleanup, a.canDiscard, a.cleanupAction, a.runId], [true, false, 'cleanup', 'run_1'], s);
    assert.deepEqual(a.leftovers.map((l) => [l.worktreeId, l.reason]), [['wt_1', 'terminal ainda aberto'], ['wt_2', 'alterações não integradas']], s);
    assert.equal(last(s, gitOf({ leftovers: [], discardedAt: T0 })).canCleanup, false, `${s} sem sobras`);
    assert.equal(last(s, gitOf({ mode: 'folder', leftovers: left })).canCleanup, false, `${s} modo pasta`);
  }
  // cancelado/falho ainda não descartado: o botão descarta (sem apagar a branch), mesmo se já houver sobras
  for (const s of ['failed', 'cancelled']) {
    assert.deepEqual([last(s, gitOf()).cleanupAction, last(s, gitOf({ leftovers: left })).cleanupAction], ['discard', 'discard'], s);
  }
  // ativos nunca limpam; pronta para integrar descarta pelo diálogo próprio (sem cleanupAction)
  for (const s of ['running', 'interrupted', 'ready_to_integrate']) {
    const a = FV.runActions(flow({ activeRun: run([], { status: s, git: gitOf({ leftovers: left }) }) }));
    assert.equal(a.canCleanup, false, s); assert.equal(a.cleanupAction, null, s);
  }
  assert.deepEqual([FV.runActions(flow()).cleanupAction, FV.runActions(flow()).leftovers], [null, []]);
  // linhas das sobras: motivo ausente vira texto claro; lixo é ignorado; só modo Git
  assert.deepEqual(FV.leftoverRows(run([], { git: gitOf({ leftovers: [{ worktreeId: 'wt_9' }, null, 'x'] }) })).map((l) => [l.worktreeId, l.reason]), [['wt_9', 'motivo não informado']]);
  assert.deepEqual(FV.leftoverRows(run([], { git: gitOf({ mode: 'folder', leftovers: left }) })), []);
  assert.deepEqual(FV.leftoverRows(null), []);
  assert.match(FV.LEFTOVERS_HINT, /Feche o terminal/);
});

test('revisão: stepIntegration usa a causa do bloqueio; só o guard de configuração pede confirmação', () => {
  const si = (o) => FV.stepIntegration(rs('s1', 'completed', { integration: integ('blocked', o) }));
  const cfg = si({ reason: 'project_config_changed', files: ['package.json'], error: 'a etapa alterou configuração executável' });
  assert.deepEqual([cfg.needsAck, cfg.needsAction, cfg.reason, cfg.label, cfg.files], [true, true, 'project_config_changed', 'integração bloqueada: configuração ou arquivo sensível alterado', ['package.json']]);
  assert.match(cfg.message, /confirmação explícita/);
  const co = si({ reason: 'branch_checked_out', error: 'a branch da missão está em checkout em outra pasta do repositório; troque a branch daquela pasta e tente de novo' });
  assert.deepEqual([co.needsAck, co.needsAction, co.reason], [false, true, 'branch_checked_out']);
  assert.match(co.label, /checkout em outra pasta/); assert.doesNotMatch(co.label, /configura/);
  assert.equal(co.message, FV.BRANCH_CHECKED_OUT_TEXT);
  assert.match(co.message, /a branch da missão está em checkout em outra pasta do repositório; troque a branch daquela pasta e clique em Tentar de novo/i); assert.doesNotMatch(co.message, /configura/);
  // bloqueio antigo sem `reason`: com arquivos = guard de configuração; sem arquivos = bloqueio genérico com o erro do servidor (nunca afirma "configuração alterada")
  assert.equal(si({ files: ['.env'] }).needsAck, true);
  const gen = si({ error: 'motivo novo do servidor' });
  assert.deepEqual([gen.needsAck, gen.label], [false, 'integração bloqueada']); assert.match(gen.message, /motivo novo do servidor/); assert.doesNotMatch(gen.message, /configura/);
  assert.equal(si({ reason: 'outro', files: ['a.js'] }).needsAck, false, 'causa desconhecida com arquivos não vira confirmação');
  assert.equal(FV.stepIntegration(rs('s1', 'completed', { integration: integ('conflict', { reason: 'project_config_changed', files: ['x'] }) })).needsAck, false, 'só blocked pede ack');
  assert.match(FV.stepIntegration(rs('s1', 'completed', { integration: integ('error', { error: 'git sem resposta' }) })).message, /falhou: git sem resposta/);
  assert.match(FV.stepIntegration(rs('s1', 'completed', { integration: integ('conflict') })).message, /deu conflito/);
  // o aviso do topo leva a causa, o texto e o needsAck
  const p = FV.integrationProblems(flow({ activeRun: run([rs('s1', 'completed', { integration: integ('blocked', { reason: 'branch_checked_out' }) })]) }))[0];
  assert.deepEqual([p.needsAck, p.reason, p.message], [false, 'branch_checked_out', FV.BRANCH_CHECKED_OUT_TEXT]);
});

test('revisão: modo pasta (fallbackReason) e recomeço (rebasedFrom) no cabeçalho, na Entrega e no histórico', () => {
  const folder = run([], { status: 'completed', finishedAt: T0, git: { mode: 'folder', fallbackReason: 'o HEAD está destacado' } });
  const n = FV.runGitNotes(folder);
  assert.deepEqual([n.fallback, n.fallbackText, n.rebased], ['o HEAD está destacado', 'sem cópia isolada: o HEAD está destacado; as etapas editam a pasta do workspace, uma por vez', null]);
  const none = { fallback: null, fallbackText: null, rebased: null, rebasedText: null };
  assert.deepEqual(FV.runGitNotes(run([], { git: gitOf() })), none, 'modo Git normal: nada');
  assert.deepEqual(FV.runGitNotes(run([])), none, 'run antigo: nada');
  assert.equal(FV.runGitNotes(run([], { git: { mode: 'folder', fallbackReason: '' } })).fallbackText, null, 'sem motivo, sem aviso inventado');
  assert.equal(FV.runGitNotes(run([], { git: gitOf({ rebasedFrom: { branch: 'main', commit: SHA } }) })).rebasedText, 'a missão recomeçou a partir de main@abcdef1');
  assert.equal(FV.runGitNotes(run([], { git: gitOf({ rebasedFrom: 'main@1234567' }) })).rebasedText, 'a missão recomeçou a partir de main@1234567');
  assert.equal(FV.runGitNotes(run([], { git: gitOf({ rebasedFrom: {} }) })).rebasedText, null);
  const d = nodeDetail(flow({ lastRun: folder }), folder, 'delivery');
  assert.equal(d.gitNotes.fallback, 'o HEAD está destacado'); assert.deepEqual(d.leftovers, []);
  const rows = historyRows([folder, run([], { id: 'run_2', status: 'completed', git: gitOf({ rebasedFrom: { branch: 'main', commit: SHA } }) }), run([], { id: 'run_0', status: 'completed' })], flow(), { now: Date.parse(T0) });
  assert.deepEqual(rows.map((r) => [r.copy, r.fallback, r.rebasedText]), [
    ['pasta do workspace: o HEAD está destacado', 'o HEAD está destacado', null], ['cópia isolada (Git)', null, 'a missão recomeçou a partir de main@abcdef1'], [null, null, null],
  ]);
});

test('revisão (tela): o ack vai SEMPRE com a lista vista; 409 com lista nova reabre o diálogo desmarcado sem reenviar', () => {
  const page = readSrc('pages/Missions.jsx'), head = readSrc('components/FlowHeader.jsx'), hook = readSrc('use-flows.js');
  assert.equal([...page.matchAll(/acknowledgeProjectConfig: true(?!, acknowledgedFiles: files)/g)].length, 0, 'nenhum ack sem acknowledgedFiles');
  assert.equal([...page.matchAll(/acknowledgeProjectConfig: true, acknowledgedFiles: files/g)].length, 2, 'etapa e integração final');
  const at = page.indexOf('const confirmAck'), end = page.indexOf('const onDiscardStep'), body = page.slice(at, end);
  assert.ok(body.includes('const files = a.files'), 'a lista enviada é a do diálogo');
  const c = body.slice(body.indexOf('catch (e)'), body.indexOf('finally'));
  assert.ok(c.includes("e?.code === 'project_config_changed'") && c.includes('files: e.files?.length ? e.files : files') && c.includes('rev: (a.rev ?? 0) + 1') && c.includes('changed: true'), 'reabre com a lista nova e nova revisão');
  assert.ok(!c.includes('actions.'), 'o 409 nunca reenvia sozinho');
  assert.ok(page.includes('<AckDialog key={`${ack.kind}-${ack.stepId ?? ack.runId}-${ack.rev ?? 0}`}'), 'lista nova remonta o diálogo com a caixa desmarcada');
  assert.ok(head.includes('const [checked, setChecked] = useState(false)') && head.includes('ack.changed &&') && head.includes('max={Infinity}'), 'diálogo: caixa nasce desmarcada, avisa que a lista mudou e mostra a lista inteira');
  assert.ok(hook.includes('Array.isArray(opts.acknowledgedFiles)'), 'o hook não manda ack sem a lista');
});

test('revisão (tela): Limpar cópias segue cleanupAction e mostra as sobras com motivo; IntegrationProblem usa o texto da causa; política e modo pasta aparecem', () => {
  const page = readSrc('pages/Missions.jsx'), head = readSrc('components/FlowHeader.jsx'), panel = readSrc('components/FlowSidePanel.jsx'), form = readSrc('components/FlowForm.jsx'), runs = readSrc('components/FlowRuns.jsx');
  assert.ok(page.includes("ra.cleanupAction === 'cleanup'") && page.includes('actions.cleanup(flow.id, ra.runId)') && page.includes('if (!flow || !ra?.cleanupAction) return undefined;'));
  assert.ok(head.includes('ra.leftovers.map((l) =>') && head.includes('{l.reason}') && head.includes('{LEFTOVERS_HINT}'), 'sobras com motivo e dica');
  assert.ok(panel.includes('d.leftovers.map((l) =>') && panel.includes('d.gitNotes?.fallbackText') && panel.includes('d.gitNotes?.rebasedText'));
  // o texto do problema vem da causa: nada de "configuração alterada" fixo no componente
  assert.ok(head.includes('{p.message && <p'), 'texto pela causa');
  assert.ok(!head.includes('A etapa alterou configuração executável ou arquivo sensível. Integrar exige'), 'sem texto fixo de configuração no IntegrationProblem');
  assert.ok(head.includes("label={p.needsAck ? 'Configuração ou arquivos sensíveis alterados' : 'Arquivos'}"));
  assert.ok(head.includes('notes.fallbackText &&') && head.includes('notes.rebasedText &&') && head.includes('runGitNotes(run)'), 'aviso de modo pasta e recomeço no cabeçalho');
  assert.ok(runs.includes('<th scope="col">Cópia</th>') && runs.includes("r.copy ?? '—'") && runs.includes('r.rebasedText'), 'coluna no histórico');
  assert.ok(panel.includes('<p className="fl-text err pre">{d.error}</p>'), 'erro da etapa inteiro no painel');
  // aviso de política: automação + acesso total + integração automática (o padrão não muda)
  assert.ok(form.includes('Esta automação roda sozinha com acesso total e integra na sua branch sem ninguém olhando (só sem conflito e com a pasta limpa). Desmarque a integração automática se quiser revisar antes.'));
  assert.ok(form.includes('const warn = unattended && checked;') && form.includes('{warn && <p id="fl-autoint-w"'));
  assert.equal([...form.matchAll(/unattended=\{auto && draft\.fullAccess === true\}/g)].length, 2, 'formulário completo e reduzido');
  assert.equal(emptyDraft().autoIntegrate, true, 'o padrão continua ligado');
});

// ---------- criar missão por briefing (docs/missions-v2-briefing.md): proposta do Planejador → formulário preenchido → só o usuário cria ----------
const proposal = (o = {}) => ({
  id: 'prop_0a1b2c3d', terminalId: 'term_p1', workspaceId: 'ws_9', workspaceName: 'Loja', createdAt: '2026-11-19T10:00:00.000Z',
  flow: {
    title: 'Checkout novo', goal: 'Trocar o checkout', kind: 'automation', maxParallel: 2, autoIntegrate: false, fullAccess: false,
    schedule: { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' },
    steps: [def('s1', { role: 'scout', model: 'haiku', effort: 'low' }), def('s2', { dependsOn: ['s1'], continueFrom: 's1', provider: 'codex' }), def('s3', { role: 'reviewer', dependsOn: ['s1', 's2'] })],
  },
  ...o,
});

test('briefing: proposalToDraft usa o workspace da proposta, desliga SEMPRE o acesso total e preserva tipo, agenda, integração, dependências e continueFrom', () => {
  const d = FV.proposalToDraft(proposal());
  assert.deepEqual([d.workspaceId, d.fullAccess, d.title, d.goal, d.kind, d.maxParallel, d.autoIntegrate], ['ws_9', false, 'Checkout novo', 'Trocar o checkout', 'automation', 2, false]);
  assert.deepEqual(d.schedule, { enabled: true, kind: 'weekly', everyHours: 4, time: '08:30', days: [1, 3] });
  assert.deepEqual(d.steps.map((s) => [s.key, s.role, s.provider, s.model, s.effort, s.dependsOn, s.continueFrom]), [
    ['k1', 'scout', 'claude', 'haiku', 'low', [], ''], ['k2', 'builder', 'codex', '', '', ['k1'], 'k1'], ['k3', 'reviewer', 'claude', '', '', ['k1', 'k2'], ''],
  ]);
  assert.equal(validateDraft(d).ok, true, 'a proposta válida no servidor passa na validação da tela');
  // acesso total e workspace nunca vêm do agente: mesmo que a proposta traga, o rascunho ignora
  const sneaky = FV.proposalToDraft(proposal({ flow: { ...proposal().flow, fullAccess: true, workspaceId: 'ws_outro' } }));
  assert.deepEqual([sneaky.fullAccess, sneaky.workspaceId], [false, 'ws_9']);
  assert.equal(FV.proposalToDraft(proposal({ workspaceId: undefined })).workspaceId, '');
  // projeto sem agenda e sem campos opcionais: padrões do formulário (integração automática ligada)
  const plain = FV.proposalToDraft(proposal({ flow: { title: 'P', steps: [def('a')] } }));
  assert.deepEqual([plain.kind, plain.autoIntegrate, plain.maxParallel, plain.fullAccess, plain.steps.length], ['project', true, 1, false, 1]);
  assert.equal(FV.proposalToDraft(null).steps.length, 1, 'proposta ausente não quebra');
  // ida e volta: o corpo do create leva as mesmas dependências e o proposalId
  const body = draftToBody(d, { proposalId: 'prop_0a1b2c3d' });
  assert.deepEqual([body.workspaceId, body.fullAccess, body.kind, body.autoIntegrate, body.proposalId], ['ws_9', false, 'automation', false, 'prop_0a1b2c3d']);
  assert.deepEqual(body.schedule, { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' });
  assert.deepEqual(body.steps.map((s) => [s.id, s.dependsOn, s.continueFrom, s.role]), [['s1', [], null, 'scout'], ['s2', ['s1'], 's1', 'builder'], ['s3', ['s1', 's2'], null, 'reviewer']]);
});

test('briefing: o editor de etapas não oferece Maestro nem Planejador (o servidor recusa esses papéis numa etapa)', () => {
  const server = [{ id: 'builder', label: 'Construtor' }, { id: 'maestro', label: 'Maestro' }, { id: 'planner', label: 'Planejador' }, { id: 'reviewer', label: 'Revisor' }, null];
  assert.deepEqual(FV.stepRoles(server).map((r) => r.id), ['builder', 'reviewer']);
  assert.deepEqual(FV.stepRoles(null).map((r) => r.id), ['builder', 'reviewer', 'scout'], 'sem resposta: a reserva, também sem o Maestro');
  assert.ok(readSrc('components/FlowForm.jsx').includes('const roleList = stepRoles(roles);'));
});

test('briefing: draftToBody só leva proposalId no create e no formato do servidor', () => {
  let d = emptyDraft({ workspaceId: 'ws_1' }); d = { ...d, title: 'M' }; d = patchStep(d, 'k1', { title: 'A', prompt: 'p' });
  assert.ok(!('proposalId' in draftToBody(d)), 'sem proposta, nada');
  assert.equal(draftToBody(d, { proposalId: 'prop_deadbeef' }).proposalId, 'prop_deadbeef');
  assert.ok(!('proposalId' in draftToBody(d, { mode: 'edit', proposalId: 'prop_deadbeef' })), 'PATCH nunca leva proposalId');
  for (const bad of ['prop_XYZ', 'prop_123', 'prop_0a1b2c3d0', '', null, 42, { id: 'prop_deadbeef' }]) assert.ok(!('proposalId' in draftToBody(d, { proposalId: bad })), String(bad));
});

test('briefing: corpo de /api/flows/briefing só com o que foi escolhido; propostas válidas, da mais nova para a mais antiga', () => {
  assert.deepEqual(FV.briefingBody({ workspaceId: 'ws_1' }), { workspaceId: 'ws_1' });
  assert.deepEqual(FV.briefingBody({ workspaceId: 'ws_1', provider: 'codex', model: 'gpt', effort: 'high' }), { workspaceId: 'ws_1', provider: 'codex', model: 'gpt', effort: 'high' });
  assert.deepEqual(FV.briefingBody({ workspaceId: 'ws_1', provider: 'gemini', model: '', effort: '' }), { workspaceId: 'ws_1' }, 'agente desconhecido e vazios ficam de fora');
  const older = proposal({ id: 'prop_00000001', terminalId: 'term_a', createdAt: '2026-11-19T09:00:00.000Z', workspaceName: '' });
  const rows = FV.proposalRows([older, proposal(), { id: 'lixo', flow: {} }, { id: 'prop_00000002' }, null], { workspaces: [{ id: 'ws_9', displayName: 'Do store' }] });
  assert.deepEqual(rows.map((r) => [r.id, r.terminalId, r.workspaceName, r.steps, r.title]), [['prop_0a1b2c3d', 'term_p1', 'Loja', 3, 'Checkout novo'], ['prop_00000001', 'term_a', 'Do store', 3, 'Checkout novo']]);
  assert.equal(rows[0].proposal.id, 'prop_0a1b2c3d', 'o formulário recebe a proposta inteira');
  assert.deepEqual(FV.proposalRows(null), []);
  assert.equal(FV.PROPOSAL_NOTICE, 'Proposta do Planejador: revise as etapas, papéis e dependências antes de criar. Acesso total vem desligado.');
  assert.equal(FV.BRIEFING_TEXT, 'Abre um terminal com o Planejador. Escreva o que você quer; ele lê o projeto, pergunta o que faltar e propõe as etapas. Você revisa no formulário antes de criar.');
});

test('briefing: proposta nova só abre o formulário quando nada está aberto; com formulário aberto vira aviso (nunca sobrescreve); versão nova do mesmo terminal pede para carregar', () => {
  const a = FV.proposalRows([proposal()])[0], b = FV.proposalRows([proposal({ id: 'prop_bbbbbbbb', terminalId: 'term_p2', createdAt: '2026-11-19T11:00:00.000Z' })])[0];
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a] }), { open: b, markSeen: ['prop_bbbbbbbb', 'prop_0a1b2c3d'] }, 'abre a mais nova; as outras ficam na faixa');
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], formOpen: true }), { open: null, markSeen: ['prop_bbbbbbbb', 'prop_0a1b2c3d'] }, 'formulário aberto: só avisa');
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], blocked: true }), { open: null, markSeen: [] }, 'outro diálogo aberto: espera sem marcar');
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], seen: new Set(['prop_bbbbbbbb', 'prop_0a1b2c3d']) }), { open: null, markSeen: [] }, 'já anunciadas (ex.: o usuário cancelou o formulário) não reabrem sozinhas');
  assert.deepEqual(FV.proposalAutoOpen(), { open: null, markSeen: [] });
  // o Planejador term_p1 mandou uma versão nova (a anterior saiu das pendentes): aviso para carregar, sem trocar sozinho
  const v2 = FV.proposalRows([proposal({ id: 'prop_cccccccc', createdAt: '2026-11-19T12:00:00.000Z' })])[0];
  const n = FV.proposalNotices([v2, b], a.proposal);
  assert.deepEqual([n.newer?.id, n.others.map((r) => r.id), n.pending], ['prop_cccccccc', ['prop_bbbbbbbb'], false]);
  const same = FV.proposalNotices([a, b], a.proposal);
  assert.deepEqual([same.newer, same.others.map((r) => r.id), same.pending], [null, ['prop_bbbbbbbb'], true]);
  const plainForm = FV.proposalNotices([a, b], null);
  assert.deepEqual([plainForm.newer, plainForm.others.length, plainForm.pending], [null, 2, false], 'formulário comum: atalho para abrir cada uma');
});

test('briefing (tela): rotas no hook, botões "Nova por briefing", diálogo, aviso e Descartar no formulário, sem abrir por cima nem criar sozinho', () => {
  const hook = readSrc('use-flows.js'), page = readSrc('pages/Missions.jsx'), side = readSrc('components/FlowSidebar.jsx'), form = readSrc('components/FlowForm.jsx'), brief = readSrc('components/FlowBriefing.jsx');
  for (const t of ["post('/api/flows/briefing', briefingBody(body))", "api.get('/api/flows/proposals')", 'post(`/api/flows/proposals/${encodeURIComponent(id)}/dismiss`, {})', 'return { flows, failure, refresh, actions, proposals }']) assert.ok(hook.includes(t), t);
  assert.ok(hook.includes("if (fl.status === 'rejected') throw fl.reason;") && !/pr\.status === 'rejected'\) throw/.test(hook), 'falha das propostas não derruba a lista de missões');
  // um só polling: a página continua recebendo tudo do App
  assert.ok(!page.includes("from '../use-flows.js'") && page.includes('const { flows, failure, refresh, actions, proposals } = data;'));
  // botões ao lado de "Nova missão": barra lateral (cabeçalho e lista vazia) e estado vazio da página
  assert.ok(side.includes('aria-label="Nova por briefing"') && side.includes('<span>Nova por briefing</span>') && side.includes('onBriefing'));
  assert.ok(page.includes('<span>Nova por briefing</span>') && page.includes('onBriefing={() => setBriefing(true)}') && page.includes('<FlowBriefing '));
  assert.ok(brief.includes('{BRIEFING_TEXT}') && brief.includes('useProviderOptions()') && brief.includes('briefingBody({ workspaceId, provider, model, effort, acknowledgeProjectConfig: needsAck && cfgOk === true })') && brief.includes("useState('claude')"), 'diálogo: texto, listas fechadas, Claude por padrão');
  assert.ok(brief.includes('role="alert">{error}'), 'erro do servidor (ex.: limite de terminais) aparece no diálogo');
  // formulário: aviso no topo, Descartar proposta (com confirmação), troca só por clique e com confirmação se mexido
  assert.ok(form.includes('{proposal && <div className="fl-callout fl-prop-notice" role="note" tabIndex={-1} data-autofocus>{lines.map((t) => <p key={t}><b>{t}</b></p>)}</div>}') && form.includes('const lines = proposal ? proposalNoticeLines(proposal) : [];') && form.includes('<span>Descartar proposta</span>'));
  assert.ok(form.includes('O Planejador enviou uma versão nova desta proposta — carregar?') && form.includes('Nova proposta do Planejador:'));
  assert.ok(/const swap = \(row\) => \{[\s\S]*?window\.confirm\(/.test(form) && /const dismiss = async \(\) => \{[\s\S]*?window\.confirm\(/.test(form));
  assert.ok(form.includes("mode === 'create' && proposal ? proposalToDraft(proposal)"), 'formulário nasce da proposta (acesso total desligado)');
  // página: abre só sem formulário aberto (proposalAutoOpen com formOpen), avisos via proposalNotices, troca remonta pela chave
  assert.ok(page.includes('proposalAutoOpen({ rows: propRows, seen: seenRef.current, formOpen: !!form, blocked: !!ack || !!discarding || !!pushDlg || briefing, terminalFocused: focusInTerminal(document.activeElement) })'));
  assert.ok(page.includes('notices={proposalNotices(propRows, form.proposal ?? null, { seenAtOpen: form.seenAtOpen })}') && page.includes("key={`${form.mode}-${form.key ?? form.flow?.id ?? 'novo'}`}"));
  assert.ok(page.includes('<ProposalTray ') && /onTrayDismiss = async \(r\) => \{\s*if \(!window\.confirm\(/.test(page), 'faixa de propostas com Descartar confirmado');
  // nada é criado nem iniciado sozinho: o efeito só abre o formulário; create só no submit do formulário
  const eff = page.slice(page.indexOf('const plan = proposalAutoOpen('), page.indexOf('}, [propRows, form'));
  assert.ok(eff.length > 0 && !eff.includes('actions.') && eff.includes("openForm({ mode: 'create', proposal: plan.open.proposal"), 'o efeito só abre o formulário');
  assert.equal([...page.matchAll(/actions\.create\(/g)].length, 1, 'create só no submit do formulário');
  // o Planejador aparece no dock da página, também sem missão selecionada, e pode ser fechado
  assert.ok(page.includes('plannerTabs(terminals?.sessions') && page.includes('onCloseTab={closePlanner}') && page.includes('const hasDock = !!stream && dockTabs.length > 0;'));
  assert.ok(page.indexOf('{stream && <FlowTerminals') > page.lastIndexOf('</>'), 'o dock fica fora do ramo da missão selecionada');
  const css = readSrc('flows.css');
  assert.ok(css.includes('.fl-props {') && css.includes('.fl-brief-grid {') && css.includes('.fl-new-row {'));
});

// ---------- revisão do briefing (segurança e código): foco, Enter, agenda desligada, confirmação da configuração, avisos e histórico ----------
test('revisão briefing: aviso da proposta diz como a agenda chegou (desligada pelo servidor); proposalToDraft mantém o enabled como veio', () => {
  const auto = (schedule) => proposal({ flow: { ...proposal().flow, schedule } });
  assert.deepEqual(FV.proposalNoticeLines(auto({ enabled: false, kind: 'interval', everyHours: 6 })), [FV.PROPOSAL_NOTICE, FV.PROPOSAL_SCHEDULE_OFF]);
  assert.equal(FV.PROPOSAL_SCHEDULE_OFF, 'A agenda vem desligada: ligue só se quiser que rode sozinha.');
  assert.deepEqual(FV.proposalNoticeLines(auto({ kind: 'daily', time: '09:00' })), [FV.PROPOSAL_NOTICE, FV.PROPOSAL_SCHEDULE_OFF], 'sem enabled = desligada');
  assert.deepEqual(FV.proposalNoticeLines(auto({ enabled: true, kind: 'daily', time: '09:00' })), [FV.PROPOSAL_NOTICE, FV.PROPOSAL_SCHEDULE_ON], 'servidor antigo que manda ligada: o aviso não mente');
  assert.deepEqual(FV.proposalNoticeLines(auto(null)), [FV.PROPOSAL_NOTICE], 'automação sem agenda');
  assert.deepEqual(FV.proposalNoticeLines(proposal({ flow: { title: 'P', kind: 'project', schedule: { enabled: false }, steps: [def('a')] } })), [FV.PROPOSAL_NOTICE], 'projeto não fala de agenda');
  assert.deepEqual(FV.proposalNoticeLines(null), [FV.PROPOSAL_NOTICE]);
  const off = FV.proposalToDraft(auto({ enabled: false, kind: 'weekly', days: [2], time: '07:00' }));
  assert.equal(off.schedule.enabled, false, 'a agenda continua desligada no rascunho');
  assert.equal(draftToBody(off).schedule.enabled, false, 'e no corpo do create, até o usuário ligar');
});

test('revisão briefing: Enter num <input> não envia o formulário da proposta; textarea, select, botões e IME seguem normais', () => {
  const ev = (key, tagName, o = {}) => ({ key, target: { tagName }, nativeEvent: {}, ...o });
  assert.equal(FV.blocksImplicitSubmit(ev('Enter', 'INPUT')), true);
  assert.equal(FV.blocksImplicitSubmit(ev('Enter', 'input')), true);
  for (const tag of ['TEXTAREA', 'SELECT', 'BUTTON', 'DIV']) assert.equal(FV.blocksImplicitSubmit(ev('Enter', tag)), false, tag);
  assert.equal(FV.blocksImplicitSubmit(ev('a', 'INPUT')), false);
  assert.equal(FV.blocksImplicitSubmit(ev('Enter', 'INPUT', { nativeEvent: { isComposing: true } })), false, 'Enter que confirma a composição do IME');
  assert.equal(FV.blocksImplicitSubmit(null), false);
  // foco num terminal xterm (o usuário digitando no Planejador)
  const inXterm = { closest: (sel) => (sel === '.xterm' ? {} : null) }, outside = { closest: () => null };
  assert.deepEqual([FV.focusInTerminal(inXterm), FV.focusInTerminal(outside), FV.focusInTerminal(null), FV.focusInTerminal({})], [true, false, false, false]);
});

test('revisão briefing: com o foco num terminal a proposta não abre o formulário; fica marcada (faixa com Revisar) e a tela avisa', () => {
  const a = FV.proposalRows([proposal()])[0], b = FV.proposalRows([proposal({ id: 'prop_bbbbbbbb', terminalId: 'term_p2', createdAt: '2026-11-19T11:00:00.000Z' })])[0];
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], terminalFocused: true }), { open: null, markSeen: ['prop_bbbbbbbb', 'prop_0a1b2c3d'], held: b });
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], terminalFocused: true, formOpen: true }), { open: null, markSeen: ['prop_bbbbbbbb', 'prop_0a1b2c3d'] }, 'com formulário aberto continua só aviso dentro dele');
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], terminalFocused: true, blocked: true }), { open: null, markSeen: [] });
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], terminalFocused: true, seen: new Set(['prop_bbbbbbbb', 'prop_0a1b2c3d']) }), { open: null, markSeen: [] });
  assert.deepEqual(FV.proposalAutoOpen({ rows: [b, a], terminalFocused: false }).open, b, 'fora do terminal abre como antes');
});

test('revisão briefing: no formulário, "Nova proposta" só para as que chegaram depois de ele abrir; as já vistas ficam na faixa', () => {
  const a = FV.proposalRows([proposal()])[0], b = FV.proposalRows([proposal({ id: 'prop_bbbbbbbb', terminalId: 'term_p2' })])[0], c = FV.proposalRows([proposal({ id: 'prop_cccccccc', terminalId: 'term_p3' })])[0];
  const plain = FV.proposalNotices([a, b, c], null, { seenAtOpen: new Set(['prop_0a1b2c3d', 'prop_bbbbbbbb']) });
  assert.deepEqual(plain.others.map((r) => r.id), ['prop_cccccccc']);
  assert.deepEqual(FV.proposalNotices([a, b], null, { seenAtOpen: new Set(['prop_0a1b2c3d', 'prop_bbbbbbbb']) }).others, [], 'nada novo: nenhum aviso no formulário');
  // formulário da proposta a: a versão nova do MESMO terminal continua pedindo para carregar mesmo já marcada como vista
  const v2 = FV.proposalRows([proposal({ id: 'prop_dddddddd' })])[0];
  const cur = FV.proposalNotices([v2, b], a.proposal, { seenAtOpen: new Set(['prop_0a1b2c3d', 'prop_bbbbbbbb', 'prop_dddddddd']) });
  assert.deepEqual([cur.newer?.id, cur.others.map((r) => r.id)], ['prop_dddddddd', []]);
  assert.equal(FV.proposalNotices([a, b], null).others.length, 2, 'sem o registro do que foi visto: todas (compatível)');
});

test('revisão briefing: confirmação da configuração do projeto só com o booleano estrito; 409 project_config_unreviewed vira lista de arquivos', () => {
  assert.deepEqual(FV.briefingBody({ workspaceId: 'ws_1', acknowledgeProjectConfig: true }), { workspaceId: 'ws_1', acknowledgeProjectConfig: true });
  for (const v of [false, 'true', 1, undefined, null, {}]) assert.ok(!('acknowledgeProjectConfig' in FV.briefingBody({ workspaceId: 'ws_1', acknowledgeProjectConfig: v })), String(v));
  assert.deepEqual(FV.briefingBody(FV.briefingBody({ workspaceId: 'ws_1', provider: 'claude', acknowledgeProjectConfig: true })), { workspaceId: 'ws_1', provider: 'claude', acknowledgeProjectConfig: true }, 'o hook passa o corpo por briefingBody de novo: a confirmação sobrevive');
  assert.deepEqual(FV.briefingConfigFiles({ code: 'project_config_unreviewed', files: ['.mcp.json', '', 3, '.claude/settings.json'] }), ['.mcp.json', '.claude/settings.json']);
  assert.deepEqual(FV.briefingConfigFiles({ code: 'project_config_unreviewed' }), []);
  assert.equal(FV.briefingConfigFiles({ code: 'project_config_changed', files: ['x'] }), null);
  assert.equal(FV.briefingConfigFiles(new Error('limite')), null);
  assert.equal(FV.BRIEFING_CONFIG_CODE, 'project_config_unreviewed');
  assert.ok(FV.BRIEFING_CONFIG_TEXT.includes('configuração executável do projeto que ainda não foi revisada; o planejador vai rodar nesta pasta'));
});

test('revisão briefing (tela): sem autofocus no Nome da proposta, foco no aviso, Enter bloqueado só na proposta, caixa obrigatória no briefing, pós-POST protegido', () => {
  const form = readSrc('components/FlowForm.jsx'), page = readSrc('pages/Missions.jsx'), brief = readSrc('components/FlowBriefing.jsx'), hook = readSrc('use-flows.js');
  // foco: o Nome só recebe data-autofocus fora da proposta; na proposta, o aviso (div não editável, tabIndex -1) é o alvo
  assert.ok(form.includes('<label>Nome<input data-autofocus={fromProposal ? undefined : true} value={draft.title}'));
  assert.ok(!/<input data-autofocus value=\{draft\.title\}/.test(form), 'nada de autofocus fixo no Nome');
  assert.equal([...form.matchAll(/data-autofocus/g)].length, 2, 'só o Nome (condicional) e o aviso da proposta');
  assert.ok(/role="note" tabIndex=\{-1\} data-autofocus>/.test(form));
  // Enter: só o formulário da proposta bloqueia (o comum continua enviando com Enter)
  assert.ok(form.includes('onKeyDown={fromProposal ? (e) => { if (blocksImplicitSubmit(e)) e.preventDefault(); } : undefined}'));
  assert.ok(readSrc('flows.css').includes('.fl-prop-notice:focus {'), 'foco visível no aviso');
  // página: não abre por cima de quem digita no terminal; avisa e deixa na faixa
  assert.ok(page.includes('else if (plan.held) notify(') && page.includes('Clique em Revisar na faixa do topo de Missões.'));
  assert.ok(page.includes('const openForm = useCallback((f) => setForm({ ...f, seenAtOpen: new Set(seenRef.current) }), []);'));
  assert.ok(!/setForm\(\{ mode: '(create|edit|schedule)'/.test(page), 'todo formulário abre por openForm (registra o que já foi visto)');
  // startBriefing: depois do POST, nada lança de volta para o diálogo já desmontado
  const sb = page.slice(page.indexOf('const startBriefing = async (body) => {'), page.indexOf('const propRows = useMemo('));
  assert.ok(sb.indexOf('setBriefing(false);') < sb.indexOf('try {') && /try \{[\s\S]*await loadTerminals\?\.\(\);[\s\S]*setDockOpen\(true\);[\s\S]*notify\([\s\S]*\} catch \{/.test(sb));
  assert.equal([...sb.matchAll(/await /g)].length, 2, 'só o POST (fora do try, erro para o diálogo) e o loadTerminals (dentro do try)');
  // briefing: 409 vira lista + caixa; sem a caixa marcada nada é reenviado; trocar de workspace descarta a confirmação
  assert.ok(brief.includes('const files = briefingConfigFiles(err);') && brief.includes('setCfg({ workspaceId, files }); setCfgOk(false);'));
  assert.ok(brief.includes('if (busy || !workspaceId || (needsAck && !cfgOk)) return; // sem a caixa marcada nada é reenviado'));
  assert.ok(brief.includes('disabled={busy || !workspaceId || (needsAck && !cfgOk)}') && brief.includes('<input ref={cfgBox} type="checkbox" checked={cfgOk}'));
  assert.ok(brief.includes('{BRIEFING_CONFIG_TEXT}') && brief.includes('cfg.files.map((f, i) =>'), 'explicação e a lista de arquivos');
  assert.ok(brief.includes('const pickWorkspace = (id) => { setWorkspaceId(id); setCfg(null); setCfgOk(false);'));
  assert.ok(brief.includes('acknowledgeProjectConfig: needsAck && cfgOk === true') && !/acknowledgeProjectConfig: true/.test(brief), 'a confirmação só sai da caixa marcada, nunca fixa');
  assert.ok(hook.includes("startBriefing: (body) => post('/api/flows/briefing', briefingBody(body)),"), 'o hook não inventa a confirmação');
});

test('revisão briefing: histórico mostra o Planejador como não restaurável pelo histórico', async () => {
  const SH = await import('../../client/src/session-history.js');
  const { others } = SH.historyRows({ history: [{ id: 'r1', workspaceId: 'ws_1', title: 'Planejador de missão', role: 'planner', state: 'exited', resumable: false, blockedReason: 'planner_session' }], workspaceId: 'ws_1' });
  assert.deepEqual([others[0].blockedCode, others[0].blockedShort, others[0].resumable], ['planner_session', 'planejador: abra pela missão', false]);
});

// ---------- Missões como página à parte: só a barra das Missões, "Voltar ao Cockpit" e o workflow no desenho do Cockpit ----------
test('Missões: a barra lateral do Cockpit some (também a gaveta e o botão de reabrir); a das Missões tem "Voltar ao Cockpit" para Início/Terminais e vira gaveta no celular', () => {
  const app = readSrc('App.jsx'), page = readSrc('pages/Missions.jsx'), side = readSrc('components/FlowSidebar.jsx');
  assert.ok(app.includes("const missions = view === 'missions';") && app.includes('const showSide = !settings && !missions && !narrow && !sideHidden;'), 'sem a barra do Cockpit em Missões');
  assert.ok(app.includes('{narrow && navOpen && !settings && !missions && <>'), 'a gaveta do Cockpit não abre em Missões');
  assert.ok(app.includes("{menu && view !== 'cockpit' && !settings && !missions && <button"), 'o botão de reabrir/menu do Cockpit não aparece em Missões');
  assert.ok(app.includes("const cockpitFrom = useRef(view === 'cockpit' ? 'cockpit' : 'home');") && app.includes("if (view === 'home' || view === 'cockpit') cockpitFrom.current = view;"), 'lembra de onde veio (Início por padrão)');
  assert.ok(app.includes('const backToCockpit = useCallback(() => goView(cockpitFrom.current), [goView]);') && app.includes('onBack={backToCockpit}') && app.includes('narrow={narrow}'));
  assert.ok(side.includes('aria-label="Voltar ao Cockpit"') && side.includes('title={`Voltar ao Cockpit (${backLabel})`}') && side.includes('onBack && <BackToCockpit onBack={onBack} backLabel={backLabel} compact />'), 'botão com rótulo acessível e dica (compacto no topo, no lugar do "recolher" do Cockpit)');
  // mesmo desenho da barra do Cockpit: as classes dela, a navegação e o cartão do workspace com as missões aninhadas como terminais
  assert.ok(side.includes('className={`fx-side fl-side') && side.includes('<nav className="fx-nav"') && side.includes('className="fx-sec-h"') && side.includes('className="fx-wslist"') && side.includes('fx-term fl-mrow') && side.includes('className="fx-side-foot"'), 'barra das Missões = desenho da do Cockpit');
  assert.ok(app.includes('side={{ onView: goView, onOpenSessions: openSessions, onOpenSettings: openSettings, onOpenWorkspaces: openWorkspaces, desktop }}'), 'a navegação da barra vem do App');
  assert.ok(side.includes("{ role: 'dialog', 'aria-modal': true, 'aria-label': 'Missões' }") && side.includes("if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }"), 'gaveta modal: Esc fecha, foco preso');
  assert.ok(side.includes('const pick = (id) => { onPick(id); if (modal) onClose?.(); };') && side.includes('if (modal) onClose?.(false);'), 'escolher fecha a gaveta; criar fecha sem roubar o foco do diálogo');
  assert.ok(page.includes('{(!narrow || listOpen) && (') && page.includes('modal={narrow} onClose={closeList}') && page.includes('aria-label="Abrir a lista de missões"') && page.includes('<BackToCockpit onBack={onBack} backLabel={backLabel} />'), 'celular: lista em gaveta aberta pelo topo, com o mesmo Voltar');
});

test('Missões: estados com o glifo do shell (sem caixa alta), "acesso total" em selo neutro com ícone, workflow com trilha de fases, Entrega com bandeira e nada de brilho', () => {
  const head = readSrc('components/FlowHeader.jsx'), wf = readSrc('components/FlowWorkflow.jsx'), css = readSrc('flows.css'), panel = readSrc('components/FlowSidePanel.jsx'), runs = readSrc('components/FlowRuns.jsx');
  assert.ok(head.includes('export function StateTag') && head.includes('<StatusGlyph state={toneGlyph(tone)} size={12} />'), 'estado = glifo + texto');
  for (const [n, s] of [['cabeçalho', head], ['painel', panel], ['histórico', runs]]) assert.ok(s.includes('<StateTag tone='), `${n} usa o StateTag`);
  assert.ok(head.includes('<span className="fl-chip warn" title="Os terminais desta missão sobem sem pedir confirmação de permissão."><Icon name="alert" size={11} />acesso total</span>'), 'acesso total: selo neutro + ícone');
  const rule = (sel) => { const at = css.indexOf(`\n${sel} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); }; // corpo da regra que começa a linha com o seletor
  assert.ok(rule('.fl-chip').includes('background: rgba(255, 255, 255, .04)') && !/background:[^;]*(245, 158, 11|240, 140, 58)/.test(rule('.fl-chip.warn')), 'o selo de aviso não é preenchido de âmbar');
  assert.ok(!/text-transform: uppercase/.test(css), 'sem caixa alta gritante');
  assert.ok(wf.includes('className="fl-rail"') && wf.includes('<FlagIcon') && wf.includes('<ProviderLogo id={a.provider} size={12} />') && wf.includes('edgePathDown(x1, y1 + 3, x2, y2 - 3, my, 12)'), 'trilha, bandeira, logo do agente e curvas suaves');
  assert.ok(css.includes('.fl-wf .mwf-node { position: relative;') && css.includes('.fl-wf .fl-e-done path') && css.includes('.fl-wf .fl-node-meter'), 'desenho escopado em .fl-wf');
  assert.ok(!/(box-shadow|text-shadow|drop-shadow|filter)\s*[:(]/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'sem brilho');
});

// ---------- comando de verificação opcional antes da integração final ----------
test('verificação: tokenizador separa por espaço, respeita aspas, não interpreta shell nem barra invertida; aspa aberta = null', () => {
  const tk = FV.tokenizeCommand;
  assert.deepEqual(tk('npm test'), ['npm', 'test']);
  assert.deepEqual(tk('  npm   run  test -- --grep "a b" '), ['npm', 'run', 'test', '--', '--grep', 'a b']);
  assert.deepEqual(tk("node -e 'x y'"), ['node', '-e', 'x y']);
  assert.deepEqual(tk('node C:\\x\\y.js'), ['node', 'C:\\x\\y.js'], 'caminho do Windows passa inteiro');
  assert.deepEqual(tk('--name="a b"c'), ['--name=a bc'], 'aspas no meio do argumento juntam as partes');
  assert.deepEqual(tk('say "it\'s"'), ['say', "it's"]);
  assert.deepEqual(tk("x '' y"), ['x', '', 'y'], 'aspas vazias = argumento vazio');
  assert.deepEqual(tk('npm test | grep x && echo > f'), ['npm', 'test', '|', 'grep', 'x', '&&', 'echo', '>', 'f'], 'sem shell: operadores viram argumentos');
  assert.deepEqual(tk('a\tb\nc'), ['a', 'b', 'c']);
  assert.deepEqual([tk(''), tk('   '), tk(null)], [[], [], []]);
  assert.equal(tk('echo "aberta'), null);
  assert.equal(tk("echo 'aberta"), null);
  // ida e volta: argsToText gera um texto que o tokenizador lê de volta igual
  for (const args of [['npm', 'test'], ['a b', '', "it's", 'say "hi"', 'ambas\'"aspas', 'C:\\p q\\r']]) assert.deepEqual(tk(FV.argsToText(args)), args);
  assert.deepEqual(FV.verifyShellOps('npm test | grep x && echo > out 2>&1 ; y'), ['|', '&&', '>', '2>&1', ';']);
  assert.deepEqual(FV.verifyShellOps('npm test "|"'), ['|'], 'mesmo entre aspas vai como argumento: avisa');
  assert.deepEqual(FV.verifyShellOps('npm test'), []);
  assert.deepEqual(FV.verifyShellOps('echo "x'), []);
});

test('verificação: rascunho nasce vazio (300 s), vem da missão, valida e vai no corpo de POST e PATCH (vazio = null)', () => {
  const d0 = emptyDraft({ workspaceId: 'ws_1' });
  assert.deepEqual([d0.verifyText, d0.verifyTimeout], ['', 300]);
  const base = patchStep({ ...d0, title: 'M' }, 'k1', { title: 'A', prompt: 'faça A' });
  assert.equal(validateDraft(base).ok, true);
  assert.equal(draftToBody(base).verifyCommand, null);
  assert.equal(draftToBody({ ...base, verifyText: '   ' }).verifyCommand, null, 'só espaços = sem verificação');
  assert.equal(validateDraft({ ...base, verifyText: '   ', verifyTimeout: '' }).ok, true, 'sem comando o tempo não é conferido');

  const d = { ...base, verifyText: 'npm run test -- --grep "login ok"', verifyTimeout: 600 };
  const want = { args: ['npm', 'run', 'test', '--', '--grep', 'login ok'], timeoutSec: 600 };
  assert.equal(validateDraft(d).ok, true);
  assert.deepEqual(draftToBody(d).verifyCommand, want);
  assert.deepEqual(draftToBody(d, { mode: 'edit' }).verifyCommand, want, 'PATCH também leva');
  assert.equal(draftToBody({ ...base, verifyText: '' }, { mode: 'edit' }).verifyCommand, null, 'PATCH com campo vazio remove a verificação');
  assert.equal(FV.draftToScheduleBody(d).verifyCommand, undefined, 'o PATCH reduzido (run ativo) não leva verificação');

  const errs = (o) => validateDraft({ ...base, ...o }).errors.filter((e) => e.field.startsWith('verify')).map((e) => e.field);
  assert.deepEqual(errs({ verifyText: 'npm "test', verifyTimeout: 300 }), ['verifyText'], 'aspa aberta');
  assert.deepEqual(errs({ verifyText: '"" test', verifyTimeout: 300 }), ['verifyText'], 'programa vazio');
  assert.deepEqual(errs({ verifyText: 'x'.repeat(FV.MAX_VERIFY_TEXT + 1), verifyTimeout: 300 }), ['verifyText']);
  for (const t of [9, 1801, 30.5, '', null, 'abc']) assert.deepEqual(errs({ verifyText: 'npm test', verifyTimeout: t }), ['verifyTimeout'], `tempo ${t}`);
  for (const t of [10, 1800, '45']) assert.deepEqual(errs({ verifyText: 'npm test', verifyTimeout: t }), [], `tempo ${t}`);
  assert.deepEqual(draftToBody({ ...base, verifyText: 'npm test', verifyTimeout: '45' }).verifyCommand, { args: ['npm', 'test'], timeoutSec: 45 });

  // editar: flowToDraft traz o comando como texto e volta igual; missão sem o campo = vazio; tempo inválido vira o padrão
  const ed = flowToDraft(flow({ verifyCommand: { args: ['node', 'scripts/check.js', 'a b', ''], timeoutSec: 120 } }));
  assert.deepEqual([ed.verifyText, ed.verifyTimeout], ['node scripts/check.js "a b" ""', 120]);
  assert.deepEqual(draftToBody(ed, { mode: 'edit' }).verifyCommand, { args: ['node', 'scripts/check.js', 'a b', ''], timeoutSec: 120 });
  assert.deepEqual([flowToDraft(flow()).verifyText, flowToDraft(flow({ verifyCommand: null })).verifyTimeout], ['', 300]);
  assert.equal(flowToDraft(flow({ verifyCommand: { args: ['npm', 'test'], timeoutSec: 99999 } })).verifyTimeout, 300);
  assert.equal(flowToDraft(flow({ verifyCommand: { args: 'npm test' } })).verifyText, '', 'args fora do formato não viram comando');
});

test('verificação: proposta do Planejador NUNCA traz comando (só o usuário define o que roda)', () => {
  const p = { id: 'prop_0a1b2c3d', workspaceId: 'ws_9', flow: { title: 'P', steps: [def('a')], verifyCommand: { args: ['curl', 'http://x', '-d', '@segredo'], timeoutSec: 60 } } };
  const d = FV.proposalToDraft(p);
  assert.deepEqual([d.verifyText, d.verifyTimeout], ['', 300]);
  assert.equal(draftToBody(d, { proposalId: p.id }).verifyCommand, null);
});

test('verificação: visão do resultado no run (status, comando, fim da saída em texto puro) e no integrationInfo', () => {
  const vr = (v) => run([], { status: 'ready_to_integrate', git: gitOf({ verification: v }) });
  assert.equal(FV.verificationView(null), null);
  assert.equal(FV.verificationView(run([])), null, 'run antigo sem git');
  assert.equal(FV.verificationView(vr(undefined)), null, 'sem verificação');
  assert.equal(FV.integrationInfo(vr(undefined)).verification, null);

  const fail = FV.verificationView(vr({ status: 'fail', command: ['npm', 'run', 'test', 'a b'], exitCode: 1, durationMs: 4200, outputTail: '\u001b[31mFAIL\u001b[0m login.test.js\r\n<b>x</b>\u0007', truncated: true, at: T0 }));
  assert.deepEqual([fail.status, fail.label, fail.tone, fail.failed, fail.command, fail.exitCode, fail.durationMs, fail.truncated, fail.at], ['fail', 'falhou', 'err', true, 'npm run test "a b"', 1, 4200, true, T0]);
  assert.equal(fail.output, 'FAIL login.test.js\n<b>x</b>', 'ANSI e controles saem; HTML fica como texto (o React escapa)');
  assert.match(fail.message, /código de saída 1/);
  assert.match(fail.message, /Integrar continua disponível/);
  assert.equal(FV.integrationInfo(vr({ status: 'fail', command: ['npm', 'test'], exitCode: 1 })).verification.command, 'npm test', 'integrationInfo leva a verificação');

  const pass = FV.verificationView(run([], { status: 'completed', git: gitOf({ verification: { status: 'pass', command: ['npm', 'test'], exitCode: 0, durationMs: 1000, outputTail: 'ok', truncated: false, at: T0 } }) }));
  assert.deepEqual([pass.label, pass.tone, pass.failed, pass.truncated], ['passou', 'ok', false, false]);
  const to = FV.verificationView(vr({ status: 'timeout', command: ['npm', 'test'], exitCode: null, durationMs: 300000, outputTail: '', truncated: false }));
  assert.deepEqual([to.label, to.tone, to.failed, to.exitCode, to.output], ['tempo esgotado', 'err', true, null, '']);
  assert.match(to.message, /tempo limite/);
  const er = FV.verificationView(vr({ status: 'error', command: ['naoexiste'], exitCode: null }));
  assert.deepEqual([er.label, er.failed], ['erro ao rodar', true]);
  assert.match(er.message, /Não foi possível rodar/);
  // dados fora do formato não quebram e não fingem sucesso
  const odd = FV.verificationView(vr({ status: 'talvez', command: 42, exitCode: '1', durationMs: -5, outputTail: { x: 1 }, truncated: 'true' }));
  assert.deepEqual([odd.status, odd.label, odd.tone, odd.failed, odd.command, odd.exitCode, odd.durationMs, odd.output, odd.truncated], [null, NOT_INFORMED, 'idle', true, NOT_INFORMED, null, null, '', false]);
  assert.equal(FV.verificationView(vr({ status: 'fail', command: 'npm test' })).command, 'npm test', 'comando em texto também aparece');
  // a ação Integrar continua disponível com a verificação falha (decisão do usuário)
  assert.equal(FV.runActions(flow({ activeRun: vr({ status: 'fail', command: ['npm', 'test'] }) })).canIntegrate, true);
});

test('verificação: formulário e telas usam o contrato (campo, dica sem shell, <pre> rolável em texto puro, Integrar continua)', () => {
  const read = (f) => fs.readFileSync(path.join(here, '../../client/src/components', f), 'utf8');
  const form = read('FlowForm.jsx'), head = read('FlowHeader.jsx'), panel = read('FlowSidePanel.jsx');
  assert.ok(form.includes('Comando de verificação') && form.includes('Tempo limite (s)') && form.includes('{VERIFY_SHELL_HINT}'), 'campos e dica visível');
  assert.match(FV.VERIFY_SHELL_HINT, /sem shell: \|, && e > não funcionam/i);
  const reducedPart = form.slice(form.indexOf('if (reduced) {'), form.indexOf("<Dialog title={mode === 'edit'"));
  assert.ok(reducedPart.length > 0 && !reducedPart.includes('<VerifyEditor') && form.includes('<VerifyEditor'), 'só o formulário completo mostra o campo (o reduzido não manda verificação)');
  assert.ok(head.includes('<VerificationResult v={ready.verification} />'), 'aviso "pronta para integrar" mostra a verificação');
  assert.ok(panel.includes('<VerificationResult v={info.verification} />'), 'painel da Entrega também');
  assert.match(head, /<pre className="fl-vres-out" tabIndex=\{0\}/, 'saída num <pre> rolável e alcançável pelo teclado');
  for (const src of [form, head, panel]) assert.ok(!src.includes('dangerouslySetInnerHTML'), 'nunca HTML');
  const css = fs.readFileSync(path.join(here, '../../client/src/flows.css'), 'utf8');
  assert.match(css, /\.fl-vres-out \{[^}]*overflow: auto;[^}]*white-space: pre-wrap;/);
});

test('envio ao remoto (pushInfo): só para run integrado; estados, rótulos, motivo e quando o botão Enviar faz sentido; linha da Entrega', () => {
  const S = 'a'.repeat(40);
  const done = (push, o = {}) => run([rs('s1', 'completed'), rs('s2', 'completed')], { status: 'completed', git: { mode: 'git', baseBranch: 'main', integration: { by: 'auto', mode: 'ff', to: S, at: T0 }, ...(push === undefined ? {} : { push }) }, ...o });
  assert.equal(FV.pushInfo(run([rs('s1', 'running')])), null, 'run ativo');
  assert.equal(FV.pushInfo(run([], { status: 'ready_to_integrate', git: { mode: 'git' } })), null, 'antes de integrar');
  assert.equal(FV.pushInfo(run([], { status: 'completed', git: { mode: 'git', integration: { mode: 'empty' } } })), null, 'sem alterações');
  assert.equal(FV.pushInfo(run([], { status: 'completed' })), null, 'modo pasta');
  const none = FV.pushInfo(done()); assert.deepEqual([none.state, none.canPush, none.needsYou, none.label], ['none', true, false, 'não enviada ao remoto']);
  const ok = FV.pushInfo(done({ state: 'pushed', by: 'auto', branch: 'origin/main', to: S, at: T0, commits: [{ sha: S, subject: 'x' }] }));
  assert.deepEqual([ok.state, ok.tone, ok.label, ok.commitShort, ok.canPush, ok.by], ['pushed', 'ok', 'enviada para origin/main', 'aaaaaaa', false, 'auto']); assert.equal(ok.commits[0].sha, 'a'.repeat(12));
  const blk = FV.pushInfo(done({ state: 'blocked', code: 'verify_not_passed', error: 'Envio automático não feito: a verificação não passou.' }));
  assert.deepEqual([blk.tone, blk.canPush, blk.needsYou, blk.label], ['wait', true, true, 'envio pendente']); assert.match(blk.error, /verificação/);
  const bad = FV.pushInfo(done({ state: 'failed', error: 'e'.repeat(900) })); assert.deepEqual([bad.tone, bad.needsYou], ['err', true]); assert.ok(bad.error.length <= 300);
  assert.deepEqual([FV.pushInfo(done({ state: 'pushing' })).canPush, FV.pushInfo(done({ state: 'estranho' })).state], [false, 'none']);
  // Entrega: a linha leva o envio quando houve tentativa
  const f = flow({ lastRun: done({ state: 'pushed', branch: 'origin/main', to: S }) });
  const node = buildWorkflow(f, f.lastRun).nodes.find((n) => n.id === 'delivery'); assert.match(node.line, /integrada em main · enviada para origin\/main/);
  const plain = buildWorkflow(flow({ lastRun: done() }), done()).nodes.find((n) => n.id === 'delivery'); assert.doesNotMatch(plain.line, /enviad/);
  const d = nodeDetail(f, f.lastRun, 'delivery'); assert.equal(d.push.state, 'pushed'); assert.equal(d.runId, 'run_1');
});

test('formulário: autoPush nasce desligado, vem da missão, exige comando de verificação e vai no corpo (inclusive no PATCH com run ativo)', () => {
  const d0 = emptyDraft({ workspaceId: 'ws_1' }); assert.equal(d0.autoPush, false);
  const d = { ...d0, title: 'M', steps: [{ ...d0.steps[0], title: 'A', prompt: 'p' }] };
  assert.ok(validateDraft({ ...d, autoPush: true }).errors.some((e) => e.field === 'autoPush'), 'sem verificação = erro');
  assert.ok(!validateDraft({ ...d, autoPush: true, verifyText: 'npm test' }).errors.some((e) => e.field === 'autoPush'));
  assert.equal(draftToBody({ ...d, autoPush: true, verifyText: 'npm test' }).autoPush, true); assert.equal(draftToBody({ ...d, autoPush: 'sim' }).autoPush, false, 'booleano estrito');
  assert.equal(flowToDraft(flow({ autoPush: true })).autoPush, true); assert.equal(flowToDraft(flow({})).autoPush, false, 'missão antiga');
  assert.deepEqual(FV.draftToScheduleBody({ kind: 'project', autoIntegrate: true, autoPush: true }), { schedule: null, autoIntegrate: true, autoPush: true });
});

test('envio ao remoto (tela): diálogo com a lista e o destino, botão só com a prévia que permite, Enviar ao remoto no cabeçalho e no painel, nada de HTML cru', () => {
  const src = (f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', f), 'utf8');
  const head = src('components/FlowHeader.jsx'), page = src('pages/Missions.jsx'), panel = src('components/FlowSidePanel.jsx'), form = src('components/FlowForm.jsx'), hook = src('use-flows.js');
  assert.match(head, /export function PushDialog/); assert.ok(head.includes("const PUSH_WARN = new Set(['local_unpushed', 'foreign_commits', 'target_unknown']);"), 'avisos = os USER_OK do servidor'); assert.ok(head.includes('{p.url ? <> em <code>{p.url}</code></> : null}'), 'mostra a URL de destino'); assert.match(head, /disabled=\{!p\?\.canPush \|\| !!busy\}/); assert.match(head, /onConfirm\(p\.digest\)/); assert.match(head, /Enviar ao remoto/);
  assert.match(page, /actions\.push\(flow\.id, d\.runId, digest\)/); assert.match(page, /e\?\.code === 'changed'/); assert.match(panel, /onPush/);
  assert.match(form, /function AutoPush/); assert.match(form, /disabled=\{!hasVerify && !checked\}/);
  assert.match(hook, /pushPreview: \(id, runId\) => api\.get/); assert.match(hook, /\/push`, \{ expect \}/); assert.match(hook, /autoPush: body\?\.autoPush === true/);
  for (const s of [head, page, panel, form]) assert.ok(!s.includes('dangerouslySetInnerHTML'));
});
