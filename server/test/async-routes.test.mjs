// asyncRoute (async-route.js): rota assíncrona que lança devolve 500 estruturado, sem rejeição não tratada e sem derrubar o processo.
// Express LOCAL em porta aleatória (o index.js/servidor real nunca é importado); nenhum banco é usado.
import test, { mock, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: express } = await import('express');
const { asyncRoute } = await import('../async-route.js');

const unhandled = [];
const onUnhandled = (e) => unhandled.push(e);
process.on('unhandledRejection', onUnhandled);
let server, base;

before(async () => {
  const app = express(); app.use(express.json());
  app.post('/teste/lanca-depois-de-responder', asyncRoute(async (req, res) => { res.status(200).write('parcial'); throw new Error('depois dos cabeçalhos'); }));
  app.post('/teste/lanca-sincrono', asyncRoute(() => { throw new Error('síncrono'); }));
  app.post('/teste/rejeita', asyncRoute(async () => { throw new Error('C:\\caminho\\interno explodiu'); }));
  app.post('/teste/ok', asyncRoute(async (req, res) => res.status(201).json({ ok: true })));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { process.off('unhandledRejection', onUnhandled); mock.restoreAll(); server.close(); server.closeAllConnections?.(); });

const post = (p) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const quiet = () => mock.method(console, 'error', () => {});
const expect500 = async (res) => {
  assert.equal(res.status, 500); assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json(); assert.deepEqual(body, { error: 'Erro interno.' }); assert.ok(!JSON.stringify(body).includes('caminho'), 'a resposta não vaza detalhes internos');
};
const stillAlive = async () => assert.equal((await post('/teste/ok')).status, 201, 'o servidor continua respondendo normalmente');

test('asyncRoute: rejeição assíncrona vira 500 estruturado, sem rejeição não tratada; resposta normal preservada', async () => {
  quiet();
  await expect500(await post('/teste/rejeita'));
  mock.restoreAll();
  const ok = await post('/teste/ok'); assert.equal(ok.status, 201); assert.deepEqual(await ok.json(), { ok: true });
  assert.deepEqual(unhandled, []);
});

test('asyncRoute: erro depois de começar a responder não gera segunda resposta nem pendura; erro síncrono também vira 500', async () => {
  quiet();
  const r = await post('/teste/lanca-depois-de-responder'); assert.equal(r.status, 200); assert.equal(await r.text(), 'parcial');
  await expect500(await post('/teste/lanca-sincrono'));
  mock.restoreAll(); assert.deepEqual(unhandled, []); await stillAlive();
});
