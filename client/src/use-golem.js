// Estado do golem no cliente (um só para o app): os tokens de todas as IAs (GET /api/provider-activity?days=0, a cada 30 s com a aba visível), o nome e a última fase vista
// (GET/PUT /api/golem) e o "ao vivo" (agentes trabalhando agora, fim de trabalho), que o App informa. A seção do golem e a barra de status leem daqui.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { normalizeActivity } from './home-view.js';
import { stageFor, totalsByProvider, alloyOf, records, liveMood, cleanName, STAGES } from './golem.js';

const POLL_MS = 30_000;
let snap = { activity: null, name: '', seenStage: null, loaded: false, error: null, working: 0, lastActive: null, lastEnd: null, tick: 0 };
const subs = new Set();
const set = (patch) => { snap = { ...snap, ...patch }; for (const f of subs) f(); };
let started = false;

async function loadActivity() {
  try {
    const a = normalizeActivity(await api.get('/api/provider-activity?days=0'));
    if (a) set({ activity: a, error: null });
    else if (!snap.activity) set({ error: 'O servidor respondeu em um formato inesperado.' });
  } catch (e) { if (!snap.activity) set({ error: e?.status === 404 ? 'Este servidor ainda não conta os tokens. Atualize o FORGE.' : 'Sem conexão com o servidor do FORGE.' }); }
}
async function loadGolem() {
  try { const g = await api.get('/api/golem'); set({ name: typeof g?.name === 'string' ? g.name : '', seenStage: Number.isInteger(g?.seenStage) ? g.seenStage : null }); } catch { /* sem a rota: nome vazio, sem animação gravada */ }
  set({ loaded: true });
}

/** Liga o golem (uma vez, no App). */
export function startGolem() {
  if (started) return; started = true;
  loadGolem(); loadActivity();
  setInterval(() => { if (!document.hidden) loadActivity(); }, POLL_MS);
  setInterval(() => { if (!document.hidden) set({ tick: snap.tick + 1 }); }, 5000); // o "ao vivo" muda com o tempo (comemorar acaba, cochilar começa)
  addEventListener('visibilitychange', () => { if (!document.hidden) loadActivity(); });
}

export const golemActions = {
  async rename(name) { const n = cleanName(name); const g = await api.put('/api/golem', { name: n }); set({ name: g.name }); },
  /** Grava a fase já mostrada (a animação de evolução não toca de novo). */
  async markSeen(index) { set({ seenStage: index }); try { await api.put('/api/golem', { seenStage: index }); } catch { /* tenta de novo na próxima abertura */ } },
  refresh: loadActivity,
};

/** Visão calculada: fase, liga, recordes e humor ao vivo. */
export function golemView(s = snap, now = Date.now()) {
  const totals = totalsByProvider(s.activity), rec = records(s.activity, new Date(now));
  return {
    loaded: s.loaded && s.activity !== null, error: s.error, name: s.name, seenStage: s.seenStage,
    totals, total: rec.total, records: rec, ...stageFor(rec.total), alloy: alloyOf(totals),
    mood: liveMood({ working: s.working, lastActive: s.lastActive, lastEnd: s.lastEnd, now }), working: s.working, stages: STAGES,
  };
}
export function useGolem() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap, () => snap);
  return golemView(s);
}

/**
 * No App: informa o "ao vivo" (quantos agentes trabalham agora e cada fim de trabalho) e avisa quando o golem evolui com o app aberto.
 * `notify(texto)` = o aviso do app (store.notify).
 */
export function useGolemLive({ workingIds, workEnds, notify }) {
  const ends = useRef(null), stage = useRef(null);
  useEffect(() => {
    const n = workingIds?.size ?? 0;
    if (n !== snap.working || n > 0) set({ working: n, ...(n > 0 ? { lastActive: Date.now() } : {}) });
  }, [workingIds]);
  useEffect(() => {
    const cur = workEnds && typeof workEnds === 'object' ? workEnds : {};
    if (ends.current && Object.entries(cur).some(([ws, at]) => ends.current[ws] !== at)) { set({ lastEnd: Date.now(), lastActive: Date.now() }); loadActivity(); } // trabalho terminou: comemora e relê os tokens
    ends.current = cur;
  }, [workEnds]);
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap, () => snap);
  const idx = s.activity ? stageFor(records(s.activity).total).index : null;
  useEffect(() => {
    if (idx === null) return;
    if (stage.current !== null && idx > stage.current) notify?.(`Seu golem evoluiu: agora é ${STAGES[idx].label}! Abra Configurações > Golem para ver.`);
    stage.current = idx;
  }, [idx, notify]);
}
