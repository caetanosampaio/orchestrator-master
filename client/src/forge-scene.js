// Cena da forja em pixel art (ARTE ORIGINAL do FORGE, desenhada por código): o ferreiro de capuz comprido (o mesmo da logo) martelando na bigorna,
// a fornalha de pedra com fogo, a chaminé soltando fumaça, faíscas a cada golpe e brasas no ar. Sem React e sem imagens: `drawScene(ctx, t)` desenha
// o quadro do instante `t` (ms) numa grade de W x H pixels lógicos; quem usa escala o canvas com image-rendering: pixelated.
// Determinística: o mesmo `t` produz o mesmo quadro (as partículas saem de uma semente), então serve também para gerar as artes do instalador.

export const W = 192, H = 128;
export const STRIKE_MS = 1300; // um golpe de martelo a cada 1,3 s

const C = {
  sky0: '#1d1e26', sky1: '#262833', hill: '#2c2f3a', hill2: '#323542',
  ground: '#3a2f28', groundTop: '#4b3c31', groundDark: '#2a221d',
  wood: '#5a4330', woodLight: '#715639', woodDark: '#3c2c20',
  stone: '#5b5d66', stoneLight: '#6e717b', stoneDark: '#43454d', mortar: '#34363d',
  brick: '#6a4b3e', brickLight: '#7d5a4a', brickDark: '#4b342b',
  fire0: '#7a1f12', fire1: '#c63d1b', fire2: '#f2922a', fire3: '#ffd36b', fire4: '#fff3c4',
  metal: '#2b2c31', metalLight: '#4a4c54', metalEdge: '#6c6f78',
  hood: '#3d3330', hoodLight: '#544641', hoodDark: '#2a2321', skin: '#c98d68', skinDark: '#a8704f',
  apron: '#6b4a32', apronDark: '#523826', pants: '#2c2829', boot: '#1c1818',
  smoke: [234, 232, 226], hot: '#ff8a2a', hotCore: '#ffe08a',
};

// ---------- utilitários de pixel ----------
let g = null;
const px = (x, y, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); };
const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); };
function line(x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) { px(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
}
function disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) px(cx + x, cy + y, c); }
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rgba = ([r, gg, b], a) => `rgba(${r},${gg},${b},${a})`;

// ---------- cenário fixo ----------
function sky() {
  for (let y = 0; y < H; y++) { rect(0, y, W, 1, y < 70 ? C.sky0 : C.sky1); if (y >= 56 && y < 70 && (y % 2 === 0)) for (let x = (y % 4 === 0 ? 0 : 1); x < W; x += 2) px(x, y, C.sky1); }
  // colinas ao fundo
  for (let x = 0; x < W; x++) {
    const h1 = 84 + Math.round(Math.sin(x / 23) * 4 + Math.sin(x / 9 + 1) * 2), h2 = 92 + Math.round(Math.sin(x / 31 + 2) * 3);
    rect(x, h1, 1, H - h1, C.hill); rect(x, h2, 1, H - h2, C.hill2);
  }
  // estrelas discretas
  for (let i = 0; i < 26; i++) { const x = Math.floor(hash(i, 7) * W), y = Math.floor(hash(i, 11) * 48); px(x, y, hash(i, 3) > 0.7 ? '#5c6070' : '#3d404c'); }
}
function ground() {
  rect(0, 104, W, H - 104, C.ground); rect(0, 104, W, 1, C.groundTop);
  for (let y = 106; y < H; y++) for (let x = 0; x < W; x++) if (hash(x, y) > 0.93) px(x, y, hash(x + 1, y) > 0.5 ? C.groundDark : C.groundTop);
}
function shelter() {
  // postes
  for (const x of [40, 152]) { rect(x, 54, 5, 50, C.wood); rect(x, 54, 1, 50, C.woodLight); rect(x + 4, 54, 1, 50, C.woodDark); for (let y = 58; y < 104; y += 7) px(x + 2, y, C.woodDark); }
  // telhado inclinado (mais alto à esquerda) com caibros
  for (let i = 0; i < 132; i++) { const x = 34 + i, y = 44 + Math.round(i * 0.09); rect(x, y, 1, 4, C.wood); px(x, y, C.woodLight); px(x, y + 4, C.woodDark); }
  for (let x = 40; x < 160; x += 9) { const y = 48 + Math.round((x - 34) * 0.09); rect(x, y, 2, 4, C.woodDark); }
  rect(38, 52, 124, 2, C.woodDark); rect(38, 52, 124, 1, C.wood); // viga
  // ferramentas penduradas
  line(52, 54, 52, 60, C.metalLight); rect(50, 60, 5, 2, C.metal); px(50, 60, C.metalEdge); // martelo
  line(58, 54, 57, 64, C.metalLight); line(60, 54, 61, 64, C.metalLight); // tenaz
  for (let y = 54; y < 62; y += 2) px(146, y, C.metalEdge); disc(146, 64, 2, C.metal); // corrente com argola
}
function barrel() {
  rect(20, 90, 12, 14, C.woodDark); rect(21, 90, 10, 14, C.wood); rect(21, 90, 1, 14, C.woodLight);
  rect(20, 93, 12, 1, C.metal); rect(20, 100, 12, 1, C.metal); rect(21, 89, 10, 1, '#2f4a5c'); // água no topo
}
function forge(flick) {
  // chaminé de tijolos
  for (let y = 22; y < 74; y++) for (let x = 126; x < 140; x++) {
    const row = Math.floor((y - 22) / 3), off = row % 2 ? 0 : 3, edge = (x - 126 + off) % 6 === 0 || (y - 22) % 3 === 0;
    px(x, y, edge ? C.brickDark : hash(x, y) > 0.82 ? C.brickLight : C.brick);
  }
  rect(124, 20, 18, 3, C.stoneDark); rect(124, 20, 18, 1, C.stoneLight);
  // corpo de pedra da fornalha
  for (let y = 72; y < 104; y++) for (let x = 110; x < 152; x++) {
    const row = Math.floor((y - 72) / 5), off = row % 2 ? 0 : 4, joint = (x - 110 + off) % 8 === 0 || (y - 72) % 5 === 0;
    px(x, y, joint ? C.mortar : hash(x, y) > 0.86 ? C.stoneLight : hash(x + 3, y) < 0.12 ? C.stoneDark : C.stone);
  }
  rect(108, 70, 46, 3, C.stoneDark); rect(108, 70, 46, 1, C.stoneLight); // laje de cima
  // boca em arco com o fogo
  const mx = 122, my = 84, mw = 18;
  for (let y = my; y < 102; y++) for (let x = mx; x < mx + mw; x++) {
    const dx = x - (mx + mw / 2 - 0.5), arch = y < my + 5 && dx * dx + (y - (my + 5)) ** 2 * 3 > 80; if (arch) continue;
    const depth = (y - my) / (102 - my), n = hash(x, y + Math.floor(flick * 7));
    px(x, y, depth > 0.75 ? (n > 0.5 ? C.fire3 : C.fire2) : depth > 0.45 ? (n > 0.55 ? C.fire2 : C.fire1) : n > 0.7 ? C.fire1 : C.fire0);
  }
  // línguas de fogo que tremulam
  for (let i = 0; i < 6; i++) { const x = mx + 2 + i * 3, h = 4 + Math.round((Math.sin(flick * 9 + i * 1.7) + 1) * 2.5); line(x, 101, x, 101 - h, i % 2 ? C.fire3 : C.fire2); px(x, 101 - h - 1, C.fire1); }
  for (let x = mx + 4; x < mx + mw - 4; x += 2) px(x, 100, C.fire4);
  // arco de pedra por cima da boca
  for (let a = 0; a <= Math.PI; a += 0.08) px(Math.round(mx + mw / 2 - 0.5 + Math.cos(a) * 10), Math.round(my + 5 - Math.sin(a) * 6), C.stoneLight);
}
function glow(intensity) {
  // brilho do fogo no chão e nas pedras: camadas de laranja translúcido (pixel a pixel, para manter a textura)
  for (let y = 56; y < H; y++) for (let x = 56; x < W; x++) {
    const d = Math.hypot((x - 131) / 1.5, (y - 98) * 1.25);
    const f = Math.max(0, 1 - d / 52), a = f * f * 0.42 * intensity; if (a < 0.012) continue; // queda quadrática: sem borda
    g.fillStyle = `rgba(255,140,50,${a.toFixed(3)})`; g.fillRect(x, y, 1, 1);
  }
}

// ---------- bigorna e ferreiro ----------
function anvil(heat, flash) {
  rect(84, 96, 14, 8, C.woodDark); rect(85, 96, 12, 8, C.wood); rect(85, 96, 12, 1, C.woodLight); for (let x = 86; x < 97; x += 3) px(x, 99, C.woodDark); // toco
  rect(86, 92, 10, 4, C.metal); rect(84, 89, 16, 3, C.metal); rect(80, 89, 4, 2, C.metal); px(79, 89, C.metal); // corpo e chifre
  rect(84, 89, 16, 1, C.metalEdge); rect(80, 89, 4, 1, C.metalLight);
  // a barra quente em cima da bigorna (esfria e reaquece com o golpe)
  const core = heat > 0.6 ? C.hotCore : C.hot;
  rect(88, 87, 9, 2, heat > 0.25 ? C.hot : '#8a4a2a'); rect(90, 87, 5, 1, core);
  if (flash) { // clarão do impacto: a barra fica branca e um halo curto em volta
    rect(89, 87, 7, 1, C.fire4);
    for (let y = 83; y < 92; y++) for (let x = 84; x < 101; x++) { const d = Math.hypot(x - 92.5, (y - 87.5) * 1.6); if (d < 7) { g.fillStyle = `rgba(255,220,140,${((1 - d / 7) * 0.45).toFixed(3)})`; g.fillRect(x, y, 1, 1); } }
  }
}

/** Pose do braço do martelo em função da fase do golpe (0..1): ângulo do antebraço e se é o instante do impacto. */
function hammerPose(phase) {
  // levanta devagar (0 → 0,6), segura no alto, desce rápido (0,78 → 0,86) e recua um pouco
  let a;
  const ease = (u) => u * u * (3 - 2 * u);
  if (phase < 0.6) a = 0.12 + ease(phase / 0.6) * 1.98;
  else if (phase < 0.78) a = 2.1;
  else if (phase < 0.86) a = 2.1 - ((phase - 0.78) / 0.08) ** 2 * 1.98;
  else a = 0.12 + Math.sin(((phase - 0.86) / 0.14) * Math.PI) * 0.22;
  return { a, impact: phase >= 0.86 && phase < 0.9 };
}
function smith(phase) {
  const x = 66, y = 80; // canto superior do corpo
  const breathe = Math.round(Math.sin(phase * Math.PI * 2) * 0.4);
  // pernas e botas
  rect(x + 3, y + 16, 3, 7, C.pants); rect(x + 9, y + 16, 3, 7, C.pants);
  rect(x + 2, y + 22, 5, 2, C.boot); rect(x + 9, y + 22, 5, 2, C.boot);
  // corpo e avental
  rect(x + 2, y + 4 + breathe, 12, 13 - breathe, C.hood);
  rect(x + 5, y + 7, 8, 11, C.apron); rect(x + 5, y + 7, 1, 11, C.apronDark); rect(x + 7, y + 6, 5, 1, C.apronDark);
  // capuz comprido descendo pelas costas (o mesmo da logo) e o tufo no alto
  rect(x, y - 6, 9, 9, C.hood); rect(x - 1, y - 3, 3, 18, C.hood); rect(x - 1, y - 3, 1, 18, C.hoodDark); rect(x + 1, y - 6, 6, 1, C.hoodLight);
  px(x + 2, y - 7, C.hoodDark); px(x + 4, y - 8, C.hoodDark); px(x + 5, y - 7, C.hoodDark); px(x + 3, y - 7, C.hood);
  // rosto de perfil, virado para a bigorna
  rect(x + 6, y - 3, 4, 5, C.skin); px(x + 10, y - 1, C.skin); px(x + 10, y, C.skin); px(x + 7, y + 1, C.skinDark); px(x + 8, y - 2, '#1a1414'); // olho
  rect(x + 6, y + 2, 4, 2, '#4a3426'); // barba curta
  // braço que segura a tenaz (mão esquerda à frente, baixa) e a tenaz até a barra
  line(x + 11, y + 7, x + 15, y + 9, C.hood); rect(x + 15, y + 8, 2, 2, C.skin); line(x + 17, y + 9, x + 22, y + 8, C.metalLight);
  // braço do martelo: ombro → mão girando pelo ângulo
  const { a } = hammerPose(phase);
  const sx = x + 9, sy = y + 4, len = 10;
  const hx = Math.round(sx + Math.cos(a) * len), hy = Math.round(sy - Math.sin(a) * len + 2);
  line(sx, sy, hx, hy, C.hoodLight); line(sx, sy + 1, hx, hy + 1, C.hood);
  rect(hx - 1, hy - 1, 2, 2, C.skin);
  // cabo e cabeça do martelo
  const ha = a - 0.8, ex = Math.round(hx + Math.cos(ha) * 7), ey = Math.round(hy - Math.sin(ha) * 7); // no golpe o cabo aponta para baixo e a cabeça cai na barra
  line(hx, hy, ex, ey, C.woodLight);
  const px2 = Math.round(Math.cos(ha + Math.PI / 2) * 2), py2 = Math.round(-Math.sin(ha + Math.PI / 2) * 2);
  line(ex - px2, ey - py2, ex + px2, ey + py2, C.metalLight); line(ex - px2 + 1, ey - py2, ex + px2 + 1, ey + py2, C.metal);
}

// ---------- partículas (determinísticas pelo tempo) ----------
function smoke(t) {
  const every = 420, life = 6000;
  for (let k = Math.floor((t - life) / every); k <= Math.floor(t / every); k++) {
    if (k < 0) continue;
    const age = t - k * every; if (age < 0 || age > life) continue;
    const r = rng(k * 7919), p = age / life;
    const x = 133 + Math.sin(age / 650 + r() * 6) * (1 + p * 4) + p * 44 + (r() - 0.5) * 6, y = 18 - p * 20 + p * p * 8 + (r() - 0.5) * 3; // sobe pouco e o vento leva para a direita (nunca encosta no topo da cena)
    const size = Math.round(1.5 + p * 5.5 + r() * 2.5), a = (p < 0.08 ? p / 0.08 : (1 - (p - 0.08) / 0.92) ** 1.8) * (0.42 + r() * 0.2);
    const shade = p < 0.3 ? 1 : 0.92;
    disc(Math.round(x), Math.round(y), size, rgba(C.smoke.map((v) => Math.round(v * shade)), a.toFixed(3)));
  }
}
function sparks(t) {
  const n = Math.floor(t / STRIKE_MS);
  for (let k = Math.max(0, n - 1); k <= n; k++) {
    const t0 = k * STRIKE_MS + STRIKE_MS * 0.86, age = (t - t0) / 1000; if (age < 0 || age > 0.9) continue;
    const r = rng(k * 104729);
    for (let i = 0; i < 14; i++) {
      const vx = (r() - 0.35) * 70, vy = -(25 + r() * 55), life = 0.35 + r() * 0.5; if (age > life) continue;
      const x = 92 + vx * age, y = 87 + vy * age + 130 * age * age, f = age / life;
      px(Math.round(x), Math.round(y), f < 0.3 ? C.fire4 : f < 0.65 ? C.fire3 : C.fire2);
      if (f < 0.4) px(Math.round(x - vx * 0.012), Math.round(y - vy * 0.012), C.fire2); // rastro curto
    }
  }
}
function embers(t) {
  const every = 380, life = 3200;
  for (let k = Math.floor((t - life) / every); k <= Math.floor(t / every); k++) {
    if (k < 0) continue;
    const age = t - k * every, r = rng(k * 31337); if (age < 0 || age > life || r() > 0.7) continue;
    const p = age / life, x = 126 + r() * 12 + Math.sin(age / 300 + k) * 3, y = 84 - p * 52;
    px(Math.round(x), Math.round(y), p < 0.5 ? C.fire3 : C.fire2);
  }
}

/** Desenha a cena no instante `t` (ms). `ctx` deve ter W x H pixels (ou estar escalado para isso). */
export function drawScene(ctx, t = 0) {
  g = ctx;
  const phase = (t % STRIKE_MS) / STRIKE_MS, flick = t / 1000;
  const { impact } = hammerPose(phase);
  const heat = 0.35 + 0.65 * Math.max(0, 1 - ((phase + 0.14) % 1) * 1.6); // aquece no golpe e esfria até o próximo
  const intensity = 0.8 + Math.sin(flick * 7.3) * 0.08 + Math.sin(flick * 13.1) * 0.06 + (impact ? 0.25 : 0);
  sky(); smoke(t); ground(); shelter(); barrel(); forge(flick); glow(intensity); anvil(heat, impact); smith(phase); sparks(t); embers(t);
  g = null;
}

/** Liga a cena a um canvas: anima com requestAnimationFrame (respeita "Animações reduzidas": um quadro parado) e devolve a função de parar. */
export function mountScene(canvas, { reduced = false } = {}) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (reduced) { drawScene(ctx, STRIKE_MS * 0.4); return () => {}; }
  let raf = 0, last = 0;
  const t0 = performance.now();
  const tick = (now) => { if (now - last >= 1000 / 24) { last = now; drawScene(ctx, now - t0); } raf = requestAnimationFrame(tick); }; // 24 qps: ritmo de pixel art
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
