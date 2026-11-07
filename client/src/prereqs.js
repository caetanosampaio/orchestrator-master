// Pré-requisitos do primeiro uso (Claude Code, login e Git). PURO: monta a lista de pendências a partir de /api/state.
// `state.prereqs` é aditivo (servidor novo); em servidor antigo cai no probe antigo do Claude Code (`state.executor`). Sem `state` (servidor ainda não respondeu) não há aviso.
//
// Cada pendência vira um bloco do popup de "Antes de começar": título, explicação, passos e se BLOQUEIA o uso.
//  - claude (Claude Code não encontrado): bloqueia, porque sem ele o FORGE não faz nada;
//  - login  (conta do Claude Code não conectada): informativo, porque a detecção é de melhor esforço (pode haver chave de API, Bedrock ou Vertex);
//  - git    (Git não encontrado): informativo, porque o resto do app funciona (só worktrees e relatórios dependem dele).
export const PREREQ = Object.freeze({
  claude: Object.freeze({
    title: 'Claude Code não encontrado',
    text: 'O FORGE trabalha com o Claude Code, e ele não foi encontrado neste computador.',
    steps: Object.freeze(['Instale o Claude Code (veja a documentação oficial da Anthropic).', 'Abra um terminal e rode `claude` uma vez para entrar com a sua conta.', 'Volte aqui e clique em Verificar novamente.']),
    blocking: true,
  }),
  login: Object.freeze({
    title: 'Conta do Claude Code não conectada',
    text: 'Não encontramos uma conta conectada ao Claude Code. Se você usa chave de API, Bedrock ou Vertex, pode continuar.',
    steps: Object.freeze(['Clique em Entrar na conta (ou em Configurações > Contas) e conclua o login no navegador.', 'Volte aqui e clique em Verificar novamente.']),
    blocking: false,
  }),
  git: Object.freeze({
    title: 'Git não encontrado',
    text: 'O Git é necessário para worktrees e para os relatórios de entrega.',
    steps: Object.freeze(['Instale o Git em https://git-scm.com/downloads.', 'Volte aqui e clique em Verificar novamente.']),
    blocking: false,
  }),
});

/** Depois de instalar algo, o sistema só atualiza a lista de programas quando o app abre: sem isso o botão "Verificar novamente" não enxerga o novo programa. */
export const RESTART_HINT = 'Se o aviso continuar depois de instalar, feche o FORGE por completo e abra de novo: o sistema só atualiza a lista de programas ao abrir o app.';

/** O detalhe do servidor só entra quando acrescenta algo ("... não encontrado no PATH" repetiria o texto fixo). */
const extra = (d) => { const t = String(d ?? '').trim(); return t && !/n[aã]o (foi )?encontrad/i.test(t) ? t : ''; };

/** Pendências, na ordem em que se resolvem: Claude Code, login, Git. */
export function prereqIssues(state) {
  if (!state || typeof state !== 'object') return [];
  const p = state.prereqs && typeof state.prereqs === 'object' ? state.prereqs : null;
  const out = [];
  const claudeOff = p?.claude && typeof p.claude.available === 'boolean' ? !p.claude.available : state.executor?.available === false;
  const add = (id, detail) => out.push({ id, ...PREREQ[id], detail });
  if (claudeOff) add('claude', extra(p?.claude?.detail ?? state.executor?.detail));
  // o login só importa com o Claude Code instalado e só quando o servidor TEM certeza (`known`): no macOS e em servidor antigo não há aviso falso
  else if (p?.login?.known === true && p.login.loggedIn === false) add('login', ''); // o detalhe do servidor repetiria os passos; só o texto fixo vale
  if (p?.git && p.git.available === false) add('git', extra(p.git.detail));
  return out;
}

/** Chave estável do conjunto de pendências: quem clicou em "Continuar mesmo assim" só volta a ver o popup se o conjunto MUDAR. */
export const issueKey = (issues) => (Array.isArray(issues) ? issues.map((i) => i.id).join('+') : '');

/** Há alguma pendência que bloqueia o uso? */
export const hasBlocking = (issues) => Array.isArray(issues) && issues.some((i) => i.blocking);

/**
 * Pode continuar sem resolver? Pendência informativa: sempre. Bloqueante: só depois de ao menos uma verificação que continuou falhando
 * (assim um falso negativo, como um PATH diferente do esperado, nunca prende o usuário fora do app).
 */
export const canContinue = ({ issues, tries = 0 } = {}) => !hasBlocking(issues) || tries > 0;

/** Parte um texto em pedaços de texto, `código` (entre crases) e links https, para o popup desenhar sem usar HTML cru. */
export function inlineParts(text) {
  const out = [];
  for (const piece of String(text ?? '').split(/(`[^`]+`|https?:\/\/[^\s)]+[^\s).,;])/)) {
    if (!piece) continue;
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) out.push({ kind: 'code', text: piece.slice(1, -1) });
    else if (/^https:\/\//.test(piece)) out.push({ kind: 'link', text: piece, href: piece });
    else out.push({ kind: 'text', text: piece });
  }
  return out;
}
