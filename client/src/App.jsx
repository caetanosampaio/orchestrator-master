import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import StatusBar from './components/StatusBar.jsx';
import DesktopTitleBar, { desktopInfo } from './components/DesktopTitleBar.jsx';
import Home from './pages/Home.jsx';
import Cockpit from './pages/Cockpit.jsx';
import Missions from './pages/Missions.jsx';
import Settings from './pages/Settings.jsx';
import Setup from './pages/Setup.jsx';
import WorkspaceDialog from './components/WorkspaceDialog.jsx';
import SessionsDialog from './components/SessionsDialog.jsx';
import { useStore } from './store.jsx';
import { startGolem, useGolemLive } from './use-golem.js';
import { nav } from './api.js';
import { useFlows } from './use-flows.js';
import { createTerminalStream } from './terminal-stream.js';
import { flowTerminalIds } from './flow-terminals.js';
import { useLiveAutoOpen } from './use-live.js';
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
  // conveniências por navegador (o servidor não precisa saber): painel Live aberto e barra lateral recolhida
  const [liveOpen, setLiveOpen] = useState(() => { try { return localStorage.getItem('forge.live.open') !== '0'; } catch { return true; } });
  const [sideHidden, setSideHidden] = useState(() => { try { return localStorage.getItem('forge.side.hidden') === '1'; } catch { return false; } });
  const [liveHint, setLiveHint] = useState(null); // 'build' = o painel abriu sozinho por causa de uma missão (abre na aba Construção); some assim que o usuário abre/fecha o painel
  const toggleLive = useCallback(() => { setLiveHint(null); setLiveOpen((o) => { try { localStorage.setItem('forge.live.open', o ? '0' : '1'); } catch { /* local */ } return !o; }); }, []);
  const toggleSide = useCallback(() => { setSideHidden((h) => { try { localStorage.setItem('forge.side.hidden', h ? '0' : '1'); } catch { /* local */ } return !h; }); setTimeout(() => window.dispatchEvent(new Event('resize')), 220); }, []);
  const [focusReq, setFocusReq] = useState(null); // terminal clicado na sidebar: o Cockpit o amplia assim que ele é do workspace aberto
  const desktop = desktopInfo()?.platform === 'darwin';
  const [dialog, setDialog] = useState(null); // 'workspaces' | 'sessions' | null (as Configurações são uma página: view 'settings')
  const [settingsTab, setSettingsTab] = useState(() => /^#\/settings\/([a-z-]+)/.exec(location.hash)?.[1] ?? 'perfil'), [settingsKey, setSettingsKey] = useState(0); // #/settings/<seção> abre direto na seção (ex.: #/settings/golem) // a chave refaz a página para ela abrir na aba pedida
  const [ui] = useUi();
  const narrow = useNarrow();
  const menuRef = useRef(null);
  const [prefs] = usePrefs();
  const { error, toast, state, openWorkspaceIds, act, workspaces, terminals, workingIds, setHiddenTerminals, workEnds, notify } = useStore();
  const [view, setView] = useState(() => (location.hash.startsWith('#/settings') ? 'settings' : location.hash.startsWith('#/missions') ? 'missions' : location.hash.startsWith('#/cockpit') ? 'cockpit' : 'home')); // página: 'home' (Início, a de abertura: #/ ou #/home) | 'cockpit' (terminais) | 'missions' (central de missões) | 'settings' (Configurações; #/settings: link antigo)
  const backTo = useRef(view === 'settings' ? 'home' : view); // de onde as Configurações foram abertas: o "Voltar" retorna para lá
  const cockpitFrom = useRef(view === 'cockpit' ? 'cockpit' : 'home'); // última página do Cockpit (Início ou Terminais): o "Voltar ao Cockpit" das Missões retorna para lá
  useEffect(() => { if (view === 'home' || view === 'cockpit') cockpitFrom.current = view; }, [view]);
  // Missões v2 (flows): um único polling serve a página Missões e o indicador da barra lateral (visível em qualquer página). `flowsSeenAt` = quando você viu Missões pela última vez: run que termina depois disso aparece como "concluída/falhou" na sidebar até você abrir a página.
  const flowsData = useFlows({ intervalMs: 2500 });
  useEffect(() => { startGolem(); }, []); // o golem de liga: cresce com os tokens de todas as IAs (com o histórico) e reage ao trabalho ao vivo
  useGolemLive({ workingIds, workEnds, notify }); // agentes trabalhando agora, fim de trabalho (comemora) e aviso quando ele evolui
  const [flowsSeenAt, setFlowsSeenAt] = useState(() => Date.now());
  useEffect(() => { if (view === 'missions') setFlowsSeenAt(Date.now()); }, [view, flowsData.flows]);
  const flowTermIds = useMemo(() => flowTerminalIds(flowsData.flows), [flowsData.flows]); // terminais das missões: só aparecem na página Missões
  useEffect(() => { setHiddenTerminals?.(flowTermIds); }, [flowTermIds, setHiddenTerminals]); // e não contam no "terminou" (!) dos workspaces da barra lateral
  // Painel Live abre sozinho quando a equipe do workspace aberto começa a trabalhar (preferência liveAutoOpen). Só setLiveOpen: NÃO grava forge.live.open, não usa focus() nem rola a página.
  const autoOpenLive = useCallback(({ mission }) => { setLiveHint(mission ? 'build' : null); setLiveOpen(true); }, []);
  useLiveAutoOpen({ wsId: state?.activeWorkspace?.id ?? null, flows: flowsData.flows, sessions: terminals?.sessions, workingIds, liveOpen, open: autoOpenLive });
  const termStream = useMemo(() => createTerminalStream(), []); // UMA conexão SSE de terminais para o Cockpit e para o dock da página Missões (o servidor limita as conexões)
  useEffect(() => () => termStream.close(), [termStream]);
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
  // #/rota vinda de fora (menu da bandeja / barra de menus do app desktop): troca de página sem recarregar
  useEffect(() => {
    const on = () => { const h = location.hash; if (h.startsWith('#/settings')) openSettings(/^#\/settings\/([a-z-]+)/.exec(h)?.[1]); else if (h.startsWith('#/missions')) goView('missions'); else if (h.startsWith('#/cockpit')) goView('cockpit'); else if (h === '#/home') goView('home'); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [goView, openSettings]);
  const openWorkspaces = useCallback(() => { setNavOpen(false); setDialog('workspaces'); }, []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeSettings = useCallback(() => goView(backTo.current === 'settings' ? 'cockpit' : backTo.current), [goView]);
  const backToCockpit = useCallback(() => goView(cockpitFrom.current), [goView]); // Missões é uma página à parte: o botão do topo da lista volta ao centro do FORGE

  const openSessions = useCallback(() => { setNavOpen(false); setDialog('sessions'); }, []);
  const side = { onOpenWorkspaces: openWorkspaces, onOpenSessions: openSessions, onOpenSettings: openSettings, view, onView: goView, flows: flowsData.flows, flowsSeenAt, hiddenIds: flowTermIds, onOpenTerminal: (t) => setFocusReq({ id: t.id, at: Date.now() }), desktop };
  const settings = view === 'settings';
  const showSetup = prefs.setupDone !== true && ui.status.state !== 'loading';
  const missions = view === 'missions'; // Missões tem a própria barra lateral (lista de missões + "Voltar ao Cockpit"), também como gaveta nas telas estreitas
  const showSide = !settings && !missions && !narrow && !sideHidden;
  const menu = narrow ? () => setNavOpen(true) : sideHidden ? toggleSide : null; // telas estreitas: gaveta; barra recolhida: reabre
  return (
    <div className={`oc-app fx-app${desktop ? ' is-desktop' : ''}${settings ? ' in-settings' : ''}`}>
      <button type="button" className="skip" onClick={() => document.getElementById('main')?.focus()}>Pular para o conteúdo</button>
      {settings && <DesktopTitleBar />}
      <div className="fx-body">
        {showSide && <Sidebar {...side} onCollapse={toggleSide} />}
        {narrow && navOpen && !settings && !missions && <><div className="oc-scrim fx-scrim" onClick={closeNav} aria-hidden="true" /><Sidebar modal onClose={closeNav} {...side} /></>}
        <div className="fx-main">
          {menu && view !== 'cockpit' && !settings && !missions && <button type="button" ref={menuRef} className="fx-ibtn fx-reopen" onClick={menu} aria-label={narrow ? 'Abrir a navegação' : 'Mostrar a barra lateral'} title={narrow ? 'Navegação' : 'Mostrar a barra lateral'}><Icon name={narrow ? 'menu' : 'panel'} size={15} /></button>}
          {error && <div className="banner err" role="alert">{error}</div>}
          {(ui.status.state === 'offline' || ui.status.state === 'error') && <div className="banner err" role="status" data-testid="ui-sync-note">{ui.status.message}</div>}
          {state?.persistence && !state.persistence.ok && (
            <div className="banner err" role="alert">
              O banco não está sendo gravado em disco (erro {state.persistence.error}): o estado só existe em memória. <PersistenceNote incident={state.persistenceIncident} />
            </div>
          )}
          <main id="main" tabIndex={-1} className="oc-content fx-content">
            {/* O Cockpit fica SEMPRE montado (só escondido nas outras páginas): os terminais não são recriados ao voltar, então rolagem e texto digitado se mantêm.
                Escondido, o contêiner mede 0 e o terminal não se reajusta (TerminalGrid só ajusta acima de 40px): nenhum redimensionamento vai ao servidor. */}
            <div className="oc-view fx-view" hidden={view !== 'cockpit'}><Cockpit stream={termStream} hiddenIds={flowTermIds} flows={flowsData.flows} liveHint={liveHint} liveVisible={view === 'cockpit'} onOpenWorkspaces={openWorkspaces} onOpenSettings={openSettings} onOpenSessions={openSessions} liveOpen={liveOpen} onToggleLive={toggleLive} narrow={narrow || sideHidden} onMenu={menu} menuIcon={narrow ? 'menu' : 'panel'} focusRequest={focusReq} onFocusHandled={() => setFocusReq(null)} /></div>
            {view === 'home' && <div className="fx-view fx-page"><Home onOpenWorkspaces={openWorkspaces} onOpenWorkspace={openCockpit} /></div>}
            {view === 'missions' && <div className="fx-view fx-page"><Missions onOpenCockpit={openCockpit} data={flowsData} stream={termStream} onBack={backToCockpit} backLabel={cockpitFrom.current === 'cockpit' ? 'Terminais' : 'Início'} narrow={narrow}
              side={{ onView: goView, onOpenSessions: openSessions, onOpenSettings: openSettings, onOpenWorkspaces: openWorkspaces, desktop }} /></div>}
            {settings && <Settings key={settingsKey} initial={settingsTab} onClose={closeSettings} onOpenWorkspaces={openWorkspaces} />}
          </main>
        </div>
      </div>
      <StatusBar liveOpen={liveOpen} onToggleLive={view === 'cockpit' ? toggleLive : null} />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span className="toast-ico"><Icon name={toast.kind === 'error' ? 'xCircle' : 'checkCircle'} size={20} /></span>
          <span className="toast-text">{toast.text}</span>
        </div>
      )}
      {showSetup && <Setup onFinish={() => goView(workspaces?.length ? 'cockpit' : 'home')} />} {/* setup animado do 1º uso: só depois de ler as preferências do servidor (sem piscar para quem já usa) */}
      <PrereqModal suspended={!!dialog || view === 'settings' || showSetup} onOpenAccounts={() => openSettings('accounts')} /> {/* se afasta enquanto um diálogo (ex.: Configurações > Contas) está aberto */}
      {dialog === 'workspaces' && <WorkspaceDialog onClose={closeDialog} onPicked={view === 'home' ? () => goView('cockpit') : undefined} />} {/* aberto no Início: escolher ou criar um workspace segue para o Cockpit */}
      {dialog === 'sessions' && <SessionsDialog onClose={closeDialog} />}
    </div>
  );
}
