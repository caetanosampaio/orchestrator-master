import React from 'react';
import claudeStarUrl from '../assets/claude-star.webp';
import { providerColor } from '../provider-view.js';
import PixelMascot from './PixelMascot.jsx';

// Marcas dos agentes (providers).
//  - Claude Code: a logo oficial (estrela, imagem em assets/claude-star.webp) na sidebar, no botão de "trabalhando" do terminal e nas Configurações;
//    o mascote (pixel-art, vetorizado a partir da referência oficial) é a variante `mascot`, usada no cabeçalho dos terminais.
//  - Codex CLI: nuvem vetorizada a partir da referência do ícone oficial (codex-icon.webp); troque o conteúdo de CodexMark pelo arquivo oficial se tiver.

const CLAUDE_ORANGE = '#d87756'; // cor medida na referência oficial (216,119,86)
// A estrela ocupa ~69% da imagem (margem transparente): a imagem é ampliada e centrada para a estrela preencher o tamanho pedido.
const STAR_FILL = 1.45;

/** Estrela oficial do Claude. Um <span> do tamanho pedido (gira em torno do centro, que é o da estrela) com a imagem centrada dentro. */
function ClaudeStar({ size, className, title }) {
  const big = size * STAR_FILL, off = -(big - size) / 2;
  return (
    <span className={`prov-mark claude prov-star${className ? ` ${className}` : ''}`} style={{ position: 'relative', display: 'inline-block', width: size, height: size, flex: 'none' }} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <img src={claudeStarUrl} alt="" draggable="false" style={{ position: 'absolute', left: off, top: off, width: big, height: big, maxWidth: 'none', pointerEvents: 'none' }} />
    </span>
  );
}

/**
 * Mascote do Claude Code (pixel-art), medidas exatas da referência (500×500): corpo, braços, 4 pernas e 2 olhos vazados.
 * Partes com classe para a animação de "trabalhando" (oc.css/retro.css): pernas alternadas (cm-leg-a/b) e pálpebras (cm-lid) que piscam sobre os olhos.
 */
function ClaudeMascot({ size, className, title }) {
  const w = size * 1.25, h = (w * 313) / 500;
  return (
    <svg className={`prov-mark claude mascot${className ? ` ${className}` : ''}`} width={w} height={h} viewBox="0 104 500 313" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" fill={CLAUDE_ORANGE}>
      <path fillRule="evenodd" d="M63 104h375v125h62v65h-62v62H63v-62H0v-65h63zM125 169h32v60h-32zM344 169h32v60h-32z" />
      <rect className="cm-lid" x="125" y="169" width="32" height="60" />
      <rect className="cm-lid" x="344" y="169" width="32" height="60" />
      <rect className="cm-leg cm-leg-a" x="94" y="356" width="31" height="61" />
      <rect className="cm-leg cm-leg-b" x="157" y="356" width="31" height="61" />
      <rect className="cm-leg cm-leg-a" x="313" y="356" width="31" height="61" />
      <rect className="cm-leg cm-leg-b" x="376" y="356" width="31" height="61" />
    </svg>
  );
}

/** Codex CLI: nuvem de bordas onduladas com degradê vertical (lavanda, azul-violeta, azul) e o prompt ">_" em branco, reproduzida da referência oficial (ícone do app). */
const CODEX_LOBES = [[11.04, 5.27, 3.27], [6.81, 7.58, 3.27], [17.19, 6.42, 3.27], [18.73, 11.42, 3.27], [17.19, 17.58, 3.46], [12.96, 18.54, 3.85], [7.19, 17.58, 3.46], [5.46, 12.38, 3.65], [12, 12.19, 6.5]];
function CodexMark({ size, className, title }) {
  const grad = `cx-g-${React.useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <svg className={`prov-mark codex${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <defs>
        <linearGradient id={grad} x1="0" y1="2" x2="0" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a995ff" />
          <stop offset=".25" stopColor="#bda0ff" />
          <stop offset=".45" stopColor="#7b8bff" />
          <stop offset=".75" stopColor="#4a4bff" />
          <stop offset="1" stopColor="#3a33ff" />
        </linearGradient>
      </defs>
      <g fill={`url(#${grad})`}>{CODEX_LOBES.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}</g>
      <g fill="none" stroke="#f4f0ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.58 9.12l1.55 3.07-1.75 2.89" />
        <path d="M12.58 14.88h4.02" />
      </g>
    </svg>
  );
}

/**
 * Logo do provider (`claude` | `codex`). `variant="mascot"` troca a estrela do Claude pelo mascote (cabeçalho do terminal); no Codex não muda nada.
 * Provider desconhecido não renderiza nada (o nome continua ao lado).
 */
export default function ProviderLogo({ id, size = 20, title, className = '', variant = 'mark' }) {
  if (id === 'claude') return variant === 'mascot' ? <ClaudeMascot size={size} className={className} title={title} /> : <ClaudeStar size={size} className={className} title={title} />;
  if (id === 'codex') return <CodexMark size={size} className={className} title={title} />;
  return null;
}

/**
 * Bonequinho da IA, em pixel art (PixelMascot), reproduzido das telas de referência: o MESMO corpo para todas e só a cor muda, que é a da IA (provider-catalog.js). Com `label`, o nome vem junto:
 * embaixo (`layout="stack"`, padrão) ou ao lado (`layout="inline"`). `hat` = o chapéu de quem coordena; `crest` = a chama com cara brava (o mascote do FORGE).
 */
export function ProviderMascot({ id, size = 40, label = null, layout = 'stack', className = '', crest = false, hat = false }) {
  return (
    <span className={`pm pm-${layout}${className ? ` ${className}` : ''}`} style={{ '--pm': providerColor(id) }} data-provider={id}>
      <PixelMascot size={size} crest={crest} hat={hat} label={label ? null : `Provider ${id}`} />
      {label && <span className="pm-name">{label}</span>}
    </span>
  );
}
