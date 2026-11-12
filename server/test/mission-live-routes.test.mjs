// Acompanhamento ao vivo (server/mission-live.js): registro de links, rotas /live, SSE e cabeçalhos.
// Express isolado (sem index.js), dependências falsas, relógio injetável, portas efêmeras e arquivos estáticos num diretório temporário.
// A visão (buildLiveView/liveMarkdown) é um STUB fiel ao contrato: o módulo real (mission-live-view.js) tem testes próprios.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import express from 'express';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-live-routes-'));
process.env.ORCH_DATA_DIR = path.join(root, 'data'); fs.mkdirSync(process.env.ORCH_DATA_DIR); // este módulo não usa o store; garante que nada toque `data/`
const { setupMissionLive, LIVE_CSP } = await import('../mission-live.js');

const servers = new Set();
const SECRET = 'SEGREDO-FORA-DA-ALLOWLIST';
const staticDir = path.join(root, 'live'); fs.mkdirSync(staticDir);
fs.writeFileSync(path.join(staticDir, 'live.html'), '<!doctype html><title>live</title><script src="/live/_/live.js"></script>');
fs.writeFileSync(path.join(staticDir, 'live.js'), '// js');
fs.writeFileSync(path.join(staticDir, 'live-model.js'), '// model');
fs.writeFileSync(path.join(staticDir, 'live.css'), '/* css */');
fs.writeFileSync(path.join(root, 'secret.txt'), SECRET);
const dirUrl = (d) => pathToFileURL(d + path.sep);
after(async () => {
  for (const s of servers) { s.closeAllConnections?.(); s.close(); }
  await new Promise((r) => setTimeout(r, 100));
  fs.rmSync(root, { recursive: true, force: true });
});

// Cabeçalhos e CSP EXATOS do contrato (literais independentes do módulo).
const CSP_CONTRATO = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const HEADERS_CONTRATO = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin', 'content-security-policy': CSP_CONTRATO,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(10); } return false; }

/** Cliente HTTP cru: controla o Host e devolve cabeçalhos e corpo. */
function req(base, p, { method = 'GET', headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const r = http.request({ host: u.hostname, port: u.port, path: p, method, agent: false, headers: { ...(host ? { host } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject); r.end();
  });
}
/** Cliente SSE: acumula os eventos recebidos; close() derruba a conexão. */
function sse(base, p) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const r = http.get({ host: u.hostname, port: u.port, path: p, agent: false }, (res) => {
      const c = { status: res.statusCode, headers: res.headers, events: [], pings: 0, raw: '', ended: false, close: () => r.destroy() };
      if (res.statusCode !== 200) { res.on('data', (d) => { c.raw += d; }); res.on('end', () => resolve(c)); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        c.raw += d; buf += d;
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith(':')) { c.pings += 1; continue; }
          const ev = /^event: (.*)$/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) c.events.push({ event: ev, data: data ? JSON.parse(data) : null });
        }
      });
      res.on('end', () => { c.ended = true; });
      res.on('error', () => { c.ended = true; });
      resolve(c);
    });
    r.on('error', reject);
  });
}

const BUS_EVENTS = ['task', 'log', 'state', 'cycle', 'usage'];
const FAST = { coalesceMs: 40, tickMs: 60000, heartbeatMs: 60000, cacheMs: 0, ...{} };

async function fixture(opts = {}) {
  const state = { rev: 1, builds: 0, T: Date.UTC(2026, 0, 1, 12, 0, 0), logs: [], squadCalls: 0 };
  const missions = new Map([
    ['mis_aaaa1111', { id: 'mis_aaaa1111', title: 'Missão A', demo: false, workspaceId: 'ws_1' }],
    ['mis_bbbb2222', { id: 'mis_bbbb2222', title: 'Missão B', demo: false, workspaceId: 'ws_1' }],
    ['mis_cccc3333', { id: 'mis_cccc3333', title: 'Missão C', demo: false, workspaceId: 'ws_1' }],
    ['mis_dddd4444', { id: 'mis_dddd4444', title: 'Missão D', demo: false, workspaceId: 'ws_1' }],
    ['mis_demo0001', { id: 'mis_demo0001', title: 'Demo', demo: true, workspaceId: 'ws_1' }],
  ]);
  const db = { workspaces: [{ id: 'ws_1', name: 'proj', path: 'C:\\x' }], worktrees: [{ id: 'wt_1', missionId: 'mis_aaaa1111' }, { id: 'wt_2', missionId: 'mis_bbbb2222' }] };
  const bus = new EventEmitter();
  const view = opts.view ?? {
    buildLiveView(m, ctx) {
      state.builds += 1; state.lastNow = ctx.now;
      if (opts.throwView) throw new Error(`falha interna com ${m.id}`);
      return { schema: 1, generatedAt: ctx.now, mission: { title: m.title }, rev: state.rev, seen: { ws: ctx.workspace?.name, wt: ctx.worktrees.length, squad: ctx.squad, delivery: ctx.delivery }, big: opts.big ? 'x'.repeat(300 * 1024) : undefined };
    },
    liveMarkdown: (s) => `# ${s.mission.title}\n\nrev ${s.rev}\n`,
  };
  const app = express();
  const ctl = setupMissionLive(app, {
    db, bus, view, staticDir: dirUrl(opts.staticDir ?? staticDir),
    deliveryFor: () => ({ ok: true, report: { code: 'delivered' } }),
    getSquad: () => { state.squadCalls += 1; return [{ id: 'sq1' }]; },
    visibleMission: (id) => missions.get(id) ?? null,
    now: () => state.T, env: opts.env ?? {}, timing: { ...FAST, ...(opts.timing ?? {}) }, ...(opts.maxLinks ? { maxLinks: opts.maxLinks } : {}), ...(opts.ttlMs ? { ttlMs: opts.ttlMs } : {}),
  });
  app.use((req, res) => res.status(418).send('fallthrough')); // o que o setup não atende cai aqui (na prática, o catch-all do SPA)
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); servers.add(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const mint = async (id, headers = {}) => { const r = await req(base, `/api/missions/${id}/live-link`, { method: 'POST', headers }); return { ...r, json: r.text ? JSON.parse(r.text) : null }; };
  const tokenOf = (url) => /\/live\/([^/]+)\//.exec(url)[1];
  const live = async (id = 'mis_aaaa1111') => { const r = await mint(id); assert.equal(r.status, 201, r.text); return { ...r.json, token: tokenOf(r.json.url) }; };
  return { state, missions, db, bus, ctl, server, base, mint, tokenOf, live, close: () => { ctl.closeAll(); server.closeAllConnections?.(); server.close(); } };
}
const listeners = (bus) => BUS_EVENTS.map((e) => bus.listenerCount(e));

// ---------- Cunhar, reaproveitar, revogar ----------
test('POST cunha o link: 201 {url, expiresAt}, host/porta da requisição, 43 chars, sem o id da missão', async () => {
  const f = await fixture();
  const r = await f.mint('mis_aaaa1111');
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.json).sort(), ['expiresAt', 'url']);
  const port = new URL(f.base).port;
  assert.match(r.json.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/[A-Za-z0-9_-]{43}/$`));
  assert.ok(!r.json.url.includes('mis_aaaa1111'));
  assert.equal(r.json.expiresAt, new Date(f.state.T + 12 * 3600 * 1000).toISOString(), 'TTL padrão de 12 h');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['set-cookie'], undefined);
  f.close();
});

test('POST: missão inexistente 404, demo 409, Host inválido 403', async () => {
  const f = await fixture();
  assert.equal((await f.mint('mis_nao_existe')).status, 404);
  const d = await f.mint('mis_demo0001'); assert.equal(d.status, 409); assert.match(d.json.error, /demonstrativa/);
  const h = await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'POST', host: 'evil.example.com' });
  assert.equal(h.status, 403);
  f.close();
});

test('POST reaproveita o link válido da missão; missões diferentes têm tokens diferentes', async () => {
  const f = await fixture();
  const a1 = await f.live('mis_aaaa1111'), a2 = await f.live('mis_aaaa1111'), b = await f.live('mis_bbbb2222');
  assert.equal(a1.url, a2.url); assert.equal(a1.expiresAt, a2.expiresAt);
  assert.notEqual(a1.token, b.token);
  f.close();
});

test('expira pelo relógio injetável e o 404 é idêntico ao de um token inexistente; um novo POST cunha token novo', async () => {
  const f = await fixture({ ttlMs: 1000 });
  const a = await f.live();
  assert.equal((await req(f.base, `/live/${a.token}/data`)).status, 200);
  f.state.T += 999; assert.equal((await req(f.base, `/live/${a.token}/data`)).status, 200);
  f.state.T += 1;
  const expired = await req(f.base, `/live/${a.token}/data`);
  const unknown = await req(f.base, `/live/${'A'.repeat(43)}/data`);
  assert.equal(expired.status, 404);
  assert.equal(expired.text, unknown.text);
  assert.deepEqual(Object.fromEntries(Object.entries(expired.headers).filter(([k]) => k !== 'date' && k !== 'etag')), Object.fromEntries(Object.entries(unknown.headers).filter(([k]) => k !== 'date' && k !== 'etag')));
  const again = await f.live();
  assert.notEqual(again.token, a.token);
  f.close();
});

test('DELETE revoga (204), é idempotente e o link deixa de funcionar; missão inexistente 404', async () => {
  const f = await fixture();
  const a = await f.live();
  const d = await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' });
  assert.equal(d.status, 204);
  assert.equal((await req(f.base, `/live/${a.token}/data`)).status, 404);
  assert.equal((await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' })).status, 204);
  assert.equal((await req(f.base, '/api/missions/mis_nao_existe/live-link', { method: 'DELETE' })).status, 404);
  assert.notEqual((await f.live()).token, a.token);
  f.close();
});

test('revokeForMission e remoção da missão descartam o link', async () => {
  const f = await fixture();
  const a = await f.live('mis_aaaa1111'), b = await f.live('mis_bbbb2222');
  assert.equal(f.ctl.revokeForMission('mis_aaaa1111'), true);
  assert.equal(f.ctl.revokeForMission('mis_aaaa1111'), false);
  assert.equal((await req(f.base, `/live/${a.token}/data`)).status, 404);
  f.missions.delete('mis_bbbb2222'); // removida sem o gancho: o acesso também falha
  assert.equal((await req(f.base, `/live/${b.token}/data`)).status, 404);
  f.close();
});

test('teto de links ativos: o excedente recebe 409; liberar um permite cunhar outro; links expirados não contam', async () => {
  const f = await fixture({ maxLinks: 2, ttlMs: 5000 });
  await f.live('mis_aaaa1111'); await f.live('mis_bbbb2222');
  const x = await f.mint('mis_cccc3333'); assert.equal(x.status, 409); assert.match(x.json.error, /Limite/);
  await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' });
  assert.equal((await f.mint('mis_cccc3333')).status, 201);
  f.state.T += 5000; // todos expiram
  assert.equal((await f.mint('mis_dddd4444')).status, 201);
  f.close();
});

// ---------- Cabeçalhos, Host, métodos ----------
test('todas as respostas de /live levam os cabeçalhos e a CSP exatos, sem Set-Cookie nem CORS', async () => {
  const f = await fixture();
  assert.equal(LIVE_CSP, CSP_CONTRATO);
  const a = await f.live();
  const paths = ['/live/_/live.html', '/live/_/live.js', '/live/_/live-model.js', '/live/_/live.css', `/live/${a.token}/`, `/live/${a.token}/data`, `/live/${a.token}/report.md`, `/live/${a.token}`, `/live/${'B'.repeat(43)}/data`, '/live/_/nao-existe', '/live', '/live/'];
  for (const p of paths) {
    const r = await req(f.base, p, { headers: { origin: 'http://evil.example.com' } });
    for (const [k, v] of Object.entries(HEADERS_CONTRATO)) assert.equal(r.headers[k], v, `${p}: ${k}`);
    assert.equal(r.headers['set-cookie'], undefined, p);
    assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')), `${p}: CORS`);
    assert.ok(!r.headers['content-security-policy'].includes('unsafe'), p);
  }
  const bad = await req(f.base, '/live/_/live.html', { host: 'evil.example.com' }); // 403 e 405 também
  for (const [k, v] of Object.entries(HEADERS_CONTRATO)) assert.equal(bad.headers[k], v);
  const post = await req(f.base, `/live/${a.token}/data`, { method: 'POST' });
  for (const [k, v] of Object.entries(HEADERS_CONTRATO)) assert.equal(post.headers[k], v);
  const s = await sse(f.base, `/live/${a.token}/stream`);
  for (const [k, v] of Object.entries(HEADERS_CONTRATO)) assert.equal(s.headers[k], v, `stream: ${k}`);
  assert.match(s.headers['content-type'], /^text\/event-stream/);
  assert.equal(s.headers['set-cookie'], undefined);
  s.close(); f.close();
});

test('Host inválido: 403 em todas as rotas /live (inclusive estáticos e com token válido)', async () => {
  const f = await fixture();
  const a = await f.live();
  for (const host of ['evil.example.com', '127.0.0.1.evil.com', 'localhost:99999', '127.0.0.1:0080']) {
    for (const p of ['/live/_/live.html', `/live/${a.token}/`, `/live/${a.token}/data`, `/live/${a.token}/stream`, `/live/${a.token}/report.md`]) {
      assert.equal((await req(f.base, p, { host })).status, 403, `${host} ${p}`);
    }
  }
  assert.equal((await req(f.base, '/live/_/live.html', { host: 'localhost' })).status, 200); // localhost é permitido
  f.close();
});

test('só GET e HEAD: demais métodos 405 com Allow; HEAD responde sem corpo', async () => {
  const f = await fixture();
  const a = await f.live();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const p of ['/live/_/live.html', `/live/${a.token}/`, `/live/${a.token}/data`, `/live/${a.token}/stream`, '/live/x']) {
      const r = await req(f.base, p, { method, headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'GET' } });
      assert.equal(r.status, 405, `${method} ${p}`);
      assert.equal(r.headers.allow, 'GET, HEAD');
      assert.ok(!Object.keys(r.headers).some((k) => k.startsWith('access-control-')));
    }
  }
  const h = await req(f.base, `/live/${a.token}/data`, { method: 'HEAD' });
  assert.equal(h.status, 200); assert.equal(h.text, '');
  const hs = await req(f.base, `/live/${a.token}/stream`, { method: 'HEAD' });
  assert.equal(hs.status, 200); assert.equal(hs.text, '');
  f.close();
});

// ---------- Estáticos (allowlist) ----------
test('estáticos: os 4 nomes da allowlist servem os arquivos com o tipo certo; sem dados nem token', async () => {
  const f = await fixture();
  const exp = { 'live.html': 'text/html', 'live.js': 'text/javascript', 'live-model.js': 'text/javascript', 'live.css': 'text/css' };
  for (const [name, type] of Object.entries(exp)) {
    const r = await req(f.base, `/live/_/${name}`);
    assert.equal(r.status, 200, name);
    assert.ok(r.headers['content-type'].startsWith(type), `${name}: ${r.headers['content-type']}`);
    assert.equal(r.text, fs.readFileSync(path.join(staticDir, name), 'utf8'));
  }
  f.close();
});

test('estáticos: nada fora da allowlist e sem traversal (%2e%2e, %2f, barra invertida, nulo, maiúsculas)', async () => {
  const f = await fixture();
  fs.writeFileSync(path.join(staticDir, 'extra.txt'), SECRET);
  const bad = [
    '/live/_/..%2fsecret.txt', '/live/_/%2e%2e%2fsecret.txt', '/live/_/%2e%2e/secret.txt', '/live/_/../secret.txt', '/live/_/..\\secret.txt', '/live/_/..%5csecret.txt',
    '/live/_/%2e%2e%5csecret.txt', '/live/_/live.html%00', '/live/_/live.html/', '/live/_/LIVE.HTML', '/live/_/extra.txt', '/live/_/', '/live/_', '/live/_/live.js.map', '/live/_/./live.html', '/live/_/live.html%2f..%2fextra.txt',
    '/live/_/%2e%2e%2f%2e%2e%2fsecret.txt', '/live/..%2fsecret.txt', '/live/%2e%2e/_/live.html',
  ];
  for (const p of bad) {
    const r = await req(f.base, p);
    assert.ok(!r.text.includes(SECRET), `${p} vazou conteúdo`);
    assert.notEqual(r.status, 200, p);
  }
  f.close();
});

test('estático que ainda não existe em server/live responde 404 genérico (sem erro de sistema de arquivos)', async () => {
  const empty = path.join(root, 'vazio'); fs.mkdirSync(empty);
  const f = await fixture({ staticDir: empty });
  const r = await req(f.base, '/live/_/live.js');
  assert.equal(r.status, 404);
  assert.deepEqual(JSON.parse(r.text), { error: 'Link inválido ou expirado.' });
  assert.ok(!/ENOENT|vazio|orch-live/.test(r.text));
  f.close();
});

// ---------- Página, dados, relatório ----------
test('/live/<token> redireciona para a barra final; /live/<token>/ serve o HTML estático e nada de dados', async () => {
  const f = await fixture();
  const a = await f.live();
  const r = await req(f.base, `/live/${a.token}`);
  assert.equal(r.status, 302); assert.equal(r.headers.location, `/live/${a.token}/`);
  const p = await req(f.base, `/live/${a.token}/`);
  assert.equal(p.status, 200); assert.ok(p.headers['content-type'].startsWith('text/html'));
  assert.equal(p.text, fs.readFileSync(path.join(staticDir, 'live.html'), 'utf8'));
  assert.ok(!p.text.includes('Missão A') && !p.text.includes(a.token));
  assert.equal((await req(f.base, `/live/${'C'.repeat(43)}/`)).status, 404); // token inválido não vê nem a página
  assert.equal((await req(f.base, `/live/${'C'.repeat(43)}`)).status, 404);
  f.close();
});

test('/data: snapshot com o contexto certo, link.expiresAt, ETag e 304; muda o ETag quando o conteúdo muda; generatedAt não conta', async () => {
  const f = await fixture();
  const a = await f.live();
  const r = await req(f.base, `/live/${a.token}/data`);
  assert.equal(r.status, 200); assert.ok(r.headers['content-type'].startsWith('application/json'));
  const j = JSON.parse(r.text);
  assert.equal(j.schema, 1); assert.equal(j.mission.title, 'Missão A');
  assert.equal(j.link.expiresAt, a.expiresAt);
  assert.deepEqual(j.seen, { ws: 'proj', wt: 1, squad: [{ id: 'sq1' }], delivery: { code: 'delivered' } });
  assert.equal(f.state.lastNow, new Date(f.state.T).toISOString(), 'ctx.now vem do relógio injetável (ISO)');
  assert.ok(!r.text.includes('mis_aaaa1111'), 'o id da missão não vai ao navegador via este módulo');
  const etag = r.headers.etag; assert.ok(etag);
  f.state.T += 5000; // só generatedAt/now mudam
  const nm = await req(f.base, `/live/${a.token}/data`, { headers: { 'if-none-match': etag } });
  assert.equal(nm.status, 304); assert.equal(nm.text, '');
  assert.equal(nm.headers['cache-control'], 'no-store');
  f.state.rev = 2;
  const ch = await req(f.base, `/live/${a.token}/data`, { headers: { 'if-none-match': etag } });
  assert.equal(ch.status, 200); assert.notEqual(ch.headers.etag, etag);
  f.close();
});

test('cache de 1 s por missão: duas leituras seguidas montam a visão uma vez; passado o prazo, de novo', async () => {
  const f = await fixture({ timing: { cacheMs: 300 } }); // o cache envelhece em tempo real (não pelo relógio injetável)
  const a = await f.live();
  await req(f.base, `/live/${a.token}/data`); await req(f.base, `/live/${a.token}/data`);
  assert.equal(f.state.builds, 1);
  await sleep(350); await req(f.base, `/live/${a.token}/data`);
  assert.equal(f.state.builds, 2);
  f.close();
});

test('/report.md: download em attachment com o texto do liveMarkdown e nome sem id', async () => {
  const f = await fixture();
  const a = await f.live();
  const r = await req(f.base, `/live/${a.token}/report.md`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'], /^attachment; filename="[A-Za-z0-9._-]+\.md"$/);
  assert.ok(!r.headers['content-disposition'].includes('mis_'));
  assert.ok(r.headers['content-type'].startsWith('text/markdown'));
  assert.equal(r.text, '# Missão A\n\nrev 1\n');
  f.close();
});

test('visão que lança, passa de 256 KB ou não existe: 503 genérico, sem detalhe interno e sem derrubar o servidor', async () => {
  const f1 = await fixture({ throwView: true });
  const a1 = await f1.live();
  const r1 = await req(f1.base, `/live/${a1.token}/data`);
  assert.equal(r1.status, 503); assert.ok(!/falha interna|mis_/.test(r1.text));
  assert.equal((await req(f1.base, `/live/${a1.token}/report.md`)).status, 503);
  f1.close();
  const f2 = await fixture({ big: true });
  const a2 = await f2.live();
  assert.equal((await req(f2.base, `/live/${a2.token}/data`)).status, 503);
  f2.close();
  const f3 = await fixture({ view: {} }); // sem buildLiveView
  const a3 = await f3.live();
  assert.equal((await req(f3.base, `/live/${a3.token}/data`)).status, 503);
  assert.equal((await req(f3.base, `/live/${a3.token}/`)).status, 200); // a página estática independe da visão
  f3.close();
});

test('falhas por minuto: acima do teto vira 429 (inclusive com token válido) até a janela virar; formato inválido também conta', async () => {
  const f = await fixture({ timing: { maxFailures: 3 } });
  const a = await f.live();
  for (const t of ['A'.repeat(43), 'curto', `${'A'.repeat(42)}%2f`]) assert.equal((await req(f.base, `/live/${t}/data`)).status, 404);
  const blocked = await req(f.base, `/live/${a.token}/data`);
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers['retry-after']) >= 1);
  assert.ok(!blocked.text.includes(a.token));
  assert.equal((await req(f.base, '/live/_/live.html')).status, 200, 'estáticos não dependem do contador');
  f.state.T += 60_000;
  assert.equal((await req(f.base, `/live/${a.token}/data`)).status, 200);
  f.close();
});

// ---------- SSE ----------
test('SSE: snapshot inicial; só reenvia quando muda; evento de OUTRA missão não dispara; coalesce rajadas', async () => {
  const f = await fixture();
  const a = await f.live('mis_aaaa1111');
  const s = await sse(f.base, `/live/${a.token}/stream`);
  assert.equal(s.status, 200);
  assert.ok(await until(() => s.events.length === 1));
  assert.equal(s.events[0].event, 'snapshot'); assert.equal(s.events[0].data.mission.title, 'Missão A'); assert.ok(s.raw.startsWith('retry: 3000'));
  const builds0 = f.state.builds;
  for (let i = 0; i < 5; i++) f.bus.emit('log', { missionId: 'mis_bbbb2222', line: 'x' }); // outra missão
  f.bus.emit('state', {}); // sem missionId
  await sleep(150);
  assert.equal(f.state.builds, builds0, 'eventos de outra missão não montam a visão');
  for (let i = 0; i < 20; i++) f.bus.emit('log', { missionId: 'mis_aaaa1111', line: `l${i}` }); // rajada, MAS nada mudou no conteúdo
  await sleep(150);
  assert.equal(s.events.length, 1, 'sem mudança, nada é enviado');
  f.state.rev = 2;
  for (let i = 0; i < 20; i++) f.bus.emit('log', { missionId: 'mis_aaaa1111', line: `m${i}` });
  assert.ok(await until(() => s.events.length === 2));
  await sleep(150);
  assert.equal(s.events.length, 2, 'a rajada de 20 eventos virou um único envio');
  assert.equal(s.events[1].data.rev, 2);
  s.close(); f.close();
});

test('SSE: coalescência limita a 1 leitura por intervalo mesmo com mudanças a cada evento', async () => {
  const f = await fixture({ timing: { coalesceMs: 200 } });
  const a = await f.live();
  const s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < 450) { f.state.rev += 1; f.bus.emit('task', { missionId: 'mis_aaaa1111' }); n += 1; await sleep(5); }
  await sleep(300);
  assert.ok(n > 20);
  assert.ok(s.events.length - 1 <= 4, `esperado ~2-3 envios em 450 ms, veio ${s.events.length - 1}`);
  assert.equal(s.events.at(-1).data.rev, f.state.rev, 'o último estado chega');
  s.close(); f.close();
});

test('SSE: o timer de segurança pega mudanças sem evento (squad/Maestro)', async () => {
  const f = await fixture({ timing: { tickMs: 50 } });
  const a = await f.live();
  const s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  f.state.rev = 7;
  assert.ok(await until(() => s.events.length === 2));
  assert.equal(s.events[1].data.rev, 7);
  s.close(); f.close();
});

test('SSE: heartbeat periódico', async () => {
  const f = await fixture({ timing: { heartbeatMs: 40 } });
  const a = await f.live();
  const s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.pings >= 2));
  s.close(); f.close();
});

test('SSE: os listeners do bus voltam ao nível inicial ao fechar (um e vários clientes)', async () => {
  const f = await fixture();
  const a = await f.live();
  const base0 = listeners(f.bus);
  const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await sse(f.base, `/live/${a.token}/stream`));
  assert.ok(await until(() => cs.every((c) => c.events.length === 1)));
  assert.deepEqual(listeners(f.bus), base0.map((n) => n + 3));
  for (const c of cs) c.close();
  assert.ok(await until(() => listeners(f.bus).every((n, i) => n === base0[i])), `listeners: ${listeners(f.bus)}`);
  f.close();
});

test('SSE: tetos de 3 por link e 10 globais respondem 429 sem abrir stream; fechar libera vaga', async () => {
  const f = await fixture();
  const A = await f.live('mis_aaaa1111'), B = await f.live('mis_bbbb2222'), C = await f.live('mis_cccc3333'), D = await f.live('mis_dddd4444');
  const base0 = listeners(f.bus);
  const open = [];
  for (const l of [A, A, A]) open.push(await sse(f.base, `/live/${l.token}/stream`));
  const over = await sse(f.base, `/live/${A.token}/stream`);
  assert.equal(over.status, 429); assert.ok(!over.raw.includes(A.token)); assert.equal(over.events.length, 0);
  for (const l of [B, B, B, C, C, C, D]) open.push(await sse(f.base, `/live/${l.token}/stream`)); // 10 no total
  assert.ok(open.every((c) => c.status === 200));
  const glob = await sse(f.base, `/live/${D.token}/stream`);
  assert.equal(glob.status, 429, 'global');
  assert.deepEqual(listeners(f.bus), base0.map((n) => n + 10), 'o 429 não deixa listener');
  open[0].close();
  assert.ok(await until(async () => (await sse(f.base, `/live/${D.token}/stream`).then((c) => { const ok = c.status === 200; c.close(); return ok; }))));
  for (const c of open) c.close();
  f.close();
});

test('SSE: event: end ao revogar, ao expirar (tick) e ao remover a missão; sem listeners sobrando', async () => {
  const f = await fixture({ timing: { tickMs: 40 } });
  const base0 = listeners(f.bus);
  // revogar
  let a = await f.live('mis_aaaa1111'); let s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' });
  assert.ok(await until(() => s.events.at(-1)?.event === 'end' && s.ended));
  assert.deepEqual(s.events.at(-1).data, { reason: 'revoked' });
  // expirar
  a = await f.live('mis_aaaa1111'); s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  f.state.T += 13 * 3600 * 1000;
  assert.ok(await until(() => s.events.at(-1)?.event === 'end' && s.ended));
  assert.deepEqual(s.events.at(-1).data, { reason: 'expired' });
  // missão removida (com o gancho e sem ele)
  a = await f.live('mis_bbbb2222'); s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  f.ctl.revokeForMission('mis_bbbb2222');
  assert.ok(await until(() => s.events.at(-1)?.event === 'end' && s.ended));
  assert.deepEqual(s.events.at(-1).data, { reason: 'removed' });
  a = await f.live('mis_cccc3333'); s = await sse(f.base, `/live/${a.token}/stream`);
  assert.ok(await until(() => s.events.length === 1));
  f.missions.delete('mis_cccc3333');
  assert.ok(await until(() => s.events.at(-1)?.event === 'end' && s.ended));
  assert.deepEqual(s.events.at(-1).data, { reason: 'removed' });
  assert.ok(await until(() => listeners(f.bus).every((n, i) => n === base0[i])));
  f.close();
});

test('SSE: token inexistente/expirado recebe o mesmo 404 e não abre stream', async () => {
  const f = await fixture();
  const s = await sse(f.base, `/live/${'D'.repeat(43)}/stream`);
  assert.equal(s.status, 404); assert.deepEqual(JSON.parse(s.raw), { error: 'Link inválido ou expirado.' });
  f.close();
});

// ---------- Segredo e ORCH_LIVE=off ----------
test('o token não aparece em console, respostas de erro nem nos cabeçalhos de falha', async () => {
  const f = await fixture();
  const logs = []; const orig = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) { orig[k] = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(' ')); }; }
  let a, texts = [];
  try {
    a = await f.live();
    for (const p of [`/live/${a.token}/nao-existe`, `/live/${a.token}/data/extra`, `/live/${a.token}/x/y`]) { const r = await req(f.base, p); texts.push(r.text, JSON.stringify(r.headers)); }
    const m = await req(f.base, `/live/${a.token}/data`, { method: 'POST' }); texts.push(m.text, JSON.stringify(m.headers));
    const h = await req(f.base, `/live/${a.token}/data`, { host: 'evil.com' }); texts.push(h.text, JSON.stringify(h.headers));
    const bad = await req(f.base, `/live/${a.token}x/data`); texts.push(bad.text);
    const d = await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' }); texts.push(d.text, JSON.stringify(d.headers));
    const gone = await req(f.base, `/live/${a.token}/data`); texts.push(gone.text, JSON.stringify(gone.headers));
  } finally { Object.assign(console, orig); }
  assert.ok(a.token.length === 43);
  assert.ok(texts.every((t) => !t.includes(a.token)), 'token em resposta de erro');
  assert.ok(logs.every((l) => !l.includes(a.token)), 'token em console');
  f.close();
});

test('ORCH_LIVE=off: /live responde 404 em tudo, POST e DELETE 404 com mensagem clara, e nenhum link é cunhado', async () => {
  for (const off of ['off', 'OFF', ' off ']) {
    const f = await fixture({ env: { ORCH_LIVE: off } });
    for (const p of ['/live/_/live.html', `/live/${'E'.repeat(43)}/`, `/live/${'E'.repeat(43)}/data`, `/live/${'E'.repeat(43)}/stream`]) assert.equal((await req(f.base, p)).status, 404, p);
    const r = await f.mint('mis_aaaa1111'); assert.equal(r.status, 404); assert.match(r.json.error, /ORCH_LIVE=off/);
    const d = await req(f.base, '/api/missions/mis_aaaa1111/live-link', { method: 'DELETE' }); assert.equal(d.status, 404); assert.match(d.text, /desligado/);
    f.close();
  }
  const on = await fixture({ env: { ORCH_LIVE: 'on' } }); // qualquer outro valor mantém ligado
  assert.equal((await on.mint('mis_aaaa1111')).status, 201); on.close();
});

test('rotas fora de /live não são afetadas: o que o setup não atende cai para o próximo handler', async () => {
  const f = await fixture();
  const r = await req(f.base, '/outra-coisa'); assert.equal(r.status, 418);
  const l = await req(f.base, '/live'); assert.equal(l.status, 404); // /live nunca cai no próximo handler (SPA)
  f.close();
});
