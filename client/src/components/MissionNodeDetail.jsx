import React, { useEffect, useRef } from 'react';
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

/**
 * Painel lateral (drawer à direita) da etapa selecionada: contexto, falhas, atividade (final do log do agente), aprovação e evidências do SISTEMA
 * (separadas do que o agente declarou). Fecha com Esc e com o botão. Lê o contrato de `nodeDetail` de forma defensiva (campos ausentes = vazio, nada inventado).
 * `onOpenTerminals(terminalId)`: o Cockpit hoje só abre o workspace; o id do terminal é repassado para quando ele souber focar.
 */
export default function MissionNodeDetail({ detail, onClose, onDecide, busyAction, onOpenTerminals }) {
  const closeRef = useRef(null);
  const nodeKey = detail?.id ?? detail?.nodeId ?? detail?.title ?? null;
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [nodeKey]); // abrir ou trocar de etapa leva o foco para o painel (teclado e leitor de tela)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!detail) return null;
  const { agent, state } = detail, ev = detail.evidence ?? null, lvl = ev?.level ? LEVEL[ev.level] : null;
  const facts = detail.facts ?? [], errors = detail.errors ?? [], activity = detail.activity ?? [], acceptance = detail.acceptance ?? [], files = detail.files ?? [];
  const context = detail.context ?? null, terminalId = detail.terminalId ?? null;
  return (
    <aside className={`mi-drawer st-${state}`} role="complementary" aria-label={`Detalhes: ${detail.title}`}>
      <header className="mi-drawer-head">
        <div className="mi-drawer-top">
          <span className={`mi-badge st-${state}`}><i aria-hidden="true" />{NODE_STATE_LABEL[state]}</span>
          <button type="button" ref={closeRef} className="oc-iconbtn" onClick={onClose} aria-label="Fechar detalhes (Esc)" title="Fechar (Esc)"><Icon name="close" size={14} /></button>
        </div>
        <h3>{detail.title}</h3>
        {agent && (
          <p className="mi-drawer-agent">
            <ProviderLogo id={agent.provider === 'codex' ? 'codex' : 'claude'} size={13} />
            <span><b>{agent.name}</b> · {agent.providerLabel} · <span className="dim">{agent.model ?? 'modelo não informado'}</span>{agent.effort ? <span className="dim"> · esforço {agent.effort}</span> : null}</span>
          </p>
        )}
        <div className="mi-drawer-act">
          <ActionButton icon="cockpit" onClick={() => onOpenTerminals(terminalId)} title={terminalId ? 'Abre o Cockpit no workspace da missão (o foco direto neste terminal ainda não é suportado)' : 'Abre o Cockpit no workspace da missão'}>{terminalId ? 'Abrir o terminal' : 'Abrir terminais'}</ActionButton>
        </div>
      </header>

      <div className="mi-drawer-body">
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

        {detail.kind === 'task' && state === 'approval' && !detail.approval && (
          <div className="mi-detail-appr" role="group" aria-label="Aprovação pendente no Cockpit">
            <strong><Icon name="gate" size={14} /> Esta tarefa espera a sua aprovação no Cockpit</strong>
            <div className="mi-row-actions">
              <ActionButton icon="cockpit" onClick={() => onOpenTerminals(terminalId)}>Abrir o Cockpit</ActionButton>
            </div>
          </div>
        )}

        {errors.length > 0 && <div className="mi-errors" role="alert"><strong><Icon name="xCircle" size={13} /> Falhas registradas</strong><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

        {context && <section className="mi-sec"><h4>Contexto</h4><p className="mi-context">{context}</p></section>}

        {facts.length > 0 && <dl className="mi-facts">{facts.map(([k, v]) => <Fact key={k} k={k} v={v} />)}</dl>}

        {!context && detail.instructions && <details className="mi-fold"><summary>Instruções da etapa</summary><p>{detail.instructions}</p></details>}
        {acceptance.length > 0 && <details className="mi-fold"><summary>Critérios de aceite ({acceptance.length})</summary><ul>{acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}

        <section className="mi-sec">
          <h4>Atividade</h4>
          {activity.length === 0
            ? <p className="dim">Nenhuma atividade registrada ainda.</p>
            : <pre className={`mi-log${state === 'working' ? ' live' : ''}`} tabIndex={0} aria-label="Final do log do agente">{activity.join('\n')}</pre>}
        </section>

        <section className="mi-sec">
          <h4>Evidências</h4>
          {!ev ? <p className="dim">Sem relatório de rodada: nada foi comprovado ainda.</p> : (
            <>
              {lvl && <p className={`mi-evlevel st-${lvl[0]}`}><i aria-hidden="true" />{lvl[1]}</p>}
              {(ev.reasons ?? []).length > 0 && <ul className="mi-reasons">{ev.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {(ev.verifications ?? []).length > 0 && (
                <ul className="mi-verifs" aria-label="Verificações reais do sistema">
                  {ev.verifications.map((v, i) => { const [st, label] = VSTAT[v.status] ?? ['idle', v.status]; return <li key={i} className={`st-${st}`}><i aria-hidden="true" /><span>{v.id}</span><span className="dim">{label}</span>{v.command && <code>{v.command}</code>}</li>; })}
                </ul>
              )}
              {ev.summary && <details className="mi-fold"><summary>O que o agente declarou (não é prova)</summary><p>{ev.summary}</p></details>}
            </>
          )}
          {files.length > 0 && <details className="mi-fold" open><summary>Arquivos alterados ({files.length})</summary><ul className="mi-files">{files.map((f) => <li key={f} className="mono">{f}</li>)}</ul></details>}
        </section>
      </div>
    </aside>
  );
}
