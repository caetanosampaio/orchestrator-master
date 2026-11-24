import React from 'react';
import { golemSprite, paletteFor, runs, HOT } from '../pixel-golem.js';

/**
 * O golem de liga em PIXEL ART (pixel-golem.js monta a grade de cada fase). `scale` = pixels de tela por pixel do desenho (inteiro: bordas nítidas, a mesma escala
 * em todas as fases, então as fases maiores aparecem maiores). `mood`:
 *   'working' (gastando tokens): ele martela — o corpo sobe e desce rápido, os braços batem, as brasas piscam e as faíscas sobem;
 *   'cheer' (um trabalho terminou): pula com os olhos felizes; 'idle': respira e pisca; 'sleep': olhos fechados, brasas apagadas, respiração lenta.
 * As animações (golem.css) andam em degraus, como sprites clássicos, e respeitam "Animações reduzidas". Só SVG.
 */
function Pixels({ list, pal, hotClass = true }) {
  return runs(list).map(([x, y, w, ch], i) => <rect key={i} x={x} y={y} width={w} height="1" fill={pal[ch] ?? '#ff00ff'} className={hotClass && HOT.has(ch) ? 'px-hot' : undefined} />);
}

export default function GolemSprite({ stage = 0, colors, mood = 'idle', scale = 4, className = '' }) {
  const sp = golemSprite(stage), pal = paletteFor(colors, mood);
  const fx = mood === 'sleep' ? [] : mood === 'working' ? sp.fx.working : sp.fx.idle;
  const eyesNow = sp.eyes ? (mood === 'sleep' ? null : mood === 'cheer' ? sp.eyes.happy : sp.eyes.open) : null;
  return (
    <svg className={`gl gl-s${Math.round(stage)} gl-m-${mood}${className ? ` ${className}` : ''}`} width={sp.w * scale} height={sp.h * scale} viewBox={`0 0 ${sp.w} ${sp.h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <g className="px-all">
        <g className="px-body"><Pixels list={sp.body} pal={pal} /></g>
        {sp.arms.length > 0 && <g className="px-arms"><Pixels list={sp.arms} pal={pal} /></g>}
        {sp.eyes && (mood === 'sleep'
          ? <g className="px-eyes"><Pixels list={sp.eyes.closed} pal={pal} hotClass={false} /></g>
          : <g className="px-eyes">
            <g className="px-eo"><Pixels list={eyesNow} pal={pal} hotClass={false} /></g>
            {mood !== 'cheer' && <g className="px-ec"><Pixels list={sp.eyes.closed} pal={pal} hotClass={false} /></g>}
          </g>)}
        {fx.length > 0 && <g className="px-fx">{fx.map(([x, y, ch], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={pal[ch]} className={`px-f f${i % 5}${ch === 'S' ? ' steam' : ''}`} />)}</g>}
      </g>
    </svg>
  );
}
