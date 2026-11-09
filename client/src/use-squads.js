import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Squads salvos do servidor (/api/team-templates): lista + criar, editar e excluir. A lista local se atualiza na hora; erro de uma ação sobe para quem chamou (a tela avisa). */
export function useSquads() {
  const [squads, setSquads] = useState([]), [ready, setReady] = useState(false), [missing, setMissing] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/team-templates');
      if (!alive.current) return;
      setSquads(Array.isArray(d?.templates) ? d.templates : []); setMissing(false);
    } catch (e) { if (alive.current) setMissing(e?.status === 404); } // servidor antigo sem a rota: a galeria some e os presets seguem funcionando
    finally { if (alive.current) setReady(true); }
  }, []);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  const create = useCallback(async (name, slots) => { const d = await api.post('/api/team-templates', { name, slots }); setSquads((l) => [...l, d.template]); return d.template; }, []);
  const update = useCallback(async (id, patch) => { const d = await api.put(`/api/team-templates/${id}`, patch); setSquads((l) => l.map((t) => (t.id === id ? d.template : t))); return d.template; }, []);
  const remove = useCallback(async (id) => { await api.del(`/api/team-templates/${id}`); setSquads((l) => l.filter((t) => t.id !== id)); }, []);
  return { squads, ready, missing, load, create, update, remove };
}
