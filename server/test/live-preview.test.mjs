// Servidor de preview do painel Live (server/live-preview.js): servidor REAL em 127.0.0.1:0, requisições com Host controlado, ataques de travessia/link/Host forjado.
// Tudo em diretórios temporários; o banco real não é tocado. Cada teste fecha o que abriu.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-livepv-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'orch-data');
const { createPreviewManager, PREVIEW_CSP, LIMITS } = await import('../live-preview.js');

const managers = [];
const mk = (opts = {}) => { const m = createPreviewManager({ dataDir: path.join(tmp, 'orch-data'), limits: { memoMs: 0 }, ...opts }); managers.push(m); return m; };
after(async () => { for (const m of managers) await m.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
const newWs = (files = { 'index.html': '<h1>oi</h1>' }) => {
  const dir = path.join(tmp, `ws${++seq}`); fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
  return { id: `ws_${String(seq).padStart(8, '0')}`, name: `ws${seq}`, path: dir };
};
const SENTINEL = path.join(tmp, 'sentinel.txt'); fs.writeFileSync(SENTINEL, 'SENTINELA-FORA-DO-DOCROOT');

/** GET/HEAD cru com Host controlado (`host: null` = sem cabeçalho Host). Sem keep-alive. */
const req = (port, { method = 'GET', target = '/', headers = {}, host } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  const useHost = host === undefined ? `127.0.0.1:${port}` : host;
  if (useHost !== null) h.host = useHost;
  const r = http.request({ host: '127.0.0.1', port, method, path: target, headers: h, agent: false, setHost: false }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  r.on('error', reject); r.end();
});
const refusing = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); });

test('caminho feliz: 200 com tipo, corpo byte a byte, cabeçalhos de segurança, CSP com frame-ancestors; HEAD sem corpo e mesmo Content-Length', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  const ws = newWs({ 'index.html': '<!doctype html><link rel="stylesheet" href="style.css"><h1>Olá, café</h1>', 'style.css': 'body{color:red}', 'app.js': 'console.log(1)', 'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'data/products.json': '{"a":1}' });
  fs.writeFileSync(path.join(ws.path, 'assets', 'p.png'), png);
  const m = mk(); const info = await m.ensure(ws);
  assert.equal(info.available, true); assert.equal(info.path, '/'); assert.equal(info.entry, 'index.html'); assert.equal(info.docroot, '.'); assert.ok(info.port > 0 && info.port < 65536);
  assert.match(info.version, /^[0-9a-f]{12}$/); assert.equal(info.files, 6); assert.equal(info.truncated, false); assert.equal(typeof info.startedAt, 'number');
  assert.ok(!JSON.stringify(info).includes(tmp), 'nenhum caminho absoluto na resposta');
  const want = { '/': ['text/html; charset=utf-8', fs.readFileSync(path.join(ws.path, 'index.html'))], '/index.html': ['text/html; charset=utf-8'], '/style.css': ['text/css; charset=utf-8'], '/app.js': ['text/javascript; charset=utf-8'], '/assets/logo.svg': ['image/svg+xml; charset=utf-8'], '/assets/p.png': ['image/png', png], '/data/products.json': ['application/json; charset=utf-8'] };
  for (const [t, [type, body]] of Object.entries(want)) {
    const r = await req(info.port, { target: t }); assert.equal(r.status, 200, t); assert.equal(r.headers['content-type'], type, t);
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.headers['permissions-policy'], /camera=\(\)/); assert.equal(r.headers['content-security-policy'], PREVIEW_CSP);
    assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')), 'sem CORS'); assert.equal(r.headers['x-frame-options'], undefined);
    assert.equal(Number(r.headers['content-length']), r.body.length);
    if (body) assert.deepEqual(r.body, body, `${t}: corpo byte a byte, sem script injetado`);
  }
  assert.match(PREVIEW_CSP, /connect-src 'self'/); assert.match(PREVIEW_CSP, /frame-ancestors http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*/); assert.match(PREVIEW_CSP, /frame-src 'none'/);
  const get = await req(info.port, { target: '/style.css' }), head = await req(info.port, { method: 'HEAD', target: '/style.css' });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], get.headers['content-length']); assert.equal(head.headers['content-type'], get.headers['content-type']);
  assert.equal((await req(info.port, { target: '/', headers: { host: `localhost:${info.port}` } })).status, 200, 'localhost:<porta> também vale');
  assert.equal((await req(info.port, { target: '/?v=1&x=../..' })).status, 200, 'a consulta é ignorada');
  assert.equal((await req(info.port, { target: '/ASSETS/LOGO.SVG' })).status, process.platform === 'win32' ? 200 : 404, 'caixa: segue o sistema de arquivos');
  assert.equal((await req(info.port, { target: '/caf%C3%A9.css' })).status, 404);
  await m.close(); assert.equal(await refusing(info.port), true, 'close() derruba o listener');
});

test('Host forjado => 403 (também sem Host: o próprio Node recusa com 400)', async () => {
  const m = mk(); const { port } = await m.ensure(newWs());
  for (const host of ['evil.com', `evil.com:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', 'localhost', `[::1]:${port}`, `localhost.evil.com:${port}`, `127.0.0.1.evil.com:${port}`, `LOCALHOST:${port}`, `127.0.0.1:${port}.evil.com`, `user@127.0.0.1:${port}`, `127.1:${port}`, `0.0.0.0:${port}`, '']) {
    const r = await req(port, { host }); assert.equal(r.status, 403, `Host ${JSON.stringify(host)}`); assert.doesNotMatch(r.body.toString(), /oi/);
  }
  const semHost = await req(port, { host: null }); assert.ok([400, 403].includes(semHost.status), `sem Host => ${semHost.status}`); assert.doesNotMatch(semHost.body.toString(), /<h1>/);
  assert.equal((await req(port)).status, 200);
});

test('Sec-Fetch-Site: cross-site => 403; same-site, same-origin, none e ausente passam', async () => {
  const m = mk(); const { port } = await m.ensure(newWs());
  assert.equal((await req(port, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await req(port, { headers: { 'sec-fetch-site': 'CROSS-SITE' } })).status, 403);
  for (const v of ['same-site', 'same-origin', 'none']) assert.equal((await req(port, { headers: { 'sec-fetch-site': v } })).status, 200, v);
  assert.equal((await req(port)).status, 200);
});

test('só GET e HEAD: os demais métodos => 405 com Allow; request-target absoluto => 400', async () => {
  const m = mk(); const { port } = await m.ensure(newWs());
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
    const r = await req(port, { method }); assert.equal(r.status, 405, method); assert.equal(r.headers.allow, 'GET, HEAD'); assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')));
  }
  for (const target of [`http://127.0.0.1:${port}/`, 'http://evil.com/', `http://127.0.0.1:${port}/index.html`, '*', 'ftp://x/']) assert.equal((await req(port, { target })).status, 400, target);
});

test('travessia: nunca 200 nem vaza o arquivo-sentinela fora do docroot', async () => {
  const ws = newWs({ 'site/index.html': 'dentro' }); fs.copyFileSync(SENTINEL, path.join(ws.path, 'sentinel.txt')); // o docroot é "site"; a sentinela fica no workspace, FORA do docroot
  const m = mk(); const info = await m.ensure(ws); assert.equal(info.docroot, 'site');
  for (const t of ['/../sentinel.txt', '/%2e%2e/sentinel.txt', '/%2e%2e/%2e%2e/sentinel.txt', '/..%5csentinel.txt', '/..%5c..%5csentinel.txt', '//sentinel.txt', '/a/../../sentinel.txt', '/%00', '/..%2fsentinel.txt', '/%2e%2e%2fsentinel.txt', '/sentinel.txt', '/./../sentinel.txt', '/..;/sentinel.txt', '/%252e%252e/sentinel.txt', '/C:/sentinel.txt', '/..\\sentinel.txt', `/${tmp.replace(/\\/g, '/')}/sentinel.txt`]) {
    const r = await req(info.port, { target: t }); assert.notEqual(r.status, 200, t); assert.ok(!r.body.toString().includes('SENTINELA'), t); assert.ok([400, 404].includes(r.status), `${t} => ${r.status}`);
  }
  assert.equal((await req(info.port, { target: '/' })).body.toString(), 'dentro');
});

test('links e junções: arquivo-link para fora, pasta-link para fora, link para arquivo DENTRO do docroot => 404', async (t) => {
  const ws = newWs({ 'index.html': 'ok', 'real.css': 'body{}' }); const outside = path.join(tmp, `fora${seq}`); fs.mkdirSync(path.join(outside, 'sub'), { recursive: true }); fs.writeFileSync(path.join(outside, 'leak.txt'), 'VAZOU'); fs.writeFileSync(path.join(outside, 'sub', 'x.txt'), 'VAZOU2');
  const m = mk(); const { port } = await m.ensure(ws);
  try { fs.symlinkSync(outside, path.join(ws.path, 'linkdir'), 'junction'); } catch (e) { t.skip(`sem permissão para junção (${e.code}): teste de link não executado`); return; }
  for (const target of ['/linkdir/leak.txt', '/linkdir/sub/x.txt', '/linkdir/', '/linkdir']) { const r = await req(port, { target }); assert.equal(r.status, 404, target); assert.ok(!r.body.toString().includes('VAZOU')); }
  fs.mkdirSync(path.join(ws.path, 'docs')); fs.writeFileSync(path.join(ws.path, 'docs', 'in.txt'), 'dentro');
  fs.symlinkSync(path.join(ws.path, 'docs'), path.join(ws.path, 'alias'), 'junction'); assert.equal((await req(port, { target: '/alias/in.txt' })).status, 404, 'junção para pasta DENTRO do docroot também é recusada');
  assert.equal((await req(port, { target: '/docs/in.txt' })).status, 200, 'o caminho real (sem link) continua servido');
});

test('links de arquivo (quando o SO permite) e hardlink para fora => 404', async (t) => {
  const ws = newWs({ 'index.html': 'ok', 'real.css': 'body{}' }); const m = mk(); const { port } = await m.ensure(ws);
  assert.equal((await req(port, { target: '/real.css' })).status, 200);
  try { fs.symlinkSync(SENTINEL, path.join(ws.path, 'out.txt'), 'file'); assert.equal((await req(port, { target: '/out.txt' })).status, 404, 'link de arquivo para fora'); }
  catch (e) { console.warn(`[aviso] symlink de arquivo indisponível (${e.code}): parte do teste pulada`); }
  try { fs.symlinkSync(path.join(ws.path, 'real.css'), path.join(ws.path, 'copy.css'), 'file'); assert.equal((await req(port, { target: '/copy.css' })).status, 404, 'link para arquivo DENTRO do docroot'); } catch { /* sem permissão */ }
  try { fs.linkSync(SENTINEL, path.join(ws.path, 'hard.txt')); const r = await req(port, { target: '/hard.txt' }); assert.equal(r.status, 404, 'hardlink (nlink>1) recusado'); assert.ok(!r.body.toString().includes('SENTINELA')); }
  catch (e) { console.warn(`[aviso] hardlink indisponível (${e.code}): parte do teste pulada`); }
  void t;
});

test('docroot (site) que é link/junção para fora: pickDocroot recusa e nada é servido', async (t) => {
  const outside = path.join(tmp, `docfora${seq}`); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'index.html'), 'FORA');
  const ws = newWs({ 'readme.txt': 'x' });
  try { fs.symlinkSync(outside, path.join(ws.path, 'site'), 'junction'); } catch (e) { t.skip(`sem permissão para junção (${e.code})`); return; }
  const m = mk(); assert.deepEqual(await m.ensure(ws), { available: false, reason: 'no-index' }); assert.deepEqual(m.listeners(), []);
});

test('dotfiles, sensíveis, fora da lista e inexistentes: o MESMO 404 (mesmo corpo e cabeçalhos relevantes)', async () => {
  const ws = newWs({ 'index.html': 'ok', '.env': 'SEGREDO=1', '.git/config': '[core]', 'package.json': '{}', 'secrets.json': '{}', 'token.js': 'x', 'notas.md': 'md', 'run.php': 'x', 'a.map': 'x', '.well-known/x.json': '{}', 'node_modules/x/index.js': 'x', 'CON.txt': 'x' });
  const m = mk(); const { port } = await m.ensure(ws); const ref = await req(port, { target: '/nao-existe.css' });
  assert.equal(ref.status, 404);
  for (const t of ['/.env', '/.git/config', '/package.json', '/secrets.json', '/token.js', '/notas.md', '/run.php', '/a.map', '/.well-known/x.json', '/node_modules/x/index.js', '/CON.txt', '/%2eenv', '/.ENV', '/semextensao']) {
    const r = await req(port, { target: t }); assert.equal(r.status, 404, t); assert.deepEqual(r.body, ref.body, `${t}: corpo idêntico`); assert.equal(r.headers['content-type'], ref.headers['content-type']); assert.equal(r.headers['content-length'], ref.headers['content-length']);
    assert.ok(!r.body.toString().includes('SEGREDO'));
  }
});

test('pasta de dados do FORGE dentro do workspace (data/db.json) => 404', async () => {
  const ws = newWs({ 'index.html': 'ok', 'data/db.json': '{"segredo":true}', 'data/outro.json': '{"x":1}', 'dados/ok.json': '{"ok":1}' });
  const dataDir = path.join(ws.path, 'data');
  const m = createPreviewManager({ dataDir, limits: { memoMs: 0 } }); managers.push(m); const info = await m.ensure(ws);
  assert.equal(info.docroot, '.');
  for (const t of ['/data/db.json', '/data/outro.json', '/data/', '/data']) assert.equal((await req(info.port, { target: t })).status, 404, t);
  assert.equal((await req(info.port, { target: '/dados/ok.json' })).status, 200);
  assert.equal(info.files, 2, 'index.html e dados/ok.json: a pasta de dados nem entra na contagem');
  // docroot DENTRO da pasta de dados é recusado
  const ws2 = newWs({ 'site/index.html': 'x' }); const m2 = createPreviewManager({ dataDir: path.join(ws2.path, 'site') }); managers.push(m2);
  assert.deepEqual(await m2.ensure(ws2), { available: false, reason: 'no-index' });
});

test('arquivo > 10 MiB => 413; exatamente 10 MiB => 200 com o tamanho certo', async () => {
  const ws = newWs({ 'index.html': 'ok' }); fs.writeFileSync(path.join(ws.path, 'limite.txt'), Buffer.alloc(LIMITS.maxFileBytes, 0x61)); fs.writeFileSync(path.join(ws.path, 'grande.txt'), Buffer.alloc(LIMITS.maxFileBytes + 1, 0x61));
  const m = mk(); const { port } = await m.ensure(ws);
  const ok = await req(port, { target: '/limite.txt' }); assert.equal(ok.status, 200); assert.equal(ok.body.length, LIMITS.maxFileBytes);
  const big = await req(port, { target: '/grande.txt' }); assert.equal(big.status, 413); assert.ok(big.body.length < 200);
  assert.equal((await req(port, { method: 'HEAD', target: '/grande.txt' })).status, 413);
  fs.writeFileSync(path.join(ws.path, 'vazio.txt'), ''); const e = await req(port, { target: '/vazio.txt' }); assert.equal(e.status, 200); assert.equal(e.body.length, 0);
});

test('diretórios: /sub => 301 para o caminho SANEADO; /sub/ serve index.html ou 404; sem listagem; Location nunca reflete texto bruto', async () => {
  const ws = newWs({ 'index.html': 'raiz', 'sub/index.html': 'sub-index', 'vazia/x.php': 'x', 'meu dir/index.html': 'espaco' });
  const m = mk(); const { port } = await m.ensure(ws);
  const r301 = await req(port, { target: '/sub' }); assert.equal(r301.status, 301); assert.equal(r301.headers.location, '/sub/'); assert.ok(r301.headers.location.startsWith('/') && !r301.headers.location.startsWith('//'));
  assert.equal((await req(port, { target: '/sub?x=<script>' })).headers.location, '/sub/', 'a consulta não é refletida');
  assert.equal((await req(port, { target: '/meu%20dir' })).headers.location, '/meu%20dir/');
  assert.equal((await req(port, { method: 'HEAD', target: '/sub' })).status, 301);
  const sub = await req(port, { target: '/sub/' }); assert.equal(sub.status, 200); assert.equal(sub.body.toString(), 'sub-index');
  assert.equal((await req(port, { target: '/meu%20dir/' })).body.toString(), 'espaco');
  const noIdx = await req(port, { target: '/vazia/' }); assert.equal(noIdx.status, 404); assert.doesNotMatch(noIdx.body.toString(), /x\.php/, 'sem listagem');
  for (const t of ['/nao-existe', '/%3Cscript%3E', '/<script>alert(1)</script>', '//evil.com', '/%2f%2fevil.com']) { const r = await req(port, { target: t }); assert.ok([301, 404, 400].includes(r.status) && !(r.headers.location ?? '').includes('evil') && !(r.headers.location ?? '').includes('<'), t); assert.notEqual(r.status, 301, t); }
});

test('ciclo de vida: docroot "." vs "site", troca mantém a porta, sem index.html => nenhum listener, reuso do listener', async () => {
  const ws = newWs({ 'site/index.html': 'do-site' }); const m = mk();
  const a = await m.ensure(ws); assert.equal(a.docroot, 'site'); assert.equal((await req(a.port, { target: '/' })).body.toString(), 'do-site');
  fs.writeFileSync(path.join(ws.path, 'index.html'), 'da-raiz');
  const b = await m.ensure(ws); assert.equal(b.docroot, '.'); assert.equal(b.port, a.port, 'a URL fica estável'); assert.equal((await req(a.port, { target: '/' })).body.toString(), 'da-raiz');
  assert.equal(b.startedAt, a.startedAt); assert.equal(m.listeners().length, 1);
  assert.deepEqual(await Promise.all([m.ensure(ws), m.ensure(ws)]).then((r) => r.map((x) => x.port)), [a.port, a.port]);
  const empty = newWs({ 'leia.txt': 'x' }); const before = m.listeners().length;
  assert.deepEqual(await m.ensure(empty), { available: false, reason: 'no-index' }); assert.equal(m.listeners().length, before, 'sem index.html não há listener');
  assert.deepEqual(await m.ensure({ id: 'ws_x', path: path.join(tmp, 'nao-existe') }), { available: false, reason: 'workspace-missing' });
  assert.deepEqual(await m.ensure({ id: 'ws_y', path: null }), { available: false, reason: 'workspace-missing' });
  assert.notEqual(a.port, 4317);
  // peek: sem efeito colateral
  const m2 = mk(); const ws2 = newWs(); const p = await m2.peek(ws2); assert.deepEqual(p, { running: false, available: true, port: null, docroot: '.', version: null, files: 0, truncated: false }); assert.equal(m2.listeners().length, 0, 'peek não liga listener');
  await m2.ensure(ws2); const p2 = await m2.peek(ws2); assert.equal(p2.running, true); assert.equal(p2.available, true); assert.equal(p2.port, m2.listeners()[0].port); assert.match(p2.version, /^[0-9a-f]{12}$/);
  assert.deepEqual(await m2.peek(empty), { running: false, available: false, port: null, docroot: null, version: null, files: 0, truncated: false });
});

test('ociosidade: timer injetado e relógio injetado fecham o listener após 10 min; atividade o mantém', async () => {
  let clock = 1_000_000, tick = null, canceled = false;
  const m = mk({ now: () => clock, setTimer: (fn) => { tick = fn; return () => { canceled = true; }; } });
  const ws = newWs(); const { port } = await m.ensure(ws); assert.equal(typeof tick, 'function', 'o varredor de ociosidade foi agendado');
  clock += LIMITS.idleMs - 1000; tick(); assert.equal(m.listeners().length, 1, 'ainda não ocioso');
  await req(port); clock += LIMITS.idleMs - 1000; tick(); assert.equal(m.listeners().length, 1, 'um acesso renova o prazo');
  await m.peek(ws); clock += LIMITS.idleMs - 1000; tick(); assert.equal(m.listeners().length, 1, 'o GET da API também renova');
  clock += LIMITS.idleMs + 1; tick(); assert.equal(m.listeners().length, 0); assert.equal(canceled, true, 'sem listeners o varredor é cancelado');
  await new Promise((r) => setTimeout(r, 100)); assert.equal(await refusing(port), true, 'a porta fechou');
  const again = await m.ensure(ws); assert.equal(again.available, true, 'reabrir religa (porta nova possível)');
});

test('limite de 3 listeners: o menos recente é fechado', async () => {
  let clock = 1000; const m = mk({ now: () => clock, setTimer: () => () => {} });
  const wss = [newWs(), newWs(), newWs(), newWs()]; const ports = [];
  for (const w of wss.slice(0, 3)) { clock += 10; ports.push((await m.ensure(w)).port); }
  clock += 10; await req(ports[0]); // o primeiro é usado de novo: o segundo vira o menos recente
  clock += 10; const p4 = (await m.ensure(wss[3])).port;
  assert.equal(m.listeners().length, 3); assert.deepEqual(m.listeners().map((l) => l.workspaceId).sort(), [wss[0].id, wss[2].id, wss[3].id].sort());
  assert.equal(await refusing(ports[1]), true, 'o menos recente foi fechado'); assert.equal((await req(ports[0])).status, 200); assert.equal((await req(p4)).status, 200);
});

test('close() encerra também conexões keep-alive e é idempotente', async () => {
  const m = mk(); const { port } = await m.ensure(newWs());
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: '/', agent, headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject); });
  const t0 = Date.now(); await m.close(); await m.close(); assert.ok(Date.now() - t0 < 3000, 'não espera o keep-alive expirar'); assert.equal(await refusing(port), true); agent.destroy();
  assert.deepEqual(await m.ensure(newWs()), { available: false, reason: 'start-failed' }, 'depois de fechado não liga mais');
});

test('version: muda ao alterar/criar/remover arquivo servível; NÃO muda com dotfile, .log, sensível ou link; truncated acima de 2000 arquivos', async () => {
  const ws = newWs({ 'index.html': 'v1', 'a.css': 'a' }); const m = mk(); const v = async () => (await m.peek(ws)).version; await m.ensure(ws);
  const v0 = await v(); assert.equal(await v(), v0, 'estável sem mudanças');
  fs.writeFileSync(path.join(ws.path, 'a.css'), 'aa'); const v1 = await v(); assert.notEqual(v1, v0, 'alterar (tamanho)');
  const f = path.join(ws.path, 'a.css'); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t); const v1b = await v(); assert.notEqual(v1b, v1, 'só o mtime');
  fs.writeFileSync(path.join(ws.path, 'nova.js'), 'x'); const v2 = await v(); assert.notEqual(v2, v1b, 'criar'); assert.equal((await m.peek(ws)).files, 3);
  fs.rmSync(path.join(ws.path, 'nova.js')); const v3 = await v(); assert.equal(v3, v1b, 'remover volta ao estado anterior');
  for (const [rel, c] of [['.env', 'x'], ['run.log', 'x'], ['.hidden/a.css', 'x'], ['package.json', '{}'], ['token.js', 'x'], ['notas.md', 'x'], ['node_modules/m/index.js', 'x']]) { fs.mkdirSync(path.dirname(path.join(ws.path, rel)), { recursive: true }); fs.writeFileSync(path.join(ws.path, rel), c); }
  assert.equal(await v(), v3, 'dotfile, .log, sensível, fora da lista e node_modules não contam');
  const big = newWs({ 'index.html': 'x' }); for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(big.path, `f${String(i).padStart(4, '0')}.css`), 'x');
  const r = await m.ensure(big); assert.equal(r.truncated, true); assert.equal(r.files, LIMITS.maxFiles); assert.match(r.version, /^[0-9a-f]{12}$/);
  const exact = newWs({ 'index.html': 'x' }); for (let i = 0; i < 29; i++) fs.writeFileSync(path.join(exact.path, `f${i}.css`), 'x');
  const m30 = mk({ limits: { memoMs: 0, maxFiles: 30 } }); const r2 = await m30.ensure(exact); assert.equal(r2.truncated, false); assert.equal(r2.files, 30, 'exatamente no limite: não é truncado');
  fs.writeFileSync(path.join(exact.path, 'extra.css'), 'x'); assert.equal((await m30.ensure(exact)).truncated, true, 'um acima do limite: truncado');
});

test('memo de 1 s: a versão não é recalculada a cada chamada (relógio injetado)', async () => {
  let clock = 5000; const m = createPreviewManager({ dataDir: path.join(tmp, 'orch-data'), now: () => clock, setTimer: () => () => {} }); managers.push(m);
  const ws = newWs({ 'index.html': 'v1' }); const a = await m.ensure(ws); fs.writeFileSync(path.join(ws.path, 'x.css'), 'novo');
  assert.equal((await m.peek(ws)).version, a.version, 'dentro de 1 s devolve o memo'); clock += 1001; assert.notEqual((await m.peek(ws)).version, a.version, 'depois de 1 s recalcula');
});
