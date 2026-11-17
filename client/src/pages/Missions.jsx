import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../flows.css';
import { useStore } from '../store.jsx';
import { useFlows } from '../use-flows.js';
import { buildWorkflow, currentRun, describeFailure, nodeDetail, pickFlowId, waitingSteps } from '../flows-view.js';
import FlowSidebar from '../components/FlowSidebar.jsx';
import FlowHeader, { FlowAttention } from '../components/FlowHeader.jsx';
import FlowWorkflow from '../components/FlowWorkflow.jsx';
import FlowSidePanel from '../components/FlowSidePanel.jsx';
import FlowRuns from '../components/FlowRuns.jsx';
import FlowForm from '../components/FlowForm.jsx';
import { Icon } from '../components/ui.jsx';

const SEL_KEY = 'forge.flows.selected';
const readSel = () => { try { return localStorage.getItem(SEL_KEY) || null; } catch { return null; } };

/**
 * Missões v2: lista por workspace à esquerda; no centro o cabeçalho e o WORKFLOW (um nó por etapa, cada uma executada por um agente num terminal real do Cockpit);
 * à direita, o painel do nó selecionado. Tudo vem de /api/flows (polling ~2,5 s): nada é simulado; o que o servidor não informa aparece como "não informado".
 * O ciclo Planner/Executor antigo não é mais usado aqui (o código do servidor fica dormente). `data` (as missões antigas) chega do App e é ignorado.
 */
export default function Missions({ onOpenCockpit }) {
  const { flows, failure, refresh, actions } = useFlows();
  const { workspaces, state, terminals, notify } = useStore();
  const [selectedId, setSelectedId] = useState(readSel), [nodeId, setNodeId] = useState(null);
  const [form, setForm] = useState(null); // null | { mode: 'create' } | { mode: 'edit', flow }
  const [busy, setBusy] = useState(null), [now, setNow] = useState(() => Date.now());
  const roles = terminals?.roles ?? null;

  const list = flows ?? [];
  // Sem seleção válida: a que mais pede você (aguardando > em execução), senão a primeira da ordem da lista.
  useEffect(() => {
    if (flows === null) return;
    if (selectedId && list.some((f) => f.id === selectedId)) return;
    setSelectedId(pickFlowId(list, { workspaces })); setNodeId(null);
  }, [flows, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = useCallback((id) => { setSelectedId(id); setNodeId(null); try { localStorage.setItem(SEL_KEY, id); } catch { /* só conveniência */ } }, []);

  const flow = list.find((f) => f.id === selectedId) ?? null;
  const run = flow ? currentRun(flow) : null;
  const active = flow?.activeRun ?? null;
  useEffect(() => { // o relógio só corre enquanto há run ativo (duração ao vivo)
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const workspace = flow ? (workspaces ?? []).find((w) => w.id === flow.workspaceId) ?? null : null;
  const workspaceName = flow ? (flow.workspaceName || workspace?.displayName || workspace?.name || null) : null;
  const workflow = useMemo(() => (flow ? buildWorkflow(flow, run, { roles: roles ?? undefined }) : null), [flow, run, roles]);
  const detail = useMemo(() => (flow && nodeId ? nodeDetail(flow, run, nodeId, { now, roles: roles ?? undefined }) : null), [flow, run, nodeId, now, roles]);
  useEffect(() => { if (nodeId && flow && !detail) setNodeId(null); }, [nodeId, flow, detail]);
  const waiting = useMemo(() => (flow ? waitingSteps(flow) : []), [flow]);

  const pickNode = useCallback((id) => setNodeId((cur) => (cur === id ? null : id)), []);
  const nodeRef = useRef(null); nodeRef.current = nodeId;
  const closePanel = useCallback(() => { // devolve o foco ao nó que abriu o painel (teclado e leitor de tela)
    const id = nodeRef.current; setNodeId(null);
    if (id) setTimeout(() => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }), 0);
  }, []);

  const run_ = useCallback(async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) notify(ok); return r; } catch (e) { notify(describeFailure(e, 'item').message, 'error'); return undefined; } finally { setBusy(null); refresh(); }
  }, [notify, refresh]);

  const onStart = () => {
    if (!flow) return undefined;
    if (flow.fullAccess === true && !window.confirm(`A missão “${flow.title}” roda com ACESSO TOTAL: os agentes executam sem pedir confirmação e podem editar arquivos e rodar comandos no seu computador. Iniciar?`)) return undefined;
    return run_('start', () => actions.start(flow.id), 'Missão iniciada.');
  };
  const onCancel = () => {
    if (!flow || !active || !window.confirm('Cancelar a missão? As etapas em andamento são interrompidas e os terminais abertos por esta execução são fechados.')) return undefined;
    return run_('cancel', () => actions.cancel(flow.id, active.id), 'Missão cancelada.');
  };
  const onRemove = () => {
    if (!flow || !window.confirm(`Excluir a missão “${flow.title}”? O histórico de execuções dela também sai.`)) return undefined;
    return run_('remove', () => actions.remove(flow.id), 'Missão excluída.').then(() => { setNodeId(null); });
  };
  // Abre o Cockpit no workspace da missão; o terminal vai junto quando há um id.
  const openTerminal = (terminalId) => onOpenCockpit(flow?.workspaceId ?? null, typeof terminalId === 'string' ? terminalId : null);

  const submitForm = async (body) => {
    if (form?.mode === 'edit') { await actions.update(form.flow.id, body); notify('Missão atualizada.'); }
    else { const created = await actions.create(body); if (created?.id) select(created.id); notify('Missão criada. Clique em Iniciar para rodar.'); }
    setForm(null);
  };

  const unavailable = flows === null && failure;
  return (
    <div className={`fl-page${detail ? ' has-panel' : ''}`}>
      <FlowSidebar flows={flows} workspaces={workspaces ?? []} selectedId={selectedId} onPick={select} onNew={() => setForm({ mode: 'create' })} failure={failure} />
      <div className="fl-main">
        {flows === null ? (
          <div className="fl-center"><p className={`fl-note${unavailable ? ' err' : ''}`} role="status">{unavailable ? failure.message : 'Carregando…'}</p></div>
        ) : !flow ? (
          <div className="fl-blank">
            <h1>Missões</h1>
            <p>Divida um objetivo em etapas e deixe cada uma com um agente (Claude ou Codex) rodando num terminal real. Aqui você vê o workflow e o andamento de verdade.</p>
            {failure && <p className="fl-note err" role="status">{failure.message}</p>}
            <button type="button" className="fl-btn fl-btn-primary" onClick={() => setForm({ mode: 'create' })}><Icon name="plus" size={13} /><span>Nova missão</span></button>
          </div>
        ) : (
          <div className="fl-center">
            {failure && <p className="fl-note err" role="status">{failure.message}</p>}
            <FlowHeader flow={flow} workspaceName={workspaceName} now={now} busy={busy} onStart={onStart} onCancel={onCancel} onEdit={() => setForm({ mode: 'edit', flow })} onRemove={onRemove} onPickStep={pickNode} />
            <FlowAttention items={waiting} onOpenTerminal={openTerminal} />
            <FlowWorkflow key={flow.id} workflow={workflow} selectedId={nodeId} onSelect={pickNode} />
            <FlowRuns key={`runs-${flow.id}`} flow={flow} now={now} />
          </div>
        )}
      </div>
      {detail && <FlowSidePanel key={flow.id} detail={detail} onClose={closePanel} onOpenTerminal={openTerminal} />}
      {form && (
        <FlowForm mode={form.mode} flow={form.flow ?? null} workspaces={workspaces ?? []} activeWorkspaceId={state?.activeWorkspace?.id ?? null} roles={roles} onClose={() => setForm(null)} onSubmit={submitForm} />
      )}
    </div>
  );
}
