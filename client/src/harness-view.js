// "Quem faz cada tarefa" no cliente: lógica pura sobre o que GET /api/harness devolve (sem React, sem rede). Nada é presumido: a tabela, as listas de modelos e esforços e as skills vêm do servidor.
export const EFFORT_ORDER = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const EFFORT_SEGMENTS = EFFORT_ORDER.length;

/** Nível de esforço de 0 (desconhecido ou padrão da CLI) a 5: quantos segmentos acendem em "Quanto pensa". */
export const effortLevel = (id) => EFFORT_ORDER.indexOf(id) + 1;
/** Os segmentos da barra de esforço: [true, true, false, false, false]. */
export const effortBars = (id) => Array.from({ length: EFFORT_SEGMENTS }, (_, i) => i < effortLevel(id));

const find = (list, id) => (Array.isArray(list) ? list.find((x) => x && x.id === id) : undefined);
/** Rótulo do modelo da IA (lista do servidor); sem modelo, "padrão da CLI"; fora da lista, o próprio id. */
export const modelLabel = (options, provider, id) => (id ? find(options?.[provider]?.models, id)?.label ?? id : 'padrão da CLI');
/** Rótulo do esforço, em minúsculas para ler junto da barra ("médio", "alto"); sem esforço, "padrão". */
export const effortLabel = (options, provider, id) => (id ? String(find(options?.[provider]?.efforts, id)?.label ?? id).toLocaleLowerCase('pt-BR') : 'padrão');

/** Filtro por IA ("Todas" = null): só as linhas cuja IA EFETIVA é a escolhida. */
export const filterRows = (rows, provider = null) => (Array.isArray(rows) ? rows.filter((r) => !provider || r.effective?.provider === provider) : []);
/** Agrupa as linhas na ordem dos grupos do servidor; grupo sem linha some. */
export function groupRows(rows, groups) {
  const list = Array.isArray(rows) ? rows : [];
  return (Array.isArray(groups) ? groups : []).map((g) => ({ group: g, rows: list.filter((r) => r.group === g) })).filter((x) => x.rows.length);
}
/** O que mudou em relação ao padrão de fábrica, em palavras (para o selo da linha): "IA, modelo". Vazio = padrão. */
export function changedFields(row) {
  const e = row?.effective ?? {}, d = row?.defaults ?? {}, out = [];
  if (e.provider !== d.provider) out.push('IA');
  if (e.model !== d.model) out.push('modelo');
  if (e.effort !== d.effort) out.push('esforço');
  if (JSON.stringify(e.skills ?? []) !== JSON.stringify(d.skills ?? [])) out.push('skills');
  if ((e.agentId ?? null) !== (d.agentId ?? null)) out.push('agente');
  return out;
}
/** Skills que dá para marcar numa linha: as do catálogo (o plugin do papel as carrega). */
export const skillChoices = (data) => (Array.isArray(data?.skills) ? data.skills.map((s) => s.id) : []);
/** Nome do agente escolhido (ou o padrão do papel). */
export const agentName = (agents, id, fallback) => (id ? (Array.isArray(agents) ? agents.find((a) => a.id === id)?.name : null) ?? fallback : fallback);
/** Resumo curto de um agente do usuário (primeira parte da instrução). */
export const snippet = (text, n = 90) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** Define qual IA aparece como "instalada" nos filtros: as do servidor (`providers`) cruzadas com os rótulos de /api/terminals. */
export const filterChoices = (data, terminalProviders) => (Array.isArray(data?.providers) ? data.providers : []).map((id) => ({ id, label: terminalProviders?.find((p) => p.id === id)?.label ?? id }));
