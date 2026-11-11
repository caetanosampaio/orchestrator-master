// Página Início: lógica PURA (sem React, sem rede). Agrega a atividade de tokens por provider (GET /api/provider-activity), formata em PT-BR (mi, mil) e organiza os workspaces recentes.
// Nada é inventado: sem dados do servidor não há barras nem totais; os dias são sempre os do fuso LOCAL da máquina (AAAA-MM-DD), como o servidor os entrega.
import { catalogById } from './provider-catalog.js';
import { friendlyNames } from './env-view.js';

export const PERIODS = Object.freeze([
  Object.freeze({ id: '30', days: 30, label: '30 dias' }),
  Object.freeze({ id: '90', days: 90, label: '90 dias' }),
  Object.freeze({ id: '0', days: 0, label: 'Desde o início' }), // days=0: tudo, o mesmo valor que a rota entende
]);
export const MODES = Object.freeze([
  Object.freeze({ id: 'daily', label: 'Diariamente', noun: 'dia' }),
  Object.freeze({ id: 'weekly', label: 'Semanal', noun: 'semana' }),
  Object.freeze({ id: 'cumulative', label: 'Acumulado', noun: 'dia' }),
]);
export const periodById = (id) => PERIODS.find((p) => p.id === String(id)) ?? PERIODS[0];
export const modeById = (id) => MODES.find((m) => m.id === id) ?? MODES[0];
export const FALLBACK_COLOR = '#8a8f98';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ---------- dias locais (AAAA-MM-DD) ----------
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const p2 = (n) => String(n).padStart(2, '0');
/** Chave AAAA-MM-DD do dia LOCAL de uma data. */
export const dayKey = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
/** Date (meio-dia local, a salvo de virada de horário de verão) de uma chave válida; `null` se a chave não é um dia real. */
export function parseDay(key) {
  const m = DAY_RE.exec(String(key ?? '')); if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])], dt = new Date(y, mo - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}
export const addDays = (key, n) => { const d = parseDay(key); if (!d) return key; d.setDate(d.getDate() + n); return dayKey(d); };
const weekStart = (key) => addDays(key, -((parseDay(key).getDay() + 6) % 7)); // segunda-feira
/** "12 de outubro de 2026". */
export function longDate(key) { const d = parseDay(key); return d ? `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}` : ''; }
/** "12 out." */
export function shortDate(key) { const d = parseDay(key); return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : ''; }
/** "terça-feira, 11 de novembro de 2026". */
export function fullDate(key) { const d = parseDay(key); return d ? `${WEEKDAYS[d.getDay()]}, ${longDate(key)}` : ''; }

// ---------- números em PT-BR ----------
const dec = (n, max) => { const s = n.toLocaleString('pt-BR', { maximumFractionDigits: max, minimumFractionDigits: 0 }); return s; };
/**
 * Abreviação em PT-BR com 3 algarismos significativos: 485 mi, 20,6 mi, 2 mi, 218 mil, 89,4 mil, 1,2 bi. Abaixo de mil, o número inteiro. Não-número vira "0".
 */
export function fmtTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v < 1000) return String(Math.round(v));
  const units = [[1e9, 'bi'], [1e6, 'mi'], [1e3, 'mil']];
  for (let i = 0; i < units.length; i++) {
    const [div, name] = units[i];
    if (v < div) continue;
    const x = v / div, digits = x >= 100 ? 0 : x >= 10 ? 1 : 2, r = Number(x.toFixed(digits));
    if (r >= 1000 && i > 0) return `${dec(1, 0)} ${units[i - 1][1]}`; // 999,9 mil arredonda para 1 mi
    return `${dec(r, digits)} ${name}`;
  }
  return String(Math.round(v));
}
/** Valor exato com separador de milhar ("485.312.004"). */
export const fmtExact = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString('pt-BR') : '0');
/** Percentual para a legenda: "<1%" quando existe mas não chega a 1%. */
export function fmtPct(part, total) {
  if (!(total > 0) || !(part > 0)) return '0%';
  const p = (part / total) * 100;
  return p < 1 ? '<1%' : `${Math.round(p)}%`;
}

// ---------- contrato de GET /api/provider-activity ----------
const nn = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
/**
 * Valida e limpa a resposta da rota. Devolve null se não é do formato do contrato (rota ausente servindo HTML, versão antiga, etc.): a tela mostra erro, nunca inventa dados.
 * Descarta provider sem id, dias com chave inválida e valores negativos ou não numéricos.
 */
export function normalizeActivity(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.providers)) return null;
  const providers = [];
  for (const p of raw.providers) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.days !== 'object' || !p.days) continue;
    const days = {};
    for (const [k, v] of Object.entries(p.days)) {
      if (!parseDay(k) || !v || typeof v !== 'object') continue;
      const io = nn(v.io), cache = nn(v.cache);
      if (io || cache) days[k] = { io, cache };
    }
    providers.push({ id: p.id, label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : null, accounts: nn(p.accounts), days });
  }
  return { generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null, sinceDay: parseDay(raw.sinceDay) ? raw.sinceDay : null, scanning: raw.scanning === true || raw.partial === true, providers }; // `partial`: a listagem das pastas foi incompleta nesta volta (pode haver mais dados): a tela não afirma "sem dados"
}

/** Nome e cor do provider: catálogo primeiro (a cor é a do FORGE), senão o que o servidor disse, senão o id. */
export const providerLook = (p) => ({ id: p.id, label: catalogById(p.id)?.label ?? p.label ?? p.id, color: catalogById(p.id)?.color ?? FALLBACK_COLOR });

const CATALOG_ORDER = ['claude', 'codex'];
const orderRank = (id) => { const i = CATALOG_ORDER.indexOf(id); return i < 0 ? 99 : i; };

/** Primeiro dia com consumo em qualquer provider (a janela "desde o início" começa aí); cai no `sinceDay` do servidor e, sem nada, em hoje. */
export function firstDay(activity, today) {
  let min = null;
  for (const p of activity?.providers ?? []) for (const k of Object.keys(p.days)) if (!min || k < min) min = k;
  return min ?? (activity?.sinceDay && activity.sinceDay <= today ? activity.sinceDay : today);
}

/** Janela mostrada: { start, end } em chaves de dia. 30/90 = os últimos N dias terminando hoje; 0 = do primeiro consumo até hoje. */
export function windowOf(activity, days, now = new Date()) {
  const end = dayKey(now);
  const start = days > 0 ? addDays(end, -(days - 1)) : firstDay(activity, end);
  return { start: start > end ? end : start, end };
}

const dayList = (start, end) => { const out = []; for (let k = start; k <= end && out.length < 20000; k = addDays(k, 1)) out.push(k); return out; };
const valueOf = (cell, withCache) => (cell ? cell.io + (withCache ? cell.cache : 0) : 0);

/**
 * Total por provider na janela (ordem: maior consumo primeiro; empate pelo catálogo). Só entram providers com consumo na janela.
 * @returns {{id,label,color,total,io,cache}[]}
 */
export function providerTotals(activity, win, withCache = false) {
  const rows = [];
  for (const p of activity?.providers ?? []) {
    let io = 0, cache = 0;
    for (const [k, c] of Object.entries(p.days)) if (k >= win.start && k <= win.end) { io += c.io; cache += c.cache; }
    const total = io + (withCache ? cache : 0);
    if (total > 0) rows.push({ ...providerLook(p), io, cache, total });
  }
  return rows.sort((a, b) => b.total - a.total || orderRank(a.id) - orderRank(b.id) || a.id.localeCompare(b.id));
}

/** Maior dia (soma dos providers) na janela: { day, total } ou null sem consumo. Sempre diário, qualquer que seja o modo do gráfico. */
export function peakDay(activity, win, withCache = false) {
  const sums = new Map();
  for (const p of activity?.providers ?? []) for (const [k, c] of Object.entries(p.days)) if (k >= win.start && k <= win.end) sums.set(k, (sums.get(k) ?? 0) + valueOf(c, withCache));
  let best = null;
  for (const [day, total] of sums) if (total > 0 && (!best || total > best.total || (total === best.total && day > best.day))) best = { day, total };
  return best;
}

/**
 * Barras empilhadas por provider.
 *  - daily: um bucket por dia da janela (dias sem consumo = barra vazia); weekly: por semana (segunda a domingo; as pontas da janela ficam parciais); cumulative: por dia, com o total acumulado desde o início da janela.
 * @returns {{buckets:{key,start,end,label,values:Object<string,number>,total:number}[], ids:string[], max:number}}
 */
export function buildSeries(activity, { win, mode = 'daily', withCache = false } = {}) {
  const totals = providerTotals(activity, win, withCache), ids = totals.map((t) => t.id);
  const providers = new Map((activity?.providers ?? []).map((p) => [p.id, p]));
  const days = dayList(win.start, win.end);
  const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
  let buckets;
  if (mode === 'weekly') {
    const byWeek = new Map();
    for (const d of days) {
      const w = weekStart(d), b = byWeek.get(w) ?? { key: w, start: d, end: d, values: zero(), total: 0 };
      b.end = d;
      for (const id of ids) { const v = valueOf(providers.get(id)?.days[d], withCache); b.values[id] += v; b.total += v; }
      byWeek.set(w, b);
    }
    buckets = [...byWeek.values()];
  } else {
    const run = zero();
    buckets = days.map((d) => {
      const values = zero(); let total = 0;
      for (const id of ids) {
        const v = valueOf(providers.get(id)?.days[d], withCache);
        if (mode === 'cumulative') { run[id] += v; values[id] = run[id]; } else values[id] = v;
        total += values[id];
      }
      return { key: d, start: d, end: d, values, total };
    });
  }
  for (const b of buckets) b.label = b.start === b.end ? fullDate(b.start) : `${shortDate(b.start)} a ${shortDate(b.end)}`;
  return { buckets, ids, max: buckets.reduce((m, b) => Math.max(m, b.total), 0) };
}

/** Marcas do eixo: o mês no primeiro bucket e em cada virada de mês ("out.", "nov."); janeiro e, com mais de um ano, o primeiro levam o ano. Marcas coladas (< 2 buckets) são descartadas. */
export function axisTicks(buckets) {
  const out = [];
  if (!buckets.length) return out;
  const years = new Set(buckets.map((b) => b.start.slice(0, 4)));
  let prev = '';
  buckets.forEach((b, i) => {
    const ym = b.start.slice(0, 7);
    if (ym === prev) return; prev = ym;
    const mo = Number(b.start.slice(5, 7)) - 1, last = out.at(-1);
    if (last && i - last.index < 2) return;
    out.push({ index: i, label: years.size > 1 && (mo === 0 || !out.length) ? `${MONTHS_SHORT[mo]} ${b.start.slice(0, 4)}` : MONTHS_SHORT[mo] });
  });
  return out;
}

/** Texto do cabeçalho do total. */
export const totalCaption = (withCache) => (withCache ? 'tokens (entrada, saída e cache)' : 'tokens (entrada e saída)');

// ---------- workspaces recentes ----------
const ts = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * "Há X": agora, há N min, há N h (até 24 h), ontem / há N dias (pelo calendário local), há N sem, há N meses, há N anos. Instante inválido ou futuro (relógio) = "agora".
 */
export function agoLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  const a = parseDay(dayKey(new Date(t))), b = parseDay(dayKey(new Date(now)));
  const d = Math.max(1, Math.round((b - a) / 86_400_000));
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  if (d < 30) return `há ${Math.floor(d / 7)} sem`;
  if (d < 365) return `há ${Math.floor(d / 30)} ${Math.floor(d / 30) === 1 ? 'mês' : 'meses'}`;
  return `há ${Math.floor(d / 365)} ${Math.floor(d / 365) === 1 ? 'ano' : 'anos'}`;
}

/**
 * Último uso de cada workspace = o instante mais recente entre: eventos do registro de atividade que citam o workspace (ativar, abrir, tópicos...), terminais dele (início, saída, fim),
 * missões e tópicos criados nele; sem nada disso, a data do cadastro. Só dados reais do servidor.
 * @returns {Map<string, number>} workspaceId -> ms
 */
export function lastUsedMap({ workspaces = [], activity = [], sessions = [], missions = [], topics = [] } = {}) {
  const out = new Map(workspaces.map((w) => [w.id, ts(w.createdAt)]));
  const bump = (id, iso) => { if (!out.has(id)) return; const t = ts(iso); if (t > out.get(id)) out.set(id, t); };
  for (const a of Array.isArray(activity) ? activity : []) if (a && a.workspaceId) bump(a.workspaceId, a.at);
  for (const s of Array.isArray(sessions) ? sessions : []) if (s && s.workspaceId) { bump(s.workspaceId, s.startedAt); bump(s.workspaceId, s.lastOutputAt); bump(s.workspaceId, s.endedAt); }
  for (const m of Array.isArray(missions) ? missions : []) if (m && m.workspaceId) bump(m.workspaceId, m.createdAt);
  for (const t of Array.isArray(topics) ? topics : []) if (t && t.workspaceId) bump(t.workspaceId, t.createdAt);
  return out;
}

/** Workspaces do mais recente para o mais antigo (empate: nome). `query` filtra por nome ou pasta, sem acento nem caixa. @returns {{id,name,path,lastUsed:number,ago:string}[]} */
export function recentWorkspaces({ workspaces = [], activity = [], sessions = [], missions = [], topics = [], query = '', now = Date.now() } = {}) {
  const names = friendlyNames(workspaces), last = lastUsedMap({ workspaces, activity, sessions, missions, topics }), q = norm(query).trim();
  return workspaces
    .map((w) => ({ id: w.id, name: names.get(w.id), path: w.path, lastUsed: last.get(w.id) ?? 0 }))
    .filter((r) => !q || norm(r.name).includes(q) || norm(r.path).includes(q))
    .sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name, 'pt-BR'))
    .map((r) => ({ ...r, ago: r.lastUsed ? agoLabel(new Date(r.lastUsed).toISOString(), now) : '' }));
}

/**
 * Faixa CONTINUAR: o workspace usado mais recentemente e, depois de "›", o tópico (o ativo nele, senão o criado por último) e a missão mais recente dele.
 * @returns {{workspaceId:string, parts:string[]}|null} null sem workspace.
 */
export function continueTarget({ workspaces = [], activity = [], sessions = [], missions = [], topics = [], activeTopicIds = {}, now = Date.now() } = {}) {
  const top = recentWorkspaces({ workspaces, activity, sessions, missions, topics, now })[0];
  if (!top) return null;
  const mine = (Array.isArray(topics) ? topics : []).filter((t) => t && t.workspaceId === top.id && !t.archived && String(t.title ?? '').trim());
  const topic = mine.find((t) => t.id === activeTopicIds?.[top.id]) ?? [...mine].sort((a, b) => ts(b.createdAt) - ts(a.createdAt))[0];
  const mission = (Array.isArray(missions) ? missions : []).filter((m) => m && m.workspaceId === top.id && String(m.title ?? '').trim()).sort((a, b) => ts(b.createdAt) - ts(a.createdAt))[0];
  return { workspaceId: top.id, parts: [top.name, topic?.title, mission?.title].filter(Boolean).map((s) => String(s).replace(/\s+/g, ' ').trim()) };
}
