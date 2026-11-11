// Atividade de tokens por provider e por dia (GET /api/provider-activity), lida do que as próprias CLIs gravam em disco:
//   - Claude Code: <pasta da conta>/projects/*/*.jsonl e projects/*/<sessão>/subagents/*.jsonl, linhas `type:"assistant"` com `message.usage`;
//   - Codex: <CODEX_HOME>/sessions/AAAA/MM/DD/rollout-*.jsonl, eventos `token_count` com `payload.info.last_token_usage`.
// É o consumo da MÁQUINA (dentro e fora do FORGE), só contagens: nenhum texto, nome de arquivo ou de projeto sai daqui, e nenhum caminho vem de conteúdo de arquivo.
//
// Regras de honestidade:
//   - Claude: a mesma mensagem aparece em várias linhas (uma por bloco) e em transcripts retomados com o MESMO `message.id`: conta uma vez (dedupe global; dentro do arquivo vence a última
//     linha, entre arquivos vence a mais completa);
//   - Codex: cada `token_count` conta uma vez e só quando o acumulado (`total_token_usage.total_tokens`) AVANÇA: o mesmo total repetido não soma de novo; total MENOR que o anterior é
//     reinício do acumulado (recomeça a contar dali); o mesmo evento (dia, timestamp, total, io, cache) em outro rollout (cópia/retomada) também conta uma vez;
//   - io = entrada + saída (no Codex, entrada sem a parte em cache); cache = contexto em cache (Claude: leitura + criação; Codex: cached_input_tokens);
//   - dias no fuso LOCAL, entre 2023-01-01 e amanhã; só dias com consumo; sem dados = nenhum provider (nunca valor inventado). Números fora de 0..1e9 por evento viram 0.
//
// Desempenho: varredura incremental (por arquivo: tamanho, mtime e offset), 1ª varredura em segundo plano em fatias (não trava o event loop; `scanning` fica true até terminar),
// leituras limitadas por bytes e listagem das pastas no máximo a cada `listTtlMs` (e >= 10x a duração da última listagem). O agregado por dia é mantido POR DIFERENÇA ao ler cada linha
// (por arquivo e por provider): `view()` só soma dias, nunca percorre mensagens. Cada arquivo guarda as chaves de dedupe que ele contou: tirar um arquivo custa o tamanho DELE, não o do histórico.
//
// Dedupe entre arquivos: o arquivo que "perdeu" (ignorou uma cópia) fica marcado (`dupes`). Se o dono de uma chave some ou recomeça, os marcados do mesmo provider são relidos, e a cópia passa a contar.
// Limites e limitações:
//   - memória: no máximo `maxKeys` chaves de dedupe (padrão 1 milhão). Estourou: as mais antigas são esquecidas. O consumo delas continua contado (nada some do total), mas uma cópia
//     do mesmo id/evento em OUTRO arquivo lido depois disso pode ser contada de novo;
//   - listagem incompleta (readdir falhou, orçamento de pastas/arquivos estourou): nada é descartado nessa volta e a resposta ganha `partial: true` (campo aditivo; ausente quando completa).
import fs from 'node:fs';
import path from 'node:path';
import { claudeConfigDir } from './terminal-usage.js';
import { codexHomeDir } from './codex-usage.js';

const CHUNK_BYTES = 2 * 1024 * 1024; // por leitura de um arquivo
const TICK_MS = 20; // tempo de CPU por fatia da varredura em segundo plano; depois cede o event loop
const SYNC_BUDGET_BYTES = 4 * 1024 * 1024; // incremento lido na própria requisição (depois da 1ª varredura); o excedente segue em segundo plano
const LIST_TTL_MS = 3000;
const MAX_FILES = 50000;
const MAX_DIRS = 20000; // diretórios lidos por listagem (a listagem é síncrona)
const MAX_KEYS = 1_000_000; // chaves de dedupe em memória (Claude + Codex)
const MAX_DAYS_PARAM = 3660;
const MAX_EVENT = 1e9; // tokens plausíveis por campo de um evento
const MAX_TOTAL = 1e12; // acumulado plausível de um rollout do Codex
const MAX_ID = 128;
const MIN_DAY = '2023-01-01';
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CLAUDE_NAME_RE = /^[\w.-]+\.jsonl$/;
const CODEX_NAME_RE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const PROVIDERS = [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }];
const GONE_CODES = new Set(['ENOENT', 'ENOTDIR']); // o que não existe mais é "sumiu"; qualquer outro erro (EPERM, EBUSY, EMFILE...) é transitório: não prova nada

const num = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_EVENT ? v : 0);
const clamp = (x) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, x));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const p2 = (n) => String(n).padStart(2, '0');
/** AAAA-MM-DD no fuso local. */
export const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

// lstat (nunca stat): link simbólico/junction não é arquivo comum nem pasta comum. `err` distingue "não existe" de "não consegui ler agora".
const lstatE = (p) => { try { return { st: fs.lstatSync(p), err: null }; } catch (e) { return { st: null, err: e }; } };
const lstatOf = (p) => lstatE(p).st;

// Listagem com orçamento de diretórios e de arquivos. Dirent de link simbólico dá isDirectory()/isFile() === false: nunca seguido. Nada de caminho vem de conteúdo de arquivo.
// `incomplete` vira true se um readdir falhou por motivo transitório ou se um orçamento estourou: quem lista não pode concluir que o que não apareceu "sumiu".
function makeLister(maxDirs) {
  const state = { dirs: 0, incomplete: false };
  const read = (dir) => {
    if (state.dirs >= maxDirs) { state.incomplete = true; return []; }
    state.dirs++;
    try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (!GONE_CODES.has(e?.code)) state.incomplete = true; return []; }
  };
  const full = (out) => { if (out.length >= MAX_FILES) { state.incomplete = true; return true; } return false; };
  return {
    state,
    // projects/<projeto>/*.jsonl e projects/<projeto>/<sessão>/subagents/*.jsonl (explícito, sem recursão livre)
    claude(projectsRoot, out) {
      for (const proj of read(projectsRoot)) {
        if (!proj.isDirectory()) continue;
        const pdir = path.join(projectsRoot, proj.name);
        for (const e of read(pdir)) {
          if (full(out)) return;
          if (e.isFile()) { if (CLAUDE_NAME_RE.test(e.name)) out.push(path.join(pdir, e.name)); continue; }
          if (!e.isDirectory()) continue;
          const sub = path.join(pdir, e.name, 'subagents'), r = lstatE(sub);
          if (!r.st) { if (r.err && !GONE_CODES.has(r.err.code)) state.incomplete = true; continue; }
          if (!r.st.isDirectory() || r.st.isSymbolicLink()) continue;
          for (const f of read(sub)) { if (full(out)) return; if (f.isFile() && CLAUDE_NAME_RE.test(f.name)) out.push(path.join(sub, f.name)); }
        }
      }
    },
    codex(home, out) {
      const root = path.join(home, 'sessions'), r = lstatE(root);
      if (!r.st) { if (r.err && !GONE_CODES.has(r.err.code)) state.incomplete = true; return; }
      if (!r.st.isDirectory() || r.st.isSymbolicLink()) return;
      const sub = (dir, re) => read(dir).filter((e) => e.isDirectory() && re.test(e.name)).map((e) => e.name).sort();
      for (const y of sub(root, /^\d{4}$/)) for (const m of sub(path.join(root, y), /^\d{2}$/)) for (const d of sub(path.join(root, y, m), /^\d{2}$/)) {
        const dir = path.join(root, y, m, d);
        for (const e of read(dir)) { if (full(out)) return; if (e.isFile() && CODEX_NAME_RE.test(e.name)) out.push(path.join(dir, e.name)); }
      }
    },
  };
}

/**
 * `claudeDirs()` -> pastas de configuração das contas do Claude Code (a padrão + as do FORGE); `codexHome` -> pasta do Codex (string ou função).
 * `now()` injetável para teste. `listTtlMs: 0` desliga o TTL (teste). `stats` (opcional, teste): contadores { drops, keyVisits }. API: `view({ days })` (days: 0 = tudo),
 * `idle()` (promessa: varredura em segundo plano terminou), `scanning()`.
 */
export function createProviderActivity({ claudeDirs = () => [claudeConfigDir()], codexHome = () => codexHomeDir(), now = Date.now, listTtlMs = LIST_TTL_MS, chunkBytes = CHUNK_BYTES, tickMs = TICK_MS, syncBudgetBytes = SYNC_BUDGET_BYTES, maxDirs = MAX_DIRS, maxKeys = MAX_KEYS, stats = null } = {}) {
  /** @type {Map<string, {file:string, kind:'claude'|'codex', owner:string, size:number, mtimeMs:number, offset:number, pending:Buffer, days:Map<string,[number, number]>, prevTotal:number|null, keys:Set<string>, dupes:boolean}>} */
  const files = new Map();
  const queue = new Set(); // arquivos com bytes ainda não lidos
  const totals = { claude: new Map(), codex: new Map() }; // provider -> dia -> [io, cache]
  const msgs = new Map(); // Claude: message.id -> { day, io, cache, f } (quem contou a mensagem; só o que o dedupe precisa)
  const seenCodex = new Map(); // Codex: `dia|timestamp|total|io|cache` -> arquivo que contou
  let lastList = -Infinity, listTtl = listTtlMs, initialDone = false, pumping = false, partial = false;
  let waiters = [];

  /** Dia local do timestamp, ou null se não for uma data ISO plausível (2023-01-01 .. amanhã). */
  function dayOf(ts, maxDay) {
    if (typeof ts !== 'string' || ts.length > 40 || !TS_RE.test(ts)) return null;
    const ms = Date.parse(ts); if (!Number.isFinite(ms)) return null;
    const day = localDay(ms);
    return day >= MIN_DAY && day <= maxDay ? day : null;
  }

  /** Soma (sign=1) ou subtrai (sign=-1) um consumo no agregado do arquivo e no do provider. */
  function credit(f, day, io, cache, sign) {
    for (const map of [f.days, totals[f.kind]]) {
      let r = map.get(day); if (!r) { if (sign < 0) continue; r = [0, 0]; map.set(day, r); }
      r[0] = clamp(r[0] + sign * io); r[1] = clamp(r[1] + sign * cache);
      if (r[0] === 0 && r[1] === 0) map.delete(day);
    }
  }
  /** Devolve ao agregado tudo o que o arquivo contou (dias e chaves de dedupe que ele possuía). Custo = tamanho do arquivo. */
  function release(f) {
    for (const [day, r] of f.days) { const t = totals[f.kind].get(day); if (t) { t[0] = clamp(t[0] - r[0]); t[1] = clamp(t[1] - r[1]); if (t[0] === 0 && t[1] === 0) totals[f.kind].delete(day); } }
    f.days.clear();
    const map = f.kind === 'claude' ? msgs : seenCodex;
    if (stats) stats.keyVisits = (stats.keyVisits ?? 0) + f.keys.size;
    for (const k of f.keys) { const own = map.get(k); if ((f.kind === 'claude' ? own?.f : own) === f) map.delete(k); }
    f.keys.clear();
  }
  const restart = (s) => { s.offset = 0; s.pending = Buffer.alloc(0); s.prevTotal = null; s.dupes = false; };
  /**
   * Tira do agregado o que estes arquivos contaram (recomeçaram ou sumiram), numa única passada em lote. Se algum deles era dono de chaves, os arquivos do mesmo provider que
   * ignoraram cópias (`dupes`) são relidos do zero: a cópia que perdeu o dedupe passa a contar. O chamador cuida de `restart` (ou de remover) os arquivos de `set`.
   */
  function drop(set) {
    if (stats) stats.drops = (stats.drops ?? 0) + 1;
    const kinds = new Set(); for (const f of set) if (f.keys.size) kinds.add(f.kind);
    const again = []; if (kinds.size) for (const x of files.values()) if (x.dupes && kinds.has(x.kind) && !set.has(x)) again.push(x);
    for (const f of set) release(f);
    for (const x of again) { release(x); restart(x); queue.add(x.file); }
  }
  function resetOne(s) { drop(new Set([s])); restart(s); }

  /** Re-lista as pastas (no máximo a cada listTtl) e enfileira o que mudou. */
  function list(force) {
    const t = now();
    if (!force && t - lastList < listTtl) return;
    lastList = t;
    const t0 = Date.now(), lister = makeLister(maxDirs), seen = new Set(), found = [], owners = new Set();
    let incomplete = false;
    let dirs = []; try { dirs = claudeDirs() ?? []; } catch { dirs = []; }
    for (const d of Array.isArray(dirs) ? dirs : []) {
      if (typeof d !== 'string' || !d) continue;
      const key = path.resolve(d), id = process.platform === 'win32' ? key.toLowerCase() : key; if (owners.has(id)) continue; owners.add(id);
      const root = path.join(key, 'projects'), r = lstatE(root);
      if (!r.st) { if (r.err && !GONE_CODES.has(r.err.code)) incomplete = true; continue; }
      if (!r.st.isDirectory() || r.st.isSymbolicLink()) continue;
      const out = []; try { lister.claude(root, out); } catch { incomplete = true; } // conta ilegível: as demais seguem
      for (const f of out) found.push({ file: f, kind: 'claude', owner: id });
    }
    try { const h = typeof codexHome === 'function' ? codexHome() : codexHome; if (typeof h === 'string' && h) { const out = []; lister.codex(path.resolve(h), out); for (const f of out) found.push({ file: f, kind: 'codex', owner: 'codex' }); } } catch { incomplete = true; }
    incomplete = incomplete || lister.state.incomplete;
    const rewrite = new Set();
    for (const { file, kind, owner } of found) {
      if (seen.has(file)) continue;
      const r = lstatE(file);
      if (!r.st) { if (r.err && !GONE_CODES.has(r.err.code)) { seen.add(file); incomplete = true; } continue; } // erro transitório: não conta como "sumiu"
      if (!r.st.isFile()) continue;
      seen.add(file);
      const st = r.st; let s = files.get(file);
      if (!s) { s = { file, kind, owner, size: st.size, mtimeMs: st.mtimeMs, offset: 0, pending: Buffer.alloc(0), days: new Map(), prevTotal: null, keys: new Set(), dupes: false }; files.set(file, s); }
      else {
        if (st.size < s.offset || (st.size === s.offset && st.mtimeMs !== s.mtimeMs && s.offset > 0)) rewrite.add(s); // recomeçou (menor) ou foi regravado com o mesmo tamanho
        s.size = st.size; s.mtimeMs = st.mtimeMs;
      }
    }
    const gone = new Set();
    if (!incomplete) for (const [f, s] of files) if (!seen.has(f)) gone.add(s); // listagem incompleta não prova que algo sumiu
    const batch = new Set([...gone, ...rewrite]);
    if (batch.size) { drop(batch); for (const s of gone) { files.delete(s.file); queue.delete(s.file); } for (const s of rewrite) if (!gone.has(s)) restart(s); }
    for (const s of files.values()) if (s.size > s.offset) queue.add(s.file);
    partial = incomplete;
    listTtl = listTtlMs === 0 ? 0 : Math.max(listTtlMs, 10 * (Date.now() - t0)); // listagem lenta (muitas pastas): espaça as próximas
  }

  /** Estourou o teto de chaves: esquece as mais antigas (ordem de inserção). O consumo já contado fica; ver "Limites e limitações". */
  function evict() {
    let over = msgs.size + seenCodex.size - Math.floor(maxKeys * 0.9);
    for (const [k, rec] of msgs) { if (over <= 0) return; msgs.delete(k); rec.f.keys.delete(k); over--; }
    for (const [k, f] of seenCodex) { if (over <= 0) return; seenCodex.delete(k); f.keys.delete(k); over--; }
  }

  function ingestClaudeLine(s, line, maxDay) {
    if (!line.includes('"usage"')) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    const m = o?.message, u = m?.usage;
    if (o?.type !== 'assistant' || !isObj(m) || !isObj(u)) return;
    const key = typeof m.id === 'string' && m.id ? m.id : (typeof o.uuid === 'string' && o.uuid ? o.uuid : null); if (!key || key.length > MAX_ID) return;
    const io = num(u.input_tokens) + num(u.output_tokens), cache = num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
    if (m.model === '<synthetic>' || io + cache === 0) return;
    const day = dayOf(o.timestamp, maxDay); if (!day) return;
    const cur = msgs.get(key);
    if (!cur) { msgs.set(key, { day, io, cache, f: s }); s.keys.add(key); credit(s, day, io, cache, 1); return; }
    if (cur.f === s) { credit(s, cur.day, cur.io, cur.cache, -1); credit(s, day, io, cache, 1); cur.day = day; cur.io = io; cur.cache = cache; return; } // a última linha da mesma mensagem vence
    s.dupes = true; // há uma cópia desta mensagem em outro arquivo
    if (io + cache > cur.io + cur.cache) { // vence a mais completa; o dono anterior fica marcado para ser relido se este arquivo sumir
      const old = cur.f; credit(old, cur.day, cur.io, cur.cache, -1); old.keys.delete(key); old.dupes = true;
      credit(s, day, io, cache, 1); s.keys.add(key); cur.day = day; cur.io = io; cur.cache = cache; cur.f = s;
    }
  }
  function ingestCodexLine(s, line, maxDay) {
    if (!line.includes('token_count')) return;
    let o; try { o = JSON.parse(line); } catch { return; }
    const p = o?.payload;
    if (p?.type !== 'token_count' || !isObj(p.info) || !isObj(p.info.last_token_usage)) return;
    const tt = isObj(p.info.total_token_usage) ? p.info.total_token_usage.total_tokens : undefined;
    let total = null;
    if (tt !== undefined && tt !== null) { if (!Number.isSafeInteger(tt) || tt < 0 || tt > MAX_TOTAL) return; total = tt; } // acumulado inválido: evento corrompido
    if (total !== null) { if (s.prevTotal !== null && total === s.prevTotal) return; s.prevTotal = total; } // mesmo acumulado repetido não é consumo novo; MENOR = reinício do acumulado: conta e recomeça dali
    const l = p.info.last_token_usage, input = num(l.input_tokens), cached = Math.min(num(l.cached_input_tokens), input);
    const io = input - cached + num(l.output_tokens), cache = cached;
    if (io + cache === 0) return;
    const day = dayOf(o.timestamp, maxDay); if (!day) return;
    const key = `${day}|${o.timestamp}|${total ?? ''}|${io}|${cache}`, own = seenCodex.get(key); // o mesmo evento repetido (no arquivo ou em outro rollout) conta uma vez, com ou sem total
    if (own) { if (own !== s) s.dupes = true; return; }
    seenCodex.set(key, s); s.keys.add(key); credit(s, day, io, cache, 1);
  }

  /** Lê até `limit` bytes novos de um arquivo; devolve quantos leu (0 = nada a ler ou falha). */
  function ingest(s, limit) {
    const vanish = () => { drop(new Set([s])); files.delete(s.file); queue.delete(s.file); return 0; };
    const st = lstatOf(s.file); if (!st || !st.isFile()) return vanish();
    s.size = st.size; s.mtimeMs = st.mtimeMs;
    let fd; try { fd = fs.openSync(s.file, 'r'); } catch { queue.delete(s.file); return 0; }
    let buf = null, n = 0, notFile = false, shrunk = false;
    try {
      const fst = fs.fstatSync(fd); // depois do open: fecha a corrida lstat/open (o arquivo trocado por outra coisa nunca é lido)
      if (!fst.isFile()) notFile = true;
      else if (fst.size < s.offset) shrunk = true;
      else { s.size = fst.size; const len = Math.min(fst.size - s.offset, limit, chunkBytes); if (len > 0) { buf = Buffer.alloc(len); n = fs.readSync(fd, buf, 0, len, s.offset); } }
    } catch { n = 0; } finally { try { fs.closeSync(fd); } catch { /* já fechado */ } }
    if (notFile) return vanish();
    if (shrunk) { resetOne(s); if (s.size > 0) queue.add(s.file); return 0; } // recomeçou: relê do zero
    if (!buf || n <= 0) { queue.delete(s.file); return 0; }
    s.offset += n;
    const all = s.pending.length ? Buffer.concat([s.pending, buf.subarray(0, n)]) : buf.subarray(0, n), cut = all.lastIndexOf(0x0a);
    s.pending = cut < 0 ? Buffer.from(all) : Buffer.from(all.subarray(cut + 1)); // a última linha pode estar incompleta: fica em BYTES (não parte um caractere UTF-8 no meio) para a próxima leitura
    if (s.pending.length > 8 * 1024 * 1024) s.pending = Buffer.alloc(0); // linha absurda sem quebra: descarta em vez de crescer sem limite
    if (cut >= 0) {
      const maxDay = localDay(now() + 86400000), one = s.kind === 'claude' ? ingestClaudeLine : ingestCodexLine;
      for (const line of all.subarray(0, cut).toString('utf8').split('\n')) { try { one(s, line, maxDay); } catch { /* linha inesperada: ignora */ } }
      if (msgs.size + seenCodex.size > maxKeys) evict();
    }
    if (s.offset >= s.size) queue.delete(s.file);
    return n;
  }

  function finishIfIdle() {
    if (queue.size) return false;
    initialDone = true; pumping = false;
    const w = waiters; waiters = []; for (const r of w) r();
    return true;
  }
  function pump() {
    if (pumping) return; pumping = true;
    const tick = () => {
      const t0 = Date.now();
      try {
        do {
          const next = queue.values().next().value; if (next === undefined) break;
          const s = files.get(next); if (!s) { queue.delete(next); continue; }
          ingest(s, chunkBytes);
        } while (Date.now() - t0 < tickMs && queue.size);
      } catch { /* uma falha não derruba a varredura */ }
      if (finishIfIdle()) return;
      const h = setTimeout(tick, 1); h.unref?.();
    };
    const h = setTimeout(tick, 0); h.unref?.();
  }

  /** Parâmetro `days` já validado: 0 = tudo; N = hoje e os N-1 dias anteriores. */
  function view({ days = 30 } = {}) {
    try { list(false); } catch { /* listagem falhou: segue com o que já há */ }
    if (queue.size) {
      if (initialDone) { let budget = syncBudgetBytes; for (const f of [...queue]) { if (budget <= 0) break; const s = files.get(f); if (!s) { queue.delete(f); continue; } budget -= ingest(s, budget) || 1; } } // tempo real: só o acrescentado
      if (queue.size) pump();
    } else if (!initialDone) finishIfIdle();
    const t = now(), w = Number.isInteger(days) && days > 0 ? days : 0;
    let cutoff = null; if (w) { const d = new Date(t); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (w - 1)); cutoff = localDay(d.getTime()); }
    const providers = []; let first = null;
    for (const p of PROVIDERS) {
      const out = {}; let any = false;
      for (const [day, v] of [...totals[p.id].entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        if (cutoff && day < cutoff) continue;
        if (v[0] + v[1] <= 0) continue;
        out[day] = { io: v[0], cache: v[1] }; any = true;
        if (first === null || day < first) first = day;
      }
      if (!any) continue;
      const owners = new Set(); for (const s of files.values()) if (s.kind === p.id && s.days.size) owners.add(s.owner); // contas lidas = pastas que realmente tinham consumo
      providers.push({ id: p.id, label: p.label, accounts: owners.size, days: out });
    }
    return { generatedAt: new Date(t).toISOString(), sinceDay: first, scanning: !initialDone, ...(partial ? { partial: true } : {}), providers };
  }

  return { view, scanning: () => !initialDone, idle: () => (pumping ? new Promise((r) => waiters.push(r)) : Promise.resolve()) };
}

/** `?days=` -> 30 (padrão), 0 (tudo) ou N inteiro positivo até 3660; qualquer outro valor = null (a rota responde 400). */
export function parseDaysParam(v) {
  if (v === undefined) return 30;
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v)) return null;
  const n = Number(v); return n <= MAX_DAYS_PARAM ? n : null;
}
