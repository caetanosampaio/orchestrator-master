// Configurações > Equipes e estado vazio do Cockpit: lógica pura (squads.js) e ligação das telas. Sem rede e sem banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchPlan, slotOf, cleanSlots, slotOptions, presetSquads, builtinSquads, draftFromSquad, draftFromCopy, draftFromPreset, withProvider, applyMix, withSlot } from '../../client/src/squads.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('launchPlan: model/effort por vaga só entram quando alguma vaga os define (compatível com squads antigos)', () => {
  const old = launchPlan({ slots: [{ role: 'builder', provider: 'claude' }, { role: 'reviewer', provider: 'claude' }] });
  assert.deepEqual(old, { roles: ['builder', 'reviewer'], providers: ['claude', 'claude'], teamId: 'duo' });
  const plan = launchPlan({ slots: [{ role: 'builder', provider: 'codex', model: 'm1' }, { role: 'reviewer', provider: 'claude', effort: 'high' }] });
  assert.deepEqual(plan.models, ['m1', null]); assert.deepEqual(plan.efforts, [null, 'high']);
});

test('vagas limpas: model/effort vazios ("Padrão") somem; os definidos ficam', () => {
  assert.deepEqual(slotOf({ role: 'builder', provider: 'claude', model: '', effort: undefined, lixo: 1 }), { role: 'builder', provider: 'claude' });
  assert.deepEqual(cleanSlots([{ role: 'scout', provider: 'codex', model: 'x', effort: 'low' }]), [{ role: 'scout', provider: 'codex', model: 'x', effort: 'low' }]);
  assert.deepEqual(cleanSlots(null), []);
});

test('slotOptions: lê as opções do servidor por agente; ausente ou vazio = null (servidor antigo, sem seletores)', () => {
  const o = { claude: { models: [{ id: 'opus', label: 'Opus' }, { nope: 1 }], efforts: [{ id: 'high', label: 'Alto' }] }, codex: { models: [], efforts: [] } };
  assert.deepEqual(slotOptions(o, 'claude'), { models: [{ id: 'opus', label: 'Opus' }], efforts: [{ id: 'high', label: 'Alto' }] });
  assert.equal(slotOptions(o, 'codex'), null); assert.equal(slotOptions(o, 'outro'), null); assert.equal(slotOptions(null, 'claude'), null); assert.equal(slotOptions(undefined, 'claude'), null);
});

test('rascunho: editar mantém model/effort; duplicar zera o id e põe "(cópia)"; trocar o agente da vaga zera modelo e esforço', () => {
  const saved = { id: 't1', name: 'Minha', slots: [{ role: 'builder', provider: 'claude', model: 'opus', effort: 'high' }] };
  const d = draftFromSquad(saved);
  assert.equal(d.id, 't1'); assert.deepEqual(d.slots, saved.slots);
  const c = draftFromCopy(saved);
  assert.equal(c.id, null); assert.equal(c.name, 'Minha (cópia)'); assert.deepEqual(c.slots, saved.slots);
  assert.ok(draftFromCopy({ name: 'x'.repeat(60), slots: [] }).name.length <= 40);
  const w = withProvider(d, 0, 'codex'); assert.deepEqual(w.slots[0], { role: 'builder', provider: 'codex' });
  assert.equal(withProvider(d, 0, 'claude').slots[0].model, 'opus', 'mesmo agente: nada muda');
  assert.equal(withSlot(d, 0, { model: undefined }).slots[0].model, undefined);
  const mixed = applyMix({ ...d, slots: [{ role: 'builder', provider: 'claude', model: 'opus' }, { role: 'reviewer', provider: 'claude', effort: 'high' }] }, 'claude-leads', ['claude', 'codex']);
  assert.deepEqual(mixed.slots[0], { role: 'builder', provider: 'codex' }); assert.equal(mixed.slots[1].effort, 'high', 'quem continua no mesmo agente mantém a escolha');
  assert.deepEqual(draftFromPreset('squad', 'all-codex', ['claude', 'codex']).slots.map((s) => s.provider), ['codex', 'codex', 'codex', 'codex']);
});

test('equipes embutidas do estado vazio: presets simples com o agente padrão + mistas só com os dois agentes', () => {
  const p = presetSquads('codex');
  assert.deepEqual(p.map((x) => x.name), ['Dupla', 'Squad', 'Squad de 6', 'Construtor']);
  assert.ok(p.every((x) => x.builtin && x.id.startsWith('builtin:preset-') && x.slots.every((s) => s.provider === 'codex')));
  assert.equal(launchPlan(p[0]).teamId, 'duo');
  assert.equal(builtinSquads(['claude']).length, 0); assert.equal(builtinSquads(['claude', 'codex']).length, 3);
});

test('interface: Configurações > Times prontos e Arquivos, e o chip do Cockpit virou "Arquivos" na sidebar', () => {
  const st = ['pages/Settings.jsx', 'settings-nav.js', 'components/settings/SettingsUi.jsx', 'components/settings/AppSections.jsx', 'components/settings/TeamSections.jsx', 'components/settings/AisSection.jsx', 'components/settings/MascotsSection.jsx'].map(src).join('\n');
  assert.match(st, /item\('equipes', 'Times prontos'/); assert.match(st, /item\('arquivos', 'Arquivos'/); assert.match(st, /<TeamsSettings \/>/); assert.match(st, /onOpenWorkspaces/);
  const t = src('components/TeamsSettings.jsx');
  assert.match(t, /useSquads\(\)/); assert.match(t, /options: sq\.options/, 'modelo e esforço vêm do `options` do servidor'); assert.match(t, /draftFromCopy\(s\)/); assert.match(t, /cleanSlots\(draft\.slots\)/);
  const sb = src('components/Sidebar.jsx');
  assert.match(sb, /className="oc-side-files"[^>]*onClick=\{onOpenWorkspaces\}/); assert.match(sb, /<Icon name="folderOpen"[^>]*\/><span className="side-label">Arquivos<\/span>/);
  assert.ok(sb.indexOf('oc-side-files') < sb.indexOf('oc-side-user'), 'Arquivos fica acima do usuário');
  assert.match(src('App.jsx'), /<Settings key=\{settingsKey\} initial=\{settingsTab\} onClose=\{closeSettings\} onOpenWorkspaces=\{openWorkspaces\} \/>/);
  assert.match(src('tokens.css'), /--w-side: 188px;/);
  assert.match(src('use-squads.js'), /options/); assert.match(src('use-squads.js'), /forge:team-templates-changed/, 'o Cockpit recarrega a lista quando as Configurações a mudam');
});
