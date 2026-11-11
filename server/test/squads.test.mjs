// Squads no cliente (client/src/squads.js): modelos do FORGE, plano de abertura, rascunho do editor e validações. Lógica pura, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readyTeams, launchPlan, squadSummary, draftFromPreset, draftFromSquad, draftFromCopy, draftForInstall, withSlot, withProvider, withSlotSkill, removeSlot, addSlot, applyMix, draftOpenProblem, draftSaveProblem, slotOf, slotSkills, takesSkills, templateBody, templateIdOf, cleanInstruction, instructionProblem, MAX_SLOTS, MAX_NAME, MAX_SQUADS, MAX_INSTRUCTION, MAX_SLOT_SKILLS } from '../../client/src/squads.js';
import { inferTeam } from '../../client/src/team-view.js';

const BOTH = ['claude', 'codex'];
const label = { claude: 'Claude Code', codex: 'Codex CLI' };

// um time misto de exemplo (como o que vem de Configurações > Times prontos): o Claude coordena e revisa, o Codex constrói
const MIXED = { id: 'tpl_aaaaaaaa', name: 'Misto', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'codex' }, { role: 'builder', provider: 'codex' }, { role: 'reviewer', provider: 'claude' }] };
// presets como o GET /api/team-templates devolve (contrato: { id: 'preset:<slug>', name, tagline, about, instruction, slots })
const PRESET = { id: 'preset:web', name: 'Web e Frontend', tagline: 'Interface com testes.', about: 'Use para telas.', instruction: 'Foco em acessibilidade.', slots: [{ role: 'maestro', provider: 'claude', model: 'opus', effort: 'high' }, { role: 'builder', provider: 'claude', model: 'sonnet', effort: 'high', skills: ['frontend-design', 'qualidade-e-testes'] }] };

test('o Cockpit não traz mais times fixos: não há builtinSquads, presetSquads nem a lista fixa do cliente; os times prontos vêm do servidor (readyTeams)', async () => {
  const m = await import('../../client/src/squads.js');
  assert.equal(Object.hasOwn(m, 'builtinSquads'), false); assert.equal(Object.hasOwn(m, 'presetSquads'), false); assert.equal(Object.hasOwn(m, 'curatedSquads'), false, 'os times prontos não moram mais no cliente');
  assert.deepEqual(readyTeams(undefined), [], 'servidor antigo sem presets: lista vazia'); assert.deepEqual(readyTeams('x'), []);
  const [t] = readyTeams([PRESET]);
  assert.equal(t.id, 'preset:web'); assert.ok(t.builtin === true && t.curated === true); assert.equal(t.instruction, 'Foco em acessibilidade.'); assert.equal(t.tagline, 'Interface com testes.'); assert.equal(t.about, 'Use para telas.');
  assert.deepEqual(t.slots[1].skills, ['frontend-design', 'qualidade-e-testes']);
});

test('readyTeams: entrada estranha some (id fora do formato, repetido, sem nome, vaga quebrada) e cada chamada devolve cópias novas', () => {
  const list = readyTeams([PRESET, { ...PRESET }, { ...PRESET, id: 'builtin:x' }, { ...PRESET, id: 'preset:sem-nome', name: '' }, { ...PRESET, id: 'preset:quebrado', slots: [null] }, { ...PRESET, id: 'preset:vazio', slots: [] }, null]);
  assert.deepEqual(list.map((t) => t.id), ['preset:web']);
  const codex = readyTeams([{ ...PRESET, id: 'preset:cx', slots: [{ role: 'builder', provider: 'codex', skills: ['a'] }] }])[0];
  assert.equal(codex.slots[0].skills, undefined, 'vaga Codex não leva skills nem vindo do servidor');
  const a = readyTeams([PRESET]), b = readyTeams([PRESET]); a[0].slots[1].skills.push('x'); a[0].name = 'Mudou';
  assert.deepEqual(b[0].slots[1].skills, ['frontend-design', 'qualidade-e-testes']); assert.equal(b[0].name, 'Web e Frontend'); assert.deepEqual(PRESET.slots[1].skills, ['frontend-design', 'qualidade-e-testes'], 'o original não muda');
  const sujo = readyTeams([{ ...PRESET, id: 'preset:sujo', instruction: 'a & b | "c"\n`d`' }])[0];
  assert.equal(sujo.instruction, 'a b c d', 'mesma limpeza do servidor');
});

test('launchPlan: papéis e agentes na ordem; o preset só é gravado quando bate exatamente; templateId e slotIndexes para o servidor achar a vaga', () => {
  const p = launchPlan(MIXED);
  assert.deepEqual(p.roles, ['maestro', 'builder', 'builder', 'reviewer']); assert.deepEqual(p.providers, ['claude', 'codex', 'codex', 'claude']); assert.equal(p.teamId, 'squad');
  assert.equal(p.templateId, 'tpl_aaaaaaaa'); assert.deepEqual(p.slotIndexes, [0, 1, 2, 3]);
  assert.equal(launchPlan({ slots: [{ role: 'maestro', provider: 'claude' }, { role: 'scout', provider: 'codex' }] }).teamId, null, 'composição própria: sem preset');
  assert.deepEqual(launchPlan(null), { roles: [], providers: [], teamId: null, templateId: null, slotIndexes: [] });
  assert.equal(launchPlan(readyTeams([PRESET])[0]).templateId, 'preset:web', 'time pronto: o id do preset');
  const web = launchPlan(readyTeams([PRESET])[0]);
  assert.equal(web.teamId, inferTeam(['maestro', 'builder']), 'teamId continua sendo o layout inferido'); assert.notEqual(web.teamId, web.templateId, 'templateId é um campo novo, não o teamId');
  assert.equal(launchPlan({ id: 'tpl_bbbbbbbb', slots: [{ role: 'builder', provider: 'claude' }, { role: 'reviewer', provider: 'claude' }] }).teamId, 'duo');
  for (const id of ['builtin:forge-x', 'tpl_123', 'tpl_AAAAAAAA', 'preset:', 'preset:A B', null, 42]) assert.equal(templateIdOf({ id }), null, `${id}: fora do formato não vai ao servidor`);
  assert.equal(templateIdOf({ id: 'tpl_0123abcd' }), 'tpl_0123abcd'); assert.equal(templateIdOf({ id: 'preset:pesquisa-conteudo' }), 'preset:pesquisa-conteudo');
});

test('skills na vaga: slotOf guarda a lista (sem repetir, até 8), lista vazia some, Codex nunca leva; takesSkills respeita a capacidade informada', () => {
  assert.deepEqual(slotOf({ role: 'builder', provider: 'claude', skills: ['a', 'a', 'b', '', 3] }), { role: 'builder', provider: 'claude', skills: ['a', 'b'] });
  assert.deepEqual(slotOf({ role: 'builder', provider: 'claude', skills: [] }), { role: 'builder', provider: 'claude' });
  assert.deepEqual(slotOf({ role: 'builder', provider: 'codex', skills: ['a'] }), { role: 'builder', provider: 'codex' });
  assert.equal(slotOf({ role: 'builder', provider: 'claude', skills: Array.from({ length: 12 }, (_, i) => `s${i}`) }).skills.length, MAX_SLOT_SKILLS);
  assert.equal(takesSkills('claude'), true); assert.equal(takesSkills('codex'), false);
  assert.equal(takesSkills('codex', [{ id: 'codex', capabilities: { plugins: true } }]), true, 'a capacidade informada pelo servidor manda');
  assert.equal(takesSkills('claude', [{ id: 'claude', capabilities: { plugins: false } }]), false);
  assert.deepEqual(slotSkills({ provider: 'codex', skills: ['a'] }), []); assert.deepEqual(slotSkills({ provider: 'claude', skills: ['a'] }), ['a']); assert.deepEqual(slotSkills(null), []);
});

test('editor: marcar skills da vaga (limite de 8), trocar a vaga para Codex tira as skills, voltar ao mesmo agente não mexe; nada muta o original', () => {
  const d0 = { ...draftFromPreset('duo', 'all-claude', BOTH) }, snap = JSON.stringify(d0);
  const d1 = withSlotSkill(withSlotSkill(d0, 0, 'a'), 0, 'b');
  assert.deepEqual(d1.slots[0].skills, ['a', 'b']); assert.deepEqual(withSlotSkill(d1, 0, 'a').slots[0].skills, ['b'], 'desmarcar');
  assert.equal(withSlotSkill(withSlotSkill(d1, 0, 'a'), 0, 'b').slots[0].skills, undefined, 'desmarcar tudo: o campo some');
  let full = d0; for (let i = 0; i < MAX_SLOT_SKILLS; i++) full = withSlotSkill(full, 0, `s${i}`);
  assert.equal(withSlotSkill(full, 0, 'mais'), full, 'cheia: devolve o mesmo rascunho');
  const cx = withProvider(d1, 0, 'codex'); assert.deepEqual(cx.slots[0], { role: 'builder', provider: 'codex' }, 'Codex: sem skills, sem modelo e sem esforço');
  assert.equal(withSlotSkill(cx, 0, 'a'), cx, 'vaga Codex não recebe skill');
  assert.equal(withProvider(d1, 0, 'claude').slots[0], d1.slots[0], 'mesmo agente: nada muda');
  assert.deepEqual(applyMix(d1, 'all-codex', BOTH).slots.map((s) => s.skills), [undefined, undefined], 'o atalho para Codex também tira as skills');
  assert.deepEqual(applyMix(d1, 'all-claude', BOTH).slots[0].skills, ['a', 'b'], 'quem fica no mesmo agente mantém as skills');
  assert.equal(JSON.stringify(d0), snap);
});

test('instrução do time: rascunhos a carregam (editar, instalar e duplicar), a limpeza é a do servidor e o limite é 1500', () => {
  assert.equal(draftFromPreset('duo', 'all-claude', BOTH).instruction, '');
  const saved = { id: 'tpl_aaaaaaaa', name: 'Meu', instruction: 'Foco em testes.', slots: [{ role: 'builder', provider: 'claude', skills: ['a'] }] };
  for (const d of [draftFromSquad(saved), draftFromCopy(saved), draftForInstall({ ...saved, builtin: true }, [])]) { assert.equal(d.instruction, 'Foco em testes.'); assert.deepEqual(d.slots[0].skills, ['a']); }
  assert.equal(draftFromSquad({ id: 'tpl_aaaaaaaa', name: 'Antigo', slots: [] }).instruction, '', 'time antigo sem instrução');
  assert.equal(cleanInstruction(' a\n\nb  &  c​ "d" `e` %f^ <g> '), 'a b c d e f g');
  assert.equal(instructionProblem('x'.repeat(MAX_INSTRUCTION)), null); assert.match(instructionProblem('x'.repeat(MAX_INSTRUCTION + 1)), /no máximo 1500/);
  assert.equal(instructionProblem(`${'x'.repeat(MAX_INSTRUCTION)}\n\n\n`), null, 'conta depois de limpar');
  const base = { ...draftFromPreset('duo', 'all-claude', BOTH), name: 'Com instrução' };
  assert.match(draftSaveProblem({ ...base, instruction: 'y'.repeat(MAX_INSTRUCTION + 5) }, { available: BOTH, squads: [] }), /no máximo 1500/, 'não salva com instrução longa demais');
  assert.equal(draftSaveProblem({ ...base, instruction: 'curta' }, { available: BOTH, squads: [] }), null);
});

test('templateBody: corpo do POST/PUT com name, slots (com skills) e instruction só quando há; apagar a instrução de um time salvo manda null; skill fora do catálogo não vai', () => {
  const d = { id: null, name: '  Meu  time ', instruction: '  foco  ', slots: [{ role: 'builder', provider: 'claude', skills: ['a', 'sumiu'] }, { role: 'reviewer', provider: 'codex', skills: ['a'] }], mix: 'custom' };
  assert.deepEqual(templateBody(d), { name: 'Meu time', instruction: 'foco', slots: [{ role: 'builder', provider: 'claude', skills: ['a', 'sumiu'] }, { role: 'reviewer', provider: 'codex' }] });
  assert.deepEqual(templateBody(d, { catalogIds: ['a'] }).slots[0].skills, ['a']);
  assert.equal(templateBody({ ...d, slots: [{ role: 'builder', provider: 'claude', skills: ['sumiu'] }] }, { catalogIds: ['a'] }).slots[0].skills, undefined, 'sem nenhuma conhecida: o campo some');
  const sem = templateBody({ ...d, instruction: '   ' });
  assert.equal(Object.hasOwn(sem, 'instruction'), false, 'time novo sem instrução: o campo não vai (servidor estrito)');
  assert.equal(templateBody({ ...d, id: 'tpl_aaaaaaaa', instruction: '' }, { previous: { instruction: 'antiga' } }).instruction, null, 'apagou a instrução: null remove no PUT');
  assert.equal(Object.hasOwn(templateBody({ ...d, id: 'tpl_aaaaaaaa', instruction: '' }, { previous: { id: 'tpl_aaaaaaaa' } }), 'instruction'), false, 'time que nunca teve instrução: nada a remover');
  assert.equal(templateBody({ ...d, instruction: 'z'.repeat(2000) }).instruction.length, MAX_INSTRUCTION);
});

test('squadSummary: contagem de terminais e de agentes', () => {
  assert.equal(squadSummary(MIXED.slots, (id) => label[id]), '4 terminais · 2 Claude Code, 2 Codex CLI');
  assert.equal(squadSummary([{ role: 'builder', provider: 'codex' }], (id) => label[id]), '1 terminal · 1 Codex CLI');
});

test('rascunho: de preset (com atalho), vazio, de um squad salvo e de um embutido', () => {
  const d = draftFromPreset('squad', 'claude-leads', BOTH);
  assert.deepEqual(d.slots.map((s) => s.provider), ['claude', 'codex', 'codex', 'claude']); assert.equal(d.mix, 'claude-leads'); assert.equal(d.id, null); assert.equal(d.name, '');
  assert.deepEqual(draftFromPreset('empty', 'all-claude', BOTH).slots, []);
  const saved = draftFromSquad({ id: 'tpl_aaaaaaaa', name: 'Meu', slots: [{ role: 'builder', provider: 'codex' }] });
  assert.equal(saved.id, 'tpl_aaaaaaaa'); assert.equal(saved.name, 'Meu'); assert.equal(saved.mix, 'custom');
  const fromBuiltin = draftFromSquad({ ...MIXED, id: 'builtin:x', builtin: true });
  assert.equal(fromBuiltin.id, null, 'embutido vira um squad NOVO'); assert.equal(fromBuiltin.name, '');
});

test('edição do rascunho: trocar vaga, remover, adicionar (limite) e aplicar atalho; nada muta o original', () => {
  const d0 = draftFromPreset('duo', 'all-claude', BOTH); const snap = JSON.stringify(d0);
  const d1 = withSlot(d0, 0, { provider: 'codex' }); assert.equal(d1.slots[0].provider, 'codex'); assert.equal(d1.mix, 'custom');
  assert.equal(removeSlot(d1, 0).slots.length, 1);
  const d2 = addSlot(d0, BOTH, 'scout'); assert.deepEqual(d2.slots.at(-1), { role: 'scout', provider: 'claude' });
  let full = draftFromPreset('empty', 'all-claude', BOTH); for (let i = 0; i < MAX_SLOTS + 3; i++) full = addSlot(full, BOTH);
  assert.equal(full.slots.length, MAX_SLOTS, 'não passa do limite');
  const m = applyMix(draftFromPreset('squad', 'all-claude', BOTH), 'codex-leads', BOTH); assert.deepEqual(m.slots.map((s) => s.provider), ['codex', 'claude', 'claude', 'codex']);
  assert.equal(JSON.stringify(d0), snap, 'o rascunho original não foi alterado');
});

test('draftOpenProblem: sem vagas, vagas demais, sem espaço, agente indisponível e válido', () => {
  const ok = draftFromPreset('squad', 'claude-leads', BOTH);
  assert.equal(draftOpenProblem(ok, { available: BOTH, room: 10 }), null);
  assert.match(draftOpenProblem({ slots: [] }, { available: BOTH }), /ao menos uma vaga/);
  assert.match(draftOpenProblem(ok, { available: BOTH, room: 3 }), /4 vagas e há 3 livres/);
  assert.match(draftOpenProblem(ok, { available: ['claude'], room: 10 }), /"codex" não está disponível/);
  assert.match(draftOpenProblem({ slots: Array.from({ length: MAX_SLOTS + 1 }, () => ({ role: 'builder', provider: 'claude' })) }, { available: BOTH }), /no máximo/);
});

test('draftSaveProblem: nome obrigatório, tamanho, duplicado (sem diferenciar maiúsculas, exceto o próprio) e limite de squads', () => {
  const base = { ...draftFromPreset('squad', 'claude-leads', BOTH), name: 'Meu time' };
  const squads = [{ id: 'tpl_aaaaaaaa', name: 'Outro' }, { id: 'tpl_bbbbbbbb', name: 'Meu Time' }];
  assert.equal(draftSaveProblem({ ...base, name: 'Novo' }, { available: BOTH, squads }), null);
  assert.match(draftSaveProblem({ ...base, name: '   ' }, { available: BOTH, squads }), /Dê um nome/);
  assert.match(draftSaveProblem({ ...base, name: 'x'.repeat(MAX_NAME + 1) }, { available: BOTH, squads }), /no máximo 40/);
  assert.match(draftSaveProblem(base, { available: BOTH, squads }), /Já existe/, 'mesmo nome em outra caixa');
  assert.equal(draftSaveProblem({ ...base, id: 'tpl_bbbbbbbb' }, { available: BOTH, squads }), null, 'editar o próprio squad com o mesmo nome é permitido');
  const many = Array.from({ length: MAX_SQUADS }, (_, i) => ({ id: `tpl_${String(i).padStart(8, '0')}`, name: `S${i}` }));
  assert.match(draftSaveProblem({ ...base, name: 'Um a mais' }, { available: BOTH, squads: many }), /Limite/);
  assert.equal(draftSaveProblem({ ...base, id: many[0].id, name: 'Renomeado' }, { available: BOTH, squads: many }), null, 'editar não esbarra no limite');
  assert.match(draftSaveProblem({ ...base, slots: [] }, { available: BOTH, squads }), /ao menos uma vaga/);
});

import { inferAgents } from '../../client/src/squads.js';
const S = (role, provider, status = 'running') => ({ role, provider, status });

test('inferAgents: trocar o preset acompanha a equipe atual (Dupla mista -> Squad)', () => {
  const duoMix = [S('builder', 'codex'), S('reviewer', 'claude')];
  assert.deepEqual(inferAgents(['maestro', 'builder'], duoMix, 'claude'), ['claude', 'codex'], 'Maestro como quem revisa (Claude), Construtor como o que já existe (Codex)');
  assert.deepEqual(inferAgents(['maestro', 'scout', 'builder', 'builder'], duoMix, 'claude'), ['claude', 'claude', 'codex', 'codex']);
});

test('inferAgents: equipe de um agente só segue o mesmo; sem terminais ou sem pista usa o padrão; sessão antiga vale Claude', () => {
  assert.deepEqual(inferAgents(['maestro', 'builder'], [S('builder', 'codex'), S('reviewer', 'codex')], 'claude'), ['codex', 'codex']);
  assert.deepEqual(inferAgents(['maestro'], [], 'codex'), ['codex'], 'sem terminais: o padrão');
  assert.deepEqual(inferAgents(['maestro'], [{ role: 'builder', status: 'running' }], 'codex'), ['claude'], 'sem o campo provider = Claude Code (equipe de um agente só)');
  // mista sem ninguém do mesmo tipo: cai no padrão
  assert.deepEqual(inferAgents(['reviewer'], [S('builder', 'codex'), S('builder', 'claude')], 'codex'), ['codex']);
});

test('inferAgents: só conta terminal em execução e o mesmo papel pela maioria', () => {
  assert.deepEqual(inferAgents(['builder'], [S('builder', 'codex', 'exited'), S('builder', 'claude')], 'codex'), ['claude'], 'encerrado não conta');
  assert.deepEqual(inferAgents(['builder'], [S('builder', 'codex'), S('builder', 'codex'), S('builder', 'claude'), S('reviewer', 'claude')], 'claude'), ['codex'], 'maioria entre os do mesmo papel');
  assert.deepEqual(inferAgents(null, null), []); assert.deepEqual(inferAgents(['x'], undefined, 'codex'), ['codex']);
});

import { teamChangePlan, applyCloseChoice } from '../../client/src/squads.js';
const T = (id, role, provider = 'claude', status = 'running') => ({ id, role, provider, status });
const SQUAD_LIVE = [T('t1', 'maestro'), T('t2', 'builder', 'codex'), T('t3', 'builder', 'codex'), T('t4', 'reviewer')];
const ids = (l) => l.map((s) => s.id);

test('teamChangePlan: Squad -> Dupla fecha o que sobra (Maestro e um Construtor) e não abre nada', () => {
  const p = teamChangePlan(['builder', 'reviewer'], SQUAD_LIVE);
  assert.deepEqual(ids(p.close).sort(), ['t1', 't3']); assert.deepEqual(ids(p.keep).sort(), ['t2', 't4']); assert.deepEqual(p.openRoles, []);
});

test('teamChangePlan: quem está trabalhando fica; senão os mais antigos', () => {
  const stateOf = (s) => (s.id === 't3' ? 'working' : 'idle');
  const p = teamChangePlan(['builder', 'reviewer'], SQUAD_LIVE, stateOf);
  assert.deepEqual(ids(p.close).sort(), ['t1', 't2'], 'o Construtor em execução (t3) fica; o ocioso e o Maestro fecham');
});

test('teamChangePlan: crescer só abre o que falta; trocar de composição fecha e abre; encerrado não conta', () => {
  const duo = [T('a', 'builder', 'codex'), T('b', 'reviewer')];
  const up = teamChangePlan(['maestro', 'builder', 'builder', 'reviewer'], duo);
  assert.deepEqual(up.close, []); assert.deepEqual(up.openRoles, ['maestro', 'builder']);
  const swap = teamChangePlan(['builder'], [T('m', 'maestro'), T('r', 'reviewer')]);
  assert.deepEqual(ids(swap.close).sort(), ['m', 'r']); assert.deepEqual(swap.openRoles, ['builder']);
  assert.deepEqual(teamChangePlan(['builder'], [T('x', 'builder', 'claude', 'exited')]).openRoles, ['builder'], 'terminal encerrado não conta como existente');
  assert.deepEqual(teamChangePlan(['builder'], []), { keep: [], close: [], openRoles: ['builder'] });
  assert.deepEqual(teamChangePlan(null, null), { keep: [], close: [], openRoles: [] });
});

test('applyCloseChoice: trocar quem fica recalcula o que abrir; manter demais bloqueia', () => {
  const dupla = ['builder', 'reviewer'];
  const ok = applyCloseChoice(dupla, SQUAD_LIVE, ['t1', 't2']);
  assert.deepEqual(ids(ok.kept).sort(), ['t3', 't4']); assert.deepEqual(ids(ok.closing).sort(), ['t1', 't2']); assert.deepEqual(ok.openRoles, []); assert.deepEqual(ok.over, []);
  const tooMany = applyCloseChoice(dupla, SQUAD_LIVE, ['t1']);
  assert.deepEqual(tooMany.over, [{ role: 'builder', have: 2, max: 1 }], 'manteria 2 Construtores numa equipe de 1');
  const outsider = applyCloseChoice(dupla, SQUAD_LIVE, ['t2', 't3']);
  assert.deepEqual(outsider.over, [{ role: 'maestro', have: 1, max: 0 }], 'Maestro não existe na Dupla');
  const fewer = applyCloseChoice(dupla, SQUAD_LIVE, ['t1', 't2', 't3', 't4']);
  assert.deepEqual(fewer.openRoles, ['builder', 'reviewer'], 'fechando tudo, a equipe nova abre inteira');
});
