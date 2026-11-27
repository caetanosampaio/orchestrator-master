// Separação entre o FORGE pessoal (instalado) e o FORGE DEV (este código rodado do repositório).
// Os terminais abertos por um FORGE instalado herdavam o ambiente do servidor dele (ORCH_DATA_DIR, PORT): um `npm test` ou `npm run server`
// rodado ali abriria o banco pessoal. A regra: código que roda de um checkout Git NUNCA abre a pasta de dados do app instalado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Pastas do app instalado (a atual e a do nome antigo, "AI Dev Orchestrator"). "FORGE DEV" não entra. */
export function installedAppRoots({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const base = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || path.join(home, '.config');
  const bases = platform === 'win32' ? [base, path.join(home, 'AppData', 'Roaming')] : [base]; // APPDATA alterado não esconde a pasta real
  return [...new Set(bases)].flatMap((b) => ['FORGE', 'AI Dev Orchestrator'].map((name) => path.join(b, name)));
}

/** Caminho real (resolve links e nomes curtos do Windows); o trecho que ainda não existe é mantido como veio. */
function realOf(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs); } catch { const up = path.dirname(abs); return up === abs ? abs : path.join(realOf(up), path.basename(abs)); }
}

export function isInstalledAppPath(target, opts = {}) {
  if (typeof target !== 'string' || !target) return false;
  const platform = opts.platform ?? process.platform;
  const norm = (p) => (platform === 'win32' || platform === 'darwin' ? realOf(p).toLowerCase() : realOf(p));
  const t = norm(target);
  return installedAppRoots(opts).some((root) => { const rel = path.relative(norm(root), t); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); });
}

/** Lança se um checkout (`codeRoot` com .git; o app instalado e o stage do desktop não têm) for abrir dados do app instalado. */
export function assertDevDataDir(dataDir, { codeRoot, ...opts }) {
  if (!fs.existsSync(path.join(codeRoot, '.git')) || !isInstalledAppPath(dataDir, opts)) return;
  throw new Error('FORGE DEV recusou abrir a pasta de dados do FORGE instalado (ORCH_DATA_DIR herdado de um terminal do app?). '
    + 'Use `npm run server`, `npm run forge-dev` ou `npm test`, que limpam o ambiente herdado. Nada foi lido nem gravado.');
}

/** O servidor já leu ORCH_DATA_DIR e PORT: tira do próprio ambiente para nenhum processo filho (terminais, logins, preparo) herdar. */
export function consumeServerEnv(env = process.env) {
  const out = { customDataDir: !!env.ORCH_DATA_DIR, port: Number(env.PORT) || null };
  delete env.ORCH_DATA_DIR; delete env.PORT;
  return out;
}

/** Só valem para o pane que as criou: nunca passam para um comando de desenvolvimento. */
const PANE_ONLY = ['FORGE_MCP_TOKEN', 'FORGE_MCP_URL', 'ELECTRON_RUN_AS_NODE', 'CLAUDE_CODE_CHILD_SESSION'];
/** Configuração do servidor do app: só sai quando o ambiente veio comprovadamente do instalado (valores definidos de propósito ficam). */
const FROM_APP_SERVER = ['ORCH_DATA_DIR', 'ORCH_API_TOKEN', 'PORT'];

/** Nomes das variáveis que apontam para dentro do app instalado (banco, contas, arquivos de pane). */
function installedEnvKeys(env, opts) {
  return Object.keys(env).filter((k) => typeof env[k] === 'string' && path.isAbsolute(env[k]) && isInstalledAppPath(env[k], { env, ...opts }));
}

/** Ambiente dos comandos de desenvolvimento: sem o que veio de um FORGE aberto. Não altera o objeto recebido. */
export function cleanDevEnv(env = process.env, opts = {}) {
  const pointing = new Set(installedEnvKeys(env, opts));
  const fromApp = [...pointing].some((k) => k.toUpperCase() === 'ORCH_DATA_DIR');
  return Object.fromEntries(Object.entries(env).filter(([k]) => {
    const key = k.toUpperCase(); // no Windows os nomes não diferenciam maiúsculas, mas a cópia do objeto sim
    return !pointing.has(k) && !PANE_ONLY.includes(key) && !(fromApp && FROM_APP_SERVER.includes(key));
  }));
}

/** Boot de um checkout sem o wrapper (`node server/index.js`, `node --test`): tira do próprio ambiente as contas e credenciais do app instalado. ORCH_DATA_DIR não chega aqui: é recusado antes. */
export function scrubInstalledEnv({ codeRoot, env = process.env, ...opts }) {
  if (!fs.existsSync(path.join(codeRoot, '.git'))) return;
  for (const k of [...installedEnvKeys(env, opts), 'FORGE_MCP_TOKEN', 'FORGE_MCP_URL']) delete env[k];
}
