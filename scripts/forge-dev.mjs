// Comandos do FORGE DEV, isolados do FORGE instalado (mesmo quando rodados de um terminal dele):
//   server : API em 127.0.0.1:4317 com o banco de desenvolvimento (data/ do repositório)
//   app    : janela "FORGE DEV" (monta desktop/stage com o código atual e abre o Electron; dados em %APPDATA%\FORGE DEV)
//   test   : a suíte (ou os arquivos passados) com um banco temporário, apagado no fim
// Nenhum deles atualiza o app instalado: isso é só `npm run update:win` em desktop/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cleanDevEnv } from '../server/dev-guard.js';
import { pidAlive } from '../server/instance-lock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode, ...args] = process.argv.slice(2);
const env = cleanDevEnv(process.env);

function run(cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: ROOT, env, stdio: 'inherit', ...opts });
    // O pai só espera o filho encerrar (para poder limpar). Ctrl+C e o fechamento do console já chegam aos dois; um `kill` só no pai (macOS/Linux) é repassado.
    const wait = () => {}, pass = () => { if (process.platform !== 'win32') child.kill('SIGTERM'); };
    const handlers = [['SIGINT', wait], ['SIGHUP', wait], ['SIGBREAK', wait], ['SIGTERM', pass]];
    for (const [sig, fn] of handlers) process.on(sig, fn);
    child.on('error', (e) => { console.error(`[forge-dev] não foi possível executar ${path.basename(cmd)}: ${e.message}`); resolve(1); });
    child.on('exit', (code) => { for (const [sig, fn] of handlers) process.off(sig, fn); resolve(code ?? 1); });
  });
}

if (mode === 'server') {
  process.exitCode = await run(process.execPath, [path.join(ROOT, 'server', 'index.js'), ...args]);
} else if (mode === 'test') {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-suite-'));
  env.ORCH_DATA_DIR = data;
  delete env.PORT; // a suíte escolhe as próprias portas
  const files = args.some((a) => /\.test\.mjs$/.test(a)) ? []
    : fs.readdirSync(path.join(ROOT, 'server', 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `server/test/${f}`);
  try { process.exitCode = await run(process.execPath, ['--test', ...args, ...files]); }
  finally { try { fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.error(`[forge-dev] não foi possível apagar ${data}`); } }
} else if (mode === 'app') {
  let electron;
  try { electron = createRequire(path.join(ROOT, 'desktop', 'package.json'))('electron'); }
  catch { console.error('[forge-dev] Electron não encontrado: rode "npm install" em desktop/.'); process.exit(1); }
  // Montar o stage apaga a pasta que um FORGE DEV aberto está usando: confere antes a trava do servidor dele.
  const appData = process.platform === 'win32' ? env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  let holder = null;
  try { holder = JSON.parse(fs.readFileSync(path.join(appData, 'FORGE DEV', 'data', 'server.lock'), 'utf8')).pid; } catch { /* sem trava: fechado */ }
  if (Number.isInteger(holder) && holder > 0 && pidAlive(holder)) { console.error('[forge-dev] o FORGE DEV já está aberto. Feche-o e rode de novo.'); process.exit(3); } // 3 = já aberto/abrindo (o lançador do atalho explica)
  // Dois cliques no atalho durante a montagem: o segundo apagaria o stage que o primeiro está criando.
  const buildLock = path.join(os.tmpdir(), 'forge-dev-build.lock');
  const takeLock = () => { try { fs.writeFileSync(buildLock, String(process.pid), { flag: 'wx' }); return true; } catch { return false; } };
  if (!takeLock()) {
    let other = 0;
    try { other = Number(fs.readFileSync(buildLock, 'utf8')); } catch { /* sumiu: tenta de novo */ }
    if (other > 0 && pidAlive(other)) { console.error('[forge-dev] o FORGE DEV já está sendo montado. Aguarde a janela abrir.'); process.exit(3); }
    fs.rmSync(buildLock, { force: true }); // sobra de uma montagem interrompida
    if (!takeLock()) { console.error('[forge-dev] o FORGE DEV já está sendo montado. Aguarde a janela abrir.'); process.exit(3); }
  }
  let stage;
  try { stage = spawnSync(process.execPath, [path.join(ROOT, 'desktop', 'scripts', 'prepare.mjs')], { cwd: ROOT, env, stdio: 'inherit' }); }
  finally { fs.rmSync(buildLock, { force: true }); }
  if (stage.status !== 0) { console.error('[forge-dev] falha ao montar o desktop/stage. Se o FORGE DEV já está aberto, feche-o e rode de novo.'); process.exit(1); }
  process.exitCode = await run(electron, [path.join(ROOT, 'desktop')]);
} else {
  console.error('uso: node scripts/forge-dev.mjs <server|app|test> [argumentos]');
  process.exitCode = 2;
}
