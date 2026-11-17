// Shell no formato do Orca: helpers puros (client/src/forge-shell.js), CSP do iframe do painel Live e o contrato estrutural da interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { elapsed, untilShort, shortPath, glyphTone, stripAnsi, lastLines, detectLocalUrls, safePreviewUrl, urlLabel, eventLabel } from '../../client/src/forge-shell.js';
import { UI_CSP, FRAME_SOURCES } from '../csp.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T12:00:00Z');

test('tempo decorrido e até o reset: compactos, sem inventar valor para instante inválido ou do lado errado', () => {
  assert.equal(elapsed(new Date(NOW - 20_000).toISOString(), NOW), 'agora');
  assert.equal(elapsed(new Date(NOW - 49 * 60_000).toISOString(), NOW), '49m');
  assert.equal(elapsed(new Date(NOW - 3 * 3600_000).toISOString(), NOW), '3h');
  assert.equal(elapsed(new Date(NOW - 2 * 86400_000).toISOString(), NOW), '2d');
  assert.equal(elapsed('lixo', NOW), ''); assert.equal(elapsed(new Date(NOW + 60_000).toISOString(), NOW), '');
  assert.equal(untilShort(new Date(NOW + (2 * 60 + 48) * 60_000).toISOString(), NOW), '2h 48m');
  assert.equal(untilShort(new Date(NOW + (4 * 24 + 6) * 3600_000).toISOString(), NOW), '4d 6h');
  assert.equal(untilShort(new Date(NOW + 35 * 60_000).toISOString(), NOW), '35m');
  assert.equal(untilShort(new Date(NOW - 1).toISOString(), NOW), null); assert.equal(untilShort(undefined, NOW), null);
  assert.equal(shortPath('/Users/dev/projetos/forge-app'), '…/projetos/forge-app'); assert.equal(shortPath('repo'), 'repo');
});

test('glifo de estado: estados do terminal e tons do workspace caem no mesmo vocabulário; desconhecido = ocioso', () => {
  assert.equal(glyphTone('working'), 'work'); assert.equal(glyphTone('work'), 'work'); assert.equal(glyphTone('boot'), 'boot');
  assert.equal(glyphTone('waiting'), 'wait'); assert.equal(glyphTone('done'), 'done'); assert.equal(glyphTone('failed'), 'err'); assert.equal(glyphTone('err'), 'err');
  assert.equal(glyphTone('exited'), 'off'); assert.equal(glyphTone('cancel'), 'off'); assert.equal(glyphTone('???'), 'idle');
});

test('saída do terminal: tira ANSI e moldura da TUI e devolve as últimas linhas com conteúdo, na ordem', () => {
  const out = '\x1b[1m\x1b[38;5;216m✻\x1b[0m Maestro\r\n\x1b]0;título\x07╭────╮\r\n│    │\r\n⏺ Update(src/a.ts)\r\n  ⎿  Updated with 2 additions\r\nbaixando 10%\rbaixando 100%\r\n> \r\n───\r\n';
  assert.equal(stripAnsi('\x1b[31mvermelho\x1b[0m'), 'vermelho');
  assert.deepEqual(lastLines(out, 3), ['Update(src/a.ts)', 'Updated with 2 additions', 'baixando 100%']);
  assert.deepEqual(lastLines(out, 1), ['baixando 100%']);
  assert.deepEqual(lastLines('', 2), []); assert.deepEqual(lastLines('────\n│ │\n', 2), []);
  assert.ok(lastLines('x'.repeat(500), 1, 40)[0].length <= 40);
});

test('URLs locais citadas na saída: só loopback com porta, sem repetição, da mais recente; 0.0.0.0 vira localhost', () => {
  const text = 'VITE ready\n  ➜  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m\nNetwork: http://192.168.0.4:5173/\napi em http://127.0.0.1:3000/health.\nde novo http://localhost:5173/\nlisten http://0.0.0.0:8080';
  assert.deepEqual(detectLocalUrls(text), ['http://localhost:8080', 'http://localhost:5173/', 'http://127.0.0.1:3000/health']);
  assert.deepEqual(detectLocalUrls('veja https://example.com e http://localhost sem porta'), []);
  assert.equal(urlLabel('http://localhost:5173/'), 'localhost:5173'); assert.equal(urlLabel('http://127.0.0.1:3000/admin'), '127.0.0.1:3000/admin');
});

test('preview: o iframe só recebe http(s) em loopback com porta, nunca a porta do próprio FORGE, credenciais ou outro esquema', () => {
  assert.equal(safePreviewUrl('localhost:5173'), 'http://localhost:5173/');
  assert.equal(safePreviewUrl('http://127.0.0.1:3000/app?x=1'), 'http://127.0.0.1:3000/app?x=1');
  assert.equal(safePreviewUrl('https://localhost:8443'), 'https://localhost:8443/');
  assert.equal(safePreviewUrl('http://0.0.0.0:8080'), 'http://localhost:8080/');
  for (const bad of ['http://example.com:80', 'http://localhost', 'javascript:alert(1)', 'file:///etc/passwd', 'http://user:pw@localhost:5173', 'http://192.168.0.4:5173', '', 'ftp://localhost:21', 'http://localhost.evil.com:5173'])
    assert.equal(safePreviewUrl(bad), null, bad);
  assert.equal(safePreviewUrl('http://localhost:4317', ['4317']), null, 'a API do FORGE não abre no painel');
  assert.equal(safePreviewUrl('http://127.0.0.1:5173', ['5173', '4317']), null, 'nem a interface no desenvolvimento');
});

test('eventos do hook do agente viram texto curto; desconhecido = vazio', () => {
  assert.equal(eventLabel('PreToolUse'), 'usando uma ferramenta'); assert.equal(eventLabel('Notification'), 'pediu sua atenção'); assert.equal(eventLabel('Outro'), '');
});

test('CSP da interface: o iframe aceita só loopback e a própria interface continua sem poder ser embutida', () => {
  assert.match(UI_CSP, /default-src 'self'/); assert.match(UI_CSP, /script-src 'self';/); assert.match(UI_CSP, /frame-ancestors 'none'/); assert.match(UI_CSP, /object-src 'none'/);
  const frame = /frame-src ([^;]+);/.exec(UI_CSP)[1].trim().split(/\s+/);
  assert.deepEqual(frame, [...FRAME_SOURCES]);
  for (const s of frame) assert.match(s, /^https?:\/\/(localhost|127\.0\.0\.1):\*$/, `fonte fora do loopback: ${s}`);
  assert.ok(!frame.includes('*') && !frame.some((x) => /^(https?:|data:|blob:)$/.test(x)), 'sem curinga de host nem esquema aberto');
  const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /import \{ UI_CSP \} from '\.\/csp\.js'/); assert.match(index, /res\.setHeader\('X-Frame-Options', 'DENY'\)/);
});

test('shell: barra lateral com marca, busca, navegação e workspaces com terminais aninhados; barra de status embaixo; painel Live no Cockpit', () => {
  const app = src('App.jsx'), sb = src('components/Sidebar.jsx'), cockpit = src('pages/Cockpit.jsx'), grid = src('components/TerminalGrid.jsx'), live = src('components/LivePanel.jsx'), bar = src('components/StatusBar.jsx');
  assert.match(app, /<StatusBar /); assert.match(app, /<Sidebar \{\.\.\.side\}/); assert.ok(!/Topbar/.test(app), 'sem a barra superior antiga: a navegação mora na barra lateral');
  assert.ok(!fs.existsSync(new URL('../../client/src/components/Topbar.jsx', import.meta.url)));
  assert.match(sb, /className="fx-brand"><span className="fx-brand-mark" aria-hidden="true" dangerouslySetInnerHTML=\{\{ __html: BRAND \}\} \/>Forge</); assert.match(sb, /placeholder="Buscar"/); assert.match(sb, /⌘K/);
  for (const label of ['Início', 'Missões', 'Terminais', 'Sessões']) assert.match(sb, new RegExp(`label="${label}"`));
  assert.match(sb, /<TermRow /, 'os terminais aparecem dentro do cartão do workspace'); assert.match(sb, /onPick=\{pick\}/);
  assert.match(cockpit, /<LivePanel stream=\{stream\}/); assert.match(cockpit, /createTerminalStream\(\)/, 'uma conexão SSE para a grade e o painel');
  assert.match(grid, /stream: shared = null/); assert.match(grid, /className="fx-tabs" role="tablist"/);
  assert.match(live, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"/); assert.match(live, /referrerPolicy="no-referrer"/);
  assert.match(live, /safePreviewUrl\(/, 'o iframe só recebe URL validada'); assert.ok(!/allow-top-navigation/.test(live), 'o preview não navega a janela do FORGE');
  assert.match(bar, /untilShort\(/); assert.match(bar, /<ProviderPanel /);
});

test('identidade: tokens neutros (sem cor de marca nem por papel), glifos animados que respeitam "Animações reduzidas" e mascotes só nas Configurações', () => {
  const css = src('forge.css'), main = src('main.jsx'), grid = src('components/TerminalGrid.jsx'), home = src('pages/Home.jsx');
  assert.ok(main.trim().split('\n').filter((l) => l.startsWith("import './")).at(-1).includes('forge.css'), 'forge.css é a última camada');
  const roles = /--c-builder: (#[0-9a-f]{6}); --c-pilot: (#[0-9a-f]{6}); --c-review: (#[0-9a-f]{6}); --c-scout: (#[0-9a-f]{6}); --c-tower: (#[0-9a-f]{6});/i.exec(css);
  assert.ok(roles && new Set(roles.slice(1)).size === 1, 'todos os papéis no mesmo cinza');
  assert.match(css, /\.tc-m, \.sh-row, \.td-card[^{]*\{ --role: #8a8a8a !important; \}/, 'a cor do papel inline é neutralizada');
  assert.match(css, /--bone: #e9e9e9; --bone-hover: #ffffff; --ink: #141414;/, 'ação primária neutra, texto escuro');
  for (const k of ['fx-spin', 'fx-breathe', 'fx-pop', 'fx-draw']) assert.match(css, new RegExp(`@keyframes ${k} `));
  assert.match(css, /html\[data-motion="reduced"\] \.fx-app \*/); assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(!/variant="mascot"/.test(grid), 'o cabeçalho do terminal usa a logo, não o mascote'); assert.ok(!/ForgeMascot/.test(home), 'o Início sem mascote');
  assert.match(src('pages/Settings.jsx'), /mascotes: <MascotsSection \/>/, 'os mascotes continuam nas Configurações');
});
