import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { squadSummary, squadMissing, describeSquad, slotChoiceLabels } from '../squads.js';
import { aiName } from '../provider-catalog.js';

/**
 * Times no formato da tela "Times prontos" de referência (em preto): cada time é uma linha com o nome, a etiqueta e o que ele faz, a fila de mascotes (um por vaga: a cor é a da IA e o rótulo embaixo é o papel)
 * e os botões à direita. O time em destaque ("comece aqui") é um cartão maior. Só mostra e pede ação: quem abre, instala, edita e exclui é TeamsSettings. Animações só com CSS, desligadas por "Animações reduzidas".
 */
export const labelFor = (providers) => (id) => aiName(id, providers.find((p) => p.id === id)?.label);

/** A fila de mascotes de um time: um por vaga, com a bolinha na cor do papel e o nome do papel embaixo. O texto do modelo e do esforço vai no `title` (e aparece completo em "Ver por dentro"). */
export function Strip({ slots, byRole, labelOf, options, size = 30, big = false }) {
  return (
    <ul className={`tc-strip${big ? ' big' : ''}`} aria-label="Quem faz parte do time">
      {slots.map((s, k) => {
        const role = byRole[s.role], ch = slotChoiceLabels(s, options);
        return (
          <li key={k} className="tc-m" style={{ '--role': role?.color || 'var(--brand)' }} title={`${role?.label ?? s.role} · ${labelOf(s.provider)} · ${ch.model} · ${ch.effort}`}>
            <ProviderMascot id={s.provider} size={size} hat={s.role === 'maestro'} />
            <span className="tc-m-l"><i aria-hidden="true" />{role?.label ?? s.role}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function TeamRow({ squad, i = 0, byRole, labelOf, options, available, known, featured = false, badge = null, fresh = false, actions, onDelete = null }) {
  const [asking, setAsking] = useState(false), [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const missing = known ? squadMissing(squad, available) : [], { tagline } = describeSquad(squad);
  const remove = () => { setLeaving(true); timer.current = setTimeout(() => onDelete?.(squad), 220); };
  return (
    <article className={`tc-row${featured ? ' featured' : ''}${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}`} style={{ '--i': i }}>
      <div className="tc-main">
        <div className="tc-head"><b>{squad.name}</b>{squad.tag && <span className="tc-tag">{squad.tag}</span>}{badge && <span className="tc-badge">{badge}</span>}</div>
        {tagline && <p className="tc-desc">{tagline}</p>}
        {featured && <p className="tc-sum">{squadSummary(squad.slots, labelOf)}</p>}
        {missing.length > 0 && <p className="tc-miss" role="status">Requer {missing.map(labelOf).join(' e ')} instalado.</p>}
      </div>
      <Strip slots={squad.slots} byRole={byRole} labelOf={labelOf} options={options} size={featured ? 36 : 28} big={featured} />
      <div className="tc-act">{actions({ ask: () => setAsking(true) })}</div>
      {asking && (
        <div className="tc-ask" role="alertdialog" aria-label={`Excluir ${squad.name}?`}>
          <p>Excluir “{squad.name}”?</p>
          <div><button type="button" className="tc-yes" data-autofocus="" onClick={remove}>Excluir</button><button type="button" onClick={() => setAsking(false)}>Cancelar</button></div>
        </div>
      )}
    </article>
  );
}

/** Botões dos cartões: `primary` = ação principal (Usar), `quiet` = texto ("Ver por dentro"), o resto = contornado. */
export const TcBtn = ({ kind = '', icon = null, children, ...p }) => <button type="button" className={`tc-btn${kind ? ` ${kind}` : ''}`} {...p}>{icon && <Icon name={icon} size={12} />}{children}</button>;

export function TeamSection({ title, hint = null, children, id }) {
  return (
    <section className="set-block" aria-labelledby={`${id}-t`}>
      <h3 className="set-block-h" id={`${id}-t`}>{title}{hint && <span className="dim">{hint}</span>}</h3>
      <div className="tc-list">{children}</div>
    </section>
  );
}
