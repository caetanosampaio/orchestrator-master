// Acompanhamento ao vivo de uma missão no navegador (localhost): link de CAPACIDADE por missão, somente leitura, de curta duração e revogável.
//  - POST/DELETE /api/missions/:id/live-link cunham/revogam o link (herdam apiGuard e o token de sessão do desktop).
//  - GET /live/_/<estático>, /live/<token>/, …/data (snapshot JSON), …/stream (SSE) e …/report.md ficam FORA de /api: validam o Host aqui, só GET/HEAD, sem CORS e sem cookies.
//  - A visão (campo a campo, redigida) vem de mission-live-view.js; este módulo só serve, controla o acesso e empurra mudanças.
// Limite honesto: o token só existe em memória (some ao reiniciar). A redação do conteúdo é melhor esforço; a barreira real é link por missão + somente leitura + loopback.
// O token NUNCA vai para store.log, atividade, console nem mensagens de erro (nenhum log é feito aqui).
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { isAllowedHost } from './origin-guard.js';

export const LIVE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const LIVE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': LIVE_CSP,
});

export const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_ACTIVE_LINKS = 20;
export const MAX_STREAMS_GLOBAL = 10, MAX_STREAMS_PER_LINK = 3;
export const MAX_SNAPSHOT_BYTES = 256 * 1024;
const DEFAULT_TIMING = { coalesceMs: 500, tickMs: 2500, heartbeatMs: 20000, cacheMs: 1000, failWindowMs: 60000, maxFailures: 30 };

// Allowlist FIXA dos arquivos da página: nada é montado a partir da URL (sem express.static, sem traversal).
const STATIC_FILES = new Map([
  ['live.html', { type: 'text/html; charset=utf-8' }],
  ['live.js', { type: 'text/javascript; charset=utf-8' }],
  ['live-model.js', { type: 'text/javascript; charset=utf-8' }],
  ['live.css', { type: 'text/css; charset=utf-8' }],
]);
const LIVE_DIR = new URL('./live/', import.meta.url);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url, sem preenchimento
const BUS_EVENTS = ['task', 'log', 'state', 'cycle', 'usage'];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const NOT_FOUND = { error: 'Link inválido ou expirado.' }; // idêntico para inexistente, expirado, revogado e missão removida

/**
 * @param app Express
 * @param deps { db, bus, deliveryFor(mission) -> {ok, report}, getSquad(mission) -> tarefas do Maestro, visibleMission(id) -> missão|null, now() -> ms | ISO, env,
 *               view? { buildLiveView, liveMarkdown } (injeção; padrão: import tolerante de ./mission-live-view.js), ttlMs?, maxLinks?, timing? }
 * @returns { revokeForMission(missionId) -> boolean, closeAll() }
 */
export function setupMissionLive(app, { db, bus, deliveryFor, getSquad, visibleMission, now = () => Date.now(), env = process.env, view, ttlMs = DEFAULT_TTL_MS, maxLinks = MAX_ACTIVE_LINKS, timing = {}, staticDir = LIVE_DIR } = {}) {
  const T = { ...DEFAULT_TIMING, ...timing };
  const clock = () => { const v = now(); return typeof v === 'number' ? v : Date.parse(v); };
  const enabled = String(env?.ORCH_LIVE ?? '').trim().toLowerCase() !== 'off';

  // ---------- Registro de links (só em memória) ----------
  const links = new Map(); // sha256(token) -> { missionId, expiresAt (ms) }
  const byMission = new Map(); // missionId -> { hash, token } (o token fica só para reaproveitar o link válido ao reabrir; nunca sai do processo)
  const conns = new Set(); // conexões SSE abertas
  const cache = new Map(); // missionId -> { at, snap, json, hash }
  const fails = { start: 0, n: 0 };

  const endConns = (pred, reason) => { for (const c of [...conns]) if (pred(c)) c.end(reason); };
  function dropLink(hash, reason) {
    const e = links.get(hash); if (!e) return false;
    links.delete(hash);
    if (byMission.get(e.missionId)?.hash === hash) byMission.delete(e.missionId);
    cache.delete(e.missionId);
    endConns((c) => c.hash === hash, reason);
    return true;
  }
  const pruneExpired = () => { const t = clock(); for (const [h, e] of [...links]) if (e.expiresAt <= t) dropLink(h, 'expired'); };

  // Contador de falhas por minuto (janela fixa): acima do teto, os GET com token respondem 429 até a janela virar (adivinhar um token de 256 bits é inviável; isto só barra martelada).
  const throttledFor = () => { const t = clock(); if (t - fails.start >= T.failWindowMs) { fails.start = t; fails.n = 0; } return fails.n >= T.maxFailures ? Math.max(1, Math.ceil((fails.start + T.failWindowMs - t) / 1000)) : 0; };
  const noteFailure = () => { throttledFor(); fails.n += 1; };

  /** Token -> { hash, entry, mission } ou null (idêntico para formato inválido, inexistente, expirado, revogado e missão removida). */
  function resolve(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const hash = sha256(token);
    const entry = links.get(hash);
    if (!entry) return null;
    if (entry.expiresAt <= clock()) { dropLink(hash, 'expired'); return null; }
    let mission = null;
    try { mission = visibleMission(entry.missionId) ?? null; } catch { mission = null; }
    if (!mission) { dropLink(hash, 'removed'); return null; }
    return { hash, entry, mission };
  }

  // ---------- Visão (snapshot redigido) ----------
  let viewApi = view ?? null, viewTried = false;
  async function views() {
    if (viewApi) return viewApi;
    if (viewTried) return null;
    viewTried = true;
    try { viewApi = await import('./mission-live-view.js'); } catch { viewApi = null; } // BE-1 pode ainda não existir: as rotas respondem 503 em vez de derrubar o servidor
    return viewApi;
  }
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  /** { snap, json, hash } da missão (cache curto por missão); null se a visão não pôde ser montada. `hash` ignora `generatedAt` para "só enviar quando muda". */
  async function snapshotFor(mission, entry, maxAgeMs = T.cacheMs) {
    const hit = cache.get(mission.id);
    const wall = Date.now(); // idade do cache em tempo real (é desempenho, não segurança); o relógio injetável fica para a expiração dos links
    if (hit && wall - hit.at < maxAgeMs && wall >= hit.at) return hit;
    const api = await views();
    if (!api || typeof api.buildLiveView !== 'function') return null;
    const delivery = safe(() => { const r = deliveryFor ? deliveryFor(mission) : null; return r && r.ok ? r.report : null; }, null);
    const ctx = {
      workspace: safe(() => (db.workspaces || []).find((w) => w.id === mission.workspaceId) || null, null),
      worktrees: safe(() => (db.worktrees || []).filter((w) => w.missionId === mission.id), []),
      squad: safe(() => (getSquad ? getSquad(mission) : null), null),
      delivery,
      now: new Date(clock()).toISOString(),
      link: { expiresAt: new Date(entry.expiresAt).toISOString() },
    };
    let snap;
    try { snap = api.buildLiveView(mission, ctx); } catch { return null; }
    if (!snap || typeof snap !== 'object') return null;
    snap = { ...snap, link: { expiresAt: ctx.link.expiresAt } };
    const json = JSON.stringify(snap);
    if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) return null;
    const { generatedAt: _g, ...rest } = snap;
    const rec = { at: wall, snap, json, hash: sha256(JSON.stringify(rest)) };
    cache.set(mission.id, rec);
    return rec;
  }

  // ---------- Rotas /live ----------
  const router = express.Router({ strict: true }); // /live/<token> (redireciona) e /live/<token>/ (página) são rotas distintas
  router.use((req, res, next) => {
    res.removeHeader('X-Powered-By');
    for (const [k, v] of Object.entries(LIVE_HEADERS)) res.setHeader(k, v);
    if (!isAllowedHost(req.get('host'))) return res.status(403).json({ error: 'Host não permitido.' });
    if (!enabled) return res.status(404).json(NOT_FOUND);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ error: 'Método não permitido.' }); }
    return next();
  });

  router.get('/_/:name', (req, res) => {
    const f = STATIC_FILES.get(req.params.name);
    if (!f) return res.status(404).json(NOT_FOUND);
    fs.readFile(new URL(req.params.name, staticDir), (err, buf) => { // nome já validado contra a allowlist
      if (err) return res.status(404).json(NOT_FOUND); // arquivo ainda não existe (ou ilegível): resposta genérica
      res.status(200).type(f.type).send(buf);
    });
  });

  // Rotas com token: o teto de falhas vale antes de qualquer consulta; a falha de resolução conta e responde 404 idêntico.
  function withLink(handler) {
    return async (req, res) => {
      const wait = throttledFor();
      if (wait) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' }); }
      const link = resolve(req.params.token);
      if (!link) { noteFailure(); return res.status(404).json(NOT_FOUND); }
      try { return await handler(req, res, link); } catch { if (!res.headersSent) res.status(500).json({ error: 'Não foi possível montar a visão.' }); else res.end(); return undefined; }
    };
  }
  const sendPage = (res) => fs.readFile(new URL('live.html', staticDir), (err, buf) => (err ? res.status(404).json(NOT_FOUND) : res.status(200).type('text/html; charset=utf-8').send(buf)));

  router.get('/:token', (req, res) => {
    const wait = throttledFor();
    if (wait) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' }); }
    if (!resolve(req.params.token)) { noteFailure(); return res.status(404).json(NOT_FOUND); }
    return res.redirect(302, `/live/${req.params.token}/`);
  });
  router.get('/:token/', withLink((req, res) => sendPage(res)));

  router.get('/:token/data', withLink(async (req, res, link) => {
    const rec = await snapshotFor(link.mission, link.entry);
    if (!rec) return res.status(503).json({ error: 'Visão ao vivo indisponível.' });
    const etag = `"${rec.hash.slice(0, 32)}"`;
    res.setHeader('ETag', etag);
    const inm = req.get('if-none-match');
    if (inm && inm.split(',').some((v) => v.trim() === etag || v.trim() === `W/${etag}`)) return res.status(304).end();
    return res.status(200).type('application/json; charset=utf-8').send(rec.json);
  }));

  router.get('/:token/report.md', withLink(async (req, res, link) => {
    const rec = await snapshotFor(link.mission, link.entry);
    const api = await views();
    if (!rec || !api || typeof api.liveMarkdown !== 'function') return res.status(503).json({ error: 'Visão ao vivo indisponível.' });
    const md = api.liveMarkdown(rec.snap);
    res.setHeader('Content-Disposition', 'attachment; filename="forge-missao-relatorio.md"');
    return res.status(200).type('text/markdown; charset=utf-8').send(typeof md === 'string' ? md : '');
  }));

  router.get('/:token/stream', withLink((req, res, link) => {
    if (req.method === 'HEAD') return res.status(200).type('text/event-stream; charset=utf-8').end();
    const { hash, entry } = link;
    if (conns.size >= MAX_STREAMS_GLOBAL) return res.status(429).json({ error: 'Conexões demais com o acompanhamento.' });
    if ([...conns].filter((c) => c.hash === hash).length >= MAX_STREAMS_PER_LINK) return res.status(429).json({ error: 'Conexões demais com este link.' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); // demais cabeçalhos já definidos no guard
    res.write('retry: 3000\n\n');
    const missionId = entry.missionId;
    const c = { hash, res, closed: false, lastHash: null, lastSendAt: 0, pending: null, busy: false, timers: [], handlers: [], end: null };
    const write = (s) => { try { res.write(s); } catch { cleanup(); } };
    function cleanup() {
      if (c.closed) return; c.closed = true;
      conns.delete(c); clearTimeout(c.pending); for (const t of c.timers) clearInterval(t);
      for (const [k, fn] of c.handlers) bus.off(k, fn);
    }
    c.end = (reason) => { if (c.closed) return; write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`); cleanup(); try { res.end(); } catch { /* já fechado */ } };
    async function flush(maxAge) {
      if (c.closed || c.busy) return;
      c.busy = true;
      try {
        const e = links.get(hash);
        if (!e) return c.end('revoked');
        if (e.expiresAt <= clock()) { dropLink(hash, 'expired'); return undefined; } // dropLink encerra esta conexão com `end`
        let mission = null; try { mission = visibleMission(missionId) ?? null; } catch { mission = null; }
        if (!mission) { dropLink(hash, 'removed'); return undefined; }
        const rec = await snapshotFor(mission, e, maxAge);
        if (c.closed || !rec) return undefined;
        if (rec.hash !== c.lastHash) { c.lastHash = rec.hash; c.lastSendAt = Date.now(); write(`event: snapshot\ndata: ${rec.json}\n\n`); }
      } catch { /* a próxima volta tenta de novo */ } finally { c.busy = false; }
      return undefined;
    }
    // Coalescência: no máximo 1 envio por T.coalesceMs; rajadas de eventos viram uma leitura só.
    const trigger = () => {
      if (c.closed || c.pending) return;
      const wait = Math.max(0, T.coalesceMs - (Date.now() - c.lastSendAt));
      c.pending = setTimeout(() => { c.pending = null; flush(Math.min(T.coalesceMs, T.cacheMs)); }, wait); c.pending.unref?.();
    };
    for (const k of BUS_EVENTS) { const fn = (d) => { if (d && d.missionId === missionId) trigger(); }; c.handlers.push([k, fn]); bus.on(k, fn); }
    const tick = setInterval(() => flush(T.cacheMs), T.tickMs); tick.unref?.(); // squad/Maestro não emitem evento: o timer de segurança cobre
    const beat = setInterval(() => write(': ping\n\n'), T.heartbeatMs); beat.unref?.();
    c.timers.push(tick, beat);
    conns.add(c);
    res.on('close', cleanup); // 'close' da resposta = a conexão acabou (o 'close' da requisição pode vir antes, ao fim da leitura do corpo)
    return flush(0);
  }));

  router.use((req, res) => res.status(404).json(NOT_FOUND)); // qualquer outra coisa sob /live: 404 genérico
  app.use('/live', router);

  // ---------- Cunhar / revogar (em /api) ----------
  const off = (res) => res.status(404).json({ error: 'O acompanhamento ao vivo está desligado neste servidor (ORCH_LIVE=off).' });

  app.post('/api/missions/:id/live-link', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return off(res);
    const host = req.get('host');
    if (!isAllowedHost(host)) return res.status(403).json({ error: 'Host não permitido.' });
    let mission = null; try { mission = visibleMission(req.params.id) ?? null; } catch { mission = null; }
    if (!mission) return res.status(404).json({ error: 'Missão não encontrada.' });
    if (mission.demo) return res.status(409).json({ error: 'Missão demonstrativa: não há o que acompanhar.' });
    pruneExpired();
    let rec = byMission.get(mission.id);
    if (!rec) {
      if (links.size >= maxLinks) return res.status(409).json({ error: `Limite de ${maxLinks} links ativos atingido: encerre algum link antes de criar outro.` });
      const token = randomBytes(32).toString('base64url');
      rec = { hash: sha256(token), token };
      links.set(rec.hash, { missionId: mission.id, expiresAt: clock() + ttlMs });
      byMission.set(mission.id, rec);
      cache.delete(mission.id);
    }
    const e = links.get(rec.hash);
    return res.status(201).json({ url: `http://${host}/live/${rec.token}/`, expiresAt: new Date(e.expiresAt).toISOString() });
  });

  app.delete('/api/missions/:id/live-link', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return off(res);
    const rec = byMission.get(req.params.id);
    if (rec) { dropLink(rec.hash, 'revoked'); return res.status(204).end(); }
    let mission = null; try { mission = visibleMission(req.params.id) ?? null; } catch { mission = null; }
    if (!mission) return res.status(404).json({ error: 'Missão não encontrada.' });
    return res.status(204).end(); // idempotente: já não havia link
  });

  return {
    /** Chame ao remover a missão: descarta o link e encerra os streams (`end`). */
    revokeForMission(missionId) { const rec = byMission.get(missionId); return rec ? dropLink(rec.hash, 'removed') : false; },
    /** Encerra todos os streams abertos (desligamento do servidor / testes). */
    closeAll() { endConns(() => true, 'shutdown'); },
  };
}
