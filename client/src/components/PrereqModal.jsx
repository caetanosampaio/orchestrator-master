import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../api.js';
import { prereqIssues, issueKey, hasBlocking, canContinue, inlineParts, RESTART_HINT } from '../prereqs.js';

const FOCUSABLE = 'button:not(:disabled), a[href]';

/** Texto com `código` e links https desenhados como elementos (nunca HTML cru). */
function Inline({ text }) {
  return inlineParts(text).map((p, i) => (p.kind === 'code' ? <code key={i}>{p.text}</code>
    : p.kind === 'link' ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
    : <React.Fragment key={i}>{p.text}</React.Fragment>));
}

/**
 * "Antes de começar": popup central, com o fundo escurecido e desfocado, mostrado quando falta algo para o FORGE funcionar (Claude Code, login da conta, Git).
 * Com o Claude Code ausente BLOQUEIA o uso; "Continuar mesmo assim" só aparece depois de uma verificação que continuou falhando (um falso negativo nunca prende o usuário).
 * Pendências informativas (login, Git) podem ser dispensadas na hora. Dispensar vale até o conjunto de pendências mudar. Some sozinho quando tudo é resolvido.
 */
export default function PrereqModal({ onOpenAccounts = null, suspended = false }) {
  const { state, refresh } = useStore();
  const [busy, setBusy] = useState(false), [tries, setTries] = useState(0), [ignored, setIgnored] = useState('');
  const box = useRef(null), primary = useRef(null);
  const issues = prereqIssues(state), key = issueKey(issues), blocking = hasBlocking(issues);
  // `suspended`: outro diálogo (por exemplo Configurações > Contas, aberto pelo botão "Entrar na conta") está na tela: o popup se afasta e volta quando ele fechar, se ainda houver pendência
  const open = !suspended && issues.length > 0 && ignored !== key;
  const can = canContinue({ issues, tries });

  useEffect(() => { if (!issues.length) { setIgnored(''); setTries(0); } }, [issues.length]);
  useEffect(() => { if (open) primary.current?.focus(); }, [open, key]);

  useEffect(() => {
    if (!open) return undefined;
    const el = box.current;
    const keydown = (e) => {
      if (e.key === 'Escape' && can) { e.preventDefault(); setIgnored(key); return; } // sem pendência bloqueante, Esc dispensa; com ela, só depois de verificar de novo
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)]; if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [open, can, key]);

  if (!open) return null;
  const recheck = async () => { setBusy(true); try { await api.get('/api/state?fresh=1').catch(() => {}); await refresh(); } finally { setBusy(false); setTries((t) => t + 1); } };
  const hasLogin = issues.some((i) => i.id === 'login');
  return (
    <div className="oc-modal prereq-modal" data-testid="prereq-modal">
      <div className="oc-dialog" role="alertdialog" aria-modal="true" aria-labelledby="prereq-t" aria-describedby="prereq-d" ref={box} tabIndex={-1}>
        <header className="oc-dialog-head"><h2 id="prereq-t">Antes de começar</h2></header>
        <div className="oc-dialog-body">
          <p id="prereq-d" className="prereq-lead">{blocking ? 'Para o FORGE funcionar, falta o seguinte neste computador:' : 'Alguns itens ainda não foram encontrados. Você pode resolver agora ou continuar:'}</p>
          <ul className="prereq-issues">
            {issues.map((i) => (
              <li key={i.id} className={`prereq-issue${i.blocking ? ' blocking' : ''}`}>
                <h3>{i.title}</h3>
                <p><Inline text={i.text} />{i.detail ? <span className="dim"> ({i.detail})</span> : null}</p>
                <ol>{i.steps.map((s, n) => <li key={n}><Inline text={s} /></li>)}</ol>
              </li>
            ))}
          </ul>
          {issues.some((i) => i.id !== 'login') ? <p className="dim small prereq-hint">{RESTART_HINT}</p> : null}
          <div className="prereq-actions">
            {hasLogin && onOpenAccounts ? <button type="button" className="btn" onClick={onOpenAccounts}>Entrar na conta</button> : null}
            <button type="button" className="btn primary" onClick={recheck} disabled={busy} ref={primary}>{busy ? 'Verificando…' : 'Verificar novamente'}</button>
            {can ? <button type="button" className="btn quiet" onClick={() => setIgnored(key)}>Continuar mesmo assim</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
