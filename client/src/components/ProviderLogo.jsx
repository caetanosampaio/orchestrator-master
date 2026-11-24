import React from 'react';
import claudeStarUrl from '../assets/claude-star.webp';
import { providerColor } from '../provider-view.js';
import { catalogById } from '../provider-catalog.js';
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

// Gemini, Cursor e OpenCode: traçados do projeto Simple Icons (CC0 para os arquivos SVG; as marcas seguem dos donos, usadas aqui só para identificar a IA, como as do Claude e
// do Codex). Gemini com o degradê azul-violeta do logo; Cursor e OpenCode são monocromáticos e seguem a cor do texto.
const GEMINI_PATH = 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81';
const CURSOR_PATH = 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23';
const OPENCODE_PATH = 'M22 24H2V0h20zM17 4.8H7v14.4h10z';
function GeminiMark({ size, className, title }) {
  const grad = `gm-g-${React.useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <svg className={`prov-mark gemini${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <defs><linearGradient id={grad} x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#1c7dff" /><stop offset=".52" stopColor="#7a8cf2" /><stop offset="1" stopColor="#c4a4f4" /></linearGradient></defs>
      <path d={GEMINI_PATH} fill={`url(#${grad})`} />
    </svg>
  );
}
const MonoMark = ({ id, d, size, className, title }) => (
  <svg className={`prov-mark ${id}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false"><path d={d} fill="currentColor" /></svg>
);
const OFFICIAL = new Set(['claude', 'codex', 'gemini', 'cursor', 'opencode']);

/**
 * Ícone de QUALQUER IA do catálogo: o oficial das integradas (ProviderLogo) e, para as que ainda não têm ícone no FORGE, um selo neutro com a inicial na cor da IA
 * (provisório: troque pelo arquivo oficial da IA quando ele entrar em assets/). Usado em Configurações > Suas IAs.
 */
export function AiIcon({ id, size = 24, title, className = '' }) {
  if (OFFICIAL.has(id)) return <ProviderLogo id={id} size={size} title={title} className={className} />;
  return <AiMonogram id={id} size={size} title={title} className={className} />;
}
/** Selo com a inicial na cor da IA (provisório, até o ícone oficial entrar em assets/). */
function AiMonogram({ id, size, title, className = '' }) {
  const c = catalogById(id), letter = String(c?.label ?? id ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={`ai-mono${className ? ` ${className}` : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.5), '--ai': c?.color ?? '#9aa3b2' }} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>{letter}</span>
  );
}

/**
 * Logo do provider (`claude` | `codex`). `variant="mascot"` troca a estrela do Claude pelo mascote (cabeçalho do terminal); no Codex não muda nada.
 * Gemini, Cursor e OpenCode com o ícone oficial; as outras IAs do catálogo levam o selo com a inicial; id fora do catálogo não renderiza nada (o nome continua ao lado).
 */
export default function ProviderLogo({ id, size = 20, title, className = '', variant = 'mark' }) {
  if (id === 'claude') return variant === 'mascot' ? <ClaudeMascot size={size} className={className} title={title} /> : <ClaudeStar size={size} className={className} title={title} />;
  if (id === 'codex') return <CodexMark size={size} className={className} title={title} />;
  if (id === 'gemini') return <GeminiMark size={size} className={className} title={title} />;
  if (id === 'cursor') return <MonoMark id="cursor" d={CURSOR_PATH} size={size} className={className} title={title} />;
  if (id === 'opencode') return <MonoMark id="opencode" d={OPENCODE_PATH} size={size} className={className} title={title} />;
  return catalogById(id) && !catalogById(id).brand ? <AiMonogram id={id} size={size} title={title} className={className} /> : null;
}

/**
 * Bonequinho da IA, em pixel art (PixelMascot), reproduzido das telas de referência: o MESMO corpo para todas e só a cor muda, que é a da IA (provider-catalog.js). Com `label`, o nome vem junto:
 * embaixo (`layout="stack"`, padrão) ou ao lado (`layout="inline"`). `hat` = o chapéu de quem coordena.
 */
export function ProviderMascot({ id, size = 40, label = null, layout = 'stack', className = '', hat = false }) {
  return (
    <span className={`pm pm-${layout}${className ? ` ${className}` : ''}`} style={{ '--pm': providerColor(id) }} data-provider={id}>
      <PixelMascot size={size} hat={hat} label={label ? null : `Provider ${id}`} />
      {label && <span className="pm-name">{label}</span>}
    </span>
  );
}
