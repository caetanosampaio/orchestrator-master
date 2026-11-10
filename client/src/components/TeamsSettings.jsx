import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { usePrefs } from '../hooks.js';
import { useSquads } from '../use-squads.js';
import { availableMixes } from '../team-view.js';
import { builtinSquads, presetSquads, draftFromPreset, draftFromSquad, draftFromCopy, cleanSlots } from '../squads.js';
import SquadGallery from './SquadGallery.jsx';
import TeamComposer from './TeamComposer.jsx';
import { Btn } from './ui.jsx';

const QUICK = { 'all-claude': 'Todos Claude Code', 'all-codex': 'Todos Codex', 'claude-leads': 'Misto' };

/**
 * Configurações > Equipes: predefinições de equipe (nome + vagas { papel, agente, modelo?, esforço? }) guardadas no servidor (/api/team-templates).
 * Criar (do zero ou por um atalho de agente), editar, duplicar, salvar e excluir. As embutidas só servem de ponto de partida. Os seletores de modelo e esforço
 * dependem do `options` que o servidor informa; sem ele (servidor antigo) a vaga fica só com papel e agente. Abrir a equipe é no estado vazio do Cockpit.
 */
export default function TeamsSettings() {
  const { terminals, notify } = useStore();
  const [prefs, setPref] = usePrefs();
  const sq = useSquads();
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false), [freshId, setFreshId] = useState(null);
  const providers = terminals?.providers ?? [], roles = terminals?.roles ?? [], byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
  const available = providers.filter((p) => p.available).map((p) => p.id);
  const provider = available.includes(prefs.provider) ? prefs.provider : (available[0] ?? 'claude');
  const quick = availableMixes(available).filter((m) => QUICK[m.id]);
  const builtins = [...builtinSquads(available), ...presetSquads(provider)];

  const save = async () => {
    if (!draft || saving) return; setSaving(true);
    try {
      const name = draft.name.trim(), slots = cleanSlots(draft.slots);
      const t = draft.id ? await sq.update(draft.id, { name, slots }) : await sq.create(name, slots);
      setDraft(null); setFreshId(t.id); setTimeout(() => setFreshId((c) => (c === t.id ? null : c)), 2600); notify(`Equipe "${t.name}" salva.`);
    } catch (e) { notify(e?.message || 'Não foi possível salvar a equipe.', 'error'); } finally { setSaving(false); }
  };
  const remove = async (s) => { try { await sq.remove(s.id); notify(`Equipe "${s.name}" excluída.`); } catch (e) { notify(e?.message || 'Não foi possível excluir a equipe.', 'error'); } };

  if (sq.missing) return <p className="oc-note err" role="status">Este servidor ainda não guarda equipes salvas. Atualize o FORGE para criar predefinições; as equipes prontas continuam disponíveis no Cockpit.</p>;
  if (draft) return <TeamComposer draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} providers={providers} roles={roles} squads={sq.squads} busy={saving} options={sq.options} />;
  return (
    <>
      <p className="dim small oc-lead">Uma equipe é um conjunto de vagas: o papel, o agente{sq.options ? ', o modelo e o esforço' : ''} de cada terminal. No Cockpit, um workspace sem terminais lista as suas equipes e as prontas, e um clique abre todos de uma vez.</p>
      <div className="oc-row">
        <div className="oc-row-t"><b>Agente padrão das equipes prontas</b><span className="dim small">As prontas (Dupla, Squad, Squad de 6, Construtor) usam um agente só.</span></div>
        <div className="oc-row-c">
          <select value={provider} onChange={(e) => setPref('provider', e.target.value)} aria-label="Agente padrão das equipes prontas" disabled={!available.length}>
            {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? '' : ' (indisponível)'}</option>)}
          </select>
        </div>
      </div>
      <div className="oc-compose-presets" role="group" aria-label="Nova equipe por atalho">
        <span className="dim small">Nova equipe</span>
        {quick.map((m) => <button key={m.id} type="button" onClick={() => setDraft(draftFromPreset('squad', m.id, available))} title={m.label}>{QUICK[m.id]}</button>)}
        <button type="button" onClick={() => setDraft(draftFromPreset('empty', 'custom', available))}>Em branco</button>
      </div>
      <SquadGallery builtins={builtins} mine={sq.squads} byRole={byRole} providers={providers} freshId={freshId} openLabel="Editar a equipe"
        onOpen={(s) => setDraft(draftFromSquad(s))} onEdit={(s) => setDraft(draftFromSquad(s))} onDuplicate={(s) => setDraft(draftFromCopy(s))} onDelete={remove} onNew={() => setDraft(draftFromPreset('squad', quick[0]?.id ?? 'all-claude', available))} />
      {!sq.ready && <p className="dim small" role="status">Carregando as equipes…</p>}
    </>
  );
}
