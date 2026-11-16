import React, { useState } from 'react';
import '../mission-board.css';
import { ActionButton } from './MissionPanel.jsx';
import { acceptanceBody } from '../mission-board.js';

/** Aceitação HUMANA e explícita de uma conclusão sem evidência verificada (só evidência inconclusiva; nunca automática). O servidor exige o motivo e `confirm: true`. */
function Acceptance({ offer, onAccept, busy }) {
  const [reason, setReason] = useState(''), [ok, setOk] = useState(false);
  const body = acceptanceBody(offer, reason);
  return (
    <details className="mb-accept mi-fold">
      <summary>Aceitar a conclusão sem evidência verificada</summary>
      <div className="mb-accept-b">
        <p>O sistema não conseguiu confirmar a última rodada ({(offer.reasons ?? []).join('; ') || 'evidência inconclusiva'}). Você pode aceitar o resultado por sua conta e risco: a entrega fica marcada como <b>autodeclarada</b>, nunca como verificada.</p>
        <label className="mb-field">Motivo da aceitação <span className="dim">(10 a 500 caracteres)</span>
          <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="mb-check-l"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>Entendo que isto é uma decisão minha e que o resultado não foi verificado pelo sistema.</span></label>
        <div className="mi-row-actions"><ActionButton kind="danger" busy={busy} disabled={!body || !ok} onClick={() => onAccept(body)}>Aceitar sem evidência</ActionButton></div>
      </div>
    </details>
  );
}

/** Entrega: garantia (verificada ou autodeclarada), resumo final, arquivos e a aceitação sem evidência. Antes de terminar mostra só uma linha. */
export default function MissionDelivery({ delivery, onAccept, busyAction }) {
  const d = delivery;
  return (
    <section className="mb-sec mb-delivery" aria-labelledby="mb-del-h">
      <header className="mb-sec-h">
        <h3 className="mi-kicker" id="mb-del-h"><i aria-hidden="true" /><span>Entrega</span></h3>
        {d.assuranceLabel && <span className={`mb-assure t-${d.assuranceTone ?? 'none'}`}>{d.assuranceLabel}</span>}
      </header>
      {d.state === 'ready' ? (
        <div className="mb-del-body">
          {d.assuranceHint && <p className="mb-note">{d.assuranceHint}</p>}
          {d.closedByLabel && <p className="mb-note">{d.closedByLabel}</p>}
          {d.summary ? <div className="mb-sub"><h4>Resumo final</h4><p className="mb-summary">{d.summary}</p></div> : <p className="mb-note">O ciclo não registrou um resumo final.</p>}
          {d.files.length > 0 && (
            <details className="mi-fold mb-files" open>
              <summary>Arquivos alterados ({d.files.length})</summary>
              <ul>{d.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul>
            </details>
          )}
        </div>
      ) : (
        <p className="mb-note">{d.state === 'cancelled' ? 'A missão foi cancelada: não há entrega.' : d.state === 'blocked' ? 'A missão está parada: a entrega só existe depois que ela terminar.' : 'A entrega aparece aqui quando a missão terminar.'}</p>
      )}
      {d.offer && onAccept && <Acceptance offer={d.offer} onAccept={onAccept} busy={busyAction === 'accept'} />}
    </section>
  );
}
