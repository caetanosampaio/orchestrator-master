import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import DesktopTitleBar from './components/DesktopTitleBar.jsx';
import Home from './pages/Home.jsx';
import Cockpit from './pages/Cockpit.jsx';
import Missions from './pages/Missions.jsx';
import Settings from './pages/Settings.jsx';
import WorkspaceDialog from './components/WorkspaceDialog.jsx';
import SessionsDialog from './components/SessionsDialog.jsx';
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
  const [dialog, setDialog] = useState(null); // 'workspaces' | 'sessions' | null (as Configurações são uma página: view 'settings')
  const [settingsTab, setSettingsTab] = useState(() => /^#\/settings\/([a-z-]+)/.exec(location.hash)?.[1] ?? 'perfil'), [settingsKey, setSettingsKey] = useState(0); // #/settings/<seção> abre direto na seção (ex.: #/settings/mascotes) // a chave refaz a página para ela abrir na aba pedida
  const [ui] = useUi();
  const narrow = useNarrow();
  const menuRef = useRef(null);
  const [prefs] = usePrefs();
  const { error, toast, state, openWorkspaceIds, act } = useStore();
  const [view, setView] = useState(() => (location.hash.startsWith('#/settings') ? 'settings' : location.hash.startsWith('#/missions') ? 'missions' : location.hash.startsWith('#/cockpit') ? 'cockpit' : 'home')); // página: 'home' (Início, a de abertura: #/ ou #/home) | 'cockpit' (terminais) | 'missions' (central de missões) | 'settings' (Configurações; #/settings: link antigo)
  const backTo = useRef(view === 'settings' ? 'home' : view); // de onde as Configurações foram abertas: o "Voltar" retorna para lá
  const missionsData = useMissions({ intervalMs: view === 'missions' ? 2500 : 6000 }); // mais devagar fora da página: só alimenta o indicador do botão Missions
  const goView = useCallback((v) => { setView(v); setNavOpen(false); history.replaceState(null, '', v === 'missions' ? '#/missions' : v === 'settings' ? '#/settings' : v === 'cockpit' ? '#/cockpit' : location.pathname + location.search); }, []); // Início = sem hash (é o padrão)
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
  const openSettings = useCallback((tab) => { setNavOpen(false); setSettingsTab(typeof tab === 'string' ? tab : 'perfil'); setSettingsKey((k) => k + 1); if (view !== 'settings') backTo.current = view; goView('settings'); }, [view, goView]); // o botão da engrenagem chama com o evento: só texto vale como aba
  const openWorkspaces = useCallback(() => { setNavOpen(false); setDialog('workspaces'); }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeSettings = useCallback(() => goView(backTo.current === 'settings' ? 'cockpit' : backTo.current), [goView]);

  const openSessions = useCallback(() => { setNavOpen(false); setDialog('sessions'); }, []);
  const side = { onOpenWorkspaces: openWorkspaces, onOpenSessions: openSessions };
  return (
    <div className="oc-app oc-app-col">
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>Pular para o conteúdo</button>
      <DesktopTitleBar />
      <Topbar narrow={narrow} onMenu={() => setNavOpen(true)} menuRef={menuRef} navOpen={navOpen} onOpenSettings={view === 'settings' ? closeSettings : openSettings} view={view} onView={goView} missions={missionsData.missions} />
      <div className="oc-body">
        {!narrow && view === 'cockpit' && <Sidebar {...side} />}
        {narrow && navOpen && view === 'cockpit' && <><div className="oc-scrim" onClick={closeNav} aria-hidden="true" /><Sidebar modal onClose={closeNav} {...side} /></>}
      <div className="oc-main">
        {error && <div className="banner err" role="alert">{error}</div>}
        {(ui.status.state === 'offline' || ui.status.state === 'error') && <div className="banner err" role="status" data-testid="ui-sync-note">{ui.status.message}</div>}
        {state?.persistence && !state.persistence.ok && (
          <div className="banner err" role="alert">
            O banco não está sendo gravado em disco (erro {state.persistence.error}): o estado só existe em memória. <PersistenceNote incident={state.persistenceIncident} />
          </div>
        )}
        <main id="main" tabIndex={-1} className="oc-content">
          {/* O Cockpit fica SEMPRE montado (só escondido nas outras páginas): os terminais não são recriados ao voltar, então rolagem e texto digitado se mantêm.
              Escondido, o contêiner mede 0 e o terminal não se reajusta (TerminalGrid só ajusta acima de 40px): nenhum redimensionamento vai ao servidor. */}
          <div className="oc-view" hidden={view !== 'cockpit'}><Cockpit onOpenWorkspaces={openWorkspaces} onOpenSettings={openSettings} onOpenSessions={openSessions} /></div>
          {view === 'home' && <Home onOpenWorkspaces={openWorkspaces} onOpenWorkspace={openCockpit} missions={missionsData.missions} />}
          {view === 'missions' && <Missions onOpenCockpit={openCockpit} data={missionsData} />}
          {view === 'settings' && <Settings key={settingsKey} initial={settingsTab} onClose={closeSettings} onOpenWorkspaces={openWorkspaces} />}
        </main>
      </div>
      </div>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span className="toast-ico"><Icon name={toast.kind === 'error' ? 'xCircle' : 'checkCircle'} size={20} /></span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
      <PrereqModal suspended={!!dialog || view === 'settings'} onOpenAccounts={() => openSettings('accounts')} /> {/* se afasta enquanto um diálogo (ex.: Configurações > Contas) está aberto */}
      {dialog === 'workspaces' && <WorkspaceDialog onClose={closeDialog} onPicked={view === 'home' ? () => goView('cockpit') : undefined} />} {/* aberto no Início: escolher ou criar um workspace segue para o Cockpit */}
      {dialog === 'sessions' && <SessionsDialog onClose={closeDialog} />}
    </div>
  );
}
