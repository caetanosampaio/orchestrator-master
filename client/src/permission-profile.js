// Perfil de permissão do workspace (default | bypass): funções PURAS (sem React nem rede), no formato do contrato de
// GET/PUT /api/workspaces/:id/permission-profile. Nada é inventado: o aviso, a lista pré-aprovada e a auditoria vêm do servidor;
// o que o servidor não manda vira "indisponível", nunca um texto ou um estado simulados. Por enquanto o perfil vale só para as MISSÕES
// (o Executor do ciclo); os terminais não mudam.

export const PROFILES = Object.freeze(['default', 'bypass']);
export const PROFILE_LABEL = Object.freeze({ default: 'padrão', bypass: 'sem confirmação' });
export const PROFILE_TITLE = Object.freeze({ default: 'Perfil padrão', bypass: 'Sem confirmação (bypass)' });
export const SCOPE_NOTE = 'Por enquanto o perfil vale só para as MISSÕES (o Executor do ciclo). Os terminais deste workspace continuam como estão; eles ficam para depois.';
export const DASH = '—';

/** Igual ao servidor (exec-profile.js): só o valor exato 'bypass' liga; qualquer outra coisa é o padrão (falha segura). */
export const profileOf = (ws) => (ws?.permissionProfile === 'bypass' ? 'bypass' : 'default');
export const isBypass = (ws) => profileOf(ws) === 'bypass';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
const isProfile = (v) => v === 'default' || v === 'bypass';

export function fmtWhen(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : DASH;
}

/** Descrição curta do selo (barra lateral, cartão da missão, diálogo). `tone`: 'bypass' (vermelho, visível) | 'default' (discreto). */
export function profileSeal(profile) {
  const bypass = profile === 'bypass';
  return { tone: bypass ? 'bypass' : 'default', text: bypass ? 'sem confirmação' : 'padrão', glyph: bypass ? '!' : '', title: bypass ? 'Perfil sem confirmação: nas missões deste workspace o Executor roda comandos, acessa a rede e instala pacotes sem pedir confirmação.' : 'Perfil padrão: nas missões o Executor edita arquivos e roda só os comandos pré-aprovados.' };
}

/**
 * Lê a resposta do servidor sem presumir nada. Devolve null se não for um objeto. Falha segura: `canEnable` e `tokenProtected` só valem se forem EXATAMENTE true;
 * sem aviso (texto e versão) não há como ligar (`enableBlock` diz por quê).
 */
export function normalizeInfo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const w = raw.warning && typeof raw.warning === 'object' ? raw.warning : null;
  const warning = w && Number.isInteger(w.version) && str(w.text).trim() ? { version: w.version, text: str(w.text), noTokenText: str(w.noTokenText) } : null;
  const audit = arr(raw.audit).filter((e) => e && typeof e === 'object' && isProfile(e.to)).map((e) => ({
    id: str(e.id) || `${str(e.at)}-${e.from}-${e.to}`, at: str(e.at), from: isProfile(e.from) ? e.from : null, to: e.to,
    tokenGuarded: typeof e.tokenGuarded === 'boolean' ? e.tokenGuarded : null, warningVersion: Number.isInteger(e.warningVersion) ? e.warningVersion : null, workspaceName: str(e.workspaceName),
  }));
  return {
    profile: raw.profile === 'bypass' ? 'bypass' : 'default',
    since: str(raw.since) || null,
    defaultAllow: arr(raw.defaultAllow).filter((x) => typeof x === 'string' && x.trim()),
    warning,
    tokenProtected: raw.tokenProtected === true,
    canEnable: raw.canEnable === true,
    reason: str(raw.reason) || null,
    notice: str(raw.notice) || null, // só no PUT que desliga com execução em curso ("ela termina com o perfil com que começou")
    audit: sortAudit(audit),
  };
}

/** Auditoria da mais recente para a mais antiga (entradas sem data válida vão para o fim, na ordem recebida). */
export function sortAudit(list) {
  const t = (e) => { const n = Date.parse(e.at); return Number.isFinite(n) ? n : -Infinity; };
  return arr(list).map((e, i) => ({ e, i })).sort((a, b) => (t(b.e) - t(a.e)) || (a.i - b.i)).map((x) => x.e);
}

/** Uma linha de auditoria legível: "11/11/26 14:02 · padrão → sem confirmação · sem token (aviso v1)". */
export function auditLine(e) {
  const from = e?.from ? PROFILE_LABEL[e.from] : DASH, to = PROFILE_LABEL[e?.to] ?? DASH;
  const guard = e?.to === 'bypass' ? (e.tokenGuarded === true ? ' · com token de sessão' : e.tokenGuarded === false ? ' · sem token de sessão' : '') : '';
  const v = Number.isInteger(e?.warningVersion) && e.to === 'bypass' ? ` · aviso v${e.warningVersion}` : '';
  return `${fmtWhen(e?.at)} · ${from} → ${to}${guard}${v}`;
}

export const REASON_TEXT = Object.freeze({
  active_cycle: 'Há um ciclo de missão ou uma tarefa em execução neste workspace. Espere terminar ou cancele antes de ligar o perfil sem confirmação.',
});
/** Por que não dá para ligar agora (null = dá). Vale só para o botão de ligar; desligar é sempre permitido. */
export function enableBlock(info) {
  if (!info) return 'Perfil indisponível: o servidor não respondeu.';
  if (info.profile === 'bypass') return null;
  if (!info.warning) return 'O servidor não enviou o texto do aviso (ou a versão dele), então não dá para ligar com segurança.';
  if (!info.tokenProtected && !info.warning.noTokenText.trim()) return 'O servidor não enviou o aviso sobre a falta do token de sessão, então não dá para ligar com segurança.';
  if (!info.canEnable) return info.reason ? (REASON_TEXT[info.reason] ?? `O servidor não permite ligar agora (motivo: ${info.reason}).`) : 'O servidor não permite ligar agora.';
  return null;
}

/** O botão "Ligar" só destrava com TODAS as confirmações do usuário (a do aviso e, sem token, a do risco extra) e com o servidor permitindo. */
export function canSubmitEnable(info, { confirmed = false, ackNoToken = false } = {}) {
  if (enableBlock(info) || info.profile === 'bypass') return false;
  return confirmed === true && (info.tokenProtected || ackNoToken === true);
}

/** Corpo do PUT. Ligar exige as confirmações (devolve null sem elas: nunca monta um pedido de bypass sem o usuário ter confirmado); desligar é um clique. */
export function buildPutBody(profile, info, { confirmed = false, ackNoToken = false } = {}) {
  if (!info?.warning || !isProfile(profile)) return null;
  if (profile === 'default') return { profile: 'default', confirm: true, warningVersion: info.warning.version };
  if (!canSubmitEnable(info, { confirmed, ackNoToken })) return null;
  return { profile: 'bypass', confirm: true, warningVersion: info.warning.version, ...(info.tokenProtected ? {} : { acknowledgeNoToken: true }) };
}

/** Mensagem honesta de um erro de rota. `where`: 'load' (GET) | 'save' (PUT). Rota ausente (servidor antigo) responde 404 sem corpo JSON: a api.js o transforma em "Erro 404". */
export function errorText(err, where = 'load') {
  const status = err?.status, msg = str(err?.message);
  if (status === 404 && /^Erro 404$/.test(msg)) return 'Este servidor não oferece o perfil de permissão (rota ausente). Atualize e reinicie o servidor do FORGE.';
  if (status === 404) return msg || 'Workspace não encontrado.';
  if (err?.code === 'no_token_ack_required') return 'Sem o token de sessão, é preciso confirmar o risco extra para ligar.';
  if (status === 409) return msg || REASON_TEXT.active_cycle;
  if (status === 400 && where === 'save') return msg || 'O servidor recusou o pedido (o aviso pode ter mudado). Leia de novo e confirme.';
  if (status === 401 || status === 403) return msg || 'O servidor recusou o pedido (sem permissão).';
  if (typeof status !== 'number') return 'Servidor indisponível. Inicie o backend (npm run server).';
  return msg || `Erro ${status}`;
}

/** Aviso mudou de versão ou o servidor recusou por validação: o diálogo recarrega o GET e zera as confirmações. */
export const needsReload = (err) => err?.status === 400 || err?.status === 409;

/**
 * Perfil do Executor mostrado no cartão da missão. A fonte mais fiel é o que o servidor GRAVOU na rodada (`round.policy.profile`, depois `task.permissionProfile`);
 * sem rodada, vale o perfil ATUAL do workspace e o selo diz isso. Sem workspace, null (nada é inventado).
 * @returns {{profile:'default'|'bypass', source:'rodada'|'tarefa'|'workspace', round:number|null, current:'default'|'bypass'|null, differs:boolean}|null}
 */
export function executorProfile(mission, workspace) {
  const current = workspace ? profileOf(workspace) : null;
  const rounds = arr(mission?.cycle?.rounds);
  for (let i = rounds.length - 1; i >= 0; i--) {
    const p = rounds[i]?.policy?.profile;
    if (isProfile(p)) return { profile: p, source: 'rodada', round: Number.isInteger(rounds[i].n) ? rounds[i].n : i + 1, current, differs: current !== null && current !== p };
  }
  const tasks = arr(mission?.tasks);
  for (let i = tasks.length - 1; i >= 0; i--) {
    const p = tasks[i]?.permissionProfile;
    if (isProfile(p)) return { profile: p, source: 'tarefa', round: null, current, differs: current !== null && current !== p };
  }
  return current ? { profile: current, source: 'workspace', round: null, current, differs: false } : null;
}

/** Texto do selo do Executor ("Executor · sem confirmação") e a dica com a origem do dado. */
export function executorSeal(mission, workspace) {
  const x = executorProfile(mission, workspace);
  if (!x) return null;
  const seal = profileSeal(x.profile);
  const origin = x.source === 'rodada' ? `gravado na rodada ${x.round}` : x.source === 'tarefa' ? 'gravado na tarefa' : 'perfil atual do workspace (a missão ainda não rodou)';
  const now = x.differs ? ` O workspace está agora no perfil ${PROFILE_LABEL[x.current]}; vale para as próximas rodadas.` : '';
  return { ...seal, label: `Executor · ${seal.text}`, title: `${seal.title} (${origin}).${now}` };
}
