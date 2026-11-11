import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { useSquads } from '../use-squads.js';
import { useSkillCatalog } from '../use-skills.js';
import { availableMixes } from '../team-view.js';
import { readyTeams, draftFromPreset, draftFromSquad, draftFromCopy, draftForInstall, isInstalled, templateBody, describeSquad, slotChoiceLabels, slotSkills, takesSkills, squadMissing } from '../squads.js';
import TeamComposer from './TeamComposer.jsx';
import { TeamRow, TeamSection, TcBtn, labelFor } from './TeamCards.jsx';
import { ProviderMascot } from './ProviderLogo.jsx';
import { Icon } from './ui.jsx';
import { Block, Head as PageHead } from './settings/SettingsUi.jsx';

const QUICK = { 'all-claude': 'Todos Claude Code', 'all-codex': 'Todos Codex', 'claude-leads': 'Misto' };
const EMPTY_STATE = ['claude', 'codex', 'claude']; // os três mascotes da ilustração de "Seus" vazio

/** "Ver por dentro": quem faz o quê, com o provider, o modelo e o esforço de cada vaga, e as ações do time. Uma página dentro das Configurações (a barra lateral continua). */
function Detail({ squad, kind, byRole, labelOf, options, available, known, catalog, onBack, onEdit, onInstall }) {
  const { tagline, about } = describeSquad(squad), missing = known ? squadMissing(squad, available) : [];
  const descOf = (id) => (Array.isArray(catalog) ? catalog.find((x) => x.id === id)?.description : null) ?? undefined;
  return (
    <>
      <PageHead title={squad.name} tag={squad.tag ?? (kind === 'mine' ? 'meu' : 'FORGE')} sub={tagline} back={onBack} backLabel="Times prontos" />
      {about && <p className="tc-about">{about}</p>}
      {missing.length > 0 && <p className="oc-note err" role="status">Este time usa {missing.map(labelOf).join(' e ')}, que não está instalado. Ao instalar você pode trocar o agente de cada vaga.</p>}
      {squad.instruction && <Block title="Instrução do time" hint="Vai para todos os terminais do time." id="td-instr"><p className="tc-instr">{squad.instruction}</p></Block>}
      <Block title="Quem faz cada coisa" hint={`${squad.slots.length} ${squad.slots.length === 1 ? 'vaga' : 'vagas'}`} id="td">
        <ul className="td-grid">
          {squad.slots.map((s, k) => {
            const role = byRole[s.role], ch = slotChoiceLabels(s, options), sk = slotSkills(s);
            return (
              <li key={k} className="td-card" style={{ '--role': role?.color || 'var(--brand)' }}>
                <ProviderMascot id={s.provider} size={46} hat={s.role === 'maestro'} />
                <span className="td-role"><i aria-hidden="true" />{role?.label ?? s.role}</span>
                <b className="td-prov">{labelOf(s.provider)}</b>
                <span className={`tc-chip${ch.modelSet ? ' set' : ''}`}>{ch.model}</span>
                <span className={`tc-chip${ch.effortSet ? ' set' : ''}`}>{ch.effort}</span>
                {sk.length > 0
                  ? <ul className="td-skills" aria-label={`Skills da vaga ${k + 1}`}>{sk.map((id) => <li key={id} className="tc-chip set" title={descOf(id)}>{id}</li>)}</ul>
                  : <span className="td-noskill">{takesSkills(s.provider) ? 'só as skills do papel' : `sem skills (${labelOf(s.provider)})`}</span>}
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
  const sq = useSquads(), cat = useSkillCatalog();
  const [view, setView] = useState({ name: 'list' }), [saving, setSaving] = useState(false), [freshId, setFreshId] = useState(null);
  const providers = terminals?.providers ?? [], roles = terminals?.roles ?? [], byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
  const available = providers.filter((p) => p.available).map((p) => p.id), known = providers.length > 0, labelOf = labelFor(providers);
  const quick = availableMixes(available).filter((m) => QUICK[m.id]);
  const common = { byRole, labelOf, options: sq.options, available, known, catalog: cat.skills };
  const ready = readyTeams(sq.presets); // times prontos do servidor (só leitura); servidor antigo = nenhum
  const back = () => setView({ name: 'list' });

  const save = async () => {
    const { draft, mode } = view; if (!draft || saving) return; setSaving(true);
    try {
      // instrução e skills de cada vaga vão juntas; skill que saiu do catálogo fica de fora; apagar a instrução de um time salvo manda `instruction: null`
      const body = templateBody(draft, { previous: draft.id ? sq.squads.find((s) => s.id === draft.id) : null, catalogIds: cat.skills ? cat.skills.map((s) => s.id) : null });
      const t = draft.id ? await sq.update(draft.id, body) : await sq.create(body);
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
    const head = mode === 'install' ? { title: 'Instalar time', sub: 'Mude o que quiser antes de instalar: o nome, a instrução, e o agente, o modelo, o esforço e as skills de cada vaga. O time só passa a ser seu quando você salvar.' }
      : draft.id ? { title: 'Editar time', sub: 'Mude as vagas e salve. O Cockpit usa a versão salva.' } : { title: 'Novo time', sub: 'Escolha o papel, o agente e as skills de cada vaga e dê um nome para salvar.' };
    return (
      <>
        <PageHead title={head.title} sub={head.sub} back={() => setView(view.from ?? { name: 'list' })} backLabel="Times prontos" />
        {cat.error && <p className="oc-note err" role="status">{cat.error === 'missing' ? 'Este servidor ainda não oferece as skills: as vagas ficam só com as skills do papel.' : `Não foi possível ler as skills: ${cat.error}`}</p>}
        <TeamComposer title={null} draft={draft} onChange={(d) => setView({ ...view, draft: d })} onSave={save} onCancel={() => setView(view.from ?? { name: 'list' })} providers={providers} roles={roles} squads={sq.squads} busy={saving} options={sq.options} catalog={cat.skills} saveLabel={mode === 'install' ? 'Instalar time' : null} />
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
      <PageHead title="Times prontos" tag="Squads" sub="Os times que aparecem no Cockpit vêm daqui: instale os prontos, edite e monte os seus. Em cada workspace você escolhe qual abrir."
        action={<TcBtn icon="plus" onClick={newTeam}>Novo time</TcBtn>} />
      <TeamSection id="install" title="Para instalar" hint="Opcionais, prontos para cada tipo de trabalho, com as skills de cada vaga. Instalar é grátis e você edita antes.">
        {ready.map((s, i) => (
          <TeamRow key={s.id} squad={{ ...s, tag: i === 0 ? 'comece aqui' : s.tag }} i={i} {...common} badge={isInstalled(s, sq.squads) ? 'instalado' : null}
            actions={() => <><TcBtn kind="quiet" onClick={() => see(s, 'install')}>Ver por dentro</TcBtn><TcBtn onClick={() => setView({ name: 'edit', draft: draftForInstall(s, sq.squads), mode: 'install' })}>Instalar</TcBtn></>} />
        ))}
        {ready.length === 0 && <p className="dim small" role="status">{sq.ready ? 'Este servidor ainda não traz times prontos. Atualize o FORGE ou monte o seu em Novo time.' : 'Carregando os times prontos…'}</p>}
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
    </>
  );
}
