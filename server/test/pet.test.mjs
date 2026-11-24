// Bichinho do FORGE (estilo Tamagotchi): a mecânica pura (client/src/pet.js) e o servidor (server/pet.js: formato, rotas, petiscos deduplicados, rollback).
// ORCH_DATA_DIR temporário; o servidor de teste sobe numa porta própria com banco em memória (nunca o banco real).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-pet-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const P = await import('../../client/src/pet.js');
const { validatePetState, readPet, setupPet, MAX_TREATS } = await import('../pet.js');
const { default: express } = await import('express');

const T0 = Date.parse('2026-11-24T12:00:00.000Z'), MIN = 60_000, H = 60 * MIN, D = 24 * H;
const hatched = (over = {}) => ({ ...P.tick(P.newPet(T0), T0 + P.TIMING.hatch), ...over });

test('ovo: choca 45 s depois de aparecer; antes disso nada corre', () => {
  const egg = P.newPet(T0);
  assert.equal(egg.stage, 'egg'); assert.equal(P.mood(egg).id, 'egg');
  assert.equal(P.tick(egg, T0 + 30_000).stage, 'egg');
  const b = P.tick(egg, T0 + P.TIMING.hatch);
  assert.equal(b.stage, 'baby'); assert.equal(b.bornAt, new Date(T0 + P.TIMING.hatch).toISOString());
  assert.deepEqual([b.hunger, b.joy, b.energy, b.poops], [4, 4, 4, 0]);
});

test('o tempo corre: fome, alegria, energia e sujeira caem nas taxas definidas; dormindo, quase para e a energia volta', () => {
  const b = hatched();
  const t = (ms) => P.tick(b, Date.parse(b.at) + ms);
  assert.equal(t(P.TIMING.hunger - MIN).hunger, 4); assert.equal(t(P.TIMING.hunger).hunger, 3);
  assert.equal(t(P.TIMING.joy).joy, 3); assert.equal(t(P.TIMING.energy).energy, 3); assert.equal(t(P.TIMING.poop).poops, 1);
  const s = P.tick({ ...b, asleep: true, energy: 1 }, Date.parse(b.at) + 2 * H);
  assert.equal(s.energy, 4, 'dormindo recupera 1 a cada 30 min'); assert.equal(s.hunger, 4, 'e a fome cai 4x mais devagar');
  const woke = P.tick({ ...b, asleep: true }, Date.parse(b.at) + 2 * H + MIN); assert.equal(woke.asleep, false, 'energia cheia e 2 h dormindo: acorda sozinho');
  assert.equal(t(30_000).at, b.at, 'menos de 1 minuto não avança o relógio (sem perder frações)');
});

test('descuido: fome zerada conta erro e derruba o cuidado; sujeira demais ou fome longa deixam doente', () => {
  const b = hatched({ hunger: 1 });
  const h = P.tick(b, Date.parse(b.at) + P.TIMING.hunger);
  assert.equal(h.hunger, 0); assert.equal(h.mistakes, 1); assert.ok(h.care < b.care);
  const starving = P.tick(b, Date.parse(b.at) + P.TIMING.hunger + P.TIMING.starveSick);
  assert.equal(starving.sick, true, 'fome zerada por 4 h = doente');
  const dirty = P.tick(hatched({ poops: 3, hunger: 4 }), Date.parse(b.at) + P.TIMING.dirtySick);
  assert.equal(dirty.sick, true, '3 sujeiras por 1 h = doente');
  assert.equal(P.mood(dirty).id, 'sick'); assert.ok(P.mood(dirty).needs.includes('remedio'));
});

test('cresce: criança com 1 dia, adulto com 3; a forma adulta segue o cuidado; ausência longa conta no máximo 7 dias', () => {
  const b = hatched(), born = Date.parse(b.bornAt);
  const kid = P.fastForward(b, D + MIN, born); assert.equal(kid.stage, 'child');
  const keep = (p) => ({ ...p, hunger: 4, joy: 4, energy: 4, poops: 0, sick: false });
  let p = b; for (let i = 0; i < 4 * 24; i++) p = keep(P.tick(p, born + (i + 1) * H)); // cuidado constante: nunca zera nada
  assert.equal(p.stage, 'adult'); assert.equal(p.form, 'curioso', 'cuidado médio (50) = curioso');
  assert.equal(P.tick({ ...b, care: 90 }, born + 3 * D + MIN).form, 'radiante');
  const far = P.tick(b, Date.parse(b.at) + 30 * D); assert.ok(Date.parse(far.at) >= Date.parse(b.at) + 30 * D - 7 * D - MIN, 'no máximo 7 dias de atraso são processados');
});

test('ações: comer, petisco, limpar, remédio, luz e carinho; cada uma recusa o que não faz sentido', () => {
  const b = hatched({ hunger: 2, joy: 1, poops: 2 });
  const meal = P.feedMeal(b); assert.equal(meal.ok, true); assert.equal(meal.pet.hunger, 3); assert.equal(meal.effect, 'eat');
  const full = P.feedMeal({ ...b, hunger: 4 }); assert.equal(full.ok, false); assert.match(full.message, /cheio/); assert.equal(full.pet.weight, b.weight + 1, 'comer cheio engorda');
  assert.equal(P.feedMeal({ ...b, asleep: true }).ok, false); assert.equal(P.feedMeal({ ...b, sick: true }).ok, false); assert.equal(P.feedMeal(P.newPet(T0)).ok, false, 'no ovo, não');
  assert.equal(P.feedTreat(b).pet.joy, 3);
  assert.equal(P.clean(b).pet.poops, 0); assert.equal(P.clean({ ...b, poops: 0 }).ok, false);
  assert.equal(P.medicine(b).ok, false); assert.equal(P.medicine({ ...b, sick: true }).pet.sick, false);
  const night = P.toggleLight(b); assert.equal(night.pet.asleep, true); assert.equal(night.effect, 'sleep'); assert.equal(P.toggleLight(night.pet).pet.asleep, false);
  const love = P.pat(b, T0 + H); assert.equal(love.pet.joy, 2); assert.equal(love.effect, 'love');
  const again = P.pat(love.pet, T0 + H + MIN); assert.equal(again.pet.joy, 2, 'carinho seguido só faz rir'); assert.equal(again.effect, 'giggle');
  assert.equal(P.pat(love.pet, T0 + H + P.TIMING.pat).pet.joy, 3);
  assert.equal(P.rename(b, '  Brasinha\u0000 de fogo muito comprida demais ').name, 'Brasinha de fogo mui');
});

test('joguinho "Para que lado?": 5 rodadas; 3 acertos ganham alegria e emagrecem', () => {
  let g = P.newGame();
  for (const [guess, actual] of [['left', 'left'], ['right', 'left'], ['right', 'right'], ['left', 'left'], ['left', 'right']]) g = P.playRound(g, guess, actual);
  assert.deepEqual([g.round, g.hits, g.over], [5, 3, true]); assert.equal(P.playRound(g, 'left', 'left'), g, 'acabou: não conta mais');
  const b = hatched({ joy: 2 }), w = P.finishGame(b, g);
  assert.deepEqual([w.won, w.pet.joy, w.pet.weight, w.pet.games, w.pet.wins], [true, 3, b.weight - 1, 1, 1]);
  const l = P.finishGame(b, { ...g, hits: 2 }); assert.deepEqual([l.won, l.pet.joy, l.pet.games, l.pet.wins], [false, 2, 1, 0]);
  assert.equal(P.canPlay({ ...b, energy: 0 }).ok, false); assert.equal(P.canPlay({ ...b, sick: true }).ok, false); assert.equal(P.canPlay(b).ok, true);
});

test('leitura tolerante e chave de petisco', () => {
  const fresh = P.normalizePet(null, T0); assert.equal(fresh.stage, 'egg');
  assert.equal(P.normalizePet({ v: 2 }, T0).stage, 'egg', 'versão desconhecida = ovo novo');
  const n = P.normalizePet({ ...hatched(), hunger: 99, joy: -3, poops: 'x', form: 'dragão', name: 5 }, T0 + D);
  assert.deepEqual([n.hunger, n.joy, n.poops, n.form, n.name], [4, 0, 0, null, '']);
  assert.equal(P.treatKey('work', 'ws_1', '2026-11-24T12:00:00.000Z'), 'work:ws_1:2026-11-24T12:00:00.000Z');
  assert.ok(/^[A-Za-z0-9:._-]{1,80}$/.test(P.treatKey('run', '../../etc <x>', 'ok')));
});

test('servidor: o formato do cliente passa; extra, tipo errado e valor fora da faixa são recusados', () => {
  for (const s of [P.newPet(T0), hatched(), P.fastForward(hatched(), 4 * D, T0)]) assert.equal(validatePetState(JSON.parse(JSON.stringify(s))).error, undefined, s.stage);
  const ok = hatched();
  for (const [bad, why] of [[{ ...ok, extra: 1 }, 'extra'], [{ ...ok, v: 2 }, 'versão'], [{ ...ok, hunger: 5 }, 'fome'], [{ ...ok, name: 'a\u0007b' }, 'controle'], [{ ...ok, name: 'x'.repeat(21) }, 'nome longo'],
    [{ ...ok, stage: 'dragão' }, 'fase'], [{ ...ok, form: 'radiante' }, 'forma fora do adulto'], [{ ...ok, bornAt: null }, 'nascido sem data'], [{ ...ok, acc: { ...ok.acc, x: 1 } }, 'contador extra'],
    [{ ...ok, acc: { ...ok.acc, hunger: -1 } }, 'contador negativo'], [{ ...ok, sick: 'sim' }, 'booleano'], [null, 'nulo'], [[ok], 'lista']]) assert.ok(validatePetState(bad).error, why);
  assert.deepEqual(readPet({ pet: { state: { v: 9 }, treats: 500, treatKeys: ['ok', '../x', 7] } }), { state: null, treats: 0, keys: ['ok'] }, 'banco editado à mão: o inválido some');
});

async function server(over = {}) {
  const db = {}, st = { saves: 0, fail: false };
  const app = express(); app.use(express.json());
  setupPet(app, { db, save: () => { st.saves++; if (st.fail) throw new Error('disco cheio'); }, ...over });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, url, body) => { const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  return { db, st, call, close: () => new Promise((r) => srv.close(r)) };
}

test('rotas: GET vazio, PUT grava o estado, petiscos deduplicados por chave, gasto com saldo e teto de 99', async () => {
  const s = await server();
  try {
    assert.deepEqual((await s.call('GET', '/api/pet')).body, { state: null, treats: 0 });
    const egg = P.newPet(T0);
    let r = await s.call('PUT', '/api/pet', { state: egg }); assert.equal(r.status, 200); assert.equal(r.body.state.stage, 'egg');
    assert.equal((await s.call('PUT', '/api/pet', { state: egg, treats: 50 })).status, 400, 'o saldo de petiscos não entra pelo PUT');
    assert.equal((await s.call('PUT', '/api/pet', { state: { ...egg, hunger: 9 } })).status, 400);
    r = await s.call('POST', '/api/pet/treats', { key: 'work:ws_1:a' }); assert.deepEqual([r.body.treats, r.body.added], [1, true]);
    r = await s.call('POST', '/api/pet/treats', { key: 'work:ws_1:a' }); assert.deepEqual([r.body.treats, r.body.added], [1, false], 'o mesmo fim de trabalho não conta duas vezes');
    assert.equal((await s.call('POST', '/api/pet/treats', { key: '../x' })).status, 400);
    r = await s.call('POST', '/api/pet/treats/use'); assert.equal(r.body.treats, 0);
    r = await s.call('POST', '/api/pet/treats/use'); assert.deepEqual([r.status, r.body.code], [409, 'no_treats']);
    for (let i = 0; i < MAX_TREATS + 5; i++) await s.call('POST', '/api/pet/treats', { key: `k${i}` });
    assert.equal((await s.call('GET', '/api/pet')).body.treats, MAX_TREATS, 'teto de 99');
    assert.equal(s.db.pet.state.stage, 'egg', 'ganhar petisco não mexe no estado');
  } finally { await s.close(); }
});

test('rotas: falha ao gravar desfaz (estado e saldo ficam como estavam)', async () => {
  const s = await server();
  try {
    await s.call('PUT', '/api/pet', { state: P.newPet(T0) }); await s.call('POST', '/api/pet/treats', { key: 'a' });
    const before = JSON.stringify(s.db.pet); s.st.fail = true;
    assert.equal((await s.call('PUT', '/api/pet', { state: hatched() })).status, 500);
    assert.equal((await s.call('POST', '/api/pet/treats', { key: 'b' })).status, 500);
    assert.equal((await s.call('POST', '/api/pet/treats/use')).status, 500);
    assert.equal(JSON.stringify(s.db.pet), before);
  } finally { await s.close(); }
});
