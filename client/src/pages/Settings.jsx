import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { usePrefs, useLayoutMode, useLayouts, useAutoRestore } from '../hooks.js';
import { LAYOUT_MODES, providerSummary } from '../env-view.js';
import { SessionHistoryBody } from '../components/SessionHistory.jsx';
import { FONT_RANGE } from '../prefs.js';
import { Btn, Icon } from '../components/ui.jsx';
import MaestroControls from '../components/MaestroControls.jsx';
import AccountsPanel from '../components/AccountsPanel.jsx';
import ProviderLogo from '../components/ProviderLogo.jsx';
import { providerStatus, withClaudeLogin } from '../provider-view.js';
import WorktreePanel from '../components/WorktreePanel.jsx';
import TeamsSettings from '../components/TeamsSettings.jsx';
import { terminalWorktrees } from '../worktree-view.js';

const SECTIONS = [
  ['perfil', 'Perfil e conta', 'user'],
  ['accounts', 'Contas', 'user'],
  ['geral', 'Preferências gerais', 'sliders'],
  ['visualizacao', 'Visualização', 'panel'],
  ['equipes', 'Equipes', 'layers'],
  ['arquivos', 'Arquivos', 'folderOpen'],
  ['historico', 'Histórico de sessões', 'clock'],
  ['aparencia', 'Aparência', 'sun'],
  ['cli', 'Claude Code CLI', 'terminal'],
  ['providers', 'Providers', 'layers'],
  ['orquestracao', 'Orquestração', 'sliders'],
  ['worktrees', 'Workspaces e Worktrees', 'workspace'],
];

const Row = ({ title, hint, children }) => <div className="oc-row"><div className="oc-row-t"><b>{title}</b>{hint && <span className="dim small">{hint}</span>}</div><div className="oc-row-c">{children}</div></div>;
const Switch = ({ checked, onChange, label }) => (
  <label className="oc-switch"><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="oc-switch-track" aria-hidden="true"><i /></span><span className="sr">{label}</span></label>
);

/**
 * Configurações: uma PÁGINA inteira (como Cockpit e Missions), com a lista de seções à esquerda e bastante espaço para o conteúdo. Só opções que existem de verdade: preferências locais da interface
 * e o estado real dos agentes. `onClose` volta para a página de onde veio.
 */
export default function Settings({ onClose, initial = 'perfil', onOpenWorkspaces = null }) {
  const { state, terminals, refresh, workspaces, workingIds } = useStore();
  const [wtScope, setWtScope] = useState('open'); // worktrees: do workspace aberto ou de todos
  const openWs = state?.activeWorkspace ?? null;
  const [mode, setMode] = useLayoutMode(openWs?.id);
  const [layouts] = useLayouts();
  const [autoRestore, setAutoRestore] = useAutoRestore();
  const wsName = openWs ? (openWs.displayName || openWs.name) : '';
  const [prefs, setPref] = usePrefs();
  const [tab, setTab] = useState(initial);
  const [checking, setChecking] = useState(false);
  // Selo do provider: ativo (terminais em uso) > conectado (login feito) > instalado; vem dos terminais reais e do login que o servidor informa, e muda sozinho a cada atualização.
  const provRows = Array.isArray(terminals?.providers) ? providerSummary(terminals.sessions ?? [], workingIds, withClaudeLogin(terminals.providers, state?.prereqs?.login)) : null;
  const pill = (id) => { if (!provRows) return null; const s = providerStatus(provRows.find((r) => r.id === id)); return <span className={`oc-pill${s.kind === 'ok' ? ' ok' : s.kind === 'bad' ? ' bad' : ''}`}>{s.text}</span>; };
  const ex = state?.executor;
  const recheck = async () => { setChecking(true); try { await refresh(); } finally { setChecking(false); } };
  const onKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const i = SECTIONS.findIndex(([id]) => id === tab), n = SECTIONS[(i + (e.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length][0];
    e.preventDefault(); setTab(n); document.getElementById(`set-tab-${n}`)?.focus();
  };

  return (
    <div className="oc-view set-page" data-testid="settings-page">
      <header className="set-page-head">
        <button type="button" className="set-back" onClick={onClose} data-autofocus=""><Icon name="chevronRight" size={14} /><span>Voltar</span></button>
        <h1 id="set-t">Configurações</h1>
      </header>
      <div className="oc-set set-page-body">
        <div className="oc-set-nav" role="tablist" aria-orientation="vertical" aria-label="Seções" onKeyDown={onKey}>
          {SECTIONS.map(([id, label, icon]) => (
            <button key={id} id={`set-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="set-panel" tabIndex={tab === id ? 0 : -1} className="oc-set-tab" onClick={() => setTab(id)}>
              <Icon name={icon} size={16} /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="oc-set-panel" id="set-panel" role="tabpanel" aria-labelledby={`set-tab-${tab}`} key={tab}>
          {tab === 'perfil' && <>
            <Row title="Nome exibido" hint="Aparece no rodapé da barra lateral.">
              <input value={prefs.name} onChange={(e) => setPref('name', e.target.value)} maxLength={40} placeholder="Seu nome" data-autofocus="" aria-label="Nome exibido" />
            </Row>
            <Row title="Conta" hint="O nome fica salvo apenas neste computador (127.0.0.1). Para conectar contas do Claude Code, use a aba Contas." />
          </>}

          {tab === 'accounts' && <AccountsPanel />}

          {tab === 'geral' && <>
            <Row title="Isolar novos terminais em worktree" hint="Cada terminal trabalha numa branch Git própria, sem pisar nos arquivos dos outros. Exige repositório Git.">
              <Switch checked={prefs.isolate} onChange={(v) => setPref('isolate', v)} label="Isolar novos terminais em worktree" />
            </Row>
          </>}

          {tab === 'visualizacao' && <>
            {!openWs ? <p className="dim small oc-lead">Abra um workspace para escolher como os terminais dele são organizados na tela.</p> : <>
              <p className="dim small oc-lead">Vale para o workspace aberto ({wsName}); cada workspace guarda a sua escolha neste navegador. Com um só terminal, todos os modos ocupam a tela inteira.</p>
              <Row title="Organização dos terminais" hint="Grade se adapta ao número de terminais; Colunas põe todos lado a lado; Linhas empilha; Foco dá um terminal grande e os outros numa tira.">
                <div className="oc-seg" role="radiogroup" aria-label="Organização dos terminais">
                  {LAYOUT_MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} title={{ auto: 'Grade automática', cols: 'Todos lado a lado', rows: 'Todos empilhados', focus: 'Um terminal grande e os outros numa tira' }[m.id]}>{m.label}</button>)}
                </div>
              </Row>
            </>}
          </>}

          {tab === 'equipes' && <TeamsSettings />}

          {tab === 'arquivos' && <>
            <p className="dim small oc-lead">Os arquivos do FORGE são as pastas de projeto (workspaces). Os terminais dos agentes abrem na pasta do workspace aberto{openWs ? ` (${wsName})` : ''}.</p>
            <Row title="Workspaces" hint="Abrir, trocar ou adicionar uma pasta de projeto.">
              <Btn onClick={() => onOpenWorkspaces?.()} disabled={!onOpenWorkspaces}><Icon name="folderOpen" size={14} /> Abrir ou adicionar workspace</Btn>
            </Row>
          </>}

          {tab === 'historico' && (openWs
            ? <SessionHistoryBody ws={openWs} topicId={null} where={wsName} order={layouts[openWs.id]?.order ?? []} autoRestore={autoRestore} onAutoRestore={setAutoRestore} />
            : <p className="dim small oc-lead">Abra um workspace para ver o histórico de sessões dele.</p>)}

          {tab === 'aparencia' && <>
            <Row title="Tema" hint="Escuro (grafite e preto). Ainda não há outro tema." />
            <Row title="Animações" hint="Automático segue a preferência do sistema por menos movimento, exceto os ícones de estado dos workspaces, que sempre animam; Reduzidas desliga todas as animações da interface, inclusive esses ícones.">
              <div className="oc-seg" role="radiogroup" aria-label="Animações">
                {[['auto', 'Automático'], ['reduced', 'Reduzidas']].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={prefs.motion === v} className={prefs.motion === v ? 'on' : ''} onClick={() => setPref('motion', v)}>{l}</button>
                ))}
              </div>
            </Row>
            <Row title="Fonte dos terminais" hint={`${prefs.fontSize}px (de ${FONT_RANGE.min} a ${FONT_RANGE.max}). Vale na hora para todos os terminais.`}>
              <input type="range" min={FONT_RANGE.min} max={FONT_RANGE.max} step="1" value={prefs.fontSize} onChange={(e) => setPref('fontSize', Number(e.target.value))} aria-label="Tamanho da fonte dos terminais" className="oc-range" />
            </Row>
          </>}

          {tab === 'cli' && <>
            <Row title="Estado" hint="Os terminais executam o comando claude encontrado no PATH, com o seu login e as suas permissões.">
              {!state ? <span className="dim">verificando…</span> : ex?.available
                ? <span className="oc-state ok"><i aria-hidden="true" />Detectado{ex.version ? ` · ${ex.version}` : ''}</span>
                : <span className="oc-state bad"><i aria-hidden="true" />Não encontrado no PATH</span>}
            </Row>
            {state && !ex?.available && <p className="oc-note err" role="status">Instale o Claude Code, entre com o seu login rodando <span className="mono">claude</span> uma vez num terminal e verifique de novo.</p>}
            <Row title="Verificar de novo" hint="A detecção é guardada por alguns segundos.">
              <Btn onClick={recheck} disabled={checking}>{checking ? 'Verificando…' : 'Verificar'}</Btn>
            </Row>
            <Row title="Permissões" hint="O terminal interativo pede permissões no próprio terminal. Quando o projeto tem configuração do Claude Code que executa comandos e não está revisada no Git, o FORGE pede a sua confirmação antes de abrir." />
          </>}

          {tab === 'providers' && <>
            <p className="dim small oc-lead">O provider é o CLI de agente que roda dentro de cada terminal. O agente de cada vaga é escolhido em Equipes; Claude Code e Codex trocam tarefas pelo mesmo Maestro.</p>
            <ul className="oc-prov">
              <li className="on"><span className="oc-prov-i logo"><ProviderLogo id="claude" size={24} /></span><span className="oc-prov-t"><b className="oc-prov-name">Claude Code</b><span className="dim small">Agente padrão dos terminais.</span></span>{pill('claude')}</li>
              <li className="on"><span className="oc-prov-i logo"><ProviderLogo id="codex" size={24} /></span><span className="oc-prov-t"><b className="oc-prov-name">Codex CLI</b><span className="dim small">Terminais do Codex ao lado do Claude Code, no mesmo Maestro. Instale com <span className="mono">npm i -g @openai/codex</span> e entre com <span className="mono">codex login</span> no terminal. Contas separadas e retomada de sessão ainda não existem para o Codex.</span></span>{pill('codex')}</li>
            </ul>
          </>}

          {tab === 'orquestracao' && <>
            <h3 className="oc-h">Maestro Autônomo</h3>
            <MaestroControls />
          </>}

          {tab === 'worktrees' && <>
            <p className="dim small oc-lead">Cada terminal isolado trabalha numa branch Git própria (<span className="mono">orch/…</span>), e um squad inteiro compartilha UM worktree. Encerrar o terminal NÃO apaga o worktree. Aqui você confere o estado, registra um snapshot (commit na branch do worktree) e limpa o que não tem mais trabalho a perder. A integração ao projeto principal exige o gate de evidência das missões, que não existe nos terminais: revise a branch e integre você mesmo com o Git; depois a limpeza fica liberada. O servidor recusa remover worktree com alterações ou commits não integrados.</p>
            <Row title="Novos terminais em worktree" hint="A chave global fica em Preferências gerais. Esta tela administra os worktrees que já existem." />
            <Row title="Mostrar worktrees de" hint={`${terminalWorktrees(state?.worktrees?.items).filter((w) => wtScope === 'all' || w.workspaceId === openWs?.id).length} no total`}>
              <select value={wtScope} onChange={(e) => setWtScope(e.target.value)} aria-label="Escopo dos worktrees">
                <option value="open">Workspace aberto{openWs ? ` (${openWs.displayName || openWs.name})` : ''}</option>
                <option value="all">Todos os workspaces</option>
              </select>
            </Row>
            <WorktreePanel terminals workspaceId={wtScope === 'all' ? null : (openWs?.id ?? '—')} inUse={new Set((terminals?.sessions ?? []).filter((x) => x.status === 'running' && x.worktreeId).map((x) => x.worktreeId))} />
          </>}
        </div>
      </div>
    </div>
  );
}
