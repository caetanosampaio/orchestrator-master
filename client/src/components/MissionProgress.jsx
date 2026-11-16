import React from 'react';
import '../mission-board.css';
import { StateMark } from './MissionStepCard.jsx';

const NODE = { done: 'completed', current: 'working', attention: 'attention', next: 'idle' };
const MARK_LABEL = { done: 'concluída', current: 'em andamento', attention: 'precisa de atenção', next: 'próxima' };

/**
 * Progresso: o que já foi concluído (✓), o que está em andamento (●) e o que vem depois (○), com a barra x/y e a próxima etapa em linguagem natural.
 * Limpo de propósito: nenhum log nem atividade técnica aqui (isso fica na gaveta de cada etapa).
 */
export default function MissionProgress({ progress, onSelect }) {
  const { done, total, pct, unit, items, headline } = progress;
  return (
    <section className="mb-sec mb-progress" aria-labelledby="mb-prog-h">
      <header className="mb-sec-h">
        <h3 className="mi-kicker" id="mb-prog-h"><i aria-hidden="true" /><span>Progresso</span></h3>
        <span className="mb-sum">{total ? <><b>{done}/{total}</b> {unit}{pct !== null ? ` · ${pct}%` : ''}</> : done > 0 ? <><b>{done}</b> {unit} concluídas</> : 'sem etapas ainda'}</span>
      </header>
      <p className="mb-headline" role="status">{headline}</p>
      {total > 0 && (
        <div className="mb-bar" role="progressbar" aria-label={`Etapas concluídas: ${done} de ${total}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          {items.map((i) => <span key={i.id} className={`mb-seg m-${i.marker}`} />)}
        </div>
      )}
      {items.length > 0 && (
        <ol className="mb-check">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" className={`mb-item m-${i.marker}`} onClick={() => onSelect(i.id)} aria-label={`${i.title}: ${MARK_LABEL[i.marker]}. Abrir detalhes.`}>
                <StateMark state={NODE[i.marker]} />
                <span className="mb-item-t">{i.title}</span>
                <span className="mb-item-s">{i.marker === 'next' ? 'próxima' : i.stateLabel}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
