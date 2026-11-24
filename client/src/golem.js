// Golem de liga (Configurações > Golem): lógica PURA (sem React, sem rede). O golem é forjado pelo seu trabalho: cresce com os tokens (entrada + saída, sem cache) de TODAS
// as IAs da máquina, desde o primeiro dia (GET /api/provider-activity?days=0), e a LIGA de que ele é feito é a sua mistura de IAs (cada IA é um metal). Nada de cuidar:
// ele nunca adoece nem some. Testado em server/test/golem.test.mjs.
import { paneState } from './env-view.js';

/** Fases, do carvão ao titã. `min` = tokens para chegar nela (escala pensada para ~300 mil tokens/dia: o aço em semanas, o titã em meses). */
export const STAGES = Object.freeze([
  Object.freeze({ id: 'faisca', label: 'Faísca', min: 0, hint: 'Uma brasa piscando dentro de um ovo de carvão.' }),
  Object.freeze({ id: 'brasa', label: 'Brasa viva', min: 50_000, hint: 'A brasa acordou e abriu os olhos.' }),
  Object.freeze({ id: 'lingote', label: 'Lingote', min: 300_000, hint: 'Um bloquinho de metal recém-fundido, que ganhou perninhas.' }),
  Object.freeze({ id: 'ferro', label: 'Golem de ferro', min: 1_000_000, hint: 'Corpo de placas rebitadas e juntas em brasa.' }),
  Object.freeze({ id: 'aco', label: 'Golem de aço', min: 5_000_000, hint: 'Placas polidas, ombreiras e um núcleo que brilha no peito.' }),
  Object.freeze({ id: 'tita', label: 'Titã da forja', min: 25_000_000, hint: 'Metal derretido corre pelas juntas e pela coroa.' }),
  Object.freeze({ id: 'mitico', label: 'Titã mítico', min: 100_000_000, hint: 'Uma aura de faíscas gira em volta dele.' }),
]);

/**
 * Metal de cada IA (a liga do golem). As cores são de METAL (não as cores de marca): `base` (sombra), `mid` (corpo) e `hi` (reflexo).
 * IA desconhecida vira ferro.
 */
export const METALS = Object.freeze({
  claude: Object.freeze({ name: 'Cobre', base: '#7a3a22', mid: '#c4693f', hi: '#f2a878' }),
  codex: Object.freeze({ name: 'Cobalto', base: '#1f2c6b', mid: '#3f5fd0', hi: '#9db2ff' }),
  gemini: Object.freeze({ name: 'Prata', base: '#5f6873', mid: '#a9b4c0', hi: '#eef3f8' }),
  cursor: Object.freeze({ name: 'Titânio', base: '#3f454c', mid: '#7f8892', hi: '#c9d0d8' }),
  kimi: Object.freeze({ name: 'Bismuto', base: '#4a2b6e', mid: '#8a5cc8', hi: '#d6b8ff' }),
  copilot: Object.freeze({ name: 'Níquel', base: '#55554d', mid: '#9c9c90', hi: '#e3e3d6' }),
  grok: Object.freeze({ name: 'Ferro negro', base: '#1c1c20', mid: '#45454f', hi: '#8c8c98' }),
  opencode: Object.freeze({ name: 'Bronze', base: '#5c4119', mid: '#a8813e', hi: '#e8c98a' }),
  kiro: Object.freeze({ name: 'Ouro rosé', base: '#7a4a45', mid: '#d48f86', hi: '#ffd6cf' }),
  antigravity: Object.freeze({ name: 'Alumínio', base: '#5b6670', mid: '#b3bec8', hi: '#f4f8fb' }),
  muse: Object.freeze({ name: 'Índio', base: '#2d2f6b', mid: '#5f62c4', hi: '#b9bbff' }),
});
export const IRON = Object.freeze({ name: 'Ferro', base: '#3a3d44', mid: '#7b818c', hi: '#c3c8d0' });
export const metalOf = (id) => METALS[id] ?? IRON;

const nn = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Fase pelos tokens: { index, stage, next, progress (0..1 até a próxima), toNext }. */
export function stageFor(tokens) {
  const t = nn(tokens);
  let i = 0; while (i + 1 < STAGES.length && t >= STAGES[i + 1].min) i++;
  const stage = STAGES[i], next = STAGES[i + 1] ?? null;
  const progress = next ? (t - stage.min) / (next.min - stage.min) : 1;
  return { index: i, stage, next, progress: Math.min(1, Math.max(0, progress)), toNext: next ? next.min - t : 0 };
}

/** Totais por IA a partir da atividade normalizada (home-view.normalizeActivity): [{ id, tokens }] do maior para o menor, só com consumo. */
export function totalsByProvider(activity) {
  const out = [];
  for (const p of Array.isArray(activity?.providers) ? activity.providers : []) {
    let n = 0; for (const v of Object.values(p.days ?? {})) n += nn(v?.io);
    if (n > 0) out.push({ id: p.id, tokens: n });
  }
  return out.sort((a, b) => b.tokens - a.tokens);
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`;
/** Mistura cores pelo peso (média em RGB). */
export function mixColors(parts) {
  const total = parts.reduce((a, p) => a + nn(p.weight), 0);
  if (!total) return null;
  const acc = [0, 0, 0];
  for (const p of parts) { const w = nn(p.weight) / total, c = hex(p.color); for (let k = 0; k < 3; k++) acc[k] += c[k] * w; }
  return toHex(acc);
}

/**
 * A liga: a parte de cada IA (metal, %) e as cores misturadas pelo peso de cada uma. Sem consumo = ferro puro.
 * `name`: "Cobre puro" (uma IA com 90% ou mais) ou "Liga de Cobre e Cobalto" (as duas maiores).
 */
export function alloyOf(totals) {
  const list = (Array.isArray(totals) ? totals : []).filter((x) => nn(x.tokens) > 0);
  const sum = list.reduce((a, x) => a + x.tokens, 0);
  if (!sum) return { name: 'Ferro puro', parts: [], colors: { base: IRON.base, mid: IRON.mid, hi: IRON.hi } };
  const parts = list.map((x) => ({ id: x.id, metal: metalOf(x.id).name, share: x.tokens / sum, tokens: x.tokens }));
  const colors = Object.fromEntries(['base', 'mid', 'hi'].map((k) => [k, mixColors(list.map((x) => ({ color: metalOf(x.id)[k], weight: x.tokens })))]));
  const name = parts[0].share >= 0.9 || parts.length === 1 ? `${parts[0].metal} puro` : `Liga de ${parts[0].metal} e ${parts[1].metal}`;
  return { name, parts, colors };
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * Recordes do trabalho: total, maior dia, dias seguidos com consumo (terminando hoje ou ontem) e o primeiro dia. Tudo dos dados reais; sem dado = 0/null.
 */
export function records(activity, now = new Date()) {
  const perDay = new Map();
  for (const p of Array.isArray(activity?.providers) ? activity.providers : []) for (const [k, v] of Object.entries(p.days ?? {})) perDay.set(k, (perDay.get(k) ?? 0) + nn(v?.io));
  let total = 0, best = { day: null, tokens: 0 };
  for (const [k, n] of perDay) { total += n; if (n > best.tokens) best = { day: k, tokens: n }; }
  const days = [...perDay.keys()].filter((k) => perDay.get(k) > 0).sort();
  let streak = 0; const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!perDay.get(dayKey(d))) d.setDate(d.getDate() - 1); // hoje ainda sem consumo: a sequência pode terminar ontem
  while (perDay.get(dayKey(d)) > 0) { streak++; d.setDate(d.getDate() - 1); }
  return { total, best, streak, since: days[0] ?? null, today: perDay.get(dayKey(now)) ?? 0 };
}

/** Tokens em texto curto: "950", "12 mil", "3,1 mi", "2,4 bi". */
export function fmtTokens(n) {
  const v = nn(n), f = (x, d) => x.toLocaleString('pt-BR', { maximumFractionDigits: d });
  if (v < 1000) return f(v, 0);
  if (v < 1e6) return `${f(v / 1e3, v < 1e4 ? 1 : 0)} mil`;
  if (v < 1e9) return `${f(v / 1e6, v < 1e7 ? 1 : 0)} mi`;
  return `${f(v / 1e9, 1)} bi`;
}

/**
 * Estado ao vivo, como uma forja que esfria aos poucos. Trabalhando = algum agente executando (o mesmo estado dos indicadores do Cockpit) OU tokens subindo há menos
 * de TOKEN_FRESH_MS. Quando para, ele NÃO congela de uma vez: 'working' (martela) -> 'slowing' (os últimos golpes, cada vez mais lentos) -> 'cheer' (só se um trabalho
 * terminou: pula de alegria) -> 'cooling' (solta vapor, as brasas baixam) -> 'idle' (respira, olha em volta) -> 'drowsy' (pálpebras pesadas) -> 'sleep' (cochila).
 * `lastActive` = ms do último instante em que havia trabalho (null = ainda não nesta sessão); `lastEnd` = ms do último fim de trabalho.
 */
export const SLEEP_AFTER_MS = 20 * 60_000, DROWSY_MS = 2 * 60_000, SLOW_MS = 2500, CHEER_MS = 4000, COOL_MS = 20_000;
export function liveMood({ working = 0, lastActive = null, lastEnd = null, now = Date.now() } = {}) {
  if (working > 0) return 'working';
  if (lastActive === null) return lastEnd !== null && now - lastEnd < CHEER_MS ? 'cheer' : 'sleep';
  const since = Math.max(0, now - lastActive);
  if (since < SLOW_MS) return 'slowing';
  // o fim do trabalho chega junto do último instante ativo (ou um pouco antes/depois, conforme a consulta): comemora logo depois dos últimos golpes
  if (lastEnd !== null && lastEnd >= lastActive - 5000 && now - Math.max(lastEnd, lastActive + SLOW_MS) < CHEER_MS) return 'cheer';
  if (since < COOL_MS) return 'cooling';
  if (since < SLEEP_AFTER_MS - DROWSY_MS) return 'idle';
  return since < SLEEP_AFTER_MS ? 'drowsy' : 'sleep';
}
/** Total de tokens (entrada + saída) dos terminais abertos, pelo consumo que o servidor mede de cada um (o mesmo número do Cockpit). Subiu = há tokens sendo gastos. */
export const sessionTokens = (sessions) => (Array.isArray(sessions) ? sessions : []).reduce((a, s) => {
  const u = s?.usage, n = Number.isFinite(u?.io) ? u.io : Number.isFinite(u?.input) && Number.isFinite(u?.output) ? u.input + u.output : 0;
  return a + (n > 0 ? n : 0);
}, 0);
/** Tokens subiram há menos que isso = ainda trabalhando (o consumo chega a cada 1,5 s, mas o transcript só grava ao fim de cada mensagem do agente). */
export const TOKEN_FRESH_MS = 6000;
/** Tokens subiram há menos que isso = rajada: ele martela mais rápido e solta mais faíscas. */
export const BURST_MS = 3000;
/** Humor efetivo e se está numa rajada. `tokensAt` = ms da última subida de tokens; `working` = agentes executando agora. */
export function liveState({ working = 0, tokensAt = null, lastActive = null, lastEnd = null, now = Date.now() } = {}) {
  const fresh = tokensAt !== null && now - tokensAt < TOKEN_FRESH_MS;
  const active = working > 0 || fresh;
  // sem agente executando, o trabalho "acabou" quando os tokens deixaram de ser frescos (não no instante da última subida)
  const last = active ? now : Math.max(lastActive ?? -Infinity, tokensAt !== null ? tokensAt + TOKEN_FRESH_MS : -Infinity);
  const mood = liveMood({ working: active ? 1 : 0, lastActive: Number.isFinite(last) ? last : null, lastEnd, now });
  return { mood, burst: mood === 'working' && tokensAt !== null && now - tokensAt < BURST_MS };
}
/** Terminais executando e esperando você, pelo MESMO estado dos indicadores do Cockpit (paneState: hooks do agente; sem hooks, `workingIds` pela saída). */
export function liveCounts(sessions, workingIds) {
  let working = 0, waiting = 0;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || typeof s !== 'object') continue;
    const st = paneState(s, workingIds instanceof Set ? workingIds : new Set());
    if (st === 'working') working++; else if (st === 'waiting') waiting++;
  }
  return { working, waiting };
}
export const MOOD_LABEL = Object.freeze({ working: 'forjando', slowing: 'diminuindo o ritmo', cheer: 'comemorando', cooling: 'esfriando', idle: 'descansando', drowsy: 'com sono', sleep: 'cochilando' });

/** Nome: até 20 caracteres, sem caracteres de controle. */
export const NAME_MAX = 20;
export const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, NAME_MAX) : '');

/** Forma exibida: a escolhida pelo usuário, se ele já a desbloqueou (fase <= a atual); senão a fase atual. Nunca mostra uma forma ainda bloqueada. */
export const shownIndex = (chosen, current) => (Number.isInteger(chosen) && chosen >= 0 && chosen <= current ? chosen : current);

/** Fases que o golem atravessou desde a última vista (`seen` = índice já mostrado; null = nunca viu: anima do começo). Lista de índices a animar, em ordem. */
export function evolutionSteps(seen, current) {
  const from = Number.isInteger(seen) && seen >= 0 ? seen : 0;
  const out = [];
  for (let i = from + 1; i <= current; i++) out.push(i);
  return out;
}
