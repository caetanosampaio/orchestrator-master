import React, { useMemo, useState } from 'react';
import { usePrefs } from '../hooks.js';
import { Icon } from '../components/ui.jsx';
import { filterNav, itemById, resolveTab } from '../settings-nav.js';
import TeamsSettings from '../components/TeamsSettings.jsx';
import AccountsPanel from '../components/AccountsPanel.jsx';
import { AisSection } from '../components/settings/AisSection.jsx';
import { MascotsSection } from '../components/settings/MascotsSection.jsx';
import { ProfileSection, GeneralSection, LayoutSection, AppearanceSection, FilesSection, HistorySection } from '../components/settings/AppSections.jsx';
import { OrchestrationSection, WorktreesSection } from '../components/settings/TeamSections.jsx';
import HarnessSection from '../components/harness/HarnessSection.jsx';

/**
 * Configurações: uma PÁGINA inteira (como Cockpit e Missions). À esquerda a barra lateral: voltar, busca, cartão de perfil e as seções em grupos (IAs e contas, Missões e times, App e computador); à direita o título
 * da seção, uma frase de apoio e o conteúdo, com bastante espaço. Cada seção é um componente em components/settings/ (a lista e a busca ficam em settings-nav.js). Só opções que existem de verdade:
 * preferências locais da interface e o estado real dos agentes. `onClose` volta para a página de onde veio.
 */
export default function Settings({ onClose, initial = 'perfil', onOpenWorkspaces = null }) {
  const [tab, setTab] = useState(() => resolveTab(initial));
  const [query, setQuery] = useState('');
  const [prefs] = usePrefs();
  const groups = useMemo(() => filterNav(query), [query]);
  const cur = itemById(tab) ?? itemById('perfil');
  const name = (prefs.name || '').trim();
  const flat = groups.flatMap((g) => g.items);
  const onKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || !flat.length) return;
    const i = flat.findIndex((x) => x.id === tab), n = flat[(i + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length].id;
    e.preventDefault(); setTab(n); document.getElementById(`set-tab-${n}`)?.focus();
  };
  const body = {
    ias: <AisSection go={setTab} />, accounts: <AccountsPanel />, mascotes: <MascotsSection />,
    equipes: <TeamsSettings />, tarefas: <HarnessSection />, orquestracao: <OrchestrationSection />, worktrees: <WorktreesSection />, historico: <HistorySection />,
    perfil: <ProfileSection />, geral: <GeneralSection />, visualizacao: <LayoutSection />, aparencia: <AppearanceSection />, arquivos: <FilesSection onOpenWorkspaces={onOpenWorkspaces} />,
  }[cur.id];

  return (
    <div className="oc-view set-page" data-testid="settings-page">
      <aside className="set-side" aria-label="Configurações">
        <button type="button" className="set-back" onClick={onClose} data-autofocus=""><Icon name="chevronRight" size={13} /><span>Voltar</span></button>
        <label className="set-search">
          <Icon name="search" size={14} /><span className="sr">Buscar nas Configurações</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nas Configurações" autoComplete="off" />
        </label>
        <button type="button" className="set-me" onClick={() => setTab('perfil')} aria-label="Abrir o perfil">
          <span className="set-me-av" aria-hidden="true">{(name[0] || 'F').toUpperCase()}</span>
          <span className="set-me-t"><b>{name || 'Seu nome'}</b><span className="dim small">Perfil neste computador</span></span>
        </button>
        <nav className="set-nav" role="tablist" aria-orientation="vertical" aria-label="Seções" onKeyDown={onKey}>
          {groups.map((g) => (
            <div key={g.id} className="set-group" role="presentation">
              <span className="set-group-t" role="presentation">{g.label}</span>
              {g.items.map((it) => (
                <button key={it.id} id={`set-tab-${it.id}`} type="button" role="tab" aria-selected={tab === it.id} aria-controls="set-panel" tabIndex={tab === it.id ? 0 : -1} className="set-tab" onClick={() => setTab(it.id)}>
                  <Icon name={it.icon} size={15} /><span>{it.label}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <p className="dim small set-none" role="status">Nada encontrado para “{query}”.</p>}
        </nav>
      </aside>
      <main className="set-main">
        <div className="set-body" id="set-panel" role="tabpanel" aria-labelledby={`set-tab-${cur.id}`} key={cur.id}>
          {!cur.own && <><h1 className="set-title">{cur.title}</h1><p className="set-sub">{cur.hint}</p></>}
          {body}
        </div>
      </main>
    </div>
  );
}
