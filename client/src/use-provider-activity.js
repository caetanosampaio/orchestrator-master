import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { normalizeActivity } from './home-view.js';

/**
 * Atividade de tokens por provider (GET /api/provider-activity?days=30|90|0): consulta a cada ~5 s com a aba visível e ao voltar a ela.
 * Estados: `status` = 'loading' (ainda sem resposta para esta janela) | 'ok' | 'error' (rota ausente, servidor fora do ar ou resposta fora do contrato).
 * Com erro depois de uma leitura boa, `data` mantém a última leitura (e `status` vira 'error' para a tela avisar que está desatualizada). Trocar a janela descarta o que não é dela.
 */
export function useProviderActivity({ days = 30, intervalMs = 5000 } = {}) {
  const [st, setSt] = useState({ days, status: 'loading', data: null, error: null });
  const seq = useRef(0), lastJson = useRef('');
  useEffect(() => {
    let alive = true, busy = false;
    lastJson.current = '';
    setSt((p) => (p.days === days ? p : { days, status: 'loading', data: null, error: null }));
    const load = async () => {
      if (busy) return;
      busy = true;
      const my = ++seq.current;
      try {
        const raw = await api.get(`/api/provider-activity?days=${days}`);
        if (!alive || my !== seq.current) return;
        const data = normalizeActivity(raw);
        if (!data) { setSt((p) => ({ ...p, days, status: 'error', error: 'O servidor respondeu em um formato inesperado.' })); return; }
        const j = JSON.stringify(data);
        if (j === lastJson.current) { setSt((p) => (p.status === 'ok' && p.days === days ? p : { days, status: 'ok', data: p.data ?? data, error: null })); return; } // nada mudou: sem novo render
        lastJson.current = j;
        setSt({ days, status: 'ok', data, error: null });
      } catch (e) {
        if (!alive || my !== seq.current) return;
        setSt((p) => ({ ...p, days, status: 'error', error: e?.status === 404 ? 'Esta versão do servidor ainda não tem a leitura de consumo (reinicie o servidor do FORGE).' : 'Não foi possível ler o consumo: servidor indisponível.' }));
      } finally { busy = false; }
    };
    const tick = () => { if (!document.hidden) load(); };
    tick();
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [days, intervalMs]);
  const mine = st.days === days;
  return { status: mine ? st.status : 'loading', data: mine ? st.data : null, error: mine ? st.error : null, scanning: mine && st.data?.scanning === true };
}
