import React from 'react';
import '../mission-board.css';
import { ActionButton } from './MissionPanel.jsx';
import { ActionSummary } from './MissionNodeDetail.jsx';
import { effortLabel, NOT_INFORMED } from '../mission-board.js';

/** Marcador do estado: a forma (e o texto ao lado) diz o que é, nunca só a cor. O ✓ é desenhado e "se traça" ao concluir. */
export function StateMark({ state }) {
  if (state === 'completed') return <svg className="mb-mark mb-mark-ok" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 6.4l2.6 2.6L10 3.4" /></svg>;
  return <i className={`mb-mark mb-mark-${state}`} aria-hidden="true" />;
}

/** Nível, modelo, esforço e origem: sempre os da rota REAL; ausente = "não informado". */
export function RouteChips({ route, showSource = true }) {
  return (
    <span className="mb-route">
      <span className={`mb-tier t-${route.tier}`} title="Nível do agente">{route.tierLabel}</span>
      <span className={`mb-model${route.model ? '' : ' mb-na'}`}>{route.model ?? `modelo ${NOT_INFORMED}`}</span>
      <span className={`mb-eff${route.effort ? '' : ' mb-na'}`}>{route.effort ? `esforço ${effortLabel(route.effort)}` : `esforço ${NOT_INFORMED}`}</span>
      {showSource && <span className="mb-src">{route.sourceLabel}</span>}
    </span>
  );
}

/** Aprovação pendente DENTRO do cartão da etapa (mesma decisão do painel de controle: o servidor exige o `digest` da ação mostrada). */
function Approval({ item, onDecide, busyAction }) {
  return (
    <div className="mb-appr" role="group" aria-label="Aprovação pendente desta etapa">
      <strong>{item.title}</strong>
      {item.detail && <p>{item.detail}</p>}
      <details className="mi-fold"><summary>Detalhes da ação que será liberada</summary><ActionSummary action={item.action} rules={item.rules} /></details>
      <div className="mi-row-actions">
        <ActionButton kind="primary" busy={busyAction === `approve:${item.id}`} disabled={!item.digest} onClick={() => onDecide({ scope: 'cycle', id: item.id, digest: item.digest, decision: 'approve' })}>Aprovar</ActionButton>
        <ActionButton busy={busyAction === `reject:${item.id}`} disabled={!item.digest} onClick={() => onDecide({ scope: 'cycle', id: item.id, digest: item.digest, decision: 'reject' })}>Rejeitar</ActionButton>
      </div>
    </div>
  );
}

/** Cartão de uma etapa: o botão abre a gaveta com os detalhes; a aprovação pendente (se houver) fica abaixo, fora do botão. */
export default function MissionStepCard({ step, index = 0, selected, onSelect, onDecide, busyAction }) {
  return (
    <li className={`mb-card st-${step.state}${selected ? ' on' : ''}`} style={{ '--i': index }}>
      <button type="button" className="mb-card-btn" data-sid={step.id} aria-expanded={selected} aria-controls="mb-drawer" onClick={() => onSelect(step.id)}>
        <span className="mb-card-top">
          <span className="mb-role">{step.roleLabel}</span>
          <span className="mb-state"><StateMark state={step.state} />{step.stateLabel}</span>
        </span>
        <span className="mb-card-title">{step.title}</span>
        <RouteChips route={step.route} />
        {(step.attempts > 1 || step.uncertain) && (
          <span className="mb-flags">
            {step.attempts > 1 && <span className="mb-flag">{step.attempts} tentativas</span>}
            {step.uncertain && <span className="mb-flag warn" title="Interrompida sem relatório final: os efeitos no workspace são desconhecidos">resultado incerto</span>}
          </span>
        )}
      </button>
      {step.approval && <Approval item={step.approval} onDecide={onDecide} busyAction={busyAction} />}
    </li>
  );
}
