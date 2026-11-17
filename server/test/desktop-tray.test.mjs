// Barra de menus / área de notificação, consumo da máquina, captura de tela, soltar arquivos no terminal, logo, cena e instaladores.
// Só partes puras e contratos estáticos: o Electron em si não roda aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { quotePath, dropText } from '../../client/src/forge-shell.js';
import { logoSvg, appIconSvg } from '../../client/src/forge-logo.mjs';
import { drawScene, W, H, STRIKE_MS } from '../../client/src/forge-scene.js';

const require = createRequire(import.meta.url);
const DESK = new URL('../../desktop/', import.meta.url);
const M = require('../../desktop/metrics.cjs'), CAP = require('../../desktop/capture.cjs'), T = require('../../desktop/tray.cjs');
const read = (rel) => fs.readFileSync(new URL(rel, DESK), 'utf8');
const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('consumo: CPU entre duas amostras, RAM pelo disponível e GPU pelas ferramentas do sistema; sem leitura = null (nunca um número inventado)', () => {
  const s = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.equal(M.cpuPercent([s(100, 900), s(100, 900)], [s(150, 950), s(200, 900)]), 75, 'núcleo 1: 50 ocupados de 100; núcleo 2: 100 de 100 => 150 de 200');
  assert.equal(M.cpuPercent([s(1, 1)], [s(1, 1)]), null, 'sem tempo decorrido'); assert.equal(M.cpuPercent([], []), null); assert.equal(M.cpuPercent([s(1, 1)], [s(1, 1), s(2, 2)]), null);
  assert.equal(M.ramPercent({ total: 1000, free: 100, available: 400 }), 60, 'no macOS vale o disponível (inclui cache)'); assert.equal(M.ramPercent({ total: 1000, free: 250 }), 75); assert.equal(M.ramPercent({ total: 0, free: 1 }), null);
  assert.equal(M.parseIoreg('"PerformanceStatistics" = {"Device Utilization %"=37,"Renderer Utilization %"=12}\n{"Device Utilization %"=5}'), 37, 'a maior das GPUs');
  assert.equal(M.parseIoreg('nada aqui'), null); assert.equal(M.parseIoreg('"Device Utilization %"=900'), null);
  assert.equal(M.parseNvidiaSmi('12\n47\n'), 47); assert.equal(M.parseNvidiaSmi('NVIDIA-SMI has failed'), null); assert.equal(M.parseBusyPercent('83\n'), 83); assert.equal(M.parseBusyPercent('x'), null);
  assert.equal(M.metricsLine({ cpu: 23, ram: 61, gpu: null }), 'CPU 23% · RAM 61% · GPU —');
});

test('bandeja: agentes trabalhando pela regra dos hooks, título curto da barra de menus (só a CPU, desligável) e a linha de estado', () => {
  const ss = [{ status: 'running', agent: { state: 'running' } }, { status: 'running', agent: { state: 'waiting' } }, { status: 'running', agent: { state: 'idle' } }, { status: 'exited', agent: { state: 'running' } }];
  assert.deepEqual(T.agentCounts(ss), { running: 3, working: 1, waiting: 1 }); assert.deepEqual(T.agentCounts(null), { running: 0, working: 0, waiting: 0 });
  assert.equal(T.menuBarTitle({ cpu: 7 }), '  7%'); assert.equal(T.menuBarTitle({ cpu: 7 }, false), ''); assert.equal(T.menuBarTitle({ cpu: null }), '');
  assert.equal(T.statusLine({ working: 2, waiting: 1, running: 3 }), '2 agentes trabalhando · 1 aguardando você');
  assert.equal(T.statusLine({ working: 0, waiting: 0, running: 0 }), 'Nenhum terminal aberto');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tray-')), 'p.json');
  assert.deepEqual(T.readPrefs(f), { cpuInMenuBar: true }, 'sem arquivo: CPU ligada'); fs.writeFileSync(f, '{"cpuInMenuBar":false}'); assert.deepEqual(T.readPrefs(f), { cpuInMenuBar: false }); fs.writeFileSync(f, 'lixo'); assert.deepEqual(T.readPrefs(f), { cpuInMenuBar: true });
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
  const tray = read('tray.cjs');
  assert.match(tray, /setTemplateImage\(true\)/, 'macOS: ícone template (o sistema inverte no tema escuro)'); assert.match(tray, /setProgressBar\(on \? 2 : -1, \{ mode: on \? 'indeterminate' : 'none' \}\)/, 'Windows/Linux: animação nativa na barra de tarefas');
  assert.match(tray, /'x-orch-token'|api\(/); for (const item of ['Capturar área da tela…', 'Capturar tela inteira', 'Workspaces', 'Sair do Forge']) assert.ok(tray.includes(item), item);
});

test('captura: nome ordenável sem colisão, poda só os arquivos do FORGE, ferramentas nativas por execFile (sem shell) e miniatura que só fala com o processo principal por 4 mensagens conferidas', () => {
  assert.equal(CAP.captureName(new Date(2026, 10, 17, 9, 5, 3, 7)), 'forge-20261117-090503-007.png'); assert.match(CAP.captureName(), CAP.NAME_RE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cap-'));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `forge-2026111${i}-000000-000.png`), 'x');
  fs.writeFileSync(path.join(dir, 'meu-arquivo.png'), 'x');
  assert.equal(CAP.prune(dir, 2), 3); assert.deepEqual(fs.readdirSync(dir).sort(), ['forge-20261113-000000-000.png', 'forge-20261114-000000-000.png', 'meu-arquivo.png'], 'as mais novas ficam; o que não é do FORGE não é tocado');
  fs.rmSync(dir, { recursive: true, force: true });
  const cap = read('capture.cjs');
  assert.ok(!/exec\(|shell:\s*true|spawn\(/.test(cap), 'sem shell'); assert.match(cap, /execFile\('screencapture', \['-i', '-x', '-t', 'png', file\]\)|run\('screencapture', \['-i', '-x', '-t', 'png', file\]\)/);
  assert.match(cap, /if \(e\.sender === card\.webContents\) fn\(\)/, 'só a própria miniatura pede para arrastar'); assert.match(cap, /startDrag\(\{ file, icon/);
  assert.match(cap, /contextIsolation: true, sandbox: true, nodeIntegration: false/); assert.match(CAP.cardHtml('data:image/png;base64,AAAA'), /Content-Security-Policy" content="default-src 'none'/);
  const pre = read('capture-preload.cjs'); assert.match(pre, /exposeInMainWorld\('forgeCapture'/); assert.ok(!/require\('node:|child_process|\bfs\b/.test(pre));
  const main = read('main.cjs'); assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+2'/); assert.match(main, /globalShortcut\.unregisterAll\(\)/); assert.match(main, /'x-orch-token': API_TOKEN/);
  assert.match(main, /\/\^#\\\/\[a-z\]\+\$\/\.test\(hash\)/, 'a bandeja só navega para rotas fixas da interface');
});

test('soltar arquivos num terminal: caminho com espaço entre aspas (simples no macOS/Linux, duplas no Windows) e o preload só revela o caminho do que foi solto', () => {
  assert.equal(quotePath('/Users/ana/cap.png'), '/Users/ana/cap.png');
  assert.equal(quotePath('/Users/ana/Captura de Tela.png'), "'/Users/ana/Captura de Tela.png'");
  assert.equal(quotePath("/tmp/it's.png"), "'/tmp/it'\\''s.png'");
  assert.equal(quotePath('C:\\Users\\Ana\\Minha captura.png', 'win32'), '"C:\\Users\\Ana\\Minha captura.png"');
  assert.equal(dropText(['/a.png', '/b c.png']), "/a.png '/b c.png' "); assert.equal(dropText([]), ''); assert.equal(dropText(['']), '');
  const grid = src('components/TerminalGrid.jsx');
  assert.match(grid, /desk\?\.pathForFile\?\.\(f\)/); assert.match(grid, /api\.post\(`\/api\/terminals\/\$\{id\}\/input`, \{ data: dropText\(paths, desk\?\.platform\) \}\)/, 'pela mesma rota de entrada do terminal');
  assert.match(grid, /o navegador não revela o caminho/, 'no navegador avisa em vez de falhar calado');
});

test('logo (traço do esboço) e cena (pixel art original): SVG sem script nem referência externa; cena determinística e com animação', () => {
  for (const svg of [logoSvg(), logoSvg({ variant: 'mark' }), logoSvg({ variant: 'glyph', steam: { dy: 2, opacity: 0.5 } }), appIconSvg({ size: 64 }), appIconSvg({ size: 1024, platform: 'mac' })]) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/); assert.ok(!/<script|href=|on[a-z]+=/i.test(svg), 'SVG inerte');
  }
  assert.match(logoSvg({ variant: 'mark', steam: { dy: 3, opacity: 0.4 } }), /<g transform="translate\(0 -3\)" opacity="0.4">/, 'o vapor anda nos quadros da bandeja');
  // contexto falso: conta as chamadas e o que foi pintado
  const fake = () => { const calls = []; return { calls, set fillStyle(v) { calls.push(v); }, get fillStyle() { return ''; }, fillRect(x, y, w, h) { calls.push([x, y, w, h]); } }; };
  const a = fake(), b = fake(), c = fake(); drawScene(a, 1000); drawScene(b, 1000); drawScene(c, 1000 + STRIKE_MS * 0.5);
  assert.deepEqual(a.calls, b.calls, 'mesmo instante = mesmo quadro'); assert.notDeepEqual(a.calls, c.calls, 'o martelo e as partículas se movem');
  assert.equal(W / H, 1.5); assert.ok(a.calls.length > 1000);
  assert.match(src('forge-scene.js'), /ARTE ORIGINAL do FORGE/);
});

test('instaladores: NSIS com lateral, cabeçalho e ícones; .dmg com fundo e posições; Linux em AppImage e .deb; nome técnico FORGE preservado (instalações e atualizações existentes)', () => {
  const c = JSON.parse(read('electron-builder.json'));
  assert.equal(c.productName, 'FORGE'); assert.equal(c.nsis.shortcutName, 'FORGE');
  for (const k of ['installerSidebar', 'uninstallerSidebar', 'installerHeader', 'installerIcon']) assert.ok(fs.existsSync(new URL(c.nsis[k], DESK)), `${k}: ${c.nsis[k]}`);
  assert.ok(fs.existsSync(new URL(c.dmg.background, DESK))); assert.deepEqual(c.dmg.window, { width: 660, height: 400 }); assert.equal(c.dmg.contents.find((x) => x.type === 'link').path, '/Applications');
  assert.deepEqual(c.linux.target.map((t) => t.target), ['AppImage', 'deb']); assert.ok(fs.existsSync(new URL('build/icons/512x512.png', DESK)));
  for (const f of ['tray.cjs', 'metrics.cjs', 'capture.cjs', 'capture-preload.cjs']) assert.ok(c.files.includes(f), `${f} no pacote`);
  assert.ok(c.extraResources.some((r) => r.from === 'build/tray' && r.to === 'tray'), 'ícones da bandeja no pacote');
  // BMP 24 bits nos tamanhos que o NSIS exige
  for (const [f, w, h] of [['build/installerSidebar.bmp', 164, 314], ['build/installerHeader.bmp', 150, 57]]) {
    const b = fs.readFileSync(new URL(f, DESK)); assert.equal(b.toString('ascii', 0, 2), 'BM'); assert.equal(b.readInt32LE(18), w); assert.equal(b.readInt32LE(22), h); assert.equal(b.readUInt16LE(28), 24, `${f}: 24 bits`);
  }
  for (const n of ['trayTemplate.png', 'trayTemplate@2x.png', 'tray.png', 'trayTemplate-work-5@2x.png', 'tray-work-0.png']) assert.ok(fs.existsSync(new URL(`build/tray/${n}`, DESK)), n);
  assert.equal(fs.readFileSync(new URL('build/icon.ico', DESK)).readUInt16LE(4), 7, 'ICO com 7 tamanhos');
  assert.match(read('package.json'), /"art": "node scripts\/make-icon\.mjs"/); assert.match(read('scripts/make-icon.mjs'), /FORGE_ART_BROWSER/, 'roda em qualquer sistema com um Chromium');
});

test('setup do primeiro uso: aparece só depois de ler as preferências do servidor, usa a cena animada, grava setupDone ao concluir ou pular e pode ser refeito', () => {
  const app = src('App.jsx'), setup = src('pages/Setup.jsx');
  assert.match(app, /const showSetup = prefs\.setupDone !== true && ui\.status\.state !== 'loading'/); assert.match(app, /suspended=\{!!dialog \|\| view === 'settings' \|\| showSetup\}/, 'o aviso de pré-requisitos não briga com o setup');
  assert.match(setup, /mountScene\(ref\.current, \{ reduced \}\)/); assert.match(setup, /setPref\('setupDone', true\)/); assert.match(setup, /Pular o setup/);
  for (const s of ['welcome', 'tools', 'account', 'workspace', 'done']) assert.match(setup, new RegExp(`id: '${s}'`));
  assert.match(setup, /<AccountsPanel \/>/, 'a conta conecta pelo fluxo real de Configurações > Contas');
  assert.match(src('components/settings/AppSections.jsx'), /setPref\('setupDone', false\)/);
  assert.match(app, /window\.addEventListener\('hashchange', on\)/, 'o menu da bandeja troca a página');
});
