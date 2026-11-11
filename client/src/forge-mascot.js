// O mascote do FORGE, em pixel art, com identidade PRÓPRIA (não é o das telas de referência): o Forjador, uma bigorna que ganhou vida. Placa de aço com a ponta (o "chifre") para a direita, uma pequena chama
// no topo, rosto de brasa na cintura, base escura com dois pés e um martelo na mão, com faíscas. As faíscas (`SPARK`) são pequenas chamas com olhos que acompanham o Forjador nas ilustrações.
// PURO (sem React): listas de formas num quadro de 32 x 28 unidades; cada forma tem uma classe pintada pelo CSS (harness.css, .fm-*).
const r = (cls, x, y, w, h) => Object.freeze({ t: 'rect', cls, x, y, w, h });
const p = (cls, pts) => Object.freeze({ t: 'poly', cls, pts });

export const FORGE_BOX = Object.freeze({ w: 32, h: 28, viewBox: '0 0 32 28' });
export const FORGE_SHAPES = Object.freeze([
  p('flame', '11,10 12,5 14,7.5 15,2 17,7.5 19,5 20,10'), p('flame-in', '13,10 14,7 15.5,4.5 17,7 18,10'), p('flame-hot', '14.5,10 15.5,7.5 16.5,10'), // chama no topo
  r('steel', 4, 10, 20, 4), p('steel', '24,10 31,11 27,14 24,14'), r('steel-hi', 4, 10, 20, 1), r('steel-lo', 4, 13, 20, 1),                                   // placa e chifre
  r('steel-lo', 9, 14, 10, 5),                                                                                                                              // cintura (o rosto)
  r('steel-dk', 6, 19, 16, 4), r('steel-lo', 6, 19, 16, 1),                                                                                                  // base
  r('steel-dk', 8, 23, 5, 3), r('steel-dk', 15, 23, 5, 3),                                                                                                  // pés
  r('gold', 11, 15.5, 2, 2), r('gold', 15, 15.5, 2, 2), r('hot', 11, 15.5, 1, 1), r('hot', 15, 15.5, 1, 1), r('ember', 12.5, 18, 3, 1),                       // olhos e boca de brasa
  r('wood', 2, 13, 1.5, 9), r('steel-dk', 0, 9, 5, 4), r('steel-hi', 0, 9, 5, 1),                                                                           // martelo
  r('gold', 0, 6.5, 1, 1), r('ember', 3, 5.5, 1, 1), r('gold', 6, 7, 1, 1), r('ember', 30, 8, 1, 1), r('gold', 28, 6, 1, 1),                                 // faíscas
]);

/** A faísca: uma chama pequena com olhos (quadro de 10 x 12), para acompanhar o Forjador. */
export const SPARK_BOX = Object.freeze({ w: 10, h: 12, viewBox: '0 0 10 12' });
export const SPARK_SHAPES = Object.freeze([
  p('flame', '1,12 1,6 3,8 5,0 7,8 9,6 9,12'), p('flame-in', '3,12 3,8 5,4 7,8 7,12'),
  r('eye', 3, 8, 1, 2), r('eye', 6, 8, 1, 2),
]);
