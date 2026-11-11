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
  for (const id of ['historico', 'orquestracao', 'accounts', 'equipes', 'ias', 'mascotes', 'perfil']) assert.ok(itemById(id), id); // abertas por TerminalGrid, MaestroPopover, PrereqModal e pelos links
  assert.equal(DEFAULT_TAB, 'perfil');
});

test('resolveTab: nomes antigos (cli, providers) levam a Suas IAs; desconhecido ou não-texto cai no padrão', () => {
  assert.equal(resolveTab('cli'), 'ias'); assert.equal(resolveTab('providers'), 'ias'); assert.equal(resolveTab('equipes'), 'equipes');
  for (const bad of ['x', '', null, undefined, 7, { id: 'ias' }, '__proto__', 'constructor']) assert.equal(resolveTab(bad), 'perfil');
  assert.equal(resolveTab('nao-existe', 'ias'), 'ias'); assert.deepEqual(Object.keys(ALIASES).sort(), ['cli', 'providers']);
});

test('busca: por nome, descrição ou palavra-chave, sem diferenciar maiúsculas nem acentos; grupo sem resultado some; vazio = tudo', () => {
  assert.equal(filterNav(''), NAV); assert.equal(filterNav('   '), NAV);
  assert.deepEqual(filterNav('MAESTRO').flatMap((g) => g.items.map((i) => i.id)), ['orquestracao']);
  assert.ok(filterNav('esforco').flatMap((g) => g.items.map((i) => i.id)).includes('equipes'), 'sem acento acha "esforço"');
  assert.ok(filterNav('codex').flatMap((g) => g.items.map((i) => i.id)).includes('ias'));
  assert.deepEqual(filterNav('zzzz-nada'), []);
  assert.ok(filterNav('mascote').every((g) => g.items.length > 0));
});

test('catálogo: só Claude Code e Codex CLI são integrados; as outras IAs aparecem como "ainda não integradas"; cada uma com a sua cor', () => {
  assert.deepEqual(integratedIds(), ['claude', 'codex']);
  assert.ok(plannedAis().length >= 8 && plannedAis().every((a) => a.integrated === false));
  assert.equal(new Set(CATALOG.map((a) => a.id)).size, CATALOG.length); assert.ok(CATALOG.every((a) => /^#[0-9a-f]{6}$/i.test(a.color)));
  assert.equal(catalogById('forge'), FORGE_MASCOT); assert.equal(FORGE_MASCOT.crest, true); assert.equal(catalogById('nao-existe'), null); assert.equal(catalogColor('nao-existe'), null);
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

test('Cockpit na estrutura das Configurações: sem busca na barra lateral, o nome FORGE no topo com as abas logo ao lado (mesmo lugar em todas as páginas), perfil e Arquivos no rodapé como antes e os ícones do cabeçalho dos terminais intactos', () => {
  const sb = src('components/Sidebar.jsx'), grid = src('components/TerminalGrid.jsx'), css = src('cockpit-ui.css'), tb = src('components/Topbar.jsx'), app = src('App.jsx');
  assert.ok(!/oc-side-search|Buscar workspaces|shownEnvs/.test(sb), 'a busca saiu da barra lateral'); assert.match(sb, /onPick=\{pick\}/, 'abrir workspace continua como antes');
  assert.ok(!/MascotLogo/.test(sb), 'o elmo saiu da barra lateral'); assert.ok(!/oc-brand-name/.test(sb.slice(0, sb.indexOf('{modal && ('))), 'a marca não fica mais na barra lateral aberta');
  assert.match(tb, /!narrow && <div className="tb-brand"><span className="oc-brand-name">FORGE<\/span><\/div>/, 'o FORGE abre a barra do topo, em todas as páginas');
  assert.ok(tb.indexOf('tb-brand') < tb.indexOf('className="tb-views"'), 'as abas vêm logo depois do FORGE');
  assert.match(css, /\.tb-row > \.tb-brand \{[^}]*margin-right: calc\(var\(--sp-3\) \* -1\)/, 'sem o espaço da linha entre o FORGE e as abas');
  assert.ok(app.indexOf('<Topbar ') < app.indexOf('<div className="oc-body">'), 'o topo ocupa a largura toda, acima da barra lateral'); assert.match(app, /oc-app oc-app-col/);
  assert.ok(sb.indexOf('oc-side-files') < sb.indexOf('className="oc-side-user"'), 'o perfil continua no rodapé, abaixo de Arquivos'); assert.ok(sb.indexOf('className="oc-side-user"') > sb.indexOf('<nav className="oc-envs"'), 'o perfil não subiu para o topo');
  assert.ok(!/onOpenSettings/.test(sb), 'a barra lateral não ganhou ação nova');
  assert.match(grid, /<ProviderLogo id=\{session\.provider \|\| 'claude'\} size=\{20\} variant="mascot" \/>/, 'o ícone do cabeçalho do terminal é o de sempre');
  assert.ok(!/ProviderMascot/.test(grid)); assert.ok(!/\.px-|oc-pmark/.test(css), 'sem regras do mascote novo nem do ícone do cabeçalho');
  assert.match(src('main.jsx'), /import '\.\/cockpit-ui\.css'/);
  assert.ok(!/oc-collapse|Recolher a barra lateral/.test(sb), 'sem o botão de recolher a barra lateral'); assert.ok(!/<Sidebar [^>]*collapsed=/.test(app), 'a barra nunca é aberta recolhida, nem com o estado antigo gravado');
  assert.match(css, /border-radius: 0/, 'caixas quadradas na barra lateral'); assert.match(css, /\.oc-side \.oc-env\.on[^{]*\{[^}]*border-radius: 0/);
});
