// Bonequinho em pixel art das IAs, reproduzido das telas de referência: um corpo quadrado (faixa clara no alto e sombra embaixo), duas alças vazadas nas laterais, dois pés escuros, olhos com um brilho e boca em triângulo.
// Todos têm o MESMO corpo e só a cor muda (a das IAs, em provider-catalog.js). Variação: `hat` (o chapéu, de quem coordena). O mascote do FORGE tem arte própria (forge-mascot.js).
// PURO (sem React): a lista de formas de um quadro de 20 unidades de largura (x para a direita, y para baixo; y negativo = acima do corpo). Cada forma tem uma classe que o CSS pinta (teams.css, .px-*).
export const PIXEL_W = 20;
const r = (cls, x, y, w, h, extra = {}) => Object.freeze({ t: 'rect', cls, x, y, w, h, ...extra });
const p = (cls, pts) => Object.freeze({ t: 'poly', cls, pts });

/** As formas do mascote e a caixa de visão (`viewBox`): mais alta quando tem chapéu. */
export function pixelShapes({ hat = false } = {}) {
  const shapes = [
    r('arm', 0.6, 6.2, 2.4, 4.2), r('arm', 17, 6.2, 2.4, 4.2),                 // alças vazadas (só o contorno)
    r('leg lega', 5, 14.6, 3, 4.4), r('leg legb', 12, 14.6, 3, 4.4),           // pés
    r('body', 3, 2, 14, 13.2), r('hi', 3, 2, 14, 1.1), r('lo', 3, 14.1, 14, 1.1), // corpo, faixa clara e sombra
  ];
  shapes.push(r('eye', 5.6, 5.2, 1.7, 1.7), r('glint', 6.6, 5.2, 0.7, 0.7), r('eye', 12.7, 5.2, 1.7, 1.7), r('glint', 13.7, 5.2, 0.7, 0.7), p('mouth', '8,9.2 12,9.2 10,11.4'));
  if (hat) shapes.push(r('hat', 5.2, -1, 9.6, 3.4, { rx: 0.6 }), r('brim', 2.6, 1.7, 14.8, 1.3));
  const top = hat ? -2 : 0;
  return Object.freeze({ shapes: Object.freeze(shapes), viewBox: `0 ${top} ${PIXEL_W} ${20 - top}`, w: PIXEL_W, h: 20 - top });
}
