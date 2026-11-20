import React, { useState } from 'react';
import { Icon } from './ui.jsx';
import Dialog from './Dialog.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { currentRun, flowProgress, flowState, FLOW_STATE_META, integrationInfo, KIND_LABEL, LEFTOVERS_HINT, NOT_INFORMED, nextRunLabel, runActions, runDuration, runGitNotes, fmtDuration, fmtWhen, runStepMeta, scheduleLabel } from '../flows-view.js';

const GLYPH = { ok: 'done', skip: 'off' }; // tom de missão/etapa -> glifo do shell (os outros tons têm o mesmo nome)
export const toneGlyph = (tone) => GLYPH[tone] ?? tone;

/** Estado (missão, etapa ou run) como no Cockpit: o glifo animado do shell e o texto, num selo neutro. O texto diz o estado; o glifo só reforça. */
export function StateTag({ tone, label, className = '' }) {
  return <span className={`fl-state fl-t-${tone}${className ? ` ${className}` : ''}`}><StatusGlyph state={toneGlyph(tone)} size={12} />{label}</span>;
}

/**
 * Botões da decisão humana sobre uma etapa que parou sem confirmar: aceitar conclui, continuar manda o agente seguir na mesma conversa, recusar falha e pula os dependentes.
 * `limit` (parou no limite de uso da conta): o trabalho pode estar pela metade, então Continuar é a ação principal e aceitar vira "Já terminou". A principal fica por último.
 */
export function StepDecision({ onDecide, busy, disabled = false, title, limit = false }) {
  const off = disabled || !!busy; // uma decisão por vez (a página ignora cliques enquanto outra está em curso)
  const btn = (decision, kind, label, { icon = null, hint } = {}) => (
    <button type="button" className={`fl-btn${kind ? ` fl-btn-${kind}` : ''}`} onClick={() => onDecide(decision)} disabled={off} aria-busy={busy === decision || undefined} title={hint}>
      {busy === decision ? <Busy on /> : icon ? <Icon name={icon} size={12} /> : null}<span>{label}</span>
    </button>
  );
  return (
    <span className="fl-decide" role="group" aria-label={`Decidir a etapa ${title}`}>
      {btn('reject', 'ghost', 'Recusar', { hint: 'A etapa fica como falha e as que dependem dela são puladas' })}
      {limit ? (
        <>
          {btn('accept', '', 'Já terminou', { icon: 'check', hint: 'Aceitar como concluída: o agente terminou antes do limite' })}
          {btn('continue', 'primary', 'Continuar', { icon: 'play', hint: 'O agente segue de onde parou, na mesma conversa' })}
        </>
      ) : (
        <>
          {btn('continue', '', 'Pedir para continuar', { icon: 'play', hint: 'O agente segue de onde parou, na mesma conversa' })}
          {btn('accept', 'primary', 'Aceitar como concluída', { icon: 'check' })}
        </>
      )}
    </span>
  );
}

/** Ponto de estado de um item do aviso (pulsa com movimento permitido). Decorativo: o texto ao lado diz o que é. */
const AttnDot = () => <span className="fl-attn-dot" aria-hidden="true" />;

const MAX_LIST = 30; // listas longas de arquivos não empurram os botões para fora da tela
/** Lista curta de caminhos (texto puro; o React escapa). Passou do limite: "e mais N". */
export function FileList({ files, label, max = MAX_LIST }) {
  if (!files?.length) return null;
  const shown = files.slice(0, max), rest = files.length - shown.length;
  return (
    <div className="fl-files">
      <span className="fl-files-l">{label}</span>
      <ul>{shown.map((f) => <li key={f}><code>{f}</code></li>)}{rest > 0 && <li className="dim">e mais {rest}</li>}</ul>
    </div>
  );
}

/**
 * Integração de etapa travada (conflito, bloqueio ou erro): o que aconteceu, onde resolver e as ações. Usado no aviso do topo e no painel da etapa.
 * O texto vem de `stepIntegration().message` (pela causa do servidor): só o bloqueio do guard de configuração (`needsAck`) fala em arquivos sensíveis e pede confirmação.
 */
export function IntegrationProblem({ p, onRetry, onDiscardStep, onOpenTerminal, busy, canAct = true }) {
  const retryKey = `step:${p.stepId}:retry`, discardKey = `step:${p.stepId}:discard`;
  return (
    <>
      {p.message && <p className="fl-int-msg">{p.message}</p>}
      <FileList files={p.conflicts} label="Arquivos em conflito" />
      <FileList files={p.files} label={p.needsAck ? 'Configuração ou arquivos sensíveis alterados' : 'Arquivos'} />
      {p.worktreePath && (
        <p className="fl-path">Pasta da etapa: <code>{p.worktreePath}</code><br />Resolva os conflitos nessa pasta, commite e clique em Tentar de novo.</p>
      )}
      {canAct ? (
        <span className="fl-decide" role="group" aria-label={`Resolver a integração da etapa ${p.title}`}>
          <button type="button" className="fl-btn fl-btn-primary" onClick={() => onRetry(p)} disabled={!!busy}><Busy on={busy === retryKey} /><Icon name="refresh" size={12} /><span>Tentar de novo</span></button>
          <button type="button" className="fl-btn fl-btn-ghost" onClick={() => onDiscardStep(p)} disabled={!!busy}><Busy on={busy === discardKey} /><span>Descartar etapa</span></button>
          {p.terminalId && onOpenTerminal && <button type="button" className="fl-btn" onClick={() => onOpenTerminal(p.terminalId)}><Icon name="terminal" size={13} /><span>Abrir terminal</span></button>}
        </span>
      ) : <p className="fl-hint">Retome a missão para tentar de novo ou descartar a etapa.</p>}
    </>
  );
}

/**
 * Aviso fixo com tudo que espera você no run ativo, um cartão por item: permissão pedida no terminal, etapa que parou sem confirmar (aceitar/continuar/recusar; no limite
 * de uso da conta, Continuar é a ação principal), integração de etapa travada
 * (conflito/bloqueio/erro), missão interrompida pelo reinício do servidor (Retomar) e missão pronta para integrar (motivos do servidor; Integrar/Descartar).
 */
export function FlowAttention({ items = [], problems = [], interrupted = false, ready = null, onOpenTerminal, onDecide, deciding = null, onRetry, onDiscardStep, onResume, onIntegrate, onDiscard, busy = null }) {
  const total = items.length + problems.length + (interrupted ? 1 : 0) + (ready ? 1 : 0);
  if (!total) return null;
  let order = 0; // posição de cada cartão: escalona a entrada (CSS var --i)
  const at = () => ({ '--i': order++ });
  return (
    <section className="fl-attn" aria-label="Aguardando você" role="status">
      <div className="fl-attn-h">
        <p className="fl-kicker"><i aria-hidden="true" />Aguardando você</p>
        <span className="fl-count">{total === 1 ? '1 item' : `${total} itens`}</span>
      </div>
      <ul>
        {interrupted && (
          <li className="fl-attn-card" style={at()}>
            <div className="fl-attn-top">
              <AttnDot />
              <div className="fl-attn-txt">
                <p className="fl-attn-t"><b>Missão interrompida</b></p>
                <p className="fl-attn-why">O servidor do FORGE reiniciou durante a execução. Nada continua sozinho; clique em Retomar para os agentes seguirem de onde pararam.</p>
              </div>
            </div>
            {onResume && (
              <div className="fl-attn-acts">
                <button type="button" className="fl-btn fl-btn-primary fl-push" onClick={onResume} disabled={!!busy} aria-busy={busy === 'resume' || undefined}><Busy on={busy === 'resume'} /><Icon name="play" size={12} /><span>Retomar</span></button>
              </div>
            )}
          </li>
        )}
        {problems.map((p) => (
          <li key={`int-${p.stepId}`} className="fl-attn-card" style={at()}>
            <div className="fl-attn-top">
              <AttnDot />
              <div className="fl-attn-txt">
                <p className="fl-attn-t"><b>{p.title}</b></p>
                <p className="fl-attn-why">{p.label}.</p>
              </div>
            </div>
            <div className="fl-attn-body"><IntegrationProblem p={p} onRetry={onRetry} onDiscardStep={onDiscardStep} onOpenTerminal={onOpenTerminal} busy={busy} /></div>
          </li>
        ))}
        {ready && (
          <li className="fl-attn-card" style={at()}>
            <div className="fl-attn-top">
              <AttnDot />
              <div className="fl-attn-txt">
                <p className="fl-attn-t"><b>Pronta para integrar</b></p>
                <p className="fl-attn-why">Todas as etapas terminaram{ready.branch ? <> na branch <code>{ready.branch}</code></> : null}. {ready.baseBranch ? <>Integre em <code>{ready.baseBranch}</code> ou descarte.</> : 'Integre na sua branch ou descarte.'}</p>
              </div>
            </div>
            <div className="fl-attn-body">
              {ready.reasons.length > 0 && (
                <>
                  <p>Não foi integrada automaticamente porque:</p>
                  <ul className="fl-reasons">{ready.reasons.map((r, i) => <li key={`${r.code ?? 'r'}-${i}`}>{r.message}</li>)}</ul>
                </>
              )}
              <FileList files={ready.conflicts} label="Arquivos em conflito" />
              {ready.needsAck && <p>Inclui configuração executável ou arquivo sensível: Integrar pede a sua confirmação explícita, com a lista dos arquivos.</p>}
            </div>
            {(onIntegrate || onDiscard) && (
              <div className="fl-attn-acts">
                <span className="fl-decide fl-push" role="group" aria-label="Integrar ou descartar a execução">
                  {onDiscard && <button type="button" className="fl-btn fl-btn-ghost" onClick={onDiscard} disabled={!!busy} aria-busy={busy === 'discard' || undefined}><Busy on={busy === 'discard'} /><span>Descartar</span></button>}
                  {onIntegrate && <button type="button" className="fl-btn fl-btn-primary" onClick={onIntegrate} disabled={!!busy} aria-busy={busy === 'integrate' || undefined}><Busy on={busy === 'integrate'} /><Icon name="check" size={12} /><span>Integrar</span></button>}
                </span>
              </div>
            )}
          </li>
        )}
        {items.map((w) => (
          <li key={w.stepId} className={`fl-attn-card${w.limit ? ' is-limit' : ''}`} style={at()}>
            <div className="fl-attn-top">
              <AttnDot />
              <div className="fl-attn-txt">
                <p className="fl-attn-t">
                  <b>{w.title}</b>
                  {w.limit && <span className="fl-chip warn" title={w.limitResets ? `Reseta ${w.limitResets} (como aparece no terminal)` : 'O terminal não mostrou o horário de reset'}><Icon name="clock" size={11} />{w.limitResets ? `reseta ${w.limitResets}` : 'limite de uso'}</span>}
                </p>
                <p className="fl-attn-why">
                  {w.limit ? 'Parou no limite de uso da conta e o trabalho pode estar pela metade. Quando o limite liberar, clique em Continuar: o agente segue de onde parou.'
                    : w.unconfirmed ? 'O agente parou sem confirmar que terminou. Abra o terminal: se ele concluiu, aceite; se parou no meio, peça para continuar.'
                      : 'O agente pediu uma permissão e espera a sua resposta no terminal.'}
                </p>
                {w.error && <p className="fl-attn-err" role="alert">{w.error}</p>}
              </div>
            </div>
            {w.unconfirmed && w.summary && (
              <details className="fl-tail">
                <summary><Icon name="chevronRight" size={12} /><span>Ver o fim do terminal</span></summary>
                <pre className="fl-tail-pre" tabIndex={0} role="region" aria-label={`Fim do terminal de ${w.title}`}>{w.summary}</pre>
              </details>
            )}
            <div className="fl-attn-acts">
              {w.terminalId
                ? <button type="button" className={`fl-btn${w.unconfirmed ? '' : ' fl-btn-primary'}`} onClick={() => onOpenTerminal(w.terminalId)}><Icon name="terminal" size={13} /><span>Abrir terminal</span></button>
                : <span className="fl-hint">terminal não informado</span>}
              {w.unconfirmed && onDecide && w.runId && <StepDecision title={w.title} limit={w.limit} disabled={!!deciding} busy={deciding?.stepId === w.stepId ? deciding.decision : null} onDecide={(d) => onDecide(w.runId, w.stepId, d, { limit: w.limit === true })} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Confirmação EXPLÍCITA para integrar com configuração executável ou arquivo sensível alterado (code project_config_changed / etapa `blocked`).
 * Só o clique depois de marcar a caixa reenvia com acknowledgeProjectConfig: true; fechar ou cancelar não envia nada.
 */
export function AckDialog({ ack, busy, onConfirm, onClose }) {
  const [checked, setChecked] = useState(false);
  const step = ack.kind === 'step';
  return (
    <Dialog title={step ? 'Confirmar a integração da etapa' : 'Confirmar a integração'} onClose={onClose} id="fl-ack">
      <div className="fl-confirm">
        {ack.changed && <p className="fl-callout wait" role="alert">A lista de arquivos mudou desde que você abriu esta confirmação (o agente alterou mais arquivos). Revise a lista nova abaixo e marque a caixa de novo.</p>}
        <p>{step ? <>A etapa <b>{ack.title}</b> alterou</> : <>Esta execução alterou</>} <b>configuração executável do projeto ou arquivos sensíveis</b> (scripts e configurações de ferramentas, hooks, chaves, <code>.env</code>). Esses arquivos podem rodar comandos no seu computador ou expor segredos. Revise antes de integrar.</p>
        {/* lista INTEIRA (rola dentro do diálogo): a confirmação é atada exatamente a ela */}
        {ack.files?.length ? <FileList files={ack.files} label={`Arquivos (${ack.files.length})`} max={Infinity} /> : <p className="dim">O servidor não informou a lista de arquivos; confira a branch da missão antes de seguir.</p>}
        <p className="dim">A confirmação vale só para os arquivos desta lista. Se a lista mudar, você confirma de novo.</p>
        <label className="fl-check">
          <input type="checkbox" data-autofocus checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>Revisei esses arquivos e quero integrar mesmo assim.</span>
        </label>
        <div className="fl-form-foot">
          <button type="button" className="fl-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="fl-btn fl-btn-primary" onClick={() => onConfirm()} disabled={!checked || !!busy}><Busy on={!!busy} /><span>Integrar com estes arquivos</span></button>
        </div>
      </div>
    </Dialog>
  );
}

/** Confirmação de Descartar a execução pronta para integrar, com a escolha de apagar também a branch da missão (desmarcada por padrão: o trabalho continua recuperável). */
export function DiscardDialog({ info, busy, onConfirm, onClose }) {
  const [deleteBranch, setDeleteBranch] = useState(false);
  return (
    <Dialog title="Descartar a execução" onClose={onClose} id="fl-discard">
      <div className="fl-confirm">
        <p>O trabalho desta execução <b>não entra</b> na sua branch{info?.baseBranch ? <> (<code>{info.baseBranch}</code>)</> : null}. As cópias de trabalho das etapas saem só quando não há nada pendente nelas; as que não puderem sair ficam listadas para limpar depois.</p>
        <label className="fl-check">
          <input type="checkbox" data-autofocus checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
          <span>Apagar também a branch da missão{info?.branch ? <> (<code>{info.branch}</code>)</> : null}</span>
        </label>
        <p className="dim">{deleteBranch ? 'A branch sai do repositório: o trabalho desta execução não poderá ser recuperado.' : 'Sem marcar, a branch fica no repositório e você ainda pode recuperar o trabalho.'}</p>
        <div className="fl-form-foot">
          <button type="button" className="fl-btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="fl-btn fl-btn-danger" onClick={() => onConfirm({ deleteBranch: deleteBranch === true })} disabled={!!busy}><Busy on={!!busy} /><span>Descartar</span></button>
        </div>
      </div>
    </Dialog>
  );
}

function Busy({ on }) { return on ? <i className="fl-spin" aria-hidden="true" /> : null; }

/**
 * Cabeçalho compacto: título, estado, ações do run (por `runActions`), metadados, objetivo e a faixa de progresso (um segmento por etapa).
 * Com run ativo, Editar vira "Editar agenda"/"Editar integração": o servidor só aceita mudar agenda e integração automática nesse momento.
 */
export default function FlowHeader({ flow, workspaceName, now, busy, onStart, onCancel, onEdit, onEditSchedule, onRemove, onPickStep, onResume, onIntegrate, onDiscard, onCleanup }) {
  const run = currentRun(flow), active = flow.activeRun ?? null;
  const state = flowState(flow), meta = FLOW_STATE_META[state], progress = flowProgress(flow, run);
  const ra = runActions(flow), info = integrationInfo(run), notes = runGitNotes(run);
  const dur = runDuration(run, now);
  const runBy = new Map((run?.steps ?? []).map((s) => [s.stepId, s]));
  const auto = flow.kind === 'automation';
  const sched = auto && flow.schedule && flow.schedule.enabled !== false ? flow.schedule : null;
  const B = (key) => <Busy on={busy === key} />;
  return (
    <header className="fl-head">
      <div className="fl-head-row">
        <div className="fl-head-id">
          <h1 className="fl-title">{flow.title}</h1>
          <StateTag tone={meta.tone} label={meta.label} />
        </div>
        {/* secundárias à esquerda, a ação principal por último (como no Início e no Cockpit) */}
        <div className="fl-actions">
          <button type="button" className="fl-btn fl-btn-ghost" onClick={onRemove} disabled={!!active || !!busy} title={active ? 'Cancele, integre ou descarte a execução para excluir.' : undefined}>{B('remove')}<span>Excluir</span></button>
          {active
            ? <button type="button" className="fl-btn" onClick={onEditSchedule} disabled={!!busy} title="Com a execução ativa, só a agenda e a integração automática podem mudar."><Icon name="pencil" size={12} /><span>{auto ? 'Editar agenda' : 'Editar integração'}</span></button>
            : <button type="button" className="fl-btn" onClick={onEdit} disabled={!!busy}><Icon name="pencil" size={12} /><span>Editar</span></button>}
          {/* run cancelado/falho em modo Git: descarta sem apagar a branch; concluído com sobras: refaz a limpeza segura */}
          {!ra.canIntegrate && (ra.canDiscard || ra.canCleanup) && (
            <button type="button" className="fl-btn" onClick={onCleanup} disabled={!!busy} title="Remove as cópias de trabalho (worktrees) desta execução que puderem sair com segurança.">{B('cleanup')}<span>Limpar cópias</span></button>
          )}
          {ra.canCancel && <button type="button" className="fl-btn fl-btn-danger" onClick={onCancel} disabled={!!busy}>{B('cancel')}<Icon name="stop" size={12} /><span>Cancelar</span></button>}
          {ra.canIntegrate && ra.canDiscard && <button type="button" className="fl-btn fl-btn-danger" onClick={onDiscard} disabled={!!busy}>{B('discard')}<span>Descartar</span></button>}
          {ra.canResume && <button type="button" className="fl-btn fl-btn-primary" onClick={onResume} disabled={!!busy}>{B('resume')}<Icon name="play" size={12} /><span>Retomar</span></button>}
          {ra.canIntegrate && <button type="button" className="fl-btn fl-btn-primary" onClick={onIntegrate} disabled={!!busy}>{B('integrate')}<Icon name="check" size={12} /><span>Integrar</span></button>}
          {!active && <button type="button" className="fl-btn fl-btn-primary" onClick={onStart} disabled={!!busy}>{B('start')}<Icon name="play" size={12} /><span>{run ? 'Executar de novo' : 'Iniciar'}</span></button>}
        </div>
      </div>
      <p className="fl-meta">
        <span>{workspaceName ?? 'sem workspace'}</span>
        <span>{KIND_LABEL[flow.kind] ?? NOT_INFORMED}</span>
        <span>{flow.maxParallel > 1 ? `até ${flow.maxParallel} etapas em paralelo` : 'uma etapa por vez'}</span>
        <span className="fl-dur">{run ? `${run.status === 'running' ? 'rodando há' : 'durou'} ${fmtDuration(dur)}` : 'nunca executada'}</span>
        {run && <span>início {fmtWhen(run.startedAt)}</span>}
      </p>
      {/* selos neutros; "acesso total" leva só um pequeno ícone de aviso (o texto diz o que é) */}
      <div className="fl-tags">
        {flow.fullAccess === true && <span className="fl-chip warn" title="Os terminais desta missão sobem sem pedir confirmação de permissão."><Icon name="alert" size={11} />acesso total</span>}
        {auto && <span className="fl-chip" title="Agenda da automação (roda só com o FORGE aberto)."><Icon name="clock" size={11} />agenda: {scheduleLabel(flow.schedule)}</span>}
        {sched && <span className="fl-chip" title="Próxima execução agendada (horário local).">próxima: {nextRunLabel(flow.nextRunAt)}</span>}
        {info?.branch && <span className="fl-chip mono" title="Branch da missão: as etapas integram aqui antes da integração final.">branch {info.branch}</span>}
        {flow.autoIntegrate !== false
          ? <span className="fl-chip" title="Em workspace Git, integra na sua branch ao terminar, se não houver conflito e a pasta estiver limpa.">integração automática</span>
          : <span className="fl-chip" title="Ao terminar, a execução espera você clicar em Integrar.">integração manual</span>}
      </div>
      {/* modo pasta (sem cópia isolada) e recomeço a partir de outra ponta: avisos do run, em texto (o motivo vem do servidor) */}
      {notes.fallbackText && <p className="fl-gitnote" role="note"><span className="fl-chip warn"><Icon name="alert" size={11} />modo pasta</span> {notes.fallbackText}.</p>}
      {notes.rebasedText && <p className="fl-gitnote" role="note"><span className="fl-chip">recomeço</span> {notes.rebasedText}.</p>}
      {ra.leftovers.length > 0 && (
        <div className="fl-leftovers" role="note" aria-label="Cópias de trabalho que não saíram">
          <p className="fl-notice-h"><Icon name="alert" size={13} /><span><b>{ra.leftovers.length === 1 ? '1 cópia de trabalho não saiu' : `${ra.leftovers.length} cópias de trabalho não saíram`}</b> na última limpeza:</span></p>
          <ul>{ra.leftovers.map((l) => <li key={l.key}>{l.worktreeId ? <code>{l.worktreeId}</code> : 'cópia'}: {l.reason}</li>)}</ul>
          {ra.canCleanup && <p className="fl-hint">{LEFTOVERS_HINT}</p>}
        </div>
      )}
      {flow.goal ? <p className="fl-goal" title={flow.goal}>{flow.goal}</p> : <p className="fl-goal dim">Objetivo: {NOT_INFORMED}.</p>}
      <div className="fl-pipe">
        <div className="fl-pipe-bar" role="img" aria-label={`Progresso: ${progress.label} etapas concluídas`}>
          {flow.steps.map((s) => {
            const m = runStepMeta(runBy.get(s.id));
            return <button type="button" key={s.id} className={`fl-seg fl-t-${m.tone}`} onClick={() => onPickStep(s.id)} title={`${s.title}: ${m.label}`} aria-label={`${s.title}: ${m.label}`} />;
          })}
        </div>
        <span className="fl-pipe-t"><b>{progress.label}</b> etapas</span>
      </div>
    </header>
  );
}
