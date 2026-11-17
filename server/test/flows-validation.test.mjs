// Missions v2: validação de criação/edição de missões (flows.js): listas fechadas, DAG sem ciclo, continueFrom, limites, texto composto da etapa. Funções puras, sem terminais.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-valid-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const F = await import('../flows.js');
const { MAX_TASK_TEXT } = await import('../maestro.js');

const step = (over = {}) => ({ title: 'Etapa', prompt: 'Faça algo', provider: 'claude', role: 'builder', ...over });
const flowBody = (over = {}) => ({ workspaceId: 'ws_1', title: 'Missão', goal: 'Objetivo', steps: [step()], ...over });
const bad = (body, re, opts = { create: true }) => { const r = F.validateFlowInput(body, opts); assert.ok(r.error, `deveria recusar: ${String(JSON.stringify(body)).slice(0, 120)}`); assert.match(r.error, re); };

test('criação válida: padrões (project, maxParallel 1, fullAccess false, goal vazio) e normalização das etapas', () => {
  const r = F.validateFlowInput({ workspaceId: 'ws_1', title: '  Missão  ', steps: [step({ title: ' A ' })] }, { create: true });
  assert.equal(r.error, undefined);
  assert.deepEqual({ ...r.value, steps: undefined }, { title: 'Missão', goal: '', fullAccess: false, maxParallel: 1, workspaceId: 'ws_1', kind: 'project', steps: undefined });
  assert.deepEqual(r.value.steps, [{ id: 's1', title: 'A', prompt: 'Faça algo', provider: 'claude', role: 'builder', model: null, effort: null, dependsOn: [], continueFrom: null }]);
  const full = F.validateFlowInput(flowBody({ kind: 'automation', fullAccess: true, maxParallel: 4, schedule: null, goal: 'a\nb' }), { create: true });
  assert.equal(full.error, undefined); assert.deepEqual([full.value.kind, full.value.fullAccess, full.value.maxParallel, full.value.goal], ['automation', true, 4, 'a\nb']);
});

test('limites de tamanho: título 120, objetivo 2000, prompt 2000, 1 a 12 etapas, maxParallel 1..4 inteiro', () => {
  assert.equal(F.validateFlowInput(flowBody({ title: 'a'.repeat(120), goal: 'b'.repeat(2000), steps: [step({ title: 'c'.repeat(120), prompt: 'd'.repeat(2000) })] }), { create: true }).error, undefined);
  bad(flowBody({ title: 'a'.repeat(121) }), /title/);
  bad(flowBody({ goal: 'b'.repeat(2001) }), /goal/);
  bad(flowBody({ steps: [step({ title: 'c'.repeat(121) })] }), /Etapa 1: título/);
  bad(flowBody({ steps: [step({ prompt: 'd'.repeat(2001) })] }), /Etapa 1: prompt/);
  bad(flowBody({ steps: [] }), /1 a 12/);
  bad(flowBody({ steps: undefined }), /1 a 12/);
  bad(flowBody({ steps: 'x' }), /1 a 12/);
  assert.equal(F.validateFlowInput(flowBody({ steps: Array.from({ length: 12 }, (_, i) => step({ title: `E${i}` })) }), { create: true }).error, undefined);
  bad(flowBody({ steps: Array.from({ length: 13 }, (_, i) => step({ title: `E${i}` })) }), /1 a 12/);
  for (const p of [0, 5, 1.5, '2', -1, false, NaN, Infinity]) bad(flowBody({ maxParallel: p }), /maxParallel/);
  for (const p of [1, 2, 3, 4]) assert.equal(F.validateFlowInput(flowBody({ maxParallel: p }), { create: true }).error, undefined);
});

test('texto: título e prompt obrigatórios, tipos, caracteres de controle, propriedades desconhecidas, corpo que não é objeto', () => {
  bad(flowBody({ title: '' }), /title/); bad(flowBody({ title: '   ' }), /title/); bad(flowBody({ title: 42 }), /title/); bad(flowBody({ title: undefined }), /title/);
  bad(flowBody({ title: 'a\nb' }), /controle/); bad(flowBody({ title: 'a\x00b' }), /controle/); bad(flowBody({ goal: 'a\x1bb' }), /controle/); bad(flowBody({ goal: 5 }), /goal/);
  bad(flowBody({ steps: [step({ prompt: '' })] }), /prompt/); bad(flowBody({ steps: [step({ prompt: 3 })] }), /prompt/); bad(flowBody({ steps: [step({ title: undefined })] }), /título/);
  bad(flowBody({ id: 'flow_00000000' }), /não permitidas/); bad(flowBody({ createdAt: 'x' }), /não permitidas/); bad(flowBody({ steps: [step({ cwd: '/etc' })] }), /não permitidas/);
  bad(flowBody({ steps: [step({ command: 'rm -rf /' })] }), /não permitidas/); bad(flowBody({ steps: [step({ taskId: 'x' })] }), /não permitidas/);
  for (const b of [null, undefined, 'x', 7, [], [flowBody()]]) bad(b, /objeto/);
  bad(JSON.parse('{"workspaceId":"ws_1","title":"x","steps":[],"__proto__":{"x":1}}'), /não permitidas/);
});

test('workspaceId, kind, schedule, fullAccess (booleano estrito)', () => {
  for (const w of [undefined, null, '', 5, {}, 'w'.repeat(81)]) bad(flowBody({ workspaceId: w }), /workspaceId/);
  bad(flowBody({ kind: 'cron' }), /kind/); bad(flowBody({ kind: 1 }), /kind/);
  bad(flowBody({ schedule: '* * * * *' }), /schedule/); bad(flowBody({ schedule: {} }), /schedule/);
  for (const f of ['true', 1, 'yes', {}, [], 0]) bad(flowBody({ fullAccess: f }), /fullAccess/);
  assert.equal(F.validateFlowInput(flowBody({ fullAccess: false }), { create: true }).value.fullAccess, false);
  assert.equal(F.validateFlowInput(flowBody({ fullAccess: true }), { create: true }).value.fullAccess, true);
});

test('etapa: provider, role, model e effort de listas fechadas (o Maestro não é papel de etapa)', () => {
  for (const p of [undefined, '', 'gemini', 'CLAUDE', '__proto__', 'constructor', 5, {}]) bad(flowBody({ steps: [step({ provider: p })] }), /provider/);
  for (const r of [undefined, '', 'maestro', 'hacker', '__proto__', 'constructor', 'toString', 5]) bad(flowBody({ steps: [step({ role: r })] }), /role/);
  for (const r of ['builder', 'reviewer', 'scout']) assert.equal(F.validateFlowInput(flowBody({ steps: [step({ role: r })] }), { create: true }).error, undefined, r);
  assert.deepEqual(F.STEP_ROLES, ['builder', 'reviewer', 'scout']);
  const ok = F.validateFlowInput(flowBody({ steps: [step({ model: 'opus', effort: 'high' }), step({ title: 'B', provider: 'codex', model: 'gpt-5', effort: 'low' })] }), { create: true });
  assert.equal(ok.error, undefined); assert.deepEqual([ok.value.steps[0].model, ok.value.steps[0].effort, ok.value.steps[1].model, ok.value.steps[1].effort], ['opus', 'high', 'gpt-5', 'low']);
  for (const m of ['', 'gpt-5', 'opus --dangerously-skip-permissions', 7, false, {}]) bad(flowBody({ steps: [step({ model: m })] }), /model/);
  bad(flowBody({ steps: [step({ provider: 'codex', model: 'opus' })] }), /model/);
  for (const e of ['', 'max-ish', 'extreme', 3]) bad(flowBody({ steps: [step({ effort: e })] }), /effort/);
  bad(flowBody({ steps: [step({ provider: 'codex', effort: 'max' })] }), /effort/); // max só existe no Claude
  assert.equal(F.validateFlowInput(flowBody({ steps: [step({ model: null, effort: null })] }), { create: true }).error, undefined);
});

test('ids das etapas: rótulos s1..s99 (únicos); os que faltam são gerados sem colidir', () => {
  const r = F.validateSteps([step({ id: 's2' }), step({ title: 'B' }), step({ title: 'C', id: 's1' }), step({ title: 'D' })]);
  assert.deepEqual(r.steps.map((s) => s.id), ['s2', 's3', 's1', 's4']);
  for (const id of ['x1', 's0', 's100', 'S1', '../s1', 5, 's1 ', '']) assert.match(F.validateSteps([step({ id })]).error, /id inválido/, String(id));
  assert.match(F.validateSteps([step({ id: 's1' }), step({ id: 's1' })]).error, /repetido/);
});

test('dependências: desconhecida, a si mesma, repetida, tipo errado, ciclo direto/indireto; DAG válido (diamante) passa', () => {
  const s = (id, dependsOn) => step({ id, title: id, dependsOn });
  assert.match(F.validateSteps([s('s1', ['s9'])]).error, /não existe/);
  assert.match(F.validateSteps([s('s1', ['s1'])]).error, /si mesma/);
  assert.match(F.validateSteps([s('s1', []), s('s2', ['s1', 's1'])]).error, /repetidas/);
  assert.match(F.validateSteps([s('s1', 'x')]).error, /dependsOn/); assert.match(F.validateSteps([s('s1', [1])]).error, /dependsOn/);
  assert.match(F.validateSteps([s('s1', ['s2']), s('s2', ['s1'])]).error, /ciclo/);
  assert.match(F.validateSteps([s('s1', ['s3']), s('s2', ['s1']), s('s3', ['s2'])]).error, /ciclo/);
  assert.match(F.validateSteps([s('s1', []), s('s2', ['s3']), s('s3', ['s4']), s('s4', ['s2'])]).error, /ciclo/, 'ciclo isolado em um subgrafo');
  const dia = F.validateSteps([s('s1', []), s('s2', ['s1']), s('s3', ['s1']), s('s4', ['s2', 's3'])]);
  assert.equal(dia.error, undefined); assert.deepEqual(dia.steps.map((x) => x.dependsOn), [[], ['s1'], ['s1'], ['s2', 's3']]);
  assert.equal(F.validateSteps([s('s2', ['s1']), s('s1', [])]).error, undefined, 'a ordem da lista não importa');
  assert.equal(F.validateSteps(Array.from({ length: 12 }, (_, i) => s(`s${i + 1}`, i ? [`s${i}`] : []))).error, undefined);
});

test('continueFrom: só uma etapa ANTERIOR da cadeia de dependências, alvo único e o mesmo agente', () => {
  const s = (id, over = {}) => step({ id, title: id, ...over });
  const ok = F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's1' }), s('s3', { dependsOn: ['s2'], continueFrom: 's2' })]);
  assert.equal(ok.error, undefined); assert.deepEqual(ok.steps.map((x) => x.continueFrom), [null, 's1', 's2']);
  assert.equal(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'] }), s('s3', { dependsOn: ['s2'], continueFrom: 's1' })]).error, undefined, 'ancestral transitivo vale');
  assert.match(F.validateSteps([s('s1'), s('s2', { continueFrom: 's1' })]).error, /cadeia de dependências/, 'sem dependência');
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's2' })]).error, /cadeia/, 'a si mesma');
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's9' })]).error, /não existe/);
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 5 })]).error, /continueFrom/);
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'] }), s('s3', { dependsOn: ['s1'], continueFrom: 's2' })]).error, /cadeia/, 'irmã não é ancestral');
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's1' }), s('s3', { dependsOn: ['s1'], continueFrom: 's1' })]).error, /já continua/, 'o terminal não se divide');
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's1', role: 'reviewer' })]).error, /mesmo/);
  assert.match(F.validateSteps([s('s1'), s('s2', { dependsOn: ['s1'], continueFrom: 's1', provider: 'codex' })]).error, /mesmo/);
  assert.match(F.validateSteps([s('s1', { model: 'opus' }), s('s2', { dependsOn: ['s1'], continueFrom: 's1', model: 'sonnet' })]).error, /mesmo/);
  assert.match(F.validateSteps([s('s1', { effort: 'low' }), s('s2', { dependsOn: ['s1'], continueFrom: 's1' })]).error, /mesmo/);
});

test('edição (parcial): só campos permitidos; nada vazio; workspaceId/kind/schedule/id não editáveis; archived booleano; validações iguais', () => {
  const v = (b) => F.validateFlowInput(b, { create: false });
  assert.deepEqual(v({ title: ' Novo ' }).value, { title: 'Novo' });
  assert.deepEqual(v({ archived: true, maxParallel: 3, fullAccess: true, goal: '' }).value, { archived: true, maxParallel: 3, fullAccess: true, goal: '' });
  assert.equal(v({ steps: [step()] }).value.steps.length, 1);
  assert.match(v({}).error, /Nada para alterar/);
  for (const k of ['workspaceId', 'kind', 'schedule', 'id', 'createdAt']) assert.match(v({ [k]: 'x', title: 'a' }).error, /não permitidas/, k);
  assert.match(v({ archived: 'sim' }).error, /archived/); assert.match(v({ title: '' }).error, /title/); assert.match(v({ maxParallel: 9 }).error, /maxParallel/);
  assert.match(v({ fullAccess: 'true' }).error, /fullAccess/);
  assert.match(v({ steps: [step({ role: 'maestro' })] }).error, /role/); assert.match(v({ steps: [] }).error, /1 a 12/);
});

test('composeStepText: contexto + etapa em uma linha; limite do Maestro respeitado sem cortar o prompt (degraus 1, 2, 3 e recusa clara)', () => {
  const flow = { title: 'Meu projeto', goal: 'Entregar a tela\nnova' }, st = { title: 'Passo 1', prompt: 'Crie\no arquivo' };
  const a = F.composeStepText(flow, st);
  assert.equal(a.ok, true); assert.equal(a.text, '[Missão: Meu projeto | Objetivo: Entregar a tela nova] Etapa "Passo 1": Crie o arquivo');
  const noGoal = F.composeStepText({ title: 'M', goal: '' }, st); assert.equal(noGoal.text, '[Missão: M] Etapa "Passo 1": Crie o arquivo');
  // degrau 2: o objetivo é cortado com "…" e o prompt vai inteiro
  const prompt = 'p'.repeat(1700), goal = 'g'.repeat(2000), b = F.composeStepText({ title: 'M', goal }, { title: 'E', prompt });
  assert.equal(b.ok, true); assert.ok(b.text.length <= MAX_TASK_TEXT, String(b.text.length)); assert.ok(b.text.endsWith(prompt)); assert.ok(b.text.includes('…'));
  assert.equal(F.composeStepText({ title: 'M', goal }, { title: 'E', prompt }).text, b.text, 'determinístico');
  // degrau 3: sem espaço nem para 60 caracteres do objetivo: só o título da missão
  const c = F.composeStepText({ title: 'M', goal }, { title: 'E', prompt: 'p'.repeat(1950) });
  assert.equal(c.ok, true); assert.ok(!c.text.includes('Objetivo')); assert.ok(c.text.length <= MAX_TASK_TEXT);
  // recusa: o prompt de 2000 caracteres + o cabeçalho mínimo passa do limite
  const d = F.composeStepText({ title: 'M', goal: 'x' }, { title: 'E', prompt: 'p'.repeat(2000) });
  assert.equal(d.ok, false); assert.match(d.error, /Encurte o prompt/); assert.match(d.error, /2000/);
  // exatamente no limite cabe
  const head = '[Missão: M] Etapa "E": ', e = F.composeStepText({ title: 'M', goal: '' }, { title: 'E', prompt: 'p'.repeat(MAX_TASK_TEXT - head.length) });
  assert.equal(e.ok, true); assert.equal(e.text.length, MAX_TASK_TEXT);
  // controles e ESC do objetivo não chegam ao terminal
  const f = F.composeStepText({ title: 'M\x1b', goal: 'a\x07b' }, { title: 'E', prompt: 'x' }); assert.ok(!/[\x00-\x1f]/.test(f.text));
});
