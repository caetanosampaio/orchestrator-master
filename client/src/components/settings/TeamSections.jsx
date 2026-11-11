import React, { useState } from 'react';
import { useStore } from '../../store.jsx';
import MaestroControls from '../MaestroControls.jsx';
import WorktreePanel from '../WorktreePanel.jsx';
import { terminalWorktrees } from '../../worktree-view.js';
import { Row, Card, Block } from './SettingsUi.jsx';

// Seções do grupo "Missões e times" que não têm tela própria (as Equipes ficam em TeamsSettings.jsx): a orquestração do Maestro e os worktrees.

export function OrchestrationSection() {
  return <Block title="Maestro Autônomo"><MaestroControls /></Block>;
}

export function WorktreesSection() {
  const { state, terminals } = useStore();
  const [wtScope, setWtScope] = useState('open'); // do workspace aberto ou de todos
  const openWs = state?.activeWorkspace ?? null;
  const total = terminalWorktrees(state?.worktrees?.items).filter((w) => wtScope === 'all' || w.workspaceId === openWs?.id).length;
  return (
    <>
      <p className="dim small">Cada terminal isolado trabalha numa branch Git própria (<span className="mono">orch/…</span>), e um squad inteiro compartilha UM worktree. Encerrar o terminal NÃO apaga o worktree. Aqui você confere o estado, registra um snapshot (commit na branch do worktree) e limpa o que não tem mais trabalho a perder. A integração ao projeto principal exige o gate de evidência das missões, que não existe nos terminais: revise a branch e integre você mesmo com o Git; depois a limpeza fica liberada. O servidor recusa remover worktree com alterações ou commits não integrados.</p>
      <Card>
        <Row title="Novos terminais em worktree" hint="A chave global fica em Preferências gerais. Esta tela administra os worktrees que já existem." />
        <Row title="Mostrar worktrees de" hint={`${total} no total`}>
          <select value={wtScope} onChange={(e) => setWtScope(e.target.value)} aria-label="Escopo dos worktrees">
            <option value="open">Workspace aberto{openWs ? ` (${openWs.displayName || openWs.name})` : ''}</option>
            <option value="all">Todos os workspaces</option>
          </select>
        </Row>
      </Card>
      <WorktreePanel terminals workspaceId={wtScope === 'all' ? null : (openWs?.id ?? '—')} inUse={new Set((terminals?.sessions ?? []).filter((x) => x.status === 'running' && x.worktreeId).map((x) => x.worktreeId))} />
    </>
  );
}
