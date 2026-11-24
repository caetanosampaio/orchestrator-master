import React, { useEffect, useRef, useState } from 'react';
import GolemSprite from '../GolemSprite.jsx';
import { AiIcon } from '../ProviderLogo.jsx';
import { aiName } from '../../provider-catalog.js';
import { useGolem, golemActions } from '../../use-golem.js';
import { fmtTokens, metalOf, evolutionSteps, NAME_MAX, STAGES } from '../../golem.js';
import '../../golem.css';

const pct = (x) => `${Math.round(x * 100)}%`;
const fmtDay = (k) => { const [y, m, d] = String(k ?? '').split('-').map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'; };
const Lock = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;

/**
 * Configurações > Golem: o golem de liga, forjado pelos tokens de TODAS as IAs da máquina (com o histórico). Sem cuidados: ele só cresce e reage ao trabalho.
 * Sem fundo: ele flutua sozinho na página. A trilha de evolução mostra as 7 fases; dá para escolher qual forma ele exibe, mas só entre as já desbloqueadas.
 * Ao abrir depois de cruzar um marco, a evolução é animada (uma vez; a fase vista fica no servidor).
 */
export function GolemSection() {
  const g = useGolem();
  const [name, setName] = useState(null), [err, setErr] = useState('');
  const [anim, setAnim] = useState(null); // { steps: [índices], i }
  const started = useRef(false);

  useEffect(() => {
    if (!g.loaded || started.current) return;
    const steps = evolutionSteps(g.seenStage, g.index);
    started.current = true;
    if (steps.length) setAnim({ steps, i: 0 }); else if (g.seenStage === null) golemActions.markSeen(g.index);
  }, [g.loaded, g.seenStage, g.index]);
  useEffect(() => {
    if (!anim) return undefined;
    const t = setTimeout(() => {
      if (anim.i + 1 < anim.steps.length) setAnim({ ...anim, i: anim.i + 1 });
      else { setAnim(null); golemActions.markSeen(Math.max(g.seenStage ?? 0, anim.steps.at(-1))); }
    }, anim.steps.length > 3 ? 1300 : 1700);
    return () => clearTimeout(t);
  }, [anim, g.seenStage]);

  if (g.error && !g.loaded) return <p className="oc-note err" role="alert">{g.error}</p>;
  if (!g.loaded) return <p className="dim small" role="status">Acendendo a forja…</p>;

  const shown = anim ? anim.steps[anim.i] : g.shown;
  const title = g.name || 'Golem sem nome';
  const save = async (e) => { e.preventDefault(); try { await golemActions.rename(name ?? ''); setName(null); setErr(''); } catch (er) { setErr(er.message || 'Não foi possível salvar o nome.'); } };
  const pick = (i) => { if (i <= g.index && !anim) golemActions.show(i === g.index ? null : i); };

  return (
    <div className="gm">
      <section className="gm-hero" aria-label="O seu golem">
        <div className={`gm-show${anim ? ' evolving' : ''}`}>
          {anim && <span key={anim.i} className="gm-flash" aria-hidden="true" />}
          <span className="gm-float" key={shown}><GolemSprite stage={shown} colors={g.alloy.colors} mood={anim ? 'cheer' : g.mood} burst={!anim && g.burst} alert={!anim && g.waiting > 0} scale={6} /></span>
        </div>
        <div className="gm-info">
          {name === null
            ? <div className="gm-name"><h2>{title}</h2><button type="button" className="gm-link" onClick={() => setName(g.name)}>{g.name ? 'Renomear' : 'Dar um nome'}</button></div>
            : <form className="gm-name" onSubmit={save}><input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Nome do golem" aria-label="Nome do golem" autoFocus /><button type="submit" className="btn primary">Salvar</button><button type="button" className="btn quiet" onClick={() => setName(null)}>Cancelar</button></form>}
          {err && <p className="oc-note err" role="alert">{err}</p>}
          <div className="gm-tags">
            <span className="gm-tag stage">{STAGES[shown].label}</span>
            <span className="gm-tag alloy"><i aria-hidden="true" style={{ background: `linear-gradient(135deg, ${g.alloy.colors.hi}, ${g.alloy.colors.mid} 55%, ${g.alloy.colors.base})` }} />{g.alloy.name}</span>
          </div>
          <p className="gm-sub">{STAGES[shown].hint}{!anim && g.shown !== g.index ? ` Exibindo uma forma antiga: a atual é ${g.stage.label}.` : ''}</p>
          <div className="gm-progress">
            <div className="gm-row"><span>Tokens forjados</span><b>{fmtTokens(g.total)}</b></div>
            {g.next ? <>
              <div className="gm-bar" role="progressbar" aria-label={`Progresso até ${g.next.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.progress * 100)}><u style={{ width: pct(g.progress) }} /></div>
              <p className="gm-note">Faltam <b>{fmtTokens(g.toNext)}</b> tokens para virar <b>{g.next.label}</b>.</p>
            </> : <p className="gm-note">Fase máxima. Ele já é lenda.</p>}
          </div>
          <p className="gm-note dim">Ele cresce sozinho com os tokens que as suas IAs consomem nesta máquina, inclusive o histórico. Nada para cuidar.</p>
        </div>
      </section>

      <section className="gm-track" aria-label="Evolução">
        <div className="gm-track-h">
          <div><h3>Evolução</h3><p className="gm-note">Escolha a forma que ele exibe aqui e na barra lateral. Só as já desbloqueadas.</p></div>
          <button type="button" className="gm-link" onClick={() => setAnim({ steps: STAGES.map((_, i) => i).filter((i) => i <= g.index), i: 0 })} disabled={!!anim}>Ver a evolução</button>
        </div>
        <ol className="gm-stages" role="radiogroup" aria-label="Forma exibida">
          {STAGES.map((s, i) => {
            const open = i <= g.index, on = open && i === g.shown;
            return (
              <li key={s.id} className={`${open ? 'open' : 'locked'}${on ? ' on' : ''}${i === g.index ? ' now' : ''}`}>
                <button type="button" role="radio" aria-checked={on} disabled={!open || !!anim} onClick={() => pick(i)} aria-label={open ? `Exibir ${s.label}` : `${s.label}: bloqueada, faltam ${fmtTokens(s.min - g.total)} tokens`} title={open ? s.hint : `Bloqueada: chega com ${fmtTokens(s.min)} tokens`}>
                  <span className="gm-mini"><GolemSprite stage={i} colors={open ? g.alloy.colors : undefined} mood={open ? 'idle' : 'sleep'} quiet scale={2} /></span>
                  <b>{open ? s.label : '???'}</b>
                  <small>{open ? (i === g.index ? 'atual' : s.min ? `${fmtTokens(s.min)}` : 'início') : <><Lock /> {fmtTokens(s.min)}</>}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="gm-grid">
        <section className="gm-card" aria-label="Liga do golem">
          <div className="gm-row"><h3>Liga</h3><b>{g.alloy.name}</b></div>
          {g.alloy.parts.length > 0 ? <>
            <div className="gm-alloy" aria-hidden="true">{g.alloy.parts.map((p) => <i key={p.id} style={{ width: pct(p.share), background: `linear-gradient(180deg, ${metalOf(p.id).hi}, ${metalOf(p.id).mid} 55%, ${metalOf(p.id).base})` }} />)}</div>
            <ul className="gm-metals">
              {g.alloy.parts.map((p) => <li key={p.id}><AiIcon id={p.id} size={16} /><span>{aiName(p.id)}</span><em>{p.metal}</em><b>{pct(p.share)}</b><small>{fmtTokens(p.tokens)}</small></li>)}
            </ul>
          </> : <p className="gm-note">Ainda sem tokens: ele é de ferro puro até as suas IAs trabalharem.</p>}
          <p className="gm-note dim">Cada IA é um metal: Claude é cobre, Codex é cobalto. A cor do golem é a mistura, pelo quanto cada uma trabalhou.</p>
        </section>
        <section className="gm-card gm-recs" aria-label="Recordes">
          <h3>Recordes</h3>
          <div className="gm-rec-grid">
            <div><span>Hoje</span><b>{fmtTokens(g.records.today)}</b></div>
            <div><span>Maior dia</span><b>{fmtTokens(g.records.best.tokens)}</b><small>{g.records.best.day ? fmtDay(g.records.best.day) : '—'}</small></div>
            <div><span>Sequência</span><b>{g.records.streak} {g.records.streak === 1 ? 'dia' : 'dias'}</b></div>
            <div><span>Desde</span><b>{g.records.since ? fmtDay(g.records.since) : '—'}</b></div>
          </div>
        </section>
      </div>
    </div>
  );
}
