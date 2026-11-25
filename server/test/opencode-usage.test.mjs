// Tokens do OpenCode (server/opencode-usage.js) e a fonte extra do GET /api/provider-activity. Bancos SQLite criados em pastas TEMPORÁRIAS (nenhum ~/.local/share/opencode real é tocado).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ocusage-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { createOpenCodeUsage, splitByDays, openCodeDbFile } = await import('../opencode-usage.js');
const { createProviderActivity } = await import('../provider-activity.js');
const sqlite = process.getBuiltinModule?.('node:sqlite') ?? null;
const noSqlite = !sqlite && 'node:sqlite indisponível neste Node';

const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime(); // 25/nov/2026 12:00 local
const at = (daysAgo, h = 12) => new Date(2026, 10, 25 - daysAgo, h, 0, 0).getTime();
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let n = 0;
/** Banco com o esquema mínimo do OpenCode 2.3.0 (só as colunas que o leitor usa, mais `data`, que ele NUNCA deve ler). */
function makeDb({ sessions = [], messages = [] } = {}) {
  const file = path.join(tmp, `oc-${++n}.db`), db = new sqlite.DatabaseSync(file);
  db.exec('CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, time_updated INTEGER, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, title TEXT)');
  db.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)');
  const si = db.prepare('INSERT INTO session_v2 VALUES (?,?,?,?,?,?,?,?,?)'), mi = db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?)');
  for (const s of sessions) si.run(s.id, s.parent ?? null, s.updated ?? NOW, s.i ?? 0, s.o ?? 0, s.r ?? 0, s.cr ?? 0, s.cw ?? 0, 'TITULO-SECRETO');
  messages.forEach((m, i) => mi.run(`m${i}`, m.s, m.type ?? 'assistant', m.t, 'CONTEUDO-SECRETO-DA-CONVERSA'));
  db.close(); return file;
}
const usage = (file, extra = {}) => createOpenCodeUsage({ dbFile: file, now: () => NOW, minIntervalMs: 0, ...extra });
const total = (r) => [...r.days.values()].reduce((a, [io, c]) => [a[0] + io, a[1] + c], [0, 0]);

test('splitByDays: reparte em inteiros, proporcional às respostas de cada dia, com a sobra no último dia; a soma é SEMPRE o total', () => {
  assert.deepEqual([...splitByDays(100, new Map([['2026-11-16', 21], ['2026-11-17', 12]]))], [['2026-11-16', 63], ['2026-11-17', 37]]); // 63,63 + 36,36 = 99; sobra 1 no último
  assert.deepEqual([...splitByDays(7, new Map([['2026-11-17', 1], ['2026-11-16', 2]]))], [['2026-11-16', 4], ['2026-11-17', 3]], 'ordena pelas datas');
  assert.deepEqual([...splitByDays(0, new Map([['2026-11-16', 3]]))], [['2026-11-16', 0]]);
  assert.deepEqual([...splitByDays(5, new Map([['2026-11-16', 1]]))], [['2026-11-16', 5]], 'um dia só: tudo nele');
  for (const [t, ws] of [[999_999_999_999, [999_983, 7, 123_457]], [1e12, [500_000, 499_999]], [13, [1, 1, 1, 1, 1, 1, 1]]]) {
    const out = splitByDays(t, new Map(ws.map((w, i) => [`2026-11-${String(10 + i).padStart(2, '0')}`, w])));
    assert.equal([...out.values()].reduce((a, b) => a + b, 0), t, `soma exata para ${t} (sem perda por ponto flutuante)`); assert.ok([...out.values()].every((v) => Number.isSafeInteger(v) && v >= 0));
  }
  for (const bad of [new Map(), new Map([['2026-11-16', 0]]), new Map([['2026-11-16', -1]]), new Map([['2026-11-16', 1.5]])]) assert.equal(splitByDays(10, bad), null);
  assert.equal(splitByDays(-1, new Map([['d', 1]])), null); assert.equal(splitByDays(1.5, new Map([['d', 1]])), null);
});

test('caminho do banco: XDG_DATA_HOME absoluto, senão ~/.local/share (também no Windows, como o OpenCode grava)', () => {
  assert.equal(openCodeDbFile({}, path.join('H', 'u')), path.join('H', 'u', '.local', 'share', 'opencode', 'opencode.db'));
  const abs = path.join(tmp, 'xdg'); assert.equal(openCodeDbFile({ XDG_DATA_HOME: abs }, 'H'), path.join(abs, 'opencode', 'opencode.db'));
  assert.equal(openCodeDbFile({ XDG_DATA_HOME: 'relativo' }, 'H'), path.join('H', '.local', 'share', 'opencode', 'opencode.db'), 'caminho relativo é ignorado');
});

test('OpenCode: o total da sessão é repartido pelos dias das respostas; io = entrada + saída + raciocínio, cache = leitura + escrita; a soma é exata', { skip: noSqlite }, () => {
  const file = makeDb({
    sessions: [
      { id: 'ses_dois_dias', i: 1000, o: 100, r: 50, cr: 10_000, cw: 5, updated: at(0) },
      { id: 'ses_um_dia', i: 300, o: 20, r: 0, cr: 0, cw: 0, updated: at(2) },
    ],
    messages: [
      ...[1, 2, 3].map((k) => ({ s: 'ses_dois_dias', t: at(1, 9 + k) })), { s: 'ses_dois_dias', t: at(0, 10) }, // 3 respostas ontem, 1 hoje
      { s: 'ses_dois_dias', t: at(0, 11), type: 'user' }, { s: 'ses_dois_dias', t: at(5), type: 'idle' }, // só respostas do assistente contam
      { s: 'ses_um_dia', t: at(2) },
    ],
  });
  const r = usage(file).read(), ontem = dayOf(at(1)), hoje = dayOf(at(0)), anteontem = dayOf(at(2));
  assert.deepEqual([...r.days.keys()].sort(), [anteontem, ontem, hoje].sort());
  assert.deepEqual(r.days.get(anteontem), [320, 0], 'sessão de um dia: exata');
  assert.deepEqual(r.days.get(ontem), [862, 7500 + 3], 'ontem: 3 de 4 respostas (1150 * 3/4 = 862, sobra no último dia)'); // 1150 = 1000+100+50; cache 10005
  assert.deepEqual(r.days.get(hoje), [288, 2502], 'hoje: 1 de 4 respostas + a sobra');
  assert.deepEqual(total(r), [1150 + 320, 10_005], 'a soma de todos os dias é exatamente a soma das sessões'); assert.equal(r.accounts, 1);
});

test('OpenCode: sessão sem resposta datada vai para o dia da última atividade; sessões-filhas contam; valores impossíveis viram 0; sessão sem consumo ou com data absurda é ignorada', { skip: noSqlite }, () => {
  const file = makeDb({
    sessions: [
      { id: 'sem_respostas', i: 50, updated: at(3) }, { id: 'filha', parent: 'sem_respostas', i: 7, o: 3, updated: at(3) },
      { id: 'hostil', i: -5, o: 1e15, r: 'texto', cr: 3.5, cw: null, updated: at(1) }, // tudo inválido: 0
      { id: 'zerada', updated: at(1) }, { id: 'sem_data', i: 99, updated: -1 }, { id: 'futuro', i: 99, updated: at(0) + 10 * 86_400_000 },
    ],
  });
  const r = usage(file).read();
  assert.deepEqual([...r.days], [[dayOf(at(3)), [60, 0]]], 'pai (50) + filha (10) no dia da última atividade; o resto some');
});

test('OpenCode: sem o arquivo, link no lugar dele, banco corrompido ou sem as tabelas = null (nunca lança nem inventa valor)', { skip: noSqlite }, () => {
  assert.equal(usage(path.join(tmp, 'nao-existe.db')).read(), null);
  const lixo = path.join(tmp, 'lixo.db'); fs.writeFileSync(lixo, 'isto não é um banco SQLite'.repeat(50)); assert.equal(usage(lixo).read(), null);
  const vazio = path.join(tmp, 'vazio.db'); new sqlite.DatabaseSync(vazio).close(); assert.equal(usage(vazio).read(), null, 'esquema que mudou (sem session_v2): null');
  const pasta = path.join(tmp, 'pasta.db'); fs.mkdirSync(pasta); assert.equal(usage(pasta).read(), null, 'pasta no lugar do banco');
  assert.equal(usage(makeDb({ sessions: [{ id: 's', i: 5 }] }), { sqlite: null }).read(), null, 'sem node:sqlite (Node antigo): a fonte some em vez de quebrar');
});

test('OpenCode: o banco só é lido de novo quando ele muda e no máximo a cada minIntervalMs; consultas só em colunas numéricas de session_v2 e nas datas de session_message (nunca conteúdo nem contas)', { skip: noSqlite }, () => {
  const file = makeDb({ sessions: [{ id: 's1', i: 100, updated: at(0) }], messages: [{ s: 's1', t: at(0) }] });
  const sqls = []; let opens = 0, ro = null;
  const spy = { DatabaseSync: class { constructor(f, opts) { opens++; ro = opts?.readOnly; this.inner = new sqlite.DatabaseSync(f, opts); } prepare(sql) { sqls.push(sql); return this.inner.prepare(sql); } close() { this.inner.close(); } } };
  let now = NOW; const src = createOpenCodeUsage({ dbFile: file, now: () => now, minIntervalMs: 10_000, sqlite: spy });
  const a = src.read(); assert.equal(opens, 1); assert.equal(ro, true, 'aberto SOMENTE para leitura');
  assert.equal(src.read(), a); assert.equal(opens, 1, 'dentro do intervalo: nada é relido');
  now += 20_000; assert.equal(src.read(), a); assert.equal(opens, 1, 'passou o intervalo mas o banco não mudou: nada é relido');
  const db = new sqlite.DatabaseSync(file); db.prepare('UPDATE session_v2 SET tokens_input = 500').run(); db.close(); // o OpenCode gravou mais
  const future = new Date(Date.now() + 5000); fs.utimesSync(file, future, future); now += 20_000;
  const b = src.read(); assert.equal(opens, 2, 'o banco mudou: relido'); assert.deepEqual(total(b), [500, 0]);
  const all = sqls.join(' ').toLowerCase();
  for (const forbidden of ['account', 'credential', 'session_part', 'blob', 'event', 'instruction', 'kv', 'title', 'summary', 'select *']) assert.ok(!all.includes(forbidden), `não consulta ${forbidden}`);
  assert.ok(!/\bdata\b/.test(all), 'nunca seleciona a coluna `data` (conteúdo das mensagens)'); assert.ok(all.includes('session_v2') && all.includes('session_message'));
});

test('provider-activity: fontes extras entram no mesmo formato e nos mesmos cortes de janela; falha, vazio, id repetido ou de Claude/Codex são ignorados', () => {
  const days = new Map([[dayOf(at(1)), [100, 900]], [dayOf(at(40)), [7, 0]], [dayOf(at(2)), [0, 0]]]);
  const act = (extraSources) => createProviderActivity({ claudeDirs: () => [], codexHome: () => path.join(tmp, 'sem-codex'), extraSources, now: () => NOW, listTtlMs: 0 });
  const ok = { id: 'opencode', label: 'OpenCode', read: () => ({ days, accounts: 1 }) };
  const v30 = act([ok]).view({ days: 30 });
  assert.deepEqual(v30.providers, [{ id: 'opencode', label: 'OpenCode', accounts: 1, days: { [dayOf(at(1))]: { io: 100, cache: 900 } } }], 'janela de 30 dias corta o dia de há 40; dia zerado some');
  assert.equal(v30.sinceDay, dayOf(at(1)));
  assert.deepEqual(Object.keys(act([ok]).view({ days: 0 }).providers[0].days).sort(), [dayOf(at(40)), dayOf(at(1))].sort(), 'days=0: tudo');
  const lixo = [{ id: 'quebra', label: 'Q', read: () => { throw new Error('x'); } }, { id: 'vazio', read: () => ({ days: new Map() }) }, { id: 'nulo', read: () => null }, { id: 'claude', read: () => ({ days }) }, { id: 'codex', read: () => ({ days }) }, { id: 'ruim', read: () => ({ days: { nao: 'um Map' } }) }, null, { read: () => ({ days }) }];
  assert.deepEqual(act([...lixo, ok, { ...ok, label: 'Duplicado' }]).view({ days: 0 }).providers.map((p) => `${p.id}:${p.label}`), ['opencode:OpenCode'], 'só a fonte válida e a primeira de cada id; Claude e Codex nunca são substituídos');
  assert.deepEqual(act([]).view({ days: 0 }).providers, [], 'sem fontes: como sempre');
  assert.equal(act([{ id: 'x', read: () => ({ days: new Map([[dayOf(at(1)), [1, 0]]]), accounts: 0 }) }]).view({ days: 0 }).providers[0].accounts, 1, 'accounts inválido vira 1');
});

test('OpenCode: falha passageira (banco travado) mantém o ÚLTIMO dado bom por algumas tentativas e só então some; arquivo que some = some na hora', { skip: noSqlite }, () => {
  const file = makeDb({ sessions: [{ id: 's1', i: 100, updated: at(0) }], messages: [{ s: 's1', t: at(0) }] });
  let broken = false;
  const flaky = { DatabaseSync: class { constructor(f, o) { if (broken) throw new Error('database is locked'); this.inner = new sqlite.DatabaseSync(f, o); } prepare(s) { return this.inner.prepare(s); } close() { this.inner.close(); } } };
  const bump = () => { const db = new sqlite.DatabaseSync(file); db.prepare('UPDATE session_v2 SET tokens_input = tokens_input + 1').run(); db.close(); const t = new Date(Date.now() + (bump.n = (bump.n ?? 0) + 1) * 5000); fs.utimesSync(file, t, t); };
  let clock = NOW; const tick = () => { clock += 60_000; }; // o relógio anda (o espaçamento entre leituras depende dele)
  const src = createOpenCodeUsage({ dbFile: file, now: () => clock, minIntervalMs: 0, sqlite: flaky, maxFailures: 3 });
  const good = src.read(); assert.deepEqual(total(good), [100, 0]);
  broken = true; bump(); tick(); assert.equal(src.read(), good, '1ª falha: continua o último dado bom (a série não pisca)');
  bump(); tick(); assert.equal(src.read(), good, '2ª falha: continua');
  bump(); tick(); assert.equal(src.read(), null, '3ª falha seguida: some (nunca dado velho para sempre)');
  broken = false; bump(); tick(); assert.deepEqual(total(src.read()), [104, 0], 'o banco voltou: lê de novo (100 + 4 gravações)');
  fs.rmSync(file); tick(); assert.equal(src.read(), null, 'arquivo sumiu: some na hora');
});

test('OpenCode: mudança SÓ no -wal (o .db fica igual, como no modo WAL) também dispara a releitura', { skip: noSqlite }, () => {
  const file = makeDb({ sessions: [{ id: 's1', i: 100, updated: at(0) }] });
  let opens = 0; const spy = { DatabaseSync: class { constructor(f, o) { opens++; this.inner = new sqlite.DatabaseSync(f, o); } prepare(s) { return this.inner.prepare(s); } close() { this.inner.close(); } } };
  let clock = NOW; const src = createOpenCodeUsage({ dbFile: file, now: () => clock, minIntervalMs: 0, sqlite: spy });
  src.read(); assert.equal(opens, 1); clock += 60_000; src.read(); assert.equal(opens, 1, 'nada mudou');
  fs.writeFileSync(`${file}-wal`, 'x'.repeat(100)); clock += 60_000; src.read(); assert.equal(opens, 2, 'apareceu um -wal: relê');
  fs.writeFileSync(`${file}-wal`, 'x'.repeat(200)); clock += 60_000; src.read(); assert.equal(opens, 3, 'o -wal cresceu: relê');
});

test('OpenCode: inteiros enormes (que o node:sqlite recusa) não derrubam a leitura; as respostas vêm AGRUPADAS por sessão e dia; leitura lenta espaça as próximas', { skip: noSqlite }, () => {
  const file = path.join(tmp, `oc-big-${++n}.db`), db = new sqlite.DatabaseSync(file);
  db.exec('CREATE TABLE session_v2 (id TEXT PRIMARY KEY, time_updated INTEGER, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write)');
  db.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)');
  db.exec(`INSERT INTO session_v2 VALUES ('ok', ${at(0)}, 100, 10, 0, 5, 0), ('gigante', ${at(0)}, 9223372036854775807, 9223372036854775807, 0, 0, 0), ('data_gigante', 9223372036854775807, 7, 0, 0, 0, 0)`);
  for (let i = 0; i < 300; i++) db.prepare("INSERT INTO session_message VALUES (?, 'ok', 'assistant', ?, 'x')").run(`m${i}`, at(0) + i); // 300 respostas no mesmo dia
  db.prepare("INSERT INTO session_message VALUES ('mg', 'ok', 'assistant', 9223372036854775807, 'x')").run();
  db.close();
  const sqls = []; const spy = { DatabaseSync: class { constructor(f, o) { this.inner = new sqlite.DatabaseSync(f, o); } prepare(s) { sqls.push(s); return this.inner.prepare(s); } close() { this.inner.close(); } } };
  const r = createOpenCodeUsage({ dbFile: file, now: () => NOW, minIntervalMs: 0, sqlite: spy }).read();
  assert.ok(r, 'não derrubou a leitura'); assert.deepEqual([...r.days], [[dayOf(at(0)), [110, 5]]], 'a sessão sã conta; os inteiros gigantes viram 0; a data absurda é descartada');
  assert.ok(sqls.some((s) => /GROUP BY session_id/i.test(s)), 'respostas agrupadas no SQL (não traz uma linha por mensagem)'); assert.ok(sqls.every((s) => /LIMIT/i.test(s) && /ORDER BY/i.test(s)), 'limites com ORDER BY (os mais recentes primeiro)');
  // leitura lenta: com minIntervalMs 0 o espaçamento vem do tempo que a leitura leva (10x)
  let t = NOW; let slowOpens = 0; const slow = { DatabaseSync: class { constructor(f, o) { slowOpens++; const t0 = performance.now(); while (performance.now() - t0 < 30) { /* leitura lenta simulada */ } this.inner = new sqlite.DatabaseSync(f, o); } prepare(s) { return this.inner.prepare(s); } close() { this.inner.close(); } } };
  const src = createOpenCodeUsage({ dbFile: file, now: () => t, minIntervalMs: 0, sqlite: slow });
  src.read(); assert.equal(slowOpens, 1); fs.writeFileSync(`${file}-wal`, 'x'); t += 100; src.read(); assert.equal(slowOpens, 1, '100 ms depois: ainda dentro de 10x o custo da leitura (>= 300 ms)');
  t += 500; src.read(); assert.equal(slowOpens, 2, 'passou o espaçamento e o banco mudou: relê');
});

test('provider-activity: o aviso "estimado" viaja do servidor ao cliente (providers[].estimated) e a Home lista só quem tem consumo na janela', async () => {
  const day = dayOf(at(1));
  const act = createProviderActivity({ claudeDirs: () => [], codexHome: () => path.join(tmp, 'sem-codex'), now: () => NOW, listTtlMs: 0,
    extraSources: [{ id: 'opencode', label: 'OpenCode', estimated: true, read: () => ({ days: new Map([[day, [10, 0]]]) }) }, { id: 'exato', label: 'Exato', read: () => ({ days: new Map([[day, [5, 0]]]) }) }] });
  const v = act.view({ days: 0 });
  assert.equal(v.providers.find((p) => p.id === 'opencode').estimated, true); assert.equal('estimated' in v.providers.find((p) => p.id === 'exato'), false, 'sem a marca, o campo nem existe (contrato aditivo)');
  const H = await import('../../client/src/home-view.js');
  const norm = H.normalizeActivity(JSON.parse(JSON.stringify(v)));
  assert.equal(norm.providers.find((p) => p.id === 'opencode').estimated, true); assert.equal('estimated' in norm.providers.find((p) => p.id === 'exato'), false);
  assert.deepEqual(H.estimatedLabels(norm, { start: day, end: day }), ['OpenCode']); assert.deepEqual(H.estimatedLabels(norm, { start: '2020-01-01', end: '2020-01-02' }), [], 'sem consumo na janela: sem aviso');
  assert.match(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', 'pages', 'Home.jsx'), 'utf8'), /estimatedLabels\(data, win\)/, 'a Home usa o aviso');
});
