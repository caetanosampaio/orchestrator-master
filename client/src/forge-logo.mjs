// Logo do FORGE: o ferreiro de traço à mão (referência logo-design.jpg) martelando na bigorna, com vapor subindo. Fonte ÚNICA da marca:
// a interface (barra lateral, setup), o ícone do app (Windows, Mac, Linux) e o ícone da barra de menus/área de notificação saem daqui.
// Traço de nanquim: linhas arredondadas com leve irregularidade (como a caneta do esboço), uma cor só. Sem dependências: string SVG pura.

export const VIEWBOX = '0 0 100 100';

// Cena completa (figura + vara + bigorna + fogo + vapor + chão), em coordenadas 0..100.
// Coordenadas tiradas do esboço (x = (px - 130) * 0.187 + 8; y = (py - 390) * 0.187 + 37), com o traço levemente irregular da caneta.
const FIGURE = [
  'M26.3 72.4 L26 78.3', 'M33.8 72.6 L34.2 78.4', // pernas
  'M24.9 52.4 C24.6 59 24.7 65.6 24.3 72.2 C28.4 72.6 32.4 72.5 36.6 72.2', // corpo: frente e barra
  'M24.9 39.2 C29 37.9 33.4 37.4 37.1 37.8 C39.9 40.4 39.6 47.6 38.6 54.4 C37.9 60.4 37.2 66.4 36.6 72.2', // capuz: do alto da cabeça, desce pelas costas até a barra
  'M35.9 40.2 C34.6 44.6 34.7 50.2 35.8 54.1 C37.1 50 37.2 44.4 35.9 40.2', // a alça comprida dentro do capuz
  'M21.9 41.2 C19.6 42.6 18 44.4 18.1 46.4 C18.2 48.6 18.4 50.6 19.1 51.9 C20.8 50.4 22.6 49.9 24.8 51 L25 52.4', // cabeça de perfil: testa, focinho e queixo
  'M25 52.4 C28.2 52.2 31.2 52.6 34.2 52.9', // linha do ombro
  'M23.2 41.6 C26.4 43.7 29.6 45.9 32.6 48.1 C33.4 49 33.4 49.8 33.1 50.6 C32.4 54 31.6 57.2 30.8 60.4', // braço: diagonal até o cotovelo e de volta às mãos
];
const ROD = 'M15.4 61.9 C27.6 61.4 40.2 61.8 52.9 61.5'; // a vara/martelo atravessando até a bigorna
const ANVIL_TOP = 'M42.6 64.4 L58.9 64.6 L58.6 66.9 L55.6 67.9 L49.6 68.2 L45.3 67.6 L42.8 66.4 Z'; // bigorna (preenchida)
const ANVIL = ['M47.1 68.4 L45.6 78', 'M55.1 68.2 L57.2 78']; // pés
const FIRE = ['M48.6 71.9 C49.4 74.2 48.2 75.9 49.1 77.9', 'M51.2 70.9 C52 73.6 50.6 75.6 51.5 77.9', 'M53.8 72.1 C53.1 74.4 54.4 76.1 53.6 77.8']; // brasa sob a bigorna
const STEAM = ['M49.4 57.4 C47.4 54.2 51.4 51.8 49.2 48.2', 'M53.4 55.2 C51.2 50.8 55.6 47.4 53.1 41.8']; // vapor
const GROUND = 'M7.6 78.1 C30 77.6 60 78.5 92.5 78.2';
const HAIR = 'M20.4 40.6 L19.9 38.9 L21.3 38.3 L21.5 36.9 L23 37.6 L24.4 36.8 L24.6 38.4 L25.9 39.2 L24.8 40.4 L25.1 41.8 L23.5 41.6 L22.4 42.7 L21.8 41.3 Z'; // o tufo espetado no alto da cabeça (preenchido)
const APRON = 'M31.6 62.4 L37.1 62 L36.7 72.1 L34.4 72.2 C33.6 68.8 32.8 65.4 31.6 62.4 Z'; // a sombra do avental abaixo da vara (preenchida)

/** Trechos do vapor, para a interface animar (cada um sobe e some em sequência). */
export const STEAM_PATHS = STEAM;

/**
 * SVG da logo. `variant`: 'full' (a cena do esboço), 'mark' (recorte quadrado da figura e da bigorna, para ícones pequenos) ou 'glyph' (só bigorna + vapor,
 * legível em 16 px: barra de menus e área de notificação). `ink` = cor do traço; `paper` = fundo (null = transparente); `rounded` = raio do fundo em % (ícone do app).
 * `stroke` engrossa o traço quando o ícone fica pequeno.
 */
export function logoSvg({ variant = 'full', ink = '#141414', paper = null, rounded = 0, size = null, stroke = null, steamClass = '', steam = null } = {}) {
  const sw = stroke ?? (variant === 'glyph' ? 5.2 : variant === 'mark' ? 2.4 : 1.7);
  const box = variant === 'glyph' ? '38 36 26 44' : variant === 'mark' ? '12 33 52 48' : VIEWBOX;
  const [bx, by, bw, bh] = box.split(' ').map(Number);
  const side = Math.max(bw, bh), vb = `${bx - (side - bw) / 2} ${by - (side - bh) / 2} ${side} ${side}`; // centra num quadrado
  const [vx, vy] = vb.split(' ').map(Number);
  const line = (d, extra = '') => `<path d="${d}"${extra}/>`;
  // `steam` = { dy, opacity }: desloca e esmaece o vapor (quadros da animação do ícone da bandeja enquanto os agentes trabalham)
  const vapor = () => { const ps = STEAM.map((d) => line(d, steamClass ? ` class="${steamClass}"` : '')).join(''); return steam ? `<g transform="translate(0 ${-(steam.dy ?? 0)})" opacity="${steam.opacity ?? 1}">${ps}</g>` : ps; };
  const parts = variant === 'glyph'
    ? [line(ANVIL_TOP, ` fill="${ink}"`), ...ANVIL.map((d) => line(d)), vapor(), line('M40.4 78 L61.6 78')]
    : [...FIGURE.map((d) => line(d)), line(ROD), line(HAIR, ` fill="${ink}"`), line(APRON, ` fill="${ink}" stroke-width="${sw * 0.5}"`), line(ANVIL_TOP, ` fill="${ink}"`), ...ANVIL.map((d) => line(d)), ...FIRE.map((d) => line(d)), vapor(), line(GROUND)];
  const bg = paper ? `<rect x="${vx}" y="${vy}" width="${side}" height="${side}" rx="${(side * rounded) / 100}" fill="${paper}" stroke="none"/>` : '';
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${dim}>${bg}<g fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g></svg>`;
}

/**
 * Ícone do app: o recorte 'mark' em nanquim sobre papel, num quadrado arredondado. No Mac segue a grade da Apple (conteúdo em 824 de 1024 px, cantos ~22%);
 * no Windows/Linux ocupa a caixa inteira. Devolve a string SVG no tamanho pedido.
 */
export function appIconSvg({ size = 1024, platform = 'mac', ink = '#161514', paper = '#efebe2' } = {}) {
  const inset = platform === 'mac' ? 100 / 1024 : 0.02; // margem da grade da Apple (100 px de cada lado em 1024)
  const inner = 1 - inset * 2, r = platform === 'mac' ? 22.5 : 18;
  const mark = logoSvg({ variant: 'mark', ink, stroke: size <= 32 ? 3.6 : 2.6 }).replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const vb = /viewBox="([^"]+)"/.exec(logoSvg({ variant: 'mark' }))[1].split(' ').map(Number);
  const s = size * inner, o = size * inset, k = s / vb[2];
  const pad = 0.06; // respiro do desenho dentro do quadrado
  const ks = k * (1 - pad * 2), os = o + s * pad;
  const rx = (s * r) / 100, clip = `fx-clip-${size}-${platform}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<defs><clipPath id="${clip}"><rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${rx}"/></clipPath></defs>`
    + `<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${rx}" fill="${paper}"/>`
    + `<g clip-path="url(#${clip})"><g transform="translate(${os - vb[0] * ks} ${os - vb[1] * ks}) scale(${ks})">${mark}</g></g></svg>`;
}
