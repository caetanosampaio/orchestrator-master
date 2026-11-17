import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { describeFailure } from './flows-view.js';

// O api.js não tem PATCH (e não é deste módulo): mesmo formato de erro, { status, message }.
async function patch(url, body) {
  const res = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { status: res.status });
  return data;
}

/**
 * Missões v2 reais de /api/flows (cada uma com `lastRun` e `activeRun`). Consulta a cada ~2,5 s com a aba visível (o run roda no servidor e muda sozinho)
 * e quando a aba volta a ficar visível; `refresh()` força uma leitura (depois de uma ação). A tela só é atualizada quando algo mudou.
 * `failure` = { kind, message } da última leitura que falhou (null se ok): servidor fora do ar ou rota inexistente; o último estado conhecido continua na tela.
 * As ações lançam o erro do servidor (mensagem em português) para a tela mostrar; depois de cada uma a lista é relida.
 */
export function useFlows({ intervalMs = 2500 } = {}) {
  const [flows, setFlows] = useState(null), [failure, setFailure] = useState(null);
  const last = useRef(''), busy = useRef(false), alive = useRef(true);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const list = await api.get('/api/flows');
      if (!alive.current) return;
      const j = JSON.stringify(list);
      if (j !== last.current) { last.current = j; setFlows(Array.isArray(list) ? list : []); }
      setFailure(null);
    } catch (e) { if (alive.current) setFailure(describeFailure(e, 'list')); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [refresh, intervalMs]);

  const act = useCallback(async (fn) => { try { return await fn(); } finally { refresh(); } }, [refresh]);
  const actions = useMemo(() => ({
    create: (body) => act(() => api.post('/api/flows', body)),
    update: (id, body) => act(() => patch(`/api/flows/${encodeURIComponent(id)}`, body)),
    remove: (id) => act(() => api.del(`/api/flows/${encodeURIComponent(id)}`)),
    start: (id) => act(() => api.post(`/api/flows/${encodeURIComponent(id)}/runs`, {})),
    cancel: (id, runId) => act(() => api.post(`/api/flows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, {})),
  }), [act]);
  return { flows, failure, refresh, actions };
}

/**
 * Histórico de runs de UMA missão (GET /api/flows/:id/runs, mais recente primeiro). Só consulta enquanto `enabled` (o <details> do histórico aberto):
 * fechado não gasta rede. `key` (ex.: o id do último run) refaz a leitura quando muda.
 */
export function useFlowRuns(flowId, { enabled = false, key = '', intervalMs = 4000 } = {}) {
  const [runs, setRuns] = useState(null), [failure, setFailure] = useState(null);
  const last = useRef(''), alive = useRef(true);
  const load = useCallback(async () => {
    if (!flowId) return;
    try {
      const list = await api.get(`/api/flows/${encodeURIComponent(flowId)}/runs`);
      if (!alive.current) return;
      const j = JSON.stringify(list);
      if (j !== last.current) { last.current = j; setRuns(Array.isArray(list) ? list : []); }
      setFailure(null);
    } catch (e) { if (alive.current) setFailure(describeFailure(e, 'item')); }
  }, [flowId]);
  useEffect(() => { last.current = ''; setRuns(null); setFailure(null); }, [flowId]);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !flowId) return () => { alive.current = false; };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, intervalMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [enabled, flowId, key, load, intervalMs]);
  return { runs, failure };
}
