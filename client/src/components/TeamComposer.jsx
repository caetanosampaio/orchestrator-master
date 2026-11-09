import React, { useRef } from 'react';
import { Btn, Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { PRESETS, availableMixes, defaultMix } from '../team-view.js';
import { providerOptionLabel } from '../env-view.js';
import { MAX_SLOTS, MAX_NAME, draftFromPreset, withSlot, removeSlot, addSlot, applyMix, draftOpenProblem, draftSaveProblem, squadSummary } from '../squads.js';

/**
 * Editor de squad: nome opcional, vagas livres (papel + agente de cada uma, adicionar e remover) e atalhos de distribuição. Parte de um preset ou de um squad já salvo.
 * Controlado pelo cockpit: `draft` = { id, name, slots[{role,provider}], mix }. "Abrir equipe" abre tudo de uma vez; "Salvar squad" guarda para reutilizar (exige nome).
 * Só escolhe e confirma: quem abre e quem salva é o cockpit.
 */
export default function TeamComposer({ draft, onChange, onOpen, onSave, onCancel, providers = [], roles = [], squads = [], busy = false, room = Infinity }) {
  const available = providers.filter((p) => p.available).map((p) => p.id);
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  const roleOf = Object.fromEntries(roles.map((r) => [r.id, r]));
  const openProblem = draftOpenProblem(draft, { available, room });
  const saveProblem = draftSaveProblem(draft, { available, squads });
  const mixes = availableMixes(available);
  const keys = useRef(0), keyOf = useRef(new WeakMap());
  const key = (s) => { if (!keyOf.current.has(s)) keyOf.current.set(s, ++keys.current); return keyOf.current.get(s); }; // chave estável por vaga: a animação de entrada roda só nas novas
  const base = (presetId) => ({ ...draftFromPreset(presetId, draft.mix === 'custom' ? defaultMix(available) : draft.mix, available), id: draft.id, name: draft.name }); // recomeça as vagas e mantém o nome e o squad que está sendo editado

  return (
    <section className="oc-compose" aria-label="Montar squad">
      <h4>{draft.id ? 'Editar squad' : 'Novo squad'} <span className="dim small">escolha o papel e o agente de cada vaga</span></h4>
      <label className="sq-name">
        <span className="sr">Nome do squad</span>
        <input type="text" value={draft.name} maxLength={MAX_NAME} placeholder="Nome do squad (para salvar)" onChange={(e) => onChange({ ...draft, name: e.target.value })} autoComplete="off" />
      </label>
      <div className="oc-compose-presets" role="group" aria-label="Começar de">
        <span className="dim small">Começar de</span>
        {PRESETS.filter((p) => p.id !== 'builder').map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => onChange(base(p.id))}>{p.label}<span className="dim"> · {p.roles.length}</span></button>)}
        <button type="button" disabled={busy} onClick={() => onChange(base('empty'))}>Vazio</button>
      </div>
      <ul className="oc-compose-slots">
        {draft.slots.map((s, i) => (
          <li key={key(s)} className="sq-slot" style={{ '--c': roleOf[s.role]?.color || 'var(--brand)' }}>
            <i className="sq-dot" aria-hidden="true" />
            <select className="oc-sel" value={s.role} disabled={busy} onChange={(e) => onChange(withSlot(draft, i, { role: e.target.value }))} aria-label={`Papel da vaga ${i + 1}`}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <ProviderLogo id={s.provider} size={14} />
            <select className="oc-sel" value={s.provider} disabled={busy} onChange={(e) => onChange(withSlot(draft, i, { provider: e.target.value }))} aria-label={`Agente da vaga ${i + 1}`}>
              {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{providerOptionLabel(p)}</option>)}
            </select>
            <button type="button" className="sq-x" disabled={busy} onClick={() => onChange(removeSlot(draft, i))} aria-label={`Remover a vaga ${i + 1}`} title="Remover vaga"><Icon name="close" size={12} /></button>
          </li>
        ))}
      </ul>
      <div className="oc-compose-mixes" role="group" aria-label="Distribuição dos agentes">
        <button type="button" className="sq-add" disabled={busy || draft.slots.length >= MAX_SLOTS} onClick={() => onChange(addSlot(draft, available))}><Icon name="plus" size={11} /> Adicionar vaga</button>
        {mixes.length > 1 && mixes.map((m) => <button key={m.id} type="button" className={m.id === draft.mix ? 'on' : ''} disabled={busy || !draft.slots.length} onClick={() => onChange(applyMix(draft, m.id, available))} title={m.label}>{m.label}</button>)}
      </div>
      <p className={`small ${openProblem ? 'oc-compose-bad' : 'dim'}`} role="status">{openProblem ?? `Abre ${squadSummary(draft.slots, labelOf)}.`}</p>
      <div className="oc-compose-act">
        <Btn kind="primary" disabled={busy || !!openProblem} onClick={onOpen}>Abrir equipe</Btn>
        <Btn kind="quiet" disabled={busy || !!saveProblem} onClick={onSave} title={saveProblem ?? 'Guardar este squad para abrir com um clique'}>{draft.id ? 'Salvar alterações' : 'Salvar squad'}</Btn>
        <Btn kind="quiet" disabled={busy} onClick={onCancel}>Cancelar</Btn>
      </div>
      {draft.name.trim() && saveProblem && !openProblem && <p className="small oc-compose-bad" role="status">{saveProblem}</p>}
    </section>
  );
}
