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
const { curatedSquads, squadMissing, squadProviders, describeSquad, slotChoiceLabels, builtinSquads, presetSquads, launchPlan, draftFromSquad, cleanSlots } = await import('../../client/src/squads.js');
const { providerColor, PROVIDER_COLORS } = await import('../../client/src/provider-view.js');
const { validateTemplateBody } = await import('../team-templates.js');
const { providerOptions } = await import('../providers/index.js');
const { ROLES } = await import('../terminals.js');

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('equipes por objetivo: nome, o que fazem, quando usar, e CADA vaga passa na validação estrita da API (papel, agente, modelo e esforço das listas fechadas)', () => {
  const list = curatedSquads();
  assert.ok(list.length >= 5);
  assert.equal(new Set(list.map((s) => s.id)).size, list.length, 'ids únicos');
  for (const s of list) {
    assert.ok(s.id.startsWith('builtin:') && s.builtin === true && s.curated === true, s.name);
    assert.ok(s.name && s.tagline && s.about, `${s.name}: precisa de nome, resumo e quando usar`);
    const v = validateTemplateBody({ name: s.name.slice(0, 40), slots: cleanSlots(s.slots) });
    assert.equal(v.error, undefined, `${s.name}: ${v.error}`);
    assert.ok(s.slots.every((x) => x.model && x.effort), `${s.name}: toda vaga traz modelo e esforço`);
    assert.ok(s.slots.every((x) => Object.hasOwn(ROLES, x.role)), `${s.name}: papel válido`);
  }
  assert.ok(list.some((s) => s.name === 'Construção de código'), 'a equipe de exemplo do pedido existe');
});

test('equipes por objetivo: só abrem com os agentes instalados (squadMissing); cópias independentes', () => {
  const byName = Object.fromEntries(curatedSquads().map((s) => [s.name, s]));
  assert.deepEqual(squadProviders(byName['Claude lidera, Codex constrói']).sort(), ['claude', 'codex']);
  assert.deepEqual(squadMissing(byName['Claude lidera, Codex constrói'], ['claude']), ['codex']);
  assert.deepEqual(squadMissing(byName['Construção de código'], ['claude']), []);
  assert.deepEqual(squadMissing(byName['Construção com Codex'], ['claude']), ['codex']);
  const a = curatedSquads(), b = curatedSquads(); a[0].slots[0].model = 'x'; a[0].name = 'Mudou';
  assert.notEqual(b[0].model, 'x'); assert.notEqual(b[0].name, 'Mudou');
  const plan = launchPlan(byName['Construção de código']);
  assert.deepEqual(plan.roles, ['maestro', 'builder', 'builder', 'reviewer']); assert.equal(plan.teamId, 'squad'); assert.deepEqual(plan.models, ['opus', 'sonnet', 'sonnet', 'opus']); assert.deepEqual(plan.efforts, ['high', 'medium', 'medium', 'high']);
});

test('usar como base: a equipe do FORGE vira rascunho NOVO (sem id nem nome) com modelo e esforço', () => {
  const d = draftFromSquad(curatedSquads()[0]);
  assert.equal(d.id, null); assert.equal(d.name, ''); assert.ok(d.slots.every((s) => s.model && s.effort));
});

test('describeSquad: equipes por objetivo e estruturas básicas têm texto; equipe do usuário só o que ela traz', () => {
  for (const s of [...curatedSquads(), ...builtinSquads(['claude', 'codex']), ...presetSquads('claude')]) { const d = describeSquad(s); assert.ok(d.tagline && d.about, `${s.id} sem texto`); }
  assert.deepEqual(describeSquad({ id: 'tpl_aaaaaaaa', name: 'Minha' }), { tagline: null, about: null });
});

test('slotChoiceLabels: usa o rótulo do servidor, o id quando fora da lista e "padrão" quando a vaga não define', () => {
  const options = providerOptions();
  assert.deepEqual(slotChoiceLabels({ provider: 'claude', model: 'sonnet', effort: 'medium' }, options), { model: 'Sonnet', effort: 'Médio', modelSet: true, effortSet: true });
  assert.deepEqual(slotChoiceLabels({ provider: 'claude' }, options), { model: 'Modelo padrão', effort: 'Esforço padrão', modelSet: false, effortSet: false });
  assert.equal(slotChoiceLabels({ provider: 'claude', model: 'antigo' }, options).model, 'antigo');
  assert.equal(slotChoiceLabels({ provider: 'claude', model: 'opus' }, null).model, 'opus', 'servidor antigo: mostra o id');
});

test('bonequinhos: cada provider tem a sua cor; desconhecido fica em cinza; o corpo 3D é o mesmo para todos', () => {
  assert.notEqual(providerColor('claude'), providerColor('codex')); assert.match(providerColor('claude'), /^#[0-9a-f]{6}$/i); assert.equal(providerColor('x'), '#9aa3b2');
  assert.deepEqual(Object.keys(PROVIDER_COLORS).sort(), ['claude', 'codex']);
  const logo = src('components/ProviderLogo.jsx'), m = logo.slice(logo.indexOf('export function ProviderMascot'));
  assert.match(m, /providerColor\(id\)/); assert.match(m, /<Mascot3D /); assert.ok(!/CLAUDE_ORANGE|#d87756/i.test(m), 'a cor vem do provider, não fixa no desenho');
  assert.match(m, /\{label && <span className="pm-name">\{label\}<\/span>\}/, 'o nome do provider acompanha o bonequinho');
  assert.ok(!/<svg/.test(m), 'o boneco não é mais uma imagem 2D');
});

test('Configurações é uma PÁGINA (não um diálogo) e a engrenagem abre e fecha; Equipes usa linhas e agentes', () => {
  const app = src('App.jsx'), page = src('pages/Settings.jsx'), tb = src('components/Topbar.jsx');
  assert.ok(!fs.existsSync(new URL('../../client/src/components/SettingsDialog.jsx', import.meta.url)), 'o diálogo antigo saiu');
  assert.ok(!/Dialog/.test(page.replace(/Workspace/g, '')), 'a página não usa o componente Dialog');
  assert.match(app, /view === 'settings'/); assert.match(app, /onOpenSettings=\{view === 'settings' \? closeSettings : openSettings\}/); assert.match(app, /#\/settings/);
  assert.match(app, /suspended=\{!!dialog \|\| view === 'settings'\}/, 'o aviso de pré-requisitos continua se afastando das Configurações');
  assert.match(page, /data-testid="settings-page"/); assert.match(page, /onClick=\{onClose\}/);
  assert.match(tb, /aria-pressed=\{view === 'settings'\}/);
  const t = src('components/TeamsSettings.jsx');
  assert.match(t, /<TeamRows title="Equipes do FORGE"/); assert.match(t, /<Agents providers=/); assert.match(t, /ProviderMascot id=\{p\.id\}/);
  const rows = src('components/TeamRows.jsx');
  assert.ok(!/ProviderMascot|Mascot3D/.test(rows), 'as equipes predefinidas não têm bonecos: só provider, modelo e esforço'); assert.match(rows, /<b className="tr-prov">\{labelOf\(slot\.provider\)\}<\/b>/); assert.match(rows, /slotChoiceLabels\(slot, options\)/); assert.match(rows, /describeSquad\(squad\)/);
  assert.match(src('main.jsx'), /import '\.\/teams\.css'/);
});
