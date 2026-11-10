import React, { useMemo } from 'react';
import { useStore } from '../store.jsx';
import { nav } from '../api.js';
import { Icon } from './ui.jsx';
import SystemStatus from './SystemStatus.jsx';
import WorkspaceTabs from './WorkspaceTabs.jsx';
import { openTabs, closePlan } from '../workspace-nav.js';
import { missionState } from '../missions-view.js';

/**
 * Barra superior em 2 linhas. Linha 1: marca, estado, recursos (terminais e contadores reais) e configurações; em telas estreitas leva o botão da navegação.
 * Linha 2: abas dos workspaces abertos. Tudo vem de /api/state e das sessões reais; nada é simulado.
 */
export default function Topbar({ narrow, onMenu, menuRef, navOpen, onOpenSettings, onOpenWorkspaces, view = 'cockpit', onView = () => {}, missions = null }) {
  const { state, workspaces, terminals, maestro, workingIds, openWorkspaceIds, act, unseenWs } = useStore();
  const ms = Array.isArray(missions) ? missions : [], busyMissions = ms.filter((m) => missionState(m) === 'working').length, waitingMissions = ms.filter((m) => missionState(m) === 'approval').length, workingTerms = workingIds?.size ?? 0; // inclui aprovações do CICLO
  const sessions = terminals?.sessions ?? [], maestroTasks = maestro?.tasks ?? [];
  const activeId = state?.activeWorkspace?.id ?? null;
  const tabs = useMemo(() => openTabs({ workspaces, openWorkspaceIds, activeId, sessions, workingIds, maestroTasks }), [workspaces, openWorkspaceIds, activeId, sessions, workingIds, maestroTasks]);
  const unseen = new Set([...unseenWs].filter((id) => id !== activeId)); // a aba do workspace aberto não precisa do aviso: a sidebar mostra o "!" dele
  const activate = (t) => act(() => nav.activateWorkspace(t.id));
  const close = async (t) => {
    const plan = closePlan(t);
    if (plan.confirm && !window.confirm(plan.message)) return; // fechar a aba nunca encerra terminais; confirma só para avisar que continuam rodando
    await act(() => nav.closeWorkspace(t.id)); // o servidor já escolhe o vizinho ao fechar a aba ativa
  };

  return (
    <header className="tb" aria-label="Barra superior">
      <div className="tb-row">
        {narrow && view === 'cockpit' && <button type="button" ref={menuRef} className="oc-iconbtn nav-toggle" onClick={onMenu} aria-label="Abrir a lista de ambientes" aria-haspopup="dialog" aria-expanded={!!navOpen} aria-controls="nav-drawer"><Icon name="menu" size={18} /></button>}
        {/* Páginas: células de texto (como as abas do Overclock). O ponto e o número só aparecem quando há algo vivo: laranja = trabalhando, âmbar = aprovação pendente. */}
        <nav className="tb-views" aria-label="Páginas">
          <button type="button" className={`tb-view${view === 'cockpit' ? ' on' : ''}`} onClick={() => onView('cockpit')} aria-current={view === 'cockpit' ? 'page' : undefined}
            title={workingTerms ? `${workingTerms} terminal(is) trabalhando` : 'Cockpit: os terminais dos agentes'}>
            {workingTerms > 0 && <i className="tb-view-dot" aria-hidden="true" />}
            <span>Cockpit</span>
            {workingTerms > 0 && <b className="tb-view-n work" aria-label={`${workingTerms} trabalhando`}>{workingTerms}</b>}
          </button>
          <button type="button" className={`tb-view${view === 'missions' ? ' on' : ''}`} onClick={() => onView('missions')} aria-current={view === 'missions' ? 'page' : undefined}
            title={waitingMissions ? `${waitingMissions} missão(ões) aguardando aprovação` : busyMissions ? `${busyMissions} missão(ões) em andamento` : 'Missions: central de missões'}>
            {(waitingMissions > 0 || busyMissions > 0) && <i className={`tb-view-dot${waitingMissions ? ' wait' : ''}`} aria-hidden="true" />}
            <span>Missions</span>
            {waitingMissions > 0
              ? <b className="tb-view-n wait" aria-label={`${waitingMissions} aguardando aprovação`}>{waitingMissions}</b>
              : busyMissions > 0 && <b className="tb-view-n work" aria-label={`${busyMissions} em andamento`}>{busyMissions}</b>}
          </button>
        </nav>
        <span className="grow" />
        <SystemStatus />
        <button type="button" className="oc-iconbtn" onClick={onOpenSettings} aria-label="Configurações" title="Configurações"><Icon name="gear" size={18} /></button>
      </div>
      <div className="tb-row tb-tabs" hidden={view !== 'cockpit'}>
        <WorkspaceTabs tabs={tabs} unseen={unseen} onActivate={activate} onClose={close} onAdd={onOpenWorkspaces} />
      </div>
    </header>
  );
}
