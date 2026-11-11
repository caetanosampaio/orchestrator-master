import React from 'react';
import { FORGE_SHAPES, FORGE_BOX, SPARK_SHAPES, SPARK_BOX } from '../forge-mascot.js';

const draw = (shapes) => shapes.map((s, k) => (s.t === 'poly' ? <polygon key={k} className={`fm-${s.cls}`} points={s.pts} /> : <rect key={k} className={`fm-${s.cls}`} x={s.x} y={s.y} width={s.w} height={s.h} />));

/** O Forjador: o mascote do FORGE em pixel art (ver forge-mascot.js). `size` = largura em pixels. As cores vêm das classes .fm-* (harness.css). */
export function ForgeMascot({ size = 64, label = null, className = '' }) {
  return (
    <svg className={`fm${className ? ` ${className}` : ''}`} width={size} height={(size * FORGE_BOX.h) / FORGE_BOX.w} viewBox={FORGE_BOX.viewBox} shapeRendering="crispEdges" focusable="false" role={label ? 'img' : undefined} aria-label={label ?? undefined} aria-hidden={label ? undefined : true}>{draw(FORGE_SHAPES)}</svg>
  );
}
/** A faísca: a chama pequena com olhos que acompanha o Forjador. */
export function SparkSprite({ size = 22, className = '' }) {
  return <svg className={`fm${className ? ` ${className}` : ''}`} width={size} height={(size * SPARK_BOX.h) / SPARK_BOX.w} viewBox={SPARK_BOX.viewBox} shapeRendering="crispEdges" focusable="false" aria-hidden="true">{draw(SPARK_SHAPES)}</svg>;
}
/** A cena da introdução: o Forjador com duas faíscas ao lado. */
export function ForgeScene({ size = 120 }) {
  return (
    <span className="fm-scene" aria-hidden="true">
      <SparkSprite size={size * 0.2} className="fm-spark a" /><ForgeMascot size={size} /><SparkSprite size={size * 0.15} className="fm-spark b" />
    </span>
  );
}
