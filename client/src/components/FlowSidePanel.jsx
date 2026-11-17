import React, { useEffect, useRef } from 'react';
import { Icon } from './ui.jsx';
import { fmtDuration, fmtWhen, NOT_INFORMED } from '../flows-view.js';

const Fact = ({ k, children }) => <div className="fl-fact"><dt>{k}</dt><dd>{children}</dd></div>;

/** Painel lateral do nó selecionado: texto da etapa, resumo ou erro, tempos e "Abrir terminal". Esc fecha; o foco vai para o título ao abrir. */
export default function FlowSidePanel({ detail, onClose, onOpenTerminal }) {
  const head = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [detail?.id]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  if (!detail) return null;
  const d = detail;
  return (
    <aside className="fl-panel" aria-label={`Detalhe: ${d.title}`}>
      <header className="fl-panel-h">
        <div className="fl-panel-id">
          <p className="fl-kicker"><i aria-hidden="true" />{d.kind === 'delivery' ? 'Entrega' : 'Etapa'}</p>
          <h2 tabIndex={-1} ref={head}>{d.title}</h2>
          <span className={`fl-state fl-t-${d.tone}`}><i aria-hidden="true" />{d.stateLabel}</span>
        </div>
        <button type="button" className="fl-plus" onClick={onClose} aria-label="Fechar o painel (Esc)" title="Fechar (Esc)"><Icon name="close" size={14} /></button>
      </header>
      <div className="fl-panel-b">
        {d.kind === 'step' ? (
          <>
            {d.state === 'waiting' && (
              <p className="fl-callout wait" role="status">O agente pediu uma permissão e espera a sua resposta no terminal.</p>
            )}
            <dl className="fl-facts">
              <Fact k="agente">{d.agent.roleLabel} · {d.agent.providerLabel}</Fact>
              <Fact k="modelo">{d.agent.model ?? NOT_INFORMED}</Fact>
              <Fact k="esforço">{d.agent.effort ?? NOT_INFORMED}</Fact>
              <Fact k="início">{fmtWhen(d.startedAt)}</Fact>
              <Fact k="fim">{d.finishedAt ? fmtWhen(d.finishedAt) : d.terminalLive ? 'em andamento' : NOT_INFORMED}</Fact>
              <Fact k="duração">{fmtDuration(d.durationMs)}</Fact>
              <Fact k="depende de">{d.dependsOn.length ? d.dependsOn.map((x) => x.title).join(', ') : 'nada (pode começar já)'}</Fact>
              {d.continueFrom && <Fact k="terminal">continua o de “{d.continueFrom.title}”</Fact>}
            </dl>
            {d.error && <section><p className="fl-label">Erro</p><p className="fl-text err">{d.error}</p></section>}
            {d.summary && <section><p className="fl-label">Resumo do agente</p><p className="fl-text">{d.summary}</p></section>}
            {!d.error && !d.summary && d.state === 'completed' && <p className="fl-text dim">Resumo {NOT_INFORMED}.</p>}
            <section><p className="fl-label">Texto da etapa</p><p className="fl-text pre">{d.prompt ?? NOT_INFORMED}</p></section>
            <div className="fl-panel-f">
              <button type="button" className="fl-btn fl-btn-primary" onClick={() => onOpenTerminal(d.terminalId)} disabled={!d.canOpenTerminal}><Icon name="terminal" size={13} /><span>Abrir terminal</span></button>
              {d.terminalHint && <p className="fl-hint">{d.terminalHint}</p>}
            </div>
          </>
        ) : (
          <>
            <dl className="fl-facts">
              <Fact k="execução">{d.hasRun ? d.stateLabel : 'ainda não executada'}</Fact>
              <Fact k="início">{fmtWhen(d.startedAt)}</Fact>
              <Fact k="fim">{d.finishedAt ? fmtWhen(d.finishedAt) : d.runStatus === 'running' ? 'em andamento' : NOT_INFORMED}</Fact>
              <Fact k="duração">{fmtDuration(d.durationMs)}</Fact>
              <Fact k="etapas">{d.hasRun ? `${d.counts.completed} de ${d.counts.total} concluídas${d.counts.failed ? ` · ${d.counts.failed} falharam` : ''}${d.counts.skipped ? ` · ${d.counts.skipped} puladas` : ''}${d.counts.cancelled ? ` · ${d.counts.cancelled} canceladas` : ''}` : `${d.counts.total} no total`}</Fact>
            </dl>
            {d.failures.length > 0 && (
              <section><p className="fl-label">Falhas</p>
                <ul className="fl-fails">{d.failures.map((f) => <li key={f.id}><b>{f.title}</b>: {f.error ?? 'motivo não informado'}</li>)}</ul>
              </section>
            )}
            <p className="fl-text dim">A entrega só é marcada como concluída quando todas as etapas terminam de verdade.</p>
          </>
        )}
      </div>
    </aside>
  );
}
