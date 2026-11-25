// Antigravity CLI, Kimi Code, Kiro CLI e Grok Build (NÍVEL 1: só terminal) e Copilot CLI (NÍVEL 2 parcial: vagas que recebem tarefas, com prova de conexão).
// PTY SIMULADO (nenhuma CLI real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-moreprov-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const P = await import('../providers/index.js');
const { copilotPaneFiles } = await import('../providers/copilot.js');
const T = await import('../terminals.js');
const TT = await import('../team-templates.js');
const F = await import('../flows.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const LEVEL1 = ['antigravity', 'kimi', 'kiro', 'grok'], ALL = [...LEVEL1, 'copilot'];
const BIN = { antigravity: 'agy', kimi: 'kimi', kiro: 'kiro-cli', grok: 'grok', copilot: 'copilot' };

test('registro: as cinco depois das anteriores; executável, instalação e configuração de projeto de cada uma; sem retomada, sem contas, sem planejador', () => {
  assert.deepEqual(P.providerIds(), ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'antigravity', 'kimi', 'kiro', 'copilot', 'grok']);
  const dir = path.join(tmp, 'bin'); fs.mkdirSync(dir);
  for (const id of ALL) {
    const p = P.getProvider(id);
    fs.writeFileSync(path.join(dir, BIN[id]), '#!/bin/sh\n');
    assert.equal(p.resolve({ env: { PATH: dir }, platform: 'linux' }).file, path.join(dir, BIN[id]), `${id}: acha ${BIN[id]}`);
    assert.equal(p.resolve({ env: { PATH: path.join(tmp, 'vazio') }, platform: 'linux' }), null);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.capabilities)); assert.equal(typeof p.install, 'string'); assert.match(p.notFoundMessage, /não foi encontrado no PATH/);
    assert.equal(P.canPlan(id), false, `${id}: não abre o planejador`); assert.equal(P.canStep(id), false); assert.equal(P.canLead(id), false); assert.equal(P.accountSpecOf(id), null);
    assert.equal(p.capabilities.resume, false); for (const mode of ['resume', 'fork']) assert.throws(() => p.paneArgs({ mode }), /não oferece retomada/);
    assert.deepEqual(p.envFor({ PATH: '/b', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c', GITHUB_TOKEN: 'g' }), { PATH: '/b', GITHUB_TOKEN: 'g' });
  }
  for (const id of LEVEL1) assert.equal(P.coordinates(id), false, `${id}: terminal livre`);
  assert.equal(P.coordinates('copilot'), true); assert.equal(P.needsProof('copilot'), true);
  assert.deepEqual([...P.getProvider('antigravity').projectConfig.dirs], ['.agents']); assert.deepEqual([...P.getProvider('kimi').projectConfig.dirs], ['.kimi-code']);
  assert.deepEqual([...P.getProvider('kiro').projectConfig.dirs], ['.kiro']); assert.deepEqual([...P.getProvider('grok').projectConfig.files], ['.mcp.json']);
  assert.equal(P.getProvider('copilot').projectConfig.keys, '*'); assert.deepEqual([...P.getProvider('copilot').projectConfig.dirs], ['.github/hooks']);
});

test('paneArgs: somente leitura e acesso total de cada CLI; quem não garante somente leitura recusa; o Copilot escolhe modelo da lista fechada', () => {
  const a = P.getProvider('antigravity'), k = P.getProvider('kimi'), r = P.getProvider('kiro'), g = P.getProvider('grok'), c = P.getProvider('copilot');
  assert.deepEqual(a.paneArgs({}), []); assert.deepEqual(a.paneArgs({ fullAccess: true }), ['--dangerously-skip-permissions']); assert.deepEqual(a.paneArgs({ readOnly: true, fullAccess: true }), ['--mode=plan']);
  assert.deepEqual(k.paneArgs({}), []); assert.deepEqual(k.paneArgs({ fullAccess: true }), ['--yolo']); assert.deepEqual(k.paneArgs({ readOnly: true, fullAccess: true }), ['--plan']);
  assert.deepEqual(r.paneArgs({}), ['chat']); assert.deepEqual(r.paneArgs({ fullAccess: true }), ['chat', '--trust-all-tools']);
  assert.deepEqual(g.paneArgs({}), []); assert.deepEqual(g.paneArgs({ fullAccess: true }), ['--always-approve']);
  assert.deepEqual(c.paneArgs({}), []); assert.deepEqual(c.paneArgs({ fullAccess: true, model: 'auto' }), ['--allow-all', '--model', 'auto']);
  for (const p of [r, g, c]) assert.throws(() => p.paneArgs({ readOnly: true }), /não garante somente leitura/, p.id);
  for (const v of ['true', 1]) assert.deepEqual(a.paneArgs({ fullAccess: v }), [], 'só o true estrito liga o acesso total');
  assert.deepEqual(P.validateChoice('copilot', { model: 'auto' }), { value: { model: 'auto' } }); assert.equal(P.validateChoice('copilot', { model: 'gpt-5' }).field, 'model');
  assert.equal(P.validateChoice('kimi', { model: 'k2' }).field, 'model', 'sem lista: o FORGE não escolhe modelo');
});

test('Copilot: arquivos do pane = MCP do FORGE só nesta sessão (--additional-mcp-config=@arquivo) e o papel em *.instructions.md; nada sem credencial válida', () => {
  const mcp = { url: 'http://127.0.0.1:4999/mcp', serverName: 'forge_ab12cd', token: 'a'.repeat(48) };
  const out = copilotPaneFiles({ dir: '/tmp/p/term_x', prompt: 'Voce e o CONSTRUTOR', mcp });
  assert.deepEqual(JSON.parse(out.files['mcp.json']), { mcpServers: { forge_ab12cd: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${'a'.repeat(48)}` }, tools: ['*'] } } });
  assert.deepEqual(out.args, [`--additional-mcp-config=@${path.join('/tmp/p/term_x', 'mcp.json')}`]);
  assert.equal(out.files['forge.instructions.md'], 'Voce e o CONSTRUTOR\n'); assert.deepEqual(out.env, { COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/tmp/p/term_x' });
  for (const bad of [{ ...mcp, token: 'curto' }, { ...mcp, url: 'http://evil.example/mcp' }, { ...mcp, serverName: 'a.b"c' }, null]) {
    const o = copilotPaneFiles({ dir: '/d', prompt: '', mcp: bad });
    assert.deepEqual([o.files, o.args], [{}, []], JSON.stringify(bad));
  }
});

function world(over = {}) {
  const spawned = [], issued = []; let pid = 1_940_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mcp = { serverName: 'forge_ab12cd', issue: (a) => { issued.push(a); return a.file === false ? { token: 'c'.repeat(48), url: 'http://127.0.0.1:4999/mcp' } : { configPath: `/tmp/${a.terminalId}.json` }; }, revoke() {} };
  const fake = (id) => () => ({ file: `/fake/${id}`, args: [], viaShell: false });
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: fake('claude'), resolveCommands: Object.fromEntries(P.providerIds().filter((x) => x !== 'claude').map((id) => [id, fake(id)])),
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp, track: () => ({ release() {} }),
    inspectConfig: async () => [], sweepMs: 0, usage: { read: () => null, has: () => true, forget() {} }, persist: () => {}, ...over });
  return { spawned, db, mgr, issued };
}

test('terminais: Antigravity, Kimi, Kiro e Grok abrem como terminal livre (sem credencial do Maestro); Maestro, time e etapa recusados', async () => {
  for (const id of LEVEL1) {
    const w = world();
    const r = await w.mgr.create({ role: 'builder', provider: id });
    assert.equal(r.ok, true, `${id}: ${r.error}`); assert.equal(w.spawned[0].file, `/fake/${id}`); assert.deepEqual(w.spawned[0].args, P.getProvider(id).paneArgs({}));
    assert.equal(w.issued.length, 0, `${id}: sem credencial`); assert.equal(w.spawned[0].opts.env.FORGE_MCP_TOKEN, undefined);
    assert.equal((await w.mgr.create({ role: 'maestro', provider: id })).code, 'provider_no_coordination');
    assert.equal((await w.mgr.create({ role: 'builder', provider: id }, { flowWorktreeId: 'wt_1' })).code, 'provider_no_coordination');
    assert.match(TT.validateTemplateBody({ name: 'T', slots: [{ role: 'builder', provider: id }] }).error ?? '', /Maestro/);
    assert.match(F.validateSteps([{ title: 'E', prompt: 'Faça', provider: id, role: 'builder' }]).error ?? '', /Maestro/);
  }
  const w = world();
  assert.equal((await w.mgr.create({ role: 'planner', provider: 'kiro' })).code, 'provider_no_read_only');
  assert.equal((await w.mgr.create({ role: 'planner', provider: 'antigravity' })).code, 'provider_no_planner', 'tem somente leitura, mas não abre o planejador de missão');
});

test('terminais: o Copilot recebe o MCP do FORGE só nesta sessão e o papel; vaga de time aceita; Maestro, etapa e planejador recusados; arquivos apagados no fim', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'pane-files-'));
  const w = world({ paneFilesDir: dir, findTemplate: () => ({ id: 'tpl_c', name: 'T', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'reviewer', provider: 'copilot' }] }) });
  const r = await w.mgr.create({ role: 'reviewer', provider: 'copilot', templateId: 'tpl_c', slotIndex: 1 });
  assert.equal(r.ok, true, r.error); assert.equal(w.issued[0].file, false);
  const p = w.spawned[0], pd = path.join(dir, r.session.id);
  assert.ok(p.args.includes(`--additional-mcp-config=@${path.join(pd, 'mcp.json')}`), p.args.join(' '));
  assert.equal(p.opts.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS, pd); assert.match(fs.readFileSync(path.join(pd, 'forge.instructions.md'), 'utf8'), /REVISOR/);
  assert.ok(!p.args.some((x) => x.includes('c'.repeat(48))), 'o token nunca vai para a linha de comando');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(pd, 'mcp.json')).mode & 0o777, 0o600);
  p.exit(0); assert.ok(!fs.existsSync(pd), 'arquivos do pane apagados no fim');
  assert.equal((await w.mgr.create({ role: 'maestro', provider: 'copilot' })).code, 'provider_no_lead');
  assert.equal((await w.mgr.create({ role: 'builder', provider: 'copilot' }, { flowWorktreeId: 'wt_1' })).code, 'provider_no_step');
  assert.equal((await w.mgr.create({ role: 'planner', provider: 'copilot' })).code, 'provider_no_read_only');
  assert.equal(TT.validateTemplateBody({ name: 'T', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'copilot', model: 'auto' }] }).error, undefined);
});

test('terminais: providers() traz as cinco com instalação e capacidades (o Copilot com coordenação a confirmar, sem estado)', () => {
  const w = world();
  const by = Object.fromEntries(w.mgr.providers().map((p) => [p.id, p]));
  for (const id of LEVEL1) assert.deepEqual(by[id].capabilities, { resume: false, plugins: false, mcp: false, readOnly: id === 'antigravity' || id === 'kimi', planner: false }, id);
  assert.deepEqual(by.copilot.capabilities, { resume: false, plugins: false, mcp: true, readOnly: false, mcpVerified: false, planner: false, state: false });
  assert.equal(by.kiro.install, 'curl -fsSL https://cli.kiro.dev/install | bash'); assert.equal(by.copilot.install, 'npm install -g @github/copilot');
});
