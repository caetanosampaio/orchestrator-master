// Limite REAL de uso de cada conta (janela curta de 5 h e janela semanal), para a interface: GET /api/limits.
//
// Fontes (tudo local; nada sai da máquina, nenhum token ou arquivo de credencial é lido):
//   - Claude Code (assinantes Pro/Max): a status line do Claude Code recebe no stdin `rate_limits.{five_hour,seven_day}`. O pane é aberto com `--settings <arquivo>` (gerado aqui) que liga a status line a
//     `claude-statusline-hook.mjs`; o script grava `<pasta>/<session_id>.json` ({ at, fiveHour, sevenDay }). Aqui só se LÊ essa pasta: para cada conta, por janela, vale o dado mais NOVO pela própria janela
//     (maior `resetsAt`; em empate, MAIOR `usedPct`, pois o uso só cresce dentro da janela; só então o `at`, que é quando o hook rodou e não quando o dado foi medido) entre as sessões dela
//     (os últimos N registros daquela conta). Não existe outra fonte local.
//   - Codex CLI: o último `token_count` com `rate_limits` dos rollouts recentes (codex-usage.js, createCodexRateLimitsReader). É nível de conta.
//
// Regras de honestidade: janela cujo `resetsAt` já passou é omitida (null), nunca se mostra porcentagem velha como atual; `usedPct` sempre em 0..100; entrada inválida vira null; falha de leitura de um item
// vira `sem-dados` daquele item. A resposta não tem caminhos, ids de sessão/registro nem e-mails.
//
// Efeito colateral CONHECIDO: com status line configurada o Claude Code deixa de mostrar a maioria das dicas do rodapé. Por isso o script imprime uma linha útil, a injeção se desliga com
// ORCH_CLAUDE_STATUSLINE=off e NÃO acontece quando o settings.json de USUÁRIO da conta já define `statusLine` (a conta aparece como `statusline-propria`, sem janelas).
// Só o settings.json de usuário é consultado: uma `statusLine` definida só no PROJETO (.claude/settings.json ou settings.local.json) é sobreposta pelo `--settings` do FORGE nos panes dele
// (precedência do Claude Code; não verificada aqui com um Claude real).
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createCodexRateLimitsReader, codexHomeDir, cleanPlan } from './codex-usage.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM_ID = 'system';
const MAX_FILE = 4096; // arquivo gravado pelo hook: poucas dezenas de bytes
const MAX_SETTINGS = 512 * 1024; // settings.json do usuário (só se procura a chave `statusLine`)
const MEMO_MS = 2000;
const CONNECTED_TIMEOUT_MS = 10_000; // consulta de login que não responde não prende o estado para sempre
const CONNECTED_TTL_MS = 60_000; // o login é consultado em segundo plano, no máximo a cada ~1 min (as sondas já têm cache próprio)
const MAX_RECORDS_PER_ACCOUNT = 30;
const MAX_FILE_CACHE = 500;
const FUTURE_SKEW_MS = 10 * 60_000; // `at` além disto no futuro é lixo
const STALE_FILE_MS = 30 * 86_400_000;
const SESSION_WINDOW_MINUTES = 300, WEEK_WINDOW_MINUTES = 10080;
const MS_THRESHOLD = 1e11, MAX_EPOCH_SEC = 4_102_444_800;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Caracteres que quebrariam a linha de comando da status line (shell do Claude Code) ou o quoting: nesse caso a status line simplesmente não é ligada (mesmo critério de agent-status.js).
const UNSAFE = /["`$%!\r\n\t\\]/;
const fwd = (p) => String(p).replace(/\\/g, '/'); // o shell aceita "/" também no Windows; "\" seria consumido pelo shell

/** ORCH_CLAUDE_STATUSLINE=off desliga; qualquer outro valor (ou ausente) = ligado. */
export const statusLineEnabled = (env = process.env) => String(env?.ORCH_CLAUDE_STATUSLINE ?? '').trim().toLowerCase() !== 'off';

/** Conteúdo do arquivo de `--settings`: `{ statusLine: { type: 'command', command } }`, ou null se algum caminho não for seguro. */
export function statusLineSettings({ node, script, dir }) {
  const parts = [fwd(node), fwd(script), fwd(dir)];
  if (parts.some((p) => !p || UNSAFE.test(p))) return null;
  return { statusLine: { type: 'command', command: `"${parts[0]}" "${parts[1]}" "${parts[2]}"` } };
}

/** Grava o arquivo de settings de forma atômica (e só se o conteúdo mudou). Lança em erro de disco. */
export function writeSettingsFile(file, settings) {
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch { /* não existe: grava */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`; // nome aleatório + 'wx': um link plantado com nome previsível nunca é seguido
  try { fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* resíduo inofensivo */ } throw e; }
  return true;
}

const pctOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v)) * 100) / 100 : null);
const secOf = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const s = Math.round(v >= MS_THRESHOLD ? v / 1000 : v);
  return s > 0 && s <= MAX_EPOCH_SEC ? s : null;
};
const storedWindow = (w) => { if (!isObj(w)) return null; const usedPct = pctOf(w.usedPct), resetsAt = secOf(w.resetsAt); return usedPct === null || resetsAt === null ? null : { usedPct, resetsAt }; };

/** Janela da resposta (ISO) a partir da gravada (epoch s), ou null se já venceu. */
const publicWindow = (w, minutes, nowMs) => (w && w.resetsAt * 1000 > nowMs ? { usedPct: w.usedPct, resetsAt: new Date(w.resetsAt * 1000).toISOString(), windowMinutes: minutes } : null);

/**
 * `db` = banco (só lê `terminalSessions`); `accounts` = módulo de contas (list, configDirOf, available, statusOf); `dir` = pasta onde o hook grava (fora do workspace);
 * `script` = caminho do claude-statusline-hook.mjs; `codexAuth` = sonda de login do Codex (cacheada). `env`, `now` (ms) e `codexReader` são injetáveis nos testes.
 */
export function createRateLimits({ db, accounts = null, dir: dirIn, script: scriptIn, node = process.execPath, settingsFile: settingsIn = null, codexHome = codexHomeDir(), codexReader = null, codexAuth = null, env = () => process.env, now = Date.now, memoMs = MEMO_MS, connectedTtlMs = CONNECTED_TTL_MS, maxRecordsPerAccount = MAX_RECORDS_PER_ACCOUNT } = {}) {
  if (!dirIn) throw new Error('createRateLimits: dir é obrigatório');
  const dir = path.resolve(dirIn), script = scriptIn ? path.resolve(scriptIn) : null; // absolutos: a status line roda com outro cwd
  const settingsFile = settingsIn ? path.resolve(settingsIn) : path.join(dir, 'claude-settings.json');
  const hookSettings = script ? statusLineSettings({ node, script, dir }) : null;
  const codex = codexReader ?? createCodexRateLimitsReader({ codexHome, now });

  // ---- o settings.json de USUÁRIO da conta já define `statusLine`? (só a existência da chave é usada; nada mais do conteúdo) ----
  const ownCache = new Map(); // arquivo -> { size, mtimeMs, own }
  function userSettingsPath(accountId) {
    let cfg = null; try { cfg = accounts?.configDirOf?.(accountId) ?? null; } catch { cfg = null; }
    if (!cfg) { const e = env(); cfg = typeof e?.CLAUDE_CONFIG_DIR === 'string' && e.CLAUDE_CONFIG_DIR ? e.CLAUDE_CONFIG_DIR : path.join(os.homedir(), '.claude'); }
    return path.join(cfg, 'settings.json');
  }
  function hasOwnStatusLine(accountId) {
    const file = userSettingsPath(accountId);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return false;
      if (st.size > MAX_SETTINGS) return true; // grande demais para conferir: por precaução NÃO se sobrepõe a configuração do usuário
      const c = ownCache.get(file);
      if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.own;
      let own = false;
      try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); own = isObj(j) && Object.hasOwn(j, 'statusLine') && j.statusLine !== null && j.statusLine !== undefined; } catch { own = false; }
      if (ownCache.size >= 50) ownCache.clear();
      ownCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, own });
      return own;
    } catch { return false; } // sem arquivo ou ilegível: o usuário não definiu nada
  }

  /** 'off' (desligado por ambiente), 'own' (status line do usuário) ou 'on'. */
  const modeOf = (accountId) => (!statusLineEnabled(env()) ? 'off' : hasOwnStatusLine(accountId) ? 'own' : 'on');

  /** Arquivo para `--settings` do pane da conta, ou null (desligado, status line do usuário, caminho inseguro ou falha ao gravar: o pane abre igual, sem a flag). Nunca lança. */
  function settingsFileFor(accountId = SYSTEM_ID) {
    try {
      if (!hookSettings || !settingsFile || modeOf(accountId ?? SYSTEM_ID) !== 'on') return null;
      writeSettingsFile(settingsFile, hookSettings);
      return settingsFile;
    } catch { return null; }
  }

  // ---- arquivos do hook (Claude) ----
  const files = new Map(); // arquivo -> { size, mtimeMs, data }
  function readSessionFile(sessionId) {
    const file = path.join(dir, `${sessionId}.json`);
    try {
      const st = fs.lstatSync(file); // lstat: link simbólico nunca é seguido
      if (!st.isFile() || st.size > MAX_FILE) { files.delete(file); return null; }
      const c = files.get(file);
      if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.data;
      const j = JSON.parse(fs.readFileSync(file, 'utf8')), atMs = Date.parse(j?.at);
      const data = Number.isFinite(atMs) ? { atMs, fiveHour: storedWindow(j.fiveHour), sevenDay: storedWindow(j.sevenDay) } : null;
      if (files.size >= MAX_FILE_CACHE) files.clear();
      files.set(file, { size: st.size, mtimeMs: st.mtimeMs, data });
      return data;
    } catch { files.delete(file); return null; }
  }

  /**
   * Sessões Claude da conta: as que estão rodando mais as últimas N do histórico (registro sem `accountId` = Sistema; registro de conta removida não entra em nenhuma lista).
   * Premissa NÃO verificada com um Claude real: ao retomar (`--resume`) a sessão mantém o MESMO session_id do registro (`claudeSessionId`), então o arquivo do hook continua casando.
   * Se o Claude Code passar a trocar o id na retomada, o dado dessa sessão só aparece de novo quando houver um registro com o id novo.
   */
  function sessionsOf(accountId) {
    const list = Array.isArray(db?.terminalSessions) ? db.terminalSessions : [];
    const mine = list.filter((r) => isObj(r) && (r.provider ?? 'claude') === 'claude' && typeof r.claudeSessionId === 'string' && SESSION_ID_RE.test(r.claudeSessionId) && (r.accountId ?? SYSTEM_ID) === accountId);
    const ids = new Set([...mine.slice(-maxRecordsPerAccount).map((r) => r.claudeSessionId), ...mine.filter((r) => r.state === 'running').map((r) => r.claudeSessionId)]);
    return [...ids];
  }

  // ---- login/plano em segundo plano (cache existente das sondas; nunca bloqueia nem dispara a cada chamada) ----
  const conn = new Map(); // chave -> { at, startedAt, gen, connected, plan, pending }
  function connectedOf(key, fetchIt) {
    const t = now();
    const m = conn.get(key) ?? { at: null, startedAt: 0, gen: 0, connected: null, plan: null, pending: false };
    conn.set(key, m);
    if (m.pending && t - m.startedAt >= CONNECTED_TIMEOUT_MS) { m.gen++; m.pending = false; m.connected = null; m.plan = null; m.at = t; } // consulta que nunca resolve: descarta (o resultado tardio é ignorado)
    if (!m.pending && (m.at === null || t - m.at >= connectedTtlMs)) {
      const gen = ++m.gen; m.pending = true; m.startedAt = t;
      Promise.resolve().then(fetchIt).then(
        (v) => { if (gen === m.gen) { m.connected = typeof v?.connected === 'boolean' ? v.connected : null; m.plan = cleanPlan(v?.plan) ?? null; } },
        () => { if (gen === m.gen) { m.connected = null; m.plan = null; } },
      ).finally(() => { if (gen === m.gen) { m.at = now(); m.pending = false; } });
    }
    return m;
  }

  /** O dado `w` (lido de um arquivo com `at`) é mais novo que o melhor até agora? Pela janela: maior resetsAt; empate: maior usedPct (só cresce na janela); último desempate: `at`. */
  const newer = (w, atMs, best) => !best || w.resetsAt > best.w.resetsAt || (w.resetsAt === best.w.resetsAt && (w.usedPct > best.w.usedPct || (w.usedPct === best.w.usedPct && atMs > best.atMs)));

  function claudeAccount(id, label, nowMs) {
    const acc = { id, label, connected: null, plan: null, source: 'sem-dados', session: null, week: null, updatedAt: null };
    try {
      if (accounts?.statusOf) { const m = connectedOf(`claude:${id}`, async () => { const s = await accounts.statusOf(id); return { connected: s?.checked ? s.loggedIn : null, plan: s?.subscriptionType }; }); acc.connected = m.connected; acc.plan = m.plan; }
    } catch { /* informativo */ }
    try {
      const mode = modeOf(id);
      if (mode === 'off') { acc.source = 'desligado'; return acc; }
      if (mode === 'own') { acc.source = 'statusline-propria'; return acc; }
      let bestS = null, bestW = null;
      for (const sid of sessionsOf(id)) {
        const d = readSessionFile(sid);
        if (!d || d.atMs > nowMs + FUTURE_SKEW_MS) continue;
        if (d.fiveHour && d.fiveHour.resetsAt * 1000 > nowMs && newer(d.fiveHour, d.atMs, bestS)) bestS = { atMs: d.atMs, w: d.fiveHour };
        if (d.sevenDay && d.sevenDay.resetsAt * 1000 > nowMs && newer(d.sevenDay, d.atMs, bestW)) bestW = { atMs: d.atMs, w: d.sevenDay };
      }
      acc.session = bestS ? publicWindow(bestS.w, SESSION_WINDOW_MINUTES, nowMs) : null;
      acc.week = bestW ? publicWindow(bestW.w, WEEK_WINDOW_MINUTES, nowMs) : null;
      if (acc.session || acc.week) { acc.source = 'statusline'; acc.updatedAt = new Date(Math.max(acc.session ? bestS.atMs : 0, acc.week ? bestW.atMs : 0)).toISOString(); }
    } catch { acc.source = 'sem-dados'; acc.session = null; acc.week = null; acc.updatedAt = null; }
    return acc;
  }

  function codexAccount(nowMs) {
    const acc = { id: 'codex', label: 'Codex', connected: null, plan: null, source: 'sem-dados', session: null, week: null, updatedAt: null };
    try {
      if (typeof codexAuth === 'function') { const m = connectedOf('codex', async () => { const a = await codexAuth(); return { connected: a?.known === true && typeof a.loggedIn === 'boolean' ? a.loggedIn : null }; }); acc.connected = m.connected; }
    } catch { /* informativo */ }
    try {
      const r = codex.read();
      if (r) {
        acc.plan = cleanPlan(r.planType) ?? null;
        if (r.session || r.week) { acc.source = 'rollout'; acc.session = r.session ?? null; acc.week = r.week ?? null; acc.updatedAt = typeof r.at === 'string' ? r.at : null; }
      }
    } catch { acc.source = 'sem-dados'; acc.session = null; acc.week = null; acc.updatedAt = null; }
    return acc;
  }

  let memo = null;
  function build() {
    const nowMs = now();
    const claude = [];
    let list = []; try { list = accounts?.list?.() ?? []; } catch { list = []; }
    let available = true; try { available = accounts?.available ? accounts.available() !== false : true; } catch { available = true; } // sem Claude Code instalado, não há conta a mostrar
    if (available) {
      claude.push(claudeAccount(SYSTEM_ID, 'Sistema', nowMs));
      for (const a of list) if (isObj(a) && typeof a.id === 'string' && /^acc_[0-9a-f]{8}$/.test(a.id) && (a.provider ?? 'claude') === 'claude') claude.push(claudeAccount(a.id, typeof a.label === 'string' && a.label ? a.label : a.id, nowMs));
    }
    const live = new Set(['codex', ...claude.map((a) => `claude:${a.id}`)]);
    for (const k of [...conn.keys()]) if (!live.has(k)) conn.delete(k); // conta removida: esquece o estado de login dela
    return { updatedAt: new Date(nowMs).toISOString(), providers: [{ provider: 'claude', label: 'Claude Code', accounts: claude }, { provider: 'codex', label: 'Codex CLI', accounts: [codexAccount(nowMs)] }] };
  }

  return {
    settingsFileFor,
    /** Só para teste/diagnóstico: quantas contas têm estado de login em memória. */
    stats: () => ({ connEntries: conn.size }),
    /** Resposta de GET /api/limits (memo curto: a interface consulta a cada ~15-30 s, e chamadas simultâneas dividem o mesmo cálculo). Nunca lança por dado ruim. */
    view() {
      const t = now();
      if (memo && t - memo.at >= 0 && t - memo.at < memoMs) return memo.value;
      const value = build();
      memo = { at: t, value };
      return value;
    },
    /** Apaga do disco só arquivos `<uuid>.json` (e `.tmp` órfãos) com mais de 30 dias na pasta do hook. Melhor esforço, chamado uma vez no boot. */
    sweep() {
      let removed = 0;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!e.isFile() || !/^[0-9a-f-]{36}\.json(?:\.[0-9a-f]+\.tmp)?$/i.test(e.name)) continue;
          const f = path.join(dir, e.name);
          try { if (now() - fs.lstatSync(f).mtimeMs > STALE_FILE_MS) { fs.rmSync(f, { force: true }); removed++; } } catch { /* próximo */ }
        }
      } catch { /* pasta ainda não existe */ }
      return removed;
    },
  };
}
