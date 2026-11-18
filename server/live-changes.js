// Aba "Construção" do painel Live: arquivos criados/alterados/removidos no workspace, somente leitura.
// Modo `git` (status + numstat, argumentos FIXOS, nada vem do cliente) e modo `scan` (varredura por mtime) quando não há Git. Falha ou tempo esgotado do Git
// vira `mode:"none"` com `error` (nunca 500). Nenhum caminho absoluto sai daqui: os caminhos são relativos ao workspace, com `/`.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { git as defaultGit } from './worktrees.js';
import { isSkippedDir } from './evidence.js';
import { isInside, isSensitiveName, realOf } from './live-paths.js';

export const CHANGES_LIMITS = Object.freeze({
  maxFiles: 200, gitCmdMs: 5000, gitTotalMs: 8000, memoMs: 1500, sinceDefaultMs: 30 * 60 * 1000, sinceMaxMs: 24 * 60 * 60 * 1000,
  statMax: 2000, countMaxFiles: 50, countMaxFileBytes: 256 * 1024, countMaxTotalBytes: 2 * 1024 * 1024,
  scanDepth: 6, scanEntries: 5000, scanMs: 2000, pathMax: 300, maxConcurrent: 2, hooks: null,
});
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const GIT_ENV = Object.freeze({ GIT_OPTIONAL_LOCKS: '0' }); // `status` não grava o índice (nem disputa o index.lock com o agente)

const emptyTotals = () => ({ files: 0, added: 0, removed: 0, created: 0, modified: 0, deleted: 0 });
const isEnvName = (name) => /^\.env/i.test(name);
const noRead = (rel) => { const n = rel.split('/').pop(); return isSensitiveName(n) || isEnvName(n); }; // nunca lê o CONTEÚDO de segredos para contar linhas

/**
 * Conta linhas de um arquivo de texto (NUL => binário). Abre, REVERIFICA (TOCTOU: o caminho pode virar link/junção entre a checagem e o open) e só então lê pelo descritor.
 * Vale só se o descritor tem o mesmo dev/ino que o `lstat` do caminho (link não é seguido), o realpath continua dentro do workspace e o tamanho cabe. Devolve { lines, binary } ou null.
 */
async function countLines(abs, root, maxBytes, hooks) {
  let fh;
  try {
    await hooks?.beforeOpen?.(abs);
    fh = await fsp.open(abs, 'r');
    await hooks?.afterOpen?.(abs);
    const st = await fh.stat({ bigint: true });
    const byPath = await fsp.lstat(abs, { bigint: true });
    const real = await new Promise((res) => fs.realpath.native(abs, (e, r) => res(e ? null : r)));
    if (!st.isFile() || byPath.isSymbolicLink() || byPath.dev !== st.dev || byPath.ino !== st.ino || !real || !isInside(real, root) || st.size > BigInt(maxBytes)) return null;
    const size = Number(st.size);
    const buf = Buffer.alloc(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    const b = buf.subarray(0, bytesRead);
    if (b.includes(0)) return { lines: null, binary: true };
    let n = 0; for (const c of b) if (c === 10) n++;
    if (b.length && b[b.length - 1] !== 10) n++;
    return { lines: n, binary: false };
  } catch { return null; } finally { try { await fh?.close(); } catch { /* ok */ } }
}

/** Preenche added/binary de arquivos sem contagem do Git (untracked) ou do scan, respeitando limites (≤ N arquivos, ≤ tamanho, ≤ total) e a contenção por realpath no workspace. */
async function fillCounts(items, root, lim, maxFiles) {
  let total = 0, n = 0;
  for (const it of items) {
    if (n >= maxFiles) break;
    if (it.status === 'deleted' || noRead(it.path)) continue;
    const abs = path.join(root, ...it.path.split('/'));
    let st; try { st = await fsp.lstat(abs); } catch { continue; }
    if (!st.isFile() || st.isSymbolicLink()) continue; // link nunca é seguido nem lido
    const real = realOf(abs);
    if (!real || !isInside(real, root)) continue;
    if (st.size > lim.countMaxFileBytes || total + st.size > lim.countMaxTotalBytes) continue;
    n++; total += st.size;
    const r = await countLines(abs, root, lim.countMaxFileBytes, lim.hooks);
    if (r) { it.added = r.lines; it.binary = r.binary; }
  }
}

const byRecent = (a, b) => (a.status === 'deleted') - (b.status === 'deleted') || (b.mtime ?? -1) - (a.mtime ?? -1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function summarize(all, lim) {
  const totals = emptyTotals(); totals.files = all.length;
  for (const f of all) {
    if (typeof f.added === 'number') totals.added += f.added;
    if (typeof f.removed === 'number') totals.removed += f.removed;
    if (f.status === 'deleted') totals.deleted++; else if (f.status === 'added' || f.status === 'untracked') totals.created++; else totals.modified++;
  }
  const files = all.slice().sort(byRecent).slice(0, lim.maxFiles);
  return { totals, files, truncated: all.length > lim.maxFiles };
}

/** `git status --porcelain=v1 -z` (sem renomeações): [{ x, y, p }]. */
export function parsePorcelain(out) {
  const res = [];
  for (const rec of String(out).split('\0')) if (rec.length > 3 && rec[2] === ' ') res.push({ x: rec[0], y: rec[1], p: rec.slice(3) });
  return res;
}
/** `git diff --numstat -z`: Map caminho => { added, removed, binary }. */
export function parseNumstat(out) {
  const m = new Map();
  for (const rec of String(out).split('\0')) {
    const r = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(rec); if (!r) continue;
    const bin = r[1] === '-' || r[2] === '-';
    m.set(r[3], { added: bin ? null : Number(r[1]), removed: bin ? null : Number(r[2]), binary: bin });
  }
  return m;
}
export function statusOf(x, y) {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A' || y === 'A') return 'added';
  return 'modified';
}

// Configuração do repositório que FAZ O GIT EXECUTAR um comando em `status`/`diff` (filtros clean/process e drivers textconv/command): um repositório hostil a usaria para rodar código
// a cada consulta do painel. Se existir QUALQUER uma, o FORGE não chama status nem diff e usa a varredura (que não executa Git).
const EXEC_CONFIG = '^(filter|diff)\\..*\\.(clean|process|textconv|command)$';
const FILTER_WARNING = 'Este repositório define filtros ou comandos do Git (filter/diff) que o FORGE não executa; as mudanças vêm da varredura de arquivos, sem +/− do Git.';

export function createChangesService({ db = null, git = defaultGit, now = Date.now, limits = {} } = {}) {
  const lim = { ...CHANGES_LIMITS, ...limits };
  const memo = new Map(), inflight = new Map();
  void db; // os workspaces chegam resolvidos pelas rotas

  // No máximo `maxConcurrent` computações ao mesmo tempo (Git e varredura): consultas de vários workspaces não empilham processos.
  let running = 0; const waiting = [];
  const limited = async (fn) => {
    while (running >= lim.maxConcurrent) await new Promise((res) => waiting.push(res));
    running++;
    try { return await fn(); } finally { running--; waiting.shift()?.(); }
  };
  /** Memo (memoMs) + single-flight por chave. */
  const memoized = (key, fn) => {
    const t = now(), hit = memo.get(key);
    if (hit && t - hit.at < lim.memoMs) return Promise.resolve(hit.value);
    let p = inflight.get(key);
    if (!p) {
      p = limited(fn).then((value) => { memo.set(key, { at: now(), value }); if (memo.size > 64) memo.delete(memo.keys().next().value); return value; }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };

  const base = (ws, t0, mode, extra = {}) => ({ workspaceId: ws.id, mode, branch: null, generatedAt: now(), durationMs: Math.max(0, now() - t0), truncated: false, totals: emptyTotals(), files: [], ...extra });
  const none = (ws, t0, error) => base(ws, t0, 'none', { error });

  async function viaGit(ws, root, t0) {
    const dl = Date.now() + lim.gitTotalMs;
    const run = (args) => { const left = dl - Date.now(); return left <= 0 ? Promise.resolve({ code: -1, out: '', err: '', failed: true, timedOut: true }) : git(root, args, { env: GIT_ENV, timeout: Math.min(lim.gitCmdMs, left) }); };
    const timeoutMsg = 'Tempo esgotado ao consultar o Git.';
    const top = await run(['rev-parse', '--show-prefix']);
    if (top.timedOut) return { err: timeoutMsg };
    if (top.code !== 0) return null; // não é repositório (ou o Git não existe): usa a varredura
    const prefix = top.out.replace(/\r?\n$/, '');
    // ANTES de status/diff: nenhum comando definido pelo repositório pode existir (config local, inclusões e config.worktree). Código 1 = sem correspondência = seguro.
    for (const scope of ['--local', '--worktree']) {
      const cfg = await run(['config', scope, '--includes', '--get-regexp', EXEC_CONFIG]);
      if (cfg.timedOut) return { err: timeoutMsg };
      if (cfg.code === 0 && cfg.out.trim()) return { scan: FILTER_WARNING };
      if (cfg.code !== 0 && cfg.code !== 1) return { scan: 'Não foi possível verificar a configuração do Git; as mudanças vêm da varredura de arquivos.' };
    }
    const head = await run(['rev-parse', '--verify', '-q', 'HEAD']);
    if (head.timedOut) return { err: timeoutMsg };
    const hasHead = head.code === 0;
    const st = await run(['status', '--porcelain=v1', '-z', '-uall', '--no-renames', '--ignore-submodules=all', '--', '.']);
    if (st.timedOut) return { err: timeoutMsg };
    if (st.code !== 0) return { err: 'Não foi possível ler o estado do Git.' };
    const nm = await run(hasHead ? ['-c', 'diff.relative=false', 'diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=all', 'HEAD', '--', '.'] : ['-c', 'diff.relative=false', 'diff', '--cached', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--', '.']);
    if (nm.timedOut) return { err: timeoutMsg };
    if (nm.code !== 0) return { err: 'Não foi possível ler as diferenças do Git.' };
    let branch = null;
    const br = await run(hasHead ? ['rev-parse', '--abbrev-ref', 'HEAD'] : ['symbolic-ref', '--short', '-q', 'HEAD']);
    if (br.code === 0) { const b = br.out.trim(); branch = b && b !== 'HEAD' && !CONTROL.test(b) ? b.slice(0, 100) : null; }

    const stat = parseNumstat(nm.out), all = [];
    const rel = (p) => { if (prefix && !p.startsWith(prefix)) return null; const r = prefix ? p.slice(prefix.length) : p; return r && !r.endsWith('/') && r.length <= lim.pathMax && !CONTROL.test(r) ? r : null; };
    for (const e of parsePorcelain(st.out)) {
      const r = rel(e.p); if (r === null) continue; // fora da subpasta do workspace, diretório (repositório aninhado) ou caminho estranho
      const status = statusOf(e.x, e.y), n = stat.get(e.p);
      all.push({ path: r, status, added: n ? n.added : (status === 'deleted' ? 0 : null), removed: n ? n.removed : (status === 'deleted' ? null : null), binary: n ? n.binary : false, mtime: null });
    }
    // mtime (lstat: sem seguir link) para os primeiros N; o resto fica sem data e vai para o fim da lista
    let statted = 0;
    for (const f of all) {
      if (f.status === 'deleted' || statted >= lim.statMax) continue;
      statted++;
      try { f.mtime = Math.round((await fsp.lstat(path.join(root, ...f.path.split('/')))).mtimeMs); } catch { /* sumiu entre o status e agora */ }
    }
    const untracked = all.filter((f) => f.status === 'untracked').sort(byRecent);
    await fillCounts(untracked, root, lim, lim.countMaxFiles);
    return { branch, all };
  }

  async function viaScan(ws, root, t0, since) {
    const deadline = Date.now() + lim.scanMs;
    const all = []; let visited = 0, cut = false;
    const walk = async (dir, rel, depth) => {
      let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (cut) return;
        if (++visited > lim.scanEntries || Date.now() > deadline) { cut = true; return; }
        if (e.isSymbolicLink()) continue; // não segue links nem junções
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name.startsWith('.') || isSkippedDir(e.name) || depth >= lim.scanDepth) continue; await walk(abs, `${rel}${e.name}/`, depth + 1); continue; }
        if (!e.isFile()) continue;
        const p = `${rel}${e.name}`;
        if (p.length > lim.pathMax || CONTROL.test(p)) continue;
        let s; try { s = await fsp.lstat(abs); } catch { continue; }
        if (!s.isFile() || s.mtimeMs < since) continue;
        all.push({ path: p, status: s.birthtimeMs >= since ? 'added' : 'modified', added: null, removed: null, binary: false, mtime: Math.round(s.mtimeMs) });
      }
    };
    await walk(root, '', 0);
    const recent = all.slice().sort(byRecent).slice(0, lim.maxFiles);
    await fillCounts(recent, root, { ...lim, countMaxTotalBytes: lim.countMaxTotalBytes * 2 }, lim.maxFiles);
    return { all, cut };
  }

  /** Fase 1 (memo por workspace, SEM `since`): decide o modo. Só o modo git é resolvido aqui por inteiro; o scan devolve { kind:'scan' } para a fase 2. */
  async function gitPhase(ws) {
    const t0 = now();
    const root = typeof ws.path === 'string' && ws.path ? realOf(ws.path) : null;
    let isDir = false; try { isDir = !!root && fs.statSync(root).isDirectory(); } catch { /* ausente */ }
    if (!isDir) return { kind: 'none', result: none(ws, t0, 'A pasta do workspace não foi encontrada.') };
    const g = await viaGit(ws, root, t0);
    if (g === null) return { kind: 'scan', root };
    if (g.scan) return { kind: 'scan', root, warn: g.scan };
    if (g.err) return { kind: 'none', result: none(ws, t0, g.err) };
    return { kind: 'git', result: base(ws, t0, 'git', { branch: g.branch, ...summarize(g.all, lim) }) };
  }
  async function scanPhase(ws, root, since, warn) {
    const t0 = now();
    const sc = await viaScan(ws, root, t0, since);
    const s = summarize(sc.all, lim);
    return base(ws, t0, 'scan', { ...s, truncated: s.truncated || sc.cut, ...(warn ? { error: warn } : {}) });
  }

  return {
    /** `since` (ms epoch) só vale no modo scan e é limitado a [agora−24 h, agora]. Em modo git a chave do memo NÃO inclui `since` (um único cálculo por workspace por janela de 1,5 s). */
    async changes(ws, { since = null } = {}) {
      const g = await memoized(`g|${ws.id}`, () => gitPhase(ws));
      if (g.kind !== 'scan') return g.result;
      const t = now();
      let s = Number.isFinite(since) ? since : t - lim.sinceDefaultMs;
      s = Math.min(t, Math.max(t - lim.sinceMaxMs, s));
      return memoized(`s|${ws.id}|${Number.isFinite(since) ? Math.floor(s / 1000) : 'd'}`, () => scanPhase(ws, g.root, s, g.warn));
    },
  };
}

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
/** GET /api/live/changes?workspaceId=ws_...[&since=<ms>]: nenhum argumento do Git vem da consulta (só o id do workspace e um número). */
export function setupLiveChanges(app, { db, service }) {
  app.get('/api/live/changes', async (req, res) => {
    const id = req.query.workspaceId, rawSince = req.query.since;
    if (typeof id !== 'string' || !ID_RE.test(id)) return bad(res, 'workspaceId ausente ou inválido.');
    let since = null;
    if (rawSince !== undefined) { if (typeof rawSince !== 'string' || !/^\d{1,15}$/.test(rawSince)) return bad(res, 'since deve ser um instante em milissegundos.'); since = Number(rawSince); }
    const ws = (db.workspaces ?? []).find((w) => w.id === id);
    if (!ws) return bad(res, 'Workspace não encontrado.', 404);
    try { res.set('Cache-Control', 'no-store').json(await service.changes(ws, { since })); } catch { bad(res, 'Não foi possível ler as mudanças do workspace.', 500); }
  });
}
