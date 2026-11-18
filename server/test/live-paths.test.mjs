// Caminhos do preview do painel Live (server/live-paths.js): puro + pickDocroot com pastas temporárias. Nada toca o banco real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeRequestPath, segmentProblem, isReservedWindowsName, isSensitiveName, MIME, mimeOf, extOf, pickDocroot, DOCROOT_CANDIDATES } from '../live-paths.js';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-livepaths-')));
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const refused = (t) => { const r = decodeRequestPath(t); assert.equal(r.ok, false, `deveria recusar ${t}`); return r; };

test('caminhos permitidos viram segmentos (raiz, subpastas, barra final, consulta descartada)', () => {
  assert.deepEqual(decodeRequestPath('/'), { ok: true, segments: [], dir: true });
  assert.deepEqual(decodeRequestPath('/a/b.css'), { ok: true, segments: ['a', 'b.css'], dir: false });
  assert.deepEqual(decodeRequestPath('/assets/logo.svg'), { ok: true, segments: ['assets', 'logo.svg'], dir: false });
  assert.deepEqual(decodeRequestPath('/data/products.json'), { ok: true, segments: ['data', 'products.json'], dir: false });
  assert.deepEqual(decodeRequestPath('/sub/'), { ok: true, segments: ['sub'], dir: true });
  assert.deepEqual(decodeRequestPath('/index.html?x=1&y=../..'), { ok: true, segments: ['index.html'], dir: false }, 'a consulta nunca vira caminho');
  assert.deepEqual(decodeRequestPath('/caf%C3%A9/p%C3%A1gina.html'), { ok: true, segments: ['café', 'página.html'], dir: false }, 'acento decodificado UMA vez');
  assert.deepEqual(decodeRequestPath('/meu%20arquivo.css').segments, ['meu arquivo.css']);
});

test('travessia e disfarces: nunca viram caminho (404 genérico; só %-inválido e alvo não relativo dão 400)', () => {
  for (const t of ['/..', '/../x', '/%2e%2e', '/%2e%2e/%2e%2e/x', '/%2e%2e%2f', '/..%5c', '/..%5cx', '/a/../../x', '/a/./b', '/.', '//etc/passwd', '/a//b', '/a//',
    '/%00', '/a%00.css', '/a\\b.css', '/%5c', '/C:\\x', '/C%3A%5Cx', '/a:b', '/a%3Ab', '/index.html::$DATA', '/index.html:x', '/index.html::%24DATA',
    '/con', '/CON', '/NUL.txt', '/nul.txt', '/com1.html', '/COM9.css', '/lpt1', '/aux', '/prn.js', '/a/aux.txt', '/index.html.', '/index.html%20', '/index.html ', '/a./b.css', '/GIT~1', '/a/GIT~1/x.css', '/PROGRA~1/x.css',
    '/.git/config', '/.GIT/config', '/.git./config', '/a/.git/HEAD', '/.env', '/.well-known/x', '/a/.hidden.css', '/node_modules/x.js', '/NODE_MODULES/x.js', '/a/node_modules/x.js',
    '/%252e%252e', '/%252e%252e/x', '/a%252fb.css', '/a%2fb.css', '/a%2Fb.css', '/%2e', '/%2E%2E/x', '/a%3Fb.css', '/a*.css', '/a%2Ab.css', '/a<b>.css', '/a%22b.css', '/a%7Cb.css',
    '/package.json', '/package-lock.json', '/tsconfig.json', '/tsconfig.app.json', '/secrets.json', '/api-token.js', '/credentials.txt', '/my-password.txt', '/id_rsa.txt', '/cert.pem', '/server.key', '/a.pfx', '/a.p12', '/settings.json', '/config.json', '/Config.JSON', '/config.local.json', '/appsettings.json', '/appsettings.Production.json', '/configuration.json', '/key.txt', '/KEY.pem', '/a/key', '/a/settings.json']) refused(t);
  // nomes exatos: parecidos continuam servíveis
  for (const t of ['/config.css', '/settings.html', '/config.js', '/settings-panel.json', '/keyboard.js', '/monkey.png', '/keys.css', '/my-config.json', '/data/config-data.json']) assert.equal(decodeRequestPath(t).ok, true, `deveria permitir ${t}`);
  assert.equal(refused('/%zz').status, 400, '%-inválido');
  assert.equal(refused('/%E0%A4%A').status, 400, 'UTF-8 truncado');
  assert.equal(refused('/%ff').status, 400, 'UTF-8 inválido');
  assert.equal(refused('http://127.0.0.1:1/x').status, 400, 'forma absoluta');
  assert.equal(refused('*').status, 400);
  assert.equal(refused('x/y').status, 400, 'não começa com /');
  assert.equal(refused('').status, 400);
  assert.equal(refused('/../x').status, 404, 'o resto é 404 genérico');
});

test('limites: segmento > 255, caminho > 1024, profundidade > 20 (e os limites exatos passam)', () => {
  refused(`/${'a'.repeat(256)}.css`);
  assert.equal(decodeRequestPath(`/${'a'.repeat(251)}.css`).ok, true, '255 exatos');
  refused(`/${Array.from({ length: 12 }, () => 'a'.repeat(100)).join('/')}/x.css`);
  refused(`/${Array.from({ length: 21 }, () => 'd').join('/')}/x.css`);
  assert.equal(decodeRequestPath(`/${Array.from({ length: 19 }, () => 'd').join('/')}/x.css`).ok, true, '20 segmentos');
  refused(`/${'%41'.repeat(2000)}`);
});

test('segmentProblem e isReservedWindowsName: motivos e bordas', () => {
  for (const n of ['con', 'CON', 'Prn', 'aux', 'NUL', 'com1', 'COM9', 'lpt1', 'LPT9', 'nul.txt', 'com1.html', 'con.tar.gz', 'COM\u00b9', 'conin$']) assert.equal(isReservedWindowsName(n), true, n);
  for (const n of ['com', 'com0', 'com10', 'console.js', 'icon.svg', 'nullable.js', 'lpt', 'x.con', 'index.html']) assert.equal(isReservedWindowsName(n), false, n);
  assert.equal(segmentProblem('index.html'), null); assert.equal(segmentProblem('Logo-2x.PNG'), null); assert.equal(segmentProblem('meu arquivo.css'), null); assert.equal(segmentProblem('a.b.c.js'), null);
  assert.equal(segmentProblem(''), 'vazio'); assert.equal(segmentProblem('..'), 'ponto'); assert.equal(segmentProblem('.x'), 'oculto'); assert.equal(segmentProblem('a\u0001b'), 'controle');
  assert.equal(segmentProblem('x.'), 'final'); assert.equal(segmentProblem('x '), 'final'); assert.equal(segmentProblem('a~1.txt'), 'nome-curto');
  assert.equal(segmentProblem('Node_Modules'), 'node_modules'); assert.equal(segmentProblem('git~1'), 'nome-curto');
  assert.equal(segmentProblem(42), 'vazio');
});

test('isSensitiveName: segredos e configuração por NOME', () => {
  for (const n of ['package.json', 'package-lock.json', 'PACKAGE.JSON', 'tsconfig.json', 'tsconfig.base.json', 'secret.txt', 'client_secret.json', 'aws-credentials', 'token.js', 'passwords.txt', 'passwd', 'private.css', 'id_rsa', 'a.pem', 'a.KEY', 'a.pfx', 'a.p12', 'settings.json', 'config.json', 'CONFIG.JSON', 'config.local.json', 'appsettings.Development.json', 'key', 'key.txt', 'KEY.PNG']) assert.equal(isSensitiveName(n), true, n);
  for (const n of ['index.html', 'style.css', 'products.json', 'logo.svg', 'app.js', 'data.json', 'config.css', 'settings.html', 'keyboard.js', 'monkey.png', 'my-config.json', 'config.yaml']) assert.equal(isSensitiveName(n), false, n);
});

test('MIME: lista fechada (sem vídeo/áudio), extensão decidida em minúscula', () => {
  assert.deepEqual(Object.keys(MIME).sort(), ['avif', 'css', 'woff', 'woff2', 'gif', 'htm', 'html', 'ico', 'jpeg', 'jpg', 'js', 'json', 'mjs', 'otf', 'png', 'svg', 'ttf', 'txt', 'webmanifest', 'webp'].sort());
  assert.equal(mimeOf('a.HTML'), 'text/html; charset=utf-8'); assert.equal(mimeOf('a.js'), 'text/javascript; charset=utf-8'); assert.equal(mimeOf('a.png'), 'image/png');
  for (const n of ['a.mp4', 'a.mp3', 'a.exe', 'a.php', 'a.map', 'a.md', 'a', '.html', 'a.html.bak', 'a.toString', 'a.__proto__', 'a.constructor']) assert.equal(mimeOf(n), null, n);
  assert.equal(extOf('a.tar.GZ'), 'gz'); assert.equal(extOf('semext'), '');
});

test('pickDocroot: precedência . > site > public > docs > dist > www; sem index.html => null; devolve só o relativo e o real', () => {
  assert.deepEqual([...DOCROOT_CANDIDATES], ['.', 'site', 'public', 'docs', 'dist', 'www']);
  const ws = path.join(tmp, 'ws1'); fs.mkdirSync(ws);
  assert.equal(pickDocroot(ws), null, 'vazio');
  assert.equal(pickDocroot(path.join(tmp, 'nao-existe')), null); assert.equal(pickDocroot(''), null); assert.equal(pickDocroot(undefined), null);
  fs.mkdirSync(path.join(ws, 'www')); fs.writeFileSync(path.join(ws, 'www', 'index.html'), 'w');
  assert.equal(pickDocroot(ws).rel, 'www');
  fs.mkdirSync(path.join(ws, 'docs')); fs.writeFileSync(path.join(ws, 'docs', 'index.html'), 'd'); assert.equal(pickDocroot(ws).rel, 'docs');
  fs.mkdirSync(path.join(ws, 'site')); fs.writeFileSync(path.join(ws, 'site', 'index.html'), 's'); assert.equal(pickDocroot(ws).rel, 'site');
  fs.writeFileSync(path.join(ws, 'index.html'), 'r'); const r = pickDocroot(ws);
  assert.equal(r.rel, '.'); assert.equal(r.real, fs.realpathSync.native(ws)); assert.equal(r.realWorkspace, fs.realpathSync.native(ws));
  fs.rmSync(path.join(ws, 'index.html'));
  fs.mkdirSync(path.join(ws, 'public', 'index.html'), { recursive: true }); // index.html que é pasta não conta
  assert.equal(pickDocroot(ws).rel, 'site');
});

test('pickDocroot recusa docroot/index.html que seja link ou junção para fora (ou para dentro), e docroot dentro da pasta de dados', (t) => {
  const outside = path.join(tmp, 'fora'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'index.html'), 'fora');
  const ws = path.join(tmp, 'ws2'); fs.mkdirSync(ws);
  try { fs.symlinkSync(outside, path.join(ws, 'site'), 'junction'); } catch (e) { t.skip(`sem permissão para junção/symlink de diretório (${e.code}): teste de link não executado`); return; }
  assert.equal(pickDocroot(ws), null, 'site é junção para fora: recusada');
  fs.rmSync(path.join(ws, 'site'), { recursive: true, force: true });
  // index.html como link de arquivo
  fs.mkdirSync(path.join(ws, 'public')); fs.writeFileSync(path.join(ws, 'public', 'real.html'), 'x');
  try { fs.symlinkSync(path.join(outside, 'index.html'), path.join(ws, 'public', 'index.html'), 'file'); assert.equal(pickDocroot(ws), null, 'index.html é link: recusado'); }
  catch (e) { console.warn(`[aviso] symlink de arquivo indisponível (${e.code}): parte do teste pulada`); }
  // docroot dentro da pasta de dados
  const wd = path.join(tmp, 'ws3'); fs.mkdirSync(path.join(wd, 'data'), { recursive: true }); fs.writeFileSync(path.join(wd, 'data', 'index.html'), 'x'); fs.writeFileSync(path.join(wd, 'index.html'), 'y');
  assert.equal(pickDocroot(wd, { dataReal: path.join(wd, 'data') }).rel, '.', 'a raiz do workspace segue valendo (os arquivos de data/ são recusados um a um)');
  const dd = path.join(tmp, 'ws4'); fs.mkdirSync(path.join(dd, 'site'), { recursive: true }); fs.writeFileSync(path.join(dd, 'site', 'index.html'), 'z');
  assert.equal(pickDocroot(dd, { dataReal: path.join(dd, 'site') }), null, 'docroot dentro da pasta de dados: recusado');
});
