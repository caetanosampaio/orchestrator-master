import React, { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Icon } from './ui.jsx';
import { api } from '../api.js';
import { addStep, ancestorKeys, draftToBody, emptyDraft, FALLBACK_ROLES, flowToDraft, MAX_STEPS, MAX_TEXT, MAX_TITLE, patchStep, PROVIDER_LABEL, PROVIDERS, removeStep, toggleDependency, validateDraft } from '../flows-view.js';

/** Modelos e esforços de cada provedor (listas fechadas do servidor, em /api/team-templates). Sem resposta: só "padrão do agente" (nada é inventado). */
function useProviderOptions() {
  const [opts, setOpts] = useState({});
  useEffect(() => {
    let alive = true;
    api.get('/api/team-templates').then((d) => { if (alive && d?.options && typeof d.options === 'object') setOpts(d.options); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return opts;
}

function StepEditor({ draft, step, index, roles, opts, errors, onChange, onRemove, canRemove }) {
  const earlier = draft.steps.slice(0, index), chain = [...ancestorKeys(draft, step.key)].map((k) => draft.steps.find((s) => s.key === k)).filter(Boolean);
  const po = opts[step.provider] ?? { models: [], efforts: [] };
  const id = `fl-s-${step.key}`;
  return (
    <fieldset className={`fl-step${errors?.length ? ' bad' : ''}`}>
      <legend><span className="fl-step-n">{String(index + 1).padStart(2, '0')}</span> Etapa {index + 1}</legend>
      <label>Título<input value={step.title} maxLength={MAX_TITLE} onChange={(e) => onChange({ title: e.target.value })} placeholder="Ex.: Implementar o login" /></label>
      <label>O que o agente deve fazer
        <textarea value={step.prompt} maxLength={MAX_TEXT} rows={4} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="Texto enviado ao agente no terminal. Diga o resultado esperado e como saber que terminou." />
        <span className="dim">{step.prompt.length}/{MAX_TEXT}</span>
      </label>
      <div className="fl-grid4">
        <label>Agente
          <select value={step.provider} onChange={(e) => { const p = e.target.value, o = opts[p] ?? { models: [], efforts: [] }; onChange({ provider: p, model: o.models.some((m) => m.id === step.model) ? step.model : '', effort: o.efforts.some((x) => x.id === step.effort) ? step.effort : '' }); }}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </select>
        </label>
        <label>Papel
          <select value={step.role} onChange={(e) => onChange({ role: e.target.value })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label>Modelo
          <select value={step.model} onChange={(e) => onChange({ model: e.target.value })}>
            <option value="">padrão do agente</option>
            {po.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label>Esforço
          <select value={step.effort} onChange={(e) => onChange({ effort: e.target.value })}>
            <option value="">padrão do agente</option>
            {po.efforts.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
      {index > 0 && (
        <div className="fl-deps" role="group" aria-labelledby={`${id}-dep`}>
          <span id={`${id}-dep`} className="fl-label">Depende de <span className="dim">(sem marcar nada, roda em paralelo com as outras)</span></span>
          <div className="fl-deps-l">
            {earlier.map((s, i) => (
              <label key={s.key} className="fl-check">
                <input type="checkbox" checked={step.dependsOn.includes(s.key)} onChange={() => onChange({ __toggle: s.key })} />
                <span>{String(i + 1).padStart(2, '0')} {s.title.trim() || 'sem título'}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {chain.length > 0 && (
        <label>Terminal
          <select value={step.continueFrom} onChange={(e) => onChange({ continueFrom: e.target.value })}>
            <option value="">abrir um terminal novo</option>
            {chain.map((s) => <option key={s.key} value={s.key}>continuar o terminal de “{s.title.trim() || 'sem título'}”</option>)}
          </select>
        </label>
      )}
      {errors?.length > 0 && <ul className="fl-errs" role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      {canRemove && <button type="button" className="fl-btn fl-btn-ghost fl-step-rm" onClick={onRemove}><Icon name="close" size={12} /><span>Remover etapa {index + 1}</span></button>}
    </fieldset>
  );
}

/** Formulário "Nova missão" (ou "Editar missão"): título, objetivo, workspace, acesso total (com aviso), paralelismo e o editor de etapas. O servidor valida de novo. */
export default function FlowForm({ mode = 'create', flow = null, workspaces, activeWorkspaceId, roles, onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => (mode === 'edit' && flow ? flowToDraft(flow)
    : emptyDraft({ workspaceId: activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id ?? '' })));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [tried, setTried] = useState(false);
  const opts = useProviderOptions();
  const roleList = roles?.length ? roles : FALLBACK_ROLES;
  const check = useMemo(() => validateDraft(draft, { mode }), [draft, mode]);
  const fieldErr = (f) => (tried ? check.errors.filter((e) => e.field === f).map((e) => e.message) : []);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const change = (key, patch) => setDraft((d) => (patch.__toggle ? toggleDependency(d, key, patch.__toggle) : patchStep(d, key, patch)));
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!check.ok || busy) return;
    setBusy(true); setError(null);
    try { await onSubmit(draftToBody(draft, { mode })); } catch (err) { setError(err.message); setBusy(false); }
  };
  const E = (f) => { const m = fieldErr(f); return m.length ? <span className="fl-err" role="alert">{m[0]}</span> : null; };
  return (
    <Dialog title={mode === 'edit' ? 'Editar missão' : 'Nova missão'} onClose={onClose} id="flow-form" size="lg">
      <form className="fl-form" onSubmit={submit} noValidate>
        <p className="dim fl-form-lead">Cada etapa roda um agente de CLI num terminal real do Cockpit, com as suas permissões. Você acompanha o workflow aqui e pode abrir qualquer terminal.</p>
        <label>Nome<input data-autofocus value={draft.title} maxLength={MAX_TITLE} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Corrigir o login com Google" aria-invalid={fieldErr('title').length ? true : undefined} />{E('title')}</label>
        <label>Objetivo <span className="dim">(entra no início do texto de cada etapa)</span>
          <textarea value={draft.goal} maxLength={MAX_TEXT} rows={3} onChange={(e) => set({ goal: e.target.value })} placeholder="O que deve ficar pronto, restrições e como saber que terminou." /><span className="dim">{draft.goal.length}/{MAX_TEXT}</span>{E('goal')}
        </label>
        <div className="fl-grid2">
          <label>Workspace
            <select value={draft.workspaceId} onChange={(e) => set({ workspaceId: e.target.value })} disabled={mode === 'edit'}>
              {workspaces.length === 0 && <option value="">Nenhum workspace cadastrado</option>}
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.displayName || w.name}</option>)}
            </select>
            {E('workspaceId')}
            {mode === 'edit' && <span className="dim">O workspace não muda depois de criada.</span>}
          </label>
          <label>Etapas em paralelo
            <select value={draft.maxParallel} onChange={(e) => set({ maxParallel: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? '1 (uma por vez)' : `até ${n}`}</option>)}
            </select>
          </label>
        </div>

        <div className={`fl-access${draft.fullAccess ? ' on' : ''}`}>
          <label className="fl-check fl-access-l">
            <input type="checkbox" checked={draft.fullAccess} onChange={(e) => set({ fullAccess: e.target.checked })} aria-describedby="fl-access-warn" />
            <span><b>Acesso total</b> <span className="dim">(sem pedir confirmação)</span></span>
          </label>
          <p id="fl-access-warn" className="fl-access-warn" role="note">
            <b>Atenção:</b> com acesso total o agente roda SEM pedir confirmação e pode editar arquivos e executar comandos no seu computador. Só marque se você confia nas etapas escritas abaixo.
            {!draft.fullAccess && <span className="dim"> Desligado, o agente pede permissão no terminal e a etapa fica “aguardando você”.</span>}
          </p>
        </div>

        <section aria-label="Etapas" className="fl-steps">
          <p className="fl-label">Etapas <span className="fl-count">{draft.steps.length}/{MAX_STEPS}</span></p>
          {draft.steps.map((s, i) => (
            <StepEditor key={s.key} draft={draft} step={s} index={i} roles={roleList} opts={opts} errors={tried ? check.byStep[s.key] : null}
              onChange={(p) => change(s.key, p)} onRemove={() => setDraft((d) => removeStep(d, s.key))} canRemove={draft.steps.length > 1} />
          ))}
          {E('steps')}
          <button type="button" className="fl-btn" onClick={() => setDraft((d) => addStep(d))} disabled={draft.steps.length >= MAX_STEPS}><Icon name="plus" size={13} /><span>Adicionar etapa</span></button>
        </section>

        {error && <p className="fl-note err" role="alert">{error}</p>}
        {tried && !check.ok && <p className="fl-note err" role="alert">Corrija os campos marcados para continuar.</p>}
        <div className="fl-form-foot">
          <button type="button" className="fl-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className={`fl-btn fl-btn-primary${busy ? ' is-busy' : ''}`} disabled={busy}>{busy ? <i className="fl-spin" aria-hidden="true" /> : null}<span>{mode === 'edit' ? 'Salvar alterações' : 'Criar missão'}</span></button>
        </div>
      </form>
    </Dialog>
  );
}
