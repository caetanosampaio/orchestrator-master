// Acompanhamento do "Testar integração", FORA do componente: sobrevive a sair das Configurações (para responder a um pedido da IA no Cockpit) e a trocar de IA no
// detalhe. Um teste por IA. Consulta GET /api/terminals por conta própria (a lista do app pausa com a janela oculta) e, quando o terminal conecta, fecha-o.
// Dependências injetáveis (post, get, relógio, intervalo, confirmação): testado a partir de server/test/.
import { INTEGRATION_WATCH_MS, integrationTerminalBody, integrationVerdict, integrationOpenError } from './integration-check.js';

const FINAL = new Set(['ok', 'ended', 'nocoord', 'outdated', 'error', 'closed']);

export function createIntegrationRunner({ post, get, now = Date.now, every = setInterval, cancel = clearInterval, tickMs = 1000, watchMs = INTEGRATION_WATCH_MS, confirm = () => false } = {}) {
  const tests = new Map(); // provider -> { id, startedAt, listed, verdict }
  const subs = new Set();
  let timer = null, ticking = false;
  const emit = () => { for (const fn of subs) { try { fn(); } catch { /* quem assina cuida do próprio erro */ } } };
  const set = (provider, patch) => { tests.set(provider, { ...(tests.get(provider) ?? {}), ...patch }); emit(); };
  const watching = () => [...tests.values()].some((t) => t.id && !FINAL.has(t.verdict?.kind));
  const stopIfIdle = () => { if (timer && !watching()) { cancel(timer); timer = null; } };
  const ensureTimer = () => { if (!timer && watching()) timer = every(() => { tick(); }, tickMs); };
  const closeTerminal = async (id) => { try { await post(`/api/terminals/${encodeURIComponent(id)}/close`); return true; } catch { return false; } };

  async function tick() {
    if (ticking) return; ticking = true; // uma consulta por vez
    try {
      let sessions;
      try { sessions = (await get('/api/terminals'))?.sessions; } catch { return; } // servidor indisponível: não conta como "terminou" nem adianta o veredito
      if (!Array.isArray(sessions)) return;
      for (const [provider, t] of tests) {
        if (!t.id || FINAL.has(t.verdict?.kind)) continue;
        const session = sessions.find((s) => s?.id === t.id) ?? null, listed = t.listed || !!session, at = now();
        let verdict = integrationVerdict({ session, listed, startedAt: t.startedAt, now: at });
        const watchedOut = verdict.kind === 'timeout' && at - t.startedAt >= watchMs; // parou de acompanhar com o terminal de teste ainda aberto
        if (watchedOut) verdict = { ...verdict, kind: 'ended', done: true, text: `${verdict.text.split(' O teste segue')[0]} O teste parou de acompanhar: use Fechar terminal de teste ou Testar de novo.` };
        const closed = verdict.kind === 'ok' ? await closeTerminal(t.id) : null;
        if (closed === false) verdict = { ...verdict, text: `${verdict.text} Não foi possível fechar o terminal de teste: feche-o no Cockpit.` };
        if (tests.get(provider)?.id !== t.id) continue; // durante o await o teste foi fechado ou refeito: esta leitura é de outro terminal
        set(provider, { listed, verdict, watchedOut, ...(closed === true ? { id: null } : {}) });
      }
    } finally { ticking = false; stopIfIdle(); }
  }

  /** Abre o terminal de teste da IA (fechando antes um de teste anterior dela que tenha ficado aberto) e começa a acompanhar. */
  async function start({ provider, name = provider, accountId = null }) {
    const prev = tests.get(provider);
    if (prev?.opening || (prev?.id && prev.verdict && !prev.verdict.done && prev.verdict.kind !== 'timeout')) return; // já testando
    // trava ANTES de qualquer await (duplo clique não abre dois terminais) e só então fecha o terminal de teste anterior: um só por IA
    set(provider, { id: null, opening: true, listed: false, verdict: { kind: 'waiting', done: false, text: 'Abrindo o terminal de teste…' } });
    if (prev?.id && !(await closeTerminal(prev.id))) {
      set(provider, { id: prev.id, opening: false, verdict: { kind: 'error', done: true, text: 'Não foi possível fechar o terminal de teste anterior: feche-o no Cockpit e teste de novo.' } });
      return;
    }
    const body = integrationTerminalBody({ provider, name, accountId });
    let r;
    try {
      try { r = await post('/api/terminals', body); } catch (e) {
        // configuração executável do projeto não revisada: só abre com a confirmação EXPLÍCITA do usuário, como qualquer terminal
        if (e?.code !== 'project_config_unreviewed' || !confirm(e)) throw e;
        r = await post('/api/terminals', { ...body, acknowledgeProjectConfig: true });
      }
      if (!r?.session?.id) throw new Error('O servidor não devolveu o terminal de teste.');
    } catch (e) { set(provider, { opening: false, verdict: { kind: 'error', done: true, text: integrationOpenError(e) } }); return; }
    set(provider, { id: r.session.id, startedAt: now(), opening: false, listed: false });
    ensureTimer(); tick();
  }

  /** Fecha o terminal de teste que ficou aberto (prazo esgotado ou sem coordenação) e esquece o teste. */
  async function close(provider) {
    const t = tests.get(provider); if (!t) return;
    if (t.id && !(await closeTerminal(t.id))) { set(provider, { verdict: { kind: 'error', done: true, text: 'Não foi possível fechar o terminal de teste: feche-o no Cockpit.' } }); stopIfIdle(); return; }
    tests.delete(provider); emit(); stopIfIdle();
  }

  return {
    start, close, tick,
    /** Estado do teste da IA: { verdict, open (há terminal de teste aberto), busy (abrindo ou no prazo) } ou null. */
    // open = ainda há um terminal de teste que o FORGE pode fechar (inclusive depois que o acompanhamento parou); um terminal que terminou sozinho não conta
    state: (provider) => { const t = tests.get(provider); if (!t) return null; const k = t.verdict?.kind; return { verdict: t.verdict ?? null, open: !!t.id && !t.opening && !(k === 'ended' && !t.watchedOut), busy: !!t.opening || (!!t.id && k === 'waiting') }; },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}
