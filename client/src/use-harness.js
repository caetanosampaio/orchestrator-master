import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * "Quem faz cada tarefa": a visão do servidor (GET /api/harness) e as ações (piloto, linhas, agentes, compartilhar). Toda ação devolve a visão nova e a tela troca por ela;
 * erro sobe para quem chamou (a tela avisa) e nada muda. `savedAt` guarda o instante da última gravação (o selo "Salvo").
 */
export function useHarness() {
  const [data, setData] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [savedAt, setSavedAt] = useState(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try { const d = await api.get('/api/harness'); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e?.status === 404 ? 'missing' : (e?.message || 'Não foi possível ler a tabela.')); }
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  const run = useCallback(async (fn, { reload = false } = {}) => {
    setBusy(true);
    try { const r = await fn(); if (alive.current) { if (r && Array.isArray(r.rows)) setData(r); else if (reload) await load(); setSavedAt(Date.now()); } return r; }
    finally { if (alive.current) setBusy(false); }
  }, [load]);
  return {
    data, error, busy, savedAt, ready: data !== null || error !== null, reload: load,
    setPilot: (patch) => run(() => api.put('/api/harness/pilot', patch)), resetPilot: () => run(() => api.del('/api/harness/pilot')),
    setRow: (id, patch) => run(() => api.put(`/api/harness/rows/${id}`, patch)), resetRow: (id) => run(() => api.del(`/api/harness/rows/${id}`)), resetRows: () => run(() => api.del('/api/harness/rows')),
    createAgent: (name, instruction) => run(() => api.post('/api/harness/agents', { name, instruction }), { reload: true }),
    updateAgent: (id, patch) => run(() => api.put(`/api/harness/agents/${id}`, patch), { reload: true }),
    removeAgent: (id) => run(() => api.del(`/api/harness/agents/${id}`), { reload: true }),
    exportCode: async () => (await api.get('/api/harness/export')).code,
    importCode: (code) => run(() => api.post('/api/harness/import', { code })),
  };
}
