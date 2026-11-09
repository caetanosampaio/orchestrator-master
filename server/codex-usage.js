// Limites de uso da CONTA do Codex (janela de 5 h e semanal), lidos do "rollout" (JSONL) que o próprio Codex grava em <CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<data>-<uuid>.jsonl:
// cada evento `token_count` traz `payload.rate_limits`. Somente leitura, com limite de bytes (só o final do arquivo), e só são abertos arquivos cujo NOME tem a forma `rollout-<data>-<uuid>.jsonl`
// dentro de pastas de data (AAAA/MM/DD) de <CODEX_HOME>/sessions, que sejam arquivos COMUNS (link simbólico/junction é ignorado: lstat, nunca stat). Nenhum caminho vem de conteúdo de arquivo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TAIL_BYTES = 256 * 1024; // final do arquivo onde procurar o último token_count
const MAX_TAIL_BYTES = 4 * 1024 * 1024; // se não achou, amplia a janela até aqui (um turno com saída enorme empurra o token_count anterior para longe)
const NAME_RE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const COMP_RE = { y: /^\d{4}$/, m: /^\d{2}$/, d: /^\d{2}$/ };

/** Pasta do Codex: CODEX_HOME ou ~/.codex. */
export const codexHomeDir = (env = process.env) => (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME ? env.CODEX_HOME : path.join(os.homedir(), '.codex'));

// lstat (nunca stat): link simbólico e junction NÃO são arquivo comum nem pasta comum
const isPlainFile = (f) => { try { return fs.lstatSync(f).isFile(); } catch { return false; } };
const isPlainDir = (d) => { try { const s = fs.lstatSync(d); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } };

function readRange(file, start, len) {
  if (!isPlainFile(file)) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len), n = fs.readSync(fd, buf, 0, len, start);
    return n < len ? buf.subarray(0, n) : buf;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* já fechado */ } }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Limites de uso da CONTA do Codex (janela de 5 h e semanal): cada `token_count` dos rollouts traz `payload.rate_limits = { primary, secondary, plan_type, ... }`, com `used_percent`,
// `window_minutes` e `resets_at` (epoch em SEGUNDOS). É nível de conta (o Codex só tem um login): vale o ÚLTIMO evento de qualquer rollout recente. Mesmas regras de segurança do leitor
// de tokens acima (nome validado, lstat/isFile sem seguir link, leitura limitada do FINAL do arquivo, cache por tamanho+mtime); nenhum caminho vem de conteúdo de arquivo.
const RL_DAYS = 8; // pastas de data (com rollouts) examinadas, das mais novas para as mais antigas: uma sessão longa continua gravando na pasta do dia em que nasceu
const RL_TOP_FILES = 6; // rollouts mais recentes (por mtime) cujo final é lido
const RL_MAX_NAMES = 300; // arquivos considerados por pasta de data
const RL_MAX_CACHE = 200;
export const SESSION_WINDOW_MINUTES = 300, WEEK_WINDOW_MINUTES = 10080;
const MS_THRESHOLD = 1e11; // epoch >= isto só pode ser milissegundos (1e11 s = ano 5138): é normalizado para ms
const MAX_EPOCH_MS = 4_102_444_800_000; // 2100-01-01
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const epochMsOf = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const ms = v >= MS_THRESHOLD ? v : v * 1000;
  return ms <= MAX_EPOCH_MS ? Math.round(ms) : null;
};

// Formato antigo do Codex: `resets_in_seconds` (relativo) em vez de `resets_at`; o instante é o do evento + o intervalo. Sem data do evento não há como saber: null.
const MAX_RESET_IN_SECONDS = 366 * 86400;
const legacyResetMs = (secs, eventMs) => (typeof secs === 'number' && Number.isFinite(secs) && secs >= 0 && secs <= MAX_RESET_IN_SECONDS && Number.isFinite(eventMs) ? Math.round(eventMs + secs * 1000) : null);

/** Plano como texto curto e seguro ("plus", "pro"...), ou null. */
export const cleanPlan = (v) => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(v) ? v.toLowerCase() : null);

/**
 * `rate_limits` do Codex -> { planType, session, week }. Janela por `window_minutes` (<= 360 = 5 h; >= 10000 = semanal; outros valores e janela sem `window_minutes` são ignorados).
 * `eventMs` = data do evento (só para o formato antigo `resets_in_seconds`). Janela inválida (percentual não numérico, `resets_at` ausente) ou já vencida (`resets_at` <= agora) vira null: nunca se mostra porcentagem velha como atual. `usedPct` limitado a 0..100.
 */
export function mapRateLimits(rl, nowMs = Date.now(), eventMs = null) {
  const out = { planType: cleanPlan(rl?.plan_type), session: null, week: null };
  if (!isObj(rl)) return out;
  for (const key of ['primary', 'secondary']) {
    const w = rl[key];
    if (!isObj(w)) continue;
    const minutes = w.window_minutes, pct = w.used_percent, resetsMs = epochMsOf(w.resets_at) ?? legacyResetMs(w.resets_in_seconds, eventMs);
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || typeof pct !== 'number' || !Number.isFinite(pct) || resetsMs === null || resetsMs <= nowMs) continue;
    const win = { usedPct: Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100, resetsAt: new Date(resetsMs).toISOString() };
    if (minutes > 0 && minutes <= 360) out.session ??= { ...win, windowMinutes: SESSION_WINDOW_MINUTES };
    else if (minutes >= 10000) out.week ??= { ...win, windowMinutes: WEEK_WINDOW_MINUTES };
  }
  return out;
}

/** Último `token_count` com `rate_limits` do final do arquivo (de trás para frente; `rate_limits: null`, `info: null` e linha parcial são ignorados). null = ainda não há. */
function lastRateLimits(file, size, tailBytes, maxTailBytes) {
  let bytes = Math.max(1024, tailBytes);
  for (;;) {
    const len = Math.min(size, bytes), start = size - len, buf = readRange(file, start, len);
    if (!buf) return null;
    let from = 0;
    if (start > 0) { const nl = buf.indexOf(0x0a); from = nl < 0 ? buf.length : nl + 1; }
    const lines = buf.subarray(from).toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('token_count') || !line.includes('rate_limits')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o?.payload?.type !== 'token_count' || !isObj(o.payload.rate_limits)) continue;
      const ts = Date.parse(o.timestamp), m = mapRateLimits(o.payload.rate_limits, 0, ts); // now = 0: só a estrutura conta (vencimento é decidido na leitura)
      if (m.session || m.week) return { ts, rl: o.payload.rate_limits }; // `rate_limits: {}` ou sem janela válida não esconde o evento anterior, que tinha
    }
    if (len >= size || bytes >= maxTailBytes) return null;
    bytes = Math.min(bytes * 4, maxTailBytes);
  }
}

/**
 * Leitor dos limites do Codex. `read()` -> { planType, session, week, at } (at = ISO do evento, ou do arquivo se o evento não tem data) ou null (sem rollout/sem `rate_limits`).
 * As janelas já vêm filtradas por validade (ver mapRateLimits). Nunca lança: falha de leitura = null.
 */
export function createCodexRateLimitsReader({ codexHome = codexHomeDir(), now = Date.now, tailBytes = TAIL_BYTES, maxTailBytes = MAX_TAIL_BYTES, maxDays = RL_DAYS, topFiles = RL_TOP_FILES, maxNames = RL_MAX_NAMES } = {}) {
  const sessionsRoot = path.join(codexHome, 'sessions');
  const cache = new Map(); // arquivo -> { size, mtimeMs, ev }
  const subdirs = (dir, re) => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return ents.filter((e) => e.isDirectory() && re.test(e.name)).map((e) => e.name).sort().reverse(); // Dirent de link simbólico dá isDirectory() === false
  };

  /** Rollouts das pastas de data mais novas: [{ file, size, mtimeMs }] (arquivos comuns apenas). */
  function recentFiles() {
    if (!isPlainDir(sessionsRoot)) return [];
    const found = []; let days = 0;
    outer: for (const y of subdirs(sessionsRoot, COMP_RE.y)) for (const m of subdirs(path.join(sessionsRoot, y), COMP_RE.m)) for (const d of subdirs(path.join(sessionsRoot, y, m), COMP_RE.d)) {
      const dir = path.join(sessionsRoot, y, m, d);
      if (!isPlainDir(path.join(sessionsRoot, y)) || !isPlainDir(path.join(sessionsRoot, y, m)) || !isPlainDir(dir)) continue;
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      const names = ents.filter((e) => e.isFile() && NAME_RE.test(e.name)).map((e) => e.name).sort().slice(-maxNames);
      if (!names.length) continue;
      for (const n of names) {
        const file = path.join(dir, n);
        try { const st = fs.lstatSync(file); if (st.isFile()) found.push({ file, size: st.size, mtimeMs: st.mtimeMs }); } catch { /* sumiu */ }
      }
      if (++days >= maxDays) break outer;
    }
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, topFiles);
  }

  function eventOf(f) {
    const c = cache.get(f.file);
    if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) return c.ev;
    const ev = lastRateLimits(f.file, f.size, tailBytes, maxTailBytes);
    if (cache.size >= RL_MAX_CACHE) cache.clear();
    cache.set(f.file, { size: f.size, mtimeMs: f.mtimeMs, ev });
    return ev;
  }

  return {
    read() {
      try {
        let best = null;
        for (const f of recentFiles()) {
          const ev = eventOf(f);
          if (!ev) continue;
          const at = Number.isFinite(ev.ts) ? ev.ts : f.mtimeMs;
          if (!best || at > best.at) best = { at, rl: ev.rl };
        }
        if (!best) return null;
        return { ...mapRateLimits(best.rl, now(), best.at), at: new Date(best.at).toISOString() };
      } catch { return null; }
    },
  };
}
