// O golem em PIXEL ART (Configurações > Golem e a barra lateral). PURO (sem React): monta cada fase numa grade de pixels com caixas de contorno escuro, luz em cima
// e à esquerda e sombra embaixo e à direita, como nos sprites clássicos. Cada pixel é uma letra da paleta; o metal (B, M, H) é a liga das suas IAs.
// Camadas: `body` (o corpo; O, Y e R são as partes em brasa), `arms` (os braços/martelo, que se mexem quando trabalha), `fx` (faíscas, chama, vapor, brilhos),
// e os olhos em três versões (abertos, fechados, felizes). Testado em server/test/golem.test.mjs.

/** Paleta: letra -> papel. B/M/H = metal da liga (sombra, corpo, luz); o resto é fixo. */
export const PALETTE_FIXED = Object.freeze({
  K: '#1b1311', D: '#2a1912', W: '#fff4e2', O: '#ff8a3d', Y: '#ffd27a', R: '#d9442a',
  C: '#2b2523', c: '#4d4542', E: '#ff7a2e', e: '#ffc27a', r: '#a3311b', S: '#9b938d', G: '#ffe9a8',
});
/** Paleta apagada (cochilando): as brasas quase sem brilho. */
export const PALETTE_SLEEP = Object.freeze({ O: '#8a4424', Y: '#a8703a', R: '#6a2a18', E: '#c25a2a', e: '#d8925a', G: '#b8a070' });
export const HOT = new Set(['O', 'Y', 'R']);

function canvas(w, h) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c; };
  const rect = (x, y, ww, hh, c) => { for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) px(x + i, y + j, c); };
  /** Caixa com contorno e cantos cortados: luz na 1ª linha e coluna de dentro, sombra na última. */
  const box = (x, y, ww, hh, { fill = 'M', hi = 'H', sh = 'B', ol = 'K', cut = true } = {}) => {
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
      const edgeX = i === 0 || i === ww - 1, edgeY = j === 0 || j === hh - 1;
      if (cut && edgeX && edgeY) continue;
      let c = fill;
      if (edgeX || edgeY) c = ol;
      else if (j === 1 || (i === 1 && j < hh - 2)) c = hi;
      else if (j === hh - 2 || i === ww - 2) c = sh;
      px(x + i, y + j, c);
    }
  };
  /** Elipse cheia com contorno (centro e raios em pixels). */
  const disc = (cx, cy, rx, ry, fill, ol = 'K') => {
    const inside = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      px(x, y, edge ? ol : fill);
    }
  };
  return { g, px, rect, box, disc, w, h };
}
const cells = (c) => { const out = []; c.g.forEach((row, y) => row.forEach((ch, x) => { if (ch !== '.') out.push([x, y, ch]); })); return out; };
const pts = (list, ch) => list.map(([x, y]) => [x, y, ch]);

/** Olhos: abertos (brasa com núcleo claro, ou escuros com brilho nos bichinhos), fechados (traço) e felizes (^). `w` = 2 ou 3. */
function eyes(xs, y, { w = 2, dark = false } = {}) {
  const open = [], closed = [], happy = [];
  for (const x of xs) {
    for (let i = 0; i < w; i++) { open.push([x + i, y, dark ? 'D' : 'O'], [x + i, y + 1, dark ? 'D' : 'O']); closed.push([x + i, y + 1, 'D']); }
    open.push([x + (dark ? w - 1 : Math.floor(w / 2)), y, dark ? 'W' : 'Y']);
    if (w >= 3) happy.push([x, y + 1, dark ? 'D' : 'Y'], [x + 1, y, dark ? 'D' : 'Y'], [x + 2, y + 1, dark ? 'D' : 'Y']);
    else happy.push([x, y + 1, dark ? 'D' : 'Y'], [x + 1, y, dark ? 'D' : 'Y']);
  }
  return { open, closed, happy };
}

/** Faíscas (só aparecem trabalhando): pontos acima da cabeça que sobem em degraus. */
const sparks = (cx, top) => [[cx - 5, top], [cx + 4, top + 1], [cx - 1, top - 1], [cx + 7, top + 2], [cx - 7, top + 2]].map(([x, y], i) => [Math.max(0, x), Math.max(0, y), i % 2 ? 'O' : 'Y']); // sempre dentro da grade

// ---------- as fases ----------
function faisca() {
  const c = canvas(16, 20);
  c.disc(8, 12.5, 6.6, 7.6, 'C');
  [[5, 8], [6, 7], [5, 9], [6, 8], [7, 7]].forEach(([x, y]) => c.px(x, y, 'c'));
  [[4, 13], [5, 12], [6, 13], [7, 12], [8, 13], [9, 12], [10, 13], [11, 12], [7, 11], [10, 14]].forEach(([x, y], i) => c.px(x, y, i % 3 ? 'O' : 'R'));
  [[6, 13], [9, 12]].forEach(([x, y]) => c.px(x, y, 'Y'));
  return { w: 16, h: 20, body: cells(c), arms: [], fx: { idle: pts([[9, 2], [8, 3]], 'Y'), working: pts([[9, 1], [8, 2], [11, 3], [5, 3]], 'Y') }, eyes: null, top: 3 };
}
function brasa() {
  const c = canvas(18, 22);
  c.disc(9, 14, 7.6, 7.4, 'E');
  c.disc(7.2, 11.6, 2.8, 2.4, 'e', 'e');
  [[13, 17], [14, 16], [12, 18], [13, 18], [4, 17], [5, 18], [14, 13]].forEach(([x, y]) => c.px(x, y, 'r'));
  [[5, 15], [13, 15]].forEach(([x, y]) => c.px(x, y, 'R'));
  c.px(8, 17, 'D'); c.px(9, 18, 'D'); c.px(10, 17, 'D');
  const fx = pts([[9, 2], [8, 3], [9, 3], [10, 3], [8, 4], [9, 4], [10, 4], [7, 5], [9, 5], [11, 5]], 'O').map(([x, y, ch], i) => [x, y, i === 0 || i === 2 || i === 5 ? 'Y' : ch]);
  return { w: 18, h: 22, body: cells(c), arms: [], fx: { idle: fx, working: [...fx, ...sparks(9, 1)] }, eyes: eyes([5, 11], 12, { w: 3, dark: true }), top: 2, flame: true };
}
function lingote() {
  const c = canvas(24, 18);
  c.box(5, 13, 4, 5, { fill: 'B', hi: 'M', sh: 'B' }); c.box(15, 13, 4, 5, { fill: 'B', hi: 'M', sh: 'B' });
  for (let y = 3; y <= 5; y++) { const inset = 6 - y; c.rect(3 + inset, y, 18 - inset * 2, 1, y === 3 ? 'H' : 'H'); c.px(2 + inset, y, 'K'); c.px(21 - inset, y, 'K'); }
  c.rect(6, 2, 12, 1, 'K');
  c.box(1, 6, 22, 9, { fill: 'M', hi: 'M', sh: 'B' });
  c.rect(2, 12, 20, 1, 'O'); c.rect(4, 12, 3, 1, 'Y'); c.rect(15, 12, 4, 1, 'Y');
  [[11, 10], [12, 9], [13, 10]].forEach(([x, y]) => c.px(x, y, 'B'));
  const arms = cells((() => { const a = canvas(24, 18); a.box(0, 8, 3, 4, { fill: 'M', hi: 'H', sh: 'B' }); a.box(21, 8, 3, 4, { fill: 'M', hi: 'H', sh: 'B' }); return a; })());
  const steam = pts([[8, 0], [9, 1], [16, 0], [15, 1]], 'S');
  return { w: 24, h: 18, body: cells(c), arms, fx: { idle: steam, working: [...steam, ...sparks(12, 0)] }, eyes: eyes([7, 15], 7, { w: 2, dark: true }), top: 1 };
}

/** O golem de corpo inteiro (fases 3 a 6), montado por um layout calculado (cabeça, pescoço, tronco, ombros, braços, mãos, pernas e botas encaixam sempre). */
const LAYOUT = {
  ferro: { W: 28, mt: 7, headW: 16, headH: 11, torsoW: 16, th: 10, sw: 5, sh: 5, armW: 4, armH: 5, handH: 5, legW: 5, legH: 5, gap: 2, bootH: 3, fw: 6 },
  aco: { W: 32, mt: 4, headW: 16, headH: 11, torsoW: 18, th: 11, sw: 8, sh: 6, armW: 5, armH: 6, handH: 5, legW: 6, legH: 5, gap: 2, bootH: 4, fw: 6 },
  tita: { W: 38, mt: 6, headW: 18, headH: 12, torsoW: 22, th: 13, sw: 9, sh: 7, armW: 6, armH: 7, handH: 6, legW: 7, legH: 6, gap: 2, bootH: 4, fw: 8 },
  mitico: { W: 42, mt: 10, headW: 18, headH: 12, torsoW: 22, th: 13, sw: 9, sh: 7, armW: 6, armH: 7, handH: 6, legW: 7, legH: 6, gap: 2, bootH: 4, fw: 8 },
};
function golem(kind) {
  const L = LAYOUT[kind], steel = kind !== 'ferro', titan = kind === 'tita' || kind === 'mitico', myth = kind === 'mitico';
  const cx = Math.floor(L.W / 2), hx = cx - L.headW / 2, hy = L.mt, ty = hy + L.headH + 1, tx = cx - L.torsoW / 2;
  const legY = ty + L.th - 1, bootY = legY + L.legH - 2, H = bootY + L.bootH;
  const c = canvas(L.W, H), a = canvas(L.W, H);
  // pernas e botas
  const lx = [cx - Math.floor(L.gap / 2) - L.legW, cx + Math.ceil(L.gap / 2)];
  for (const x of lx) { c.box(x, legY, L.legW, L.legH); c.box(x - 1, bootY, L.legW + 2, L.bootH, { fill: 'B', hi: 'M', sh: 'K' }); if (steel) c.rect(x + 1, legY + 1, L.legW - 2, 1, 'H'); }
  // braços e mãos (camada que bate quando trabalha)
  const armX = [tx - L.armW + 1, tx + L.torsoW - 1], armY = ty + L.sh - 2;
  for (const x of armX) {
    a.box(x, armY, L.armW, L.armH);
    a.box(x - 1, armY + L.armH - 1, L.armW + 2, L.handH, { fill: 'M', hi: 'H', sh: 'B' });
    if (titan) a.rect(x, armY + L.armH, L.armW, 1, 'O');
  }
  // tronco em barril, costura rebitada e a portinha da fornalha
  c.box(tx, ty, L.torsoW, L.th);
  c.rect(tx + 1, ty + 2, L.torsoW - 2, 1, 'B');
  if (!steel) { c.px(tx + 2, ty + 2, 'H'); c.px(tx + L.torsoW - 3, ty + 2, 'H'); }
  const fx0 = cx - L.fw / 2, fy = ty + 3, fh = L.th - 4;
  c.box(fx0, fy, L.fw, fh, { fill: 'D', hi: 'D', sh: 'D' });
  c.rect(fx0 + 1, fy + 1, L.fw - 2, fh - 2, 'O'); c.rect(fx0 + 2, fy + 2, L.fw - 4, Math.max(1, fh - 4), 'Y');
  for (let x = fx0 + 1; x < fx0 + L.fw - 1; x += 2) c.px(x, fy + 1, 'R');
  if (steel) { c.rect(tx + 1, ty + L.th - 2, L.torsoW - 2, 1, 'B'); c.rect(cx - 1, ty + L.th - 2, 2, 1, 'H'); }
  if (titan) [[tx + 2, ty + 4], [tx + 3, ty + 5], [tx + 3, ty + 6], [tx + 4, ty + 7], [tx + L.torsoW - 3, ty + 4], [tx + L.torsoW - 4, ty + 5], [tx + L.torsoW - 4, ty + 6], [tx + L.torsoW - 5, ty + 7]].forEach(([x, y]) => c.px(x, y, 'O'));
  // ombros (o aço e o titã ganham ombreiras maiores) com junta em brasa
  const sx = [tx - L.sw + 3, tx + L.torsoW - 3], sy = ty - (steel ? 1 : 0);
  for (const x of sx) { c.box(x, sy, L.sw, L.sh); if (!steel) c.px(x + Math.floor(L.sw / 2), sy + Math.floor(L.sh / 2), 'O'); else c.rect(x + 2, sy + L.sh - 2, L.sw - 4, 1, 'B'); }
  // pescoço, cabeça e o que vai em cima (chaminé, crista, coroa, halo)
  c.rect(cx - 3, ty - 1, 6, 1, 'B'); c.px(cx - 4, ty - 1, 'K'); c.px(cx + 3, ty - 1, 'K');
  if (!steel) c.box(hx + L.headW - 6, hy - 4, 4, 5, { fill: 'B', hi: 'M', sh: 'B' });
  if (steel && !titan) c.box(cx - 2, hy - 3, 4, 4);
  if (titan) [[2, 3], [6, 5], [L.headW - 7, 5], [L.headW - 3, 3]].forEach(([dx, hgt], i) => { for (let k = 1; k <= hgt; k++) c.px(hx + dx, hy - k + 1, k === hgt ? 'Y' : i % 3 ? 'O' : 'H'); c.px(hx + dx, hy - hgt, 'K'); });
  c.box(hx, hy, L.headW, L.headH);
  c.rect(hx + 2, hy + 2, L.headW - 4, 1, 'B');
  const ey = hy + 4;
  let ex;
  if (steel) { c.box(hx + 2, ey - 1, L.headW - 4, 4, { fill: 'D', hi: 'D', sh: 'D' }); ex = [hx + 4, hx + L.headW - 7]; }
  else { ex = [hx + 3, hx + L.headW - 6]; for (let i = 0; i < 3; i++) c.px(cx - 2 + i * 2, hy + L.headH - 3, 'D'); c.px(hx + 2, hy + L.headH - 3, 'H'); c.px(hx + L.headW - 3, hy + L.headH - 3, 'H'); }
  if (steel) c.rect(cx - 2, hy + L.headH - 3, 4, 1, 'B');
  const fxIdle = [];
  if (!steel) fxIdle.push(...pts([[hx + L.headW - 4, hy - 6], [hx + L.headW - 3, hy - 7]], 'S')); // fumaça logo acima da chaminé
  if (myth) {
    for (let i = -6; i <= 6; i++) c.px(cx + i, 1 + (Math.abs(i) > 4 ? 1 : 0), Math.abs(i) > 4 ? 'O' : 'G');
    fxIdle.push(...pts([[1, ty], [L.W - 2, ty + 4], [2, ty + 12], [L.W - 3, ty + 16], [4, hy + 2], [L.W - 5, hy + 4]], 'G'));
  }
  const top = Math.max(0, hy - (titan ? 7 : 5));
  return { w: L.W, h: H, body: cells(c), arms: cells(a), fx: { idle: fxIdle, working: [...fxIdle, ...sparks(cx, top)] }, eyes: eyes(ex, ey, { w: 3 }), top };
}

const BUILDERS = [faisca, brasa, lingote, () => golem('ferro'), () => golem('aco'), () => golem('tita'), () => golem('mitico')];
const memo = new Map();
/** Sprite da fase (0..6), memorizado. */
export function golemSprite(stage) {
  const s = Math.min(6, Math.max(0, Math.round(Number(stage) || 0)));
  if (!memo.has(s)) memo.set(s, Object.freeze(BUILDERS[s]()));
  return memo.get(s);
}

/** Cor de cada letra para uma liga ({ base, mid, hi }) e um humor ('sleep' apaga as brasas). */
export function paletteFor(colors, mood) {
  const c = colors ?? { base: '#3a3d44', mid: '#7b818c', hi: '#c3c8d0' };
  return { ...PALETTE_FIXED, ...(mood === 'sleep' ? PALETTE_SLEEP : {}), B: c.base, M: c.mid, H: c.hi };
}

/** Junta pixels vizinhos da mesma cor numa linha em retângulos (menos elementos no SVG). [[x, y, w, ch]]. */
export function runs(list) {
  const rows = new Map();
  for (const [x, y, ch] of list) { if (!rows.has(y)) rows.set(y, new Map()); rows.get(y).set(x, ch); }
  const out = [];
  for (const [y, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    const xs = [...row.keys()].sort((a, b) => a - b);
    let start = null, prev = null, ch = null;
    for (const x of xs) {
      const c = row.get(x);
      if (start !== null && x === prev + 1 && c === ch) { prev = x; continue; }
      if (start !== null) out.push([start, y, prev - start + 1, ch]);
      start = x; prev = x; ch = c;
    }
    if (start !== null) out.push([start, y, prev - start + 1, ch]);
  }
  return out;
}
