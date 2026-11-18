import React, { useEffect, useMemo, useRef, useState } from 'react';
import TerminalGrid from '../components/TerminalGrid.jsx';
import LivePanel from '../components/LivePanel.jsx';
import { createTerminalStream } from '../terminal-stream.js';

const W_KEY = 'forge.live.width', W_MIN = 300, W_MAX = 760, W_DEF = 400;
const readW = () => { try { const n = Number(localStorage.getItem(W_KEY)); return Number.isFinite(n) && n >= W_MIN ? Math.min(W_MAX, n) : W_DEF; } catch { return W_DEF; } };

/**
 * Cockpit: os terminais dos agentes no centro (abas + grade) e, à direita, o painel Live (preview do localhost e a equipe ao vivo), redimensionável pela borda.
 * UMA conexão SSE de terminais serve os dois: a grade desenha a tela, o painel lê a cauda (URLs locais e última linha de cada agente).
 */
export default function Cockpit({ liveOpen = false, onToggleLive = null, stream: shared = null, flows = null, liveHint = null, liveVisible = true, ...props }) {
  const own = useMemo(() => (shared ? null : createTerminalStream()), [shared]); // o App passa a conexão compartilhada com a página Missões; sem ela o Cockpit abre a sua
  useEffect(() => () => own?.close(), [own]);
  const stream = shared ?? own;
  const [w, setW] = useState(readW);
  const drag = useRef(null);
  // abrir/fechar ou redimensionar o painel muda a largura dos terminais: avisa o xterm para se reajustar
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 240); return () => clearTimeout(t); }, [liveOpen]);
  const onDown = (e) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture?.(e.pointerId);
    const x0 = e.clientX, w0 = w; drag.current = w0;
    document.body.classList.add('fx-resizing');
    const move = (ev) => { const n = Math.max(W_MIN, Math.min(W_MAX, w0 + (x0 - ev.clientX))); drag.current = n; setW(n); };
    const up = () => {
      document.body.classList.remove('fx-resizing');
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      try { localStorage.setItem(W_KEY, String(drag.current)); } catch { /* conveniência local */ }
      window.dispatchEvent(new Event('resize'));
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const n = Math.max(W_MIN, Math.min(W_MAX, w + (e.key === 'ArrowLeft' ? 24 : -24)));
    setW(n); try { localStorage.setItem(W_KEY, String(n)); } catch { /* conveniência local */ }
  };
  return (
    <div className={`fx-cockpit-wrap${liveOpen ? ' live-open' : ''}`} style={{ '--live-w': `${w}px` }}>
      <div className="fx-center"><TerminalGrid {...props} stream={stream} liveOpen={liveOpen} onToggleLive={onToggleLive} /></div>
      {liveOpen && <>
        <div className="fx-live-gutter" role="separator" aria-orientation="vertical" aria-label="Redimensionar o painel Live" tabIndex={0} onPointerDown={onDown} onKeyDown={onKey} onDoubleClick={() => { setW(W_DEF); try { localStorage.removeItem(W_KEY); } catch { /* local */ } }} title="Arraste para redimensionar (duplo clique restaura)" />
        <LivePanel stream={stream} onClose={onToggleLive} flows={flows} openHint={liveHint} visible={liveVisible} />
      </>}
    </div>
  );
}
