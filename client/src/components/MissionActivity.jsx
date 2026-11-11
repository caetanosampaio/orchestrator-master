import React, { useState } from 'react';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { ActionButton } from './MissionPanel.jsx';
import { ActionSummary } from './MissionNodeDetail.jsx';
import { controlItems, missionFeed, missionTeam, nodeIdForTask } from '../missions-view.js';
import { taskTone, taskLabel } from '../op-state.js';

const hhmm = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; };

/**
 * Faixa de controle: o que pede VOCÊ agora (aprovações pendentes do ciclo e das tarefas manuais, falha ou bloqueio). Só aparece quando há algo; pulsa em âmbar/vermelho.
 * A aprovação do ciclo exige o `digest` da ação mostrada: o servidor recusa se a ação mudou desde a solicitação.
 */
export function ControlBar({ mission, onDecide, busyAction, onSelectNode, workflow }) {
  const items = controlItems(mission), wf = workflow ?? null; // sem `workflow` não há "ver etapa" (nunca se remonta um grafo sem o contexto do squad); as aprovações continuam visíveis
  if (!items.length) return null;
  return (
    <section className="mi-control" aria-label="Pede a sua atenção" role="alert">
      {items.map((it) => (
        <article key={`${it.kind}:${it.id}`} className={`mi-ctl ${it.kind === 'approval' ? 'st-approval' : it.kind === 'resume' ? 'st-working' : 'st-attention'}`}>
          <p className="mi-kicker"><i aria-hidden="true" /><span>{it.kind === 'approval' ? 'Gate · aprovação' : it.kind === 'resume' ? 'Gate · decidido' : 'Bloqueio'}</span></p>
          <strong className="mi-ctl-t">{it.title}</strong>
          {it.detail && <p>{it.detail}</p>}
          {it.kind === 'approval' && it.scope === 'cycle' && <details className="mi-fold"><summary>Detalhes da ação que será liberada</summary><ActionSummary action={it.action} rules={it.rules} /></details>}
          {it.kind === 'approval' && (
            <div className="mi-row-actions">
              <ActionButton kind="primary" busy={busyAction === `approve:${it.id}`} disabled={it.scope === 'cycle' && !it.digest} onClick={() => onDecide({ scope: it.scope, id: it.id, digest: it.digest, decision: 'approve' })}>Aprovar</ActionButton>
              <ActionButton busy={busyAction === `reject:${it.id}`} disabled={it.scope === 'cycle' && !it.digest} onClick={() => onDecide({ scope: it.scope, id: it.id, digest: it.digest, decision: 'reject' })}>Rejeitar</ActionButton>
              {it.scope === 'task' && nodeIdForTask(wf, it.id) && <button type="button" className="mi-link" onClick={() => onSelectNode(nodeIdForTask(wf, it.id))}>ver etapa</button>}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

/** Área inferior: Atividade (linha do tempo real de /api/activity), Tarefas e Terminais do workspace (com o estado real de cada agente). */
export default function MissionActivity({ mission, activity, sessions, stateOf, onSelectNode, onOpenTerminals, workflow }) {
  const [tab, setTab] = useState('feed');
  const feed = missionFeed(activity, mission.id), tasks = mission.tasks ?? [], team = missionTeam(mission, sessions, { stateOf }).filter((a) => a.source === 'terminal');
  const wf = workflow ?? null;
  if (!wf) return null; // o workflow vem da página (com sessões e Maestro): sem ele não se desenha um grafo divergente
  const tabs = [['feed', 'Atividade', feed.length], ['tasks', 'Tarefas', tasks.length], ['terms', 'Terminais', team.length]];
  return (
    <div className="mi-activity">
      <div className="mi-tabs" role="tablist" aria-label="Atividade da missão">
        {tabs.map(([id, label, n]) => (
          <button key={id} type="button" role="tab" id={`mi-tab-${id}`} aria-selected={tab === id} aria-controls={`mi-pane-${id}`} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}{n > 0 && <span className="oc-n">{n}</span>}</button>
        ))}
      </div>
      <div className="mi-pane" role="tabpanel" id={`mi-pane-${tab}`} aria-labelledby={`mi-tab-${tab}`} tabIndex={0}>
        {tab === 'feed' && (feed.length === 0 ? <p className="dim">Nenhuma atividade registrada para esta missão.</p> : (
          <ol className="mi-feed">{feed.map((f, i) => <li key={f.id ?? i} className={i === 0 ? 'new' : ''}><time>{hhmm(f.at)}</time><span className="mi-feed-t">{f.type}</span>{f.agent && <span className="mi-feed-a">{f.agent}</span>}<span>{f.message}</span></li>)}</ol>
        ))}
        {tab === 'tasks' && (tasks.length === 0 ? <p className="dim">Sem tarefas ainda: o Planner as cria a cada rodada.</p> : (
          <ul className="mi-tasks">
            {tasks.map((t) => {
              const tone = taskTone(t.status), node = nodeIdForTask(wf, t.id);
              return (
                <li key={t.id} className={`tone-${tone}`}>
                  <i aria-hidden="true" /><span className="mi-task-t">{t.title}</span><span className="mi-task-s">{taskLabel(t)}</span>
                  {t.blockedReason && <span className="mi-task-b dim" title={t.blockedReason}>bloqueada</span>}
                  {node && <button type="button" className="mi-link" onClick={() => onSelectNode(node)}>ver no workflow</button>}
                </li>
              );
            })}
          </ul>
        ))}
        {tab === 'terms' && (
          <>
            {team.length === 0 ? <p className="dim">Nenhum terminal aberto neste workspace.</p> : (
              <ul className="mi-terms">
                {team.map((a) => (
                  <li key={a.id} className={`ag-${a.state ?? 'none'}`}>
                    <ProviderLogo id={a.provider === 'codex' ? 'codex' : 'claude'} size={13} /><b>{a.name}</b><span className="dim">{a.providerLabel} · {a.model ?? 'modelo não informado'}</span>
                    <span className="mi-term-s">{a.state ? ({ working: 'trabalhando', waiting: 'aguardando você', done: 'terminou', failed: 'falhou', idle: 'ocioso' }[a.state] ?? a.state) : 'sem leitura'}</span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="mi-btn" onClick={() => onOpenTerminals()}><Icon name="cockpit" size={14} /><span>Abrir no Cockpit</span></button>
          </>
        )}
      </div>
    </div>
  );
}
