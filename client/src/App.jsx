import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Cockpit from './pages/Cockpit.jsx';
import Missions from './pages/Missions.jsx';
import ActivityDrawer from './components/ActivityDrawer.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import WorkspaceDialog from './components/WorkspaceDialog.jsx';
import { useStore } from './store.jsx';
import { nav } from './api.js';
import { useMissions } from './use-missions.js';
import { usePrefs, useUi } from './hooks.js';
import PrereqModal from './components/PrereqModal.jsx';
import { Icon, PersistenceNote } from './components/ui.jsx';

const NARROW = '(max-width: 900px)';

/** `matchMedia` reativo: a lista de ambientes é um trilho em telas largas e uma gaveta modal nas estreitas. */
function useNarrow() {
  const [v, setV] = useState(() => !!window.matchMedia?.(NARROW).matches);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW); if (!m) return undefined;
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const [dialog, setDialog] = useState(() => (location.hash.startsWith('#/settings') ? 'settings' : null)); // 'settings' | 'workspaces' | null (#/settings: link antigo)
  const [settingsTab, setSettingsTab] = useState('perfil');
  const [ui, uiActions] = useUi();
  const collapsed = ui.sidebarCollapsed;
  const narrow = useNarrow();
  const menuRef = useRef(null);
  const [prefs] = usePrefs();
  const { error, toast, state, openWorkspaceIds, act } = useStore();
  const [view, setView] = useState(() => (location.hash.startsWith('#/missions') ? 'missions' : 'cockpit')); // página: 'cockpit' (terminais) | 'missions' (central de missões)
  const missionsData = useMissions({ intervalMs: view === 'missions' ? 2500 : 6000 }); // mais devagar fora da página: só alimenta o indicador do botão Missions
  const goView = useCallback((v) => { setView(v); setNavOpen(false); history.replaceState(null, '', v === 'missions' ? '#/missions' : location.pathname + location.search); }, []);
  /** "Terminais" de uma missão: abre e ativa o workspace dela e volta ao Cockpit. */
  const openCockpit = useCallback(async (workspaceId) => {
    if (workspaceId) await act(async () => { if (!(openWorkspaceIds ?? []).includes(workspaceId)) await nav.openWorkspace(workspaceId); return nav.activateWorkspace(workspaceId); });
    goView('cockpit');
  }, [act, openWorkspaceIds, goView]);

  // "Animações reduzidas" (preferência) liga o mesmo modo que prefers-reduced-motion: o CSS lê data-motion
  useEffect(() => { document.documentElement.dataset.motion = prefs.motion; }, [prefs.motion]);
  useEffect(() => { if (!narrow) setNavOpen(false); }, [narrow]);
  // de volta ao Cockpit: o layout reaparece, então os terminais se reajustam ao espaço (o mesmo evento que usam ao maximizar)
  useEffect(() => { if (view !== 'cockpit') return undefined; const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60); return () => clearTimeout(t); }, [view]);
  const closeNav = useCallback(() => { setNavOpen(false); setTimeout(() => menuRef.current?.focus(), 0); }, []);
  const toggleSide = () => uiActions.setSidebarCollapsed(!collapsed);
  const openSettings = useCallback((tab) => { setNavOpen(false); setSettingsTab(typeof tab === 'string' ? tab : 'perfil'); setDialog('settings'); }, []); // o botão da engrenagem chama com o evento: só texto vale como aba
  const openWorkspaces = useCallback(() => { setNavOpen(false); setDialog('workspaces'); }, []);
  const closeDialog = useCallback(() => { setDialog(null); if (location.hash.startsWith('#/settings')) history.replaceState(null, '', location.pathname + location.search); }, []);

  const side = { onOpenWorkspaces: openWorkspaces };
  return (
    <div className="oc-app">
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>Pular para o conteúdo</button>
      {!narrow && view === 'cockpit' && <Sidebar collapsed={collapsed} onToggle={toggleSide} {...side} />}
      {narrow && navOpen && view === 'cockpit' && <><div className="oc-scrim" onClick={closeNav} aria-hidden="true" /><Sidebar modal onClose={closeNav} {...side} /></>}
      <div className="oc-main">
        <Topbar narrow={narrow} onMenu={() => setNavOpen(true)} menuRef={menuRef} navOpen={navOpen} onOpenSettings={openSettings} onOpenWorkspaces={openWorkspaces} view={view} onView={goView} missions={missionsData.missions} />
        {error && <div className="banner err" role="alert">{error}</div>}
        {(ui.status.state === 'offline' || ui.status.state === 'error') && <div className="banner err" role="status" data-testid="ui-sync-note">{ui.status.message}</div>}
        {state?.persistence && !state.persistence.ok && (
          <div className="banner err" role="alert">
            O banco não está sendo gravado em disco (erro {state.persistence.error}): o estado só existe em memória. <PersistenceNote incident={state.persistenceIncident} />
          </div>
        )}
        <main id="main" tabIndex={-1} className="oc-content">
          {/* O Cockpit fica SEMPRE montado (só escondido em Missions): os terminais não são recriados ao voltar, então rolagem e texto digitado se mantêm.
              Escondido, o contêiner mede 0 e o terminal não se reajusta (TerminalGrid só ajusta acima de 40px): nenhum redimensionamento vai ao servidor. */}
          <div className="oc-view" hidden={view !== 'cockpit'}><Cockpit onOpenWorkspaces={openWorkspaces} onOpenSettings={openSettings} /><ActivityDrawer /></div>
          {view === 'missions' && <Missions onOpenCockpit={openCockpit} data={missionsData} />}
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span className="toast-ico"><Icon name={toast.kind === 'error' ? 'xCircle' : 'checkCircle'} size={20} /></span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
      <PrereqModal suspended={!!dialog} onOpenAccounts={() => openSettings('accounts')} /> {/* se afasta enquanto um diálogo (ex.: Configurações > Contas) está aberto */}
      {dialog === 'settings' && <SettingsDialog initial={settingsTab} onClose={closeDialog} onOpenWorkspaces={openWorkspaces} />}
      {dialog === 'workspaces' && <WorkspaceDialog onClose={closeDialog} />}
    </div>
  );
}
