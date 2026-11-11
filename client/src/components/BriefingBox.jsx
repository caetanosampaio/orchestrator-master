import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { Btn } from './ui.jsx';
import { MAX_BRIEFING, cleanBriefing, briefingProblem, briefingBody, pickMaestro, latestBriefing, briefingStatus, briefingError, mergeMaestros } from '../briefing-view.js';

/**
 * Briefing para o Maestro, no Cockpit (montado pela grade quando há um Maestro rodando no workspace): o usuário escreve o pedido e o FORGE avisa o Maestro, que o lê com get_briefing
 * e conduz o squad. POST /api/maestro/briefing { workspaceId, text, paneId? }; a situação (Na fila, Entregue, Lido pelo Maestro, Falhou) vem do GET /api/maestro que a loja já consulta.
 * Com mais de um Maestro, pede para escolher qual. O texto fica guardado por workspace enquanto a tela está aberta e só é limpo depois de enviado.
 */
export default function BriefingBox({ workspaceId, maestros: local = [], briefings = null }) {
  const [open, setOpen] = useState(true);
  const [texts, setTexts] = useState({}), [panes, setPanes] = useState({}), [sent, setSent] = useState({}), [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false), [extra, setExtra] = useState({}); // extra: Maestros que o servidor listou no 409 many_maestros (a grade pode estar atrasada)
  const sending = useRef(false); // trava síncrona: dois cliques (ou Ctrl+Enter repetido) nunca enviam duas vezes
  const input = useRef(null);
  const text = texts[workspaceId] ?? '', err = errs[workspaceId] ?? null;
  const maestros = mergeMaestros(local, extra[workspaceId]);
  const paneId = pickMaestro(maestros, panes[workspaceId] ?? null);
  const problem = briefingProblem(text, { maestros, paneId });
  const last = latestBriefing(briefings, { workspaceId, id: sent[workspaceId]?.id ?? null, sent: sent[workspaceId] ?? null });
  const st = briefingStatus(last);
  const len = cleanBriefing(text).length;
  const ids = { box: `brf-${workspaceId}`, n: `brf-n-${workspaceId}`, pane: `brf-p-${workspaceId}` };
  const setFor = (setter, v) => setter((m) => ({ ...m, [workspaceId]: v }));

  const send = async () => {
    if (sending.current || problem) return;
    sending.current = true; setBusy(true); setFor(setErrs, null);
    try {
      const r = await api.post('/api/maestro/briefing', briefingBody({ workspaceId, text, paneId: maestros.length > 1 ? paneId : null }));
      if (r?.briefing?.id) setFor(setSent, { ...r.briefing, workspaceId });
      setFor(setTexts, '');
    } catch (e) {
      const x = briefingError(e);
      if (x.choose) { setFor(setPanes, null); setFor(setExtra, x.panes); } // a lista local pode estar atrasada: o servidor manda os Maestros e o seletor aparece já
      setFor(setErrs, x.text);
    } finally { sending.current = false; setBusy(false); input.current?.focus(); } // o foco volta ao campo: com Ctrl+Enter ele não se perde
  };
  const onKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };

  return (
    <section className="oc-brief" aria-label="Briefing para o Maestro">
      <div className="oc-brief-h">
        <button type="button" className="oc-brief-t" aria-expanded={open} aria-controls={ids.box} onClick={() => setOpen((v) => !v)}><i className="hz-caret" aria-hidden="true" />Briefing para o Maestro</button>
        <span className={`oc-brief-st${st ? ` t-${st.tone}` : ''}`} role="status" aria-live="polite" title={st?.hint || undefined}>
          {st ? <>Último briefing: <b>{st.label}</b>{st.note ? <span className="oc-brief-note"> · {st.note}</span> : null}</> : <span className="dim">Nenhum briefing enviado neste workspace.</span>}
        </span>
      </div>
      {open && (
        <div className="oc-brief-b" id={ids.box}>
          <label className="sr" htmlFor={`${ids.box}-t`}>Briefing para o Maestro</label>
          <textarea id={`${ids.box}-t`} ref={input} className="oc-brief-in" rows={3} value={text} maxLength={MAX_BRIEFING} readOnly={busy} aria-busy={busy} aria-describedby={ids.n} onKeyDown={onKey}
            placeholder="O que o squad deve fazer, com o critério de pronto. O Maestro divide e delega sozinho." onChange={(e) => setFor(setTexts, e.target.value)} />
          <div className="oc-brief-f">
            <span className="oc-brief-n" id={ids.n}>{len}/{MAX_BRIEFING} · Ctrl+Enter envia</span>
            {maestros.length > 1 && (
              <span className="oc-brief-p">
                <label htmlFor={ids.pane}>Maestro</label>
                <select id={ids.pane} value={paneId ?? ''} disabled={busy} onChange={(e) => setFor(setPanes, e.target.value || null)}>
                  <option value="">Escolha…</option>
                  {maestros.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </span>
            )}
            <span className="oc-brief-g" />
            {err && <span className="oc-brief-err" role="alert">{err}</span>}
            {!err && text.trim() && problem && <span className="oc-brief-err" role="status">{problem}</span>}
            <Btn kind="primary" disabled={busy || !!problem} onClick={send} title={problem ?? 'Enviar o briefing ao Maestro'}>{busy ? 'Enviando…' : 'Enviar ao Maestro'}</Btn>
          </div>
        </div>
      )}
    </section>
  );
}
