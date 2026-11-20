// Reconhece, no FIM da saída de um terminal, a mensagem de "limite de uso da conta atingido" das CLIs de agente (Claude Code, Codex).
// Serve só para EXPLICAR por que um agente parou (missões: etapa `unconfirmed` com `stopReason: 'limit'`): nunca conclui nem falha nada sozinho.
// Falso positivo custa pouco (a etapa continua esperando a sua decisão, só com outro texto); por isso as frases são as de PARADA ("reached", "hit your"),
// nunca as de aviso ("Approaching ... limit"), e só o trecho final conta (o mesmo texto citado bem antes no terminal não vale).
// Entrada: texto do terminal (dado não confiável). Saída: { resets } (resets = horário de reset como aparece, curto e limpo, ou null) ou null.

export const LIMIT_WINDOW = 700, MAX_RESETS = 48;

const STOP_RES = [
  /\b(?:hit|reached) your (?:[a-z0-9-]+ ){0,2}limit\b/i, // "You've hit your limit · resets 3pm", "You've reached your usage limit", "hit your usage limit" (Codex)
  /\busage limit (?:reached|exceeded)\b/i, // "Claude AI usage limit reached|1754000000"
  /\b(?:5-hour|five-hour|session|weekly|daily|opus|sonnet)(?: weekly)? limit (?:reached|exceeded)\b/i, // "5-hour limit reached ∙ resets 7pm", "Opus weekly limit reached"
];
const RESETS_RE = /\b(?:resets?|try again)\s+(?:at\s+|in\s+|on\s+)?(.{1,80})/i;
// onde o horário termina: separadores da CLI, " /upgrade", fim de frase, espaço duplo, ou a próxima instrução da mensagem
// (inclui o resto da tela do Claude Code: caixa de entrada "> ", "? for shortcuts", molduras e marcadores)
const RESETS_END_RE = /\s\/|[·∙•|>?│─╭╮╰╯⎿●■✻]|\.\s|\s{2,}|\b(?:upgrade|switch|to continue|or wait|and try)\b/i;
const SAFE_RESETS_RE = /[^A-Za-z0-9 :.,+\-()/_]/g; // as CLIs escrevem o horário em ASCII ("3pm (America/Sao_Paulo)", "Oct 9, 10am"): o resto sai (menos texto livre do agente na tela)
const strip = (v) => String(v ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ' ').replace(/[\x00-\x1f\x7f]/g, ' '); // eslint-disable-line no-control-regex

/** Horário de reset logo depois da frase de limite ("resets 3pm (America/Sao_Paulo)", "try again at 3:05 PM"), ou null. */
function resetsOf(text) {
  const m = RESETS_RE.exec(text); if (!m) return null;
  let r = m[1];
  const cut = r.search(RESETS_END_RE); if (cut >= 0) r = r.slice(0, cut);
  const close = r.indexOf(')'); if (close >= 0) r = r.slice(0, close + 1); // o fuso "(America/Sao_Paulo)" fecha o horário
  r = r.replace(SAFE_RESETS_RE, '').replace(/ {2,}/g, ' ').replace(/[\s.,;:]+$/, '').trim();
  if (r.includes('(') && !r.includes(')')) r = r.slice(0, r.indexOf('(')).trim(); // parêntese cortado pelo limite: sai o pedaço
  return r ? r.slice(0, MAX_RESETS).trim() : null;
}

/** { resets } se o fim de `text` mostra a parada por limite de uso; senão null. */
export function detectLimitStop(text) {
  const tail = strip(text).replace(/ {2,}/g, ' ').slice(-LIMIT_WINDOW);
  let at = -1;
  for (const re of STOP_RES) { const m = re.exec(tail); if (m && m.index > at) at = m.index; }
  if (at < 0) return null;
  return { resets: resetsOf(tail.slice(at)) };
}
