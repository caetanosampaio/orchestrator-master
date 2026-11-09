import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Btn, Icon } from './ui.jsx';
import { PRESETS, presetById, missingRoles } from '../team-view.js';
import { providerOptionLabel } from '../env-view.js';
import ProviderLogo from './ProviderLogo.jsx';
import { inferAgents, draftOpenProblem, squadSummary, teamChangePlan, applyCloseChoice } from '../squads.js';

const STATE_TEXT = { working: 'executando', waiting: 'aguardando', done: 'concluído', idle: 'ocioso', failed: 'falhou', exited: 'encerrado' };
const W = 380, GAP = 6, EDGE = 8;
const plural2 = (n) => `${n} ${n === 1 ? 'vaga' : 'vagas'}`;
/** "Maestro, Construtor ×2, Revisor": as vagas de um preset em uma linha. */
const roleSummary = (roles, label) => { const c = new Map(); for (const r of roles) c.set(r, (c.get(r) ?? 0) + 1); return [...c].map(([r, n]) => (n > 1 ? `${label(r)} ×${n}` : label(r))).join(', '); };

/**
 * Equipe do workspace: identificação compacta (ex.: "Squad ▾") que abre o gerenciamento. Consulta a composição atual, altera o preset, adiciona/remove agentes e abre
 * terminais avulsos. Nada aqui encerra processo sem confirmação; cada ação chama o que o cockpit já faz (abrir, encerrar, gravar a equipe do workspace).
 */
export default function TeamMenu({ role = 'builder', onRole = () => {}, providers = [], provider = 'claude', onProvider = () => {}, onChangeWith = null, preset, saved = true, sessions, stateOf, roles, byRole, room, busy, where, onChange, onAdd, onRemove, onReset }) {
  const [open, setOpen] = useState(false), [pos, setPos] = useState(null), [plan, setPlan] = useState(null); // `role` e `provider` vêm do cockpit (preferências): o que se escolhe aqui vale para a tela principal. `plan` = troca de preset em confirmação: { presetId, closeIds[], slots[{role,provider}], over[], canShrink }
  useEffect(() => { if (!open) setPlan(null); }, [open]);
  const available = providers.filter((p) => p.available).map((p) => p.id), labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  const btn = useRef(null), pop = useRef(null);
  const team = presetById(preset);
  const live = useMemo(() => sessions.filter((s) => s.status === 'running'), [sessions]);
  /**
   * Trocar o preset de uma equipe que JÁ tem terminais: a equipe passa a ser exatamente a do preset novo. Mostra o que FICA, o que FECHA (o excedente; em atividade fica primeiro) e o que ABRE (o agente de cada vaga nova
   * acompanha a equipe atual). Tudo ajustável antes de confirmar; nada é fechado nem aberto sem confirmação. `planFrom` recalcula o plano quando se troca quem fica, preservando os agentes já escolhidos.
   */
  const planFrom = (presetId, closeIds, prevSlots = [], canShrink = false) => {
    const r = applyCloseChoice(presetById(presetId).roles, live, closeIds), queue = [...prevSlots];
    const reused = r.openRoles.map((role) => { const k = queue.findIndex((x) => x.role === role); return k >= 0 ? queue.splice(k, 1)[0] : null; });
    const fresh = r.openRoles.filter((_, i) => !reused[i]), inferred = inferAgents(fresh, r.kept, provider);
    let m = 0;
    return { presetId, closeIds, canShrink, over: r.over, slots: r.openRoles.map((role, i) => reused[i] ?? { role, provider: inferred[m++] }) };
  };
  const pickPreset = (p) => {
    if (p.id === preset) return;
    const pl = teamChangePlan(p.roles, live, stateOf);
    if (onChangeWith && live.length > 0 && (pl.close.length || pl.openRoles.length)) { setPlan(planFrom(p.id, pl.close.map((x) => x.id), [], pl.close.length > 0)); return; }
    setOpen(false); onChange(p.id);
  };
  const setKeep = (sess, close) => setPlan((pl) => planFrom(pl.presetId, close ? [...new Set([...pl.closeIds, sess.id])] : pl.closeIds.filter((x) => x !== sess.id), pl.slots, pl.canShrink));
  const missing = useMemo(() => (team ? missingRoles(team.roles, live.map((s) => s.role)) : []), [team, live]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btn.current?.getBoundingClientRect(); if (!r) return;
      const w = Math.min(W, window.innerWidth - EDGE * 2), left = Math.max(EDGE, Math.min(r.left, window.innerWidth - w - EDGE));
      setPos({ left, width: w, top: r.bottom + GAP, maxHeight: Math.min(window.innerHeight * 0.7, window.innerHeight - r.bottom - GAP - EDGE) }); // nunca cobre mais que 70% da altura
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);

  return (
    <>
      <button type="button" ref={btn} className="tm-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls="tm-panel" onClick={() => setOpen((o) => !o)}
        title={`Equipe do workspace: ${team?.label ?? 'personalizada'} (${live.length} ${live.length === 1 ? 'ativo' : 'ativos'}). Clique para gerenciar.`}>
        <Icon name="layers" size={13} /><b>{team?.label ?? 'Equipe'}</b><Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div id="tm-panel" ref={pop} className="tm-panel" role="dialog" aria-label="Gerenciar a equipe" style={pos ?? { visibility: 'hidden' }}>
          <p className="tm-h"><b>Equipe · {team?.label ?? 'personalizada'}</b><span>{where}</span></p>

          {!plan && <>{/* durante a troca de preset o menu mostra SÓ a troca: um passo por vez, sem rolagem */}
          <section className="tm-s" aria-label="Composição atual">
            <h3>Composição atual<span>{live.length} {live.length === 1 ? 'ativo' : 'ativos'}{sessions.length > live.length ? ` · ${sessions.length - live.length} encerrado${sessions.length - live.length === 1 ? '' : 's'}` : ''}</span></h3>
            {sessions.length === 0 ? <p className="dim small">Nenhum agente neste workspace.</p> : (
              <ul className="tm-l">{sessions.map((s) => { const st = stateOf(s); return (
                <li key={s.id} className={`st-${st}`}>
                  <i className="tm-led" aria-hidden="true" /><span className="tm-n"><b>{s.title}</b><span className="dim"> · {byRole[s.role]?.label ?? s.role} · {STATE_TEXT[st] ?? st}</span></span>
                  <button type="button" className="tm-x" disabled={busy} onClick={() => onRemove(s)} aria-label={s.status === 'running' ? `Encerrar ${s.title}` : `Remover ${s.title}`} title={s.status === 'running' ? 'Encerrar este agente (pede confirmação)' : 'Remover da lista'}><Icon name="close" size={12} /></button>
                </li>); })}</ul>
            )}
            {missing.length > 0 && <p className="small dim tm-miss">Faltam para completar “{team.label}”: {missing.map((r) => byRole[r]?.label ?? r).join(', ')}. <button type="button" className="tm-link" disabled={busy || room < 1} onClick={() => onAdd(missing)}>Abrir {missing.length === 1 ? 'o que falta' : 'os que faltam'}</button></p>}
          </section>

          <section className="tm-s" aria-label="Adicionar agente ou terminal">
            <h3>Adicionar agente ou terminal</h3>
            <div className="tm-row">
              <label className="sr" htmlFor="tm-role">Papel do novo terminal</label>
              <select id="tm-role" className="oc-sel" value={role} onChange={(e) => onRole(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
              {providers.length > 1 && <><label className="sr" htmlFor="tm-prov">Agente do novo terminal</label>
              <select id="tm-prov" className="oc-sel" value={provider} onChange={(e) => onProvider(e.target.value)}>{providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{providerOptionLabel(p)}</option>)}</select></>}
              <Btn disabled={busy || room < 1} onClick={() => onAdd([role], provider)} title="Abre um terminal com este papel e este agente (Claude Code ou Codex); cada agente que edita ganha o seu worktree quando há mais de um"><Icon name="plus" size={12} /> Terminal</Btn>
            </div>
            {room < 1 && <p className="small dim">Limite de terminais atingido: encerre algum antes de abrir outro.</p>}
          </section>
          </>}

          <section className="tm-s" aria-label="Alterar preset">
            {plan ? (() => {
              const target = presetById(plan.presetId), closing = live.filter((x) => plan.closeIds.includes(x.id));
              const label = (r) => byRole[r]?.label ?? r;
              const overMsg = plan.over.length ? plan.over.map((o) => (o.max === 0 ? `${label(o.role)} não faz parte da ${target.label}: feche-o` : `a ${target.label} tem ${o.max} ${label(o.role)}: feche o excedente`)).join('; ') : null;
              const problem = overMsg ?? (plan.slots.length ? draftOpenProblem({ slots: plan.slots }, { available, room: room + closing.length }) : null);
              const busyClosing = closing.filter((x) => ['working', 'waiting'].includes(stateOf(x)));
              const kept = live.length - closing.length;
              const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
              const result = [
                kept > 0 ? `${plural(kept, 'terminal continua', 'terminais continuam')} rodando` : null,
                closing.length ? `${plural(closing.length, 'fecha', 'fecham')}: ${closing.map((x) => x.title).join(', ')}` : null,
                plan.slots.length ? `${plan.slots.length === 1 ? 'abre' : 'abrem'}: ${squadSummary(plan.slots, labelOf)}` : null,
              ].filter(Boolean);
              return (
                <div className="tm-plan" role="group" aria-label={`Trocar para ${target.label}`}>
                  <button type="button" className="tm-back" onClick={() => setPlan(null)}>← Voltar aos presets</button>
                  <h4 className="tm-plan-h">Trocar para {target.label}</h4>
                  <p className="small dim tm-plan-from">Hoje: {team?.label ?? 'equipe personalizada'} com {plural(live.length, 'terminal', 'terminais')}. A {target.label} tem {plural(target.roles.length, 'vaga', 'vagas')}: {roleSummary(target.roles, label)}.</p>
                  {plan.canShrink ? (
                    <>
                      <p className="tm-plan-step"><b>1.</b> Escolha o que fica e o que fecha</p>
                      <ul className="tm-plan-keep">{live.map((x) => { const out = plan.closeIds.includes(x.id), st = stateOf(x); return (
                        <li key={x.id} className={out ? 'out' : 'in'}>
                          <i className={`tm-led st-${st}`} aria-hidden="true" /><span className="tm-n"><b>{x.title}</b><span className="dim"> · {STATE_TEXT[st] ?? st}</span></span>
                          <span className="tm-seg" role="group" aria-label={`O que fazer com ${x.title}`}>
                            <button type="button" aria-pressed={!out} disabled={busy} onClick={() => setKeep(x, false)}>Manter</button>
                            <button type="button" className="close" aria-pressed={out} disabled={busy} onClick={() => setKeep(x, true)}>Fechar</button>
                          </span>
                        </li>); })}</ul>
                      <p className="small dim tm-plan-hint">Já sugerimos o que fechar (os ociosos primeiro). Troque se preferir.</p>
                    </>
                  ) : <p className="small tm-plan-keepall">Os {plural(live.length, 'terminal atual continua', 'terminais atuais continuam')} rodando; nada será fechado.</p>}
                  {plan.slots.length > 0 && (
                    <>
                      <p className="tm-plan-step"><b>{plan.canShrink ? '2' : '1'}.</b> Novos terminais: escolha o agente de cada um</p>
                      <ul className="tm-plan-l">{plan.slots.map((x, i) => (
                        <li key={i}><span>{label(x.role)}</span><ProviderLogo id={x.provider} size={14} />
                          <select className="oc-sel" value={x.provider} onChange={(e) => setPlan({ ...plan, slots: plan.slots.map((y, k) => (k === i ? { ...y, provider: e.target.value } : y)) })} aria-label={`Agente de ${label(x.role)}`}>{providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{providerOptionLabel(p)}</option>)}</select></li>
                      ))}</ul>
                    </>
                  )}
                  {busyClosing.length > 0 && <p className="small oc-compose-bad" role="status">Atenção: {busyClosing.map((x) => x.title).join(', ')} {busyClosing.length === 1 ? 'está em atividade e será interrompido' : 'estão em atividade e serão interrompidos'}. As sessões continuam no histórico.</p>}
                  <div className="tm-plan-act">
                    <p className={`small tm-plan-res ${problem ? 'oc-compose-bad' : ''}`} role="status">{problem ? `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`.replace(/\.\.$/, '.') : <><b>Resultado:</b> {result.join(' · ')}.</>}</p>
                    <Btn kind={closing.length ? 'danger' : 'primary'} disabled={busy || !!problem} onClick={() => { const pl = plan; setOpen(false); onChangeWith(pl.presetId, pl.slots, closing); }}>Trocar para {target.label}</Btn>
                  </div>
                </div>
              );
            })() : (
              <>
                <h3>Alterar preset<span>você confirma antes de mudar</span></h3>
                <div className="tm-presets" role="radiogroup" aria-label="Preset da equipe">
                  {PRESETS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={p.id === preset} disabled={busy} className={p.id === preset ? 'on' : ''} onClick={() => pickPreset(p)}>
                    <b>{p.label}</b><span className="tm-pr-n">{plural2(p.roles.length)}</span><span className="tm-pr-r dim">{roleSummary(p.roles, (r) => byRole[r]?.label ?? r)}</span>{p.id === preset && <span className="tm-pr-now">atual</span>}</button>)}
                </div>
                <p className="small dim">Escolha uma equipe: antes de abrir ou fechar qualquer terminal, mostramos o que vai acontecer e você confirma.</p>
              </>
            )}
          </section>

          {saved && <p className="tm-foot"><button type="button" className="tm-link" disabled={busy || sessions.length > 0} onClick={() => { setOpen(false); onReset(); }} title={sessions.length > 0 ? 'Disponível quando o workspace não tiver terminais: encerre-os antes' : 'Volta a mostrar os presets de configuração inicial'}>Redefinir equipe deste workspace</button></p>}
        </div>
      )}
    </>
  );
}
