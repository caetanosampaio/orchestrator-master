import React, { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { Icon } from './ui.jsx';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import {
  addStep, ancestorKeys, blocksImplicitSubmit, draftToBody, draftToScheduleBody, emptyDraft, flowToDraft, stepRoles, MAX_EVERY_HOURS, MAX_STEPS, MAX_TEXT, MAX_TITLE, patchStep, proposalNoticeLines, proposalToDraft,
  PROVIDER_LABEL, STEP_PROVIDERS, removeStep, toggleDependency, toggleScheduleDay, validateDraft, validateScheduleDraft, WEEKDAY_SHORT,
  MAX_VERIFY_TEXT, VERIFY_SHELL_HINT, VERIFY_TIMEOUT_MAX, VERIFY_TIMEOUT_MIN, verifyShellOps, accountRows, setDraftAccount,
} from '../flows-view.js';

/**
 * Conta de cada provedor usado nas etapas (Contas v2): todos os terminais da missão daquele provedor nascem nela e o gasto entra no limite dela.
 * Uma conta só = automática; várias = escolha obrigatória (pré-seleciona a última usada); nenhuma = aviso para adicionar em Contas.
 */
function AccountsPicker({ rows, onPick, errOf }) {
  if (!rows.length) return null;
  const errs = errOf('accounts');
  return (
    <fieldset className="fl-sched fl-accounts">
      <legend className="fl-label">Contas da missão</legend>
      <p className="dim">Cada IA usa UMA conta em todas as etapas dela; os tokens entram no limite dessa conta.</p>
      {rows.map((r) => (
        <label key={r.provider} className="fl-acc-row">
          <span className="fl-acc-p"><ProviderLogo id={r.provider} size={13} />{r.label}</span>
          {r.options.length > 0 ? (
            <select value={r.value} onChange={(e) => onPick(r.provider, e.target.value)} aria-invalid={r.state === 'choose' || r.state === 'missing' ? true : undefined} aria-label={`Conta do ${r.label} na missão`}>
              {(r.state === 'choose' || r.state === 'missing') && <option value="">Escolher conta…</option>}
              {r.state === 'auto' && <option value="">Automática ({r.options[0].label})</option>}
              {r.options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.home === 'machine' ? ' (deste computador)' : ''}</option>)}
            </select>
          ) : null}
          {r.hint && <span className={r.state === 'none' || r.state === 'missing' ? 'fl-hint warn' : 'dim'}>{r.hint}</span>}
        </label>
      ))}
      {errs.length > 0 && <span className="fl-err" role="alert">{errs[0]}</span>}
    </fieldset>
  );
}

/**
 * Avisos de proposta do Planejador dentro do formulário. Nada substitui o que está na tela sozinho: "carregar" e "abrir" só com o clique, e com confirmação se o
 * formulário já foi mexido. `notices` vem de proposalNotices (flows-view.js).
 */
function ProposalNotices({ proposal, notices, onSwap }) {
  const { newer = null, others = [], pending = false } = notices ?? {};
  if (!proposal && !others.length) return null;
  const lines = proposal ? proposalNoticeLines(proposal) : [];
  return (
    <>
      {/* o foco inicial do formulário da proposta fica AQUI (não editável): nada digitado por engano cai num campo */}
      {proposal && <div className="fl-callout fl-prop-notice" role="note" tabIndex={-1} data-autofocus>{lines.map((t) => <p key={t}><b>{t}</b></p>)}</div>}
      {newer && (
        <div className="fl-callout fl-prop-swap" role="status">
          <span>O Planejador enviou uma versão nova desta proposta — carregar? <span className="dim">Carregar troca o que está neste formulário.</span></span>
          <button type="button" className="fl-btn" onClick={() => onSwap(newer)}>Carregar versão nova</button>
        </div>
      )}
      {proposal && !newer && !pending && <p className="fl-hint" role="note">Esta proposta não está mais pendente (foi usada, descartada ou expirou). Você ainda pode criar a missão com o que está aqui.</p>}
      {others.slice(0, 3).map((r) => (
        <div key={r.id} className="fl-callout fl-prop-swap" role="status">
          <span>Nova proposta do Planejador: “{r.title}”{r.workspaceName ? <span className="dim"> · {r.workspaceName}</span> : null}</span>
          <button type="button" className="fl-btn" onClick={() => onSwap(r)} aria-label={`Abrir a proposta “${r.title}” no lugar deste formulário`}>Abrir</button>
        </div>
      ))}
    </>
  );
}

// presets da agenda (docs/missions-v2-fatia2.md, A): o rascunho guarda os campos de todos, então trocar de preset não perde o que foi digitado
const SCHEDULE_PRESETS = [{ id: 'interval', label: 'A cada N horas' }, { id: 'daily', label: 'Todo dia, num horário' }, { id: 'weekly', label: 'Dias da semana, num horário' }];

/** Tipo da missão: projeto (você inicia) ou automação (roda pela agenda). Radios num fieldset: setas trocam a opção. */
function KindPicker({ kind, onChange, disabled }) {
  return (
    <fieldset className="fl-kind" disabled={disabled}>
      <legend className="fl-label">Tipo</legend>
      <label className="fl-check"><input type="radio" name="fl-kind" value="project" checked={kind !== 'automation'} onChange={() => onChange('project')} /><span><b>Projeto</b> <span className="dim">— você inicia quando quiser</span></span></label>
      <label className="fl-check"><input type="radio" name="fl-kind" value="automation" checked={kind === 'automation'} onChange={() => onChange('automation')} /><span><b>Automação</b> <span className="dim">— roda sozinha pela agenda</span></span></label>
    </fieldset>
  );
}

/** Agenda da automação: ligada/desligada, preset e os campos do preset. Os erros vêm de validateScheduleDraft (as mesmas regras do servidor). */
function ScheduleEditor({ sd, onChange, fullAccess, errOf }) {
  const set = (patch) => onChange({ ...sd, ...patch });
  const E = (f) => { const m = errOf(f); return m.length ? <span className="fl-err" role="alert">{m[0]}</span> : null; };
  return (
    <fieldset className="fl-sched">
      <legend className="fl-label">Agenda</legend>
      <label className="fl-check"><input type="checkbox" checked={sd.enabled === true} onChange={(e) => set({ enabled: e.target.checked })} /><span><b>Agenda ligada</b> <span className="dim">(desligada, a automação só roda quando você clicar em Iniciar)</span></span></label>
      <div className="fl-grid2">
        <label>Frequência
          <select value={sd.kind} onChange={(e) => set({ kind: e.target.value })} aria-invalid={errOf('schedule.kind').length ? true : undefined}>
            {SCHEDULE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {E('schedule.kind')}
        </label>
        {sd.kind === 'interval' ? (
          <label>Intervalo (horas)
            <input type="number" inputMode="numeric" min={1} max={MAX_EVERY_HOURS} step={1} value={sd.everyHours ?? ''} onChange={(e) => set({ everyHours: e.target.value === '' ? '' : Number(e.target.value) })} aria-invalid={errOf('schedule.everyHours').length ? true : undefined} />
            {E('schedule.everyHours')}
          </label>
        ) : (
          <label>Horário (local)
            <input type="time" step={60} value={sd.time ?? ''} onChange={(e) => set({ time: e.target.value.slice(0, 5) })} aria-invalid={errOf('schedule.time').length ? true : undefined} />
            {E('schedule.time')}
          </label>
        )}
      </div>
      {sd.kind === 'weekly' && (
        <div className="fl-days" role="group" aria-labelledby="fl-days-l">
          <span id="fl-days-l" className="fl-label">Dias</span>
          <div className="fl-days-l">
            {WEEKDAY_SHORT.map((name, day) => (
              <label key={name} className="fl-check"><input type="checkbox" checked={(sd.days ?? []).includes(day)} onChange={() => onChange(toggleScheduleDay(sd, day))} /><span>{name}</span></label>
            ))}
          </div>
          {E('schedule.days')}
        </div>
      )}
      <p className="fl-hint" role="note">Roda só com o FORGE aberto; horários perdidos são pulados.</p>
      {!fullAccess && <p className="fl-hint warn" role="note">Sem acesso total, a automação pode parar pedindo permissão sem ninguém olhando.</p>}
    </fieldset>
  );
}

/** Política sem ninguém olhando: automação + acesso total + integração automática. Só avisa (o padrão não muda). */
const UNATTENDED_POLICY_WARNING = 'Esta automação roda sozinha com acesso total e integra na sua branch sem ninguém olhando (só sem conflito e com a pasta limpa). Desmarque a integração automática se quiser revisar antes.';

/** Integração automática na branch do workspace (padrão ligado; desligável por missão). `unattended` = automação com acesso total: mostra o aviso de política com a caixa marcada. */
function AutoIntegrate({ checked, onChange, unattended = false }) {
  const warn = unattended && checked;
  return (
    <div className="fl-autoint">
      <label className="fl-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={warn ? 'fl-autoint-d fl-autoint-w' : 'fl-autoint-d'} />
        <span><b>Integrar automaticamente na sua branch quando terminar sem conflitos</b></span>
      </label>
      <p id="fl-autoint-d" className="fl-hint">Em workspace Git, cada etapa trabalha numa cópia isolada (só arquivos versionados; alterações não commitadas na sua pasta não entram). Sua pasta só muda na integração final, e só se estiver limpa.{!checked && ' Desligada, a execução termina “pronta para integrar” e espera você.'}</p>
      {warn && <p id="fl-autoint-w" className="fl-policy-warn" role="note"><b>Atenção:</b> {UNATTENDED_POLICY_WARNING}</p>}
    </div>
  );
}

/**
 * Envio automático ao remoto (padrão desligado): depois da integração final, só com o comando de verificação aprovado. Sem verificação o interruptor fica travado (o servidor também recusa).
 * Nenhuma IA envolvida: é o Git desta máquina, com as credenciais dela.
 */
function AutoPush({ checked, onChange, hasVerify, errOf }) {
  const errs = errOf('autoPush');
  return (
    <div className="fl-autoint">
      <label className="fl-check">
        <input type="checkbox" checked={checked} disabled={!hasVerify && !checked} onChange={(e) => onChange(e.target.checked)} aria-describedby="fl-autopush-d" aria-invalid={errs.length ? true : undefined} />
        <span><b>Enviar para o remoto (push) depois de integrar</b> <span className="dim">(só com a verificação aprovada)</span></span>
      </label>
      <p id="fl-autopush-d" className="fl-hint">
        {hasVerify
          ? 'Depois da integração final, o commit integrado vai para a branch remota que a sua acompanha (ex.: origin/main), sem forçar. Se a verificação não passar, ou o remoto tiver commits que você não tem, nada é enviado e a missão mostra Enviar agora.'
          : 'Defina um comando de verificação abaixo para liberar: o envio automático só acontece depois de ele passar.'}
      </p>
      {errs.length > 0 && <span className="fl-err" role="alert">{errs[0]}</span>}
    </div>
  );
}

/**
 * Comando de verificação opcional (ex.: npm test): roda numa cópia isolada da branch da missão antes da integração final automática (modo Git); só integra se passar.
 * Sem shell: o texto vira uma lista de argumentos (tokenizeCommand). Operadores de shell digitados só geram aviso (iriam como argumentos literais).
 */
function VerifyEditor({ text, timeout, onChange, errOf }) {
  const E = (f) => { const m = errOf(f); return m.length ? <span className="fl-err" role="alert">{m[0]}</span> : null; };
  const ops = verifyShellOps(text), on = text.trim() !== '';
  return (
    <fieldset className="fl-verify">
      <legend className="fl-label">Verificação antes de integrar <span className="dim">(opcional)</span></legend>
      <div className="fl-grid-verify">
        <label>Comando de verificação
          <input className="mono" value={text} maxLength={MAX_VERIFY_TEXT} spellCheck={false} autoComplete="off" placeholder="Ex.: npm test" onChange={(e) => onChange({ verifyText: e.target.value })}
            aria-describedby={`fl-verify-d fl-verify-h${ops.length ? ' fl-verify-w' : ''}`} aria-invalid={errOf('verifyText').length ? true : undefined} />
          {E('verifyText')}
        </label>
        <label>Tempo limite (s)
          <input type="number" inputMode="numeric" min={VERIFY_TIMEOUT_MIN} max={VERIFY_TIMEOUT_MAX} step={1} value={timeout ?? ''} disabled={!on}
            onChange={(e) => onChange({ verifyTimeout: e.target.value === '' ? '' : Number(e.target.value) })} aria-invalid={errOf('verifyTimeout').length ? true : undefined} />
          {E('verifyTimeout')}
        </label>
      </div>
      <p id="fl-verify-d" className="fl-hint">Em workspace Git, antes da integração final automática o comando roda numa cópia isolada da branch da missão. Só integra se passar; se falhar, a execução fica “pronta para integrar” com o fim da saída. Vazio = sem verificação. Atenção: o comando executa o código da missão, inclusive scripts do package.json e testes que os agentes tenham alterado, com o seu usuário e sem revisão prévia desses arquivos.</p>
      <p id="fl-verify-h" className="fl-hint" role="note">{VERIFY_SHELL_HINT}</p>
      {ops.length > 0 && <p id="fl-verify-w" className="fl-hint warn" role="note">O comando tem {ops.map((o, i) => <React.Fragment key={o}>{i ? ' ' : ''}<code>{o}</code></React.Fragment>)}: sem shell, isso vai como argumento do programa e não como operador.</p>}
    </fieldset>
  );
}

/** Modelos e esforços de cada provedor (listas fechadas do servidor, em /api/team-templates). Sem resposta: só "padrão do agente" (nada é inventado). Também usado no diálogo do briefing. */
export function useProviderOptions() {
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
            {STEP_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
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

/**
 * Formulário "Nova missão" / "Editar missão": tipo, título, objetivo, workspace, acesso total (com aviso), paralelismo, agenda (automação), integração automática e o editor de etapas.
 * `mode = 'schedule'`: formulário reduzido para a missão com execução ativa, quando o servidor só aceita mudar agenda e integração automática (PATCH só com esses campos).
 * O servidor valida de novo.
 * `proposal` (só no create): proposta do Planejador já validada pelo servidor; o formulário nasce preenchido (proposalToDraft: acesso total desligado) e o create leva o
 * `proposalId`. `notices`/`onOpenProposal`: avisos de propostas que chegaram com o formulário aberto (nunca abrem por cima sozinhas). `onDismissProposal`: Descartar proposta.
 * Na proposta o foco começa no aviso (não num campo) e Enter num campo não envia: a criação é sempre um clique em "Criar missão".
 */
export default function FlowForm({ mode = 'create', flow = null, workspaces, activeWorkspaceId, roles, onClose, onSubmit, proposal = null, notices = null, onOpenProposal = null, onDismissProposal = null }) {
  const reduced = mode === 'schedule';
  const [draft, setDraft] = useState(() => ((mode === 'edit' || reduced) && flow ? flowToDraft(flow)
    : mode === 'create' && proposal ? proposalToDraft(proposal)
      : emptyDraft({ workspaceId: activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId) ? activeWorkspaceId : workspaces[0]?.id ?? '' })));
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [tried, setTried] = useState(false), [dismissing, setDismissing] = useState(false);
  const fromProposal = mode === 'create' && !!proposal;
  // "mexido" = diferente do que abriu: trocar por outra proposta pede confirmação antes de jogar fora o que o usuário digitou
  const initial = useRef(null); if (initial.current === null) initial.current = JSON.stringify(draft);
  const swap = (row) => {
    if (!onOpenProposal) return;
    if (JSON.stringify(draft) !== initial.current && !window.confirm('Abrir a proposta substitui o que você preencheu neste formulário. Continuar?')) return;
    onOpenProposal(row);
  };
  const dismiss = async () => {
    if (!fromProposal || !onDismissProposal || dismissing) return;
    if (!window.confirm('Descartar esta proposta? O formulário fecha e nada é criado. O terminal do Planejador continua aberto e pode enviar outra.')) return;
    setDismissing(true); setError(null);
    try { await onDismissProposal(proposal.id); } catch (err) { setError(err.message); setDismissing(false); }
  };
  const opts = useProviderOptions();
  const { accounts, lastAccount } = useStore(); // contas (só nomes) e a última usada por provedor: o seletor de conta da missão
  const accOpts = { accounts, lastUsed: lastAccount };
  const accRows = useMemo(() => accountRows(draft, accounts, lastAccount), [draft, accounts, lastAccount]);
  const roleList = stepRoles(roles); // sem Maestro e Planejador (o servidor recusa esses papéis numa etapa)
  // no modo reduzido só a agenda é conferida (o resto não vai no PATCH)
  const check = useMemo(() => (reduced ? (draft.kind === 'automation' ? validateScheduleDraft(draft.schedule) : { ok: true, errors: [] }) : validateDraft(draft, { mode, accounts, lastUsed: lastAccount })), [draft, mode, reduced, accounts, lastAccount]);
  const fieldErr = (f) => (tried ? check.errors.filter((e) => e.field === f).map((e) => e.message) : []);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const change = (key, patch) => setDraft((d) => (patch.__toggle ? toggleDependency(d, key, patch.__toggle) : patchStep(d, key, patch)));
  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!check.ok || busy) return;
    setBusy(true); setError(null);
    try { await onSubmit(reduced ? draftToScheduleBody(draft) : draftToBody(draft, { mode, proposalId: fromProposal ? proposal.id : null, ...accOpts })); } catch (err) { setError(err.message); setBusy(false); }
  };
  const E = (f) => { const m = fieldErr(f); return m.length ? <span className="fl-err" role="alert">{m[0]}</span> : null; };
  const auto = draft.kind === 'automation';
  const foot = (
    <>
      {error && <p className="fl-note err" role="alert">{error}</p>}
      {tried && !check.ok && <p className="fl-note err" role="alert">Corrija os campos marcados para continuar.</p>}
      <div className="fl-form-foot">
        {fromProposal && onDismissProposal && (
          <button type="button" className="fl-btn fl-btn-danger fl-foot-left" onClick={dismiss} disabled={dismissing || busy}>{dismissing ? <i className="fl-spin" aria-hidden="true" /> : null}<span>Descartar proposta</span></button>
        )}
        <button type="button" className="fl-btn" onClick={onClose}>Cancelar</button>
        <button type="submit" className={`fl-btn fl-btn-primary${busy ? ' is-busy' : ''}`} disabled={busy}>{busy ? <i className="fl-spin" aria-hidden="true" /> : null}<span>{mode === 'create' ? 'Criar missão' : 'Salvar alterações'}</span></button>
      </div>
    </>
  );
  if (reduced) {
    return (
      <Dialog title={auto ? 'Editar agenda' : 'Editar integração'} onClose={onClose} id="flow-form" size="lg">
        <form className="fl-form" onSubmit={submit} noValidate>
          <ProposalNotices proposal={null} notices={notices} onSwap={swap} />
          <p className="dim fl-form-lead">A missão “{flow?.title}” tem uma execução ativa: agora só a agenda, a integração automática e o envio automático podem mudar. O resto fica para quando a execução terminar. Mudar a agenda recalcula a próxima execução a partir de agora.</p>
          {auto && <ScheduleEditor sd={draft.schedule} onChange={(schedule) => set({ schedule })} fullAccess={draft.fullAccess} errOf={fieldErr} />}
          <AutoIntegrate checked={draft.autoIntegrate === true} onChange={(v) => set({ autoIntegrate: v })} unattended={auto && draft.fullAccess === true} />
          <AutoPush checked={draft.autoPush === true} onChange={(v) => set({ autoPush: v })} hasVerify={!!String(draft.verifyText ?? '').trim()} errOf={fieldErr} />
          {foot}
        </form>
      </Dialog>
    );
  }
  return (
    <Dialog title={mode === 'edit' ? 'Editar missão' : fromProposal ? 'Nova missão (proposta do Planejador)' : 'Nova missão'} onClose={onClose} id="flow-form" size="lg">
      {/* proposta: Enter num campo não envia (só o botão Criar missão); ver blocksImplicitSubmit */}
      <form className="fl-form" onSubmit={submit} onKeyDown={fromProposal ? (e) => { if (blocksImplicitSubmit(e)) e.preventDefault(); } : undefined} noValidate>
        <ProposalNotices proposal={fromProposal ? proposal : null} notices={notices} onSwap={swap} />
        <p className="dim fl-form-lead">Cada etapa roda um agente de CLI num terminal real do Cockpit, com as suas permissões. Você acompanha o workflow aqui e pode abrir qualquer terminal.</p>
        <KindPicker kind={draft.kind} onChange={(kind) => set({ kind })} />
        {E('kind')}
        <label>Nome<input data-autofocus={fromProposal ? undefined : true} value={draft.title} maxLength={MAX_TITLE} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Corrigir o login com Google" aria-invalid={fieldErr('title').length ? true : undefined} />{E('title')}</label>
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
            {draft.maxParallel > 1 && <span className="dim">Em workspace Git, cada etapa roda numa cópia isolada e o paralelo vale para todas. Sem Git, etapas de Construtor (que editam arquivos) rodam uma por vez na pasta do workspace; o paralelo vale para revisão e investigação.</span>}
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

        {auto && <ScheduleEditor sd={draft.schedule} onChange={(schedule) => set({ schedule })} fullAccess={draft.fullAccess} errOf={fieldErr} />}
        <AutoIntegrate checked={draft.autoIntegrate === true} onChange={(v) => set({ autoIntegrate: v })} unattended={auto && draft.fullAccess === true} />
        <VerifyEditor text={draft.verifyText ?? ''} timeout={draft.verifyTimeout} onChange={set} errOf={fieldErr} />
        <AutoPush checked={draft.autoPush === true} onChange={(v) => set({ autoPush: v })} hasVerify={!!String(draft.verifyText ?? '').trim()} errOf={fieldErr} />

        <section aria-label="Etapas" className="fl-steps">
          <p className="fl-label">Etapas <span className="fl-count">{draft.steps.length}/{MAX_STEPS}</span></p>
          {draft.steps.map((s, i) => (
            <StepEditor key={s.key} draft={draft} step={s} index={i} roles={roleList} opts={opts} errors={tried ? check.byStep[s.key] : null}
              onChange={(p) => change(s.key, p)} onRemove={() => setDraft((d) => removeStep(d, s.key))} canRemove={draft.steps.length > 1} />
          ))}
          {E('steps')}
          <button type="button" className="fl-btn" onClick={() => setDraft((d) => addStep(d))} disabled={draft.steps.length >= MAX_STEPS}><Icon name="plus" size={13} /><span>Adicionar etapa</span></button>
        </section>

        <AccountsPicker rows={accRows} onPick={(p, id) => setDraft((d) => setDraftAccount(d, p, id))} errOf={fieldErr} />

        {foot}
      </form>
    </Dialog>
  );
}
