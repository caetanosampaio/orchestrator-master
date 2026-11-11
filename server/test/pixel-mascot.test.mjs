// Bonequinho em pixel art (client/src/pixel-mascot.js e components/PixelMascot.jsx), reproduzido das telas de referência: o mesmo corpo para todas as IAs, só a cor muda. Lógica pura e leitura do código; sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pixelShapes, PIXEL_W } from '../../client/src/pixel-mascot.js';
import { CATALOG, FORGE_MASCOT } from '../../client/src/provider-catalog.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const has = (g, cls) => g.shapes.filter((s) => s.cls.split(' ').includes(cls));

test('corpo: quadrado com faixa clara em cima e sombra embaixo, duas alças vazadas, dois pés, dois olhos com brilho e boca em triângulo, tudo dentro do quadro', () => {
  const g = pixelShapes();
  assert.equal(has(g, 'body').length, 1); assert.equal(has(g, 'hi').length, 1); assert.equal(has(g, 'lo').length, 1);
  assert.equal(has(g, 'arm').length, 2); assert.equal(has(g, 'leg').length, 2); assert.equal(has(g, 'eye').length, 2); assert.equal(has(g, 'glint').length, 2);
  const mouth = has(g, 'mouth'); assert.equal(mouth.length, 1); assert.equal(mouth[0].t, 'poly', 'a boca é um triângulo');
  for (const s of g.shapes.filter((x) => x.t === 'rect')) assert.ok(s.x >= 0 && s.x + s.w <= PIXEL_W + 0.0001 && s.y >= 0 && s.w > 0 && s.h > 0, `${s.cls} fora do quadro`);
  assert.equal(g.viewBox, `0 0 ${PIXEL_W} 20`);
});

test('simetria: alças, olhos e pés espelham em torno do centro; os pés alternam a/b para o passo; os pés ficam sob o corpo', () => {
  const g = pixelShapes(), mirror = (s) => PIXEL_W - (s.x + s.w);
  const [al, ar] = has(g, 'arm'), [el, er] = has(g, 'eye'), [la, lb] = has(g, 'leg'), body = has(g, 'body')[0];
  assert.ok(Math.abs(mirror(al) - ar.x) < 0.01); assert.ok(Math.abs(mirror(el) - er.x) < 0.7 + 0.01); assert.ok(Math.abs(mirror(la) - lb.x) < 0.01);
  assert.ok(la.cls.includes('lega') && lb.cls.includes('legb')); assert.ok(la.y < body.y + body.h, 'os pés saem de baixo do corpo');
  assert.ok(ar.y === al.y && al.y > body.y && al.y < body.y + body.h, 'as alças ficam no meio da altura do corpo');
});

test('variação: o chapéu (quem coordena) acrescenta peças em cima e aumenta o quadro; sem ele nada muda; não há mais a chama copiada', () => {
  const base = pixelShapes(), hat = pixelShapes({ hat: true });
  assert.equal(has(hat, 'hat').length, 1); assert.equal(has(hat, 'brim').length, 1); assert.ok(hat.h > base.h); assert.equal(hat.viewBox.split(' ')[1], '-2'); assert.deepEqual(pixelShapes({}), base);
  for (const s of hat.shapes.filter((x) => x.t === 'rect')) assert.ok(s.y >= Number(hat.viewBox.split(' ')[1]), 'nada acima do quadro');
  const crest = pixelShapes({ crest: true }); assert.deepEqual(crest, base, 'a variação `crest` saiu: o FORGE tem arte própria'); assert.equal(has(base, 'bar').length, 0);
});

test('cores: as das telas de referência, uma por IA (todas diferentes) e a laranja da marca para o FORGE; o componente é SVG plano pintado por classes', () => {
  const colors = [...CATALOG, FORGE_MASCOT].map((a) => a.color.toLowerCase()); assert.equal(new Set(colors).size, colors.length, 'cada IA tem a sua cor');
  assert.equal(CATALOG.filter((a) => a.integrated).map((a) => a.id).join(), 'claude,codex'); assert.equal(FORGE_MASCOT.brand, true); assert.equal(Object.hasOwn(FORGE_MASCOT, 'crest'), false);
  const c = src('components/PixelMascot.jsx'); assert.match(c, /<svg className=/); assert.match(c, /shapeRendering="crispEdges"/); assert.ok(!/preserve-3d|perspective|WebGL|from 'three'/.test(c));
  const css = src('teams.css'); for (const k of ['px-body', 'px-hi', 'px-lo', 'px-arm', 'px-eye', 'px-glint', 'px-mouth', 'px-hat']) assert.match(css, new RegExp(`\\.${k}\\b`), `falta a regra .${k}`);
  assert.ok(!/preserve-3d/.test(css), 'sem CSS 3D');
});
