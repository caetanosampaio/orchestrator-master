import React from 'react';
import '../mission-board.css';
import MissionStepCard from './MissionStepCard.jsx';
import { ActionButton } from './MissionPanel.jsx';
import { ActionSummary } from './MissionNodeDetail.jsx';

const WAVE_STATE = { pending: 'na fila', active: 'em andamento', done: 'concluída', attention: 'precisa de atenção' };

/** O que pede VOCÊ e não está num cartão (aprovação sem etapa, tarefa manual, decisão registrada, falha ou bloqueio). Só aparece quando há algo; sem logs. */
export function MissionAttention({ items, onDecide, busyAction }) {
  if (!items?.length) return null;
  return (
    <section className="mi-control" aria-label="Pede a sua atenção" role="alert">
      {items.map((it) => (
        <article key={`${it.kind}:${it.id}`} className={`mi-ctl ${it.kind === 'approval' ? 'st-approval' : it.kind === 'resume' ? 'st-working' : 'st-attention'}`}>
          <p className="mi-kicker"><i aria-hidden="true" /><span>{it.kind === 'approval' ? 'Aprovação' : it.kind === 'resume' ? 'Decisão registrada' : 'Bloqueio'}</span></p>
          <strong className="mi-ctl-t">{it.title}</strong>
          {it.detail && <p>{it.detail}</p>}
          {it.kind === 'approval' && it.scope === 'cycle' && <details className="mi-fold"><summary>Detalhes da ação que será liberada</summary><ActionSummary action={it.action} rules={it.rules} /></details>}
          {it.kind === 'approval' && (
            <div className="mi-row-actions">
              <ActionButton kind="primary" busy={busyAction === `approve:${it.id}`} disabled={it.scope === 'cycle' && !it.digest} onClick={() => onDecide({ scope: it.scope, id: it.id, digest: it.digest, decision: 'approve' })}>Aprovar</ActionButton>
              <ActionButton busy={busyAction === `reject:${it.id}`} disabled={it.scope === 'cycle' && !it.digest} onClick={() => onDecide({ scope: it.scope, id: it.id, digest: it.digest, decision: 'reject' })}>Rejeitar</ActionButton>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

/**
 * Plano: trilho VERTICAL por ondas, de cima para baixo. Etapas da mesma onda não dependem entre si (lado a lado; empilhadas em tela estreita).
 * O conector entre ondas se desenha quando a onda anterior termina e pulsa enquanto a seguinte executa. Só apresenta `board` (view-model puro).
 */
export default function MissionBoard({ board, selectedId, onSelect, onDecide, busyAction }) {
  let n = 0; // índice global do cartão: a entrada em cascata segue a ordem de leitura
  const total = board.steps.length;
  return (
    <section className="mb-sec mb-plan" aria-labelledby="mb-plan-h">
      <header className="mb-sec-h">
        <h3 className="mi-kicker" id="mb-plan-h"><i aria-hidden="true" /><span>Plano</span></h3>
        {total > 0 && <span className="mb-sum">{total} {total === 1 ? 'etapa' : 'etapas'} · {board.waves.length} {board.waves.length === 1 ? 'onda' : 'ondas'}</span>}
      </header>
      {board.note && <p className="mb-note">{board.note}</p>}
      {total === 0 ? (
        board.empty && <div className="mb-empty" role="status"><i aria-hidden="true" /><span>Sem etapas ainda.</span></div>
      ) : (
        <ol className="mb-waves">
          {board.waves.map((w) => (
            <li key={w.n} className={`mb-wave w-${w.state} out-${w.out ?? 'none'}`} aria-label={`${w.label}: ${WAVE_STATE[w.state]}${w.parallel > 1 ? `, ${w.parallel} etapas em paralelo` : ''}`}>
              <div className="mb-rail" aria-hidden="true"><span className="mb-wave-node">{w.n}</span><span className="mb-line" /></div>
              <div className="mb-wave-body">
                <h4 className="mb-wave-h"><span>{w.label}</span>{w.parallel > 1 && <span className="mb-par">{w.parallel} em paralelo</span>}</h4>
                <ul className="mb-cards">
                  {w.steps.map((s) => <MissionStepCard key={s.id} step={s} index={n++} selected={s.id === selectedId} onSelect={onSelect} onDecide={onDecide} busyAction={busyAction} />)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
