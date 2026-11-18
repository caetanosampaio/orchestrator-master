// Preview SEM servidor do painel Live: serve a pasta do workspace SOMENTE LEITURA num servidor HTTP próprio (node:http, 127.0.0.1, porta efêmera).
// ORIGEM DIFERENTE da API do FORGE de propósito: o JS da página servida nunca tem a origem da API (apiGuard recusa Sec-Fetch-Site same-site/cross-site, o Electron injeta
// o token de sessão só na origem da interface e a CSP da página tem connect-src 'self'). O servidor nunca lê token, banco nem .env: só arquivos regulares do docroot.
// Um listener por workspace (máx. 3; o menos recente é fechado), sob demanda e fechado após 10 min sem uso. A recarga automática não injeta script: o cliente consulta
// `version` (hash de caminho:tamanho:mtime dos arquivos servíveis) pela API e remonta o iframe quando ela muda.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodeRequestPath, mimeOf, pickDocroot, realOf, isInside, samePath, segmentProblem } from './live-paths.js';

export const LIMITS = Object.freeze({
  maxListeners: 3, idleMs: 10 * 60 * 1000, sweepMs: 30 * 1000, maxFileBytes: 10 * 1024 * 1024, maxFiles: 2000, maxDepth: 8, maxVisited: 20000, memoMs: 1000,
  maxConnections: 32, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 2000,
  socketTimeoutMs: 30000, // inatividade do socket (nenhum byte lido nem escrito): cliente que pede arquivo grande e não lê é derrubado; download lento que progride não
});
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const PREVIEW_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors http://127.0.0.1:* http://localhost:*";
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'content-security-policy': PREVIEW_CSP,
});
const NOT_FOUND = Buffer.from('Não encontrado.', 'utf8'); // o MESMO corpo para dotfile, fora da lista, sensível e inexistente: nada vaza a existência
const TEXT_PLAIN = 'text/plain; charset=utf-8';

const realpathNative = (p) => new Promise((resolve) => fs.realpath.native(p, (e, r) => resolve(e ? null : r)));
const defaultTimer = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return () => clearInterval(t); };

/** Varre o docroot e devolve { version, files, truncated } com SÓ o que o servidor serviria (mesmos filtros): sem links, sem ocultos/sensíveis/pasta de dados, extensão da lista. */
export async function scanDocroot(real, { dataReal = null, limits = LIMITS } = {}) {
  const lines = []; let truncated = false, visited = 0;
  const walk = async (dir, rel, depth) => {
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      if (truncated) return;
      if (++visited > limits.maxVisited) { truncated = true; return; }
      if (e.isSymbolicLink() || segmentProblem(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (dataReal && isInside(abs, dataReal)) continue;
      if (e.isDirectory()) { if (depth < limits.maxDepth) await walk(abs, `${rel}${e.name}/`, depth + 1); else truncated = true; continue; }
      if (!e.isFile() || !mimeOf(e.name)) continue;
      let st; try { st = await fsp.lstat(abs); } catch { continue; }
      if (!st.isFile() || st.nlink > 1) continue;
      if (lines.length >= limits.maxFiles) { truncated = true; return; }
      lines.push(`${rel}${e.name}:${st.size}:${st.mtimeMs}`);
    }
  };
  await walk(real, '', 0);
  return { version: crypto.createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12), files: lines.length, truncated };
}

/** Gerenciador dos listeners. `db` (workspaces) só é lido pelas rotas; aqui entram objetos de workspace. `now`/`setTimer` são injetáveis para testar a ociosidade. */
export function createPreviewManager({ db = null, dataDir = null, now = Date.now, setTimer = defaultTimer, limits = {}, hooks = {} } = {}) {
  const L = { ...LIMITS, ...limits };
  const listeners = new Map(); // workspaceId -> estado do listener
  const starting = new Map();
  let cancelSweep = null, closed = false;
  const dataReal = () => (dataDir ? (realOf(dataDir) ?? path.resolve(dataDir)) : null);

  const stopListener = (s) => {
    listeners.delete(s.id);
    if (!listeners.size && cancelSweep) { cancelSweep(); cancelSweep = null; }
    return new Promise((resolve) => { try { s.server.close(() => resolve()); s.server.closeAllConnections?.(); } catch { resolve(); } });
  };
  const sweep = () => { for (const s of [...listeners.values()]) if (now() - s.lastHit > L.idleMs) void stopListener(s); };
  const ensureSweep = () => { if (!cancelSweep) cancelSweep = setTimer(sweep, L.sweepMs); };

  // ---------- resposta ----------
  const send = (req, res, status, { body = null, type = TEXT_PLAIN, size = null, headers = {} } = {}) => {
    const len = size ?? (body ? body.length : 0);
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type, 'content-length': len, ...headers });
    res.end(req.method === 'HEAD' || !body ? undefined : body);
  };
  const notFound = (req, res) => send(req, res, 404, { body: NOT_FOUND });
  const text = (req, res, status, msg, headers) => send(req, res, status, { body: Buffer.from(msg, 'utf8'), headers });

  /** Caminho real contido: o realpath tem de ser EXATAMENTE docroot-real + segmentos (qualquer link/junção no meio muda o resultado) e fora da pasta de dados. */
  const contained = async (root, segments) => {
    const abs = path.join(root, ...segments);
    const real = await realpathNative(abs);
    if (!real || !samePath(real, abs)) return null;
    const dr = dataReal();
    if (dr && isInside(real, dr)) return null;
    return real;
  };

  /**
   * Abre o arquivo JÁ validado e REVERIFICA depois de aberto (TOCTOU: um agente pode trocar uma pasta por junção entre o realpath e o open).
   * Aceita só se: o descritor é arquivo regular sem outro nome (nlink 1); o realpath do caminho continua IGUAL ao validado (antes e depois de um stat por caminho);
   * o stat por caminho tem o MESMO dev/ino do descritor aberto; e o caminho final não está na pasta de dados. No Linux confere também o caminho do próprio descritor.
   * Qualquer divergência => null (o chamador responde o 404 genérico) e o descritor é fechado. `hooks.beforeOpen/afterOpen` existem só para o teste simular a troca.
   */
  const openChecked = async (root, segs) => {
    const abs = path.join(root, ...segs);
    if (!(await contained(root, segs))) return null;
    let fh = null, ok = false;
    try {
      await hooks.beforeOpen?.(abs);
      fh = await fsp.open(abs, 'r');
      await hooks.afterOpen?.(abs);
      const st = await fh.stat({ bigint: true });
      const r1 = await realpathNative(abs);
      const byPath = await fsp.stat(abs, { bigint: true });
      const r2 = await realpathNative(abs);
      const dr = dataReal();
      let fdOk = true;
      if (process.platform === 'linux') { const fdReal = await realpathNative(`/proc/self/fd/${fh.fd}`); fdOk = !fdReal || samePath(fdReal, abs); }
      ok = st.isFile() && st.nlink <= 1n && !!r1 && !!r2 && samePath(r1, abs) && samePath(r2, abs) && byPath.dev === st.dev && byPath.ino === st.ino && fdOk && !(dr && (isInside(r1, dr) || isInside(r2, dr)));
      return ok ? { fh, size: Number(st.size) } : null;
    } catch { return null; } finally { if (!ok) { try { await fh?.close(); } catch { /* já fechado */ } } }
  };

  async function serve(s, req, res) {
    s.lastHit = now();
    const host = req.headers.host;
    if (host !== `127.0.0.1:${s.port}` && host !== `localhost:${s.port}`) return text(req, res, 403, 'Acesso negado.');
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return text(req, res, 403, 'Acesso negado.');
    if (typeof req.url !== 'string' || !req.url.startsWith('/')) return text(req, res, 400, 'Requisição inválida.');
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(req, res, 405, 'Método não permitido.', { allow: 'GET, HEAD' });
    const d = decodeRequestPath(req.url);
    if (!d.ok) return d.status === 400 ? text(req, res, 400, 'Requisição inválida.') : notFound(req, res);
    const root = s.docroot?.real;
    if (!root) return notFound(req, res);
    let segs = d.segments;
    if (d.dir) segs = [...segs, 'index.html'];
    else if (!mimeOf(segs.at(-1))) {
      // `/sub` sem barra: se for uma pasta real contida, redireciona para o caminho SANEADO (reconstruído dos segmentos validados, nunca o texto bruto)
      const real = await contained(root, segs);
      let isDir = false; if (real) { try { isDir = (await fsp.stat(real)).isDirectory(); } catch { /* some */ } }
      if (!isDir) return notFound(req, res);
      return text(req, res, 301, 'Movido.', { location: `/${segs.map(encodeURIComponent).join('/')}/` });
    }
    const type = mimeOf(segs.at(-1));
    if (!type) return notFound(req, res);
    const opened = await openChecked(root, segs);
    if (!opened) return notFound(req, res);
    const { fh, size } = opened;
    try {
      if (size > L.maxFileBytes) { await fh.close(); return text(req, res, 413, 'Arquivo grande demais para o preview.'); }
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'content-length': size });
      if (req.method === 'HEAD' || size === 0) { await fh.close(); return void res.end(); }
      const rs = fh.createReadStream({ start: 0, end: size - 1, autoClose: true }); // lê só o tamanho já medido: o Content-Length nunca fica errado se o arquivo crescer
      res.on('close', () => rs.destroy());
      rs.on('error', () => res.destroy());
      rs.pipe(res);
    } catch {
      try { await fh.close(); } catch { /* já fechado */ }
      if (!res.headersSent) notFound(req, res); else res.destroy();
    }
  }

  const handler = (s) => (req, res) => {
    req.resume();
    serve(s, req, res).catch(() => { try { if (!res.headersSent) text(req, res, 500, 'Erro interno.'); else res.destroy(); } catch { /* conexão já caiu */ } });
  };

  async function startListener(id) {
    // limite: o menos recentemente usado sai para dar lugar ao novo
    while (listeners.size >= L.maxListeners) {
      const oldest = [...listeners.values()].sort((a, b) => a.lastHit - b.lastHit)[0];
      await stopListener(oldest);
    }
    const s = { id, server: null, port: 0, docroot: null, startedAt: now(), lastHit: now(), memo: null };
    const server = http.createServer({ requestTimeout: L.requestTimeout, headersTimeout: L.headersTimeout, keepAliveTimeout: L.keepAliveTimeout, maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, handler(s));
    server.maxConnections = L.maxConnections;
    server.keepAliveTimeout = L.keepAliveTimeout;
    server.timeout = L.socketTimeoutMs; // socket parado (ex.: pediu arquivo grande e não lê) não segura uma das conexões para sempre
    server.on('timeout', (socket) => { socket.destroy(); }); // com ouvinte registrado o Node não destrói sozinho; destruir também encerra o stream de leitura (res 'close')
    s.server = server;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port: 0, host: '127.0.0.1' }, () => { server.off('error', reject); resolve(); }); });
    } catch { try { server.close(); } catch { /* nunca abriu */ } return null; }
    server.on('error', () => {}); // erro tardio de conexão não derruba o FORGE
    server.unref();
    s.port = server.address().port;
    if (closed) { try { server.close(); server.closeAllConnections?.(); } catch { /* ok */ } return null; }
    while (listeners.size >= L.maxListeners) { // dois starts em paralelo passam pelo limite lá em cima: confere de novo antes de registrar
      const oldest = [...listeners.values()].sort((a, b) => a.lastHit - b.lastHit)[0];
      await stopListener(oldest);
    }
    listeners.set(id, s);
    ensureSweep();
    return s;
  }

  const workspaceOk = (ws) => { const r = ws && typeof ws.path === 'string' ? realOf(ws.path) : null; try { return !!r && fs.statSync(r).isDirectory(); } catch { return false; } };
  const versionOf = async (s) => {
    const t = now();
    if (s.memo && s.memo.key === s.docroot.real && t - s.memo.at < L.memoMs) return s.memo.value;
    const value = await scanDocroot(s.docroot.real, { dataReal: dataReal(), limits: L });
    s.memo = { key: s.docroot.real, at: t, value };
    return value;
  };

  return {
    /** Liga (se preciso) o listener do workspace e devolve o que o contrato de POST /api/live/preview pede. */
    async ensure(ws) {
      if (closed) return { available: false, reason: 'start-failed' };
      if (!workspaceOk(ws)) return { available: false, reason: 'workspace-missing' };
      const dr = pickDocroot(ws.path, { dataReal: dataReal() });
      let s = listeners.get(ws.id);
      if (!dr) { if (s) { s.docroot = null; s.lastHit = now(); } return { available: false, reason: 'no-index' }; }
      if (!s) {
        let p = starting.get(ws.id);
        if (!p) { p = startListener(ws.id).finally(() => starting.delete(ws.id)); starting.set(ws.id, p); }
        s = await p;
        if (!s) return { available: false, reason: 'start-failed' };
      }
      s.docroot = dr; s.lastHit = now(); // a URL (porta) fica estável mesmo se a raiz mudar
      const v = await versionOf(s);
      return { available: true, port: s.port, path: '/', docroot: dr.rel, entry: 'index.html', version: v.version, files: v.files, truncated: v.truncated, startedAt: s.startedAt };
    },
    /** Estado SEM efeito colateral (não liga listener); conta como uso (lastHit) para o listener não expirar enquanto o painel olha. */
    async peek(ws) {
      const s = listeners.get(ws?.id);
      const dr = workspaceOk(ws) ? pickDocroot(ws.path, { dataReal: dataReal() }) : null;
      if (s) { s.lastHit = now(); s.docroot = dr; }
      if (!dr) return { running: !!s, available: false, port: s?.port ?? null, docroot: null, version: null, files: 0, truncated: false };
      if (!s) return { running: false, available: true, port: null, docroot: dr.rel, version: null, files: 0, truncated: false };
      const v = await versionOf(s);
      return { running: true, available: true, port: s.port, docroot: dr.rel, version: v.version, files: v.files, truncated: v.truncated };
    },
    /** Estado interno para testes e diagnóstico (nenhum caminho absoluto). */
    listeners: () => [...listeners.values()].map((s) => ({ workspaceId: s.id, port: s.port, startedAt: s.startedAt, lastHit: s.lastHit })),
    /** Fecha tudo (listeners e conexões keep-alive). Seguro de chamar várias vezes. */
    close() {
      closed = true;
      if (cancelSweep) { cancelSweep(); cancelSweep = null; }
      return Promise.all([...listeners.values()].map((s) => stopListener(s))).then(() => undefined);
    },
    sweep, // exposto para o teste de ociosidade com relógio injetado
  };
}

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const findWs = (db, id) => (db.workspaces ?? []).find((w) => w.id === id) ?? null;

/** POST /api/live/preview (liga o preview) e GET /api/live/preview?workspaceId= (estado, sem efeito colateral). Montadas sob /api: herdam apiGuard e o token de sessão do desktop. */
export function setupLivePreview(app, { db, manager }) {
  app.post('/api/live/preview', async (req, res) => {
    const b = req.body;
    if (!isObj(b) || Object.keys(b).some((k) => k !== 'workspaceId') || typeof b.workspaceId !== 'string' || !ID_RE.test(b.workspaceId)) return bad(res, 'Corpo inválido: envie apenas { "workspaceId": "..." }.');
    const ws = findWs(db, b.workspaceId);
    if (!ws) return bad(res, 'Workspace não encontrado.', 404);
    try { res.set('Cache-Control', 'no-store').json(await manager.ensure(ws)); } catch { bad(res, 'Não foi possível preparar o preview.', 500); }
  });
  app.get('/api/live/preview', async (req, res) => {
    const id = req.query.workspaceId;
    if (typeof id !== 'string' || !ID_RE.test(id)) return bad(res, 'workspaceId ausente ou inválido.');
    const ws = findWs(db, id);
    if (!ws) return bad(res, 'Workspace não encontrado.', 404);
    try { res.set('Cache-Control', 'no-store').json(await manager.peek(ws)); } catch { bad(res, 'Não foi possível ler o estado do preview.', 500); }
  });
}
