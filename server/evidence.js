// Nomes de diretório que as varreduras do painel Live não percorrem (live-changes.js) e reconhecimento do diretório interno do Git (live-paths.js).
// O restante deste módulo (instantâneo, integridade e evidência do Executor) era do ciclo antigo de missões e foi removido junto com ele.

export const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.turbo', '__pycache__', '.venv', 'venv', 'target']);

/** O nome é o diretório interno do Git? Windows e macOS (APFS padrão) ignoram caixa, e o Windows ignora pontos/espaços finais e fluxos (`.git::$INDEX_ALLOCATION`): `.GIT`, `.git.` e `.git ` são o mesmo `.git`. `.github`/`.gitignore` não. */
export const isGitName = (name) => { const n = String(name ?? '').split(':')[0].replace(/[. ]+$/, '').toLowerCase(); return n === '.git' || /^\.?git~\d+$/.test(n); }; // inclui o nome curto 8.3 do NTFS (`GIT~1`)

/** Diretório que a varredura não percorre (a entrada `.git` vale em qualquer caixa). */
export const isSkippedDir = (name) => SKIP_DIRS.has(name) || isGitName(name);
