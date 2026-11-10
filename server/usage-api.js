// Uso REAL da conta consultado no provedor (5 h e semana, somando TODOS os clientes: FORGE, terminal externo, navegador/web), como um painel oficial de uso.
//
// Autorizado pelo usuário (2026-11-10): lê o token de login que o próprio Claude Code / Codex já gravaram e consulta o endpoint de uso do provedor. Regras:
//   - O token vive só em memória, durante a chamada: nunca é gravado, logado, devolvido na resposta nem incluído em mensagens de erro (as razões são códigos fixos).
//   - Hosts FIXOS no código (nenhuma URL vem de dado), HTTPS, sem seguir redirecionamento (o cabeçalho com o token não pode ir para outro host), timeout e recusa de corpo grande (content-length e tamanho após a leitura).
//   - NÃO renova token (renovar giraria o refresh_token e poderia deslogar o CLI): token vencido = 'token-expirado'; o CLI renova sozinho no próximo uso.
//   - Arquivo de credencial: só arquivo regular (lstat, sem link), com limite de tamanho. Só os campos do token são usados.
//   - Endpoints NÃO documentados pelos provedores: qualquer formato inesperado vira `ok:false` (o chamador cai nas fontes locais), nunca lança.
// Resultado: { ok: true, planType, session, week } com janelas { usedPct 0..100, resetsAt ISO, windowMinutes } ou null; { ok: false, reason } com reason de um conjunto fixo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const MAX_CRED_FILE = 256 * 1024;
const MAX_BODY = 512 * 1024;
const TIMEOUT_MS = 8000;
const EXPIRY_SKEW_MS = 30_000;
const SESSION_MIN = 300, WEEK_MIN = 10080;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v)) * 100) / 100 : null);

/** Lê um JSON de credencial com segurança (arquivo regular, tamanho limitado). null se ausente/inválido. */
function readJson(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_CRED_FILE) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObj(j) ? j : null;
  } catch { return null; }
}

/** GET JSON com timeout, sem redirecionamento e com limite de bytes. Nunca devolve o token nem texto do corpo de erro. */
async function getJson(fetchFn, url, headers) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { method: 'GET', headers, redirect: 'error', signal: ac.signal });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'nao-autorizado' };
    if (r.status === 429) return { ok: false, reason: 'limitado' };
    if (!r.ok) return { ok: false, reason: 'http' };
    const len = Number(r.headers?.get?.('content-length'));
    if (Number.isFinite(len) && len > MAX_BODY) return { ok: false, reason: 'formato' };
    const text = await r.text();
    if (text.length > MAX_BODY) return { ok: false, reason: 'formato' };
    try { const j = JSON.parse(text); return isObj(j) ? { ok: true, body: j } : { ok: false, reason: 'formato' }; } catch { return { ok: false, reason: 'formato' }; }
  } catch { return { ok: false, reason: 'rede' }; } finally { clearTimeout(timer); }
}

/** Claude: `{ five_hour: { utilization (0..100), resets_at ISO }, seven_day: {...} }`. */
export function parseClaudeUsage(b, nowMs) {
  const win = (w, minutes) => {
    if (!isObj(w)) return null;
    const p = pct(w.utilization), at = Date.parse(w.resets_at);
    return p === null || !Number.isFinite(at) || at <= nowMs ? null : { usedPct: p, resetsAt: new Date(at).toISOString(), windowMinutes: minutes };
  };
  const session = win(b?.five_hour, SESSION_MIN), week = win(b?.seven_day, WEEK_MIN);
  return session || week ? { session, week } : null;
}

/** Codex: `rate_limit.{primary_window,secondary_window}` com `used_percent`, `limit_window_seconds`, `reset_at` (epoch s). Janela pela duração, não pela posição. */
export function parseCodexUsage(b, nowMs) {
  const rl = isObj(b?.rate_limit) ? b.rate_limit : null;
  if (!rl) return null;
  let session = null, week = null;
  for (const w of [rl.primary_window, rl.secondary_window]) {
    if (!isObj(w)) continue;
    const p = pct(w.used_percent), secs = w.limit_window_seconds, reset = typeof w.reset_at === 'number' ? w.reset_at : NaN;
    if (p === null || typeof secs !== 'number' || !Number.isFinite(reset) || reset * 1000 <= nowMs) continue;
    const minutes = Math.round(secs / 60), resetsAt = new Date(reset * 1000).toISOString();
    if (minutes <= 360) session = { usedPct: p, resetsAt, windowMinutes: minutes };
    else if (minutes >= 10000) week = { usedPct: p, resetsAt, windowMinutes: minutes };
  }
  return session || week ? { session, week } : null;
}

const cleanPlan = (v) => (typeof v === 'string' && /^[A-Za-z0-9 _-]{1,30}$/.test(v) ? v : null);

/**
 * `credsDirOf(accountId)` -> pasta de configuração do Claude da conta (null = padrão: CLAUDE_CONFIG_DIR ou ~/.claude). `fetchFn` e `now` injetáveis nos testes.
 * No macOS o Claude Code guarda o token no Keychain (sem arquivo): vira 'sem-credencial' e as fontes locais continuam valendo.
 */
export function createUsageApi({ credsDirOf = () => null, codexHome = null, fetchFn = globalThis.fetch, now = Date.now, env = () => process.env } = {}) {
  const home = () => codexHome ?? (env().CODEX_HOME || path.join(os.homedir(), '.codex'));
  return {
    async claude(accountId) {
      if (typeof fetchFn !== 'function') return { ok: false, reason: 'indisponivel' };
      let dir = null;
      try { dir = credsDirOf(accountId) ?? null; } catch { if (accountId !== 'system') return { ok: false, reason: 'sem-credencial' }; } // falha numa conta gerenciada NUNCA cai no login do Sistema
      dir = dir || env().CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
      const o = readJson(path.join(dir, '.credentials.json'))?.claudeAiOauth;
      const token = isObj(o) && typeof o.accessToken === 'string' && o.accessToken ? o.accessToken : null;
      if (!token) return { ok: false, reason: 'sem-credencial' };
      if (typeof o.expiresAt === 'number' && o.expiresAt <= now() + EXPIRY_SKEW_MS) return { ok: false, reason: 'token-expirado' };
      const r = await getJson(fetchFn, CLAUDE_USAGE_URL, { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'forge-usage/1' });
      if (!r.ok) return r;
      const w = parseClaudeUsage(r.body, now());
      return w ? { ok: true, planType: cleanPlan(o.subscriptionType), ...w } : { ok: false, reason: 'formato' };
    },
    async codex() {
      if (typeof fetchFn !== 'function') return { ok: false, reason: 'indisponivel' };
      const t = readJson(path.join(home(), 'auth.json'))?.tokens;
      const token = isObj(t) && typeof t.access_token === 'string' && t.access_token ? t.access_token : null;
      if (!token) return { ok: false, reason: 'sem-credencial' };
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'forge-usage/1' };
      if (typeof t.account_id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(t.account_id)) headers['ChatGPT-Account-Id'] = t.account_id;
      const r = await getJson(fetchFn, CODEX_USAGE_URL, headers);
      if (!r.ok) return r;
      const w = parseCodexUsage(r.body, now());
      return w ? { ok: true, planType: cleanPlan(r.body.plan_type), ...w } : { ok: false, reason: 'formato' };
    },
  };
}
