import React, { useMemo, useState } from 'react';
import { Icon } from './ui.jsx';
import { groupFlows } from '../flows-view.js';

function Row({ row, selected, onPick }) {
  const { flow, state, meta, progress, workspace } = row;
  return (
    <li>
      <button type="button" className={`fl-row fl-t-${meta.tone}${selected ? ' on' : ''}`} onClick={() => onPick(flow.id)} aria-current={selected ? 'true' : undefined}
        aria-label={`${flow.title}: ${meta.label}; ${row.kind}${workspace ? `; workspace ${workspace}` : ''}; progresso ${progress.label}`}>
        <i className="fl-dot" aria-hidden="true" />
        <span className="fl-row-main">
          <span className="fl-row-title">{flow.title}</span>
          <span className="fl-row-sub">{row.kind} · <span className="fl-row-state">{meta.label}</span></span>
        </span>
        <span className="fl-row-n" aria-hidden="true">{progress.label}</span>
        {state === 'running' && <i className="fl-row-meter" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** Lista de missões por workspace: título, tipo, estado do último run e progresso n/m; "+" cria uma nova; o botão do Planejador cria por briefing (`onBriefing`). */
export default function FlowSidebar({ flows, workspaces, selectedId, onPick, onNew, onBriefing = null, failure }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupFlows(flows ?? [], { workspaces, query }), [flows, workspaces, query]);
  const total = (flows ?? []).filter((f) => !f.archived).length;
  return (
    <aside className="fl-side" aria-label="Missões">
      <div className="fl-side-h">
        <span className="fl-label">Missões</span>
        {total > 0 && <span className="fl-count">{total}</span>}
        {onBriefing && <button type="button" className="fl-plus fl-plus-text" onClick={onBriefing} aria-label="Nova por briefing" title="Nova por briefing (o Planejador propõe as etapas)"><Icon name="planner" size={13} /><span>briefing</span></button>}
        <button type="button" className={`fl-plus${onBriefing ? ' fl-plus-next' : ''}`} onClick={onNew} aria-label="Nova missão" title="Nova missão"><Icon name="plus" size={14} /></button>
      </div>
      {(total > 6 || query) && (
        <label className="fl-search"><span aria-hidden="true">/</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar missão ou workspace" aria-label="Buscar missão ou workspace" /></label>
      )}
      {failure && flows !== null && <p className="fl-note err" role="status">{failure.message}</p>}
      <nav className="fl-list" aria-label="Lista de missões">
        {flows === null && <p className="fl-note" role="status">{failure ? 'Não foi possível carregar as missões.' : 'Carregando missões…'}</p>}
        {flows !== null && total === 0 && (
          <div className="fl-empty">
            <p>Nenhuma missão ainda.</p>
            <p className="dim">Uma missão é um objetivo dividido em etapas. Cada etapa roda um agente (Claude ou Codex) num terminal real do Cockpit, e o workflow mostra o andamento de cada uma.</p>
            <div className="fl-new-row">
              <button type="button" className="fl-btn fl-btn-primary" onClick={onNew}><Icon name="plus" size={13} /><span>Nova missão</span></button>
              {onBriefing && <button type="button" className="fl-btn" onClick={onBriefing}><Icon name="planner" size={13} /><span>Nova por briefing</span></button>}
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div className="fl-group" key={g.key}>
            <h3 className="fl-group-h"><span>{g.name}</span><span className="fl-count">{g.items.length}</span></h3>
            <ul>{g.items.map((r) => <Row key={r.id} row={r} selected={r.id === selectedId} onPick={onPick} />)}</ul>
          </div>
        ))}
        {flows !== null && total > 0 && query && groups.length === 0 && <p className="fl-note">Nenhuma missão encontrada.</p>}
      </nav>
    </aside>
  );
}
