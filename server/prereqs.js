// Pré-requisitos do app (aditivo em GET /api/state): Claude Code (vem do probe do executor), Git (aqui) e o login (alguma conta conectada de algum provider).
// Sem shell, argumentos fixos, timeout curto, cache de 15 s e uma única chamada em andamento compartilhada (várias rotas consultam ao mesmo tempo).
import { execFile } from 'node:child_process';
import { accountSpecOf } from './providers/index.js';

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
 * O FORGE tem ALGUMA conta conectada, de qualquer provider? (O FORGE é agnóstico de provider: basta uma conta logada de algum.) Usa o estado de login de cada conta
 * (accounts.statusOf, com cache de ~45 s por conta): não lê arquivos de credenciais. Devolve { known, loggedIn, detail }; `loggedIn` só vale quando `known` é verdadeiro.
 * O `detail` NUNCA traz e-mail, organização nem o rótulo da conta (/api/state é uma leitura aberta): só o nome do provider.
 * A conta do COMPUTADOR do Claude com chave de API/token/Bedrock/Vertex no ambiente do servidor conta como conectada (a CLI usa essas variáveis); numa conta isolada elas são removidas
 * do ambiente do filho (providers/claude.js), então lá só vale o login da própria conta.
 */
const AUTH_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];
export const NO_ACCOUNT_DETAIL = 'Nenhuma conta conectada: abra Configurações > Contas e conecte uma conta de algum provider (Claude Code, Codex CLI...).';
const UNKNOWN_DETAIL = 'Não foi possível consultar o login das contas.';
export async function probeLogin({ env = process.env, accounts = null } = {}) {
  if (!accounts?.list || !accounts?.statusOf) return { known: false, loggedIn: null, detail: UNKNOWN_DETAIL };
  let rows; try { rows = accounts.list(); } catch { rows = null; }
  if (!Array.isArray(rows)) return { known: false, loggedIn: null, detail: UNKNOWN_DETAIL };
  if (!rows.length) return { known: true, loggedIn: false, detail: NO_ACCOUNT_DETAIL };
  const envAuth = AUTH_ENV.some((k) => typeof env[k] === 'string' && env[k] !== '');
  const machineEnv = envAuth ? rows.find((a) => a.provider === 'claude' && a.home === 'machine') : null;
  if (machineEnv) return { known: true, loggedIn: true, detail: 'Autenticação por variável de ambiente (chave de API, token, Bedrock ou Vertex).' }; // a CLI usa as variáveis: sem consultar nada
  // Responde ASSIM QUE alguma conta aparece conectada (uma conta lenta não pode transformar "conectado" em "desconhecido" no teto do /api/state);
  // só espera todas para concluir "nenhuma conectada" ou "desconhecido".
  return new Promise((resolve) => {
    let pending = rows.length, done = false;
    const results = [];
    const finish = () => {
      // Ninguém conectado: basta UMA resposta definitiva "não conectada" para orientar o login; contas sem resposta (CLI ausente, erro) não mascaram isso.
      if (results.some((st) => st?.checked === true && st.loggedIn === false)) return resolve({ known: true, loggedIn: false, detail: NO_ACCOUNT_DETAIL });
      const err = results.find((st) => typeof st?.error === 'string' && st.error)?.error;
      resolve({ known: false, loggedIn: null, detail: err || UNKNOWN_DETAIL });
    };
    for (const a of rows) {
      Promise.resolve().then(() => accounts.statusOf(a.id)).catch(() => null).then((st) => {
        if (done) return;
        results.push(st);
        if (st?.checked === true && st.loggedIn === true) { done = true; return resolve({ known: true, loggedIn: true, detail: `Conta conectada: ${providerLabel(a.provider)}.` }); }
        if (--pending === 0) { done = true; finish(); }
      });
    }
  });
}
/** Nome do provider para o `detail` (nunca dado da conta). */
const providerLabel = (p) => accountSpecOf(p)?.label ?? 'provider';

/** Monta o contrato `prereqs` a partir do probe do Claude ({available, version?, detail}), do Git e do login (probeLogin). */
export const prereqsOf = (claudeProbe, git, login = { known: false, loggedIn: null, detail: '' }) => ({
  claude: { available: !!claudeProbe.available, version: claudeProbe.available ? (claudeProbe.version || null) : null, detail: claudeProbe.available ? 'Claude Code detectado.' : (claudeProbe.detail || 'Claude Code não encontrado no PATH. Instale em https://claude.com/claude-code') },
  git: { available: !!git.available, version: git.version ?? null, detail: git.detail },
  login: { known: !!login.known, loggedIn: login.known ? !!login.loggedIn : null, detail: String(login.detail ?? '') },
});
