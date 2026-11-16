import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../mission-board.css';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { missionState } from '../missions-view.js';
import { buildBoard, drawerModel, pinBody, pinUrl, TIER_LABEL } from '../mission-board.js';
import MissionSidebar from '../components/MissionSidebar.jsx';
import MissionPanel from '../components/MissionPanel.jsx';
import MissionLiveButton from '../components/MissionLiveButton.jsx';
import MissionBriefing from '../components/MissionBriefing.jsx';
import MissionBoard, { MissionAttention } from '../components/MissionBoard.jsx';
import MissionProgress from '../components/MissionProgress.jsx';
import MissionDelivery from '../components/MissionDelivery.jsx';
import MissionAgentDrawer from '../components/MissionAgentDrawer.jsx';
import NewMissionDialog from '../components/NewMissionDialog.jsx';

const SEL_KEY = 'forge.missions.selected';
const readSel = () => { try { return localStorage.getItem(SEL_KEY) || null; } catch { return null; } };

/**
 * Central de missões, de CIMA PARA BAIXO: sidebar à esquerda; no centro, uma coluna com o cabeçalho, o briefing, o plano por ondas, o progresso e a entrega.
 * Clicar numa etapa abre a gaveta do agente (modelo, esforço, contexto; logs só em "Detalhes técnicos"). Tudo vem do servidor (/api/missions, /api/chat,
 * /api/state): nada é simulado; o que o servidor não informa aparece como "não informado". Sem missão selecionada (ou em "Nova missão") a coluna é o briefing.
 */
export default function Missions({ onOpenCockpit, data }) {
  const { missions, failed, refresh } = data; // lido uma vez no App (também alimenta o indicador do botão Missions)
  const { workspaces, state, notify, refresh: refreshStore } = useStore();
  const [selectedId, setSelectedId] = useState(readSel), [stepId, setStepId] = useState(null), [composing, setComposing] = useState(false);
  const [newOpen, setNewOpen] = useState(false), [busy, setBusy] = useState(null), [pendingId, setPendingId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const list = missions ?? [];
  // Sem seleção válida: a missão que mais pede você (aprovação > atenção > trabalhando), senão a primeira. Uma missão recém-criada pelo briefing ainda pode não estar na lista.
  useEffect(() => {
    if (missions === null) return;
    if (pendingId && list.some((m) => m.id === pendingId)) setPendingId(null);
    if (selectedId && (list.some((m) => m.id === selectedId) || selectedId === pendingId)) return;
    const pick = ['approval', 'attention', 'working'].map((s) => list.find((m) => missionState(m) === s)).find(Boolean) ?? list[0] ?? null;
    setSelectedId(pick?.id ?? null); setStepId(null); // outra missão: o detalhe da etapa anterior não "gruda"
  }, [missions, selectedId, pendingId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // a missão criada pelo briefing pode não aparecer na lista (falha persistente do refresh): não deixa "Abrindo a missão criada…" preso
    if (!pendingId) return undefined;
    const t = setTimeout(() => setPendingId(null), 20000);
    return () => clearTimeout(t);
  }, [pendingId]);
  const select = useCallback((id) => { setSelectedId(id); setStepId(null); setComposing(false); try { localStorage.setItem(SEL_KEY, id); } catch { /* só conveniência */ } }, []);

  const mission = list.find((m) => m.id === selectedId) ?? null;
  const mstate = mission ? missionState(mission) : 'idle';
  useEffect(() => { // o relógio só corre enquanto a missão está ativa (duração ao vivo)
    if (mstate !== 'working') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mstate, selectedId]);

  const workspace = mission ? workspaces.find((w) => w.id === mission.workspaceId) ?? null : null;
  const tiers = state?.orchestration?.tiers ?? null; // tabela EFETIVA do servidor (somente leitura); ausente = modelo "não informado"
  const board = useMemo(() => (mission ? buildBoard(mission, { tiers, usage: state?.usage }) : null), [mission, tiers, state?.usage]);
  const drawer = useMemo(() => (mission && board && stepId ? drawerModel(mission, board, stepId) : null), [mission, board, stepId]);
  useEffect(() => { if (stepId && board && !board.steps.some((s) => s.id === stepId)) setStepId(null); }, [board, stepId]);
  const pickStep = useCallback((id) => setStepId((cur) => (cur === id ? null : id)), []);
  const stepRef = useRef(null); stepRef.current = stepId;
  const closeDrawer = useCallback(() => { // devolve o foco ao cartão que abriu a gaveta (teclado e leitor de tela)
    const id = stepRef.current; setStepId(null);
    if (id) setTimeout(() => document.querySelector(`.mb-card-btn[data-sid="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }), 0);
  }, []);

  const run = useCallback(async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) notify(ok); } catch (e) { notify(e.message, 'error'); } finally { setBusy(null); refresh(); refreshStore(); }
  }, [notify, refresh, refreshStore]);

  const onAction = (what) => {
    if (!mission) return undefined;
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
  // Fixar o nível de uma etapa na fila (o servidor só aceita enquanto ela está `queued`; só o NOME do nível vai no corpo, nunca um modelo).
  const onPin = (id, value) => {
    const body = pinBody(value);
    if (!mission || !body) return undefined;
    return run(`pin:${id}`, () => api.post(pinUrl(mission.id, id), body), value === 'auto' ? 'Nível devolvido ao Planner.' : `Nível fixado: ${TIER_LABEL[value]}.`);
  };
  // Aceitação humana de uma conclusão SEM evidência verificada: nunca automática (o corpo já traz o motivo e a confirmação explícita).
  const onAccept = (body) => (mission ? run('accept', () => api.post(`/api/missions/${mission.id}/cycle/accept-unverified`, body), 'Conclusão aceita sem evidência verificada.') : undefined);
  // Abre o Cockpit no workspace da missão. O terminal só vai junto quando é um id (os botões podem repassar o evento de clique, que não conta).
  const openTerminals = (terminalId) => onOpenCockpit(mission?.workspaceId ?? null, typeof terminalId === 'string' ? terminalId : null);
  // Briefing aprovado: o servidor criou a missão e iniciou o ciclo (202 { missionId }); seleciona-a mesmo antes de ela chegar na lista.
  const onApproved = (id) => {
    if (id) { setPendingId(id); select(id); }
    setComposing(false); refresh(); refreshStore();
  };

  const startNew = () => { setComposing(true); setStepId(null); };
  const showBriefing = missions !== null && (composing || (!mission && !pendingId));
  const opening = !mission && !!pendingId && !composing;

  return (
    <div className={`mi-page${drawer ? ' has-drawer' : ''}`}>
      <MissionSidebar missions={missions} workspaces={workspaces} selectedId={composing ? null : selectedId} onPick={select} onNew={startNew} failed={failed} />
      <div className="mi-main">
        {missions === null ? (
          <div className="mi-center mb-center"><p className="mi-note" role="status">Carregando…</p></div>
        ) : showBriefing ? (
          <div className="mi-center mb-center">
            <MissionBriefing mission={mission} composing tiers={tiers} notify={notify} onApproved={onApproved} onManual={() => setNewOpen(true)} onCancel={() => setComposing(false)} />
          </div>
        ) : opening ? (
          <div className="mi-center mb-center"><p className="mi-note" role="status">Abrindo a missão criada…</p></div>
        ) : mission && board ? (
          <div className="mi-center mb-center">
            <MissionPanel mission={mission} workspace={workspace} now={now} usage={state?.usage ?? null} onAction={onAction} onOpenTerminals={openTerminals} busyAction={busy} />
            <MissionLiveButton key={mission.id} mission={mission} />
            <MissionAttention items={board.attention} onDecide={onDecide} busyAction={busy} />
            <MissionBriefing mission={mission} />
            <MissionBoard key={mission.id} board={board} selectedId={stepId} onSelect={pickStep} onDecide={onDecide} busyAction={busy} />
            <MissionProgress progress={board.progress} onSelect={pickStep} />
            <MissionDelivery delivery={board.delivery} onAccept={onAccept} busyAction={busy} />
          </div>
        ) : null}
      </div>
      {drawer && <MissionAgentDrawer model={drawer} onClose={closeDrawer} onDecide={onDecide} onPin={onPin} busyAction={busy} />}
      {newOpen && (
        <NewMissionDialog workspaces={workspaces} activeWorkspaceId={state?.activeWorkspace?.id ?? null} onClose={() => setNewOpen(false)}
          onCreated={(m, note) => { setNewOpen(false); setPendingId(m.id); select(m.id); notify(note ?? 'Missão criada.', note ? 'error' : 'info'); refresh(); refreshStore(); }} />
      )}
    </div>
  );
}
