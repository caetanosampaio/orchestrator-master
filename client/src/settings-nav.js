// Navegação da página de Configurações: grupos, seções, busca e nomes antigos. PURO (sem React). Cada seção é um componente em components/settings/ (o mapa fica em pages/Settings.jsx).
const item = (id, label, icon, hint, keywords = [], extra = {}) => Object.freeze({ id, label, icon, title: label, hint, keywords: Object.freeze(keywords), ...extra });
const group = (id, label, items) => Object.freeze({ id, label, items: Object.freeze(items) });

export const NAV = Object.freeze([
  group('ias', 'IAs e contas', [
    item('ias', 'Suas IAs', 'terminal', 'Os agentes que rodam nos terminais do FORGE e as outras IAs que podem vir.', ['claude', 'codex', 'provider', 'agentes', 'cli', 'instalado', 'login']),
    item('accounts', 'Contas', 'user', 'Entre com mais de uma conta do Claude Code e escolha qual cada terminal usa.', ['login', 'claude', 'entrar', 'assinatura']),
    item('mascotes', 'Mascotes', 'agents', 'Cada IA tem o seu mascote: o corpo é o mesmo e a cor muda.', ['bonecos', 'cor', 'pixel', 'cara']),
  ]),
  group('times', 'Missões e times', [
    item('equipes', 'Times prontos', 'layers', 'Times com papéis e agentes prontos para abrir no Cockpit. Instale os opcionais, edite e monte os seus.', ['squad', 'squads', 'equipes', 'times', 'modelo', 'esforço', 'predefinições', 'instalar'], { tag: 'Squads', own: true }), // `own`: a seção desenha o próprio cabeçalho (título, ação e as páginas de ver e editar)
    item('orquestracao', 'Orquestração', 'sliders', 'Como o Maestro envia tarefas aos outros terminais.', ['maestro', 'autônomo', 'aprovação']),
    item('worktrees', 'Workspaces e Worktrees', 'workspace', 'As branches Git dos terminais isolados: estado, snapshot e limpeza.', ['git', 'branch', 'isolado']),
    item('historico', 'Histórico de sessões', 'clock', 'As sessões de terminal do workspace aberto, para retomar.', ['retomar', 'restaurar', 'conversas']),
  ]),
  group('app', 'App e computador', [
    item('perfil', 'Perfil', 'user', 'O nome que aparece na barra lateral. Fica salvo só neste computador.', ['nome', 'conta']),
    item('geral', 'Preferências gerais', 'sliders', 'Como os novos terminais são abertos.', ['isolar', 'worktree']),
    item('visualizacao', 'Visualização', 'panel', 'Como os terminais do workspace aberto são organizados na tela.', ['grade', 'colunas', 'linhas', 'foco', 'layout']),
    item('aparencia', 'Aparência', 'sun', 'Tema, animações e a fonte dos terminais.', ['tema', 'animações', 'fonte', 'movimento']),
    item('arquivos', 'Arquivos', 'folderOpen', 'Os workspaces: as pastas de projeto onde os agentes trabalham.', ['pasta', 'projeto', 'workspace']),
  ]),
]);

export const DEFAULT_TAB = 'perfil';
/** Nomes antigos de seções que foram reunidas em outras (o link continua levando ao lugar certo). */
export const ALIASES = Object.freeze({ cli: 'ias', providers: 'ias' });
export const flatItems = () => NAV.flatMap((g) => g.items);
export const itemById = (id) => flatItems().find((x) => x.id === id) ?? null;
/** Seção válida para um id qualquer: nome antigo vira o novo; desconhecido (ou algo que não é texto) cai em `fallback`. */
export const resolveTab = (id, fallback = DEFAULT_TAB) => { const k = typeof id === 'string' ? (ALIASES[id] ?? id) : null; return k && itemById(k) ? k : fallback; };

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
/** Grupos com só as seções que combinam com a busca (nome, título, descrição ou palavras-chave; sem diferenciar maiúsculas nem acentos). Busca vazia = tudo. Grupo sem resultado some. */
export function filterNav(query) {
  const q = fold(query).trim(); if (!q) return NAV;
  return NAV.map((g) => ({ ...g, items: g.items.filter((it) => [it.label, it.hint, ...it.keywords].some((t) => fold(t).includes(q))) })).filter((g) => g.items.length);
}
