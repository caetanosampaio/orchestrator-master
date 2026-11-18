// Lógica PURA do painel Live (Preview por arquivos do projeto, aba Construção e abertura automática). Sem React nem rede; testada em server/test/live-view.test.mjs.
// Contrato das rotas /api/live/*: ver docs/ARQUITETURA.md (o servidor devolve `port` e `path`; o cliente monta a URL).
import { currentRun, flowProgress, runSteps, stepMeta } from './flows-view.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const PREVIEW_HOSTS = Object.freeze(['localhost', '127.0.0.1']);
export const PREVIEW_POLL_MS = 2000;      // aba Preview visível: consulta a versão dos arquivos
export const PREVIEW_MIN_RELOAD_MS = 1500; // intervalo mínimo entre duas recargas do iframe
export const CHANGES_BUSY_MS = 3000, CHANGES_IDLE_MS = 10_000;
export const BUSY_OFF_MS = 8000;           // o "trabalhando" só some depois deste tempo estável (um agente ocioso entre etapas não conta como fim)

// ---------- Preview ----------
/**
 * URL do preview por arquivos: `http://<hostname da UI>:<porta>/<path>`. O hostname tem de ser o MESMO da UI (localhost e 127.0.0.1 são "cross-site" entre si),
 * por isso só esses dois são aceitos; qualquer outro vira 127.0.0.1. Devolve null se o servidor não informou um preview utilizável.
 */
export function buildPreviewUrl(hostname, info) {
  if (!info || info.available !== true) return null;
  const port = info.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = PREVIEW_HOSTS.includes(String(hostname ?? '').toLowerCase()) ? String(hostname).toLowerCase() : '127.0.0.1';
  const path = info.path === undefined || info.path === null ? '/' : info.path;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 1024 || /[\u0000-\u001f\u007f\\\s#?@]/.test(path)) return null;
  return `http://${host}:${port}${path}`;
}

/** Quando remontar o iframe: a versão dos arquivos mudou. `wait` = ms que faltam para respeitar o intervalo mínimo (0 = agora). */
export function reloadDecision({ shown, next, lastAt = 0, now = Date.now(), minMs = PREVIEW_MIN_RELOAD_MS }) {
  if (next === null || next === undefined || next === shown) return { reload: false, wait: 0 };
  if (shown === null || shown === undefined) return { reload: true, wait: 0 }; // primeira carga
  const wait = Math.max(0, minMs - (now - lastAt));
  return { reload: true, wait };
}

/** Texto curto sobre os arquivos servidos ("7 arquivos", "mais de 2000 arquivos"). */
export function previewFilesLabel(info) {
  const n = info?.files;
  if (!isNum(n)) return '';
  const t = `${n} ${n === 1 ? 'arquivo' : 'arquivos'}`;
  return info?.truncated ? `mais de ${t}` : t;
}

// ---------- abrir sozinho ----------
/** O workspace está trabalhando? Missão com run ativo OU algum terminal em execução do workspace marcado como "trabalhando" (workingIds: Set de ids). */
export function workspaceBusy(wsId, { flows = [], sessions = [], workingIds = new Set() } = {}) {
  if (!wsId) return false;
  if (arr(flows).some((f) => f && f.workspaceId === wsId && !f.archived && f.activeRun?.status === 'running')) return true;
  const has = typeof workingIds?.has === 'function' ? (id) => workingIds.has(id) : () => false;
  return arr(sessions).some((s) => s && s.workspaceId === wsId && s.status === 'running' && has(s.id));
}

/** Abre só na subida (parado → trabalhando), com a preferência ligada, painel fechado e sem o usuário ter fechado durante este mesmo trabalho. */
export function shouldAutoOpen({ prevBusy, busy, enabled, liveOpen, dismissed }) {
  return prevBusy === false && busy === true && enabled === true && !liveOpen && !dismissed;
}

/**
 * Um passo da máquina de abertura automática. `mem` começa em null: a primeira leitura é só a linha de base e NUNCA abre (abrir o app com a equipe
 * já trabalhando não deve mexer na tela). `dismissed` liga quando o usuário fecha o painel durante o trabalho e só desliga quando o trabalho para.
 * Devolve { mem, open }.
 */
export function autoOpenStep(mem, { busy, liveOpen, enabled }) {
  const b = busy === true, o = liveOpen === true;
  if (!mem) return { mem: { prevBusy: b, prevOpen: o, dismissed: false }, open: false };
  let dismissed = mem.dismissed;
  if (!b) dismissed = false;
  else if (mem.prevOpen && !o) dismissed = true;
  const open = shouldAutoOpen({ prevBusy: mem.prevBusy, busy: b, enabled: enabled === true, liveOpen: o, dismissed });
  return { mem: { prevBusy: b, prevOpen: o || open, dismissed }, open };
}

// ---------- missão ativa ----------
/** Progresso da missão em execução do workspace (a mais recente se houver mais de uma) ou null. */
export function missionProgress(flows, wsId) {
  if (!wsId) return null;
  const active = arr(flows).filter((f) => f && f.workspaceId === wsId && !f.archived && f.activeRun?.status === 'running');
  if (!active.length) return null;
  const ts = (f) => { const t = Date.parse(f.activeRun?.startedAt ?? ''); return Number.isFinite(t) ? t : 0; };
  const flow = active.slice().sort((a, b) => ts(b) - ts(a))[0];
  const run = currentRun(flow), p = flowProgress(flow, run);
  const defs = new Map(arr(flow.steps).map((s) => [s?.id, s]));
  const steps = arr(flow.steps).filter((s) => s?.id).map((def) => {
    const rs = runSteps(run).find((s) => s?.stepId === def.id);
    const state = rs?.status ?? 'pending', meta = stepMeta(state);
    return { id: def.id, title: String(defs.get(def.id)?.title || def.id), state, label: meta.label, tone: meta.tone, terminalId: rs?.terminalId ?? null };
  });
  return { flowId: flow.id, title: String(flow.title || 'Missão'), done: p.done ?? 0, total: p.total, pct: p.pct ?? 0, label: p.label, waiting: steps.some((s) => s.state === 'waiting'), steps };
}

// ---------- aba Construção ----------
const STATUS = Object.freeze({
  added: { label: 'novo', mark: 'A', tone: 'ok' },
  untracked: { label: 'novo', mark: 'N', tone: 'ok' },
  modified: { label: 'alterado', mark: 'M', tone: 'work' },
  deleted: { label: 'removido', mark: 'D', tone: 'err' },
  conflict: { label: 'conflito', mark: 'C', tone: 'wait' },
});
export const changeStatus = (s) => STATUS[s] ?? { label: s ? String(s) : 'alterado', mark: '?', tone: 'idle' };

/** "pasta/" + "arquivo.ext" para exibir; o caminho completo fica no title. */
export function splitPath(p) {
  const s = String(p ?? ''), i = s.lastIndexOf('/');
  return i < 0 ? { dir: '', name: s } : { dir: s.slice(0, i + 1), name: s.slice(i + 1) };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/**
 * Resumo da resposta de GET /api/live/changes: texto da linha de totais e quantos arquivos ficaram de fora da lista ("e mais N").
 * `state`: 'error' (git estourou o tempo/falhou), 'empty' (nada mudou), 'ok'.
 */
export function changesSummary(data) {
  if (!data || typeof data !== 'object') return { state: 'empty', text: 'Nenhuma alteração.', extra: 0, added: 0, removed: 0, files: 0, mode: 'none' };
  const t = data.totals ?? {}, files = arr(data.files);
  const total = isNum(t.files) ? t.files : files.length;
  const added = isNum(t.added) ? t.added : 0, removed = isNum(t.removed) ? t.removed : 0;
  const mode = data.mode === 'git' || data.mode === 'scan' ? data.mode : 'none';
  const extra = Math.max(0, total - files.length);
  if (mode === 'none' && data.error) return { state: 'error', text: String(data.error), extra: 0, added: 0, removed: 0, files: 0, mode };
  if (total === 0 && !files.length) return { state: 'empty', text: mode === 'scan' ? 'Nenhum arquivo mexido nos últimos minutos.' : 'Nenhuma alteração.', extra: 0, added, removed, files: 0, mode };
  const parts = [plural(total, 'arquivo', 'arquivos')];
  if (added || removed) parts.push(`+${added} −${removed}`);
  return { state: 'ok', text: parts.join(' · '), extra, added, removed, files: total, mode };
}

/** Rótulo da linha de +/−: "+12 −3"; nulo = não contado ("—"); binário = "binário". */
export function lineDelta(f) {
  if (f?.binary) return { text: 'binário', added: null, removed: null };
  const a = isNum(f?.added) ? f.added : null, r = isNum(f?.removed) ? f.removed : null;
  return { text: a === null && r === null ? '' : `${a === null ? '' : `+${a}`}${a !== null && r !== null ? ' ' : ''}${r === null ? '' : `−${r}`}`, added: a, removed: r };
}

/** "agora", "há 15s", "há 3 min", "há 2 h", "há 4 d". Futuro/inválido = ''. Os segundos arredondam para baixo de 5 em 5 (o rótulo não pisca a cada tick). */
export function agoLabel(ms, now = Date.now()) {
  if (!isNum(ms)) return '';
  const d = now - ms;
  if (d < -5000) return '';
  const s = Math.max(0, Math.floor(d / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `há ${Math.floor(s / 5) * 5}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Intervalo da próxima leitura de /api/live/changes (0 = não ler): aba oculta, painel fechado ou aba Construção fora de vista. */
export function nextPollMs({ hidden = false, active = true, busy = false } = {}) {
  if (hidden || !active) return 0;
  return busy ? CHANGES_BUSY_MS : CHANGES_IDLE_MS;
}
/** Intervalo da leitura da versão do preview (0 = não ler). */
export const previewPollMs = ({ hidden = false, active = true } = {}) => (hidden || !active ? 0 : PREVIEW_POLL_MS);

/** Compara respostas de changes ignorando o que muda a cada leitura (generatedAt, durationMs): o estado só muda se o conteúdo mudou. */
export const changesKey = (data) => { if (!data || typeof data !== 'object') return ''; const { generatedAt, durationMs, ...rest } = data; return JSON.stringify(rest); }; // eslint-disable-line no-unused-vars

/**
 * O que fazer com a resposta do GET /api/live/preview: 'unavailable' (sem index.html), 'relight' (disponível mas o listener não está de pé, ou ainda não temos a resposta do POST:
 * religa pelo POST, que devolve a porta nova) ou 'adopt' (listener de pé: só atualiza versão e arquivos). Puro para testar o caminho que antes nunca executava.
 */
export function pollAction(r, hasMeta) {
  if (r?.available !== true) return 'unavailable';
  return r.running === true && hasMeta ? 'adopt' : 'relight';
}
