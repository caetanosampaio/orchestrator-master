#!/usr/bin/env node
// Status line do Claude Code (configurada por `--settings`, ver rate-limits.js): recebe no stdin um JSON com `session_id` e, para assinantes Pro/Max, `rate_limits`
// ({ five_hour, seven_day }, cada um com `used_percentage` e `resets_at`). Grava SÓ essas duas janelas em <pasta>/<session_id>.json, para o FORGE mostrar o limite real da conta.
// Regras: a pasta vem do argumento de linha de comando (nunca do stdin); o nome do arquivo é só o UUID validado; escrita atômica (.tmp + rename); NUNCA falha (sempre sai com 0);
// imprime UMA linha curta (o Claude Code a mostra no rodapé), sem sequências de escape; nada além das duas janelas é lido do JSON nem gravado.
//
// Decisões (documentadas porque o contrato deixa margem):
//   - `resets_at` é epoch em SEGUNDOS. Valor >= 1e11 só pode ser milissegundos (1e11 s seria o ano 5138): é NORMALIZADO para segundos, não recusado. Acima do ano 2100, <= 0, NaN, texto: janela inválida (null).
//   - `used_percentage` precisa ser número finito; é limitado a 0..100 (arredondado a 2 casas). Texto, NaN, Infinity: janela inválida. Uma janela só vale com os DOIS campos válidos.
//   - sem `rate_limits` (ou sem nenhuma janela válida) o arquivo anterior fica INTACTO: assinante sem dado ainda não é "sem limite".
//   - resposta com UMA janela só: a outra gravada antes é MANTIDA enquanto o `resetsAt` dela ainda estiver no futuro (a expiração já protege contra dado velho).
//   - escrita segura: .tmp com nome aleatório e flag 'wx' (um link plantado com nome previsível nunca é seguido), pasta 0700 e arquivo 0600 (no Windows o `mode` é ignorado).
//   - não regrava se nada mudou e o arquivo tem menos de 10 s (a status line roda a cada resposta); regrava a cada >= 10 s para o `at` seguir recente.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STDIN = 1_000_000;
const MAX_FILE = 4096;
export const REWRITE_MS = 10_000;
const MS_THRESHOLD = 1e11; // >= isto só pode ser milissegundos
const MAX_EPOCH_SEC = 4_102_444_800; // 2100-01-01

/** Percentual limitado a 0..100 (2 casas), ou null se não for número finito. */
export function clampPct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

/** Epoch em segundos (inteiro), normalizando milissegundos; null se inválido. */
export function epochSeconds(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const s = Math.round(v >= MS_THRESHOLD ? v / 1000 : v);
  return s > 0 && s <= MAX_EPOCH_SEC ? s : null;
}

/** { usedPct, resetsAt (epoch s) } ou null. `src` pode ser a janela do Claude Code (used_percentage/resets_at) ou a já gravada (usedPct/resetsAt). */
export function windowOf(src, stored = false) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const usedPct = clampPct(stored ? src.usedPct : src.used_percentage), resetsAt = epochSeconds(stored ? src.resetsAt : src.resets_at);
  return usedPct === null || resetsAt === null ? null : { usedPct, resetsAt };
}

/** JSON do stdin (texto ou objeto) -> { sessionId, fiveHour, sevenDay } ou null (não é objeto ou `session_id` não é UUID: nada será gravado). Extrai SÓ as duas janelas. */
export function parse(input) {
  let o = input;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const sid = o.session_id;
  if (typeof sid !== 'string' || !SESSION_ID_RE.test(sid)) return null;
  const rl = o.rate_limits && typeof o.rate_limits === 'object' ? o.rate_limits : null;
  return { sessionId: sid, fiveHour: windowOf(rl?.five_hour), sevenDay: windowOf(rl?.seven_day) };
}

const same = (a, b) => (a === null && b === null) || (!!a && !!b && a.usedPct === b.usedPct && a.resetsAt === b.resetsAt);

function readPrev(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    const j = JSON.parse(fs.readFileSync(file, 'utf8')), at = Date.parse(j?.at);
    if (!Number.isFinite(at)) return null;
    return { at: j.at, atMs: at, fiveHour: windowOf(j.fiveHour, true), sevenDay: windowOf(j.sevenDay, true) };
  } catch { return null; }
}

/**
 * Grava (se for o caso) e devolve o estado do arquivo da sessão: { at, fiveHour, sevenDay } ou null (entrada inválida ou nada conhecido). `now` = relógio em ms.
 * Pode lançar erro de disco: quem chama (main) trata. Nunca escreve fora de `dir`: o nome vem só do UUID validado.
 */
export function record(dir, input, now = Date.now) {
  const p = parse(input);
  if (!p || !SESSION_ID_RE.test(p.sessionId) || typeof dir !== 'string' || !dir) return null;
  const file = path.join(dir, `${p.sessionId}.json`), prev = readPrev(file);
  if (!p.fiveHour && !p.sevenDay) return prev ? { at: prev.at, fiveHour: prev.fiveHour, sevenDay: prev.sevenDay } : null; // sem dado novo: mantém o anterior
  const t = now();
  const keep = (w) => (w && w.resetsAt * 1000 > t ? w : null); // janela anterior ainda vigente
  const fiveHour = p.fiveHour ?? keep(prev?.fiveHour ?? null), sevenDay = p.sevenDay ?? keep(prev?.sevenDay ?? null);
  if (prev && same(prev.fiveHour, fiveHour) && same(prev.sevenDay, sevenDay) && t - prev.atMs >= 0 && t - prev.atMs < REWRITE_MS) return { at: prev.at, fiveHour: prev.fiveHour, sevenDay: prev.sevenDay };
  const data = { at: new Date(t).toISOString(), fiveHour, sevenDay };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, `${JSON.stringify(data)}\n`, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* resíduo inofensivo */ } throw e; }
  return data;
}

/** Linha do rodapé: `FORGE · 5h 23% · semana 41%` (só janelas ainda vigentes), ou `FORGE` sem dados. Sempre uma linha, sem escapes. */
export function lineFor(data, nowMs = Date.now()) {
  const parts = ['FORGE'];
  try {
    for (const [label, w] of [['5h', data?.fiveHour], ['semana', data?.sevenDay]]) {
      if (w && Number.isFinite(w.usedPct) && Number.isFinite(w.resetsAt) && w.resetsAt * 1000 > nowMs) parts.push(`${label} ${Math.round(w.usedPct)}%`);
    }
  } catch { /* só FORGE */ }
  return parts.join(' · ');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { // executado pelo Claude Code (importado nos testes, só exporta)
  let raw = '', done = false;
  const finish = (line) => {
    if (done) return; done = true;
    try { process.stdout.write(`${line}\n`, () => process.exit(0)); } catch { process.exit(0); }
    setTimeout(() => process.exit(0), 500).unref?.();
  };
  const run = () => {
    let line = 'FORGE';
    try {
      const p = parse(raw);
      let data = null;
      try { data = record(process.argv[2], raw); } catch { /* disco: o rodapé ainda mostra o que veio no stdin */ }
      line = lineFor(data ?? (p && (p.fiveHour || p.sevenDay) ? p : null)); // `data` já reúne as duas janelas (a recebida e a anterior ainda vigente)
    } catch { line = 'FORGE'; }
    finish(line);
  };
  setTimeout(() => finish('FORGE'), 4000).unref?.(); // stdin que nunca fecha: nunca trava o Claude Code
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { if (raw.length < MAX_STDIN) raw += c; });
  process.stdin.on('end', run);
  process.stdin.on('error', () => finish('FORGE'));
}
