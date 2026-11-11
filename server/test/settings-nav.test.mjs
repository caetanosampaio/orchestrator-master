// Navegação da página de Configurações (client/src/settings-nav.js) e catálogo de IAs (client/src/provider-catalog.js): lógica pura e a ligação das seções. Sem rede e sem banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NAV, ALIASES, DEFAULT_TAB, flatItems, itemById, resolveTab, filterNav } from '../../client/src/settings-nav.js';
import { CATALOG, FORGE_MASCOT, catalogById, catalogColor, integratedIds, plannedAis, aiName } from '../../client/src/provider-catalog.js';
import { providerColor } from '../../client/src/provider-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('navegação: três grupos, ids únicos, cada seção com rótulo, ícone e frase de apoio; as seções que outras telas abrem continuam existindo', () => {
  assert.deepEqual(NAV.map((g) => g.label), ['IAs e contas', 'Missões e times', 'App e computador']);
  const items = flatItems(); assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const i of items) assert.ok(i.label && i.icon && i.hint, i.id);
  assert.equal(itemById('equipes').label, 'Times prontos'); assert.equal(itemById('equipes').tag, 'Squads');
  for (const id of ['orquestracao', 'accounts', 'equipes', 'ias', 'mascotes', 'perfil']) assert.ok(itemById(id), id); // abertas por TerminalGrid, MaestroPopover, PrereqModal e pelos links
  assert.equal(DEFAULT_TAB, 'perfil');
});

test('resolveTab: nomes antigos (cli, providers) levam a Suas IAs; desconhecido ou não-texto cai no padrão', () => {
  assert.equal(resolveTab('cli'), 'ias'); assert.equal(resolveTab('providers'), 'ias'); assert.equal(resolveTab('equipes'), 'equipes');
  for (const bad of ['x', '', null, undefined, 7, { id: 'ias' }, '__proto__', 'constructor']) assert.equal(resolveTab(bad), 'perfil');
  assert.equal(resolveTab('nao-existe', 'ias'), 'ias'); assert.deepEqual(Object.keys(ALIASES).sort(), ['cli', 'providers']);
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
});

test('página: cada seção da navegação tem um componente, a busca e o cartão de perfil existem e "Para ligar" não finge ligar nada', () => {
  const page = src('pages/Settings.jsx');
  for (const i of flatItems()) assert.match(page, new RegExp(`\\b${i.id}: <`), `a seção ${i.id} não tem componente`);
  assert.match(page, /Buscar nas Configurações/); assert.match(page, /filterNav\(query\)/); assert.match(page, /className="set-me"/); assert.match(page, /role="tablist"/);
  const ais = src('components/settings/AisSection.jsx'), next = ais.slice(ais.indexOf('<Block title="Para ligar"'));
  assert.match(next, /plannedAis\(\)/); assert.match(next, /em breve/); assert.ok(!/<button/.test(next), 'IA ainda não integrada não tem botão de ligar');
  assert.match(src('components/settings/MascotsSection.jsx'), /Ainda não integrado ao FORGE/);
});

test('Cockpit na estrutura das Configurações: sem busca na barra lateral, o nome FORGE no topo com as abas logo ao lado (mesmo lugar em todas as páginas), Arquivos e Sessões no rodapé, um em cima do outro, sem o cartão de nome e perfil e os ícones do cabeçalho dos terminais intactos', () => {
  const sb = src('components/Sidebar.jsx'), grid = src('components/TerminalGrid.jsx'), css = src('cockpit-ui.css'), tb = src('components/Topbar.jsx'), app = src('App.jsx');
  assert.ok(!/oc-side-search|Buscar workspaces|shownEnvs/.test(sb), 'a busca saiu da barra lateral'); assert.match(sb, /onPick=\{pick\}/, 'abrir workspace continua como antes');
  assert.ok(!/MascotLogo/.test(sb), 'o elmo saiu da barra lateral'); assert.ok(!/oc-brand-name/.test(sb.slice(0, sb.indexOf('{modal && ('))), 'a marca não fica mais na barra lateral aberta');
  assert.ok(!/oc-brand-name|tb-brand|>FORGE</.test(tb), 'o nome FORGE não fica mais na barra superior');
  assert.ok(app.indexOf('<Topbar ') < app.indexOf('<div className="oc-body">'), 'o topo ocupa a largura toda, acima da barra lateral'); assert.match(app, /oc-app oc-app-col/);
  assert.ok(!/oc-side-user|oc-avatar|prefs\.name/.test(sb), 'o cartão de nome e perfil saiu da barra lateral'); assert.ok(sb.indexOf('<Icon name="folderOpen"') < sb.indexOf('<Icon name="clock"'), 'Arquivos em cima e Sessões logo abaixo'); assert.match(sb, /oc-side-sessions" onClick=\{onOpenSessions\}/); assert.ok(sb.indexOf('oc-side-sessions') > sb.indexOf('<nav className="oc-envs"'), 'no rodapé');
  assert.ok(!/onOpenSettings/.test(sb), 'a barra lateral não abre Configurações');
  assert.match(grid, /<ProviderLogo id=\{session\.provider \|\| 'claude'\} size=\{20\} variant="mascot" \/>/, 'o ícone do cabeçalho do terminal é o de sempre');
  assert.ok(!/ProviderMascot/.test(grid)); assert.ok(!/\.px-|oc-pmark/.test(css), 'sem regras do mascote novo nem do ícone do cabeçalho');
  assert.match(src('main.jsx'), /import '\.\/cockpit-ui\.css'/);
  assert.ok(!/oc-collapse|Recolher a barra lateral/.test(sb), 'sem o botão de recolher a barra lateral'); assert.ok(!/<Sidebar [^>]*collapsed=/.test(app), 'a barra nunca é aberta recolhida, nem com o estado antigo gravado');
  assert.match(css, /border-radius: 0/, 'caixas quadradas na barra lateral'); assert.match(css, /\.oc-side \.oc-env\.on[^{]*\{[^}]*border-radius: 0/);
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
  for (const f of ['missions.css', 'missions-workflow.css', 'overclock.css', 'oc.css', 'retro.css', 'shell.css', 'teams.css']) assert.ok(!/#ef4444|#dc2626|rgba\(239, ?68, ?68/i.test(src(f)), `${f} ainda tem o vermelho vivo`);
  assert.match(css, /\.oc-app \.oc-pane \{ border: 1px solid var\(--pane-line\) !important; box-shadow: none !important; \}/); assert.match(css, /--pane-line: #4f171c/, 'a borda dos terminais em vinho escuro');
  assert.ok(!/'--role'/.test(grid.slice(grid.indexOf('<section className={`oc-pane'), grid.indexOf('<header className="oc-ph">'))), 'o terminal não leva mais a cor do papel');
  assert.ok(!/\.oc-app \.oc-prole[^}]*--role/.test(css), 'a etiqueta do papel não usa a cor do papel');
});

test('barra superior no formato da referência: só os recursos (forge-app, com Missions em ícone à esquerda), sem abas de workspace nem "+", sem a faixa de atividade no Cockpit e o círculo do perfil abre as Configurações', () => {
  const tb = src('components/Topbar.jsx'), app = src('App.jsx'), css = src('cockpit-ui.css'), ui = src('components/ui.jsx');
  assert.ok(!/WorkspaceTabs|openTabs|onOpenWorkspaces|tb-tabs/.test(tb), 'os workspaces moram só na barra lateral'); assert.ok(!fs.existsSync(new URL('../../client/src/components/WorkspaceTabs.jsx', import.meta.url)));
  assert.ok(!/ActivityDrawer/.test(app) && !fs.existsSync(new URL('../../client/src/components/ActivityDrawer.jsx', import.meta.url)), 'a faixa de atividade saiu do Cockpit');
  assert.match(tb, /<span>forge-app<\/span>/); assert.ok(tb.indexOf('name="briefcase"') < tb.indexOf('<span>forge-app</span>'), 'o ícone de Missions fica à esquerda de forge-app'); assert.match(tb, /onClick=\{\(\) => onView\('missions'\)\}/); assert.match(tb, /onClick=\{\(\) => onView\('cockpit'\)\}/);
  assert.match(tb, /<b className="tb-bang" aria-hidden="true">!<\/b>/, 'missão esperando você: "!" vermelho'); assert.match(ui, /briefcase: 'M4 8h16/);
  assert.match(tb, /className=\{`tb-avatar\$\{view === 'settings' \? ' on' : ''\}`\}[^>]*aria-label="Configurações" aria-pressed=\{view === 'settings'\}/); assert.match(tb, /<SystemStatus \/>/);
  assert.match(css, /\.oc-app \.tb-view \{ text-transform: none; letter-spacing: 0;/, 'abas em minúsculas'); assert.match(css, /\.oc-app \.tb-view\.on \{ color: #fff; font-weight: 700; \}/); assert.match(css, /\.oc-app \.tb \{ border-bottom: 1px solid var\(--line\); \}/, 'sem a linha vermelha de ponta a ponta'); assert.ok(!/#4a1a1a/.test(css)); assert.match(css, /\.oc-app \.tb-view::after \{ height: 2px; \}/, 'o vermelho fica só no sublinhado da aba selecionada');
});

test('FORGE + versão só na janela do app: a faixa do macOS leva o nome e a versão ao lado dos botões da janela; fora do app (navegador) e no Windows nada é desenhado; o preload só expõe plataforma e versão', async () => {
  const bar = src('components/DesktopTitleBar.jsx'), css = src('cockpit-ui.css'), app = src('App.jsx');
  assert.match(app, /<DesktopTitleBar \/>/); assert.ok(app.indexOf('<DesktopTitleBar />') < app.indexOf('<Topbar '), 'a faixa vem acima da barra superior');
  assert.match(bar, /d\.platform !== 'darwin'\) return null/); assert.match(bar, /<b>FORGE<\/b>\{d\.version\}/);
  assert.match(css, /\.oc-titlebar \{[^}]*padding: 0 12px 0 82px[^}]*-webkit-app-region: drag/, 'espaço para os botões da janela à esquerda e área de arrastar');
  const main = fs.readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8'), pre = fs.readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(main, /const title = `FORGE \$\{app\.getVersion\(\)\}`/); assert.match(main, /titleBarStyle: 'hidden', trafficLightPosition: \{ x: 14, y: 9 \}/); assert.match(main, /preload: path\.join\(__dirname, 'preload\.cjs'\)/); assert.match(main, /additionalArguments: \[`--forge-version=\$\{app\.getVersion\(\)\}`\]/);
  assert.match(main, /contextIsolation: true, sandbox: true, nodeIntegration: false/, 'a página continua sem acesso ao sistema'); assert.match(main, /page-title-updated', \(e\) => e\.preventDefault\(\)/);
  assert.match(pre, /exposeInMainWorld\('forgeDesktop', Object\.freeze\(\{ platform: process\.platform, version \}\)\)/); assert.ok(!/ipcRenderer|require\('node:|child_process|fs\b/.test(pre.replace(/\/\/[^\n]*/g, '')), 'o preload não expõe Node nem ipc');
  const { version } = JSON.parse(fs.readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8')); assert.match(version, /^\d+\.\d+\.\d+/);
});

test('trabalho em segundo plano: terminais trabalhando mostram um mini "!" amarelo-escuro ao lado de forge-app, em qualquer página (inclusive Missions), sem etiqueta', () => {
  const tb = src('components/Topbar.jsx'), css = src('cockpit-ui.css');
  assert.match(tb, /workingTerms > 0 && <b className="tb-work" role="status"[^>]*>!<\/b>/); assert.ok(!/<i aria-hidden="true" \/>work/.test(tb), 'não é mais uma etiqueta com a palavra work');
  assert.match(tb, /em segundo plano/); assert.ok(!/view === 'cockpit' && workingTerms/.test(tb), 'não depende da página aberta');
  const rule = /\.oc-app \.tb-work \{([^}]*)\}/.exec(css)[1]; const size = parseFloat(/font: 700 ([\d.]+)px/.exec(rule)[1]); assert.ok(size < 11, 'menor que o nome forge-app (11px)');
  const hex = /color: (#[0-9a-f]{6})/i.exec(rule)[1], [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); assert.ok(r > g && g > b && r < 200, 'amarelado e escuro, não claro');
  assert.match(css, /@keyframes tb-work-bob \{[\s\S]*?translateY\(1px\)[\s\S]*?translateY\(-2px\)/, 'sobe e desce de leve'); assert.match(css, /prefers-reduced-motion: reduce\) \{ \.oc-app \.tb-work \{ animation: none; \} \}/);
});
