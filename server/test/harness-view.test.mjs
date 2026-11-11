// "Quem faz cada tarefa" no cliente (harness-view.js, use-harness.js, components/harness/*) e o mascote próprio do FORGE (forge-mascot.js). Lógica pura e leitura do código; sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { effortBars, effortLevel, modelLabel, effortLabel, filterRows, groupRows, changedFields, skillChoices, agentName, snippet, filterChoices, EFFORT_SEGMENTS } from '../../client/src/harness-view.js';
import { FORGE_SHAPES, FORGE_BOX, SPARK_SHAPES, SPARK_BOX } from '../../client/src/forge-mascot.js';
import { itemById } from '../../client/src/settings-nav.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const options = { claude: { models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: [{ id: 'medium', label: 'Médio' }, { id: 'max', label: 'Máximo' }] }, codex: { models: [{ id: 'gpt-5', label: 'GPT-5' }], efforts: [] } };
const rows = [
  { id: 'a', group: 'Dev', effective: { provider: 'claude', model: 'sonnet', effort: 'medium', skills: ['x'], agentId: null }, defaults: { provider: 'claude', model: 'sonnet', effort: 'medium', skills: ['x'], agentId: null }, customized: false },
  { id: 'b', group: 'Dev', effective: { provider: 'codex', model: 'gpt-5', effort: 'high', skills: [], agentId: 'agt_1' }, defaults: { provider: 'claude', model: 'sonnet', effort: 'medium', skills: ['x'], agentId: null }, customized: true },
  { id: 'c', group: 'Texto', effective: { provider: 'claude', model: null, effort: null, skills: [], agentId: null }, defaults: { provider: 'claude', model: 'haiku', effort: 'low', skills: [], agentId: null }, customized: true },
];

test('esforço: cinco segmentos, do baixo ao máximo; desconhecido ou padrão não acende nenhum', () => {
  assert.equal(EFFORT_SEGMENTS, 5); assert.deepEqual(effortBars('low'), [true, false, false, false, false]); assert.deepEqual(effortBars('high'), [true, true, true, false, false]); assert.deepEqual(effortBars('max'), [true, true, true, true, true]);
  for (const x of [null, undefined, 'turbo', '']) { assert.equal(effortLevel(x), 0); assert.ok(effortBars(x).every((b) => b === false)); }
});

test('rótulos: o do servidor, o id fora da lista e "padrão" quando não há', () => {
  assert.equal(modelLabel(options, 'claude', 'sonnet'), 'Sonnet'); assert.equal(modelLabel(options, 'claude', 'antigo'), 'antigo'); assert.equal(modelLabel(options, 'claude', null), 'padrão da CLI'); assert.equal(modelLabel(null, 'x', 'm'), 'm');
  assert.equal(effortLabel(options, 'claude', 'max'), 'máximo'); assert.equal(effortLabel(options, 'claude', null), 'padrão'); assert.equal(effortLabel(options, 'codex', 'high'), 'high');
});

test('tabela: filtro por IA, grupos na ordem do servidor (grupo vazio some), o que mudou em relação ao padrão', () => {
  assert.deepEqual(filterRows(rows, null).map((r) => r.id), ['a', 'b', 'c']); assert.deepEqual(filterRows(rows, 'codex').map((r) => r.id), ['b']); assert.deepEqual(filterRows(rows, 'gemini'), []); assert.deepEqual(filterRows(null, 'x'), []);
  assert.deepEqual(groupRows(rows, ['Texto', 'Dev', 'Vazio']).map((g) => [g.group, g.rows.length]), [['Texto', 1], ['Dev', 2]]); assert.deepEqual(groupRows(null, null), []);
  assert.deepEqual(changedFields(rows[0]), []); assert.deepEqual(changedFields(rows[1]), ['IA', 'modelo', 'esforço', 'skills', 'agente']); assert.deepEqual(changedFields(rows[2]), ['modelo', 'esforço']); assert.deepEqual(changedFields(null), []);
});

test('apoio: skills do catálogo, agente escolhido, resumo e as IAs do filtro', () => {
  assert.deepEqual(skillChoices({ skills: [{ id: 'a' }, { id: 'b' }] }), ['a', 'b']); assert.deepEqual(skillChoices(null), []);
  const agents = [{ id: 'agt_1', name: 'Rigoroso' }]; assert.equal(agentName(agents, 'agt_1', 'padrão'), 'Rigoroso'); assert.equal(agentName(agents, null, 'padrão'), 'padrão'); assert.equal(agentName(agents, 'agt_2', 'padrão'), 'padrão');
  assert.equal(snippet('  um   texto\ncurto '), 'um texto curto'); assert.equal(snippet('x'.repeat(200), 50).length, 50); assert.ok(snippet('x'.repeat(200), 50).endsWith('…'));
  assert.deepEqual(filterChoices({ providers: ['claude', 'codex'] }, [{ id: 'codex', label: 'Codex CLI' }]), [{ id: 'claude', label: 'claude' }, { id: 'codex', label: 'Codex CLI' }]);
});

test('o Forjador: arte própria (bigorna com chama, rosto de brasa, martelo e faíscas), tudo dentro do quadro; as faíscas têm olhos; nada vem do mascote das IAs', () => {
  const inBox = (shapes, box) => { for (const s of shapes) { if (s.t === 'rect') assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= box.w + 0.001 && s.y + s.h <= box.h + 0.001 && s.w > 0 && s.h > 0, `${s.cls} fora do quadro`); else for (const [x, y] of s.pts.split(' ').map((p) => p.split(',').map(Number))) assert.ok(x >= 0 && y >= 0 && x <= box.w && y <= box.h, `${s.cls} fora do quadro`); } };
  inBox(FORGE_SHAPES, FORGE_BOX); inBox(SPARK_SHAPES, SPARK_BOX);
  const cls = (list) => new Set(list.map((s) => s.cls));
  for (const k of ['steel', 'steel-hi', 'steel-lo', 'steel-dk', 'flame', 'flame-in', 'flame-hot', 'gold', 'ember', 'wood']) assert.ok(cls(FORGE_SHAPES).has(k), `falta ${k}`);
  assert.equal(SPARK_SHAPES.filter((s) => s.cls === 'eye').length, 2);
  const px = src('pixel-mascot.js'); assert.ok(!/forge|steel|ember/i.test(px.replace(/\/\/[^\n]*/g, '')), 'o mascote das IAs não tem peças do Forjador');
  const css = src('harness.css'); for (const k of ['fm-steel', 'fm-ember', 'fm-gold', 'fm-flame', 'fm-wood', 'fm-eye']) assert.match(css, new RegExp(`\\.${k}\\b`));
  assert.match(src('components/settings/MascotsSection.jsx'), /ForgeMascot size=\{120\}/, 'o FORGE usa o Forjador na página de mascotes');
});

test('página: seção Quem faz cada tarefa na navegação (com o próprio cabeçalho), hook ligado às rotas, introdução, Maestro, tabela com filtro/editor, agentes e compartilhar', () => {
  const it = itemById('tarefas'); assert.equal(it.label, 'Quem faz cada tarefa'); assert.equal(it.tag, 'Harness'); assert.equal(it.own, true);
  assert.match(src('pages/Settings.jsx'), /tarefas: <HarnessSection \/>/); assert.match(src('main.jsx'), /import '\.\/harness\.css'/);
  const hook = src('use-harness.js'); for (const r of ["'/api/harness'", "'/api/harness/pilot'", '`/api/harness/rows/${id}`', "'/api/harness/rows'", "'/api/harness/agents'", '`/api/harness/agents/${id}`', "'/api/harness/export'", "'/api/harness/import'"]) assert.ok(hook.includes(r), `o hook não usa ${r}`);
  const sec = src('components/harness/HarnessSection.jsx'), parts = src('components/harness/HarnessParts.jsx');
  for (const t of ['Quem faz cada tarefa', 'O Maestro', 'Os ajudantes, por tipo de tarefa', 'Ver os seus agentes', 'Compartilhar', 'Restaurar a tabela']) assert.ok(sec.includes(t), `falta "${t}"`);
  for (const t of ['Tipo de tarefa', 'Quanto pensa', 'Skills', 'Modelo']) assert.ok(sec.includes(t) || parts.includes(t), `falta a coluna "${t}"`);
  assert.match(sec, /h\.setPilot\(\{ provider: v \}\)/); assert.match(sec, /h\.setRow\(r\.id, p\)/); assert.match(sec, /h\.createAgent\(n, i\)/); assert.match(sec, /h\.importCode\(code\)/);
  assert.match(parts, /<ForgeScene size=\{116\} \/>/); assert.match(parts, /window\.confirm\('Importar substitui/, 'importar pede confirmação'); assert.match(parts, /navigator\.clipboard\.writeText\(code\)/);
  assert.ok(!/dangerouslySetInnerHTML/.test(sec + parts), 'texto de agente nunca vira HTML');
});

test('painel de edição ÚNICO: o mesmo desenho no Maestro, nas linhas da tabela, nos agentes, no compartilhar e no editor de times; cada ajuste numa linha com nome e dica', () => {
  const ui = src('components/settings/SettingsUi.jsx'), parts = src('components/harness/HarnessParts.jsx'), sec = src('components/harness/HarnessSection.jsx'), cmp = src('components/TeamComposer.jsx'), css = src('settings.css');
  for (const c of ['EditPanel', 'EditRow', 'Pills', 'Steps', 'SelectBox', 'CheckChips', 'TextField', 'TextArea']) assert.match(ui, new RegExp(`export (?:function|const) ${c}\\b`), `falta ${c}`);
  for (const k of ['ep-head', 'ep-row', 'ep-label', 'ep-foot', 'ep-pills', 'ep-steps', 'ep-select', 'ep-chips', 'ep-input', 'ep-slot']) assert.match(css, new RegExp(`\\.${k}\\b`), `falta a regra .${k}`);
  assert.match(parts, /<EditPanel title=\{`Ajustar: \$\{row\.label\}`\}/); for (const l of ['label="IA"', 'label="Modelo"', 'label="Quanto pensa"', 'label="Agente"', 'label="Skills"']) assert.ok(parts.includes(l), `a linha da tabela não tem ${l}`);
  assert.match(sec, /<EditPanel title="Ajustar o Maestro"/); for (const l of ['label="Reserva"', 'label="Quanto pensa"']) assert.ok(sec.includes(l));
  assert.match(parts, /<EditPanel title=\{form\.id \? 'Editar agente' : 'Novo agente'\}/); assert.match(parts, /<EditPanel title="Compartilhar"/); assert.match(cmp, /<EditPanel title=\{heading \?\? 'Montar o time'\}/);
  for (const t of ['Adicionar vaga', 'Salvar squad', 'Abrir equipe', 'Começar de', 'Modelo da vaga', 'Esforço da vaga']) assert.ok(cmp.includes(t), `o editor de times perdeu "${t}"`);
  for (const f of ['components/harness/HarnessParts.jsx', 'components/harness/HarnessSection.jsx', 'components/TeamComposer.jsx']) assert.ok(!/<select|hz-edit-grid|oc-compose/.test(src(f)), `${f} ainda tem controle fora do painel único`);
  assert.match(css, /:where\(\.set-body\) :where\(select, input\[type="text"\]/, 'os campos soltos das Configurações seguem o mesmo desenho'); assert.ok(!/preserve-3d/.test(css));
  const h = src('harness.css'); assert.ok(!/\.hz-edit|\.hz-share/.test(h), 'os estilos dos editores antigos saíram');
});
