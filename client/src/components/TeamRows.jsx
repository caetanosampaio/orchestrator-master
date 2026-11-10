import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { squadSummary, squadMissing, describeSquad, slotChoiceLabels } from '../squads.js';

/**
 * Equipes em LINHAS horizontais (Configurações > Equipes): à esquerda o nome, o que a equipe faz, quando usar e as ações; à direita os agentes em fila, cada um com o bonequinho do provider
 * (a cor é a dele), o nome do provider, o papel, o modelo e o esforço. As equipes do FORGE só viram ponto de partida; as suas podem ser editadas, duplicadas e excluídas.
 * Só mostra e pede ação: quem edita, duplica e exclui é TeamsSettings. Animações só com CSS (teams.css), desligadas por "Animações reduzidas".
 */
function Slot({ slot, byRole, labelOf, options }) {
  const role = byRole[slot.role], ch = slotChoiceLabels(slot, options);
  return (
    <li className="tr-slot" style={{ '--role': role?.color || 'var(--brand)' }}>
      <ProviderMascot id={slot.provider} size={34} label={labelOf(slot.provider)} />
      <span className="tr-role"><i aria-hidden="true" />{role?.label ?? slot.role}</span>
      <span className={`tr-chip${ch.modelSet ? ' set' : ''}`} title="Modelo">{ch.model}</span>
      <span className={`tr-chip${ch.effortSet ? ' set' : ''}`} title="Esforço">{ch.effort}</span>
    </li>
  );
}

function Row({ squad, i, byRole, labelOf, options, available, fresh, onEdit, onDuplicate, onDelete }) {
  const [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const missing = squadMissing(squad, available), { tagline, about } = describeSquad(squad);
  const remove = () => { setLeaving(true); timer.current = setTimeout(() => onDelete(squad), 220); };
  return (
    <article className={`tr-row${squad.builtin ? ' builtin' : ''}${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}${missing.length ? ' off' : ''}`} style={{ '--i': i }}>
      <div className="tr-info">
        <div className="tr-head"><h5>{squad.name}</h5><span className="tr-tag">{squad.builtin ? 'FORGE' : 'minha'}</span></div>
        {tagline && <p className="tr-tagline">{tagline}</p>}
        {about && <p className="tr-about">{about}</p>}
        <p className="tr-sum">{squadSummary(squad.slots, labelOf)}</p>
        {missing.length > 0 && <p className="tr-miss" role="status">Requer {missing.map(labelOf).join(' e ')} instalado.</p>}
        <div className="tr-actions">
          <button type="button" className="tr-act" onClick={() => onEdit(squad)} aria-label={squad.builtin ? `Usar ${squad.name} como ponto de partida de uma equipe nova` : `Editar a equipe ${squad.name}`}>
            <Icon name="pencil" size={12} /> {squad.builtin ? 'Usar como base' : 'Editar'}
          </button>
          <button type="button" className="tr-act" onClick={() => onDuplicate(squad)} aria-label={`Duplicar ${squad.name} como uma equipe nova`}><Icon name="copy" size={12} /> Duplicar</button>
          {!squad.builtin && <button type="button" className="tr-act danger" onClick={() => setAsking(true)} aria-label={`Excluir a equipe ${squad.name}`}><Icon name="close" size={12} /> Excluir</button>}
        </div>
      </div>
      <ul className="tr-slots" aria-label={`Agentes de ${squad.name}`}>
        {squad.slots.map((s, k) => <Slot key={k} slot={s} byRole={byRole} labelOf={labelOf} options={options} />)}
      </ul>
      {asking && (
        <div className="tr-ask" role="alertdialog" aria-label={`Excluir ${squad.name}?`}>
          <p>Excluir “{squad.name}”?</p>
          <div><button type="button" className="tr-yes" data-autofocus="" onClick={remove}>Excluir</button><button type="button" onClick={() => setAsking(false)}>Cancelar</button></div>
        </div>
      )}
    </article>
  );
}

export default function TeamRows({ title, hint = null, squads = [], emptyText = null, byRole = {}, providers = [], options = null, freshId = null, onEdit, onDuplicate, onDelete, children = null }) {
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  const available = providers.filter((p) => p.available).map((p) => p.id);
  return (
    <section className="tr-sec" aria-label={title}>
      <h4 className="tr-h">{title} {hint && <span className="dim">{hint}</span>}</h4>
      {squads.length === 0 && emptyText && <p className="dim small tr-empty">{emptyText}</p>}
      <div className="tr-list">
        {squads.map((s, i) => <Row key={s.id} squad={s} i={i} byRole={byRole} labelOf={labelOf} options={options} available={available} fresh={freshId === s.id} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />)}
        {children}
      </div>
    </section>
  );
}
