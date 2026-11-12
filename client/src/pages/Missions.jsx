import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { paneState } from '../env-view.js';
import { buildWorkflow, missionState, nodeDetail, parallelInfo } from '../missions-view.js';
import MissionSidebar from '../components/MissionSidebar.jsx';
import MissionPanel, { MissionMeters, MissionTeam } from '../components/MissionPanel.jsx';
import MissionLiveButton from '../components/MissionLiveButton.jsx';
import MissionWorkflow from '../components/MissionWorkflow.jsx';
import MissionNodeDetail from '../components/MissionNodeDetail.jsx';
import MissionActivity, { ControlBar } from '../components/MissionActivity.jsx';
import NewMissionDialog from '../components/NewMissionDialog.jsx';

const SEL_KEY = 'forge.missions.selected';
const readSel = () => { try { return localStorage.getItem(SEL_KEY) || null; } catch { return null; } };

/** Seção recolhida (fechada por padrão): informação complementar que não precisa ficar sempre à vista. */
const More = ({ title, hint, children }) => (
  <details className="mi-more">
    <summary><span>{title}</span>{hint ? <span className="mi-more-h">{hint}</span> : null}</summary>
    <div className="mi-more-b">{children}</div>
  </details>
);

/**
 * Central de missões: sidebar à esquerda; no centro um cabeçalho compacto e o WORKFLOW como protagonista; a etapa selecionada abre num painel lateral (drawer).
 * Atividade geral, custo/tokens e equipe ficam em seções recolhidas. Tudo vem do servidor (/api/missions, ciclo autônomo, /api/state.usage, terminais, Maestro, atividade): nada é simulado.
 */
export default function Missions({ onOpenCockpit, data }) {
  const { missions, failed, refresh } = data; // lido uma vez no App (também alimenta o indicador do botão Missions)
  const { workspaces, state, terminals, maestro, workingIds, activity, notify, refresh: refreshStore } = useStore();
  const [selectedId, setSelectedId] = useState(readSel), [nodeId, setNodeId] = useState(null), [newOpen, setNewOpen] = useState(false), [busy, setBusy] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const list = missions ?? [];
  // Sem seleção válida: a missão que mais pede você (aprovação > atenção > trabalhando), senão a primeira.
  useEffect(() => {
    if (missions === null) return;
    if (selectedId && list.some((m) => m.id === selectedId)) return;
    const pick = ['approval', 'attention', 'working'].map((s) => list.find((m) => missionState(m) === s)).find(Boolean) ?? list[0] ?? null;
    setSelectedId(pick?.id ?? null); setNodeId(null); // outra missão: o detalhe da etapa anterior não "gruda"
  }, [missions, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = useCallback((id) => { setSelectedId(id); setNodeId(null); try { localStorage.setItem(SEL_KEY, id); } catch { /* só conveniência */ } }, []);

  const mission = list.find((m) => m.id === selectedId) ?? null;
  const mstate = mission ? missionState(mission) : 'idle';
  useEffect(() => { // o relógio só corre enquanto a missão está ativa (duração ao vivo)
    if (mstate !== 'working') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mstate, selectedId]);

  const workspace = mission ? workspaces.find((w) => w.id === mission.workspaceId) ?? null : null;
  const sessions = terminals?.sessions ?? [];
  const wf = useMemo(() => (mission ? buildWorkflow(mission, { sessions, maestro }) : null), [mission, sessions, maestro]);
  const detail = useMemo(() => (mission && nodeId ? nodeDetail(mission, nodeId, { sessions, maestro, activity }) : null), [mission, nodeId, sessions, maestro, activity]);
  const par = wf ? parallelInfo(wf) : null;
  const stateOf = useCallback((s) => paneState(s, workingIds), [workingIds]);
  useEffect(() => { if (nodeId && wf && !wf.nodes.some((n) => n.id === nodeId)) setNodeId(null); }, [wf, nodeId]);
  const closeDetail = useCallback(() => setNodeId(null), []);

  const run = useCallback(async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) notify(ok); } catch (e) { notify(e.message, 'error'); } finally { setBusy(null); refresh(); refreshStore(); }
  }, [notify, refresh, refreshStore]);

  const onAction = (what) => {
    if (!mission) return;
    const id = mission.id;
    if (what === 'start') return run('start', () => api.post(`/api/missions/${id}/cycle/start`, {}), 'Ciclo iniciado.');
    if (what === 'resume') return run('resume', () => api.post(`/api/missions/${id}/cycle/resume`, {}), 'Ciclo retomado.');
    if (what === 'cancel') { if (!window.confirm('Cancelar o ciclo? A rodada em andamento é interrompida e o ciclo não segue.')) return undefined; return run('cancel', () => api.post(`/api/missions/${id}/cycle/cancel`, {}), 'Ciclo cancelado.'); }
    if (what === 'remove') { if (!window.confirm(`Remover a missão “${mission.title}”? O histórico dela deixa de aparecer.`)) return undefined; return run('remove', () => api.del(`/api/missions/${id}`), 'Missão removida.'); }
    return undefined;
  };
  const onDecide = ({ scope, id, digest, decision }) => {
    if (!mission) return undefined;
    const verb = decision === 'approve' ? 'Aprovada' : 'Rejeitada';
    if (scope === 'task') return run(`${decision}:${id}`, () => api.post(`/api/missions/${mission.id}/tasks/${id}/${decision}`, {}), `${verb}.`);
    return run(`${decision}:${id}`, () => api.post(`/api/missions/${mission.id}/cycle/approvals/${id}`, { decision, digest }), `${verb}.`);
  };
  // Abre o Cockpit no workspace da missão. O terminal só vai junto quando é um id (os botões podem repassar o evento de clique, que não conta).
  const openTerminals = (terminalId) => onOpenCockpit(mission?.workspaceId ?? null, typeof terminalId === 'string' ? terminalId : null);

  return (
    <div className={`mi-page${detail ? ' has-drawer' : ''}`}>
      <MissionSidebar missions={missions} workspaces={workspaces} selectedId={selectedId} onPick={select} onNew={() => setNewOpen(true)} failed={failed} />
      <div className="mi-main">
        {!mission ? (
          <div className="mi-blank">
            <p className="mi-kicker"><i aria-hidden="true" /><span>Missions</span></p>
            <h2>Central de missões</h2>
            <p>{missions === null ? 'Carregando…' : 'Escolha uma missão na lista ou crie uma nova. Aqui você acompanha o workflow, aprova o que pede decisão e vê os agentes trabalhando.'}</p>
            {missions !== null && (
              <ol className="mi-how">
                <li><b>01</b><span>Objetivo</span><p>Você descreve o que deve ficar pronto e em qual workspace.</p></li>
                <li><b>02</b><span>Ciclo</span><p>O Planner divide em etapas, o Executor faz uma por vez e o sistema verifica.</p></li>
                <li><b>03</b><span>Entrega</span><p>Só conclui com evidência verificada. O que precisar de você para aqui.</p></li>
              </ol>
            )}
            {missions !== null && <button type="button" className="mi-btn mi-btn-primary" onClick={() => setNewOpen(true)}>Nova missão</button>}
          </div>
        ) : (
          <div className="mi-center">
            <MissionPanel mission={mission} workspace={workspace} now={now} workflow={wf} selectedNode={nodeId} onSelectNode={setNodeId} onAction={onAction} onOpenTerminals={openTerminals} busyAction={busy} />
            <MissionLiveButton key={mission.id} mission={mission} />
            <ControlBar mission={mission} workflow={wf} onDecide={onDecide} busyAction={busy} onSelectNode={setNodeId} />
            <section className={`mi-flow st-${mstate}`} aria-label="Workflow da missão">
              <header className="mi-flow-head">
                <h3 className="mi-kicker"><i aria-hidden="true" /><span>Workflow</span></h3>
                {par && <span className="mi-flow-sum">{par.phases} {par.phases === 1 ? 'fase' : 'fases'} · {par.steps} {par.steps === 1 ? 'etapa' : 'etapas'}{par.running > 0 ? ` · ${par.running} em execução` : ''}{par.queued > 0 ? ` · ${par.queued} na fila` : ''}</span>}
              </header>
              <MissionWorkflow key={mission.id} workflow={wf} selectedId={nodeId} onSelect={(id) => setNodeId((cur) => (cur === id ? cur : id))} now={now} />
            </section>
            <div className="mi-extras">
              <More title="Atividade geral" hint="linha do tempo, tarefas e terminais"><MissionActivity mission={mission} workflow={wf} activity={activity} sessions={sessions} stateOf={stateOf} onSelectNode={setNodeId} onOpenTerminals={openTerminals} /></More>
              <More title="Custo e tokens" hint="rodadas e consumo estimado"><MissionMeters mission={mission} usage={state?.usage} /></More>
              <More title="Equipe" hint="agentes, provedor e modelo"><MissionTeam mission={mission} sessions={sessions} working={mstate === 'working'} /></More>
            </div>
          </div>
        )}
      </div>
      {detail && <MissionNodeDetail detail={detail} onClose={closeDetail} onDecide={onDecide} busyAction={busy} onOpenTerminals={openTerminals} />}
      {newOpen && (
        <NewMissionDialog workspaces={workspaces} activeWorkspaceId={state?.activeWorkspace?.id ?? null} onClose={() => setNewOpen(false)}
          onCreated={(m, note) => { setNewOpen(false); select(m.id); notify(note ?? 'Missão criada.', note ? 'error' : 'info'); refresh(); refreshStore(); }} />
      )}
    </div>
  );
}
