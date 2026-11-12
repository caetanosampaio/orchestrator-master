// Modelo puro da página de acompanhamento ao vivo (sem DOM, sem rede, sem relógio global): rótulos, durações, progresso,
// ordenação da linha do tempo e normalização DEFENSIVA do snapshot (schema 1). Todo texto do snapshot vem de agentes e é
// NÃO confiável: aqui ele só vira string limpa (sem caracteres de controle) e recortada; quem desenha usa somente textContent.
// Nenhuma função daqui lança: entrada ausente, nula ou de tipo inesperado vira valor neutro.

const MAX_LIST = 400; // teto defensivo por lista (o servidor já limita; isto protege contra snapshots malformados)
const MAX_TEXT = 4000;

// ---------- coerção ----------

const CONTROL = /(?![\n\t])\p{Cc}|\p{Cf}|\p{Zl}|\p{Zp}/gu;

export function str(v, max = MAX_TEXT) {
  let s = '';
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  s = s.replace(CONTROL, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);
const obj = (v) => (isObj(v) ? v : {});

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// Aceita ISO (string) ou epoch em ms (número); qualquer outra coisa vira null.
export function toMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// ---------- rótulos ----------

export const STATE_LABELS = Object.freeze({
  working: 'Em execução',
  approval: 'Aguardando aprovação',
  attention: 'Precisa de atenção',
  idle: 'Ociosa',
  completed: 'Concluída',
  cancelled: 'Cancelada',
});

const STATE_TONES = { working: 'run', approval: 'warn', attention: 'err', idle: 'idle', completed: 'ok', cancelled: 'idle' };
export const TERMINAL_STATES = Object.freeze(['completed', 'cancelled']);

export function stateKey(state) {
  const s = str(state, 40).toLowerCase();
  return Object.hasOwn(STATE_LABELS, s) ? s : 'unknown';
}
export function stateLabel(state, serverLabel = '') {
  const k = stateKey(state);
  if (k !== 'unknown') return STATE_LABELS[k];
  return str(serverLabel, 60) || 'Estado desconhecido';
}
export function stateTone(state) { return STATE_TONES[stateKey(state)] || 'idle'; }

const TONE_GROUPS = {
  ok: ['done', 'completed', 'complete', 'passed', 'pass', 'verified', 'success', 'succeeded', 'ok', 'accepted', 'approved', 'delivered', 'finished'],
  run: ['running', 'in_progress', 'in-progress', 'working', 'active', 'executing', 'started', 'doing'],
  warn: ['awaiting', 'waiting', 'approval', 'partial', 'paused', 'queued', 'needs_attention', 'retrying'],
  err: ['failed', 'fail', 'error', 'blocked', 'rejected', 'denied', 'timeout', 'timed_out', 'unverified', 'aborted'],
};
const STATUS_LABELS = {
  pending: 'pendente', queued: 'na fila', running: 'em execução', in_progress: 'em execução', 'in-progress': 'em execução', working: 'em execução',
  active: 'em execução', executing: 'em execução', started: 'iniciada', doing: 'em execução',
  done: 'concluída', completed: 'concluída', complete: 'concluída', finished: 'concluída', success: 'concluída', succeeded: 'concluída',
  passed: 'passou', pass: 'passou', verified: 'verificada', ok: 'ok', accepted: 'aceita', approved: 'aprovada', delivered: 'entregue',
  failed: 'falhou', fail: 'falhou', error: 'erro', blocked: 'bloqueada', rejected: 'rejeitada', denied: 'negada', timeout: 'tempo esgotado',
  timed_out: 'tempo esgotado', aborted: 'abortada', unverified: 'não verificada', cancelled: 'cancelada', canceled: 'cancelada',
  skipped: 'ignorada', expired: 'expirada', paused: 'pausada', partial: 'parcial', awaiting: 'aguardando', waiting: 'aguardando', approval: 'aguardando aprovação',
  needs_attention: 'precisa de atenção', retrying: 'tentando de novo',
};

export function statusKey(status) {
  return str(status, 40).trim().toLowerCase();
}
// kind 'approval': "pending" pede decisão humana, então vale como aviso e não como fila neutra.
export function statusTone(status, kind = '') {
  const k = statusKey(status);
  if (k === 'pending' && kind === 'approval') return 'warn';
  for (const [tone, list] of Object.entries(TONE_GROUPS)) if (list.includes(k)) return tone;
  return 'idle';
}
export function statusLabel(status, kind = '') {
  const k = statusKey(status);
  if (!k) return '—';
  if (k === 'pending' && kind === 'approval') return 'aguardando decisão';
  return Object.hasOwn(STATUS_LABELS, k) ? STATUS_LABELS[k] : k.slice(0, 30);
}
export function isDoneStatus(status) { return TONE_GROUPS.ok.includes(statusKey(status)); }

const EVIDENCE_LABELS = { verified: 'verificada', partial: 'parcial', unverified: 'não verificada', none: 'sem evidência', claimed: 'declarada', human: 'aceita por humano', accepted: 'aceita por humano' };
export function evidenceLabel(level) {
  const k = str(level, 40).trim().toLowerCase();
  if (!k) return '—';
  return Object.hasOwn(EVIDENCE_LABELS, k) ? EVIDENCE_LABELS[k] : k.slice(0, 30);
}
export function evidenceTone(level) {
  const k = str(level, 40).trim().toLowerCase();
  if (k === 'verified') return 'ok';
  if (k === 'partial' || k === 'claimed' || k === 'human' || k === 'accepted') return 'warn';
  if (k === 'unverified' || k === 'none') return 'err';
  return 'idle';
}

const KIND_LABELS = {
  created: 'criada', started: 'início', finished: 'fim', round: 'rodada', step: 'etapa', approval: 'aprovação', policy: 'política', block: 'bloqueio',
  blocked: 'bloqueio', note: 'nota', human: 'nota', acceptance: 'aceitação', decision: 'decisão', evidence: 'evidência', worktree: 'worktree',
  verification: 'verificação', delivery: 'entrega', squad: 'squad', claude: 'agente', log: 'log', error: 'erro', info: 'info',
};
export function kindLabel(kind) {
  const k = str(kind, 40).trim().toLowerCase();
  if (!k) return 'evento';
  return Object.hasOwn(KIND_LABELS, k) ? KIND_LABELS[k] : k.slice(0, 20);
}
export function kindTone(kind) {
  const k = str(kind, 40).trim().toLowerCase();
  if (/block|error|fail|reject|deny/.test(k)) return 'err';
  if (/approval|policy|attention|warn/.test(k)) return 'warn';
  if (/accept|finish|deliver|verified|complete/.test(k)) return 'ok';
  if (/start|round|claude|step|decision/.test(k)) return 'run';
  return 'idle';
}

// ---------- tempo ----------

const p2 = (n) => String(n).padStart(2, '0');

// 12 s · 1 min 03 s · 2 h 05 min · 1 d 03 h. Negativo, NaN ou ausente viram "—".
export function formatDuration(ms) {
  const n = num(ms);
  if (n === null || n < 0) return '—';
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${p2(s % 60)} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${p2(m % 60)} min`;
  return `${Math.floor(h / 24)} d ${p2(h % 24)} h`;
}

// "agora" (< 1 s), "há 12 s", "há 1 min 03 s".
export function formatAgo(ms) {
  const n = num(ms);
  if (n === null) return '—';
  if (n < 1000) return 'agora';
  return `há ${formatDuration(n)}`;
}

export function formatClock(ms, { utc = false } = {}) {
  const t = toMs(ms);
  if (t === null) return '—';
  const d = new Date(t);
  return utc ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}` : `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
export function formatDay(ms, { utc = false } = {}) {
  const t = toMs(ms);
  if (t === null) return '—';
  const d = new Date(t);
  return utc ? `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function formatDateTime(ms, opts) {
  const t = toMs(ms);
  return t === null ? '—' : `${formatDay(t, opts)} ${formatClock(t, opts)}`;
}

// Relógio do servidor estimado no cliente: usa generatedAt do snapshot + o tempo local decorrido desde o recebimento.
// Assim "há Xs" e a duração viva não dependem de os relógios coincidirem.
export function serverNow(generatedAtMs, receivedAtMs, nowMs) {
  const g = toMs(generatedAtMs), r = toMs(receivedAtMs), n = toMs(nowMs);
  if (n === null) return g ?? 0;
  if (g === null || r === null) return n;
  return g + Math.max(0, n - r);
}

// ---------- reconexão ----------

// 1 s, 2 s, 4 s … até 30 s, com jitter de ±25% (rand em [0,1); 0,5 = sem jitter).
export function backoffDelay(attempt, rand = Math.random) {
  const a = Math.max(0, Math.min(10, Math.floor(num(attempt) ?? 0)));
  const base = Math.min(30000, 1000 * 2 ** a);
  const r = typeof rand === 'function' ? Number(rand()) : 0.5;
  const f = 0.75 + 0.5 * (Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5);
  return Math.round(base * f);
}
export const POLL_INTERVAL_MS = 5000;

// Indicador de conexão: { key, label, tone }. `phase`: connecting | live | reconnecting | expired | ended | paused.
export function connectionView({ phase, state } = {}) {
  if (phase === 'expired') return { key: 'expired', label: 'link expirado — gere outro no FORGE', tone: 'err' };
  if (phase === 'ended') return { key: 'ended', label: 'transmissão encerrada', tone: 'idle' };
  if (phase === 'reconnecting') return { key: 'reconnecting', label: 'reconectando…', tone: 'warn' };
  if (phase === 'connecting') return { key: 'connecting', label: 'conectando…', tone: 'warn' };
  if (TERMINAL_STATES.includes(stateKey(state))) return { key: 'finished', label: 'missão encerrada', tone: 'idle' };
  if (phase === 'paused') return { key: 'paused', label: 'tela pausada', tone: 'idle' };
  return { key: 'live', label: 'ao vivo', tone: 'run' };
}

// ---------- normalização do snapshot ----------

const strList = (v, max = 400) => arr(v).map((x) => str(isObj(x) ? (x.text ?? x.message ?? x.title ?? '') : x, max)).filter(Boolean);

function normProgress(v) {
  if (!isObj(v)) return null;
  const done = num(v.done), total = num(v.total), pct = num(v.pct);
  if (done === null && total === null && pct === null) return null;
  return { basis: str(v.basis, 40), done: done === null ? null : Math.max(0, Math.floor(done)), total: total === null ? null : Math.max(0, Math.floor(total)), pct };
}

function normStep(x) {
  const o = obj(x);
  return { id: str(o.id, 80), title: str(o.title, 300), status: statusKey(o.status), dependsOn: arr(o.dependsOn).map((d) => str(d, 80)).filter(Boolean), round: num(o.round), attempts: num(o.attempts) };
}
function normRound(x) {
  const o = obj(x);
  return {
    n: num(o.n), status: statusKey(o.status), title: str(o.title, 300), agent: str(o.agent, 120), startedAt: toMs(o.startedAt), finishedAt: toMs(o.finishedAt),
    verification: statusKey(o.verification), evidenceLevel: str(o.evidenceLevel, 40).trim().toLowerCase(),
  };
}
function normTask(x) {
  const o = obj(x), to = obj(o.to);
  return {
    id: str(o.id, 80), to: { title: str(to.title, 160), role: str(to.role, 80), provider: str(to.provider, 60), model: str(to.model, 80) },
    status: statusKey(o.status), createdAt: toMs(o.createdAt), doneAt: toMs(o.doneAt), text: str(o.text, 1200),
  };
}
function normFiles(v) {
  const o = obj(v);
  const items = arr(o.items).slice(0, 50).map((it) => {
    if (isObj(it)) return { text: str(it.path ?? it.name ?? it.file ?? it.text ?? '', 300), status: str(it.status, 30) };
    return { text: str(it, 300), status: '' };
  }).filter((i) => i.text);
  const total = num(o.total);
  return { total: total === null ? items.length : Math.max(0, Math.floor(total)), items };
}

export function emptySnapshot() { return normalizeSnapshot(null); }

// Nunca lança. `ok` é false quando a entrada nem é um objeto (a página ignora e mantém o último bom).
export function normalizeSnapshot(raw) {
  try { return build(raw, isObj(raw)); } catch { return build({}, false); } // getter que lança, estrutura hostil: cai no snapshot vazio
}

function build(r, ok) {
  const m = obj(r.mission), cy = r.cycle, sq = r.squad, cur = r.current, dl = r.delivery, tl = obj(r.timeline), lk = obj(r.link);
  const state = stateKey(m.state);
  const mission = {
    title: str(m.title, 300), objective: str(m.objective, 4000), state, stateLabel: stateLabel(m.state, m.stateLabel), tone: stateTone(m.state),
    createdAt: toMs(m.createdAt), startedAt: toMs(m.startedAt), finishedAt: toMs(m.finishedAt), durationMs: num(m.durationMs),
    workspaceName: str(m.workspaceName, 160), demo: m.demo === true, origin: str(m.origin, 80),
  };
  return {
    ok, schema: num(r.schema), generatedAt: toMs(r.generatedAt), link: { expiresAt: toMs(lk.expiresAt) }, mission,
    progress: normProgress(r.progress),
    cycle: isObj(cy) ? { status: statusKey(cy.status), round: num(cy.round), maxIterations: num(cy.maxIterations), blockedCode: str(cy.blockedCode, 80), blockedReason: str(cy.blockedReason, 600) } : null,
    steps: arr(r.steps).map(normStep), rounds: arr(r.rounds).map(normRound),
    squad: isObj(sq) ? { note: str(sq.note, 600), tasks: arr(sq.tasks).map(normTask) } : null,
    current: isObj(cur) && (str(cur.what, 600) || str(cur.agent, 120)) ? { what: str(cur.what, 600), agent: str(cur.agent, 120), since: toMs(cur.since) } : null,
    recent: arr(r.recent).map((x) => (isObj(x) ? { kind: str(x.kind, 40).trim().toLowerCase(), text: str(x.text, 600) } : { kind: '', text: str(x, 600) })).filter((x) => x.text),
    approvals: arr(r.approvals).map((x) => { const o = obj(x); return { id: str(o.id, 80), round: num(o.round), title: str(o.title, 300), status: statusKey(o.status), createdAt: toMs(o.createdAt) }; }),
    verifications: arr(r.verifications).map((x) => { const o = obj(x); return { round: num(o.round), script: str(o.script, 200), status: statusKey(o.status), durationMs: num(o.durationMs) }; }),
    delivery: isObj(dl) ? {
      code: str(dl.code, 80), delivered: dl.delivered === true, assurance: str(dl.assurance, 400), limitations: strList(dl.limitations).slice(0, 10), files: normFiles(dl.files),
    } : null,
    timeline: {
      items: arr(tl.items).map((x) => { const o = obj(x); return { at: toMs(o.at), kind: str(o.kind, 40).trim().toLowerCase(), text: str(o.text, 800) }; }).filter((x) => x.text),
      omitted: Math.max(0, Math.floor(num(tl.omitted) ?? 0)),
    },
    notes: strList(r.notes, 600),
  };
}

// ---------- visões derivadas ----------

// Progresso: o do servidor quando válido; senão deriva das etapas. null se não há base.
export function computeProgress(snap) {
  const s = isObj(snap) ? snap : {};
  const p = s.progress;
  if (p && p.total !== null && p.total > 0) {
    const done = Math.min(p.done ?? 0, p.total);
    const pct = p.pct !== null ? Math.min(100, Math.max(0, Math.round(p.pct))) : Math.round((done / p.total) * 100);
    return { basis: p.basis || 'steps', done, total: p.total, pct, label: `${done} de ${p.total} ${p.total === 1 ? 'passo concluído' : 'passos concluídos'}` };
  }
  const steps = arr(s.steps);
  if (steps.length) {
    const done = steps.filter((x) => isDoneStatus(x.status)).length;
    return { basis: 'steps', done, total: steps.length, pct: Math.round((done / steps.length) * 100), label: `${done} de ${steps.length} ${steps.length === 1 ? 'passo concluído' : 'passos concluídos'}` };
  }
  return null;
}

// "Agora": o que, quem, desde quando (duração viva calculada a partir de `nowMs`, relógio do servidor estimado).
export function nowView(snap, nowMs) {
  const s = isObj(snap) ? snap : {};
  const state = obj(s.mission).state;
  const c = s.current;
  if (c) {
    const since = c.since;
    return { active: true, what: c.what || 'Trabalhando…', agent: c.agent, since, sinceMs: since === null || since === undefined ? null : Math.max(0, (toMs(nowMs) ?? since) - since) };
  }
  if (TERMINAL_STATES.includes(state)) return { active: false, what: 'Nada em execução: a missão foi encerrada.', agent: '', since: null, sinceMs: null };
  if (state === 'approval') return { active: false, what: 'Aguardando uma decisão humana no FORGE.', agent: '', since: null, sinceMs: null };
  if (state === 'attention') return { active: false, what: 'A missão precisa de atenção no FORGE.', agent: '', since: null, sinceMs: null };
  return { active: false, what: 'Aguardando o próximo evento…', agent: '', since: null, sinceMs: null };
}

// Duração total da missão: a informada, ou a viva (início até agora) enquanto não terminou.
export function missionDuration(snap, nowMs) {
  const m = obj(obj(snap).mission);
  const start = m.startedAt ?? m.createdAt ?? null;
  if (m.finishedAt && start) return Math.max(0, m.finishedAt - start);
  if (num(m.durationMs) !== null && TERMINAL_STATES.includes(m.state)) return m.durationMs;
  if (start && !TERMINAL_STATES.includes(m.state)) return Math.max(0, (toMs(nowMs) ?? start) - start);
  return num(m.durationMs);
}

// Linha do tempo: ordena por horário (estável) e agrupa por dia. order 'desc' (mais recente primeiro, padrão) ou 'asc'.
// Itens sem horário válido vão para um grupo final "sem horário", na ordem original.
export function groupTimeline(items, { order = 'desc', utc = false } = {}) {
  const list = arr(items).map((it, i) => ({ ...obj(it), at: toMs(obj(it).at), _i: i }));
  const dated = list.filter((x) => x.at !== null);
  const undated = list.filter((x) => x.at === null);
  const dir = order === 'asc' ? 1 : -1;
  dated.sort((a, b) => (a.at - b.at) * dir || (a._i - b._i) * dir);
  const groups = [];
  for (const it of dated) {
    const key = formatDay(it.at, { utc });
    let g = groups[groups.length - 1];
    if (!g || g.day !== key) { g = { day: key, items: [] }; groups.push(g); }
    g.items.push({ at: it.at, time: formatClock(it.at, { utc }), kind: str(it.kind, 40), text: str(it.text, 800) });
  }
  if (undated.length) groups.push({ day: 'sem horário', items: undated.map((it) => ({ at: null, time: '—', kind: str(it.kind, 40), text: str(it.text, 800) })) });
  return groups;
}

// Aviso de expiração do link (para o rodapé): "expira em 11 h 20 min".
export function expiryText(snap, nowMs) {
  const e = obj(obj(snap).link).expiresAt;
  if (!e) return '';
  const left = e - (toMs(nowMs) ?? 0);
  return left <= 0 ? 'link expirado' : `link expira em ${formatDuration(left)}`;
}

export function pageTitle(snap) {
  const m = obj(obj(snap).mission);
  const t = str(m.title, 80);
  return t ? `FORGE · ${t} · ${stateLabel(m.state, m.stateLabel)}` : 'FORGE · missão ao vivo';
}
