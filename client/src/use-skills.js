import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Skills: o catálogo e o que cada papel recebe (GET /api/loadouts) mais a tabela "Quem faz cada tarefa" (GET /api/harness), só para mostrar onde cada skill é citada.
 * Mudar as skills de um papel é PUT /api/loadouts e vale para os terminais abertos DEPOIS da mudança. Erro sobe para quem chamou (a tela avisa) e nada muda.
 */
export function useSkills() {
  const [loadouts, setLoadouts] = useState(null), [rows, setRows] = useState([]), [error, setError] = useState(null), [busy, setBusy] = useState(false), [savedAt, setSavedAt] = useState(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const [l, h] = await Promise.all([api.get('/api/loadouts'), api.get('/api/harness').catch(() => null)]);
      if (!alive.current) return;
      setLoadouts(l); setRows(Array.isArray(h?.rows) ? h.rows : []); setError(null);
    } catch (e) { if (alive.current) setError(e?.status === 404 ? 'missing' : (e?.message || 'Não foi possível ler as skills.')); }
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  const run = useCallback(async (body) => {
    setBusy(true);
    try { const r = await api.put('/api/loadouts', body); if (alive.current) { setLoadouts(r); setSavedAt(Date.now()); } return r; }
    finally { if (alive.current) setBusy(false); }
  }, []);
  return { loadouts, rows, error, busy, savedAt, reload: load, setRoleSkills: (role, skills) => run({ role, skills }), resetRole: (role) => run({ role, reset: true }) };
}
