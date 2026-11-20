import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { toneGlyph } from './FlowHeader.jsx';
import { HomeIcon, NavItem } from './Sidebar.jsx';
import { groupFlows } from '../flows-view.js';
import { shortPath } from '../forge-shell.js';
import { logoSvg } from '../forge-logo.mjs';

const BRAND = logoSvg({ variant: 'mark', ink: 'currentColor', stroke: 3 }); // a mesma marca da barra lateral do Cockpit (SVG fixo gerado do código)

/**
 * Volta ao Cockpit (Início ou Terminais, de onde você veio). `compact`: só a seta, no topo da barra (no lugar do "recolher" do Cockpit); sem ele, a seta e a marca (barra do celular).
 */
export function BackToCockpit({ onBack, backLabel = 'Início', compact = false }) {
  return (
    <button type="button" className={compact ? 'fx-ibtn fl-back-c' : 'fl-back'} onClick={onBack} aria-label="Voltar ao Cockpit" title={`Voltar ao Cockpit (${backLabel})`}>
      <Icon name="chevronRight" size={compact ? 15 : 14} />
      {!compact && <span className="fl-back-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND }} />}
    </button>
  );
}

// tom do cartão do workspace = o mais urgente das missões dele (como o cartão do Cockpit agrega os terminais)
const URGENCY = ['wait', 'err', 'work', 'ok', 'idle', 'cancel', 'skip'];
const cardTone = (items) => items.map((r) => r.meta.tone).sort((a, b) => URGENCY.indexOf(a) - URGENCY.indexOf(b))[0] ?? 'idle';

/** Uma missão dentro do cartão do workspace, no desenho do terminal do Cockpit: glifo de estado, título e o progresso n/m. */
function MissionRow({ row, selected, onPick }) {
  const { flow, meta, progress } = row;
  return (
    <li>
      <button type="button" className={`fx-term fl-mrow fl-t-${meta.tone}${selected ? ' on' : ''}`} onClick={() => onPick(flow.id)} aria-current={selected ? 'true' : undefined}
        title={`${flow.title}: ${meta.label} (${row.kind})`} aria-label={`${flow.title}: ${meta.label}; ${row.kind}; progresso ${progress.label}`}>
        <StatusGlyph state={toneGlyph(meta.tone)} size={12} />
        <span className="fx-term-t">{flow.title}</span>
        <span className="fx-term-m mono">{progress.label}</span>
      </button>
    </li>
  );
}

/** Um workspace = um cartão, como no Cockpit: estado agregado + nome + "N aguardando", a pasta embaixo e as missões aninhadas. Clicar no nome abre a primeira missão dele. */
function WsCard({ group, path, selectedId, onPick }) {
  const tone = cardTone(group.items), on = group.items.some((r) => r.id === selectedId);
  const waiting = group.items.filter((r) => r.meta.tone === 'wait').length;
  return (
    <li className={`fx-ws has-terms${on ? ' on' : ''}`}>
      <div className="fx-ws-row">
        <button type="button" className={`fx-ws-head tone-${tone}`} onClick={() => group.items[0] && onPick(group.items[0].id)} aria-label={`${group.name}: ${group.items.length} ${group.items.length === 1 ? 'missão' : 'missões'}${waiting ? `, ${waiting} aguardando você` : ''}`} title={path ?? group.name}>
          <StatusGlyph state={toneGlyph(tone)} size={13} />
          <span className="fx-ws-name">{group.name}</span>
          {waiting > 0 ? <span className="fx-chip warn">{waiting} aguardando</span> : <span className="fx-n">{group.items.length}</span>}
        </button>
      </div>
      {path && <div className="fx-ws-sub mono" title={path}><span className="mono">{shortPath(path)}</span></div>}
      <ul className="fx-terms" aria-label={`Missões de ${group.name}`}>
        {group.items.map((r) => <MissionRow key={r.id} row={r} selected={r.id === selectedId} onPick={onPick} />)}
      </ul>
    </li>
  );
}

/**
 * Barra lateral da página Missões, com o MESMO desenho da barra do Cockpit (classes fx-side): marca, busca (⌘K), navegação (Início, Missões, Terminais, Sessões),
 * a seção "Missões" (no lugar de "Workspaces") com as missões aninhadas no cartão do workspace (como os terminais) e o rodapé. Só o conteúdo muda.
 * `side` (do App): onView, onOpenSessions, onOpenSettings, onOpenWorkspaces, desktop; sem ele, a navegação cai no Voltar. Com `modal` (telas estreitas) vira gaveta: Esc fecha, o foco fica preso nela.
 */
export default function FlowSidebar({ flows, workspaces, selectedId, onPick, onNew, onBriefing = null, failure, onBack = null, backLabel = 'Início', modal = false, onClose = null, side = null }) {
  const [query, setQuery] = useState('');
  const box = useRef(null), searchRef = useRef(null);
  const groups = useMemo(() => groupFlows(flows ?? [], { workspaces, query }), [flows, workspaces, query]);
  const pathOf = useMemo(() => new Map((workspaces ?? []).map((w) => [w.id, w.path ?? null])), [workspaces]);
  const total = (flows ?? []).filter((f) => !f.archived).length;
  // na gaveta: escolher fecha (o foco volta ao botão que abriu); criar fecha sem devolver o foco (o diálogo que abre cuida dele)
  const pick = (id) => { onPick(id); if (modal) onClose?.(); };
  const create = (fn) => () => { if (modal) onClose?.(false); fn?.(); };
  const go = (v) => () => { if (modal) onClose?.(false); if (side?.onView) side.onView(v); else onBack?.(); };
  // ⌘K / Ctrl+K: foca a busca, como no Cockpit (fora de um terminal)
  useEffect(() => {
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k' && !e.target?.closest?.('.xterm')) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
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
    <aside id="fl-side" ref={box} className={`fx-side fl-side${modal ? ' modal' : ''}`} {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Missões' } : { 'aria-label': 'Missões' })}>
      <div className={`fx-side-top${side?.desktop && !modal ? ' desktop' : ''}`}>
        <span className="fx-brand"><span className="fx-brand-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND }} />Forge</span>
        <span className="grow" />
        {modal
          ? <button type="button" className="fx-ibtn" onClick={() => onClose?.()} aria-label="Fechar a lista de missões" title="Fechar"><Icon name="close" size={15} /></button>
          : onBack && <BackToCockpit onBack={onBack} backLabel={backLabel} compact />}
      </div>

      <label className="fx-search">
        <Icon name="search" size={14} /><span className="sr">Buscar missão ou workspace</span>
        <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }}
          placeholder="Buscar" aria-label="Buscar missão ou workspace" autoComplete="off" spellCheck="false" />
        {!query && <kbd aria-hidden="true">⌘K</kbd>}
      </label>

      <nav className="fx-nav" aria-label="Páginas do FORGE">
        <NavItem icon={<HomeIcon />} label="Início" onClick={go('home')} title="Início: atividade de tokens e workspaces recentes" />
        <NavItem icon={<Icon name="briefcase" size={15} />} label="Missões" on onClick={() => {}} title="Missões (esta página)" />
        <NavItem icon={<Icon name="terminal" size={15} />} label="Terminais" onClick={go('cockpit')} title="Terminais do workspace aberto" />
        {side?.onOpenSessions && <NavItem icon={<Icon name="clock" size={15} />} label="Sessões" onClick={() => side.onOpenSessions()} title="Histórico de sessões do workspace aberto, para retomar" />}
      </nav>

      <div className="fx-sec-h">
        <span>Missões</span>{total > 0 && <span className="fx-n">{total}</span>}
        <span className="grow" />
        {onBriefing && <button type="button" className="fx-ibtn sm" onClick={create(onBriefing)} aria-label="Nova por briefing" title="Nova por briefing (o Planejador propõe as etapas)"><Icon name="planner" size={14} /></button>}
        <button type="button" className="fx-ibtn sm" onClick={create(onNew)} aria-label="Nova missão" title="Nova missão"><Icon name="plus" size={14} /></button>
      </div>

      {failure && flows !== null && <p className="fx-empty-side fl-side-err" role="status">{failure.message}</p>}
      <nav className="fx-wslist" aria-label="Lista de missões">
        {flows === null && <p className="fx-empty-side" role="status">{failure ? 'Não foi possível carregar as missões.' : 'Carregando missões…'}</p>}
        {flows !== null && total === 0 && (
          <div className="fx-empty-side">
            <p>Nenhuma missão ainda.</p>
            <p className="dim">Uma missão é um objetivo dividido em etapas. Cada etapa roda um agente (Claude ou Codex) num terminal real do Cockpit.</p>
            <button type="button" className="fx-link" onClick={create(onNew)}>Nova missão</button>
            {onBriefing && <button type="button" className="fx-link" onClick={create(onBriefing)}><span>Nova por briefing</span></button>}
          </div>
        )}
        {groups.length > 0 && <ul>{groups.map((g) => <WsCard key={g.key} group={g} path={pathOf.get(g.key) ?? null} selectedId={selectedId} onPick={pick} />)}</ul>}
        {flows !== null && total > 0 && query && groups.length === 0 && <p className="fx-empty-side">Nada encontrado para “{query}”.</p>}
      </nav>

      {side && (
        <div className="fx-side-foot">
          <button type="button" className="fx-ibtn" onClick={() => side.onOpenSettings?.()} aria-label="Configurações" title="Configurações"><Icon name="gear" size={15} /></button>
          <button type="button" className="fx-ibtn" onClick={() => side.onOpenWorkspaces?.()} aria-label="Arquivos: abrir, trocar ou adicionar workspace" title="Arquivos: abrir, trocar ou adicionar workspace"><Icon name="folderOpen" size={15} /></button>
          <span className="grow" />
          <button type="button" className="fx-ibtn" onClick={() => side.onOpenSessions?.()} aria-label="Sessões: histórico de sessões do workspace aberto" title="Sessões: histórico, para retomar"><Icon name="clock" size={15} /></button>
        </div>
      )}
    </aside>
  );
}
