// Link de acompanhamento ao vivo de uma missão (botão "Acompanhar no navegador"). Lógica PURA: sem React, sem estado global.
// O link é uma URL de capacidade (o token está no caminho): vive só em memória do componente; este módulo nunca grava, loga nem expõe o token em atributos.
// `fetch`, `window`, `navigator` e `document` entram por parâmetro (com padrão no global) para os testes usarem falsos.

export const LIVE_OPEN_FEATURES = 'noopener,noreferrer';
const MAX_SERVER_MSG = 160;

const livePath = (missionId) => `/api/missions/${encodeURIComponent(String(missionId))}/live-link`;

/** Mensagens amigáveis por tipo de falha (PT-BR). Nenhuma inclui a URL nem o token. */
export const LIVE_MESSAGES = {
  forbidden: 'O servidor recusou o pedido (403). Recarregue o app e tente de novo; se persistir, o acesso desta sessão não está autorizado.',
  disabled: 'O acompanhamento ao vivo está desligado neste servidor (ORCH_LIVE=off). Ligue-o e reinicie o servidor para usar este recurso.',
  missing_route: 'Este servidor ainda não tem o acompanhamento ao vivo. Reinicie o servidor para atualizá-lo (ou confira se o recurso está ativo).',
  not_found: 'Missão não encontrada. Ela pode ter sido removida; atualize a lista.',
  conflict: 'Esta missão não permite link agora (por exemplo, é demonstrativa).',
  rate_limited: 'Muitas tentativas ou links ativos demais. Aguarde um minuto ou encerre outro link e tente de novo.',
  server: 'O servidor falhou ao tratar o link. Tente de novo em instantes.',
  network: 'Sem conexão com o servidor. Confira se o FORGE continua rodando e tente de novo.',
  bad_response: 'O servidor devolveu uma resposta inesperada. Reinicie o servidor e tente de novo.',
};

const fail = (kind, status, extra) => ({ ok: false, kind, status: status ?? null, message: extra ? `${LIVE_MESSAGES[kind]} (${extra})` : LIVE_MESSAGES[kind] });

/** Mensagem do servidor só quando curta, textual e sem aspecto de URL/token (nunca repassamos o que possa conter credencial). */
function serverNote(body) {
  const e = body && typeof body.error === 'string' ? body.error.trim() : '';
  if (!e || e.length > MAX_SERVER_MSG || /https?:\/\/|\/live\//i.test(e)) return '';
  return e;
}

async function readJson(res) {
  try { return typeof res.json === 'function' ? await res.json() : null; } catch { return null; }
}

/** Traduz uma resposta de erro HTTP (já lida) para `{ok:false, kind, status, message}`. `body` é o JSON ou null. */
export function failureFromResponse(status, body) {
  const code = body && typeof body.code === 'string' ? body.code : '';
  const text = body && typeof body.error === 'string' ? body.error : '';
  if (code === 'live_disabled' || /ORCH_LIVE/i.test(text)) return fail('disabled', status);
  if (status === 403) return fail('forbidden', status);
  if (status === 404) return body && text ? fail('not_found', status) : fail('missing_route', status); // 404 sem JSON = rota inexistente (servidor antigo)
  if (status === 409) { const n = serverNote(body); return n ? { ...fail('conflict', status), message: n } : fail('conflict', status); }
  if (status === 429) return fail('rate_limited', status);
  if (status === 503) return fail('disabled', status);
  if (status >= 500) return fail('server', status);
  return fail('bad_response', status);
}

/**
 * Valida a URL devolvida pelo servidor: http(s), mesma origem do app quando relativa, e caminho `/live/<algo>`.
 * Devolve o href absoluto ou null (impede `javascript:`/`data:` e URLs de outro destino virarem alvo do window.open).
 */
export function safeLiveUrl(raw, base) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw, base || undefined);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!/^\/live\/[^/]+/.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}

/** expiresAt (ISO ou epoch ms) -> ms ou null. */
export function expiryMs(expiresAt) {
  if (expiresAt == null || expiresAt === '') return null;
  const t = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt));
  return Number.isFinite(t) ? t : null;
}

/** Cunha (ou reaproveita, no servidor) o link da missão. Resolve sempre: `{ok:true, link:{url, expiresAt}}` ou `{ok:false, kind, status, message}`. */
export async function mintLiveLink(missionId, { fetchImpl, base } = {}) {
  const f = fetchImpl ?? globalThis.fetch;
  let res;
  try { res = await f(livePath(missionId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { return fail('network'); }
  const body = await readJson(res);
  if (res.status !== 201 && res.status !== 200) return failureFromResponse(res.status, body);
  const url = safeLiveUrl(body && body.url, base ?? globalThis.location?.href);
  if (!url) return fail('bad_response', res.status);
  return { ok: true, link: { url, expiresAt: expiryMs(body.expiresAt) != null ? body.expiresAt : null } };
}

/** Revoga o link. 204 = ok; 404 sem corpo de erro útil também conta como "já não existe" só quando o servidor responde JSON (missão sumiu). */
export async function revokeLiveLink(missionId, { fetchImpl } = {}) {
  const f = fetchImpl ?? globalThis.fetch;
  let res;
  try { res = await f(livePath(missionId), { method: 'DELETE' }); } catch { return fail('network'); }
  if (res.status === 204 || res.status === 200) return { ok: true };
  const body = await readJson(res);
  if (res.status === 404 && body && typeof body.error === 'string') return { ok: true, already: true }; // missão/link já não existe: o objetivo (sem link) está cumprido
  return failureFromResponse(res.status, body);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Estado de exibição do link: `{status:'none'|'active'|'expired', until, msLeft}`.
 * `until` = "HH:MM" (com "dd/mm " se não for hoje); null quando a validade é desconhecida. Expira por `expiresAt` (<= agora).
 */
export function describeLinkState(link, now = Date.now()) {
  if (!link || !link.url) return { status: 'none', until: null, msLeft: null };
  const t = expiryMs(link.expiresAt);
  if (t == null) return { status: 'active', until: null, msLeft: null };
  if (t <= now) return { status: 'expired', until: null, msLeft: 0 };
  const d = new Date(t), n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { status: 'active', until: sameDay ? hm : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`, msLeft: t - now };
}

/** Abre o link numa nova aba sem `opener` nem `referrer`. Com `noopener` o retorno é sempre null (mesmo com sucesso), então não dá para saber se o popup foi bloqueado: devolve 'requested' (ou 'blocked' se open lançar/não existir). */
export function openLiveLink(url, win = globalThis.window) {
  if (typeof url !== 'string' || !url || !win || typeof win.open !== 'function') return 'blocked';
  try { win.open(url, '_blank', LIVE_OPEN_FEATURES); return 'requested'; } catch { return 'blocked'; }
}

/** Copia texto: Clipboard API; se faltar/negar, `execCommand('copy')` num textarea temporário removido em seguida. Devolve true/false. */
export async function copyText(text, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (typeof text !== 'string' || !text) return false;
  try { if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; } } catch { /* cai no fallback */ }
  if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return false;
  const ta = doc.createElement('textarea');
  try {
    ta.value = text; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true'); ta.tabIndex = -1;
    if (ta.style) { ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '-9999px'; ta.style.opacity = '0'; }
    doc.body.appendChild(ta);
    if (typeof ta.select === 'function') ta.select();
    return doc.execCommand('copy') === true;
  } catch { return false; } finally { try { ta.parentNode?.removeChild(ta); } catch { /* já removido */ } }
}
