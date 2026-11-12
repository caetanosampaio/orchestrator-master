// Cola do DOM da página de acompanhamento ao vivo. Regra de segurança: o snapshot vem de agentes (NÃO confiável); todo texto dele
// entra no DOM só por textContent (via el()); nada de HTML montado, nem URL, nem atributo de evento a partir do snapshot.
// Rede: apenas ./stream (SSE), ./data (fallback de 5 s) e o link estático ./report.md do HTML. Sem cookies nem armazenamento local.
import {
  normalizeSnapshot, computeProgress, nowView, missionDuration, groupTimeline, connectionView, serverNow, backoffDelay, POLL_INTERVAL_MS,
  formatDuration, formatAgo, formatClock, formatDateTime, statusLabel, statusTone, evidenceLabel, evidenceTone, kindLabel, kindTone, stateTone,
  expiryText, pageTitle, TERMINAL_STATES,
} from '/live/_/live-model.js';

const $ = (id) => document.getElementById(id);
const TONES = new Set(['run', 'ok', 'warn', 'err', 'idle']);
const ATTR_OK = /^(role|title|id|aria-[a-z]+|data-[a-z-]+)$/;

// Cria um elemento. O texto entra por textContent; atributos só da lista segura (nada de href/src/on*/style).
function el(tag, cls, text, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null && text !== '') n.textContent = String(text);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (ATTR_OK.test(k)) n.setAttribute(k, String(v));
  return n;
}
function add(parent, ...kids) { for (const k of kids) if (k) parent.appendChild(k); return parent; }
function tag(text, tone) { return el('span', 'tag', text, { 'data-tone': TONES.has(tone) ? tone : 'idle' }); }
function setTone(node, tone) { node.setAttribute('data-tone', TONES.has(tone) ? tone : 'idle'); }
function setHidden(node, hide) { if (hide) node.setAttribute('hidden', ''); else node.removeAttribute('hidden'); }
function meta(...parts) {
  const d = el('div', 'rows__meta');
  for (const p of parts) if (p) add(d, el('span', '', p));
  return d;
}

// ---------- estado ----------
const S = {
  snap: null, receivedAt: 0, shownAt: 0, phase: 'connecting', paused: false, pendingWhilePaused: false,
  order: 'desc', sig: {}, clocks: [], clockKeys: {},
};
const nowMs = () => (S.snap ? serverNow(S.snap.generatedAt, S.receivedAt, Date.now()) : Date.now());

// Relógios vivos: pares {node, fn}; fn(nowMs) devolve o texto. Substituídos quando a seção é redesenhada.
function setClocks(key, list) {
  S.clockKeys[key] = list;
  S.clocks = Object.values(S.clockKeys).flat();
}
function clock(node, fn) { return { node, fn }; }

// Redesenha uma seção só quando os dados dela mudaram (preserva rolagem, seleção e evita reanunciar leitores de tela).
function section(key, data, secId, visible, draw) {
  const sec = secId ? $(secId) : null;
  const sig = JSON.stringify(data);
  if (S.sig[key] === sig) return;
  S.sig[key] = sig;
  if (sec) setHidden(sec, !visible);
  if (visible) draw();
  else setClocks(key, []);
}

// ---------- seções ----------
function drawHero(s) {
  const m = s.mission;
  section('hero', m, null, true, () => {
    $('mission-title').textContent = m.title || 'Missão sem título';
    $('mission-objective').textContent = m.objective;
    setHidden($('mission-objective'), !m.objective);
    $('state-label').textContent = m.stateLabel;
    const st = $('state');
    setTone(st, m.tone);
    st.className = `state state--${m.state}`;
    const led = st.querySelector('.led');
    if (led) led.className = m.state === 'working' ? 'led led--pulse' : 'led';
    setHidden($('demo-note'), !m.demo);
    document.title = pageTitle(s);
    const box = $('hero-meta');
    box.replaceChildren();
    const parts = [];
    if (m.workspaceName) parts.push(el('span', '', `workspace ${m.workspaceName}`));
    if (m.origin) parts.push(el('span', '', `origem ${m.origin}`));
    if (m.startedAt || m.createdAt) parts.push(el('span', '', `${m.startedAt ? 'início' : 'criada'} ${formatDateTime(m.startedAt || m.createdAt)}`));
    const dur = el('span', '');
    parts.push(dur);
    parts.forEach((p, i) => { if (i) box.appendChild(document.createTextNode(' · ')); box.appendChild(p); });
    const f = (now) => { const d = missionDuration(S.snap, now); return d === null ? '' : `duração ${formatDuration(d)}`; };
    dur.textContent = f(nowMs());
    setClocks('hero', [clock(dur, f)]);
  });
}

function drawNow(s) {
  const nv = nowView(s, nowMs());
  const prog = computeProgress(s);
  section('now', [nv.what, nv.agent, nv.since, nv.active, s.mission.state], 'sec-now', true, () => {
    const box = $('now-live');
    box.replaceChildren(el('p', 'now__what', nv.what));
    if (nv.agent) {
      const a = el('p', 'now__agent', 'agente: ');
      add(a, el('b', '', nv.agent));
      box.appendChild(a);
    }
    const c = $('now-clock');
    if (nv.since !== null && nv.since !== undefined) {
      const f = () => { const v = nowView(S.snap, nowMs()); return v.sinceMs === null ? '' : `desde ${formatClock(v.since)} · há ${formatDuration(v.sinceMs)}`; };
      c.textContent = f();
      setClocks('now', [clock(c, f)]);
    } else { c.textContent = ''; setClocks('now', []); }
  });
  section('progress', prog, null, true, () => {
    const box = $('progress');
    setHidden(box, !prog);
    if (!prog) return;
    $('progress-label').textContent = prog.label;
    $('progress-pct').textContent = `${prog.pct}%`;
    const track = $('progress-track');
    track.setAttribute('aria-valuenow', String(prog.pct));
    track.setAttribute('aria-valuetext', `${prog.pct}%: ${prog.label}`);
    $('progress-fill').style.width = `${prog.pct}%`; // CSSOM (a CSP não permite style inline, mas permite isto)
  });
}

function stepRow(x) {
  const li = el('li');
  add(li, tag(statusLabel(x.status), statusTone(x.status)));
  const main = el('div', 'rows__main');
  add(main, el('div', 'rows__title', x.title || x.id || 'Etapa'));
  add(main, meta(
    x.id && x.title ? `id ${x.id}` : '', x.round !== null ? `rodada ${x.round}` : '', x.attempts ? `${x.attempts} ${x.attempts === 1 ? 'tentativa' : 'tentativas'}` : '',
    x.dependsOn.length ? `depende de ${x.dependsOn.join(', ')}` : '',
  ));
  return add(li, main);
}
function drawSteps(s) {
  section('steps', s.steps, 'sec-steps', s.steps.length > 0, () => { $('steps').replaceChildren(add(el('ol', 'rows'), ...s.steps.map(stepRow))); });
}

function roundRow(r) {
  const li = el('li');
  add(li, tag(statusLabel(r.status), statusTone(r.status)));
  const main = el('div', 'rows__main');
  add(main, el('div', 'rows__title', `${r.n !== null ? `Rodada ${r.n}` : 'Rodada'}${r.title ? ` · ${r.title}` : ''}`));
  const m = meta(r.agent ? `agente ${r.agent}` : '', r.startedAt ? `início ${formatClock(r.startedAt)}` : '', r.startedAt && r.finishedAt ? `duração ${formatDuration(r.finishedAt - r.startedAt)}` : '');
  if (r.verification) { const w = el('span', ''); add(w, document.createTextNode('verificação '), tag(statusLabel(r.verification), statusTone(r.verification))); add(m, w); }
  if (r.evidenceLevel) { const w = el('span', ''); add(w, document.createTextNode('evidência '), tag(evidenceLabel(r.evidenceLevel), evidenceTone(r.evidenceLevel))); add(m, w); }
  return add(li, add(main, m));
}
function drawRounds(s) {
  section('rounds', s.rounds, 'sec-rounds', s.rounds.length > 0, () => $('rounds').replaceChildren(add(el('ol', 'rows'), ...s.rounds.map(roundRow))));
}

function drawSquad(s) {
  const q = s.squad;
  section('squad', q, 'sec-squad', !!q && (q.tasks.length > 0 || !!q.note), () => {
    const box = $('squad');
    box.replaceChildren();
    if (q.note) add(box, el('p', 'note', q.note));
    if (!q.tasks.length) { add(box, el('p', 'muted small', 'Nenhuma tarefa do Maestro vinculada a esta missão.')); return; }
    const ul = el('ul', 'rows');
    for (const t of q.tasks) {
      const li = el('li');
      add(li, tag(statusLabel(t.status), statusTone(t.status)));
      const main = el('div', 'rows__main');
      const dest = [t.to.title, [t.to.role, [t.to.provider, t.to.model].filter(Boolean).join('/')].filter(Boolean).join(' · ')].filter(Boolean);
      add(main, el('div', 'rows__title', dest.length ? `para ${dest[0]}${dest[1] ? ` (${dest[1]})` : ''}` : 'tarefa do Maestro'));
      add(main, meta(t.createdAt ? `criada ${formatClock(t.createdAt)}` : '', t.doneAt ? `concluída ${formatClock(t.doneAt)}` : '', t.id ? `id ${t.id}` : ''));
      if (t.text) add(main, el('div', 'rows__body', t.text));
      add(ul, add(li, main));
    }
    add(box, ul);
  });
}

function drawVerifications(s) {
  section('verifications', s.verifications, 'sec-verifications', s.verifications.length > 0, () => {
    const ul = el('ul', 'rows');
    for (const v of s.verifications) {
      const li = el('li');
      add(li, tag(statusLabel(v.status), statusTone(v.status)));
      const main = el('div', 'rows__main');
      add(main, el('div', 'rows__title', v.script || 'verificação'));
      add(main, meta(v.round !== null ? `rodada ${v.round}` : '', v.durationMs !== null ? `duração ${formatDuration(v.durationMs)}` : ''));
      add(ul, add(li, main));
    }
    $('verifications').replaceChildren(ul);
  });
}

function drawApprovals(s) {
  section('approvals', s.approvals, 'sec-approvals', s.approvals.length > 0, () => {
    const box = $('approvals');
    box.replaceChildren(el('p', 'note', 'Somente leitura: decida no FORGE.'));
    const ul = el('ul', 'rows');
    for (const a of s.approvals) {
      const li = el('li');
      add(li, tag(statusLabel(a.status, 'approval'), statusTone(a.status, 'approval')));
      const main = el('div', 'rows__main');
      add(main, el('div', 'rows__title', a.title || 'Aprovação'));
      add(main, meta(a.round !== null ? `rodada ${a.round}` : '', a.createdAt ? `pedida ${formatClock(a.createdAt)}` : ''));
      add(ul, add(li, main));
    }
    add(box, ul);
  });
}

function drawDelivery(s) {
  const d = s.delivery;
  section('delivery', d, 'sec-delivery', !!d, () => {
    const box = $('delivery');
    box.replaceChildren();
    const kv = el('dl', 'kv');
    add(kv, el('dt', '', 'entregue'), el('dd', '', d.delivered ? 'sim' : 'ainda não'));
    if (d.code) add(kv, el('dt', '', 'situação'), el('dd', '', d.code));
    if (d.assurance) add(kv, el('dt', '', 'garantia'), el('dd', '', d.assurance));
    add(box, kv);
    if (d.limitations.length) {
      add(box, el('h3', 'subtitle', 'Limitações'));
      add(box, add(el('ul', 'bullets'), ...d.limitations.map((x) => el('li', '', x))));
    }
    if (d.files.total || d.files.items.length) {
      add(box, el('h3', 'subtitle', `Arquivos (${d.files.total})`));
      add(box, add(el('ul', 'bullets'), ...d.files.items.map((f) => el('li', '', f.status ? `${f.text} · ${f.status}` : f.text))));
      if (d.files.total > d.files.items.length) add(box, el('p', 'hint', `e mais ${d.files.total - d.files.items.length} arquivo(s) não listados aqui.`));
    }
  });
}

function drawTimeline(s) {
  const tl = s.timeline;
  section('timeline', [tl, S.order], 'sec-timeline', tl.items.length > 0 || tl.omitted > 0, () => {
    const box = $('timeline');
    box.replaceChildren();
    for (const g of groupTimeline(tl.items, { order: S.order })) {
      add(box, el('h3', 'tl__day', g.day));
      const ul = el('ul', 'tl__list');
      for (const it of g.items) {
        const li = el('li');
        add(li, el('span', 'tl__time', it.time), tag(kindLabel(it.kind), kindTone(it.kind)), el('span', 'tl__text', it.text));
        add(ul, li);
      }
      add(box, ul);
    }
    if (tl.omitted > 0) add(box, el('p', 'hint tl__omitted', `${tl.omitted} ${tl.omitted === 1 ? 'item omitido' : 'itens omitidos'} por limite de exibição.`));
  });
  $('timeline-order').textContent = S.order === 'desc' ? 'Mais antigos primeiro' : 'Mais recentes primeiro';
}

function drawRecent(s) {
  section('recent', s.recent, 'sec-recent', s.recent.length > 0, () => {
    const ul = el('ul', 'log');
    for (const r of s.recent) add(ul, add(el('li'), el('span', 'log__kind', r.kind ? kindLabel(r.kind) : 'log'), el('span', 'log__text', r.text)));
    $('recent').replaceChildren(ul);
  });
}

function drawNotes(s) {
  section('notes', s.notes, 'sec-notes', s.notes.length > 0, () => $('notes').replaceChildren(add(el('ul', 'bullets'), ...s.notes.map((n) => el('li', '', n)))));
}

function render() {
  const s = S.snap;
  if (!s) return;
  S.shownAt = Date.now();
  setHidden($('empty'), true);
  drawHero(s); drawNow(s); drawSteps(s); drawRounds(s); drawSquad(s); drawVerifications(s); drawApprovals(s); drawDelivery(s); drawTimeline(s); drawRecent(s); drawNotes(s);
  renderConn();
  tick();
}

// ---------- conexão / indicadores ----------
function renderConn() {
  const v = connectionView({ phase: S.paused && !['expired', 'ended', 'reconnecting', 'connecting'].includes(S.phase) ? 'paused' : S.phase, state: S.snap ? S.snap.mission.state : '' });
  const c = $('conn');
  c.className = `conn conn--${v.key}`;
  setTone(c, v.tone);
  $('conn-label').textContent = v.label;
  const led = c.querySelector('.led');
  if (led) led.className = v.key === 'live' ? 'led led--pulse' : 'led';
  document.body.classList.toggle('is-stale', S.phase === 'expired' || S.phase === 'ended');
  document.body.classList.toggle('is-paused', S.paused);
}

function banner(text, tone) {
  const b = $('banner');
  if (!text) { b.textContent = ''; setHidden(b, true); return; }
  b.textContent = text;
  setTone(b, tone);
  setHidden(b, false);
}

function tick() {
  const now = nowMs();
  for (const c of S.clocks) { const t = c.fn(now); if (c.node.textContent !== t) c.node.textContent = t; }
  const u = $('updated');
  if (!S.snap) u.textContent = 'aguardando o primeiro dado';
  else if (S.paused) u.textContent = `tela pausada ${formatAgo(Date.now() - S.shownAt)}`;
  else u.textContent = `atualizado ${formatAgo(Date.now() - S.receivedAt)}`;
  $('expiry').textContent = S.snap ? expiryText(S.snap, now) : '';
}

function setPhase(p) {
  if (S.phase === p) return;
  S.phase = p;
  if (p === 'live') banner('');
  else if (p === 'reconnecting') banner('Conexão ao vivo interrompida. Tentando reconectar; enquanto isso a página consulta os dados a cada 5 segundos.', 'warn');
  renderConn();
}

function applySnapshot(raw) {
  const n = normalizeSnapshot(raw);
  if (!n.ok) return;
  S.snap = n;
  S.receivedAt = Date.now();
  if (S.paused) { S.pendingWhilePaused = true; renderConn(); tick(); return; }
  render();
}

// ---------- rede: SSE com backoff + fallback por consulta ----------
let es = null, pollTimer = null, retryTimer = null, attempt = 0, stopped = false, polling = false;

async function fetchData() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch('./data', { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (res.status === 404 || res.status === 410 || res.status === 401 || res.status === 403) return { gone: true };
    if (!res.ok) return { error: true };
    return { data: await res.json() };
  } catch { return { error: true }; } finally { clearTimeout(t); }
}

async function pollOnce() {
  if (polling || stopped) return;
  polling = true;
  try {
    const r = await fetchData();
    if (stopped) return;
    if (r.gone) expire();
    else if (r.data) applySnapshot(r.data);
  } finally { polling = false; }
}
function startPolling() { if (pollTimer || stopped) return; pollOnce(); pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

function closeStream() { if (es) { try { es.close(); } catch { /* já fechado */ } } es = null; }

function expire() {
  stopped = true;
  closeStream(); stopPolling();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  S.phase = 'expired';
  banner('Este link expirou ou foi revogado. Gere outro no FORGE para continuar acompanhando.', 'err');
  $('pause').disabled = true;
  renderConn(); tick();
}

async function onEnd() {
  closeStream(); stopPolling();
  const r = await fetchData();
  if (r.gone) { expire(); return; }
  stopped = true;
  if (r.data) applySnapshot(r.data);
  S.phase = 'ended';
  banner('A transmissão foi encerrada pelo FORGE. O último estado recebido continua na tela.', 'warn');
  renderConn(); tick();
}

function scheduleRetry() {
  if (retryTimer || stopped) return;
  const delay = backoffDelay(attempt++);
  retryTimer = setTimeout(() => { retryTimer = null; openStream(); }, delay);
}

function openStream() {
  if (stopped || es) return;
  let src;
  try { src = new EventSource('./stream'); } catch { setPhase('reconnecting'); startPolling(); scheduleRetry(); return; }
  es = src;
  src.addEventListener('open', () => { attempt = 0; stopPolling(); setPhase('live'); });
  src.addEventListener('snapshot', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    if (S.phase !== 'live') { attempt = 0; stopPolling(); setPhase('live'); }
    applySnapshot(data);
  });
  src.addEventListener('end', () => { onEnd(); });
  src.addEventListener('error', () => {
    if (stopped) return;
    setPhase('reconnecting');
    startPolling();
    if (src.readyState === EventSource.CLOSED) { if (es === src) es = null; scheduleRetry(); }
  });
}

// ---------- interação ----------
$('pause').addEventListener('click', () => {
  S.paused = !S.paused;
  const b = $('pause');
  b.textContent = S.paused ? 'Ligar ao vivo' : 'Pausar a tela';
  b.setAttribute('aria-pressed', S.paused ? 'true' : 'false');
  if (!S.paused && S.snap) { S.pendingWhilePaused = false; render(); } else { renderConn(); tick(); }
});
$('timeline-order').addEventListener('click', () => {
  S.order = S.order === 'desc' ? 'asc' : 'desc';
  if (S.snap) drawTimeline(S.snap);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !stopped && !es) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } openStream(); }
});

setInterval(tick, 1000);
setPhase('connecting');
renderConn();
openStream();
