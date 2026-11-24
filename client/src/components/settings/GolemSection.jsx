import React, { useEffect, useRef, useState } from 'react';
import GolemSprite from '../GolemSprite.jsx';
import { AiIcon } from '../ProviderLogo.jsx';
import { aiName } from '../../provider-catalog.js';
import { useGolem, golemActions } from '../../use-golem.js';
import { fmtTokens, metalOf, evolutionSteps, MOOD_LABEL, NAME_MAX, STAGES } from '../../golem.js';
import '../../golem.css';

const pct = (x) => `${Math.round(x * 100)}%`;
const fmtDay = (k) => { const [y, m, d] = String(k ?? '').split('-').map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'; };

/**
 * Configurações > Golem: o golem de liga, forjado pelos tokens de TODAS as IAs da máquina (com o histórico). Sem cuidados: ele só cresce e reage ao trabalho.
 * A cor dele é a liga dos metais das suas IAs. Ao abrir depois de cruzar um marco, a evolução é animada (uma vez; a fase vista fica no servidor).
 */
export function GolemSection() {
  const g = useGolem();
  const [name, setName] = useState(null), [err, setErr] = useState('');
  const [anim, setAnim] = useState(null); // { steps: [índices], i }
  const started = useRef(false);

  // evolução acumulada: anima as fases cruzadas desde a última vista (na 1ª vez, desde a faísca), uma a uma
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
      else { setAnim(null); golemActions.markSeen(anim.steps.at(-1)); }
    }, anim.steps.length > 3 ? 1300 : 1800);
    return () => clearTimeout(t);
  }, [anim]);

  if (g.error && !g.loaded) return <p className="oc-note err" role="alert">{g.error}</p>;
  if (!g.loaded) return <p className="dim small" role="status">Acendendo a forja…</p>;

  const shownStage = anim ? anim.steps[anim.i] : g.index;
  const title = g.name || 'Golem sem nome';
  const save = async (e) => { e.preventDefault(); try { await golemActions.rename(name ?? ''); setName(null); setErr(''); } catch (er) { setErr(er.message || 'Não foi possível salvar o nome.'); } };
  const moodText = g.mood === 'working' ? `forjando · ${g.working} ${g.working === 1 ? 'agente trabalhando' : 'agentes trabalhando'}` : MOOD_LABEL[g.mood];

  return (
    <div className="gm">
      <div className={`gm-forge m-${g.mood}${anim ? ' evolving' : ''}`}>
        <span className={`gm-chip m-${anim ? 'cheer' : g.mood}`} role="status"><i aria-hidden="true" />{anim ? 'evoluindo' : moodText}</span>
        <div className="gm-stage">
          {anim && <span key={anim.i} className="gm-flash" aria-hidden="true" />}
          <span className="gm-golem" key={shownStage}><GolemSprite stage={shownStage} colors={g.alloy.colors} mood={anim ? 'cheer' : g.mood} size={shownStage >= 3 ? 230 : 170} /></span>
          {g.mood === 'sleep' && !anim && <span className="gm-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>}
        </div>
        <p className="gm-cap" aria-live="polite">{anim ? <><b>Evoluindo…</b> {STAGES[shownStage].label}</> : <><b>{STAGES[g.index].label}</b> · {g.alloy.name}</>}</p>
      </div>

      <div className="gm-side">
        {name === null
          ? <div className="gm-name"><h2>{title}</h2><button type="button" className="btn quiet" onClick={() => setName(g.name)}>{g.name ? 'Renomear' : 'Dar um nome'}</button></div>
          : <form className="gm-name" onSubmit={save}><input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Nome do golem" aria-label="Nome do golem" autoFocus /><button type="submit" className="btn primary">Salvar</button><button type="button" className="btn quiet" onClick={() => setName(null)}>Cancelar</button></form>}
        {err && <p className="oc-note err" role="alert">{err}</p>}
        <p className="gm-sub">{g.stage.hint} Ele cresce sozinho com os tokens que as suas IAs consomem, inclusive o histórico desta máquina.</p>

        <section className="gm-card" aria-label="Próxima fase">
          <div className="gm-row"><span>Tokens forjados</span><b>{fmtTokens(g.total)}</b></div>
          {g.next ? <>
            <div className="gm-bar" role="progressbar" aria-label={`Progresso até ${g.next.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.progress * 100)}><u style={{ width: pct(g.progress) }} /></div>
            <p className="gm-note">Faltam <b>{fmtTokens(g.toNext)}</b> tokens para virar <b>{g.next.label}</b>.</p>
          </> : <p className="gm-note">Fase máxima. Ele já é lenda.</p>}
        </section>

        <section className="gm-card" aria-label="Liga do golem">
          <div className="gm-row"><span>Liga</span><b>{g.alloy.name}</b></div>
          {g.alloy.parts.length > 0 ? <>
            <div className="gm-alloy" aria-hidden="true">{g.alloy.parts.map((p) => <i key={p.id} style={{ width: pct(p.share), background: `linear-gradient(180deg, ${metalOf(p.id).hi}, ${metalOf(p.id).mid} 55%, ${metalOf(p.id).base})` }} />)}</div>
            <ul className="gm-metals">
              {g.alloy.parts.map((p) => <li key={p.id}><AiIcon id={p.id} size={16} /><span>{aiName(p.id)}</span><em>{p.metal}</em><b>{pct(p.share)}</b><small>{fmtTokens(p.tokens)}</small></li>)}
            </ul>
          </> : <p className="gm-note">Ainda sem tokens: ele é de ferro puro até as suas IAs trabalharem.</p>}
          <p className="gm-note dim">Cada IA é um metal: Claude é cobre, Codex é cobalto. A cor do golem é a mistura, pelo quanto cada uma trabalhou.</p>
        </section>

        <section className="gm-card gm-recs" aria-label="Recordes">
          <div><span>Hoje</span><b>{fmtTokens(g.records.today)}</b></div>
          <div><span>Maior dia</span><b>{fmtTokens(g.records.best.tokens)}</b><small>{g.records.best.day ? fmtDay(g.records.best.day) : '—'}</small></div>
          <div><span>Sequência</span><b>{g.records.streak} {g.records.streak === 1 ? 'dia' : 'dias'}</b></div>
          <div><span>Desde</span><b>{g.records.since ? fmtDay(g.records.since) : '—'}</b></div>
        </section>

        <section className="gm-card" aria-label="Fases">
          <div className="gm-row"><span>Fases</span><button type="button" className="btn quiet gm-replay" onClick={() => setAnim({ steps: STAGES.map((_, i) => i).filter((i) => i <= g.index), i: 0 })} disabled={!!anim}>Ver a evolução</button></div>
          <ol className="gm-stages">
            {STAGES.map((s, i) => (
              <li key={s.id} className={i < g.index ? 'done' : i === g.index ? 'now' : 'next'}>
                <span className="gm-mini"><GolemSprite stage={i} colors={i <= g.index ? g.alloy.colors : undefined} mood={i <= g.index ? 'idle' : 'sleep'} size={i >= 3 ? 40 : 30} /></span>
                <span className="gm-st"><b>{i <= g.index ? s.label : '???'}</b><small>{s.min ? `${fmtTokens(s.min)} tokens` : 'início'}</small></span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
