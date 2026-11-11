// Robustez do app desktop: trava após taskkill, rotação do log, menu Ajuda e política de reinício. Só diretórios temporários.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { removeLockIfOwned } = require('../../desktop/lock-cleanup.cjs');
const { rotateIfNeeded, createLogWriter } = require('../../desktop/log-rotate.cjs');
const { createRestartPolicy } = require('../../desktop/restart-policy.cjs');
const { buildMenuTemplate, diagnosticText } = require('../../desktop/menu.cjs');

const roots = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-desk-')); roots.push(d); return d; };
after(() => { for (const d of roots) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

test('trava: do pid encerrado é removida', () => {
  const d = mk(); fs.writeFileSync(path.join(d, 'server.lock'), JSON.stringify({ pid: 111, token: 't' }));
  assert.equal(removeLockIfOwned({ dir: d, pid: 111 }).removed, true);
  assert.equal(fs.existsSync(path.join(d, 'server.lock')), false);
});
test('trava: de outro pid não é removida', () => {
  const d = mk(); fs.writeFileSync(path.join(d, 'server.lock'), JSON.stringify({ pid: 222, token: 't' }));
  assert.equal(removeLockIfOwned({ dir: d, pid: 111 }).reason, 'other-owner');
  assert.equal(fs.existsSync(path.join(d, 'server.lock')), true);
});
test('trava: ausente, ilegível e entrada inválida não lançam', () => {
  const d = mk();
  assert.equal(removeLockIfOwned({ dir: d, pid: 1 }).reason, 'missing');
  fs.writeFileSync(path.join(d, 'server.lock'), '{lixo');
  assert.equal(removeLockIfOwned({ dir: d, pid: 1 }).removed, false);
  assert.equal(fs.existsSync(path.join(d, 'server.lock')), true);
  assert.equal(removeLockIfOwned({ dir: d, pid: 'x' }).removed, false);
  assert.equal(removeLockIfOwned({}).removed, false);
});

test('log: abaixo do limite não rotaciona; acima rotaciona com no máximo 2 backups', () => {
  const d = mk(), f = path.join(d, 'server.log');
  fs.writeFileSync(f, 'abc');
  assert.equal(rotateIfNeeded({ file: f, maxBytes: 10 }), false);
  for (const n of ['A', 'B', 'C']) { fs.writeFileSync(f, n.repeat(20)); assert.equal(rotateIfNeeded({ file: f, maxBytes: 10 }), true); }
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.readFileSync(`${f}.1`, 'utf8'), 'C'.repeat(20));
  assert.equal(fs.readFileSync(`${f}.2`, 'utf8'), 'B'.repeat(20)); // o "A" foi descartado
  assert.equal(fs.existsSync(`${f}.3`), false);
});
test('log: gravador rotaciona durante as gravações e não lança sem diretório', () => {
  const d = mk(), f = path.join(d, 'server.log');
  const w = createLogWriter({ file: f, maxBytes: 50, checkEvery: 2 });
  for (let i = 0; i < 10; i++) w.write(`linha ${i} `.padEnd(30, 'x'));
  assert.ok(fs.existsSync(`${f}.1`));
  assert.equal(createLogWriter({ file: path.join(d, 'nao', 'existe', 'x.log') }).write('a'), false);
  assert.equal(createLogWriter({ file: path.join(d, 'nao', 'x.log') }).check(), false);
});

test('reinício: 3 permitidos em 2 min, o 4º desiste; a janela deslizante libera de novo', () => {
  let t = 0; const p = createRestartPolicy({ now: () => t });
  assert.deepEqual([p.decide().restart, p.decide().restart, p.decide().restart, p.decide().restart], [true, true, true, false]);
  t = 119999; assert.equal(p.decide().restart, false);
  t = 120001; assert.equal(p.decide().restart, true);
});

const fakeApp = { getName: () => 'FORGE', getVersion: () => '9.9.9' };
function build(platform) {
  const calls = [];
  const tpl = buildMenuTemplate({ app: fakeApp, platform, logsDir: 'C:\logs', dataDir: 'C:\dados', osRelease: '10.0', arch: 'x64', versions: { electron: '1.2.3', node: '4.5.6', chrome: '7' },
    shell: { openPath: (p) => calls.push(['open', p]) }, clipboard: { writeText: (t) => calls.push(['copy', t]) }, dialog: { showMessageBox: (w, o) => calls.push(['box', o]) } });
  return { tpl, calls };
}
test('menu: Windows tem Ajuda com as 3 ações e preserva Editar', () => {
  const { tpl, calls } = build('win32');
  assert.ok(tpl.some((m) => m.role === 'editMenu'));
  const help = tpl.find((m) => m.label === 'Ajuda'), item = (l) => help.submenu.find((i) => i.label === l);
  item('Abrir pasta de logs').click(); item('Copiar informações de diagnóstico').click(); item('Sobre o FORGE').click();
  assert.deepEqual(calls[0], ['open', 'C:\logs']);
  assert.match(calls[1][1], /FORGE 9\.9\.9/); assert.match(calls[1][1], /Electron 1\.2\.3 \(Node embutido 4\.5\.6/);
  assert.match(calls[2][1].message, /9\.9\.9/);
});
test('menu: macOS mantém appMenu/editMenu/windowMenu e acrescenta Ajuda', () => {
  const { tpl } = build('darwin');
  assert.deepEqual(tpl.slice(0, 3).map((m) => m.role), ['appMenu', 'editMenu', 'windowMenu']);
  assert.equal(tpl[3].label, 'Ajuda');
});
test('diagnóstico: sem token, ambiente nem workspaces', () => {
  process.env.ORCH_API_TOKEN = 'SEGREDO-123';
  const t = diagnosticText({ app: fakeApp, logsDir: 'L', dataDir: 'D' });
  delete process.env.ORCH_API_TOKEN;
  assert.ok(!t.includes('SEGREDO-123')); assert.ok(!/token|workspace/i.test(t));
  assert.equal(t.split('\n').length, 5);
});

test('módulos novos estão em electron-builder.json files', () => {
  const files = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../desktop/electron-builder.json'), 'utf8')).files;
  for (const f of ['lock-cleanup.cjs', 'log-rotate.cjs', 'restart-policy.cjs', 'menu.cjs', 'mac-env.cjs', 'preload.cjs']) assert.ok(files.includes(f), f);
});
