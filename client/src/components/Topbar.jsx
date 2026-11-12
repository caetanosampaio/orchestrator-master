import React, { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { workingCount } from '../env-view.js';
import { usePrefs } from '../hooks.js';
import { Icon } from './ui.jsx';
import SystemStatus from './SystemStatus.jsx';
import { missionState } from '../missions-view.js';

const HOLD_MS = 3000; // quanto o "!" de trabalho persiste depois da última leitura "executando"

/** Casinha da página Início (mesmo traço dos demais ícones; o conjunto de ícones compartilhado não tem uma). */
const HomeIcon = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 11l8-7 8 7M6 10v10h4v-6h4v6h4V10" /></svg>;

/**
 * Barra superior em LINHA ÚNICA (no formato da barra de referência): os RECURSOS do FORGE e, à direita, o status global e o círculo com a inicial do seu nome (abre e fecha a página de Configurações).
 * Início (só o ícone de casa, o primeiro: é a página de abertura do app). Os recursos são: forge-app (o app em si: Cockpit e seus terminais, a aba ativa fica em negrito com o sublinhado vermelho) e Missions (só o ícone de maleta, à esquerda de forge-app; um "!" vermelho quando há missão esperando você). Recursos novos (extensões do app) entram aqui, ao lado de forge-app.
 * Os workspaces moram só na barra lateral. Terminais trabalhando (em qualquer workspace, pela mesma regra da sidebar: `workingCount`): um "!" amarelo-escuro, subindo e descendo de leve, aparece ao lado de forge-app em QUALQUER página, para sinalizar o trabalho em segundo plano quando você está em Missions ou nas Configurações. Missions: vermelho escuro = em andamento, âmbar = aprovação pendente.
 * O nome FORGE e a versão não ficam aqui: só na faixa da janela do app desktop (DesktopTitleBar). Em telas estreitas o botão da lista de ambientes vem antes de tudo. Tudo vem de /api/state e das sessões reais; nada é simulado.
 */
export default function Topbar({ narrow, onMenu, menuRef, navOpen, onOpenSettings, view = 'cockpit', onView = () => {}, missions = null }) {
  const { workingIds, terminals, maestro } = useStore();
  const [prefs] = usePrefs(), initial = ((prefs.name || '').trim()[0] || 'F').toUpperCase();
  const live = workingCount(terminals?.sessions, workingIds, maestro?.tasks ?? []); // tempo real: recalcula a cada consulta aos terminais (1,5 s), em qualquer página
  const [held, setHeld] = useState(0);
  // Retém o último valor por HOLD_MS depois que o trabalho cessa: sem hooks (ou entre duas consultas) a leitura oscila, e o "!" não deve piscar enquanto a equipe segue trabalhando.
  useEffect(() => {
    if (live > 0) { setHeld(live); return undefined; }
    const t = setTimeout(() => setHeld(0), HOLD_MS);
    return () => clearTimeout(t);
  }, [live]);
  const workingTerms = live > 0 ? live : held;
  const ms = Array.isArray(missions) ? missions : [], busyMissions = ms.filter((m) => missionState(m) === 'working').length, waitingMissions = ms.filter((m) => missionState(m) === 'approval').length;
  const missionsTitle = waitingMissions ? `Missions: ${waitingMissions} missão(ões) aguardando aprovação` : busyMissions ? `Missions: ${busyMissions} missão(ões) em andamento` : 'Missions: central de missões';

  return (
    <header className="tb" aria-label="Barra superior">
      <div className="tb-row">
        {narrow && view === 'cockpit' && <button type="button" ref={menuRef} className="oc-iconbtn nav-toggle" onClick={onMenu} aria-label="Abrir a lista de ambientes" aria-haspopup="dialog" aria-expanded={!!navOpen} aria-controls="nav-drawer"><Icon name="menu" size={18} /></button>}
        <nav className="tb-views" aria-label="Recursos do FORGE">
          <button type="button" className={`tb-view tb-view-icon${view === 'home' ? ' on' : ''}`} onClick={() => onView('home')} aria-current={view === 'home' ? 'page' : undefined} aria-label="Início" title="Início: atividade de tokens e workspaces recentes">
            <HomeIcon />
          </button>
          <button type="button" className={`tb-view tb-view-icon${view === 'missions' ? ' on' : ''}`} onClick={() => onView('missions')} aria-current={view === 'missions' ? 'page' : undefined} aria-label={missionsTitle} title={missionsTitle}>
            <Icon name="briefcase" size={15} />
            {waitingMissions > 0
              ? <b className="tb-bang" aria-hidden="true">!</b>
              : busyMissions > 0 && <b className="tb-view-n work" aria-hidden="true">{busyMissions}</b>}
          </button>
          <button type="button" className={`tb-view${view === 'cockpit' ? ' on' : ''}`} onClick={() => onView('cockpit')} aria-current={view === 'cockpit' ? 'page' : undefined}
            title={workingTerms ? `forge-app: ${workingTerms} terminal(is) trabalhando${view === 'cockpit' ? '' : ' em segundo plano'}` : 'forge-app: o Cockpit, com os terminais dos agentes'}>
            <span>forge-app</span>
            {workingTerms > 0 && <b className="tb-work" role="status" aria-label={`${workingTerms} ${workingTerms === 1 ? 'terminal trabalhando' : 'terminais trabalhando'}${view === 'cockpit' ? '' : ' em segundo plano'}`}>!</b>}
          </button>
        </nav>
        <span className="grow" />
        <SystemStatus />
        <button type="button" className={`tb-avatar${view === 'settings' ? ' on' : ''}`} onClick={onOpenSettings} aria-label="Configurações" aria-pressed={view === 'settings'} title={view === 'settings' ? 'Fechar as Configurações' : 'Configurações'}><span aria-hidden="true">{initial}</span></button>
      </div>
    </header>
  );
}
