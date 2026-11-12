// Limites das contas (funções puras, sem React): leitura de /api/limits, cor da barra pelo uso, tempo até o reset e resumo para acessibilidade.
// Regra de honestidade (a mesma de usage-view.js): sem dado = "—", nunca um percentual inventado. O servidor já omite janelas cujo reset passou; aqui também se confere o relógio.

export const DASH = '—';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Janela curta (5 h) e semanal: rótulos e textos. */
export const WINDOWS = Object.freeze([
  Object.freeze({ key: 'session', short: '5 h', label: 'Janela de 5 h', hint: 'Limite da janela de 5 horas (o "diário" da conta)' }),
  Object.freeze({ key: 'week', short: 'semana', label: 'Semana', hint: 'Limite semanal da conta' }),
]);

/** Porcentagem 0..100 (arredondada) ou null. */
export const clampPct = (v) => (isNum(v) ? Math.min(100, Math.max(0, v)) : null);

/**
 * Cor da barra pelo uso: verde enquanto sobra folga, passando por âmbar e ficando cada vez mais vermelha perto do fim (a partir de ~35 % de uso; vermelho pleno em ~95 %).
 * Contínua (HSL) para a barra "esquentar" aos poucos, não em degraus. Sem dado = cinza.
 */
export function usageColor(pct) {
  const p = clampPct(pct);
  if (p === null) return 'hsl(0 0% 40%)';
  const t = Math.min(1, Math.max(0, (p - 35) / 60)); // 0 até 35 %; 1 a partir de 95 %
  const hue = Math.round(142 - 142 * t);              // 142 (verde) -> 0 (vermelho)
  const sat = Math.round(62 + 18 * t), light = Math.round(46 + 2 * Math.sin(t * Math.PI));
  return `hsl(${hue} ${sat}% ${light}%)`;
}
/** Faixa para texto/estilo: 'ok' (< 60 %), 'warn' (60 a 85 %), 'crit' (>= 85 %), 'none' (sem dado). */
export const usageBand = (pct) => { const p = clampPct(pct); return p === null ? 'none' : p >= 85 ? 'crit' : p >= 60 ? 'warn' : 'ok'; };

/** Tempo até o reset, compacto como na barra: "40min", "9h", "3d". Passado ou inválido = null (a janela já reiniciou). */
export function fmtReset(resetsAt, now = Date.now()) {
  const t = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(t)) return null;
  const ms = t - now;
  if (ms <= 0) return null;
  if (ms < HOUR) return `${Math.max(1, Math.ceil(ms / MIN))}min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}
/** Tempo até o reset por extenso, para o painel: "2 h 10 min", "3 d 4 h". */
export function fmtResetLong(resetsAt, now = Date.now()) {
  const t = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(t) || t <= now) return null;
  const ms = t - now, d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${Math.max(1, m)} min`;
}
/** Dia e hora do reset no fuso do usuário: "hoje 18:35", "amanhã 09:00" ou "qui 12:00". */
export function fmtResetAt(resetsAt, now = Date.now()) {
  const t = typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t), n = new Date(now), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(n)) / DAY);
  if (days === 0) return `hoje ${hm}`;
  if (days === 1) return `amanhã ${hm}`;
  return `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()]} ${hm}`;
}

const cleanWindow = (w, now) => {
  if (!w || typeof w !== 'object') return null;
  const pct = clampPct(w.usedPct), at = Date.parse(w.resetsAt);
  if (pct === null || !Number.isFinite(at) || at <= now) return null; // reset já passou: o dado velho não vale como atual
  return { usedPct: pct, resetsAt: new Date(at).toISOString(), windowMinutes: isNum(w.windowMinutes) ? w.windowMinutes : null };
};
const SOURCES = new Set(['api', 'ultima-leitura', 'statusline', 'rollout', 'statusline-propria', 'desligado', 'sem-dados']);

/**
 * Normaliza a resposta de /api/limits. Servidor antigo (sem a rota) ou resposta inválida = null (a barra mostra "—").
 * Cada conta ganha `index` (1, 2, 3 ... só para as do Claude Code, na ordem) e `critical`: a janela mais perto do limite (a que define o tempo mostrado ao lado das barras).
 * @returns {null | { providers: Array<{ provider: string, label: string, accounts: Array<object> }> }}
 */
export function normalizeLimits(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.providers)) return null;
  const providers = raw.providers.filter((p) => p && typeof p.provider === 'string' && Array.isArray(p.accounts)).map((p) => {
    let n = 0;
    const accounts = p.accounts.filter((a) => a && typeof a.id === 'string').map((a) => {
      const session = cleanWindow(a.session, now), week = cleanWindow(a.week, now);
      const critical = [['session', session], ['week', week]].filter(([, w]) => w).sort((x, y) => y[1].usedPct - x[1].usedPct || Date.parse(x[1].resetsAt) - Date.parse(y[1].resetsAt))[0]?.[0] ?? null;
      return {
        id: a.id, label: typeof a.label === 'string' && a.label ? a.label : a.id, connected: a.connected === true ? true : a.connected === false ? false : null,
        plan: typeof a.plan === 'string' && a.plan ? a.plan : null, source: SOURCES.has(a.source) ? a.source : 'sem-dados', session, week, critical,
        updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : null, index: p.provider === 'claude' ? ++n : null,
      };
    });
    return { provider: p.provider, label: typeof p.label === 'string' ? p.label : p.provider, accounts };
  });
  return { providers };
}

/** Contas que aparecem na barra: as conectadas (ou de conexão não verificada) de cada provedor; conta explicitamente desconectada não ocupa espaço. */
export const visibleAccounts = (provider) => (provider?.accounts ?? []).filter((a) => a.connected !== false);

/**
 * Resumo de UM provedor para as 2 barras do topo: para cada janela, a conta mais perto do limite (maior uso; empate: reset mais cedo), e qual das duas janelas é a mais crítica.
 * Com uma conta só (o comum), é a própria conta. `accounts` = as contas conectadas, para o painel.
 */
export function providerSummary(provider) {
  const accounts = visibleAccounts(provider);
  const pick = (key) => accounts.map((a) => a[key]).filter(Boolean).sort((x, y) => y.usedPct - x.usedPct || Date.parse(x.resetsAt) - Date.parse(y.resetsAt))[0] ?? null;
  const session = pick('session'), week = pick('week');
  const critical = session && week ? (week.usedPct >= session.usedPct ? 'week' : 'session') : session ? 'session' : week ? 'week' : null;
  return { provider: provider?.provider ?? '', label: provider?.label ?? '', accounts, session, week, critical };
}

/** Tempo (compacto) mostrado ao lado das barras: o reset da janela mais crítica; sem dado = "—". */
export function resetLabel(account, now = Date.now()) {
  const w = account?.critical ? account[account.critical] : null;
  return w ? fmtReset(w.resetsAt, now) ?? DASH : DASH;
}

/** Idade de uma leitura: "agora há pouco" até 1 min; depois minutos, horas ou dias. null se o instante é inválido ou futuro. */
export function fmtAgo(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t) || t > now + 60_000) return null;
  const m = Math.floor((now - t) / 60_000);
  return m < 1 ? 'menos de 1 min' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
}
export const STALE_READING_MS = 5 * 60_000;
/** Aviso quando as barras vêm de uma leitura que não é recente (o provedor não respondeu agora, o login venceu ou o app acabou de abrir): o valor continua valendo, e a idade aparece. */
export function staleNote(account, now = Date.now()) {
  if (!account || (!account.session && !account.week) || account.source !== 'ultima-leitura') return null; // só a leitura guardada/antiga do provedor: status line e rollout de sessão ociosa não são "o provedor não respondeu"
  const t = Date.parse(account.updatedAt); if (!Number.isFinite(t) || now - t < STALE_READING_MS) return null;
  const ago = fmtAgo(account.updatedAt, now); return ago ? `Última leitura há ${ago}; atualiza sozinha assim que o provedor responder (o valor não zera ao reabrir o app).` : null;
}

/** Explica por que uma conta está sem barras (texto do painel). */
export function sourceNote(account, providerId) {
  switch (account?.source) {
    case 'statusline-propria': return 'Esta conta usa uma status line própria no settings do Claude Code; o FORGE não a substitui, então não há leitura do limite.';
    case 'desligado': return 'Leitura de limites desligada (ORCH_CLAUDE_STATUSLINE=off).';
    case 'sem-dados': return providerId === 'codex' ? 'Sem sessões recentes do Codex com leitura de limite ainda.' : 'Aguardando a primeira resposta de uma sessão desta conta (o limite só é informado depois dela, e só para assinantes Pro/Max).';
    default: return null;
  }
}

/** Resumo para leitor de tela e tooltip. */
export function limitsSummary(norm, now = Date.now()) {
  if (!norm) return 'Limites das contas: sem leitura.';
  const parts = [];
  for (const p of norm.providers) for (const a of visibleAccounts(p)) {
    const w = (win) => (a[win.key] ? `${win.short} ${Math.round(a[win.key].usedPct)}% (reseta em ${fmtResetLong(a[win.key].resetsAt, now) ?? 'instantes'})` : null);
    const bits = WINDOWS.map(w).filter(Boolean);
    parts.push(`${p.label}${a.index ? ` conta ${a.index}` : ''}${a.label && p.provider === 'claude' ? ` (${a.label})` : ''}: ${bits.length ? bits.join(', ') : 'sem leitura'}`);
  }
  return parts.length ? `Limites das contas. ${parts.join('. ')}.` : 'Limites das contas: nenhuma conta conectada.';
}
