import React, { useState } from 'react';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { STATE_META, NODE_STATE_LABEL, missionState, missionProgress, missionDuration, fmtDuration, missionUsage, missionTeam, cycleActions, DASH } from '../missions-view.js';
import { fmtUsd, fmtTokens } from '../usage-view.js';
import { executorSeal } from '../permission-profile.js';

const CYCLE_LABEL = { planning: 'planejando', running: 'em execução', blocked: 'bloqueado', completed: 'concluído', cancelled: 'cancelado', limit_reached: 'no limite de rodadas' };
const fmtDate = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : DASH; };

/** Botão de ação com estado de "ocupado": enquanto a chamada roda mostra o indicador e ignora cliques repetidos. */
export function ActionButton({ kind = '', icon, busy, onClick, children, disabled = false, ...rest }) {
  return (
    <button type="button" className={`mi-btn ${kind ? `mi-btn-${kind}` : ''}${busy ? ' is-busy' : ''}`} onClick={onClick} disabled={busy || disabled} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="mi-spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={13} /> : null}<span>{children}</span>
    </button>
  );
}

/**
 * Faixa de pipeline: um segmento por etapa REAL do workflow, na cor do estado (o que roda agora pisca). Clicar num segmento seleciona a etapa no workflow.
 * Sem etapas ainda, a faixa fica vazia (não se inventa progresso).
 */
function Pipeline({ steps, progress, selectedNode, onSelectNode }) {
  return (
    <div className="mi-pipe">
      <div className="mi-pipe-bar" role="group" aria-label="Etapas da missão">
        {steps.length === 0 ? <span className="mi-seg st-idle empty" aria-hidden="true" /> : steps.map((n, i) => (
          <button key={n.id} type="button" tabIndex={-1} className={`mi-seg st-${n.state}${n.id === selectedNode ? ' on' : ''}`} onClick={() => onSelectNode(n.id)}
            aria-label={`Etapa ${i + 1}: ${n.title}, ${NODE_STATE_LABEL[n.state]}`} title={`${i + 1}. ${n.title} · ${NODE_STATE_LABEL[n.state]}`} />
        ))}
      </div>
      <span className="mi-pipe-t">
        {progress.basis ? <><b>{progress.done}{progress.total ? `/${progress.total}` : ''}</b> {progress.basis}</> : 'sem etapas ainda'}
        {progress.pct !== null && <> · <b>{progress.pct}%</b></>}
      </span>
    </div>
  );
}

const Meter = ({ label, hint, children }) => <div className="mi-meter-c" title={hint}><dt>{label}</dt><dd>{children}</dd></div>;

/** Rodadas, custo e tokens da missão: informação complementar (vai num <details> fechado da página). */
export function MissionMeters({ mission, usage }) {
  const u = missionUsage(usage, mission.id), c = mission.cycle;
  return (
    <dl className="mi-meter">
      <Meter label="Rodadas" hint="Rodadas executadas / limite do ciclo">{c ? <>{(c.rounds ?? []).length}{c.maxIterations ? <span className="dim"> / {c.maxIterations}</span> : null}</> : DASH}</Meter>
      <Meter label="Custo estimado" hint="Estimativa da CLI, não é cobrança. Sem relato = —">{fmtUsd(u.costUsd)}{u.partial && <span className="dim"> parcial</span>}</Meter>
      <Meter label="Tokens" hint="Entrada + saída reportadas pela CLI (cache fora)">{fmtTokens(u.tokens)}{(u.planner !== null || u.executor !== null) && <span className="dim mi-meter-s"> planner {fmtTokens(u.planner)} · executor {fmtTokens(u.executor)}</span>}</Meter>
    </dl>
  );
}

/** Equipe responsável (provedor e modelo reais; sem leitura = "modelo não informado"). */
export function MissionTeam({ mission, sessions, working }) {
  const team = missionTeam(mission, sessions);
  if (!team.length) return <p className="dim mi-none">Sem agentes ainda.</p>;
  return (
    <ul className="mi-team" aria-label="Equipe responsável">
      {team.map((a) => (
        <li key={a.id} className={`mi-agent${a.source === 'ciclo' && working ? ' live' : ''}`} title={`${a.name}: ${a.role} · ${a.providerLabel}${a.model ? ` · ${a.model}` : ' · modelo não informado'}`}>
          <ProviderLogo id={a.provider === 'codex' ? 'codex' : 'claude'} size={12} />
          <b>{a.name}</b><span>{a.providerLabel}</span><span className="mi-agent-m">{a.model ?? 'modelo não informado'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cabeçalho COMPACTO da missão: nome e estado, ações discretas, objetivo resumido, progresso e duração. Custo, tokens e equipe ficam em seções recolhidas. */
export default function MissionPanel({ mission, workspace, now, workflow, selectedNode, onSelectNode, onAction, onOpenTerminals, busyAction }) {
  const [ctxOpen, setCtxOpen] = useState(false);
  const state = missionState(mission), meta = STATE_META[state], progress = missionProgress(mission), dur = missionDuration(mission, now);
  const act = cycleActions(mission), c = mission.cycle;
  const steps = (workflow?.nodes ?? []).filter((n) => n.kind === 'step' || n.kind === 'task'); // etapa do ciclo ou tarefa do Maestro (squad)
  const working = state === 'working';
  const seal = executorSeal(mission, workspace); // perfil do Executor (rodada gravada ou, sem rodada, o atual do workspace)
  return (
    <header className={`mi-head st-${state}`} aria-label={`Missão ${mission.title}`}>
      <div className="mi-head-row">
        <div className="mi-head-id">
          <h2 className="mi-title">{mission.title}</h2>
          <span className={`mi-state st-${state}`}><i aria-hidden="true" />{meta.label}</span>
        </div>
        <div className="mi-actions">
          {act.start && <ActionButton kind="primary" busy={busyAction === 'start'} onClick={() => onAction('start')} title="Inicia o ciclo autônomo: o Planner decide, o Executor age no workspace e o sistema verifica">{c ? 'Novo ciclo' : 'Iniciar'}</ActionButton>}
          {act.resume && <ActionButton kind="primary" busy={busyAction === 'resume'} onClick={() => onAction('resume')} title="Retoma o ciclo para o Planner reavaliar">Retomar</ActionButton>}
          {act.cancel && <ActionButton kind="ghost" busy={busyAction === 'cancel'} onClick={() => onAction('cancel')}>Cancelar</ActionButton>}
          <ActionButton kind="ghost" onClick={() => onOpenTerminals()} title="Abre o Cockpit no workspace desta missão">Terminais</ActionButton>
          {act.remove && <ActionButton kind="ghost" busy={busyAction === 'remove'} onClick={() => onAction('remove')} title="Remover a missão">Remover</ActionButton>}
        </div>
      </div>

      <p className="mi-meta">
        <span title={workspace?.path}>{workspace ? (workspace.displayName || workspace.name) : 'sem workspace'}</span>
        {c && <span>ciclo {CYCLE_LABEL[c.status] ?? c.status}</span>}
        {seal && <span className={`pp-seal pp-seal-${seal.tone}`} title={seal.title} aria-label={`${seal.label}. ${seal.title}`}>{seal.glyph && <b aria-hidden="true">{seal.glyph}</b>}{seal.label}</span>}
        <span>criada {fmtDate(mission.createdAt)}</span>
        <span className="mi-meta-dur">{fmtDuration(dur)}{working && dur !== null && <i className="mi-live" aria-hidden="true" />}</span>
      </p>

      <p className="mi-objective">{mission.objective || <span className="dim">Sem objetivo descrito.</span>}{' '}
        <button type="button" className="mi-link" onClick={() => setCtxOpen((v) => !v)} aria-expanded={ctxOpen}>{ctxOpen ? 'ocultar contexto' : 'contexto'}</button></p>
      {ctxOpen && (
        <dl className="mi-ctx">
          <dt>Workspace</dt><dd className="mono">{workspace?.path ?? DASH}</dd>
          {c?.plan?.rationale && <><dt>Raciocínio do plano</dt><dd>{c.plan.rationale}</dd></>}
          {c?.finalSummary && <><dt>Resumo final</dt><dd>{c.finalSummary}</dd></>}
          <dt>Identificador</dt><dd className="mono">{mission.id}</dd>
        </dl>
      )}

      <Pipeline steps={steps} progress={progress} selectedNode={selectedNode} onSelectNode={onSelectNode} />
    </header>
  );
}
