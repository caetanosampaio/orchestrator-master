import React, { useId } from 'react';

/**
 * O golem de liga, desenhado do zero em VETOR: metal com chanfros e reflexos, partes quentes com brilho de verdade (filtro de desfoque), proporção "chibi"
 * (cabeça e mãos grandes) e detalhes de forja (portinha de fornalha na barriga, chaminé, rebites, veios de metal derretido). Sete fases (golem.js > STAGES).
 * `colors` = a liga ({ base, mid, hi }: a mistura dos metais das suas IAs). `mood`: 'working' (juntas acesas, fornalha forte e faíscas), 'cheer' (olhos felizes),
 * 'idle' ou 'sleep' (olhos apagados, metal frio). `size` = pixels por 100 unidades do desenho (a mesma escala em todas as fases). Só SVG; as animações ficam em golem.css e respeitam "Animações reduzidas".
 */
// Recorte (viewBox) de cada fase. A escala é a MESMA em todas (`size` = pixels por 100 unidades): as fases maiores aparecem maiores, e o crescimento se vê.
const VIEW = [[28, 38, 64, 78], [28, 30, 64, 84], [16, 46, 88, 70], [16, 12, 88, 104], [12, 10, 96, 106], [4, -2, 112, 120], [-4, -10, 128, 130]];
const DEFAULT = { base: '#3a3d44', mid: '#7b818c', hi: '#c3c8d0' };

/** Olhos de golem (brasas): glow por baixo, núcleo claro por cima. Dormindo = traço apagado; feliz = arcos. */
function GolemEyes({ x1, x2, y, rx = 3.6, ry = 2.8, mood, id, visor = false }) {
  if (mood === 'sleep') return <path d={visor ? `M${x1 - 6} ${y} H${x2 + 6}` : `M${x1 - rx} ${y} h${rx * 2} M${x2 - rx} ${y} h${rx * 2}`} stroke="#2a1610" strokeWidth="1.6" strokeLinecap="round" />;
  if (mood === 'cheer') return <g filter={`url(#${id}-glow)`}><path d={`M${x1 - rx} ${y + 1} q${rx} ${-ry * 2.2} ${rx * 2} 0 M${x2 - rx} ${y + 1} q${rx} ${-ry * 2.2} ${rx * 2} 0`} fill="none" stroke="#ffd27a" strokeWidth="2" strokeLinecap="round" /></g>;
  const core = mood === 'working' ? '#fff6d0' : '#ffe2a0';
  return (
    <g className="gl-blink">
      {visor && <rect x={x1 - 8} y={y - 3.2} width={x2 - x1 + 16} height="6.4" rx="3.2" fill="#1a100c" />}
      <g filter={`url(#${id}-glow)`}><ellipse cx={x1} cy={y} rx={rx} ry={ry} fill="#ff9a3d" /><ellipse cx={x2} cy={y} rx={rx} ry={ry} fill="#ff9a3d" /></g>
      <ellipse cx={x1} cy={y - 0.3} rx={rx * 0.55} ry={ry * 0.5} fill={core} /><ellipse cx={x2} cy={y - 0.3} rx={rx * 0.55} ry={ry * 0.5} fill={core} />
    </g>
  );
}
/** Placa de metal: corpo no degradê da liga, reflexo em cima e sombra embaixo. */
function Plate({ x, y, w, h, r, id, shade = true }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={`url(#${id}-metal)`} />
      <rect x={x + 1.2} y={y + 1} width={w - 2.4} height={Math.min(3, h / 3)} rx={Math.min(r, 1.5)} fill={`url(#${id}-shine)`} opacity=".8" />
      {shade && <rect x={x} y={y + h * 0.62} width={w} height={h * 0.38} rx={r} fill={`url(#${id}-shade)`} />}
    </g>
  );
}
const Rivet = ({ x, y, c }) => <g><circle cx={x} cy={y} r="1.35" fill={c.base} /><circle cx={x - 0.35} cy={y - 0.35} r=".7" fill={c.hi} /></g>;
/** Faíscas que sobem enquanto os agentes trabalham. */
const Sparks = ({ cx, top }) => (
  <g className="gl-sparks">{[-15, -6, 5, 14, -1].map((dx, i) => <circle key={i} className={`gl-spark s${i % 4}`} cx={cx + dx} cy={top + (i === 4 ? -4 : 0)} r={i % 2 ? 1 : 1.4} fill="#ffd27a" />)}</g>
);

/** Fases 3 a 6: o golem de corpo inteiro. `steel` (aço), `titan` (titã) e `myth` (mítico) acrescentam peças. */
function Golem({ c, id, mood, steel, titan, myth }) {
  const hot = `url(#${id}-hot)`, glow = `url(#${id}-glow)`;
  const furnace = mood === 'sleep' ? 0.25 : mood === 'working' ? 1 : 0.7;
  return (
    <g>
      {myth && <g className="gl-aura"><ellipse cx="60" cy="74" rx="54" ry="16" fill="none" stroke="#ffcf7a" strokeWidth=".9" strokeDasharray="1.5 5" opacity=".8" />{[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={60 + 54 * Math.cos((i * Math.PI) / 3)} cy={74 + 16 * Math.sin((i * Math.PI) / 3)} r="1.4" fill="#ffd27a" filter={glow} />)}</g>}
      <ellipse cx="60" cy="113" rx={titan ? 38 : 27} ry="3.2" className="gl-shadow" />
      <g transform={myth ? 'translate(60 112) scale(1.18) translate(-60 -112)' : titan ? 'translate(60 112) scale(1.12) translate(-60 -112)' : undefined}>
      {titan && <path d="M34 60 L22 92 L36 88 Z M86 60 L98 92 L84 88 Z" fill={c.base} opacity=".9" />}
      {/* pernas e botas */}
      <Plate x={46} y={88} w={11} h={18} r={4} id={id} /><Plate x={63} y={88} w={11} h={18} r={4} id={id} />
      <rect x="43" y="102" width="17" height="9" rx="4.5" fill={c.base} /><rect x="60" y="102" width="17" height="9" rx="4.5" fill={c.base} />
      <rect x="44.5" y="102.8" width="14" height="2" rx="1" fill={c.mid} opacity=".7" /><rect x="61.5" y="102.8" width="14" height="2" rx="1" fill={c.mid} opacity=".7" />
      {steel && <><path d="M45 92 h13 l-2 5 h-9 z" fill={c.hi} opacity=".85" /><path d="M62 92 h13 l-2 5 h-9 z" fill={c.hi} opacity=".85" /></>}
      {/* braços (mão grande) */}
      <g className="gl-arm l">
        <Plate x={27} y={60} w={10} h={15} r={4} id={id} />
        <rect x={23} y={74} width={16} height={15} rx={7} fill={`url(#${id}-metal)`} /><path d="M25 79 h12" stroke={c.base} strokeWidth="1" opacity=".6" />
        {titan && <path d="M25 76 h12" stroke={hot} strokeWidth="1.6" strokeLinecap="round" filter={glow} />}
      </g>
      <g className="gl-arm r">
        <Plate x={83} y={60} w={10} h={15} r={4} id={id} />
        <rect x={81} y={74} width={16} height={15} rx={7} fill={`url(#${id}-metal)`} /><path d="M83 79 h12" stroke={c.base} strokeWidth="1" opacity=".6" />
        {titan && <path d="M83 76 h12" stroke={hot} strokeWidth="1.6" strokeLinecap="round" filter={glow} />}
      </g>
      {/* tronco em barril, com costura rebitada e a portinha da fornalha */}
      <Plate x={37} y={57} w={46} h={36} r={11} id={id} />
      <path d="M39 73 Q60 77 81 73" fill="none" stroke={c.base} strokeWidth="1.1" opacity=".55" />
      {!steel && [43, 51, 69, 77].map((x) => <Rivet key={x} x={x} y={x < 60 ? 72.6 : 72.6} c={c} />)}
      <g className="gl-furnace" opacity={furnace}>
        <path d="M51 90 V81 a9 7 0 0 1 18 0 V90 Z" fill="#1c100b" />
        <path d="M53 90 V82 a7 5.5 0 0 1 14 0 V90 Z" fill={hot} filter={glow} />
        <path d="M55 82.5 h10 M54.5 85.5 h11 M54.5 88.3 h11" stroke="#3a160a" strokeWidth="1" />
      </g>
      <path d="M50 90.5 h20" stroke={c.base} strokeWidth="1.4" strokeLinecap="round" />
      {steel && <><rect x="40" y="86" width="40" height="3.6" rx="1.8" fill={c.base} /><rect x="56" y="85.4" width="8" height="4.8" rx="1.2" fill={c.hi} /></>}
      {steel && !titan && <g><circle cx="60" cy="66" r="5.2" fill="#1c100b" /><circle cx="60" cy="66" r="3.6" fill={hot} filter={glow} opacity={furnace} /><path d="M57.5 66 h5 M60 63.5 v5" stroke="#fff3c4" strokeWidth=".9" strokeLinecap="round" opacity={furnace} /></g>}
      {titan && <path d="M42 63 l6 4 l-2 6 l7 5 M78 62 l-5 6 l3 5 l-6 6" fill="none" stroke={hot} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter={glow} className="gl-molten" />}
      {titan && <g><circle cx="60" cy="66" r="6.5" fill="#1c100b" /><circle cx="60" cy="66" r="4.8" fill={hot} filter={glow} className="gl-core" /><path d="M56.5 66 l3.5 -4 l3.5 4 l-3.5 4 z" fill="#fff3c4" opacity=".9" /></g>}
      {/* ombros (juntas em brasa) e ombreiras do aço */}
      {[[38, 61], [82, 61]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="6.2" fill={`url(#${id}-metal)`} /><circle cx={x} cy={y} r="2.6" fill={hot} filter={glow} className="gl-joint" opacity={furnace} /></g>)}
      {steel && <><path d="M28 61 Q31 49 44 52 L42 60 Z" fill={`url(#${id}-metal)`} /><path d="M29.5 58 Q33 51 42 53" fill="none" stroke={c.hi} strokeWidth="1" opacity=".8" /><path d="M92 61 Q89 49 76 52 L78 60 Z" fill={`url(#${id}-metal)`} /><path d="M90.5 58 Q87 51 78 53" fill="none" stroke={c.hi} strokeWidth="1" opacity=".8" /></>}
      {/* pescoço e cabeça grande */}
      <rect x="54" y="53" width="12" height="6" rx="2" fill={c.base} />
      {!steel && <g><rect x="68" y="21" width="6" height="11" rx="1.5" fill={c.base} /><rect x="67" y="20" width="8" height="3" rx="1.2" fill={c.mid} />{mood === 'working' && <g className="gl-smoke"><circle cx="71" cy="15" r="2.4" fill="#9a9090" opacity=".5" /><circle cx="73" cy="10" r="3" fill="#9a9090" opacity=".35" /></g>}</g>}
      {titan && <g className="gl-crown">{[[-13, 10], [-5, 14], [5, 14], [13, 10]].map(([dx, hgt], i) => <path key={i} d={`M${60 + dx - 3.4} 32 L${60 + dx} ${32 - hgt} L${60 + dx + 3.4} 32 Z`} fill={i % 3 ? hot : `url(#${id}-metal)`} filter={i % 3 ? glow : undefined} />)}</g>}
      {steel && !titan && <path d="M60 22 q8 4 6 12 h-12 q-2 -8 6 -12 z" fill={`url(#${id}-metal)`} />}
      <Plate x={42} y={28} w={36} h={28} r={10} id={id} />
      <path d="M45 37 Q60 31 75 37" fill="none" stroke={c.base} strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      {!steel && <><Rivet x={46} y={50} c={c} /><Rivet x={74} y={50} c={c} /></>}
      <GolemEyes x1={52} x2={68} y={43} mood={mood} id={id} visor={steel} rx={steel ? 3 : 3.6} ry={steel ? 2 : 2.8} />
      {!steel && mood !== 'sleep' && <path d="M56 50.5 v2.4 M60 50.5 v2.4 M64 50.5 v2.4" stroke={c.base} strokeWidth="1.2" strokeLinecap="round" />}
      {steel && <path d="M54 51 h12" stroke={c.base} strokeWidth="1.4" strokeLinecap="round" />}
      {myth && <ellipse cx="60" cy="14" rx="15" ry="3.4" fill="none" stroke="#ffe08a" strokeWidth="1.5" filter={glow} className="gl-halo" />}
      </g>
    </g>
  );
}

export default function GolemSprite({ stage = 0, colors, mood = 'idle', size = 220, className = '' }) {
  const id = `gl${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const c = colors ?? DEFAULT;
  const s = Math.min(6, Math.max(0, Math.round(stage)));
  const hot = `url(#${id}-hot)`, glow = `url(#${id}-glow)`;
  const lit = mood === 'sleep' ? 0.3 : mood === 'working' ? 1 : 0.75;
  let body;
  if (s === 0) {
    body = (
      <g>
        <ellipse cx="60" cy="112" rx="18" ry="2.6" className="gl-shadow" />
        <path d="M60 56 C76 56 84 78 84 91 C84 104 73 111 60 111 C47 111 36 104 36 91 C36 78 44 56 60 56 Z" fill={`url(#${id}-coal)`} />
        <path d="M60 56 L50 70 L60 74 Z M60 56 L72 68 L60 74 Z M38 86 L50 70 L52 92 Z M82 86 L72 68 L70 92 Z" fill="#fff" opacity=".05" />
        <ellipse cx="60" cy="87" rx="13" ry="6" fill={hot} opacity={0.35 * lit} filter={glow} className="gl-pulse" />
        <path d="M44 88 l6 -6 l4 5 l6 -7 l5 6 l6 -5 l5 4 M58 80 l-2 -6 M66 81 l3 -5" fill="none" stroke={hot} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" filter={glow} opacity={lit} className="gl-seam" />
        <ellipse cx="51" cy="66" rx="3.2" ry="7" fill="#fff" opacity=".1" transform="rotate(-22 51 66)" />
        <g className="gl-flicker"><circle cx="64" cy="50" r="1.8" fill="#ffd27a" filter={glow} /><circle cx="56" cy="46" r="1.1" fill="#ffd27a" /><circle cx="69" cy="44" r=".9" fill="#ffd27a" /></g>
      </g>
    );
  } else if (s === 1) {
    body = (
      <g>
        <ellipse cx="60" cy="110" rx="19" ry="2.6" className="gl-shadow" />
        <g className="gl-flicker" filter={glow}>
          <path d="M60 36 C53 46 51 53 55 60 C57 56 59 55 60 59 C62 55 64 56 66 60 C70 52 67 45 60 36 Z" fill="#ff8a3d" />
          <path d="M60 44 C57 50 56 54 58 58 C59 56 61 56 62 58 C64 54 63 49 60 44 Z" fill="#ffe08a" />
        </g>
        <circle cx="60" cy="84" r="25" fill={`url(#${id}-ember)`} />
        <path d="M37 80 Q42 68 52 64 L50 74 Z M74 63 Q83 70 85 80 L74 76 Z M44 98 Q52 106 62 108 L58 99 Z" fill="#4a1d10" opacity=".72" />
        <path d="M50 74 L52 64 M74 76 L74 63 M58 99 L62 108" stroke="#ffcf7a" strokeWidth=".8" opacity=".6" />
        <ellipse cx="49" cy="74" rx="4" ry="8" fill="#fff" opacity=".22" transform="rotate(-28 49 74)" />
        <ellipse cx="46" cy="90" rx="4.6" ry="2.6" fill="#ff5a3d" opacity=".45" /><ellipse cx="74" cy="90" rx="4.6" ry="2.6" fill="#ff5a3d" opacity=".45" />
        {mood === 'sleep' ? <path d="M48 84 h7 M65 84 h7" stroke="#3a140a" strokeWidth="2" strokeLinecap="round" />
          : mood === 'cheer' ? <path d="M48 86 q3.5 -6 7 0 M65 86 q3.5 -6 7 0" fill="none" stroke="#3a140a" strokeWidth="2.2" strokeLinecap="round" />
            : <g className="gl-blink"><ellipse cx="52" cy="84" rx="3.6" ry="4.6" fill="#2a0e06" /><ellipse cx="68" cy="84" rx="3.6" ry="4.6" fill="#2a0e06" /><circle cx="53.2" cy="82.2" r="1.4" fill="#fff" /><circle cx="69.2" cy="82.2" r="1.4" fill="#fff" /><circle cx="51" cy="86" r=".6" fill="#fff" opacity=".8" /><circle cx="67" cy="86" r=".6" fill="#fff" opacity=".8" /></g>}
        <path d="M56 93 q4 3.4 8 0" fill="none" stroke="#3a140a" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    );
  } else if (s === 2) {
    body = (
      <g>
        <ellipse cx="60" cy="113" rx="34" ry="2.8" className="gl-shadow" />
        <rect x="42" y="100" width="9" height="11" rx="3.5" fill={c.base} /><rect x="69" y="100" width="9" height="11" rx="3.5" fill={c.base} />
        <ellipse cx="26" cy="88" rx="5" ry="3.6" fill={c.mid} className="gl-arm l" /><ellipse cx="94" cy="88" rx="5" ry="3.6" fill={c.mid} className="gl-arm r" />
        <path d="M31 78 L89 78 L95 102 L25 102 Z" fill={`url(#${id}-metal)`} />
        <path d="M36 68 L84 68 L89 78 L31 78 Z" fill={`url(#${id}-top)`} />
        <path d="M37 69.4 L83 69.4" stroke="#fff" strokeWidth=".9" opacity=".55" />
        <path d="M84 68 L92 72 L97 100 L89 78 Z" fill={c.base} opacity=".85" />
        <path d="M26 97 L94 97 L95 102 L25 102 Z" fill={hot} opacity={0.6 * lit + 0.1} filter={glow} className="gl-cool" />
        <path d="M54 92 l6 -6 l6 6 M56 92 h8" fill="none" stroke={c.base} strokeWidth="1.3" strokeLinecap="round" opacity=".7" />
        {mood === 'sleep' ? <path d="M46 86 h7 M67 86 h7" stroke="#20140f" strokeWidth="1.8" strokeLinecap="round" />
          : mood === 'cheer' ? <path d="M46 87 q3.5 -5 7 0 M67 87 q3.5 -5 7 0" fill="none" stroke="#20140f" strokeWidth="2" strokeLinecap="round" />
            : <g className="gl-blink"><ellipse cx="49.5" cy="86" rx="3" ry="3.8" fill="#20140f" /><ellipse cx="70.5" cy="86" rx="3" ry="3.8" fill="#20140f" /><circle cx="50.6" cy="84.6" r="1.1" fill="#fff" /><circle cx="71.6" cy="84.6" r="1.1" fill="#fff" /></g>}
        {mood !== 'sleep' && <g className="gl-steam" opacity=".45"><path d="M48 64 q-3 -5 0 -9 q3 -4 0 -8" fill="none" stroke="#d8d0c8" strokeWidth="1.4" strokeLinecap="round" /><path d="M70 62 q3 -5 0 -9" fill="none" stroke="#d8d0c8" strokeWidth="1.2" strokeLinecap="round" /></g>}
      </g>
    );
  } else {
    body = <Golem c={c} id={id} mood={mood} steel={s >= 4} titan={s >= 5} myth={s >= 6} />;
  }
  const top = [44, 34, 50, 18, 16, 6, 4][s];
  const vb = VIEW[s];
  return (
    <svg className={`gl gl-s${s} gl-m-${mood}${className ? ` ${className}` : ''}`} width={Math.round((size * vb[2]) / 100)} height={Math.round((size * vb[3]) / 100)} viewBox={vb.join(' ')} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2=".9" y2="1"><stop offset="0" stopColor={c.hi} /><stop offset=".38" stopColor={c.mid} /><stop offset="1" stopColor={c.base} /></linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.hi} /><stop offset="1" stopColor={c.mid} /></linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" /></linearGradient>
        <radialGradient id={`${id}-hot`} cx="50%" cy="45%" r="65%"><stop offset="0" stopColor="#fff3c0" /><stop offset=".4" stopColor="#ffb347" /><stop offset="1" stopColor="#ff5a1f" /></radialGradient>
        <radialGradient id={`${id}-ember`} cx="40%" cy="34%" r="72%"><stop offset="0" stopColor="#ffe9a8" /><stop offset=".45" stopColor="#ff8a3a" /><stop offset="1" stopColor="#b12e16" /></radialGradient>
        <radialGradient id={`${id}-coal`} cx="38%" cy="28%" r="85%"><stop offset="0" stopColor="#57504d" /><stop offset=".6" stopColor="#2a2524" /><stop offset="1" stopColor="#121010" /></radialGradient>
        <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {body}
      {mood === 'working' && s >= 1 && <Sparks cx={60} top={top} />}
    </svg>
  );
}
