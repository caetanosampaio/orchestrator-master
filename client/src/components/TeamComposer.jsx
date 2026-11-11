import React, { useRef } from 'react';
import { Btn, Icon } from './ui.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { PRESETS, availableMixes, defaultMix } from '../team-view.js';
import { providerOptionLabel } from '../env-view.js';
import { MAX_SLOTS, MAX_NAME, draftFromPreset, withSlot, withProvider, removeSlot, addSlot, applyMix, draftOpenProblem, draftSaveProblem, squadSummary, slotOptions } from '../squads.js';
import { EditPanel, EditRow, SelectBox, Pills, TextField } from './settings/SettingsUi.jsx';

/**
 * Editor de time, no painel de edição único das Configurações: o nome, "Começar de" (formações prontas), as vagas (papel, IA, modelo e esforço de cada terminal, uma vaga por linha) e o atalho de distribuição das IAs.
 * Controlado por quem usa: `draft` = { id, name, slots[{role,provider,model?,effort?}], mix }. "Abrir equipe" abre tudo de uma vez; "Salvar" guarda (exige nome). Só escolhe e confirma: quem abre e quem salva é quem usa o componente.
 * `options` (do GET /api/team-templates: { <agente>: { models, efforts } }) liga os seletores de modelo e esforço por vaga; sem ele (servidor antigo) eles não aparecem. Sem `onOpen` não há "Abrir equipe".
 */
export default function TeamComposer({ draft, onChange, onOpen = null, onSave, onCancel, providers = [], roles = [], squads = [], busy = false, room = Infinity, options = null, title, saveLabel = null }) {
  const available = providers.filter((p) => p.available).map((p) => p.id);
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  const roleOf = Object.fromEntries(roles.map((r) => [r.id, r]));
  const openProblem = draftOpenProblem(draft, { available, room });
  const saveProblem = draftSaveProblem(draft, { available, squads });
  const mixes = availableMixes(available);
  const keys = useRef(0), keyOf = useRef(new WeakMap());
  const key = (s) => { if (!keyOf.current.has(s)) keyOf.current.set(s, ++keys.current); return keyOf.current.get(s); }; // chave estável por vaga: a animação de entrada roda só nas novas
  const base = (presetId) => ({ ...draftFromPreset(presetId, draft.mix === 'custom' ? defaultMix(available) : draft.mix, available), id: draft.id, name: draft.name }); // recomeça as vagas e mantém o nome e o squad que está sendo editado
  const heading = title === null ? null : (title ?? (draft.id ? 'Editar squad' : 'Novo squad'));

  return (
    <EditPanel title={heading ?? 'Montar o time'} hint="Escolha o papel e a IA de cada vaga, com o modelo e o esforço." label="Montar squad"
      footer={(
        <>
          <span className={`ep-sum${openProblem ? ' bad' : ''}`} role="status">{openProblem ?? `${onOpen ? 'Abre' : 'Time de'} ${squadSummary(draft.slots, labelOf)}.`}</span>
          <span className="ep-acts">
            {onOpen && <Btn kind="primary" disabled={busy || !!openProblem} onClick={onOpen}>Abrir equipe</Btn>}
            <Btn kind={onOpen ? 'quiet' : 'primary'} disabled={busy || !!saveProblem} onClick={onSave} title={saveProblem ?? 'Guardar este squad para abrir com um clique'}>{saveLabel ?? (draft.id ? 'Salvar alterações' : 'Salvar squad')}</Btn>
            <Btn kind="quiet" disabled={busy} onClick={onCancel}>Cancelar</Btn>
          </span>
        </>
      )}>
      <EditRow label="Nome" hint="Para guardar e reconhecer o time.">
        <TextField label="Nome do squad" value={draft.name} maxLength={MAX_NAME} placeholder="Nome do squad (para salvar)" onChange={(e) => onChange({ ...draft, name: e.target.value })} autoComplete="off" />
        {draft.name.trim() && saveProblem && !openProblem && <p className="ep-err" role="status">{saveProblem}</p>}
      </EditRow>
      <EditRow label="Começar de" hint="Troca as vagas por uma formação pronta.">
        <div className="ep-pills" role="group" aria-label="Começar de">
          {PRESETS.filter((p) => p.id !== 'builder').map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => onChange(base(p.id))}><span>{p.label}</span><em>{p.roles.length}</em></button>)}
          <button type="button" disabled={busy} onClick={() => onChange(base('empty'))}><span>Vazio</span></button>
        </div>
      </EditRow>
      <EditRow label="Vagas" hint={`Até ${MAX_SLOTS}. Uma por linha.`}>
        <div className="ep-slots">
          <div className="ep-slot-head" aria-hidden="true"><span /><span>Papel</span><span>IA</span><span>{options ? 'Modelo' : ''}</span><span>{options ? 'Esforço' : ''}</span><span /></div>
          <ul>
            {draft.slots.map((s, i) => {
              const opt = slotOptions(options, s.provider);
              return (
                <li key={key(s)} className="ep-slot" style={{ '--c': roleOf[s.role]?.color || 'var(--brand)' }}>
                  <i className="ep-slot-dot" aria-hidden="true" />
                  <SelectBox label={`Papel da vaga ${i + 1}`} value={s.role} disabled={busy} onChange={(v) => onChange(withSlot(draft, i, { role: v }))}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</SelectBox>
                  <span className="ep-slot-ai"><ProviderMascot id={s.provider} size={12} />
                    <SelectBox label={`Agente da vaga ${i + 1}`} value={s.provider} disabled={busy} onChange={(v) => onChange(withProvider(draft, i, v))}>{providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{providerOptionLabel(p)}</option>)}</SelectBox></span>
                  {options && (opt?.models.length > 0
                    ? <SelectBox label={`Modelo da vaga ${i + 1}`} value={s.model ?? ''} disabled={busy} onChange={(v) => onChange(withSlot(draft, i, { model: v || undefined }))}>
                      <option value="">Padrão</option>{opt.models.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}{s.model && !opt.models.some((m) => m.id === s.model) && <option value={s.model}>{s.model}</option>}</SelectBox>
                    : <span />)}
                  {options && (opt?.efforts.length > 0
                    ? <SelectBox label={`Esforço da vaga ${i + 1}`} value={s.effort ?? ''} disabled={busy} onChange={(v) => onChange(withSlot(draft, i, { effort: v || undefined }))}>
                      <option value="">Padrão</option>{opt.efforts.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}{s.effort && !opt.efforts.some((m) => m.id === s.effort) && <option value={s.effort}>{s.effort}</option>}</SelectBox>
                    : <span />)}
                  <button type="button" className="ep-x" disabled={busy} onClick={() => onChange(removeSlot(draft, i))} aria-label={`Remover a vaga ${i + 1}`} title="Remover vaga"><Icon name="close" size={12} /></button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="ep-add" disabled={busy || draft.slots.length >= MAX_SLOTS} onClick={() => onChange(addSlot(draft, available))}><Icon name="plus" size={11} /> Adicionar vaga</button>
        </div>
      </EditRow>
      {mixes.length > 1 && (
        <EditRow label="Distribuição" hint="Atalho: troca a IA de todas as vagas de uma vez.">
          <Pills label="Distribuição dos agentes" value={draft.mix} options={mixes.map((m) => ({ id: m.id, label: m.label }))} disabled={busy || !draft.slots.length} onChange={(id) => onChange(applyMix(draft, id, available))} />
        </EditRow>
      )}
    </EditPanel>
  );
}
