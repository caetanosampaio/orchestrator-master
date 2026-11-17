import React, { useState } from 'react';
import { useFlowRuns } from '../use-flows.js';
import { historyRows, fmtDuration, fmtWhen } from '../flows-view.js';

/** Histórico dos runs em <details> fechado por padrão; só consulta o servidor enquanto está aberto. */
export default function FlowRuns({ flow, now }) {
  const [open, setOpen] = useState(false);
  const { runs, failure } = useFlowRuns(flow.id, { enabled: open, key: `${flow.lastRun?.id ?? ''}:${flow.lastRun?.status ?? ''}:${flow.activeRun?.id ?? ''}` });
  const rows = runs ? historyRows(runs, flow, { now }) : [];
  return (
    <details className="fl-runs" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Histórico de execuções</summary>
      {failure && <p className="fl-note err" role="status">{failure.message}</p>}
      {!failure && open && runs === null && <p className="fl-note" role="status">Carregando…</p>}
      {runs && rows.length === 0 && <p className="fl-note">Nenhuma execução ainda.</p>}
      {rows.length > 0 && (
        <table className="fl-runs-t">
          <thead><tr><th scope="col">Início</th><th scope="col">Estado</th><th scope="col">Etapas</th><th scope="col">Duração</th><th scope="col">Motivo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtWhen(r.startedAt)}</td>
                <td><span className={`fl-state fl-t-${r.tone}`}><i aria-hidden="true" />{r.label}</span></td>
                <td>{r.progress}</td>
                <td>{fmtDuration(r.durationMs)}</td>
                <td className="dim">{r.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
