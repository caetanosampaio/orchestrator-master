// Página independente de acompanhamento ao vivo (server/live/*): modelo puro com snapshots no formato do contrato (schema 1) e
// LINT ESTÁTICO dos 4 arquivos (nenhuma API que injete HTML/código, sem script/style inline, referências só às rotas permitidas).
// Sem navegador, sem servidor, sem rede e sem tocar `data/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as M from '../live/live-model.js';

const LIVE_DIR = new URL('../live/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, LIVE_DIR), 'utf8');
const FILES = ['live.html', 'live.css', 'live-model.js', 'live.js'];
const SRC = Object.fromEntries(FILES.map((f) => [f, read(f)]));

// ---------- fixtures no formato do contrato ----------
const T0 = Date.parse('2026-11-11T12:00:00.000Z');
const iso = (ms) => new Date(T0 + ms).toISOString();

const full = () => ({
  schema: 1, generatedAt: iso(120000), link: { expiresAt: iso(12 * 3600 * 1000) },
  mission: { title: 'Adicionar login', objective: 'Implementar login com e-mail e senha.', state: 'working', stateLabel: 'Em execução', createdAt: iso(-60000), startedAt: iso(0), finishedAt: null, durationMs: null, workspaceName: 'loja', demo: false, origin: 'cockpit' },
  progress: { basis: 'steps', done: 1, total: 3, pct: 33 },
  cycle: { status: 'running', round: 2, maxIterations: 5, blockedCode: null, blockedReason: null },
  steps: [
    { id: 's1', title: 'Ler o código', status: 'done', dependsOn: [], round: 1, attempts: 1 },
    { id: 's2', title: 'Escrever a rota', status: 'running', dependsOn: ['s1'], round: 2, attempts: 1 },
    { id: 's3', title: 'Testes', status: 'pending', dependsOn: ['s2'], round: null, attempts: 0 },
  ],
  rounds: [
    { n: 1, status: 'done', title: 'Mapear', agent: 'scout', startedAt: iso(0), finishedAt: iso(30000), verification: 'passed', evidenceLevel: 'verified' },
    { n: 2, status: 'running', title: 'Implementar', agent: 'builder', startedAt: iso(31000), finishedAt: null, verification: '', evidenceLevel: '' },
  ],
  squad: { note: 'Tarefas do Maestro são mantidas só em memória (últimas 50).', tasks: [{ id: 't1', to: { title: 'Builder 1', role: 'builder', provider: 'claude', model: 'opus' }, status: 'running', createdAt: iso(40000), doneAt: null, text: 'Criar /login' }] },
  current: { what: 'Escrevendo a rota de login', agent: 'builder', since: iso(90000) },
  recent: [{ kind: 'claude', text: 'Lendo server/auth.js' }, { kind: 'claude', text: 'Editando a rota' }],
  approvals: [{ id: 'a1', round: 2, title: 'Instalar bcrypt', status: 'pending', createdAt: iso(100000) }],
  verifications: [{ round: 1, script: 'npm test', status: 'passed', durationMs: 4200 }],
  delivery: { code: 'in_progress', delivered: false, assurance: 'verified', limitations: ['sem teste de carga'], files: { total: 2, items: ['server/auth.js', { path: 'server/auth.test.js', status: 'new' }] } },
  timeline: { items: [
    { at: iso(0), kind: 'started', text: 'Ciclo iniciado' },
    { at: iso(60000), kind: 'approval', text: 'Aprovação pedida' },
    { at: iso(30000), kind: 'round', text: 'Rodada 1 concluída' },
  ], omitted: 4 },
  notes: ['plano antigo sem datas'],
});
const minimal = () => ({ schema: 1, generatedAt: iso(0), mission: { title: 'x', state: 'idle' } });
const squadOnly = () => ({
  schema: 1, generatedAt: iso(5000), link: { expiresAt: iso(3600000) },
  mission: { title: 'Só squad', objective: '', state: 'working', stateLabel: 'Em execução', createdAt: iso(0), workspaceName: 'w', demo: false, origin: 'maestro' },
  progress: null, cycle: null, steps: [], rounds: [], squad: { note: 'mantidas só em memória', tasks: [{ id: 't', to: { title: 'A' }, status: 'done', createdAt: iso(1000), doneAt: iso(2000), text: 'ok' }] },
  current: null, recent: [], approvals: [], verifications: [], delivery: null, timeline: { items: [], omitted: 0 }, notes: [],
});
const demo = () => ({ ...minimal(), mission: { title: 'Demo', state: 'completed', demo: true, origin: 'demo' } });

// ---------- tempo ----------
test('formatDuration / formatAgo: curtos, legíveis e tolerantes', () => {
  assert.equal(M.formatDuration(0), '0 s');
  assert.equal(M.formatDuration(12_000), '12 s');
  assert.equal(M.formatDuration(59_999), '59 s');
  assert.equal(M.formatDuration(63_000), '1 min 03 s');
  assert.equal(M.formatDuration(3_600_000 + 5 * 60_000), '1 h 05 min');
  assert.equal(M.formatDuration(27 * 3_600_000), '1 d 03 h');
  for (const bad of [-1, NaN, null, undefined, 'x', {}, Infinity]) assert.equal(M.formatDuration(bad), '—', String(bad));
  assert.equal(M.formatAgo(12_000), 'há 12 s');
  assert.equal(M.formatAgo(63_000), 'há 1 min 03 s');
  assert.equal(M.formatAgo(400), 'agora');
  assert.equal(M.formatAgo(undefined), '—');
});

test('toMs / serverNow: ISO e epoch; relógio do servidor estimado sem depender do relógio local', () => {
  assert.equal(M.toMs('2026-11-11T12:00:00.000Z'), T0);
  assert.equal(M.toMs(T0), T0);
  for (const bad of ['', 'abc', null, undefined, NaN, -5, 0, {}, []]) assert.equal(M.toMs(bad), null, String(bad));
  // recebido em local 1000 com generatedAt = T0; agora local 4000 -> servidor T0 + 3000
  assert.equal(M.serverNow(T0, 1000, 4000), T0 + 3000);
  assert.equal(M.serverNow(null, 1000, 4000), 4000, 'sem generatedAt usa o relógio local');
  assert.equal(M.serverNow(T0, 5000, 4000), T0, 'nunca anda para trás');
});

test('backoffDelay: exponencial com teto de 30 s e jitter de ±25%', () => {
  assert.deepEqual([0, 1, 2, 3].map((a) => M.backoffDelay(a, () => 0.5)), [1000, 2000, 4000, 8000]);
  assert.equal(M.backoffDelay(50, () => 0.5), 30000);
  assert.equal(M.backoffDelay(0, () => 0), 750);
  assert.equal(M.backoffDelay(0, () => 0.999999), 1250);
  assert.equal(M.backoffDelay(-3, () => 0.5), 1000);
  assert.equal(M.backoffDelay('x', () => 0.5), 1000);
  assert.equal(M.POLL_INTERVAL_MS, 5000);
});

// ---------- rótulos ----------
test('rótulos e tons: estados da missão, status e evidência; desconhecido nunca quebra', () => {
  assert.equal(M.stateLabel('working'), 'Em execução');
  assert.equal(M.stateLabel('completed'), 'Concluída');
  assert.equal(M.stateLabel('banana', 'Rótulo do servidor'), 'Rótulo do servidor');
  assert.equal(M.stateLabel(undefined), 'Estado desconhecido');
  assert.equal(M.stateTone('working'), 'run'); assert.equal(M.stateTone('attention'), 'err'); assert.equal(M.stateTone('x'), 'idle');
  assert.equal(M.statusLabel('running'), 'em execução');
  assert.equal(M.statusLabel('PENDING'), 'pendente');
  assert.equal(M.statusLabel('pending', 'approval'), 'aguardando decisão');
  assert.equal(M.statusTone('pending', 'approval'), 'warn');
  assert.equal(M.statusTone('pending'), 'idle');
  assert.equal(M.statusTone('failed'), 'err'); assert.equal(M.statusTone('passed'), 'ok');
  assert.equal(M.statusLabel(''), '—');
  assert.equal(M.statusLabel('<b>x</b>'), '<b>x</b>', 'texto desconhecido passa cru (quem desenha usa textContent)');
  assert.equal(M.evidenceLabel('verified'), 'verificada'); assert.equal(M.evidenceTone('verified'), 'ok'); assert.equal(M.evidenceTone('none'), 'err');
  assert.equal(M.kindLabel('approval'), 'aprovação'); assert.equal(M.kindLabel(''), 'evento'); assert.equal(M.kindTone('block'), 'err');
  assert.ok(M.isDoneStatus('done') && M.isDoneStatus('completed') && !M.isDoneStatus('running') && !M.isDoneStatus(undefined));
});

test('connectionView: ao vivo, reconectando, link expirado, missão encerrada e pausa', () => {
  assert.equal(M.connectionView({ phase: 'live', state: 'working' }).label, 'ao vivo');
  assert.equal(M.connectionView({ phase: 'reconnecting' }).label, 'reconectando…');
  assert.equal(M.connectionView({ phase: 'connecting' }).key, 'connecting');
  const exp = M.connectionView({ phase: 'expired', state: 'working' });
  assert.match(exp.label, /link expirado.*gere outro no FORGE/); assert.equal(exp.tone, 'err');
  assert.equal(M.connectionView({ phase: 'live', state: 'completed' }).label, 'missão encerrada');
  assert.equal(M.connectionView({ phase: 'live', state: 'cancelled' }).key, 'finished');
  assert.equal(M.connectionView({ phase: 'ended' }).key, 'ended');
  assert.equal(M.connectionView({ phase: 'paused', state: 'working' }).key, 'paused');
  assert.equal(M.connectionView().key, 'live');
});

// ---------- normalização ----------
test('normalizeSnapshot: snapshot completo vira estrutura tipada e preserva o conteúdo', () => {
  const n = M.normalizeSnapshot(full());
  assert.equal(n.ok, true); assert.equal(n.schema, 1);
  assert.equal(n.generatedAt, T0 + 120000);
  assert.deepEqual([n.mission.title, n.mission.state, n.mission.stateLabel, n.mission.tone, n.mission.workspaceName], ['Adicionar login', 'working', 'Em execução', 'run', 'loja']);
  assert.equal(n.mission.startedAt, T0); assert.equal(n.mission.finishedAt, null); assert.equal(n.mission.demo, false);
  assert.equal(n.steps.length, 3); assert.deepEqual(n.steps[1].dependsOn, ['s1']); assert.equal(n.steps[2].round, null);
  assert.equal(n.rounds[0].evidenceLevel, 'verified'); assert.equal(n.rounds[0].finishedAt, T0 + 30000);
  assert.equal(n.squad.tasks[0].to.model, 'opus'); assert.match(n.squad.note, /memória/);
  assert.deepEqual(n.current, { what: 'Escrevendo a rota de login', agent: 'builder', since: T0 + 90000 });
  assert.equal(n.recent.length, 2); assert.equal(n.approvals[0].status, 'pending'); assert.equal(n.verifications[0].durationMs, 4200);
  assert.equal(n.delivery.limitations[0], 'sem teste de carga');
  assert.deepEqual(n.delivery.files.items.map((f) => f.text), ['server/auth.js', 'server/auth.test.js']);
  assert.equal(n.delivery.files.total, 2); assert.equal(n.timeline.items.length, 3); assert.equal(n.timeline.omitted, 4);
  assert.deepEqual(n.notes, ['plano antigo sem datas']);
  assert.equal(n.link.expiresAt, T0 + 12 * 3600 * 1000);
});

test('normalizeSnapshot: mínimo, só-squad e demo (campos ausentes viram vazio/null)', () => {
  const mn = M.normalizeSnapshot(minimal());
  assert.equal(mn.ok, true);
  assert.deepEqual([mn.progress, mn.cycle, mn.squad, mn.current, mn.delivery], [null, null, null, null, null]);
  assert.deepEqual([mn.steps, mn.rounds, mn.recent, mn.approvals, mn.verifications, mn.notes], [[], [], [], [], [], []]);
  assert.deepEqual(mn.timeline, { items: [], omitted: 0 });
  const sq = M.normalizeSnapshot(squadOnly());
  assert.equal(sq.cycle, null); assert.equal(sq.squad.tasks.length, 1); assert.equal(sq.squad.tasks[0].to.title, 'A'); assert.equal(sq.squad.tasks[0].to.role, '');
  assert.equal(M.computeProgress(sq), null, 'sem etapas nem progresso: sem barra');
  const d = M.normalizeSnapshot(demo());
  assert.equal(d.mission.demo, true); assert.equal(d.mission.state, 'completed');
});

test('normalizeSnapshot: malformado nunca lança e nunca vaza tipo errado', () => {
  for (const bad of [null, undefined, 42, 'texto', true, [], [1, 2], () => 1]) {
    const n = M.normalizeSnapshot(bad);
    assert.equal(n.ok, false, String(bad)); assert.deepEqual(n.steps, []); assert.equal(n.mission.title, '');
  }
  const garbage = {
    schema: 'um', generatedAt: {}, link: 'x', mission: 'não é objeto', progress: 'x', cycle: [], steps: 'nope', rounds: { a: 1 }, squad: 7, current: [], recent: 'x',
    approvals: [null, 1, 'a', []], verifications: [{}, null], delivery: 'x', timeline: { items: [null, 5, { at: 'ontem', text: 7 }, { at: iso(0), text: '' }], omitted: 'muitos' }, notes: [{ text: 'a' }, null, 3],
  };
  const n = M.normalizeSnapshot(garbage);
  assert.equal(n.ok, true); assert.equal(n.schema, null); assert.equal(n.generatedAt, null);
  assert.deepEqual([n.progress, n.cycle, n.squad, n.current, n.delivery], [null, null, null, null, null]);
  assert.deepEqual(n.steps, []); assert.deepEqual(n.rounds, []); assert.deepEqual(n.recent, []);
  assert.equal(n.approvals.length, 4, 'itens inválidos viram linhas vazias, sem lançar'); assert.equal(n.approvals[0].title, '');
  assert.equal(n.timeline.items.length, 1, 'item com texto 7 vira "7" e sem horário; vazios são descartados'); assert.equal(n.timeline.items[0].text, '7'); assert.equal(n.timeline.items[0].at, null);
  assert.equal(n.timeline.omitted, 0); assert.deepEqual(n.notes, ['a', '3']);
  assert.equal(n.mission.state, 'unknown'); assert.equal(n.mission.stateLabel, 'Estado desconhecido');
  // referências circulares e getters que lançam
  const circ = { mission: { title: 'c' } }; circ.mission.self = circ;
  assert.doesNotThrow(() => M.normalizeSnapshot(circ));
  const boom = { get mission() { throw new Error('boom'); } };
  assert.doesNotThrow(() => M.normalizeSnapshot(boom));
});

test('normalizeSnapshot: fuzz determinístico com valores de qualquer tipo nunca lança', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const atoms = [null, undefined, 0, -1, 1e308, NaN, '', 'x', 'working', '<script>', true, false, [], {}, [null], { a: 1 }, T0, iso(0)];
  const keys = ['schema', 'generatedAt', 'link', 'mission', 'progress', 'cycle', 'steps', 'rounds', 'squad', 'current', 'recent', 'approvals', 'verifications', 'delivery', 'timeline', 'notes', 'state', 'title', 'items', 'tasks', 'files', 'to', 'at', 'since', 'status'];
  const gen = (depth) => {
    const r = rnd();
    if (depth > 3 || r < 0.35) return atoms[Math.floor(rnd() * atoms.length)];
    if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => gen(depth + 1));
    const o = {}; for (let i = 0, n = Math.floor(rnd() * 8); i < n; i += 1) o[keys[Math.floor(rnd() * keys.length)]] = gen(depth + 1);
    return o;
  };
  for (let i = 0; i < 400; i += 1) {
    const raw = gen(0);
    assert.doesNotThrow(() => { const n = M.normalizeSnapshot(raw); M.computeProgress(n); M.nowView(n, T0); M.missionDuration(n, T0); M.groupTimeline(n.timeline.items); M.expiryText(n, T0); M.pageTitle(n); }, `iteração ${i}`);
  }
});

test('str: remove controles e bidi, preserva quebras de linha e recorta; texto hostil fica inerte como texto', () => {
  assert.equal(M.str('a\u0000b\u0007c\u001b[31md'), 'abc[31md');
  assert.equal(M.str('x‮y'), 'xy', 'sobrescrita bidirecional removida');
  assert.equal(M.str('linha1\nlinha2\ttab'), 'linha1\nlinha2\ttab');
  assert.equal(M.str('a'.repeat(50), 10).length, 10); assert.ok(M.str('a'.repeat(50), 10).endsWith('…'));
  assert.equal(M.str({ toString() { return 'x'; } }), ''); assert.equal(M.str(null), ''); assert.equal(M.str(12), '12');
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const snap = M.normalizeSnapshot({ ...minimal(), mission: { title: hostile, state: 'working' }, current: { what: hostile, agent: hostile, since: iso(0) }, recent: [{ kind: 'claude', text: hostile }] });
  assert.equal(snap.mission.title, hostile, 'o modelo não interpreta nem escapa: quem desenha usa só textContent');
  assert.equal(snap.current.what, hostile); assert.equal(snap.recent[0].text, hostile);
});

test('normalizeSnapshot: listas gigantes são recortadas', () => {
  const big = { ...minimal(), steps: Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}`, title: 't', status: 'pending' })), timeline: { items: Array.from({ length: 5000 }, (_, i) => ({ at: iso(i), kind: 'x', text: 't' })), omitted: 0 } };
  const n = M.normalizeSnapshot(big);
  assert.ok(n.steps.length <= 400 && n.timeline.items.length <= 400);
});

// ---------- derivados ----------
test('computeProgress: usa o do servidor, deriva das etapas e nunca passa de 100%', () => {
  assert.deepEqual(M.computeProgress(M.normalizeSnapshot(full())), { basis: 'steps', done: 1, total: 3, pct: 33, label: '1 de 3 passos concluídos' });
  const derived = M.normalizeSnapshot({ ...full(), progress: null });
  assert.deepEqual(M.computeProgress(derived), { basis: 'steps', done: 1, total: 3, pct: 33, label: '1 de 3 passos concluídos' });
  const over = M.normalizeSnapshot({ ...minimal(), progress: { done: 9, total: 3, pct: 300 } });
  assert.equal(M.computeProgress(over).pct, 100); assert.equal(M.computeProgress(over).done, 3);
  assert.equal(M.computeProgress(M.normalizeSnapshot({ ...minimal(), progress: { done: 0, total: 0 } })), null);
  assert.equal(M.computeProgress(M.normalizeSnapshot({ ...minimal(), progress: { done: 1, total: 1 } })).label, '1 de 1 passo concluído');
  assert.equal(M.computeProgress(null), null); assert.equal(M.computeProgress(undefined), null);
});

test('nowView: o que, quem e a duração viva; sem current, explica o estado', () => {
  const n = M.normalizeSnapshot(full());
  const v = M.nowView(n, T0 + 100000);
  assert.deepEqual([v.active, v.what, v.agent, v.sinceMs], [true, 'Escrevendo a rota de login', 'builder', 10000]);
  assert.equal(M.nowView(n, T0).sinceMs, 0, 'duração nunca fica negativa');
  assert.match(M.nowView(M.normalizeSnapshot(squadOnly()), T0).what, /próximo evento/);
  assert.match(M.nowView(M.normalizeSnapshot(demo()), T0).what, /encerrada/);
  assert.match(M.nowView(M.normalizeSnapshot({ ...minimal(), mission: { state: 'approval' } }), T0).what, /decisão humana/);
  assert.equal(M.nowView(null, T0).active, false);
});

test('missionDuration / expiryText / pageTitle', () => {
  const n = M.normalizeSnapshot(full());
  assert.equal(M.missionDuration(n, T0 + 125000), 125000, 'viva enquanto não terminou');
  const done = M.normalizeSnapshot({ ...full(), mission: { ...full().mission, state: 'completed', finishedAt: iso(300000), durationMs: 300000 } });
  assert.equal(M.missionDuration(done, T0 + 999999), 300000);
  assert.equal(M.missionDuration(M.normalizeSnapshot({}), T0), null);
  assert.equal(M.expiryText(n, T0 + 12 * 3600 * 1000 - 20 * 60000), 'link expira em 20 min 00 s');
  assert.equal(M.expiryText(n, T0 + 13 * 3600 * 1000), 'link expirado');
  assert.equal(M.expiryText(M.normalizeSnapshot({}), T0), '');
  assert.equal(M.pageTitle(n), 'FORGE · Adicionar login · Em execução'); assert.equal(M.pageTitle(null), 'FORGE · missão ao vivo');
});

test('groupTimeline: agrupa por dia, ordena (estável) e põe itens sem horário no fim', () => {
  const items = [
    { at: '2026-11-10T12:00:00Z', kind: 'a', text: 'ontem' },
    { at: '2026-11-11T12:00:05Z', kind: 'b', text: 'hoje 2' },
    { at: '2026-11-11T12:00:05Z', kind: 'b', text: 'hoje 2b (mesmo instante)' },
    { at: '2026-11-11T12:00:00Z', kind: 'c', text: 'hoje 1' },
    { at: 'lixo', kind: 'd', text: 'sem horário' },
    null,
  ];
  const desc = M.groupTimeline(items, { utc: true });
  assert.deepEqual(desc.map((g) => g.day), ['11/11/2026', '10/11/2026', 'sem horário']);
  assert.deepEqual(desc[0].items.map((i) => i.text), ['hoje 2b (mesmo instante)', 'hoje 2', 'hoje 1']);
  assert.equal(desc[0].items[2].time, '12:00:00');
  const asc = M.groupTimeline(items, { order: 'asc', utc: true });
  assert.deepEqual(asc.map((g) => g.day), ['10/11/2026', '11/11/2026', 'sem horário']);
  assert.deepEqual(asc[1].items.map((i) => i.text), ['hoje 1', 'hoje 2', 'hoje 2b (mesmo instante)'], 'empate mantém a ordem original');
  assert.equal(asc[2].items[0].time, '—');
  assert.deepEqual(M.groupTimeline(undefined), []); assert.deepEqual(M.groupTimeline('x'), []);
});

// ---------- lint estático ----------
const stripComments = (name, s) => (name.endsWith('.css') ? s.replace(/\/\*[\s\S]*?\*\//g, '') : name.endsWith('.html') ? s.replace(/<!--[\s\S]*?-->/g, '') : s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'));

test('lint: os 4 arquivos existem, sem BOM e sem dependências externas', () => {
  for (const f of FILES) {
    assert.ok(SRC[f].length > 200, `${f} existe e não está vazio`);
    assert.notEqual(SRC[f].charCodeAt(0), 0xfeff, `${f} sem BOM`);
  }
  for (const f of ['live-model.js', 'live.js']) {
    const r = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(f, LIVE_DIR))], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f} sintaxe: ${r.stderr}`);
  }
});

test('lint: nenhuma API que injete HTML/código nem armazenamento/rede indevidos (código, não comentários)', () => {
  const forbidden = [
    ['innerHTML', /innerHTML/], ['outerHTML', /outerHTML/], ['insertAdjacentHTML', /insertAdjacent/i], ['document.write', /document\s*\.\s*write/],
    ['eval', /\beval\s*\(/], ['new Function', /new\s+Function|\bFunction\s*\(/], ['setTimeout/setInterval com string', /set(?:Timeout|Interval)\s*\(\s*['"`]/],
    ['srcdoc', /srcdoc/], ['createContextualFragment', /createContextualFragment/], ['DOMParser', /DOMParser/], ['import() dinâmico', /\bimport\s*\(/],
    ['localStorage', /localStorage/], ['sessionStorage', /sessionStorage/], ['cookie', /document\s*\.\s*cookie|Set-Cookie/i], ['indexedDB', /indexedDB/],
    ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /WebSocket/], ['sendBeacon', /sendBeacon/], ['postMessage', /postMessage/], ['importScripts', /importScripts/],
    ['window.open', /window\s*\.\s*open/], ['location', /\blocation\s*[.=]/], ['atribuição de href/src/action', /\.\s*(?:href|src|action|formAction)\s*=[^=]/],
    ['setAttribute de href/src/style/on*', /setAttribute\s*\(\s*['"`](?:href|src|style|on|xlink|srcset|action|formaction)/i],
  ];
  for (const f of ['live.js', 'live-model.js']) {
    const code = stripComments(f, SRC[f]);
    for (const [name, re] of forbidden) if (re) assert.doesNotMatch(code, re, `${f}: uso proibido de ${name}`);
  }
  // O único setAttribute com nome vindo de variável é o do helper el(), protegido por lista de permissão.
  const code = stripComments('live.js', SRC['live.js']);
  assert.match(code, /ATTR_OK\s*=\s*\/\^\(role\|title\|id\|aria-\[a-z\]\+\|data-\[a-z-\]\+\)\$\//, 'lista de atributos permitidos presente e restrita');
  assert.match(code, /if \(ATTR_OK\.test\(k\)\) n\.setAttribute\(k, String\(v\)\)/, 'el() só aplica atributos permitidos');
  assert.match(code, /\.style\.width\s*=/, 'a barra de progresso usa o CSSOM (a CSP não aceita style inline)');
  assert.doesNotMatch(code, /\.style\.cssText|\.setAttribute\(\s*['"]style/, 'nada de style por texto');
});

test('lint: rede restrita a ./stream, ./data e ./report.md; imports só do modelo em /live/_/', () => {
  const code = stripComments('live.js', SRC['live.js']);
  const fetches = [...code.matchAll(/\bfetch\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(fetches, ["'./data'"], 'único fetch é ./data');
  const sources = [...code.matchAll(/new\s+EventSource\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(sources, ["'./stream'"], 'único EventSource é ./stream');
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['/live/_/live-model.js']);
  assert.doesNotMatch(stripComments('live-model.js', SRC['live-model.js']), /\bimport\b|\bfetch\b|EventSource|document|window/, 'o modelo é puro: sem DOM, rede nem imports');
  for (const f of FILES) assert.doesNotMatch(stripComments(f, SRC[f]), /(?:https?|wss?|ftp):\/\/|(?:^|[\s'"(=])\/\/[a-z0-9.-]+\.[a-z]{2,}/i, `${f}: sem URL externa`);
  // todo literal de caminho é permitido
  const paths = [...code.matchAll(/['"`](\.{1,2}\/[^'"`]*|\/live\/[^'"`]*)['"`]/g)].map((m) => m[1]);
  for (const p of paths) assert.ok(['./data', './stream', '/live/_/live-model.js'].includes(p), `caminho não permitido: ${p}`);
});

test('lint HTML: sem script/style inline, sem on*=, só referências permitidas e landmarks/ARIA presentes', () => {
  const html = stripComments('live.html', SRC['live.html']);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc="\/live\/_\/live\.js"/, 'script só externo, de /live/_/live.js'); assert.match(m[1], /type="module"/); assert.equal(m[2].trim(), '', 'script sem corpo inline');
  }
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.doesNotMatch(html, /<style\b/i, 'sem <style>'); assert.doesNotMatch(html, /\sstyle\s*=/i, 'sem style=""');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'sem atributos on*'); assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<(?:iframe|object|embed|form|base|meta[^>]*http-equiv)\b/i);
  const refs = [...html.matchAll(/\b(?:href|src|action|data|poster|srcset)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).sort();
  assert.deepEqual(refs, ['./report.md', '#conteudo', '/live/_/live.css', '/live/_/live.js', 'data:,'].sort());
  assert.match(html, /<html lang="pt-BR">/); assert.match(html, /name="viewport"/); assert.match(html, /<header\b/); assert.match(html, /<main\b/); assert.match(html, /<footer\b/);
  assert.match(html, /aria-live="polite"/); assert.match(html, /role="progressbar"/); assert.match(html, /Baixar relatório \(\.md\)/);
  assert.match(html, /name="referrer" content="no-referrer"/); assert.match(html, /name="robots"/);
  const h1s = html.match(/<h1\b/g) || []; assert.equal(h1s.length, 1, 'um único h1');
});

test('lint HTML x JS: todo id usado por $() existe no HTML e ids são únicos', () => {
  const html = SRC['live.html'], code = stripComments('live.js', SRC['live.js']);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids duplicados');
  const used = new Set([...code.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]));
  for (const id of used) assert.ok(ids.includes(id), `JS usa #${id}, que não existe no HTML`);
  for (const m of html.matchAll(/aria-labelledby="([^"]+)"/g)) for (const id of m[1].split(/\s+/)) assert.ok(ids.includes(id), `aria-labelledby aponta para #${id} inexistente`);
});

test('lint JS: tudo que live.js importa do modelo existe no modelo', () => {
  const code = stripComments('live.js', SRC['live.js']);
  const names = code.match(/import\s*\{([\s\S]*?)\}\s*from/)[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(names.length > 10);
  for (const n of names) assert.ok(n in M, `live-model.js não exporta ${n}`);
});

test('lint CSS: sem @import, url(), fontes remotas nem brilho; com foco visível e reduced-motion', () => {
  const css = stripComments('live.css', SRC['live.css']);
  assert.doesNotMatch(css, /@import|@font-face|url\s*\(|https?:|\/\/|image-set|expression\(/i);
  assert.doesNotMatch(css, /box-shadow|text-shadow|drop-shadow|blur\s*\(/i, 'estética sem glow');
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /min-height:\s*40px/, 'alvo de toque confortável nos botões');
  assert.match(css, /--mono:/);
});

// contraste WCAG dos tokens de texto contra o fundo preto
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('lint CSS: cores de texto têm contraste AA (>= 4,5:1) sobre o fundo e sobre os cartões', () => {
  const css = SRC['live.css'];
  const tok = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  const bg = tok('bg'), raise = tok('raise'), raise2 = tok('raise2');
  assert.ok(bg && raise && raise2);
  for (const n of ['strong', 'text', 'dim', 'faint', 'run', 'ok', 'warn', 'err', 'brand-soft']) {
    const c = tok(n); assert.ok(c, `token --${n}`);
    for (const [name, base] of [['fundo', bg], ['cartão', raise], ['botão', raise2]]) assert.ok(contrast(c, base) >= 4.5, `--${n} sobre ${name}: ${contrast(c, base).toFixed(2)}`);
  }
});
