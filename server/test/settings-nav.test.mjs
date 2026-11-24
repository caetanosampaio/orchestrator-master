// Navegação da página de Configurações (client/src/settings-nav.js) e catálogo de IAs (client/src/provider-catalog.js): lógica pura e a ligação das seções. Sem rede e sem banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NAV, ALIASES, DEFAULT_TAB, flatItems, itemById, resolveTab, filterNav } from '../../client/src/settings-nav.js';
import { CATALOG, FORGE_MASCOT, catalogById, catalogColor, integratedIds, plannedAis, aiName, aiShortName } from '../../client/src/provider-catalog.js';
import { providerColor } from '../../client/src/provider-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('navegação: três grupos, ids únicos, cada seção com rótulo, ícone e frase de apoio; as seções que outras telas abrem continuam existindo', () => {
  assert.deepEqual(NAV.map((g) => g.label), ['IAs e contas', 'Missões e times', 'App e computador']);
  const items = flatItems(); assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) assert.ok(i.label && i.icon && i.hint, i.id);
  assert.equal(itemById('equipes').label, 'Times prontos'); assert.equal(itemById('equipes').tag, 'Squads');
  for (const id of ['orquestracao', 'accounts', 'equipes', 'ias', 'golem', 'perfil']) assert.ok(itemById(id), id); // abertas por TerminalGrid, MaestroPopover, PrereqModal e pelos links
  assert.equal(DEFAULT_TAB, 'perfil');
});

test('resolveTab: nomes antigos (cli, providers) levam a Suas IAs; desconhecido ou não-texto cai no padrão', () => {
  assert.equal(resolveTab('cli'), 'ias'); assert.equal(resolveTab('providers'), 'ias'); assert.equal(resolveTab('equipes'), 'equipes');
  for (const bad of ['x', '', null, undefined, 7, { id: 'ias' }, '__proto__', 'constructor']) assert.equal(resolveTab(bad), 'perfil');
  assert.equal(resolveTab('nao-existe', 'ias'), 'ias'); assert.deepEqual(Object.keys(ALIASES).sort(), ['bichinho', 'cli', 'mascotes', 'providers']);
  assert.equal(resolveTab('mascotes'), 'golem', 'o link antigo dos mascotes abre o Golem'); assert.equal(resolveTab('bichinho'), 'golem');
});

test('busca: por nome, descrição ou palavra-chave, sem diferenciar maiúsculas nem acentos; grupo sem resultado some; vazio = tudo', () => {
  assert.equal(filterNav(''), NAV); assert.equal(filterNav('   '), NAV);
  assert.deepEqual(filterNav('MAESTRO').flatMap((g) => g.items.map((i) => i.id)), ['tarefas', 'orquestracao']);
  assert.ok(filterNav('esforco').flatMap((g) => g.items.map((i) => i.id)).includes('equipes'), 'sem acento acha "esforço"');
  assert.ok(filterNav('codex').flatMap((g) => g.items.map((i) => i.id)).includes('ias'));
  assert.deepEqual(filterNav('zzzz-nada'), []);
  assert.ok(filterNav('mascote').every((g) => g.items.length > 0));
});

test('catálogo: só Claude Code e Codex CLI são integrados; as outras IAs aparecem como "ainda não integradas"; cada uma com a sua cor', () => {
  assert.deepEqual(integratedIds(), ['claude', 'codex']);
  assert.ok(plannedAis().length >= 8 && plannedAis().every((a) => a.integrated === false));
  assert.equal(new Set(CATALOG.map((a) => a.id)).size, CATALOG.length); assert.ok(CATALOG.every((a) => /^#[0-9a-f]{6}$/i.test(a.color)));
  assert.equal(catalogById('forge'), FORGE_MASCOT); assert.equal(FORGE_MASCOT.brand, true); assert.equal(catalogById('nao-existe'), null); assert.equal(catalogColor('nao-existe'), null);
  assert.equal(providerColor('gemini'), catalogColor('gemini')); assert.equal(providerColor('nao-existe'), '#9aa3b2');
  assert.equal(aiName('claude'), 'Claude Code'); assert.equal(aiName('claude', 'Claude Code CLI'), 'Claude Code'); assert.equal(aiName('estranha', 'Outro nome'), 'Outro nome'); assert.equal(aiName('gemini'), 'Gemini'); assert.equal(aiName('xyz'), 'xyz');
  // Suas IAs: só o nome da IA, sem o produto
  assert.equal(aiShortName('claude', 'Claude Code CLI'), 'Claude'); assert.equal(aiShortName('codex', 'Codex CLI'), 'Codex'); assert.equal(aiShortName('opencode'), 'OpenCode');
  assert.equal(aiShortName('nova', 'Nova CLI'), 'Nova', 'fora do catálogo: o nome do servidor sem " CLI"'); assert.equal(aiShortName('xyz'), 'xyz'); assert.equal(aiShortName('xyz', '   '), 'xyz');
});

test('página: cada seção da navegação tem um componente, a busca e o cartão de perfil existem e "Para ligar" não finge ligar nada', () => {
  const page = src('pages/Settings.jsx');
  for (const i of flatItems()) assert.match(page, new RegExp(`\\b${i.id}: <`), `a seção ${i.id} não tem componente`);
  assert.match(page, /Buscar nas Configurações/); assert.match(page, /filterNav\(query\)/); assert.match(page, /className="set-me"/); assert.match(page, /role="tablist"/);
  const ais = src('components/settings/AisSection.jsx'), next = ais.slice(ais.indexOf('<Block title="Para ligar"'));
  assert.match(next, /plannedAis\(/); assert.match(next, /em breve/); assert.ok(!/aiName\(/.test(ais), 'Suas IAs mostra só o nome da IA (aiShortName), sem "Code"/"CLI"'); assert.ok(!/<button/.test(next), 'IA ainda não integrada não tem botão de ligar');
  assert.match(src('components/settings/GolemSection.jsx'), /Tokens forjados/); assert.ok(!itemById('mascotes') && !itemById('bichinho'), 'Mascotes e Bichinho deram lugar ao Golem');
});

test('barra lateral no formato do Orca: marca Forge no topo (com recolher), busca ⌘K, navegação, workspaces em cartões e, no rodapé, Configurações, Arquivos e Sessões; o terminal leva a logo do agente', () => {
  const sb = src('components/Sidebar.jsx'), grid = src('components/TerminalGrid.jsx'), app = src('App.jsx');
  assert.match(sb, /className="fx-brand"><span className="fx-brand-mark" aria-hidden="true" dangerouslySetInnerHTML=\{\{ __html: BRAND \}\} \/>Forge</, 'a marca mora no topo da barra lateral'); assert.match(sb, /aria-label="Recolher a barra lateral"/); assert.match(app, /onCollapse=\{toggleSide\}/);
  assert.match(sb, /placeholder="Buscar"/); assert.match(sb, /e\.metaKey \|\| e\.ctrlKey/, '⌘K / Ctrl+K foca a busca'); assert.match(sb, /onPick=\{pick\}/, 'abrir workspace continua como antes');
  assert.ok(!/MascotLogo|ForgeMascot|PixelMascot/.test(sb), 'sem mascote na barra lateral (eles moram nas Configurações)');
  assert.ok(sb.indexOf('<nav className="fx-wslist"') < sb.indexOf('className="fx-side-foot"'), 'o rodapé vem depois dos workspaces');
  const foot = sb.slice(sb.indexOf('className="fx-side-foot"'));
  assert.match(foot, /aria-label="Configurações"/); assert.match(foot, /onClick=\{onOpenWorkspaces\} aria-label="Arquivos: abrir, trocar ou adicionar workspace"/); assert.match(foot, /onOpenSessions\?\.\(\)/);
  assert.match(grid, /<ProviderLogo id=\{session\.provider \|\| 'claude'\} size=\{13\}/, 'o cabeçalho do terminal usa a logo do agente'); assert.ok(!/variant="mascot"|ProviderMascot/.test(grid));
  assert.ok(!/<Sidebar [^>]*collapsed=/.test(app), 'a barra nunca abre no modo antigo de recolhida');
  assert.match(src('main.jsx'), /import '\.\/forge\.css'/);
});

test('Cockpit compacto: textos pequenos na barra lateral, no topo, na barra de controles e nos terminais; o texto dentro do terminal segue a preferência de fonte', () => {
  const css = src('cockpit-ui.css'), tail = css.slice(css.indexOf('/* ---------- compacto'));
  const px = (re) => { const m = re.exec(tail); assert.ok(m, String(re)); return parseFloat(m[1]); };
  assert.ok(px(/\.oc-env-name \{ font-size: ([\d.]+)px/) <= 11, 'nome do workspace');
  assert.ok(px(/\.tb-view \{[^}]*font-size: ([\d.]+)px/) <= 10, 'abas'); assert.ok(px(/\.oc-side-title \{[^}]*font-size: ([\d.]+)px/) <= 10, 'título do grupo');
  assert.ok(px(/\.oc-ptitle, \.oc-app \.oc-ptitle\.sub \{ font-size: ([\d.]+)px/) <= 11, 'título do terminal'); assert.ok(px(/\.oc-pf \{[^}]*font-size: ([\d.]+)px/) <= 10, 'rodapé do terminal');
  assert.ok(!/xterm|fontSize|font-size: var\(--term/.test(tail), 'o texto do terminal não é tocado aqui');
});

test('vermelhos mais escuros e terminais sem cor por papel: nenhum vermelho vivo restou nos estilos e as bordas dos terminais são todas iguais, finas e em vermelho escuro', () => {
  const tok = src('tokens.css'), css = src('cockpit-ui.css'), grid = src('components/TerminalGrid.jsx');
  for (const [name, old] of [['--brand', '#ef4444'], ['--bone', '#dc2626'], ['--focus', '#ef4444']]) assert.ok(!new RegExp(`${name}: ${old}`).test(tok), `${name} voltou ao vermelho antigo`);
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const hexOf = (n) => new RegExp(`${n}: (#[0-9a-f]{6})`, 'i').exec(tok)[1], bright = (h) => 0.299 * parseInt(h.slice(1, 3), 16) + 0.587 * parseInt(h.slice(3, 5), 16) + 0.114 * parseInt(h.slice(5, 7), 16);
  assert.ok(bright(hexOf('--brand')) < bright('#ef4444') - 45, 'a marca virou vinho/sangue'); assert.ok(bright(hexOf('--bone')) < bright('#dc2626') - 30); assert.ok(bright(hexOf('--brand-soft')) > bright(hexOf('--brand')), 'ícones e texto em vermelho um pouco mais claros que os fundos');
  assert.ok((lum(hexOf('--err')) + 0.05) / (lum('#0a0a0a') + 0.05) >= 4.5, 'o vermelho de texto continua legível (AA)');
  for (const f of ['missions-workflow.css', 'overclock.css', 'oc.css', 'retro.css', 'shell.css', 'teams.css']) assert.ok(!/#ef4444|#dc2626|rgba\(239, ?68, ?68/i.test(src(f)), `${f} ainda tem o vermelho vivo`);
  assert.match(css, /\.oc-app \.oc-pane \{ border: 1px solid var\(--pane-line\) !important; box-shadow: none !important; \}/); assert.match(css, /--pane-line: #4f171c/, 'a borda dos terminais em vinho escuro');
  assert.ok(!/'--role'/.test(grid.slice(grid.indexOf('<section className={`oc-pane'), grid.indexOf('<header className="oc-ph">'))), 'o terminal não leva mais a cor do papel');
  assert.ok(!/\.oc-app \.oc-prole[^}]*--role/.test(css), 'a etiqueta do papel não usa a cor do papel');
});

test('sem barra superior: a navegação (Início, Missões, Terminais, Sessões) mora na barra lateral, com o indicador de missão esperando você e de terminais trabalhando', () => {
  const sb = src('components/Sidebar.jsx'), app = src('App.jsx'), ui = src('components/ui.jsx');
  assert.ok(!fs.existsSync(new URL('../../client/src/components/Topbar.jsx', import.meta.url)), 'a Topbar saiu'); assert.ok(!/Topbar|tb-row/.test(app));
  assert.ok(!fs.existsSync(new URL('../../client/src/components/WorkspaceTabs.jsx', import.meta.url))); assert.ok(!/ActivityDrawer/.test(app) && !fs.existsSync(new URL('../../client/src/components/ActivityDrawer.jsx', import.meta.url)));
  assert.match(sb, /onClick=\{\(\) => \{ onView\('home'\);/); assert.match(sb, /onClick=\{\(\) => \{ onView\('missions'\);/); assert.match(sb, /onClick=\{\(\) => \{ onView\('cockpit'\);/);
  assert.ok(sb.indexOf('label="Início"') < sb.indexOf('label="Missões"') && sb.indexOf('label="Missões"') < sb.indexOf('label="Terminais"'), 'Início, Missões e Terminais, nessa ordem');
  assert.match(sb, /flowsActivity\(flows, \{ seenAt: view === 'missions' \? Infinity : flowsSeenAt \}\)/, 'o indicador de Missões vem do estado real das missões (flows)'); assert.match(sb, /<StatusGlyph state=\{fa\.state\} size=\{12\} \/>/, 'missão trabalhando, aguardando você, falhou ou concluída: glifo de estado em tempo real'); assert.match(ui, /briefcase: 'M4 8h16/);
  assert.match(app, /view, onView: goView, flows: flowsData\.flows, flowsSeenAt/); // a sidebar recebe o estado real das missões (flows), não mais as missões do ciclo antigo
});

test('janela do app no macOS: sem barra nativa, a marca Forge fica no topo da barra lateral com espaço para os botões da janela e área de arrastar; nas Configurações a faixa própria faz esse papel; o preload só expõe plataforma e versão', async () => {
  const bar = src('components/DesktopTitleBar.jsx'), css = src('cockpit-ui.css'), app = src('App.jsx'), fx = src('forge.css'), sb = src('components/Sidebar.jsx');
  assert.match(app, /\{settings && <DesktopTitleBar \/>\}/); assert.match(app, /desktopInfo\(\)\?\.platform === 'darwin'/);
  assert.match(bar, /d\.platform !== 'darwin'\) return null/); assert.match(bar, /<b>FORGE<\/b>\{d\.version\}/);
  assert.match(css, /\.oc-titlebar \{[^}]*padding: 0 12px 0 82px[^}]*-webkit-app-region: drag/);
  assert.match(sb, /fx-side-top\$\{desktop \? ' desktop' : ''\}/); assert.match(fx, /\.fx-side-top\.desktop \{ padding-left: 80px; -webkit-app-region: drag; \}/); assert.match(fx, /\.fx-side-top\.desktop button \{ -webkit-app-region: no-drag; \}/);
  const main = fs.readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8'), pre = fs.readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /const title = `FORGE \$\{app\.getVersion\(\)\}`/); assert.match(main, /titleBarStyle: 'hidden', trafficLightPosition: \{ x: 14, y: 9 \}/); assert.match(main, /preload: path\.join\(__dirname, 'preload\.cjs'\)/); assert.match(main, /additionalArguments: \[`--forge-version=\$\{app\.getVersion\(\)\}`\]/);
  assert.match(main, /contextIsolation: true, sandbox: true, nodeIntegration: false/, 'a página continua sem acesso ao sistema'); assert.match(main, /page-title-updated', \(e\) => e\.preventDefault\(\)/);
  assert.match(pre, /exposeInMainWorld\('forgeDesktop', Object\.freeze\(\{ platform: process\.platform, version, pathForFile \}\)\)/); assert.match(pre, /webUtils\.getPathForFile\(file\)/, 'a única função: o caminho de um arquivo que o usuário soltou'); assert.ok(!/ipcRenderer|require\('node:|child_process|fs\b/.test(pre.replace(/\/\/[^\n]*/g, '')), 'o preload não expõe Node nem ipc');
  const { version } = JSON.parse(fs.readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8')); assert.match(version, /^\d+\.\d+\.\d+/);
});

test('trabalho em segundo plano: o item Terminais da barra lateral mostra o arco girando e quantos terminais trabalham, em qualquer página, pela mesma regra dos indicadores', () => {
  const sb = src('components/Sidebar.jsx'), fx = src('forge.css');
  assert.match(sb, /const working = sessions\.filter\(\(s\) => s\.status === 'running' && paneState\(s, workingIds, pending\) === 'working'\)\.length/, 'mesma regra dos hooks, não só a saída crescendo');
  assert.match(sb, /working > 0 \? <span className="fx-nav-run" role="status"[^>]*><StatusGlyph state="working" size=\{12\} \/><b>\{working\}<\/b>/);
  assert.match(fx, /\.fx-glyph\.g-work, \.fx-glyph\.g-boot \{ transform-origin: 50% 50%; animation: fx-spin \.9s linear infinite; \}/, 'o arco gira');
  assert.match(fx, /@media \(prefers-reduced-motion: reduce\)/); assert.match(fx, /html\[data-motion="reduced"\] \.fx-app \*/);
});
