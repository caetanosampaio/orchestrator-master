// Link de acompanhamento ao vivo no cliente (client/src/live-link.js + MissionLiveButton): lógica pura com fetch/window/navigator/document falsos.
// Sem rede, sem servidor e sem tocar `data/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  mintLiveLink, revokeLiveLink, describeLinkState, openLiveLink, copyText, safeLiveUrl, expiryMs, failureFromResponse, LIVE_MESSAGES, LIVE_OPEN_FEATURES,
} from '../../client/src/live-link.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const TOKEN = 'abcDEF0123456789_-abcDEF0123456789_-abcDEF012';
const URL_OK = `http://127.0.0.1:4317/live/${TOKEN}/`;
const BASE = 'http://127.0.0.1:4317/';

// fetch falso: registra chamadas e responde `{status, body}` (body objeto -> json(); null -> json() rejeita, como HTML de 404).
const fakeFetch = (status, body) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return { status, json: async () => { if (body === null) throw new SyntaxError('not json'); return body; } }; };
  f.calls = calls; return f;
};
const failingFetch = async () => { throw new TypeError('Failed to fetch'); };

test('mintLiveLink: POST na rota da missão, 201 devolve {url, expiresAt}', async () => {
  const f = fakeFetch(201, { url: URL_OK, expiresAt: '2026-11-11T22:00:00.000Z' });
  const r = await mintLiveLink('m 1/x', { fetchImpl: f, base: BASE });
  assert.deepEqual(r, { ok: true, link: { url: URL_OK, expiresAt: '2026-11-11T22:00:00.000Z' } });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/missions/m%201%2Fx/live-link', 'o id é codificado no caminho');
  assert.equal(f.calls[0].init.method, 'POST');
});

test('mintLiveLink: url relativa é resolvida contra a origem; esquemas perigosos e caminhos fora de /live/ são rejeitados', async () => {
  const rel = await mintLiveLink('m1', { fetchImpl: fakeFetch(201, { url: `/live/${TOKEN}/`, expiresAt: null }), base: BASE });
  assert.equal(rel.ok, true); assert.equal(rel.link.url, URL_OK); assert.equal(rel.link.expiresAt, null);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://127.0.0.1/live/x/', 'http://127.0.0.1:4317/api/state', '', 42, null, undefined, `http://x/${'a'.repeat(3000)}`]) {
    const r = await mintLiveLink('m1', { fetchImpl: fakeFetch(201, { url: bad, expiresAt: null }), base: BASE });
    assert.equal(r.ok, false, String(bad).slice(0, 30)); assert.equal(r.kind, 'bad_response');
  }
  assert.equal(safeLiveUrl('/live/x/', undefined), null, 'relativa sem base não é aceita');
});

test('mintLiveLink: expiresAt inválido vira null (validade desconhecida), não derruba a resposta', async () => {
  const r = await mintLiveLink('m1', { fetchImpl: fakeFetch(201, { url: URL_OK, expiresAt: 'ontem' }), base: BASE });
  assert.equal(r.ok, true); assert.equal(r.link.expiresAt, null);
});

test('mintLiveLink: 403, 404 (rota ausente e missão ausente), 409, 429, 500 e rede têm mensagem amigável em PT-BR', async () => {
  const cases = [
    [403, { error: 'origem não permitida' }, 'forbidden', LIVE_MESSAGES.forbidden],
    [404, null, 'missing_route', LIVE_MESSAGES.missing_route],
    [404, { error: 'Missão não encontrada.' }, 'not_found', LIVE_MESSAGES.not_found],
    [429, { error: 'too many' }, 'rate_limited', LIVE_MESSAGES.rate_limited],
    [500, { error: 'boom' }, 'server', LIVE_MESSAGES.server],
  ];
  for (const [status, body, kind, message] of cases) {
    const r = await mintLiveLink('m1', { fetchImpl: fakeFetch(status, body), base: BASE });
    assert.equal(r.ok, false); assert.equal(r.kind, kind, `${status}`); assert.equal(r.status, status); assert.equal(r.message, message);
  }
  assert.match(LIVE_MESSAGES.missing_route, /Reinicie o servidor/);
  const c = await mintLiveLink('m1', { fetchImpl: fakeFetch(409, { error: 'Missão demonstrativa não tem link.' }), base: BASE });
  assert.equal(c.kind, 'conflict'); assert.equal(c.message, 'Missão demonstrativa não tem link.');
  const c2 = await mintLiveLink('m1', { fetchImpl: fakeFetch(409, {}), base: BASE });
  assert.equal(c2.message, LIVE_MESSAGES.conflict);
  const n = await mintLiveLink('m1', { fetchImpl: failingFetch, base: BASE });
  assert.deepEqual([n.ok, n.kind, n.message], [false, 'network', LIVE_MESSAGES.network]);
  for (const m of Object.values(LIVE_MESSAGES)) assert.ok(m.length > 20 && !/undefined|\[object/.test(m));
});

test('recusa por ORCH_LIVE=off (código ou texto, em qualquer status) tem mensagem própria', async () => {
  for (const [status, body] of [[403, { code: 'live_disabled' }], [404, { error: 'Acompanhamento ao vivo desligado (ORCH_LIVE=off).' }], [503, { error: 'indisponível' }]]) {
    const r = await mintLiveLink('m1', { fetchImpl: fakeFetch(status, body), base: BASE });
    assert.equal(r.kind, 'disabled', String(status)); assert.match(r.message, /ORCH_LIVE=off/);
  }
});

test('mensagem do servidor com URL ou /live/ não é repassada (o token nunca chega à tela por erro)', () => {
  assert.equal(failureFromResponse(409, { error: `veja http://x/live/${TOKEN}/` }).message, LIVE_MESSAGES.conflict);
  assert.equal(failureFromResponse(409, { error: `link ${TOKEN} /live/ x` }).message, LIVE_MESSAGES.conflict);
  assert.equal(failureFromResponse(409, { error: 'x'.repeat(500) }).message, LIVE_MESSAGES.conflict);
  assert.equal(failureFromResponse(418, null).kind, 'bad_response');
  for (const k of ['forbidden', 'missing_route', 'not_found', 'conflict', 'rate_limited', 'server', 'network', 'bad_response', 'disabled']) assert.ok(!LIVE_MESSAGES[k].includes(TOKEN));
});

test('revokeLiveLink: DELETE; 204 ok; 404 com erro JSON = já não existe; falhas viram mensagem', async () => {
  const f = fakeFetch(204, {});
  assert.deepEqual(await revokeLiveLink('m1', { fetchImpl: f }), { ok: true });
  assert.equal(f.calls[0].url, '/api/missions/m1/live-link'); assert.equal(f.calls[0].init.method, 'DELETE');
  assert.deepEqual(await revokeLiveLink('m1', { fetchImpl: fakeFetch(404, { error: 'não encontrada' }) }), { ok: true, already: true });
  const miss = await revokeLiveLink('m1', { fetchImpl: fakeFetch(404, null) });
  assert.equal(miss.ok, false); assert.equal(miss.kind, 'missing_route');
  assert.equal((await revokeLiveLink('m1', { fetchImpl: fakeFetch(403, {}) })).kind, 'forbidden');
  assert.equal((await revokeLiveLink('m1', { fetchImpl: fakeFetch(500, {}) })).kind, 'server');
  assert.equal((await revokeLiveLink('m1', { fetchImpl: failingFetch })).kind, 'network');
});

test('describeLinkState: sem link, ativo ("HH:MM"), outro dia, validade desconhecida e expirado por expiresAt', () => {
  const now = new Date(2026, 10, 11, 10, 0, 0).getTime(); // horário local, independe do fuso da máquina
  assert.equal(describeLinkState(null, now).status, 'none');
  assert.equal(describeLinkState({}, now).status, 'none');
  const today = describeLinkState({ url: URL_OK, expiresAt: new Date(2026, 10, 11, 18, 5).toISOString() }, now);
  assert.deepEqual([today.status, today.until, today.msLeft], ['active', '18:05', 8 * 3600e3 + 5 * 60e3]);
  const next = describeLinkState({ url: URL_OK, expiresAt: new Date(2026, 10, 12, 9, 7).getTime() }, now);
  assert.equal(next.status, 'active'); assert.equal(next.until, '12/11 09:07');
  const unknown = describeLinkState({ url: URL_OK, expiresAt: null }, now);
  assert.deepEqual([unknown.status, unknown.until], ['active', null]);
  const exp = new Date(2026, 10, 11, 10, 0, 0).toISOString();
  assert.equal(describeLinkState({ url: URL_OK, expiresAt: exp }, now).status, 'expired', 'no instante exato já expirou');
  assert.equal(describeLinkState({ url: URL_OK, expiresAt: exp }, now - 1).status, 'active');
  assert.deepEqual(describeLinkState({ url: URL_OK, expiresAt: new Date(now - 5000).toISOString() }, now), { status: 'expired', until: null, msLeft: 0 });
  assert.equal(expiryMs(''), null); assert.equal(expiryMs('x'), null); assert.equal(expiryMs(5), 5);
});

test('openLiveLink: abre com _blank e noopener,noreferrer; falha/ausência vira "blocked"', () => {
  const calls = [];
  const win = { open: (...a) => { calls.push(a); return null; } }; // com noopener o retorno é sempre null mesmo com sucesso
  assert.equal(openLiveLink(URL_OK, win), 'requested');
  assert.deepEqual(calls, [[URL_OK, '_blank', 'noopener,noreferrer']]);
  assert.equal(LIVE_OPEN_FEATURES, 'noopener,noreferrer');
  assert.equal(openLiveLink(URL_OK, { open() { throw new Error('negado'); } }), 'blocked');
  assert.equal(openLiveLink(URL_OK, {}), 'blocked'); assert.equal(openLiveLink(URL_OK, null), 'blocked'); assert.equal(openLiveLink('', win), 'blocked');
});

test('copyText: usa a Clipboard API; sem ela (ou negada) cai no textarea+execCommand e o remove; sem nada devolve false', async () => {
  const written = [];
  assert.equal(await copyText(URL_OK, { nav: { clipboard: { writeText: async (t) => { written.push(t); } } }, doc: null }), true);
  assert.deepEqual(written, [URL_OK]);

  const mkDoc = (exec) => {
    const body = { kids: [], appendChild(n) { n.parentNode = body; this.kids.push(n); }, removeChild(n) { this.kids = this.kids.filter((k) => k !== n); } };
    return { body, createElement: () => ({ style: {}, setAttribute() {}, select() { this.selected = true; } }), execCommand: (c) => { assert.equal(c, 'copy'); return exec; } };
  };
  const doc = mkDoc(true);
  assert.equal(await copyText(URL_OK, { nav: { clipboard: { writeText: async () => { throw new Error('negado'); } } }, doc }), true, 'cai no fallback quando a API nega');
  assert.equal(doc.body.kids.length, 0, 'o textarea temporário (com o link) é removido');
  assert.equal(await copyText(URL_OK, { nav: {}, doc: mkDoc(true) }), true);
  assert.equal(await copyText(URL_OK, { nav: {}, doc: mkDoc(false) }), false);
  assert.equal(await copyText(URL_OK, { nav: {}, doc: null }), false);
  assert.equal(await copyText('', { nav: { clipboard: { writeText: async () => {} } } }), false);
});

test('componente e página: montagem mínima, URL só em memória, sem console/localStorage/atributos com o token', () => {
  const comp = src('components/MissionLiveButton.jsx'), lib = src('live-link.js'), css = src('mission-live.css');
  for (const [name, text] of [['MissionLiveButton.jsx', comp], ['live-link.js', lib]]) {
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(text), `${name} não persiste a URL`);
    assert.ok(!/console\./.test(text), `${name} não loga`);
    assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(text), `${name} sem HTML cru`);
  }
  assert.ok(!/data-[a-z-]+=\{[^}]*(url|link)/i.test(comp), 'nenhum data-* recebe a URL');
  assert.ok(!/title=\{[^}]*link\.url|aria-label=\{[^}]*link\.url/.test(comp), 'título/aria não recebem a URL');
  assert.match(comp, /import '\.\.\/mission-live\.css'/);
  assert.match(comp, /mission\?\.demo/); assert.match(comp, /Acompanhar no navegador/); assert.match(comp, /Copiar link/); assert.match(comp, /Encerrar link/);
  assert.match(comp, /role="alert"/); assert.match(comp, /readOnly/);
  assert.match(css, /prefers-reduced-motion/); assert.ok(!/box-shadow|drop-shadow|text-shadow/.test(css), 'sem glow');
  const page = src('pages/Missions.jsx');
  assert.match(page, /import MissionLiveButton from '\.\.\/components\/MissionLiveButton\.jsx'/);
  assert.match(page, /<MissionLiveButton key=\{mission\.id\} mission=\{mission\} \/>/);
  assert.ok(page.indexOf('<MissionPanel ') < page.indexOf('<MissionLiveButton') && page.indexOf('<MissionLiveButton') < page.indexOf('<ControlBar '), 'entre MissionPanel e ControlBar');
});
