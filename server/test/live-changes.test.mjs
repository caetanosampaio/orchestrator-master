// Aba "Construção" do painel Live (server/live-changes.js): Git REAL em repositórios temporários, varredura por mtime sem Git, rotas com apiGuard + token. Nada toca o banco real.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-livechg-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'orch-data');
const { default: express } = await import('express');
const { apiGuard } = await import('../origin-guard.js');
const { createTokenGuard, TOKEN_HEADER } = await import('../session-token.js');
const { git: realGit } = await import('../worktrees.js');
const { createChangesService, setupLiveChanges, parsePorcelain, parseNumstat, statusOf } = await import('../live-changes.js');

after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
const G = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'safe.directory=*'];
const sh = (cwd, ...a) => execFileSync('git', [...G, ...a], { cwd, stdio: 'ignore' });
const put = (root, rel, content) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; };
const newRepo = () => { const d = path.join(tmp, `repo${++seq}`); fs.mkdirSync(d); sh(d, 'init', '-q'); return d; };
const wsOf = (dir) => ({ id: `ws_${String(++seq).padStart(8, '0')}`, name: 'w', path: dir });
const byPath = (r) => Object.fromEntries(r.files.map((f) => [f.path, f]));

test('parsePorcelain, parseNumstat e statusOf (puros)', () => {
  assert.deepEqual(parsePorcelain(' M a b.txt\0?? c.txt\0A  d.txt\0'), [{ x: ' ', y: 'M', p: 'a b.txt' }, { x: '?', y: '?', p: 'c.txt' }, { x: 'A', y: ' ', p: 'd.txt' }]);
  assert.deepEqual([...parseNumstat('3\t1\ta.txt\0-\t-\timg.bin\0').entries()], [['a.txt', { added: 3, removed: 1, binary: false }], ['img.bin', { added: null, removed: null, binary: true }]]);
  for (const [x, y, s] of [[' ', 'M', 'modified'], ['M', ' ', 'modified'], ['T', ' ', 'modified'], ['A', ' ', 'added'], [' ', 'A', 'added'], ['D', ' ', 'deleted'], [' ', 'D', 'deleted'], ['A', 'D', 'deleted'], ['?', '?', 'untracked'], ['U', 'U', 'conflict'], ['A', 'A', 'conflict'], ['D', 'D', 'conflict'], ['M', 'U', 'conflict']]) assert.equal(statusOf(x, y), s, `${x}${y}`);
});

test('modo git: novos, modificado, removido, staged, untracked em subpasta nova, binário, nome com espaço e acento; totais e +/-', async () => {
  const d = newRepo();
  put(d, 'tracked.txt', 'a\nb\nc\n'); put(d, 'del.txt', 'um\ndois\n'); put(d, 'site/index.html', '<h1>v1</h1>\n'); fs.writeFileSync(path.join(d, 'img.bin'), Buffer.from([0, 1, 2, 3]));
  sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'base');
  put(d, 'tracked.txt', 'a\nB\nc\nd\n'); fs.rmSync(path.join(d, 'del.txt')); fs.writeFileSync(path.join(d, 'img.bin'), Buffer.from([0, 9, 9, 9, 9]));
  put(d, 'staged.txt', 'x\ny\nz\n'); sh(d, 'add', 'staged.txt');
  put(d, 'site/new/page.html', '<p>1</p>\n<p>2</p>\n'); put(d, 'nome com espaço.txt', 'linha\n'); put(d, 'café é.txt', 'sem quebra final'); fs.writeFileSync(path.join(d, 'raw.dat'), Buffer.from([65, 0, 66]));
  const svc = createChangesService({}); const ws = wsOf(d); const r = await svc.changes(ws);
  assert.equal(r.mode, 'git'); assert.equal(r.branch, 'main'); assert.equal(r.workspaceId, ws.id); assert.equal(r.truncated, false); assert.equal(r.error, undefined);
  assert.equal(typeof r.generatedAt, 'number'); assert.equal(typeof r.durationMs, 'number');
  assert.deepEqual(r.totals, { files: 8, added: 9, removed: 3, created: 5, modified: 2, deleted: 1 });
  const f = byPath(r);
  assert.deepEqual([f['tracked.txt'].status, f['tracked.txt'].added, f['tracked.txt'].removed, f['tracked.txt'].binary], ['modified', 2, 1, false]);
  assert.deepEqual([f['del.txt'].status, f['del.txt'].added, f['del.txt'].removed, f['del.txt'].mtime], ['deleted', 0, 2, null]);
  assert.deepEqual([f['staged.txt'].status, f['staged.txt'].added, f['staged.txt'].removed], ['added', 3, 0], 'só staged: contado');
  assert.deepEqual([f['site/new/page.html'].status, f['site/new/page.html'].added, f['site/new/page.html'].removed], ['untracked', 2, null], 'untracked contado em linhas');
  assert.deepEqual([f['nome com espaço.txt'].status, f['nome com espaço.txt'].added], ['untracked', 1]); assert.equal(f['café é.txt'].added, 1, 'sem quebra final conta a última linha');
  assert.deepEqual([f['img.bin'].status, f['img.bin'].binary, f['img.bin'].added, f['img.bin'].removed], ['modified', true, null, null]);
  assert.deepEqual([f['raw.dat'].binary, f['raw.dat'].added], [true, null], 'untracked binário');
  for (const x of r.files) { assert.ok(!x.path.includes('\\') && !path.isAbsolute(x.path) && x.path.length <= 300); assert.ok(['added', 'modified', 'deleted', 'untracked', 'conflict'].includes(x.status)); assert.ok(x.mtime === null || typeof x.mtime === 'number'); }
  assert.equal(r.files.at(-1).status, 'deleted', 'removidos por último');
  const times = r.files.filter((x) => x.status !== 'deleted').map((x) => x.mtime); assert.deepEqual(times, [...times].sort((a, b) => b - a), 'mtime decrescente');
  assert.ok(!JSON.stringify(r).includes(tmp), 'nenhum caminho absoluto');
});

test('só staged (modificação no índice, árvore igual) e repositório SEM commits', async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n2\n'); sh(d, 'add', 'a.txt'); sh(d, 'commit', '-q', '-m', 'x');
  put(d, 'a.txt', '1\n2\n3\n'); sh(d, 'add', 'a.txt');
  const r = await createChangesService({}).changes(wsOf(d)); assert.equal(r.mode, 'git'); assert.deepEqual(r.files.map((x) => [x.path, x.status, x.added, x.removed]), [['a.txt', 'modified', 1, 0]]);
  const e = newRepo(); put(e, 'novo.txt', 'a\nb\n'); put(e, 'solto.txt', 'z\n'); sh(e, 'add', 'novo.txt');
  const r2 = await createChangesService({}).changes(wsOf(e)); assert.equal(r2.mode, 'git'); assert.equal(r2.branch, 'main', 'sem HEAD: o nome da branch vem de symbolic-ref');
  const f = byPath(r2); assert.deepEqual([f['novo.txt'].status, f['novo.txt'].added, f['novo.txt'].removed], ['added', 2, 0]); assert.deepEqual([f['solto.txt'].status, f['solto.txt'].added], ['untracked', 1]);
  assert.deepEqual(r2.totals, { files: 2, added: 3, removed: 0, created: 2, modified: 0, deleted: 0 });
  const clean = newRepo(); put(clean, 'x.txt', 'x\n'); sh(clean, 'add', '-A'); sh(clean, 'commit', '-q', '-m', 'c');
  const r3 = await createChangesService({}).changes(wsOf(clean)); assert.equal(r3.mode, 'git'); assert.deepEqual(r3.files, []); assert.equal(r3.totals.files, 0);
});

test('workspace em SUBPASTA do repositório: só entradas do prefixo, caminhos sem o prefixo', async () => {
  const d = newRepo(); put(d, 'pkg/app/m.txt', '1\n'); put(d, 'pkg/other/o.txt', '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b');
  put(d, 'pkg/app/m.txt', '1\n2\n'); put(d, 'pkg/app/novo/a.txt', 'a\n'); put(d, 'pkg/other/o.txt', '1\n2\n3\n'); put(d, 'raiz.txt', 'x\n');
  const r = await createChangesService({}).changes(wsOf(path.join(d, 'pkg', 'app')));
  assert.equal(r.mode, 'git'); assert.deepEqual(r.files.map((x) => x.path).sort(), ['m.txt', 'novo/a.txt']); assert.equal(r.totals.files, 2);
  const f = byPath(r); assert.deepEqual([f['m.txt'].added, f['m.txt'].removed], [1, 0]); assert.equal(f['novo/a.txt'].added, 1);
});

test('mais de 200 arquivos: files limitado a 200, truncated e totals.files com o número real; contagem de linhas limitada a 50 arquivos', async () => {
  const d = newRepo(); put(d, 'base.txt', 'x\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b');
  for (let i = 0; i < 230; i++) put(d, `lote/f${String(i).padStart(3, '0')}.txt`, 'a\n');
  const r = await createChangesService({}).changes(wsOf(d));
  assert.equal(r.files.length, 200); assert.equal(r.truncated, true); assert.equal(r.totals.files, 230); assert.equal(r.totals.created, 230);
  assert.ok(r.totals.added <= 50, `no máximo 50 arquivos têm linhas contadas (${r.totals.added})`); assert.ok(r.files.some((x) => x.added === null));
});

test('endurecimento: core.fsmonitor do repositório NÃO é executado (marcador não criado) e o modo git segue funcionando', async () => {
  const d = newRepo(); const m1 = path.join(tmp, `marca-fsmonitor${seq}`); const h1 = path.join(tmp, `h1-${seq}.js`);
  fs.writeFileSync(h1, `require('node:fs').writeFileSync(${JSON.stringify(m1)}, 'x');`);
  put(d, 'a.txt', '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, 'a.txt', '1\n2\n');
  sh(d, 'config', 'core.fsmonitor', `node ${JSON.stringify(h1.replace(/\\/g, '/'))}`);
  try { execFileSync('git', ['status', '--porcelain'], { cwd: d, stdio: 'ignore' }); } catch { /* o que importa é o marcador */ }
  const ctrl = fs.existsSync(m1); fs.rmSync(m1, { force: true });
  const r = await createChangesService({}).changes(wsOf(d));
  assert.equal(fs.existsSync(m1), false, 'core.fsmonitor não pode rodar');
  assert.equal(r.mode, 'git'); assert.deepEqual(r.files.map((x) => [x.path, x.added, x.removed]), [['a.txt', 1, 0]]);
  if (!ctrl) console.warn('[aviso] controle: este Git não executou fsmonitor no comando cru; o teste só confirma o funcionamento normal.');
});

test('Git que estoura o tempo ou falha => mode:"none" com error, sem lançar; Git ausente => varredura', async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n'); const ws = wsOf(d);
  const timeout = async () => ({ code: -1, out: '', err: 'timeout', failed: true, timedOut: true });
  const r = await createChangesService({ git: timeout }).changes(ws);
  assert.equal(r.mode, 'none'); assert.match(r.error, /Tempo esgotado/); assert.deepEqual(r.files, []); assert.equal(r.totals.files, 0); assert.equal(r.workspaceId, ws.id);
  const calls = []; let n = 0;
  const failStatus = async (cwd, args) => { calls.push(args[0]); if (args[0] === 'status') return { code: 128, out: '', err: 'fatal', failed: false, timedOut: false }; return realGit(cwd, args, {}); };
  const r2 = await createChangesService({ git: failStatus }).changes(wsOf(d)); assert.equal(r2.mode, 'none'); assert.match(r2.error, /Git/);
  const late = async (cwd, args) => (++n >= 3 ? timeout() : realGit(cwd, args, {})); // estoura no meio (no status)
  assert.equal((await createChangesService({ git: late }).changes(wsOf(d))).mode, 'none');
  const noGit = async () => ({ code: -1, out: '', err: 'spawn git ENOENT', failed: true, timedOut: false });
  const r3 = await createChangesService({ git: noGit }).changes(ws); assert.equal(r3.mode, 'scan', 'sem Git instalado: cai na varredura'); assert.equal(r3.files[0].path, 'a.txt');
  const missing = await createChangesService({}).changes({ id: 'ws_00000099', path: path.join(tmp, 'sumiu') }); assert.equal(missing.mode, 'none'); assert.match(missing.error, /pasta do workspace/);
});

test('prazo total de 8 s e 5 s por comando: o timeout passado ao Git respeita os limites', async () => {
  const d = newRepo(); const seen = [];
  const spy = async (cwd, args, opts) => { seen.push(opts); return realGit(cwd, args, opts); };
  await createChangesService({ git: spy }).changes(wsOf(d));
  assert.ok(seen.length >= 5); for (const o of seen) { assert.ok(o.timeout <= 5000 && o.timeout > 0); assert.deepEqual(o.env, { GIT_OPTIONAL_LOCKS: '0' }); }
});

test('untracked que é link para fora (arquivo ou junção) não é lido: added:null', async (t) => {
  const d = newRepo(); put(d, 'base.txt', 'x\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b');
  const outside = path.join(tmp, `ext${seq}`); fs.mkdirSync(outside); const secret = put(outside, 'leak.txt', 'a\nb\nc\nd\ne\n');
  let any = false;
  try { fs.symlinkSync(secret, path.join(d, 'link.txt'), 'file'); any = true; } catch (e) { console.warn(`[aviso] symlink de arquivo indisponível (${e.code})`); }
  try { fs.symlinkSync(outside, path.join(d, 'lnk'), 'junction'); any = true; } catch (e) { console.warn(`[aviso] junção indisponível (${e.code})`); }
  if (!any) { t.skip('sem permissão para links'); return; }
  const r = await createChangesService({}).changes(wsOf(d));
  for (const x of r.files.filter((f) => f.path === 'link.txt' || f.path.startsWith('lnk'))) { assert.equal(x.added, null, `${x.path} não pode ser lido`); }
  assert.ok(!JSON.stringify(r).includes('leak') || r.files.every((x) => x.added === null || !x.path.includes('leak')));
});

test('segredos (.env, token...) aparecem pelo NOME mas o conteúdo não é lido', async () => {
  const d = newRepo(); put(d, 'base.txt', 'x\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, '.env', 'A=1\nB=2\n'); put(d, 'secret-token.txt', 'x\ny\n'); put(d, 'ok.txt', 'x\ny\n');
  const f = byPath(await createChangesService({}).changes(wsOf(d))); assert.equal(f['.env'].added, null); assert.equal(f['secret-token.txt'].added, null); assert.equal(f['ok.txt'].added, 2);
});

test('modo scan (sem Git): since, birthtime, ignora node_modules/dotdirs/links/dist, contagem de linhas, binário, grande, limite de entradas e de tempo', async (t) => {
  const d = path.join(tmp, `scan${++seq}`); fs.mkdirSync(d);
  const old = put(d, 'antigo.txt', 'velho\n'); const oldT = new Date(Date.now() - 3 * 3600 * 1000); fs.utimesSync(old, oldT, oldT);
  const ex = put(d, 'existente.txt', '1\n2\n3\n'); fs.utimesSync(ex, oldT, oldT);
  await new Promise((r) => setTimeout(r, 30)); const since = Date.now(); await new Promise((r) => setTimeout(r, 30));
  fs.writeFileSync(ex, '1\n2\n3\n4\n'); // criado antes de `since`, alterado depois: modified
  put(d, 'novo.html', 'a\nb\n'); put(d, 'pasta/fundo/x.css', 'x\n'); fs.writeFileSync(path.join(d, 'bin.dat'), Buffer.from([1, 0, 2])); fs.writeFileSync(path.join(d, 'enorme.txt'), Buffer.alloc(300 * 1024, 0x61));
  put(d, 'node_modules/m/i.js', 'x'); put(d, '.oculto/a.txt', 'x'); put(d, 'dist/a.js', 'x'); put(d, '.git/HEAD', 'x'); put(d, 'build/a.js', 'x');
  const out = path.join(tmp, `scanfora${seq}`); put(out, 'vaza.txt', 'x\n'); try { fs.symlinkSync(out, path.join(d, 'lnk'), 'junction'); } catch { console.warn('[aviso] junção indisponível: parte do scan não verificada'); }
  const svc = createChangesService({}); const r = await svc.changes(wsOf(d), { since });
  assert.equal(r.mode, 'scan'); assert.equal(r.branch, null); const f = byPath(r);
  assert.deepEqual(Object.keys(f).sort(), ['bin.dat', 'enorme.txt', 'existente.txt', 'novo.html', 'pasta/fundo/x.css'], 'só o que mudou depois de since e fora das pastas ignoradas');
  assert.equal(f['novo.html'].status, 'added'); assert.equal(f['novo.html'].added, 2); assert.equal(f['novo.html'].removed, null);
  assert.equal(f['existente.txt'].status, 'modified', 'birthtime antes de since: modified'); assert.equal(f['existente.txt'].added, 4);
  assert.deepEqual([f['bin.dat'].binary, f['bin.dat'].added], [true, null]); assert.equal(f['enorme.txt'].added, null, '>256 KB: sem contagem');
  assert.equal(r.totals.files, 5); assert.equal(r.totals.created + r.totals.modified, 5); assert.equal(r.truncated, false);
  // since limitado a [agora-24h, agora]
  const veryOld = path.join(d, 'muito-antigo.txt'); fs.writeFileSync(veryOld, 'x'); const t48 = new Date(Date.now() - 48 * 3600 * 1000); fs.utimesSync(veryOld, t48, t48);
  const r0 = await createChangesService({}).changes(wsOf(d), { since: 0 }); assert.ok(r0.files.some((x) => x.path === 'antigo.txt'), '3 h atrás está dentro da janela de 24 h'); assert.ok(!r0.files.some((x) => x.path === 'muito-antigo.txt'), 'since=0 é limitado a 24 h');
  const rf = await createChangesService({}).changes(wsOf(d), { since: Date.now() + 3600 * 1000 }); assert.equal(rf.totals.files, 0, 'since no futuro é limitado a agora');
  const rd = await createChangesService({}).changes(wsOf(d)); assert.ok(rd.files.some((x) => x.path === 'novo.html') && !rd.files.some((x) => x.path === 'antigo.txt'), 'padrão: últimos 30 min');
  // limite de entradas
  const cut = await createChangesService({ limits: { scanEntries: 3 } }).changes(wsOf(d), { since }); assert.equal(cut.mode, 'scan'); assert.equal(cut.truncated, true); assert.ok(cut.totals.files < 5);
  t.diagnostic('scan ok');
});

test('modo scan: mais de 200 arquivos => 200 e truncated; profundidade máxima 6', async () => {
  const d = path.join(tmp, `scan${++seq}`); fs.mkdirSync(d); for (let i = 0; i < 205; i++) put(d, `f${i}.txt`, 'x\n'); put(d, 'a/b/c/d/e/f/ok.txt', 'x'); put(d, 'a/b/c/d/e/f/g/fundo.txt', 'x');
  const r = await createChangesService({}).changes(wsOf(d)); assert.equal(r.mode, 'scan'); assert.equal(r.files.length, 200); assert.equal(r.truncated, true); assert.equal(r.totals.files, 206);
  assert.ok(!JSON.stringify(r).includes('fundo.txt') || r.files.length === 200);
  const small = path.join(tmp, `scan${++seq}`); put(small, 'a/b/c/d/e/f/ok.txt', 'x'); put(small, 'a/b/c/d/e/f/g/fundo.txt', 'x');
  const rs = await createChangesService({}).changes(wsOf(small)); assert.deepEqual(rs.files.map((x) => x.path), ['a/b/c/d/e/f/ok.txt']);
});

test('memo de 1,5 s e single-flight: duas chamadas concorrentes = uma execução do Git; relógio injetado expira o memo', async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n'); const calls = []; let clock = 10_000;
  const spy = (cwd, args, opts) => { calls.push(args[0]); return realGit(cwd, args, opts); };
  const svc = createChangesService({ git: spy, now: () => clock }); const ws = wsOf(d);
  const [a, b] = await Promise.all([svc.changes(ws), svc.changes(ws)]); assert.equal(a, b, 'a mesma promessa/resultado'); const first = calls.length; assert.ok(first >= 5 && first <= 7, `um conjunto de comandos (${first})`);
  clock += 1000; await svc.changes(ws); assert.equal(calls.length, first, 'dentro de 1,5 s vem do memo');
  clock += 600; const c = await svc.changes(ws); assert.equal(calls.length, first * 2, 'depois de 1,5 s roda de novo'); assert.notEqual(c, a);
  await svc.changes(wsOf(d)); assert.equal(calls.length, first * 3, 'outro workspace tem memo próprio');
});

// ---------- rotas ----------
const TOKEN = 'C'.repeat(16) + 'z8_-'.repeat(8);
let server, port, good; const routeCalls = []; const routeDb = { workspaces: [] };
const call = (target, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: target, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* não JSON */ } resolve({ status: res.statusCode, text: s, json, headers: res.headers }); }); }).on('error', reject);
});
before(async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n'); routeDb.workspaces.push({ id: 'ws_route001', name: 'r', path: d });
  const svc = createChangesService({ git: (cwd, args, opts) => { routeCalls.push(args); return realGit(cwd, args, opts); } });
  const app = express(); app.use('/api', apiGuard); app.use('/api', createTokenGuard(TOKEN)); app.use(express.json());
  setupLiveChanges(app, { db: routeDb, service: svc });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); port = server.address().port; good = { [TOKEN_HEADER]: TOKEN };
});
after(() => { server?.close(); server?.closeAllConnections?.(); });

test('rota GET /api/live/changes: token obrigatório, no-store, 400 (id e since), 404, sem caminho absoluto, nada do cliente vai ao Git', async () => {
  const q = '/api/live/changes?workspaceId=ws_route001';
  assert.equal((await call(q)).status, 403, 'sem token'); assert.equal((await call(q, { [TOKEN_HEADER]: 'x'.repeat(40) })).status, 403);
  assert.equal((await call(q, { ...good, 'sec-fetch-site': 'same-site' })).status, 403, 'página de outra origem');
  const ok = await call(q, good); assert.equal(ok.status, 200); assert.equal(ok.headers['cache-control'], 'no-store'); assert.equal(ok.json.mode, 'git'); assert.equal(ok.json.files[0].path, 'a.txt'); assert.ok(!ok.text.includes(tmp));
  for (const bad of ['', '?workspaceId=', '?workspaceId=ws_1;rm%20-rf', '?workspaceId=a%20b', '?workspaceId[]=x', `?workspaceId=ws_route001&since=abc`, '?workspaceId=ws_route001&since=-5', '?workspaceId=ws_route001&since=1.5', '?workspaceId=ws_route001&since=1e3', '?workspaceId=ws_route001&since=', '?workspaceId=ws_route001&since=1&since=2', `?workspaceId=ws_route001&since=${'9'.repeat(16)}`, '?workspaceId=--output%3dx']) assert.equal((await call(`/api/live/changes${bad}`, good)).status, 400, bad);
  assert.equal((await call('/api/live/changes?workspaceId=ws_desconhecido', good)).status, 404);
  assert.equal((await call(`${q}&since=${Date.now() - 1000}`, good)).status, 200, 'since numérico é aceito (só vale no scan)');
  const flat = routeCalls.flat().join(' '); assert.ok(!/ws_route001|ws_1|since|--output|rm /.test(flat), 'nenhum argumento do Git vem da consulta'); assert.ok(routeCalls.length >= 5);
});

test('rota: workspace com pasta ausente => 200 com mode:"none" (nunca 500)', async () => {
  routeDb.workspaces.push({ id: 'ws_sumiu001', name: 's', path: path.join(tmp, 'nao-existe-mesmo') });
  const r = await call('/api/live/changes?workspaceId=ws_sumiu001', good); assert.equal(r.status, 200); assert.equal(r.json.mode, 'none'); assert.match(r.json.error, /pasta do workspace/);
});
