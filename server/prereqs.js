// Pré-requisitos do app (aditivo em GET /api/state): Claude Code (vem do probe do executor) e Git (aqui).
// Sem shell, argumentos fixos, timeout curto, cache de 15 s e uma única chamada em andamento compartilhada (várias rotas consultam ao mesmo tempo).
import { execFile } from 'node:child_process';

export const GIT_MISSING = 'Git não encontrado no PATH. Instale em https://git-scm.com/downloads';
const TTL_MS = 15_000;

/** `command` só existe para os testes injetarem um Git falso (ou inexistente); o servidor usa o padrão. */
export function createGitProbe({ command = 'git', prefixArgs = [], ttlMs = TTL_MS } = {}) {
  let cache = { at: 0, value: null }, inFlight = null;
  function probeGit() {
    if (cache.value && Date.now() - cache.at < ttlMs) return Promise.resolve(cache.value);
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve) => {
      const done = (value) => { cache = { at: Date.now(), value }; inFlight = null; resolve(value); };
      try {
        execFile(command, [...prefixArgs, '--version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
          if (err) return done({ available: false, version: null, detail: GIT_MISSING });
          const version = String(stdout).trim().replace(/^git version\s+/i, '') || null;
          done({ available: true, version, detail: 'Git detectado.' });
        });
      } catch { done({ available: false, version: null, detail: GIT_MISSING }); }
    });
    return inFlight;
  }
  probeGit.reset = () => { cache = { at: 0, value: null }; }; // "Verificar novamente": a próxima sonda consulta de verdade
  return probeGit;
}

/**
 * O Claude Code está com a conta conectada? Usa o estado da CONTA PADRÃO (`claude auth status`, via accounts.js, com cache de ~45 s): não lê arquivos de credenciais.
 * Devolve { known, loggedIn, detail }; `loggedIn` só vale quando `known` é verdadeiro. O `detail` NUNCA traz e-mail nem nome da conta (/api/state é uma leitura aberta).
 * Na conta Sistema, chave de API/Bedrock/Vertex no ambiente do servidor contam como autenticado (a CLI usa essas variáveis); numa conta do FORGE elas são removidas do ambiente do filho
 * (claude-cli.js), então só vale o login da própria conta.
 */
const AUTH_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];
export async function probeLogin({ env = process.env, accounts = null } = {}) {
  const defaultId = accounts?.defaultId?.() ?? 'system';
  if (defaultId === 'system' && AUTH_ENV.some((k) => typeof env[k] === 'string' && env[k] !== '')) return { known: true, loggedIn: true, detail: 'Autenticação por variável de ambiente (chave de API, token, Bedrock ou Vertex).' };
  if (!accounts?.statusOf) return { known: false, loggedIn: null, detail: 'Não foi possível consultar o login do Claude Code.' };
  let st; try { st = await accounts.statusOf(defaultId); } catch { st = null; }
  if (!st || !st.checked || typeof st.loggedIn !== 'boolean') return { known: false, loggedIn: null, detail: st?.error || 'Não foi possível consultar o login do Claude Code.' };
  return st.loggedIn
    ? { known: true, loggedIn: true, detail: 'Claude Code conectado (conta padrão).' }
    : { known: true, loggedIn: false, detail: 'O Claude Code não está conectado: abra Configurações > Contas e faça login.' };
}

/** Monta o contrato `prereqs` a partir do probe do Claude ({available, version?, detail}), do Git e do login (probeLogin). */
export const prereqsOf = (claudeProbe, git, login = { known: false, loggedIn: null, detail: '' }) => ({
  claude: { available: !!claudeProbe.available, version: claudeProbe.available ? (claudeProbe.version || null) : null, detail: claudeProbe.available ? 'Claude Code detectado.' : (claudeProbe.detail || 'Claude Code não encontrado no PATH. Instale em https://claude.com/claude-code') },
  git: { available: !!git.available, version: git.version ?? null, detail: git.detail },
  login: { known: !!login.known, loggedIn: login.known ? !!login.loggedIn : null, detail: String(login.detail ?? '') },
});
