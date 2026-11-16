// role/tier opcionais nas etapas do plano (cycle-schema.js). Puro: sem processos, banco ou modelo.
import test from 'node:test';
import assert from 'node:assert/strict';

const { validatePlanSteps, validateDecision } = await import('../cycle-schema.js');
const { ROLES, TIER_NAMES } = await import('../tiers.js');

const step = (extra = {}, id = 's1') => ({ id, title: 'Título', instructions: 'Instruções', acceptance: ['o arquivo src/a.js existe'], dependsOn: [], ...extra });
const plan = (steps) => JSON.stringify({ decision: 'plan', rationale: 'r', steps });

test('role e tier válidos entram no objeto da etapa; ausentes NÃO deixam rastro (plano antigo idêntico)', () => {
  const old = validatePlanSteps([step()]); assert.equal(old.ok, true);
  assert.deepEqual(old.steps[0], { id: 's1', title: 'Título', instructions: 'Instruções', acceptance: ['o arquivo src/a.js existe'], dependsOn: [] });
  assert.ok(!('role' in old.steps[0]) && !('tier' in old.steps[0]));
  for (const role of ROLES) for (const tier of TIER_NAMES) {
    const r = validatePlanSteps([step({ role, tier })]); assert.equal(r.ok, true, `${role}/${tier}`); assert.equal(r.steps[0].role, role); assert.equal(r.steps[0].tier, tier);
  }
  const only = validatePlanSteps([step({ tier: 'leve' }), step({ role: 'docs' }, 's2')]); assert.equal(only.ok, true);
  assert.deepEqual(only.steps[0], { ...old.steps[0], tier: 'leve' }); assert.deepEqual(only.steps[1], { ...old.steps[0], id: 's2', role: 'docs' });
  assert.deepEqual(validatePlanSteps([step({ agent: 'code', expectedFiles: ['src/a.js'], role: 'testes', tier: 'padrao' })]).steps[0], { ...old.steps[0], agent: 'code', expectedFiles: ['src/a.js'], role: 'testes', tier: 'padrao' });
});

test('role e tier inválidos são rejeitados com mensagem em português no estilo das existentes', () => {
  for (const tier of ['fast', 'Leve', '', ' leve', 'claude-opus-5-5', null, 0, 1, true, ['leve'], { name: 'leve' }, '__proto__']) {
    const r = validatePlanSteps([step({ tier })]); assert.equal(r.ok, false, JSON.stringify(tier)); assert.equal(r.error, '"steps[0].tier" deve ser leve | padrao | profunda');
  }
  for (const role of ['dev', 'Docs', '', 'implementação', null, 5, false, ['docs'], {}, 'constructor']) {
    const r = validatePlanSteps([step({}), step({ role }, 's2')]); assert.equal(r.ok, false, JSON.stringify(role)); assert.equal(r.error, '"steps[1].role" deve ser implementacao | testes | revisao | docs | analise');
  }
  assert.equal(validatePlanSteps([step({ role: 'docs', tier: 'x' })]).ok, false);
});

test('`route` e `wave` são DERIVADOS: continuam rejeitados como chave desconhecida (e nenhuma outra chave nova entrou)', () => {
  for (const k of ['route', 'wave']) {
    const r = validatePlanSteps([step({ [k]: k === 'wave' ? 1 : { tier: 'padrao', model: 'claude-sonnet-5-5', effort: 'medium', source: 'default' } })]);
    assert.equal(r.ok, false, k); assert.match(r.error, new RegExp(`chaves não permitidas em steps\\[0\\]: ${k}`));
  }
  for (const k of ['model', 'effort', 'permissions', 'tools', 'status']) assert.match(validatePlanSteps([step({ [k]: 'x' })]).error, /chaves não permitidas/, k);
  assert.match(validatePlanSteps([step({ tier: 'leve', model: 'claude-opus-5-5' })]).error, /chaves não permitidas em steps\[0\]: model/);
});

test('modo strict (plano novo vindo do Planner) e validateDecision: role/tier passam pelo mesmo caminho', () => {
  assert.equal(validatePlanSteps([step({ role: 'revisao', tier: 'profunda' })], { strict: true }).ok, true);
  const d = validateDecision(plan([step({ role: 'testes', tier: 'leve' }), step({}, 's2')]), { plan: true });
  assert.equal(d.ok, true); assert.equal(d.value.steps[0].tier, 'leve'); assert.equal(d.value.steps[0].role, 'testes'); assert.ok(!('tier' in d.value.steps[1]) && !('role' in d.value.steps[1]));
  const bad = validateDecision(plan([step({ tier: 'ultra' })]), { plan: true }); assert.equal(bad.ok, false); assert.match(bad.error, /steps\[0\]\.tier/);
  assert.match(validateDecision(plan([step({ route: { model: 'x' } })]), { plan: true }).error, /route/);
});

test('revalidar um plano gravado com role/tier mantém os campos; o resto da validação (ids, dependências) segue igual', () => {
  const r = validatePlanSteps([step({ tier: 'padrao' }), step({ dependsOn: ['s1'], role: 'docs' }, 's2')]); assert.equal(r.ok, true); assert.deepEqual(r.steps[1].dependsOn, ['s1']);
  assert.match(validatePlanSteps([step({ tier: 'padrao', dependsOn: ['s1'] })]).error, /depende de si mesma/);
  assert.match(validatePlanSteps([step({ tier: 'padrao' }), step({ tier: 'leve' })]).error, /duplicado/);
});
