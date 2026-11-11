import React from 'react';
import { pixelShapes } from '../pixel-mascot.js';

/**
 * Bonequinho em pixel art (ver pixel-mascot.js), na cor `--pm` do pai. É um SVG plano, como o das telas de referência: nada de 3D. `size` é a largura do corpo em pixels (o desenho inteiro é um pouco mais largo,
 * por causa das alças). As pernas dão passos quando o pai tem a classe `.px-walk` (hover nos times, teams.css, desligado por "Animações reduzidas").
 */
export default function PixelMascot({ size = 40, label = null, className = '', hat = false, crest = false }) {
  const g = pixelShapes({ hat, crest }), w = size * 1.25, h = (w * g.h) / g.w;
  return (
    <svg className={`px${className ? ` ${className}` : ''}`} width={w} height={h} viewBox={g.viewBox} shapeRendering="crispEdges" focusable="false" role={label ? 'img' : undefined} aria-label={label ?? undefined} aria-hidden={label ? undefined : true}>
      {g.shapes.map((s, k) => (s.t === 'poly'
        ? <polygon key={k} className={`px-${s.cls}`} points={s.pts} />
        : <rect key={k} className={`px-${s.cls.split(' ').join(' px-')}`} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />))}
    </svg>
  );
}
