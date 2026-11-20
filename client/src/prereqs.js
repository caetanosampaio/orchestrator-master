// Pré-requisitos do primeiro uso (uma IA suportada, login e Git). PURO: monta a lista de pendências a partir de /api/state e dos provedores de /api/terminals.
// `state.prereqs` é aditivo (servidor novo); em servidor antigo cai no probe antigo do Claude Code (`state.executor`). Sem `state` (servidor ainda não respondeu) não há aviso.
// Nenhuma IA específica é obrigatória: basta UMA suportada (hoje Claude Code ou Codex CLI) instalada.
//
// Cada pendência vira um bloco do popup de "Antes de começar": título, explicação, passos e se BLOQUEIA o uso.
//  - agent  (nenhuma IA encontrada): bloqueia, porque sem um agente o FORGE não faz nada. Só aparece com o Claude Code ausente E o Codex ausente;
//  - login  (conta do Claude Code não conectada): informativo, porque a detecção é de melhor esforço (pode haver chave de API, Bedrock ou Vertex);
//  - codexLogin (Codex é a única IA instalada e não está conectado): informativo, mesmo motivo;
//  - git    (Git não encontrado): informativo, porque o resto do app funciona (só worktrees e relatórios dependem dele).
export const PREREQ = Object.freeze({
  agent: Object.freeze({
    title: 'Nenhuma IA encontrada',
    text: 'O FORGE precisa de pelo menos uma IA de linha de comando instalada neste computador (hoje: Claude Code ou Codex CLI) e conectada à sua assinatura.',
    steps: Object.freeze(['Instale o Claude Code (veja a documentação oficial da Anthropic) ou o Codex CLI (`npm i -g @openai/codex`).', 'Abra um terminal e rode `claude` ou `codex login` uma vez para entrar com a sua conta.', 'Volte aqui e clique em Verificar novamente.']),
    blocking: true,
  }),
  codexLogin: Object.freeze({
    title: 'Conta do Codex não conectada',
    text: 'O Codex CLI foi encontrado, mas não há uma conta conectada a ele.',
    steps: Object.freeze(['Abra um terminal e rode `codex login` para entrar com a sua conta.', 'Volte aqui e clique em Verificar novamente.']),
    blocking: false,
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

/**
 * Pendências, na ordem em que se resolvem: IA, login, Git.
 * `providers` é `terminals.providers` (/api/terminals): `null`/`undefined` = ainda não carregou. Com o Claude Code ausente, a decisão de bloquear depende do Codex,
 * então espera os provedores chegarem (senão um usuário só com Codex veria o bloqueio piscar na abertura).
 */
export function prereqIssues(state, providers = null) {
  if (!state || typeof state !== 'object') return [];
  const p = state.prereqs && typeof state.prereqs === 'object' ? state.prereqs : null;
  const out = [];
  const claudeOff = p?.claude && typeof p.claude.available === 'boolean' ? !p.claude.available : state.executor?.available === false;
  const add = (id, detail) => out.push({ id, ...PREREQ[id], detail });
  const codex = Array.isArray(providers) ? providers.find((x) => x?.id === 'codex') : null;
  const codexOn = codex?.available === true;
  if (claudeOff) {
    if (!Array.isArray(providers)) { /* provedores ainda não chegaram: sem aviso por enquanto */ }
    else if (!codexOn) add('agent', extra(p?.claude?.detail ?? state.executor?.detail));
    else if (codex.auth?.known === true && codex.auth.loggedIn === false) add('codexLogin', ''); // o Codex é a IA que sobrou: avisa se ele não está conectado
  } else if (p?.login?.known === true && p.login.loggedIn === false) {
    // o login do Claude só importa com ele instalado e só quando o servidor TEM certeza (`known`): no macOS e em servidor antigo não há aviso falso
    add('login', ''); // o detalhe do servidor repetiria os passos; só o texto fixo vale
  }
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
