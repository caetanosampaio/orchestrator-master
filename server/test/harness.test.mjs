// "Quem faz cada tarefa" (server/harness.js): padrão de fábrica, validação estrita, piloto, linhas, agentes, compartilhar por código, rollback ao falhar a gravação e o que a tabela FAZ
// (padrões do Maestro novo, ferramenta list_routes e task_type em send_task). Express próprio, banco TEMPORÁRIO, nenhum Claude real.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-harness-'));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
assert.ok(fs.realpathSync.native(path.dirname(process.env.ORCH_DATA_DIR)).startsWith(fs.realpathSync.native(os.tmpdir())));

const { default: express } = await import('express');
const store = await import('../store.js');
const H = await import('../harness.js');
const M = await import('../maestro.js');
const { apiGuard } = await import('../origin-guard.js');
const { providerOptions } = await import('../providers/index.js');
const { SKILLS } = await import('../loadouts.js');
const { ROLES } = await import('../terminals.js');

let db, server, base;
const call = (url, method = 'GET', body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
const jr = async (r) => ({ status: r.status, j: await r.json() });
const disk = () => JSON.parse(fs.readFileSync(path.join(process.env.ORCH_DATA_DIR, 'db.json'), 'utf8'));
const rowOf = (v, id) => v.rows.find((r) => r.id === id);

before(async () => {
  db = store.load();
  const app = express(); app.use('/api', apiGuard); app.use(express.json());
  H.setupHarness(app, { db });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

test('padrão de fábrica: tipos por grupo, cada um com IA, modelo, esforço e skills VÁLIDOS (listas fechadas dos provedores e catálogo de skills); Claude e Codex aparecem', () => {
  const opts = providerOptions();
  assert.ok(H.TASK_TYPES.length >= 12); assert.deepEqual(H.GROUPS, ['Desenvolvimento', 'Investigação', 'Testes e segurança', 'Páginas e design', 'Texto']);
  assert.equal(new Set(H.TASK_IDS).size, H.TASK_IDS.length);
  for (const t of H.TASK_TYPES) {
    assert.ok(Object.hasOwn(ROLES, t.role), `${t.id}: papel`); assert.ok(opts[t.provider], `${t.id}: IA`);
    assert.ok(opts[t.provider].models.some((m) => m.id === t.model), `${t.id}: modelo`); assert.ok(opts[t.provider].efforts.some((m) => m.id === t.effort), `${t.id}: esforço`);
    assert.ok(t.skills.every((s) => Object.hasOwn(SKILLS, s)), `${t.id}: skills`);
  }
  assert.deepEqual([...new Set(H.TASK_TYPES.map((t) => t.provider))].sort(), ['claude', 'codex']);
  assert.ok(opts[H.PILOT_DEFAULT.provider].models.some((m) => m.id === H.PILOT_DEFAULT.model) && opts[H.PILOT_DEFAULT.provider].models.some((m) => m.id === H.PILOT_DEFAULT.reserveModel));
});

test('GET: piloto, linhas efetivas, catálogos e limites; nada personalizado de início e nada é gravado ao ler', async () => {
  const r = await jr(await call('/api/harness')); assert.equal(r.status, 200);
  assert.equal(r.j.rows.length, H.TASK_TYPES.length); assert.ok(r.j.rows.every((x) => x.customized === false)); assert.equal(r.j.pilot.customized, false);
  assert.deepEqual(r.j.pilot.effective, { ...H.PILOT_DEFAULT }); assert.ok(r.j.pilot.skills.length > 0, 'as skills do Maestro vêm de loadouts.js');
  assert.deepEqual(r.j.agents, []); assert.ok(r.j.options.claude.models.length && r.j.skills.length && r.j.roleSkills.builder.length); assert.equal(r.j.limits.maxAgents, H.MAX_AGENTS);
  assert.equal(Object.hasOwn(disk(), 'harness'), false, 'ler não grava');
});

test('piloto: muda IA/modelo/esforço/reserva; trocar de IA zera o que era da outra; null volta ao padrão; valores fora das listas são 400', async () => {
  let r = await jr(await call('/api/harness/pilot', 'PUT', { model: 'sonnet', effort: 'medium' })); assert.equal(r.status, 200);
  assert.equal(r.j.pilot.effective.model, 'sonnet'); assert.equal(r.j.pilot.customized, true); assert.deepEqual(disk().harness.pilot, { model: 'sonnet', effort: 'medium' });
  r = await jr(await call('/api/harness/pilot', 'PUT', { provider: 'codex' })); assert.equal(r.status, 200);
  assert.equal(r.j.pilot.effective.provider, 'codex'); assert.deepEqual([r.j.pilot.effective.model, r.j.pilot.effective.effort], ['gpt-5-codex', 'medium'], 'o modelo antigo do Claude saiu: entra uma opção média do Codex');
  assert.equal(Object.hasOwn(disk().harness.pilot, 'model'), false);
  r = await jr(await call('/api/harness/pilot', 'PUT', { provider: null, model: null, effort: null })); assert.deepEqual(r.j.pilot.effective, { ...H.PILOT_DEFAULT });
  const bad = async (body, re) => { const x = await jr(await call('/api/harness/pilot', 'PUT', body)); assert.equal(x.status, 400, JSON.stringify(body)); assert.match(x.j.error, re); };
  await bad({ model: 'gpt-5' }, /model/); await bad({ provider: 'gemini' }, /IA inválida/); await bad({ effort: 'turbo' }, /effort/); await bad({ reserveModel: 'nao-existe' }, /reserveModel/);
  await bad({ nope: 1 }, /não permitidas/); await bad({}, /ao menos um campo/); await bad({ agentId: 'agt_00000000' }, /Agente/); await bad([1], /objeto/);
  assert.equal((await jr(await call('/api/harness/pilot', 'DELETE'))).status, 200);
});

test('linhas: muda uma linha (IA, modelo, esforço, skills), só o que mudou é guardado; "padrão" (null) e DELETE voltam; validação estrita', async () => {
  let r = await jr(await call('/api/harness/rows/fix-bug', 'PUT', { provider: 'codex', model: 'gpt-5-codex', effort: 'high', skills: ['implementar-em-passos-pequenos'] })); assert.equal(r.status, 200);
  const x = rowOf(r.j, 'fix-bug'); assert.equal(x.customized, true); assert.deepEqual(x.effective, { provider: 'codex', model: 'gpt-5-codex', effort: 'high', skills: ['implementar-em-passos-pequenos'], agentId: null });
  assert.deepEqual(x.defaults, { provider: 'claude', model: 'sonnet', effort: 'medium', skills: [...H.TASK_TYPES[0].skills], agentId: null }); assert.ok(rowOf(r.j, 'new-feature').customized === false);
  assert.deepEqual(Object.keys(disk().harness.rows), ['fix-bug']);
  r = await jr(await call('/api/harness/rows/fix-bug', 'PUT', { effort: null })); assert.equal(rowOf(r.j, 'fix-bug').effective.effort, 'medium', 'null volta o campo ao padrão da fábrica');
  r = await jr(await call('/api/harness/rows/fix-bug', 'PUT', { provider: 'claude' })); assert.equal(rowOf(r.j, 'fix-bug').effective.model, 'sonnet', 'trocar de IA zera o modelo da outra'); r = await jr(await call('/api/harness/rows/fix-bug', 'PUT', { provider: 'codex' })); assert.deepEqual([rowOf(r.j, 'fix-bug').effective.model, rowOf(r.j, 'fix-bug').effective.effort], ['gpt-5-codex', 'medium'], 'a IA nova entra com modelo e esforço médios, nunca sem nenhum marcado'); r = await jr(await call('/api/harness/rows/fix-bug', 'PUT', { provider: 'claude' }));
  const bad = async (id, body, re, st = 400) => { const y = await jr(await call(`/api/harness/rows/${id}`, 'PUT', body)); assert.equal(y.status, st, JSON.stringify(body)); assert.match(y.j.error, re); };
  await bad('fix-bug', { model: 'gpt-5' }, /model|effort/); await bad('fix-bug', { skills: ['nao-existe'] }, /skills/); await bad('fix-bug', { skills: ['protocolo-do-squad', 'protocolo-do-squad'] }, /skills/);
  await bad('fix-bug', { skills: Array.from({ length: 7 }, (_, i) => `x${i}`) }, /skills/); await bad('fix-bug', { skills: 'x' }, /skills/); await bad('__proto__', { effort: 'low' }, /não encontrado/, 404); await bad('nope', { effort: 'low' }, /não encontrado/, 404);
  await bad('fix-bug', { role: 'maestro' }, /não permitidas/);
  assert.equal((await jr(await call('/api/harness/rows/fix-bug', 'DELETE'))).status, 200); assert.equal(Object.hasOwn(disk().harness.rows, 'fix-bug'), false);
  assert.equal((await jr(await call('/api/harness/rows/nope', 'DELETE'))).status, 404);
});

test('agentes: criar, nome único, limpar o texto (sem controles nem & | < > ^ % "), editar, usar no piloto e numa linha, excluir (quem usava volta ao padrão), limite', async () => {
  const bad = async (body, st, re) => { const x = await jr(await call('/api/harness/agents', 'POST', body)); assert.equal(x.status, st, JSON.stringify(body)); assert.match(x.j.error, re); };
  await bad({ name: '', instruction: 'x' }, 400, /nome/); await bad({ name: 'a'.repeat(41), instruction: 'x' }, 400, /nome/); await bad({ name: 'ok', instruction: '' }, 400, /instrução/); await bad({ name: 'ok', instruction: 'x'.repeat(1501) }, 400, /instrução/); await bad({ name: 'ok', instruction: 'x', extra: 1 }, 400, /não permitidas/);
  const c = await jr(await call('/api/harness/agents', 'POST', { name: '  Mestre\u0007 ferreiro  ', instruction: 'Faça "tudo" & depois | cheque < > ^ 100%\nlinha dois' })); assert.equal(c.status, 201);
  const a = c.j.agent; assert.match(a.id, /^agt_[0-9a-f]{8}$/); assert.equal(a.name, 'Mestre ferreiro'); assert.ok(!/[&|<>^%"\n\u0007]/.test(a.instruction), a.instruction); assert.match(a.instruction, /Faça tudo/);
  await bad({ name: 'mestre FERREIRO', instruction: 'outro' }, 409, /nome/);
  let r = await jr(await call(`/api/harness/agents/${a.id}`, 'PUT', { instruction: 'Só dividir o trabalho.' })); assert.equal(r.status, 200); assert.equal(r.j.agent.instruction, 'Só dividir o trabalho.');
  assert.equal((await jr(await call('/api/harness/agents/agt_00000000', 'PUT', { name: 'x' }))).status, 404); assert.equal((await jr(await call('/api/harness/agents/xx', 'DELETE'))).status, 404);
  r = await jr(await call('/api/harness/pilot', 'PUT', { agentId: a.id })); assert.equal(r.j.pilot.effective.agentId, a.id);
  r = await jr(await call('/api/harness/rows/docs', 'PUT', { agentId: a.id })); assert.equal(rowOf(r.j, 'docs').effective.agentId, a.id);
  r = await jr(await call(`/api/harness/agents/${a.id}`, 'DELETE')); assert.equal(r.status, 200);
  const v = (await jr(await call('/api/harness'))).j; assert.equal(v.pilot.effective.agentId, null); assert.equal(rowOf(v, 'docs').effective.agentId, null); assert.deepEqual(v.agents, []);
  for (let i = 0; i < H.MAX_AGENTS; i++) assert.equal((await jr(await call('/api/harness/agents', 'POST', { name: `Agente ${i}`, instruction: 'ok' }))).status, 201);
  await bad({ name: 'Um a mais', instruction: 'ok' }, 409, /Limite/);
  for (const ag of (await jr(await call('/api/harness'))).j.agents) await call(`/api/harness/agents/${ag.id}`, 'DELETE');
  await call('/api/harness/pilot', 'DELETE'); await call('/api/harness/rows', 'DELETE');
});

test('compartilhar: exportar e importar um código; ids de agente refeitos; código inválido, grande demais ou com valor fora das listas é recusado SEM mudar nada', async () => {
  await jr(await call('/api/harness/pilot', 'PUT', { effort: 'xhigh' }));
  const ag = (await jr(await call('/api/harness/agents', 'POST', { name: 'Revisor rigoroso', instruction: 'Aponte por gravidade.' }))).j.agent;
  await jr(await call('/api/harness/rows/review-text', 'PUT', { model: 'sonnet', effort: 'high', agentId: ag.id }));
  const { code } = (await jr(await call('/api/harness/export'))).j; assert.ok(code.startsWith(H.CODE_PREFIX));
  await call(`/api/harness/agents/${ag.id}`, 'DELETE'); await call('/api/harness/pilot', 'DELETE'); await call('/api/harness/rows', 'DELETE');
  const r = await jr(await call('/api/harness/import', 'POST', { code })); assert.equal(r.status, 200);
  assert.equal(r.j.pilot.effective.effort, 'xhigh'); assert.equal(r.j.agents.length, 1); assert.notEqual(r.j.agents[0].id, ag.id, 'ids refeitos'); assert.equal(rowOf(r.j, 'review-text').effective.agentId, r.j.agents[0].id);
  const before = JSON.stringify(disk().harness);
  const enc = (o) => H.CODE_PREFIX + Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  for (const bad of ['', 'lixo', 'forge-harness:1:@@@', enc({ extra: 1 }), enc({ rows: { 'nao-existe': { effort: 'low' } } }), enc({ rows: { docs: { model: 'gpt-5' } } }), enc({ pilot: { provider: 'gemini' } }), enc({ rows: { docs: { skills: ['x'] } } }), enc({ agents: [{ name: 'a', instruction: 'x' }, { name: 'A', instruction: 'y' }] }), enc({ agents: [{ name: '', instruction: 'x' }] }), H.CODE_PREFIX + 'A'.repeat(H.MAX_CODE)]) {
    const x = await jr(await call('/api/harness/import', 'POST', { code: bad })); assert.equal(x.status, 400, String(bad).slice(0, 50)); assert.equal(JSON.stringify(disk().harness), before, 'nada mudou');
  }
  assert.equal((await jr(await call('/api/harness/import', 'POST', { code: 5 }))).status, 400); assert.equal((await jr(await call('/api/harness/import', 'POST', { code, x: 1 }))).status, 400);
  await call('/api/harness/pilot', 'DELETE'); await call('/api/harness/rows', 'DELETE'); for (const a of (await jr(await call('/api/harness'))).j.agents) await call(`/api/harness/agents/${a.id}`, 'DELETE');
});

test('rollback: se o banco não puder ser gravado, a mudança é desfeita e a resposta é 500', async () => {
  const snap = JSON.stringify(db.harness ?? null);
  const dir = process.env.ORCH_DATA_DIR, file = path.join(dir, 'db.json'); fs.chmodSync(dir, 0o500);
  let r; try { r = await jr(await call('/api/harness/pilot', 'PUT', { effort: 'low' })); } finally { fs.chmodSync(dir, 0o700); }
  if (r.status === 500) { assert.match(r.j.error, /nada foi alterado/); assert.equal(JSON.stringify(db.harness ?? null), snap, 'o banco em memória voltou ao que era'); assert.ok(fs.existsSync(file)); }
  else assert.ok([200].includes(r.status), 'em sistemas que ignoram a permissão (root) a gravação passa');
  await call('/api/harness/pilot', 'DELETE');
});

test('leitura tolerante: banco editado à mão (lixo, ids inexistentes, modelo que não existe mais) nunca derruba e cai no padrão', () => {
  const dirty = { harness: { pilot: { provider: 'xx', model: 7, agentId: 'agt_ffffffff' }, rows: { docs: { model: 'inexistente', skills: ['nao-existe'], agentId: 'agt_ffffffff' }, nope: { effort: 'low' }, 'fix-bug': 'texto' }, agents: [{ id: 'agt_aaaaaaaa', name: 'ok', instruction: 'x' }, { id: 'ruim' }, null, { id: 'agt_aaaaaaaa', name: 'repetido', instruction: 'y' }] } };
  const h = H.readHarness(dirty); assert.deepEqual(h.agents.map((a) => a.id), ['agt_aaaaaaaa']); assert.equal(h.pilot.provider, undefined); assert.equal(h.pilot.agentId, undefined); assert.equal(h.rows.nope, undefined); assert.equal(h.rows['fix-bug'], undefined);
  const v = H.harnessView(dirty); assert.equal(rowOf(v, 'docs').effective.model, 'haiku', 'modelo desconhecido volta ao padrão'); assert.deepEqual(rowOf(v, 'docs').effective.skills, []); assert.equal(v.pilot.effective.provider, 'claude');
  for (const junk of [null, undefined, 'x', 7, [], { harness: 'x' }, { harness: [] }]) assert.doesNotThrow(() => H.harnessView(junk));
});

test('o que a tabela FAZ nos terminais: Maestro novo abre com o modelo/esforço do piloto (só para a IA do piloto) e a instrução do agente; outros papéis não mudam', () => {
  const d = { harness: { pilot: { model: 'sonnet', effort: 'low', agentId: 'agt_11111111' }, rows: {}, agents: [{ id: 'agt_11111111', name: 'Chefe', instruction: 'Divida e cobre.' }] } };
  assert.deepEqual(H.terminalDefaults(d, 'maestro', 'claude'), { model: 'sonnet', effort: 'low', extraPrompt: 'Divida e cobre.' });
  assert.deepEqual(H.terminalDefaults(d, 'maestro', 'codex'), { extraPrompt: 'Divida e cobre.' }, 'modelo e esforço só valem para a IA do piloto');
  for (const role of ['builder', 'reviewer', 'scout', 'x']) assert.deepEqual(H.terminalDefaults(d, role, 'claude'), {});
  assert.deepEqual(H.terminalDefaults({}, 'maestro', 'claude'), { model: 'opus', effort: 'high' });
  const src = fs.readFileSync(new URL('../terminals.js', import.meta.url), 'utf8');
  assert.match(src, /if \(model === null && d\.model\) model = d\.model/); assert.match(src, /extraPrompt \? `\$\{ROLES\[role\]\.prompt\} Instrucao/, 'a instrução entra no prompt só na criação');
  assert.doesNotMatch(src.slice(src.indexOf('async function resumeReserved'), src.indexOf('const history = ')), /defaults\?\./, 'a retomada não aplica padrões');
});

// ---- Maestro: list_routes e task_type ----
const MA = 'term_aaaaaaaa', B1 = 'term_bbbbbbbb';
function maestroWorld(dbm) {
  const panes = new Map([[MA, { id: MA, role: 'maestro', title: 'Maestro', status: 'running', provider: 'claude' }], [B1, { id: B1, role: 'builder', title: 'Construtor', status: 'running', provider: 'claude', skills: ['protocolo-do-squad', 'implementar-em-passos-pequenos', 'relato-de-conclusao'], agent: { state: 'idle', at: '2020-01-01T00:00:00Z' } }]]); // `skills`: as que o pane tem de fato (o hint só cita essas)
  const written = [], timers = [];
  const terms = { get: (id) => panes.get(id) ?? null, peek: (id) => panes.get(id) ?? null, list: () => [...panes.values()], write: (id, d) => { written.push([id, d]); return { ok: true }; }, readOutput: () => '' };
  const m = M.createMaestro({ getTerminals: () => terms, harness: { routes: () => H.routesForMaestro(dbm), route: (t) => H.routeFor(dbm, t), hint: H.taskHint }, setTimer: (fn) => { timers.push(fn); return { unref() {} }; } });
  const call = (caller, name, args = {}) => m.rpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  return { m, panes, written, call, timers, maestro: { terminalId: MA, role: 'maestro' }, builder: { terminalId: B1, role: 'builder' } };
}

test('Maestro: list_routes devolve a tabela (só para o maestro) e aparece só na lista de ferramentas dele; list_panes informa modelo e esforço', () => {
  const w = maestroWorld({ settings: {} });
  const names = (c) => w.m.rpc(c, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map((t) => t.name);
  assert.ok(names(w.maestro).includes('list_routes')); assert.ok(!names(w.builder).includes('list_routes'));
  const r = w.call(w.maestro, 'list_routes'); assert.ok(!r.isError); const j = JSON.parse(r.content[0].text.slice(r.content[0].text.indexOf('\n') + 1));
  assert.equal(j.task_types.length, H.TASK_TYPES.length); assert.deepEqual(j.task_types[0], { task_type: 'fix-bug', label: 'Consertar um defeito', group: 'Desenvolvimento', role: 'builder', provider: 'claude', model: 'sonnet', effort: 'medium', skills: ['implementar-em-passos-pequenos', 'relato-de-conclusao'], agent: null });
  assert.deepEqual(j.pilot, { provider: 'claude', model: 'opus', effort: 'high', reserve_model: 'sonnet' });
  assert.equal(w.call(w.builder, 'list_routes').isError, true);
  const panes = JSON.parse(w.call(w.maestro, 'list_panes').content[0].text); assert.ok(panes.every((p) => 'model' in p && 'effort' in p));
});

test('Maestro: send_task com task_type leva o tipo, as skills e o agente na linha entregue; tipo desconhecido é recusado; IA diferente só avisa; sem task_type nada muda', () => {
  const dbm = { settings: {}, harness: { pilot: {}, rows: { 'fix-bug': { provider: 'codex', model: 'gpt-5-codex', effort: 'high', agentId: 'agt_11111111' } }, agents: [{ id: 'agt_11111111', name: 'Mestre', instruction: 'Mude pouco & teste "tudo".' }] } };
  const w = maestroWorld(dbm); w.m.setAutonomous(true);
  const r = w.call(w.maestro, 'send_task', { pane_id: B1, task_type: 'fix-bug', task: 'corrija o login' });
  assert.ok(!r.isError); assert.match(r.content[0].text, /Aviso: a tabela recomenda codex \(gpt-5-codex, high\) para "Consertar um defeito", e este pane é claude/);
  const line = w.written.find((x) => x[0] === B1)[1];
  assert.match(line, /^\[Tarefa task_[0-9a-f]{8} do maestro\] corrija o login \[tipo: Consertar um defeito · skills: \/squad:implementar-em-passos-pequenos \/squad:relato-de-conclusao · agente Mestre: Mude pouco teste tudo \.\] \(Ao terminar,/);
  assert.ok(!/[&|<>^%"]/.test(line.slice(line.indexOf('[tipo'), line.indexOf('(Ao terminar'))), 'o agente chega limpo');
  assert.equal(w.m.snapshot().tasks[0].taskType, 'fix-bug');
  for (const bad of ['nao-existe', 7, '', null, '__proto__']) { const x = w.call(w.maestro, 'send_task', { pane_id: B1, task_type: bad, task: 'x' }); assert.equal(x.isError, true, String(bad)); assert.match(x.content[0].text, /task_type desconhecido/); }
  const w2 = maestroWorld({ settings: {} }); w2.m.setAutonomous(true);
  const ok = w2.call(w2.maestro, 'send_task', { pane_id: B1, task: 'sem tipo' }); assert.ok(!ok.isError); assert.ok(!/Aviso/.test(ok.content[0].text)); assert.ok(!/\[tipo:/.test(w2.written.find((x) => x[0] === B1)[1]));
  const sameAi = maestroWorld({ settings: {} }); sameAi.m.setAutonomous(true); assert.ok(!/Aviso/.test(sameAi.call(sameAi.maestro, 'send_task', { pane_id: B1, task_type: 'review-code', task: 'revise' }).content[0].text), 'mesma IA: sem aviso');
});

test('prompt do Maestro cita list_routes e task_type; o servidor liga o harness no boot', () => {
  assert.match(ROLES.maestro.prompt, /list_routes/); assert.match(ROLES.maestro.prompt, /task_type/);
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(idx, /setupHarness\(app, \{ db \}\)/); assert.match(idx, /defaults: \(role, providerId\) => terminalDefaults\(db, role, providerId\)/); assert.match(idx, /harness: \{ routes: \(\) => routesForMaestro\(db\)/);
});

// ---- hint da tarefa (Fase 1): só as skills que o pane de destino tem; Codex sem /squad:; a instrução do agente nunca é cortada ----
test('taskHint: cita /squad: só das skills que o pane tem; Codex e pane sem a lista não recebem /squad:; tipo e agente continuam', () => {
  const route = { label: 'Consertar um defeito', skills: ['implementar-em-passos-pequenos', 'relato-de-conclusao'], agent: { name: 'Mestre', instruction: 'Mude pouco.' } };
  assert.equal(H.taskHint(route, { provider: 'claude', skills: ['protocolo-do-squad', 'relato-de-conclusao'] }), ' [tipo: Consertar um defeito · skills: /squad:relato-de-conclusao · agente Mestre: Mude pouco.]', 'só a interseção');
  for (const target of [{ provider: 'codex', skills: ['relato-de-conclusao'] }, { provider: 'claude', skills: [] }, { provider: 'claude' }, null, { provider: 'xx', skills: ['relato-de-conclusao'] }]) {
    const h = H.taskHint(route, target); assert.ok(!/\/squad:|skills:/.test(h), `${JSON.stringify(target)}: ${h}`); assert.match(h, /tipo: Consertar um defeito · agente Mestre: Mude pouco\./);
  }
  assert.equal(H.taskHint(null, { provider: 'claude' }), '');
});

test('taskHint: instrução de agente com 1500 caracteres chega INTEIRA, com o tipo e 6 skills, e sem caracteres especiais', () => {
  const instruction = `${'a'.repeat(700)} & | < > ^ % " ${'b'.repeat(791)}`; // com os caracteres especiais limpos, cabe no limite de MAX_INSTRUCTION
  const clean = H.cleanLine(instruction, H.MAX_INSTRUCTION + 1); assert.ok(clean.length <= H.MAX_INSTRUCTION, String(clean.length));
  const longLabel = [...H.TASK_TYPES].sort((a, b) => b.label.length - a.label.length)[0].label;
  const skills = Object.keys(SKILLS).sort((a, b) => b.length - a.length).slice(0, H.MAX_ROW_SKILLS);
  const h = H.taskHint({ label: longLabel, skills, agent: { name: 'n'.repeat(H.MAX_NAME), instruction: 'x'.repeat(H.MAX_INSTRUCTION) } }, { provider: 'claude', skills });
  assert.ok(h.includes(`${'n'.repeat(H.MAX_NAME)}: ${'x'.repeat(H.MAX_INSTRUCTION)}]`), 'a instrução inteira e o fecho do colchete');
  for (const s of skills) assert.ok(h.includes(`/squad:${s}`), s);
  assert.ok(h.length <= H.TASK_HINT_MAX + 3);
  const dirty = H.taskHint({ label: 'x', skills: [], agent: { name: 'A', instruction } }, { provider: 'claude', skills: [] });
  assert.ok(!/[&|<>^%"`\u0000-\u001f]/.test(dirty), dirty.slice(0, 80)); assert.ok(dirty.endsWith(`${'b'.repeat(791)}]`), 'nada cortado no fim');
});

test('send_task: pane Codex de destino recebe o tipo e o agente, mas nenhuma menção a /squad:', () => {
  const dbm = { settings: {}, harness: { pilot: {}, rows: {}, agents: [] } };
  const w = maestroWorld(dbm); w.panes.get(B1).provider = 'codex'; w.panes.get(B1).skills = []; w.m.setAutonomous(true);
  assert.ok(!w.call(w.maestro, 'send_task', { pane_id: B1, task_type: 'fix-bug', task: 'corrija' }).isError);
  const line = w.written.find((x) => x[0] === B1)[1]; assert.match(line, /\[tipo: Consertar um defeito\]/); assert.ok(!/\/squad:/.test(line), line);
});
