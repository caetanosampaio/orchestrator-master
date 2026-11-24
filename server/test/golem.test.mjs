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
  assert.equal(G.liveMood({ lastEnd: now - 1000, lastActive: now - 1000, now }), 'slowing', 'o trabalho acabou de terminar: primeiro os últimos golpes');
  assert.equal(G.liveMood({ lastEnd: now - G.SLOW_MS - 500, lastActive: now - G.SLOW_MS - 500, now }), 'cheer', 'depois dos últimos golpes, comemora');
  assert.equal(G.liveMood({ lastActive: now - 60_000, now }), 'idle'); assert.equal(G.liveMood({ lastActive: now - G.SLEEP_AFTER_MS, now }), 'sleep'); assert.equal(G.liveMood({ now }), 'sleep', 'sem trabalho nesta sessão: cochilando');
  assert.deepEqual([950, 12_345, 3_147_122, 25_000_000, 2.4e9].map(G.fmtTokens), ['950', '12 mil', '3,1 mi', '25 mi', '2,4 bi']);
  assert.equal(G.cleanName('  Bigorna\u0000 de Cobre muito comprido '), 'Bigorna de Cobre mui');
  assert.deepEqual(G.evolutionSteps(null, 3), [1, 2, 3], 'nunca viu: anima da faísca até a fase atual');
  assert.deepEqual(G.evolutionSteps(1, 3), [2, 3]); assert.deepEqual(G.evolutionSteps(3, 3), []); assert.deepEqual(G.evolutionSteps(5, 3), [], 'nunca anima para trás');
});

test('servidor: leitura tolerante e validação estrita do PUT', () => {
  assert.deepEqual(readGolem({}), { name: '', seenStage: null, shownStage: null });
  assert.deepEqual(readGolem({ golem: { name: 'a\u0007', seenStage: 9, shownStage: -2 } }), { name: '', seenStage: null, shownStage: null }, 'banco editado à mão: inválido volta ao padrão');
  assert.deepEqual(validateGolemPatch({ shownStage: null }).patch, { shownStage: null }, 'null volta para a fase atual'); assert.deepEqual(validateGolemPatch({ shownStage: 2 }).patch, { shownStage: 2 });
  assert.deepEqual(validateGolemPatch({ name: '  Bigorna ', seenStage: 3 }).patch, { name: 'Bigorna', seenStage: 3 });
  for (const bad of [null, [], { x: 1 }, { name: 5 }, { name: 'a'.repeat(21) }, { name: 'a\nb' }, { seenStage: 7 }, { seenStage: -1 }, { seenStage: 1.5 }, { seenStage: '2' }, { shownStage: 7 }, { shownStage: 'x' }, { shownStage: false }]) assert.ok(validateGolemPatch(bad).error, JSON.stringify(bad));
});

test('rotas: GET padrão, PUT parcial (nome e fase vista) e rollback quando a gravação falha', async () => {
  const db = {}, st = { fail: false };
  const app = express(); app.use(express.json());
  setupGolem(app, { db, save: () => { if (st.fail) throw new Error('disco cheio'); } });
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, body) => { const res = await fetch(`${base}/api/golem`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, body: await res.json() }; };
  try {
    assert.deepEqual((await call('GET')).body, { name: '', seenStage: null, shownStage: null });
    assert.deepEqual((await call('PUT', { name: 'Bigorna' })).body, { name: 'Bigorna', seenStage: null, shownStage: null });
    assert.deepEqual((await call('PUT', { seenStage: 3 })).body, { name: 'Bigorna', seenStage: 3, shownStage: null }, 'parcial: o nome fica');
    assert.deepEqual((await call('PUT', { shownStage: 1 })).body, { name: 'Bigorna', seenStage: 3, shownStage: 1 });
    assert.equal((await call('PUT', { seenStage: 3, tokens: 1e9 })).status, 400, 'os tokens não entram pelo PUT (vêm da atividade real)');
    st.fail = true; const before = JSON.stringify(db.golem);
    assert.equal((await call('PUT', { name: 'Outro' })).status, 500); assert.equal(JSON.stringify(db.golem), before);
  } finally { await new Promise((r) => srv.close(r)); }
});

test('martela enquanto há tokens sendo gastos: soma o consumo dos terminais (subiu = trabalhando)', () => {
  const s = [{ id: 't1', usage: { io: 1200 } }, { id: 't2', usage: { input: 300, output: 50 } }, { id: 't3', usage: null }, { id: 't4' }, { id: 't5', usage: { io: -5 } }];
  assert.equal(G.sessionTokens(s), 1550); assert.equal(G.sessionTokens(null), 0);
  const now = 50_000_000;
  assert.equal(G.liveMood({ working: 1, lastActive: now - 1000, now }), 'working', 'um terminal com tokens recentes conta como trabalhando');
  assert.ok(G.TOKEN_FRESH_MS >= 5000 && G.TOKEN_FRESH_MS <= 30_000);
});

test('vai parando aos poucos: martela -> últimos golpes -> (comemora) -> esfria -> parado -> com sono -> cochila', () => {
  const t0 = 80_000_000, at = (ms, extra = {}) => G.liveMood({ lastActive: t0, now: t0 + ms, ...extra });
  assert.equal(G.liveMood({ working: 1, lastActive: t0 - 5 * 60_000, now: t0 }), 'working', 'trabalhando vale mais que qualquer horário antigo');
  assert.equal(at(0), 'slowing'); assert.equal(at(G.SLOW_MS - 1), 'slowing');
  assert.equal(at(G.SLOW_MS), 'cooling', 'sem fim de trabalho (os tokens só pararam): esfria direto, sem comemorar');
  assert.equal(at(G.SLOW_MS, { lastEnd: t0 }), 'cheer'); assert.equal(at(G.SLOW_MS + G.CHEER_MS - 1, { lastEnd: t0 }), 'cheer');
  assert.equal(at(G.SLOW_MS + G.CHEER_MS, { lastEnd: t0 }), 'cooling', 'a comemoração acaba e ele esfria');
  assert.equal(at(G.SLOW_MS, { lastEnd: t0 - 60_000 }), 'cooling', 'um fim de trabalho antigo não faz comemorar de novo');
  assert.equal(at(G.COOL_MS - 1), 'cooling'); assert.equal(at(G.COOL_MS), 'idle');
  assert.equal(at(G.SLEEP_AFTER_MS - G.DROWSY_MS - 1), 'idle'); assert.equal(at(G.SLEEP_AFTER_MS - G.DROWSY_MS), 'drowsy'); assert.equal(at(G.SLEEP_AFTER_MS), 'sleep');
  assert.equal(G.liveMood({ now: t0 }), 'sleep', 'nada nesta sessão: cochilando');
  assert.equal(G.liveMood({ lastEnd: t0 - 1000, now: t0 }), 'cheer', 'fim de trabalho sem instante ativo conhecido: comemora');
  assert.equal(G.liveMood({ lastActive: t0 + 5000, now: t0 }), 'slowing', 'relógio que andou para trás não quebra a sequência');
});

test('ao vivo pelos tokens: subiu agora = rajada; para TOKEN_FRESH_MS depois da última subida e então desacelera', () => {
  const t0 = 90_000_000, st = (ms, extra = {}) => G.liveState({ tokensAt: t0, now: t0 + ms, ...extra });
  assert.deepEqual(st(500), { mood: 'working', burst: true });
  assert.deepEqual(st(G.BURST_MS), { mood: 'working', burst: false }, 'ainda trabalhando, mas sem rajada');
  assert.equal(st(G.TOKEN_FRESH_MS).mood, 'slowing', 'os tokens pararam: começa a desacelerar a partir daí, não pula a desaceleração');
  assert.equal(st(G.TOKEN_FRESH_MS + G.SLOW_MS).mood, 'cooling');
  assert.deepEqual(G.liveState({ working: 1, now: t0 }), { mood: 'working', burst: false }, 'agente executando sem tokens novos: martela no ritmo normal');
  assert.equal(G.liveState({ lastActive: t0, now: t0 + 1000 }).mood, 'slowing', 'o último agente acabou de parar');
  assert.equal(G.liveState({ now: t0 }).mood, 'sleep');
});

test('agentes executando e esperando você pelo MESMO estado dos indicadores (hooks antes da saída)', () => {
  const run = (id, agent, extra = {}) => ({ id, status: 'running', agent: agent ? { state: agent } : null, ...extra });
  const sessions = [run('a', 'running'), run('b', 'idle'), run('c', 'waiting'), run('d', null), run('e', null), { id: 'f', status: 'exited', exitCode: 0 }, null];
  assert.deepEqual(G.liveCounts(sessions, new Set(['b', 'd'])), { working: 2, waiting: 1 }, "o hook diz 'idle' em b: a saída crescendo (redesenho) não conta; d sem hooks conta pela saída");
  assert.deepEqual(G.liveCounts(null, null), { working: 0, waiting: 0 });
});

test('pixel art: cada fase é uma grade com corpo, olhos e efeitos dentro dela; letras só da paleta; fases crescem', async () => {
  const PX = await import('../../client/src/pixel-golem.js');
  const pal = PX.paletteFor({ base: '#111111', mid: '#222222', hi: '#333333' }, 'idle');
  let lastArea = 0;
  for (let i = 0; i < 7; i++) {
    const sp = PX.golemSprite(i), inside = ([x, y]) => x >= 0 && y >= 0 && x < sp.w && y < sp.h;
    for (const list of [sp.body, sp.arms, sp.fx.idle, sp.fx.working, sp.fx.hit, sp.fx.cool, sp.fx.cheer, sp.zzz, sp.alert, ...(sp.eyes ? [sp.eyes.open, sp.eyes.closed, sp.eyes.happy, sp.eyes.left, sp.eyes.right, sp.eyes.half] : [])]) {
      assert.ok(list.every(inside), `fase ${i}: tudo dentro da grade`);
      assert.ok(list.every(([, , ch]) => typeof pal[ch] === 'string'), `fase ${i}: letras da paleta`);
    }
    assert.ok(sp.body.length > 40, `fase ${i}: corpo desenhado`); assert.equal(PX.golemSprite(i), sp, 'memorizado');
    if (i >= 3) { assert.ok(sp.w * sp.h > lastArea, `fase ${i} é maior que a anterior`); lastArea = sp.w * sp.h; assert.ok(sp.arms.length > 0, 'golem tem braços (que batem ao trabalhar)'); }
    if (i >= 1) assert.ok(sp.fx.working.length > sp.fx.idle.length, `fase ${i}: trabalhando solta faíscas`);
    if (i >= 2) assert.ok(sp.fx.hit.length > 0, `fase ${i}: faíscas nas mãos a cada golpe`);
    if (i >= 2) {
      const maxY = (l) => Math.max(...l.map(([, y]) => y)), minY = (l) => Math.min(...l.map(([, y]) => y)), inside2 = ([x, y]) => x >= 0 && y >= 0 && x < sp.w && y < sp.h;
      for (const pose of ['up', 'slam']) assert.ok(sp.poses[pose].length > 0 && sp.poses[pose].every(inside2), `fase ${i}: pose ${pose} desenhada dentro da grade`);
      assert.equal(maxY(sp.poses.slam), sp.h - 1, `fase ${i}: no golpe as mãos encostam no chão`);
      assert.ok(maxY(sp.arms) < sp.h - 1, `fase ${i}: em repouso as mãos ficam acima do chão (o golpe desce de verdade)`);
      assert.ok(minY(sp.poses.up) < minY(sp.arms), `fase ${i}: no impulso os braços sobem`);
    } else assert.equal(sp.poses, undefined, `fase ${i}: sem braços, sem poses`);
    const solidOf = (...lists) => new Set(lists.flat().map(([x, y]) => `${x},${y}`));
    const anyPose = solidOf(sp.body, sp.arms, sp.poses?.up ?? [], sp.poses?.slam ?? []), impact = solidOf(sp.body, sp.poses?.slam ?? sp.arms);
    assert.ok([...sp.zzz, ...sp.alert].every(([x, y]) => !anyPose.has(`${x},${y}`)), `fase ${i}: Zzz e "!" ficam fora do corpo e dos braços em qualquer pose`);
    assert.ok(sp.fx.hit.every(([x, y]) => !impact.has(`${x},${y}`)), `fase ${i}: as faíscas do golpe ficam fora do corpo e das mãos no chão (o quadro em que aparecem)`);
    assert.ok(sp.fx.cool.every(([, , ch]) => ch === 'S'), `fase ${i}: esfriando solta vapor`);
  }
  assert.equal(PX.golemSprite(0).eyes, null, 'o ovo de carvão não tem olhos');
  assert.deepEqual([pal.B, pal.M, pal.H], ['#111111', '#222222', '#333333'], 'o metal é a liga');
  assert.notEqual(PX.paletteFor(null, 'sleep').O, pal.O, 'cochilando, as brasas apagam');
  assert.ok(![pal.O, PX.paletteFor(null, 'sleep').O].includes(PX.paletteFor(null, 'cooling').O), 'esfriando, as brasas baixam (entre acesas e apagadas)');
  assert.deepEqual(PX.runs([[0, 0, 'K'], [1, 0, 'K'], [2, 0, 'M'], [4, 0, 'M'], [0, 1, 'K']]), [[0, 0, 2, 'K'], [2, 0, 1, 'M'], [4, 0, 1, 'M'], [0, 1, 1, 'K']], 'pixels vizinhos da mesma cor viram um retângulo');
});
