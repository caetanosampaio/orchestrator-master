// Ponta a ponta SEM CLIs reais: PTY real (node-pty) com um "agente" falso (script Node) no lugar do claude e do codex, Maestro real servido por HTTP.
// Prova o caminho que o Codex real usará: o token chega SÓ pelo ambiente do processo, esse token autentica no /mcp, um Codex como MAESTRO enxerga os dois provedores
// em list_panes e entrega tarefas a um Claude (texto + Enter) e a outro Codex (colagem entre colchetes + Enter), sem nenhum arquivo de credencial em disco.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import express from 'express';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-e2e-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const T = await import('../terminals.js');
const M = await import('../maestro.js');

// O "agente": mostra os argumentos e se recebeu o token no ambiente, depois ecoa em JSON cada pedaço de entrada recebido (modo cru: preserva ESC e CR).
const AGENT = path.join(tmp, 'fake-agent.mjs');
fs.writeFileSync(AGENT, `
const t = process.env.FORGE_MCP_TOKEN || '';
process.stdout.write('ARGS=' + JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('TOKEN=' + t + '\\n');
process.stdout.write('READY\\n');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (d) => process.stdout.write('STDIN=' + JSON.stringify(d.toString()) + '\\n'));
setInterval(() => {}, 1000);
`);

const ws = path.join(tmp, 'ws'); fs.mkdirSync(ws, { recursive: true });
const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
let mgr = null;
const app = express(); app.use(express.json({ limit: '100kb' }));
const srv = await new Promise((res) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => res(s)); });
const port = srv.address().port, URL_ = `http://127.0.0.1:${port}/mcp`;
const mcpDir = path.join(tmp, 'mcp');
const maestro = M.createMaestro({ getTerminals: () => mgr, mcpDir, url: URL_, serverName: 'forge_e2e123' });
M.setupMaestro(app, { maestro });
mgr = T.createTerminalManager({ db, mcp: maestro, inspectConfig: async () => [], persist: () => {}, sweepMs: 0, usage: null,
  resolveCommand: () => ({ file: process.execPath, args: [AGENT, 'claude'], viaShell: false }), resolveCommands: { codex: () => ({ file: process.execPath, args: [AGENT, 'codex'], viaShell: false }) } });
after(async () => { try { mgr.killAllSync(); } catch { /* já encerrado */ } await new Promise((r) => srv.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); });

const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) assert.fail(`tempo esgotado esperando: ${what}\n${JSON.stringify(mgr.list().map((s) => [s.id, mgr.readOutput(s.id, 800)]))}`); await new Promise((r) => setTimeout(r, 40)); } };
const mcpCall = (token, name, args = {}) => new Promise((resolve, reject) => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const rq = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'content-length': Buffer.byteLength(body) } }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null })); });
  rq.on('error', reject); rq.end(body);
});
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

test('Codex como maestro (token só no ambiente) coordena um Claude e outro Codex: list_panes mostra os provedores e as tarefas chegam do jeito de cada CLI', { timeout: 60000 }, async () => {
  const m = await mgr.create({ role: 'maestro', provider: 'codex', cols: 200, rows: 30 });
  const cl = await mgr.create({ role: 'builder', provider: 'claude', cols: 200, rows: 30 });
  const cx = await mgr.create({ role: 'builder', provider: 'codex', cols: 200, rows: 30 });
  for (const r of [m, cl, cx]) assert.equal(r.status, 201, r.error);
  for (const r of [m, cl, cx]) await until(() => mgr.readOutput(r.session.id, 4000).includes('READY'), `${r.session.id} pronto`);

  // 1) o Codex recebe o token no ambiente e NENHUM arquivo de credencial é gravado; o Claude recebe o arquivo, sem token no ambiente
  const out = (id) => strip(mgr.readOutput(id, 8000));
  const token = /TOKEN=([0-9a-f]{48})/.exec(out(m.session.id))?.[1]; assert.ok(token, 'o token chegou ao ambiente do Codex');
  assert.match(out(cl.session.id), /TOKEN=\r?\n/, 'o Claude não recebe o token no ambiente');
  const files = fs.existsSync(mcpDir) ? fs.readdirSync(mcpDir) : [];
  assert.deepEqual(files, [`${cl.session.id}.json`], 'só o pane do Claude tem arquivo de credencial');
  const codexArgs = JSON.parse(/ARGS=(\[.*\])/.exec(out(m.session.id))[1]);
  assert.ok(codexArgs.includes('--no-alt-screen') && codexArgs.includes(`mcp_servers.forge_e2e123.url="${URL_}"`), codexArgs.join(' ')); assert.ok(!codexArgs.some((a) => a.includes(token)), 'token fora da linha de comando');

  // 2) o token do ambiente autentica no /mcp e o papel é o do pane (maestro); um token errado não
  assert.equal((await mcpCall('0'.repeat(48), 'list_panes')).status, 401);
  const lp = await mcpCall(token, 'list_panes'); assert.equal(lp.status, 200);
  const panes = JSON.parse(lp.json.result.content[0].text);
  assert.deepEqual(panes.map((p) => [p.role, p.provider]).sort(), [['builder', 'claude'], ['builder', 'codex']]); // o maestro não vê o próprio pane

  // 3) o Codex-maestro entrega tarefas (modo autônomo = sem esperar o clique do usuário): o Claude recebe texto puro + Enter; o Codex, a colagem entre colchetes + Enter
  maestro.setAutonomous(true);
  assert.match((await mcpCall(token, 'send_task', { pane_id: cl.session.id, task: 'rode os testes do servidor' })).json.result.content[0].text, /entregue/);
  const gotCl = await until(() => out(cl.session.id).match(/STDIN="(\[Tarefa task_[0-9a-f]{8} do maestro\][^"]*)"/), 'tarefa no Claude');
  assert.ok(!gotCl[1].includes('\\u001b'), 'Claude: sem marcadores de colagem'); assert.match(gotCl[1], /rode os testes do servidor/);
  await until(() => /STDIN="\\r"/.test(out(cl.session.id)), 'Enter no Claude');
  await new Promise((r) => setTimeout(r, 450)); // intervalo do Maestro entre uma entrega e a seguinte no mesmo pane não se aplica: são panes diferentes
  assert.match((await mcpCall(token, 'send_task', { pane_id: cx.session.id, task: 'revise a branch do construtor' })).json.result.content[0].text, /entregue/);
  const gotCx = await until(() => out(cx.session.id).match(/STDIN="(\\u001b\[200~\[Tarefa task_[0-9a-f]{8} do maestro\][^"]*\\u001b\[201~)"/), 'colagem no Codex');
  assert.match(gotCx[1], /revise a branch do construtor/);
  await until(() => /STDIN="\\r"/.test(out(cx.session.id)), 'Enter no Codex');

  // 4) o Codex construtor responde com o token DELE (que não é maestro): report_done funciona para a tarefa que recebeu; ele não consegue enviar tarefas
  const tok2 = /TOKEN=([0-9a-f]{48})/.exec(out(cx.session.id))?.[1]; assert.ok(tok2 && tok2 !== token, 'cada pane tem o seu token');
  assert.match((await mcpCall(tok2, 'send_task', { pane_id: cl.session.id, task: 'x' })).json.result.content[0].text, /Só o maestro envia tarefas/);
  const taskId = maestro.snapshot().tasks.find((t) => t.to === cx.session.id).id;
  assert.match((await mcpCall(tok2, 'report_done', { task_id: taskId, summary: 'revisado na branch orch/wt_1' })).json.result.content[0].text, /^Concluída/);
  assert.equal(maestro.snapshot().tasks.find((t) => t.id === taskId).status, 'done');

  // 5) encerrar o pane revoga o token do ambiente
  mgr.close(cx.session.id); assert.equal((await mcpCall(tok2, 'list_panes')).status, 401, 'token revogado ao encerrar');
});
