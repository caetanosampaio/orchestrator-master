// Visão REDIGIDA de uma missão para o acompanhamento ao vivo no navegador (página /live/<token>/) e para o relatório `report.md`.
// Funções puras: não gravam nada (nem no banco nem no workspace), não executam nada e NUNCA lançam, para qualquer missão
// (demonstrativa, sem ciclo, só squad, ciclo legado, dados malformados, campos de tipo errado). Dado ilegível vira `null`/lista vazia + uma linha em `notes`.
//
// Como a privacidade é garantida (e até onde):
//  - A visão é montada CAMPO A CAMPO (allowlist); nunca `{ ...mission }`. Não entram: workspace.path, conversation, outputTail das verificações, saída de terminais
//    (linhas [stdout]/[stderr] do log), `command` bruto das verificações e dos preparos, nem argumentos de ferramentas de shell.
//  - Todo texto livre passa por `redactor`: ANSI e caracteres de controle removidos; segredos (sk-…, ghp_/github_pat_, AKIA…, xox…, Bearer …, JWT, blocos PRIVATE KEY,
//    (KEY|TOKEN|SECRET|PASSWORD)…=valor, userinfo de URL via `redactSecrets` de worktrees.js); caminhos absolutos (Windows, UNC, POSIX) e as raízes do workspace,
//    dos worktrees, do diretório de dados e do home viram marcadores («workspace», «worktree», «dados», «home», «caminho»).
//  - A redação é MELHOR ESFORÇO (heurística): a barreira real é o link por missão (capacidade), somente leitura, em loopback. Texto de agente é NÃO confiável.
//
// Paridade com o cliente: o vínculo missão <-> tarefa do Maestro (`squadTasksOf`) é a PORTA SERVER-SIDE de `squadTasks` em client/src/missions-view.js
// (duas barreiras: tempo e workspace; pane sumido só vale por remetente do workspace ou por pane já ligado). Se a heurística do cliente mudar, mude aqui também
// (o teste de paridade em server/test/mission-live-view.test.mjs compara as duas).
import os from 'node:os';
import { missionStatus } from './mission-status.js';
import { stepStatusFromRound } from './plan.js';
import { deliveryOf } from './delivery.js';
import { redactSecrets } from './worktrees.js';

export const LIVE_SCHEMA = 1;
export const LIMITS = Object.freeze({ timeline: 300, recent: 30, recentLine: 180, files: 50, limitations: 10, bytes: 256 * 1024, steps: 100, rounds: 60, approvals: 50, verifications: 100, squad: 50, notes: 20 });

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objs = (v) => arr(v).filter(isObj);
const ms = (v) => { if (typeof v !== 'string' || v.length > 40) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const iso = (v) => { const t = ms(v); return t === null ? null : new Date(t).toISOString(); };

// ---------- sanitização e redação ----------
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]?/g;
const C1_CSI = /\u009b[0-?]*[ -/]*[@-~]?/g;
// controles (menos \n e \t), C1, zero-width e marcas bidirecionais (spoofing de texto)
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
/** Remove sequências ANSI e caracteres de controle. Só o que é texto de verdade sobra (\n e \t são mantidos). */
export function stripControl(s) {
  return String(s).replace(OSC, '').replace(CSI, '').replace(C1_CSI, '').replace(/\u001b./g, '').replace(CTRL, '');
}

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;
// Acrescenta aos padrões de `redactSecrets` (worktrees.js: userinfo de URL, _auth/password/token=valor). Idempotente: o marcador `***` não casa de novo.
const SECRET_RULES = [
  [/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{15,}/g, '***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '***'],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g, '***'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '***'],
  [/\b(Bearer)[ \t]+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b(authorization[ \t]*[:=][ \t]*)(?:(?:bearer|basic|token)[ \t]+)?[^\s,;]+/gi, '$1***'],
  [/([A-Za-z0-9_.-]{0,40}(?:key|token|secret|passw(?:or)?d|pwd)[A-Za-z0-9_.-]{0,40})([ \t]*[=:][ \t]*)("[^"]*"|'[^']*'|[^\s,;"']+)/gi, '$1$2***'],
];
const PATH_RULES = [
  [/\bfile:\/\/\/?[^\s"'<>|`]*/gi, '«caminho»'],
  [/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|*?`]*/g, '«caminho»'], // C:\… e C:/…
  [/(?<![\w\\])\\\\[\w.$-]+\\+[^\s"'<>|]+/g, '«caminho»'], // UNC \\servidor\compartilhamento\…
  [/(?<![\w.:/\\-])\/(?:home|Users|root|var|tmp|opt|etc|mnt|usr|srv|private|Volumes|proc|run|snap|builds|workspaces?)(?=[/\s"'<>|`,;:)]|$)(?:\/[^\s"'<>|`]*)?/g, '«caminho»'], // POSIX conhecidos
  [/(?<!\w)~[\\/][^\s"'<>|`]*/g, '«caminho»'],
];
const BASE64_LINE = /^(\s*(?:\[claude\]\s+)?)[A-Za-z0-9+/=]{48,}\s*$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEY_MARK = '«chave privada removida»';

function rootRule(p, mark) {
  if (typeof p !== 'string') return null;
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (n.length < 3) return null; // nunca a raiz do disco
  return { len: n.length, re: new RegExp(`${n.split('/').map(esc).join('[\\\\/]+')}(?![A-Za-z0-9_.-])`, 'gi'), mark };
}

const clipTo = (s, n) => {
  if (s.length <= n) return s;
  let out = s.slice(0, Math.max(0, n - 1));
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1); // não corta um par substituto ao meio
  return `${out}…`;
};

/**
 * Redator de texto da visão. `roots`: raízes a mascarar (workspace/worktrees/dados/home).
 * `text(v, n)`: uma linha, até n caracteres. `block(v, n)`: várias linhas (quebras preservadas). Só strings e números viram texto; o resto vira ''.
 */
export function redactor({ workspace = null, worktrees = [], dataDir = null, roots = [] } = {}) {
  const rules = [];
  const add = (p, mark) => { const r = rootRule(p, mark); if (r) rules.push(r); };
  try { add(workspace?.path, '«workspace»'); } catch { /* sem raiz */ }
  for (const w of arr(worktrees)) { try { add(w?.path, '«worktree»'); add(w?.repoPath, '«workspace»'); } catch { /* ignora */ } }
  add(dataDir, '«dados»');
  for (const r of arr(roots)) add(r, '«raiz»');
  try { add(os.homedir(), '«home»'); } catch { /* sem home */ }
  rules.sort((a, b) => b.len - a.len);

  const asText = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
  const line = (s) => {
    let x = s;
    for (const [re, to] of SECRET_RULES) x = x.replace(re, to);
    x = x.replace(/\S{300,}/g, '«texto longo omitido»'); // blob sem espaço (base64, minificado): não é texto humano e evita custo quadrático nas regexes abaixo
    x = redactSecrets(x);
    for (const r of rules) x = x.replace(r.re, r.mark);
    for (const [re, to] of PATH_RULES) x = x.replace(re, to);
    return x.replace(BASE64_LINE, '$1***');
  };
  const prep = (v, n) => stripControl(asText(v).slice(0, Math.max(n * 4, 2000))).replace(PRIVATE_KEY, KEY_MARK);
  return {
    text(v, n = 200) { return clipTo(line(prep(v, n).replace(/\s+/g, ' ').trim()), n); },
    block(v, n = 1000) {
      const body = prep(v, n).split('\n').map((l) => line(l.replace(/[ \t]+$/g, ''))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      return clipTo(body, n);
    },
  };
}

// ---------- estados ----------
const STATE_LABEL = Object.freeze({ idle: 'Ociosa', working: 'Trabalhando', completed: 'Concluída', attention: 'Atenção', approval: 'Aprovação', cancelled: 'Cancelada' });
const CYCLE_PT = { planning: 'planejando', running: 'em execução', blocked: 'bloqueado', cancelled: 'cancelado', limit_reached: 'limite de rodadas atingido', completed: 'concluído' };
const ROUND_PT = { running: 'em execução', succeeded: 'concluída', failed: 'falhou', interrupted: 'interrompida' };
const SHELL_TOOLS = /^(?:bash|powershell|shell|sh|cmd|terminal|task)$/i; // o argumento é um comando: nunca é mostrado

function stateOf(c, tasks) {
  if (c && c.status === 'blocked' && c.blockedCode === 'approval_required' && objs(c.approvals).some((a) => a.status === 'pending')) return 'approval'; // igual ao cliente (cycleApprovalPending)
  let st = 'queued';
  try { st = missionStatus({ cycle: c, tasks }); } catch { /* estado desconhecido: ociosa */ }
  switch (st) {
    case 'running': return 'working';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    case 'awaiting_approval': return 'approval';
    case 'failed': case 'interrupted': case 'blocked': case 'limit_reached': return 'attention';
    default: return 'idle';
  }
}

const safeStep = (r) => { try { return stepStatusFromRound(r); } catch { return 'failed'; } };

/** Porta server-side de missionProgress (client/src/missions-view.js): { basis, done, total, pct } ou null se nada foi planejado. */
function progressOf(state, steps, rounds, tasks) {
  let r;
  if (steps.length) r = { basis: 'etapas', done: steps.filter((s) => s.status === 'completed').length, total: steps.length };
  else if (rounds.length) r = { basis: 'rodadas', done: rounds.filter((x) => safeStep(x) === 'completed').length, total: null };
  else if (tasks.length) r = { basis: 'tarefas', done: tasks.filter((t) => t.status === 'completed').length, total: tasks.length };
  else return null;
  return { ...r, pct: state === 'completed' ? 100 : r.total ? Math.round((r.done / r.total) * 100) : null };
}

// ---------- squad (Maestro): porta de squadTasks de client/src/missions-view.js ----------
/** Tarefas do Maestro desta missão, em ordem de criação, com o pane de destino (ou null). `squad` = { tasks, sessions } ou só a lista de tarefas. */
export function squadTasksOf(m, squad, sessionsArg = []) {
  const taskList = (Array.isArray(squad) ? squad : arr(squad?.tasks)).slice(0, 200);
  const all = objs(isObj(squad) && Array.isArray(squad.sessions) ? squad.sessions : sessionsArg).filter((s) => s.id != null);
  const wsId = m?.workspaceId;
  const mine = new Map(all.filter((s) => s.workspaceId === wsId).map((s) => [s.id, s])), others = new Set(all.filter((s) => s.workspaceId !== wsId).map((s) => s.id));
  const from = ms(m?.cycle?.startedAt) ?? ms(m?.createdAt);
  const tasks = objs(taskList).filter((t) => typeof t.id === 'string' && !others.has(t.to) && !(from !== null && ms(t.createdAt) !== null && ms(t.createdAt) < from));
  const linked = new Set(tasks.filter((t) => mine.has(t.to) || mine.has(t.from)).map((t) => t.id)), pane = new Set(tasks.filter((t) => linked.has(t.id)).map((t) => t.to));
  return tasks.filter((t) => linked.has(t.id) || pane.has(t.to))
    .sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0) || String(a.id).localeCompare(String(b.id)))
    .map((task) => ({ task, session: mine.get(task.to) ?? null }));
}

// ---------- log da tarefa -> atividade recente ----------
const LOG_WINDOW = 200, LOG_LINE_PRE = 600;
/** Linhas legíveis de UMA tarefa, redigidas: só o que o agente disse ([claude]), ferramentas (sem comando de shell), erros de ferramenta, sessão, fim e avisos. [stdout]/[stderr] e o resto ficam de fora. */
function taskLines(task, R) {
  const log = arr(task?.log).filter((l) => typeof l === 'string').slice(-LOG_WINDOW).map((l) => l.slice(0, LOG_LINE_PRE));
  if (!log.length) return [];
  const out = [];
  for (const raw of R.block(log.join('\n'), LOG_WINDOW * LOG_LINE_PRE).split('\n')) {
    const l = raw.trim();
    let m;
    if ((m = /^\[claude\]\s+(.+)$/.exec(l))) out.push({ kind: 'agent', text: clipTo(m[1].trim(), LIMITS.recentLine) });
    else if ((m = /^\[ferramenta\]\s+(\S+)(?:\s+(.*))?$/.exec(l))) out.push({ kind: 'tool', text: clipTo(SHELL_TOOLS.test(m[1]) ? m[1] : `${m[1]} ${m[2] ?? ''}`.trim(), LIMITS.recentLine) });
    else if ((m = /^\[erro de ferramenta\]\s*(.*)$/.exec(l))) out.push({ kind: 'error', text: clipTo(`erro de ferramenta: ${m[1].replace(/\s+/g, ' ')}`.trim(), LIMITS.recentLine) });
    else if ((m = /^\[sessão\]\s+modelo\s+(\S+)/.exec(l))) out.push({ kind: 'system', text: clipTo(`sessão iniciada (modelo ${m[1]})`, LIMITS.recentLine) });
    else if ((m = /^\[fim\]\s*(.*)$/.exec(l))) out.push({ kind: 'end', text: clipTo(`fim: ${m[1]}`.trim(), LIMITS.recentLine) });
    else if ((m = /^\[aviso\]\s*(.*)$/.exec(l))) out.push({ kind: 'warn', text: clipTo(`aviso: ${m[1]}`.trim(), LIMITS.recentLine) });
  }
  return out;
}

function recentOf(tasks, R) {
  const list = tasks.filter((t) => Array.isArray(t.log) && t.log.length).map((t, i) => ({ t, i, at: ms(t.startedAt) ?? 0 })).sort((a, b) => a.at - b.at || a.i - b.i);
  let out = [];
  for (let k = list.length - 1; k >= 0 && out.length < LIMITS.recent; k--) out = [...taskLines(list[k].t, R).slice(-(LIMITS.recent - out.length)), ...out];
  return out.slice(-LIMITS.recent);
}

// ---------- agora ----------
function currentOf({ state, demo, c, rounds, tasks, approvals, squadItems }, R) {
  if (demo) return null;
  const t = (v, n = 160) => R.text(v, n);
  const lastRound = rounds.at(-1) ?? null;
  const pending = approvals.filter((a) => a.status === 'pending');
  if (c && c.status === 'blocked') {
    if (pending.length) { const a = pending[0]; return { what: `Aguardando a sua decisão: ${t(a.title, 120) || 'ação que exige aprovação'} (rodada ${a.round ?? '?'})`, agent: null, since: a.createdAt }; }
    const b = objs(c.blocks).at(-1);
    return { what: `Ciclo bloqueado (${t(c.blockedCode, 40) || 'sem código'}): ${t(c.blockedReason, 160) || 'sem motivo gravado'}`, agent: null, since: iso(b?.at) };
  }
  if (c && ['planning', 'running'].includes(c.status)) {
    if (lastRound && lastRound.phase === 'verifying') return { what: `Verificando a rodada ${lastRound.n ?? '?'} (testes e build reais)`, agent: 'Sistema', since: iso(lastRound.finishedAt) ?? iso(lastRound.startedAt) };
    const run = [...rounds].reverse().find((r) => r.status === 'running');
    if (run) return { what: `Executando a rodada ${run.n ?? '?'}: ${t(run.plan?.title, 120) || 'sem título'}`, agent: `Executor${typeof run.agent === 'string' && run.agent ? ` (${t(run.agent, 30)})` : ''}`, since: iso(run.startedAt) };
    return { what: lastRound ? `Planner avaliando o resultado da rodada ${lastRound.n ?? '?'} e decidindo a próxima etapa` : 'Planner montando o plano da missão', agent: 'Planner', since: iso(lastRound?.finishedAt) ?? iso(c.startedAt) };
  }
  const runTask = tasks.find((x) => x.status === 'running');
  if (runTask) return { what: `Executando a tarefa: ${t(runTask.title, 120) || 'sem título'}`, agent: t(runTask.agent, 30) || null, since: iso(runTask.startedAt) };
  const waitTask = tasks.find((x) => x.status === 'awaiting_approval');
  if (waitTask) return { what: `Aguardando a sua aprovação da tarefa: ${t(waitTask.title, 120) || 'sem título'}`, agent: null, since: iso(waitTask.createdAt) };
  const delivered = squadItems.filter((x) => x.task.status === 'delivered'), pend = squadItems.filter((x) => x.task.status === 'pending');
  if (delivered.length) { const f = delivered[0]; return { what: `Maestro: ${delivered.length} tarefa(s) em andamento: ${t(String(f.task.text ?? '').split('\n').find((l) => l.trim()) ?? '', 100)}`.replace(/: $/, ''), agent: t(f.session?.title ?? f.task.toTitle, 60) || null, since: iso(f.task.createdAt) }; }
  if (pend.length) return { what: `Maestro: ${pend.length} tarefa(s) aguardando a sua aprovação`, agent: null, since: iso(pend[0].task.createdAt) };
  return state === 'working' ? { what: 'Em andamento', agent: null, since: null } : null;
}

// ---------- linha do tempo ----------
function timelineOf({ mission, c, rounds, worktreesOf, tasks, squadItems }, R, notes) {
  const items = []; let seq = 0, invalid = 0;
  const add = (at, kind, text) => { const t = ms(at); if (t === null) { if (at != null) invalid++; return; } items.push({ ms: t, seq: seq++, at: new Date(t).toISOString(), kind, text: R.text(text, 240) }); };
  add(mission?.createdAt, 'mission', 'Missão criada');
  if (c) {
    add(c.startedAt, 'cycle', `Ciclo autônomo iniciado (limite de ${num(c.maxIterations) ?? '?'} rodada(s))`);
    if (isObj(c.plan)) add(c.plan.createdAt, 'plan', `Plano criado com ${objs(c.plan.steps).length} etapa(s)`);
    for (const r of rounds) {
      const title = R.text(r.plan?.title, 100), n = r.n ?? '?', ag = typeof r.agent === 'string' && r.agent ? ` (${R.text(r.agent, 30)})` : '';
      add(r.startedAt, 'round', `Rodada ${n} iniciada: ${title || 'sem título'}${ag}`);
      const v = verificationOf(r), lv = ['verified', 'inconclusive', 'failed'].includes(r.report?.evidence?.level) ? r.report.evidence.level : null;
      add(r.finishedAt, 'round', `Rodada ${n} ${ROUND_PT[r.status] ?? R.text(r.status, 20) ?? ''}${v ? `; verificações: ${v}` : ''}${lv ? `; evidência: ${lv}` : ''}`);
      if (isObj(r.decision)) add(r.decision.at, 'decision', `Planner decidiu "${R.text(r.decision.decision, 40)}" depois da rodada ${n}${r.decision.rationale ? `: ${R.text(r.decision.rationale, 160)}` : ''}`);
      if (lv) add(r.report.evidence.at, 'evidence', `Parecer de evidência da rodada ${n}: ${lv}`);
    }
    for (const a of objs(c.approvals)) {
      const title = R.text(a.action?.title, 100);
      add(a.createdAt, 'approval', `Aprovação solicitada (rodada ${a.round ?? '?'}): ${title || 'ação sensível'}`);
      if (a.decidedAt) add(a.decidedAt, 'approval', `Ação ${a.status === 'rejected' ? 'rejeitada' : 'aprovada'} por ${R.text(a.decidedBy, 20) || 'uma pessoa'}: ${title || 'ação sensível'}`);
    }
    for (const p of objs(c.policyLog)) add(p.at, 'policy', `Política (rodada ${p.round ?? '?'}${p.stepId ? `, etapa ${R.text(p.stepId, 40)}` : ''}): ${R.text(p.decision, 30)} → ${R.text(p.outcome, 30)}`);
    for (const b of objs(c.blocks)) add(b.at, 'block', `Ciclo bloqueado (${R.text(b.code, 40) || 'sem código'}): ${R.text(b.reason, 160)}`);
    for (const h of objs(c.humanNotes)) add(h.at, 'note', `Orientação humana: ${R.text(h.text, 160)}`);
    if (isObj(c.acceptance) && c.acceptance.kind === 'unverified_acceptance') add(c.acceptance.at, 'acceptance', `Conclusão aceita por uma pessoa SEM evidência verificada (rodada ${c.acceptance.round ?? '?'})`);
    add(c.finishedAt, 'cycle', `Ciclo terminou: ${CYCLE_PT[c.status] ?? R.text(c.status, 30)}`);
  }
  for (const w of worktreesOf) for (const a of objs(w.attempts)) add(a.at, 'worktree', `Worktree: ${R.text(a.kind, 30) || 'tentativa'} → ${R.text(a.outcome ?? a.result, 40) || 'sem resultado'}`);
  for (const t of tasks.filter((x) => !x.auto)) { // tarefas do ciclo já aparecem como rodadas
    add(t.startedAt, 'task', `Tarefa iniciada: ${R.text(t.title, 100)}`);
    add(t.finishedAt, 'task', `Tarefa ${R.text(t.status, 20)}: ${R.text(t.title, 100)}`);
  }
  for (const { task: t, session } of squadItems) {
    const to = R.text(session?.title ?? t.toTitle ?? t.toRole, 60) || 'pane';
    add(t.createdAt, 'squad', `Tarefa do Maestro para ${to}: ${R.text(String(t.text ?? '').split('\n').find((l) => l.trim()) ?? '', 100)}`);
    if (t.doneAt) add(t.doneAt, 'squad', `Tarefa do Maestro concluída (${to})`);
  }
  if (invalid) notes.push(`${invalid} registro(s) sem data válida ficaram fora da linha do tempo.`);
  items.sort((a, b) => a.ms - b.ms || a.seq - b.seq);
  const seen = new Set(), uniq = [];
  for (const i of items) { const k = `${i.at}\u0000${i.kind}\u0000${i.text}`; if (!seen.has(k)) { seen.add(k); uniq.push({ at: i.at, kind: i.kind, text: i.text }); } }
  const omitted = Math.max(0, uniq.length - LIMITS.timeline);
  return { items: uniq.slice(omitted), omitted };
}

function verificationOf(r) {
  if (r?.report?.verificationsInterrupted) return 'skipped';
  return typeof r?.verification === 'string' ? r.verification.slice(0, 20) : null;
}

// ---------- montagem ----------
function nowOf(ctx) {
  let v = ctx?.now;
  try { if (typeof v === 'function') v = v(); } catch { v = undefined; }
  if (v instanceof Date) v = v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return ms(v) ?? Date.now();
}

function deliveryOfCtx(mission, ctx, nowIso) {
  const d = ctx.delivery;
  if (isObj(d)) {
    if (isObj(d.report)) return d.report;
    if (d.ok === false) return null;
    if (isObj(d.state) || d.schemaVersion !== undefined) return d;
  }
  const r = deliveryOf(mission, isObj(ctx.workspace) ? ctx.workspace : null, { now: () => nowIso, worktrees: arr(ctx.worktrees) });
  return r.ok ? r.report : null;
}

function deliverySection(rep, R, notes) {
  if (!isObj(rep)) return null;
  const lim = arr(rep.limitations).filter((x) => typeof x === 'string').map((x) => R.text(x, 300)).filter(Boolean);
  if (lim.length > LIMITS.limitations) notes.push(`${lim.length - LIMITS.limitations} limitação(ões) omitida(s) (a visão mostra ${LIMITS.limitations}).`);
  const files = isObj(rep.observed?.files) ? rep.observed.files : {}, fitems = objs(files.items);
  return {
    code: R.text(rep.state?.code, 30) || null, delivered: rep.state?.delivered === true, assurance: R.text(rep.assurance?.level, 30) || null, limitations: lim.slice(0, LIMITS.limitations),
    files: { total: num(files.total) ?? fitems.length, items: fitems.slice(0, LIMITS.files).map((f) => ({ path: R.text(f.path, 200), status: R.text(f.status, 12) || null, added: num(f.added), removed: num(f.removed), preexisting: f.preexisting === true })) },
  };
}

function build(mission, ctx) {
  const notes = [], note = (s) => { if (notes.length < LIMITS.notes) notes.push(s); };
  const m = isObj(mission) ? mission : {};
  if (!isObj(mission)) note('Os dados da missão estão ilegíveis.');
  const nowMs = nowOf(ctx), nowIso = new Date(nowMs).toISOString();
  const worktrees = objs(ctx.worktrees);
  const R = redactor({ workspace: isObj(ctx.workspace) ? ctx.workspace : null, worktrees, dataDir: typeof ctx.dataDir === 'string' ? ctx.dataDir : null, roots: arr(ctx.roots) });
  const guard = (name, fn, fallback) => { try { return fn(); } catch { note(`Seção "${name}" indisponível (dados ilegíveis).`); return fallback; } };

  const demo = m.demo === true;
  const c = isObj(m.cycle) ? m.cycle : null;
  if (m.cycle != null && !c) note('O ciclo autônomo da missão está ilegível.');
  const rounds = c ? objs(c.rounds) : [], tasks = objs(m.tasks), planSteps = c ? objs(c.plan?.steps) : [];
  if (demo) note('Missão demonstrativa: nada foi executado.');

  const steps = guard('etapas', () => planSteps.slice(0, LIMITS.steps).map((s) => {
    const rs = rounds.filter((x) => x.planId === c.plan?.id && x.stepId === s.id), r = rs.at(-1);
    return { id: R.text(s.id, 60), title: R.text(s.title, 200), status: safeStep(r), dependsOn: arr(s.dependsOn).filter((d) => typeof d === 'string').slice(0, 20).map((d) => R.text(d, 60)), round: num(r?.n), attempts: rs.length };
  }), []);
  const state = guard('estado', () => stateOf(c, tasks), 'idle');
  const sessionsCtx = arr(ctx.sessions);
  const squadItems = guard('squad', () => (demo || ctx.squad == null ? [] : squadTasksOf(m, ctx.squad, sessionsCtx)), []);
  const approvals = guard('aprovações', () => (c ? objs(c.approvals).slice(-LIMITS.approvals).map((a) => ({ id: R.text(a.id, 60), round: num(a.round), title: R.text(a.action?.title, 160), status: R.text(a.status, 20), createdAt: iso(a.createdAt) })) : []), []);
  const roundsOut = guard('rodadas', () => rounds.slice(-LIMITS.rounds).map((r) => ({
    n: num(r.n), status: R.text(r.status, 20), title: R.text(r.plan?.title, 200), agent: R.text(r.agent, 40) || null, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), verification: verificationOf(r),
    evidenceLevel: ['verified', 'inconclusive', 'failed'].includes(r.report?.evidence?.level) ? r.report.evidence.level : null,
  })), []);
  const verifications = guard('verificações', () => {
    const out = [];
    for (const r of rounds) for (const v of objs(r.report?.verifications)) out.push({ round: num(r.n), script: R.text(v.script ?? v.id, 80) || null, status: R.text(v.status, 20) || null, durationMs: num(v.durationMs) }); // sem command, outputTail nem reason
    return out.slice(-LIMITS.verifications);
  }, []);
  const progress = guard('progresso', () => progressOf(state, steps, rounds, tasks), null);

  const squad = guard('squad', () => {
    if (demo || ctx.squad == null || (!squadItems.length && c)) return null;
    return {
      note: 'Tarefas do Maestro são mantidas só em memória (últimas 50): o que saiu da memória não aparece aqui.',
      tasks: squadItems.slice(-LIMITS.squad).map(({ task: t, session: s }) => ({
        id: R.text(t.id, 60), to: { title: R.text(s?.title ?? t.toTitle, 80) || null, role: R.text(s?.roleLabel ?? s?.role ?? t.toRole, 60) || null, provider: s ? (s.provider === 'codex' ? 'codex' : 'claude') : null, model: R.text(s?.model ?? s?.usage?.model, 60) || null },
        status: R.text(t.status, 20), createdAt: iso(t.createdAt), doneAt: iso(t.doneAt), text: R.text(t.text, 300), summary: R.text(t.summary, 300) || null,
      })),
    };
  }, null);
  const current = guard('agora', () => currentOf({ state, demo, c, rounds, tasks, approvals, squadItems }, R), null);
  const recent = guard('atividade recente', () => (demo ? [] : recentOf(tasks, R)), []);
  const worktreesOf = worktrees.filter((w) => w.missionId === m.id);
  const timeline = guard('linha do tempo', () => (demo ? timelineOf({ mission: m, c: null, rounds: [], worktreesOf: [], tasks: [], squadItems: [] }, R, notes) : timelineOf({ mission: m, c, rounds, worktreesOf, tasks, squadItems }, R, notes)), { items: [], omitted: 0 });
  const delivery = guard('entrega', () => (demo ? null : deliverySection(deliveryOfCtx(m, ctx, nowIso), R, notes)), null);
  if (!demo && !delivery) note('O relatório de entrega não pôde ser montado.');

  const startedAt = iso(c?.startedAt) ?? iso(tasks.map((t) => t.startedAt).filter((x) => ms(x) !== null).sort().at(0)) ?? null;
  const finishedAt = iso(c?.finishedAt);
  const startMs = ms(c?.startedAt), endMs = ms(c?.finishedAt);
  const active = c && ['planning', 'running'].includes(c.status);
  let durationMs = null; // do início do ciclo até o fim (ou até agora, se ativo); sem ciclo, null
  if (startMs !== null) { const stop = endMs ?? (active ? nowMs : null); durationMs = stop === null ? null : Math.max(0, stop - startMs); }
  const wsName = R.text(ctx.workspace?.displayName || ctx.workspace?.name, 100) || null;

  const snap = {
    schema: LIVE_SCHEMA, generatedAt: nowIso, link: { expiresAt: iso(ctx.link?.expiresAt ?? ctx.linkExpiresAt) },
    mission: { title: R.text(m.title, 200), objective: R.block(m.objective, 1000), state, stateLabel: STATE_LABEL[state], createdAt: iso(m.createdAt), startedAt, finishedAt, durationMs, workspaceName: wsName, demo, origin: R.text(m.origin, 40) || null },
    progress,
    cycle: c ? { status: R.text(c.status, 30) || null, round: num(rounds.at(-1)?.n) ?? (rounds.length || null), maxIterations: num(c.maxIterations), blockedCode: R.text(c.blockedCode, 60) || null, blockedReason: R.text(c.blockedReason, 500) || null } : null,
    steps, rounds: roundsOut, squad, current, recent,
    approvals: approvals.map(({ id, round, title, status, createdAt }) => ({ id, round, title, status, createdAt })),
    verifications, delivery, timeline, notes,
  };
  return fit(snap);
}

/** Garante o teto de 256 KB: se estourar, corta ao meio a MAIOR lista (mantendo as entradas mais novas) até caber. Nunca devolve acima do limite. */
function fit(snap) {
  const size = () => Buffer.byteLength(JSON.stringify(snap));
  const lists = () => [
    ['timeline', snap.timeline?.items], ['recent', snap.recent], ['squad', snap.squad?.tasks], ['rounds', snap.rounds], ['verifications', snap.verifications], ['steps', snap.steps],
    ['approvals', snap.approvals], ['files', snap.delivery?.files?.items], ['limitations', snap.delivery?.limitations],
  ].filter(([, l]) => Array.isArray(l) && l.length);
  let cut = false;
  for (let guard = 0; guard < 200 && size() > LIMITS.bytes; guard++) {
    const [name, l] = lists().sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0] ?? [];
    if (!l) break;
    const drop = Math.max(1, Math.ceil(l.length / 2));
    l.splice(0, drop); // as mais antigas saem primeiro
    if (name === 'timeline') snap.timeline.omitted += drop;
    cut = true;
  }
  if (cut) snap.notes.push('Visão reduzida para caber no limite de 256 KB; as entradas mais antigas foram omitidas.');
  if (size() > LIMITS.bytes) return minimal(snap.generatedAt, snap.link, 'A visão desta missão excede o limite de tamanho.');
  return snap;
}

function minimal(generatedAt, link, why, title = '') {
  return {
    schema: LIVE_SCHEMA, generatedAt, link: link ?? { expiresAt: null },
    mission: { title, objective: '', state: 'idle', stateLabel: STATE_LABEL.idle, createdAt: null, startedAt: null, finishedAt: null, durationMs: null, workspaceName: null, demo: false, origin: null },
    progress: null, cycle: null, steps: [], rounds: [], squad: null, current: null, recent: [], approvals: [], verifications: [], delivery: null, timeline: { items: [], omitted: 0 }, notes: [why],
  };
}

/**
 * Snapshot (schema 1) da missão, redigido e dentro dos limites. NUNCA lança.
 * @param {object} mission  missão do banco (qualquer formato; dado malformado vira null + notes)
 * @param {{workspace?:object, worktrees?:object[], squad?:{tasks:object[], sessions?:object[]}|object[], sessions?:object[], delivery?:object, now?:(()=>string|number)|string|number|Date,
 *          dataDir?:string, roots?:string[], link?:{expiresAt?:string}}} [ctx]
 *   `squad`: tarefas do Maestro (`{ tasks, sessions }`: as sessões de terminal permitem ligar a tarefa ao workspace; sem sessões nenhuma tarefa é ligada, nunca adivinhada).
 *   `delivery`: relatório de entrega já montado (ou `{ ok, report }` de deliveryOf); ausente = recomputado aqui.
 */
export function buildLiveView(mission, ctx = {}) {
  const c = isObj(ctx) ? ctx : {};
  try { return build(mission, c); } catch {
    // último recurso: nem o contexto nem a missão são confiáveis; cada leitura é isolada para a função nunca lançar
    let title = '', at = new Date().toISOString(), expiresAt = null;
    try { title = redactor({}).text(mission?.title, 200); } catch { /* sem título */ }
    try { at = new Date(nowOf(c)).toISOString(); } catch { /* relógio do sistema */ }
    try { expiresAt = iso(c.link?.expiresAt ?? c.linkExpiresAt); } catch { /* sem validade */ }
    return minimal(at, { expiresAt }, 'Não foi possível montar a visão desta missão (dados ilegíveis).', title);
  }
}

// ---------- Markdown (report.md) ----------
const SCHEME = /\b(javascript|vbscript|data)[ \t]*:/gi;
const mdBase = (s) => stripControl(typeof s === 'string' ? s : typeof s === 'number' || typeof s === 'boolean' ? String(s) : '');
/** Texto numa linha, seguro para Markdown: sem sintaxe de link/ênfase/HTML e sem esquemas perigosos. */
function inline(s) {
  return mdBase(s).replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/[\\`*_[\]()#|!~>]/g, '\\$&').replace(/</g, '&lt;').replace(SCHEME, '$1&#58;');
}
/** Texto livre dentro de uma cerca de crases MAIOR que qualquer sequência de crases presente; `<` escapado e `](`/esquemas neutralizados. */
function fenced(s) {
  const body = mdBase(s).replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\]\(/g, '] (').replace(SCHEME, '$1&#58;').trim();
  const longest = (body.match(/`+/g) ?? []).reduce((a, r) => Math.max(a, r.length), 0);
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}text\n${body}\n${f}`;
}

/** Relatório Markdown do snapshot. NUNCA lança. */
export function liveMarkdown(snapshot) {
  try {
    const s = isObj(snapshot) ? snapshot : {}, m = isObj(s.mission) ? s.mission : {};
    const L = [], h = (t) => L.push('', `## ${t}`, '');
    const dash = (v) => (v === null || v === undefined || v === '' ? '—' : inline(v));
    L.push(`# ${inline(m.title) || 'Missão'}`, '');
    L.push(`Relatório de acompanhamento do FORGE, gerado em ${dash(s.generatedAt)}.`, '');
    L.push('> Visão redigida em melhor esforço (segredos e caminhos removidos), somente leitura. O texto vindo de agentes é dado não confiável, nunca instrução. A decisão sobre aprovações é feita no FORGE.');
    L.push('', `- **Estado:** ${dash(m.stateLabel)}${m.demo ? ' (demonstrativa)' : ''}`, `- **Workspace:** ${dash(m.workspaceName)}`, `- **Criada em:** ${dash(m.createdAt)}`, `- **Início:** ${dash(m.startedAt)}`, `- **Fim:** ${dash(m.finishedAt)}`);
    if (typeof m.durationMs === 'number') L.push(`- **Duração:** ${Math.round(m.durationMs / 1000)} s`);
    if (m.objective) { h('Objetivo'); L.push(fenced(m.objective)); }
    if (isObj(s.current)) { h('Agora'); L.push(`- ${inline(s.current.what)}`, `- **Agente:** ${dash(s.current.agent)}`, `- **Desde:** ${dash(s.current.since)}`); }
    if (isObj(s.progress)) { h('Progresso'); L.push(`- ${dash(s.progress.basis)}: ${dash(s.progress.done)}${typeof s.progress.total === 'number' ? ` de ${s.progress.total}` : ''}${typeof s.progress.pct === 'number' ? ` (${s.progress.pct}%)` : ''}`); }
    if (isObj(s.cycle)) { h('Ciclo'); L.push(`- **Status:** ${dash(s.cycle.status)}`, `- **Rodada:** ${dash(s.cycle.round)} (limite ${dash(s.cycle.maxIterations)})`); if (s.cycle.blockedCode || s.cycle.blockedReason) L.push(`- **Bloqueio:** ${dash(s.cycle.blockedCode)}: ${dash(s.cycle.blockedReason)}`); }
    if (arr(s.steps).length) { h('Etapas do plano'); for (const x of objs(s.steps)) L.push(`- ${inline(x.id)}: ${inline(x.title)} — ${dash(x.status)}${typeof x.attempts === 'number' ? `, ${x.attempts} tentativa(s)` : ''}`); }
    if (arr(s.rounds).length) { h('Rodadas'); for (const r of objs(s.rounds)) L.push(`- Rodada ${dash(r.n)}: ${inline(r.title) || 'sem título'} — ${dash(r.status)}; verificação: ${dash(r.verification)}; evidência: ${dash(r.evidenceLevel)}`); }
    if (isObj(s.squad)) { h('Squad (Maestro)'); L.push(inline(s.squad.note), ''); for (const t of objs(s.squad.tasks)) L.push(`- ${dash(t.to?.title)} — ${dash(t.status)}: ${inline(t.text)}`); }
    if (arr(s.verifications).length) { h('Verificações'); for (const v of objs(s.verifications)) L.push(`- Rodada ${dash(v.round)}: ${dash(v.script)} — ${dash(v.status)}${typeof v.durationMs === 'number' ? ` (${v.durationMs} ms)` : ''}`); }
    if (arr(s.approvals).length) { h('Aprovações (somente leitura)'); for (const a of objs(s.approvals)) L.push(`- Rodada ${dash(a.round)}: ${inline(a.title) || 'ação'} — ${dash(a.status)}`); }
    if (isObj(s.delivery)) {
      h('Entrega');
      L.push(`- **Código:** ${dash(s.delivery.code)}`, `- **Entregue:** ${s.delivery.delivered === true ? 'sim' : 'não'}`, `- **Garantia:** ${dash(s.delivery.assurance)}`);
      const files = objs(s.delivery.files?.items);
      if (files.length) { L.push('', `Arquivos alterados (${dash(s.delivery.files?.total)} no total; lista parcial):`, ''); for (const f of files) L.push(`- ${inline(f.path)} (${dash(f.status)})`); }
      const lim = arr(s.delivery.limitations);
      if (lim.length) { L.push('', 'Limitações:', ''); for (const x of lim) L.push(`- ${inline(x)}`); }
    }
    const items = objs(s.timeline?.items);
    if (items.length) { h('Linha do tempo'); if (num(s.timeline?.omitted)) L.push(`${s.timeline.omitted} registro(s) mais antigo(s) omitido(s).`, ''); L.push(fenced(items.map((i) => `${mdBase(i.at)}  [${mdBase(i.kind)}]  ${mdBase(i.text)}`).join('\n'))); }
    const rec = objs(s.recent);
    if (rec.length) { h('Atividade recente do agente'); L.push(fenced(rec.map((r) => `[${mdBase(r.kind)}] ${mdBase(r.text)}`).join('\n'))); }
    const nts = arr(s.notes);
    if (nts.length) { h('Observações'); for (const n of nts) L.push(`- ${inline(n)}`); }
    return `${L.join('\n')}\n`;
  } catch {
    return '# Relatório indisponível\n\nNão foi possível gerar o relatório desta missão.\n';
  }
}
