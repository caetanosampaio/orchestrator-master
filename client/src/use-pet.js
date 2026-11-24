// Estado do bichinho no cliente (um só para o app inteiro): carrega de GET /api/pet, deixa o tempo correr (tick a cada segundo com a aba visível), grava com PUT /api/pet
// depois de cada ação e a cada 30 s quando mudou, e cuida do saldo de petiscos (ganhar e gastar são do servidor). A barra de status e a seção do bichinho leem daqui.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { newPet, normalizePet, tick, fastForward, feedTreat, mood, treatKey } from './pet.js';

let snap = { pet: null, treats: 0, loaded: false, error: null };
const subs = new Set();
const emit = () => { for (const f of subs) f(); };
const set = (patch) => { snap = { ...snap, ...patch }; emit(); };
let started = false, lastSaved = '', saving = null;

async function load() {
  try {
    const d = await api.get('/api/pet');
    const fresh = !d?.state, pet = tick(fresh ? newPet() : normalizePet(d.state));
    set({ pet, treats: Number.isInteger(d?.treats) ? d.treats : 0, loaded: true, error: null });
    if (fresh) save(true); // primeiro uso: o ovo nasce já gravado
  } catch (e) {
    set({ loaded: true, error: e?.status === 404 ? 'Este servidor ainda não tem o bichinho. Atualize o FORGE.' : 'Sem conexão com o servidor do FORGE; o bichinho volta quando ela voltar.' });
  }
}

/** Grava o estado (só se mudou, salvo `force`). Uma gravação por vez; falha tenta de novo na próxima. */
async function save(force = false) {
  const p = snap.pet; if (!p) return;
  const j = JSON.stringify(p); if (!force && j === lastSaved) return;
  if (saving) { await saving.catch(() => {}); }
  lastSaved = j;
  saving = api.put('/api/pet', { state: p }).catch(() => { lastSaved = ''; });
  await saving; saving = null;
}

/** O tempo corre: só emite quando um passo de 1 minuto passou ou o ovo chocou (evita redesenhar a tela toda a cada segundo). */
function advance() {
  const p = snap.pet; if (!p) return;
  const n = tick(p);
  if (n.at !== p.at || n.stage !== p.stage) set({ pet: n });
}

/** Liga o bichinho (uma vez, no App). */
export function startPet() {
  if (started) return; started = true;
  load();
  setInterval(() => { if (!document.hidden) advance(); }, 1000);
  setInterval(() => { save(false); }, 30_000);
  addEventListener('visibilitychange', () => { if (document.hidden) save(false); else advance(); });
}

export const petActions = {
  /** Aplica uma ação pura de pet.js (feedMeal, clean, pat...) ao estado em dia e grava. Devolve o resultado { ok, effect, message? }. */
  apply(fn, ...args) {
    if (!snap.pet) return { ok: false, message: 'O bichinho ainda está carregando.' };
    const r = fn(tick(snap.pet), ...args);
    set({ pet: r.pet }); save(true);
    return r;
  },
  /** Come um petisco: gasta 1 no servidor (409 sem saldo) e só então aplica o efeito. */
  async eatTreat() {
    if (!snap.pet) return { ok: false, message: 'O bichinho ainda está carregando.' };
    const pre = feedTreat(tick(snap.pet)); if (!pre.ok) return pre; // dormindo, doente...: nem gasta
    try { const d = await api.post('/api/pet/treats/use'); set({ treats: d.treats }); } catch (e) { return { ok: false, message: e?.message || 'Não foi possível usar o petisco.' }; }
    return this.apply(feedTreat);
  },
  /** Ganha um petisco por um fim de trabalho (chave deduplicada no servidor). */
  async award(key) {
    try { const d = await api.post('/api/pet/treats', { key }); set({ treats: d.treats }); return d.added === true; } catch { return false; }
  },
  /** Teste: adianta o relógio. */
  fastForward(delta) { if (snap.pet) { set({ pet: fastForward(snap.pet, delta) }); save(true); } },
  /** Recomeça com um ovo novo. */
  restart() { set({ pet: newPet() }); save(true); },
};

/** { pet, treats, loaded, error, mood } — reativo. */
export function usePet() {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap, () => snap);
  return s;
}
export const petMood = (s) => (s?.pet ? mood(s.pet) : null);

const ACTIVE_RUN = ['running', 'interrupted', 'ready_to_integrate'];
/**
 * Petiscos ganhos com o trabalho dos agentes (no App, uma vez): cada fim de trabalho de um workspace (store.workEnds) e cada missão que TERMINA concluída enquanto o FORGE
 * está aberto vale 1 petisco. O que já estava assim ao abrir não conta (só transições vistas agora). A chave vai ao servidor, que ignora repetidas (outra aba, recarregamento).
 */
export function usePetTreats({ workEnds, flows }) {
  const ends = useRef(null), runs = useRef(null);
  useEffect(() => {
    const cur = workEnds && typeof workEnds === 'object' ? workEnds : {};
    if (ends.current) for (const [ws, at] of Object.entries(cur)) if (ends.current[ws] !== at) petActions.award(treatKey('work', ws, at));
    ends.current = cur;
  }, [workEnds]);
  useEffect(() => {
    const cur = new Map();
    for (const f of Array.isArray(flows) ? flows : []) { const r = f?.activeRun ?? f?.lastRun; if (r && typeof r.id === 'string') cur.set(r.id, r.status); }
    if (runs.current) for (const [id, st] of cur) if (st === 'completed' && ACTIVE_RUN.includes(runs.current.get(id))) petActions.award(treatKey('run', id, 'ok'));
    runs.current = cur;
  }, [flows]);
}
