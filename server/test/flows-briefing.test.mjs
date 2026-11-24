// Missions v2: criar missão por briefing (docs/missions-v2-briefing.md). Papel `planner`, ferramentas mission_options/propose_mission só dele (maestro.js, porta injetada por setPlanner),
// propostas em memória (flows.js) e as rotas /api/flows/briefing, /api/flows/proposals e proposalId em POST /api/flows. Maestro REAL, terminais e PTY SIMULADOS (nenhum Claude/Codex real),
// banco e porta TEMPORÁRIOS (ORCH_DATA_DIR; nunca a 4317).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-briefing-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const { default: express } = await import('express');
const store = await import('../store.js');
const F = await import('../flows.js');
const M = await import('../maestro.js');
const T = await import('../terminals.js');
const { apiGuard } = await import('../origin-guard.js');
const { providerOptions } = await import('../providers/index.js');

const hex = (n) => n.toString(16).padStart(8, '0');
let db, server, base, flows, maestro, clock = Date.parse('2026-11-19T12:00:00.000Z'), tn = 0, createResult = null, available = { claude: true, codex: true };
const panes = new Map(), created = [];
const terminals = {
  async create(o) {
    created.push(o);
    if (createResult) return createResult;
    const id = `term_${hex(++tn)}`; panes.set(id, { id, role: o.role, title: o.title, workspaceId: o.workspaceId, provider: o.provider, status: 'running' });
    return { ok: true, status: 201, session: { id, role: o.role, title: o.title, workspaceId: o.workspaceId } };
  },
  // peek espelha o REAL (terminals.js): SEM workspaceId (só o get/describe o traz); antes o mock o devolvia e escondia que o planejador falhava sempre no servidor real
  peek: (id) => { const t = panes.get(id); return t ? { id: t.id, role: t.role, provider: t.provider ?? 'claude', title: t.title, status: t.status, lastOutputAt: t.lastOutputAt ?? null, agent: t.status === 'running' ? t.agent ?? null : null, skills: [] } : null; },
  get: (id) => panes.get(id) ?? null, list: () => [...panes.values()],
  close: (id) => { const t = panes.get(id); if (t) t.status = 'exited'; return { ok: true }; },
  count: () => [...panes.values()].filter((t) => t.status === 'running').length,
  providers: () => [{ id: 'claude', label: 'Claude Code', available: available.claude }, { id: 'codex', label: 'Codex CLI', available: available.codex }],
  write: () => ({ ok: true, status: 200 }), readOutput: () => '',
};
/** Pane simulado já rodando (sem passar pela rota). */
const addPane = (role, workspaceId = 'ws_1') => { const id = `term_${hex(++tn)}`; panes.set(id, { id, role, title: role, workspaceId, status: 'running', provider: 'claude', agent: { state: 'idle', at: '2026-11-19T10:00:00.000Z' }, lastOutputAt: '2026-11-19T10:00:00.000Z' }); return id; };
const as = (terminalId) => ({ terminalId, role: panes.get(terminalId)?.role });
const rpc = (caller, method, params) => maestro.rpc(caller, { jsonrpc: '2.0', id: 1, method, params });
const tool = (caller, name, args = {}) => rpc(caller, 'tools/call', { name, arguments: args }).result;
const names = (caller) => rpc(caller, 'tools/list').result.tools.map((t) => t.name);
const txt = (r) => r.content[0].text;
const call = (url, method = 'GET', body, headers = {}) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const jr = async (r) => { const text = await r.text(); return { status: r.status, j: text ? JSON.parse(text) : null }; };
const mission = (over = {}) => ({ title: 'Login com e-mail', goal: 'Usuário entra com e-mail e senha', steps: [{ id: 's1', title: 'Mapear', prompt: 'Mapeie o fluxo de login atual.', provider: 'claude', role: 'scout', model: 'sonnet', effort: 'low' }, { id: 's2', title: 'Implementar', prompt: 'Implemente o login; pronto quando os testes passarem.', provider: 'claude', role: 'builder', dependsOn: ['s1'] }], ...over });
const pending = () => flows.listProposals();

before(async () => {
  db = store.load();
  const wsDir = path.join(root, 'proj'); fs.mkdirSync(wsDir);
  db.workspaces.push({ id: 'ws_1', name: 'proj', path: wsDir, hasGit: true }, { id: 'ws_2', name: 'outro', displayName: 'Outro projeto', path: wsDir, hasGit: false });
  store.saveOrThrow();
  maestro = M.createMaestro({ getTerminals: () => terminals, mcpDir: path.join(root, 'mcp'), url: 'http://127.0.0.1:4999/mcp', setTimer: () => ({ unref() {} }), watchTimer: () => ({ unref() {} }) });
  const app = express();
  app.use('/api', apiGuard); app.use(express.json({ limit: '100kb' }));
  flows = F.setupFlows(app, { db, terminals, maestro, persist: () => store.saveOrThrow(), now: () => new Date(clock).toISOString(), pollMs: 0, scheduler: false, onError: () => {} });
  maestro.setPlanner(flows.plannerPort()); // como no index.js
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { flows.stop(); await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

test('papel planner: em ROLES, sem edits, prompt sem metacaracteres de shell; NÃO é papel de etapa (STEP_ROLES)', () => {
  const p = T.ROLES.planner; assert.ok(p); assert.equal(p.label, 'Planejador'); assert.notEqual(p.edits, true);
  assert.ok(!/[&|<>^%"]/.test(p.prompt)); assert.match(p.prompt, /mission_options/); assert.match(p.prompt, /propose_mission/); assert.match(p.prompt, /Nao inicie a missao/);
  assert.deepEqual(F.STEP_ROLES, ['builder', 'reviewer', 'scout']);
  assert.match(F.validateSteps([{ title: 'a', prompt: 'b', provider: 'claude', role: 'planner' }]).error, /role inválido/);
});

test('tools/list por papel: o planner vê SÓ mission_options e propose_mission; maestro e builder não as veem', () => {
  const pl = as(addPane('planner')), ma = as(addPane('maestro')), b = as(addPane('builder'));
  assert.deepEqual(names(pl), ['mission_options', 'propose_mission']);
  assert.deepEqual(names(ma), ['list_panes', 'send_task', 'list_routes', 'read_pane_output', 'list_tasks', 'report_done']);
  assert.deepEqual(names(b), ['list_panes', 'list_tasks', 'report_done']);
});

test('ferramenta chamada por papel errado = erro (isError), sem efeito', () => {
  const pl = as(addPane('planner')), ma = as(addPane('maestro')), b = as(addPane('builder'));
  for (const c of [ma, b]) for (const n of ['mission_options', 'propose_mission']) { const r = tool(c, n, mission()); assert.equal(r.isError, true, `${c.role} ${n}`); assert.match(txt(r), /planejador/); }
  for (const n of ['list_panes', 'send_task', 'list_tasks', 'report_done', 'read_pane_output', 'list_routes']) { const r = tool(pl, n, { pane_id: b.terminalId, task: 'x', task_id: 'task_00000001', summary: 'x' }); assert.equal(r.isError, true, n); assert.match(txt(r), /planejador/); }
  assert.equal(pending().filter((p) => p.terminalId === ma.terminalId || p.terminalId === b.terminalId).length, 0);
  assert.equal(rpc(pl, 'tools/call', { name: 'toString' }).error.code, -32602, 'ferramenta inexistente continua sendo erro de protocolo');
});

test('mission_options: workspace do PANE (nome e git), provedores com listas fechadas, papéis de etapa, limites, agenda e notas', () => {
  const r = tool(as(addPane('planner')), 'mission_options'); assert.ok(!r.isError, txt(r));
  const o = JSON.parse(txt(r)); const opts = providerOptions();
  assert.deepEqual(o.workspace, { name: 'proj', git: true });
  assert.deepEqual(o.providers.map((p) => [p.id, p.label, p.available]), [['claude', 'Claude Code', true], ['codex', 'Codex CLI', true], ['gemini', 'Gemini CLI', true]]); // só IAs com o Maestro (o Gemini no nível 2; OpenCode e Cursor ficam de fora); fora da lista de terminais vale como disponível
  assert.deepEqual(o.providers[0].models, opts.claude.models); assert.deepEqual(o.providers[1].efforts, opts.codex.efforts);
  assert.deepEqual(o.roles.map((x) => [x.id, x.edits]), [['builder', true], ['reviewer', false], ['scout', false]]); assert.ok(o.roles.every((x) => x.label && x.what));
  assert.deepEqual(o.limits, { maxSteps: F.MAX_STEPS, maxParallel: F.MAX_PARALLEL, maxTitle: F.MAX_TITLE, maxGoal: F.MAX_GOAL, maxPrompt: F.MAX_PROMPT });
  assert.deepEqual(o.kinds, ['project', 'automation']); assert.deepEqual(o.schedule, { kinds: ['interval', 'daily', 'weekly'], everyHours: [1, 168], time: 'HH:MM', days: '0=dom..6=sáb' });
  assert.ok(Array.isArray(o.notes) && o.notes.length > 0 && o.notes.every((n) => typeof n === 'string'));
  const o2 = JSON.parse(txt(tool(as(addPane('planner', 'ws_2')), 'mission_options'))); assert.deepEqual(o2.workspace, { name: 'Outro projeto', git: false }, 'displayName vale; outro pane, outro workspace');
  available.codex = false; try { assert.equal(JSON.parse(txt(tool(as(addPane('planner')), 'mission_options'))).providers[1].available, false); } finally { available.codex = true; }
});

test('mission_options/propose_mission: pane encerrado ou workspace removido = erro; sem a porta ligada = erro', () => {
  const id = addPane('planner'); panes.get(id).status = 'exited';
  assert.match(txt(tool(as(id), 'mission_options')), /não está ativo/);
  const gone = addPane('planner', 'ws_sumiu');
  assert.match(txt(tool(as(gone), 'mission_options')), /não existe mais/); assert.equal(tool(as(gone), 'propose_mission', mission()).isError, true);
  const bare = M.createMaestro({ getTerminals: () => terminals, url: 'http://127.0.0.1:1/mcp' });
  const r = bare.rpc(as(addPane('planner')), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mission_options', arguments: {} } }).result; assert.equal(r.isError, true); assert.match(txt(r), /ainda não estão disponíveis/);
  assert.throws(() => bare.setPlanner({ options: () => {} }), TypeError);
});

test('propose_mission válida: proposta pendente com o workspace do PANE e fullAccess false; o texto de retorno é o do contrato', () => {
  const pl = addPane('planner', 'ws_2');
  const r = tool(as(pl), 'propose_mission', mission({ kind: 'project', maxParallel: 2 })); assert.ok(!r.isError, txt(r));
  const id = /^Proposta (prop_[0-9a-f]{8}) enviada para revisão na tela de Missões\. O usuário vai revisar e criar; você pode continuar refinando e enviar outra \(ela substitui esta\)\.$/.exec(txt(r))?.[1]; assert.ok(id, txt(r));
  const p = pending().find((x) => x.id === id); assert.ok(p);
  assert.deepEqual([p.terminalId, p.workspaceId, p.workspaceName, p.createdAt], [pl, 'ws_2', 'Outro projeto', new Date(clock).toISOString()]);
  assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'flow', 'id', 'terminalId', 'workspaceId', 'workspaceName']);
  assert.equal(p.flow.fullAccess, false); assert.equal(p.flow.workspaceId, 'ws_2'); assert.equal(p.flow.maxParallel, 2); assert.equal(p.flow.autoIntegrate, true); assert.equal(p.flow.schedule, null);
  assert.deepEqual(p.flow.steps[0], { id: 's1', title: 'Mapear', prompt: 'Mapeie o fluxo de login atual.', provider: 'claude', role: 'scout', model: 'sonnet', effort: 'low', dependsOn: [], continueFrom: null });
  p.flow.title = 'alterado fora'; assert.equal(pending().find((x) => x.id === id).flow.title, 'Login com e-mail', 'a lista devolve cópia');
  assert.equal(db.flows.length, 0, 'nada é criado sem o usuário');
  flows.dismissProposal(id);
});

test('propose_mission: workspaceId, fullAccess, proposalId ou chave extra nos argumentos = erro e nada é registrado', () => {
  const pl = addPane('planner'); const n = pending().length;
  for (const extra of [{ workspaceId: 'ws_2' }, { workspaceId: 'ws_1' }, { fullAccess: false }, { fullAccess: true }, { proposalId: 'prop_00000001' }]) {
    const r = tool(as(pl), 'propose_mission', mission(extra)); assert.equal(r.isError, true, JSON.stringify(extra)); assert.match(txt(r), /não permitidas/);
  }
  const r = tool(as(pl), 'propose_mission', mission({ cwd: '/etc' })); assert.equal(r.isError, true); assert.match(txt(r), /Propriedades não permitidas: cwd/);
  const r2 = tool(as(pl), 'propose_mission', mission({ steps: [{ title: 'a', prompt: 'b', provider: 'claude', role: 'builder', command: 'rm -rf /' }] })); assert.equal(r2.isError, true); assert.match(txt(r2), /não permitidas/);
  assert.equal(pending().length, n);
});

test('propose_mission: validação recusada volta como isError com a mensagem em português (o agente corrige e reenvia)', () => {
  const pl = addPane('planner');
  const cases = [
    [mission({ title: '' }), /title é obrigatório/],
    [mission({ steps: [] }), /steps deve ser uma lista/],
    [mission({ steps: [{ title: 'a', prompt: 'b', provider: 'claude', role: 'planner' }] }), /role inválido/],
    [mission({ steps: [{ title: 'a', prompt: 'b', provider: 'claude', role: 'maestro' }] }), /role inválido/],
    [mission({ steps: [{ title: 'a', prompt: 'b', provider: 'claude', role: 'builder', model: 'gpt-99' }] }), /model inválido/],
    [mission({ schedule: { kind: 'daily', time: '09:00' } }), /agenda só vale/],
    [mission({ maxParallel: 9 }), /maxParallel/],
  ];
  for (const [args, re] of cases) { const r = tool(as(pl), 'propose_mission', args); assert.equal(r.isError, true, JSON.stringify(args).slice(0, 80)); assert.match(txt(r), re); }
  for (const bad of [[], 'x', null]) assert.equal(maestro.rpc(as(pl), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_mission', arguments: bad } }).result.isError, true);
  assert.equal(pending().filter((p) => p.terminalId === pl).length, 0);
  const auto = tool(as(pl), 'propose_mission', mission({ kind: 'automation', schedule: { kind: 'weekly', days: [1, 3], time: '09:30' } })); assert.ok(!auto.isError, txt(auto));
  assert.deepEqual(pending().find((p) => p.terminalId === pl).flow.schedule, { enabled: false, kind: 'weekly', days: [1, 3], time: '09:30' }, 'a agenda da proposta vem sempre desligada');
  flows.dismissProposal(pending().find((p) => p.terminalId === pl).id);
});

test('segunda proposta do MESMO terminal substitui a pendente; de outro terminal, convive', () => {
  const a = addPane('planner'), b = addPane('planner');
  const id1 = /prop_[0-9a-f]{8}/.exec(txt(tool(as(a), 'propose_mission', mission({ title: 'v1' }))))[0];
  const id2 = /prop_[0-9a-f]{8}/.exec(txt(tool(as(a), 'propose_mission', mission({ title: 'v2' }))))[0];
  const id3 = /prop_[0-9a-f]{8}/.exec(txt(tool(as(b), 'propose_mission', mission({ title: 'outro' }))))[0];
  assert.notEqual(id1, id2);
  const mine = pending().filter((p) => p.terminalId === a); assert.deepEqual(mine.map((p) => [p.id, p.flow.title]), [[id2, 'v2']]);
  assert.ok(pending().some((p) => p.id === id3));
  assert.equal(flows.dismissProposal(id1).status, 404, 'a substituída não existe mais');
  flows.dismissProposal(id2); flows.dismissProposal(id3);
});

test('limite de propostas pendentes (MAX_PROPOSALS) e expiração em 24 h pelo relógio injetado', () => {
  assert.equal(pending().length, 0);
  const ids = []; for (let i = 0; i < F.MAX_PROPOSALS; i++) { const r = tool(as(addPane('planner')), 'propose_mission', mission({ title: `p${i}` })); assert.ok(!r.isError, txt(r)); ids.push(/prop_[0-9a-f]{8}/.exec(txt(r))[0]); }
  assert.equal(pending().length, F.MAX_PROPOSALS);
  const over = tool(as(addPane('planner')), 'propose_mission', mission()); assert.equal(over.isError, true); assert.match(txt(over), new RegExp(`Há ${F.MAX_PROPOSALS} propostas`));
  const again = panes.get(pending()[0].terminalId).id; assert.ok(!tool(as(again), 'propose_mission', mission({ title: 'troca' })).isError, 'substituir a do próprio terminal continua valendo no limite');
  assert.equal(pending().length, F.MAX_PROPOSALS);
  clock += F.PROPOSAL_TTL_MS - 1000; assert.equal(pending().length, F.MAX_PROPOSALS, 'antes de 24 h continuam');
  clock += 2000; assert.equal(pending().length, 0, 'depois de 24 h somem');
  assert.equal(flows.dismissProposal(ids[1]).status, 404, 'expirada não é encontrada');
  assert.ok(!tool(as(addPane('planner')), 'propose_mission', mission()).isError, 'com as expiradas fora, há espaço de novo');
  for (const p of pending()) flows.dismissProposal(p.id);
});

test('dispatch e send_task recusam o planejador como destino; list_panes não o mostra', () => {
  const pl = addPane('planner'), ma = addPane('maestro');
  const d = maestro.dispatch({ to: pl, text: 'faça algo' }); assert.equal(d.ok, false); assert.match(d.error, /planejador/);
  const s = tool(as(ma), 'send_task', { pane_id: pl, task: 'faça algo' }); assert.equal(s.isError, true); assert.match(txt(s), /planejador/);
  assert.ok(!JSON.parse(txt(tool(as(ma), 'list_panes'))).some((x) => x.pane_id === pl || x.role === 'planner'));
  assert.equal(maestro.snapshot().tasks.length, 0);
  assert.match(maestro.dispatch({ to: ma, text: 'x' }).error, /maestro/, 'o maestro continua recusado como antes');
});

test('POST /api/flows/briefing: abre um terminal planner pelo terminals.create (Claude padrão) e devolve { terminalId, session }', async () => {
  const before = created.length;
  const r = await jr(await call('/api/flows/briefing', 'POST', { workspaceId: 'ws_1' }));
  assert.equal(r.status, 201, JSON.stringify(r.j)); assert.match(r.j.terminalId, /^term_[0-9a-f]{8}$/); assert.equal(r.j.session.id, r.j.terminalId);
  assert.deepEqual(Object.keys(r.j).sort(), ['session', 'terminalId']);
  assert.deepEqual(created.at(-1), { workspaceId: 'ws_1', role: 'planner', provider: 'claude', model: null, effort: null, title: 'Planejador de missão', acknowledgeProjectConfig: false });
  const r2 = await jr(await call('/api/flows/briefing', 'POST', { workspaceId: 'ws_2', provider: 'codex', model: 'gpt-5', effort: 'high' })); assert.equal(r2.status, 201, JSON.stringify(r2.j));
  assert.deepEqual(created.at(-1), { workspaceId: 'ws_2', role: 'planner', provider: 'codex', model: 'gpt-5', effort: 'high', title: 'Planejador de missão', acknowledgeProjectConfig: false });
  assert.equal(created.length, before + 2);
  // o terminal aberto pela rota é um planner de verdade para o Maestro: vê as ferramentas dele e propõe para o workspace dele
  const pl = { terminalId: r.j.terminalId, role: 'planner' }; assert.deepEqual(names(pl), ['mission_options', 'propose_mission']);
  assert.ok(!tool(pl, 'propose_mission', mission()).isError); assert.equal(pending().find((p) => p.terminalId === pl.terminalId).workspaceId, 'ws_1');
  flows.dismissProposal(pending().find((p) => p.terminalId === pl.terminalId).id);
});

test('POST /api/flows/briefing: validação 400, workspace 404, provedor indisponível 409 e o erro do terminals.create repassado (status, code, files); nada é aberto', async () => {
  const before = created.length;
  const bad = async (b, status, re) => { const r = await jr(await call('/api/flows/briefing', 'POST', b)); assert.equal(r.status, status, JSON.stringify(b)); assert.match(r.j.error, re); };
  await bad({}, 400, /workspaceId/); await bad({ workspaceId: 7 }, 400, /workspaceId/); await bad([], 400, /objeto/);
  await bad({ workspaceId: 'ws_nao' }, 404, /não encontrado/);
  await bad({ workspaceId: 'ws_1', provider: 'gpt' }, 400, /provider/); await bad({ workspaceId: 'ws_1', provider: '__proto__' }, 400, /provider/);
  await bad({ workspaceId: 'ws_1', model: 'gpt-5' }, 400, /model inválido/); await bad({ workspaceId: 'ws_1', effort: 'turbo' }, 400, /effort inválido/);
  await bad({ workspaceId: 'ws_1', role: 'builder' }, 400, /não permitidas: role/); await bad({ workspaceId: 'ws_1', fullAccess: true }, 400, /não permitidas: fullAccess/); await bad({ workspaceId: 'ws_1', title: 'x' }, 400, /não permitidas/);
  available.codex = false; try { await bad({ workspaceId: 'ws_1', provider: 'codex' }, 409, /não está disponível/); } finally { available.codex = true; }
  for (const ack of ['true', 1, 0, null, {}, []]) await bad({ workspaceId: 'ws_1', acknowledgeProjectConfig: ack }, 400, /acknowledgeProjectConfig deve ser verdadeiro ou falso/); // booleano estrito
  assert.equal(created.length, before, 'nada chegou ao terminals.create');
  createResult = { ok: false, status: 409, error: 'Limite de 50 terminais simultâneos atingido; feche algum antes de abrir outro.' };
  try {
    await bad({ workspaceId: 'ws_1' }, 409, /Limite de 50/);
    createResult = { ok: false, status: 409, error: 'Este espaço de trabalho tem configuração do Claude Code que executa comandos e não está revisada no Git: .mcp.json (x).', code: 'project_config_unreviewed', files: [{ path: '.mcp.json', why: 'x' }] };
    const r = await jr(await call('/api/flows/briefing', 'POST', { workspaceId: 'ws_1' }));
    assert.equal(r.status, 409); assert.equal(r.j.code, 'project_config_unreviewed'); assert.deepEqual(r.j.files, [{ path: '.mcp.json', why: 'x' }]);
  } finally { createResult = null; }
});

test('POST /api/flows/briefing com acknowledgeProjectConfig: o booleano chega ao terminals.create (true só quando enviado true)', async () => {
  for (const [ack, want] of [[true, true], [false, false]]) {
    const r = await jr(await call('/api/flows/briefing', 'POST', { workspaceId: 'ws_1', acknowledgeProjectConfig: ack })); assert.equal(r.status, 201, JSON.stringify(r.j));
    assert.deepEqual(created.at(-1), { workspaceId: 'ws_1', role: 'planner', provider: 'claude', model: null, effort: null, title: 'Planejador de missão', acknowledgeProjectConfig: want });
  }
});

test('proposta pendente de planejador que NÃO está mais rodando: sai da lista (dismissed, terminal_closed), não conta no limite e não pode ser descartada de novo', () => {
  assert.equal(pending().length, 0);
  const a = addPane('planner'), b = addPane('planner');
  const ida = /prop_[0-9a-f]{8}/.exec(txt(tool(as(a), 'propose_mission', mission({ title: 'de a' }))))[0];
  const idb = /prop_[0-9a-f]{8}/.exec(txt(tool(as(b), 'propose_mission', mission({ title: 'de b' }))))[0];
  assert.deepEqual(pending().map((p) => p.id).sort(), [ida, idb].sort());
  terminals.close(a); // status exited
  assert.deepEqual(pending().map((p) => p.id), [idb], 'a do terminal fechado some da lista');
  assert.equal(flows.dismissProposal(ida).status, 404, 'já foi baixada (terminal_closed)');
  panes.delete(b); // terminal que sumiu da lista (fechado e removido)
  assert.equal(pending().length, 0);
  // o limite só conta as pendentes de terminais vivos: 20 vivas cabem mesmo depois das baixadas acima
  const ids = []; for (let i = 0; i < F.MAX_PROPOSALS; i++) { const r = tool(as(addPane('planner')), 'propose_mission', mission({ title: `v${i}` })); assert.ok(!r.isError, txt(r)); ids.push(/prop_[0-9a-f]{8}/.exec(txt(r))[0]); }
  assert.equal(pending().length, F.MAX_PROPOSALS);
  assert.equal(tool(as(addPane('planner')), 'propose_mission', mission()).isError, true, 'no limite com 20 vivas');
  terminals.close(pending()[0].terminalId);
  assert.ok(!tool(as(addPane('planner')), 'propose_mission', mission({ title: 'cabe' })).isError, 'a do terminal fechado deixou de contar');
  for (const p of pending()) flows.dismissProposal(p.id);
});

test('GET /api/flows/proposals lista só as pendentes; POST .../dismiss = 204 e depois 404', async () => {
  const pl = addPane('planner');
  const id = /prop_[0-9a-f]{8}/.exec(txt(tool(as(pl), 'propose_mission', mission())))[0];
  const other = /prop_[0-9a-f]{8}/.exec(txt(tool(as(addPane('planner')), 'propose_mission', mission({ title: 'outra' }))))[0];
  let r = await jr(await call('/api/flows/proposals')); assert.equal(r.status, 200);
  assert.deepEqual(r.j.map((p) => p.id).sort(), [id, other].sort());
  const p = r.j.find((x) => x.id === id); assert.deepEqual([p.terminalId, p.workspaceId, p.workspaceName, p.flow.fullAccess, p.flow.title], [pl, 'ws_1', 'proj', false, 'Login com e-mail']);
  const d = await call(`/api/flows/proposals/${id}/dismiss`, 'POST'); assert.equal(d.status, 204); assert.equal(await d.text(), '');
  r = await jr(await call('/api/flows/proposals')); assert.deepEqual(r.j.map((x) => x.id), [other], 'descartada não aparece');
  for (const bad of [id, 'prop_zzzzzzzz', 'x', 'prop_000000001']) { const x = await jr(await call(`/api/flows/proposals/${bad}/dismiss`, 'POST')); assert.equal(x.status, 404, bad); assert.match(x.j.error, /Proposta não encontrada/); }
  flows.dismissProposal(other);
});

test('POST /api/flows com proposalId: cria a missão e a proposta vira used (sai da lista); id inexistente cria normalmente; formato inválido = 400', async () => {
  const pl = addPane('planner');
  const id = /prop_[0-9a-f]{8}/.exec(txt(tool(as(pl), 'propose_mission', mission())))[0];
  const prop = (await jr(await call('/api/flows/proposals'))).j.find((p) => p.id === id);
  const c = await jr(await call('/api/flows', 'POST', { ...prop.flow, fullAccess: false, proposalId: id }));
  assert.equal(c.status, 201, JSON.stringify(c.j)); assert.ok(!('proposalId' in c.j), 'o id da proposta não vai para a missão'); assert.equal(c.j.fullAccess, false); assert.equal(c.j.workspaceId, 'ws_1');
  assert.ok(!('proposalId' in db.flows.find((f) => f.id === c.j.id)));
  assert.equal((await jr(await call('/api/flows/proposals'))).j.some((p) => p.id === id), false, 'used não aparece');
  assert.equal(flows.dismissProposal(id).status, 404);
  const ghost = await jr(await call('/api/flows', 'POST', { ...prop.flow, title: 'Sem proposta', proposalId: 'prop_00000000' })); assert.equal(ghost.status, 201, 'proposta inexistente não impede a criação');
  for (const bad of ['x', 'prop_XYZ', 7, true]) { const r = await jr(await call('/api/flows', 'POST', { ...prop.flow, proposalId: bad })); assert.equal(r.status, 400, String(bad)); assert.match(r.j.error, /proposalId/); }
  // criação que falha na validação NÃO baixa a proposta
  const id2 = /prop_[0-9a-f]{8}/.exec(txt(tool(as(pl), 'propose_mission', mission({ title: 'segunda' }))))[0];
  const fail = await jr(await call('/api/flows', 'POST', { ...prop.flow, title: '', proposalId: id2 })); assert.equal(fail.status, 400);
  assert.ok((await jr(await call('/api/flows/proposals'))).j.some((p) => p.id === id2), 'continua pendente');
  flows.dismissProposal(id2);
});

test('Origin externo ou ausente: 403 nas rotas novas e nada é aberto nem descartado', async () => {
  const before = created.length;
  const id = /prop_[0-9a-f]{8}/.exec(txt(tool(as(addPane('planner')), 'propose_mission', mission())))[0];
  const evil = { origin: 'http://evil.example' };
  assert.equal((await call('/api/flows/briefing', 'POST', { workspaceId: 'ws_1' }, evil)).status, 403);
  assert.equal((await fetch(`${base}/api/flows/briefing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'ws_1' }) })).status, 403);
  assert.equal((await call('/api/flows/proposals', 'GET', undefined, evil)).status, 403);
  assert.equal((await call(`/api/flows/proposals/${id}/dismiss`, 'POST', undefined, evil)).status, 403);
  assert.equal(created.length, before); assert.ok(pending().some((p) => p.id === id));
  flows.dismissProposal(id);
});

test('terminals.create (PTY simulado): papel planner abre com o prompt dele e NUNCA ganha acesso total pelo Maestro autônomo', async () => {
  const spawned = []; let pid = 1_940_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {} }; spawned.push(p); return p; } };
  const wsDir = path.join(root, 'tws'); fs.mkdirSync(wsDir, { recursive: true });
  const tdb = { settings: { activeWorkspaceId: 'w1' }, workspaces: [{ id: 'w1', name: 'W', path: wsDir }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db: tdb, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => [], persist: () => {}, autoFullAccess: () => true });
  const r = await mgr.create({ workspaceId: 'w1', role: 'planner', title: F.PLANNER_TITLE }); assert.equal(r.ok, true, r.error);
  const args = spawned.at(-1).args; assert.equal(args[args.indexOf('--append-system-prompt') + 1], T.ROLES.planner.prompt);
  assert.ok(!args.includes('--dangerously-skip-permissions'), 'o planejador não sobe sem confirmação de permissão'); assert.equal(r.session.fullAccess, false);
  assert.equal(r.session.title, 'Planejador de missão'); assert.equal(r.session.role, 'planner');
  const b = await mgr.create({ workspaceId: 'w1', role: 'builder' }); assert.equal(b.ok, true); assert.ok(spawned.at(-1).args.includes('--dangerously-skip-permissions'), 'os demais papéis seguem a regra do autônomo');
  assert.ok(mgr.roles().some((x) => x.id === 'planner' && x.edits === false));
});

test('terminals.create: planner com fullAccess interno true continua SEM acesso total; Claude recebe --disallowedTools Edit Write NotebookEdit antes do MCP, os outros papéis não', async () => {
  const spawned = []; let pid = 1_941_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit() {}, write() {}, resize() {} }; spawned.push(p); return p; } };
  const wsDir = path.join(root, 'tws2'); fs.mkdirSync(wsDir, { recursive: true });
  const tdb = { settings: { activeWorkspaceId: 'w1' }, workspaces: [{ id: 'w1', name: 'W', path: wsDir }], worktrees: [], topics: [] };
  const mcp = { serverName: 'forge_abc123', issue: ({ terminalId }) => ({ configPath: path.join(root, `${terminalId}.json`) }), revoke() {} };
  const mgr = T.createTerminalManager({ db: tdb, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => [], persist: () => {}, mcp });
  const r = await mgr.create({ workspaceId: 'w1', role: 'planner', fullAccess: true }); assert.equal(r.ok, true, r.error); assert.equal(r.session.fullAccess, false);
  const a = spawned.at(-1).args; assert.ok(!a.includes('--dangerously-skip-permissions'));
  const i = a.indexOf('--disallowedTools'); assert.ok(i > 0); assert.deepEqual(a.slice(i, i + 4), ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit']);
  assert.equal(a[i + 4], '--mcp-config', 'logo depois vem outra flag: nada é engolido pela lista variádica'); assert.deepEqual(a.slice(-2), ['--allowedTools', 'mcp__forge_abc123']);
  for (const role of ['builder', 'reviewer', 'scout', 'maestro']) { const x = await mgr.create({ workspaceId: 'w1', role }); assert.equal(x.ok, true, x.error); assert.ok(!spawned.at(-1).args.includes('--disallowedTools'), role); }
  assert.deepEqual(mgr.roles().map((x) => [x.id, x.team]), [['maestro', true], ['builder', true], ['reviewer', true], ['scout', true], ['planner', false]], 'o planejador não entra em times nem no seletor do Cockpit');
});

// ---------- integração: gerente de terminais REAL (PTY simulado) + Maestro REAL (MCP com credencial do pane) + flows REAL ----------
test('INTEGRAÇÃO: briefing abre o planner real (409 sem ack, 201 com ack); com a credencial do pane chama mission_options e propose_mission; proposta com o workspace certo; fechar baixa a proposta; sessão planner não é retomável', async () => {
  const spawned = []; let pid = 1_942_000_000, n = 0;
  const cfg = [{ path: '.mcp.json', why: 'não versionado' }];
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {} }; spawned.push(p); return p; } };
  const fake = (file) => () => ({ file, args: [], viaShell: false });
  let mgr = null;
  const mae = M.createMaestro({ getTerminals: () => mgr, mcpDir: path.join(root, 'mcp-int'), url: 'http://127.0.0.1:4999/mcp', lockDir: () => true, setTimer: () => ({ unref() {} }), watchTimer: () => ({ unref() {} }) });
  mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: fake('/fake/claude'), resolveCommands: { codex: fake('/fake/codex') }, killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, inspectConfig: async () => cfg, persist: () => store.saveOrThrow(), mcp: mae, transcriptExists: () => true });
  const fl = F.createFlows({ db, terminals: mgr, maestro: mae, persist: () => store.saveOrThrow(), now: () => new Date(clock).toISOString(), pollMs: 0, onError: () => {} });
  mae.setPlanner(fl.plannerPort());
  try {
    // configuração de projeto não revisada: 409 com a lista (nada abre); com o ack do usuário: 201
    const no = await fl.openBriefing({ workspaceId: 'ws_1' });
    assert.equal(no.status, 409); assert.equal(no.code, 'project_config_unreviewed'); assert.deepEqual(no.extra.files, cfg); assert.equal(spawned.length, 0);
    const ok = await fl.openBriefing({ workspaceId: 'ws_1', acknowledgeProjectConfig: true }); assert.equal(ok.status, 201, ok.error);
    const tid = ok.body.terminalId; assert.match(tid, /^term_[0-9a-f]{8}$/); assert.equal(ok.body.session.role, 'planner'); assert.equal(ok.body.session.workspaceId, 'ws_1');
    assert.equal(mgr.peek(tid).workspaceId, undefined, 'o peek real continua sem workspaceId (contrato inalterado)');
    // a credencial é a do PANE: lida do --mcp-config que o processo recebeu
    const a = spawned.at(-1).args, file = a[a.indexOf('--mcp-config') + 1];
    const auth = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers)[0].headers.Authorization;
    const caller = mae.authenticate(auth); assert.deepEqual(caller, { terminalId: tid, role: 'planner' });
    assert.ok(a.includes('--disallowedTools') && !a.includes('--dangerously-skip-permissions'));
    const call2 = (name, args = {}) => mae.rpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
    const o = call2('mission_options'); assert.ok(!o.isError, o.content[0].text);
    assert.deepEqual(JSON.parse(o.content[0].text).workspace, { name: 'proj', git: true });
    const pr = call2('propose_mission', mission({ kind: 'automation', schedule: { kind: 'daily', time: '08:00' } })); assert.ok(!pr.isError, pr.content[0].text);
    const list = fl.listProposals(); assert.equal(list.length, 1);
    assert.deepEqual([list[0].terminalId, list[0].workspaceId, list[0].workspaceName, list[0].flow.workspaceId, list[0].flow.fullAccess, list[0].flow.schedule.enabled], [tid, 'ws_1', 'proj', 'ws_1', false, false]);
    // Codex como planejador: sandbox read-only (com aprovação on-request), nunca workspace-write nem bypass
    const cx = await fl.openBriefing({ workspaceId: 'ws_2', provider: 'codex', acknowledgeProjectConfig: true }); assert.equal(cx.status, 201, cx.error);
    const ca = spawned.at(-1).args, si = ca.indexOf('-s'); assert.deepEqual(ca.slice(si, si + 4), ['-s', 'read-only', '-a', 'on-request']);
    assert.ok(!ca.includes('workspace-write') && !ca.includes('--dangerously-bypass-approvals-and-sandbox'));
    // fechar o terminal do planejador: a proposta pendente sai da lista e a ferramenta deixa de responder para ele
    mgr.close(tid);
    assert.equal(fl.listProposals().length, 0);
    assert.equal(fl.plannerPort().propose(caller, mission()).ok, false, 'pane fechado não propõe');
    // histórico: a sessão do planejador nunca é retomável nem reabrível; retomar, bifurcar e reabrir = 409 planner_session
    const recId = ok.body.session.recordId, h = mgr.history().find((x) => x.id === recId);
    assert.deepEqual([h.role, h.resumable, h.reopenable, h.blockedReason], ['planner', false, false, 'planner_session']); assert.match(h.blockedMessage, /Abra um novo planejador pela tela de Missões/);
    const before2 = spawned.length;
    for (const opts of [{}, { fork: true }, { reopen: true }]) { const r = await mgr.resume({ recordId: recId, ...opts }); assert.equal(r.status, 409, JSON.stringify(opts)); assert.equal(r.code, 'planner_session'); assert.equal(r.error, 'Abra um novo planejador pela tela de Missões.'); }
    // interrompida (encerramento gracioso do servidor), que a restauração automática do Cockpit tentaria reabrir: continua bloqueada
    mgr.killAllSync();
    const cxRec = mgr.history().find((x) => x.id === cx.body.session.recordId); assert.equal(cxRec.state, 'interrupted');
    assert.deepEqual([cxRec.resumable, cxRec.reopenable, cxRec.blockedReason], [false, false, 'planner_session']);
    const re = await mgr.resume({ recordId: cxRec.id, reopen: true }); assert.equal(re.status, 409); assert.equal(re.code, 'planner_session');
    assert.equal(spawned.length, before2, 'nenhum processo foi aberto pelas tentativas de retomada');
  } finally { mgr.killAllSync(); mae.setPlanner(null); fl.stop(); db.terminalSessions = []; store.saveOrThrow(); }
});
