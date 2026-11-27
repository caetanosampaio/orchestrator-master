// Separação FORGE instalado x FORGE DEV (server/dev-guard.js). Só pastas temporárias como APPDATA falso; o %APPDATA% real nunca é aberto.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installedAppRoots, isInstalledAppPath, assertDevDataDir, consumeServerEnv, cleanDevEnv, scrubInstalledEnv } from '../dev-guard.js';

// valores definidos de propósito ficam; contas e MCP do instalado saem mesmo sem o wrapper
test('ORCH_DATA_DIR e PORT próprios NÃO são descartados', () => {
  const own = { ORCH_DATA_DIR: path.join(os.tmpdir(), 'meu-banco'), PORT: '5123', ORCH_API_TOKEN: 't' };
  assert.deepEqual(cleanDevEnv({ ...own, FORGE_MCP_URL: 'u' }, { env: {}, home: path.join(os.tmpdir(), 'ninguem') }), own);
});

test('boot de um checkout sem o wrapper tira contas, arquivos de pane e MCP do instalado; sem .git nada muda', () => {
  const checkout = path.join(tmp, 'checkout2'), packaged = path.join(tmp, 'packaged2');
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true }); fs.mkdirSync(packaged);
  const make = () => ({ ...fake.env, PATH: 'p', CLAUDE_CONFIG_DIR: path.join(personal, 'accounts', 'a'), GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(personal, 'pane-files', 'g.json'), CODEX_HOME: path.join(tmp, 'meu-codex'), FORGE_MCP_TOKEN: 't' });
  const env = make(); scrubInstalledEnv({ ...fake, codeRoot: checkout, env });
  assert.deepEqual(env, { ...fake.env, PATH: 'p', CODEX_HOME: path.join(tmp, 'meu-codex') });
  const other = make(); scrubInstalledEnv({ ...fake, codeRoot: packaged, env: other });
  assert.deepEqual(other, make());
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-devguard-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const appData = path.join(tmp, 'appdata');
const fake = { env: { APPDATA: appData, XDG_CONFIG_HOME: appData }, platform: process.platform === 'darwin' ? 'darwin' : process.platform, home: tmp };
const personal = path.join(installedAppRoots(fake)[0], 'data');
const devApp = path.join(path.dirname(installedAppRoots(fake)[0]), 'FORGE DEV', 'data');

test('reconhece a pasta do app instalado (e a antiga), mas não a do FORGE DEV nem uma vizinha', () => {
  assert.equal(isInstalledAppPath(personal, fake), true);
  assert.equal(isInstalledAppPath(installedAppRoots(fake)[0], fake), true);
  assert.equal(isInstalledAppPath(path.join(installedAppRoots(fake)[1], 'data'), fake), true);
  assert.equal(isInstalledAppPath(devApp, fake), false);
  assert.equal(isInstalledAppPath(`${installedAppRoots(fake)[0]}-outra`, fake), false);
  assert.equal(isInstalledAppPath(path.join(tmp, 'qualquer'), fake), false);
  assert.equal(isInstalledAppPath(undefined, fake), false);
});

test('Windows e macOS não diferenciam maiúsculas', { skip: process.platform !== 'win32' && process.platform !== 'darwin' }, () => {
  assert.equal(isInstalledAppPath(personal.toUpperCase(), fake), true);
});

test('checkout Git recusa os dados do instalado; código sem .git (o app empacotado) abre normalmente', () => {
  const checkout = path.join(tmp, 'checkout'), packaged = path.join(tmp, 'packaged');
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true }); fs.mkdirSync(packaged);
  assert.throws(() => assertDevDataDir(personal, { codeRoot: checkout, ...fake }), /FORGE DEV recusou/);
  assert.doesNotThrow(() => assertDevDataDir(devApp, { codeRoot: checkout, ...fake }));
  assert.doesNotThrow(() => assertDevDataDir(personal, { codeRoot: packaged, ...fake }));
});

test('importar o store com ORCH_DATA_DIR do app instalado falha antes de criar qualquer arquivo', { skip: !fs.existsSync(path.join(ROOT, '.git')) }, () => {
  const env = { ...process.env, APPDATA: appData, XDG_CONFIG_HOME: appData, HOME: tmp, ORCH_DATA_DIR: process.platform === 'darwin' ? path.join(tmp, 'Library', 'Application Support', 'FORGE', 'data') : personal };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../store.js', import.meta.url).href)})`], { env, encoding: 'utf8', windowsHide: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FORGE DEV recusou/);
  assert.equal(fs.existsSync(env.ORCH_DATA_DIR), false);
});

test('o servidor consome ORCH_DATA_DIR e PORT: os filhos não herdam', () => {
  const env = { ORCH_DATA_DIR: 'x', PORT: '5123', PATH: 'p', ORCH_LIMITS_API: 'off' };
  assert.deepEqual(consumeServerEnv(env), { customDataDir: true, port: 5123 });
  assert.deepEqual(env, { PATH: 'p', ORCH_LIMITS_API: 'off' });
  assert.deepEqual(consumeServerEnv({}), { customDataDir: false, port: null });
});

test('ambiente de desenvolvimento: tira o herdado do app, mantém o resto e as pastas de conta do próprio usuário', () => {
  const env = { ...fake.env, PATH: 'p', ORCH_DATA_DIR: personal, Port: '57469', ORCH_API_TOKEN: 't', FORGE_MCP_TOKEN: 't', CLAUDE_CONFIG_DIR: path.join(personal, 'accounts', 'a'), CODEX_HOME: path.join(tmp, 'meu-codex') };
  assert.deepEqual(cleanDevEnv(env, fake), { ...fake.env, PATH: 'p', CODEX_HOME: path.join(tmp, 'meu-codex') });
  assert.equal(env.ORCH_DATA_DIR, personal, 'não altera o ambiente recebido');
});
