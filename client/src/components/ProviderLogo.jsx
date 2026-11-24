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
const MonoMark = ({ id, d, size, className, title, evenOdd = false }) => (
  <svg className={`prov-mark ${id}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false"><path d={d} fill="currentColor" fillRule={evenOdd ? 'evenodd' : undefined} /></svg>
);
// IAs ainda não integradas (só aparecem para acompanhar): Copilot e Kimi do Simple Icons (CC0); Grok, Kiro, Antigravity e Muse do LobeHub Icons (MIT). Kiro e Muse nas versões
// coloridas oficiais (simples); as demais nas monocromáticas oficiais (a colorida do Antigravity é feita de borrões sobrepostos, pesada para um ícone pequeno).
const COPILOT_PATH = 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z';
const KIMI_PATH = 'M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441';
const GROK_PATH = 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815';
const ANTIGRAVITY_PATH = 'M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z';
const MUSE_PATH = 'M5.91 3.869C6.777 3.869 7.396 4.546 7.396 5.607 7.396 6.669 7.225 7.626 6.941 9.659 6.738 11.084 6.389 13.258 6.243 14.162 6.523 13.628 7.178 12.378 7.294 12.144 8.666 9.375 10.096 6.901 10.508 6.246 11.054 5.372 11.535 5.021 12.278 5.021 12.664 5.022 13.124 5.217 13.352 5.477 13.66 5.829 13.725 6.398 13.714 7.019 13.698 7.97 13.574 9.486 13.405 11.177 13.33 11.929 13.185 13.466 13.087 14.496 13.965 12.925 15.591 10.035 16.246 9.025 16.817 8.146 17.392 7.579 18.164 7.579 18.83 7.579 19.651 8.05 19.603 9.302 19.531 11.149 19.264 15.174 19.143 16.979 19.96 15.79 21.033 14.029 21.436 13.367 21.842 12.698 22.26 12.157 22.894 12.139 23.544 12.12 23.979 12.562 23.999 13.244 24.019 13.927 23.612 14.694 23.072 15.565 22.486 16.511 21.831 17.523 21.033 18.468 20.236 19.413 19.502 20.131 18.384 20.131 17.382 20.131 16.677 19.465 16.628 18.246 16.602 17.607 16.723 16.234 16.814 15.16 16.92 13.917 17.048 12.717 17.137 11.923 16.256 13.535 14.402 16.912 13.568 18.23 12.752 19.52 12.355 19.974 11.493 19.975 10.631 19.975 10.253 19.354 10.241 18.42 10.227 17.407 10.988 11.324 11.246 9.297 10.828 10.191 9.801 12.385 9.157 13.69 8.534 14.953 7.489 17.135 6.73 18.393 6.184 19.298 5.57 19.975 4.66 19.975 3.75 19.975 3.236 19.363 3.236 18.379 3.236 17.395 3.521 15.756 3.827 13.723 3.98 12.739 4.155 11.667 4.352 10.53 4.496 9.708 4.746 8.26 4.9 7.371 4.2 8.461 2.941 10.423 2.558 11.014 2.131 11.671 1.749 12.15 1.115 12.15 0.416 12.15 0 11.605 0 10.971 0 10.337 0.322 9.848 0.846 8.988 1.518 7.883 2.726 6.377 3.388 5.586 4.168 4.654 4.947 3.869 5.91 3.869Z';
const svgProps = (id, size, className, title) => ({ className: `prov-mark ${id}${className ? ` ${className}` : ''}`, width: size, height: size, viewBox: '0 0 24 24', role: title ? 'img' : undefined, 'aria-label': title, 'aria-hidden': title ? undefined : true, focusable: 'false' });
function KiroMark({ size, className, title }) {
  return (
    <svg {...svgProps('kiro', size, className, title)}>
      <path d="M18.8 0H5.2A5.2 5.2 0 000 5.2v13.6A5.2 5.2 0 005.2 24h13.6a5.2 5.2 0 005.2-5.2V5.2A5.2 5.2 0 0018.8 0z" fill="#9046FF" />
      <path d="M7.97 16.376c-1.644 3.642 1.86 4.556 4.443 2.424.76 2.39 3.608.607 4.631-1.247 2.251-4.084 1.342-8.249 1.108-9.108-1.6-5.859-9.6-5.869-10.976.03-.323 1.033-.328 2.206-.507 3.423-.09.617-.16 1.009-.393 1.655-.139.373-.323.7-.62 1.257-.458.865-.264 2.53 2.101 1.665l.224-.1h-.01l-.001.001z" fill="#fff" />
      <path d="M12.722 10.985c-.656 0-.755-.785-.755-1.252 0-.423.074-.756.218-.97a.61.61 0 01.537-.283c.229 0 .428.095.567.289.159.218.243.55.243.964 0 .785-.303 1.252-.805 1.252h-.005zm2.703 0c-.656 0-.755-.785-.755-1.252 0-.423.074-.756.219-.97a.61.61 0 01.536-.283c.229 0 .428.095.567.289.159.218.243.55.243.964 0 .785-.303 1.252-.805 1.252h-.005z" fill="#000" />
    </svg>
  );
}
function MuseMark({ size, className, title }) {
  const grad = `mu-g-${React.useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <svg {...svgProps('muse', size, className, title)}>
      <defs><linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="31.979" x2="5.981" y1="26.171" y2="-3.014"><stop offset=".255" stopColor="#0082FB" /><stop offset=".697" stopColor="#0064E0" /><stop offset="1" stopColor="#0040DC" /></linearGradient></defs>
      <path d={MUSE_PATH} fill={`url(#${grad})`} />
    </svg>
  );
}
const MONO = Object.freeze({ cursor: [CURSOR_PATH], opencode: [OPENCODE_PATH], copilot: [COPILOT_PATH], kimi: [KIMI_PATH], grok: [GROK_PATH, true], antigravity: [ANTIGRAVITY_PATH, true] });
const OFFICIAL = new Set(['claude', 'codex', 'gemini', 'cursor', 'opencode', 'copilot', 'kimi', 'grok', 'kiro', 'antigravity', 'muse']);

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
 * Gemini, Cursor, OpenCode e as IAs ainda não integradas (Copilot, Kimi, Grok, Kiro, Antigravity, Muse) com o ícone oficial; IA do catálogo sem ícone leva o selo com a inicial; id fora do catálogo não renderiza nada (o nome continua ao lado).
 */
export default function ProviderLogo({ id, size = 20, title, className = '', variant = 'mark' }) {
  if (id === 'claude') return variant === 'mascot' ? <ClaudeMascot size={size} className={className} title={title} /> : <ClaudeStar size={size} className={className} title={title} />;
  if (id === 'codex') return <CodexMark size={size} className={className} title={title} />;
  if (id === 'gemini') return <GeminiMark size={size} className={className} title={title} />;
  if (id === 'kiro') return <KiroMark size={size} className={className} title={title} />;
  if (id === 'muse') return <MuseMark size={size} className={className} title={title} />;
  if (Object.hasOwn(MONO, id)) return <MonoMark id={id} d={MONO[id][0]} evenOdd={MONO[id][1] === true} size={size} className={className} title={title} />;
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
