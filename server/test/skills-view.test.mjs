// Skills no cliente (skills-view.js, use-skills.js, components/settings/SkillsSection.jsx): lógica pura, a ligação com as rotas e a estrutura da página. Só as skills que existem no catálogo do servidor. Sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { callName, rolesLoading, tasksUsing, toggleSkill, diffFromDefault, firstSentence, filterByRole, summary, ROLE_ORDER, skillGroup, groupLabel, skillSource, catalogSkills, groupSkills } from '../../client/src/skills-view.js';
import { itemById, filterNav } from '../../client/src/settings-nav.js';
import { SKILLS, ROLE_DEFAULTS } from '../../server/loadouts.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const loadouts = {
  roles: { maestro: { skills: ['a', 'b'], defaults: ['a'], customized: true }, builder: { skills: ['a', 'c'], defaults: ['a', 'c'], customized: false }, estranho: { skills: ['c'], defaults: [], customized: false } },
  catalog: { skills: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }, limits: { maxSkillsPerRole: 3 },
};
const rows = [{ id: 'x', label: 'Tarefa X', effective: { skills: ['a', 'c'] } }, { id: 'y', label: 'Tarefa Y', effective: { skills: ['c'] } }, { id: 'z', label: 'Sem skill', effective: { skills: [] } }];

test('papéis e tabela: quem recebe cada skill (ordem de exibição, papel desconhecido por último) e onde a tabela a cita', () => {
  assert.deepEqual(ROLE_ORDER, ['maestro', 'builder', 'reviewer', 'scout']);
  assert.deepEqual(rolesLoading(loadouts, 'a'), ['maestro', 'builder']); assert.deepEqual(rolesLoading(loadouts, 'c'), ['builder', 'estranho']); assert.deepEqual(rolesLoading(loadouts, 'd'), []); assert.deepEqual(rolesLoading(null, 'a'), []);
  assert.deepEqual(tasksUsing(rows, 'c').map((t) => t.id), ['x', 'y']); assert.deepEqual(tasksUsing(rows, 'd'), []); assert.deepEqual(tasksUsing(null, 'a'), []);
  assert.equal(callName('mapear-codigo'), '/squad:mapear-codigo');
});

test('marcar e desmarcar: respeita o limite (null quando estoura), não repete e nunca muda a lista original', () => {
  const l = ['a', 'b']; assert.deepEqual(toggleSkill(l, 'c', 3), ['a', 'b', 'c']); assert.equal(toggleSkill(['a', 'b', 'c'], 'd', 3), null, 'acima do limite'); assert.deepEqual(toggleSkill(['a', 'b', 'c'], 'b', 3), ['a', 'c'], 'desmarcar sempre pode');
  assert.deepEqual(l, ['a', 'b']); assert.deepEqual(toggleSkill(null, 'a'), ['a']); assert.deepEqual(toggleSkill(['a'], 'a'), []);
});

test('diferença do padrão, primeira frase, filtro por papel e o resumo do topo', () => {
  assert.deepEqual(diffFromDefault(loadouts.roles.maestro), { added: ['b'], removed: [] }); assert.deepEqual(diffFromDefault({ skills: ['a'], defaults: ['a', 'c'] }), { added: [], removed: ['c'] }); assert.deepEqual(diffFromDefault(null), { added: [], removed: [] });
  assert.equal(firstSentence('Uma frase. Outra frase.'), 'Uma frase.'); assert.equal(firstSentence('  sem   ponto final '), 'sem ponto final'); assert.equal(firstSentence('x'.repeat(300), 50).length, 50); assert.equal(firstSentence(null), '');
  assert.deepEqual(filterByRole(loadouts.catalog.skills, loadouts, 'maestro').map((s) => s.id), ['a', 'b']); assert.equal(filterByRole(loadouts.catalog.skills, loadouts, null).length, 4); assert.deepEqual(filterByRole(null, null, 'x'), []);
  assert.deepEqual(summary(loadouts, rows), { skills: 4, roles: 3, inTable: 2, customized: 1 }); assert.deepEqual(summary(null, null), { skills: 0, roles: 0, inTable: 0, customized: 0 });
});

test('o que a tela mostra existe de verdade: os papéis e as skills do catálogo do servidor, nada inventado', () => {
  assert.deepEqual(ROLE_ORDER, Object.keys(ROLE_DEFAULTS)); assert.equal(Object.keys(SKILLS).length, 16, 'catálogo da Fase 1: 8 de processo + 8 da biblioteca');
  const sec = src('components/settings/SkillsSection.jsx'); for (const id of Object.keys(SKILLS)) assert.ok(!sec.includes(`'${id}'`), `${id} não deve estar escrita na tela: ela vem do servidor`);
  for (const t of ['list_panes', 'list_tasks', 'report_done', 'send_task', 'read_pane_output', 'list_routes']) assert.ok(sec.includes(t), `o servidor MCP cita ${t}`);
});

test('grupo e origem: Processo/Domínio (sem o campo = Processo), vendorizadas com origem e licença, catálogo enxuto para os seletores e grupos na ordem', () => {
  assert.equal(skillGroup({ group: 'dominio' }), 'dominio'); assert.equal(skillGroup({ group: 'processo' }), 'processo'); assert.equal(skillGroup({}), 'processo', 'servidor antigo'); assert.equal(skillGroup({ group: 'outro' }), 'processo'); assert.equal(skillGroup(null), 'processo');
  assert.equal(groupLabel('dominio'), 'Domínio'); assert.equal(groupLabel('processo'), 'Processo'); assert.equal(groupLabel('x'), 'Processo');
  assert.deepEqual(skillSource({ source: 'vendored', origin: ' anthropics/x\nfrontend-design 1.1.1 ', license: 'Apache-2.0' }), { vendored: true, origin: 'anthropics/x frontend-design 1.1.1', license: 'Apache-2.0' });
  assert.deepEqual(skillSource({ source: 'vendored' }), { vendored: true, origin: null, license: null });
  assert.deepEqual(skillSource({ source: 'forge', origin: 'ignorado', license: 'MIT' }), { vendored: false, origin: null, license: null }, 'as do FORGE não mostram origem');
  const cat = catalogSkills({ catalog: { skills: [{ id: 'b', description: 'B.', body: 'longo', group: 'dominio' }, { id: 'a' }, null, { id: '' }, { description: 'sem id' }] } });
  assert.deepEqual(cat.map((s) => [s.id, s.group]), [['b', 'dominio'], ['a', 'processo']]); assert.equal(Object.hasOwn(cat[0], 'body'), false, 'o seletor não carrega o texto longo'); assert.equal(cat[1].description, '');
  assert.deepEqual(catalogSkills(null), []);
  assert.deepEqual(groupSkills(cat).map((g) => [g.id, g.label, g.skills.map((s) => s.id)]), [['processo', 'Processo', ['a']], ['dominio', 'Domínio', ['b']]]);
  assert.deepEqual(groupSkills([{ id: 'x' }]).map((g) => g.id), ['processo'], 'grupo vazio não aparece'); assert.deepEqual(groupSkills(null), []);
});

test('catálogo do servidor: cada skill tem grupo e as vendorizadas trazem origem e licença (contrato da Fase 1)', async () => {
  const { loadoutView } = await import('../../server/loadouts.js');
  const list = loadoutView({}).catalog.skills;
  assert.equal(list.length, 16);
  for (const s of list) { assert.ok(['processo', 'dominio'].includes(s.group), `${s.id}: grupo`); if (s.source === 'vendored') assert.ok(skillSource(s).origin && skillSource(s).license, `${s.id}: origem e licença`); }
  assert.ok(groupSkills(catalogSkills({ catalog: { skills: list } })).length === 2, 'os dois grupos aparecem');
});

test('página Skills: na navegação (com o próprio cabeçalho), hook ligado a /api/loadouts e /api/harness, resumo, por papel, catálogo com o texto e o servidor MCP', () => {
  const it = itemById('skills'); assert.equal(it.label, 'Skills'); assert.equal(it.tag, 'Squad'); assert.equal(it.own, true); assert.ok(filterNav('skill').flatMap((g) => g.items.map((i) => i.id)).includes('skills'));
  assert.match(src('pages/Settings.jsx'), /skills: <SkillsSection go=\{setTab\} \/>/); assert.match(src('main.jsx'), /import '\.\/skills\.css'/);
  const hook = src('use-skills.js'); assert.ok(hook.includes("'/api/loadouts'") && hook.includes("'/api/harness'")); assert.match(hook, /api\.put\('\/api\/loadouts', body\)/); assert.match(hook, /\{ role, reset: true \}/);
  const sec = src('components/settings/SkillsSection.jsx');
  for (const t of ['Por papel', 'Catálogo', 'Servidor MCP do FORGE', 'O que cada papel recebe', 'Ver o texto que o agente recebe', 'Restaurar o padrão de', 'citadas na tabela']) assert.ok(sec.includes(t), `falta "${t}"`);
  assert.match(sec, /<EditPanel title="O que cada papel recebe"/); assert.match(sec, /<CheckChips label=\{`Skills de \$\{role\.label\}`\}/); assert.match(sec, /go\?\.\('tarefas'\)/, 'a skill leva à tabela Quem faz cada tarefa');
  assert.match(sec, /groupLabel\(skillGroup\(skill\)\)/, 'cada cartão mostra o grupo'); assert.match(sec, /groupSkills\(list\)/, 'o catálogo vem separado por Processo e Domínio');
  assert.match(sec, /src\.vendored && <div><dt>Origem<\/dt>/); assert.match(sec, /src\.vendored && <div><dt>Licença<\/dt>/, 'as de terceiros mostram origem e licença');
  assert.match(src('use-skills.js'), /export function useSkillCatalog\(\)/); assert.match(src('use-skills.js'), /setSkills\(catalogSkills\(l\)\)/, 'o editor de times usa o mesmo catálogo');
  assert.match(sec, /<pre>\{skill\.body\}<\/pre>/); assert.ok(!/dangerouslySetInnerHTML/.test(sec), 'o texto da skill nunca vira HTML');
  const css = src('skills.css'); for (const k of ['sk-stats', 'sk-card', 'sk-role', 'sk-body', 'sk-mcp', 'sk-toggle']) assert.match(css, new RegExp(`\\.${k}\\b`), `falta .${k}`);
});
