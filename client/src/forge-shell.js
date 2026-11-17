// Lógica PURA do shell novo (sidebar, abas de terminais, painel Live e barra de status). Sem React nem DOM: testada em server/test/forge-shell.test.mjs.

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** Tempo decorrido compacto, como na sidebar do Orca: "agora", "12m", "3h", "2d". Instante inválido ou futuro = ''. */
export function elapsed(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t) || t > now + 5000) return '';
  const ms = Math.max(0, now - t);
  if (ms < MIN) return 'agora';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

/** Duração até um instante futuro em duas unidades ("2h 48m", "4d 6h", "35m"), para os limites na barra de status. Passado ou inválido = null. */
export function untilShort(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t) || t <= now) return null;
  const ms = t - now, d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(1, m)}m`;
}

/** "~/projeto/pasta" curto: os dois últimos segmentos do caminho. */
export function shortPath(p) {
  const parts = String(p ?? '').split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/') || String(p ?? '');
}

/** Estado do terminal (paneState + 'boot') ou tom do workspace (wsTone) -> tom do glifo de status. */
const TONE = { working: 'work', work: 'work', boot: 'boot', waiting: 'wait', wait: 'wait', done: 'done', idle: 'idle', failed: 'err', err: 'err', exited: 'off', cancel: 'off', off: 'off' };
export const glyphTone = (state) => TONE[state] ?? 'idle';

// ---------- saída dos terminais ----------

// CSI (cores, cursor), OSC (título, hiperlinks; termina em BEL ou ST) e escapes de 2 bytes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
/** Remove sequências ANSI e caracteres de controle (exceto quebra de linha), deixando o texto legível. */
export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// Linhas que são só moldura da TUI (caixas, réguas, spinners) ou prompt vazio não dizem o que o agente está fazendo.
const NOISE = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝▔▁▏▕█▌▐░▒▓·•∙⋯…>❯$%#*✻✳✶✢⏺⎿\-_=+|]*$/u;
/**
 * As últimas `n` linhas com conteúdo da saída de um terminal (sem ANSI, sem moldura, sem prompt vazio), da mais antiga para a mais nova.
 * `\r` sozinho reescreve a linha (barras de progresso): fica só o último trecho de cada linha.
 */
export function lastLines(text, n = 1, maxLen = 160) {
  const clean = stripAnsi(text);
  const lines = clean.split('\n').map((l) => { const seg = l.split('\r').filter((x) => x.trim()); return (seg.at(-1) ?? '').replace(/\s+/g, ' ').trim(); });
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    const l = lines[i];
    if (!l || NOISE.test(l) || !/[\p{L}\p{N}]/u.test(l)) continue;
    out.unshift(l.replace(/^[⏺⎿•●○◦▶►✻✳✶*>❯\s]+/u, '').slice(0, maxLen));
  }
  return out;
}

const LOOP_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s'"`<>)\]}]*)?/gi;

/** Normaliza uma URL local: 0.0.0.0 vira localhost (é onde o navegador alcança o servidor); tira a pontuação final colada no texto. */
function tidy(u) {
  return u.replace(/[.,;:!?]+$/, '').replace('://0.0.0.0:', '://localhost:');
}

/** URLs de servidores locais (localhost/127.0.0.1/0.0.0.0 com porta) citadas na saída, sem repetição, da mais RECENTE para a mais antiga. */
export function detectLocalUrls(text) {
  const found = stripAnsi(text).match(URL_RE) ?? [];
  const seen = new Set(), out = [];
  for (let i = found.length - 1; i >= 0; i--) { const u = tidy(found[i]); const k = u.replace(/\/$/, ''); if (!seen.has(k)) { seen.add(k); out.push(u); } }
  return out;
}

/**
 * A URL pode ir para o iframe do painel Live? Só http(s) em loopback, com porta, e nunca a porta do próprio FORGE (`blockedPorts`):
 * a interface do FORGE dentro dela mesma não faz sentido e o servidor já a recusa em iframe. Devolve o href normalizado ou null.
 */
export function safePreviewUrl(raw, blockedPorts = []) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2048) return null;
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `http://${s}`); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!LOOP_HOSTS.has(u.hostname)) return null;
  if (!u.port) return null;
  if (blockedPorts.map(String).includes(u.port)) return null;
  if (u.username || u.password) return null;
  if (u.hostname === '0.0.0.0') u.hostname = 'localhost';
  return u.href;
}

/** Rótulo curto de uma URL local para os chips: "localhost:5173/admin". */
export const urlLabel = (href) => { try { const u = new URL(href); return `${u.hostname}:${u.port}${u.pathname === '/' ? '' : u.pathname}`; } catch { return String(href ?? ''); } };

/** O que o hook do agente diz que ele está fazendo, em português (o texto da saída complementa). */
const EVENTS = { PreToolUse: 'usando uma ferramenta', PostToolUse: 'processando o resultado', UserPromptSubmit: 'lendo o pedido', Notification: 'pediu sua atenção', Stop: 'terminou a vez', SubagentStop: 'subagente terminou', SessionStart: 'iniciando' };
export const eventLabel = (ev) => EVENTS[ev] ?? '';
