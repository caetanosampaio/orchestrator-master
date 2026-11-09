import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProviderLogo from './ProviderLogo.jsx';
import { WINDOWS, DASH, usageColor, usageBand, providerSummary, resetLabel, fmtResetLong, fmtResetAt, sourceNote, clampPct } from '../limits-view.js';
import '../limits.css';

const W = 350, GAP = 6, EDGE = 8;

/** Duas barras finas empilhadas: em cima o limite diário (janela de 5 h), embaixo o semanal. A largura é o USO (cheia = limite esgotado) e a cor esquenta do verde ao vermelho perto do fim. */
function Bars({ source }) {
  return (
    <span className="lm-bars" aria-hidden="true">
      {WINDOWS.map((w) => {
        const pct = source[w.key]?.usedPct ?? null;
        return <i key={w.key} className={`lm-bar band-${usageBand(pct)}`}><u style={pct === null ? undefined : { width: `${Math.max(pct > 0 ? 6 : 0, pct)}%`, background: usageColor(pct) }} /></i>;
      })}
    </span>
  );
}

/** Uma janela no painel: rótulo, % grande, barra e o reset (em tempo e em hora do relógio). */
function WindowBlock({ win, data, now }) {
  const pct = data?.usedPct ?? null;
  if (pct === null) return <div className="lm-win off"><div className="lm-win-h"><span className="lm-w-n">{win.label}</span><b>{DASH}</b></div><i className="lm-track" /><p className="dim small">sem leitura</p></div>;
  const long = fmtResetLong(data.resetsAt, now), clock = fmtResetAt(data.resetsAt, now);
  return (
    <div className={`lm-win band-${usageBand(pct)}`}>
      <div className="lm-win-h"><span className="lm-w-n" title={win.hint}>{win.label}</span><b>{Math.round(pct)}%</b></div>
      <i className="lm-track" role="progressbar" aria-label={`${win.label}: ${Math.round(pct)}% usado`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><u style={{ width: `${Math.max(pct > 0 ? 3 : 0, clampPct(pct))}%`, background: usageColor(pct) }} /></i>
      <p className="dim small">Reseta em {long ?? 'instantes'}{clock ? ` · ${clock}` : ''}</p>
    </div>
  );
}

/** Painel de UM provedor: as contas conectadas dele, cada uma com o limite diário e o semanal (% e reset), ou o motivo de não haver leitura. */
function ProviderPanel({ sum, now, anchor, onClose }) {
  const box = useRef(null), [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect(); if (!r) return;
      const w = Math.min(W, window.innerWidth - EDGE * 2), left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - w - EDGE));
      setPos({ left, width: w, top: r.bottom + GAP, maxHeight: Math.min(window.innerHeight * 0.7, window.innerHeight - r.bottom - GAP - EDGE) });
    };
    place(); window.addEventListener('resize', place); return () => window.removeEventListener('resize', place);
  }, [anchor]);
  useEffect(() => {
    box.current?.focus();
    const down = (e) => { if (!box.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor.current?.focus(); } };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div id={`lm-pop-${sum.provider}`} ref={box} tabIndex={-1} className="lm-pop" role="dialog" aria-label={`Limites do ${sum.label}`} style={pos ?? { visibility: 'hidden' }}>
      <p className="lm-pop-h"><ProviderLogo id={sum.provider} size={16} /><b>{sum.label}</b><span>limites {sum.accounts.length > 1 ? 'das contas' : 'da conta'}</span></p>
      <ul className="lm-list">
        {sum.accounts.map((a) => {
          const note = !a.session && !a.week ? sourceNote(a, sum.provider) : null;
          return (
            <li key={a.id} className="lm-row">
              <div className="lm-row-h"><b>{a.index !== null && sum.accounts.length > 1 ? `Conta ${a.index} · ${a.label}` : a.label}</b>{a.plan && <span className="lm-plan">{a.plan}</span>}</div>
              {note ? <p className="small dim lm-note">{note}</p> : WINDOWS.map((w) => <WindowBlock key={w.key} win={w} data={a[w.key]} now={now} />)}
            </li>
          );
        })}
      </ul>
      <p className="small dim lm-foot">Quanto mais cheia a barra, mais perto do limite: verde, âmbar e depois vermelho.{sum.accounts.length > 1 ? ' Na barra do topo vale a conta mais perto do limite.' : ''}</p>
    </div>, document.body);
}

/** O botão de um provedor: ícone, as 2 barras (diário em cima, semanal embaixo) e o tempo até o reset da janela mais crítica. Clicar abre os limites das contas daquele provedor. */
function ProviderLimits({ sum, now, onOpen }) {
  const [open, setOpen] = useState(false), btn = useRef(null);
  const crit = usageBand(sum.critical ? sum[sum.critical].usedPct : null);
  const title = `${sum.label}: ${WINDOWS.map((w) => `${w.short} ${sum[w.key] ? `${Math.round(sum[w.key].usedPct)}%` : DASH}`).join(' · ')}. Clique para ver os limites.`;
  return (
    <>
      <button type="button" ref={btn} className={`lm-btn band-${crit}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`lm-pop-${sum.provider}`} title={title}
        aria-label={`Limites do ${sum.label}: ${WINDOWS.map((w) => `${w.label} ${sum[w.key] ? `${Math.round(sum[w.key].usedPct)}% usado, reseta em ${fmtResetLong(sum[w.key].resetsAt, now) ?? 'instantes'}` : 'sem leitura'}`).join('; ')}`}
        onClick={() => { setOpen((o) => !o); onOpen?.(); }}>
        <ProviderLogo id={sum.provider} size={14} /><Bars source={sum} /><span className="lm-t">{resetLabel(sum, now)}</span>
      </button>
      {open && <ProviderPanel sum={sum} now={now} anchor={btn} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Limites das contas no canto superior direito do cockpit: UM botão por provedor (Claude Code, Codex), cada um com as SUAS 2 barras (limite diário em cima, semanal embaixo) e o tempo até o reset.
 * Sem contas conectadas o provedor não aparece; sem leitura as barras ficam vazias e o tempo é "—". `refresh` relê os limites ao abrir um painel.
 */
export function LimitsBars({ limits, now, refresh }) {
  const sums = (limits?.providers ?? []).map(providerSummary).filter((s) => s.accounts.length > 0);
  if (!sums.length) return <span className="lm-strip lm-empty"><span className="lm-t">{limits ? 'sem contas' : DASH}</span></span>;
  return (
    <span className="lm-strip" role="group" aria-label="Limites das contas">
      {sums.map((s, i) => (
        <React.Fragment key={s.provider}>
          {i > 0 && <i className="lm-sep" aria-hidden="true" />}
          <ProviderLimits sum={s} now={now} onOpen={refresh} />
        </React.Fragment>
      ))}
    </span>
  );
}
