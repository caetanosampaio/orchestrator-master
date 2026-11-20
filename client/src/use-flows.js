import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { briefingBody, describeFailure } from './flows-view.js';

const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

// O api.js não tem PATCH nem repassa `files`/`conflicts` dos 409 (e não é deste módulo). Mesmo formato de erro { status, message, code? }, mais as listas que a tela
// precisa para pedir a confirmação explícita (project_config_changed traz `files[]`; conflict traz `conflicts[]`). Só listas de texto passam.
async function send(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Erro ${res.status}`), {
      status: res.status, ...(typeof data.code === 'string' ? { code: data.code } : {}), files: strList(data.files), conflicts: strList(data.conflicts),
    });
  }
  return data;
}
const patch = (url, body) => send('PATCH', url, body);
const post = (url, body) => send('POST', url, body);
const runUrl = (id, runId) => `/api/flows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`;
// A confirmação de configuração executável/arquivo sensível só vai quando o usuário marcou de fato (booleano estrito; nunca por padrão) e SEMPRE atada à lista que o
// diálogo mostrou (`acknowledgedFiles`): o servidor só aceita o ack para exatamente esses arquivos. Sem a lista, nada de ack.
const ackBody = (opts) => (opts?.acknowledgeProjectConfig === true && Array.isArray(opts.acknowledgedFiles)
  ? { acknowledgeProjectConfig: true, acknowledgedFiles: strList(opts.acknowledgedFiles) } : {});

/**
 * Missões v2 reais de /api/flows (cada uma com `lastRun` e `activeRun`). Consulta a cada ~2,5 s com a aba visível (o run roda no servidor e muda sozinho)
 * e quando a aba volta a ficar visível; `refresh()` força uma leitura (depois de uma ação). A tela só é atualizada quando algo mudou.
 * `failure` = { kind, message } da última leitura que falhou (null se ok): servidor fora do ar ou rota inexistente; o último estado conhecido continua na tela.
 * As ações lançam o erro do servidor (mensagem em português) para a tela mostrar; depois de cada uma a lista é relida.
 * `proposals` = propostas pendentes do Planejador (GET /api/flows/proposals), lidas junto; sem a rota fica [] e nada falha.
 */
export function useFlows({ intervalMs = 2500 } = {}) {
  const [flows, setFlows] = useState(null), [failure, setFailure] = useState(null), [proposals, setProposals] = useState([]);
  const last = useRef(''), lastP = useRef('[]'), busy = useRef(false), alive = useRef(true);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      // propostas do Planejador no MESMO polling (docs/missions-v2-briefing.md): a falha delas (servidor antigo sem a rota = 404) nunca vira falha da lista de missões
      const [fl, pr] = await Promise.allSettled([api.get('/api/flows'), api.get('/api/flows/proposals')]);
      if (!alive.current) return;
      if (pr.status === 'fulfilled') {
        const jp = JSON.stringify(Array.isArray(pr.value) ? pr.value : []);
        if (jp !== lastP.current) { lastP.current = jp; setProposals(JSON.parse(jp)); }
      }
      if (fl.status === 'rejected') throw fl.reason;
      const list = fl.value;
      const j = JSON.stringify(list);
      if (j !== last.current) { last.current = j; setFlows(Array.isArray(list) ? list : []); }
      setFailure(null);
    } catch (e) { if (alive.current) setFailure(describeFailure(e, 'list')); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true;
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => { alive.current = false; clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [refresh, intervalMs]);

  const act = useCallback(async (fn) => { try { return await fn(); } finally { refresh(); } }, [refresh]);
  const actions = useMemo(() => ({
    create: (body) => act(() => api.post('/api/flows', body)),
    update: (id, body) => act(() => patch(`/api/flows/${encodeURIComponent(id)}`, body)),
    remove: (id) => act(() => api.del(`/api/flows/${encodeURIComponent(id)}`)),
    start: (id) => act(() => api.post(`/api/flows/${encodeURIComponent(id)}/runs`, {})),
    cancel: (id, runId) => act(() => api.post(`/api/flows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, {})),
    // etapa que parou sem report_done: decision = 'accept' | 'reject' (o servidor confere e registra)
    decide: (id, runId, stepId, decision) => act(() => api.post(`/api/flows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/decision`, { decision })),
    // fatia 2 (docs/missions-v2-fatia2.md, seção B): retomar, integrar, descartar, limpar cópias e resolver a integração de uma etapa
    resume: (id, runId) => act(() => post(`${runUrl(id, runId)}/resume`, {})),
    integrate: (id, runId, opts) => act(() => post(`${runUrl(id, runId)}/integrate`, ackBody(opts))),
    discard: (id, runId, { deleteBranch = false } = {}) => act(() => post(`${runUrl(id, runId)}/discard`, { deleteBranch: deleteBranch === true })),
    cleanup: (id, runId) => act(() => post(`${runUrl(id, runId)}/cleanup`, {})),
    // envio ao remoto depois da integração: a prévia só lê (consulta o remoto); o envio exige o `digest` da prévia que você viu
    pushPreview: (id, runId) => api.get(`${runUrl(id, runId)}/push`),
    push: (id, runId, expect) => act(() => post(`${runUrl(id, runId)}/push`, { expect })),
    // action = 'retry' | 'discard'
    stepIntegration: (id, runId, stepId, action, opts) => act(() => post(`${runUrl(id, runId)}/steps/${encodeURIComponent(stepId)}/integration`, { action, ...ackBody(opts) })),
    // único PATCH aceito com run ativo: SÓ agenda, integração automática e envio automático (os demais campos dariam 409)
    updateSchedule: (id, body) => act(() => patch(`/api/flows/${encodeURIComponent(id)}`, { schedule: body?.schedule ?? null, autoIntegrate: body?.autoIntegrate === true, autoPush: body?.autoPush === true })),
    // criar por briefing: abre o terminal do Planejador ({ terminalId, session }); nada é criado nem iniciado aqui
    startBriefing: (body) => post('/api/flows/briefing', briefingBody(body)),
    dismissProposal: (id) => act(() => post(`/api/flows/proposals/${encodeURIComponent(id)}/dismiss`, {})),
  }), [act]);
  return { flows, failure, refresh, actions, proposals };
}

/**
 * Histórico de runs de UMA missão (GET /api/flows/:id/runs, mais recente primeiro). Só consulta enquanto `enabled` (o <details> do histórico aberto):
 * fechado não gasta rede. `key` (ex.: o id do último run) refaz a leitura quando muda.
 */
export function useFlowRuns(flowId, { enabled = false, key = '', intervalMs = 4000 } = {}) {
  const [runs, setRuns] = useState(null), [failure, setFailure] = useState(null);
  const last = useRef(''), alive = useRef(true);
  const load = useCallback(async () => {
    if (!flowId) return;
    try {
      const list = await api.get(`/api/flows/${encodeURIComponent(flowId)}/runs`);
      if (!alive.current) return;
      const j = JSON.stringify(list);
      if (j !== last.current) { last.current = j; setRuns(Array.isArray(list) ? list : []); }
      setFailure(null);
    } catch (e) { if (alive.current) setFailure(describeFailure(e, 'item')); }
  }, [flowId]);
  useEffect(() => { last.current = ''; setRuns(null); setFailure(null); }, [flowId]);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !flowId) return () => { alive.current = false; };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, intervalMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [enabled, flowId, key, load, intervalMs]);
  return { runs, failure };
}
