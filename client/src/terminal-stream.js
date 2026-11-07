// Uma única conexão SSE (/api/terminals/stream) para a saída de TODOS os terminais. O navegador limita ~6 conexões por origem: uma por pane travava a tela com 7+ terminais.
// Guarda a tela atual de cada terminal (limitada) para o pane que monta depois dos primeiros dados receber o que já foi impresso. Sem React; o EventSource é injetável nos testes.

export const SCREEN_LIMIT = 400_000;
export const REPLAY_QUIET_MS = 5000;
/**
 * O terminal já vive há tempo suficiente para que as PERGUNTAS gravadas na saída (identificação, posição do cursor, foco) sejam passado: o Claude Code não espera mais resposta a elas.
 * Ao reconstruir a tela de um terminal assim, o xterm não pode responder de novo: as respostas chegariam ao Claude Code vivo como teclas. Terminal recém-criado continua respondendo.
 */
export const isOld = (startedAt, now = Date.now()) => { const t = Date.parse(startedAt); return Number.isFinite(t) && now - t > REPLAY_QUIET_MS; };

export const RECONNECT_MIN_MS = 1000, RECONNECT_MAX_MS = 15000;

export function createTerminalStream({ url = '/api/terminals/stream', EventSourceImpl = globalThis.EventSource, setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout } = {}) {
  const screens = new Map();   // id -> texto já impresso (cauda)
  const exited = new Map();    // id -> código de saída
  const subs = new Map();      // id -> Set<{ onReset, onData, onExit }>
  let es = null, closed = false;
  // Reconexão: o EventSource só reconecta sozinho em queda de rede; com 429 (limite de conexões) ou queda definitiva ele fica CLOSED e os terminais ficariam mudos sem aviso.
  let status = 'connecting', delay = RECONNECT_MIN_MS, retry = null;
  const statusSubs = new Set();
  const setStatus = (v) => { if (v === status) return; status = v; for (const f of [...statusSubs]) { try { f(v); } catch { /* ouvinte com defeito */ } } };
  const alive = () => { delay = RECONNECT_MIN_MS; setStatus('open'); };
  const each = (id, fn) => { for (const s of subs.get(id) ?? []) { try { fn(s); } catch { /* um pane com defeito não derruba os outros */ } } };
  const parse = (e) => { try { const m = JSON.parse(e.data); return m && typeof m.id === 'string' ? m : null; } catch { return null; } };
  const clip = (t) => (t.length > SCREEN_LIMIT ? t.slice(-SCREEN_LIMIT) : t);

  function open() {
    if (es || closed || !EventSourceImpl) return;
    const cur = new EventSourceImpl(url); es = cur;
    cur.onopen = () => { if (es === cur) setStatus('open'); };
    cur.onerror = () => {
      if (es !== cur || closed || cur.readyState !== 2) return; // 2 = CLOSED; em CONNECTING o navegador já está tentando
      try { cur.close(); } catch { /* já fechado */ }
      es = null; setStatus('reconnecting');
      if (retry) return;
      const wait = delay; delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      retry = setTimeoutImpl(() => { retry = null; open(); }, wait);
    };
    es.addEventListener('init', (e) => { alive(); const m = parse(e); if (!m) return; screens.set(m.id, clip(String(m.replay ?? ''))); exited.delete(m.id); each(m.id, (s) => s.onReset?.(screens.get(m.id))); });
    es.addEventListener('data', (e) => { alive(); const m = parse(e); if (!m || typeof m.d !== 'string') return; screens.set(m.id, clip((screens.get(m.id) ?? '') + m.d)); each(m.id, (s) => s.onData?.(m.d)); });
    es.addEventListener('exit', (e) => { const m = parse(e); if (!m) return; exited.set(m.id, m.exitCode ?? null); each(m.id, (s) => s.onExit?.(m.exitCode ?? null)); });
    es.addEventListener('closed', (e) => { const m = parse(e); if (!m) return; screens.delete(m.id); exited.delete(m.id); });
  }

  /** Inscreve um pane. Se já há tela guardada, `onReset` recebe-a na hora (e `onExit`, se o processo já acabou). Devolve a função de cancelar. */
  function subscribe(id, handlers) {
    if (!retry) open(); // com uma reabertura já agendada (recuo crescente), um pane novo espera a vez em vez de reabrir na hora
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id).add(handlers);
    if (screens.has(id)) handlers.onReset?.(screens.get(id));
    if (exited.has(id)) handlers.onExit?.(exited.get(id));
    return () => { subs.get(id)?.delete(handlers); if (!subs.get(id)?.size) subs.delete(id); };
  }
  /** Ouve o estado da conexão ('connecting' | 'open' | 'reconnecting'); devolve a função de cancelar. */
  const onStatus = (fn) => { statusSubs.add(fn); return () => statusSubs.delete(fn); };
  const close = () => { closed = true; if (retry) { clearTimeoutImpl(retry); retry = null; } statusSubs.clear(); try { es?.close(); } catch { /* já fechado */ } es = null; subs.clear(); screens.clear(); exited.clear(); };
  return { subscribe, close, onStatus, status: () => status, screenOf: (id) => screens.get(id) ?? null };
}
