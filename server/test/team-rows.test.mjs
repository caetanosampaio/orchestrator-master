// Configurações como página e Configurações > Equipes em linhas: equipes por objetivo (conferidas contra a validação ESTRITA da API), textos, rótulos de modelo/esforço,
// cor dos bonequinhos e a ligação das telas. Lógica pura e leitura do código das telas; sem rede e sem banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-rows-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const { uniqueName, draftForInstall, isInstalled, readyTeams, squadMissing, squadProviders, describeSquad, slotChoiceLabels, launchPlan, draftFromSquad, templateBody, takesSkills } = await import('../../client/src/squads.js');
const { providerColor, PROVIDER_COLORS } = await import('../../client/src/provider-view.js');
const { validateTemplateBody } = await import('../team-templates.js');
const { providerOptions } = await import('../providers/index.js');
const { ROLES } = await import('../terminals.js');
const { SKILLS } = await import('../loadouts.js');

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
// Os times prontos agora vêm do servidor (server/team-presets.js, contrato da Fase 1) e o cliente só os normaliza (readyTeams). Importado dentro de cada teste: até o
// backend entregar o módulo, só estes testes falham (o resto do arquivo continua valendo).
const ready = async () => readyTeams((await import('../team-presets.js')).TEAM_PRESETS);

test('times prontos do servidor: nome, o que fazem, quando usar, e CADA um, do jeito que o cliente instala, passa na validação estrita da API (papel, agente, modelo, esforço, skills e instrução)', async () => {
  const list = await ready();
  assert.equal(list.length, 7, 'os sete times prontos da Fase 1 chegam inteiros ao cliente');
  assert.equal(new Set(list.map((s) => s.id)).size, list.length, 'ids únicos');
  for (const s of list) {
    assert.ok(s.id.startsWith('preset:') && s.builtin === true && s.curated === true, s.name);
    assert.ok(s.name && s.tagline && s.about && s.instruction, `${s.name}: precisa de nome, resumo, quando usar e instrução`);
    const v = validateTemplateBody(templateBody(draftForInstall(s, [])));
    assert.equal(v.error, undefined, `${s.name}: ${v.error}`);
    assert.ok(s.slots.every((x) => x.model && x.effort), `${s.name}: toda vaga traz modelo e esforço`);
    assert.ok(s.slots.every((x) => Object.hasOwn(ROLES, x.role)), `${s.name}: papel válido`);
    assert.ok(s.slots.every((x) => takesSkills(x.provider) || !x.skills), `${s.name}: vaga Codex sem skills`);
    for (const x of s.slots) for (const id of x.skills ?? []) assert.ok(Object.hasOwn(SKILLS, id), `${s.name}: skill ${id} existe no catálogo`);
  }
  for (const name of ['Construção de código', 'Revisão e segurança']) assert.ok(list.some((s) => s.name === name), `${name}: o porte dos dois times mistos existe`);
});

test('times prontos: os dois mistos portados continuam com as mesmas vagas; só abrem com os dois agentes instalados (squadMissing); cópias independentes', async () => {
  const byName = Object.fromEntries((await ready()).map((t) => [t.name, t]));
  for (const n of ['Construção de código', 'Revisão e segurança']) { const t = byName[n]; assert.deepEqual(squadProviders(t).sort(), ['claude', 'codex'], `${n}: misto`); assert.deepEqual(squadMissing(t, ['claude']), ['codex']); assert.deepEqual(squadMissing(t, ['codex']), ['claude']); assert.deepEqual(squadMissing(t, ['claude', 'codex']), []); }
  const a = await ready(), b = await ready(); a[0].slots[0].model = 'x'; a[0].name = 'Mudou';
  assert.notEqual(b[0].slots[0].model, 'x'); assert.notEqual(b[0].name, 'Mudou');
  const plan = launchPlan(byName['Construção de código']);
  assert.deepEqual(plan.roles, ['maestro', 'builder', 'builder', 'reviewer']); assert.deepEqual(plan.providers, ['claude', 'codex', 'codex', 'claude']); assert.equal(plan.teamId, 'squad');
  assert.deepEqual(plan.models, ['opus', 'gpt-5-codex', 'gpt-5-codex', 'opus']); assert.deepEqual(plan.efforts, ['high', 'medium', 'medium', 'high']);
  assert.equal(plan.templateId, 'preset:code-build'); assert.deepEqual(plan.slotIndexes, [0, 1, 2, 3]);
  const audit = byName['Revisão e segurança']; assert.deepEqual(audit.slots.map((v) => `${v.role}:${v.provider}`), ['maestro:claude', 'scout:codex', 'reviewer:claude', 'reviewer:codex']);
  assert.ok(!audit.slots.some((v) => v.role === 'builder'), 'a revisão não tem quem edite');
});

test('usar como base: o time do FORGE vira rascunho NOVO (sem id nem nome) com modelo, esforço, skills e a instrução', async () => {
  const t = (await ready()).find((s) => s.slots.some((x) => x.skills?.length)), d = draftFromSquad(t);
  assert.equal(d.id, null); assert.equal(d.name, ''); assert.ok(d.slots.every((s) => s.model && s.effort)); assert.equal(d.instruction, t.instruction);
  assert.deepEqual(d.slots.map((s) => s.skills ?? []), t.slots.map((s) => s.skills ?? []));
});

test('describeSquad: os times prontos têm texto; equipe do usuário só o que ela traz', async () => {
  for (const s of await ready()) { const d = describeSquad(s); assert.ok(d.tagline && d.about, `${s.id} sem texto`); }
  assert.deepEqual(describeSquad({ id: 'tpl_aaaaaaaa', name: 'Minha' }), { tagline: null, about: null });
});

test('slotChoiceLabels: usa o rótulo do servidor, o id quando fora da lista e "padrão" quando a vaga não define', () => {
  const options = providerOptions();
  assert.deepEqual(slotChoiceLabels({ provider: 'claude', model: 'sonnet', effort: 'medium' }, options), { model: 'Sonnet', effort: 'Médio', modelSet: true, effortSet: true });
  assert.deepEqual(slotChoiceLabels({ provider: 'claude' }, options), { model: 'Modelo padrão', effort: 'Esforço padrão', modelSet: false, effortSet: false });
  assert.equal(slotChoiceLabels({ provider: 'claude', model: 'antigo' }, options).model, 'antigo');
  assert.equal(slotChoiceLabels({ provider: 'claude', model: 'opus' }, null).model, 'opus', 'servidor antigo: mostra o id');
});

test('bonequinhos: cada IA tem a sua cor (a das telas de referência); desconhecida fica em cinza; o corpo em pixel art é o mesmo para todas', () => {
  assert.notEqual(providerColor('claude'), providerColor('codex')); assert.match(providerColor('claude'), /^#[0-9a-f]{6}$/i); assert.equal(providerColor('x'), '#9aa3b2');
  assert.deepEqual(Object.keys(PROVIDER_COLORS).sort(), ['claude', 'codex']);
  const logo = src('components/ProviderLogo.jsx'), m = logo.slice(logo.indexOf('export function ProviderMascot'));
  assert.match(m, /providerColor\(id\)/); assert.match(m, /<PixelMascot /); assert.ok(!/CLAUDE_ORANGE|#d87756/i.test(m), 'a cor vem da IA, não fixa no desenho');
  assert.match(m, /\{label && <span className="pm-name">\{label\}<\/span>\}/, 'o nome da IA acompanha o bonequinho');
  assert.ok(!/Mascot3D|mascot-3d/.test(logo), 'o boneco não é mais 3D: as telas de referência são pixel art plano');
});

test('Configurações é uma PÁGINA (não um diálogo) e a engrenagem abre e fecha; a seção Times prontos desenha o próprio cabeçalho', () => {
  const app = src('App.jsx'), page = src('pages/Settings.jsx'), tb = src('components/Topbar.jsx');
  assert.ok(!fs.existsSync(new URL('../../client/src/components/SettingsDialog.jsx', import.meta.url)), 'o diálogo antigo saiu');
  assert.ok(!/Dialog/.test(page.replace(/Workspace/g, '')), 'a página não usa o componente Dialog');
  assert.match(app, /view === 'settings'/); assert.match(app, /onOpenSettings=\{view === 'settings' \? closeSettings : openSettings\}/); assert.match(app, /#\/settings/);
  assert.match(app, /suspended=\{!!dialog \|\| view === 'settings'\}/, 'o aviso de pré-requisitos continua se afastando das Configurações');
  assert.match(page, /data-testid="settings-page"/); assert.match(page, /onClick=\{onClose\}/);
  assert.match(tb, /aria-pressed=\{view === 'settings'\}/);
  assert.match(src('main.jsx'), /import '\.\/teams\.css'/);
});

test('instalar: nome livre entre os seus times, vagas com modelo e esforço, time NOVO (sem id) e dá para instalar de novo com outro nome', async () => {
  const mine = [{ id: 'tpl_aaaaaaaa', name: 'Construção de código' }, { id: 'tpl_bbbbbbbb', name: 'construção de código (2)' }];
  assert.equal(uniqueName('Time novo', mine), 'Time novo'); assert.equal(uniqueName('Construção de código', mine), 'Construção de código (3)', 'sem diferenciar maiúsculas');
  assert.equal(uniqueName('x'.repeat(40), [{ name: 'x'.repeat(40) }]).length <= 40, true, 'respeita o limite de 40 caracteres'); assert.equal(uniqueName('', []), '');
  const list = await ready(), t = list.find((s) => s.name === 'Construção de código'), other = list.find((s) => s.name === 'Revisão e segurança'), d = draftForInstall(t, mine);
  assert.equal(d.id, null); assert.equal(d.name, 'Construção de código (3)'); assert.deepEqual(templateBody(d).slots, templateBody(t).slots); assert.ok(d.slots.every((s) => s.model && s.effort)); assert.equal(d.instruction, t.instruction);
  const v = validateTemplateBody(templateBody(d)); assert.equal(v.error, undefined, 'o rascunho de instalação passa na validação estrita da API');
  assert.equal(isInstalled(t, mine), true); assert.equal(isInstalled(other, mine), false); assert.equal(isInstalled(null, null), false);
});

test('Times prontos: seções Para instalar (do servidor) e Seus, ver por dentro e editar abrem como página dentro das Configurações, e instalar passa pela edição', () => {
  const t = src('components/TeamsSettings.jsx'), cards = src('components/TeamCards.jsx'), page = src('pages/Settings.jsx'), nav = src('settings-nav.js');
  assert.ok(!/title="Do FORGE"/.test(t), 'sem a lista de todas as possibilidades'); assert.match(t, /title="Para instalar"/); assert.match(t, /title="Seus"/); assert.match(t, /Ver por dentro/); assert.match(t, /Novo time/);
  assert.match(t, /view\.name === 'edit'/); assert.match(t, /view\.name === 'detail'/); assert.match(t, /draftForInstall\(s, sq\.squads\)/); assert.match(t, /mode: 'install'/, '"Instalar" abre a edição antes de salvar');
  assert.match(t, /saveLabel=\{mode === 'install' \? 'Instalar time' : null\}/); assert.match(t, /sq\.create\(body\)/, 'só salvar cria o time (via /api/team-templates)');
  assert.match(t, /readyTeams\(sq\.presets\)/, 'os times para instalar vêm dos presets do servidor'); assert.ok(!/curatedSquads|CURATED/.test(t + src('squads.js')), 'sem a lista fixa no cliente');
  assert.match(src('use-squads.js'), /setPresets\(Array\.isArray\(d\?\.presets\) \? d\.presets : \[\]\)/, 'presets ausente = lista vazia (servidor antigo)');
  assert.match(t, /\{squad\.instruction && <Block title="Instrução do time"/, '"Ver por dentro" mostra a instrução'); assert.match(t, /aria-label=\{`Skills da vaga \$\{k \+ 1\}`\}/, 'e as skills de cada vaga');
  assert.match(cards, /slotSkills\(s\)/, 'o cartão mostra as skills de cada vaga');
  for (const id of Object.keys(SKILLS)) for (const f of ['components/TeamsSettings.jsx', 'components/TeamComposer.jsx', 'components/TeamCards.jsx']) assert.ok(!src(f).includes(`'${id}'`), `${f}: a skill ${id} não é escrita à mão na tela`);
  assert.ok(!/onClose/.test(t), 'as páginas de dentro não escondem nem fecham a barra lateral das Configurações');
  assert.match(nav, /own: true/); assert.match(page, /!cur\.own &&/, 'a seção desenha o próprio título; a barra lateral é sempre a da página');
  assert.match(cards, /<ProviderMascot id=\{s\.provider\} size=\{size\} hat=\{s\.role === 'maestro'\} \/>/, 'cada vaga é um mascote na cor da IA, e o Maestro usa o chapéu'); assert.match(cards, /tc-m-l/, 'com o papel embaixo');
  assert.ok(!/<ProviderMascot/.test(src('components/TerminalGrid.jsx')));
  const grid = src('components/TerminalGrid.jsx'); assert.ok(!/curatedSquads/.test(grid), 'as equipes por objetivo são opcionais: só entram no Cockpit depois de instaladas');
  const ais = src('components/settings/AisSection.jsx'); assert.match(ais, /<ProviderMascot id=\{r\.id\} size=\{40\} label=/, 'Suas IAs usa o mesmo estilo de mascote dos times');
  assert.match(ais, /<ProviderMascot id=\{a\.id\} size=\{34\} label=/);
});

test('Cockpit sem terminais: só os times de Configurações (instalados e seus), sem equipes fixas; vazio orienta e leva a Times prontos; o agente padrão dos times básicos saiu das Configurações', () => {
  const grid = src('components/TerminalGrid.jsx'), gal = src('components/SquadGallery.jsx'), t = src('components/TeamsSettings.jsx');
  assert.ok(!/builtinSquads|presetSquads|curatedSquads/.test(grid), 'o Cockpit não lista equipes embutidas');
  assert.match(grid, /<SquadGallery mine=\{sq\.missing \? \[\] : sq\.squads\} mineTitle="Times prontos"/); assert.match(grid, /Nenhum time pronto ainda/); assert.match(grid, /onOpenSettings\?\.\('equipes'\)/, 'leva a Configurações > Times prontos');
  assert.match(grid, /onOpen=\{openSquad\}/, 'abrir um time continua como antes'); assert.ok(!/oc-agent/.test(grid), 'sem a linha do agente padrão das equipes prontas');
  assert.match(gal, /\{mine\.length === 0 && !onNew && empty\}/);
  assert.ok(!/Times básicos do Cockpit|Agente dos times básicos/.test(t), 'a escolha do agente das equipes embutidas saiu');
  const pg = src('pages/Settings.jsx'); assert.ok(pg.includes('TeamsSettings'));
});
