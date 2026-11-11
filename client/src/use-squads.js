import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const CHANGED = 'forge:team-templates-changed';
const announce = () => { try { window.dispatchEvent(new Event(CHANGED)); } catch { /* sem window (testes de lógica) */ } };
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Squads do servidor (/api/team-templates): os salvos, os prontos do FORGE (`presets`, só leitura), `options` (modelos e esforços por agente, se o servidor informar) e `limits`
 * + criar, editar e excluir. A lista local se atualiza na hora; erro de uma ação sobe para quem chamou (a tela avisa). Servidor antigo sem `presets` = lista vazia.
 * `create(body)` e `update(id, patch)` recebem o corpo pronto ({ name, slots, instruction? }; ver templateBody em squads.js).
 */
export function useSquads() {
  const [squads, setSquads] = useState([]), [presets, setPresets] = useState([]), [options, setOptions] = useState(null), [limits, setLimits] = useState(null), [ready, setReady] = useState(false), [missing, setMissing] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/team-templates');
      if (!alive.current) return;
      setSquads(Array.isArray(d?.templates) ? d.templates : []); setMissing(false);
      setPresets(Array.isArray(d?.presets) ? d.presets : []); // times prontos do FORGE; ausente = servidor antigo (a seção mostra que não há)
      setOptions(isObj(d?.options) ? d.options : null); // modelos e esforços por agente; ausente = servidor antigo (sem os seletores)
      setLimits(isObj(d?.limits) ? d.limits : null);
    } catch (e) { if (alive.current) setMissing(e?.status === 404); } // servidor antigo sem a rota: a galeria some e os presets seguem funcionando
    finally { if (alive.current) setReady(true); }
  }, []);
  useEffect(() => {
    alive.current = true; load();
    window.addEventListener(CHANGED, load); // outra tela (Configurações > Equipes) mudou a lista: o Cockpit, sempre montado, recarrega
    return () => { alive.current = false; window.removeEventListener(CHANGED, load); };
  }, [load]);
  const create = useCallback(async (body) => { const d = await api.post('/api/team-templates', body); setSquads((l) => [...l, d.template]); announce(); return d.template; }, []);
  const update = useCallback(async (id, patch) => { const d = await api.put(`/api/team-templates/${id}`, patch); setSquads((l) => l.map((t) => (t.id === id ? d.template : t))); announce(); return d.template; }, []);
  const remove = useCallback(async (id) => { await api.del(`/api/team-templates/${id}`); setSquads((l) => l.filter((t) => t.id !== id)); announce(); }, []);
  return { squads, presets, options, limits, ready, missing, load, create, update, remove };
}
