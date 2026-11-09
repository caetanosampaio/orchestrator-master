// Integração com o Codex CLI: o adaptador (providers/codex.js), o gerenciador de terminais com provedor POR PANE, a credencial do Maestro só no ambiente (sem arquivo),
// a entrega de tarefas por colagem entre colchetes e o list_panes com provedor/branch. PTY SIMULADO (nenhum Codex nem Claude real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-codex-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const P = await import('../providers/index.js');
const { codexProvider, resolveCodex, MCP_TOKEN_ENV } = await import('../providers/codex.js');
const T = await import('../terminals.js');
const M = await import('../maestro.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NAME = 'forge_ab12cd', URL_ = 'http://127.0.0.1:4999/mcp';

test('codex.resolve: acha o `codex` no PATH; wrapper .cmd (npm no Windows) passa pelo cmd.exe; ausente = null', () => {
  const dir = path.join(tmp, 'bin'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n'); fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\n');
  assert.deepEqual(resolveCodex({ env: { PATH: [path.join(tmp, 'vazio'), dir].join(path.delimiter) }, platform: 'linux' }), { file: path.join(dir, 'codex'), args: [], viaShell: false });
  const w = resolveCodex({ env: { PATH: dir, ComSpec: 'cmd.exe' }, platform: 'win32' });
  assert.equal(w.viaShell, true); assert.equal(w.file, 'cmd.exe'); assert.deepEqual(w.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(resolveCodex({ env: { PATH: path.join(tmp, 'vazio') }, platform: 'linux' }), null);
  assert.equal(P.getProvider('codex'), codexProvider); assert.ok(Object.isFrozen(codexProvider));
});

test('codex.paneArgs: sandbox e aprovação fixos, prompt em developer_instructions, MCP por -c com o token SÓ no ambiente (nunca na linha de comando)', () => {
  const a = codexProvider.paneArgs({ mode: 'new', prompt: 'Voce e o CONSTRUTOR. Faca (rapido): ok.', mcp: { url: URL_, serverName: NAME } });
  assert.deepEqual(a.slice(0, 5), ['--no-alt-screen', '-s', 'workspace-write', '-a', 'on-request']);
  const cs = a.filter((x, i) => a[i - 1] === '-c');
  assert.deepEqual(cs, [
    'developer_instructions="Voce e o CONSTRUTOR. Faca (rapido): ok."',
    `mcp_servers.${NAME}.url="${URL_}"`, `mcp_servers.${NAME}.bearer_token_env_var="${MCP_TOKEN_ENV}"`,
    `mcp_servers.${NAME}.default_tools_approval_mode="approve"`, `mcp_servers.${NAME}.startup_timeout_sec=20`,
  ]);
  assert.ok(!a.some((x) => /--session-id|--mcp-config|--plugin-dir|--allowedTools|--append-system-prompt/.test(x)), 'nenhuma flag do Claude');
  // aspas dentro do prompt são escapadas como string TOML; wrapper .cmd (quote:false) vai sem aspas
  assert.equal(codexProvider.paneArgs({ prompt: 'diga "oi"' })[6], 'developer_instructions="diga \\"oi\\""');
  const raw = codexProvider.paneArgs({ prompt: 'Voce e o BATEDOR', mcp: { url: URL_, serverName: NAME }, quote: false }).filter((x, i, l) => l[i - 1] === '-c');
  assert.deepEqual(raw.slice(0, 3), ['developer_instructions=Voce e o BATEDOR', `mcp_servers.${NAME}.url=${URL_}`, `mcp_servers.${NAME}.bearer_token_env_var=${MCP_TOKEN_ENV}`]);
  // sem MCP, ou com nome de servidor que não é chave simples: nenhum argumento de MCP
  assert.ok(!codexProvider.paneArgs({ prompt: 'x' }).some((x) => /mcp_servers/.test(x)));
  assert.ok(!codexProvider.paneArgs({ prompt: 'x', mcp: { url: URL_, serverName: 'a.b"c' } }).some((x) => /mcp_servers/.test(x)));
  assert.throws(() => codexProvider.paneArgs({ mode: 'resume' }), /não oferece retomada/); assert.throws(() => codexProvider.paneArgs({ mode: 'fork' }), /não oferece retomada/);
});

test('codex.envFor: herda o ambiente, mas sem variáveis do Claude Code/Anthropic; capacidades e configuração de projeto declaradas', () => {
  const e = codexProvider.envFor({ PATH: '/bin', HOME: '/h', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'o' });
  assert.deepEqual(e, { PATH: '/bin', HOME: '/h', OPENAI_API_KEY: 'o' });
  assert.deepEqual({ ...codexProvider.capabilities }, { resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false });
  assert.deepEqual([...codexProvider.projectConfig.dirs], ['.codex']);
});

function world(over = {}) {
  const spawned = [], issued = [], revoked = [], inspected = [], usageCalls = []; let pid = 1_910_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mcp = { serverName: NAME, issue: (a) => { issued.push(a); return a.file === false ? { token: 'f'.repeat(48), url: URL_ } : { configPath: `/tmp/${a.terminalId}.json` }; }, revoke: (id) => revoked.push(id) };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp, track: () => ({ release() {} }),
    inspectConfig: async (dir, spec) => { inspected.push(spec); return []; }, sweepMs: 0, usage: { read: (...a) => { usageCalls.push(a); return { total: 5 }; }, has: () => true, forget() {} }, persist: () => {}, ...over });
  return { spawned, db, mgr, issued, revoked, inspected, usageCalls };
}

test('terminais: create({provider:"codex"}) abre o Codex com os argumentos dele, token só no ambiente, sem arquivo MCP, registro com provider e conta Sistema', async () => {
  const w = world();
  const r = await w.mgr.create({ role: 'builder', provider: 'codex', accountId: 'qualquer-coisa' });
  assert.equal(r.ok, true, r.error); assert.equal(r.status, 201);
  assert.equal(r.session.provider, 'codex'); assert.equal(r.session.providerLabel, 'Codex CLI'); assert.equal(r.session.accountId, 'system', 'contas do FORGE não se aplicam ao Codex');
  const p = w.spawned[0];
  assert.equal(p.file, '/fake/codex');
  assert.ok(p.args.includes('--no-alt-screen') && p.args.includes(`mcp_servers.${NAME}.url="${URL_}"`), p.args.join(' '));
  assert.ok(!p.args.some((x) => x.includes('f'.repeat(48))), 'o token nunca vai para a linha de comando');
  assert.equal(p.opts.env[MCP_TOKEN_ENV], 'f'.repeat(48)); assert.equal(p.opts.env.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(w.issued[0].file, false, 'Codex pede credencial sem arquivo');
  assert.equal(w.db.terminalSessions[0].provider, 'codex'); assert.equal(w.db.terminalSessions[0].usesMcp, true);
  assert.deepEqual([...w.inspected[0].dirs], ['.codex'], 'a inspeção de configuração usa a do Codex');
  assert.equal(w.mgr.list()[0].agent, null, 'sem hooks no Codex: o estado vem da leitura pela saída'); assert.equal(w.mgr.list()[0].usage, null); assert.equal(w.usageCalls.length, 0, 'não lê transcript do Claude');
  w.spawned[0].exit(0); assert.deepEqual(w.revoked, [r.session.id], 'fim do processo revoga a credencial');
});

test('terminais: sem provider continua sendo o Claude (arquivo MCP, --session-id); provedor inválido é 400; Codex ausente do PATH dá mensagem própria', async () => {
  const w = world();
  const c = await w.mgr.create({ role: 'builder' });
  assert.equal(c.session.provider, 'claude'); assert.ok(w.spawned[0].args.includes('--mcp-config') && w.spawned[0].args.includes('--session-id')); assert.equal(w.issued[0].file, true);
  assert.equal(w.spawned[0].opts.env[MCP_TOKEN_ENV], undefined, 'o Claude não recebe o token no ambiente');
  for (const bad of ['gemini', '', '__proto__', 7, false]) { const r = await w.mgr.create({ provider: bad }); assert.equal(r.status, 400, String(bad)); assert.equal(r.code, 'provider_invalid'); }
  const none = world({ resolveCommands: { codex: () => null } });
  const r = await none.mgr.create({ provider: 'codex' }); assert.equal(r.status, 409); assert.match(r.error, /Codex CLI não foi encontrado/); assert.equal(none.spawned.length, 0);
});

test('terminais: a configuração de projeto do Codex (.codex) não revisada exige confirmação, com o nome do provedor na mensagem', async () => {
  const w = world({ inspectConfig: async () => [{ path: '.codex', why: 'tem arquivos não versionados' }] });
  const r = await w.mgr.create({ provider: 'codex' });
  assert.equal(r.status, 409); assert.equal(r.code, 'project_config_unreviewed'); assert.match(r.error, /configuração do Codex CLI/); assert.equal(w.spawned.length, 0);
  const ok = await w.mgr.create({ provider: 'codex', acknowledgeProjectConfig: true }); assert.equal(ok.status, 201);
});

test('terminais: sessão do Codex não é retomável (histórico informa e a retomada recusa com 409); a do Claude segue retomável', async () => {
  const w = world();
  const r = await w.mgr.create({ provider: 'codex' }); w.spawned[0].exit(0);
  const h = w.mgr.history()[0];
  assert.equal(h.provider, 'codex'); assert.equal(h.resumable, false); assert.equal(h.blockedReason, 'provider_no_resume');
  const again = await w.mgr.resume({ recordId: h.id }); assert.equal(again.status, 409); assert.equal(again.code, 'provider_no_resume'); assert.equal(w.spawned.length, 1);
  assert.equal((await w.mgr.resume({ recordId: h.id, fork: true })).status, 409);
  const c = await w.mgr.create({ provider: 'claude' }); w.spawned[1].exit(0);
  assert.equal(w.mgr.history().find((x) => x.provider === 'claude').resumable, true, JSON.stringify(w.mgr.history()[0]));
  assert.ok(r.session.id);
});

test('terminais: providers() lista os dois com disponibilidade e capacidade de retomada; a API traz o mesmo', async () => {
  const w = world({ resolveCommands: { codex: () => null } });
  assert.deepEqual(w.mgr.providers(), [
    { id: 'claude', label: 'Claude Code', available: true, capabilities: { resume: true } },
    { id: 'codex', label: 'Codex CLI', available: false, capabilities: { resume: false } },
  ]);
});

// ---------- Maestro: credencial sem arquivo, colagem entre colchetes, list_panes ----------
const MA = 'term_aaaaaaaa', CX = 'term_bbbbbbbb', CL = 'term_cccccccc';
function mworld() {
  const panes = new Map([[MA, { id: MA, role: 'maestro', provider: 'claude', title: 'M', status: 'running', usage: { total: 1 } }],
    [CX, { id: CX, role: 'builder', provider: 'codex', title: 'CX', status: 'running', usage: null, worktreeId: 'wt_1', cwd: '/w/wt1', branch: 'orch/wt_1' }],
    [CL, { id: CL, role: 'builder', provider: 'claude', title: 'CL', status: 'running', usage: null, worktreeId: null, cwd: '/w' }]]);
  const written = [], timers = []; let n = 0;
  const api = { get: (id) => panes.get(id) ?? null, peek: (id) => panes.get(id) ?? null, list: () => [...panes.values()], write: (id, d) => { written.push([id, d]); return { ok: true, status: 200 }; }, readOutput: () => '' };
  const dir = path.join(tmp, `mcp-${Math.random().toString(16).slice(2)}`);
  const m = M.createMaestro({ getTerminals: () => api, mcpDir: dir, url: URL_, serverName: NAME, uid: (p) => `${p}_${String(++n).padStart(8, '0')}`, setTimer: (fn) => { timers.push(fn); return { unref() {} }; } });
  const call = (caller, name, args = {}) => m.rpc(caller, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  return { m, written, timers, dir, call, ma: { terminalId: MA, role: 'maestro' } };
}

test('maestro.issue({file:false}): devolve token e url, NÃO grava arquivo, autentica o token e a revogação o invalida; o modo com arquivo segue igual', () => {
  const w = mworld();
  const cred = w.m.issue({ terminalId: CX, role: 'builder', file: false });
  assert.match(cred.token, /^[0-9a-f]{48}$/); assert.equal(cred.url, URL_); assert.equal(cred.configPath, undefined);
  assert.equal(fs.existsSync(w.dir) ? fs.readdirSync(w.dir).length : 0, 0, 'nenhum arquivo em disco');
  assert.deepEqual(w.m.authenticate(`Bearer ${cred.token}`), { terminalId: CX, role: 'builder' });
  w.m.revoke(CX); assert.equal(w.m.authenticate(`Bearer ${cred.token}`), null);
  const f = w.m.issue({ terminalId: CL, role: 'builder' }); assert.ok(fs.existsSync(f.configPath)); w.m.revoke(CL); assert.ok(!fs.existsSync(f.configPath));
  assert.equal(w.m.issue({ terminalId: 'invalido', role: 'builder', file: false }), null);
});

test('maestro.deliver: pane do Codex recebe a tarefa entre marcadores de colagem + Enter depois; o do Claude continua com texto puro + Enter', () => {
  const w = mworld(); w.m.setAutonomous(true);
  assert.match(w.call(w.ma, 'send_task', { pane_id: CX, task: 'faça \u001b[31misso' }).content[0].text, /entregue/);
  assert.equal(w.written.length, 1); const [id, d] = w.written[0];
  assert.equal(id, CX); assert.ok(d.startsWith('\x1b[200~[Tarefa task_') && d.endsWith('\x1b[201~'), JSON.stringify(d));
  assert.equal((d.match(/\x1b/g) ?? []).length, 2, 'só os dois marcadores têm ESC; o texto do agente foi limpo');
  w.timers.shift()(); assert.deepEqual(w.written[1], [CX, '\r']);
  w.call(w.ma, 'send_task', { pane_id: CL, task: 'outra' });
  assert.ok(!w.written[2][1].includes('\x1b'), 'Claude: texto puro'); w.timers.shift()(); assert.deepEqual(w.written[3], [CL, '\r']);
});

test('maestro.list_panes: informa provedor, branch e caminho do worktree para o maestro saber onde cada agente trabalha', () => {
  const w = mworld();
  const list = JSON.parse(w.call(w.ma, 'list_panes').content[0].text);
  const by = Object.fromEntries(list.map((x) => [x.pane_id, x]));
  assert.equal(by[CX].provider, 'codex'); assert.equal(by[CX].branch, 'orch/wt_1'); assert.equal(by[CX].worktree, '/w/wt1');
  assert.equal(by[CL].provider, 'claude'); assert.equal(by[CL].branch, null); assert.equal(by[CL].worktree, null);
});

test('nome do servidor MCP: tanto forge_<hex> quanto o legado orchestrator_<hex> viram chave válida de mcp_servers no Codex', () => {
  for (const name of [M.stableServerName({}, { gen: () => 'ab12cd' }), 'orchestrator_0a1b2c']) {
    const a = codexProvider.paneArgs({ prompt: 'x', mcp: { url: URL_, serverName: name } });
    assert.ok(a.includes(`mcp_servers.${name}.url="${URL_}"`), name);
  }
});

test('Claude abre com CLAUDE_CODE_NO_FLICKER=1 (renderer em tela cheia, vence o auto-desligamento por lançamento interrompido); o valor do ambiente do usuário é respeitado; o Codex não recebe', async () => {
  const keep = process.env.CLAUDE_CODE_NO_FLICKER;
  try {
    delete process.env.CLAUDE_CODE_NO_FLICKER;
    const w = world();
    await w.mgr.create({ role: 'builder' }); await w.mgr.create({ role: 'builder', provider: 'codex' });
    assert.equal(w.spawned[0].opts.env.CLAUDE_CODE_NO_FLICKER, '1'); assert.equal(w.spawned[1].opts.env.CLAUDE_CODE_NO_FLICKER, undefined);
    process.env.CLAUDE_CODE_NO_FLICKER = '0';
    const w2 = world(); await w2.mgr.create({ role: 'builder' });
    assert.equal(w2.spawned[0].opts.env.CLAUDE_CODE_NO_FLICKER, '0', 'quem exporta outro valor manda');
  } finally { if (keep === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER; else process.env.CLAUDE_CODE_NO_FLICKER = keep; }
});

test('estado do Codex: lido da sequência OSC 7501 do terminal (idle/working/blocked/done), inclusive cortada entre dois pedaços', async () => {
  let feed = null;
  const lib = { spawn() { const p = { pid: 1_920_000_001, onData(cb) { feed = cb; }, onExit() {}, write() {}, resize() {} }; return p; } };
  const w = world({ ptyLib: lib });
  const r = await w.mgr.create({ role: 'builder', provider: 'codex' });
  assert.equal(r.ok, true, r.error);
  const state = () => w.mgr.get(r.session.id).agent?.state ?? null;
  assert.equal(state(), null, 'sem sinal ainda: cai na leitura pela saída');
  feed('\x1b]7501;state=working:app=codex\x1b\\'); assert.equal(state(), 'running');
  feed('texto\x1b]7501;state=blocked:app=codex:kind=permission\x07'); assert.equal(state(), 'waiting');
  feed('\x1b]7501;state=do'); assert.equal(state(), 'waiting', 'sequência incompleta não muda nada');
  feed('ne:app=codex\x1b\\'); assert.equal(state(), 'completed');
  feed('\x1b]7501;state=inventado:app=codex\x07'); feed('\x1b]7501;state=working:app=outro\x07'); assert.equal(state(), 'completed', 'estado desconhecido ou de outro app é ignorado');
  feed('\x1b]7501;state=working:app=codex\x07'); feed('\x1b]7501;state=error:app=codex\x07');
  assert.equal(state(), 'error', 'falha do turno (HTTP 4xx/5xx, resposta failed): o painel não fica em "executando"');
  feed('\x1b]7501;state=working:app=codex\x07');
  assert.equal(state(), 'running', 'um novo pedido depois do erro volta a executar');
});
