// Terminais das Missões (flows): cada etapa roda num terminal real do servidor, mas ele é mostrado DENTRO da página Missões, nunca misturado
// com os terminais que o usuário abriu no Cockpit. Funções puras (testadas em server/test/flow-terminals.test.mjs).

const arr = (v) => (Array.isArray(v) ? v : []);

/** Ids de terminal que pertencem a missões (run ativo ou último run de cada uma). O Cockpit e a barra lateral escondem esses terminais. */
export function flowTerminalIds(flows) {
  const ids = new Set();
  for (const f of arr(flows)) {
    for (const run of [f?.activeRun, f?.lastRun]) {
      for (const s of arr(run?.steps)) if (typeof s?.terminalId === 'string' && s.terminalId) ids.add(s.terminalId);
    }
  }
  return ids;
}

/** Terminal do Planejador de missão (criar por briefing): papel `planner`. Mostrado só na página Missões. */
export const PLANNER_ROLE = 'planner';
export const isPlannerSession = (s) => s?.role === PLANNER_ROLE;

/**
 * Papéis oferecidos nas vagas de equipe (TeamComposer): os do servidor, sem o Planejador (ele só nasce pelo "Nova por briefing" e o servidor o recusa numa vaga).
 * O Maestro continua (formações prontas usam vaga de Maestro).
 */
export const teamSlotRoles = (roles) => arr(roles).filter((r) => r && typeof r.id === 'string' && r.id && r.id !== PLANNER_ROLE);

/**
 * `sessions` sem os terminais de missões e sem os do Planejador (os dois vivem na página Missões; montar o mesmo terminal em dois lugares disputaria o tamanho do pty).
 * Sem nada a esconder devolve a MESMA lista (referência estável para useMemo).
 */
export function withoutFlowTerminals(sessions, hidden) {
  const list = arr(sessions), none = !hidden || hidden.size === 0;
  if (none && !list.some(isPlannerSession)) return list;
  return list.filter((s) => !isPlannerSession(s) && (none || !hidden.has(s?.id)));
}

/**
 * Abas dos Planejadores abertos (um por briefing; pode haver vários), na ordem em que abriram. Valem com ou sem missão selecionada. `closable`: o Planejador o usuário
 * fecha quando quiser (as etapas de missão não: encerrar é "Cancelar missão"). Título "Planejador" (numerado quando há mais de um); o workspace vai na dica.
 */
export function plannerTabs(sessions, { workspaces = [] } = {}) {
  const list = arr(sessions).filter((s) => isPlannerSession(s) && typeof s.id === 'string' && s.id)
    .sort((a, b) => (Date.parse(a.startedAt ?? '') || 0) - (Date.parse(b.startedAt ?? '') || 0));
  const wsName = (id) => { const w = arr(workspaces).find((x) => x?.id === id); return w ? w.displayName || w.name || null : null; };
  return list.map((s, i) => ({
    terminalId: s.id, kind: 'planner', closable: true, stepId: null, stepStatus: null, order: -1, session: s,
    title: list.length > 1 ? `Planejador ${i + 1}` : 'Planejador', workspaceName: wsName(s.workspaceId),
  }));
}

/**
 * Abas do dock de terminais de UMA missão: uma por etapa do run atual que já tem terminal, na ordem da definição.
 * `session` = a sessão viva/encerrada em /api/terminals (null se o servidor já a esqueceu: a aba continua, marcada como encerrada).
 */
export function flowTerminalTabs(flow, sessions) {
  const run = flow?.activeRun ?? flow?.lastRun ?? null;
  if (!run) return [];
  const byId = new Map(arr(sessions).map((s) => [s?.id, s]));
  const defs = new Map(arr(flow?.steps).map((s, i) => [s.id, { title: s.title, order: i }]));
  const seen = new Set(), tabs = [];
  for (const rs of arr(run.steps)) {
    if (typeof rs?.terminalId !== 'string' || !rs.terminalId || seen.has(rs.terminalId)) continue; // continueFrom: várias etapas, um terminal só
    seen.add(rs.terminalId);
    const d = defs.get(rs.stepId);
    tabs.push({ terminalId: rs.terminalId, kind: 'step', closable: false, stepId: rs.stepId, title: d?.title ?? rs.stepId, order: d?.order ?? 999, stepStatus: rs.status, session: byId.get(rs.terminalId) ?? null });
  }
  return tabs.sort((a, b) => a.order - b.order);
}

/** Qual aba fica ativa: a pedida (se existir), senão a que espera você, senão a em execução, senão a primeira. */
export function pickTerminalTab(tabs, wanted = null) {
  const list = arr(tabs);
  if (!list.length) return null;
  return (list.find((t) => t.terminalId === wanted) ?? list.find((t) => t.stepStatus === 'waiting') ?? list.find((t) => t.stepStatus === 'running') ?? list[0]).terminalId;
}
