import React, { useState } from 'react';
import Dialog from './Dialog.jsx';
import { ActionButton } from './MissionPanel.jsx';
import { api } from '../api.js';

/** Nova missão: título e objetivo (o que o Planner recebe) e o workspace. Criar não executa nada: o ciclo só começa no botão "Iniciar ciclo" (ou marcando a opção). */
export default function NewMissionDialog({ workspaces, activeWorkspaceId, onClose, onCreated }) {
  const [title, setTitle] = useState(''), [objective, setObjective] = useState('');
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id ?? '');
  const [start, setStart] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const valid = title.trim().length > 0 && workspaceId;
  const submit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(null);
    try {
      const m = await api.post('/api/missions', { title: title.trim(), objective: objective.trim(), workspaceId });
      let note = null;
      if (start) { try { await api.post(`/api/missions/${m.id}/cycle/start`, {}); } catch (err) { note = `Missão criada, mas o ciclo não iniciou: ${err.message}`; } }
      onCreated(m, note);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog title="Nova missão" onClose={onClose} id="new-mission">
      <form className="mi-form" onSubmit={submit}>
        <label>Nome<input data-autofocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Corrigir o login com Google" required /></label>
        <label>Objetivo e contexto<textarea value={objective} maxLength={2000} rows={5} onChange={(e) => setObjective(e.target.value)} placeholder="O que deve ficar pronto, restrições, arquivos ou áreas envolvidas e como saber que terminou." /><span className="dim">{objective.length}/2000 · o Planner usa este texto para dividir o trabalho em etapas verificáveis.</span></label>
        <label>Workspace
          <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} required>
            {workspaces.length === 0 && <option value="">Nenhum workspace cadastrado</option>}
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.displayName || w.name}</option>)}
          </select>
        </label>
        <label className="mi-check"><input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /><span>Iniciar o ciclo autônomo logo após criar <span className="dim">(o Claude Code passa a agir no workspace e consome créditos)</span></span></label>
        {error && <p className="mi-note err" role="alert">{error}</p>}
        <div className="mi-form-foot">
          <button type="button" className="mi-btn" onClick={onClose}>Cancelar</button>
          <ActionButton kind="primary" icon="plus" busy={busy} disabled={!valid} type="submit">{start ? 'Criar e iniciar' : 'Criar missão'}</ActionButton>
        </div>
      </form>
    </Dialog>
  );
}
