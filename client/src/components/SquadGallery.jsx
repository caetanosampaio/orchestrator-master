import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { squadSummary } from '../squads.js';

/**
 * Galeria de equipes (tela sem terminais): cartões com as vagas da equipe (um selo por vaga: a cor é a do papel e o logo é o do agente), abrem tudo com um clique.
 * No Cockpit só aparecem os times de Configurações > Times prontos (os instalados e os seus); `empty` é o que mostrar quando não há nenhum. A gestão (editar, excluir, criar) mora em Configurações > Equipes: sem `onEdit`/`onDuplicate`/`onDelete`/`onNew` os cartões
 * só abrem, e `onManage` mostra o link "Gerenciar equipes". Animações só com CSS (retro.css, .sq-*), desligadas pelas regras globais de "Animações reduzidas". Nada aqui abre terminal: quem abre é o cockpit (onOpen).
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

function Card({ squad, i, byRole, labelOf, busy, launching, fresh, tooBig, openLabel, onOpen, onEdit, onDuplicate, onDelete }) {
  const [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const sum = squadSummary(squad.slots, labelOf);
  const remove = () => { setLeaving(true); timer.current = setTimeout(() => onDelete(squad), 220); }; // some com uma animação curta e só então exclui
  return (
    <article className={`sq-card${launching ? ' launching' : ''}${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}${squad.builtin ? ' builtin' : ''}`} style={{ '--i': i }}>
      <button type="button" className="sq-main" disabled={busy || asking || tooBig} onClick={() => onOpen(squad)} aria-label={`${openLabel} ${squad.name}: ${sum}`} title={tooBig ? 'Não há vagas livres para esta equipe' : undefined}>
        <span className="sq-head"><b>{squad.name}</b><span className="sq-tag">{squad.builtin ? 'FORGE' : 'meu'}</span></span>
        <Pips slots={squad.slots} byRole={byRole} labelOf={labelOf} />
        <span className="sq-sum">{launching ? 'Abrindo a equipe…' : (squad.tagline ?? sum)}</span>
        {squad.tagline && !launching && <span className="sq-sub dim">{sum}</span>}
      </button>
      {!launching && (onEdit || onDuplicate || (onDelete && !squad.builtin)) && (
        <div className="sq-actions">
          {onEdit && <button type="button" className="sq-act" disabled={busy} onClick={() => onEdit(squad)} aria-label={squad.builtin ? `Usar ${squad.name} como ponto de partida de um squad novo` : `Editar o squad ${squad.name}`} title={squad.builtin ? 'Usar como ponto de partida' : 'Editar'}><Icon name="pencil" size={12} /></button>}
          {onDuplicate && <button type="button" className="sq-act" disabled={busy} onClick={() => onDuplicate(squad)} aria-label={`Duplicar ${squad.name} como uma equipe nova`} title="Duplicar"><Icon name="copy" size={12} /></button>}
          {onDelete && !squad.builtin && <button type="button" className="sq-act" disabled={busy} onClick={() => setAsking(true)} aria-label={`Excluir o squad ${squad.name}`} title="Excluir"><Icon name="close" size={12} /></button>}
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

export default function SquadGallery({ builtins = [], mine = [], byRole = {}, providers = [], busy = false, launchingId = null, freshId = null, room = Infinity, openLabel = 'Abrir a equipe', mineTitle = 'Minhas equipes', mineHint = null, empty = null, onOpen, onEdit, onDuplicate, onDelete, onNew, onManage }) {
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  let n = 0;
  const card = (s) => <Card key={s.id} squad={s} i={n++} byRole={byRole} labelOf={labelOf} busy={busy || (launchingId !== null && launchingId !== s.id)} launching={launchingId === s.id} fresh={freshId === s.id} tooBig={s.slots.length > room} openLabel={openLabel} onOpen={onOpen} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />;
  return (
    <section className="sq-gallery" aria-label="Equipes">
      {builtins.length > 0 && <><h4 className="sq-h">Equipes do FORGE <span className="dim">abrem todos os terminais de uma vez</span></h4><div className="sq-grid">{builtins.map(card)}</div></>}
      {(mine.length > 0 || onNew) && <h4 className="sq-h">{mineTitle} {mineHint ? <span className="dim">{mineHint}</span> : mine.length === 0 && <span className="dim">monte a sua e abra a equipe toda com um clique</span>}</h4>}
      {(mine.length > 0 || onNew) && <div className="sq-grid">
        {mine.map(card)}
        {onNew && <button type="button" className="sq-card sq-new" style={{ '--i': n }} disabled={busy} onClick={onNew} aria-label="Montar uma equipe nova">
          <span className="sq-plus" aria-hidden="true"><Icon name="plus" size={16} /></span>
          <span className="sq-sum">Nova equipe</span>
          <span className="sq-sub dim">escolha o papel e o agente de cada vaga</span>
        </button>}
      </div>}
      {mine.length === 0 && !onNew && empty}
      {onManage && mine.length > 0 && <p className="sq-manage small"><button type="button" className="oc-link" onClick={onManage}>Gerenciar times</button></p>}
    </section>
  );
}
