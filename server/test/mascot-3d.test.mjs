// Bonequinho 3D (client/src/mascot-3d.js e components/Mascot3D.jsx): geometria única para todos os providers, pose e a ligação do componente. Lógica pura e leitura do código; sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PARTS, UNITS, pose, SWAY_DEG, REST_YAW } from '../../client/src/mascot-3d.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('geometria: corpo, dois braços, dois olhos e quatro pernas, todos dentro da caixa 16 x 10 e com profundidade (são blocos, não desenho chapado)', () => {
  const by = (k) => PARTS.filter((p) => p.kind === k);
  assert.equal(by('body').length, 1); assert.equal(by('arm').length, 2); assert.equal(by('eye').length, 2); assert.equal(by('leg').length, 4);
  for (const p of PARTS) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= UNITS.w && p.y + p.h <= UNITS.h, `${p.id} fora da caixa`);
    assert.ok(p.d > 0 && p.w > 0 && p.h > 0, `${p.id} sem volume`);
  }
  assert.equal(new Set(PARTS.map((p) => p.id)).size, PARTS.length, 'ids únicos');
});

test('geometria: simétrica (braços, olhos e pernas espelham em torno do centro) e as pernas alternam a/b para o passo', () => {
  const mid = UNITS.w / 2, mirror = (p) => UNITS.w - (p.x + p.w);
  for (const k of ['arm', 'eye']) { const [l, r] = PARTS.filter((p) => p.kind === k); assert.equal(mirror(l), r.x, `${k} espelhado`); assert.equal(l.y, r.y); }
  const legs = PARTS.filter((p) => p.kind === 'leg'); assert.ok(legs.every((l) => l.x + l.w / 2 !== mid));
  assert.deepEqual(legs.map((l) => l.leg), ['a', 'b', 'a', 'b']); assert.ok(legs.every((l) => l.y + l.h === UNITS.h), 'as pernas chegam ao chão');
  const body = PARTS.find((p) => p.kind === 'body'); assert.equal(body.y + body.h, legs[0].y, 'as pernas saem da base do corpo');
  for (const e of PARTS.filter((p) => p.kind === 'eye')) assert.ok(e.z + e.d / 2 > body.d / 2, 'o olho aparece à frente do corpo');
});

test('pose: balança de lado a lado dentro do limite, cada boneco numa fase; reduzida = pose parada de três quartos', () => {
  for (let t = 0; t < 30; t += 0.37) { const p = pose(t, 1.3); assert.ok(Math.abs(p.ry) <= SWAY_DEG + 1e-9); assert.ok(Math.abs(p.bob) <= 0.2); }
  assert.notEqual(pose(2, 0).ry, pose(2, 2).ry, 'fases diferentes');
  assert.deepEqual(pose(5, 3, true), pose(99, 0, true)); assert.equal(pose(1, 0, true).ry, REST_YAW); assert.equal(pose(1, 0, true).bob, 0);
});

test('componente: um laço só para todos os bonecos, só os visíveis, sem laço com animações reduzidas, arrasto por ponteiro, sem WebGL nem dependência nova', () => {
  const c = src('components/Mascot3D.jsx');
  assert.equal((c.match(/requestAnimationFrame\(/g) ?? []).length, 2, 'um laço compartilhado (o pedido inicial e a repetição)');
  assert.match(c, /IntersectionObserver/); assert.match(c, /it\.visible/); assert.match(c, /document\.hidden/);
  assert.match(c, /dataset\.motion === 'reduced'/); assert.match(c, /onPointerDown=\{onDown\}/); assert.match(c, /setPointerCapture/);
  assert.ok(!/WebGL|from 'three'/.test(c)); assert.ok(!/three/.test(fs.readFileSync(new URL('../../client/package.json', import.meta.url), 'utf8')), 'nenhuma dependência nova');
  assert.match(src('teams.css'), /transform-style: preserve-3d/); assert.match(src('teams.css'), /perspective:/);
});
