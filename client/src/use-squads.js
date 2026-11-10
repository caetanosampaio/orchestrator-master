import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const CHANGED = 'forge:team-templates-changed';
const announce = () => { try { window.dispatchEvent(new Event(CHANGED)); } catch { /* sem window (testes de lógica) */ } };

/** Squads salvos do servidor (/api/team-templates): lista, `options` (modelos e esforços por agente, se o servidor informar) + criar, editar e excluir. A lista local se atualiza na hora; erro de uma ação sobe para quem chamou (a tela avisa). */
export function useSquads() {
  const [squads, setSquads] = useState([]), [options, setOptions] = useState(null), [ready, setReady] = useState(false), [missing, setMissing] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/team-templates');
      if (!alive.current) return;
      setSquads(Array.isArray(d?.templates) ? d.templates : []); setMissing(false);
      setOptions(d?.options && typeof d.options === 'object' && !Array.isArray(d.options) ? d.options : null); // modelos e esforços por agente; ausente = servidor antigo (sem os seletores)
    } catch (e) { if (alive.current) setMissing(e?.status === 404); } // servidor antigo sem a rota: a galeria some e os presets seguem funcionando
    finally { if (alive.current) setReady(true); }
  }, []);
  useEffect(() => {
    alive.current = true; load();
    window.addEventListener(CHANGED, load); // outra tela (Configurações > Equipes) mudou a lista: o Cockpit, sempre montado, recarrega
    return () => { alive.current = false; window.removeEventListener(CHANGED, load); };
  }, [load]);
  const create = useCallback(async (name, slots) => { const d = await api.post('/api/team-templates', { name, slots }); setSquads((l) => [...l, d.template]); announce(); return d.template; }, []);
  const update = useCallback(async (id, patch) => { const d = await api.put(`/api/team-templates/${id}`, patch); setSquads((l) => l.map((t) => (t.id === id ? d.template : t))); announce(); return d.template; }, []);
  const remove = useCallback(async (id) => { await api.del(`/api/team-templates/${id}`); setSquads((l) => l.filter((t) => t.id !== id)); announce(); }, []);
  return { squads, options, ready, missing, load, create, update, remove };
}
