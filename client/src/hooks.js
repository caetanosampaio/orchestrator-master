import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPrefs, setPref, subscribePrefs, DEFAULT_PREFS } from './prefs.js';
import { getUi } from './ui-state.js';
import { getLayouts } from './layout-state.js';
import { layoutModeId } from './env-view.js';

const mq = () => window.matchMedia?.('(prefers-reduced-motion: reduce)');
/** Preferência do sistema por menos movimento (reativa a mudanças). */
export function usePrefersReduced() {
  const [v, setV] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq(); if (!m) return undefined;
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Layout da grade de terminais por workspace: [layouts por id de workspace, ações, ready]. */
export function useLayouts() {
  const l = getLayouts();
  const snap = useSyncExternalStore(l.subscribe, l.getSnapshot, l.getSnapshot);
  return [snap.layouts, l.actions, snap.ready];
}

/** Navegação da interface sincronizada com o servidor: { sidebarCollapsed, expandedWorkspaces, status } + ações. */
export function useUi() {
  const ui = getUi();
  const snap = useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot);
  return [snap, ui.actions];
}

/** Preferências da interface: [valores, mudar(chave, valor)]. */
export function usePrefs() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, () => DEFAULT_PREFS);
  return [prefs, setPref];
}

/** Modo de organização da grade do workspace: [modo, mudar(modo)]. Vive no layout do workspace NO SERVIDOR (volta em qualquer navegador e no app, mesmo com a porta do Electron mudando). */
export function useLayoutMode(wsId) {
  const l = getLayouts();
  const snap = useSyncExternalStore(l.subscribe, l.getSnapshot, l.getSnapshot);
  return [layoutModeId(wsId ? snap.layouts[wsId]?.mode : undefined), (m) => { if (wsId) l.actions.setMode(wsId, m); }];
}

// Restauração automática das sessões: preferência do usuário (padrão ligada), guardada no servidor junto das demais; compartilhada pelo cockpit (que restaura) e pelas Configurações (onde se liga e desliga).
export function useAutoRestore() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, () => DEFAULT_PREFS);
  return [prefs.autoRestore !== false, (v) => setPref('autoRestore', !!v)];
}
