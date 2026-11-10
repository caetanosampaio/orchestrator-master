// Bonequinho 3D dos providers: a MESMA geometria para todos (o corpo do mascote do Claude Code feito de blocos); só a cor muda. PURO (sem React, sem DOM): as peças e a pose.
// Unidades: 1 = a largura de uma perna (o mascote tem 16 de largura e 10 de altura). x/y a partir do canto superior esquerdo da vista de frente; z = centro do bloco na profundidade (0 = meio do corpo).
export const UNITS = Object.freeze({ w: 16, h: 10 });
const part = (id, kind, x, y, w, h, d, z = 0, leg = null) => Object.freeze({ id, kind, x, y, w, h, d, z, leg });
export const PARTS = Object.freeze([
  part('body', 'body', 2, 0, 12, 8, 6),
  part('arm-l', 'arm', 0, 4, 2, 2, 3), part('arm-r', 'arm', 14, 4, 2, 2, 3),
  part('eye-l', 'eye', 4, 2, 1, 2, 0.06, 3.03), part('eye-r', 'eye', 11, 2, 1, 2, 0.06, 3.03), // olhos: só a face da frente, escura, colada à frente do corpo (blocos finos deixavam riscos nos ângulos laterais)
  part('leg-1', 'leg', 3, 8, 1, 2, 2, 0, 'a'), part('leg-2', 'leg', 5, 8, 1, 2, 2, 0, 'b'),
  part('leg-3', 'leg', 10, 8, 1, 2, 2, 0, 'a'), part('leg-4', 'leg', 12, 8, 1, 2, 2, 0, 'b'),
]);

export const SWAY_DEG = 30, TILT_DEG = -12, REST_YAW = -28; // balanço de lado a lado, inclinação para ver o topo e a pose parada (animações reduzidas)

/**
 * Pose do bonequinho no instante `t` (segundos): giro de lado a lado (`ry`), inclinação (`rx`) e um leve sobe e desce (`bob`, em unidades). `phase` desencontra os bonecos entre si.
 * `reduced` (animações reduzidas): pose parada de três quartos.
 */
export function pose(t = 0, phase = 0, reduced = false) {
  if (reduced) return { ry: REST_YAW, rx: TILT_DEG, bob: 0 };
  return { ry: SWAY_DEG * Math.sin(t * 0.85 + phase), rx: TILT_DEG + 3 * Math.sin(t * 0.6 + phase * 1.7), bob: 0.18 * Math.sin(t * 1.7 + phase) };
}
