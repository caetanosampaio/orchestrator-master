import React, { useId } from 'react';

/**
 * O golem de liga, desenhado do zero em VETOR (placas, rebites, juntas em brasa; nada de pixel art). Sete fases, da faísca no carvão ao titã mítico (golem.js > STAGES).
 * `colors` = a liga ({ base, mid, hi }, a mistura dos metais das suas IAs). `mood`: 'working' (juntas acesas e faíscas), 'cheer' (olhos felizes), 'idle' ou 'sleep'
 * (olhos fechados, metal frio). Só SVG; as animações ficam em golem.css e respeitam "Animações reduzidas".
 */
const VIEW = [[30, 46, 60, 64], [30, 36, 60, 66], [18, 38, 84, 70], [14, 10, 92, 104], [8, 4, 104, 112], [2, 0, 116, 118], [0, 0, 120, 120]];

function Eyes({ x1, x2, y, w = 6, h = 3.4, mood, hot }) {
  if (mood === 'sleep') return <g className="gl-eyes"><path d={`M${x1 - w / 2} ${y} h${w} M${x2 - w / 2} ${y} h${w}`} stroke="#1b1412" strokeWidth="1.6" strokeLinecap="round" /></g>;
  if (mood === 'cheer') return <g className="gl-eyes"><path d={`M${x1 - w / 2} ${y + 1} q${w / 2} ${-h * 1.4} ${w} 0 M${x2 - w / 2} ${y + 1} q${w / 2} ${-h * 1.4} ${w} 0`} fill="none" stroke={hot} strokeWidth="1.8" strokeLinecap="round" /></g>;
  return <g className="gl-eyes gl-blink"><rect x={x1 - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={hot} /><rect x={x2 - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={hot} /></g>;
}
const Rivets = ({ pts, c }) => pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.3" fill={c} />);
const Joint = ({ x, y, r = 3.2, id }) => <circle className="gl-joint" cx={x} cy={y} r={r} fill={`url(#${id}-hot)`} />;
/** Faíscas que sobem enquanto os agentes trabalham. */
const Sparks = ({ cx, top }) => (
  <g className="gl-sparks">{[-14, -5, 6, 15].map((dx, i) => <circle key={i} className={`gl-spark s${i}`} cx={cx + dx} cy={top} r={i % 2 ? 1.1 : 1.5} fill="#ffd27a" />)}</g>
);

export default function GolemSprite({ stage = 0, colors, mood = 'idle', size = 220, className = '' }) {
  const id = `gl${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const c = colors ?? { base: '#3a3d44', mid: '#7b818c', hi: '#c3c8d0' };
  const hot = mood === 'sleep' ? '#7a3a1e' : '#ffb347';
  const metal = `url(#${id}-metal)`, side = `url(#${id}-side)`;
  const shadow = (cx, rx, cy = 116) => <ellipse cx={cx} cy={cy} rx={rx} ry="2.6" className="gl-shadow" />;
  let body;
  if (stage <= 0) {
    body = (
      <g>
        {shadow(60, 18, 108)}
        <path d="M60 52 C74 52 82 72 82 86 C82 100 72 108 60 108 C48 108 38 100 38 86 C38 72 46 52 60 52 Z" fill={`url(#${id}-coal)`} />
        <path d="M44 84 l6 -5 l5 6 l5 -7 l5 6 l6 -5 l5 4" fill="none" stroke={`url(#${id}-hot)`} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="gl-seam" />
        <ellipse cx="52" cy="66" rx="3" ry="6" fill="#fff" opacity=".12" transform="rotate(-20 52 66)" />
        <circle cx="66" cy="50" r="2.2" fill="#ffd27a" className="gl-flicker" />
      </g>
    );
  } else if (stage === 1) {
    body = (
      <g>
        {shadow(60, 16, 100)}
        <path d="M60 46 C 57 40 60 36 64 34 C 62 39 66 41 63 46 Z" fill="#ffd27a" className="gl-flicker" />
        <circle cx="60" cy="74" r="25" fill={`url(#${id}-ember)`} />
        <ellipse cx="48" cy="86" rx="6" ry="3.5" fill="#5a2414" opacity=".55" /><ellipse cx="74" cy="66" rx="5" ry="3" fill="#5a2414" opacity=".5" /><ellipse cx="66" cy="92" rx="4" ry="2.4" fill="#5a2414" opacity=".5" />
        <ellipse cx="50" cy="62" rx="4" ry="7" fill="#fff" opacity=".25" transform="rotate(-25 50 62)" />
        {mood === 'sleep' ? <path d="M50 74 h6 M64 74 h6" stroke="#3a140a" strokeWidth="2" strokeLinecap="round" />
          : mood === 'cheer' ? <path d="M50 76 q3 -5 6 0 M64 76 q3 -5 6 0" fill="none" stroke="#3a140a" strokeWidth="2" strokeLinecap="round" />
            : <g className="gl-blink"><ellipse cx="53" cy="74" rx="3" ry="4" fill="#3a140a" /><ellipse cx="67" cy="74" rx="3" ry="4" fill="#3a140a" /><circle cx="54" cy="72.5" r="1" fill="#fff" /><circle cx="68" cy="72.5" r="1" fill="#fff" /></g>}
        <path d="M56 83 q4 3 8 0" fill="none" stroke="#3a140a" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    );
  } else if (stage === 2) {
    body = (
      <g>
        {shadow(60, 30, 104)}
        <rect x="42" y="92" width="8" height="10" rx="3" fill={c.base} /><rect x="70" y="92" width="8" height="10" rx="3" fill={c.base} />
        <path d="M30 60 L90 60 L98 92 L22 92 Z" fill={metal} />
        <path d="M34 52 L86 52 L90 60 L30 60 Z" fill={c.hi} />
        <path d="M86 52 L94 58 L98 92 L90 60 Z" fill={side} />
        <path d="M24 86 L96 86 L98 92 L22 92 Z" fill={`url(#${id}-hot)`} opacity=".55" className="gl-cool" />
        <Eyes x1={50} x2={70} y={72} w={7} h={4} mood={mood} hot={mood === 'idle' || mood === 'working' ? '#2a1a14' : hot} />
        <path d="M54 81 q6 4 12 0" fill="none" stroke="#2a1a14" strokeWidth="1.6" strokeLinecap="round" opacity=".7" />
      </g>
    );
  } else {
    const big = stage >= 5, steel = stage >= 4;
    const tw = big ? 58 : steel ? 50 : 44, th = big ? 44 : steel ? 38 : 34, ty = big ? 50 : steel ? 52 : 56, tx = 60 - tw / 2;
    const hw = big ? 34 : steel ? 30 : 28, hh = big ? 24 : 22, hy = ty - hh - 2, hx = 60 - hw / 2;
    const ly = ty + th - 2, legH = 116 - ly - 2;
    body = (
      <g>
        {stage >= 6 && <ellipse cx="60" cy="72" rx="56" ry="20" fill="none" stroke="#ffb347" strokeWidth="1.2" strokeDasharray="2 6" className="gl-aura" />}
        {shadow(60, tw / 2 + 12)}
        {/* pernas */}
        <rect x={60 - tw / 2 + 4} y={ly} width={tw / 2 - 8} height={legH} rx="4" fill={metal} /><rect x={60 + 4} y={ly} width={tw / 2 - 8} height={legH} rx="4" fill={metal} />
        <rect x={60 - tw / 2 + 2} y={114 - 6} width={tw / 2 - 4} height="6" rx="2.5" fill={c.base} /><rect x={62} y={114 - 6} width={tw / 2 - 4} height="6" rx="2.5" fill={c.base} />
        {/* braços */}
        <rect className="gl-arm l" x={tx - (big ? 15 : 12)} y={ty + 4} width={big ? 13 : 10} height={th + (big ? 10 : 6)} rx="5" fill={side} />
        <rect className="gl-arm r" x={tx + tw + 2} y={ty + 4} width={big ? 13 : 10} height={th + (big ? 10 : 6)} rx="5" fill={side} />
        {big && <><rect x={tx - 16} y={ty + th + 10} width="15" height="9" rx="4" fill={`url(#${id}-hot)`} className="gl-joint" /><rect x={tx + tw + 1} y={ty + th + 10} width="15" height="9" rx="4" fill={`url(#${id}-hot)`} className="gl-joint" /></>}
        {/* tronco */}
        {steel
          ? <path d={`M${tx} ${ty + 4} Q${tx} ${ty} ${tx + 6} ${ty} H${tx + tw - 6} Q${tx + tw} ${ty} ${tx + tw} ${ty + 4} L${tx + tw - 5} ${ty + th} H${tx + 5} Z`} fill={metal} />
          : <rect x={tx} y={ty} width={tw} height={th} rx="6" fill={metal} />}
        <rect x={tx + 3} y={ty + 3} width={tw - 6} height="3" rx="1.5" fill={c.hi} opacity=".55" />
        {!steel && <Rivets pts={[[tx + 5, ty + 9], [tx + tw - 5, ty + 9], [tx + 5, ty + th - 6], [tx + tw - 5, ty + th - 6]]} c={c.hi} />}
        {steel && <><path d={`M${tx - 6} ${ty + 2} q6 -8 16 -4 v8 h-16 z`} fill={c.hi} opacity=".9" /><path d={`M${tx + tw + 6} ${ty + 2} q-6 -8 -16 -4 v8 h16 z`} fill={c.hi} opacity=".9" /></>}
        {steel && <g className="gl-core"><circle cx="60" cy={ty + th / 2} r={big ? 8 : 6} fill={`url(#${id}-hot)`} /><path d={`M60 ${ty + th / 2 - 4} v8 M56 ${ty + th / 2} h8`} stroke="#fff3c4" strokeWidth="1.2" strokeLinecap="round" /></g>}
        {big && <path d={`M${tx + 6} ${ty + 12} l8 6 l-3 8 l9 6 M${tx + tw - 6} ${ty + 10} l-7 7 l4 7 l-8 7`} fill="none" stroke={`url(#${id}-hot)`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="gl-molten" />}
        <Joint x={tx + 1} y={ty + 6} id={id} /><Joint x={tx + tw - 1} y={ty + 6} id={id} /><Joint x={60 - tw / 4} y={ly + 1} r={2.8} id={id} /><Joint x={60 + tw / 4} y={ly + 1} r={2.8} id={id} />
        {/* cabeça */}
        {big && <g className="gl-crown">{[-12, -4, 4, 12].map((dx, i) => <path key={i} d={`M${60 + dx - 3} ${hy + 2} L${60 + dx} ${hy - (i % 3 ? 9 : 6)} L${60 + dx + 3} ${hy + 2} Z`} fill={i % 2 ? c.hi : `url(#${id}-hot)`} />)}</g>}
        <rect x={hx} y={hy} width={hw} height={hh} rx={steel ? 8 : 5} fill={metal} />
        <rect x={hx + 3} y={hy + 3} width={hw - 6} height="2.5" rx="1.2" fill={c.hi} opacity=".6" />
        {!steel && <Rivets pts={[[hx + 4, hy + hh - 4], [hx + hw - 4, hy + hh - 4]]} c={c.hi} />}
        {steel && <rect x={hx + 4} y={hy + hh / 2 - 4} width={hw - 8} height="8" rx="4" fill="#1b1412" opacity=".85" />}
        <Eyes x1={60 - hw / 4.2} x2={60 + hw / 4.2} y={hy + hh / 2} w={steel ? 7 : 6} h={steel ? 3 : 3.6} mood={mood} hot={hot} />
      </g>
    );
  }
  const top = [52, 40, 50, 20, 14, 8, 6][Math.min(6, Math.max(0, stage))];
  const vb = VIEW[Math.min(6, Math.max(0, stage))];
  return (
    <svg className={`gl gl-s${stage} gl-m-${mood}${className ? ` ${className}` : ''}`} width={size} height={Math.round((size * vb[3]) / vb[2])} viewBox={vb.join(' ')} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c.hi} /><stop offset=".45" stopColor={c.mid} /><stop offset="1" stopColor={c.base} /></linearGradient>
        <linearGradient id={`${id}-side`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.mid} /><stop offset="1" stopColor={c.base} /></linearGradient>
        <radialGradient id={`${id}-hot`} cx="50%" cy="50%" r="60%"><stop offset="0" stopColor="#fff3b0" /><stop offset=".45" stopColor="#ffb347" /><stop offset="1" stopColor="#ff5a1f" /></radialGradient>
        <radialGradient id={`${id}-ember`} cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#ffe08a" /><stop offset=".5" stopColor="#ff7a2e" /><stop offset="1" stopColor="#b8301a" /></radialGradient>
        <radialGradient id={`${id}-coal`} cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#4a4646" /><stop offset="1" stopColor="#151313" /></radialGradient>
      </defs>
      {body}
      {mood === 'working' && stage >= 1 && <Sparks cx={60} top={top + 6} />}
    </svg>
  );
}
