import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { toneGlyph } from './FlowHeader.jsx';
import { groupFlows } from '../flows-view.js';
import { logoSvg } from '../forge-logo.mjs';

const BRAND = logoSvg({ variant: 'mark', ink: 'currentColor', stroke: 3 }); // a mesma marca da barra lateral do Cockpit (SVG fixo gerado do código)

/**
 * Volta ao Cockpit (Início ou Terminais, de onde você veio): a seta e a marca do FORGE, o centro do app. Missões é uma página à parte, com só a barra dela.
 */
export function BackToCockpit({ onBack, backLabel = 'Início' }) {
  return (
    <button type="button" className="fl-back" onClick={onBack} aria-label="Voltar ao Cockpit" title={`Voltar ao Cockpit (${backLabel})`}>
      <Icon name="chevronRight" size={14} />
      <span className="fl-back-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND }} />
    </button>
  );
}

function Row({ row, selected, onPick }) {
  const { flow, state, meta, progress, workspace } = row;
  return (
    <li>
      <button type="button" className={`fl-row fl-t-${meta.tone}${selected ? ' on' : ''}`} onClick={() => onPick(flow.id)} aria-current={selected ? 'true' : undefined}
        aria-label={`${flow.title}: ${meta.label}; ${row.kind}${workspace ? `; workspace ${workspace}` : ''}; progresso ${progress.label}`}>
        <StatusGlyph state={toneGlyph(meta.tone)} size={13} className="fl-dot" />
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

/**
 * Barra lateral da página Missões (a do Cockpit some aqui): no topo, "Voltar ao Cockpit"; depois a lista de missões por workspace (título, tipo, estado do último run e
 * progresso n/m). "+" cria uma nova; o botão do Planejador cria por briefing (`onBriefing`). Com `modal` (telas estreitas) vira gaveta: Esc fecha, o foco fica preso nela.
 */
export default function FlowSidebar({ flows, workspaces, selectedId, onPick, onNew, onBriefing = null, failure, onBack = null, backLabel = 'Início', modal = false, onClose = null }) {
  const [query, setQuery] = useState('');
  const box = useRef(null);
  const groups = useMemo(() => groupFlows(flows ?? [], { workspaces, query }), [flows, workspaces, query]);
  const total = (flows ?? []).filter((f) => !f.archived).length;
  // na gaveta: escolher fecha (o foco volta ao botão que abriu); criar fecha sem devolver o foco (o diálogo que abre cuida dele)
  const pick = (id) => { onPick(id); if (modal) onClose?.(); };
  const create = (fn) => () => { if (modal) onClose?.(false); fn?.(); };
  useEffect(() => {
    if (!modal) return undefined;
    box.current?.querySelector('button')?.focus();
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const items = [...box.current.querySelectorAll('button:not(:disabled), input')];
      if (!items.length) return;
      const a = items[0], z = items.at(-1);
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [modal, onClose]);
  return (
    <aside id="fl-side" ref={box} className={`fl-side${modal ? ' modal' : ''}`} {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Missões' } : { 'aria-label': 'Missões' })}>
      <div className="fl-side-top">
        {onBack && <BackToCockpit onBack={onBack} backLabel={backLabel} />}
        <h2 className="fl-side-t">Missões</h2>
        {total > 0 && <span className="fl-count">{total}</span>}
        <span className="grow" />
        {onBriefing && <button type="button" className="fx-ibtn" onClick={create(onBriefing)} aria-label="Nova por briefing" title="Nova por briefing (o Planejador propõe as etapas)"><Icon name="planner" size={15} /></button>}
        <button type="button" className="fx-ibtn" onClick={create(onNew)} aria-label="Nova missão" title="Nova missão"><Icon name="plus" size={15} /></button>
        {modal && <button type="button" className="fx-ibtn" onClick={() => onClose?.()} aria-label="Fechar a lista de missões" title="Fechar"><Icon name="close" size={15} /></button>}
      </div>
      {(total > 6 || query) && (
        <label className="fl-search">
          <Icon name="search" size={14} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar missão ou workspace" aria-label="Buscar missão ou workspace" autoComplete="off" spellCheck="false" />
        </label>
      )}
      {failure && flows !== null && <p className="fl-note err" role="status">{failure.message}</p>}
      <nav className="fl-list" aria-label="Lista de missões">
        {flows === null && <p className="fl-note" role="status">{failure ? 'Não foi possível carregar as missões.' : 'Carregando missões…'}</p>}
        {flows !== null && total === 0 && (
          <div className="fl-empty">
            <p>Nenhuma missão ainda.</p>
            <p className="dim">Uma missão é um objetivo dividido em etapas. Cada etapa roda um agente (Claude ou Codex) num terminal real do Cockpit, e o workflow mostra o andamento de cada uma.</p>
            <div className="fl-new-row">
              <button type="button" className="fl-btn fl-btn-primary" onClick={create(onNew)}><Icon name="plus" size={13} /><span>Nova missão</span></button>
              {onBriefing && <button type="button" className="fl-btn" onClick={create(onBriefing)}><Icon name="planner" size={13} /><span>Nova por briefing</span></button>}
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div className="fl-group" key={g.key}>
            <h3 className="fl-group-h"><span>{g.name}</span><span className="fl-count">{g.items.length}</span></h3>
            <ul>{g.items.map((r) => <Row key={r.id} row={r} selected={r.id === selectedId} onPick={pick} />)}</ul>
          </div>
        ))}
        {flows !== null && total > 0 && query && groups.length === 0 && <p className="fl-note">Nenhuma missão encontrada.</p>}
      </nav>
    </aside>
  );
}
