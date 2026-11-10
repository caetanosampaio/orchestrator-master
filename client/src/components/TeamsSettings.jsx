import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { usePrefs } from '../hooks.js';
import { useSquads } from '../use-squads.js';
import { availableMixes } from '../team-view.js';
import { builtinSquads, presetSquads, curatedSquads, draftFromPreset, draftFromSquad, draftFromCopy, cleanSlots, slotOptions } from '../squads.js';
import { providerStatus, withClaudeLogin, providerColor } from '../provider-view.js';
import TeamRows from './TeamRows.jsx';
import TeamComposer from './TeamComposer.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { Icon } from './ui.jsx';

const QUICK = { 'all-claude': 'Todos Claude Code', 'all-codex': 'Todos Codex', 'claude-leads': 'Misto' };

/** Os agentes (providers): o bonequinho na cor do provider, o nome, o estado e quantos modelos e níveis de esforço dá para escolher. Vem de /api/terminals e do `options` do servidor. */
function Agents({ providers, options, login }) {
  if (!providers.length) return null;
  const rows = withClaudeLogin(providers, login);
  return (
    <section className="tr-sec" aria-label="Agentes">
      <h4 className="tr-h">Agentes <span className="dim">cada vaga de uma equipe usa um deles</span></h4>
      <ul className="tr-agents">
        {rows.map((p) => {
          const st = providerStatus(p), o = slotOptions(options, p.id);
          return (
            <li key={p.id} className={`tr-agent${p.available ? '' : ' off'}`} style={{ '--pm': providerColor(p.id) }}>
              <ProviderMascot id={p.id} size={72} label={p.label} />
              <span className={`oc-pill${st.kind === 'ok' ? ' ok' : st.kind === 'bad' ? ' bad' : ''}`}>{st.text}</span>
              <span className="dim small">{o ? `${o.models.length} ${o.models.length === 1 ? 'modelo' : 'modelos'} · ${o.efforts.length} ${o.efforts.length === 1 ? 'nível' : 'níveis'} de esforço` : 'modelo e esforço padrão'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Configurações > Equipes: predefinições de equipe (nome + vagas { papel, agente, modelo?, esforço? }) guardadas no servidor (/api/team-templates).
 * Mostra os agentes (bonequinhos), as equipes do FORGE por objetivo e as estruturas básicas (em linhas horizontais, com agente, modelo e esforço de cada vaga) e as suas equipes.
 * Criar (do zero ou por um atalho de agente), editar, duplicar, salvar e excluir; as do FORGE só servem de ponto de partida. Os seletores de modelo e esforço dependem do `options` que o servidor
 * informa; sem ele (servidor antigo) a vaga fica só com papel e agente. Abrir a equipe é no estado vazio do Cockpit.
 */
export default function TeamsSettings() {
  const { terminals, notify, state } = useStore();
  const [prefs, setPref] = usePrefs();
  const sq = useSquads();
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false), [freshId, setFreshId] = useState(null);
  const providers = terminals?.providers ?? [], roles = terminals?.roles ?? [], byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
  const available = providers.filter((p) => p.available).map((p) => p.id);
  const provider = available.includes(prefs.provider) ? prefs.provider : (available[0] ?? 'claude');
  const quick = availableMixes(available).filter((m) => QUICK[m.id]);
  const basics = [...builtinSquads(available), ...presetSquads(provider)];

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
  const rows = { byRole, providers, options: sq.options, freshId, onEdit: (s) => setDraft(draftFromSquad(s)), onDuplicate: (s) => setDraft(draftFromCopy(s)), onDelete: remove };
  return (
    <>
      <p className="dim small oc-lead">Uma equipe é um conjunto de vagas: o papel, o agente{sq.options ? ', o modelo e o esforço' : ''} de cada terminal. No Cockpit, um workspace sem terminais lista as suas equipes e as prontas, e um clique abre todos de uma vez.</p>
      <Agents providers={providers} options={sq.options} login={state?.prereqs?.login} />
      <TeamRows title="Equipes do FORGE" hint="prontas para usar, por objetivo" squads={curatedSquads()} {...rows} />
      <TeamRows title="Estruturas básicas" hint="só a formação, sem modelo nem esforço definidos" squads={basics} {...rows}>
        <div className="oc-row tr-default">
          <div className="oc-row-t"><b>Agente padrão das estruturas básicas</b><span className="dim small">As prontas (Dupla, Squad, Squad de 6, Construtor) usam um agente só.</span></div>
          <div className="oc-row-c">
            <select value={provider} onChange={(e) => setPref('provider', e.target.value)} aria-label="Agente padrão das estruturas básicas" disabled={!available.length}>
              {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? '' : ' (indisponível)'}</option>)}
            </select>
          </div>
        </div>
      </TeamRows>
      <TeamRows title="Minhas equipes" hint={sq.squads.length ? null : 'monte a sua e abra a equipe toda com um clique'} squads={sq.squads} emptyText={sq.ready ? null : 'Carregando as equipes…'} {...rows}>
        <div className="tr-new" role="group" aria-label="Nova equipe">
          <span className="dim small">Nova equipe</span>
          {quick.map((m) => <button key={m.id} type="button" onClick={() => setDraft(draftFromPreset('squad', m.id, available))} title={m.label}>{QUICK[m.id]}</button>)}
          <button type="button" onClick={() => setDraft(draftFromPreset('empty', 'custom', available))}><Icon name="plus" size={11} /> Em branco</button>
        </div>
      </TeamRows>
    </>
  );
}
