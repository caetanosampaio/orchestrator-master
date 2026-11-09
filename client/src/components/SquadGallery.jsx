import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { squadSummary } from '../squads.js';

/**
 * Galeria de squads (tela sem terminais): cartões com as vagas da equipe (um selo por vaga: a cor é a do papel e o logo é o do agente), abrem tudo com um clique.
 * Squads do FORGE (sugestões mistas) e Meus squads (salvos, com editar e excluir) + o cartão "Novo squad". Animações só com CSS (retro.css, .sq-*), e desligadas pelas
 * regras globais de "Animações reduzidas". Nada aqui abre terminal: quem abre é o cockpit (onOpen).
 */
function Pips({ slots, byRole, labelOf }) {
  return (
    <span className="sq-pips" aria-hidden="true">
      {slots.map((s, k) => (
        <span key={k} className="sq-pip" style={{ '--k': k, '--c': byRole[s.role]?.color || 'var(--brand)' }} title={`${byRole[s.role]?.label ?? s.role} · ${labelOf(s.provider)}`}>
          <ProviderLogo id={s.provider} size={13} />
        </span>
      ))}
    </span>
  );
}

function Card({ squad, i, byRole, labelOf, busy, launching, fresh, onOpen, onEdit, onDelete }) {
  const [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const sum = squadSummary(squad.slots, labelOf);
  const remove = () => { setLeaving(true); timer.current = setTimeout(() => onDelete(squad), 220); }; // some com uma animação curta e só então exclui
  return (
    <article className={`sq-card${launching ? ' launching' : ''}${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}${squad.builtin ? ' builtin' : ''}`} style={{ '--i': i }}>
      <button type="button" className="sq-main" disabled={busy || asking} onClick={() => onOpen(squad)} aria-label={`Abrir o squad ${squad.name}: ${sum}`}>
        <span className="sq-head"><b>{squad.name}</b><span className="sq-tag">{squad.builtin ? 'FORGE' : 'meu'}</span></span>
        <Pips slots={squad.slots} byRole={byRole} labelOf={labelOf} />
        <span className="sq-sum">{launching ? 'Abrindo a equipe…' : (squad.tagline ?? sum)}</span>
        {squad.tagline && !launching && <span className="sq-sub dim">{sum}</span>}
      </button>
      {!launching && (
        <div className="sq-actions">
          <button type="button" className="sq-act" disabled={busy} onClick={() => onEdit(squad)} aria-label={squad.builtin ? `Usar ${squad.name} como ponto de partida de um squad novo` : `Editar o squad ${squad.name}`} title={squad.builtin ? 'Usar como ponto de partida' : 'Editar'}><Icon name="pencil" size={12} /></button>
          {!squad.builtin && <button type="button" className="sq-act" disabled={busy} onClick={() => setAsking(true)} aria-label={`Excluir o squad ${squad.name}`} title="Excluir"><Icon name="close" size={12} /></button>}
        </div>
      )}
      {asking && (
        <div className="sq-ask" role="alertdialog" aria-label={`Excluir ${squad.name}?`}>
          <p>Excluir “{squad.name}”?</p>
          <div><button type="button" className="sq-yes" data-autofocus="" onClick={remove}>Excluir</button><button type="button" onClick={() => setAsking(false)}>Cancelar</button></div>
        </div>
      )}
    </article>
  );
}

export default function SquadGallery({ builtins = [], mine = [], byRole = {}, providers = [], busy = false, launchingId = null, freshId = null, onOpen, onEdit, onDelete, onNew }) {
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  let n = 0;
  const card = (s) => <Card key={s.id} squad={s} i={n++} byRole={byRole} labelOf={labelOf} busy={busy || (launchingId !== null && launchingId !== s.id)} launching={launchingId === s.id} fresh={freshId === s.id} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />;
  return (
    <section className="sq-gallery" aria-label="Squads">
      {builtins.length > 0 && <><h4 className="sq-h">Squads do FORGE <span className="dim">misturam Claude Code e Codex</span></h4><div className="sq-grid">{builtins.map(card)}</div></>}
      <h4 className="sq-h">Meus squads {mine.length === 0 && <span className="dim">monte o seu e abra a equipe toda com um clique</span>}</h4>
      <div className="sq-grid">
        {mine.map(card)}
        <button type="button" className="sq-card sq-new" style={{ '--i': n }} disabled={busy} onClick={onNew} aria-label="Montar um squad novo">
          <span className="sq-plus" aria-hidden="true"><Icon name="plus" size={16} /></span>
          <span className="sq-sum">Novo squad</span>
          <span className="sq-sub dim">escolha o papel e o agente de cada vaga</span>
        </button>
      </div>
    </section>
  );
}
