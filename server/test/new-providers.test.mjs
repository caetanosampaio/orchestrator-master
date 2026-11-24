// Gemini CLI, OpenCode e Cursor CLI no NÍVEL 1 (só terminal, sem coordenação): detecção no PATH, argumentos de cada CLI, estado do Gemini pelo título do terminal, o
// registro (capacidades, opções fechadas) e as recusas (Maestro, time, squad, missão e planejador). PTY SIMULADO (nenhuma CLI real), banco em memória, ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-newprov-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const P = await import('../providers/index.js');
const { resolveOnPath, withoutClaudeEnv } = await import('../providers/cli-path.js');
const { geminiProvider, geminiOscState } = await import('../providers/gemini.js');
const { opencodeProvider } = await import('../providers/opencode.js');
const { cursorProvider, resolveCursor } = await import('../providers/cursor.js');
const T = await import('../terminals.js');
const TT = await import('../team-templates.js');
const F = await import('../flows.js');
const PC = await import('../project-config.js');
const M = await import('../maestro.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NEW = ['gemini', 'opencode', 'cursor'];
const bin = (name, files) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(d, f), '#!/bin/sh\n'); return d; };

test('resolveOnPath: primeiro nome achado no PATH, na ordem; .cmd no Windows vai pelo cmd.exe; nome fora do padrão nunca vira executável; ausente = null', () => {
  const a = bin('bin-a', ['gemini', 'gemini.cmd']), b = bin('bin-b', ['opencode']);
  assert.deepEqual(resolveOnPath(['gemini'], { env: { PATH: [path.join(tmp, 'vazio'), a].join(path.delimiter) }, platform: 'linux' }), { file: path.join(a, 'gemini'), args: [], viaShell: false });
  assert.deepEqual(resolveOnPath(['nada', 'opencode'], { env: { PATH: [a, b].join(path.delimiter) }, platform: 'linux' }).file, path.join(b, 'opencode'));
  const w = resolveOnPath(['gemini'], { env: { PATH: a, ComSpec: 'cmd.exe' }, platform: 'win32' });
  assert.equal(w.viaShell, true); assert.deepEqual(w.args, ['/d', '/s', '/c', path.join(a, 'gemini.cmd')]);
  for (const bad of ['../gemini', 'gem ini', '', 'Gemini', null]) assert.equal(resolveOnPath([bad], { env: { PATH: a }, platform: 'linux' }), null, String(bad));
  assert.equal(resolveOnPath(['gemini'], { env: { PATH: path.join(tmp, 'vazio') }, platform: 'linux' }), null);
  assert.equal(geminiProvider.resolve({ env: { PATH: a }, platform: 'linux' }).file, path.join(a, 'gemini'));
  assert.equal(opencodeProvider.resolve({ env: { PATH: b }, platform: 'linux' }).file, path.join(b, 'opencode'));
});

test('resolveCursor: `cursor-agent` primeiro; `agent` (nome genérico) só vale se o arquivo real for do Cursor', () => {
  const named = bin('cur-named', ['cursor-agent', 'agent']);
  assert.equal(resolveCursor({ env: { PATH: named }, platform: 'linux' }).file, path.join(named, 'cursor-agent'));
  const other = bin('outro-bin', ['agent']); // um "agent" qualquer, de outra ferramenta
  assert.equal(resolveCursor({ env: { PATH: other }, platform: 'linux' }), null, 'agent de outra ferramenta não é o Cursor');
  const real = bin(path.join('share', 'cursor-agent', 'versions', '1'), ['cursor-agent']), link = path.join(tmp, 'local-bin'); fs.mkdirSync(link);
  fs.symlinkSync(path.join(real, 'cursor-agent'), path.join(link, 'agent'));
  assert.equal(resolveCursor({ env: { PATH: link }, platform: 'linux' }).file, path.join(link, 'agent'), 'o link do instalador (~/.local/bin/agent -> …/cursor-agent/…) vale');
  assert.equal(resolveCursor({ env: { PATH: path.join(tmp, 'vazio') }, platform: 'linux' }), null);
});

test('paneArgs: Gemini (aprovação e modelo), OpenCode (--standalone; somente leitura recusado) e Cursor (ask, --force, --model); nenhum aceita retomada', () => {
  assert.deepEqual(geminiProvider.paneArgs({}), ['--approval-mode', 'default']);
  assert.deepEqual(geminiProvider.paneArgs({ model: 'flash', fullAccess: true }), ['--approval-mode', 'yolo', '-m', 'flash']);
  assert.deepEqual(geminiProvider.paneArgs({ readOnly: true, fullAccess: true }), ['--approval-mode', 'plan'], 'somente leitura vence o acesso total');
  for (const v of ['true', 1, undefined]) assert.deepEqual(geminiProvider.paneArgs({ fullAccess: v }), ['--approval-mode', 'default'], `só o true estrito liga o yolo (${v})`);
  assert.deepEqual(opencodeProvider.paneArgs({ fullAccess: true, model: 'x' }), ['--standalone'], 'o OpenCode segue as permissões dele; o FORGE não escolhe modelo');
  assert.throws(() => opencodeProvider.paneArgs({ readOnly: true }), /somente leitura/);
  assert.deepEqual(cursorProvider.paneArgs({}), []);
  assert.deepEqual(cursorProvider.paneArgs({ fullAccess: true, model: 'auto' }), ['--force', '--model', 'auto']);
  assert.deepEqual(cursorProvider.paneArgs({ readOnly: true, fullAccess: true }), ['--mode', 'ask'], 'somente leitura: modo ask e nunca --force');
  for (const p of [geminiProvider, opencodeProvider, cursorProvider]) for (const mode of ['resume', 'fork']) assert.throws(() => p.paneArgs({ mode }), /não oferece retomada/, `${p.id} ${mode}`);
  for (const p of [geminiProvider, opencodeProvider, cursorProvider]) assert.ok(!p.paneArgs({ prompt: 'Voce e o CONSTRUTOR' }).some((x) => /CONSTRUTOR|--session-id|--mcp-config|mcp_servers/.test(x)), `${p.id}: sem papel nem MCP na linha de comando`);
});

test('estado do Gemini: o símbolo do título do terminal (◇ pronto, ✦ trabalhando, ✋ pede ação), inclusive cortado entre dois pedaços; título sem símbolo é ignorado', () => {
  assert.deepEqual(geminiOscState('\x1b]0;✦  Working… (proj)\x07'), { state: 'running', carry: '' });
  assert.equal(geminiOscState('saida\x1b]2;✋  Action Required (proj)\x1b\\').state, 'waiting');
  assert.equal(geminiOscState('\x1b]0;◇  Ready (proj)\x07').state, 'idle');
  assert.equal(geminiOscState('\x1b]0;✦ a\x07\x1b]0;◇ b\x07').state, 'idle', 'vale o último');
  assert.equal(geminiOscState('\x1b]0;meu titulo\x07').state, null);
  const cut = geminiOscState('texto\x1b]0;✦ Wor'); assert.equal(cut.state, null); assert.equal(cut.carry, '\x1b]0;✦ Wor');
  assert.equal(geminiOscState('king\x07', cut.carry).state, 'running');
  assert.equal(geminiOscState('\x1b]0;' + 'x'.repeat(400)).carry, '', 'sequência sem fim e longa demais não fica presa');
});

test('registro: os cinco provedores, os novos sem coordenação; opções fechadas; ambiente sem variáveis do Claude; configuração de projeto de cada um', () => {
  assert.deepEqual(P.providerIds(), ['claude', 'codex', ...NEW]);
  for (const id of NEW) {
    const p = P.getProvider(id);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.capabilities), id);
    assert.equal(P.coordinates(id), false, `${id}: sem coordenação`); assert.equal(p.capabilities.resume, false); assert.equal(p.capabilities.plugins, false); assert.equal(p.capabilities.transcript, false);
    assert.match(P.noCoordinationMessage(id), new RegExp(p.label)); assert.equal(typeof p.install, 'string'); assert.match(p.notFoundMessage, /não foi encontrado no PATH/);
    assert.deepEqual(p.envFor({ PATH: '/bin', CLAUDE_CODE_CHILD_SESSION: '1', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'g' }), { PATH: '/bin', GEMINI_API_KEY: 'g' });
    assert.equal(P.accountSpecOf(id), null, `${id}: sem contas do FORGE`);
  }
  assert.equal(P.coordinates('claude'), true); assert.equal(P.coordinates('codex'), true); assert.equal(P.coordinates('xpto'), false);
  assert.equal(P.providerCan('gemini', 'readOnly'), true); assert.equal(P.providerCan('cursor', 'readOnly'), true); assert.equal(P.providerCan('opencode', 'readOnly'), false);
  assert.deepEqual(P.validateChoice('gemini', { model: 'pro' }), { value: { model: 'pro' } });
  assert.equal(P.validateChoice('gemini', { model: 'gemini-2.5-pro; rm -rf' }).field, 'model', 'fora da lista fechada é recusado');
  assert.equal(P.validateChoice('gemini', { effort: 'high' }).field, 'effort', 'o Gemini não tem esforço');
  assert.equal(P.validateChoice('opencode', { model: 'auto' }).field, 'model', 'o OpenCode não escolhe modelo pelo FORGE');
  assert.deepEqual(P.providerOptions().cursor, { models: [{ id: 'auto', label: 'Automático' }], efforts: [] });
  assert.deepEqual([...geminiProvider.projectConfig.dirs], ['.gemini']); assert.deepEqual([...cursorProvider.projectConfig.dirs], ['.cursor']);
  assert.deepEqual([...opencodeProvider.projectConfig.files], ['opencode.json', 'opencode.jsonc']); assert.equal(opencodeProvider.projectConfig.keys, '*');
  assert.deepEqual(withoutClaudeEnv({ claude_x: '1', A: '2' }), { A: '2' }, 'sem caixa');
});

test('configuração de projeto do OpenCode: QUALQUER chave conta (plugins, mcp…); o detector do Claude segue igual', () => {
  assert.deepEqual(PC.activeKeys('{"$schema":"x","mcp":{"servers":{"a":{}}},"plugins":["p"],"theme":""}', '*'), ['mcp', 'plugins']);
  assert.deepEqual(PC.activeKeys('{"$schema":"x"}', '*'), [], 'só o $schema: nada a confirmar');
  assert.equal(PC.activeKeys('{ // jsonc\n}', '*'), null, 'JSONC com comentário não é interpretado: pede confirmação');
  assert.deepEqual(PC.activeKeys('{"mcp":{"servers":{}},"theme":"x"}'), [], 'sem `*`, só as chaves do Claude Code contam');
});

function world(over = {}) {
  const spawned = [], issued = [], inspected = []; let pid = 1_930_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData(cb) { p.feed = cb; }, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mcp = { serverName: 'forge_ab12cd', issue: (a) => { issued.push(a); return { configPath: `/tmp/${a.terminalId}.json` }; }, revoke() {} };
  const fake = (id) => () => ({ file: `/fake/${id}`, args: [], viaShell: false });
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: fake('claude'), resolveCommands: Object.fromEntries(['codex', ...NEW].map((id) => [id, fake(id)])),
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp, track: () => ({ release() {} }),
    inspectConfig: async (dir, spec) => { inspected.push(spec); return []; }, sweepMs: 0, usage: { read: () => ({ total: 5 }), has: () => true, forget() {} }, persist: () => {}, ...over });
  return { spawned, db, mgr, issued, inspected };
}

test('terminais: Gemini, OpenCode e Cursor abrem como terminal livre, com os argumentos deles, SEM credencial do Maestro, sem papel e sem token no ambiente', async () => {
  for (const id of NEW) {
    const w = world();
    const r = await w.mgr.create({ role: 'builder', provider: id });
    assert.equal(r.ok, true, `${id}: ${r.error}`); assert.equal(r.session.provider, id);
    const p = w.spawned[0];
    assert.equal(p.file, `/fake/${id}`); assert.deepEqual(p.args, P.getProvider(id).paneArgs({}), `${id}: só os argumentos do adaptador`);
    assert.equal(w.issued.length, 0, `${id}: nenhuma credencial do Maestro emitida`); assert.equal(w.db.terminalSessions[0].usesMcp, false);
    assert.equal(p.opts.env.FORGE_MCP_TOKEN, undefined); assert.equal(p.opts.env.CLAUDE_CODE_CHILD_SESSION, undefined);
    assert.deepEqual(w.inspected[0], P.getProvider(id).projectConfig, `${id}: inspeciona a configuração de projeto dele`);
    assert.equal(w.mgr.list()[0].usage, null, `${id}: sem leitura de consumo`);
  }
  const w = world();
  const g = await w.mgr.create({ role: 'reviewer', provider: 'gemini', model: 'pro' }); assert.equal(g.ok, true, g.error);
  assert.deepEqual(w.spawned[0].args, ['--approval-mode', 'default', '-m', 'pro']);
  assert.equal((await w.mgr.create({ provider: 'gemini', model: 'opus' })).code, 'model_invalid', 'modelo de outra IA é recusado');
  assert.equal((await w.mgr.create({ provider: 'cursor', role: 'planner' })).ok, true, 'o Cursor abre o planejador em modo ask');
  assert.deepEqual(w.spawned.at(-1).args, ['--mode', 'ask']);
});

test('terminais: sem coordenação, recusa Maestro, vaga de time, squad e etapa de missão (409, nada aberto); OpenCode não abre o planejador', async () => {
  for (const id of NEW) {
    const w = world();
    for (const [opts, second] of [[{ role: 'maestro', provider: id }], [{ role: 'builder', provider: id, squadId: 'sq_1' }], [{ role: 'builder', provider: id }, { flowWorktreeId: 'wt_1' }]]) {
      const r = await w.mgr.create(opts, second ?? {});
      assert.equal(r.status, 409, `${id} ${JSON.stringify(opts)}`); assert.equal(r.code, 'provider_no_coordination'); assert.match(r.error, /Maestro/);
    }
    assert.equal(w.spawned.length, 0, `${id}: nada foi aberto`); assert.equal(w.issued.length, 0);
  }
  const w = world();
  const r = await w.mgr.create({ role: 'planner', provider: 'opencode' });
  assert.equal(r.status, 409); assert.equal(r.code, 'provider_no_read_only'); assert.equal(w.spawned.length, 0);
  const team = world({ findTemplate: () => ({ id: 'tpl_x', name: 'T', slots: [{ role: 'builder', provider: 'gemini' }] }) });
  const t = await team.mgr.create({ role: 'builder', provider: 'gemini', templateId: 'tpl_x', slotIndex: 0 });
  assert.equal(t.code, 'provider_no_coordination', 'vaga de time (mesmo de um time antigo gravado) é recusada'); assert.equal(team.spawned.length, 0);
});

test('terminais: providers() traz disponibilidade, capacidades (retomada, skills, coordenação, somente leitura), o comando de instalação e o aviso de permissões', () => {
  const w = world({ resolveCommands: { codex: () => null, gemini: () => ({ file: '/fake/gemini', args: [], viaShell: false }), opencode: () => null, cursor: () => null } });
  const list = w.mgr.providers();
  assert.deepEqual(list.map((p) => [p.id, p.available]), [['claude', true], ['codex', false], ['gemini', true], ['opencode', false], ['cursor', false]]);
  assert.deepEqual(list[0].capabilities, { resume: true, plugins: true, mcp: true, readOnly: true });
  assert.deepEqual(list[2].capabilities, { resume: false, plugins: false, mcp: false, readOnly: true });
  assert.deepEqual(list[3].capabilities, { resume: false, plugins: false, mcp: false, readOnly: false });
  assert.equal(list[2].install, 'npm i -g @google/gemini-cli'); assert.match(list[3].note, /permissões seguem a configuração do próprio OpenCode/);
  assert.equal(list[0].install, undefined, 'Claude e Codex sem install aqui (já têm a tela própria)');
});

test('estado do Gemini chega ao terminal pelo título (sem hooks): trabalhando -> pede ação -> pronto', async () => {
  const w = world();
  const r = await w.mgr.create({ provider: 'gemini' });
  const state = () => w.mgr.get(r.session.id).agent?.state ?? null;
  assert.equal(state(), null);
  w.spawned[0].feed('\x1b]0;✦  Working (proj)\x07'); assert.equal(state(), 'running');
  w.spawned[0].feed('\x1b]0;✋  Action Required\x07'); assert.equal(state(), 'waiting');
  w.spawned[0].feed('\x1b]0;◇  Ready\x07'); assert.equal(state(), 'idle');
});

test('times e missões: vaga ou etapa com IA sem coordenação é recusada na validação, com a mensagem do Maestro', () => {
  for (const id of NEW) {
    const t = TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: id }] });
    assert.match(t.error ?? '', /slots\[1\]: .*Maestro/, id);
    const s = F.validateSteps([{ title: 'Etapa', prompt: 'Faça algo', provider: id, role: 'builder' }]);
    assert.match(s.error ?? '', /Etapa 1: .*Maestro/, id);
  }
  assert.equal(TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'builder', provider: 'codex' }] }).error, undefined, 'Codex continua aceito');
  assert.equal(F.validateSteps([{ title: 'Etapa', prompt: 'Faça algo', provider: 'claude', role: 'builder' }]).error, undefined, 'Claude continua aceito');
});

test('Maestro: o terminal livre (IA sem coordenação) aparece em list_panes com coordinated:false e NÃO recebe send_task nem dispatch (não teria como avisar o fim)', () => {
  const MA = 'term_aaaaaaaa', GE = 'term_bbbbbbbb', CL = 'term_cccccccc', OC = 'term_dddddddd';
  const panes = new Map([[MA, { id: MA, role: 'maestro', provider: 'claude', title: 'M', status: 'running' }], [GE, { id: GE, role: 'builder', provider: 'gemini', title: 'G', status: 'running' }],
    [OC, { id: OC, role: 'builder', provider: 'opencode', title: 'O', status: 'running' }], [CL, { id: CL, role: 'builder', provider: 'claude', title: 'C', status: 'running' }]]);
  const written = [], timers = []; let n = 0;
  const api = { get: (id) => panes.get(id) ?? null, peek: (id) => panes.get(id) ?? null, list: () => [...panes.values()], write: (id, d) => { written.push([id, d]); return { ok: true, status: 200 }; }, readOutput: () => '' };
  const m = M.createMaestro({ getTerminals: () => api, mcpDir: path.join(tmp, `mcp-${Math.random().toString(16).slice(2)}`), url: 'http://127.0.0.1:4999/mcp', serverName: 'forge_ab12cd', uid: (p) => `${p}_${String(++n).padStart(8, '0')}`, setTimer: (fn) => { timers.push(fn); return { unref() {} }; } });
  const ma = { terminalId: MA, role: 'maestro' }, call = (name, args = {}) => m.rpc(ma, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  m.setAutonomous(true);
  const by = Object.fromEntries(JSON.parse(call('list_panes').content[0].text).map((x) => [x.pane_id, x]));
  assert.equal(by[GE].coordinated, false); assert.equal(by[OC].coordinated, false); assert.equal('coordinated' in by[CL], false, 'pane com coordenação: o campo nem aparece');
  for (const id of [GE, OC]) {
    const r = call('send_task', { pane_id: id, task: 'faça isso' });
    assert.equal(r.isError, true, id); assert.match(r.content[0].text, /terminal livre.*NÃO foi enviada/);
    const d = m.dispatch({ to: id, text: 'faça isso' }); assert.equal(d.ok, false); assert.match(d.error, /terminal livre/);
  }
  assert.equal(written.length, 0, 'nada foi digitado nos terminais livres');
  assert.match(call('send_task', { pane_id: CL, task: 'faça isso' }).content[0].text, /entregue/, 'o pane do Claude continua recebendo');
  assert.equal(written[0][0], CL);
});
