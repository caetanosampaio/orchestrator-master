import React, { useMemo, useState } from 'react';
import { Icon } from './ui.jsx';
import { WsIcon } from './Sidebar.jsx';
import { groupMissions, STATE_META } from '../missions-view.js';

/** Ícone de estado da missão: o MESMO ícone dos terminais do Cockpit (WsIcon), para o estado ter uma só cara no produto. */
export function MissionIcon({ state, agent = 'claude' }) {
  const tone = STATE_META[state]?.tone ?? 'idle';
  return <WsIcon tone={tone} agent={tone === 'work' ? agent : null} />;
}

// Encerradas ficam recolhidas no rodapé (como o "ARQUIVADOS n" do Overclock): a lista de cima é só o que ainda pede algo.
const FOLDED = new Set(['completed', 'cancelled']);

function Row({ row, selected, onPick }) {
  const { m, state, workspace, progress } = row, meta = STATE_META[state];
  const count = progress.total ? `${progress.done}/${progress.total}` : progress.pct !== null ? `${progress.pct}%` : '';
  return (
    <li>
      <button type="button" className={`mi-row st-${state}${selected ? ' on' : ''}`} onClick={() => onPick(m.id)} aria-current={selected ? 'true' : undefined}
        aria-label={`${m.title}: ${meta.label}${workspace ? `; workspace ${workspace}` : ''}${progress.total ? `; ${progress.done} de ${progress.total} ${progress.basis}` : ''}`}>
        <MissionIcon state={state} />
        <span className="mi-row-main">
          <span className="mi-row-title">{m.title}</span>
          <span className="mi-row-sub">{workspace ?? 'sem workspace'}</span>
        </span>
        {count && <span className="mi-row-n" aria-hidden="true">{count}</span>}
        {state === 'working' && <i className="mi-row-meter" aria-hidden="true" />}
      </button>
    </li>
  );
}

/** Sidebar das missões: rótulo "MISSÕES +", grupos pelos estados dos terminais, encerradas recolhidas no rodapé, busca quando a lista cresce. */
export default function MissionSidebar({ missions, workspaces, selectedId, onPick, onNew, failed }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState({});
  const groups = useMemo(() => groupMissions(missions ?? [], { workspaces, query }), [missions, workspaces, query]);
  const total = (missions ?? []).length;
  const live = groups.filter((g) => !FOLDED.has(g.state)), folded = groups.filter((g) => FOLDED.has(g.state));
  // um grupo recolhido abre sozinho quando a missão selecionada está nele ou quando há busca
  const isOpen = (g) => open[g.state] ?? (!!query || g.items.some((r) => r.m.id === selectedId));
  return (
    <aside className="mi-side" aria-label="Missões">
      <div className="mi-side-h">
        <span className="mi-label">Missões</span>
        {total > 0 && <span className="mi-count">{total}</span>}
        <button type="button" className="mi-plus" onClick={onNew} aria-label="Nova missão" title="Nova missão"><Icon name="plus" size={14} /></button>
      </div>
      {(total > 6 || query) && (
        <label className="mi-search"><span aria-hidden="true">/</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar missão ou workspace" aria-label="Buscar missão ou workspace" /></label>
      )}
      {failed && missions !== null && <p className="mi-note err" role="status">API indisponível: mostrando o último estado conhecido.</p>}
      <nav className="mi-list" aria-label="Lista de missões">
        {missions === null && <p className="mi-note">{failed ? 'Não foi possível carregar as missões.' : 'Carregando missões…'}</p>}
        {missions !== null && total === 0 && (
          <div className="mi-empty">
            <p>Nenhuma missão ainda.</p>
            <p className="dim">Uma missão tem um objetivo e um workspace. O Planner divide o trabalho em etapas, o Executor faz e o sistema verifica.</p>
            <button type="button" className="mi-btn mi-btn-primary" onClick={onNew}><Icon name="plus" size={13} /><span>Nova missão</span></button>
          </div>
        )}
        {total > 0 && groups.length === 0 && <p className="mi-note">Nada encontrado para “{query}”.</p>}
        {live.map((g) => (
          <section key={g.state} className={`mi-group st-${g.state}`} aria-label={g.meta.group}>
            <h3 className="mi-group-h"><span>{g.meta.group}</span><span className="mi-count">{g.items.length}</span></h3>
            <ul>{g.items.map((r) => <Row key={r.m.id} row={r} selected={r.m.id === selectedId} onPick={onPick} />)}</ul>
          </section>
        ))}
      </nav>
      {folded.length > 0 && (
        <div className="mi-side-f">
          {folded.map((g) => (
            <section key={g.state} className={`mi-group folded st-${g.state}`} aria-label={g.meta.group}>
              <button type="button" className="mi-fold-h" aria-expanded={isOpen(g)} onClick={() => setOpen((o) => ({ ...o, [g.state]: !isOpen(g) }))}>
                <span>{g.meta.group}</span><span className="mi-count">{g.items.length}</span><Icon name={isOpen(g) ? 'chevronDown' : 'chevronRight'} size={12} />
              </button>
              {isOpen(g) && <ul>{g.items.map((r) => <Row key={r.m.id} row={r} selected={r.m.id === selectedId} onPick={onPick} />)}</ul>}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
