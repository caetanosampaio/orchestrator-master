// Painel Live (client/src/live-view.js): URL do preview, abertura automática, progresso da missão, resumo de mudanças e intervalos. Puro: sem navegador nem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../client/src/live-view.js';

const OK = { available: true, port: 53211, path: '/', docroot: 'site', entry: 'index.html', version: 'a1b2c3d4e5f6', files: 7, truncated: false, startedAt: 1 };

test('buildPreviewUrl: usa o hostname da UI (localhost ou 127.0.0.1) e recusa o que não é preview utilizável', () => {
  assert.equal(L.buildPreviewUrl('localhost', OK), 'http://localhost:53211/');
  assert.equal(L.buildPreviewUrl('127.0.0.1', OK), 'http://127.0.0.1:53211/');
  assert.equal(L.buildPreviewUrl('LOCALHOST', OK), 'http://localhost:53211/');
  for (const h of ['evil.com', 'localhost.evil.com', '127.0.0.1.evil.com', '[::1]', '', undefined, null, '192.168.0.2']) assert.equal(L.buildPreviewUrl(h, OK), 'http://127.0.0.1:53211/', `hostname estranho (${h}) vira 127.0.0.1`);
  assert.equal(L.buildPreviewUrl('localhost', { ...OK, path: '/sub/pagina.html' }), 'http://localhost:53211/sub/pagina.html');
  assert.equal(L.buildPreviewUrl('localhost', { available: true, port: 4000 }), 'http://localhost:4000/', 'sem path = raiz');
  assert.equal(L.buildPreviewUrl('localhost', null), null);
  assert.equal(L.buildPreviewUrl('localhost', { available: false, reason: 'no-index' }), null);
  for (const port of [0, -1, 65536, 1.5, '53211', null, undefined, NaN]) assert.equal(L.buildPreviewUrl('localhost', { ...OK, port }), null, `porta inválida: ${port}`);
  for (const path of ['//evil.com/', 'x', '/a b', '/a\\b', '/a?x=1', '/a#b', '/@evil', '/a\u0000b', 7, '/' + 'a'.repeat(1100)]) assert.equal(L.buildPreviewUrl('localhost', { ...OK, path }), null, `path inválido: ${String(path).slice(0, 12)}`);
});

test('reloadDecision: remonta o iframe quando a versão muda, respeitando o intervalo mínimo', () => {
  assert.deepEqual(L.reloadDecision({ shown: 'a', next: 'a' }), { reload: false, wait: 0 });
  assert.deepEqual(L.reloadDecision({ shown: 'a', next: null }), { reload: false, wait: 0 });
  assert.deepEqual(L.reloadDecision({ shown: null, next: 'a', lastAt: 1000, now: 1100 }), { reload: true, wait: 0 }, 'primeira carga não espera');
  assert.deepEqual(L.reloadDecision({ shown: 'a', next: 'b', lastAt: 10_000, now: 10_400 }), { reload: true, wait: 1100 });
  assert.deepEqual(L.reloadDecision({ shown: 'a', next: 'b', lastAt: 10_000, now: 12_000 }), { reload: true, wait: 0 });
});

test('previewFilesLabel', () => {
  assert.equal(L.previewFilesLabel({ files: 1 }), '1 arquivo');
  assert.equal(L.previewFilesLabel({ files: 7 }), '7 arquivos');
  assert.equal(L.previewFilesLabel({ files: 2000, truncated: true }), 'mais de 2000 arquivos');
  assert.equal(L.previewFilesLabel({}), '');
});

const flow = (o = {}) => ({ id: 'f1', title: 'Site', workspaceId: 'ws_a', steps: [{ id: 's1', title: 'Páginas' }, { id: 's2', title: 'Revisão' }], activeRun: { status: 'running', startedAt: '2026-01-01T10:00:00Z', steps: [{ stepId: 's1', status: 'completed' }, { stepId: 's2', status: 'running', terminalId: 't9' }] }, ...o });

test('workspaceBusy: missão em execução do workspace OU terminal rodando e trabalhando nele', () => {
  const none = { flows: [], sessions: [], workingIds: new Set() };
  assert.equal(L.workspaceBusy('ws_a', none), false);
  assert.equal(L.workspaceBusy('ws_a', { ...none, flows: [flow()] }), true);
  assert.equal(L.workspaceBusy('ws_b', { ...none, flows: [flow()] }), false, 'missão de outro workspace');
  assert.equal(L.workspaceBusy('ws_a', { ...none, flows: [flow({ activeRun: null, lastRun: { status: 'running' } })] }), false, 'só o run ativo conta');
  assert.equal(L.workspaceBusy('ws_a', { ...none, flows: [flow({ activeRun: { status: 'completed' } })] }), false);
  assert.equal(L.workspaceBusy('ws_a', { ...none, flows: [flow({ archived: true })] }), false);
  const sess = [{ id: 't1', workspaceId: 'ws_a', status: 'running' }, { id: 't2', workspaceId: 'ws_b', status: 'running' }, { id: 't3', workspaceId: 'ws_a', status: 'exited' }];
  assert.equal(L.workspaceBusy('ws_a', { ...none, sessions: sess, workingIds: new Set(['t1']) }), true);
  assert.equal(L.workspaceBusy('ws_a', { ...none, sessions: sess, workingIds: new Set(['t2']) }), false, 'trabalhando em outro workspace');
  assert.equal(L.workspaceBusy('ws_a', { ...none, sessions: sess, workingIds: new Set(['t3']) }), false, 'terminal encerrado não conta');
  assert.equal(L.workspaceBusy('ws_a', { ...none, sessions: sess }), false, 'sem workingIds');
  assert.equal(L.workspaceBusy('ws_a', { flows: null, sessions: undefined, workingIds: null }), false, 'dados ausentes não quebram');
  assert.equal(L.workspaceBusy(null, { flows: [flow()] }), false);
});

test('shouldAutoOpen: só na subida, com preferência ligada, painel fechado e sem dispensa', () => {
  const base = { prevBusy: false, busy: true, enabled: true, liveOpen: false, dismissed: false };
  assert.equal(L.shouldAutoOpen(base), true);
  assert.equal(L.shouldAutoOpen({ ...base, prevBusy: true }), false, 'já estava trabalhando');
  assert.equal(L.shouldAutoOpen({ ...base, prevBusy: null }), false, 'linha de base');
  assert.equal(L.shouldAutoOpen({ ...base, busy: false }), false);
  assert.equal(L.shouldAutoOpen({ ...base, enabled: false }), false, 'preferência desligada');
  assert.equal(L.shouldAutoOpen({ ...base, liveOpen: true }), false, 'já aberto');
  assert.equal(L.shouldAutoOpen({ ...base, dismissed: true }), false);
});

test('autoOpenStep: sem disparo na linha de base, dispara na subida, não reabre depois de fechado durante o mesmo trabalho, independe de foco', () => {
  const run = (steps, enabled = true) => { let mem = null; return steps.map(([busy, liveOpen]) => { const r = L.autoOpenStep(mem, { busy, liveOpen, enabled }); mem = r.mem; return r.open; }); };
  // abrir o app com a equipe já trabalhando e o painel fechado: linha de base, nada acontece
  assert.deepEqual(run([[true, false], [true, false], [true, false]]), [false, false, false]);
  // parado -> trabalhando: abre uma vez; com o painel já aberto na leitura seguinte não pede de novo
  assert.deepEqual(run([[false, false], [true, false], [true, true], [true, true]]), [false, true, false, false]);
  // o usuário fecha durante o trabalho: não reabre mesmo que o "trabalhando" oscile sem passar por parado
  assert.deepEqual(run([[false, false], [true, false], [true, true], [true, false], [true, false]]), [false, true, false, false, false]);
  // terminou e começou outro trabalho: abre de novo
  assert.deepEqual(run([[false, false], [true, false], [true, true], [true, false], [false, false], [true, false]]), [false, true, false, false, false, true]);
  // preferência desligada nunca abre
  assert.deepEqual(run([[false, false], [true, false]], false), [false, false]);
  // usuário abriu e fechou antes do trabalho: sem efeito; no trabalho abre
  assert.deepEqual(run([[false, true], [false, false], [true, false]]), [false, false, true]);
  // a função só recebe estado: nada de foco ou documento
  assert.equal(L.autoOpenStep.length, 2);
});

test('missionProgress: só a missão em execução do workspace, com n/m e etapas', () => {
  assert.equal(L.missionProgress([], 'ws_a'), null);
  assert.equal(L.missionProgress([flow()], 'ws_b'), null);
  assert.equal(L.missionProgress([flow({ activeRun: null })], 'ws_a'), null);
  assert.equal(L.missionProgress([flow()], null), null);
  const m = L.missionProgress([flow()], 'ws_a');
  assert.equal(m.flowId, 'f1'); assert.equal(m.title, 'Site'); assert.equal(m.done, 1); assert.equal(m.total, 2); assert.equal(m.pct, 50); assert.equal(m.label, '1/2'); assert.equal(m.waiting, false);
  assert.deepEqual(m.steps.map((s) => [s.id, s.title, s.state, s.label]), [['s1', 'Páginas', 'completed', 'concluída'], ['s2', 'Revisão', 'running', 'trabalhando']]);
  assert.equal(m.steps[1].terminalId, 't9');
  // etapa aguardando você
  const w = flow({ activeRun: { status: 'running', startedAt: '2026-01-01T10:00:00Z', steps: [{ stepId: 's1', status: 'waiting' }] } });
  assert.equal(L.missionProgress([w], 'ws_a').waiting, true);
  assert.equal(L.missionProgress([w], 'ws_a').steps[1].state, 'pending', 'etapa sem run = na fila');
  // duas missões ativas: a mais recente
  const novo = flow({ id: 'f2', title: 'Novo', activeRun: { status: 'running', startedAt: '2026-01-01T11:00:00Z', steps: [] } });
  assert.equal(L.missionProgress([flow(), novo], 'ws_a').flowId, 'f2');
});

test('changesSummary: totais, "e mais N" e estados de erro/vazio', () => {
  const f = (path) => ({ path, status: 'modified', added: 1, removed: 0, binary: false, mtime: 1 });
  const s = L.changesSummary({ mode: 'git', totals: { files: 3, added: 12, removed: 4 }, files: [f('a'), f('b'), f('c')] });
  assert.deepEqual([s.state, s.text, s.extra, s.mode], ['ok', '3 arquivos · +12 −4', 0, 'git']);
  assert.equal(L.changesSummary({ mode: 'git', totals: { files: 1, added: 0, removed: 0 }, files: [f('a')] }).text, '1 arquivo');
  const cut = L.changesSummary({ mode: 'git', truncated: true, totals: { files: 250, added: 5, removed: 1 }, files: Array.from({ length: 200 }, (_, i) => f(`x${i}`)) });
  assert.equal(cut.extra, 50); assert.equal(cut.text, '250 arquivos · +5 −1');
  assert.equal(L.changesSummary({ mode: 'git', totals: { files: 0 }, files: [] }).state, 'empty');
  assert.match(L.changesSummary({ mode: 'scan', totals: { files: 0 }, files: [] }).text, /últimos minutos/);
  const e = L.changesSummary({ mode: 'none', error: 'O Git demorou demais.', files: [], totals: {} });
  assert.deepEqual([e.state, e.text], ['error', 'O Git demorou demais.']);
  for (const bad of [null, undefined, 'x', 7, {}]) assert.equal(L.changesSummary(bad).state, 'empty', 'resposta estranha não quebra');
});

test('changeStatus, splitPath e lineDelta', () => {
  assert.deepEqual(L.changeStatus('added'), { label: 'novo', mark: 'A', tone: 'ok' });
  assert.equal(L.changeStatus('untracked').label, 'novo'); assert.equal(L.changeStatus('modified').mark, 'M'); assert.equal(L.changeStatus('deleted').tone, 'err'); assert.equal(L.changeStatus('conflict').label, 'conflito');
  assert.equal(L.changeStatus('zzz').mark, '?'); assert.equal(L.changeStatus(undefined).label, 'alterado');
  assert.deepEqual(L.splitPath('site/css/app.css'), { dir: 'site/css/', name: 'app.css' });
  assert.deepEqual(L.splitPath('index.html'), { dir: '', name: 'index.html' });
  assert.deepEqual(L.splitPath(undefined), { dir: '', name: '' });
  assert.equal(L.lineDelta({ added: 12, removed: 3 }).text, '+12 −3');
  assert.equal(L.lineDelta({ added: 5, removed: null }).text, '+5');
  assert.equal(L.lineDelta({ added: null, removed: null }).text, '');
  assert.equal(L.lineDelta({ binary: true, added: null, removed: null }).text, 'binário');
});

test('agoLabel: arredonda "há Xs" de 5 em 5 e muda de unidade', () => {
  const now = 1_000_000_000;
  const at = (s) => L.agoLabel(now - s * 1000, now);
  assert.equal(at(0), 'agora'); assert.equal(at(4), 'agora'); assert.equal(at(5), 'há 5s'); assert.equal(at(14), 'há 10s'); assert.equal(at(59), 'há 55s');
  assert.equal(at(60), 'há 1 min'); assert.equal(at(3599), 'há 59 min'); assert.equal(at(3600), 'há 1 h'); assert.equal(at(86_399), 'há 23 h'); assert.equal(at(86_400 * 3), 'há 3 d');
  assert.equal(L.agoLabel(now + 60_000, now), '', 'futuro'); assert.equal(L.agoLabel(now + 2000, now), 'agora', 'pequena diferença de relógio');
  for (const bad of [null, undefined, 'x', NaN]) assert.equal(L.agoLabel(bad, now), '');
});

test('nextPollMs e previewPollMs: 3 s trabalhando, 10 s parado, 0 oculto/fechado', () => {
  assert.equal(L.nextPollMs({ busy: true }), 3000); assert.equal(L.nextPollMs({ busy: false }), 10_000); assert.equal(L.nextPollMs(), 10_000);
  assert.equal(L.nextPollMs({ hidden: true, busy: true }), 0); assert.equal(L.nextPollMs({ active: false, busy: true }), 0);
  assert.equal(L.previewPollMs({}), 2000); assert.equal(L.previewPollMs({ hidden: true }), 0); assert.equal(L.previewPollMs({ active: false }), 0);
});

test('changesKey ignora generatedAt/durationMs (o estado só muda se o conteúdo mudou)', () => {
  const a = { mode: 'git', generatedAt: 1, durationMs: 5, files: [{ path: 'a' }] };
  assert.equal(L.changesKey(a), L.changesKey({ ...a, generatedAt: 99, durationMs: 80 }));
  assert.notEqual(L.changesKey(a), L.changesKey({ ...a, files: [{ path: 'b' }] }));
  assert.equal(L.changesKey(null), '');
});

test('pollAction: index.html que aparece depois (disponível mas sem listener) e listener derrubado religam pelo POST; listener de pé só atualiza', () => {
  assert.equal(L.pollAction({ available: false }, false), 'unavailable');
  assert.equal(L.pollAction(null, true), 'unavailable');
  assert.equal(L.pollAction({ available: true, running: false }, false), 'relight', 'o agente acabou de criar o index.html: o POST liga o listener');
  assert.equal(L.pollAction({ available: true, running: false }, true), 'relight', 'listener derrubado por ociosidade/reinício');
  assert.equal(L.pollAction({ available: true, running: true }, false), 'relight', 'sem a resposta do POST (path/entry) ainda');
  assert.equal(L.pollAction({ available: true, running: true }, true), 'adopt');
});
