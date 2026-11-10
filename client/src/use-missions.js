import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Missões reais de /api/missions (com o ciclo, as rodadas e as tarefas). Consulta a cada ~2,5 s com a aba visível (o ciclo roda no servidor e muda sozinho)
 * e quando a aba volta a ficar visível; `refresh()` força uma leitura (depois de uma ação). A tela só é atualizada quando algo mudou.
 * `failed` = a última leitura falhou (servidor fora do ar): o último estado conhecido continua na tela.
 */
export function useMissions({ intervalMs = 2500 } = {}) {
  const [missions, setMissions] = useState(null), [failed, setFailed] = useState(false);
  const last = useRef(''), busy = useRef(false), alive = useRef(true);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const list = await api.get('/api/missions');
      if (!alive.current) return;
      const j = JSON.stringify(list);
      if (j !== last.current) { last.current = j; setMissions(Array.isArray(list) ? list : []); }
      setFailed(false);
    } catch { if (alive.current) setFailed(true); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [refresh, intervalMs]);
  return { missions, failed, refresh };
}
