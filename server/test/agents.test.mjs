// Perfis de agentes (agents.js) e o campo opcional task.agent na validação de decisões. Puro: sem processos, banco ou modelo.
import test from 'node:test';
import assert from 'node:assert/strict';

const { AGENTS, AGENT_NAMES, DEFAULT_AGENT, agentArgs, isAgent } = await import('../agents.js');
const { CLAUDE_ARGS } = await import('../executor/index.js');
const { executorArgs, DEFAULT_ALLOW } = await import('../exec-profile.js');
const { validateDecision } = await import('../cycle-schema.js');

const dec = (task) => JSON.stringify({ decision: 'continue', rationale: 'r', task: { title: 't', instructions: 'i', acceptance: ['a'], ...task } });

test('perfil `code`: sem perfil de permissão o resultado é o do perfil PADRÃO (acceptEdits + lista pré-aprovada, sem --tools restritivo, sem bypass)', () => {
  assert.deepEqual(agentArgs('code'), executorArgs('default')); assert.deepEqual(agentArgs(), executorArgs('default'), 'sem nome = agente padrão');
  assert.deepEqual(agentArgs('code'), CLAUDE_ARGS); assert.deepEqual(agentArgs('code', {}), executorArgs('default')); assert.deepEqual(agentArgs('code', { profile: 'default' }), executorArgs('default'));
  assert.equal(DEFAULT_AGENT, 'code'); assert.deepEqual([...AGENT_NAMES], ['code']);
  const a = agentArgs('code');
  assert.ok(!a.includes('--tools'), 'o Executor ganha as ferramentas do terminal: nada de --tools restritivo'); assert.ok(!a.some((x) => /dangerously|bypass/i.test(x)));
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'acceptEdits'); assert.equal(a[a.indexOf('--permission-prompts') + 1], 'none');
  assert.deepEqual(a.slice(a.indexOf('--allowedTools') + 1), [...DEFAULT_ALLOW], '--allowedTools vai por último (variádica) e só com a lista pré-aprovada');
});

test('perfil de permissão do workspace: só a string exata "bypass" liga o modo sem confirmação; o resto é o padrão (fail-safe); bypass não leva allowedTools nem --tools', () => {
  const b = agentArgs('code', { profile: 'bypass' }); assert.deepEqual(b, executorArgs('bypass'));
  assert.equal(b[b.indexOf('--permission-mode') + 1], 'bypassPermissions'); assert.ok(!b.includes('--allowedTools') && !b.includes('--tools') && !b.includes('--disallowedTools'));
  assert.ok(!b.some((x) => /dangerously/i.test(x)), 'nunca --dangerously-skip-permissions'); assert.equal(b[b.indexOf('--permission-prompts') + 1], 'none');
  for (const p of ['Bypass', 'BYPASS', ' bypass', 'bypass ', 'default', '', 'sim', true, 1, null, undefined, {}, ['bypass'], { toString: () => 'bypass' }]) assert.deepEqual(agentArgs('code', { profile: p }), executorArgs('default'), JSON.stringify(p));
  for (const o of [null, 'bypass', 5, [], () => {}]) assert.deepEqual(agentArgs('code', o), executorArgs('default'), 'opções malformadas = padrão');
  assert.deepEqual(agentArgs(undefined, { profile: 'bypass' }), executorArgs('bypass'), 'sem nome = agente padrão também em bypass');
  assert.throws(() => agentArgs('review', { profile: 'bypass' }), /Perfil de agente desconhecido/, 'agente desconhecido continua lançando, qualquer que seja o perfil');
});

test('a tabela é protegida e cada chamada devolve uma cópia nova, em qualquer perfil (mutar o resultado não altera o agente)', () => {
  assert.ok(Object.isFrozen(AGENTS) && Object.isFrozen(AGENTS.code) && Object.isFrozen(AGENTS.code.args) && Object.isFrozen(AGENTS.code.bypassArgs));
  for (const profile of ['default', 'bypass']) {
    const a = agentArgs('code', { profile }); a.push('--x'); a[0] = 'mudou';
    assert.deepEqual(agentArgs('code', { profile }), executorArgs(profile)); assert.notEqual(agentArgs('code', { profile }), agentArgs('code', { profile }));
  }
  assert.throws(() => { AGENTS.review = {}; }, TypeError);
  assert.throws(() => { AGENTS.code.args.push('--x'); }, TypeError);
  assert.throws(() => { AGENTS.code.bypassArgs.push('--x'); }, TypeError);
});

test('nomes desconhecidos, tipos inválidos e nomes especiais são rejeitados (nunca resolvem por herança de protótipo)', () => {
  for (const n of ['review', 'research', 'test', 'CODE', 'code ', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype', null, 0, 5, true, {}, ['code']]) {
    assert.equal(isAgent(n), false, String(n)); assert.throws(() => agentArgs(n), /Perfil de agente desconhecido/, String(n));
  }
  assert.equal(isAgent('code'), true);
});

test('validateDecision: `task.agent` ausente = resposta antiga, intacta (sem campo novo); `code` é aceito', () => {
  const old = validateDecision(dec({}));
  assert.equal(old.ok, true); assert.deepEqual(old.value.task, { title: 't', instructions: 'i', acceptance: ['a'] }); assert.ok(!('agent' in old.value.task));
  const code = validateDecision(dec({ agent: 'code' })); assert.equal(code.ok, true); assert.equal(code.value.task.agent, 'code');
});

test('validateDecision: perfis desconhecidos e tipos inválidos são rejeitados pelo mecanismo existente; as demais validações não mudam', () => {
  for (const agent of ['review', 'Code', '', ' code', '__proto__', 'constructor', null, 0, 1, true, false, ['code'], { name: 'code' }]) {
    const r = validateDecision(dec({ agent })); assert.equal(r.ok, false, JSON.stringify(agent)); assert.match(r.error, /task\.agent/);
  }
  assert.match(validateDecision(dec({ tools: 'Bash' })).error, /chaves não permitidas em "task": tools/, 'chaves desconhecidas continuam proibidas');
  assert.match(validateDecision(dec({ permissions: 'all', agent: 'code' })).error, /permissions/);
  assert.equal(validateDecision(dec({ title: '' })).ok, false); assert.equal(validateDecision(dec({ acceptance: [] })).ok, false);
  assert.match(validateDecision(JSON.stringify({ decision: 'complete', rationale: 'r', evidence: ['e'], task: { agent: 'code' } })).error, /não aceita "task"/);
});
