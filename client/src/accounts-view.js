// Contas (Configurações > Contas): lógica PURA da tela. O servidor é a fonte da verdade; aqui só há rótulos, validações e regras de habilitação.
// Tudo é defensivo: o servidor novo pode não existir ainda, e qualquer campo pode faltar.

export const MAX_ACCOUNTS = 10;
export const NAME_MAX = 60;
export const LOGIN_POLL_MS = 1500;
export const LOGIN_METHODS = Object.freeze([
  { id: 'claudeai', label: 'Conta Claude (assinatura)' },
  { id: 'console', label: 'Console Anthropic (uso por API)' },
  { id: 'sso', label: 'SSO' },
]);
export const DEFAULT_METHOD = 'claudeai';
export const LOGIN_INTRO = 'Estamos abrindo o navegador para você entrar. Se ele não abrir, use o link abaixo. Quando terminar, volte aqui: o FORGE detecta sozinho.';

const HOSTS = ['claude.ai', 'claude.com', 'console.anthropic.com'];

/** Só https, sem credenciais embutidas, e host exato da lista ou subdomínio de anthropic.com (claude.ai.evil.com NÃO passa). Devolve a URL normalizada ou null. */
export function safeLoginUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 4000 || /[\u0000-\u001f\u007f\s]/.test(raw.trim())) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  const okHost = HOSTS.includes(h) || ['claude.ai', 'claude.com', 'anthropic.com'].some((d) => h === d || h.endsWith('.' + d)); // igual ao filtro do servidor: o domínio e seus subdomínios, nunca um nome que apenas termine igual (evilclaude.ai)
  return okHost ? u.href : null;
}

/** Nome da conta: 1 a 60 caracteres (após aparar), sem caracteres de controle. Devolve { ok, value, error }. */
export function validateName(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, value, error: 'Informe um nome para a conta.' };
  if (value.length > NAME_MAX) return { ok: false, value, error: `O nome deve ter até ${NAME_MAX} caracteres.` };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return { ok: false, value, error: 'O nome não pode ter caracteres de controle.' };
  return { ok: true, value, error: null };
}

const PLANS = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Gratuito' };
/** Nome legível do plano ("max" vira "Max"); vazio quando o servidor não informa. */
export function planLabel(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return PLANS[t.toLowerCase()] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

/** Resumo "e-mail · plano · organização" (só as partes que existem). */
export function accountSummary(account) {
  const st = account?.status ?? {};
  return [st.email, planLabel(st.subscriptionType), st.orgName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
}

/** Estado exibido: { kind: 'ok'|'off'|'wait'|'bad', text, detail }. */
export function accountState(account) {
  const st = account?.status;
  if (!st || typeof st !== 'object' || st.checked === false) return { kind: 'wait', text: 'verificando…', detail: '' };
  if (st.error) return { kind: 'bad', text: String(st.error), detail: '' };
  if (st.loggedIn === true) return { kind: 'ok', text: 'Conectada', detail: accountSummary(account) };
  if (st.loggedIn === false) return { kind: 'off', text: 'Não conectada', detail: '' };
  return { kind: 'wait', text: 'verificando…', detail: '' }; // loggedIn nulo: o servidor ainda não sabe
}

/** Texto do botão de login: conta já conectada reconecta. */
export const loginButtonLabel = (account) => (account?.status?.loggedIn === true ? 'Reconectar' : 'Entrar');

export const isLoginRunning = (login) => login?.state === 'running';

/** Lista de contas segura: ignora entradas sem id e normaliza campos. */
export function normalizeAccounts(data) {
  const list = Array.isArray(data?.accounts) ? data.accounts.filter((a) => a && typeof a.id === 'string' && a.id) : [];
  return {
    accounts: list.map((a) => ({ ...a, label: String(a.label ?? a.id), system: a.system === true, isDefault: a.isDefault === true })),
    providers: Array.isArray(data?.providers) ? data.providers.filter((p) => p && typeof p.id === 'string') : [],
  };
}

/**
 * Habilitação dos botões de um cartão. `busy` = há uma chamada em andamento neste cartão; `loginRunningId` = conta com login em andamento (um por vez).
 * Remover: nunca na conta Sistema nem com login dela em andamento; o servidor ainda recusa se um terminal a usa (409).
 */
export function accountActions(account, { busy = false, loginRunningId = null } = {}) {
  const other = !!loginRunningId && loginRunningId !== account?.id;
  const mine = !!loginRunningId && loginRunningId === account?.id;
  return {
    login: !busy && !loginRunningId,
    loginReason: other ? 'Já há um login em andamento em outra conta. Termine ou cancele esse primeiro.' : '',
    makeDefault: !busy && !account?.isDefault,
    remove: !busy && !account?.system && !mine,
    canRemove: !account?.system,
  };
}

/** Pode adicionar? Limite de contas, nome válido e provedor que o FORGE sabe conectar (Claude Code; o Codex usa o login do próprio CLI). */
export function canAddAccount({ count = 0, name = '', provider = null, busy = false } = {}) {
  if (busy) return { ok: false, reason: '' };
  if (count >= MAX_ACCOUNTS) return { ok: false, reason: `Limite de ${MAX_ACCOUNTS} contas atingido.` };
  if (!provider || provider.available === false) return { ok: false, reason: 'Provedor indisponível.' };
  if (provider.canLogin === false) return { ok: false, reason: provider.note || 'O login deste provedor é feito no próprio CLI.' };
  const v = validateName(name);
  return v.ok ? { ok: true, reason: '' } : { ok: false, reason: v.error };
}

/** Provedor selecionável para criar conta do FORGE? Só o que o FORGE sabe conectar (canLogin). O Codex aparece na lista, mas o login dele é do próprio CLI. */
export const providerSelectable = (p) => !!p && p.available !== false && p.canLogin !== false;

/** Código colado só pode ser enviado com texto e sem login encerrado. */
export const canSendCode = (text, login) => login?.state === 'running' && login?.needsCode === true && String(text ?? '').trim().length > 0;

/** Últimas linhas da saída do login (sem linhas vazias), limitadas e cortadas para caber na área pequena. */
export function tailLines(lines, n = 6) {
  return (Array.isArray(lines) ? lines : []).map((l) => String(l ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 300)).filter((l) => l.trim()).slice(-n);
}

/** Nome da conta para a etiqueta do terminal; null quando for a Sistema, desconhecida ou sem lista. */
export function accountTagName(accountId, accounts) {
  if (!accountId || accountId === 'system' || !Array.isArray(accounts)) return null;
  const a = accounts.find((x) => x?.id === accountId);
  if (!a || a.system) return null;
  const t = String(a.label ?? '').trim();
  return t || null;
}

/** Mensagem em português por código de erro do servidor; sem código conhecido devolve null (o chamador usa o `error` do servidor). */
export function errorMessageFor(code) {
  return ({
    login_closing: 'Aguarde: o FORGE está confirmando a conta.',
    input_limit: 'Muitas tentativas de código. Cancele e comece o login de novo.',
    login_too_soon: 'Aguarde um instante e tente de novo.',
  })[code] ?? null;
}

/** O código colado deve voltar ao campo se o envio falhou? Não em `login_closing`: o código já foi aceito. */
export const shouldRestoreCode = (code) => code !== 'login_closing';

/** Texto de erro de uma chamada: mensagem do código, ou o `error` do servidor (ex.: account_in_use), ou o padrão. */
export const apiErrorText = (e, fallback) => errorMessageFor(e?.code) ?? (e?.message || fallback);

/** Mensagem após remover: { kind: 'ok'|'err', text }. Pasta que não pôde ser apagada é ERRO (dados de login ficaram no disco). */
export function removalMessage({ folderRemoved, defaultChangedTo, id } = {}) {
  if (folderRemoved === false) return { kind: 'err', text: `A conta foi removida, mas a pasta com o login dela não pôde ser apagada. Apague manualmente a pasta accounts/${id} dentro da pasta de dados do FORGE.` };
  return { kind: 'ok', text: defaultChangedTo === 'system' ? 'Conta removida. A conta padrão voltou a ser Sistema.' : 'Conta removida.' };
}

export const LOGIN_INTERRUPTED = 'O login foi interrompido (o FORGE pode ter reiniciado). Tente de novo.';
/** Na fase de execução, `idle` do servidor = ele reiniciou e perdeu o login. */
export const loginInterrupted = (phase, login) => phase === 'run' && login?.state === 'idle';
