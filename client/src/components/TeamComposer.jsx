import React, { useRef, useState } from 'react';
import { Btn, Icon } from './ui.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { PRESETS, availableMixes, defaultMix } from '../team-view.js';
import { providerOptionLabel } from '../env-view.js';
import { MAX_SLOTS, MAX_NAME, MAX_INSTRUCTION, MAX_SLOT_SKILLS, draftFromPreset, withSlot, withProvider, withSlotSkill, removeSlot, addSlot, applyMix, draftOpenProblem, draftSaveProblem, instructionProblem, squadSummary, slotOptions, takesSkills } from '../squads.js';
import { groupSkills } from '../skills-view.js';
import { EditPanel, EditRow, SelectBox, Pills, TextField, TextArea, CheckChips } from './settings/SettingsUi.jsx';

/**
 * Editor de time, no painel de edição único das Configurações: o nome, a instrução do time, "Começar de" (formações prontas), as vagas (papel, IA, modelo, esforço e skills de cada terminal, uma vaga por linha) e o atalho de distribuição das IAs.
 * Controlado por quem usa: `draft` = { id, name, instruction, slots[{role,provider,model?,effort?,skills?}], mix }. "Abrir equipe" abre tudo de uma vez; "Salvar" guarda (exige nome). Só escolhe e confirma: quem abre e quem salva é quem usa o componente.
 * `options` (do GET /api/team-templates: { <agente>: { models, efforts } }) liga os seletores de modelo e esforço por vaga; sem ele (servidor antigo) eles não aparecem. Sem `onOpen` não há "Abrir equipe".
 * `catalog` (catalog.skills do GET /api/loadouts, sem o texto) liga o seletor de skills de cada vaga, agrupado por Processo e Domínio; sem ele (lendo, ou servidor antigo) o seletor não aparece.
 */
export default function TeamComposer({ draft, onChange, onOpen = null, onSave, onCancel, providers = [], roles = [], squads = [], busy = false, room = Infinity, options = null, catalog = null, title, saveLabel = null }) {
  const available = providers.filter((p) => p.available).map((p) => p.id);
  const labelOf = (id) => providers.find((p) => p.id === id)?.label ?? id;
  const roleOf = Object.fromEntries(roles.map((r) => [r.id, r]));
  const openProblem = draftOpenProblem(draft, { available, room });
  const saveProblem = draftSaveProblem(draft, { available, squads });
  const instrProblem = instructionProblem(draft.instruction);
  const mixes = availableMixes(available);
  const groups = Array.isArray(catalog) && catalog.length ? groupSkills(catalog) : [];
  const [openSkills, setOpenSkills] = useState(() => new Set()); // vagas com o seletor de skills aberto (pela chave estável da vaga)
  const keys = useRef(0), keyOf = useRef(new WeakMap());
  const key = (s) => { if (!keyOf.current.has(s)) keyOf.current.set(s, ++keys.current); return keyOf.current.get(s); }; // chave estável por vaga: a animação de entrada roda só nas novas
  // Mudança numa vaga cria um objeto novo: ele herda a chave da anterior, senão a linha remonta e o foco do teclado (no seletor ou na skill marcada) se perde.
  const slotChange = (i, next) => { const was = draft.slots[i], now = next.slots[i]; if (was && now && now !== was && !keyOf.current.has(now)) keyOf.current.set(now, key(was)); onChange(next); };
  const toggleOpen = (k) => setOpenSkills((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const base = (presetId) => ({ ...draftFromPreset(presetId, draft.mix === 'custom' ? defaultMix(available) : draft.mix, available), id: draft.id, name: draft.name, instruction: draft.instruction ?? '' }); // recomeça as vagas e mantém o nome, a instrução e o squad que está sendo editado
  const heading = title === null ? null : (title ?? (draft.id ? 'Editar squad' : 'Novo squad'));
  const instrLen = String(draft.instruction ?? '').length;

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
        {draft.name.trim() && saveProblem && !openProblem && !instrProblem && <p className="ep-err" role="status">{saveProblem}</p>}
      </EditRow>
      <EditRow label="Instrução do time" hint="Vai para todos os terminais do time, junto com o papel de cada um. Opcional.">
        <TextArea label="Instrução do time" rows={3} value={draft.instruction ?? ''} maxLength={MAX_INSTRUCTION} disabled={busy} aria-describedby="ep-instr-n"
          placeholder="O foco do time e o que cada vaga faz. Ex.: priorize acessibilidade; o revisor confere os testes." onChange={(e) => onChange({ ...draft, instruction: e.target.value })} />
        <p className="ep-count" id="ep-instr-n"><span>{instrLen}/{MAX_INSTRUCTION}</span> Vira uma linha só; os caracteres &amp; | &lt; &gt; ^ % &quot; e a crase são removidos.</p>
        {instrProblem && <p className="ep-err" role="status">{instrProblem}</p>}
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
              const opt = slotOptions(options, s.provider), k = key(s), can = takesSkills(s.provider, providers), picked = can && Array.isArray(s.skills) ? s.skills : [], isOpen = openSkills.has(k);
              return (
                <li key={k} className="ep-slot" style={{ '--c': roleOf[s.role]?.color || 'var(--brand)' }}>
                  <i className="ep-slot-dot" aria-hidden="true" />
                  <SelectBox label={`Papel da vaga ${i + 1}`} value={s.role} disabled={busy} onChange={(v) => slotChange(i, withSlot(draft, i, { role: v }))}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</SelectBox>
                  <span className="ep-slot-ai"><ProviderMascot id={s.provider} size={12} />
                    <SelectBox label={`Agente da vaga ${i + 1}`} value={s.provider} disabled={busy} onChange={(v) => slotChange(i, withProvider(draft, i, v))}>{providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{providerOptionLabel(p)}</option>)}</SelectBox></span>
                  {options && (opt?.models.length > 0
                    ? <SelectBox label={`Modelo da vaga ${i + 1}`} value={s.model ?? ''} disabled={busy} onChange={(v) => slotChange(i, withSlot(draft, i, { model: v || undefined }))}>
                      <option value="">Padrão</option>{opt.models.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}{s.model && !opt.models.some((m) => m.id === s.model) && <option value={s.model}>{s.model}</option>}</SelectBox>
                    : <span />)}
                  {options && (opt?.efforts.length > 0
                    ? <SelectBox label={`Esforço da vaga ${i + 1}`} value={s.effort ?? ''} disabled={busy} onChange={(v) => slotChange(i, withSlot(draft, i, { effort: v || undefined }))}>
                      <option value="">Padrão</option>{opt.efforts.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}{s.effort && !opt.efforts.some((m) => m.id === s.effort) && <option value={s.effort}>{s.effort}</option>}</SelectBox>
                    : <span />)}
                  <button type="button" className="ep-x" disabled={busy} onClick={() => onChange(removeSlot(draft, i))} aria-label={`Remover a vaga ${i + 1}`} title="Remover vaga"><Icon name="close" size={12} /></button>
                  {groups.length > 0 && (
                    <div className="ep-slot-sk">
                      <button type="button" className="ep-sk-toggle" aria-expanded={isOpen} aria-controls={`ep-sk-${k}`} onClick={() => toggleOpen(k)}>
                        <i className="hz-caret" aria-hidden="true" />Skills da vaga {i + 1}
                        <span className="ep-sk-sum">{!can ? 'O Codex CLI ainda não recebe skills' : picked.length ? `${picked.length}/${MAX_SLOT_SKILLS} · ${picked.join(', ')}` : 'só as do papel'}</span>
                      </button>
                      {isOpen && (
                        <div className="ep-sk-body" id={`ep-sk-${k}`}>
                          {!can && <p className="ep-sk-note" role="note">O Codex CLI ainda não recebe skills. Use o Claude Code nesta vaga para escolher skills.</p>}
                          {can && <p className="ep-sk-note">Somam-se às skills do papel (Configurações &gt; Skills). Até {MAX_SLOT_SKILLS} por vaga.</p>}
                          {groups.map((g) => (
                            <div key={g.id} className="ep-sk-group">
                              <span className="ep-sk-gl">{g.label}</span>
                              <CheckChips label={`Skills de ${g.label} da vaga ${i + 1}`} items={g.skills.map((x) => ({ id: x.id, title: x.description }))} selected={picked} max={MAX_SLOT_SKILLS} disabled={busy || !can}
                                onToggle={(id) => slotChange(i, withSlotSkill(draft, i, id))} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
