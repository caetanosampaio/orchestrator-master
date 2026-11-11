// Briefing para o Maestro no cliente (briefing-view.js e components/BriefingBox.jsx): lógica pura e a ligação da tela com POST /api/maestro/briefing e GET /api/maestro. Sem navegador, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_BRIEFING, SENT_GRACE_MS, cleanBriefing, briefingProblem, briefingBody, runningMaestros, pickMaestro, latestBriefing, briefingStatus, briefingError, mergeMaestros } from '../../client/src/briefing-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const M = (id, o = {}) => ({ id, role: 'maestro', status: 'running', workspaceId: 'ws1', title: `Maestro ${id}`, ...o });

test('texto: tira caracteres de controle (menos quebra de linha e tabulação), apara e respeita 1 a 8000', () => {
  assert.equal(MAX_BRIEFING, 8000);
  assert.equal(cleanBriefing('  a\tb\r\nc\u0007\u001b[31m d\u0085 '), 'a\tb\nc[31m d');
  assert.equal(cleanBriefing(null), '');
  const one = [{ id: 'p1', title: 'M' }];
  assert.equal(briefingProblem('   \n ', { maestros: one }), 'Escreva o briefing.');
  assert.equal(briefingProblem('x'.repeat(MAX_BRIEFING), { maestros: one }), null);
  assert.match(briefingProblem('x'.repeat(MAX_BRIEFING + 1), { maestros: one }), /no máximo 8000/);
  assert.equal(briefingProblem(`  ${'x'.repeat(MAX_BRIEFING)}  \u0007`, { maestros: one }), null, 'conta depois de limpar');
  assert.match(briefingProblem('faça', { maestros: [] }), /Abra um time com Maestro/);
});

test('destino: um Maestro vai sem paneId; com mais de um é preciso escolher (e a escolha só vale se ele ainda roda)', () => {
  const ms = runningMaestros([M('p1'), M('p2', { status: 'exited' }), M('p3', { workspaceId: 'ws2' }), { id: 'b', role: 'builder', status: 'running', workspaceId: 'ws1' }, null], 'ws1');
  assert.deepEqual(ms, [{ id: 'p1', title: 'Maestro p1' }]); assert.deepEqual(runningMaestros(null, 'ws1'), []);
  assert.deepEqual(runningMaestros([M('p9', { title: '' })], 'ws1'), [{ id: 'p9', title: 'Maestro' }]);
  assert.equal(pickMaestro(ms, null), 'p1', 'único: ele mesmo');
  const two = runningMaestros([M('p1'), M('p2')], 'ws1');
  assert.equal(pickMaestro(two, null), null); assert.equal(pickMaestro(two, 'p2'), 'p2'); assert.equal(pickMaestro(two, 'sumiu'), null);
  assert.match(briefingProblem('faça', { maestros: two, paneId: null }), /Escolha qual Maestro/); assert.equal(briefingProblem('faça', { maestros: two, paneId: 'p1' }), null);
  assert.deepEqual(briefingBody({ workspaceId: 'ws1', text: ' oi ' }), { workspaceId: 'ws1', text: 'oi' }, 'sem paneId: o servidor acha o único Maestro');
  assert.deepEqual(briefingBody({ workspaceId: 'ws1', text: 'oi', paneId: 'p2' }), { workspaceId: 'ws1', text: 'oi', paneId: 'p2' });
  assert.deepEqual(Object.keys(briefingBody({ workspaceId: 'ws1', text: 'oi', paneId: '' })), ['workspaceId', 'text'], 'só as propriedades do contrato (o servidor recusa as desconhecidas)');
});

test('situação: o enviado agora (mesmo antes do snapshot), senão o mais recente do workspace; rótulos do contrato e nota de falha', () => {
  const list = [
    { id: 'brf_00000001', workspaceId: 'ws1', status: 'read', createdAt: '2026-11-11T10:00:00.000Z' },
    { id: 'brf_00000002', workspaceId: 'ws1', status: 'queued', createdAt: '2026-11-11T10:05:00.000Z' },
    { id: 'brf_00000003', workspaceId: 'ws2', status: 'failed', createdAt: '2026-11-11T10:09:00.000Z' },
  ];
  assert.equal(latestBriefing(list, { workspaceId: 'ws1' }).id, 'brf_00000002'); assert.equal(latestBriefing(list, { workspaceId: 'ws1', id: 'brf_00000001' }).id, 'brf_00000001');
  const sent = { id: 'brf_0000000a', workspaceId: 'ws1', status: 'queued', createdAt: '2026-11-11T11:00:00.000Z' };
  const fresh = Date.parse(sent.createdAt) + 1000;
  assert.equal(latestBriefing(list, { workspaceId: 'ws1', id: sent.id, sent, now: fresh }), sent, 'acabou de enviar: vale a resposta do POST');
  assert.equal(latestBriefing(null, { workspaceId: 'ws1', id: sent.id, sent, now: fresh }), sent, 'servidor sem `briefings` no snapshot');
  // passado o prazo e sem o servidor listar (reiniciou ou descartou): situação desconhecida, nunca "Na fila" para sempre
  const stale = latestBriefing(list, { workspaceId: 'ws1', id: sent.id, sent, now: Date.parse(sent.createdAt) + SENT_GRACE_MS + 1 });
  assert.equal(stale.id, sent.id); assert.equal(briefingStatus(stale).label, 'Situação desconhecida'); assert.match(briefingStatus(stale).note, /reiniciado ou o descartou/);
  assert.equal(latestBriefing(list, { workspaceId: 'ws9' }), null); assert.equal(latestBriefing(undefined, { workspaceId: 'ws1' }), null);
  assert.deepEqual(['queued', 'delivered', 'read', 'failed'].map((s) => briefingStatus({ status: s }).label), ['Na fila', 'Entregue', 'Lido pelo Maestro', 'Falhou']);
  assert.equal(briefingStatus({ status: 'failed', note: ' o Maestro\n saiu ' }).note, 'o Maestro saiu'); assert.equal(briefingStatus({ status: 'read' }).note, null);
  assert.equal(briefingStatus({ status: 'estranho' }).tone, 'dim', 'situação desconhecida não vira sucesso'); assert.equal(briefingStatus(null), null);
  assert.equal(briefingStatus({ status: 'failed' }).tone, 'err'); assert.equal(briefingStatus({ status: 'queued' }).tone, 'wait');
});

test('erros: muitos Maestros pede para escolher; nenhum Maestro e servidor antigo explicam; o resto usa a mensagem do servidor', () => {
  assert.equal(briefingError({ status: 409, code: 'many_maestros' }).choose, true);
  assert.deepEqual(briefingError({ status: 409, code: 'no_maestro', message: 'x' }), { choose: false, text: 'Abra um time com Maestro neste workspace.' });
  assert.match(briefingError({ status: 404 }).text, /ainda não recebe briefings/);
  assert.equal(briefingError({ status: 400, message: 'Propriedades não permitidas: x.' }).text, 'Propriedades não permitidas: x.');
  assert.equal(briefingError(null).text, 'Não foi possível enviar o briefing.');
  const panes = [{ id: 'term_aaaaaaaa', title: 'Maestro 1' }, { id: 'term_bbbbbbbb', title: 'Maestro 2' }];
  assert.deepEqual(briefingError({ status: 409, code: 'many_maestros', panes }).panes, panes, 'a lista do servidor vem junto');
  assert.deepEqual(briefingError({ status: 409, code: 'many_maestros' }).panes, []);
});

test('Maestros a oferecer: a grade mais os que o servidor listou no 409, sem repetir e só ids válidos (a grade pode estar atrasada)', () => {
  const local = [{ id: 'term_aaaaaaaa', title: 'Maestro 1' }];
  const merged = mergeMaestros(local, [{ id: 'term_aaaaaaaa', title: 'outro nome' }, { id: 'term_bbbbbbbb', title: 'Maestro 2' }, { id: '../x', title: 'mau' }, null, { id: 'term_cccccccc' }]);
  assert.deepEqual(merged, [{ id: 'term_aaaaaaaa', title: 'Maestro 1' }, { id: 'term_bbbbbbbb', title: 'Maestro 2' }, { id: 'term_cccccccc', title: 'Maestro' }]);
  assert.equal(merged.length > 1, true, 'com a lista do servidor o seletor aparece mesmo com a grade vendo um Maestro só');
  assert.deepEqual(mergeMaestros(local, undefined), local); assert.deepEqual(mergeMaestros(null, null), []);
  assert.equal(pickMaestro(merged, null), null, 'com mais de um, precisa escolher');
  const api = src('api.js'); assert.match(api, /Array\.isArray\(data\.panes\) \? \{ panes: data\.panes \}/, 'o cliente de API repassa a lista do erro');
  const box = src('components/BriefingBox.jsx');
  assert.match(box, /mergeMaestros\(local, extra\[workspaceId\]\)/); assert.match(box, /setFor\(setExtra, x\.panes\)/);
  assert.match(box, /readOnly=\{busy\}/, 'o campo não é desabilitado durante o envio (desabilitar tirava o foco)'); assert.ok(!/<textarea[^>]*disabled=/.test(box));
  assert.match(box, /input\.current\?\.focus\(\)/, 'o foco volta ao campo depois do envio');
});

test('BriefingBox: rótulo, contador, Ctrl+Enter, rota do contrato, escolha do Maestro, situação com aria-live e nada de HTML cru; montado na grade só com Maestro rodando', () => {
  const box = src('components/BriefingBox.jsx');
  assert.match(box, /api\.post\('\/api\/maestro\/briefing', briefingBody\(/); assert.ok(!/fetch\(/.test(box), 'passa pelo cliente de API de sempre');
  assert.match(box, /<label className="sr" htmlFor=\{`\$\{ids\.box\}-t`\}>Briefing para o Maestro<\/label>/); assert.match(box, /maxLength=\{MAX_BRIEFING\}/); assert.match(box, /\{len\}\/\{MAX_BRIEFING\}/);
  assert.match(box, /aria-live="polite"/); assert.match(box, /role="status"/); assert.match(box, /aria-expanded=\{open\}/); assert.match(box, /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/);
  assert.match(box, /'Enviar ao Maestro'/); assert.match(box, /maestros\.length > 1 &&/, 'com mais de um Maestro aparece o seletor'); assert.match(box, /<label htmlFor=\{ids\.pane\}>Maestro<\/label>/);
  assert.match(box, /sending\.current/, 'trava síncrona contra envio duplo'); assert.ok(!/dangerouslySetInnerHTML/.test(box));
  const grid = src('components/TerminalGrid.jsx');
  assert.match(grid, /\{ws && maestroPanes\.length > 0 && <BriefingBox workspaceId=\{ws\.id\} maestros=\{maestroPanes\} briefings=\{maestro\?\.briefings\} \/>\}/);
  assert.match(grid, /runningMaestros\(mine, ws\.id\)/);
  const css = src('cockpit-ui.css'); for (const k of ['oc-brief', 'oc-brief-in', 'oc-brief-st', 'oc-brief-err']) assert.match(css, new RegExp(`\\.${k}\\b`), `falta .${k}`);
  assert.match(css, /\.tg\.tg-full > \.oc-brief \{ display: none; \}/);
});
