import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, nav } from '../api.js';
import { useStore } from '../store.jsx';
import { environments, wsTone, wsAlert, paneState, pendingPanes } from '../env-view.js';
import { Icon } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { elapsed, shortPath } from '../forge-shell.js';
import { flowsActivity } from '../flows-view.js';
import { withoutFlowTerminals } from '../flow-terminals.js';
import { logoSvg } from '../forge-logo.mjs';
import GolemSprite from './GolemSprite.jsx';
import { useGolem } from '../use-golem.js';
import '../golem.css';

const BRAND = logoSvg({ variant: 'mark', ink: 'currentColor', stroke: 3 }); // SVG fixo gerado do código (nenhum dado externo entra nele)

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const TONE_LABEL = { idle: 'sem atividade', work: 'executando', wait: 'aguardando você', done: 'concluído', err: 'com falha', cancel: 'cancelada' };
const STATE_LABEL = { working: 'executando', idle: 'ocioso', done: 'concluído', waiting: 'aguardando você', exited: 'encerrado', failed: 'falhou' };
const MAX_TERMS = 5; // terminais listados por workspace; o resto vira "+N"
function describe(e) {
  const parts = [];
  if (e.running) parts.push(plural(e.running, 'terminal ativo', 'terminais ativos') + (e.working ? ` (${e.working} executando)` : ''));
  if (e.waiting) parts.push(plural(e.waiting, 'agente aguardando você', 'agentes aguardando você'));
  if (e.exited) parts.push(plural(e.exited, 'encerrado', 'encerrados'));
  if (e.failed) parts.push(plural(e.failed, 'terminou com falha', 'terminaram com falha'));
  if (e.pendingTasks) parts.push(plural(e.pendingTasks, 'tarefa do maestro aguardando você', 'tarefas do maestro aguardando você'));
  return parts.join(', ') || 'sem terminais';
}

/**
 * Ícone de estado do workspace (ou da missão), agregado dos terminais: o glifo animado do shell (StatusGlyph).
 * `agent` fica na assinatura por compatibilidade (Início e Missões passam o provider que lidera); o glifo não muda de cor por agente.
 */
export function WsIcon({ tone }) { // eslint-disable-line no-unused-vars -- `agent` é aceito e ignorado
  return <span className={`wsi wsi-${tone}`} aria-hidden="true"><StatusGlyph state={tone} size={13} /></span>;
}
const MAX_NAME = 80;

/** Campo de edição do nome amigável: Enter confirma, Esc cancela, sair do campo confirma. Só o rótulo muda (pasta e identidade do workspace ficam como estão). */
function EnvRename({ env, onSave, onCancel }) {
  const [value, setValue] = useState(env.name);
  const done = useRef(false);
  const finish = (save) => { if (done.current) return; done.current = true; if (save) onSave(value); else onCancel(); };
  return (
    <div className="fx-ws-head editing">
      <StatusGlyph state={wsTone(env)} size={13} />
      <input className="fx-ws-input" autoFocus maxLength={MAX_NAME} value={value} aria-label={`Novo nome para o ambiente ${env.original}`} title={`Pasta: ${env.path}\nEnter confirma, Esc cancela. Vazio restaura "${env.original}".`}
        onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} onBlur={() => finish(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } }} />
    </div>
  );
}

/** Um terminal dentro do cartão do workspace: glifo de estado, logo do agente, título, modelo e há quanto tempo roda. Clicar abre o terminal em destaque no Cockpit. */
function TermRow({ s, state, now, onOpen }) {
  const meta = [s.model, elapsed(s.startedAt, now)].filter(Boolean).join(' · ');
  return (
    <li>
      <button type="button" className={`fx-term st-${state}`} onClick={() => onOpen(s)} title={`${s.title}: ${STATE_LABEL[state] ?? state}${s.branch ? `\nBranch ${s.branch}` : ''}`} aria-label={`Terminal ${s.title}, ${STATE_LABEL[state] ?? state}`}>
        <StatusGlyph state={state} size={12} />
        <ProviderLogo id={s.provider || 'claude'} size={12} />
        <span className="fx-term-t">{s.title}</span>
        {meta && <span className="fx-term-m">{meta}</span>}
      </button>
    </li>
  );
}

/** Um workspace = um cartão: estado + nome + contagem, a pasta embaixo e os terminais dele aninhados. O aberto fica destacado (como o projeto ativo do Orca). */
function EnvCard({ env, terms, now, editing, onPick, onEdit, onSave, onCancel, onOpenTerm }) {
  const tone = wsTone(env), alert = wsAlert(tone, env.finished);
  const full = `${env.name}: ${TONE_LABEL[tone]}; ${describe(env)}${env.active ? ' (aberto)' : ''}`;
  const shown = terms.slice(0, MAX_TERMS), more = terms.length - shown.length;
  return (
    <li className={`fx-ws${env.active ? ' on' : ''}${terms.length ? ' has-terms' : ''}`}>
      {editing ? <EnvRename env={env} onSave={onSave} onCancel={onCancel} /> : (
        <div className="fx-ws-row">
          <button type="button" className={`fx-ws-head tone-${tone}`} onClick={() => onPick(env)} aria-current={env.active ? 'true' : undefined} aria-label={full} title={env.renamed ? `${env.path}\nNome original: ${env.original}` : env.path}>
            <StatusGlyph state={tone} size={13} />
            <span className="fx-ws-name">{env.name}</span>
            {env.waiting + env.pendingTasks > 0 && <span className="fx-chip warn" title={describe(env)}>{env.waiting + env.pendingTasks} aguardando</span>}
            {alert && <span className={`fx-new${tone === 'err' ? ' err' : ''}`} title={tone === 'err' ? TONE_LABEL.err : 'A equipe terminou tudo: o aviso some quando você entrar neste workspace'} />}
          </button>
          <button type="button" className="fx-ibtn fx-ws-pen" onClick={() => onEdit(env.id)} aria-label={`Renomear o ambiente ${env.name}`} title="Renomear (só o nome exibido)"><Icon name="pencil" size={12} /></button>
        </div>
      )}
      <div className="fx-ws-sub" title={env.path}>
        <span>{shortPath(env.path)}</span>
      </div>
      {shown.length > 0 && (
        <ul className="fx-terms" aria-label={`Terminais de ${env.name}`}>
          {shown.map((t) => <TermRow key={t.s.id} s={t.s} state={t.state} now={now} onOpen={onOpenTerm} />)}
          {more > 0 && <li><button type="button" className="fx-term more" onClick={() => onPick(env)}>+{more} {more === 1 ? 'terminal' : 'terminais'}</button></li>}
        </ul>
      )}
    </li>
  );
}

/** Item da navegação principal (Início, Missões, Terminais, Sessões). Exportado: a barra da página Missões usa o mesmo desenho. */
export function NavItem({ icon, label, on, onClick, badge = null, title }) {
  return (
    <button type="button" className={`fx-nav-i${on ? ' on' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined} title={title ?? label}>
      <span className="fx-nav-ico">{icon}</span><span className="fx-nav-l">{label}</span>{badge}
    </button>
  );
}
export const HomeIcon = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 11l8-7 8 7M6 10v10h4v-6h4v6h4V10" /></svg>;

/**
 * Barra lateral do FORGE no formato do Orca: a marca e o botão de recolher no topo (área de arrastar a janela no app desktop), a busca (⌘K), a navegação principal
 * (Início, Missões, Terminais, Sessões) e os WORKSPACES em cartões, cada um com os seus terminais aninhados (glifo de estado em tempo real, agente, modelo e tempo).
 * Embaixo, as Configurações e "Arquivos" (abrir, trocar ou adicionar workspace). Em telas estreitas vira uma gaveta modal. Tudo vem de /api/state e /api/terminals.
 */
/** O golem na barra lateral, acima do rodapé: só ele (a forma escolhida), animado conforme o que acontece no Cockpit — martela enquanto há tokens sendo gastos,
 * comemora quando um trabalho termina, respira parado e cochila depois de um tempo sem trabalho. Sem textos. Abre Configurações > Golem. */
function SideGolem({ onOpen }) {
  const g = useGolem();
  if (!g.loaded) return null;
  return (
    <button type="button" className="fx-golem" onClick={onOpen} aria-label={`Abrir o golem (${g.stages[g.shown].label})`}>
      <GolemSprite stage={g.shown} colors={g.alloy.colors} mood={g.mood} scale={3} />
    </button>
  );
}

export default function Sidebar({ modal = false, onClose, onOpenWorkspaces, onOpenSessions = null, onOpenSettings = null, view = 'cockpit', onView = () => {}, onOpenTerminal = null, flows = null, flowsSeenAt = 0, hiddenIds = null, onCollapse = null, desktop = false }) {
  const { workspaces, state, terminals, maestro, workingIds, openWorkspaceIds, act, unseenWs } = useStore();
  const box = useRef(null), searchRef = useRef(null);
  const [editId, setEditId] = useState(null);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const sessions = useMemo(() => withoutFlowTerminals(terminals?.sessions, hiddenIds), [terminals?.sessions, hiddenIds]); // terminais de missões aparecem na página Missões, não aninhados nos workspaces
  const activeId = state?.activeWorkspace?.id ?? null;
  const envs = useMemo(() => environments({ workspaces, sessions, activeId, workingIds, maestroTasks: maestro?.tasks ?? [], finished: unseenWs }), [workspaces, sessions, activeId, workingIds, maestro, unseenWs]);
  const pending = useMemo(() => pendingPanes(maestro?.tasks ?? []), [maestro]);
  const termsOf = useMemo(() => {
    const by = new Map();
    for (const s of sessions) { if (!s.workspaceId) continue; if (!by.has(s.workspaceId)) by.set(s.workspaceId, []); by.get(s.workspaceId).push({ s, state: paneState(s, workingIds, pending) }); }
    for (const list of by.values()) list.sort((a, b) => (a.s.status === 'running' ? 0 : 1) - (b.s.status === 'running' ? 0 : 1)); // vivos primeiro
    return by;
  }, [sessions, workingIds, pending]);
  const q = query.trim().toLowerCase();
  const shown = q ? envs.filter((e) => e.name.toLowerCase().includes(q) || String(e.path).toLowerCase().includes(q) || (termsOf.get(e.id) ?? []).some((t) => String(t.s.title).toLowerCase().includes(q))) : envs;
  const working = sessions.filter((s) => s.status === 'running' && paneState(s, workingIds, pending) === 'working').length;
  const fa = useMemo(() => flowsActivity(flows, { seenAt: view === 'missions' ? Infinity : flowsSeenAt }), [flows, flowsSeenAt, view]); // estado das Missões em tempo real, em qualquer página

  // ⌘K / Ctrl+K: foca a busca (de qualquer lugar fora de um campo de texto)
  useEffect(() => {
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k' && !e.target?.closest?.('.xterm')) { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!modal) return undefined;
    box.current?.querySelector('button')?.focus();
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = [...box.current.querySelectorAll('a[href], button:not(:disabled), input')];
      if (!items.length) return;
      const a = items[0], z = items.at(-1);
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [modal, onClose]);

  const save = async (env, text) => {
    setEditId(null);
    const next = String(text).replace(/\s+/g, ' ').trim();
    if (next === env.name || (!env.renamed && next === env.original)) return; // nada mudou
    await act(() => api.post(`/api/workspaces/${env.id}/rename`, { displayName: next }));
  };
  const pick = async (env) => {
    if (!env.active) await act(async () => { if (!openWorkspaceIds.includes(env.id)) await nav.openWorkspace(env.id); return nav.activateWorkspace(env.id); });
    onView('cockpit');
    if (modal) onClose();
  };
  const openTerm = async (s) => {
    const env = envs.find((e) => e.id === s.workspaceId);
    if (env && !env.active) await act(async () => { if (!openWorkspaceIds.includes(env.id)) await nav.openWorkspace(env.id); return nav.activateWorkspace(env.id); });
    onView('cockpit'); onOpenTerminal?.(s);
    if (modal) onClose();
  };

  return (
    <aside id="nav-drawer" ref={box} className={`fx-side${modal ? ' modal' : ''}`} {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navegação e workspaces' } : { 'aria-label': 'Navegação e workspaces' })}>
      <div className={`fx-side-top${desktop ? ' desktop' : ''}`}>
        <span className="fx-brand"><span className="fx-brand-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND }} />Forge</span>
        <span className="grow" />
        {modal
          ? <button type="button" className="fx-ibtn" onClick={onClose} aria-label="Fechar a navegação"><Icon name="close" size={15} /></button>
          : onCollapse && <button type="button" className="fx-ibtn" onClick={onCollapse} aria-label="Recolher a barra lateral" title="Recolher a barra lateral"><Icon name="panel" size={15} /></button>}
      </div>

      <label className="fx-search">
        <Icon name="search" size={14} /><span className="sr">Buscar workspaces e terminais</span>
        <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }} placeholder="Buscar" autoComplete="off" spellCheck="false" />
        {!query && <kbd aria-hidden="true">⌘K</kbd>}
      </label>

      <nav className="fx-nav" aria-label="Páginas do FORGE">
        <NavItem icon={<HomeIcon />} label="Início" on={view === 'home'} onClick={() => { onView('home'); if (modal) onClose(); }} title="Início: atividade de tokens e workspaces recentes" />
        <NavItem icon={<Icon name="briefcase" size={15} />} label="Missões" on={view === 'missions'} onClick={() => { onView('missions'); if (modal) onClose(); }}
          title={fa.title || 'Missões'} badge={fa.state ? <span className={`fx-nav-run is-${fa.state}`} role="status" aria-label={fa.title}><StatusGlyph state={fa.state} size={12} />{fa.count > 1 && <b>{fa.count}</b>}</span> : null} />
        <NavItem icon={<Icon name="terminal" size={15} />} label="Terminais" on={view === 'cockpit'} onClick={() => { onView('cockpit'); if (modal) onClose(); }} title={working ? `${working} terminal(is) trabalhando` : 'Terminais do workspace aberto'}
          badge={working > 0 ? <span className="fx-nav-run" role="status" aria-label={`${working} ${working === 1 ? 'terminal trabalhando' : 'terminais trabalhando'}`}><StatusGlyph state="working" size={12} /><b>{working}</b></span> : null} />
        <NavItem icon={<Icon name="clock" size={15} />} label="Sessões" onClick={() => { onOpenSessions?.(); }} title="Histórico de sessões do workspace aberto, para retomar" />
      </nav>

      <div className="fx-sec-h">
        <span>Workspaces</span>{envs.length > 0 && <span className="fx-n">{envs.length}</span>}
        <span className="grow" />
        <button type="button" className="fx-ibtn sm" onClick={onOpenWorkspaces} aria-label="Abrir ou adicionar workspace" title="Abrir ou adicionar workspace"><Icon name="plus" size={14} /></button>
      </div>

      <nav className="fx-wslist" aria-label="Workspaces">
        {envs.length === 0
          ? <div className="fx-empty-side"><p>Nenhum workspace ainda.</p><button type="button" className="fx-link" onClick={onOpenWorkspaces}>Adicionar um workspace</button></div>
          : shown.length === 0 ? <p className="fx-empty-side">Nada encontrado para “{query}”.</p>
          : <ul>{shown.map((e) => <EnvCard key={e.id} env={e} terms={termsOf.get(e.id) ?? []} now={now} editing={editId === e.id} onPick={pick} onEdit={setEditId} onSave={(t) => save(e, t)} onCancel={() => setEditId(null)} onOpenTerm={openTerm} />)}</ul>}
      </nav>

      <SideGolem onOpen={() => onOpenSettings?.('golem')} />
      <div className="fx-side-foot">
        <button type="button" className={`fx-ibtn${view === 'settings' ? ' on' : ''}`} onClick={() => onOpenSettings?.()} aria-label="Configurações" title="Configurações"><Icon name="gear" size={15} /></button>
        <button type="button" className="fx-ibtn" onClick={onOpenWorkspaces} aria-label="Arquivos: abrir, trocar ou adicionar workspace" title="Arquivos: abrir, trocar ou adicionar workspace"><Icon name="folderOpen" size={15} /></button>
        <span className="grow" />
        <button type="button" className="fx-ibtn" onClick={() => onOpenSessions?.()} aria-label="Sessões: histórico de sessões do workspace aberto" title="Sessões: histórico, para retomar"><Icon name="clock" size={15} /></button>
      </div>
    </aside>
  );
}
