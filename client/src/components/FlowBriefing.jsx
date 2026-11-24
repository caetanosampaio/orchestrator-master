import React, { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Icon } from './ui.jsx';
import { useProviderOptions } from './FlowForm.jsx';
import { useStore } from '../store.jsx';
import { accountsOf, pickAccount } from '../accounts-view.js';
import { BRIEFING_CONFIG_TEXT, BRIEFING_TEXT, briefingBody, briefingConfigFiles, PROVIDER_LABEL, PROVIDERS } from '../flows-view.js';

/**
 * Faixa da página com as propostas do Planejador pendentes (as que não estão abertas no formulário agora). Revisar abre o formulário preenchido; Descartar pede confirmação.
 * Nada é criado daqui: a missão só nasce no Criar do formulário.
 */
export function ProposalTray({ rows, onOpen, onDismiss, busyId = null }) {
  if (!rows?.length) return null;
  return (
    <section className="fl-props" aria-label="Propostas do Planejador">
      <div className="fl-attn fl-props-box" role="status">
        <p className="fl-kicker"><i aria-hidden="true" />{rows.length === 1 ? 'Proposta do Planejador' : `${rows.length} propostas do Planejador`}</p>
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <span><b>{r.title}</b> <span className="dim">· {r.steps} {r.steps === 1 ? 'etapa' : 'etapas'}{r.workspaceName ? ` · ${r.workspaceName}` : ''}</span></span>
              <span className="fl-props-act">
                <button type="button" className="fl-btn fl-btn-primary" onClick={() => onOpen(r)} aria-label={`Revisar a proposta “${r.title}” no formulário`}>Revisar</button>
                <button type="button" className="fl-btn fl-btn-ghost" onClick={() => onDismiss(r)} disabled={busyId === r.id} aria-label={`Descartar a proposta “${r.title}”`}>{busyId === r.id ? <i className="fl-spin" aria-hidden="true" /> : null}<span>Descartar</span></button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * "Nova por briefing": escolhe o workspace (padrão: o ativo) e, se quiser, o agente/modelo/esforço do Planejador (listas fechadas de /api/team-templates, como no
 * formulário). Confirmar só ABRE o terminal do Planejador (POST /api/flows/briefing); nada é criado nem iniciado. O erro do servidor (ex.: limite de terminais) fica no diálogo.
 * Workspace com configuração executável de projeto não revisada (409 project_config_unreviewed): o diálogo mostra os arquivos e uma caixa de confirmação; só com ela
 * marcada o pedido vai de novo, com a confirmação (acknowledgeProjectConfig).
 */
export default function FlowBriefing({ workspaces, activeWorkspaceId, onClose, onSubmit }) {
  const [workspaceId, setWorkspaceId] = useState(() => (activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id ?? ''));
  const [provider, setProvider] = useState('claude'), [model, setModel] = useState(''), [effort, setEffort] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  // 409 project_config_unreviewed: { workspaceId, files }. Só com a caixa marcada o pedido é REENVIADO com a confirmação (acknowledgeProjectConfig); trocar de workspace descarta.
  const [cfg, setCfg] = useState(null), [cfgOk, setCfgOk] = useState(false);
  const needsAck = !!cfg && cfg.workspaceId === workspaceId;
  const cfgBox = useRef(null);
  useEffect(() => { if (cfg) cfgBox.current?.focus(); }, [cfg]); // o botão de envio fica desabilitado: o foco vai para a caixa de confirmação (senão cai no body)
  const opts = useProviderOptions();
  const po = opts[provider] ?? { models: [], efforts: [] };
  // Conta do terminal do Planejador (Contas v2): só se escolhe com MAIS de uma conta do agente (pré-seleção: a última usada); com uma, o servidor usa ela.
  const { accounts, lastAccount } = useStore();
  const [chosenAccount, setChosenAccount] = useState('');
  const mine = accountsOf(accounts, provider), account = pickAccount({ accounts, provider, chosen: chosenAccount, lastUsed: lastAccount });
  const pickProvider = (p) => {
    const o = opts[p] ?? { models: [], efforts: [] };
    setProvider(p); setChosenAccount(''); setModel((m) => (o.models.some((x) => x.id === m) ? m : '')); setEffort((e) => (o.efforts.some((x) => x.id === e) ? e : ''));
  };
  const pickWorkspace = (id) => { setWorkspaceId(id); setCfg(null); setCfgOk(false); setError(null); };
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !workspaceId || (needsAck && !cfgOk)) return; // sem a caixa marcada nada é reenviado
    setBusy(true); setError(null);
    try { await onSubmit(briefingBody({ workspaceId, provider, model, effort, acknowledgeProjectConfig: needsAck && cfgOk === true, accountId: account })); } catch (err) {
      const files = briefingConfigFiles(err);
      if (files) { setCfg({ workspaceId, files }); setCfgOk(false); } // lista (nova) aparece com a caixa DESMARCADA
      else setError(err?.message || 'Não foi possível abrir o Planejador.');
      setBusy(false);
    }
  };
  return (
    <Dialog title="Nova missão por briefing" onClose={onClose} id="flow-briefing">
      <form className="fl-form" onSubmit={submit} noValidate>
        <p className="fl-form-lead" id="fl-briefing-d">{BRIEFING_TEXT}</p>
        <label>Workspace
          <select data-autofocus value={workspaceId} onChange={(e) => pickWorkspace(e.target.value)} aria-describedby="fl-briefing-d" aria-invalid={!workspaceId ? true : undefined}>
            {workspaces.length === 0 && <option value="">Nenhum workspace cadastrado</option>}
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.displayName || w.name}</option>)}
          </select>
          {!workspaces.length && <span className="fl-err" role="alert">Cadastre um workspace antes de abrir o Planejador.</span>}
        </label>
        <fieldset className="fl-sched">
          <legend className="fl-label">Agente do Planejador <span className="dim">(opcional)</span></legend>
          <div className="fl-brief-grid">
            <label>Agente
              <select value={provider} onChange={(e) => pickProvider(e.target.value)}>
                {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
              </select>
            </label>
            <label>Modelo
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">padrão do agente</option>
                {po.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label>Esforço
              <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">padrão do agente</option>
                {po.efforts.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
          {mine.length > 1 && (
            <label>Conta do {PROVIDER_LABEL[provider]}
              <select value={account ?? ''} onChange={(e) => setChosenAccount(e.target.value)} aria-invalid={!account ? true : undefined}>
                {!account && <option value="">Escolher conta…</option>}
                {mine.map((a) => <option key={a.id} value={a.id}>{a.label}{a.home === 'machine' ? ' (deste computador)' : ''}</option>)}
              </select>
              {!account && <span className="dim">Há mais de uma conta do {PROVIDER_LABEL[provider]}: escolha qual o Planejador usa.</span>}
            </label>
          )}
        </fieldset>
        {needsAck && (
          <div className="fl-callout fl-brief-cfg" role="alert">
            <p id="fl-brief-cfg-d"><b>Atenção:</b> {BRIEFING_CONFIG_TEXT}</p>
            {cfg.files.length > 0
              ? <ul className="fl-brief-cfg-l" tabIndex={0} aria-label="Arquivos de configuração não revisados">{cfg.files.map((f, i) => <li key={`${i}:${f}`}><code>{f}</code></li>)}</ul>
              : <p className="dim">O servidor não informou os arquivos.</p>}
            <label className="fl-check">
              <input ref={cfgBox} type="checkbox" checked={cfgOk} onChange={(e) => setCfgOk(e.target.checked)} aria-describedby="fl-brief-cfg-d" />
              <span>Revisei e confio nesses arquivos: abrir o Planejador nesta pasta mesmo assim.</span>
            </label>
          </div>
        )}
        {error && <p className="fl-note err" role="alert">{error}</p>}
        <div className="fl-form-foot">
          <button type="button" className="fl-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className={`fl-btn fl-btn-primary${busy ? ' is-busy' : ''}`} disabled={busy || !workspaceId || (needsAck && !cfgOk)}>{busy ? <i className="fl-spin" aria-hidden="true" /> : <Icon name="planner" size={13} />}<span>{needsAck ? 'Confirmar e abrir o Planejador' : 'Abrir o Planejador'}</span></button>
        </div>
      </form>
    </Dialog>
  );
}
