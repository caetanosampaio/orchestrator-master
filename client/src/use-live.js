import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useAutoOpenPref } from './hooks.js';
import { BUSY_OFF_MS, PREVIEW_POLL_MS, autoOpenStep, buildPreviewUrl, changesKey, missionProgress, nextPollMs, pollAction, previewPollMs, reloadDecision, workspaceBusy } from './live-view.js';

const hostname = () => { try { return globalThis.location?.hostname ?? ''; } catch { return ''; } };

/**
 * Preview por arquivos do projeto (servidor estático do FORGE, rotas /api/live/preview).
 * POST ao ativar (liga o listener sob demanda); depois GET a cada ~2 s com a aba visível: sem efeito colateral, só lê a versão dos arquivos.
 * Se o servidor derrubou o listener por ociosidade (running:false) e o preview está disponível, faz POST de novo e a URL (porta) se adapta.
 * Devolve { status: 'loading'|'ready'|'unavailable'|'error', reason, url, version, info, reloadKey, refresh }: o iframe é remontado quando `reloadKey` muda
 * (versão nova dos arquivos, no mínimo 1,5 s entre recargas, ou porta nova).
 */
export function usePreviewInfo(wsId, active) {
  const [info, setInfo] = useState(null);                 // último { available, port, path, ... } conhecido
  const [status, setStatus] = useState('loading');
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(null);               // versão exibida no iframe
  const [nonce, setNonce] = useState(0);                  // recarga manual
  // estado mutável fora do render: workspace atual, uma chamada por vez, última recarga, resposta do POST (o GET não repete path/entry) e o temporizador do intervalo mínimo
  const ref = useRef({ ws: null, alive: false, busy: false, lastReload: 0, timer: null, shown: null, port: null, meta: null }).current;
  const clearTimer = useCallback(() => { if (ref.timer) { clearTimeout(ref.timer); ref.timer = null; } }, [ref]);
  const reset = useCallback(() => { clearTimer(); ref.shown = null; ref.port = null; ref.meta = null; setInfo(null); setShown(null); }, [ref, clearTimer]);

  /** Aceita um preview disponível: atualiza a informação na hora; a versão (o que remonta o iframe) respeita o intervalo mínimo entre recargas, e uma porta nova recarrega logo. */
  const adopt = useCallback((next) => {
    const portChanged = ref.port !== null && next.port !== ref.port;
    ref.port = next.port; ref.meta = next;
    setInfo((cur) => (cur && JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    setStatus('ready'); setReason('');
    const version = next.version ?? '';
    const d = reloadDecision({ shown: portChanged ? null : ref.shown, next: version, lastAt: ref.lastReload });
    if (!d.reload) return;
    const ws = ref.ws;
    const apply = () => { if (!ref.alive || ref.ws !== ws) return; ref.timer = null; ref.shown = version; ref.lastReload = Date.now(); setShown(version); };
    clearTimer();
    if (d.wait <= 0) apply(); else ref.timer = setTimeout(apply, d.wait);
  }, [ref, clearTimer]);

  const unavailable = useCallback((why) => { reset(); setStatus('unavailable'); setReason(why); }, [reset]);

  const start = useCallback(async () => {
    const ws = ref.ws;
    if (!ws || ref.busy) return;
    ref.busy = true;
    try {
      const r = await api.post('/api/live/preview', { workspaceId: ws });
      if (!ref.alive || ref.ws !== ws) return;
      if (r?.available === true) adopt(r); else unavailable(String(r?.reason ?? 'no-index'));
    } catch { if (ref.alive && ref.ws === ws) setStatus((s) => (s === 'ready' ? s : 'error')); } finally { ref.busy = false; }
  }, [ref, adopt, unavailable]);

  const poll = useCallback(async () => {
    const ws = ref.ws;
    if (!ws || ref.busy) return;
    ref.busy = true;
    let relight = false;
    try {
      const r = await api.get(`/api/live/preview?workspaceId=${encodeURIComponent(ws)}`);
      if (!ref.alive || ref.ws !== ws) return;
      const act = pollAction(r, !!ref.meta); // sem `return` dentro do try: ele pularia o start() abaixo (era o defeito que impedia religar o preview)
      if (act === 'unavailable') unavailable('no-index');
      else if (act === 'relight') relight = true; // listener derrubado por ociosidade (ou o index.html acabou de aparecer): religa pelo POST (porta nova)
      else adopt({ ...ref.meta, port: r.port, version: r.version, files: r.files, truncated: r.truncated, docroot: r.docroot });
    } catch { /* erro passageiro: o último preview continua na tela e a próxima leitura tenta de novo */ } finally { ref.busy = false; }
    if (relight) start();
  }, [ref, adopt, unavailable, start]);

  useEffect(() => {
    ref.alive = true;
    if (ref.ws !== wsId) { ref.ws = wsId; reset(); setStatus('loading'); setReason(''); }
    if (!wsId || !active) return () => { ref.alive = false; clearTimer(); };
    start();
    let t = null;
    const loop = () => { t = setTimeout(() => { if (previewPollMs({ hidden: document.hidden, active })) poll(); loop(); }, PREVIEW_POLL_MS); };
    loop();
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { ref.alive = false; clearTimeout(t); clearTimer(); document.removeEventListener('visibilitychange', vis); };
  }, [wsId, active, start, poll, reset, clearTimer, ref]);

  const url = info ? buildPreviewUrl(hostname(), info) : null;
  const refresh = useCallback(() => { setNonce((n) => n + 1); start(); }, [start]);
  return { status, reason, url, version: info?.version ?? null, info, reloadKey: `${info?.port ?? ''}:${shown ?? ''}:${nonce}`, refresh };
}

/**
 * Arquivos criados/alterados do workspace (GET /api/live/changes): a cada 3 s com a equipe trabalhando, 10 s caso contrário, nada com a aba do navegador
 * oculta ou a aba Construção fora de vista. O estado só muda se o conteúdo mudou (sem repintar à toa).
 * Devolve { data, failure, loading, refresh }.
 */
export function useChanges(wsId, active, busy) {
  const [data, setData] = useState(null), [failure, setFailure] = useState(null), [loading, setLoading] = useState(true);
  const last = useRef(''), alive = useRef(true), inflight = useRef(false), ws = useRef(wsId);
  ws.current = wsId;
  const load = useCallback(async () => {
    if (!wsId || inflight.current) return;
    inflight.current = true;
    try {
      const r = await api.get(`/api/live/changes?workspaceId=${encodeURIComponent(wsId)}`);
      if (!alive.current || ws.current !== wsId) return;
      const k = changesKey(r);
      if (k !== last.current) { last.current = k; setData(r); }
      setFailure(null);
    } catch (e) {
      if (alive.current && ws.current === wsId) setFailure(e?.status === 404 ? 'Workspace não encontrado.' : e?.status ? (e.message || `Erro ${e.status}`) : 'Não foi possível falar com o servidor do FORGE.');
    } finally { inflight.current = false; if (alive.current) setLoading(false); }
  }, [wsId]);
  useEffect(() => { last.current = ''; setData(null); setFailure(null); setLoading(true); }, [wsId]);
  useEffect(() => {
    alive.current = true;
    if (!wsId || !active) return () => { alive.current = false; };
    load();
    let t = null;
    const poll = () => nextPollMs({ hidden: document.hidden, active, busy });
    const loop = () => { t = setTimeout(() => { if (poll()) load(); loop(); }, poll() || 3000); };
    loop();
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive.current = false; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
  }, [wsId, active, busy, load]);
  return { data, failure, loading, refresh: load };
}

/**
 * Abre o painel Live sozinho quando a equipe do workspace aberto começa a trabalhar (preferência `liveAutoOpen`, padrão ligada).
 * NÃO grava `forge.live.open`, não usa focus() e não rola a página: só chama `open({ mission })` (o App faz setLiveOpen(true)).
 * O "trabalhando" só vira falso depois de BUSY_OFF_MS estável: um agente ocioso entre etapas não conta como fim do trabalho (nem reabre o painel que o usuário fechou).
 */
export function useLiveAutoOpen({ wsId, flows, sessions, workingIds, liveOpen, open }) {
  const [enabled] = useAutoOpenPref();
  const raw = workspaceBusy(wsId, { flows, sessions, workingIds });
  const [held, setHeld] = useState(() => ({ ws: wsId, v: raw }));
  const busy = held.ws === wsId ? held.v : raw; // ao trocar de workspace vale o estado dele, não o resto do anterior
  const mem = useRef(null), openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (raw) { setHeld((h) => (h.ws === wsId && h.v ? h : { ws: wsId, v: true })); return undefined; }
    const t = setTimeout(() => setHeld({ ws: wsId, v: false }), BUSY_OFF_MS);
    return () => clearTimeout(t);
  }, [raw, wsId]);
  const ready = flows != null && sessions != null; // /api/flows e /api/terminals já responderam: só então há linha de base
  useEffect(() => {
    if (!ready) return;
    if (mem.current && mem.current.ws !== wsId) mem.current = null; // workspace novo: nova linha de base, sem disparo
    const first = !mem.current;
    const r = autoOpenStep(mem.current?.m ?? null, { busy: first ? raw : busy, liveOpen, enabled });
    mem.current = { ws: wsId, m: r.mem };
    if (r.open) openRef.current?.({ mission: !!missionProgress(flows, wsId) });
  }, [busy, liveOpen, enabled, wsId, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- `raw` e `flows` só servem de linha de base e de dica de aba
  return busy;
}
