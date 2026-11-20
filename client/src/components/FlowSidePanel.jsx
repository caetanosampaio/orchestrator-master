import React, { useEffect, useRef } from 'react';
import { Icon } from './ui.jsx';
import { fmtDuration, fmtWhen, LEFTOVERS_HINT, NOT_INFORMED } from '../flows-view.js';
import { FileList, IntegrationProblem, StateTag, StepDecision, VerificationResult } from './FlowHeader.jsx';

const Fact = ({ k, children }) => <div className="fl-fact"><dt>{k}</dt><dd>{children}</dd></div>;
// modos da integração final gravados pelo servidor (git.integration.mode)
const MODE_LABEL = { ff: 'avanço direto (fast-forward)', merge: 'commit de merge', already: 'já estava na branch', empty: 'sem alterações' };

/**
 * Painel lateral do nó selecionado: texto da etapa, resumo ou erro, tempos, branch/integração da etapa (modo Git) e "Abrir terminal"; na Entrega, a integração final.
 * Esc fecha; o foco vai para o título ao abrir.
 */
export default function FlowSidePanel({ detail, onClose, onOpenTerminal, onDecide, deciding = null, onRetryStep, onDiscardStep, busy = null }) {
  const head = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [detail?.id]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  if (!detail) return null;
  const d = detail;
  const ig = d.integration ?? null, info = d.kind === 'delivery' ? ig : null, si = d.kind === 'step' ? ig : null;
  // o mesmo formato do aviso do topo (integrationProblems), montado do detalhe da etapa
  const problem = si?.needsAction ? { ...si, stepId: d.id, runId: d.runId, title: d.title, worktreePath: d.worktreePath ?? null, terminalId: d.terminalId } : null;
  return (
    <aside className="fl-panel" aria-label={`Detalhe: ${d.title}`}>
      <header className="fl-panel-h">
        <div className="fl-panel-id">
          <p className="fl-kicker"><i aria-hidden="true" />{d.kind === 'delivery' ? 'Entrega' : 'Etapa'}</p>
          <h2 tabIndex={-1} ref={head}>{d.title}</h2>
          <StateTag tone={d.tone} label={d.stateLabel} />
        </div>
        <button type="button" className="fx-ibtn" onClick={onClose} aria-label="Fechar o painel (Esc)" title="Fechar (Esc)"><Icon name="close" size={14} /></button>
      </header>
      <div className="fl-panel-b">
        {d.kind === 'step' ? (
          <>
            {d.state === 'waiting' && !d.unconfirmed && (
              <p className="fl-callout wait" role="status">O agente pediu uma permissão e espera a sua resposta no terminal.</p>
            )}
            {d.unconfirmed && (
              <div className={`fl-callout wait${d.limit ? ' is-limit' : ''}`} role="status">
                {d.limit
                  ? <p><b>Parou no limite de uso da conta</b>{d.limitResets ? <> · reseta {d.limitResets}</> : null}. O trabalho pode estar pela metade: quando o limite liberar, clique em Continuar e o agente segue de onde parou.</p>
                  : <p>O agente parou sem confirmar que terminou (não chamou report_done). Se ele concluiu, aceite; se parou no meio, peça para continuar. Se ele terminar sozinho, a etapa avança.</p>}
                {d.canDecide && onDecide && <StepDecision title={d.title} limit={d.limit === true} disabled={!!deciding} busy={deciding?.stepId === d.id ? deciding.decision : null} onDecide={(x) => onDecide(d.runId, d.id, x, { limit: d.limit === true })} />}
              </div>
            )}
            {d.state === 'interrupted' && (
              <p className="fl-callout wait" role="status">O servidor do FORGE reiniciou durante esta etapa. Clique em Retomar no topo da missão para o agente continuar de onde parou.</p>
            )}
            {problem && (
              <div className="fl-callout wait fl-int-box" role="status">
                <p><b>{si.label}</b></p>
                {/* sem "Abrir terminal" aqui: o rodapé do painel já tem o botão */}
                <IntegrationProblem p={problem} onRetry={onRetryStep} onDiscardStep={onDiscardStep} onOpenTerminal={null} busy={busy} canAct={d.canResolveIntegration && !!onRetryStep && !!onDiscardStep} />
              </div>
            )}
            <dl className="fl-facts">
              <Fact k="agente">{d.agent.roleLabel} · {d.agent.providerLabel}</Fact>
              <Fact k="modelo">{d.agent.model ?? NOT_INFORMED}</Fact>
              <Fact k="esforço">{d.agent.effort ?? NOT_INFORMED}</Fact>
              <Fact k="início">{fmtWhen(d.startedAt)}</Fact>
              <Fact k="fim">{d.finishedAt ? fmtWhen(d.finishedAt) : d.terminalLive ? 'em andamento' : NOT_INFORMED}</Fact>
              <Fact k="duração">{fmtDuration(d.durationMs)}</Fact>
              <Fact k="depende de">{d.dependsOn.length ? d.dependsOn.map((x) => x.title).join(', ') : 'nada (pode começar já)'}</Fact>
              {d.continueFrom && <Fact k="terminal">continua o de “{d.continueFrom.title}”</Fact>}
              {d.completedBy && <Fact k="conclusão">{d.completedBy === 'user' ? `aceita por você${d.decidedAt ? ` em ${fmtWhen(d.decidedAt)}` : ''}` : 'confirmada pelo agente'}</Fact>}
              {/* modo Git (fatia 2): ausentes em runs antigos e no modo pasta */}
              {d.branch && <Fact k="branch"><code>{d.branch}</code></Fact>}
              {d.worktreeId && <Fact k="cópia">{d.worktreeId}</Fact>}
              {si && (si.state !== 'none' || d.branch) && <Fact k="integração"><span className={`fl-t-${si.tone} fl-st-t`}>{si.label}</span>{si.at && si.state !== 'none' ? ` · ${fmtWhen(si.at)}` : ''}</Fact>}
            </dl>
            {/* erro INTEIRO, como veio do servidor (ex.: configuração não revisada na cópia), com as quebras de linha; o nó do workflow só mostra o começo */}
            {d.error && <section><p className="fl-label">Erro</p><p className="fl-text err pre">{d.error}</p></section>}
            {d.summary && <section><p className="fl-label">{d.unconfirmed ? (d.limit ? 'Fim do terminal (parou no limite)' : 'Fim do terminal (relatório automático)') : d.completedBy === 'user' ? 'Fim do terminal (relatório automático, aceito por você; não é repassado à próxima etapa)' : 'Resumo do agente'}</p><p className="fl-text">{d.summary}</p></section>}
            {!d.error && !d.summary && d.state === 'completed' && <p className="fl-text dim">Resumo {NOT_INFORMED}.</p>}
            <section><p className="fl-label">Texto da etapa</p><p className="fl-text pre">{d.prompt ?? NOT_INFORMED}</p></section>
            <div className="fl-panel-f">
              <button type="button" className="fl-btn fl-btn-primary" onClick={() => onOpenTerminal(d.terminalId)} disabled={!d.canOpenTerminal}><Icon name="terminal" size={13} /><span>Abrir terminal</span></button>
              {d.terminalHint && <p className="fl-hint">{d.terminalHint}</p>}
            </div>
          </>
        ) : (
          <>
            <dl className="fl-facts">
              <Fact k="execução">{d.hasRun ? d.stateLabel : 'ainda não executada'}</Fact>
              <Fact k="início">{fmtWhen(d.startedAt)}</Fact>
              <Fact k="fim">{d.finishedAt ? fmtWhen(d.finishedAt) : d.runStatus === 'running' ? 'em andamento' : NOT_INFORMED}</Fact>
              <Fact k="duração">{fmtDuration(d.durationMs)}</Fact>
              <Fact k="etapas">{d.hasRun ? `${d.counts.completed} de ${d.counts.total} concluídas${d.counts.failed ? ` · ${d.counts.failed} falharam` : ''}${d.counts.skipped ? ` · ${d.counts.skipped} puladas` : ''}${d.counts.cancelled ? ` · ${d.counts.cancelled} canceladas` : ''}` : `${d.counts.total} no total`}</Fact>
              {/* integração final (modo Git): null em runs antigos e no modo pasta */}
              {info && <Fact k="integração">{info.label ?? (d.runStatus === 'discarded' ? 'descartada' : 'ainda não integrada')}</Fact>}
              {info?.byLabel && <Fact k="por">{info.by === 'auto' ? 'automática (política da missão)' : 'você'}</Fact>}
              {info?.mode && <Fact k="modo">{MODE_LABEL[info.mode] ?? info.mode}</Fact>}
              {info?.commitShort && <Fact k="commit"><code>{info.commitShort}</code></Fact>}
              {info?.at && <Fact k="quando">{fmtWhen(info.at)}</Fact>}
              {info?.branch && <Fact k="branch"><code>{info.branch}</code></Fact>}
              {info?.baseBranch && <Fact k="destino"><code>{info.baseBranch}</code></Fact>}
            </dl>
            {d.gitNotes?.fallbackText && <p className="fl-text wait">{d.gitNotes.fallbackText}.</p>}
            {d.gitNotes?.rebasedText && <p className="fl-text">{d.gitNotes.rebasedText}.</p>}
            {d.leftovers?.length > 0 && (
              <section><p className="fl-label">Cópias que não saíram</p>
                <ul className="fl-fails">{d.leftovers.map((l) => <li key={l.key}>{l.worktreeId ? <code>{l.worktreeId}</code> : 'cópia'}: {l.reason}</li>)}</ul>
                <p className="fl-hint">{LEFTOVERS_HINT}</p>
              </section>
            )}
            {d.line && <p className={`fl-text${d.state === 'ready_to_integrate' ? ' wait' : ''}`}>{d.line}</p>}
            {info?.state === 'pending' && info.reasons.length > 0 && (
              <section><p className="fl-label">Por que não integrou sozinha</p>
                <ul className="fl-fails">{info.reasons.map((r, i) => <li key={`${r.code ?? 'r'}-${i}`}>{r.message}</li>)}</ul>
              </section>
            )}
            {/* comando de verificação antes da integração final (só quando a missão tem um e ele rodou) */}
            {info?.verification && <section><VerificationResult v={info.verification} /></section>}
            {info?.state === 'pending' && <FileList files={info.conflicts} label="Arquivos em conflito" />}
            {info?.state === 'pending' && <FileList files={info.files} label="Configuração ou arquivos sensíveis alterados" />}
            {d.failures.length > 0 && (
              <section><p className="fl-label">Falhas</p>
                <ul className="fl-fails">{d.failures.map((f) => <li key={f.id}><b>{f.title}</b>: {f.error ?? 'motivo não informado'}</li>)}</ul>
              </section>
            )}
            <p className="fl-text dim">A entrega só é marcada como concluída quando todas as etapas terminam de verdade.</p>
          </>
        )}
      </div>
    </aside>
  );
}
