// Golem de liga: a lógica pura (client/src/golem.js: fases pelos tokens, liga pela mistura de IAs, recordes, humor ao vivo) e o servidor (server/golem.js: nome e fase vista).
// ORCH_DATA_DIR temporário; o servidor de teste sobe numa porta própria com banco em memória.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-golem-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const G = await import('../../client/src/golem.js');
const { readGolem, validateGolemPatch, setupGolem } = await import('../golem.js');
const { default: express } = await import('express');

const act = (rows) => ({ providers: Object.entries(rows).map(([id, days]) => ({ id, days: Object.fromEntries(Object.entries(days).map(([k, io]) => [k, { io, cache: 999 }])) })) });

test('fases pelos tokens: limites exatos, progresso até a próxima e a fase máxima', () => {
  assert.deepEqual(G.STAGES.map((s) => s.min), [0, 50_000, 300_000, 1_000_000, 5_000_000, 25_000_000, 100_000_000]);
  assert.equal(G.stageFor(0).stage.id, 'faisca'); assert.equal(G.stageFor(49_999).index, 0); assert.equal(G.stageFor(50_000).stage.id, 'brasa');
  const s = G.stageFor(3_147_122); assert.equal(s.stage.id, 'ferro'); assert.equal(s.next.id, 'aco'); assert.equal(s.toNext, 5_000_000 - 3_147_122);
  assert.ok(Math.abs(s.progress - (2_147_122 / 4_000_000)) < 1e-9);
  const top = G.stageFor(5e9); assert.deepEqual([top.stage.id, top.next, top.progress, top.toNext], ['mitico', null, 1, 0]);
  for (const bad of [-5, NaN, undefined, 'x']) assert.equal(G.stageFor(bad).index, 0);
});

test('totais por IA: só entrada + saída (o cache fica fora), do maior para o menor, IA sem consumo some', () => {
  const t = G.totalsByProvider(act({ claude: { '2026-11-20': 1000, '2026-11-21': 500 }, codex: { '2026-11-21': 4000 }, kimi: {} }));
  assert.deepEqual(t, [{ id: 'codex', tokens: 4000 }, { id: 'claude', tokens: 1500 }]);
  assert.deepEqual(G.totalsByProvider(null), []);
});

test('liga: cada IA é um metal; a cor é a mistura pelo peso; nome "puro" com 90% ou mais', () => {
  assert.equal(G.alloyOf([]).name, 'Ferro puro'); assert.deepEqual(G.alloyOf([]).colors, { base: G.IRON.base, mid: G.IRON.mid, hi: G.IRON.hi });
  const pure = G.alloyOf([{ id: 'claude', tokens: 95 }, { id: 'codex', tokens: 5 }]); assert.equal(pure.name, 'Cobre puro');
  const mix = G.alloyOf([{ id: 'claude', tokens: 60 }, { id: 'codex', tokens: 40 }]);
  assert.equal(mix.name, 'Liga de Cobre e Cobalto'); assert.deepEqual(mix.parts.map((p) => [p.metal, p.share]), [['Cobre', 0.6], ['Cobalto', 0.4]]);
  assert.equal(G.mixColors([{ color: '#000000', weight: 1 }, { color: '#ffffff', weight: 1 }]), '#808080');
  assert.equal(mix.colors.mid, G.mixColors([{ color: G.METALS.claude.mid, weight: 60 }, { color: G.METALS.codex.mid, weight: 40 }]));
  assert.equal(G.metalOf('desconhecida'), G.IRON, 'IA sem metal vira ferro');
  assert.equal(G.alloyOf([{ id: 'gemini', tokens: 10 }]).name, 'Prata puro');
});

test('recordes: total, maior dia, sequência terminando hoje ou ontem, primeiro dia', () => {
  const now = new Date(2026, 10, 24, 15);
  const r = G.records(act({ claude: { '2026-11-20': 100, '2026-11-22': 300, '2026-11-23': 50, '2026-11-24': 10 }, codex: { '2026-11-23': 500 } }), now);
  assert.deepEqual([r.total, r.best.day, r.best.tokens, r.streak, r.since, r.today], [960, '2026-11-23', 550, 3, '2026-11-20', 10]);
  const y = G.records(act({ claude: { '2026-11-22': 1, '2026-11-23': 1 } }), now); assert.equal(y.streak, 2, 'sem consumo hoje: a sequência vale até ontem');
  assert.equal(G.records(act({ claude: { '2026-11-20': 1 } }), now).streak, 0);
  assert.deepEqual(G.records(null, now), { total: 0, best: { day: null, tokens: 0 }, streak: 0, since: null, today: 0 });
});

test('humor ao vivo, tokens em texto, nome e a evolução acumulada', () => {
  const now = 10_000_000;
  assert.equal(G.liveMood({ working: 2, now }), 'working');
  assert.equal(G.liveMood({ lastEnd: now - 1000, lastActive: now - 1000, now }), 'cheer');
  assert.equal(G.liveMood({ lastActive: now - 60_000, now }), 'idle'); assert.equal(G.liveMood({ lastActive: now - G.SLEEP_AFTER_MS, now }), 'sleep'); assert.equal(G.liveMood({ now }), 'sleep', 'sem trabalho nesta sessão: cochilando');
  assert.deepEqual([950, 12_345, 3_147_122, 25_000_000, 2.4e9].map(G.fmtTokens), ['950', '12 mil', '3,1 mi', '25 mi', '2,4 bi']);
  assert.equal(G.cleanName('  Bigorna\u0000 de Cobre muito comprido '), 'Bigorna de Cobre mui');
  assert.deepEqual(G.evolutionSteps(null, 3), [1, 2, 3], 'nunca viu: anima da faísca até a fase atual');
  assert.deepEqual(G.evolutionSteps(1, 3), [2, 3]); assert.deepEqual(G.evolutionSteps(3, 3), []); assert.deepEqual(G.evolutionSteps(5, 3), [], 'nunca anima para trás');
});

test('servidor: leitura tolerante e validação estrita do PUT', () => {
  assert.deepEqual(readGolem({}), { name: '', seenStage: null });
  assert.deepEqual(readGolem({ golem: { name: 'a\u0007', seenStage: 9 } }), { name: '', seenStage: null }, 'banco editado à mão: inválido volta ao padrão');
  assert.deepEqual(validateGolemPatch({ name: '  Bigorna ', seenStage: 3 }).patch, { name: 'Bigorna', seenStage: 3 });
  for (const bad of [null, [], { x: 1 }, { name: 5 }, { name: 'a'.repeat(21) }, { name: 'a\nb' }, { seenStage: 7 }, { seenStage: -1 }, { seenStage: 1.5 }, { seenStage: '2' }]) assert.ok(validateGolemPatch(bad).error, JSON.stringify(bad));
});

test('rotas: GET padrão, PUT parcial (nome e fase vista) e rollback quando a gravação falha', async () => {
  const db = {}, st = { fail: false };
  const app = express(); app.use(express.json());
  setupGolem(app, { db, save: () => { if (st.fail) throw new Error('disco cheio'); } });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, body) => { const res = await fetch(`${base}/api/golem`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  try {
    assert.deepEqual((await call('GET')).body, { name: '', seenStage: null });
    assert.deepEqual((await call('PUT', { name: 'Bigorna' })).body, { name: 'Bigorna', seenStage: null });
    assert.deepEqual((await call('PUT', { seenStage: 3 })).body, { name: 'Bigorna', seenStage: 3 }, 'parcial: o nome fica');
    assert.equal((await call('PUT', { seenStage: 3, tokens: 1e9 })).status, 400, 'os tokens não entram pelo PUT (vêm da atividade real)');
    st.fail = true; const before = JSON.stringify(db.golem);
    assert.equal((await call('PUT', { name: 'Outro' })).status, 500); assert.equal(JSON.stringify(db.golem), before);
  } finally { await new Promise((r) => srv.close(r)); }
});
