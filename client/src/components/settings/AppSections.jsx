import React from 'react';
import { useStore } from '../../store.jsx';
import { usePrefs, useLayoutMode, useLayouts, useAutoRestore } from '../../hooks.js';
import { LAYOUT_MODES } from '../../env-view.js';
import { FONT_RANGE } from '../../prefs.js';
import { SessionHistoryBody } from '../SessionHistory.jsx';
import { Btn, Icon } from '../ui.jsx';
import { Row, Switch, Card, Segmented } from './SettingsUi.jsx';

// Seções do grupo "App e computador" e o histórico: preferências locais da interface. Só opções que existem de verdade.

export function ProfileSection() {
  const [prefs, setPref] = usePrefs();
  return (
    <Card>
      <Row title="Nome exibido" hint="Aparece no rodapé da barra lateral e no cartão de perfil.">
        <input value={prefs.name} onChange={(e) => setPref('name', e.target.value)} maxLength={40} placeholder="Seu nome" data-autofocus="" aria-label="Nome exibido" />
      </Row>
      <Row title="Conta" hint="O nome fica salvo apenas neste computador (127.0.0.1). Para conectar contas do Claude Code, use Contas em IAs e contas." />
    </Card>
  );
}

export function GeneralSection() {
  const [prefs, setPref] = usePrefs();
  return (
    <Card>
      <Row title="Isolar novos terminais em worktree" hint="Cada terminal trabalha numa branch Git própria, sem pisar nos arquivos dos outros. Exige repositório Git.">
        <Switch checked={prefs.isolate} onChange={(v) => setPref('isolate', v)} label="Isolar novos terminais em worktree" />
      </Row>
    </Card>
  );
}

export function LayoutSection() {
  const { state } = useStore();
  const openWs = state?.activeWorkspace ?? null, wsName = openWs ? (openWs.displayName || openWs.name) : '';
  const [mode, setMode] = useLayoutMode(openWs?.id);
  if (!openWs) return <p className="dim small">Abra um workspace para escolher como os terminais dele são organizados na tela.</p>;
  return (
    <>
      <p className="dim small">Vale para o workspace aberto ({wsName}); cada workspace guarda a sua escolha neste navegador. Com um só terminal, todos os modos ocupam a tela inteira.</p>
      <Card>
        <Row title="Organização dos terminais" hint="Grade se adapta ao número de terminais; Colunas põe todos lado a lado; Linhas empilha; Foco dá um terminal grande e os outros numa tira.">
          <div className="oc-seg" role="radiogroup" aria-label="Organização dos terminais">
            {LAYOUT_MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} title={{ auto: 'Grade automática', cols: 'Todos lado a lado', rows: 'Todos empilhados', focus: 'Um terminal grande e os outros numa tira' }[m.id]}>{m.label}</button>)}
          </div>
        </Row>
      </Card>
    </>
  );
}

export function AppearanceSection() {
  const [prefs, setPref] = usePrefs();
  return (
    <Card>
      <Row title="Tema" hint="Escuro (grafite e preto). Ainda não há outro tema." />
      <Row title="Animações" hint="Automático segue a preferência do sistema por menos movimento, exceto os ícones de estado dos workspaces, que sempre animam; Reduzidas desliga todas as animações da interface, inclusive esses ícones.">
        <Segmented label="Animações" value={prefs.motion} onChange={(v) => setPref('motion', v)} options={[['auto', 'Automático'], ['reduced', 'Reduzidas']]} />
      </Row>
      <Row title="Fonte dos terminais" hint={`${prefs.fontSize}px (de ${FONT_RANGE.min} a ${FONT_RANGE.max}). Vale na hora para todos os terminais.`}>
        <input type="range" min={FONT_RANGE.min} max={FONT_RANGE.max} step="1" value={prefs.fontSize} onChange={(e) => setPref('fontSize', Number(e.target.value))} aria-label="Tamanho da fonte dos terminais" className="oc-range" />
      </Row>
    </Card>
  );
}

export function FilesSection({ onOpenWorkspaces }) {
  const { state } = useStore();
  const openWs = state?.activeWorkspace ?? null, wsName = openWs ? (openWs.displayName || openWs.name) : '';
  return (
    <>
      <p className="dim small">Os arquivos do FORGE são as pastas de projeto (workspaces). Os terminais dos agentes abrem na pasta do workspace aberto{openWs ? ` (${wsName})` : ''}.</p>
      <Card>
        <Row title="Workspaces" hint="Abrir, trocar ou adicionar uma pasta de projeto.">
          <Btn onClick={() => onOpenWorkspaces?.()} disabled={!onOpenWorkspaces}><Icon name="folderOpen" size={14} /> Abrir ou adicionar workspace</Btn>
        </Row>
      </Card>
    </>
  );
}

export function HistorySection() {
  const { state } = useStore();
  const [layouts] = useLayouts(), [autoRestore, setAutoRestore] = useAutoRestore();
  const openWs = state?.activeWorkspace ?? null, wsName = openWs ? (openWs.displayName || openWs.name) : '';
  return openWs
    ? <SessionHistoryBody ws={openWs} topicId={null} where={wsName} order={layouts[openWs.id]?.order ?? []} autoRestore={autoRestore} onAutoRestore={setAutoRestore} />
    : <p className="dim small">Abra um workspace para ver o histórico de sessões dele.</p>;
}
