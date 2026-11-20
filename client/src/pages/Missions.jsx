import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../flows.css';
import { useStore } from '../store.jsx';
import { buildWorkflow, currentRun, describeFailure, focusInTerminal, integrationInfo, integrationProblems, nodeDetail, pickFlowId, proposalAutoOpen, proposalNotices, proposalRows, runActions, waitingSteps } from '../flows-view.js';
import FlowSidebar from '../components/FlowSidebar.jsx';
import FlowHeader, { AckDialog, DiscardDialog, FlowAttention } from '../components/FlowHeader.jsx';
import FlowWorkflow from '../components/FlowWorkflow.jsx';
import FlowSidePanel from '../components/FlowSidePanel.jsx';
import FlowRuns from '../components/FlowRuns.jsx';
import FlowForm from '../components/FlowForm.jsx';
import FlowTerminals from '../components/FlowTerminals.jsx';
import FlowBriefing, { ProposalTray } from '../components/FlowBriefing.jsx';
import { flowTerminalTabs, plannerTabs } from '../flow-terminals.js';
import { Icon } from '../components/ui.jsx';
import { api } from '../api.js';

const SEL_KEY = 'forge.flows.selected';
const readSel = () => { try { return localStorage.getItem(SEL_KEY) || null; } catch { return null; } };
// propostas do Planejador já anunciadas (abertas ou avisadas) nesta sessão do navegador: cancelar o formulário não o faz reabrir sozinho ao voltar à página
const SEEN_KEY = 'forge.flows.proposalsSeen';
const readSeen = () => { try { const v = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch { return new Set(); } };

/**
 * Missões v2: lista por workspace à esquerda; no centro o cabeçalho e o WORKFLOW (um nó por etapa, cada uma executada por um agente num terminal real do Cockpit);
 * à direita, o painel do nó selecionado. Tudo vem de /api/flows (polling ~2,5 s): nada é simulado; o que o servidor não informa aparece como "não informado".
 * O ciclo Planner/Executor antigo não é mais usado aqui (o código do servidor fica dormente). `data` = o resultado de useFlows, que o App mantém (um só polling para a página e para a barra lateral).
 */
export default function Missions({ onOpenCockpit, data, stream = null }) {
  const { flows, failure, refresh, actions, proposals } = data; // o App mantém um único polling de /api/flows (também usado pelo indicador da barra lateral); as propostas vêm junto
  const { workspaces, state, terminals, notify, loadTerminals } = useStore();
  const [selectedId, setSelectedId] = useState(readSel), [nodeId, setNodeId] = useState(null);
  // null | { mode: 'create' } | { mode: 'create', proposal, key } (proposta do Planejador) | { mode: 'edit', flow } | { mode: 'schedule', flow } (só agenda/integração, com run ativo);
  // todos com `seenAtOpen` (propostas já vistas ao abrir; ver openForm)
  const [form, setForm] = useState(null);
  const [briefing, setBriefing] = useState(false); // diálogo "Nova por briefing"
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
  const problems = useMemo(() => (flow ? integrationProblems(flow) : []), [flow]);
  const ra = flow ? runActions(flow) : null;
  // pronta para integrar sem diagnóstico (não deveria ocorrer fora do modo Git): o aviso aparece mesmo assim, sem motivos
  const readyInfo = ra?.canIntegrate ? integrationInfo(run) ?? { reasons: [], conflicts: [], files: [], needsAck: false, branch: null, baseBranch: null } : null;

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
  // Etapa que parou sem report_done: a decisão é sua e fica registrada no servidor. Recusar falha a etapa e pula as que dependem dela, por isso pede confirmação.
  const [deciding, setDeciding] = useState(null);
  const onDecide = async (runId, stepId, decision) => {
    if (!flow || deciding) return;
    if (decision === 'reject' && !window.confirm('Recusar esta etapa? Ela fica como falha e as etapas que dependem dela são puladas.')) return;
    setDeciding({ stepId, decision });
    try { await run_('decide', () => actions.decide(flow.id, runId, stepId, decision), decision === 'accept' ? 'Etapa aceita como concluída.' : 'Etapa recusada.'); } finally { setDeciding(null); }
  };
  // ---------- fatia 2: retomar, integrar, descartar, limpar cópias e resolver a integração de etapa ----------
  const onResume = () => {
    if (!flow || !ra?.canResume) return undefined;
    return run_('resume', () => actions.resume(flow.id, ra.runId), 'Missão retomada: os agentes continuam de onde pararam.');
  };
  // Confirmação EXPLÍCITA de configuração executável/arquivo sensível: { kind: 'final' | 'step', runId, stepId?, title?, files, rev, changed }. Só o clique no diálogo reenvia
  // com o ack, e o ack vai atado à lista mostrada (acknowledgedFiles). `rev` muda a cada lista nova: o diálogo remonta com a caixa DESMARCADA.
  const [ack, setAck] = useState(null), [discarding, setDiscarding] = useState(null);
  const askAck = (a) => setAck({ ...a, files: Array.isArray(a.files) ? a.files : [], rev: a.rev ?? 0, changed: a.changed === true });
  const onIntegrate = async () => {
    if (!flow || !ra?.canIntegrate) return;
    const runId = ra.runId, info = integrationInfo(run);
    if (info?.needsAck) { askAck({ kind: 'final', runId, files: info.files }); return; } // o servidor já disse que precisa: pergunta antes de tentar
    setBusy('integrate');
    try { await actions.integrate(flow.id, runId); notify('Missão integrada na sua branch.'); }
    catch (e) {
      if (e?.code === 'project_config_changed') askAck({ kind: 'final', runId, files: e.files?.length ? e.files : info?.files });
      else notify(describeFailure(e, 'item').message, 'error');
    } finally { setBusy(null); refresh(); }
  };
  const onRetryStep = async (p) => {
    if (!flow || !p?.runId) return;
    if (p.needsAck) { askAck({ kind: 'step', runId: p.runId, stepId: p.stepId, title: p.title, files: p.files }); return; } // etapa bloqueada pelo guard: confirmação antes do retry
    setBusy(`step:${p.stepId}:retry`);
    try { await actions.stepIntegration(flow.id, p.runId, p.stepId, 'retry'); notify('Integração da etapa reenviada.'); }
    catch (e) {
      if (e?.code === 'project_config_changed') askAck({ kind: 'step', runId: p.runId, stepId: p.stepId, title: p.title, files: e.files?.length ? e.files : p.files });
      else notify(describeFailure(e, 'item').message, 'error');
    } finally { setBusy(null); refresh(); }
  };
  const confirmAck = async () => {
    const a = ack;
    if (!flow || !a || busy) return;
    const files = a.files; // EXATAMENTE a lista que o diálogo mostrou
    setBusy(a.kind === 'step' ? `step:${a.stepId}:retry` : 'integrate');
    try {
      if (a.kind === 'step') await actions.stepIntegration(flow.id, a.runId, a.stepId, 'retry', { acknowledgeProjectConfig: true, acknowledgedFiles: files });
      else await actions.integrate(flow.id, a.runId, { acknowledgeProjectConfig: true, acknowledgedFiles: files });
      notify(a.kind === 'step' ? 'Integração da etapa reenviada com a sua confirmação.' : 'Missão integrada na sua branch.');
      setAck(null);
    } catch (e) {
      // a lista mudou (o agente acrescentou arquivos): o diálogo reabre com a lista NOVA e a caixa desmarcada; nada é reenviado sozinho
      if (e?.code === 'project_config_changed') { setAck({ ...a, files: e.files?.length ? e.files : files, rev: (a.rev ?? 0) + 1, changed: true }); notify('A lista de arquivos sensíveis mudou. Revise a lista nova e confirme de novo.', 'error'); }
      else notify(describeFailure(e, 'item').message, 'error'); // outra falha: o diálogo fica aberto e Cancelar fecha
    } finally { setBusy(null); refresh(); }
  };
  const onDiscardStep = (p) => {
    if (!flow || !p?.runId || !window.confirm(`Descartar a etapa “${p.title}”? O trabalho dela não entra na missão, ela fica como falha e as etapas que dependem dela são puladas. As outras seguem.`)) return undefined;
    return run_(`step:${p.stepId}:discard`, () => actions.stepIntegration(flow.id, p.runId, p.stepId, 'discard'), 'Etapa descartada.');
  };
  // Descartar a execução pronta para integrar: diálogo próprio (confirmação + caixa "apagar também a branch")
  const onDiscard = () => { if (flow && ra?.canIntegrate && ra.canDiscard) setDiscarding({ runId: ra.runId, info: integrationInfo(run) }); };
  const confirmDiscard = async ({ deleteBranch }) => {
    const d = discarding;
    if (!flow || !d) return;
    const ok = await run_('discard', () => actions.discard(flow.id, d.runId, { deleteBranch: deleteBranch === true }), deleteBranch ? 'Execução descartada e branch da missão apagada.' : 'Execução descartada. A branch da missão continua no repositório.');
    if (ok !== undefined) setDiscarding(null);
  };
  // Limpar cópias (ra.cleanupAction): run cancelado/falho ainda não descartado = descarte SEM apagar a branch; já descartado ou concluído com sobras = refaz a limpeza segura
  const onCleanup = () => {
    if (!flow || !ra?.cleanupAction) return undefined;
    if (!window.confirm('Limpar as cópias de trabalho (worktrees) desta execução? Só saem as que não têm nada pendente; a branch da missão continua no repositório.')) return undefined;
    return ra.cleanupAction === 'cleanup'
      ? run_('cleanup', () => actions.cleanup(flow.id, ra.runId), 'Limpeza das cópias refeita. Se alguma ainda sobrou, o motivo aparece no topo da missão.')
      : run_('cleanup', () => actions.discard(flow.id, ra.runId, { deleteBranch: false }), 'Cópias da execução limpas. A branch da missão continua no repositório.');
  };
  const onRemove = () => {
    if (!flow || !window.confirm(`Excluir a missão “${flow.title}”? O histórico de execuções dela também sai.`)) return undefined;
    return run_('remove', () => actions.remove(flow.id), 'Missão excluída.').then(() => { setNodeId(null); });
  };
  // Terminais da missão: abrem num dock aqui mesmo (abaixo do workflow), separados dos terminais do Cockpit. Os Planejadores (criar por briefing) entram no mesmo
  // dock, antes das etapas, e valem com ou sem missão selecionada.
  const [dockOpen, setDockOpen] = useState(false), [dockWanted, setDockWanted] = useState(null);
  const tabs = useMemo(() => (flow ? flowTerminalTabs(flow, terminals?.sessions) : []), [flow, terminals?.sessions]);
  const planTabs = useMemo(() => plannerTabs(terminals?.sessions, { workspaces: workspaces ?? [] }), [terminals?.sessions, workspaces]);
  const dockTabs = useMemo(() => [...planTabs, ...tabs], [planTabs, tabs]);
  const dockLabel = planTabs.length && tabs.length ? 'Terminais da missão e do Planejador' : planTabs.length ? 'Planejador de missão' : 'Terminais da missão';
  const plannerIds = useRef(new Set()); plannerIds.current = new Set(planTabs.map((t) => t.terminalId));
  const wantedRef = useRef(null); wantedRef.current = dockWanted;
  useEffect(() => { // cada missão começa com o dock recolhido e sem confirmação pendente de outra; um Planejador à vista continua à vista
    setAck(null); setDiscarding(null);
    if (wantedRef.current && plannerIds.current.has(wantedRef.current)) return;
    setDockOpen(false); setDockWanted(null);
  }, [selectedId]);
  const openTerminal = (terminalId) => { setDockWanted(typeof terminalId === 'string' ? terminalId : null); setDockOpen(true); };
  const closePlanner = async (t) => {
    if (t.session?.status === 'running' && !window.confirm('Encerrar o Planejador? A conversa com ele termina; nada é criado.')) return;
    try { await api.post(`/api/terminals/${encodeURIComponent(t.terminalId)}/close`); } catch (e) { notify(e.message, 'error'); }
    finally { if (wantedRef.current === t.terminalId) setDockWanted(null); loadTerminals?.(); }
  };

  // ---------- criar por briefing (docs/missions-v2-briefing.md): o Planejador propõe, o formulário mostra, só o usuário cria ----------
  const startBriefing = async (body) => {
    const r = await actions.startBriefing(body); // erro (limite de terminais, provedor indisponível, configuração não revisada...) fica no diálogo
    setBriefing(false); // o diálogo desmonta aqui: nada do que vem depois pode lançar de volta para ele
    try {
      const id = typeof r?.terminalId === 'string' ? r.terminalId : typeof r?.session?.id === 'string' ? r.session.id : null;
      await loadTerminals?.();
      if (id) setDockWanted(id);
      setDockOpen(true);
      notify('Planejador aberto. Escreva o que você quer no terminal abaixo; quando a proposta chegar, ela aparece para você revisar.');
    } catch {
      notify('O Planejador foi aberto, mas a tela não conseguiu mostrá-lo agora. Ele aparece no dock desta página na próxima atualização.', 'error');
    }
  };
  const propRows = useMemo(() => proposalRows(proposals, { workspaces: workspaces ?? [] }), [proposals, workspaces]);
  const seenRef = useRef(null); if (!seenRef.current) seenRef.current = readSeen();
  const markSeen = useCallback((ids) => {
    for (const id of ids) seenRef.current.add(id);
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenRef.current].slice(-50))); } catch { /* só conveniência */ }
  }, []);
  // todo formulário guarda as propostas já vistas ao abrir: dentro dele, "Nova proposta" só para as que chegarem depois (as vistas ficam na faixa da página)
  const openForm = useCallback((f) => setForm({ ...f, seenAtOpen: new Set(seenRef.current) }), []);
  const openProposal = useCallback((row) => { markSeen([row.id]); openForm({ mode: 'create', proposal: row.proposal, key: row.id }); }, [markSeen, openForm]);
  // Proposta nova: abre o formulário preenchido SÓ se nada estiver aberto; com um formulário aberto, vira aviso dentro dele (nunca sobrescreve o que o usuário edita).
  // Com o foco num terminal (o usuário digitando no Planejador), não abre: fica na faixa com "Revisar" e um aviso, sem roubar o foco nem receber um Enter.
  useEffect(() => {
    const plan = proposalAutoOpen({ rows: propRows, seen: seenRef.current, formOpen: !!form, blocked: !!ack || !!discarding || briefing, terminalFocused: focusInTerminal(document.activeElement) });
    if (plan.markSeen.length) markSeen(plan.markSeen);
    if (plan.open) openForm({ mode: 'create', proposal: plan.open.proposal, key: plan.open.id });
    else if (plan.held) notify(`Proposta do Planejador pronta: “${plan.held.title}”. Clique em Revisar na faixa do topo de Missões.`);
  }, [propRows, form, ack, discarding, briefing, markSeen, openForm, notify]);
  const [dismissingId, setDismissingId] = useState(null);
  const dismissProposal = async (id) => {
    try { await actions.dismissProposal(id); } catch (e) { if (e?.status !== 404) throw e; } // 404 = já não estava pendente (usada, substituída ou expirada)
    notify('Proposta descartada. O terminal do Planejador continua aberto para refinar.');
  };
  const onTrayDismiss = async (r) => {
    if (!window.confirm(`Descartar a proposta “${r.title}”? Nada é criado. O terminal do Planejador continua aberto e pode enviar outra.`)) return;
    setDismissingId(r.id);
    try { await dismissProposal(r.id); } catch (e) { notify(describeFailure(e, 'item').message, 'error'); } finally { setDismissingId(null); }
  };
  const trayRows = useMemo(() => propRows.filter((r) => r.id !== form?.proposal?.id), [propRows, form]);

  const submitForm = async (body) => {
    if (form?.mode === 'schedule') { await actions.updateSchedule(form.flow.id, body); notify(form.flow.kind === 'automation' ? 'Agenda atualizada.' : 'Integração automática atualizada.'); }
    else if (form?.mode === 'edit') { await actions.update(form.flow.id, body); notify('Missão atualizada.'); }
    else { const created = await actions.create(body); if (created?.id) select(created.id); notify(form?.proposal ? 'Missão criada a partir da proposta do Planejador. Clique em Iniciar para rodar.' : 'Missão criada. Clique em Iniciar para rodar.'); }
    setForm(null);
  };

  const unavailable = flows === null && failure;
  const hasDock = !!stream && dockTabs.length > 0;
  const newButtons = (
    <div className="fl-new-row">
      <button type="button" className="fl-btn fl-btn-primary" onClick={() => openForm({ mode: 'create' })}><Icon name="plus" size={13} /><span>Nova missão</span></button>
      <button type="button" className="fl-btn" onClick={() => setBriefing(true)}><Icon name="planner" size={13} /><span>Nova por briefing</span></button>
    </div>
  );
  return (
    <div className={`fl-page${detail ? ' has-panel' : ''}`}>
      <FlowSidebar flows={flows} workspaces={workspaces ?? []} selectedId={selectedId} onPick={select} onNew={() => openForm({ mode: 'create' })} onBriefing={() => setBriefing(true)} failure={failure} />
      <div className={`fl-main${hasDock ? ' has-dock' : ''}`}>
        <ProposalTray rows={trayRows} onOpen={openProposal} onDismiss={onTrayDismiss} busyId={dismissingId} />
        {flows === null ? (
          <div className="fl-center"><p className={`fl-note${unavailable ? ' err' : ''}`} role="status">{unavailable ? failure.message : 'Carregando…'}</p></div>
        ) : !flow ? (
          <div className="fl-scroll fl-scroll-blank"><div className="fl-blank">
            <h1>Missões</h1>
            <p>Divida um objetivo em etapas e deixe cada uma com um agente (Claude ou Codex) rodando num terminal real. Aqui você vê o workflow e o andamento de verdade.</p>
            <p className="dim">Prefere descrever o que quer? Em “Nova por briefing” o Planejador conversa com você num terminal, lê o projeto e propõe as etapas; você revisa antes de criar.</p>
            {failure && <p className="fl-note err" role="status">{failure.message}</p>}
            {newButtons}
          </div></div>
        ) : (
          <>
          <div className="fl-scroll"><div className="fl-center">
            {failure && <p className="fl-note err" role="status">{failure.message}</p>}
            <FlowHeader flow={flow} workspaceName={workspaceName} now={now} busy={busy} onStart={onStart} onCancel={onCancel} onEdit={() => openForm({ mode: 'edit', flow })} onEditSchedule={() => openForm({ mode: 'schedule', flow })}
              onRemove={onRemove} onPickStep={pickNode} onResume={onResume} onIntegrate={onIntegrate} onDiscard={onDiscard} onCleanup={onCleanup} />
            <FlowAttention items={waiting} problems={problems} interrupted={!!ra?.canResume} ready={readyInfo} onOpenTerminal={openTerminal} onDecide={onDecide} deciding={deciding}
              onRetry={onRetryStep} onDiscardStep={onDiscardStep} onResume={onResume} onIntegrate={onIntegrate} onDiscard={onDiscard} busy={busy} />
            <FlowWorkflow key={flow.id} workflow={workflow} selectedId={nodeId} onSelect={pickNode} />
            <FlowRuns key={`runs-${flow.id}`} flow={flow} now={now} />
          </div></div>
          </>
        )}
        {stream && <FlowTerminals tabs={dockTabs} open={dockOpen && dockTabs.length > 0} wanted={dockWanted} onWanted={setDockWanted} onOpen={openTerminal} onClose={() => setDockOpen(false)} onCloseTab={closePlanner} stream={stream} label={dockLabel} />}
      </div>
      {detail && <FlowSidePanel key={flow.id} detail={detail} onClose={closePanel} onOpenTerminal={openTerminal} onDecide={onDecide} deciding={deciding} onRetryStep={onRetryStep} onDiscardStep={onDiscardStep} busy={busy} />}
      {ack && <AckDialog key={`${ack.kind}-${ack.stepId ?? ack.runId}-${ack.rev ?? 0}`} ack={ack} busy={busy} onConfirm={confirmAck} onClose={() => setAck(null)} />}
      {discarding && <DiscardDialog info={discarding.info} busy={busy} onConfirm={confirmDiscard} onClose={() => setDiscarding(null)} />}
      {briefing && <FlowBriefing workspaces={workspaces ?? []} activeWorkspaceId={state?.activeWorkspace?.id ?? null} onClose={() => setBriefing(false)} onSubmit={startBriefing} />}
      {form && (
        <FlowForm key={`${form.mode}-${form.key ?? form.flow?.id ?? 'novo'}`} mode={form.mode} flow={form.flow ?? null} workspaces={workspaces ?? []} activeWorkspaceId={state?.activeWorkspace?.id ?? null} roles={roles} onClose={() => setForm(null)} onSubmit={submitForm}
          proposal={form.proposal ?? null} notices={proposalNotices(propRows, form.proposal ?? null, { seenAtOpen: form.seenAtOpen })} onOpenProposal={openProposal}
          onDismissProposal={form.proposal ? async (id) => { await dismissProposal(id); setForm(null); } : null} />
      )}
    </div>
  );
}
