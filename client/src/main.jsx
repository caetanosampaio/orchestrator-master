import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import App from './App.jsx';
import { StoreProvider } from './store.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { getUi } from './ui-state.js';
import { getLayouts } from './layout-state.js';
import './tokens.css';
import './styles.css';
import './shell.css';
import './cockpit.css';
import './pages.css';
import './theme.css'; // por último: aparência (console de agentes); não muda estrutura nem comportamento
import './oc.css'; // interface centrada nos terminais (sidebar de ambientes, Cockpit, diálogos): carregado depois de tudo
import './retro.css'; // identidade retro-terminal (cantos retos, status em pixels, scanline discreta): a última camada
import './overclock.css'; // linguagem do Overclock por cima de tudo: preto total, sem brilho, pontos redondos, chips contornados, navegação em texto
import './missions.css'; // página Missões (central de missões)
import './missions-workflow.css'; // workflow animado da página Missões
import './teams.css'; // página de Configurações e Configurações > Equipes (linhas de equipe, bonequinhos dos providers)
import './settings.css'; // página de Configurações (barra lateral agrupada, seções, Suas IAs, Mascotes)
import './harness.css'; // Configurações > Quem faz cada tarefa e o mascote do FORGE
import './skills.css'; // Configurações > Skills
import './home.css'; // página Início (atividade de tokens, workspaces recentes)
import './cockpit-ui.css'; // Cockpit na estrutura das Configurações (barra lateral e topo dos terminais): a última camada

getLayouts().start(); // layout da grade por workspace (db.settings.layouts)
getUi().start(); // preferências: cache local já aplicado; o servidor (db.settings.ui) é lido e vence o cache

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <StoreProvider>
      <App />
    </StoreProvider>
  </ErrorBoundary>,
);
