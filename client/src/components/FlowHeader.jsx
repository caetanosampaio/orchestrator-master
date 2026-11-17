import React from 'react';
import { Icon } from './ui.jsx';
import { currentRun, flowProgress, flowState, FLOW_STATE_META, KIND_LABEL, NOT_INFORMED, runDuration, fmtDuration, fmtWhen, stepMeta } from '../flows-view.js';

/** Aviso fixo quando alguma etapa espera você: o agente pediu permissão e só o terminal resolve. Atalho para abrir o terminal da etapa. */
export function FlowAttention({ items, onOpenTerminal }) {
  if (!items.length) return null;
  return (
    <section className="fl-attn" aria-label="Etapas aguardando você" role="status">
      <p className="fl-kicker"><i aria-hidden="true" />Aguardando você</p>
      <ul>
        {items.map((w) => (
          <li key={w.stepId}>
            <span><b>{w.title}</b>: o agente pediu uma permissão e espera a sua resposta no terminal.</span>
            {w.terminalId
              ? <button type="button" className="fl-btn fl-btn-primary" onClick={() => onOpenTerminal(w.terminalId)}><Icon name="terminal" size={13} /><span>Abrir terminal</span></button>
              : <span className="dim">terminal não informado</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Busy({ on }) { return on ? <i className="fl-spin" aria-hidden="true" /> : null; }

/** Cabeçalho compacto: título, estado, ações (Iniciar/Cancelar/Editar/Excluir), metadados, objetivo e a faixa de progresso (um segmento por etapa). */
export default function FlowHeader({ flow, workspaceName, now, busy, onStart, onCancel, onEdit, onRemove, onPickStep }) {
  const run = currentRun(flow), active = flow.activeRun ?? null;
  const state = flowState(flow), meta = FLOW_STATE_META[state], progress = flowProgress(flow, run);
  const dur = runDuration(run, now);
  const runBy = new Map((run?.steps ?? []).map((s) => [s.stepId, s]));
  return (
    <header className="fl-head">
      <div className="fl-head-row">
        <div className="fl-head-id">
          <h1 className="fl-title">{flow.title}</h1>
          <span className={`fl-state fl-t-${meta.tone}`}><i aria-hidden="true" />{meta.label}</span>
        </div>
        <div className="fl-actions">
          {active
            ? <button type="button" className="fl-btn fl-btn-danger" onClick={onCancel} disabled={!!busy}><Busy on={busy === 'cancel'} /><Icon name="stop" size={12} /><span>Cancelar</span></button>
            : <button type="button" className="fl-btn fl-btn-primary" onClick={onStart} disabled={!!busy}><Busy on={busy === 'start'} /><Icon name="play" size={12} /><span>{run ? 'Executar de novo' : 'Iniciar'}</span></button>}
          <button type="button" className="fl-btn" onClick={onEdit} disabled={!!active || !!busy} title={active ? 'Cancele ou espere o run terminar para editar.' : undefined}><span>Editar</span></button>
          <button type="button" className="fl-btn fl-btn-ghost" onClick={onRemove} disabled={!!active || !!busy} title={active ? 'Cancele ou espere o run terminar para excluir.' : undefined}><Busy on={busy === 'remove'} /><span>Excluir</span></button>
        </div>
      </div>
      <p className="fl-meta">
        <span>{workspaceName ?? 'sem workspace'}</span>
        <span>{KIND_LABEL[flow.kind] ?? NOT_INFORMED}</span>
        <span>{flow.maxParallel > 1 ? `até ${flow.maxParallel} etapas em paralelo` : 'uma etapa por vez'}</span>
        {flow.fullAccess === true && <span className="fl-chip warn" title="Os terminais desta missão sobem sem pedir confirmação de permissão.">acesso total</span>}
        <span className="fl-dur">{run ? `${run.status === 'running' ? 'rodando há' : 'durou'} ${fmtDuration(dur)}` : 'nunca executada'}</span>
        {run && <span>início {fmtWhen(run.startedAt)}</span>}
      </p>
      {flow.goal ? <p className="fl-goal" title={flow.goal}>{flow.goal}</p> : <p className="fl-goal dim">Objetivo: {NOT_INFORMED}.</p>}
      <div className="fl-pipe">
        <div className="fl-pipe-bar" role="img" aria-label={`Progresso: ${progress.label} etapas concluídas`}>
          {flow.steps.map((s) => {
            const st = runBy.get(s.id)?.status ?? 'pending', m = stepMeta(st);
            return <button type="button" key={s.id} className={`fl-seg fl-t-${m.tone}`} onClick={() => onPickStep(s.id)} title={`${s.title}: ${m.label}`} aria-label={`${s.title}: ${m.label}`} />;
          })}
        </div>
        <span className="fl-pipe-t"><b>{progress.label}</b> etapas</span>
      </div>
    </header>
  );
}
