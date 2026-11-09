// Squads no cliente (client/src/squads.js): modelos do FORGE, plano de abertura, rascunho do editor e validações. Lógica pura, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinSquads, launchPlan, squadSummary, draftFromPreset, draftFromSquad, withSlot, removeSlot, addSlot, applyMix, draftOpenProblem, draftSaveProblem, MAX_SLOTS, MAX_NAME, MAX_SQUADS } from '../../client/src/squads.js';

const BOTH = ['claude', 'codex'];
const label = { claude: 'Claude Code', codex: 'Codex CLI' };

test('builtinSquads: só com Claude e Codex; o Claude coordena/revisa/investiga e o Codex constrói', () => {
  assert.deepEqual(builtinSquads(['claude']), []); assert.deepEqual(builtinSquads(['codex']), []); assert.deepEqual(builtinSquads([]), []);
  const b = builtinSquads(BOTH);
  assert.deepEqual(b.map((s) => s.name), ['Dupla mista', 'Squad misto', 'Squad de 6 misto']);
  assert.ok(b.every((s) => s.builtin === true && s.id.startsWith('builtin:') && s.tagline));
  assert.deepEqual(b[1].slots, [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'codex' }, { role: 'builder', provider: 'codex' }, { role: 'reviewer', provider: 'claude' }]);
  assert.deepEqual(b[2].slots.map((s) => `${s.role}:${s.provider}`), ['maestro:claude', 'scout:claude', 'builder:codex', 'builder:codex', 'builder:codex', 'reviewer:claude']);
});

test('launchPlan: papéis e agentes na ordem; o preset só é gravado quando bate exatamente', () => {
  const p = launchPlan(builtinSquads(BOTH)[1]);
  assert.deepEqual(p.roles, ['maestro', 'builder', 'builder', 'reviewer']); assert.deepEqual(p.providers, ['claude', 'codex', 'codex', 'claude']); assert.equal(p.teamId, 'squad');
  assert.equal(launchPlan({ slots: [{ role: 'maestro', provider: 'claude' }, { role: 'scout', provider: 'codex' }] }).teamId, null, 'composição própria: sem preset');
  assert.deepEqual(launchPlan(null), { roles: [], providers: [], teamId: null });
});

test('squadSummary: contagem de terminais e de agentes', () => {
  assert.equal(squadSummary(builtinSquads(BOTH)[1].slots, (id) => label[id]), '4 terminais · 2 Claude Code, 2 Codex CLI');
  assert.equal(squadSummary([{ role: 'builder', provider: 'codex' }], (id) => label[id]), '1 terminal · 1 Codex CLI');
});

test('rascunho: de preset (com atalho), vazio, de um squad salvo e de um embutido', () => {
  const d = draftFromPreset('squad', 'claude-leads', BOTH);
  assert.deepEqual(d.slots.map((s) => s.provider), ['claude', 'codex', 'codex', 'claude']); assert.equal(d.mix, 'claude-leads'); assert.equal(d.id, null); assert.equal(d.name, '');
  assert.deepEqual(draftFromPreset('empty', 'all-claude', BOTH).slots, []);
  const saved = draftFromSquad({ id: 'tpl_aaaaaaaa', name: 'Meu', slots: [{ role: 'builder', provider: 'codex' }] });
  assert.equal(saved.id, 'tpl_aaaaaaaa'); assert.equal(saved.name, 'Meu'); assert.equal(saved.mix, 'custom');
  const fromBuiltin = draftFromSquad(builtinSquads(BOTH)[0]);
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
