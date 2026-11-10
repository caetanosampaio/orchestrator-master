import React from 'react';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { ActionButton } from './MissionPanel.jsx';
import { NODE_STATE_LABEL } from '../missions-view.js';

const LEVEL = { verified: ['completed', 'verificada pelo sistema'], failed: ['attention', 'o sistema não confirmou'], inconclusive: ['approval', 'inconclusiva: não vale como concluída'] };
const VSTAT = { pass: ['completed', 'passou'], fail: ['attention', 'falhou'], blocked: ['attention', 'bloqueada'], skipped: ['idle', 'não rodou'], error: ['attention', 'erro'] };

/** Linha de campo: rótulo + valor (texto livre cortado pelo modelo de visão). */
const Fact = ({ k, v }) => <div className="mi-fact"><dt>{k}</dt><dd>{v}</dd></div>;

/** Resumo legível da ação que pede aprovação: só os campos que o servidor gravou (a decisão exige o mesmo `digest`). */
export function ActionSummary({ action, rules }) {
  const rows = Object.entries(action ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '').slice(0, 8)
    .map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 8).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  return (
    <dl className="mi-action">
      {rows.map(([k, v]) => <Fact key={k} k={k} v={v.length > 240 ? `${v.slice(0, 240)}…` : v} />)}
      {rules?.length > 0 && <Fact k="regras" v={rules.join(', ')} />}
    </dl>
  );
}

/** Detalhes da etapa selecionada: agente, atividade (final do log do Executor), evidências do SISTEMA (separadas do que o agente declarou), arquivos e aprovação. */
export default function MissionNodeDetail({ detail, onClose, onDecide, busyAction, onOpenTerminals }) {
  if (!detail) return null;
  const { agent, state } = detail, ev = detail.evidence, lvl = ev?.level ? LEVEL[ev.level] : null;
  return (
    <aside className={`mi-detail st-${state}`} aria-label={`Detalhes: ${detail.title}`}>
      <header className="mi-detail-head">
        <span className={`mi-badge st-${state}`}><i aria-hidden="true" />{NODE_STATE_LABEL[state]}</span>
        <h3>{detail.title}</h3>
        <button type="button" className="oc-iconbtn" onClick={onClose} aria-label="Fechar detalhes"><Icon name="close" size={14} /></button>
      </header>

      {agent && (
        <div className="mi-detail-agent">
          <ProviderLogo id={agent.provider === 'codex' ? 'codex' : 'claude'} size={14} />
          <span><b>{agent.name}</b> · {agent.providerLabel} · <span className="dim">{agent.model ?? 'modelo não informado'}</span></span>
          <button type="button" className="mi-link" onClick={onOpenTerminals}>terminais</button>
        </div>
      )}

      {detail.approval && (
        <div className="mi-detail-appr" role="group" aria-label="Aprovação pendente">
          <strong><Icon name="gate" size={14} /> Esta etapa espera a sua decisão</strong>
          <ActionSummary action={detail.approval.action} rules={detail.approval.rules} />
          <div className="mi-row-actions">
            <ActionButton kind="primary" icon="checkCircle" busy={busyAction === `approve:${detail.approval.id}`} onClick={() => onDecide({ scope: 'cycle', id: detail.approval.id, digest: detail.approval.digest, decision: 'approve' })}>Aprovar</ActionButton>
            <ActionButton kind="danger" icon="xCircle" busy={busyAction === `reject:${detail.approval.id}`} onClick={() => onDecide({ scope: 'cycle', id: detail.approval.id, digest: detail.approval.digest, decision: 'reject' })}>Rejeitar</ActionButton>
          </div>
        </div>
      )}

      {detail.facts.length > 0 && <dl className="mi-facts">{detail.facts.map(([k, v]) => <Fact key={k} k={k} v={v} />)}</dl>}

      {detail.instructions && <details className="mi-fold"><summary>Instruções da etapa</summary><p>{detail.instructions}</p></details>}
      {detail.acceptance.length > 0 && <details className="mi-fold"><summary>Critérios de aceite ({detail.acceptance.length})</summary><ul>{detail.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}

      {detail.errors.length > 0 && <div className="mi-errors" role="alert"><strong><Icon name="xCircle" size={13} /> Falhas registradas</strong><ul>{detail.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

      <section className="mi-sec">
        <h4>Atividade</h4>
        {detail.activity.length === 0
          ? <p className="dim">Nenhuma atividade registrada ainda.</p>
          : <pre className={`mi-log${state === 'working' ? ' live' : ''}`} tabIndex={0} aria-label="Final do log do agente">{detail.activity.join('\n')}</pre>}
      </section>

      <section className="mi-sec">
        <h4>Evidências</h4>
        {!ev ? <p className="dim">Sem relatório de rodada: nada foi comprovado ainda.</p> : (
          <>
            {lvl && <p className={`mi-evlevel st-${lvl[0]}`}><i aria-hidden="true" />{lvl[1]}</p>}
            {ev.reasons.length > 0 && <ul className="mi-reasons">{ev.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {ev.verifications.length > 0 && (
              <ul className="mi-verifs" aria-label="Verificações reais do sistema">
                {ev.verifications.map((v, i) => { const [st, label] = VSTAT[v.status] ?? ['idle', v.status]; return <li key={i} className={`st-${st}`}><i aria-hidden="true" /><span>{v.id}</span><span className="dim">{label}</span>{v.command && <code>{v.command}</code>}</li>; })}
              </ul>
            )}
            {ev.summary && <details className="mi-fold"><summary>O que o agente declarou (não é prova)</summary><p>{ev.summary}</p></details>}
          </>
        )}
        {detail.files.length > 0 && <details className="mi-fold" open><summary>Arquivos alterados ({detail.files.length})</summary><ul className="mi-files">{detail.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul></details>}
      </section>
    </aside>
  );
}
