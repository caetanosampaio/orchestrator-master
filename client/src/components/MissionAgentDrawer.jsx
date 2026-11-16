import React, { useEffect, useRef } from 'react';
import '../mission-board.css';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { ActionButton } from './MissionPanel.jsx';
import { ActionSummary } from './MissionNodeDetail.jsx';
import { NODE_STATE_LABEL } from '../missions-view.js';
import { NOT_INFORMED, TIER_LABEL, TIER_NAMES } from '../mission-board.js';

const LEVEL = { verified: ['completed', 'verificada pelo sistema'], failed: ['attention', 'o sistema não confirmou'], inconclusive: ['approval', 'inconclusiva: não vale como concluída'] };
const VSTAT = { pass: ['completed', 'passou'], fail: ['attention', 'falhou'], blocked: ['attention', 'bloqueada'], skipped: ['idle', 'não rodou'], error: ['attention', 'erro'] };
const PIN_OPTIONS = [['auto', 'Automático'], ...TIER_NAMES.map((t) => [t, TIER_LABEL[t]])];

const Fact = ({ k, v }) => <div className="mi-fact"><dt>{k}</dt><dd>{v}</dd></div>;

/**
 * Gaveta do agente da etapa: modelo, esforço, nível e origem, o contexto (instruções, critérios, arquivos, dependências), a evidência e as falhas.
 * Logs e atividade técnica ficam só na seção recolhida "Detalhes técnicos". O seletor "Fixar nível" só existe com a etapa na fila.
 * Fecha com Esc e com o botão; o foco vai para a gaveta ao abrir ou trocar de etapa.
 */
export default function MissionAgentDrawer({ model, onClose, onDecide, onPin, busyAction }) {
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, [model?.id]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!model) return null;
  const m = model, ev = m.evidence, lvl = ev?.level ? LEVEL[ev.level] : null, tech = m.technical;
  const current = m.pin ?? 'auto';
  return (
    <aside id="mb-drawer" className={`mi-drawer mb-drawer st-${m.state}`} role="complementary" aria-label={`Agente da etapa: ${m.title}`}>
      <header className="mi-drawer-head">
        <div className="mi-drawer-top">
          <span className={`mi-badge st-${m.state}`}><i aria-hidden="true" />{m.stateLabel ?? NODE_STATE_LABEL[m.state]}</span>
          <button type="button" ref={closeRef} className="oc-iconbtn" onClick={onClose} aria-label="Fechar detalhes (Esc)" title="Fechar (Esc)"><Icon name="close" size={14} /></button>
        </div>
        <h3>{m.title}</h3>
        <p className="mi-drawer-agent"><ProviderLogo id="claude" size={13} /><span><b>{m.roleLabel}</b> · agente {m.agent.name} · {m.agent.providerLabel}</span></p>
      </header>

      <div className="mi-drawer-body">
        <dl className="mi-facts mb-facts">
          <Fact k="Modelo" v={m.agent.model} />
          <Fact k="Esforço" v={m.agent.effort} />
          <Fact k="Nível" v={`${m.route.tierLabel} · ${m.route.sourceLabel}`} />
          <Fact k="Onda" v={`Onda ${m.wave}`} />
          {m.attempts > 0 && <Fact k="Tentativas" v={String(m.attempts)} />}
        </dl>
        {(m.agent.model === NOT_INFORMED) && <p className="mb-note">O servidor não registrou o modelo desta etapa (missão anterior ao roteamento por nível).</p>}

        {m.canPin ? (
          <fieldset className="mb-pin">
            <legend>Fixar nível</legend>
            <div className="mb-pin-opts" role="group" aria-label="Nível do agente desta etapa">
              {PIN_OPTIONS.map(([v, label]) => (
                <button key={v} type="button" className={`mb-pin-o${current === v ? ' on' : ''}`} aria-pressed={current === v} disabled={busyAction === `pin:${m.id}`} onClick={() => current !== v && onPin(m.id, v)}>{label}</button>
              ))}
            </div>
            <p className="mb-hint">Vale só enquanto a etapa está na fila e vence a escolha do Planner. “Automático” devolve a decisão ao Planner.</p>
          </fieldset>
        ) : (
          m.pin && <p className="mb-hint">Nível fixado por você: {TIER_LABEL[m.pin]}. Não dá para mudar depois que a etapa começa.</p>
        )}

        {m.approval && (
          <div className="mi-detail-appr" role="group" aria-label="Aprovação pendente">
            <strong><Icon name="gate" size={14} /> Esta etapa espera a sua decisão</strong>
            <ActionSummary action={m.approval.action} rules={m.approval.rules} />
            <div className="mi-row-actions">
              <ActionButton kind="primary" icon="checkCircle" busy={busyAction === `approve:${m.approval.id}`} disabled={!m.approval.digest} onClick={() => onDecide({ scope: 'cycle', id: m.approval.id, digest: m.approval.digest, decision: 'approve' })}>Aprovar</ActionButton>
              <ActionButton kind="danger" icon="xCircle" busy={busyAction === `reject:${m.approval.id}`} disabled={!m.approval.digest} onClick={() => onDecide({ scope: 'cycle', id: m.approval.id, digest: m.approval.digest, decision: 'reject' })}>Rejeitar</ActionButton>
            </div>
          </div>
        )}

        {m.errors.length > 0 && <div className="mi-errors" role="alert"><strong><Icon name="xCircle" size={13} /> Falhas registradas</strong><ul>{m.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

        <section className="mi-sec">
          <h4>Contexto da etapa</h4>
          {m.instructions ? <p className="mi-context">{m.instructions}</p> : <p className="dim">O servidor não registrou instruções para esta etapa.</p>}
        </section>

        {m.acceptance.length > 0 && <section className="mi-sec"><h4>Critérios de aceite</h4><ul className="mb-list">{m.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul></section>}
        {m.expectedFiles.length > 0 && <section className="mi-sec"><h4>Arquivos esperados</h4><ul className="mb-list mono">{m.expectedFiles.map((f) => <li key={f}>{f}</li>)}</ul></section>}
        {m.deps.length > 0 && <section className="mi-sec"><h4>Depende de</h4><ul className="mb-list">{m.deps.map((d) => <li key={d.id}>{d.title}</li>)}</ul></section>}

        <section className="mi-sec">
          <h4>Evidência</h4>
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
          {m.files.length > 0 && <details className="mi-fold"><summary>Arquivos alterados ({m.files.length})</summary><ul className="mi-files">{m.files.map((f) => <li key={f} className="mono">{f}</li>)}</ul></details>}
        </section>

        <details className="mi-fold mb-tech">
          <summary>Detalhes técnicos</summary>
          <div className="mb-tech-b">
            {tech.facts.length > 0 && <dl className="mi-facts">{tech.facts.map(([k, v]) => <Fact key={k} k={k} v={v} />)}</dl>}
            <h4 className="mb-tech-h">Atividade do agente (final do log)</h4>
            {tech.activity.length === 0 ? <p className="dim">Nenhuma atividade registrada ainda.</p> : <pre className={`mi-log${m.state === 'working' ? ' live' : ''}`} tabIndex={0} aria-label="Final do log do agente">{tech.activity.join('\n')}</pre>}
          </div>
        </details>
      </div>
    </aside>
  );
}
