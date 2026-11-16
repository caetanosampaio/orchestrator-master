import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../mission-board.css';
import { api } from '../api.js';
import { ActionButton } from './MissionPanel.jsx';
import { RouteChips } from './MissionStepCard.jsx';
import { approveBody, briefingState, proposalBoard } from '../mission-board.js';

const MAX_TEXT = 2000; // mesmo limite de uma mensagem no servidor (chat.js)
const POLL_MS = 3000;

/** Plano proposto, em ondas, com papel, nível e modelo/esforço de cada etapa (rota resolvida no servidor; ausente = "não informado"). */
function Proposal({ proposal, tiers }) {
  const pb = proposalBoard(proposal, { tiers });
  if (!pb.steps.length) return <p className="mb-note">As etapas serão definidas pelo Planner depois da aprovação (esta proposta não traz o plano pronto).</p>;
  return (
    <ol className="mb-waves mb-waves-p">
      {pb.waves.map((w) => (
        <li key={w.n} className="mb-wave w-pending out-idle">
          <div className="mb-rail" aria-hidden="true"><span className="mb-wave-node">{w.n}</span><span className="mb-line" /></div>
          <div className="mb-wave-body">
            <h4 className="mb-wave-h"><span>{w.label}</span>{w.parallel > 1 && <span className="mb-par">{w.parallel} em paralelo</span>}</h4>
            <ul className="mb-cards">
              {w.steps.map((s) => (
                <li key={s.id} className="mb-card mb-card-p st-idle">
                  <div className="mb-card-static">
                    <span className="mb-card-top"><span className="mb-role">{s.roleLabel}</span></span>
                    <span className="mb-card-title">{s.title}</span>
                    <RouteChips route={s.route} />
                    {s.policyNote && <span className={`mb-policy${s.blocked ? ' bad' : ''}`}>{s.policyNote}</span>}
                    {s.acceptance.length > 0 && <details className="mi-fold"><summary>Critérios de aceite ({s.acceptance.length})</summary><ul>{s.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Conversa de briefing (/api/chat): o cliente descreve o que precisa; o FORGE pergunta, propõe o plano e só executa depois da aprovação. */
function BriefingChat({ tiers, hasMission, onApproved, onManual, onCancel, notify }) {
  const [view, setView] = useState(null), [loadError, setLoadError] = useState(null), [text, setText] = useState('');
  const [sending, setSending] = useState(false), [error, setError] = useState(null), [busyKey, setBusyKey] = useState(null);
  const logRef = useRef(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try { const v = await api.get('/api/chat'); if (alive.current) { setView(v); setLoadError(null); } } catch (e) { if (alive.current) setLoadError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { // o servidor ocupado (outra conversa ou aprovação em curso): relê até liberar
    if (!view?.busy || sending) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [view?.busy, sending, load]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [view?.messages?.length, sending]);

  const s = briefingState(view, { sending });
  const call = async (key, fn) => {
    setError(null); setBusyKey(key);
    try { return await fn(); } catch (e) { if (alive.current) { setError(e.message); load(); } return null; } finally { if (alive.current) setBusyKey(null); }
  };
  const send = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !s.canSend) return;
    setSending(true); setError(null);
    try { const v = await api.post('/api/chat/message', { text: t }); if (alive.current) { setView(v); setText(''); } } catch (err) { if (alive.current) { setError(err.message); load(); } } finally { if (alive.current) setSending(false); }
  };
  const approve = () => call('approve', async () => {
    const body = approveBody(view);
    if (!body) throw new Error('O plano tem mais etapas do que o limite de rodadas permite. Peça um plano menor.');
    const r = await api.post('/api/chat/approve', body);
    notify?.('Plano aprovado: a missão foi criada e o ciclo começou.');
    onApproved(r?.missionId ?? null);
    return r;
  });
  const discard = () => call('discard', async () => { setView(await api.post('/api/chat/discard', { proposalId: view.proposal.id })); });
  const reset = () => { if (window.confirm('Começar uma nova conversa? O histórico desta conversa será apagado (o consumo já gasto continua registrado).')) call('reset', async () => { setView(await api.post('/api/chat/reset', {})); setText(''); }); };

  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(e); };

  return (
    <section className="mb-sec mb-brief" aria-labelledby="mb-brief-h">
      <header className="mb-sec-h">
        <h3 className="mi-kicker" id="mb-brief-h"><i aria-hidden="true" /><span>{hasMission ? 'Nova missão' : 'Briefing'}</span></h3>
        {hasMission && <button type="button" className="mi-link" onClick={onCancel}>voltar à missão</button>}
      </header>
      <p className="mb-lead">Conte o que você precisa, com suas palavras. O FORGE faz perguntas se faltar algo, monta um plano em etapas e escolhe o modelo e o esforço de cada agente. Nada roda até você aprovar o plano.</p>

      {loadError && !view && <p className="mi-note err" role="alert">Não foi possível abrir a conversa: {loadError} <button type="button" className="mi-link" onClick={load}>tentar de novo</button></p>}
      {!view && !loadError && <p className="mi-note" role="status">Carregando a conversa…</p>}

      {view && (
        <>
          <p className="mb-ws">
            <span className="mb-ws-k">Workspace ativo</span>
            {s.workspace ? <b>{s.workspace.name}</b> : <span className="mb-na">nenhum</span>}
            <span className="mb-ws-h">{s.workspaceProblem ? '' : 'É nele que os agentes vão trabalhar. Se não for este, troque o workspace ativo na barra lateral do app antes de enviar.'}</span>
          </p>
          {s.workspaceProblem && <p className="mi-note err" role="alert">{s.workspaceProblem}</p>}

          {s.messages.length > 0 && (
            <ol className="mb-log" ref={logRef} role="log" aria-label="Conversa de briefing" aria-live="polite" tabIndex={0}>
              {s.messages.map((m, i) => (
                <li key={m.id ?? i} className={`mb-msg ${m.role === 'user' ? 'me' : 'ai'}`}>
                  <span className="mb-who">{m.role === 'user' ? 'Você' : 'FORGE'}</span>
                  <p>{m.text}</p>
                  {Array.isArray(m.questions) && m.questions.length > 0 && <ul>{m.questions.map((q, j) => <li key={j}>{q}</li>)}</ul>}
                </li>
              ))}
              {s.busy && <li className="mb-msg ai mb-typing" role="status"><span className="mb-who">FORGE</span><p>Analisando o pedido<i aria-hidden="true" /></p></li>}
            </ol>
          )}

          {s.approving && <p className="mi-note" role="status">Plano aprovado: criando a missão e iniciando o ciclo…</p>}

          {s.proposal && (
            <article className="mb-proposal" aria-label="Plano proposto">
              <p className="mi-kicker"><i aria-hidden="true" /><span>Plano proposto{(s.proposal.revision ?? 1) > 1 ? ` · revisão ${s.proposal.revision}` : ''}</span></p>
              <h4 className="mb-prop-t">{s.proposal.title}</h4>
              {s.proposal.objective && <p className="mb-prop-o">{s.proposal.objective}</p>}
              {s.proposal.changes && <p className="mb-note">O que mudou: {s.proposal.changes}</p>}
              <Proposal proposal={s.proposal} tiers={tiers} />
              <div className="mi-row-actions">
                <ActionButton kind="primary" icon="play" busy={busyKey === 'approve'} disabled={!s.canApprove} onClick={approve}>Aprovar e iniciar</ActionButton>
                <ActionButton kind="ghost" busy={busyKey === 'discard'} disabled={!s.canApprove} onClick={discard}>Descartar</ActionButton>
              </div>
              <p className="mb-hint">Para ajustar o plano, escreva abaixo o que mudar: o FORGE devolve uma nova versão para você aprovar.</p>
            </article>
          )}

          <form className="mb-compose" onSubmit={send}>
            <label htmlFor="mb-text" className="mb-compose-l">{s.messages.length ? 'Responder ou pedir ajustes' : 'O que você precisa?'}</label>
            <textarea id="mb-text" value={text} maxLength={MAX_TEXT} rows={s.messages.length ? 3 : 5} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={!s.canSend && !sending}
              placeholder="Ex.: o login com Google está falhando em produção; quero corrigir e cobrir com testes." />
            <div className="mb-compose-f">
              <span className="mb-count">{text.length}/{MAX_TEXT} · Ctrl+Enter envia</span>
              <ActionButton kind={s.proposal ? '' : 'primary'} icon="send" type="submit" busy={sending} disabled={!text.trim() || !s.canSend}>Enviar</ActionButton>
            </div>
            {error && <p className="mi-note err" role="alert">{error}</p>}
          </form>

          <p className="mb-alt">
            {s.canReset && <><button type="button" className="mi-link" onClick={reset}>começar uma nova conversa</button> · </>}
            <button type="button" className="mi-link" onClick={onManual} title="Cria a missão só com título e objetivo, sem revisar o plano antes; o Planner monta o plano quando o ciclo começar">criar sem plano</button>
          </p>
        </>
      )}
      {!view && loadError && <p className="mb-alt"><button type="button" className="mi-link" onClick={onManual}>criar sem plano</button></p>}
    </section>
  );
}

/**
 * Briefing. Sem `mission` (ou em "Nova missão"): a conversa. Com `mission`: um bloco RECOLHIDO com o objetivo que o FORGE recebeu (e o que ficou confirmado/suposto no briefing).
 */
export default function MissionBriefing({ mission = null, composing = false, ...chat }) {
  if (mission && !composing) {
    const b = mission.brief ?? null, list = (x) => (Array.isArray(x) ? x.filter((i) => typeof i === 'string' && i.trim()) : []);
    const confirmed = list(b?.confirmed), assumptions = list(b?.assumptions);
    return (
      <details className="mb-sec mb-brief-done">
        <summary><span className="mi-kicker"><i aria-hidden="true" /><span>Briefing</span></span><span className="mb-brief-obj">{mission.objective || 'Sem objetivo descrito.'}</span></summary>
        <div className="mb-brief-b">
          <p className="mb-brief-full">{mission.objective || 'Sem objetivo descrito.'}</p>
          {confirmed.length > 0 && <><h4>Confirmado por você</h4><ul className="mb-list">{confirmed.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
          {assumptions.length > 0 && <><h4>Suposições do FORGE</h4><ul className="mb-list">{assumptions.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
        </div>
      </details>
    );
  }
  return <BriefingChat hasMission={!!mission} {...chat} />;
}
