import React from 'react';
import { glyphTone } from '../forge-shell.js';

/**
 * Glifo de estado em tempo real (o mesmo na sidebar, nas abas, nos terminais, no painel Live e nas missões).
 * A FORMA diz o estado, a cor só reforça: arco girando = executando, arco cinza = iniciando, anel com ponto respirando = aguardando você,
 * círculo com check (entra com um "pop") = concluído, anel vazio = ocioso, círculo com x = falha, traço = encerrado.
 * Decorativo: o texto ao lado (ou o aria-label da linha) diz o mesmo. As animações param com "Animações reduzidas" e prefers-reduced-motion (forge.css).
 */
export default function StatusGlyph({ state = 'idle', size = 14, className = '' }) {
  const t = glyphTone(state);
  return (
    <svg className={`fx-glyph g-${t}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {(t === 'work' || t === 'boot') && <>
        <circle className="g-track" cx="8" cy="8" r="5.6" strokeWidth="1.6" />
        <circle className="g-arc" cx="8" cy="8" r="5.6" strokeWidth="1.8" strokeLinecap="round" pathLength="100" strokeDasharray="30 70" />
      </>}
      {t === 'wait' && <>
        <circle className="g-ring" cx="8" cy="8" r="5.6" strokeWidth="1.6" />
        <circle className="g-core" cx="8" cy="8" r="2.4" />
      </>}
      {t === 'done' && <>
        <circle className="g-ring" cx="8" cy="8" r="5.8" strokeWidth="1.5" />
        <path className="g-check" d="M5.4 8.2l1.8 1.8 3.5-3.9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" pathLength="10" strokeDasharray="10" />
      </>}
      {t === 'idle' && <circle className="g-ring" cx="8" cy="8" r="4.2" strokeWidth="1.5" />}
      {t === 'err' && <>
        <circle className="g-fill" cx="8" cy="8" r="6.2" />
        <path className="g-x" d="M6 6l4 4M10 6l-4 4" strokeWidth="1.6" strokeLinecap="round" />
      </>}
      {t === 'off' && <path className="g-dash" d="M5 8h6" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
