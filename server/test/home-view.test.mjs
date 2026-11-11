// Página Início (cliente, funções puras e guardas de estrutura): formatação PT-BR, validação do contrato de /api/provider-activity, séries empilhadas, workspaces recentes e CONTINUAR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PERIODS, MODES, periodById, modeById, dayKey, parseDay, addDays, longDate, fullDate, fmtTokens, fmtExact, fmtPct, normalizeActivity, providerLook, windowOf, firstDay,
  providerTotals, peakDay, buildSeries, axisTicks, totalCaption, agoLabel, lastUsedMap, recentWorkspaces, continueTarget,
} from '../../client/src/home-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const NOW = new Date(2026, 10, 11, 15, 30); // 11/11/2026, hora local (os testes não dependem do fuso)
const iso = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

// Fixture no formato do contrato (o que o servidor devolve).
const raw = () => ({
  generatedAt: '2026-11-11T18:30:00.000Z', sinceDay: '2026-10-05', scanning: false,
  providers: [
    { id: 'codex', label: 'Codex', accounts: 1, days: { '2026-11-10': { io: 2_000_000, cache: 500_000 }, '2026-11-11': { io: 1_000_000, cache: 0 } } },
    { id: 'claude', label: 'Claude', accounts: 2, days: { '2026-10-05': { io: 9_000_000, cache: 90_000_000 }, '2026-11-09': { io: 5_000_000, cache: 20_000_000 }, '2026-11-10': { io: 3_000_000, cache: 10_000_000 }, '2026-11-11': { io: 400_000, cache: 1_000_000 } } },
  ],
});

test('formatação PT-BR: mi, mil e bi com 3 algarismos significativos; exato com milhar; percentuais com "<1%"', () => {
  assert.equal(fmtTokens(485_000_000), '485 mi'); assert.equal(fmtTokens(20_600_000), '20,6 mi'); assert.equal(fmtTokens(2_000_000), '2 mi'); assert.equal(fmtTokens(1_200_000), '1,2 mi');
  assert.equal(fmtTokens(218_000), '218 mil'); assert.equal(fmtTokens(89_400), '89,4 mil'); assert.equal(fmtTokens(1_234_567_890), '1,23 bi'); assert.equal(fmtTokens(40_200_000), '40,2 mi');
  assert.equal(fmtTokens(999), '999'); assert.equal(fmtTokens(0), '0'); assert.equal(fmtTokens(-5), '0'); assert.equal(fmtTokens(NaN), '0'); assert.equal(fmtTokens('abc'), '0');
  assert.equal(fmtTokens(999_960), '1 mi', 'arredondar 999,96 mil sobe para 1 mi, nunca "1000 mil"'); assert.equal(fmtTokens(999_960_000), '1 bi');
  assert.equal(fmtExact(485_312_004), '485.312.004'); assert.equal(fmtExact('x'), '0');
  assert.equal(fmtPct(352, 485), '73%'); assert.equal(fmtPct(1, 1000), '<1%'); assert.equal(fmtPct(0, 100), '0%'); assert.equal(fmtPct(5, 0), '0%');
});

test('dias locais: chave AAAA-MM-DD, soma de dias, validação e datas por extenso', () => {
  assert.equal(dayKey(NOW), '2026-11-11'); assert.equal(addDays('2026-11-01', -1), '2026-10-31'); assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(parseDay('2026-02-30'), null, 'dia inexistente'); assert.equal(parseDay('2026-13-01'), null); assert.equal(parseDay('11/11/2026'), null); assert.equal(parseDay(null), null);
  assert.equal(longDate('2026-10-12'), '12 de outubro de 2026'); assert.equal(fullDate('2026-11-11'), 'quarta-feira, 11 de novembro de 2026'); assert.equal(longDate('lixo'), '');
});

test('contrato: normalizeActivity valida o formato e descarta o que não é número ou dia real', () => {
  const n = normalizeActivity(raw());
  assert.equal(n.providers.length, 2); assert.equal(n.sinceDay, '2026-10-05'); assert.equal(n.scanning, false); assert.equal(n.providers[1].accounts, 2);
  assert.deepEqual(normalizeActivity({ providers: [] }).providers, [], 'sem dados = providers vazio (não é erro)');
  for (const bad of [null, undefined, 'x', 42, [], {}, { providers: 'a' }, '<!doctype html>']) assert.equal(normalizeActivity(bad), null, `resposta fora do contrato: ${JSON.stringify(bad)}`);
  const dirty = normalizeActivity({ scanning: true, sinceDay: 'amanhã', providers: [null, { id: '', days: {} }, { id: 'x', days: 'a' }, { id: 'grok', label: '  Grok  ', accounts: -3, days: { '2026-11-11': { io: -5, cache: 'x' }, 'ontem': { io: 9 }, '2026-11-10': { io: 12.6, cache: 0 }, '2026-11-09': null } }] });
  assert.equal(dirty.scanning, true); assert.equal(dirty.sinceDay, null); assert.equal(dirty.providers.length, 1);
  assert.deepEqual(dirty.providers[0], { id: 'grok', label: 'Grok', accounts: 0, days: { '2026-11-10': { io: 13, cache: 0 } } }, 'só dias válidos com consumo; valores inválidos viram 0');
});

test('provider: nome e cor do catálogo (claude #e8603a, codex #3fe0bd); desconhecido usa o nome do servidor e uma cor neutra', () => {
  assert.deepEqual(providerLook({ id: 'claude', label: 'Outro' }), { id: 'claude', label: 'Claude', color: '#e8603a' }); assert.equal(providerLook({ id: 'codex' }).color, '#3fe0bd');
  const x = providerLook({ id: 'novo', label: 'Novo' }); assert.equal(x.label, 'Novo'); assert.match(x.color, /^#[0-9a-f]{6}$/); assert.equal(providerLook({ id: 'sem-nome', label: null }).label, 'sem-nome');
});

test('janela: 30/90 dias terminam hoje; "desde o início" começa no primeiro consumo (ou no sinceDay do servidor)', () => {
  const a = normalizeActivity(raw());
  assert.deepEqual(windowOf(a, 30, NOW), { start: '2026-10-13', end: '2026-11-11' }); assert.deepEqual(windowOf(a, 90, NOW), { start: '2026-08-14', end: '2026-11-11' });
  assert.deepEqual(windowOf(a, 0, NOW), { start: '2026-10-05', end: '2026-11-11' });
  assert.equal(firstDay({ providers: [], sinceDay: '2026-09-01' }, '2026-11-11'), '2026-09-01'); assert.equal(firstDay({ providers: [], sinceDay: null }, '2026-11-11'), '2026-11-11'); assert.equal(firstDay(null, '2026-11-11'), '2026-11-11');
  assert.equal(PERIODS.map((p) => p.days).join(), '30,90,0'); assert.equal(periodById('xyz').days, 30); assert.equal(modeById('weekly').noun, 'semana'); assert.equal(modeById('?').id, 'daily'); assert.equal(MODES.length, 3);
});

test('totais por provider: entrada+saída por padrão, cache só quando somado; ordem por consumo; fora da janela não conta', () => {
  const a = normalizeActivity(raw()), win = windowOf(a, 30, NOW);
  const t = providerTotals(a, win, false); assert.deepEqual(t.map((x) => [x.id, x.total]), [['claude', 8_400_000], ['codex', 3_000_000]], '05/10 fica fora dos 30 dias');
  const c = providerTotals(a, win, true); assert.deepEqual(c.map((x) => [x.id, x.total]), [['claude', 8_400_000 + 31_000_000], ['codex', 3_500_000]]);
  assert.equal(providerTotals(a, windowOf(a, 0, NOW), false)[0].total, 17_400_000, 'desde o início inclui o dia 05/10');
  assert.deepEqual(providerTotals({ providers: [] }, win), []); assert.deepEqual(providerTotals(null, win), []);
  assert.equal(providerTotals({ providers: [{ id: 'a', label: 'A', days: { '2020-01-01': { io: 5, cache: 0 } } }] }, win).length, 0, 'provider só com consumo antigo não aparece na janela');
});

test('maior dia: soma dos providers no dia, com ou sem cache', () => {
  const a = normalizeActivity(raw()), win = windowOf(a, 30, NOW);
  assert.deepEqual(peakDay(a, win, false), { day: '2026-11-10', total: 5_000_000 }, 'dia 09 (só Claude) e dia 10 (3+2) empatam em 5 mi: o mais recente vence');
  assert.deepEqual(peakDay(a, win, true), { day: '2026-11-09', total: 25_000_000 }); assert.equal(peakDay({ providers: [] }, win), null);
});

test('séries diárias: um bucket por dia da janela (dias sem consumo vazios), valores empilhados por provider e total', () => {
  const a = normalizeActivity(raw()), win = windowOf(a, 30, NOW), s = buildSeries(a, { win, mode: 'daily' });
  assert.equal(s.buckets.length, 30); assert.deepEqual(s.ids, ['claude', 'codex']); assert.equal(s.buckets[0].key, '2026-10-13'); assert.equal(s.buckets.at(-1).key, '2026-11-11');
  const d10 = s.buckets.find((b) => b.key === '2026-11-10'); assert.deepEqual(d10.values, { claude: 3_000_000, codex: 2_000_000 }); assert.equal(d10.total, 5_000_000);
  assert.equal(s.buckets[0].total, 0); assert.equal(s.max, 5_000_000);
  const withCache = buildSeries(a, { win, mode: 'daily', withCache: true }); assert.equal(withCache.buckets.find((b) => b.key === '2026-11-10').values.claude, 13_000_000);
});

test('séries semanais: semanas de segunda a domingo; as pontas da janela ficam parciais e a soma bate com o total', () => {
  const a = normalizeActivity(raw()), win = windowOf(a, 30, NOW), s = buildSeries(a, { win, mode: 'weekly' });
  assert.equal(s.buckets[0].start, '2026-10-13', 'a primeira semana começa no primeiro dia da janela (parcial)'); assert.equal(s.buckets[0].end, '2026-10-18', '13/10 é terça: vai até o domingo 18');
  assert.equal(s.buckets.at(-1).end, '2026-11-11'); assert.equal(s.buckets.at(-1).start, '2026-11-09'); assert.equal(s.buckets.at(-1).total, 11_400_000);
  assert.equal(s.buckets.reduce((x, b) => x + b.total, 0), 11_400_000); assert.match(s.buckets.at(-1).label, /^9 nov\. a 11 nov\.$/);
  assert.equal(buildSeries(a, { win: { start: '2026-11-09', end: '2026-11-09' }, mode: 'weekly' }).buckets[0].label, 'segunda-feira, 9 de novembro de 2026', 'semana de um dia só: data por extenso');
});

test('séries acumuladas: cada barra é o total desde o início da janela e nunca diminui', () => {
  const a = normalizeActivity(raw()), win = windowOf(a, 30, NOW), s = buildSeries(a, { win, mode: 'cumulative' });
  let prev = 0; for (const b of s.buckets) { assert.ok(b.total >= prev, 'monótona'); prev = b.total; }
  assert.equal(s.buckets.at(-1).total, 11_400_000); assert.deepEqual(s.buckets.at(-1).values, { claude: 8_400_000, codex: 3_000_000 }); assert.equal(s.max, 11_400_000);
});

test('séries sem dados: sem providers não há barras com valor (max 0), nada inventado', () => {
  const s = buildSeries({ providers: [] }, { win: windowOf(null, 30, NOW), mode: 'daily' }); assert.equal(s.max, 0); assert.equal(s.ids.length, 0); assert.ok(s.buckets.every((b) => b.total === 0));
  assert.equal(buildSeries(null, { win: { start: '2026-11-11', end: '2026-11-11' } }).buckets.length, 1);
});

test('eixo: o mês no primeiro bucket e em cada virada; janeiro e janelas de mais de um ano levam o ano', () => {
  const a = normalizeActivity(raw()), s = buildSeries(a, { win: windowOf(a, 30, NOW), mode: 'daily' });
  assert.deepEqual(axisTicks(s.buckets), [{ index: 0, label: 'out.' }, { index: 19, label: 'nov.' }]); assert.deepEqual(axisTicks([]), []);
  const long = buildSeries({ providers: [{ id: 'claude', label: 'Claude', accounts: 1, days: { '2026-12-20': { io: 1, cache: 0 } } }] }, { win: { start: '2026-12-20', end: '2027-02-10' }, mode: 'daily' });
  assert.deepEqual(axisTicks(long.buckets).map((t) => t.label), ['dez. 2026', 'jan. 2027', 'fev.']);
  assert.equal(totalCaption(false), 'tokens (entrada e saída)'); assert.equal(totalCaption(true), 'tokens (entrada, saída e cache)');
});

test('"há X": agora, minutos, horas, ontem, dias, semanas, meses e anos', () => {
  const now = NOW.getTime(), ago = (ms) => agoLabel(new Date(now - ms).toISOString(), now), m = 60_000, h = 60 * m, d = 24 * h;
  assert.equal(ago(10_000), 'agora'); assert.equal(ago(39 * m), 'há 39 min'); assert.equal(ago(1 * h + m), 'há 1 h'); assert.equal(ago(5 * h), 'há 5 h');
  assert.equal(agoLabel(iso(2026, 11, 10, 8), now), 'ontem'); assert.equal(agoLabel(iso(2026, 11, 8, 8), now), 'há 3 dias'); assert.equal(agoLabel(iso(2026, 11, 1, 9), now), 'há 1 sem'); assert.equal(agoLabel(iso(2026, 9, 1, 9), now), 'há 2 meses');
  assert.equal(agoLabel(iso(2025, 9, 1, 9), now), 'há 1 ano'); assert.equal(agoLabel('lixo', now), ''); assert.equal(agoLabel(new Date(now + 5 * m).toISOString(), now), 'agora', 'relógio adiantado não vira texto estranho');
});

const WS = [
  { id: 'w1', name: 'app-a', path: 'C:\\code\\app-a', createdAt: iso(2026, 1, 1) },
  { id: 'w2', name: 'app-b', path: 'C:\\code\\app-b', createdAt: iso(2026, 2, 1) },
  { id: 'w3', name: 'Ação Útil', displayName: 'Ação Útil', path: 'D:\\x\\acao', createdAt: iso(2026, 3, 1) },
];

test('último uso do workspace: o instante mais recente entre atividade, terminais, missões e tópicos; sem nada, o cadastro', () => {
  const last = lastUsedMap({
    workspaces: WS,
    activity: [{ at: iso(2026, 11, 11, 15, 0), workspaceId: 'w1', type: 'workspace' }, { at: iso(2026, 11, 11, 15, 29), message: 'sem workspace' }, { at: iso(2026, 11, 5), workspaceId: 'desconhecido' }],
    sessions: [{ workspaceId: 'w2', startedAt: iso(2026, 11, 11, 10), lastOutputAt: iso(2026, 11, 11, 14, 50), endedAt: null }],
    missions: [{ workspaceId: 'w1', createdAt: iso(2026, 11, 1) }], topics: [{ workspaceId: 'w3', createdAt: iso(2026, 10, 1) }],
  });
  assert.equal(last.get('w1'), Date.parse(iso(2026, 11, 11, 15, 0))); assert.equal(last.get('w2'), Date.parse(iso(2026, 11, 11, 14, 50))); assert.equal(last.get('w3'), Date.parse(iso(2026, 10, 1)));
  assert.equal(last.size, 3, 'workspace desconhecido não entra'); assert.equal(lastUsedMap({ workspaces: WS }).get('w2'), Date.parse(iso(2026, 2, 1)));
});

test('recentes: do mais recente ao mais antigo, com "há X"; busca por nome ou pasta sem acento nem caixa', () => {
  const base = { workspaces: WS, activity: [{ at: iso(2026, 11, 11, 15, 0), workspaceId: 'w2' }, { at: iso(2026, 11, 10, 9, 0), workspaceId: 'w1' }], now: NOW.getTime() };
  const r = recentWorkspaces(base); assert.deepEqual(r.map((x) => x.id), ['w2', 'w1', 'w3']); assert.equal(r[0].ago, 'há 30 min'); assert.equal(r[1].ago, 'ontem'); assert.equal(r[0].name, 'app-b');
  assert.deepEqual(recentWorkspaces({ ...base, query: 'ACAO' }).map((x) => x.id), ['w3'], 'sem acento e sem caixa'); assert.deepEqual(recentWorkspaces({ ...base, query: 'code\\app-a' }).map((x) => x.id), ['w1'], 'também pela pasta');
  assert.deepEqual(recentWorkspaces({ ...base, query: 'zzz' }), []); assert.deepEqual(recentWorkspaces({}), []);
  const tie = recentWorkspaces({ workspaces: [{ id: 'b', name: 'zeta', path: 'p', createdAt: iso(2026, 1, 1) }, { id: 'a', name: 'alfa', path: 'q', createdAt: iso(2026, 1, 1) }] }); assert.deepEqual(tie.map((x) => x.id), ['a', 'b'], 'empate: ordem alfabética');
});

test('CONTINUAR: o workspace mais recente, o tópico (ativo, senão o mais novo) e a missão mais recente dele; sem workspace, nada', () => {
  const base = { workspaces: WS, activity: [{ at: iso(2026, 11, 11, 15, 0), workspaceId: 'w2' }], now: NOW.getTime() };
  assert.deepEqual(continueTarget(base), { workspaceId: 'w2', parts: ['app-b'] }, 'sem tópico nem missão: só o workspace');
  const topics = [{ id: 't1', workspaceId: 'w2', title: 'Entrega', createdAt: iso(2026, 11, 1) }, { id: 't2', workspaceId: 'w2', title: 'Corrigir   bug', createdAt: iso(2026, 11, 5) }, { id: 't3', workspaceId: 'w2', title: 'Velho', createdAt: iso(2026, 11, 9), archived: true }, { id: 't4', workspaceId: 'w1', title: 'Outro', createdAt: iso(2026, 11, 9) }];
  const missions = [{ workspaceId: 'w2', title: 'Missão velha', createdAt: iso(2026, 11, 2) }, { workspaceId: 'w2', title: 'Testar no Linux', createdAt: iso(2026, 11, 8) }, { workspaceId: 'w1', title: 'De outro', createdAt: iso(2026, 11, 10) }];
  assert.deepEqual(continueTarget({ ...base, topics, missions }).parts, ['app-b', 'Corrigir bug', 'Testar no Linux'], 'tópico mais novo não arquivado, espaços colapsados, missão mais recente do próprio workspace');
  assert.equal(continueTarget({ ...base, topics, missions, activeTopicIds: { w2: 't1' } }).parts[1], 'Entrega', 'o tópico ativo vence');
  assert.equal(continueTarget({ workspaces: [] }), null); assert.equal(continueTarget({}), null);
});

test('integração: Início é a página de abertura, o Cockpit segue sempre montado e a Topbar tem o ícone de casa antes de Missions', () => {
  const app = src('App.jsx'), tb = src('components/Topbar.jsx'), home = src('pages/Home.jsx'), hook = src('use-provider-activity.js');
  assert.match(app, /import Home from '\.\/pages\/Home\.jsx'/); assert.match(app, /: 'home'\)\)/, 'padrão: Início'); assert.match(app, /view === 'home' && <Home /); assert.match(app, /onOpenWorkspace=\{openCockpit\}/);
  assert.match(app, /<div className="oc-view" hidden=\{view !== 'cockpit'\}><Cockpit /); assert.match(app, /#\/cockpit/); assert.match(app, /backTo = useRef\(view === 'settings' \? 'home' : view\)/);
  assert.ok(!/view === 'cockpit' \? 'cockpit' : view/.test(app));
  assert.match(tb, /aria-label="Início"/); assert.match(tb, /onClick=\{\(\) => onView\('home'\)\}/); assert.ok(tb.indexOf("onView('home')") < tb.indexOf('name="briefcase"'), 'a casa fica à esquerda de Missions');
  assert.match(src('main.jsx'), /import '\.\/home\.css'/); assert.match(hook, /\/api\/provider-activity\?days=\$\{days\}/); assert.match(hook, /document\.hidden/, 'só consulta com a aba visível'); assert.match(hook, /intervalMs = 5000/);
  assert.match(home, /Nenhum consumo encontrado nas contas conectadas/); assert.match(home, /lendo o histórico das contas/); assert.match(home, /somar o cache/); assert.match(home, /role="switch"/); assert.match(home, /aria-pressed=\{value === it\.id\}/);
  assert.ok(!/Math\.random|SSH/.test(home + src('home-view.js')), 'nada simulado e sem Servidores SSH (não existe no FORGE)');
});

test('integração: escolher ou criar um workspace no diálogo aberto no Início segue para o Cockpit, mesmo se for o já ativo', () => {
  const app = src('App.jsx'), dlg = src('components/WorkspaceDialog.jsx');
  assert.match(app, /<WorkspaceDialog onClose=\{closeDialog\} onPicked=\{view === 'home' \? \(\) => goView\('cockpit'\) : undefined\}/, 'só no Início o diálogo recebe onPicked');
  assert.match(dlg, /onClose\(\); onPicked\?\.\(\); \};/, 'escolher um workspace avisa onPicked'); assert.match(dlg, /aberto\.`\); onClose\(\); onPicked\?\.\(\);/, 'criar um workspace avisa onPicked');
  assert.ok(!/fromHome/.test(app), 'sem comparação de ids (falhava com o workspace já ativo)');
});

test('normalizeActivity: `partial` (listagem incompleta no servidor) conta como leitura em andamento, para a tela não afirmar "sem dados"', () => {
  const base = { generatedAt: '2026-11-11T12:00:00.000Z', sinceDay: null, providers: [] };
  assert.equal(normalizeActivity({ ...base, partial: true }).scanning, true);
  assert.equal(normalizeActivity({ ...base, scanning: true }).scanning, true);
  assert.equal(normalizeActivity({ ...base }).scanning, false);
});
