// Missions v2 (fatia 2): agenda das missões de AUTOMAÇÃO (flow.kind === 'automation'). Módulo independente: não importa flows.js nem store.js; o agendador recebe `flows` injetado.
// Regras (docs/missions-v2-fatia2.md, decisão 3): roda só com o servidor no ar; horário perdido = pulado; run ativo no horário = pulado; todo pulo é registrado; NADA roda no boot.
//
// scheduleState (só o servidor escreve; datas em ISO): { anchorAt, nextRunAt|null, lastSlotAt|null, lastRunId|null, skips: [{ slotAt, reason, message, count?, at }] } (máx. MAX_SKIPS pulos).
//   - anchorAt: âncora do intervalo ("a cada N h" = anchorAt + k*N h); refeita para "agora" quando a agenda é editada (refresh).
//   - lastSlotAt: o último horário TRATADO (disparado ou pulado); um horário <= lastSlotAt nunca é tratado de novo. lastRunId só muda quando um run é de fato iniciado.
//
// Disparo duplo: o próximo horário é sempre calculado DEPOIS do horário tratado e gravado junto com lastSlotAt. Se saveScheduleState falhar, a decisão tomada (run iniciado ou pulo)
// fica guardada em memória (`pending`) e o próximo tick só tenta GRAVAR de novo o mesmo estado, sem reavaliar o horário: um run já iniciado nunca é iniciado outra vez. A memória é
// descartada se o estado gravado mudar por outro caminho (ex.: refresh). Limite conhecido: se o processo cair entre o início do run e a gravação, o banco também não gravou o run
// (store grava o banco inteiro) e o boot registra o horário como perdido.

export const MAX_SKIPS = 20, MAX_EVERY_HOURS = 168, CHECK_MS = 30_000, GRACE_MS = 120_000, MAX_SCHEDULED_ACTIVE = 3;
export const SCHEDULE_KINDS = Object.freeze(['interval', 'daily', 'weekly']);
export const SKIP_REASONS = Object.freeze(['missed', 'active_run', 'start_failed', 'limit', 'archived', 'workspace_missing']);
export const WEEKDAY_LABELS = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);
const HOUR_MS = 3_600_000, TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/, MAX_COUNT_ITER = 5000, MAX_MESSAGE = 300;
const KEYS = { interval: ['enabled', 'kind', 'everyHours'], daily: ['enabled', 'kind', 'time'], weekly: ['enabled', 'kind', 'days', 'time'] };

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isoOk = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const clip = (v, n) => { const s = String(v ?? ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

// ---------- funções puras ----------
/** Valida e normaliza a agenda de um flow. `kind` = kind do FLOW ('project'|'automation'). Devolve { value } (null ou agenda normalizada, `enabled` ausente = true) ou { error } em português. */
export function validateSchedule(raw, kind) {
  if (raw === undefined || raw === null) return { value: null };
  if (kind !== 'automation') return { error: 'A agenda só vale para missões de automação.' };
  if (!isObj(raw)) return { error: 'schedule deve ser um objeto ou null.' };
  if (!SCHEDULE_KINDS.includes(raw.kind)) return { error: `schedule.kind deve ser um destes: ${SCHEDULE_KINDS.join(', ')}.` };
  const extra = Object.keys(raw).filter((k) => !KEYS[raw.kind].includes(k));
  if (extra.length) return { error: `Propriedades não permitidas na agenda: ${extra.join(', ').slice(0, 80)}.` };
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return { error: 'schedule.enabled deve ser verdadeiro ou falso.' };
  const enabled = raw.enabled !== false;
  if (raw.kind === 'interval') {
    if (!Number.isInteger(raw.everyHours) || raw.everyHours < 1 || raw.everyHours > MAX_EVERY_HOURS) return { error: `schedule.everyHours deve ser um inteiro de 1 a ${MAX_EVERY_HOURS}.` };
    return { value: { enabled, kind: 'interval', everyHours: raw.everyHours } };
  }
  if (typeof raw.time !== 'string' || !TIME_RE.test(raw.time)) return { error: 'schedule.time deve estar no formato HH:MM (00:00 a 23:59).' };
  if (raw.kind === 'daily') return { value: { enabled, kind: 'daily', time: raw.time } };
  if (!Array.isArray(raw.days) || raw.days.length < 1 || raw.days.length > 7 || raw.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'schedule.days deve ser uma lista de 1 a 7 dias (0 = domingo a 6 = sábado).' };
  if (new Set(raw.days).size !== raw.days.length) return { error: 'schedule.days tem dias repetidos.' };
  return { value: { enabled, kind: 'weekly', days: [...raw.days].sort((a, b) => a - b), time: raw.time } };
}

const usable = (s) => validateSchedule(s, 'automation').value ?? null; // defensivo: o banco pode ter sido editado à mão

/**
 * Próximo horário (ms) ESTRITAMENTE depois de `fromMs`; null se a agenda é nula, desligada ou inválida.
 * interval: anchorMs + k*everyHours (k inteiro; sem âncora válida, a âncora é fromMs). daily/weekly: horário LOCAL do servidor, montado com new Date(y, m, d, hh, mm) (o Date normaliza o horário de verão).
 */
export function nextRunAt(schedule, fromMs, anchorMs) {
  const s = usable(schedule);
  if (!s || !s.enabled || !Number.isFinite(fromMs)) return null;
  if (s.kind === 'interval') {
    const p = s.everyHours * HOUR_MS, a = Number.isFinite(anchorMs) ? anchorMs : fromMs;
    return a + (Math.floor((fromMs - a) / p) + 1) * p;
  }
  const [hh, mm] = s.time.split(':').map(Number), f = new Date(fromMs), y = f.getFullYear(), m = f.getMonth(), d = f.getDate();
  for (let i = 0; i <= 14; i++) {
    if (s.kind === 'weekly' && !s.days.includes(new Date(y, m, d + i, 12).getDay())) continue; // dia da semana pelo meio-dia: imune à virada do horário de verão
    const c = new Date(y, m, d + i, hh, mm).getTime();
    if (c > fromMs) return c;
  }
  return null;
}

/** Texto curto em português: "a cada 4 h", "diário às 09:00", "dom, qua às 08:30"; "desligada" (enabled false) ou "sem agenda" (null/inválida). */
export function describeSchedule(schedule) {
  const s = usable(schedule);
  if (!s) return 'sem agenda';
  if (!s.enabled) return 'desligada';
  if (s.kind === 'interval') return `a cada ${s.everyHours} h`;
  if (s.kind === 'daily') return `diário às ${s.time}`;
  return `${s.days.map((d) => WEEKDAY_LABELS[d]).join(', ')} às ${s.time}`;
}

/** Normaliza um scheduleState lido do banco (campos inválidos viram null; pulos inválidos saem; no máximo MAX_SKIPS). Nunca devolve o mesmo objeto. */
export function readScheduleState(state) {
  const st = isObj(state) ? state : {};
  const skips = Array.isArray(st.skips) ? st.skips.filter((k) => isObj(k) && SKIP_REASONS.includes(k.reason)).map((k) => ({ ...k })) : [];
  return {
    anchorAt: isoOk(st.anchorAt) ? st.anchorAt : null,
    nextRunAt: isoOk(st.nextRunAt) ? st.nextRunAt : null,
    lastSlotAt: isoOk(st.lastSlotAt) ? st.lastSlotAt : null,
    lastRunId: typeof st.lastRunId === 'string' && st.lastRunId ? st.lastRunId : null,
    skips: skips.slice(-MAX_SKIPS),
  };
}

/** Estado recalculado a partir de agora (agenda criada/editada): anchorAt = agora, nextRunAt = próximo depois de agora (null se desligada); lastSlotAt, lastRunId e pulos são mantidos. */
export function freshScheduleState(schedule, nowMs, prev) {
  const cur = readScheduleState(prev);
  return { ...cur, anchorAt: iso(nowMs), nextRunAt: iso(nextRunAt(schedule, nowMs, nowMs)) };
}

/** Horários de `firstMs` até `toMs` (inclusive): { count, last }. Para daily/weekly percorre no máximo MAX_COUNT_ITER horários (count vira um piso). */
function slotsUpTo(schedule, firstMs, toMs, anchorMs) {
  if (schedule.kind === 'interval') {
    const p = schedule.everyHours * HOUR_MS, count = Math.floor((toMs - firstMs) / p) + 1;
    return { count, last: firstMs + (count - 1) * p };
  }
  let count = 1, last = firstMs;
  for (let n = nextRunAt(schedule, firstMs, anchorMs); n !== null && n <= toMs && count < MAX_COUNT_ITER; n = nextRunAt(schedule, n, anchorMs)) { count++; last = n; }
  return { count, last };
}

function withSkip(state, skip) { return { ...state, skips: [...state.skips, skip].slice(-MAX_SKIPS) }; }

// ---------- agendador ----------
/**
 * Agendador das automações. `flows` (injetado) precisa de: scheduled() -> [{ flow, state }], hasActiveRun(flowId), workspaceExists(workspaceId), countActiveScheduled(),
 * startScheduled(flowId, slotIso) -> { ok, error?, runId? } (pode devolver Promise) e saveScheduleState(flowId, nextState) (lança se não gravar; nesse caso o estado não foi aplicado).
 * Para que desligar/remover a agenda zere nextRunAt, scheduled() deve listar também os flows que ainda têm scheduleState (ou o chamador zera o estado ele mesmo).
 * Devolve { start, stop, tick, boot, refresh }. start() roda boot() se ainda não rodou. tick() devolve uma Promise (um tick por vez; chamada concorrente recebe a mesma Promise).
 */
export function createFlowScheduler({ flows, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, checkMs = CHECK_MS, graceMs = GRACE_MS, maxScheduledActive = MAX_SCHEDULED_ACTIVE, onError = (e) => console.error('[flow-schedule]', e?.code || e?.message || e) } = {}) {
  if (!flows) throw new Error('createFlowScheduler: flows é obrigatório.');
  const pending = new Map(); // flowId -> { baseNext, baseAnchor, next }: decisão tomada cuja gravação falhou (regravada no próximo tick, sem reavaliar)
  const inflight = new Set(), refreshedDuring = new Set();
  let timer = null, booted = false, ticking = null;

  const report = (e) => { try { onError(e); } catch { /* o onError não pode derrubar o agendador */ } };
  function list() {
    let l;
    try { l = flows.scheduled(); } catch (e) { report(e); return []; }
    return Array.isArray(l) ? l.filter((x) => isObj(x) && isObj(x.flow) && typeof x.flow.id === 'string') : [];
  }
  const lookup = (id) => list().find((x) => x.flow.id === id) ?? null;
  const activeSchedule = (flow) => (flow.kind === 'automation' ? usable(flow.schedule) : null);
  const enabledSchedule = (flow) => { const s = activeSchedule(flow); return s && s.enabled ? s : null; };

  /** Grava `next` como novo estado. `raw` = estado lido do banco antes da decisão. Falhou: guarda em `pending` e devolve false. */
  function commit(id, raw, next) {
    pending.set(id, { baseNext: raw?.nextRunAt ?? null, baseAnchor: raw?.anchorAt ?? null, next });
    try { flows.saveScheduleState(id, next); pending.delete(id); return true; } catch (e) { report(e); return false; }
  }
  /** Gravação pendente deste flow ainda vale? (o estado gravado é o mesmo de quando a decisão foi tomada) */
  function retryPending(id, raw) {
    const p = pending.get(id);
    if (!p) return false;
    if ((raw?.nextRunAt ?? null) !== p.baseNext || (raw?.anchorAt ?? null) !== p.baseAnchor) { pending.delete(id); return false; }
    try { flows.saveScheduleState(id, p.next); pending.delete(id); } catch (e) { report(e); }
    return true;
  }

  /** Agenda nula/desligada: nextRunAt null. Sem próximo horário: inicializa a partir de agora. Devolve o estado normalizado ou null quando já tratou o flow. */
  function settleBasics(flow, raw, sch, t) {
    const cur = readScheduleState(raw);
    if (!sch) { if (cur.nextRunAt !== null) commit(flow.id, raw, { ...cur, nextRunAt: null }); return null; }
    if (cur.nextRunAt === null) { commit(flow.id, raw, freshScheduleState(sch, t, cur)); return null; }
    if (cur.anchorAt === null) cur.anchorAt = cur.nextRunAt; // mantém a cadência do intervalo
    return cur;
  }

  const missedMessage = (count, atBoot) => (atBoot
    ? (count > 1 ? `${count} horários perdidos enquanto o FORGE estava fechado.` : 'Horário perdido: o FORGE estava fechado.')
    : (count > 1 ? `${count} horários perdidos: a agenda não foi verificada a tempo (computador suspenso ou ocupado).` : 'Horário perdido: a agenda não foi verificada a tempo (computador suspenso ou ocupado).'));

  /** Horário vencido: um pulo `missed` com count e o próximo calculado a partir de `t`. */
  function markMissed(flow, raw, cur, sch, slot, t, atBoot) {
    const anchor = Date.parse(cur.anchorAt), { count, last } = slotsUpTo(sch, slot, t, anchor);
    const next = { ...cur, lastSlotAt: iso(last), nextRunAt: iso(nextRunAt(sch, t, anchor)) };
    commit(flow.id, raw, withSkip(next, { slotAt: iso(slot), reason: 'missed', message: missedMessage(count, atBoot), count, at: iso(t) }));
  }

  /** Boot: nada é iniciado. Horário vencido = UM pulo `missed` com count; o próximo é calculado a partir de agora. */
  function boot() {
    booted = true;
    const t = now();
    for (const { flow, state } of list()) {
      try {
        const cur = settleBasics(flow, state, enabledSchedule(flow), t);
        if (!cur) continue;
        const sch = enabledSchedule(flow), slot = Date.parse(cur.nextRunAt);
        if (slot > t) { if (!isoOk(state?.anchorAt)) commit(flow.id, state, cur); continue; }
        if (cur.lastSlotAt && Date.parse(cur.lastSlotAt) >= slot) { commit(flow.id, state, { ...cur, nextRunAt: iso(nextRunAt(sch, t, Date.parse(cur.anchorAt))) }); continue; }
        markMissed(flow, state, cur, sch, slot, t, true);
      } catch (e) { report(e); }
    }
  }

  async function handle(flow, raw, t) {
    const id = flow.id;
    if (retryPending(id, raw)) return; // decisão já tomada para este horário: só regrava
    const sch = enabledSchedule(flow), cur = settleBasics(flow, raw, sch, t);
    if (!cur) return;
    const slot = Date.parse(cur.nextRunAt);
    if (slot > t) return;
    const anchor = Date.parse(cur.anchorAt), slotIso = iso(slot), next = iso(nextRunAt(sch, t, anchor));
    if (cur.lastSlotAt && Date.parse(cur.lastSlotAt) >= slot) { commit(id, raw, { ...cur, nextRunAt: next }); return; } // horário já tratado: só avança
    if (t - slot > graceMs) { markMissed(flow, raw, cur, sch, slot, t, false); return; }
    const treated = { ...cur, lastSlotAt: slotIso, nextRunAt: next };
    const skip = (reason, message) => commit(id, raw, withSkip(treated, { slotAt: slotIso, reason, message: clip(message, MAX_MESSAGE), at: iso(t) }));
    if (flow.archived === true) return skip('archived', 'A missão está arquivada.');
    if (!flows.workspaceExists(flow.workspaceId)) return skip('workspace_missing', 'O workspace da missão não existe mais.');
    if (flows.hasActiveRun(id)) return skip('active_run', 'A missão ainda tinha uma execução ativa neste horário.');
    if (flows.countActiveScheduled() >= maxScheduledActive) return skip('limit', `Limite de ${maxScheduledActive} execuções agendadas ao mesmo tempo atingido.`);
    let res;
    inflight.add(id);
    try { res = await flows.startScheduled(id, slotIso); } catch (e) { report(e); res = { ok: false, error: 'Erro interno ao iniciar a missão.' }; } finally { inflight.delete(id); }
    let base = raw, done = treated;
    if (refreshedDuring.delete(id)) { // a agenda foi editada enquanto o run iniciava: mantém o horário recalculado e só acrescenta o resultado deste horário
      base = lookup(id)?.state; const latest = readScheduleState(base);
      done = { ...latest, lastSlotAt: slotIso };
    }
    if (res?.ok) commit(id, base, { ...done, lastRunId: typeof res.runId === 'string' && res.runId ? res.runId : null });
    else commit(id, base, withSkip(done, { slotAt: slotIso, reason: 'start_failed', message: clip(res?.error || 'A missão não pôde ser iniciada.', MAX_MESSAGE), at: iso(t) }));
  }

  /** Um passo do agendador: trata cada flow com horário vencido. Falha num flow não impede os outros. */
  function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      try {
        const t = now();
        for (const { flow, state } of list()) { try { await handle(flow, state, t); } catch (e) { report(e); } }
      } catch (e) { report(e); } finally { ticking = null; }
    })();
    return ticking;
  }

  /** Agenda criada/editada: recalcula a partir de agora (anchorAt = agora). Devolve o estado gravado, ou null se o flow não está em scheduled(). Lança se saveScheduleState falhar. */
  function refresh(flowId) {
    const entry = lookup(flowId);
    if (!entry) { pending.delete(flowId); return null; }
    if (inflight.has(flowId)) refreshedDuring.add(flowId);
    const base = pending.get(flowId)?.next ?? entry.state; // decisão pendente (ex.: run iniciado sem gravar) não se perde
    const next = freshScheduleState(enabledSchedule(entry.flow), now(), base);
    flows.saveScheduleState(flowId, next);
    pending.delete(flowId);
    return next;
  }

  function start() {
    if (!booted) boot();
    if (timer || !(checkMs > 0)) return;
    timer = setTimer(() => { void tick(); }, checkMs);
    try { timer?.unref?.(); } catch { /* fake dos testes */ }
  }
  function stop() { if (!timer) return; try { clearTimer(timer); } catch { /* já limpo */ } timer = null; }

  return { start, stop, tick, boot, refresh };
}
