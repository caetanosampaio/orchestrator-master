import React, { useId } from 'react';

/**
 * A criatura do bichinho, desenhada do zero em VETOR (curvas suaves, degradês; nada de pixel art nem do Forjador): uma "brasinha" redonda e fofa que choca de um ovo.
 * Cada fase muda a silhueta: bebê (pequena gota), criança (corpo maior com bracinhos e um broto), adulto em três formas, conforme o cuidado (radiante, curioso, travesso).
 * O rosto muda com o humor (feliz, triste, com fome, doente, com sono, dormindo). Só SVG: nada de HTML cru.
 */
const PALETTE = {
  baby: ['#ffd29a', '#ff9a62'], child: ['#ffc58a', '#ff7f6a'],
  radiante: ['#ffd36e', '#ff6f91'], curioso: ['#8ee6e0', '#4c8dff'], travesso: ['#c7a2ff', '#7a4cff'],
};

function Face({ mood, cx, cy, s }) {
  const eyeDx = 9 * s, eyeY = cy - 2 * s;
  const eyes = (() => {
    if (mood === 'happy') return [-1, 1].map((d) => <path key={d} d={`M ${cx + d * eyeDx - 4.5 * s} ${eyeY + 1.5 * s} q ${4.5 * s} ${-6 * s} ${9 * s} 0`} className="pc-line" strokeWidth={2.6 * s} />);
    if (mood === 'asleep' || mood === 'tired') return [-1, 1].map((d) => <path key={d} d={`M ${cx + d * eyeDx - 4.5 * s} ${eyeY} q ${4.5 * s} ${4 * s} ${9 * s} 0`} className="pc-line" strokeWidth={2.4 * s} />);
    if (mood === 'sick') return [-1, 1].map((d) => <g key={d} className="pc-line" strokeWidth={2 * s}><path d={`M ${cx + d * eyeDx - 3.5 * s} ${eyeY - 3.5 * s} l ${7 * s} ${7 * s} M ${cx + d * eyeDx + 3.5 * s} ${eyeY - 3.5 * s} l ${-7 * s} ${7 * s}`} /></g>);
    return [-1, 1].map((d) => (
      <g key={d} className="pc-eye">
        <ellipse cx={cx + d * eyeDx} cy={eyeY} rx={4.2 * s} ry={5.4 * s} className="pc-pupil" />
        <circle cx={cx + d * eyeDx + 1.5 * s} cy={eyeY - 2.2 * s} r={1.6 * s} className="pc-shine" />
      </g>
    ));
  })();
  const my = cy + 8 * s;
  const mouth = mood === 'happy' ? <path d={`M ${cx - 6 * s} ${my - 1 * s} q ${6 * s} ${7 * s} ${12 * s} 0 z`} className="pc-mouth" />
    : mood === 'hungry' ? <ellipse cx={cx} cy={my + 1 * s} rx={3.6 * s} ry={4.2 * s} className="pc-mouth" />
      : mood === 'sad' || mood === 'sick' ? <path d={`M ${cx - 5 * s} ${my + 3 * s} q ${5 * s} ${-5 * s} ${10 * s} 0`} className="pc-line" strokeWidth={2.2 * s} />
        : mood === 'asleep' ? <ellipse cx={cx} cy={my + 1 * s} rx={2 * s} ry={1.6 * s} className="pc-mouth" />
          : <path d={`M ${cx - 4.5 * s} ${my} q ${4.5 * s} ${4 * s} ${9 * s} 0`} className="pc-line" strokeWidth={2.2 * s} />;
  return (
    <g>
      <ellipse cx={cx - 15 * s} cy={cy + 5 * s} rx={4.6 * s} ry={2.8 * s} className="pc-blush" />
      <ellipse cx={cx + 15 * s} cy={cy + 5 * s} rx={4.6 * s} ry={2.8 * s} className="pc-blush" />
      {eyes}{mouth}
      {mood === 'sad' && <path d={`M ${cx + eyeDx + 3 * s} ${eyeY + 4 * s} q ${2 * s} ${4 * s} 0 ${6 * s} q ${-2 * s} ${-2 * s} 0 ${-6 * s} z`} className="pc-tear" />}
      {mood === 'hungry' && <path d={`M ${cx + 2.5 * s} ${my + 5 * s} q ${1.6 * s} ${3 * s} 0 ${5 * s} q ${-1.6 * s} ${-2 * s} 0 ${-5 * s} z`} className="pc-tear" />}
    </g>
  );
}

/** O ovo: creme com pintinhas; balança e racha perto de chocar (`crack` de 0 a 1). */
function Egg({ crack, gid }) {
  return (
    <g className="pc-egg">
      <ellipse cx="50" cy="94" rx="18" ry="3.5" className="pc-shadow" />
      <path d="M50 44 C 64 44 72 64 72 76 C 72 88 62 95 50 95 C 38 95 28 88 28 76 C 28 64 36 44 50 44 Z" fill={`url(#${gid}-egg)`} className="pc-egg-shell" />
      <ellipse cx="42" cy="62" rx="3.2" ry="4.2" className="pc-spot" /><ellipse cx="58" cy="72" rx="4.2" ry="3.4" className="pc-spot" /><ellipse cx="46" cy="83" rx="2.6" ry="2.2" className="pc-spot" />
      <ellipse cx="41" cy="56" rx="3.5" ry="6" className="pc-gloss" transform="rotate(-22 41 56)" />
      {crack > 0.35 && <path d="M33 71 l6 -4 l5 5 l6 -6 l5 5 l6 -4 l6 4" className="pc-crack" />}
      {crack > 0.7 && <path d="M44 66 l3 -6 M58 64 l-2 -5" className="pc-crack" />}
    </g>
  );
}

// Recorte (viewBox) de cada fase: o desenho ocupa a área toda, sem margem vazia (o tamanho pedido é a LARGURA).
const VIEW = { egg: [22, 40, 56, 58], baby: [24, 44, 52, 54], child: [16, 26, 68, 72], adult: [10, 4, 80, 94] };

export default function PetCreature({ stage = 'egg', form = null, mood = 'ok', crack = 0, size = 160, facing = 'front', className = '' }) {
  const gid = `pc${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const key = stage === 'adult' ? form ?? 'radiante' : stage === 'child' ? 'child' : 'baby';
  const [c1, c2] = PALETTE[key] ?? PALETTE.baby;
  const vb = VIEW[stage] ?? VIEW.adult;
  const look = facing === 'left' ? -4 : facing === 'right' ? 4 : 0; // o rosto vira um pouco para o lado (joguinho)
  let body = null;
  if (stage === 'baby') {
    body = (
      <g>
        <ellipse cx="50" cy="94" rx="16" ry="3" className="pc-shadow" />
        <path d="M50 58 C 64 58 70 70 70 79 C 70 89 61 94 50 94 C 39 94 30 89 30 79 C 30 70 36 58 50 58 Z" fill={`url(#${gid}-b)`} />
        <path d="M50 58 C 49 52 52 48 56 47 C 54 51 55 54 52 58 Z" className="pc-sprout" />
        <ellipse cx="42" cy="68" rx="4" ry="6" className="pc-gloss" transform="rotate(-25 42 68)" />
        <g transform={`translate(${look} 0)`}><Face mood={mood} cx={50} cy={78} s={0.62} /></g>
      </g>
    );
  } else if (stage === 'child') {
    body = (
      <g>
        <ellipse cx="50" cy="94" rx="20" ry="3.5" className="pc-shadow" />
        <ellipse cx="28" cy="74" rx="6" ry="4" fill={c2} className="pc-arm l" /><ellipse cx="72" cy="74" rx="6" ry="4" fill={c2} className="pc-arm r" />
        <path d="M50 44 C 68 44 76 60 76 72 C 76 86 65 93 50 93 C 35 93 24 86 24 72 C 24 60 32 44 50 44 Z" fill={`url(#${gid}-b)`} />
        <path d="M50 44 C 47 36 52 30 58 29 C 56 34 58 38 54 44 Z" className="pc-sprout" /><path d="M51 41 C 46 38 41 39 39 42 C 43 42 46 43 49 45 Z" className="pc-sprout" />
        <ellipse cx="38" cy="56" rx="4.5" ry="8" className="pc-gloss" transform="rotate(-25 38 56)" />
        <ellipse cx="40" cy="93" rx="6" ry="3" fill={c2} /><ellipse cx="60" cy="93" rx="6" ry="3" fill={c2} />
        <g transform={`translate(${look} 0)`}><Face mood={mood} cx={50} cy={68} s={0.85} /></g>
      </g>
    );
  } else if (stage === 'adult') {
    const top = key === 'radiante' ? (
      <g className="pc-crest"><path d="M50 30 C 44 22 46 12 54 8 C 52 15 58 18 56 26 C 60 22 64 22 66 18 C 66 26 60 31 54 32 Z" fill="#ffe08a" /><circle cx="34" cy="26" r="2" className="pc-sparkle" /><circle cx="70" cy="34" r="1.6" className="pc-sparkle" /></g>
    ) : key === 'curioso' ? (
      <g className="pc-crest"><path d="M50 32 C 50 24 52 18 56 14" className="pc-line" strokeWidth="2.4" /><circle cx="57" cy="12" r="4.5" fill="#fff3a6" className="pc-bulb" /></g>
    ) : (
      <g className="pc-crest"><path d="M36 36 C 32 28 34 22 38 20 C 38 26 41 30 44 33 Z" fill="#5a2fd6" /><path d="M64 36 C 68 28 66 22 62 20 C 62 26 59 30 56 33 Z" fill="#5a2fd6" /></g>
    );
    body = (
      <g>
        <ellipse cx="50" cy="95" rx="25" ry="3.5" className="pc-shadow" />
        <ellipse cx="21" cy="66" rx="7" ry="4.6" fill={c2} className="pc-arm l" /><ellipse cx="79" cy="66" rx="7" ry="4.6" fill={c2} className="pc-arm r" />
        {top}
        <path d="M50 30 C 72 30 82 48 82 64 C 82 82 68 94 50 94 C 32 94 18 82 18 64 C 18 48 28 30 50 30 Z" fill={`url(#${gid}-b)`} />
        <ellipse cx="50" cy="75" rx="17" ry="13" className="pc-belly" />
        <ellipse cx="34" cy="44" rx="5" ry="9" className="pc-gloss" transform="rotate(-28 34 44)" />
        <ellipse cx="38" cy="94" rx="7" ry="3" fill={c2} /><ellipse cx="62" cy="94" rx="7" ry="3" fill={c2} />
        <g transform={`translate(${look} 0)`}><Face mood={mood === 'happy' && key === 'travesso' ? 'happy' : mood} cx={50} cy={56} s={1} /></g>
        {key === 'travesso' && mood !== 'asleep' && <path d="M58 66 l3 3 l3 -3" className="pc-line" strokeWidth="1.6" />}
      </g>
    );
  }
  return (
    <svg className={`pc pc-${stage}${stage === 'adult' ? ` pc-${key}` : ''} pc-m-${mood}${className ? ` ${className}` : ''}`} width={size} height={Math.round((size * vb[3]) / vb[2])} viewBox={vb.join(' ')} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${gid}-b`} cx="38%" cy="32%" r="75%"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></radialGradient>
        <radialGradient id={`${gid}-egg`} cx="38%" cy="30%" r="80%"><stop offset="0" stopColor="#fffaf0" /><stop offset="1" stopColor="#f1dcc0" /></radialGradient>
      </defs>
      {stage === 'egg' ? <Egg crack={crack} gid={gid} /> : body}
    </svg>
  );
}
