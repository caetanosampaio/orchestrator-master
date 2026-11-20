import React, { useState } from 'react';
import { useFlowRuns } from '../use-flows.js';
import { historyRows, fmtDuration, fmtWhen, skipRows } from '../flows-view.js';

/** Integração resumida de um run no histórico: "integrada automaticamente · abcdef1"; sem integração (modo pasta, run antigo) = traço. */
const integrationText = (i) => (i ? [i.label ?? i.state, i.commitShort].filter(Boolean).join(' · ') : '—');

/**
 * Histórico dos runs em <details> fechado por padrão; só consulta o servidor enquanto está aberto. Mostra gatilho (manual/agenda) e integração de cada run e,
 * nas automações, os últimos horários pulados pela agenda (vêm junto com a missão em /api/flows: não gastam rede).
 */
export default function FlowRuns({ flow, now }) {
  const [open, setOpen] = useState(false);
  const { runs, failure } = useFlowRuns(flow.id, { enabled: open, key: `${flow.lastRun?.id ?? ''}:${flow.lastRun?.status ?? ''}:${flow.activeRun?.id ?? ''}:${flow.activeRun?.status ?? ''}` });
  const rows = runs ? historyRows(runs, flow, { now }) : [];
  const skips = skipRows(flow);
  const showSkips = flow.kind === 'automation' || skips.length > 0;
  return (
    <details className="fl-runs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Histórico de execuções{skips.length > 0 ? ` · ${skips.length} ${skips.length === 1 ? 'horário pulado' : 'horários pulados'}` : ''}</summary>
      {failure && <p className="fl-note err" role="status">{failure.message}</p>}
      {!failure && open && runs === null && <p className="fl-note" role="status">Carregando…</p>}
      {runs && rows.length === 0 && <p className="fl-note">Nenhuma execução ainda.</p>}
      {rows.length > 0 && (
        <div className="fl-runs-wrap">
          <table className="fl-runs-t">
            <thead><tr><th scope="col">Início</th><th scope="col">Gatilho</th><th scope="col">Estado</th><th scope="col">Etapas</th><th scope="col">Duração</th><th scope="col">Cópia</th><th scope="col">Integração</th><th scope="col">Motivo</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtWhen(r.startedAt)}</td>
                  <td>{r.trigger}</td>
                  <td><span className={`fl-state fl-t-${r.tone}`}><i aria-hidden="true" />{r.label}</span></td>
                  <td>{r.progress}</td>
                  <td>{fmtDuration(r.durationMs)}</td>
                  {/* onde as etapas trabalharam: cópia isolada (Git) ou a pasta do workspace (modo pasta, com o motivo); recomeço a partir de outra ponta como nota */}
                  <td className={r.copy ? (r.fallback ? 'fl-warn-t' : undefined) : 'dim'}>{r.copy ?? '—'}{r.rebasedText && <span className="fl-runs-note dim">{r.rebasedText}</span>}</td>
                  <td className={r.integration ? undefined : 'dim'}>{integrationText(r.integration)}</td>
                  <td className="dim">{r.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showSkips && (
        <section className="fl-skips" aria-label="Horários pulados pela agenda">
          <p className="fl-label">Horários pulados</p>
          {skips.length === 0
            ? <p className="fl-note">Nenhum horário pulado.</p>
            : (
              <ul>
                {skips.map((s) => (
                  <li key={s.key}>
                    <span className="fl-skip-when">{s.when}</span>
                    <span>{s.label}{s.countLabel ? ` (${s.countLabel})` : ''}</span>
                    {s.message && <span className="dim">{s.message}</span>}
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </details>
  );
}
