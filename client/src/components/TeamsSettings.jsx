import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { usePrefs } from '../hooks.js';
import { useSquads } from '../use-squads.js';
import { availableMixes } from '../team-view.js';
import { curatedSquads, draftFromPreset, draftFromSquad, draftFromCopy, draftForInstall, isInstalled, cleanSlots, describeSquad, slotChoiceLabels, squadMissing } from '../squads.js';
import TeamComposer from './TeamComposer.jsx';
import { TeamRow, TeamSection, TcBtn, labelFor } from './TeamCards.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { Icon } from './ui.jsx';
import { Block } from './settings/SettingsUi.jsx';

const QUICK = { 'all-claude': 'Todos Claude Code', 'all-codex': 'Todos Codex', 'claude-leads': 'Misto' };
const EMPTY_STATE = ['claude', 'codex', 'claude']; // os três mascotes da ilustração de "Seus" vazio

/** Cabeçalho de uma página de Times prontos: voltar (nas páginas de dentro), título com etiqueta, frase de apoio e a ação à direita. */
function Head({ title, tag = null, sub, back = null, action = null }) {
  return (
    <>
      {back && <button type="button" className="set-crumb" onClick={back}><Icon name="chevronRight" size={12} /><span>Times prontos</span></button>}
      <div className="set-head">
        <div><h1 className="set-title">{title}{tag && <span className="set-title-tag">{tag}</span>}</h1>{sub && <p className="set-sub">{sub}</p>}</div>
        {action}
      </div>
    </>
  );
}

/** "Ver por dentro": quem faz o quê, com o provider, o modelo e o esforço de cada vaga, e as ações do time. Uma página dentro das Configurações (a barra lateral continua). */
function Detail({ squad, kind, byRole, labelOf, options, available, known, onBack, onEdit, onInstall }) {
  const { tagline, about } = describeSquad(squad), missing = known ? squadMissing(squad, available) : [];
  return (
    <>
      <Head title={squad.name} tag={squad.tag ?? (kind === 'mine' ? 'meu' : 'FORGE')} sub={tagline} back={onBack} />
      {about && <p className="tc-about">{about}</p>}
      {missing.length > 0 && <p className="oc-note err" role="status">Este time usa {missing.map(labelOf).join(' e ')}, que não está instalado. Ao instalar você pode trocar o agente de cada vaga.</p>}
      <Block title="Quem faz cada coisa" hint={`${squad.slots.length} ${squad.slots.length === 1 ? 'vaga' : 'vagas'}`} id="td">
        <ul className="td-grid">
          {squad.slots.map((s, k) => {
            const role = byRole[s.role], ch = slotChoiceLabels(s, options);
            return (
              <li key={k} className="td-card" style={{ '--role': role?.color || 'var(--brand)' }}>
                <ProviderMascot id={s.provider} size={46} hat={s.role === 'maestro'} />
                <span className="td-role"><i aria-hidden="true" />{role?.label ?? s.role}</span>
                <b className="td-prov">{labelOf(s.provider)}</b>
                <span className={`tc-chip${ch.modelSet ? ' set' : ''}`}>{ch.model}</span>
                <span className={`tc-chip${ch.effortSet ? ' set' : ''}`}>{ch.effort}</span>
              </li>
            );
          })}
        </ul>
      </Block>
      <div className="td-act">
        {kind === 'install' && <TcBtn kind="primary" icon="plus" onClick={() => onInstall(squad)}>Instalar e editar</TcBtn>}
        {kind === 'mine' && <TcBtn kind="primary" icon="pencil" onClick={() => onEdit(squad)}>Editar</TcBtn>}
      </div>
    </>
  );
}

/**
 * Configurações > Times prontos (no formato da tela de referência, em preto): "Do FORGE" (vêm prontos: o time em destaque e as estruturas básicas, abrem no Cockpit), "Para instalar" (opcionais, por objetivo:
 * dá para ver por dentro e instalar; ao instalar abre a página de edição, e só depois de salvar o time passa a ser seu) e "Seus" (os que você montou: editar, duplicar, excluir; vêm de /api/team-templates).
 * Ver e editar abrem como página DENTRO das Configurações (a barra lateral não some). Os seletores de modelo e esforço dependem do `options` do servidor; sem ele a vaga fica só com papel e agente.
 */
export default function TeamsSettings() {
  const { terminals, notify } = useStore();
  const [prefs, setPref] = usePrefs();
  const sq = useSquads();
  const [view, setView] = useState({ name: 'list' }), [saving, setSaving] = useState(false), [freshId, setFreshId] = useState(null);
  const providers = terminals?.providers ?? [], roles = terminals?.roles ?? [], byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
  const available = providers.filter((p) => p.available).map((p) => p.id), known = providers.length > 0, labelOf = labelFor(providers);
  const provider = available.includes(prefs.provider) ? prefs.provider : (available[0] ?? 'claude');
  const quick = availableMixes(available).filter((m) => QUICK[m.id]);
  const common = { byRole, labelOf, options: sq.options, available, known };
  const back = () => setView({ name: 'list' });

  const save = async () => {
    const { draft, mode } = view; if (!draft || saving) return; setSaving(true);
    try {
      const name = draft.name.trim(), slots = cleanSlots(draft.slots);
      const t = draft.id ? await sq.update(draft.id, { name, slots }) : await sq.create(name, slots);
      setView({ name: 'list' }); setFreshId(t.id); setTimeout(() => setFreshId((c) => (c === t.id ? null : c)), 2600);
      notify(mode === 'install' ? `Time "${t.name}" instalado: ele aparece em Seus.` : `Time "${t.name}" salvo.`);
    } catch (e) { notify(e?.message || 'Não foi possível salvar o time.', 'error'); } finally { setSaving(false); }
  };
  const remove = async (s) => { try { await sq.remove(s.id); notify(`Time "${s.name}" excluído.`); } catch (e) { notify(e?.message || 'Não foi possível excluir o time.', 'error'); } };
  const edit = (draft, mode) => setView({ name: 'edit', draft, mode });
  const newTeam = () => edit(draftFromPreset('squad', quick[0]?.id ?? 'all-claude', available), 'new');

  if (sq.missing) return <p className="oc-note err" role="status">Este servidor ainda não guarda times salvos. Atualize o FORGE para instalar e montar times; os que vêm prontos continuam disponíveis no Cockpit.</p>;

  if (view.name === 'edit') {
    const { draft, mode } = view;
    const head = mode === 'install' ? { title: 'Instalar time', sub: 'Mude o que quiser antes de instalar: o nome, o agente, o modelo e o esforço de cada vaga. O time só passa a ser seu quando você salvar.' }
      : draft.id ? { title: 'Editar time', sub: 'Mude as vagas e salve. O Cockpit usa a versão salva.' } : { title: 'Novo time', sub: 'Escolha o papel e o agente de cada vaga e dê um nome para salvar.' };
    return (
      <>
        <Head title={head.title} sub={head.sub} back={() => setView(view.from ?? { name: 'list' })} />
        <TeamComposer title={null} draft={draft} onChange={(d) => setView({ ...view, draft: d })} onSave={save} onCancel={() => setView(view.from ?? { name: 'list' })} providers={providers} roles={roles} squads={sq.squads} busy={saving} options={sq.options} saveLabel={mode === 'install' ? 'Instalar time' : null} />
      </>
    );
  }
  if (view.name === 'detail') {
    const { squad, kind } = view, from = { name: 'detail', squad, kind };
    return <Detail squad={squad} kind={kind} {...common} onBack={back}
      onInstall={(s) => setView({ name: 'edit', draft: draftForInstall(s, sq.squads), mode: 'install', from })} onEdit={(s) => setView({ name: 'edit', draft: draftFromSquad(s), mode: 'edit', from })} />;
  }

  const see = (squad, kind) => setView({ name: 'detail', squad, kind });
  return (
    <>
      <Head title="Times prontos" tag="Squads" sub="Times com papéis e agentes prontos para abrir no Cockpit. Instale os opcionais, edite e monte os seus."
        action={<TcBtn icon="plus" onClick={newTeam}>Novo time</TcBtn>} />
      <TeamSection id="install" title="Para instalar" hint="Opcionais, com Claude e Codex juntos. Instalar é grátis e você edita antes.">
        {curatedSquads().map((s, i) => (
          <TeamRow key={s.id} squad={{ ...s, tag: i === 0 ? 'comece aqui' : s.tag }} i={i} {...common} badge={isInstalled(s, sq.squads) ? 'instalado' : null}
            actions={() => <><TcBtn kind="quiet" onClick={() => see(s, 'install')}>Ver por dentro</TcBtn><TcBtn onClick={() => setView({ name: 'edit', draft: draftForInstall(s, sq.squads), mode: 'install' })}>Instalar</TcBtn></>} />
        ))}
      </TeamSection>
      <TeamSection id="mine" title="Seus" hint="Os times que você montou. O app nunca muda nem apaga estes.">
        {sq.squads.map((s, i) => (
          <TeamRow key={s.id} squad={{ ...s, tag: 'meu' }} i={i} {...common} fresh={freshId === s.id} onDelete={remove}
            actions={({ ask }) => <><TcBtn kind="quiet" onClick={() => see(s, 'mine')}>Ver por dentro</TcBtn><TcBtn icon="pencil" onClick={() => edit(draftFromSquad(s), 'edit')}>Editar</TcBtn><TcBtn icon="copy" onClick={() => edit(draftFromCopy(s), 'new')}>Duplicar</TcBtn><TcBtn kind="danger" icon="close" onClick={ask}>Excluir</TcBtn></>} />
        ))}
        {sq.squads.length === 0 && (
          <div className="tc-empty">
            <div className="tc-empty-art" aria-hidden="true">{EMPTY_STATE.map((id, k) => <ProviderMascot key={k} id={id} size={34} hat={k === 0} />)}</div>
            <div className="tc-empty-t">
              <b>{sq.ready ? 'Você ainda não montou um time' : 'Carregando os seus times…'}</b>
              <p className="dim">Quando um trabalho der certo, guarde o jeito como time: da próxima vez, é 1 clique no Cockpit.</p>
              <TcBtn icon="plus" onClick={newTeam}>Novo time</TcBtn>
            </div>
          </div>
        )}
      </TeamSection>
      <Block title="Times básicos do Cockpit" hint="Dupla, Squad, Squad de 6 e Construtor já vêm no Cockpit e usam um agente só." id="basics">
        <div className="set-card"><div className="set-row">
          <div className="set-row-t"><b>Agente dos times básicos</b><span className="dim small">Qual agente os times básicos do Cockpit abrem.</span></div>
          <div className="set-row-c"><select value={provider} onChange={(e) => setPref('provider', e.target.value)} aria-label="Agente dos times básicos" disabled={!available.length}>
            {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{labelOf(p.id)}{p.available ? '' : ' (indisponível)'}</option>)}
          </select></div>
        </div></div>
      </Block>
    </>
  );
}
