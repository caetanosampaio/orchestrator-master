// Integração com o Codex CLI: o adaptador (providers/codex.js), o gerenciador de terminais com provedor POR PANE, a credencial do Maestro só no ambiente (sem arquivo),
// a entrega de tarefas por colagem entre colchetes e o list_panes com provedor/branch. PTY SIMULADO (nenhum Codex nem Claude real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-codex-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.CODEX_HOME = path.join(tmp, 'codex-home'); // terminais do Codex simulados: nunca o ~/.codex real (o models_cache.json lido ao abrir o pane)
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
  assert.deepEqual(a.slice(0, 6), ['--no-alt-screen', '--no-daemon', '-s', 'workspace-write', '-a', 'on-request']);
  const cs = a.filter((x, i) => a[i - 1] === '-c');
  assert.deepEqual(cs, [
    'developer_instructions="Voce e o CONSTRUTOR. Faca (rapido): ok."',
    `mcp_servers.${NAME}.url="${URL_}"`, `mcp_servers.${NAME}.bearer_token_env_var="${MCP_TOKEN_ENV}"`,
    `mcp_servers.${NAME}.default_tools_approval_mode="approve"`, `mcp_servers.${NAME}.startup_timeout_sec=20`,
    'check_for_update_on_startup=false', 'notice.hide_rate_limit_model_nudge=true', // sem perguntas ao abrir (sem env: sem o mapa de migrações)
  ]);
  assert.ok(!a.some((x) => /--session-id|--mcp-config|--plugin-dir|--allowedTools|--append-system-prompt/.test(x)), 'nenhuma flag do Claude');
  // aspas dentro do prompt são escapadas como string TOML; wrapper .cmd (quote:false) vai sem aspas
  assert.equal(codexProvider.paneArgs({ prompt: 'diga "oi"' })[7], 'developer_instructions="diga \\"oi\\""');
  const raw = codexProvider.paneArgs({ prompt: 'Voce e o BATEDOR', mcp: { url: URL_, serverName: NAME }, quote: false }).filter((x, i, l) => l[i - 1] === '-c');
  assert.deepEqual(raw.slice(0, 3), ['developer_instructions=Voce e o BATEDOR', `mcp_servers.${NAME}.url=${URL_}`, `mcp_servers.${NAME}.bearer_token_env_var=${MCP_TOKEN_ENV}`]);
  // sem MCP, ou com nome de servidor que não é chave simples: nenhum argumento de MCP
  assert.ok(!codexProvider.paneArgs({ prompt: 'x' }).some((x) => /mcp_servers/.test(x)));
  assert.ok(!codexProvider.paneArgs({ prompt: 'x', mcp: { url: URL_, serverName: 'a.b"c' } }).some((x) => /mcp_servers/.test(x)));
  assert.throws(() => codexProvider.paneArgs({ mode: 'resume' }), /não oferece retomada/); assert.throws(() => codexProvider.paneArgs({ mode: 'fork' }), /não oferece retomada/);
});

test('codex.paneArgs readOnly (planejador): sandbox read-only com aprovação on-request, MCP igual; readOnly vence fullAccess; sem readOnly nada muda', () => {
  const mcp = { url: URL_, serverName: NAME };
  const ro = codexProvider.paneArgs({ prompt: 'PLANEJADOR', mcp, readOnly: true }), rw = codexProvider.paneArgs({ prompt: 'PLANEJADOR', mcp });
  assert.deepEqual(ro.slice(0, 6), ['--no-alt-screen', '--no-daemon', '-s', 'read-only', '-a', 'on-request']);
  assert.deepEqual(ro.slice(6), rw.slice(6), 'prompt e MCP (default_tools_approval_mode approve) iguais: as ferramentas do FORGE são chamadas pelo próprio Codex, fora do sandbox');
  const both = codexProvider.paneArgs({ prompt: 'x', fullAccess: true, readOnly: true });
  assert.deepEqual(both.slice(0, 6), ['--no-alt-screen', '--no-daemon', '-s', 'read-only', '-a', 'on-request']); assert.ok(!both.includes('--dangerously-bypass-approvals-and-sandbox'));
  for (const v of [false, undefined, 'true', 1]) {
    assert.deepEqual(codexProvider.paneArgs({ prompt: 'x', readOnly: v }).slice(0, 6), ['--no-alt-screen', '--no-daemon', '-s', 'workspace-write', '-a', 'on-request'], String(v));
    assert.deepEqual(codexProvider.paneArgs({ prompt: 'x', fullAccess: true, readOnly: v }).slice(0, 3), ['--no-alt-screen', '--no-daemon', '--dangerously-bypass-approvals-and-sandbox'], String(v));
  }
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

test('terminais: create({provider:"codex"}) abre o Codex com os argumentos dele, token só no ambiente, sem arquivo MCP, registro com provider; sem módulo de contas o accountId é ignorado', async () => {
  const w = world();
  const r = await w.mgr.create({ role: 'builder', provider: 'codex', accountId: 'qualquer-coisa' });
  assert.equal(r.ok, true, r.error); assert.equal(r.status, 201);
  assert.equal(r.session.provider, 'codex'); assert.equal(r.session.providerLabel, 'Codex CLI'); assert.equal(r.session.accountId, null, 'sem módulo de contas o accountId é ignorado (a conta do Codex é coberta em terminals-accounts-v2)');
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
  for (const bad of ['xpto', '', '__proto__', 7, false]) { const r = await w.mgr.create({ provider: bad }); assert.equal(r.status, 400, String(bad)); assert.equal(r.code, 'provider_invalid'); }
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

test('terminais: providers() lista Claude e Codex com disponibilidade e capacidades (os novos em new-providers.test.mjs); a API traz o mesmo', async () => {
  const w = world({ resolveCommands: { codex: () => null } });
  assert.deepEqual(w.mgr.providers().slice(0, 2), [
    { id: 'claude', label: 'Claude Code', available: true, capabilities: { resume: true, plugins: true, mcp: true, readOnly: true } },
    { id: 'codex', label: 'Codex CLI', available: false, capabilities: { resume: false, plugins: false, mcp: true, readOnly: true } },
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
  assert.ok(!w.written[2][1].includes('\x1b'), 'Claude: texto puro'); while (w.written.length < 4 && w.timers.length) w.timers.shift()(); assert.deepEqual(w.written[3], [CL, '\r']); // drena também o timer de confirmação do envio do Codex (não escreve nada: sem estado de agente)
});

test('maestro.list_panes: informa provedor, branch e caminho do worktree para o maestro saber onde cada agente trabalha', () => {
  const w = mworld();
  const list = JSON.parse(w.call(w.ma, 'list_panes').content[0].text);
  const by = Object.fromEntries(list.map((x) => [x.pane_id, x]));
  assert.equal(by[CX].provider, 'codex'); assert.equal(by[CX].branch, 'orch/wt_1'); assert.equal(by[CX].worktree, '/w/wt1');
  assert.equal(by[CL].provider, 'claude'); assert.equal(by[CL].branch, undefined); assert.equal(by[CL].worktree, undefined); assert.equal(by[MA], undefined, 'o maestro não vê o próprio pane'); assert.ok(list.every((x) => !('tokens' in x)));
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

// ---- Codex sem perguntas ao abrir (atualização, migração de modelo, troca perto do limite): terminais de time, missão e teste ninguém está olhando ----
const { codexModelMigrations, codexQuietArgs } = await import('../providers/codex.js');
const catalog = (dir, models) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'models_cache.json'), JSON.stringify({ fetched_at: 'x', etag: 'e', client_version: '0.172.0', models })); return dir; };

test('Codex sem perguntas: migrações lidas do models_cache.json da conta (o mesmo formato que a resposta manual grava); sem cache, só as chaves fixas', () => {
  const home = catalog(path.join(tmp, 'codex-home-1'), [
    { slug: 'gpt-5.6-sol', upgrade: { model: 'gpt-6.2-sol', migration_markdown: 'Meet…' } }, { slug: 'gpt-5.6-terra', upgrade: { model: 'gpt-6.1-terra' } },
    { slug: 'gpt-6.2-sol', upgrade: null }, { slug: 'x"; calc', upgrade: { model: 'y' } }, { slug: 'a b', upgrade: { model: 'c' } }, { slug: 'ok-1', upgrade: { model: "z'1" } },
    { slug: 'same', upgrade: { model: 'same' } }, { slug: 'gpt-5.6-sol', upgrade: { model: 'outro' } }, null, { upgrade: { model: 'sem-slug' } },
  ]);
  assert.deepEqual(codexModelMigrations(home), [['gpt-5.6-sol', 'gpt-6.2-sol'], ['gpt-5.6-terra', 'gpt-6.1-terra']], 'só pares válidos (sem aspas, espaço nem metacaractere), sem repetir o modelo de origem');
  assert.deepEqual(codexQuietArgs({ codexHome: home }), ['-c', 'check_for_update_on_startup=false', '-c', 'notice.hide_rate_limit_model_nudge=true', '-c', "notice.model_migrations={'gpt-5.6-sol'='gpt-6.2-sol','gpt-5.6-terra'='gpt-6.1-terra'}"]);
  assert.deepEqual(codexQuietArgs({ codexHome: path.join(tmp, 'nao-existe') }), ['-c', 'check_for_update_on_startup=false', '-c', 'notice.hide_rate_limit_model_nudge=true'], 'sem catálogo: sem o mapa (vale o que o usuário já respondeu)');
  assert.deepEqual(codexQuietArgs({}), ['-c', 'check_for_update_on_startup=false', '-c', 'notice.hide_rate_limit_model_nudge=true']);
  const bad = path.join(tmp, 'codex-home-bad'); fs.mkdirSync(bad); fs.writeFileSync(path.join(bad, 'models_cache.json'), '{ quebrado'); assert.deepEqual(codexModelMigrations(bad), [], 'ilegível: nunca lança');
  const big = path.join(tmp, 'codex-home-big'); fs.mkdirSync(big); fs.writeFileSync(path.join(big, 'models_cache.json'), Buffer.alloc(8 * 1024 * 1024 + 1, 32)); assert.deepEqual(codexModelMigrations(big), [], 'grande demais: ignorado');
  const many = catalog(path.join(tmp, 'codex-home-many'), Array.from({ length: 100 }, (_, i) => ({ slug: `m${i}`, upgrade: { model: `n${i}` } }))); assert.equal(codexModelMigrations(many).length, 32, 'teto de pares');
});

test('Codex sem perguntas: o catálogo é relido quando o Codex o atualiza; o pane recebe as chaves com o CODEX_HOME DELE; chamada direta sem env não lê o disco', () => {
  const home = catalog(path.join(tmp, 'codex-home-2'), [{ slug: 'old-a', upgrade: { model: 'new-a' } }]);
  assert.deepEqual(codexModelMigrations(home), [['old-a', 'new-a']]);
  const f = path.join(home, 'models_cache.json'); fs.writeFileSync(f, JSON.stringify({ models: [{ slug: 'old-a', upgrade: { model: 'new-b' } }, { slug: 'old-c', upgrade: { model: 'new-c' } }] })); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
  assert.deepEqual(codexModelMigrations(home), [['old-a', 'new-b'], ['old-c', 'new-c']], 'cache atualizado: relido');
  const a = codexProvider.paneArgs({ prompt: 'x', env: { CODEX_HOME: home } });
  assert.deepEqual(a.slice(-6), ['-c', 'check_for_update_on_startup=false', '-c', 'notice.hide_rate_limit_model_nudge=true', '-c', "notice.model_migrations={'old-a'='new-b','old-c'='new-c'}"]);
  assert.deepEqual(codexProvider.paneArgs({ prompt: 'x', quote: false, env: { CODEX_HOME: home } }).slice(-1), ["notice.model_migrations={'old-a'='new-b','old-c'='new-c'}"], 'no wrapper .cmd: só aspas simples, sem metacaractere do cmd.exe');
  const direct = codexProvider.paneArgs({ prompt: 'x' }); assert.ok(direct.includes('check_for_update_on_startup=false')); assert.ok(!direct.some((x) => x.startsWith('notice.model_migrations')), 'sem env: nada lido do disco');
  for (const v of [codexProvider.paneArgs({ prompt: 'x', fullAccess: true, env: { CODEX_HOME: home } }), codexProvider.paneArgs({ prompt: 'x', readOnly: true, env: { CODEX_HOME: home } })]) assert.ok(v.includes('check_for_update_on_startup=false'), 'vale com acesso total e somente leitura');
});

test('Codex sem perguntas: o mapa de migrações nunca estoura a linha do cmd.exe (teto de tamanho) e um link simbólico no lugar do catálogo não é seguido', () => {
  const long = (p, i) => `${p}${String(i).padStart(2, '0')}-${'x'.repeat(58)}`; // 64 caracteres, o máximo aceito pela regex
  const home = catalog(path.join(tmp, 'codex-home-long'), Array.from({ length: 64 }, (_, i) => ({ slug: long('a', i), upgrade: { model: long('b', i) } })));
  const arg = codexQuietArgs({ codexHome: home }).at(-1);
  assert.ok(arg.startsWith('notice.model_migrations={') && arg.length <= 1600, `argumento limitado (${arg.length} caracteres)`);
  assert.ok(codexModelMigrations(home).length < 64, 'o que não cabe fica de fora');
  const real = catalog(path.join(tmp, 'codex-home-real'), [{ slug: 'old-x', upgrade: { model: 'new-x' } }]), linkHome = path.join(tmp, 'codex-home-link'); fs.mkdirSync(linkHome);
  let linked = true; try { fs.symlinkSync(path.join(real, 'models_cache.json'), path.join(linkHome, 'models_cache.json')); } catch { linked = false; } // Windows sem privilégio de link: pula
  if (linked) assert.deepEqual(codexModelMigrations(linkHome), [], 'link simbólico: ignorado');
});

// ---- Lista de modelos e esforços do Codex = o catálogo do PRÓPRIO Codex (<CODEX_HOME>/models_cache.json); sem catálogo, a lista de reserva ----
const { codexCatalogOptions, configureCodexCatalog, CODEX_OPTIONS } = await import('../providers/codex.js');
const entry = (slug, extra = {}) => ({ slug, display_name: slug.toUpperCase(), visibility: 'list', priority: 5, supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => ({ effort })), upgrade: null, ...extra });

test('Codex: modelos e esforços vêm do catálogo do Codex (só os listados, na ordem dele, esforços que TODOS aceitam); sem catálogo, a lista de reserva', () => {
  const home = catalog(path.join(tmp, 'codex-home-opt'), [
    entry('gpt-6-luna', { priority: 8, supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => ({ effort })) }),
    entry('gpt-6.2-sol', { priority: 1, display_name: 'GPT-6.2-Sol', supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((effort) => ({ effort })) }),
    entry('gpt-reserve', { priority: 4, visibility: 'hide' }), entry('codex-auto-review', { priority: 12, visibility: 'hide' }),
    entry('gpt-5.6-terra', { priority: 10, display_name: 'GPT-5.6 <b>"Terra"</b>', upgrade: { model: 'gpt-6.1-terra' } }),
    entry('Mau Id'), entry('x"; calc', { priority: 0 }), null,
  ]);
  const o = codexCatalogOptions(home);
  assert.deepEqual(o.models.map((m) => m.id), ['gpt-6.2-sol', 'gpt-6-luna', 'gpt-5.6-terra'], 'só os listados (sem hide), por prioridade, sem ids inválidos');
  assert.deepEqual(o.models.map((m) => m.label), ['GPT-6.2-Sol', 'GPT-6-LUNA', 'GPT-5.6 b Terra b'], 'rótulo saneado (sem aspas nem tags; o que sobra vira espaço, sem juntar palavras)');
  assert.deepEqual(o.efforts.map((e) => e.id), ['low', 'medium', 'high', 'xhigh', 'max'], '"ultra" não vale para todos os modelos: fica de fora, e nenhuma combinação é inválida');
  assert.deepEqual(o.efforts.map((e) => e.label), ['Baixo', 'Médio', 'Alto', 'Muito alto', 'Máximo']);
  assert.ok(Object.isFrozen(o.models) && Object.isFrozen(o.models[0]));
  assert.equal(codexCatalogOptions(path.join(tmp, 'nao-existe')), null); assert.equal(codexCatalogOptions(null), null);
  const onlyHidden = catalog(path.join(tmp, 'codex-home-hidden'), [entry('gpt-reserve', { visibility: 'hide' })]); assert.equal(codexCatalogOptions(onlyHidden), null, 'catálogo sem modelo listado: reserva');
});

test('Codex: o provedor serve o catálogo configurado pelo servidor e a reserva sem ele; validateChoice/providerOptions acompanham, e o catálogo atualizado vale sem reiniciar', () => {
  assert.equal(codexProvider.options, CODEX_OPTIONS, 'sem configuração (testes, usos soltos): lista de reserva, nada lido do ~/.codex');
  const home = catalog(path.join(tmp, 'codex-home-live'), [entry('gpt-6.2-sol', { priority: 1 }), entry('gpt-6-luna', { priority: 8 })]);
  try {
    configureCodexCatalog({ home });
    assert.deepEqual(codexProvider.options.models.map((m) => m.id), ['gpt-6.2-sol', 'gpt-6-luna']);
    assert.deepEqual(P.providerOptions().codex.models.map((m) => m.id), ['gpt-6.2-sol', 'gpt-6-luna'], 'a lista que vai para a interface');
    assert.deepEqual(P.validateChoice('codex', { model: 'gpt-6-luna', effort: 'max' }), { value: { model: 'gpt-6-luna', effort: 'max' } });
    assert.equal(P.validateChoice('codex', { model: 'gpt-5-codex' }).field, 'model', 'modelo que o Codex da conta já não oferece: recusado (nunca vai para a linha de comando)');
    assert.deepEqual(P.tolerantChoice('codex', { model: 'gpt-5-codex', effort: 'high' }), { effort: 'high' }, 'registro antigo: o modelo que saiu é ignorado, o resto vale');
    assert.equal(P.validateChoice('claude', { model: 'gpt-6-luna' }).field, 'model', 'o catálogo do Codex não vaza para as outras IAs');
    const f = path.join(home, 'models_cache.json'); fs.writeFileSync(f, JSON.stringify({ models: [entry('gpt-7', { priority: 1 })] })); const t = new Date(Date.now() + 9000); fs.utimesSync(f, t, t);
    assert.deepEqual(codexProvider.options.models.map((m) => m.id), ['gpt-7'], 'o Codex atualizou o catálogo: a lista muda sem reiniciar o FORGE');
    fs.rmSync(f); assert.equal(codexProvider.options, CODEX_OPTIONS, 'catálogo sumiu: volta para a reserva');
  } finally { configureCodexCatalog({}); }
  assert.equal(codexProvider.options, CODEX_OPTIONS);
});

test('Codex: times prontos e tabela de tarefas não fixam modelo no Codex (ele muda por conta e por versão), e passam na validação com um catálogo e sem ele', async () => {
  const { TEAM_PRESETS } = await import('../team-presets.js');
  const { TASK_TYPES } = await import('../harness.js');
  const codexSlots = TEAM_PRESETS.flatMap((p) => p.slots.filter((s) => s.provider === 'codex')); assert.ok(codexSlots.length >= 3);
  assert.ok(codexSlots.every((s) => !('model' in s)), 'vaga Codex sem modelo fixo');
  assert.ok(TASK_TYPES.filter((t) => t.provider === 'codex').every((t) => t.model === null));
  const home = catalog(path.join(tmp, 'codex-home-presets'), [entry('gpt-6.2-sol', { priority: 1 }), entry('gpt-6-luna', { priority: 8 })]);
  try {
    configureCodexCatalog({ home });
    for (const s of codexSlots) assert.equal(P.validateChoice('codex', s).error, undefined, `${s.role}: ${s.effort} vale no catálogo`);
    for (const t of TASK_TYPES.filter((x) => x.provider === 'codex')) assert.equal(P.validateChoice('codex', { model: t.model, effort: t.effort }).error, undefined, t.id);
  } finally { configureCodexCatalog({}); }
});

test('Codex: catálogo atípico não quebra a lista — modelo sem níveis fica fora da interseção, sem nenhum nível cai na reserva, rótulos e níveis estranhos são saneados', () => {
  const lv = (...l) => l.map((effort) => ({ effort }));
  const semNiveis = catalog(path.join(tmp, 'codex-home-nolevels'), [entry('gpt-a', { priority: 1, supported_reasoning_levels: undefined }), entry('gpt-b', { priority: 2, supported_reasoning_levels: lv('low', 'high') }), entry('gpt-c', { priority: 3, supported_reasoning_levels: lv('low', 'high', 'max') })]);
  assert.deepEqual(codexCatalogOptions(semNiveis).efforts.map((e) => e.id), ['low', 'high'], 'o modelo sem níveis (mesmo o primeiro) não zera os esforços do Codex inteiro');
  const nenhum = catalog(path.join(tmp, 'codex-home-nolevels2'), [entry('gpt-a', { supported_reasoning_levels: [] }), entry('gpt-b', { supported_reasoning_levels: 'low' })]);
  assert.deepEqual(codexCatalogOptions(nenhum).efforts, CODEX_OPTIONS.efforts, 'nenhum modelo informa níveis: esforços da lista de reserva');
  assert.equal(codexCatalogOptions(nenhum).models.length, 2);
  const disjuntos = catalog(path.join(tmp, 'codex-home-disjoint'), [entry('gpt-a', { supported_reasoning_levels: lv('low') }), entry('gpt-b', { supported_reasoning_levels: lv('high') })]);
  assert.deepEqual(codexCatalogOptions(disjuntos).efforts, CODEX_OPTIONS.efforts, 'interseção vazia: reserva (nunca uma lista que recuse todo esforço)');
  const estranho = catalog(path.join(tmp, 'codex-home-weird'), [entry('gpt-a', { display_name: 'GPT-5.5 (Terra) + Pro', supported_reasoning_levels: lv('1', '-s', 'true1', 'low', 'high', 'Max', 'medium;rm') }), entry('gpt-b', { display_name: 'Codex – Auto/Review', supported_reasoning_levels: lv('1', '-s', 'true1', 'low', 'high') }), entry('gpt-c', { display_name: '!!!' })]);
  const o = codexCatalogOptions(estranho);
  assert.deepEqual(o.models.map((m) => m.label), ['GPT-5.5 Terra Pro', 'Codex Auto Review', 'gpt-c'], 'sem espaços duplos; sem nome útil, o próprio id');
  assert.deepEqual(o.efforts.map((e) => e.id), ['low', 'high'], 'níveis só com letra inicial e sem metacaractere: "1", "-s", "Max" e "medium;rm" nunca chegam à lista (nem viram número, booleano ou flag no -c)');
});

test('Codex: catálogo ilegível é lembrado (não reparseado a cada consulta), e um link simbólico no lugar dele é ignorado', () => {
  const home = path.join(tmp, 'codex-home-badjson'); fs.mkdirSync(home); const f = path.join(home, 'models_cache.json'); fs.writeFileSync(f, '{"models": [' + 'x'.repeat(2000));
  let reads = 0; const spy = { ...fs, readFileSync: (...a) => { reads++; return fs.readFileSync(...a); } };
  assert.equal(codexCatalogOptions(home, { fsImpl: spy }), null); assert.equal(codexCatalogOptions(home, { fsImpl: spy }), null); assert.equal(codexCatalogOptions(home, { fsImpl: spy }), null);
  assert.equal(reads, 1, 'lido e rejeitado UMA vez (o arquivo ruim fica na memória pela data e pelo tamanho)');
  fs.writeFileSync(f, JSON.stringify({ models: [entry('gpt-ok')] })); const t = new Date(Date.now() + 20000); fs.utimesSync(f, t, t);
  assert.deepEqual(codexCatalogOptions(home, { fsImpl: spy }).models.map((m) => m.id), ['gpt-ok'], 'arquivo corrigido: lido de novo'); assert.equal(reads, 2);
});

test('Tabela de tarefas: um modelo que o Codex deixou de oferecer não leva junto o esforço salvo (cada campo volta ao padrão sozinho)', async () => {
  const { effectiveRow, TASK_TYPES } = await import('../harness.js');
  const type = TASK_TYPES.find((t) => t.provider === 'codex'), home = catalog(path.join(tmp, 'codex-home-stale'), [entry('gpt-6.2-sol', { priority: 1 }), entry('gpt-6-luna', { priority: 8 })]);
  try {
    configureCodexCatalog({ home });
    const stale = effectiveRow(type, { rows: { [type.id]: { provider: 'codex', model: 'gpt-5-codex', effort: 'max' } } });
    assert.deepEqual([stale.model, stale.effort], [null, 'max'], 'o modelo que saiu volta ao padrão da CLI; o esforço salvo continua');
    const badEffort = effectiveRow(type, { rows: { [type.id]: { provider: 'codex', model: 'gpt-6-luna', effort: 'ultra' } } });
    assert.deepEqual([badEffort.model, badEffort.effort], ['gpt-6-luna', type.effort], 'esforço inexistente: só ele volta ao padrão da linha');
  } finally { configureCodexCatalog({}); }
});
