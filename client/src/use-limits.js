import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { normalizeLimits } from './limits-view.js';

/**
 * Limites das contas (5 h e semana) de /api/limits: consulta a cada ~15 s com a aba visível e quando ela volta a ficar visível; `now` avança a cada 30 s para o "reseta em" não ficar parado.
 * `refresh()` força uma leitura (o painel a chama ao abrir). Servidor antigo/sem a rota: `limits` fica null e `failed` true (a barra mostra "—").
 */
export function useLimits({ intervalMs = 15_000 } = {}) {
  const [limits, setLimits] = useState(null), [failed, setFailed] = useState(false), [now, setNow] = useState(() => Date.now());
  const last = useRef('');
  const load = useRef(null);
  useEffect(() => {
    let alive = true, busy = false;
    load.current = async () => {
      if (busy) return;
      busy = true;
      try {
        const raw = await api.get('/api/limits');
        if (!alive) return;
        const n = normalizeLimits(raw);
        if (!n) { setFailed(true); return; }
        setFailed(false);
        const j = JSON.stringify(n); if (j !== last.current) { last.current = j; setLimits(n); }
      } catch { if (alive) setFailed(true); } finally { busy = false; }
    };
    const tick = () => { if (!document.hidden) load.current(); };
    tick();
    const t = setInterval(tick, intervalMs), c = setInterval(() => setNow(Date.now()), 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => { alive = false; clearInterval(t); clearInterval(c); document.removeEventListener('visibilitychange', tick); };
  }, [intervalMs]);
  return { limits, failed, now, refresh: () => load.current?.() };
}
