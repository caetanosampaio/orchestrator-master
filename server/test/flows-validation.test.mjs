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

test('criação válida: padrões (project, maxParallel 1, fullAccess false, goal vazio, sem agenda, autoIntegrate true) e normalização das etapas', () => {
  const r = F.validateFlowInput({ workspaceId: 'ws_1', title: '  Missão  ', steps: [step({ title: ' A ' })] }, { create: true });
  assert.equal(r.error, undefined);
  assert.deepEqual({ ...r.value, steps: undefined }, { title: 'Missão', goal: '', fullAccess: false, maxParallel: 1, workspaceId: 'ws_1', kind: 'project', schedule: null, autoIntegrate: true, autoPush: false, verifyCommand: null, steps: undefined });
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
  // fatia 2: a agenda passou a ser aceita, mas só em automação e só nos formatos dos presets (texto de cron e objeto vazio continuam recusados)
  bad(flowBody({ schedule: '* * * * *' }), /automação/); bad(flowBody({ schedule: {} }), /automação/);
  bad(flowBody({ kind: 'automation', schedule: '* * * * *' }), /schedule/); bad(flowBody({ kind: 'automation', schedule: {} }), /schedule/);
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

test('edição (parcial): só campos permitidos; nada vazio; workspaceId/id/scheduleState não editáveis; kind e schedule validados; archived booleano; validações iguais', () => {
  const v = (b) => F.validateFlowInput(b, { create: false });
  assert.deepEqual(v({ title: ' Novo ' }).value, { title: 'Novo' });
  assert.deepEqual(v({ archived: true, maxParallel: 3, fullAccess: true, goal: '' }).value, { archived: true, maxParallel: 3, fullAccess: true, goal: '' });
  assert.equal(v({ steps: [step()] }).value.steps.length, 1);
  assert.match(v({}).error, /Nada para alterar/);
  for (const k of ['workspaceId', 'id', 'createdAt', 'scheduleState', 'nextRunAt', 'scheduleSkips']) assert.match(v({ [k]: 'x', title: 'a' }).error, /não permitidas/, k);
  // fatia 2: kind e schedule passaram a ser editáveis, mas valores inválidos continuam recusados
  assert.match(v({ kind: 'x', title: 'a' }).error, /kind/); assert.match(v({ schedule: 'x', title: 'a' }).error, /automação/);
  assert.match(v({ archived: 'sim' }).error, /archived/); assert.match(v({ title: '' }).error, /title/); assert.match(v({ maxParallel: 9 }).error, /maxParallel/);
  assert.match(v({ fullAccess: 'true' }).error, /fullAccess/);
  assert.match(v({ steps: [step({ role: 'maestro' })] }).error, /role/); assert.match(v({ steps: [] }).error, /1 a 12/);
});

test('agenda na criação: só em automação; presets normalizados (enabled ausente = true, dias ordenados); formatos inválidos recusados', () => {
  const ok = (sch) => { const r = F.validateFlowInput(flowBody({ kind: 'automation', schedule: sch }), { create: true }); assert.equal(r.error, undefined, JSON.stringify(sch)); return r.value.schedule; };
  assert.deepEqual(ok({ kind: 'interval', everyHours: 4 }), { enabled: true, kind: 'interval', everyHours: 4 });
  assert.deepEqual(ok({ enabled: false, kind: 'daily', time: '09:00' }), { enabled: false, kind: 'daily', time: '09:00' });
  assert.deepEqual(ok({ kind: 'weekly', days: [3, 1], time: '08:30' }), { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' });
  assert.equal(ok(null), null); assert.equal(ok(undefined), null);
  for (const k of ['project', undefined]) bad(flowBody({ kind: k, schedule: { kind: 'interval', everyHours: 4 } }), /só vale para missões de automação/);
  assert.equal(F.validateFlowInput(flowBody({ schedule: null }), { create: true }).value.schedule, null, 'projeto com agenda nula vale');
  const auto = (sch) => flowBody({ kind: 'automation', schedule: sch });
  for (const h of [0, 169, 1.5, '4', null]) bad(auto({ kind: 'interval', everyHours: h }), /everyHours/);
  for (const t of ['9:00', '24:00', '12:60', '', 900]) bad(auto({ kind: 'daily', time: t }), /HH:MM/);
  for (const d of [[], [7], [-1], [1, 1], 'seg', [1.5]]) bad(auto({ kind: 'weekly', days: d, time: '08:00' }), /days|repetidos/);
  bad(auto({ kind: 'monthly', time: '08:00' }), /schedule.kind/); bad(auto({ kind: 'interval', everyHours: 4, cron: '* * * * *' }), /não permitidas na agenda/);
  bad(auto({ kind: 'interval', everyHours: 4, enabled: 'sim' }), /enabled/); bad(auto([{ kind: 'interval', everyHours: 4 }]), /objeto/);
});

test('autoIntegrate: booleano estrito; padrão true na criação; na edição só quando vier', () => {
  assert.equal(F.validateFlowInput(flowBody(), { create: true }).value.autoIntegrate, true);
  assert.equal(F.validateFlowInput(flowBody({ autoIntegrate: false }), { create: true }).value.autoIntegrate, false);
  assert.equal(F.validateFlowInput(flowBody({ autoIntegrate: true }), { create: true }).value.autoIntegrate, true);
  for (const a of ['true', 'false', 1, 0, null, {}, []]) bad(flowBody({ autoIntegrate: a }), /autoIntegrate/);
  const v = (b) => F.validateFlowInput(b, { create: false });
  assert.deepEqual(v({ autoIntegrate: false }).value, { autoIntegrate: false });
  assert.equal('autoIntegrate' in v({ title: 'x' }).value, false, 'edição sem o campo não o altera');
  for (const a of ['false', 0, null]) assert.match(v({ autoIntegrate: a }).error, /autoIntegrate/);
});

test('edição de kind/schedule contra o resultado MESCLADO (current): coerência e 400 claro ao virar projeto com agenda', () => {
  const sch = { enabled: true, kind: 'interval', everyHours: 4 };
  const proj = { kind: 'project', schedule: null }, auto = { kind: 'automation', schedule: sch };
  const v = (b, current) => F.validateFlowInput(b, { create: false, current });
  assert.deepEqual(v({ schedule: { kind: 'daily', time: '07:00' } }, auto).value, { schedule: { enabled: true, kind: 'daily', time: '07:00' } }, 'agenda nova numa automação');
  assert.match(v({ schedule: { kind: 'daily', time: '07:00' } }, proj).error, /automação/, 'agenda num projeto');
  assert.deepEqual(v({ kind: 'automation', schedule: sch }, proj).value, { kind: 'automation', schedule: sch }, 'projeto vira automação com agenda no mesmo corpo');
  assert.deepEqual(v({ kind: 'automation' }, proj).value, { kind: 'automation' }, 'automação sem agenda vale (schedule null)');
  assert.match(v({ kind: 'project' }, auto).error, /schedule: null/, 'virar projeto sem zerar a agenda = 400, nunca apaga em silêncio');
  assert.deepEqual(v({ kind: 'project', schedule: null }, auto).value, { kind: 'project', schedule: null });
  assert.match(v({ kind: 'project', schedule: sch }, auto).error, /automação/);
  assert.deepEqual(v({ kind: 'project' }, { kind: 'automation', schedule: null }).value, { kind: 'project' }, 'automação sem agenda vira projeto sem nada a zerar');
  assert.deepEqual(v({ schedule: null }, auto).value, { schedule: null }, 'remover a agenda');
  assert.equal(v({ kind: 'automation', schedule: { kind: 'interval', everyHours: 0 } }, proj).error.includes('everyHours'), true);
  // corpo completo do cliente (draftToBody em modo edição) passa
  const full = { kind: 'automation', title: 'M', goal: '', fullAccess: false, maxParallel: 1, schedule: { enabled: true, kind: 'weekly', days: [1, 3], time: '08:30' }, autoIntegrate: true, steps: [step({ id: 's1' })] };
  const r = v(full, proj); assert.equal(r.error, undefined); assert.deepEqual([r.value.kind, r.value.schedule.kind, r.value.autoIntegrate], ['automation', 'weekly', true]);
});

test('runSafePatch: só schedule/autoIntegrate (ao menos um) é aceito com run ativo', () => {
  assert.equal(F.runSafePatch({ schedule: null }), true); assert.equal(F.runSafePatch({ autoIntegrate: false }), true); assert.equal(F.runSafePatch({ schedule: null, autoIntegrate: true }), true);
  for (const b of [{}, null, [], 'x', { schedule: null, title: 'x' }, { kind: 'automation', schedule: null }, { autoIntegrate: true, steps: [] }]) assert.equal(F.runSafePatch(b), false, JSON.stringify(b));
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

// ---------- comando de verificação (verifyCommand) ----------
/** Gerente com terminais falsos e banco em memória (nada é gravado em disco): só o necessário para criar, editar e propor. */
function manager() {
  const db = { workspaces: [{ id: 'ws_1', name: 'proj', path: tmp }], flows: [], flowRuns: [] };
  const pane = (id) => (id === 'term_00000001' ? { id, status: 'running', role: 'planner', workspaceId: 'ws_1' } : null);
  const terminals = { get: pane, peek: pane, count: () => 0, providers: () => [], close() {} };
  const fl = F.createFlows({ db, terminals, maestro: {}, persist: () => {}, pollMs: 0, onError: () => {}, flowVerify: { run: async () => { throw new Error('não deveria rodar'); } } });
  return { db, fl };
}

test('verifyCommand: null/ausente = sem verificação; objeto validado (args 1..16 textos sem controle, timeoutSec inteiro 10..1800, padrão 300); recusas com o nome do campo', () => {
  assert.equal(F.validateFlowInput(flowBody(), { create: true }).value.verifyCommand, null);
  assert.equal(F.validateFlowInput(flowBody({ verifyCommand: null }), { create: true }).value.verifyCommand, null);
  assert.deepEqual(F.validateFlowInput(flowBody({ verifyCommand: { args: ['npm', 'test'] } }), { create: true }).value.verifyCommand, { args: ['npm', 'test'], timeoutSec: 300 });
  assert.deepEqual(F.validateFlowInput(flowBody({ verifyCommand: { args: ['node', 'x.js'], timeoutSec: 60 } }), { create: true }).value.verifyCommand, { args: ['node', 'x.js'], timeoutSec: 60 });
  for (const vc of ['npm test', ['npm'], { args: [] }, { args: 'npm' }, { args: [1] }, { args: [''] }, { args: ['npm', 'a\nb'] }, { args: Array(17).fill('x') }, { args: ['npm'], timeoutSec: 5 }, { args: ['npm'], timeoutSec: 1801 }, { args: ['npm'], timeoutSec: 30.5 }, { args: ['npm'], timeoutSec: '60' }]) bad(flowBody({ verifyCommand: vc }), /^verifyCommand: /);
  // edição: só quando vier; null remove
  assert.equal(Object.hasOwn(F.validateFlowInput({ title: 'x' }, { create: false }).value, 'verifyCommand'), false);
  assert.equal(F.validateFlowInput({ verifyCommand: null }, { create: false }).value.verifyCommand, null);
  bad({ verifyCommand: { args: [] } }, /^verifyCommand: /, { create: false });
  assert.equal(F.runSafePatch({ verifyCommand: null }), false, 'não entra nos campos editáveis com run ativo');
  assert.equal(F.RUN_SAFE_PATCH_KEYS.includes('verifyCommand'), false);
});

test('verifyCommand no gerente: criar/editar/remover; list e get devolvem o campo (null em missão antiga ou com valor inválido no banco)', () => {
  const { db, fl } = manager();
  const c = fl.create(flowBody({ verifyCommand: { args: ['npm', 'test'], timeoutSec: 120 } })); assert.equal(c.status, 201, c.error);
  assert.deepEqual(c.body.verifyCommand, { args: ['npm', 'test'], timeoutSec: 120 });
  assert.deepEqual(fl.get(c.body.id).body.verifyCommand, { args: ['npm', 'test'], timeoutSec: 120 }); assert.deepEqual(fl.list()[0].verifyCommand, { args: ['npm', 'test'], timeoutSec: 120 });
  assert.equal(fl.create(flowBody({ verifyCommand: { args: [] } })).status, 400);
  const e = fl.update(c.body.id, { verifyCommand: { args: ['node', 't.js'] } }); assert.equal(e.status, 200, e.error); assert.deepEqual(e.body.verifyCommand, { args: ['node', 't.js'], timeoutSec: 300 });
  const n = fl.update(c.body.id, { verifyCommand: null }); assert.equal(n.status, 200, n.error); assert.equal(n.body.verifyCommand, null); assert.equal(db.flows[0].verifyCommand, null);
  delete db.flows[0].verifyCommand; assert.equal(fl.get(c.body.id).body.verifyCommand, null, 'missão antiga sem o campo');
  db.flows[0].verifyCommand = { args: 'rm -rf /' }; assert.equal(fl.get(c.body.id).body.verifyCommand, null, 'valor inválido no banco não vale');
});

test('verifyCommand: o planejador nunca define (propose_mission recusa a propriedade); edição com run ativo = 409', () => {
  const { db, fl } = manager();
  const caller = { terminalId: 'term_00000001', role: 'planner' };
  const mission = { title: 'M', goal: 'G', steps: [step()] };
  const no = fl.plannerPort().propose(caller, { ...mission, verifyCommand: { args: ['npm', 'test'] } });
  assert.equal(no.ok, false); assert.match(no.error, /verifyCommand/);
  const no2 = fl.plannerPort().propose(caller, { ...mission, verifyCommand: null }); assert.equal(no2.ok, false, 'nem null: a chave não pode vir do agente');
  const ok = fl.plannerPort().propose(caller, mission); assert.equal(ok.ok, true, ok.error);
  assert.equal(fl.listProposals()[0].flow.verifyCommand, null);
  // run ativo (running, interrupted ou ready_to_integrate): verifyCommand não muda; a agenda/autoIntegrate continuam liberados
  const c = fl.create(flowBody({ verifyCommand: { args: ['npm', 'test'] } })); assert.equal(c.status, 201, c.error);
  for (const status of ['running', 'interrupted', 'ready_to_integrate']) {
    db.flowRuns = [{ id: 'run_0000000a', flowId: c.body.id, status, steps: [], git: null, ownedTerminalIds: [] }];
    for (const body of [{ verifyCommand: null }, { verifyCommand: { args: ['node', 'x.js'] } }, { verifyCommand: null, autoIntegrate: false }]) assert.equal(fl.update(c.body.id, body).status, 409, `${status} ${JSON.stringify(body)}`);
    assert.equal(fl.update(c.body.id, { autoIntegrate: false }).status, 200);
  }
  assert.deepEqual(db.flows.find((f) => f.id === c.body.id).verifyCommand, { args: ['npm', 'test'], timeoutSec: 300 });
});
