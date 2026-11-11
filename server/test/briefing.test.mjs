// Briefing do usuário ao Maestro (maestro.js): validação estrita da rota, escolha do Maestro de destino, a linha curta digitada com a mesma entrega segura do relatório,
// fila e novas tentativas, a ferramenta MCP get_briefing (só o maestro endereçado) e o snapshot. Terminais simulados, nenhum agente real, diretórios TEMPORÁRIOS.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-briefing-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const { default: express } = await import('express');
const M = await import('../maestro.js');
const { ROLES } = await import('../terminals.js');
const { apiGuard } = await import('../origin-guard.js');

const MA = 'term_aaaaaaaa', MB = 'term_bbbbbbbb', B1 = 'term_cccccccc', MX = 'term_dddddddd';
const IDLE = { state: 'idle', at: '2026-11-03T11:59:00.000Z' }, OLD = '2026-11-03T11:00:00.000Z';
function world() {
  const panes = new Map([
    [MA, { id: MA, role: 'maestro', title: 'Maestro 1', status: 'running', provider: 'claude', workspaceId: 'ws1', agent: { ...IDLE }, lastOutputAt: OLD }],
    [B1, { id: B1, role: 'builder', title: 'Construtor 1', status: 'running', provider: 'claude', workspaceId: 'ws1', agent: { ...IDLE }, lastOutputAt: OLD }],
    [MX, { id: MX, role: 'maestro', title: 'Maestro outro', status: 'running', provider: 'claude', workspaceId: 'ws2', agent: { ...IDLE }, lastOutputAt: OLD }],
  ]);
  const written = [], timers = []; let n = 0;
  const api = { get: (id) => panes.get(id) ?? null, peek: (id) => panes.get(id) ?? null, list: () => [...panes.values()], readOutput: () => '',
    write: (id, d) => { const p = panes.get(id); if (!p || p.status !== 'running') return { ok: false, status: 409, error: 'O terminal já terminou.' }; written.push([id, d]); return { ok: true, status: 200 }; } };
  const m = M.createMaestro({ getTerminals: () => api, mcpDir: path.join(tmp, `mcp-${Math.random().toString(16).slice(2)}`), url: 'http://127.0.0.1:4999/mcp', uid: (p) => `${p}_${String(++n).padStart(8, '0')}`, setTimer: (fn) => { timers.push(fn); return { unref() {} }; } });
  const call = (caller, name, args = {}) => m.rpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  return { m, panes, written, timers, api, call };
}
const lineFor = (id) => `[Briefing ${id} do usuario] Chame a ferramenta get_briefing com briefing_id ${id}, leia o pedido completo e conduza o squad seguindo a skill orquestrar-briefing.`;

test('validação estrita do corpo: propriedades, tipos, paneId e o texto (1 a 8000 depois de limpar)', () => {
  const ok = M.validateBriefingBody({ workspaceId: 'ws1', text: '  Faça a\r\npágina\u0007 de\tlogin\u001b[31m  ' });
  assert.deepEqual(ok.value, { workspaceId: 'ws1', paneId: null, text: 'Faça a\npágina de\tlogin' }, 'controles e ANSI saem; \\n e \\t ficam; aparado');
  assert.equal(M.validateBriefingBody({ workspaceId: 'ws1', paneId: MA, text: 'x' }).value.paneId, MA);
  assert.equal(M.validateBriefingBody({ workspaceId: 'ws1', text: 'x'.repeat(M.MAX_BRIEFING_TEXT) }).value.text.length, M.MAX_BRIEFING_TEXT);
  for (const [b, re] of [[null, /objeto/], [[], /objeto/], ['x', /objeto/], [{ workspaceId: 'ws1', text: 'x', extra: 1 }, /não permitidas: extra/], [{ text: 'x' }, /workspaceId/], [{ workspaceId: 7, text: 'x' }, /workspaceId/], [{ workspaceId: '', text: 'x' }, /workspaceId/],
    [{ workspaceId: 'ws1', paneId: '../x', text: 'x' }, /paneId/], [{ workspaceId: 'ws1', paneId: 5, text: 'x' }, /paneId/], [{ workspaceId: 'ws1' }, /text/], [{ workspaceId: 'ws1', text: 5 }, /text/], [{ workspaceId: 'ws1', text: ' \n\t\u0000 ' }, /1 a 8000/], [{ workspaceId: 'ws1', text: 'x'.repeat(M.MAX_BRIEFING_TEXT + 1) }, /1 a 8000/]]) {
    const v = M.validateBriefingBody(b); assert.ok(v.error, JSON.stringify(b)?.slice(0, 60)); assert.match(v.error, re);
  }
});

test('destino: o único Maestro rodando no workspace; nenhum = no_maestro; mais de um = many_maestros com a lista; paneId que não é Maestro ativo do workspace = no_maestro', () => {
  const w = world();
  const r = w.m.submitBriefing({ workspaceId: 'ws1', text: 'Crie a página de login.' });
  assert.equal(r.ok, true); assert.equal(r.status, 201); assert.equal(r.briefing.paneId, MA); assert.match(r.briefing.id, /^brf_[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(r.briefing).sort(), ['createdAt', 'id', 'paneId', 'status'], 'a resposta não leva o texto');
  assert.deepEqual(w.m.submitBriefing({ workspaceId: 'ws-vazio', text: 'x' }), { ok: false, status: 409, code: 'no_maestro', error: 'Abra um time com Maestro neste workspace.' });
  for (const paneId of [B1, MX, 'term_eeeeeeee']) { const x = w.m.submitBriefing({ workspaceId: 'ws1', paneId, text: 'x' }); assert.equal(x.code, 'no_maestro', paneId); assert.equal(x.status, 409); }
  w.panes.get(MA).status = 'exited'; assert.equal(w.m.submitBriefing({ workspaceId: 'ws1', text: 'x' }).code, 'no_maestro', 'Maestro encerrado não conta');
  w.panes.get(MA).status = 'running';
  w.panes.set(MB, { id: MB, role: 'maestro', title: 'Maestro 2', status: 'running', provider: 'claude', workspaceId: 'ws1', agent: { ...IDLE }, lastOutputAt: OLD });
  const many = w.m.submitBriefing({ workspaceId: 'ws1', text: 'x' });
  assert.equal(many.status, 409); assert.equal(many.code, 'many_maestros'); assert.deepEqual(many.panes, [{ id: MA, title: 'Maestro 1' }, { id: MB, title: 'Maestro 2' }]);
  assert.equal(w.m.submitBriefing({ workspaceId: 'ws1', paneId: MB, text: 'para o 2' }).briefing.paneId, MB);
});

test('entrega: digita UMA linha curta e fixa (sem o texto do usuário nem caracteres especiais) e o Enter separado; status delivered', () => {
  const w = world(); const r = w.m.submitBriefing({ workspaceId: 'ws1', text: 'Segredo do pedido & "aspas" | não vão para o terminal' });
  assert.equal(r.briefing.status, 'delivered');
  assert.deepEqual(w.written, [[MA, lineFor(r.briefing.id)]]); assert.doesNotMatch(w.written[0][1], /[&|<>^%"`]|Segredo/);
  assert.equal(w.timers.length, 1); w.timers.shift()(); assert.deepEqual(w.written[1], [MA, '\r']);
  const snap = w.m.snapshot().briefings; assert.equal(snap.length, 1);
  assert.deepEqual(Object.keys(snap[0]).sort(), ['createdAt', 'id', 'note', 'paneId', 'preview', 'status', 'workspaceId']);
  assert.equal(snap[0].status, 'delivered'); assert.equal(snap[0].preview, 'Segredo do pedido & "aspas" | não vão para o terminal');
});

test('fila: Maestro aguardando permissão, sem estado, trabalhando, com saída recente ou recebendo outra entrega => queued, nada digitado; entra sozinho quando liberar', () => {
  const t0 = new Date().toISOString();
  const cases = [
    ['aguardando permissão', (p) => { p.agent = { state: 'waiting', at: t0 }; }, /aguardando uma permissão/],
    ['sem estado', (p) => { p.agent = null; }, /estado dele é desconhecido/],
    ['trabalhando', (p) => { p.agent = { state: 'running', at: t0 }; p.lastOutputAt = new Date().toISOString(); }, /trabalhando/],
    ['saída recente', (p) => { p.lastOutputAt = new Date().toISOString(); }, /digitação em curso/],
  ];
  for (const [nome, block, re] of cases) {
    const w = world(); block(w.panes.get(MA));
    const r = w.m.submitBriefing({ workspaceId: 'ws1', text: 'x' });
    assert.equal(r.briefing.status, 'queued', nome); assert.equal(w.written.length, 0, nome);
    assert.match(w.m.snapshot().briefings[0].note, re, nome); assert.equal(w.timers.length, 1, `${nome}: tenta de novo`);
    w.timers.shift()(); assert.equal(w.written.length, 0, `${nome}: segue esperando`);
    Object.assign(w.panes.get(MA), { agent: { ...IDLE }, lastOutputAt: OLD });
    w.timers.shift()(); assert.deepEqual(w.written[0], [MA, lineFor(r.briefing.id)], `${nome}: liberado, entra`);
    assert.equal(w.m.snapshot().briefings[0].status, 'delivered'); assert.equal(w.m.snapshot().briefings[0].note, null);
  }
  // outra entrega em curso no mesmo Maestro: o segundo briefing não se cola na linha do primeiro
  const w = world(); const a = w.m.submitBriefing({ workspaceId: 'ws1', text: 'um' }), b = w.m.submitBriefing({ workspaceId: 'ws1', text: 'dois' });
  assert.equal(a.briefing.status, 'delivered'); assert.equal(b.briefing.status, 'queued'); assert.match(w.m.snapshot().briefings[0].note, /recebendo outra mensagem/);
  w.timers.shift()(); // Enter do primeiro
  w.timers.shift()(); assert.equal(w.written.filter((x) => x[1] !== '\r').length, 2); assert.equal(w.written.at(-1)[1], lineFor(b.briefing.id));
});

test('desistência e falhas: Maestro encerrado antes da entrega, escrita recusada e tempo esgotado viram failed com nota', () => {
  const w = world(); w.panes.get(MA).agent = { state: 'waiting', at: new Date().toISOString() };
  const r = w.m.submitBriefing({ workspaceId: 'ws1', text: 'x' }); w.panes.get(MA).status = 'exited'; w.timers.shift()();
  assert.equal(w.m.snapshot().briefings[0].status, 'failed'); assert.match(w.m.snapshot().briefings[0].note, /encerrado antes de receber/); assert.equal(w.timers.length, 0); void r;
  const w2 = world(); w2.api.write = () => ({ ok: false, status: 409, error: 'O terminal não aceitou a entrada.' });
  assert.equal(w2.m.submitBriefing({ workspaceId: 'ws1', text: 'x' }).briefing.status, 'failed'); assert.match(w2.m.snapshot().briefings[0].note, /não aceitou a entrada/);
  const w3 = world(); w3.panes.get(MA).agent = { state: 'waiting', at: new Date().toISOString() };
  w3.m.submitBriefing({ workspaceId: 'ws1', text: 'x' });
  let n = 0; while (w3.timers.length && n < M.REPORT_RETRIES + 50) { w3.timers.shift()(); n++; }
  assert.equal(n, M.REPORT_RETRIES, 'tenta pelo mesmo prazo do relatório e para'); assert.equal(w3.written.length, 0);
  assert.equal(w3.m.snapshot().briefings[0].status, 'failed'); assert.match(w3.m.snapshot().briefings[0].note, /não foi digitado no Maestro \(ele estava aguardando uma permissão\)/);
});

test('get_briefing: só o maestro vê e chama; só o briefing endereçado ao pane chamador; devolve o texto completo e marca como lido (para a fila)', () => {
  const w = world(); const text = `Linha 1\n${'detalhe '.repeat(200)}fim`;
  const { briefing } = w.m.submitBriefing({ workspaceId: 'ws1', text });
  const tools = (role) => w.m.rpc({ terminalId: B1, role }, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map((t) => t.name);
  assert.ok(tools('maestro').includes('get_briefing')); for (const role of ['builder', 'reviewer', 'scout']) assert.ok(!tools(role).includes('get_briefing'), role);
  const schema = w.m.rpc({ terminalId: MA, role: 'maestro' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.find((t) => t.name === 'get_briefing').inputSchema;
  assert.deepEqual(schema.required, ['briefing_id']); assert.equal(schema.additionalProperties, false);
  assert.equal(w.call({ terminalId: B1, role: 'builder' }, 'get_briefing', { briefing_id: briefing.id }).isError, true, 'construtor não lê');
  for (const args of [{ briefing_id: briefing.id }, { briefing_id: 'brf_zzzzzzzz' }, { briefing_id: 7 }, {}]) {
    const r = w.call({ terminalId: MX, role: 'maestro' }, 'get_briefing', args); assert.equal(r.isError, true); assert.equal(r.content[0].text, 'Briefing não encontrado.');
  }
  const ok = w.call({ terminalId: MA, role: 'maestro' }, 'get_briefing', { briefing_id: briefing.id });
  assert.equal(ok.isError, undefined); assert.ok(ok.content[0].text.endsWith(`\n${text}`), 'texto completo'); assert.match(ok.content[0].text, /^\[Briefing brf_[0-9a-f]{8} do usuário: este é o pedido do usuário/);
  assert.equal(w.m.snapshot().briefings[0].status, 'read');
  const w2 = world(); w2.panes.get(MA).agent = null; const q = w2.m.submitBriefing({ workspaceId: 'ws1', text: 'x' }).briefing;
  assert.equal(w2.call({ terminalId: MA, role: 'maestro' }, 'get_briefing', { briefing_id: q.id }).isError, undefined);
  w2.panes.get(MA).agent = { ...IDLE }; w2.timers.shift()(); assert.equal(w2.written.length, 0, 'lido antes da entrega: nada mais é digitado'); assert.equal(w2.m.snapshot().briefings[0].status, 'read');
});

test('memória limitada: no máximo 50 briefings (os mais antigos saem); o snapshot lista do mais novo ao mais antigo, com prévia de 120 caracteres', () => {
  const w = world(); const ids = [];
  for (let i = 0; i < M.MAX_BRIEFINGS + 5; i++) { ids.push(w.m.submitBriefing({ workspaceId: 'ws1', text: `${i} ${'p'.repeat(300)}` }).briefing.id); while (w.timers.length) w.timers.shift()(); }
  const snap = w.m.snapshot().briefings; assert.equal(snap.length, M.MAX_BRIEFINGS);
  assert.equal(snap[0].id, ids.at(-1)); assert.equal(snap.at(-1).id, ids[5]); assert.ok(snap.every((b) => b.preview.length === M.BRIEFING_PREVIEW));
  assert.equal(w.call({ terminalId: MA, role: 'maestro' }, 'get_briefing', { briefing_id: ids[0] }).isError, true, 'o descartado não é mais lido');
});

test('prompt do Maestro: explica a linha [Briefing brf_...], get_briefing, a skill orquestrar-briefing e as duas formas de entrega do send_task, sem caracteres especiais', () => {
  const p = ROLES.maestro.prompt;
  assert.match(p, /\[Briefing brf_/); assert.match(p, /get_briefing/); assert.match(p, /orquestrar-briefing/); assert.match(p, /modo autonomo/); assert.match(p, /pendente ate o usuario aprovar/);
  assert.doesNotMatch(p, /[&|<>^%"`]/);
});

// ---- HTTP real ----
test('HTTP: POST /api/maestro/briefing exige Origin; 201 sem o texto; 400 estrito; 409 com código e panes; GET /api/maestro traz briefings', async () => {
  const w = world(); const app = express(); app.use('/api', apiGuard); app.use(express.json({ limit: '100kb' })); M.setupMaestro(app, { maestro: w.m });
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (body, headers = { origin: base }) => { const r = await fetch(`${base}/api/maestro/briefing`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  try {
    assert.equal((await post({ workspaceId: 'ws1', text: 'x' }, {})).status, 403, 'sem Origin');
    assert.equal((await post({ workspaceId: 'ws1', text: 'x' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal(w.m.snapshot().briefings.length, 0, 'nada criado sem a checagem de origem');
    const ok = await post({ workspaceId: 'ws1', text: 'Página de login com testes.' });
    assert.equal(ok.status, 201); assert.deepEqual(Object.keys(ok.j.briefing).sort(), ['createdAt', 'id', 'paneId', 'status']); assert.equal(ok.j.briefing.status, 'delivered');
    const bad = await post({ workspaceId: 'ws1', text: 'x', role: 'maestro' }); assert.equal(bad.status, 400); assert.match(bad.j.error, /não permitidas/);
    const none = await post({ workspaceId: 'ws9', text: 'x' }); assert.equal(none.status, 409); assert.equal(none.j.code, 'no_maestro'); assert.equal(none.j.panes, undefined);
    w.panes.set(MB, { id: MB, role: 'maestro', title: 'Maestro 2', status: 'running', provider: 'claude', workspaceId: 'ws1', agent: { ...IDLE }, lastOutputAt: OLD });
    const many = await post({ workspaceId: 'ws1', text: 'x' }); assert.equal(many.status, 409); assert.equal(many.j.code, 'many_maestros'); assert.equal(many.j.panes.length, 2);
    const chosen = await post({ workspaceId: 'ws1', paneId: MB, text: 'x' }); assert.equal(chosen.status, 201); assert.equal(chosen.j.briefing.paneId, MB);
    const snap = await (await fetch(`${base}/api/maestro`)).json(); assert.equal(snap.briefings.length, 2); assert.equal(snap.briefings[1].preview, 'Página de login com testes.');
    assert.ok(Array.isArray(snap.tasks) && typeof snap.autonomous === 'boolean', 'o snapshot antigo continua igual');
  } finally { srv.close(); srv.closeAllConnections?.(); }
});

test('limite de briefings em memória: saem primeiro os já resolvidos (lido ou falho), nunca um entregue e ainda não lido', () => {
  const w = world();
  const a = w.m.submitBriefing({ workspaceId: 'ws1', text: 'primeiro: entregue e ainda não lido' }).briefing; // o Maestro está livre: entregue na hora
  const b = w.m.submitBriefing({ workspaceId: 'ws1', text: 'segundo: lido' }).briefing;
  assert.equal(w.call({ terminalId: MA, role: 'maestro' }, 'get_briefing', { briefing_id: b.id }).isError, undefined);
  for (let i = 0; i < M.MAX_BRIEFINGS - 1; i++) w.m.submitBriefing({ workspaceId: 'ws1', text: `mais ${i}` });
  const ids = w.m.snapshot().briefings.map((x) => x.id);
  assert.equal(ids.length, M.MAX_BRIEFINGS);
  assert.ok(ids.includes(a.id), 'o entregue e não lido continua disponível para o get_briefing');
  assert.ok(!ids.includes(b.id), 'o já lido saiu no lugar dele');
});

test('get_briefing: a releitura avisa que o pedido já foi lido (um relatório de agente pode citar o id para o Maestro repetir um pedido antigo)', () => {
  const w = world(), me = { terminalId: MA, role: 'maestro' };
  const { id } = w.m.submitBriefing({ workspaceId: 'ws1', text: 'Crie a página de login.' }).briefing;
  const first = w.call(me, 'get_briefing', { briefing_id: id }).content[0].text;
  assert.ok(!/já foi lido/.test(first)); assert.match(first, /Crie a página de login\./);
  const readAt = w.m.snapshot().briefings.find((x) => x.id === id).status;
  assert.equal(readAt, 'read');
  const again = w.call(me, 'get_briefing', { briefing_id: id }).content[0].text;
  assert.match(again, /já foi lido em .+; não execute de novo sem um pedido novo do usuário/); assert.match(again, /Crie a página de login\./, 'o texto continua disponível');
});

test('list_panes informa as skills de cada pane (nos times com dois construtores iguais, é o que diz quem é de frontend e quem é de backend)', () => {
  const w = world();
  w.panes.get(B1).skills = ['frontend-design', 'qualidade-e-testes'];
  const list = JSON.parse(w.call({ terminalId: MA, role: 'maestro' }, 'list_panes').content[0].text);
  assert.deepEqual(list.find((p) => p.pane_id === B1).skills, ['frontend-design', 'qualidade-e-testes']);
  assert.deepEqual(list.find((p) => p.pane_id === MA).skills, [], 'pane sem a lista (ou Codex) = lista vazia');
});
