// Modelo de VISÃO das missões v2 (flows). PURO (sem React, sem rede): só organiza e rotula o que /api/flows devolve (contrato em docs/missions-v2-spec.md e, para
// paralelo isolado, integração, retomada e agenda, docs/missions-v2-fatia2.md seções A, B e G). Campo novo ausente (run antigo, modo pasta) = comportamento da fatia 1.
// Nada é simulado: dado ausente vira "não informado" (ou "—" onde cabe um traço). O estado de cada etapa vem do run real; sem run, a etapa está "na fila" e a lista mostra "—/m".
// Testado em server/test/flows-view.test.mjs.

export const NOT_INFORMED = 'não informado';
export const DASH = '—';
export const MAX_STEPS = 12, MAX_TITLE = 120, MAX_TEXT = 2000;

const arr = (v) => (Array.isArray(v) ? v : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// ---------- rótulos ----------
/** Estado de uma etapa do run. `tone` escolhe a cor (idle, work, wait, ok, err, skip, cancel). `waiting` é o destaque "aguardando você". */
export const STEP_STATE_META = Object.freeze({
  pending: { label: 'na fila', tone: 'idle' },
  running: { label: 'trabalhando', tone: 'work' },
  waiting: { label: 'aguardando você', tone: 'wait' },
  completed: { label: 'concluída', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' },
  skipped: { label: 'pulada', tone: 'skip' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
  interrupted: { label: 'interrompida', tone: 'wait' }, // só dentro de run `interrupted` (reinício do servidor); volta com Retomar
});
export const RUN_STATE_META = Object.freeze({
  running: { label: 'em execução', tone: 'work' },
  interrupted: { label: 'interrompida', tone: 'wait' },
  ready_to_integrate: { label: 'pronta para integrar', tone: 'wait' },
  completed: { label: 'concluída', tone: 'ok' },
  failed: { label: 'falhou', tone: 'err' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
  discarded: { label: 'descartada', tone: 'cancel' },
});
/** Runs que ainda ocupam a missão (bloqueiam editar, excluir e iniciar outro; a agenda pula). Espelha ACTIVE_RUN do servidor. */
export const ACTIVE_RUN_STATES = Object.freeze(['running', 'interrupted', 'ready_to_integrate']);
export const isActiveRun = (run) => ACTIVE_RUN_STATES.includes(run?.status);
/**
 * Estado da MISSÃO na lista (derivado do run ativo ou do último). Ordem = prioridade de exibição (quem pede você vem antes).
 * `conflict` vem primeiro: a missão já parou de iniciar etapas e só anda com a sua decisão. Tom `wait` (e não `err`): nada se perdeu e a missão não falhou; é um pedido de
 * ação, como "aguardando você". O vermelho fica reservado para o que já terminou mal.
 */
export const FLOW_STATES = Object.freeze(['conflict', 'waiting', 'interrupted', 'ready_to_integrate', 'running', 'failed', 'idle', 'completed', 'cancelled', 'discarded']);
export const FLOW_STATE_META = Object.freeze({
  conflict: { label: 'conflito na integração', tone: 'wait' },
  waiting: { label: 'aguardando você', tone: 'wait' },
  interrupted: { label: 'interrompida', tone: 'wait' },
  ready_to_integrate: { label: 'pronta para integrar', tone: 'wait' },
  running: { label: 'em execução', tone: 'work' },
  failed: { label: 'falhou', tone: 'err' },
  idle: { label: 'sem execução', tone: 'idle' },
  completed: { label: 'concluída', tone: 'ok' },
  cancelled: { label: 'cancelada', tone: 'cancel' },
  discarded: { label: 'descartada', tone: 'cancel' },
});
/** Estado da integração de uma etapa na branch da missão (modo Git). Ausente = `none` (runs antigos e modo pasta). */
export const STEP_INTEGRATION_META = Object.freeze({
  none: { label: 'sem integração', tone: 'idle' },
  pending: { label: 'aguardando integração', tone: 'idle' },
  integrating: { label: 'integrando', tone: 'work' },
  integrated: { label: 'integrada', tone: 'ok' },
  empty: { label: 'sem alterações para integrar', tone: 'skip' },
  conflict: { label: 'conflito na integração', tone: 'wait' },
  blocked: { label: 'integração bloqueada', tone: 'wait' }, // o motivo (integration.reason) refina o rótulo: ver BLOCKED_REASON_LABEL
  error: { label: 'erro na integração', tone: 'err' },
});
/** Rótulo do bloqueio pela causa que o servidor gravou em `integration.reason`. Bloqueio antigo sem `reason` mas com `files` = guard de configuração. */
export const BLOCKED_REASON_LABEL = Object.freeze({
  project_config_changed: 'integração bloqueada: configuração ou arquivo sensível alterado',
  branch_checked_out: 'integração bloqueada: a branch da missão está em checkout em outra pasta',
});
export const BRANCH_CHECKED_OUT_TEXT = 'A branch da missão está em checkout em outra pasta do repositório; troque a branch daquela pasta e clique em Tentar de novo.';
/** Integração de etapa que trava a missão (não inicia etapas novas) até você tentar de novo ou descartar a etapa. */
export const INTEGRATION_PROBLEM_STATES = Object.freeze(['conflict', 'blocked', 'error']);
export const KIND_LABEL = Object.freeze({ project: 'projeto', automation: 'automação' });
export const PROVIDER_LABEL = Object.freeze({ claude: 'Claude Code', codex: 'Codex CLI' });
export const PROVIDERS = Object.freeze(['claude', 'codex']);
/** Reserva para quando /api/terminals ainda não respondeu: os papéis do servidor (terminals.js). O que vale é a lista real recebida em `roles`. */
export const FALLBACK_ROLES = Object.freeze([
  { id: 'builder', label: 'Construtor' }, { id: 'reviewer', label: 'Revisor' }, { id: 'scout', label: 'Batedor' }, { id: 'maestro', label: 'Maestro' },
]);

/** Papéis que não são de etapa (espelha STEP_ROLES do servidor): o Maestro e o Planejador não recebem tarefas. */
export const NON_STEP_ROLES = Object.freeze(['maestro', 'planner']);
/** Papéis oferecidos no editor de etapas: a lista real do servidor (senão a reserva), sem os que não são de etapa. */
export const stepRoles = (roles) => (arr(roles).length ? arr(roles) : FALLBACK_ROLES).filter((r) => r?.id && !NON_STEP_ROLES.includes(r.id));
export const providerLabel = (id) => PROVIDER_LABEL[id] ?? (id ? String(id) : NOT_INFORMED);
export function roleLabel(id, roles = FALLBACK_ROLES) {
  if (!id) return NOT_INFORMED;
  return arr(roles).find((r) => r?.id === id)?.label ?? FALLBACK_ROLES.find((r) => r.id === id)?.label ?? String(id);
}
export const stepMeta = (state) => STEP_STATE_META[state] ?? { label: state ? String(state) : NOT_INFORMED, tone: 'idle' };
/**
 * Etapa que parou sem report_done (relatório automático): o servidor a deixa `waiting` com `unconfirmed: true` até o agente confirmar ou você decidir. Se o agente voltar a
 * trabalhar ou pedir permissão (`agentBusy`), não é hora de decidir: a etapa aparece como trabalhando/aguardando permissão, como qualquer outra.
 */
export const UNCONFIRMED_META = Object.freeze({ label: 'confirme a conclusão', tone: 'wait' });
/** Etapa sem confirmação cujo terminal termina na mensagem de limite de uso da conta (`stopReason: 'limit'`): o trabalho pode estar pela metade, então a ação é Continuar. */
export const LIMIT_META = Object.freeze({ label: 'parou no limite', tone: 'wait' });
export const MAX_LIMIT_RESETS = 60;
const isUnconfirmed = (rs) => rs?.status === 'waiting' && rs?.unconfirmed === true && rs?.agentBusy !== true;
// run antigo sem `stopReason` (ou motivo desconhecido) = caso genérico
const isLimitStop = (rs) => isUnconfirmed(rs) && rs?.stopReason === 'limit';
// horário de reset como o terminal mostrou (texto do terminal: só exibido como dado); vazio, não-texto ou fora do limite = null
const limitResetsOf = (rs) => (isLimitStop(rs) ? clip(str(rs.limitResets), MAX_LIMIT_RESETS) || null : null);
const unconfirmedMeta = (rs) => (isLimitStop(rs) ? LIMIT_META : UNCONFIRMED_META);
/** Rótulo e cor do estado de uma etapa do run, considerando a etapa que espera a sua confirmação (e a que parou no limite da conta). */
export const runStepMeta = (rs) => (isUnconfirmed(rs) ? unconfirmedMeta(rs) : stepMeta(rs?.status ?? 'pending'));

// ---------- tempo ----------
export function fmtDuration(ms) {
  if (!isNum(ms)) return DASH;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min`;
}
/** Data curta no fuso do usuário ("16/11 14:05"); ausente ou inválida = "não informado". */
export function fmtWhen(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return NOT_INFORMED;
  return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
/** Duração em ms entre início e fim; sem fim, só corre (até `now`) enquanto `live`. Sem início = null. */
export function spanMs(startedAt, finishedAt, live, now = Date.now()) {
  const a = Date.parse(startedAt ?? ''), b = Date.parse(finishedAt ?? '');
  if (!Number.isFinite(a)) return null;
  const stop = Number.isFinite(b) ? b : live ? now : null;
  return stop === null ? null : Math.max(0, stop - a);
}
export const runDuration = (run, now) => (run ? spanMs(run.startedAt, run.finishedAt, run.status === 'running', now) : null);

// ---------- run, estado e progresso ----------
/** O run que a tela mostra: o ativo, senão o último. */
export const currentRun = (flow) => flow?.activeRun ?? flow?.lastRun ?? null;
export const runSteps = (run) => arr(run?.steps);
const runStep = (run, id) => runSteps(run).find((s) => s?.stepId === id) ?? null;

const hasIntegrationProblem = (rs) => INTEGRATION_PROBLEM_STATES.includes(rs?.integration?.state);

/**
 * Estado da missão (sinal real do servidor; sem run = idle). Run `running`: `conflict` (etapa com integração em conflict|blocked|error) > `waiting` (etapa espera você) > `running`.
 * Run `interrupted` mostra `interrupted` mesmo com conflito pendente: as ações de integração exigem o run `running`, então o primeiro passo é Retomar.
 */
export function flowState(flow) {
  const run = currentRun(flow);
  if (!run) return 'idle';
  if (run.status === 'running') {
    const steps = runSteps(run);
    return steps.some(hasIntegrationProblem) ? 'conflict' : steps.some((s) => s?.status === 'waiting') ? 'waiting' : 'running';
  }
  return FLOW_STATE_META[run.status] ? run.status : 'idle';
}

// estados da missão que pedem você (o indicador da barra lateral junta todos em `waiting`, com o motivo no título)
const ASKS_YOU = Object.freeze(['conflict', 'waiting', 'interrupted', 'ready_to_integrate']);

/**
 * Resumo para o indicador de Missões na barra lateral (visível em qualquer página). `state`: waiting (alguma missão pede você: conflito, etapa esperando, interrompida ou pronta
 * para integrar) > working (run ativo) > failed / done (run que terminou depois de `seenAt`, ou seja, enquanto você olhava outra página; some ao abrir Missões) > null (nada a
 * mostrar). `waiting` soma os quatro motivos; o `title` diz cada um. Só estado real de /api/flows.
 */
export function flowsActivity(flows, { seenAt = 0 } = {}) {
  const c = { working: 0, waiting: 0, failed: 0, done: 0 }, ask = { conflict: 0, waiting: 0, interrupted: 0, ready_to_integrate: 0 };
  for (const f of arr(flows)) {
    if (!f || f.archived) continue;
    const st = flowState(f);
    if (st === 'running') c.working++;
    else if (ASKS_YOU.includes(st)) { c.waiting++; ask[st]++; }
    else if ((st === 'failed' || st === 'completed') && ts(currentRun(f)?.finishedAt) > seenAt) c[st === 'failed' ? 'failed' : 'done']++;
  }
  const state = c.waiting ? 'waiting' : c.working ? 'working' : c.failed ? 'failed' : c.done ? 'done' : null;
  const n = (v, one, many) => (v ? [`${v} ${v === 1 ? one : many}`] : []);
  const parts = [
    ...n(ask.conflict, 'missão com conflito na integração', 'missões com conflito na integração'), ...n(ask.waiting, 'missão aguardando você', 'missões aguardando você'),
    ...n(ask.interrupted, 'missão interrompida', 'missões interrompidas'), ...n(ask.ready_to_integrate, 'missão pronta para integrar', 'missões prontas para integrar'),
    ...n(c.working, 'missão em execução', 'missões em execução'), ...n(c.failed, 'missão falhou', 'missões falharam'), ...n(c.done, 'missão concluída', 'missões concluídas'),
  ];
  return { state, count: c.waiting || c.working || c.failed || c.done, ...c, title: parts.join(' · ') };
}

// ---------- ações do run e integração (fatia 2) ----------
/** Runs terminados em que o servidor aceita refazer a limpeza segura das cópias que sobraram (`POST .../cleanup`). */
export const CLEANUP_RUN_STATES = Object.freeze(['completed', 'failed', 'cancelled', 'discarded']);
export const LEFTOVERS_HINT = 'Feche o terminal da etapa (ou resolva o que está pendente na cópia) e clique em Limpar cópias de novo.';
/** Cópias (worktrees) que a limpeza segura não removeu, com o motivo do servidor (ex.: terminal ainda aberto, alterações não integradas). Só modo Git. */
export function leftoverRows(run) {
  const git = run?.git && typeof run.git === 'object' ? run.git : null;
  if (!git || git.mode !== 'git') return [];
  return arr(git.leftovers).filter((l) => l && typeof l === 'object').map((l, i) => ({ key: `${str(l.worktreeId) || 'wt'}-${i}`, worktreeId: str(l.worktreeId) || null, reason: str(l.reason) || 'motivo não informado' }));
}

/**
 * O que a tela pode oferecer para o run atual (o ativo, senão o último: `currentRun`). O servidor confere de novo e pode recusar com 409. Retomar só `interrupted`; Cancelar em
 * `running|interrupted`; Integrar e Descartar em `ready_to_integrate`; Descartar também em `cancelled|failed` de modo Git ainda não descartado; Limpar cópias (rota cleanup) em
 * `completed|failed|cancelled|discarded` de modo Git com `git.leftovers`. `cleanupAction` diz o que o botão "Limpar cópias" chama: `discard` (run cancelado/falho ainda não
 * descartado, sem apagar a branch) tem prioridade; senão `cleanup` (já descartado ou concluído, mas sobraram cópias); senão null.
 */
export function runActions(flow) {
  const run = currentRun(flow), st = run?.status, git = run?.git && typeof run.git === 'object' ? run.git : null;
  const leftovers = leftoverRows(run);
  const canDiscard = st === 'ready_to_integrate' || ((st === 'cancelled' || st === 'failed') && git?.mode === 'git' && !git.discardedAt);
  const canCleanup = CLEANUP_RUN_STATES.includes(st) && git?.mode === 'git' && leftovers.length > 0;
  return {
    runId: run?.id ?? null,
    canResume: st === 'interrupted',
    canCancel: st === 'running' || st === 'interrupted',
    canIntegrate: st === 'ready_to_integrate',
    canDiscard,
    canCleanup,
    cleanupAction: canDiscard && st !== 'ready_to_integrate' ? 'discard' : canCleanup ? 'cleanup' : null,
    leftovers,
  };
}

/**
 * Avisos de Git do run para o cabeçalho, o histórico e a Entrega. `fallback` = motivo de a missão rodar em MODO PASTA (workspace sem Git, HEAD destacado, subpasta do repositório,
 * Git antigo): sem cópia isolada, as etapas editam a pasta do workspace. `rebased` = a missão recomeçou a partir de outra ponta (`git.rebasedFrom`, objeto { branch, commit }
 * ou texto). Ausentes = null (run antigo, modo Git normal).
 */
export function runGitNotes(run) {
  const git = run?.git && typeof run.git === 'object' ? run.git : null;
  if (!git) return { fallback: null, fallbackText: null, rebased: null, rebasedText: null };
  const fallback = git.mode !== 'git' ? clip(str(git.fallbackReason), 300) || null : null;
  const rf = git.rebasedFrom;
  let rebased = null;
  if (rf && typeof rf === 'object') {
    const branch = str(rf.branch) || str(rf.baseBranch) || null, commitShort = shortSha(rf.commit) ?? shortSha(rf.baseCommit) ?? shortSha(rf.tip);
    if (branch || commitShort) rebased = { branch, commitShort };
  } else if (str(rf).trim()) rebased = { branch: null, commitShort: null, raw: clip(rf, 160) };
  const rebasedText = rebased ? `a missão recomeçou a partir de ${rebased.raw ?? `${rebased.branch ?? 'branch não informada'}${rebased.commitShort ? `@${rebased.commitShort}` : ''}`}` : null;
  return { fallback, fallbackText: fallback ? `sem cópia isolada: ${fallback}; as etapas editam a pasta do workspace, uma por vez` : null, rebased, rebasedText };
}

const strList = (v) => arr(v).filter((x) => typeof x === 'string' && x);
const shortSha = (v) => (typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v) ? v.slice(0, 7) : null);

/**
 * Integração FINAL do run na branch do workspace (modo Git), para chips, histórico e o aviso "pronta para integrar". null em runs antigos e no modo pasta.
 * `state`: integrated (feita: `by` auto|user) | pending (esperando você, com `reasons`, `conflicts` e `files`) | none. `branch` = branch da missão; `baseBranch` = onde integra.
 * `needsAck`: configuração executável ou arquivo sensível mudou; Integrar só passa com a sua confirmação explícita.
 */
export function integrationInfo(run) {
  const git = run?.git && typeof run.git === 'object' ? run.git : null;
  if (!git || git.mode !== 'git') return null;
  const done = git.integration && typeof git.integration === 'object' ? git.integration : null, pend = !done && git.pending && typeof git.pending === 'object' ? git.pending : null;
  const by = done?.by === 'auto' || done?.by === 'user' ? done.by : null, mode = done ? str(done.mode) || null : null;
  const reasons = arr(pend?.reasons).filter((r) => r && (r.code || r.message)).map((r) => ({ code: str(r.code) || null, message: str(r.message) || NOT_INFORMED }));
  const label = done ? (mode === 'empty' ? 'nada a integrar (sem alterações)' : mode === 'already' ? 'já estava na branch do workspace' : by === 'auto' ? 'integrada automaticamente' : by === 'user' ? 'integrada por você' : 'integrada')
    : run?.status === 'ready_to_integrate' ? 'pronta para integrar' : null;
  return {
    state: done ? 'integrated' : pend || run?.status === 'ready_to_integrate' ? 'pending' : 'none', label,
    by, byLabel: by === 'auto' ? 'automática' : by === 'user' ? 'por você' : null, mode, at: done?.at ?? null, commitShort: shortSha(done?.to) ?? shortSha(done?.missionTip),
    reasons, conflicts: strList(pend?.conflicts), files: strList(pend?.files), needsAck: reasons.some((r) => r.code === 'project_config_changed'), checkedAt: pend?.checkedAt ?? null,
    branch: str(git.branch) || null, baseBranch: str(git.baseBranch) || null, verification: verificationView(run),
  };
}

/**
 * Envio ao remoto de um run INTEGRADO (modo Git): null antes da integração, em runs sem alterações e no modo pasta. `state`: pushed | pushing | blocked (regra: espera você) |
 * failed | none (ainda não enviado). `canPush`: o botão Enviar agora faz sentido (o servidor confere tudo de novo na prévia).
 */
export const PUSH_STATES = Object.freeze(['pushing', 'pushed', 'blocked', 'failed']);
export function pushInfo(run) {
  const git = run?.git && typeof run.git === 'object' ? run.git : null;
  const integ = git?.integration && typeof git.integration === 'object' ? git.integration : null;
  if (!git || git.mode !== 'git' || run?.status !== 'completed' || !integ || integ.mode === 'empty') return null;
  const p = git.push && typeof git.push === 'object' ? git.push : null, state = PUSH_STATES.includes(p?.state) ? p.state : 'none';
  const branch = str(p?.branch) || null;
  const label = state === 'pushed' ? (branch ? `enviada para ${branch}` : 'enviada ao remoto') : state === 'pushing' ? 'enviando ao remoto…' : state === 'blocked' ? 'envio pendente' : state === 'failed' ? 'envio falhou' : 'não enviada ao remoto';
  const tone = state === 'pushed' ? 'ok' : state === 'pushing' ? 'work' : state === 'failed' ? 'err' : state === 'blocked' ? 'wait' : 'idle';
  return {
    state, label, tone, branch, by: p?.by === 'auto' || p?.by === 'user' ? p.by : null, code: str(p?.code) || null, error: state === 'blocked' || state === 'failed' ? clip(p?.error, 300) || null : null,
    commitShort: shortSha(p?.to), at: p?.at ?? null, commits: arr(p?.commits).filter((c) => c && typeof c.sha === 'string').map((c) => ({ sha: c.sha.slice(0, 12), subject: clip(c.subject, 160) })), more: Number.isInteger(p?.more) ? p.more : 0,
    canPush: state !== 'pushed' && state !== 'pushing', needsYou: state === 'blocked' || state === 'failed',
  };
}

// ---------- comando de verificação (opcional, definido só pelo usuário no formulário) ----------
export const VERIFY_TIMEOUT_MIN = 10, VERIFY_TIMEOUT_MAX = 1800, VERIFY_TIMEOUT_DEFAULT = 300, MAX_VERIFY_TEXT = 1000;
export const VERIFY_SHELL_HINT = 'Sem shell: |, && e > não funcionam (cada parte vira um argumento do programa).';
const SHELL_OP_RE = /^(\|\|?|&&?|;|>>?|<|\d?>&\d|\d>>?)$/;
const strArgs = (v) => arr(v).filter((x) => typeof x === 'string');

/**
 * Separa o texto do comando em argumentos, como uma linha de comando simples: espaço separa; aspas duplas ou simples agrupam (e somem); aspas vazias geram um argumento
 * vazio. Sem escapes nem expansão (barra invertida é literal: caminhos do Windows passam inteiros). Retorna string[] ([] para texto vazio) ou null se uma aspa ficou aberta.
 */
export function tokenizeCommand(text) {
  const out = [];
  let cur = '', inTok = false, quote = null;
  for (const ch of String(text ?? '')) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; inTok = true; continue; }
    if (/\s/.test(ch)) { if (inTok) { out.push(cur); cur = ''; inTok = false; } continue; }
    cur += ch; inTok = true;
  }
  if (quote) return null;
  if (inTok) out.push(cur);
  return out;
}

/** Um argumento como texto que `tokenizeCommand` lê de volta igual (usado para mostrar o comando e no rascunho de edição). */
export function quoteArg(arg) {
  const a = String(arg ?? '');
  if (a && !/[\s"']/.test(a)) return a;
  if (!a.includes('"')) return `"${a}"`;
  if (!a.includes("'")) return `'${a}'`;
  return a.split('"').map((p) => `"${p}"`).join(`'"'`);
}
export const argsToText = (args) => strArgs(args).map(quoteArg).join(' ');

const verifyTimeoutOf = (v) => { const t = Number(v); return Number.isInteger(t) && t >= VERIFY_TIMEOUT_MIN && t <= VERIFY_TIMEOUT_MAX ? t : VERIFY_TIMEOUT_DEFAULT; };
/** Rascunho do comando de verificação: texto e tempo limite (s). Missão sem comando = texto vazio e o tempo padrão. */
export function verifyToDraft(vc) {
  const args = vc && typeof vc === 'object' ? strArgs(vc.args) : [];
  return { verifyText: args.length ? argsToText(args) : '', verifyTimeout: verifyTimeoutOf(vc?.timeoutSec) };
}

/** `flow.verifyCommand` a partir do rascunho: texto vazio (ou só espaços) = null; senão { args, timeoutSec }. Aspa aberta = null (a validação já barra o envio). */
export function draftToVerify(draft) {
  const args = tokenizeCommand(str(draft?.verifyText));
  if (!args || !args.length) return null;
  return { args, timeoutSec: verifyTimeoutOf(draft?.verifyTimeout) };
}

/** Erros do comando de verificação (mesmo formato de validateDraft). Texto vazio não confere nada: o comando é opcional. */
export function validateVerifyDraft(draft) {
  const errors = [], text = str(draft?.verifyText);
  if (!text.trim()) return errors;
  const args = tokenizeCommand(text);
  if (text.length > MAX_VERIFY_TEXT) errors.push({ field: 'verifyText', message: `O comando passa de ${MAX_VERIFY_TEXT} caracteres.` });
  else if (!args) errors.push({ field: 'verifyText', message: 'Feche as aspas do comando de verificação.' });
  else if (!args[0]) errors.push({ field: 'verifyText', message: 'O comando de verificação começa pelo programa a rodar (ex.: npm).' });
  const t = draft?.verifyTimeout, n = Number(t);
  if (t === '' || t == null || !Number.isInteger(n) || n < VERIFY_TIMEOUT_MIN || n > VERIFY_TIMEOUT_MAX) {
    errors.push({ field: 'verifyTimeout', message: `O tempo limite vai de ${VERIFY_TIMEOUT_MIN} a ${VERIFY_TIMEOUT_MAX} segundos.` });
  }
  return errors;
}

/** Operadores de shell digitados no comando (iriam como argumentos literais, não como shell). Só para avisar; não bloqueia. */
export function verifyShellOps(text) {
  const args = tokenizeCommand(text);
  return args ? [...new Set(args.filter((a) => SHELL_OP_RE.test(a)))] : [];
}

export const VERIFY_STATUS_META = Object.freeze({
  pass: { label: 'passou', tone: 'ok' },
  fail: { label: 'falhou', tone: 'err' },
  timeout: { label: 'tempo esgotado', tone: 'err' },
  error: { label: 'erro ao rodar', tone: 'err' },
});
// ANSI (cores, cursor, títulos) e controles que não sejam quebra de linha ou tab: a saída aparece como texto puro e legível
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const cleanOutput = (v) => str(v).replace(ANSI_RE, '').replace(/\r\n?/g, '\n').replace(CTRL_RE, '');

/**
 * Resultado da verificação antes da integração final (`run.git.verification`), para a tela. null se não houve verificação. Texto puro (o React escapa; nada vira HTML).
 * `failed` = não passou (falhou, tempo esgotado, erro ou status desconhecido): a missão fica pronta para integrar e a decisão é sua (Integrar continua disponível).
 */
export function verificationView(run) {
  const git = run?.git && typeof run.git === 'object' ? run.git : null;
  const v = git?.verification && typeof git.verification === 'object' ? git.verification : null;
  if (!v) return null;
  const status = Object.hasOwn(VERIFY_STATUS_META, v.status) ? v.status : null;
  const meta = status ? VERIFY_STATUS_META[status] : { label: NOT_INFORMED, tone: 'idle' };
  const command = Array.isArray(v.command) ? argsToText(v.command) : str(v.command).trim();
  const exitCode = Number.isInteger(v.exitCode) ? v.exitCode : null, durationMs = isNum(v.durationMs) && v.durationMs >= 0 ? v.durationMs : null;
  const decide = 'a missão não foi integrada automaticamente. Integrar continua disponível se você decidir seguir.';
  const message = status === 'pass' ? 'A verificação passou.'
    : status === 'fail' ? `A verificação falhou${exitCode !== null ? ` (código de saída ${exitCode})` : ''}: ${decide}`
      : status === 'timeout' ? `A verificação passou do tempo limite e foi encerrada: ${decide}`
        : status === 'error' ? `Não foi possível rodar o comando de verificação (programa não encontrado ou erro ao iniciar): ${decide}`
          : 'O resultado da verificação não foi reconhecido; confira a branch da missão antes de integrar.';
  return {
    status, label: meta.label, tone: meta.tone, failed: status !== 'pass', message, command: command || NOT_INFORMED, exitCode, durationMs,
    output: cleanOutput(v.outputTail), truncated: v.truncated === true, at: v.at ?? null,
  };
}

/**
 * Integração de UMA etapa na branch da missão. Estado ausente = `none`. `needsAction` = trava a missão (Tentar de novo / Descartar etapa). `reason` = causa gravada pelo servidor.
 * `needsAck` = bloqueada pelo guard de configuração: só com `state === 'blocked'` e (`reason === 'project_config_changed'` ou, em bloqueio antigo sem `reason`, lista de arquivos
 * não vazia). Outras causas (ex.: `branch_checked_out`) NÃO pedem confirmação: o Tentar de novo vai sem ack. `message` = o que aconteceu, para a tela (texto puro).
 */
export function stepIntegration(rs) {
  const i = rs?.integration && typeof rs.integration === 'object' ? rs.integration : null, state = str(i?.state) || 'none';
  const reason = str(i?.reason) || null, files = strList(i?.files), error = str(i?.error) || null;
  const needsAck = state === 'blocked' && (reason === 'project_config_changed' || (!reason && files.length > 0));
  const meta = STEP_INTEGRATION_META[state] ?? { label: state, tone: 'idle' };
  const label = state === 'blocked' ? (needsAck ? BLOCKED_REASON_LABEL.project_config_changed : BLOCKED_REASON_LABEL[reason] ?? meta.label) : meta.label;
  const message = state === 'conflict' ? 'A integração na branch da missão deu conflito; as etapas novas só começam depois que você resolver.'
    : state === 'blocked' ? (needsAck ? 'A etapa alterou configuração executável ou arquivo sensível. Integrar exige a sua confirmação explícita.'
      : reason === 'branch_checked_out' ? BRANCH_CHECKED_OUT_TEXT : `A integração foi bloqueada${error ? `: ${error}` : '.'}`)
      : state === 'error' ? `A integração falhou${error ? `: ${error}` : '.'}` : null;
  return { state, label, tone: meta.tone, reason, message, conflicts: strList(i?.conflicts), files, error, at: i?.at ?? null, needsAction: INTEGRATION_PROBLEM_STATES.includes(state), needsAck };
}

/** Etapas do run ATIVO (`running`) cuja integração trava a missão, para o aviso no topo. `worktreePath` só quando o servidor o mandou (só vem na etapa com conflito). */
export function integrationProblems(flow) {
  const run = flow?.activeRun ?? null;
  if (!run || run.status !== 'running') return [];
  const defs = new Map(arr(flow.steps).map((s) => [s.id, s]));
  return runSteps(run).filter(hasIntegrationProblem).map((s) => ({ stepId: s.stepId, runId: run.id ?? null, title: defs.get(s.stepId)?.title ?? s.stepId, ...stepIntegration(s), branch: str(s.branch) || null, worktreePath: str(s.worktreePath) || null, terminalId: s.terminalId ?? null }));
}

// ---------- agenda (automações) ----------
export const WEEKDAY_SHORT = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);
export const SCHEDULE_KINDS = Object.freeze(['interval', 'daily', 'weekly']);
export const MAX_EVERY_HOURS = 168;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayList = (v) => [...new Set(arr(v).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);

/** "a cada 4 h", "diário às 09:00", "seg, qua às 08:30"; desligada = "desligada"; sem agenda (null) = "sem agenda"; formato desconhecido = "não informado". */
export function scheduleLabel(schedule) {
  if (schedule === null || schedule === undefined) return 'sem agenda';
  if (typeof schedule !== 'object') return NOT_INFORMED;
  if (schedule.enabled === false) return 'desligada';
  if (schedule.kind === 'interval' && Number.isInteger(schedule.everyHours) && schedule.everyHours >= 1) return `a cada ${schedule.everyHours} h`;
  if (schedule.kind === 'daily' && TIME_RE.test(str(schedule.time))) return `diário às ${schedule.time}`;
  if (schedule.kind === 'weekly' && TIME_RE.test(str(schedule.time)) && dayList(schedule.days).length) return `${dayList(schedule.days).map((d) => WEEKDAY_SHORT[d]).join(', ')} às ${schedule.time}`;
  return NOT_INFORMED;
}
/** Próxima execução da agenda em data curta local ("19/11 14:00"); ausente ou inválida = "—". */
export const nextRunLabel = (nextRunAt) => (Number.isFinite(Date.parse(nextRunAt ?? '')) ? fmtWhen(nextRunAt) : DASH);

export const SKIP_REASON_LABEL = Object.freeze({
  missed: 'horário perdido (o FORGE estava fechado ou o servidor fora do ar)',
  active_run: 'pulada: a execução anterior ainda estava ativa',
  start_failed: 'não foi possível iniciar a execução',
  limit: 'pulada: limite de automações rodando ao mesmo tempo',
  archived: 'pulada: a missão está arquivada',
  workspace_missing: 'pulada: o workspace não existe mais',
});
/** Pulos da agenda (`flow.scheduleSkips`, os últimos do servidor), do mais recente para o mais antigo. `count` > 1 = vários horários perdidos de uma vez. */
export function skipRows(flow) {
  return arr(flow?.scheduleSkips).filter((s) => s && typeof s === 'object').map((s, i) => {
    const reason = str(s.reason) || null, count = Number.isInteger(s.count) && s.count > 1 ? s.count : null;
    return { key: `${s.slotAt ?? s.at ?? ''}-${reason ?? ''}-${i}`, reason, label: SKIP_REASON_LABEL[reason] ?? (reason || NOT_INFORMED), message: str(s.message) || null, count,
      countLabel: count ? `${count} horários` : null, slotAt: s.slotAt ?? null, at: s.at ?? null, when: fmtWhen(s.slotAt ?? s.at) };
  }).sort((a, b) => ts(b.slotAt ?? b.at) - ts(a.slotAt ?? a.at));
}

/** Rascunho da agenda no formulário: guarda os campos de todos os presets para trocar de preset sem perder o que foi digitado. */
export function emptySchedule() {
  return { enabled: true, kind: 'daily', everyHours: 4, time: '09:00', days: [1, 2, 3, 4, 5] };
}
export function scheduleToDraft(schedule) {
  const d = emptySchedule();
  if (!schedule || typeof schedule !== 'object') return d;
  return {
    enabled: schedule.enabled === true, kind: SCHEDULE_KINDS.includes(schedule.kind) ? schedule.kind : d.kind,
    everyHours: Number.isInteger(schedule.everyHours) ? schedule.everyHours : d.everyHours, time: TIME_RE.test(str(schedule.time)) ? schedule.time : d.time,
    days: dayList(schedule.days).length ? dayList(schedule.days) : d.days,
  };
}
/** Marca/desmarca um dia da semana (0 = domingo) no rascunho da agenda. */
export function toggleScheduleDay(sd, day) {
  const days = arr(sd?.days);
  return { ...sd, days: days.includes(day) ? days.filter((d) => d !== day) : dayList([...days, day]) };
}
/** Mesmas regras do servidor: intervalo inteiro de 1 a 168 h; horário HH:MM; semanal com ao menos um dia de 0 a 6. { ok, errors: [{ field, message }] } */
export function validateScheduleDraft(sd) {
  const errors = [], add = (field, message) => errors.push({ field, message });
  const kind = sd?.kind;
  if (!SCHEDULE_KINDS.includes(kind)) add('schedule.kind', 'Escolha a frequência da agenda.');
  if (kind === 'interval') {
    const h = Number(sd?.everyHours);
    if (sd?.everyHours === '' || sd?.everyHours === null || !Number.isInteger(h) || h < 1 || h > MAX_EVERY_HOURS) add('schedule.everyHours', `O intervalo vai de 1 a ${MAX_EVERY_HOURS} horas (número inteiro).`);
  }
  if ((kind === 'daily' || kind === 'weekly') && !TIME_RE.test(str(sd?.time))) add('schedule.time', 'Informe o horário no formato HH:MM (00:00 a 23:59).');
  if (kind === 'weekly') {
    const raw = arr(sd?.days);
    if (!raw.length) add('schedule.days', 'Escolha ao menos um dia da semana.');
    else if (raw.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) add('schedule.days', 'Dia da semana inválido.');
  }
  return { ok: errors.length === 0, errors };
}
/** Rascunho → `schedule` da API, só com os campos do preset escolhido. `enabled` só `true` se marcado (booleano estrito). */
export function draftToSchedule(sd) {
  const enabled = sd?.enabled === true;
  if (sd?.kind === 'interval') return { enabled, kind: 'interval', everyHours: Number(sd.everyHours) };
  if (sd?.kind === 'weekly') return { enabled, kind: 'weekly', days: dayList(sd.days), time: str(sd.time) };
  return { enabled, kind: 'daily', time: str(sd?.time) };
}

/** { done, total, pct, label, hasRun }. `total` = etapas da definição; `done` = etapas `completed` do run. Sem run: done/pct nulos e label "—/m". */
export function flowProgress(flow, run = currentRun(flow)) {
  const total = arr(flow?.steps).length || runSteps(run).length;
  if (!total) return { done: null, total: 0, pct: null, label: NOT_INFORMED, hasRun: !!run };
  if (!run) return { done: null, total, pct: null, label: `${DASH}/${total}`, hasRun: false };
  const done = runSteps(run).filter((s) => s?.status === 'completed').length;
  return { done, total, pct: Math.round((done / total) * 100), label: `${done}/${total}`, hasRun: true };
}

/**
 * Etapas esperando o usuário no run ativo (para o aviso no topo e o atalho de abrir o terminal). `unconfirmed` = o agente parou sem confirmar (decida: aceitar, continuar
 * ou recusar); senão, o agente pediu uma permissão no terminal. `limit` = parou no limite de uso da conta (a ação natural é Continuar), com `limitResets` (texto curto do
 * terminal ou null). `runId` vai junto para a decisão.
 */
export function waitingSteps(flow) {
  const run = flow?.activeRun ?? null;
  if (!run || run.status !== 'running') return [];
  const defs = new Map(arr(flow.steps).map((s) => [s.id, s]));
  return runSteps(run).filter((s) => s?.status === 'waiting').map((s) => ({
    stepId: s.stepId, runId: run.id ?? null, title: defs.get(s.stepId)?.title ?? s.stepId, terminalId: s.terminalId ?? null, startedAt: s.startedAt ?? null,
    unconfirmed: isUnconfirmed(s), summary: isUnconfirmed(s) ? s.summary ?? null : null, limit: isLimitStop(s), limitResets: limitResetsOf(s),
    // "Continuar" que não conseguiu reabrir o terminal: a etapa volta a esperar você com o motivo do servidor
    error: isUnconfirmed(s) && typeof s.error === 'string' && s.error.trim() ? clip(s.error, 300) : null,
  }));
}

// ---------- lista ----------
const ts = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : 0; };
const wsNameOf = (flow, workspaces) => str(flow?.workspaceName).trim() || arr(workspaces).find((w) => w?.id === flow?.workspaceId)?.displayName || arr(workspaces).find((w) => w?.id === flow?.workspaceId)?.name || null;

/** Linhas da lista já ordenadas (quem pede você primeiro, depois recência). Arquivadas ficam de fora. */
export function flowRows(flows, { workspaces = [], query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return arr(flows).filter((f) => f?.id && !f.archived).map((flow) => {
    const state = flowState(flow);
    return { flow, id: flow.id, state, meta: FLOW_STATE_META[state], progress: flowProgress(flow), workspace: wsNameOf(flow, workspaces), kind: KIND_LABEL[flow.kind] ?? NOT_INFORMED };
  }).filter((r) => !q || `${r.flow.title ?? ''} ${r.workspace ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => FLOW_STATES.indexOf(a.state) - FLOW_STATES.indexOf(b.state) || ts(b.flow.updatedAt ?? b.flow.createdAt) - ts(a.flow.updatedAt ?? a.flow.createdAt));
}
/** Lista agrupada por workspace (grupos por nome; dentro, a ordem de `flowRows`). */
export function groupFlows(flows, opts = {}) {
  const groups = new Map();
  for (const r of flowRows(flows, opts)) {
    const key = r.flow.workspaceId ?? '';
    if (!groups.has(key)) groups.set(key, { key, name: r.workspace ?? 'sem workspace', items: [] });
    groups.get(key).items.push(r);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
/** Missão a abrir quando nada está selecionado: a primeira da ordem de prioridade (aguardando você > em execução > ...). */
export const pickFlowId = (flows, opts) => flowRows(flows, opts)[0]?.id ?? null;

// ---------- workflow ----------
function depths(steps) {
  const by = new Map(steps.map((s) => [s.id, s])), memo = new Map(), busy = new Set();
  const depth = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (busy.has(id)) return 0; // ciclo (o servidor recusa; aqui só não trava)
    busy.add(id);
    const ds = arr(by.get(id)?.dependsOn).filter((d) => by.has(d) && d !== id);
    const v = ds.length ? 1 + Math.max(...ds.map(depth)) : 0;
    busy.delete(id); memo.set(id, v);
    return v;
  };
  return new Map(steps.map((s) => [s.id, depth(s.id)]));
}
const firstLine = (t) => clip(String(t ?? '').split('\n').find((l) => l.trim()) ?? '', 90);

function nodeLine(def, st) {
  switch (st.state) {
    case 'running': return { line: firstLine(def.prompt) || null, lineKind: 'task' };
    case 'waiting': return {
      line: st.limit ? `parou no limite da conta${st.limitResets ? ` (reseta ${st.limitResets})` : ''}: clique em Continuar`
        : st.unconfirmed ? 'o agente parou sem confirmar que terminou: confira e decida' : 'o agente espera a sua resposta no terminal',
      lineKind: 'wait',
    };
    case 'completed': return st.summary ? { line: clip(st.summary, 110), lineKind: 'summary' } : { line: 'sem resumo informado', lineKind: 'note' };
    case 'failed': return { line: clip(st.error, 110) || 'falhou sem motivo informado', lineKind: 'error' };
    case 'skipped': return { line: 'pulada: uma etapa da qual depende falhou', lineKind: 'note' };
    case 'cancelled': return { line: 'cancelada junto com a missão', lineKind: 'note' };
    case 'interrupted': return { line: 'interrompida pelo reinício do servidor: clique em Retomar', lineKind: 'wait' };
    default: return { line: null, lineKind: null };
  }
}

/** Estado do nó de Entrega: o do run terminado; `ready_to_integrate` e `discarded` (fatia 2) com rótulo do run; ativo/sem run = na fila. */
function deliveryState(run) {
  const s = run?.status, info = integrationInfo(run), meta = (k) => STEP_STATE_META[k] ?? RUN_STATE_META[k];
  const pick = (state, line) => ({ state, label: meta(state).label, tone: meta(state).tone, line });
  if (!run) return pick('pending', null);
  if (s === 'completed') {
    const p = pushInfo(run), sent = p && p.state !== 'none' ? ` · ${p.label}` : ''; // o envio ao remoto, quando houve tentativa
    if (info?.state === 'integrated' && info.mode !== 'empty') return pick('completed', `${info.baseBranch ? `integrada em ${info.baseBranch}` : 'integrada na branch do workspace'}${sent}`);
    return pick('completed', 'todas as etapas concluídas');
  }
  if (s === 'ready_to_integrate') return pick('ready_to_integrate', info?.baseBranch ? `pronta para integrar em ${info.baseBranch}` : 'pronta para integrar');
  if (s === 'failed') return pick('failed', 'o run terminou com falha');
  if (s === 'cancelled') return pick('cancelled', 'o run foi cancelado');
  if (s === 'discarded') return pick('discarded', 'o run foi descartado: nada entrou na branch do workspace');
  return pick('pending', null);
}

/**
 * Nós e arestas do workflow. Coluna = profundidade na cadeia de dependências (ramos paralelos ficam na mesma coluna); linha = ordem da definição.
 * O último nó é a ENTREGA, ligada às etapas finais (as que ninguém espera). Estado de cada nó = o do run (sem run, tudo `pending`).
 */
export function buildWorkflow(flow, run = currentRun(flow), { roles = FALLBACK_ROLES } = {}) {
  const steps = arr(flow?.steps).filter((s) => s?.id);
  if (!steps.length) return { nodes: [], edges: [], columns: [], hasRun: !!run };
  const depth = depths(steps), ids = new Set(steps.map((s) => s.id)), rowIn = new Map();
  const nodes = steps.map((def) => {
    const col = depth.get(def.id) ?? 0, row = rowIn.get(col) ?? 0; rowIn.set(col, row + 1);
    const rs = runStep(run, def.id), state = rs?.status && STEP_STATE_META[rs.status] ? rs.status : 'pending', meta = isUnconfirmed(rs) ? unconfirmedMeta(rs) : STEP_STATE_META[state];
    const st = { state, summary: rs?.summary, error: rs?.error, unconfirmed: isUnconfirmed(rs), limit: isLimitStop(rs), limitResets: limitResetsOf(rs) };
    return {
      id: def.id, kind: 'step', col, row, title: str(def.title) || def.id, state, stateLabel: meta.label, tone: meta.tone, waiting: state === 'waiting', unconfirmed: st.unconfirmed, limit: st.limit,
      agent: { provider: def.provider ?? null, providerLabel: providerLabel(def.provider), role: def.role ?? null, roleLabel: roleLabel(def.role, roles), model: def.model || null, effort: def.effort || null },
      terminalId: rs?.terminalId ?? null, ...nodeLine(def, st), integration: stepIntegration(rs),
    };
  });
  const stateOf = new Map(nodes.map((n) => [n.id, n.state]));
  const edges = [];
  for (const def of steps) {
    for (const from of arr(def.dependsOn).filter((d) => ids.has(d) && d !== def.id)) {
      const a = stateOf.get(from), b = stateOf.get(def.id);
      const state = b === 'running' ? 'active' : b === 'waiting' || b === 'interrupted' ? 'wait' : a === 'completed' ? 'done' : a === 'failed' ? 'err' : 'idle';
      edges.push({ id: `${from}->${def.id}`, from, to: def.id, state, reuse: def.continueFrom === from });
    }
  }
  const needed = new Set(steps.flatMap((s) => arr(s.dependsOn)));
  const leaves = nodes.filter((n) => !needed.has(n.id));
  const d = deliveryState(run);
  nodes.push({ id: 'delivery', kind: 'delivery', col: Math.max(...nodes.map((n) => n.col)) + 1, row: 0, title: 'Entrega', state: d.state, stateLabel: d.label, tone: d.tone, waiting: false, agent: null, terminalId: null, line: d.line, lineKind: d.line ? 'note' : null, integration: integrationInfo(run) });
  for (const l of leaves) edges.push({ id: `${l.id}->delivery`, from: l.id, to: 'delivery', state: l.state === 'completed' ? 'done' : l.state === 'failed' ? 'err' : 'idle', reuse: false });
  return { nodes, edges, columns: workflowColumns(nodes), hasRun: !!run };
}

/**
 * Conector do workflow de CIMA PARA BAIXO: sai do centro da base do nó de origem (x1, y1), desce até a linha `my` (o corredor entre as fases), anda na horizontal
 * e desce até o topo do nó de destino (x2, y2). Cantos arredondados de raio até `r`; no mesmo eixo vira uma reta vertical.
 */
export function edgePathDown(x1, y1, x2, y2, my, r = 6) {
  const dx = x2 - x1;
  if (Math.abs(dx) < 1) return `M ${x1} ${y1} V ${y2}`;
  const k = Math.min(r, Math.abs(dx) / 2, Math.max(0, (my - y1) / 2), Math.max(0, (y2 - my))), s = Math.sign(dx);
  return `M ${x1} ${y1} V ${my - k} Q ${x1} ${my} ${x1 + s * k} ${my} H ${x2 - s * k} Q ${x2} ${my} ${x2} ${my + k} V ${y2}`;
}

/** Colunas (fases) para desenhar: cada uma com seus nós, quantas etapas paralelas há e quantas trabalham/esperam agora. */
export function workflowColumns(nodes) {
  const by = new Map();
  for (const n of arr(nodes)) { const l = by.get(n.col) ?? []; l.push(n); by.set(n.col, l); }
  let phase = 0;
  return [...by.keys()].sort((a, b) => a - b).map((col, i) => {
    const list = by.get(col).slice().sort((a, b) => a.row - b.row), steps = list.filter((n) => n.kind === 'step');
    return { col, index: i + 1, label: steps.length ? `Fase ${++phase}` : 'Entrega', list, parallel: steps.length, live: steps.filter((n) => n.state === 'running' || n.state === 'waiting').length };
  });
}

// ---------- detalhe do nó (painel lateral) ----------
export function nodeDetail(flow, run, nodeId, { now = Date.now(), roles = FALLBACK_ROLES } = {}) {
  const steps = arr(flow?.steps);
  if (nodeId === 'delivery') {
    if (!steps.length) return null;
    const rs = runSteps(run), count = (s) => rs.filter((x) => x?.status === s).length;
    const wf = buildWorkflow(flow, run, { roles }), n = wf.nodes.find((x) => x.id === 'delivery');
    const defs = new Map(steps.map((s) => [s.id, s]));
    return {
      kind: 'delivery', id: 'delivery', title: 'Entrega', state: n.state, stateLabel: n.stateLabel, tone: n.tone, hasRun: !!run,
      counts: { total: steps.length, completed: count('completed'), failed: count('failed'), skipped: count('skipped'), cancelled: count('cancelled') },
      failures: rs.filter((x) => x?.status === 'failed').map((x) => ({ id: x.stepId, title: defs.get(x.stepId)?.title ?? x.stepId, error: x.error ?? null })),
      startedAt: run?.startedAt ?? null, finishedAt: run?.finishedAt ?? null, durationMs: runDuration(run, now), runStatus: run?.status ?? null,
      line: n.line, integration: integrationInfo(run), push: pushInfo(run), runId: run?.id ?? null, gitNotes: runGitNotes(run), leftovers: leftoverRows(run),
    };
  }
  const def = steps.find((s) => s.id === nodeId);
  if (!def) return null;
  const rs = runStep(run, nodeId), state = rs?.status && STEP_STATE_META[rs.status] ? rs.status : 'pending', unconfirmed = isUnconfirmed(rs), meta = unconfirmed ? unconfirmedMeta(rs) : STEP_STATE_META[state];
  const title = (id) => steps.find((s) => s.id === id)?.title ?? id;
  const live = state === 'running' || state === 'waiting';
  return {
    kind: 'step', id: def.id, title: str(def.title) || def.id, state, stateLabel: meta.label, tone: meta.tone, hasRun: !!run,
    runId: run?.id ?? null, unconfirmed, canDecide: unconfirmed && run?.status === 'running', limit: isLimitStop(rs), limitResets: limitResetsOf(rs),
    completedBy: rs?.completedBy === 'user' || rs?.completedBy === 'agent' ? rs.completedBy : null, decidedAt: rs?.decidedAt ?? null,
    agent: { providerLabel: providerLabel(def.provider), roleLabel: roleLabel(def.role, roles), model: def.model || null, effort: def.effort || null },
    prompt: str(def.prompt) || null,
    dependsOn: arr(def.dependsOn).map((id) => ({ id, title: title(id) })),
    continueFrom: def.continueFrom ? { id: def.continueFrom, title: title(def.continueFrom) } : null,
    summary: rs?.summary ?? null, error: rs?.error ?? null,
    startedAt: rs?.startedAt ?? null, finishedAt: rs?.finishedAt ?? null, durationMs: rs ? spanMs(rs.startedAt, rs.finishedAt, live, now) : null,
    terminalId: rs?.terminalId ?? null, taskId: rs?.taskId ?? null,
    canOpenTerminal: !!rs?.terminalId, terminalLive: live,
    terminalHint: !rs?.terminalId ? 'Esta etapa ainda não abriu um terminal.' : live ? null : state === 'interrupted' ? 'O servidor reiniciou durante a etapa; clique em Retomar para continuar.' : 'A etapa terminou; o terminal pode já ter sido encerrado.',
    // modo Git (fatia 2): ausentes em runs antigos e no modo pasta. O caminho do worktree só vem do servidor na etapa com conflito; nunca é montado aqui.
    branch: str(rs?.branch) || null, worktreeId: str(rs?.worktreeId) || null, integration: stepIntegration(rs),
    ...(str(rs?.worktreePath) ? { worktreePath: rs.worktreePath } : {}),
    canResolveIntegration: run?.status === 'running' && hasIntegrationProblem(rs),
  };
}

// ---------- histórico de runs ----------
export function historyRows(runs, flow, { now = Date.now() } = {}) {
  return arr(runs).filter((r) => r?.id).map((run) => {
    const meta = RUN_STATE_META[run.status] ?? { label: run.status ? String(run.status) : NOT_INFORMED, tone: 'idle' };
    const p = flowProgress(flow, run), failed = runSteps(run).find((s) => s?.status === 'failed');
    const info = integrationInfo(run), notes = runGitNotes(run), git = run.git && typeof run.git === 'object' ? run.git : null;
    return {
      id: run.id, status: run.status, label: meta.label, tone: meta.tone, startedAt: run.startedAt ?? null, durationMs: runDuration(run, now), progress: p.label, reason: failed ? clip(failed.error, 140) || null : null,
      trigger: run.trigger === 'schedule' ? 'agenda' : 'manual', // run antigo sem `trigger` foi iniciado à mão
      integration: info && info.state !== 'none' ? { state: info.state, label: info.label, by: info.by, mode: info.mode, at: info.at, commitShort: info.commitShort } : null,
      // onde as etapas trabalharam: cópia isolada (Git), pasta do workspace (com o motivo) ou não informado (run antigo / ainda sondando)
      copy: git?.mode === 'git' ? 'cópia isolada (Git)' : notes.fallback ? `pasta do workspace: ${notes.fallback}` : git?.mode === 'folder' ? 'pasta do workspace' : null,
      fallback: notes.fallback, rebasedText: notes.rebasedText,
    };
  });
}

// ---------- falhas de rede / rota ----------
/** Mensagem clara para a tela. `ctx`: 'list' (a lista inteira) ou 'item' (uma missão). Servidor antigo sem as rotas responde 404. */
export function describeFailure(err, ctx = 'list') {
  const status = err?.status;
  if (status === undefined || status === null) return { kind: 'offline', message: 'Não foi possível falar com o servidor do FORGE. Confira se ele está rodando; o último estado conhecido continua na tela.' };
  if (status === 404 && ctx === 'list') return { kind: 'unavailable', message: 'As missões novas ainda não existem neste servidor (a rota /api/flows não foi encontrada). Atualize o FORGE e reinicie o servidor.' };
  if (status === 404) return { kind: 'notfound', message: 'Missão não encontrada. Ela pode ter sido removida; a lista será atualizada.' };
  if (status === 409) return { kind: 'conflict', message: err?.message || 'Ação recusada: já existe uma execução ativa.' };
  return { kind: 'error', message: err?.message || `Erro ${status}` };
}

// ---------- rascunho do formulário "Nova missão" ----------
/** Etapa do editor. `key` é local (estável na edição); os ids s1..sN só nascem em `draftToBody`. */
const blankStep = (key, deps = []) => ({ key, title: '', prompt: '', provider: 'claude', role: 'builder', model: '', effort: '', dependsOn: deps, continueFrom: '' });
/** `kind`: 'project' | 'automation' (só automação leva agenda). `autoIntegrate` nasce ligado (padrão do servidor); `schedule` é o rascunho de `emptySchedule()`. */
export function emptyDraft({ workspaceId = '', kind = 'project' } = {}) {
  return { workspaceId, kind: kind === 'automation' ? 'automation' : 'project', title: '', goal: '', fullAccess: false, maxParallel: 1, autoIntegrate: true, autoPush: false, schedule: emptySchedule(), ...verifyToDraft(null), steps: [blankStep('k1')], nextKey: 2 };
}
/** Nova etapa ao fim; por padrão depende da anterior (sequência), e o usuário desmarca para criar um ramo paralelo. */
export function addStep(draft) {
  if (draft.steps.length >= MAX_STEPS) return draft;
  const last = draft.steps.at(-1);
  return { ...draft, steps: [...draft.steps, blankStep(`k${draft.nextKey}`, last ? [last.key] : [])], nextKey: draft.nextKey + 1 };
}
/** Remove a etapa e limpa as referências a ela (dependências e "continuar do terminal de"). Nunca deixa o rascunho sem etapas. */
export function removeStep(draft, key) {
  if (draft.steps.length <= 1) return draft;
  return { ...draft, steps: draft.steps.filter((s) => s.key !== key).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== key), continueFrom: s.continueFrom === key ? '' : s.continueFrom })) };
}
export const patchStep = (draft, key, patch) => ({ ...draft, steps: draft.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
/** Chaves de todas as etapas das quais `key` depende, direta ou indiretamente (a cadeia onde "continuar do terminal de" pode apontar). */
export function ancestorKeys(draft, key) {
  const by = new Map(draft.steps.map((s) => [s.key, s])), out = new Set(), stack = [...(by.get(key)?.dependsOn ?? [])];
  while (stack.length) { const k = stack.pop(); if (out.has(k) || !by.has(k)) continue; out.add(k); stack.push(...by.get(k).dependsOn); }
  return out;
}
/** Marca/desmarca uma dependência; se a cadeia deixar de conter o `continueFrom`, ele é limpo. */
export function toggleDependency(draft, key, depKey) {
  const s = draft.steps.find((x) => x.key === key);
  if (!s || depKey === key) return draft;
  const deps = s.dependsOn.includes(depKey) ? s.dependsOn.filter((d) => d !== depKey) : [...s.dependsOn, depKey];
  let next = patchStep(draft, key, { dependsOn: deps });
  // quem depende desta etapa também pode perder o ancestral do `continueFrom`
  next = { ...next, steps: next.steps.map((x) => (x.continueFrom && !ancestorKeys(next, x.key).has(x.continueFrom) ? { ...x, continueFrom: '' } : x)) };
  return next;
}
export function flowToDraft(flow) {
  const steps = arr(flow?.steps), keyOf = new Map(steps.map((s, i) => [s.id, `k${i + 1}`]));
  return {
    workspaceId: flow?.workspaceId ?? '', title: str(flow?.title), goal: str(flow?.goal), fullAccess: flow?.fullAccess === true, maxParallel: Math.min(4, Math.max(1, Number(flow?.maxParallel) || 1)),
    kind: flow?.kind === 'automation' ? 'automation' : 'project', schedule: scheduleToDraft(flow?.schedule), autoIntegrate: flow?.autoIntegrate !== false, // missão antiga sem o campo = true
    ...verifyToDraft(flow?.verifyCommand), // sem o campo = sem verificação
    autoPush: flow?.autoPush === true, // missão antiga sem o campo = desligado

    steps: steps.length ? steps.map((s) => ({ key: keyOf.get(s.id), title: str(s.title), prompt: str(s.prompt), provider: s.provider ?? 'claude', role: s.role ?? 'builder', model: s.model ?? '', effort: s.effort ?? '', dependsOn: arr(s.dependsOn).map((d) => keyOf.get(d)).filter(Boolean), continueFrom: s.continueFrom ? keyOf.get(s.continueFrom) ?? '' : '' })) : [blankStep('k1')],
    nextKey: steps.length + 1,
  };
}

/** Confere o rascunho como o servidor confere (o servidor continua sendo a palavra final). { ok, errors: [{ field, key?, message }], byStep: { [key]: [mensagem] } } */
export function validateDraft(draft, { mode = 'create' } = {}) {
  const errors = [], byStep = {};
  const add = (field, message, key) => { errors.push({ field, ...(key ? { key } : {}), message }); if (key) (byStep[key] ??= []).push(message); };
  const title = str(draft?.title).trim();
  if (!title) add('title', 'Dê um nome à missão.'); else if (title.length > MAX_TITLE) add('title', `O nome passa de ${MAX_TITLE} caracteres.`);
  if (str(draft?.goal).length > MAX_TEXT) add('goal', `O objetivo passa de ${MAX_TEXT} caracteres.`);
  if (mode === 'create' && !draft?.workspaceId) add('workspaceId', 'Escolha o workspace onde a missão vai rodar.');
  if (![1, 2, 3, 4].includes(Number(draft?.maxParallel))) add('maxParallel', 'O paralelismo vai de 1 a 4.');
  const kind = draft?.kind ?? 'project'; // rascunho antigo sem tipo = projeto
  if (kind !== 'project' && kind !== 'automation') add('kind', 'Escolha o tipo: projeto ou automação.');
  if (kind === 'automation') for (const e of validateScheduleDraft(draft?.schedule).errors) add(e.field, e.message);
  for (const e of validateVerifyDraft(draft)) add(e.field, e.message);
  if (draft?.autoPush === true && !str(draft?.verifyText).trim()) add('autoPush', 'O envio automático exige um comando de verificação: só envia depois de ele passar.');
  const steps = arr(draft?.steps);
  if (!steps.length) add('steps', 'Adicione ao menos uma etapa.');
  if (steps.length > MAX_STEPS) add('steps', `No máximo ${MAX_STEPS} etapas por missão.`);
  const index = new Map(steps.map((s, i) => [s.key, i]));
  steps.forEach((s, i) => {
    const n = i + 1;
    if (!str(s.title).trim()) add('step.title', `Etapa ${n}: dê um título.`, s.key); else if (s.title.trim().length > MAX_TITLE) add('step.title', `Etapa ${n}: o título passa de ${MAX_TITLE} caracteres.`, s.key);
    if (!str(s.prompt).trim()) add('step.prompt', `Etapa ${n}: escreva o que o agente deve fazer.`, s.key); else if (s.prompt.length > MAX_TEXT) add('step.prompt', `Etapa ${n}: o texto passa de ${MAX_TEXT} caracteres.`, s.key);
    if (!PROVIDERS.includes(s.provider)) add('step.provider', `Etapa ${n}: escolha o agente (Claude ou Codex).`, s.key);
    if (!s.role) add('step.role', `Etapa ${n}: escolha o papel.`, s.key);
    for (const d of arr(s.dependsOn)) if (!index.has(d) || index.get(d) >= i) add('step.dependsOn', `Etapa ${n}: só pode depender de etapas anteriores da lista.`, s.key);
    if (s.continueFrom && !ancestorKeys(draft, s.key).has(s.continueFrom)) add('step.continueFrom', `Etapa ${n}: só pode continuar o terminal de uma etapa da sua cadeia de dependências.`, s.key);
  });
  return { ok: errors.length === 0, errors, byStep };
}

/**
 * Corpo de POST/PATCH /api/flows. Vazio de modelo/esforço = null (padrão do agente). `fullAccess` e `autoIntegrate` só vão `true` se marcados (booleano estrito: texto nunca
 * liga; o rascunho nasce com `autoIntegrate: true`). `kind` vai nos dois modos (o PATCH valida contra o resultado mesclado); `schedule` só em automação, senão null. PATCH não leva workspace.
 * `verifyCommand` vai nos dois modos: null (sem verificação; no PATCH, remove a que havia) ou { args, timeoutSec }.
 */
export function draftToBody(draft, { mode = 'create', proposalId = null } = {}) {
  const ids = new Map(arr(draft.steps).map((s, i) => [s.key, `s${i + 1}`]));
  const kind = draft.kind === 'automation' ? 'automation' : 'project';
  const body = {
    kind, title: str(draft.title).trim(), goal: str(draft.goal).trim(), fullAccess: draft.fullAccess === true, maxParallel: Number(draft.maxParallel) || 1,
    schedule: kind === 'automation' ? draftToSchedule(draft.schedule) : null, autoIntegrate: draft.autoIntegrate === true, autoPush: draft.autoPush === true, verifyCommand: draftToVerify(draft),
    steps: arr(draft.steps).map((s) => ({
      id: ids.get(s.key), title: str(s.title).trim(), prompt: str(s.prompt).trim(), provider: s.provider, role: s.role, model: s.model || null, effort: s.effort || null,
      dependsOn: arr(s.dependsOn).map((d) => ids.get(d)).filter(Boolean), continueFrom: s.continueFrom ? ids.get(s.continueFrom) ?? null : null,
    })),
  };
  // `proposalId` só no create e só no formato do servidor: serve para baixar a proposta do Planejador depois da criação (não muda a missão)
  return mode === 'create' ? { workspaceId: draft.workspaceId, ...body, ...(isProposalId(proposalId) ? { proposalId } : {}) } : body;
}
/** PATCH só com agenda, integração automática e envio automático: o único aceito com run ativo (os demais campos dão 409). */
export function draftToScheduleBody(draft) {
  return { schedule: draft?.kind === 'automation' ? draftToSchedule(draft.schedule) : null, autoIntegrate: draft?.autoIntegrate === true, autoPush: draft?.autoPush === true };
}

// ---------- criar por briefing: terminal planejador e propostas (docs/missions-v2-briefing.md) ----------
export const PROPOSAL_ID_RE = /^prop_[0-9a-f]{8}$/;
export const isProposalId = (v) => typeof v === 'string' && PROPOSAL_ID_RE.test(v);
export const BRIEFING_TEXT = 'Abre um terminal com o Planejador. Escreva o que você quer; ele lê o projeto, pergunta o que faltar e propõe as etapas. Você revisa no formulário antes de criar.';
export const PROPOSAL_NOTICE = 'Proposta do Planejador: revise as etapas, papéis e dependências antes de criar. Acesso total vem desligado.';
/** Automação proposta: o servidor manda a agenda SEMPRE desligada (só o usuário liga). Se um servidor antigo mandar ligada, o aviso diz isso em vez de mentir. */
export const PROPOSAL_SCHEDULE_OFF = 'A agenda vem desligada: ligue só se quiser que rode sozinha.';
export const PROPOSAL_SCHEDULE_ON = 'Atenção: a agenda veio LIGADA; desligue se não quiser que a automação rode sozinha.';

/** Linhas do aviso no topo do formulário da proposta: o aviso geral e, em automação com agenda, como a agenda chegou. */
export function proposalNoticeLines(proposal) {
  const flow = proposal?.flow && typeof proposal.flow === 'object' ? proposal.flow : null;
  if (!flow) return [PROPOSAL_NOTICE];
  const sched = flow.kind === 'automation' && flow.schedule && typeof flow.schedule === 'object' ? flow.schedule : null;
  return sched ? [PROPOSAL_NOTICE, sched.enabled === true ? PROPOSAL_SCHEDULE_ON : PROPOSAL_SCHEDULE_OFF] : [PROPOSAL_NOTICE];
}

/**
 * Formulário aberto a partir de proposta: Enter num <input> NÃO envia (o envio implícito do navegador criaria a missão com um Enter acidental, ex.: digitando no
 * terminal quando o formulário abriu). Só o botão "Criar missão" envia. Textarea (quebra de linha), select e botões seguem normais; composição de IME não é tocada.
 */
export const blocksImplicitSubmit = (e) => e?.key === 'Enter' && e?.nativeEvent?.isComposing !== true && e?.isComposing !== true && String(e?.target?.tagName ?? '').toUpperCase() === 'INPUT';

/** O foco está dentro de um terminal (xterm)? Usado para não abrir o formulário da proposta por cima de quem está digitando. */
export const focusInTerminal = (el) => !!(el && typeof el.closest === 'function' && el.closest('.xterm'));

/** Briefing num workspace com configuração executável de projeto ainda não revisada: o servidor recusa com 409 e a lista; a tela pede confirmação explícita. */
export const BRIEFING_CONFIG_CODE = 'project_config_unreviewed';
export const BRIEFING_CONFIG_TEXT = 'Este workspace tem configuração executável do projeto que ainda não foi revisada; o planejador vai rodar nesta pasta e o agente pode carregar esses arquivos.';
/** Arquivos do 409 `project_config_unreviewed` (só texto), ou null se o erro é outro. */
export function briefingConfigFiles(err) {
  if (err?.code !== BRIEFING_CONFIG_CODE) return null;
  return arr(err.files).filter((f) => typeof f === 'string' && f);
}

/**
 * Corpo de POST /api/flows/briefing: workspace obrigatório; agente só se for um dos conhecidos; modelo e esforço só quando escolhidos (vazio = padrão do agente).
 * Os valores vêm de listas fechadas (selects); o servidor valida de novo. `acknowledgeProjectConfig` só vai `true` com o booleano estrito (a caixa marcada no diálogo).
 */
export function briefingBody({ workspaceId, provider, model, effort, acknowledgeProjectConfig } = {}) {
  return {
    workspaceId: str(workspaceId), ...(PROVIDERS.includes(provider) ? { provider } : {}),
    ...(str(model) ? { model } : {}), ...(str(effort) ? { effort } : {}),
    ...(acknowledgeProjectConfig === true ? { acknowledgeProjectConfig: true } : {}),
  };
}

/**
 * Propostas pendentes de GET /api/flows/proposals, da mais nova para a mais antiga. Item sem id no formato do servidor ou sem `flow` é ignorado (texto de agente: nada
 * é confiável além do que o servidor validou). `title` é só para avisos curtos; o formulário usa o `proposal` inteiro.
 */
export function proposalRows(list, { workspaces = [] } = {}) {
  return arr(list).filter((p) => p && isProposalId(p.id) && p.flow && typeof p.flow === 'object').map((p) => ({
    id: p.id, terminalId: str(p.terminalId) || null, workspaceId: str(p.workspaceId) || null,
    workspaceName: str(p.workspaceName).trim() || wsNameOf({ workspaceId: p.workspaceId }, workspaces), createdAt: p.createdAt ?? null,
    title: clip(str(p.flow.title), 80) || 'sem título', steps: arr(p.flow.steps).length, proposal: p,
  })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
}

/**
 * Rascunho do formulário "Nova missão" a partir de uma proposta do Planejador: mesmo caminho da edição (flowToDraft), mas o workspace é SEMPRE o da proposta (o do pane,
 * nunca um campo do agente), o acesso total vem SEMPRE desligado (só o usuário liga) e o comando de verificação vem SEMPRE vazio (só o usuário define um comando a rodar).
 */
export function proposalToDraft(proposal) {
  const flow = proposal?.flow && typeof proposal.flow === 'object' ? proposal.flow : {};
  return { ...flowToDraft(flow), workspaceId: str(proposal?.workspaceId), fullAccess: false, ...verifyToDraft(null) };
}

/**
 * O que fazer com as propostas que chegaram. `seen` = ids já anunciados (abertos ou avisados). Bloqueado (outro diálogo aberto) = espera, sem marcar nada.
 * Com um formulário aberto, NADA abre por cima: as novas só viram aviso dentro dele (e ficam marcadas). Sem formulário, abre a mais nova; as demais ficam na faixa da página.
 * `terminalFocused` (o foco está num terminal xterm, ex.: o usuário digitando no Planejador): NADA abre; as novas ficam marcadas e vão para a faixa da página
 * ("Revisar"), e `held` traz a mais nova para a tela avisar. Assim um formulário nunca rouba o foco de quem digita (e um Enter não cai nele).
 */
export function proposalAutoOpen({ rows = [], seen = new Set(), formOpen = false, blocked = false, terminalFocused = false } = {}) {
  const fresh = arr(rows).filter((r) => r?.id && !seen.has(r.id));
  if (!fresh.length || blocked) return { open: null, markSeen: [] };
  const markSeen = fresh.map((r) => r.id);
  if (formOpen) return { open: null, markSeen };
  if (terminalFocused) return { open: null, markSeen, held: fresh[0] };
  return { open: fresh[0], markSeen };
}

/**
 * Avisos dentro do formulário. `current` = a proposta carregada nele (null no formulário comum). `newer` = versão nova do MESMO terminal (a pendente anterior foi
 * substituída): só carrega se o usuário pedir. `others` = outras pendentes que chegaram DEPOIS que o formulário abriu ("Nova proposta"): `seenAtOpen` = ids já vistos
 * naquele momento; essas continuam só na faixa da página. `pending` = a carregada ainda está pendente no servidor.
 */
export function proposalNotices(rows, current = null, { seenAtOpen = null } = {}) {
  const list = arr(rows), cur = current?.id ?? null;
  const old = seenAtOpen && typeof seenAtOpen.has === 'function' ? seenAtOpen : new Set();
  const newer = cur && current?.terminalId ? list.find((r) => r.terminalId === current.terminalId && r.id !== cur) ?? null : null;
  return { newer, others: list.filter((r) => r.id !== cur && r !== newer && !old.has(r.id)), pending: !!cur && list.some((r) => r.id === cur) };
}
