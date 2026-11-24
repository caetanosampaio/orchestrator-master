// Limite das contas que NÃO zera: a última leitura boa da API fica em disco (reabrir o app mantém as barras) e continua valendo quando o provedor limita (429), o login vence ou a rede cai;
// a status line (que só atualiza quando o terminal renderiza) e a API são mescladas pela medida mais recente. Tudo com API FALSA e pastas TEMPORÁRIAS: nenhuma credencial, rede, ~/.claude, data/ ou 4317 é tocado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-limits-persist-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const RL = await import('../rate-limits.js');
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const T0 = Date.parse('2026-11-10T12:00:00.000Z'), iso = (ms) => new Date(ms).toISOString();
let n = 0; const mk = () => { const d = path.join(root, `d${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const flush = () => new Promise((r) => setTimeout(r, 25));
const SID = '00000000-0000-4000-8000-0000000000aa';
// Modelo v2: a conta do computador é uma linha comum ('acc_…', home 'machine'); o last-known guarda chaves '<provider>:acc_…' e traduz as legadas (`claude:system`, `codex`) pelas contas do computador de db.accountsModel.machineIds.
const M = 'acc_11111111', CX = 'acc_33333333', A = 'acc_aaaaaaaa', B = 'acc_bbbbbbbb';
const M_ROW = { id: M, provider: 'claude', label: 'Claude Code', home: 'machine' }, CX_ROW = { id: CX, provider: 'codex', label: 'Codex CLI', home: 'machine' };
const modelOf = (machineIds = { claude: M }) => ({ v: 2, machineIds });
const lk = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'last-known.json'), 'utf8'));
const e = (pct, over = {}) => ({ okAt: T0, planType: 'pro', session: { usedPct: pct, resetsAt: iso(T0 + 3600_000), windowMinutes: 300 }, week: null, ...over });
const ok = (five, seven) => ({ ok: true, planType: 'pro', session: { usedPct: five, resetsAt: iso(T0 + 3600_000), windowMinutes: 300 }, week: { usedPct: seven, resetsAt: iso(T0 + 86400_000), windowMinutes: 10080 } });
const acc = (v, id = M, provider = 'claude') => v.providers.find((p) => p.provider === provider).accounts.find((a) => a.id === id);

function world({ dir = mk(), claude, codex = { ok: false, reason: 'sem-credencial' }, clock = { t: T0 }, sessions = [], list = [M_ROW], model = modelOf() } = {}) {
  const usageApi = { claude: async (id) => (typeof claude === 'function' ? claude(id) : claude), codex: async () => (typeof codex === 'function' ? codex() : codex) };
  const accounts = { list: () => list, configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) };
  const rl = RL.createRateLimits({ db: { terminalSessions: sessions, accounts: list, accountsModel: model }, accounts, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: mk() }), now: () => clock.t, memoMs: 0, connectedTtlMs: 0, usageApi, apiTtlMs: 30_000, codexReader: { read: () => null } });
  return { rl, dir, clock };
}
const hookFile = (dir, five, seven, atMs, sid = SID) => fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify({ at: iso(atMs), fiveHour: { usedPct: five, resetsAt: Math.floor((T0 + 3600_000) / 1000) }, sevenDay: { usedPct: seven, resetsAt: Math.floor((T0 + 86400_000) / 1000) } }));

test('reabrir o app: a última leitura da API volta do disco como `ultima-leitura`, sem zerar, mesmo com a API falhando', async () => {
  const w1 = world({ claude: ok(41, 63) }); w1.rl.view(); await flush(); assert.equal(acc(w1.rl.view()).source, 'api');
  const file = path.join(w1.dir, 'last-known.json'); assert.ok(fs.existsSync(file), 'a leitura foi gravada em disco');
  const txt = fs.readFileSync(file, 'utf8'); assert.ok(!/token|secret|segredo|Bearer|@/i.test(txt), 'só números de uso e plano, nada sensível');
  const clock = { t: T0 + 20 * 60_000 }; // "reabriu" 20 min depois; a API não responde
  const w2 = world({ dir: w1.dir, clock, claude: { ok: false, reason: 'token-expirado' } });
  const v = acc(w2.rl.view()); assert.equal(v.source, 'ultima-leitura'); assert.equal(v.session.usedPct, 41); assert.equal(v.week.usedPct, 63);
  assert.equal(v.updatedAt, iso(T0), 'diz de quando é a leitura, não finge que é de agora'); await flush(); assert.equal(acc(w2.rl.view()).session.usedPct, 41, 'a falha da consulta não apaga o valor');
});

test('429 / login vencido por horas: o valor conhecido continua (a janela só some quando o reset passa)', async () => {
  let mode = 'ok'; const w = world({ claude: () => (mode === 'ok' ? ok(10, 20) : { ok: false, reason: 'limitado' }) });
  w.rl.view(); await flush(); mode = 'fail'; w.clock.t += 31 * 60_000; w.rl.view(); await flush();
  const v = acc(w.rl.view()); assert.equal(v.source, 'ultima-leitura'); assert.equal(v.session.usedPct, 10);
  w.clock.t = T0 + 3600_000 + 1; const after5h = acc(w.rl.view()); assert.equal(after5h.session, null, 'a janela de 5 h venceu: nunca mostra o valor velho como atual'); assert.equal(after5h.week.usedPct, 20);
});

test('a leitura nova da API vence a gravada; sem valor novo, não regrava a cada consulta', async () => {
  let pct = 30; const w = world({ claude: () => ok(pct, 40) }); w.rl.view(); await flush();
  const file = path.join(w.dir, 'last-known.json'), m1 = fs.statSync(file).mtimeMs;
  w.clock.t += 31_000; w.rl.view(); await flush(); assert.equal(fs.statSync(file).mtimeMs, m1, 'mesmo valor em < 60 s: nada regravado');
  pct = 55; w.clock.t += 31_000; w.rl.view(); await flush(); assert.equal(acc(w.rl.view()).session.usedPct, 55); assert.match(fs.readFileSync(file, 'utf8'), /"usedPct": 55/);
});

test('status line e API se mesclam: a medida mais recente da MESMA janela vence (a API velha não esconde o terminal usado depois)', async () => {
  const dir = mk(); let mode = 'ok'; const sessions = [{ provider: 'claude', accountId: M, claudeSessionId: SID, state: 'running' }];
  const w = world({ dir, sessions, claude: () => (mode === 'ok' ? ok(10, 20) : { ok: false, reason: 'rede' }) });
  w.rl.view(); await flush(); assert.equal(acc(w.rl.view()).session.usedPct, 10);
  mode = 'fail'; w.clock.t += 10 * 60_000; hookFile(dir, 18, 25, w.clock.t - 1000); // o terminal gastou mais depois da última leitura da API
  const v = acc(w.rl.view()); assert.equal(v.source, 'statusline'); assert.equal(v.session.usedPct, 18); assert.equal(v.week.usedPct, 25);
});

test('mesma janela: vale o MAIOR uso (dentro da janela ele só cresce); o arquivo do hook com uso menor perde para a última leitura da API, mesmo sendo mais novo', async () => {
  const dir = mk(); const sessions = [{ provider: 'claude', accountId: M, claudeSessionId: SID, state: 'running' }]; let mode = 'ok';
  const w = world({ dir, sessions, claude: () => (mode === 'ok' ? ok(10, 20) : { ok: false, reason: 'rede' }) });
  w.rl.view(); await flush(); mode = 'fail'; w.clock.t += 10 * 60_000; hookFile(dir, 6, 8, w.clock.t - 1000);
  const v = acc(w.rl.view()); assert.equal(v.source, 'ultima-leitura'); assert.equal(v.session.usedPct, 10, 'nunca mostra menos do que já foi lido'); assert.equal(v.week.usedPct, 20);
});

test('leitura recente da API (< 5 min) manda mesmo que haja arquivo do hook', async () => {
  const dir = mk(); const sessions = [{ provider: 'claude', accountId: M, claudeSessionId: SID, state: 'running' }];
  hookFile(dir, 99, 99, T0 - 1000); const w = world({ dir, sessions, claude: ok(7, 8) }); w.rl.view(); await flush();
  const v = acc(w.rl.view()); assert.equal(v.source, 'api'); assert.equal(v.session.usedPct, 7);
});

test('arquivo gravado corrompido, enorme, do futuro ou com chaves estranhas é ignorado; a chave legada `claude:system` vira claude:<conta do computador> e o arquivo é regravado já traduzido', async () => {
  const dir = mk(), file = path.join(dir, 'last-known.json');
  const good = { okAt: T0, planType: 'pro', session: { usedPct: 5, resetsAt: iso(T0 + 3600_000), windowMinutes: 300 }, week: null };
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries: { 'claude:system': good, '../etc': good, 'claude:acc_aaaaaaaa': { ...good, okAt: T0 + 99 * 3600_000 }, 'claude:acc_bbbbbbbb': { ...good, session: { usedPct: 'x', resetsAt: 'y' } } } }));
  const w = world({ dir, claude: { ok: false, reason: 'rede' }, list: [M_ROW, { id: A, provider: 'claude', label: 'A' }, { id: B, provider: 'claude', label: 'B' }] });
  const v = w.rl.view(); assert.equal(acc(v).session.usedPct, 5, 'a leitura de `claude:system` chegou à conta do computador'); assert.equal(acc(v).source, 'ultima-leitura'); assert.equal(acc(v, A).source, 'sem-dados', 'okAt no futuro: lixo'); assert.equal(acc(v, B).source, 'sem-dados', 'janela inválida: lixo');
  const saved = lk(dir); assert.equal(saved.v, 2); assert.deepEqual(Object.keys(saved.entries), [`claude:${M}`], 'regravado traduzido: sem `claude:system`, sem lixo');
  fs.writeFileSync(file, 'x'.repeat(200_000)); assert.equal(acc(world({ dir, claude: { ok: false, reason: 'rede' } }).rl.view()).source, 'sem-dados', 'arquivo enorme não é lido');
  fs.writeFileSync(file, '{ nao é json'); assert.equal(acc(world({ dir, claude: { ok: false, reason: 'rede' } }).rl.view()).source, 'sem-dados');
});

test('a gravação preserva as leituras das contas que ainda existem e poda as removidas; lista de contas que falha não poda nada; o que veio do disco nunca é "api"', async () => {
  const dir = mk(), file = path.join(dir, 'last-known.json');
  // v1 legado + conta isolada removida: a do computador (traduzida) fica, a removida sai
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries: { 'claude:system': e(5), [`claude:${A}`]: e(9) } }));
  const one = world({ dir, claude: { ok: false, reason: 'rede' }, list: [M_ROW] }); one.rl.view(); await flush();
  let saved = lk(dir).entries; assert.equal(lk(dir).v, 2); assert.ok(saved[`claude:${M}`], 'a conta viva não é apagada (chave traduzida)'); assert.equal(saved[`claude:${A}`], undefined, 'a removida some'); assert.equal(saved['claude:system'], undefined);
  // nenhuma conta listada: as duas leituras saem
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries: { 'claude:system': e(5), [`claude:${A}`]: e(9) } }));
  const none = world({ dir, claude: { ok: false, reason: 'rede' }, list: [] }); none.rl.view(); await flush();
  saved = lk(dir).entries; assert.equal(saved[`claude:${M}`], undefined); assert.equal(saved[`claude:${A}`], undefined); assert.deepEqual(saved, {});
  // lista de contas que falha: nada é podado (as leituras ficam, já traduzidas)
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries: { 'claude:system': e(5), [`claude:${A}`]: e(9) } }));
  const usageApi = { claude: async () => ok(7, 8), codex: async () => ({ ok: false, reason: 'sem-credencial' }) }, accounts = { list: () => { throw new Error('x'); }, configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) };
  const rl = RL.createRateLimits({ db: { terminalSessions: [], accountsModel: modelOf() }, accounts, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: mk() }), now: () => T0 + 1000, memoMs: 0, usageApi, codexReader: { read: () => null } });
  assert.doesNotThrow(() => rl.view()); assert.deepEqual(rl.view().providers.map((p) => p.accounts), [[], []]); await flush();
  saved = lk(dir).entries; assert.ok(saved[`claude:${M}`] && saved[`claude:${A}`], 'falha ao listar contas não apaga nenhuma leitura gravada'); assert.equal(saved['claude:system'], undefined);
  // o que veio do disco vale como `ultima-leitura`, nunca "api", mesmo recente; só a 1ª consulta boa promove
  fs.writeFileSync(file, JSON.stringify({ v: 2, entries: { [`claude:${M}`]: e(5), [`claude:${A}`]: e(9) } }));
  const w = world({ dir, claude: (id) => (id === M ? ok(7, 8) : { ok: false, reason: 'rede' }), clock: { t: T0 + 1000 }, list: [M_ROW, { id: A, provider: 'claude', label: 'A' }] });
  assert.equal(acc(w.rl.view()).source, 'ultima-leitura', 'o que veio do disco nunca é "api", mesmo recente'); await flush(); assert.equal(acc(w.rl.view()).source, 'api', 'depois da 1a consulta boa vale a leitura nova');
  assert.equal(lk(dir).entries[`claude:${M}`].session.usedPct, 7); assert.equal(lk(dir).entries[`claude:${A}`].session.usedPct, 9, 'a leitura da outra conta (cuja consulta falhou) é preservada');
});

test('chave legada `codex` do last-known vira codex:<conta do computador do Codex> quando accountsModel.machineIds.codex existe; sem ela fica PRESERVADA no arquivo (não atribuída a ninguém), sem lançar', async () => {
  const dir = mk(), file = path.join(dir, 'last-known.json'), legacy = () => fs.writeFileSync(file, JSON.stringify({ v: 1, entries: { codex: e(31, { planType: 'plus' }), 'claude:system': e(5) } }));
  legacy();
  const w = world({ dir, claude: { ok: false, reason: 'rede' }, codex: { ok: false, reason: 'sem-credencial' }, list: [M_ROW, CX_ROW], model: modelOf({ claude: M, codex: CX }) });
  const v = w.rl.view(); assert.deepEqual([acc(v, CX, 'codex').source, acc(v, CX, 'codex').session.usedPct, acc(v, M).session.usedPct], ['ultima-leitura', 31, 5]);
  const saved = lk(dir); assert.equal(saved.v, 2); assert.deepEqual(Object.keys(saved.entries).sort(), [`claude:${M}`, `codex:${CX}`].sort(), 'regravado: `codex` -> codex:<id>, `claude:system` -> claude:<id>');
  // sem a conta do computador do Codex no modelo: a chave legada `codex` não tem para onde ir; não é atribuída a ninguém, mas a última leitura boa NÃO se perde (fica no arquivo até a migração gravar)
  legacy(); const orig = JSON.parse(fs.readFileSync(file, 'utf8')).entries.codex;
  const w2 = world({ dir, claude: { ok: false, reason: 'rede' }, list: [M_ROW, CX_ROW], model: modelOf({ claude: M }) });
  let v2; assert.doesNotThrow(() => { v2 = w2.rl.view(); });
  assert.equal(acc(v2, CX, 'codex').source, 'sem-dados', 'sem tradução, a leitura antiga do Codex não é atribuída a ninguém'); assert.equal(acc(v2, M).session.usedPct, 5);
  assert.deepEqual(Object.keys(lk(dir).entries).sort(), [`claude:${M}`, 'codex'].sort(), 'claude:system traduzida; `codex` preservada como estava'); assert.equal(lk(dir).v, 2);
  assert.deepEqual(lk(dir).entries.codex, orig, 'a entrada preservada é exatamente a que estava no arquivo');
  // depois que a migração grava a conta do Codex, o boot seguinte traduz a leitura preservada
  const w2b = world({ dir, claude: { ok: false, reason: 'rede' }, codex: { ok: false, reason: 'sem-credencial' }, list: [M_ROW, CX_ROW], model: modelOf({ claude: M, codex: CX }) });
  assert.equal(acc(w2b.rl.view(), CX, 'codex').session.usedPct, 31, 'a leitura preservada volta para a conta certa');
  // sem nenhum accountsModel (banco ainda não migrado): nenhuma legada é atribuída, e o arquivo fica INTACTO (nada a traduzir, nada a perder), sem lançar
  legacy(); const raw = fs.readFileSync(file, 'utf8');
  const w3 = world({ dir, claude: { ok: false, reason: 'rede' }, list: [M_ROW, CX_ROW], model: null });
  assert.doesNotThrow(() => w3.rl.view()); assert.equal(acc(w3.rl.view(), CX, 'codex').source, 'sem-dados'); assert.equal(acc(w3.rl.view()).source, 'sem-dados'); assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('sweep remove o .tmp órfão do last-known e o gravador não segue link simbólico', (t) => {
  const dir = mk(); fs.writeFileSync(path.join(dir, 'last-known.json.abc123.tmp'), 'x'); fs.utimesSync(path.join(dir, 'last-known.json.abc123.tmp'), 1, 1);
  const rl = RL.createRateLimits({ db: { terminalSessions: [] }, dir, script: null, codexHome: mk(), env: () => ({}), now: () => Date.now(), memoMs: 0, codexReader: { read: () => null } });
  assert.equal(rl.sweep(), 1); assert.ok(!fs.existsSync(path.join(dir, 'last-known.json.abc123.tmp')));
  const alvo = path.join(dir, 'alvo.txt'), lnk = path.join(dir, 'link.json'); fs.writeFileSync(alvo, 'intacto');
  try { fs.symlinkSync(alvo, lnk); } catch { t.skip('sem permissão para symlink'); return; }
  RL.writeSettingsFile(lnk, { a: 1 }); assert.equal(fs.readFileSync(alvo, 'utf8'), 'intacto', 'o destino do link não é sobrescrito');
});

test('sem usageApi (testes, API desligada no boot): nada é lido nem gravado em disco', async () => {
  const dir = mk(), file = path.join(dir, 'last-known.json'), content = JSON.stringify({ v: 1, entries: { 'claude:system': e(5) } }); fs.writeFileSync(file, content);
  const accounts = { list: () => [M_ROW], configDirOf: () => null, statusOf: async () => ({ checked: true, loggedIn: true }) };
  const rl = RL.createRateLimits({ db: { terminalSessions: [], accountsModel: modelOf() }, accounts, dir, script: null, codexHome: mk(), env: () => ({ CLAUDE_CONFIG_DIR: mk() }), now: () => T0, memoMs: 0, codexReader: { read: () => null } });
  assert.equal(acc(rl.view()).source, 'sem-dados'); await flush(); rl.view(); assert.equal(fs.readFileSync(file, 'utf8'), content, 'o arquivo fica exatamente como estava (nem traduzido)');
});
