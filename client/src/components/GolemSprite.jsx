import React from 'react';
import { golemSprite, paletteFor, runs, HOT } from '../pixel-golem.js';

/**
 * O golem de liga em PIXEL ART (pixel-golem.js monta a grade de cada fase). `scale` = pixels de tela por pixel do desenho (inteiro: bordas nítidas, a mesma escala
 * em todas as fases, então as fases maiores aparecem maiores). `mood` (golem.js > liveMood), como uma forja que esfria aos poucos:
 *   'working' (gastando tokens): o golpe em 4 quadros — ergue os braços, desce, bate as mãos no chão (o corpo afunda, tudo treme, faíscas e poeira) e volta;
 *     `burst` (os tokens acabaram de subir) encurta o compasso e aviva as brasas;
 *   'slowing': os últimos golpes, lentos; 'cheer' (um trabalho terminou): pula com os olhos felizes e solta confete;
 *   'cooling': respira fundo, solta vapor e as brasas baixam; 'idle': respira, pisca, olha para os lados e se espreguiça de vez em quando;
 *   'drowsy': pálpebras pesadas, cabeceia; 'sleep': olhos fechados, brasas apagadas e Zzz.
 * `alert` = um agente espera você: um "!" pisca no canto. `quiet` = sem Zzz nem "!" (as miniaturas da trilha de evolução).
 * As animações (golem.css) andam em degraus, como sprites clássicos, e respeitam "Animações reduzidas". Só SVG.
 */
function Pixels({ list, pal, hotClass = true }) {
  return runs(list).map(([x, y, w, ch], i) => <rect key={i} x={x} y={y} width={w} height="1" fill={pal[ch] ?? '#ff00ff'} className={hotClass && HOT.has(ch) ? 'px-hot' : undefined} />);
}
const Fx = ({ list, pal, cls }) => list.map(([x, y, ch], i) => <rect key={i} x={x} y={y} width="1" height="1" fill={pal[ch]} className={`${cls} f${i % 5}${ch === 'S' ? ' steam' : ''}`} />);

const HAMMER = new Set(['working', 'slowing']);

function Eyes({ eyes, mood, pal }) {
  if (!eyes) return null;
  const P = (list) => <Pixels list={list} pal={pal} hotClass={false} />;
  if (mood === 'sleep') return <g className="px-eyes">{P(eyes.closed)}</g>;
  if (mood === 'cheer') return <g className="px-eyes">{P(eyes.happy)}</g>;
  if (mood === 'drowsy') return <g className="px-eyes"><g className="px-eh">{P(eyes.half)}</g><g className="px-ed">{P(eyes.closed)}</g></g>;
  if (mood === 'idle') { // olha em volta: centro, esquerda, centro, direita, e pisca (um ciclo de 10 s)
    return <g className="px-eyes"><g className="px-gc">{P(eyes.open)}</g><g className="px-gl">{P(eyes.left)}</g><g className="px-gr">{P(eyes.right)}</g><g className="px-gb">{P(eyes.closed)}</g></g>;
  }
  return <g className="px-eyes"><g className="px-eo">{P(eyes.open)}</g><g className="px-ec">{P(eyes.closed)}</g></g>;
}

export default function GolemSprite({ stage = 0, colors, mood = 'idle', burst = false, alert = false, quiet = false, scale = 4, className = '' }) {
  const sp = golemSprite(stage), pal = paletteFor(colors, mood);
  const fx = mood === 'sleep' || mood === 'drowsy' ? [] : HAMMER.has(mood) ? sp.fx.working : mood === 'cooling' ? [...sp.fx.idle, ...sp.fx.cool] : sp.fx.idle;
  const posed = !!sp.poses && (HAMMER.has(mood) || mood === 'cheer'); // as poses (erguidos / no chão) só entram em cena no golpe e na comemoração
  const cls = ['gl', `gl-s${Math.round(stage)}`, `gl-m-${mood}`, posed ? 'gl-posed' : '', burst && mood === 'working' ? 'gl-burst' : '', alert && !quiet ? 'gl-alert' : '', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} width={sp.w * scale} height={sp.h * scale} viewBox={`0 0 ${sp.w} ${sp.h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <g className="px-all">
        <g className="px-body"><Pixels list={sp.body} pal={pal} /></g>
        {sp.arms.length > 0 && <g className="px-arms px-pose-rest"><Pixels list={sp.arms} pal={pal} /></g>}
        {posed && <g className="px-pose-up"><Pixels list={sp.poses.up} pal={pal} /></g>}
        {posed && HAMMER.has(mood) && <g className="px-pose-slam"><Pixels list={sp.poses.slam} pal={pal} /></g>}
        <Eyes eyes={sp.eyes} mood={mood} pal={pal} />
        {fx.length > 0 && <g className="px-fx"><Fx list={fx} pal={pal} cls="px-f" /></g>}
        {HAMMER.has(mood) && sp.fx.hit.length > 0 && <g className="px-hit"><Fx list={sp.fx.hit} pal={pal} cls="px-h" /></g>}
        {mood === 'cheer' && <g className="px-cheer"><Fx list={sp.fx.cheer} pal={pal} cls="px-c" /></g>}
      </g>
      {!quiet && alert && <g className="px-alert"><Pixels list={sp.alert} pal={pal} hotClass={false} /></g>}
      {!quiet && !alert && mood === 'sleep' && <g className="px-zzz"><g className="px-z z1"><Pixels list={sp.zzz} pal={pal} hotClass={false} /></g><g className="px-z z2"><Pixels list={sp.zzz} pal={pal} hotClass={false} /></g></g>}
    </svg>
  );
}
