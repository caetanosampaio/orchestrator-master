// Comando de verificação opcional da missão (Missions v2): roda ANTES da integração final, numa CÓPIA ISOLADA do commit da missão.
//
// Regras fixas:
//  - nada é escrito no repositório do usuário: a cópia é `git clone --local --no-hardlinks --no-checkout` para uma pasta temporária nova (sem worktree, branch ou ref novos),
//    seguida de `checkout --detach <sha>`; tudo pelo `git` de worktrees.js (hooks desligados, sem prompts);
//  - a cópia é apagada num `finally`, também após timeout, falha ou saída gigante;
//  - o processo é `spawn` sem shell, cwd = cópia, ambiente por LISTA PERMITIDA (+ CI=1), timeout com `killTree`, teto de saída e só o FIM da saída é guardado;
//  - `npm`/`npx` rodam por node + npm-cli.js/npx-cli.js (sem shell); `.cmd`/`.bat` não rodam sem shell no Windows: erro claro em português;
//  - nenhuma dependência é instalada; `run` nunca lança.
// Limite honesto: o comando executa código do projeto (inclusive o que os agentes editaram), como `npm test`.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, redactSecrets } from './worktrees.js';
import { resolveNpmCli } from './npm-cli.js';
import { killTree } from './proc.js';

export const VERIFY_MAX_ARGS = 16;
export const VERIFY_MAX_ARG_LEN = 200;
export const VERIFY_MIN_TIMEOUT_SEC = 10;
export const VERIFY_MAX_TIMEOUT_SEC = 1800;
export const VERIFY_DEFAULT_TIMEOUT_SEC = 300;
export const VERIFY_TAIL = 4000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const KEEP_CHARS = 16_000; // guardado antes de ocultar segredos; o resultado final é cortado em VERIFY_TAIL
const SHA_RE = /^[0-9a-f]{40,64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SECRET_ENV = /key|token|secret|passw|credential|auth/i;
const PROXY_ENV = /^(http_proxy|https_proxy|all_proxy|no_proxy)$/i;

/** Valida o comando configurado. `null`/ausente = sem verificação. Devolve `{ value }` (normalizado) ou `{ error }` em português. */
export function validateVerifyCommand(v) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'O comando de verificação deve ser um objeto { args, timeoutSec } ou nulo.' };
  const { args, timeoutSec } = v;
  if (!Array.isArray(args) || args.length < 1 || args.length > VERIFY_MAX_ARGS) return { error: `args deve ser uma lista de 1 a ${VERIFY_MAX_ARGS} textos (executável e argumentos).` };
  for (const a of args) {
    if (typeof a !== 'string') return { error: 'Cada item de args deve ser um texto.' };
    if (a.length > VERIFY_MAX_ARG_LEN) return { error: `Cada item de args deve ter no máximo ${VERIFY_MAX_ARG_LEN} caracteres.` };
    if (CONTROL_RE.test(a)) return { error: 'Os itens de args não podem ter caracteres de controle (quebra de linha, nulo etc.).' };
  }
  if (args[0].trim() === '') return { error: 'O primeiro item de args (o executável) não pode ser vazio.' };
  let sec = VERIFY_DEFAULT_TIMEOUT_SEC;
  if (timeoutSec !== undefined && timeoutSec !== null) {
    if (!Number.isInteger(timeoutSec) || timeoutSec < VERIFY_MIN_TIMEOUT_SEC || timeoutSec > VERIFY_MAX_TIMEOUT_SEC) return { error: `timeoutSec deve ser um inteiro entre ${VERIFY_MIN_TIMEOUT_SEC} e ${VERIFY_MAX_TIMEOUT_SEC}.` };
    sec = timeoutSec;
  }
  return { value: { args: [...args], timeoutSec: sec } };
}

const secretValues = () => Object.entries(process.env).filter(([k, v]) => (SECRET_ENV.test(k) || PROXY_ENV.test(k)) && typeof v === 'string' && v.length >= 4).map(([, v]) => v);

// LISTA PERMITIDA: o comando roda código que um agente pode ter editado, então só passa o que o sistema e as ferramentas precisam (PATH, pastas do usuário e temporárias, idioma).
// URLs de banco com senha, PATs, webhooks e NODE_OPTIONS do usuário ficam de fora, seja qual for o nome. HOME/USERPROFILE continuam: sem eles npm e git não acham a própria configuração.
// Também passam: onde ficam as toolchains (JAVA_HOME, GOPATH, CARGO_HOME...) e o CA corporativo (caminhos, não segredos); sem elas uma verificação não-Node falharia sem explicação.
const ENV_ALLOW = /^(?:path|pathext|systemroot|systemdrive|windir|comspec|temp|tmp|tmpdir|home|homedrive|homepath|userprofile|appdata|localappdata|programdata|programfiles(?:\(x86\))?|programw6432|commonprogramfiles(?:\(x86\))?|commonprogramw6432|allusersprofile|public|username|user|userdomain|logname|computername|sessionname|os|number_of_processors|processor_\w+|shell|term|lang|language|tz|lc_(?:all|ctype|messages|collate|time|numeric|monetary)|xdg_(?:config_home|cache_home|data_home|state_home|runtime_dir)|java_home|gopath|goroot|cargo_home|rustup_home|dotnet_root|virtual_env|nvm_dir|volta_home|psmodulepath|node_extra_ca_certs|ssl_cert_file)$/i;

/** Ambiente só com a lista permitida (e ainda sem nada que pareça segredo ou proxy), mais CI=1. */
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (ENV_ALLOW.test(k) && !SECRET_ENV.test(k) && !PROXY_ENV.test(k)) env[k] = v;
  return { ...env, CI: '1', NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
}

/** Resolve args[0] para { command, args } sem shell, ou { error } em português. */
function resolveCommand(args, platform) {
  const [exe, ...rest] = args;
  const base = path.basename(exe).toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  if (base === 'npm' || base === 'npx') {
    const cli = resolveNpmCli();
    if (!cli) return { error: 'npm não foi encontrado junto ao Node; não foi possível executar a verificação.' };
    return { command: process.execPath, args: [base === 'npm' ? cli : path.join(path.dirname(cli), 'npx-cli.js'), ...rest] };
  }
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) return { error: `"${exe}" é um script .cmd/.bat e não roda sem shell no Windows. Use um executável (.exe), "node arquivo.js" ou "npm run <script>".` };
  return { command: exe, args: rest };
}

const CANCELLED = 'Verificação cancelada.';
const noteTail = (text, note) => `${String(text).slice(-Math.max(0, KEEP_CHARS - note.length - 1))}\n${note}`;

/**
 * `runGit`, `spawnProc` e `tmpRoot` existem para os testes; o servidor usa o Git real, `spawn` e a pasta temporária do sistema.
 * `maxOutputBytes` e `timeoutScale` (multiplica o timeout) também são só para os testes.
 */
export function createFlowVerify({ runGit = git, spawnProc = spawn, tmpRoot = os.tmpdir(), maxOutputBytes = MAX_OUTPUT_BYTES, timeoutScale = 1, platform = process.platform } = {}) {
  /**
   * Nunca lança. Devolve { status: 'pass'|'fail'|'timeout'|'error', command, exitCode, durationMs, outputTail, truncated, at }.
   * `opts.signal` (AbortSignal, opcional): abortar = a árvore do processo é encerrada e o resultado é `error` ("Verificação cancelada."); a cópia é apagada do mesmo jeito.
   */
  async function run(repoPath, sha, opts = {}) {
    const checked = validateVerifyCommand({ args: opts?.args, timeoutSec: opts?.timeoutSec });
    const command = Array.isArray(opts?.args) ? opts.args.map(String).join(' ').slice(0, 400) : '';
    const secrets = secretValues();
    const result = (status, { exitCode = null, durationMs = 0, text = '', total = text.length } = {}) => {
      const clean = redactSecrets(String(text).trim(), secrets);
      return { status, command: redactSecrets(command, secrets), exitCode, durationMs, outputTail: clean.slice(-VERIFY_TAIL), truncated: total > VERIFY_TAIL || clean.length > VERIFY_TAIL, at: new Date().toISOString() };
    };
    if (checked.error) return result('error', { text: checked.error });
    if (typeof repoPath !== 'string' || !repoPath) return result('error', { text: 'Caminho do repositório inválido.' });
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) return result('error', { text: 'Commit inválido: esperado um SHA completo em hexadecimal.' });
    const { args, timeoutSec } = checked.value;
    const resolved = resolveCommand(args, platform);
    if (resolved.error) return result('error', { text: resolved.error });
    const signal = opts?.signal ?? null;
    if (signal?.aborted) return result('error', { text: CANCELLED });

    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(tmpRoot, 'forge-verify-'));
      const copy = path.join(dir, 'repo');
      const clone = await runGit(dir, ['clone', '--local', '--no-hardlinks', '--no-checkout', '--quiet', '--', path.resolve(repoPath), copy], { timeout: 120_000 });
      if (clone.code !== 0) return result('error', { text: `Não foi possível criar a cópia isolada do repositório: ${clone.timedOut ? 'tempo esgotado' : (clone.err || 'falha ao executar o Git')}` });
      const co = await runGit(copy, ['checkout', '--quiet', '--detach', sha], { timeout: 120_000 });
      if (co.code !== 0) return result('error', { text: `Não foi possível posicionar a cópia no commit ${sha.slice(0, 12)}: ${co.timedOut ? 'tempo esgotado' : (co.err || 'falha ao executar o Git')}` });
      if (signal?.aborted) return result('error', { text: CANCELLED });
      return await execute(copy, resolved, timeoutSec, result, signal);
    } catch (e) {
      return result('error', { text: `Falha ao preparar a verificação: ${e?.message ?? e}` });
    } finally {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); } catch { /* melhor esforço: a pasta fica no diretório temporário do sistema */ } }
    }
  }

  function execute(cwd, spec, timeoutSec, result, signal = null) {
    const limit = Math.max(Math.round(timeoutSec * 1000 * timeoutScale), 50);
    const t0 = Date.now();
    return new Promise((resolve) => {
      let child, done = false, timedOut = false, overflow = false, aborted = false, bytes = 0, tail = '';
      const dec = new StringDecoder('utf8');
      let timer = null, failSafe = null;
      const finish = (exitCode, spawnError) => {
        if (done) return; done = true; clearTimeout(timer); clearTimeout(failSafe); signal?.removeEventListener?.('abort', onAbort);
        try { child.removeAllListeners(); child.stdout?.removeAllListeners(); child.stderr?.removeAllListeners(); child.on('error', () => {}); } catch { /* já limpo */ }
        const durationMs = Date.now() - t0, total = bytes;
        if (spawnError) {
          const msg = spawnError.code === 'ENOENT' ? `Executável não encontrado: "${spec.command}". Ele precisa estar no PATH ou existir dentro do projeto.`
            : spawnError.code === 'EINVAL' || spawnError.code === 'EACCES' || spawnError.code === 'EPERM' ? `Não foi possível executar "${spec.command}" sem shell (${spawnError.code}). Use um executável, "node arquivo.js" ou "npm run <script>".`
              : `Falha ao iniciar o processo: ${spawnError.message}`;
          return resolve(result('error', { durationMs, text: msg }));
        }
        const text = (tail + dec.end()).trim();
        if (aborted) return resolve(result('error', { exitCode: null, durationMs, total, text: noteTail(text, `[${CANCELLED} Processo encerrado.]`) }));
        if (timedOut) return resolve(result('timeout', { exitCode: null, durationMs, total, text: noteTail(text, `[tempo máximo excedido (${Math.round(limit / 1000)} s); processo encerrado]`) }));
        if (overflow) return resolve(result('fail', { exitCode: null, durationMs, total, text: noteTail(text, `[a saída passou de ${maxOutputBytes} bytes; processo encerrado]`) }));
        resolve(result(exitCode === 0 ? 'pass' : 'fail', { exitCode, durationMs, total, text }));
      };
      try {
        child = spawnProc(spec.command, spec.args, { cwd, shell: false, windowsHide: true, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { return finish(null, e); }
      const stop = () => { // encerra a árvore; se o `close` não vier logo depois, conclui mesmo assim para a cópia poder ser apagada
        killTree(child).then(() => { if (!done) failSafe = setTimeout(() => finish(null), 3000); });
      };
      timer = setTimeout(() => { timedOut = true; stop(); }, limit);
      function onAbort() { if (done || aborted || timedOut || overflow) return; aborted = true; stop(); }
      signal?.addEventListener?.('abort', onAbort, { once: true });
      const feed = (chunk) => {
        bytes += chunk.length;
        if (overflow || timedOut || aborted) return; // depois do corte, o restante é descartado
        tail = (tail + dec.write(chunk)).slice(-KEEP_CHARS);
        if (bytes > maxOutputBytes) { overflow = true; stop(); }
      };
      child.stdout?.on('data', feed); child.stderr?.on('data', feed);
      child.on('error', (e) => finish(null, e));
      child.on('close', (code) => finish(code));
    });
  }

  return { run };
}
