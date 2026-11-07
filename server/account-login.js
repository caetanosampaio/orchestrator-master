// Login de uma conta: roda `claude auth login [--console|--sso]` como processo filho SEM shell, com CLAUDE_CONFIG_DIR da conta, e expõe o andamento (URL de login, linhas
// recentes, pedido de código colado) para a interface. Só UM login por vez no servidor. A árvore de processos é encerrada no cancelamento, no timeout e no shutdown.
// A saída da CLI é dado não confiável: ANSI e caracteres de controle saem, a URL só vale com host da Anthropic, e o texto digitado pelo usuário (código) nunca é registrado em log.
import { spawn } from 'node:child_process';
import { launchSpec, envForAccount } from './claude-cli.js';
import { resolveClaude } from './providers/claude.js';
import { killTree as killTreeAsync } from './proc.js';
import { killTreeSync as killTreeSyncDefault } from './orphans.js';
import { pidAlive } from './instance-lock.js';
import { SYSTEM_ID, NOT_FOUND } from './accounts.js';

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_LINES = 12, MAX_LINE = 300, MAX_INPUT = 2048;
export const MAX_INPUTS_PER_LOGIN = 20, MIN_START_INTERVAL_MS = 2000; // limites: entradas por login e intervalo entre dois inícios
const METHOD_ARGS = Object.freeze({ claudeai: ['--claudeai'], console: ['--console'], sso: ['--sso'] }); // lista fechada: nada de --email nem argumento vindo do cliente
// Tipo no child-registry: depois de uma queda do servidor o boot reclama o login órfão (encerra a árvore se a identidade do processo for confirmada).
export const LOGIN_TRACK_KIND = 'login';
const ALLOWED_HOSTS = ['claude.ai', 'claude.com', 'console.anthropic.com', 'anthropic.com'];

// ESC [ ... (CSI), ESC ] ... BEL|ESC \ (OSC), demais ESC + 1 caractere; depois qualquer controle que sobrou
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]|\u001b./g;
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g;
/** Texto → linhas limpas (sem ANSI/controle, sem vazias). `\r` isolado também quebra linha (barras de progresso). */
export const cleanLines = (text) => String(text).replace(ANSI, '').split(/\r\n|\r|\n/).map((l) => l.replace(/\t/g, ' ').replace(CTRL, '').trim()).filter(Boolean);

/** Host permitido (ou subdomínio), https, sem credenciais embutidas nem porta. */
export function allowedUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`)) ? u.href : null;
}
/** Primeira URL https permitida do texto; `final` = false ignora a URL que termina no fim do texto (pode estar cortada no meio do fluxo). */
export function findUrl(text, final = true) {
  for (const m of String(text).matchAll(/https:\/\/[^\s"'<>`\\]+/g)) {
    if (!final && m.index + m[0].length >= text.length) continue;
    const cand = allowedUrl(m[0].replace(/[.,;:!?)\]}>]+$/, ''));
    if (cand) return cand;
  }
  return null;
}
const wantsCode = (line) => /\bpaste\b/i.test(line) && /\bcode\b/i.test(line);

export function createLoginManager({ accounts, command, prefixArgs = [], unavailable = false, resolve = resolveClaude, env = () => process.env, track = null, killTree = killTreeAsync, killTreeSync = killTreeSyncDefault, timeoutMs = LOGIN_TIMEOUT_MS, spawnFn = spawn, now = () => new Date().toISOString(), minIntervalMs = MIN_START_INTERVAL_MS, maxInputs = MAX_INPUTS_PER_LOGIN, goneTimeoutMs = 3000, isAlive = pidAlive, clock = Date.now } = {}) {
  const injected = command !== undefined;
  let lastStartAt = -Infinity; // instante do último início bem-sucedido (intervalo mínimo)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let s = null; // sessão atual ou a última concluída: { accountId, state, child, lines, partial, url, needsCode, startedAt, error, timer, tracked, finished }
  const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
  const running = () => s !== null && s.state === 'running';

  function ingest(sess, chunk) {
    if (sess !== s) return;
    const text = sess.partial + chunk.toString('utf8'), parts = text.split(/\r\n|\r|\n/);
    sess.partial = parts.pop().slice(-4096); // o trecho sem quebra (prompt "Paste code here >") fica visível e conta para needsCode
    for (const raw of parts) {
      for (const l of cleanLines(raw)) { absorb(sess, l); sess.lines.push(l.slice(0, MAX_LINE)); }
    }
    if (sess.lines.length > MAX_LINES * 4) sess.lines.splice(0, sess.lines.length - MAX_LINES * 2);
    const tail = cleanLines(sess.partial).join(' ');
    if (tail) { if (!sess.url) sess.url = findUrl(tail, false); if (wantsCode(tail)) sess.needsCode = true; }
  }
  function absorb(sess, line) { if (!sess.url) sess.url = findUrl(line); if (wantsCode(line)) sess.needsCode = true; }

  function snapshot(accountId) {
    if (!s || s.accountId !== accountId) return { state: 'idle', url: null, needsCode: false, lines: [], startedAt: null, error: null };
    const tail = cleanLines(s.partial).map((l) => l.slice(0, MAX_LINE));
    return { state: s.state, url: s.url, needsCode: s.state === 'running' && s.needsCode, lines: [...s.lines, ...tail].slice(-MAX_LINES), startedAt: s.startedAt, error: s.error };
  }

  /** Encerra de vez: timer, registro de filho, entrada, listeners. Idempotente. */
  function settle(sess, state, error = null, { keepTrack = false } = {}) { // keepTrack: cancelar/timeout só liberam o registro do filho DEPOIS de a morte ser confirmada (releaseWhenGone)
    if (sess.finished) return; sess.finished = true;
    clearTimeout(sess.timer);
    if (sess.state === 'running') { sess.state = state; sess.error = error; }
    if (sess.partial) { for (const l of cleanLines(sess.partial)) { absorb(sess, l); sess.lines.push(l.slice(0, MAX_LINE)); } sess.partial = ''; }
    try { sess.child.stdin.destroy(); } catch { /* já fechado */ }
    sess.child.stdout?.removeAllListeners('data'); sess.child.stderr?.removeAllListeners('data');
    if (!keepTrack) { try { sess.tracked?.release(); } catch { /* informativo */ } sess.tracked = null; }
    accounts.invalidate(sess.accountId); // o estado de login mudou (ou pode ter mudado)
  }

  /** Espera o PID sumir (até goneTimeoutMs) e só então solta o registro do child-registry; sem confirmação ele fica para o próximo boot reclamar. */
  async function releaseWhenGone(sess) {
    const t0 = clock();
    while (isAlive(sess.child.pid) && clock() - t0 < goneTimeoutMs) await sleep(50);
    if (isAlive(sess.child.pid)) return false;
    try { sess.tracked?.release(); } catch { /* informativo */ }
    sess.tracked = null;
    return true;
  }

  function start(accountId, method = 'claudeai') {
    if (typeof method !== 'string' || !Object.hasOwn(METHOD_ARGS, method)) return fail(400, 'Método de login inválido. Use claudeai, console ou sso.');
    if (!accounts.usable(accountId)) return fail(404, 'Conta não encontrada.');
    if (running()) return fail(409, 'Já existe um login em andamento: conclua ou cancele-o antes de iniciar outro.', { code: 'login_busy' });
    if (clock() - lastStartAt < minIntervalMs) return fail(429, `Aguarde ${Math.ceil((minIntervalMs - (clock() - lastStartAt)) / 1000)} s antes de iniciar outro login.`, { code: 'login_too_soon' });
    if (unavailable || (!injected && !resolve())) return fail(409, `${NOT_FOUND}.`, { code: 'claude_missing' });
    const spec = launchSpec({ injected, command, prefixArgs }, ['auth', 'login', ...METHOD_ARGS[method]], { resolve });
    if (spec.error) return fail(400, spec.error);
    try { accounts.ensureDir(accountId); } catch { return fail(500, 'Não foi possível preparar a pasta da conta.'); }
    const dir = accountId === SYSTEM_ID ? null : accounts.configDirOf(accountId);
    let child;
    try { child = spawnFn(spec.file, spec.args, { shell: false, windowsHide: true, windowsVerbatimArguments: spec.verbatim, stdio: ['pipe', 'pipe', 'pipe'], env: envForAccount(env(), dir) }); }
    catch { return fail(500, 'Não foi possível iniciar o Claude Code.'); }
    const sess = { accountId, state: 'running', child, lines: [], partial: '', url: null, needsCode: false, startedAt: now(), error: null, timer: null, tracked: null, finished: false, closing: false, inputs: 0 };
    s = sess;
    try { sess.tracked = track?.(LOGIN_TRACK_KIND, child.pid, { accountLogin: true }) ?? null; } // sem registro o filho não seria achado depois de uma queda: não segue vivo
    catch { try { killTreeSync(child.pid); } catch { /* já encerrado */ } child.once?.('error', () => {}); s = null; return fail(503, 'O login não pôde ser registrado; ele não foi iniciado.'); }
    lastStartAt = clock();
    child.stdout.on('data', (c) => ingest(sess, c));
    child.stderr.on('data', (c) => ingest(sess, c));
    child.stdin.on('error', () => { /* o processo pode fechar a entrada antes */ });
    sess.timer = setTimeout(() => { if (sess.finished || sess.state !== 'running' || sess.closing) return; settle(sess, 'failed', `Tempo esgotado (${Math.round(timeoutMs / 60000)} min): o login não foi concluído.`, { keepTrack: true }); Promise.resolve(killTree(child)).then(() => releaseWhenGone(sess)).catch(() => {}); }, timeoutMs);
    sess.timer.unref?.();
    child.on('error', () => { if (sess.state === 'running') settle(sess, 'failed', 'Não foi possível iniciar o Claude Code.'); });
    child.on('close', (code) => {
      if (sess.finished) return;
      if (sess.state !== 'running') return settle(sess, sess.state, sess.error);
      if (code !== 0) return settle(sess, 'failed', 'O login não foi concluído (a CLI do Claude Code encerrou com erro).');
      // Código 0 sozinho não prova nada: só vale `done` se o status da conta disser que há login.
      sess.closing = true; // janela de confirmação: input e cancelar respondem 409 login_closing
      const UNCONFIRMED = 'Não foi possível confirmar o estado da conta. Feche e confira em Contas.';
      (async () => {
        let st = await accounts.freshStatus(accountId);
        if (!st.checked) st = await accounts.freshStatus(accountId); // inconclusivo: UMA nova tentativa
        if (sess.finished) return;
        if (st.checked && st.loggedIn === true) settle(sess, 'done');
        else if (st.checked) settle(sess, 'failed', 'O login terminou, mas a conta ainda não aparece como conectada.');
        else settle(sess, 'failed', UNCONFIRMED);
      })().catch(() => { if (!sess.finished) settle(sess, 'failed', UNCONFIRMED); });
    });
    return { ok: true, status: 202 };
  }

  function input(accountId, text) {
    if (!s || s.accountId !== accountId || s.state !== 'running') return fail(409, 'Não há login em andamento nesta conta.');
    if (s.closing) return fail(409, 'O login está sendo concluído: aguarde a confirmação.', { code: 'login_closing' });
    if (typeof text !== 'string' || !text.length || text.length > MAX_INPUT || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return fail(400, `O código deve ter de 1 a ${MAX_INPUT} caracteres, sem caracteres de controle.`);
    if (s.inputs >= maxInputs) return fail(429, `Limite de ${maxInputs} entradas por login atingido: cancele e inicie o login de novo.`, { code: 'input_limit' });
    const stdin = s.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return fail(409, 'O processo de login não aceita mais entrada.');
    try { stdin.write(`${text}\n`); } catch { return fail(409, 'O processo de login não aceitou a entrada.'); }
    s.inputs++;
    return { ok: true, status: 200 };
  }

  async function cancel(accountId) {
    if (!s || s.accountId !== accountId || s.state !== 'running') return fail(409, 'Não há login em andamento nesta conta.');
    if (s.closing) return fail(409, 'O login está sendo concluído: aguarde a confirmação.', { code: 'login_closing' });
    const sess = s;
    settle(sess, 'cancelled', null, { keepTrack: true });
    await killTree(sess.child);
    await releaseWhenGone(sess);
    return { ok: true, status: 200 };
  }

  return {
    start, input, cancel, snapshot,
    isActive: (accountId) => running() && s.accountId === accountId,
    killActiveSync: () => { if (running() && s.child?.pid) { try { killTreeSync(s.child.pid); } catch { /* o processo pode já ter saído */ } } },
  };
}
