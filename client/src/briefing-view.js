// Briefing para o Maestro no cliente: lógica pura sobre POST /api/maestro/briefing e o campo `briefings` do GET /api/maestro. Sem React, sem rede.
// O briefing é a ORDEM do usuário: o texto vai uma vez ao servidor e o Maestro o lê pela ferramenta get_briefing; a tela só mostra a situação (nunca o texto de volta).
export const MAX_BRIEFING = 8000;

/** A mesma limpeza do servidor: tira caracteres de controle (menos quebra de linha e tabulação) e apara. */
export const cleanBriefing = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim();

/** Problema que impede de enviar (ou null): precisa de texto, até MAX_BRIEFING caracteres depois de limpo, e de escolher o Maestro quando há mais de um. */
export function briefingProblem(text, { maestros = [], paneId = null } = {}) {
  const t = cleanBriefing(text);
  if (!t) return 'Escreva o briefing.';
  if (t.length > MAX_BRIEFING) return `O briefing tem no máximo ${MAX_BRIEFING} caracteres.`;
  const list = Array.isArray(maestros) ? maestros : [];
  if (!list.length) return 'Abra um time com Maestro neste workspace.';
  if (list.length > 1 && !list.some((m) => m.id === paneId)) return 'Escolha qual Maestro recebe o briefing.';
  return null;
}

/** Corpo do POST: { workspaceId, text, paneId? }. Sem paneId o servidor procura o único Maestro rodando no workspace. */
export function briefingBody({ workspaceId, text, paneId = null }) {
  return { workspaceId, text: cleanBriefing(text), ...(typeof paneId === 'string' && paneId ? { paneId } : {}) };
}

/** Os Maestros rodando no workspace, na ordem da grade: [{ id, title }]. */
export function runningMaestros(sessions, workspaceId) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && s.status === 'running' && s.role === 'maestro' && s.workspaceId === workspaceId && typeof s.id === 'string')
    .map((s) => ({ id: s.id, title: typeof s.title === 'string' && s.title ? s.title : 'Maestro' }));
}

/**
 * Maestros a oferecer: os da grade mais os que o servidor listou no 409 many_maestros (`fromServer`), sem repetir. A grade pode estar atrasada em relação ao servidor;
 * sem esta união o seletor não aparecia (a grade ainda via um Maestro só) e o usuário ficava sem como escolher até a próxima consulta.
 */
export function mergeMaestros(local, fromServer) {
  const out = [...(Array.isArray(local) ? local : [])], seen = new Set(out.map((m) => m.id));
  for (const p of Array.isArray(fromServer) ? fromServer : []) {
    if (!p || typeof p.id !== 'string' || !/^term_[0-9a-f]{8}$/.test(p.id) || seen.has(p.id)) continue;
    seen.add(p.id); out.push({ id: p.id, title: typeof p.title === 'string' && p.title ? p.title.slice(0, 80) : 'Maestro' });
  }
  return out;
}

/** Pane escolhido que ainda vale (rodando e na lista), ou o único Maestro, ou null. */
export function pickMaestro(maestros, paneId) {
  const list = Array.isArray(maestros) ? maestros : [];
  if (paneId && list.some((m) => m.id === paneId)) return paneId;
  return list.length === 1 ? list[0].id : null;
}

const ts = (b) => { const t = Date.parse(b?.createdAt); return Number.isFinite(t) ? t : 0; };
/** Por quanto tempo vale o que a resposta do POST disse, enquanto o servidor ainda não lista o briefing (a loja consulta a cada 1,5 s). */
export const SENT_GRACE_MS = 10_000;
/**
 * O briefing a mostrar: o que acabou de ser enviado (`id`), se o servidor já o lista; senão o mais recente do workspace. `sent` = o que a resposta do POST devolveu:
 * vale só por SENT_GRACE_MS. Depois disso, se o servidor não o lista (reiniciou ou descartou; os briefings vivem em memória), a situação vira desconhecida em vez de
 * ficar "Na fila" para sempre.
 */
export function latestBriefing(briefings, { workspaceId, id = null, sent = null, now = Date.now() } = {}) {
  const list = (Array.isArray(briefings) ? briefings : []).filter((b) => b && typeof b.id === 'string' && b.workspaceId === workspaceId);
  if (id) {
    const hit = list.find((b) => b.id === id); if (hit) return hit;
    if (sent?.id === id) return now - ts(sent) <= SENT_GRACE_MS ? sent : { ...sent, status: 'unknown', note: 'O servidor não informa mais este briefing (foi reiniciado ou o descartou).' };
  }
  return list.reduce((best, b) => (!best || ts(b) >= ts(best) ? b : best), null);
}

const STATUS = Object.freeze({
  queued: { label: 'Na fila', tone: 'wait', hint: 'O Maestro está ocupado; o FORGE entrega sozinho assim que der.' },
  delivered: { label: 'Entregue', tone: 'ok', hint: 'O aviso foi digitado no terminal do Maestro.' },
  read: { label: 'Lido pelo Maestro', tone: 'ok', hint: 'O Maestro leu o pedido completo e conduz o squad.' },
  failed: { label: 'Falhou', tone: 'err', hint: 'O aviso não chegou ao Maestro.' },
});
/** Situação legível de um briefing: { label, tone ('wait'|'ok'|'err'|'dim'), hint, note }. Situação desconhecida não vira sucesso. */
export function briefingStatus(b) {
  if (!b) return null;
  const s = STATUS[b.status] ?? { label: 'Situação desconhecida', tone: 'dim', hint: '' };
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
  return { ...s, note };
}

/** Erro do envio em texto para a tela; `choose` = o servidor achou mais de um Maestro e pede para escolher (409 many_maestros). */
export function briefingError(e) {
  if (e?.code === 'many_maestros') return { choose: true, panes: Array.isArray(e.panes) ? e.panes : [], text: 'Há mais de um Maestro neste workspace: escolha qual recebe o briefing e envie de novo.' };
  if (e?.code === 'no_maestro') return { choose: false, text: 'Abra um time com Maestro neste workspace.' };
  if (e?.status === 404) return { choose: false, text: 'Este servidor ainda não recebe briefings. Atualize o FORGE.' };
  return { choose: false, text: e?.message || 'Não foi possível enviar o briefing.' };
}
