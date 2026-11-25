// Gemini CLI (NÍVEL 2: com o Maestro, a confirmar pela conexão real), Cursor CLI (NÍVEL 2 parcial: só vagas que recebem tarefas) e OpenCode (NÍVEL 1: só terminal): detecção no PATH, argumentos de cada CLI, estado do Gemini pelo título do terminal, o
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

const NEW = ['gemini', 'opencode', 'cursor'], FREE = ['opencode'];
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

test('registro: os cinco provedores; Gemini e Cursor com coordenação a confirmar (o Cursor sem liderar nem ser etapa), OpenCode sem; opções fechadas; ambiente sem variáveis do Claude; configuração de projeto de cada um', () => {
  assert.deepEqual(P.providerIds().slice(0, 5), ['claude', 'codex', ...NEW], 'as cinco seguintes em more-providers.test.mjs');
  for (const id of NEW) {
    const p = P.getProvider(id);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.capabilities), id);
    assert.equal(P.coordinates(id), id !== 'opencode', `${id}: Gemini e Cursor coordenam`); assert.equal(P.needsProof(id), id !== 'opencode'); assert.equal(P.canLead(id), id === 'gemini', `${id}: Maestro`); assert.equal(P.canStep(id), id === 'gemini', `${id}: etapa`); assert.equal(P.canPlan(id), false, `${id}: não abre o planejador`); assert.equal(p.capabilities.resume, false); assert.equal(p.capabilities.plugins, false); assert.equal(p.capabilities.transcript, false);
    assert.match(P.noCoordinationMessage(id), new RegExp(p.label.replace(/[()]/g, ''))); assert.equal(typeof p.install, 'string'); assert.match(p.notFoundMessage, /não foi encontrado no PATH/);
    assert.deepEqual(p.envFor({ PATH: '/bin', CLAUDE_CODE_CHILD_SESSION: '1', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'g' }), { PATH: '/bin', GEMINI_API_KEY: 'g' });
    assert.equal(P.accountSpecOf(id), null, `${id}: sem contas do FORGE`);
  }
  assert.equal(P.coordinates('claude'), true); assert.equal(P.coordinates('codex'), true); assert.equal(P.coordinates('xpto'), false);
  assert.equal(P.needsProof('claude'), false); assert.equal(P.needsProof('codex'), false); assert.equal(P.canPlan('claude'), true); assert.equal(P.canPlan('codex'), true);
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
  const mcp = { serverName: 'forge_ab12cd', issue: (a) => { issued.push(a); return a.file === false ? { token: 'e'.repeat(48), url: 'http://127.0.0.1:4999/mcp' } : { configPath: `/tmp/${a.terminalId}.json` }; }, revoke() {} }; // como o maestro.issue real
  const fake = (id) => () => ({ file: `/fake/${id}`, args: [], viaShell: false });
  const mk = () => T.createTerminalManager({ db, ptyLib: lib, resolveCommand: fake('claude'), resolveCommands: Object.fromEntries(['codex', ...NEW].map((id) => [id, fake(id)])),
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp, track: () => ({ release() {} }),
    inspectConfig: async (dir, spec) => { inspected.push(spec); return []; }, sweepMs: 0, usage: { read: () => ({ total: 5 }), has: () => true, forget() {} }, persist: () => {}, ...over });
  return { spawned, db, mgr: mk(), mk, issued, inspected }; // mk: outro gerente sobre o MESMO banco (simula o servidor reiniciado)
}

test('terminais: OpenCode e Cursor abrem como terminal livre, com os argumentos deles, SEM credencial do Maestro, sem papel e sem token no ambiente', async () => {
  for (const id of FREE) {
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
  assert.equal(w.issued[0].file, false, 'Gemini: credencial sem arquivo (token no ambiente)');
  assert.deepEqual(w.spawned[0].args, ['--approval-mode', 'default', '-m', 'pro']);
  assert.equal((await w.mgr.create({ provider: 'gemini', model: 'opus' })).code, 'model_invalid', 'modelo de outra IA é recusado');
  assert.equal((await w.mgr.create({ provider: 'cursor', role: 'planner' })).code, 'provider_no_planner', 'o Cursor não abre o planejador de missão');
});

test('terminais: sem coordenação, recusa Maestro, vaga de time, squad e etapa de missão (409, nada aberto); OpenCode e Gemini não abrem o planejador', async () => {
  for (const id of FREE) {
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
  const gp = await w.mgr.create({ role: 'planner', provider: 'gemini' });
  assert.equal(gp.status, 409); assert.equal(gp.code, 'provider_no_planner'); assert.equal(w.spawned.length, 0);
  const team = world({ findTemplate: () => ({ id: 'tpl_x', name: 'T', slots: [{ role: 'builder', provider: 'opencode' }] }) });
  const t = await team.mgr.create({ role: 'builder', provider: 'opencode', templateId: 'tpl_x', slotIndex: 0 });
  assert.equal(t.code, 'provider_no_coordination', 'vaga de time (mesmo de um time antigo gravado) é recusada'); assert.equal(team.spawned.length, 0);
});

test('terminais: providers() traz disponibilidade, capacidades (retomada, skills, coordenação, somente leitura), o comando de instalação e o aviso de permissões', () => {
  const w = world({ resolveCommands: { codex: () => null, gemini: () => ({ file: '/fake/gemini', args: [], viaShell: false }), opencode: () => null, cursor: () => null } });
  const list = w.mgr.providers();
  assert.deepEqual(list.slice(0, 5).map((p) => [p.id, p.available]), [['claude', true], ['codex', false], ['gemini', true], ['opencode', false], ['cursor', false]]);
  assert.deepEqual(list[0].capabilities, { resume: true, plugins: true, mcp: true, readOnly: true });
  assert.deepEqual(list[2].capabilities, { resume: false, plugins: false, mcp: true, readOnly: true, mcpVerified: false, planner: false });
  assert.deepEqual(list[4].capabilities, { resume: false, plugins: false, mcp: true, readOnly: true, mcpVerified: false, planner: false, state: false, rolePrompt: false });
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

test('times e missões: vaga ou etapa com IA sem coordenação é recusada na validação, com a mensagem do Maestro; o Gemini (nível 2) entra', () => {
  assert.equal(TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'maestro', provider: 'gemini' }, { role: 'builder', provider: 'gemini', model: 'flash' }] }).error, undefined);
  assert.equal(F.validateSteps([{ title: 'Etapa', prompt: 'Faça algo', provider: 'gemini', role: 'builder' }]).error, undefined);
  for (const id of FREE) {
    const t = TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: id }] });
    assert.match(t.error ?? '', /slots\[1\]: .*Maestro/, id);
    const s = F.validateSteps([{ title: 'Etapa', prompt: 'Faça algo', provider: id, role: 'builder' }]);
    assert.match(s.error ?? '', /Etapa 1: .*Maestro/, id);
  }
  // Cursor: vaga que recebe tarefas sim; Maestro e etapa de missão não
  assert.equal(TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'cursor' }, { role: 'reviewer', provider: 'cursor' }] }).error, undefined);
  assert.match(TT.validateTemplateBody({ name: 'Time', slots: [{ role: 'maestro', provider: 'cursor' }] }).error ?? '', /slots\[0\]: Cursor CLI ainda não pode ser o Maestro/);
  assert.match(F.validateSteps([{ title: 'Etapa', prompt: 'Faça algo', provider: 'cursor', role: 'builder' }]).error ?? '', /Etapa 1: Cursor CLI ainda não entra em etapas de missão/);
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
  for (const [id, why] of [[GE, /ainda não se conectou ao Maestro.*NÃO foi enviada/], [OC, /terminal livre.*NÃO foi enviada/]]) {
    const r = call('send_task', { pane_id: id, task: 'faça isso' });
    assert.equal(r.isError, true, id); assert.match(r.content[0].text, why);
    const d = m.dispatch({ to: id, text: 'faça isso' }); assert.equal(d.ok, false); assert.notEqual(d.transient, true, 'sem data de início: não é "recém-aberto"');
  }
  assert.equal(written.length, 0, 'nada foi digitado nos terminais livres');
  assert.match(call('send_task', { pane_id: CL, task: 'faça isso' }).content[0].text, /entregue/, 'o pane do Claude continua recebendo');
  assert.equal(written[0][0], CL);
  // missão: Gemini recém-aberto ainda conectando = "não pronto" (tenta de novo), não falha
  panes.get(GE).startedAt = new Date().toISOString();
  const young = m.dispatch({ to: GE, text: 'faça isso' }); assert.equal(young.ok, false); assert.equal(young.transient, true); assert.match(young.error, /se conectando/);
  // a PROVA: o pane do Gemini fala com o MCP usando a credencial dele -> passa a coordenar
  const cred = m.issue({ terminalId: GE, role: 'builder', file: false });
  assert.equal(m.connected(GE), false); assert.ok(m.authenticate(`Bearer ${cred.token}`)); assert.equal(m.connected(GE), true);
  assert.equal('coordinated' in Object.fromEntries(JSON.parse(call('list_panes').content[0].text).map((x) => [x.pane_id, x]))[GE], false, 'conectado: sai a marca de livre');
  while (timers.length) timers.shift()();
  assert.match(call('send_task', { pane_id: GE, task: 'faça isso no gemini' }).content[0].text, /entregue/, 'conectado: recebe a tarefa');
  assert.ok(written.some(([id]) => id === GE));
  m.revoke(GE); assert.equal(m.connected(GE), false, 'a revogação apaga a prova');
});

test('Gemini: arquivos do pane = padrões do sistema com o MCP do FORGE (token só como ${FORGE_MCP_TOKEN}) e o hook do papel; caminho inseguro não registra o hook', async () => {
  const G = await import('../providers/gemini.js');
  const mcp = { url: 'http://127.0.0.1:4999/mcp', serverName: 'forge_ab12cd' };
  const out = G.geminiPaneFiles({ dir: '/tmp/forge/term_x', prompt: 'Voce e o CONSTRUTOR', mcp, node: '/usr/bin/node', platform: 'darwin' });
  assert.deepEqual(out.env, { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join('/tmp/forge/term_x', 'settings.json') });
  const st = JSON.parse(out.files['settings.json']);
  assert.deepEqual(st.mcpServers, { forge_ab12cd: { httpUrl: mcp.url, headers: { Authorization: 'Bearer ${FORGE_MCP_TOKEN}' }, trust: true, timeout: 20000 } });
  assert.equal(out.files['papel.txt'], 'Voce e o CONSTRUTOR');
  assert.equal(st.hooks.BeforeAgent[0].hooks[0].command, `"/usr/bin/node" "${G.HOOK_SCRIPT.replace(/\\/g, '/')}" "${path.join('/tmp/forge/term_x', 'papel.txt').replace(/\\/g, '/')}"`);
  assert.match(G.roleHookCommand({ node: 'C:\\node\\node.exe', roleFile: 'C:\\d\\papel.txt', platform: 'win32' }), /^& "C:\/node\/node.exe" ".*" "C:\/d\/papel.txt"$/, 'Windows: chamada do PowerShell e barras normais');
  for (const bad of ['/a"b', '/a$b', "/a'b", '/a`b', '/a%b', '/a\nb']) assert.equal(G.roleHookCommand({ node: bad, roleFile: '/x' }), null, bad);
  const noHook = G.geminiPaneFiles({ dir: '/tmp/a$b', prompt: 'x', mcp, node: '/usr/bin/node' });
  assert.equal(JSON.parse(noHook.files['settings.json']).hooks, undefined, 'pasta insegura: sem hook, o MCP segue'); assert.equal(noHook.files['papel.txt'], undefined);
  for (const bad of [{ url: 'http://evil.example/mcp', serverName: 'forge_ab12cd' }, { url: mcp.url, serverName: 'a.b"c' }]) assert.equal(JSON.parse(G.geminiPaneFiles({ dir: '/d', prompt: 'x', mcp: bad, node: '/n' }).files['settings.json']).mcpServers, undefined, JSON.stringify(bad));
  assert.deepEqual(G.geminiPaneFiles({ dir: '/d', prompt: '', mcp: null }), { files: {}, env: {} });
});

test('hook do papel do Gemini: entrega o papel UMA vez por sessão como additionalContext; sem arquivo ou com erro, sai com {} e código 0', async () => {
  const { execFileSync } = await import('node:child_process');
  const G = await import('../providers/gemini.js');
  const d = fs.mkdtempSync(path.join(tmp, 'hook-')), role = path.join(d, 'papel.txt'); fs.writeFileSync(role, 'Voce e o REVISOR');
  const run = (sid, file = role) => JSON.parse(execFileSync(process.execPath, [G.HOOK_SCRIPT, file], { input: '{}', env: { ...process.env, GEMINI_SESSION_ID: sid } }).toString());
  const first = run('sess-1');
  assert.deepEqual(first, { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: '[Instrução do FORGE para este terminal] Voce e o REVISOR' } });
  assert.deepEqual(run('sess-1'), {}, 'segundo turno da mesma sessão: nada'); assert.ok(run('sess-2').hookSpecificOutput, 'sessão nova (ex.: /clear): entrega de novo');
  assert.deepEqual(run('../../x'), first, 'id de sessão estranho é limpo (a marca fica na pasta do papel)'); assert.ok(!fs.existsSync(path.join(d, '..', '..', 'x')));
  assert.deepEqual(run('s', path.join(d, 'nao-existe.txt')), {});
});

test('terminais: o pane do Gemini recebe a credencial só no ambiente e os arquivos numa pasta própria (0600, sem token), apagada quando ele acaba; boot limpa sobras', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'pane-files-'));
  fs.mkdirSync(path.join(dir, 'term_sobra00')); fs.writeFileSync(path.join(dir, 'term_sobra00', 'settings.json'), '{}');
  const w = world({ paneFilesDir: dir, hookNode: '/usr/bin/node' });
  assert.ok(!fs.existsSync(path.join(dir, 'term_sobra00')), 'sobra de uma execução anterior removida na partida');
  const r = await w.mgr.create({ role: 'builder', provider: 'gemini' });
  assert.equal(r.ok, true, r.error);
  const p = w.spawned[0], pd = path.join(dir, r.session.id), env = p.opts.env;
  assert.equal(env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH, path.join(pd, 'settings.json'));
  assert.equal(env.FORGE_MCP_TOKEN, 'e'.repeat(48), 'token só no ambiente'); assert.equal(w.issued[0].file, false);
  assert.ok(!p.args.some((x) => x.includes('e'.repeat(48))), 'nunca na linha de comando');
  const st = fs.readFileSync(path.join(pd, 'settings.json'), 'utf8');
  assert.ok(!st.includes('e'.repeat(48)), 'nunca no arquivo');
  assert.match(st, /Bearer \$\{FORGE_MCP_TOKEN\}/); assert.match(fs.readFileSync(path.join(pd, 'papel.txt'), 'utf8'), /CONSTRUTOR/);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(path.join(pd, 'settings.json')).mode & 0o777, 0o600); assert.equal(fs.statSync(pd).mode & 0o777, 0o700); }
  p.exit(0); assert.ok(!fs.existsSync(pd), 'pasta do pane apagada no fim');
  const c = await w.mgr.create({ role: 'builder', provider: 'claude' }); assert.equal(c.ok, true);
  assert.deepEqual(fs.readdirSync(dir), [], 'o Claude não ganha pasta de arquivos do pane');
});

test('reabrir um terminal de outra IA inspeciona a configuração de projeto DELA (não só a do Claude) e recusa sem confirmação; a mensagem cita a IA certa', async () => {
  for (const id of ['gemini', 'opencode']) { // (o Cursor fica fora: o preparo dele grava no ~/.cursor; Kiro e Copilot são do more-providers)
    let found = [];
    const w = world({ inspectConfig: async (dir, spec) => { w.inspected.push(spec); return found; } });
    const r = await w.mgr.create({ role: 'builder', provider: id }); assert.equal(r.ok, true, `${id}: ${r.error}`);
    w.mgr.killAllSync(); w.mgr = w.mk(); // o servidor parou com o terminal aberto: o registro fica interrompido (reabrível)
    w.inspected.length = 0; found = [{ path: '.x', why: 'tem arquivos não versionados' }];
    const re = await w.mgr.resume({ recordId: r.session.recordId, reopen: true });
    assert.equal(re.status, 409, `${id}: ${re.error}`); assert.equal(re.code, 'project_config_unreviewed');
    assert.deepEqual(w.inspected, [P.getProvider(id).projectConfig], `${id}: inspeciona com os caminhos dele`);
    assert.ok(re.error.includes(P.getProvider(id).label), `${id}: ${re.error}`); assert.equal(w.spawned.length, 1, `${id}: nada aberto`);
    found = [];
    const ok = await w.mgr.resume({ recordId: r.session.recordId, reopen: true }); assert.equal(ok.status, 201, `${id}: ${ok.error}`);
  }
});

test('arquivos do pane: a pasta base recebe a ACL só do usuário UMA vez, antes do primeiro arquivo (o mcp.json do Copilot leva o token)', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(tmp, 'pane-lock-')), 'pane-files'), locked = [];
  const w = world({ paneFilesDir: dir, hookNode: '/usr/bin/node', lockDir: (d) => { locked.push([d, fs.existsSync(d), fs.existsSync(d) ? fs.readdirSync(d).length : -1]); return true; } });
  for (let i = 0; i < 2; i++) { const r = await w.mgr.create({ role: 'builder', provider: 'gemini' }); assert.equal(r.ok, true, r.error); }
  assert.equal(fs.readdirSync(dir).length, 2, 'os dois panes gravaram arquivos');
  assert.deepEqual(locked, [[dir, true, 0]], 'uma vez, com a pasta criada e ainda vazia');
  // a pasta base apagada com o servidor rodando: recriada e restringida de novo
  fs.rmSync(dir, { recursive: true, force: true });
  const r3 = await w.mgr.create({ role: 'builder', provider: 'gemini' }); assert.equal(r3.ok, true, r3.error);
  assert.equal(locked.length, 2, 'pasta recriada = nova restrição'); assert.equal(locked[1][2], 0);
  // falha da restrição não impede o terminal (melhor esforço, como a pasta mcp/ do Maestro), os arquivos são gravados e o próximo pane tenta de novo
  const d2 = path.join(fs.mkdtempSync(path.join(tmp, 'pane-lock-')), 'p'); let tries = 0;
  const w2 = world({ paneFilesDir: d2, hookNode: '/usr/bin/node', lockDir: () => { tries++; return false; } });
  const r2 = await w2.mgr.create({ role: 'builder', provider: 'gemini' }); assert.equal(r2.ok, true, r2.error);
  assert.ok(fs.existsSync(path.join(d2, r2.session.id, 'settings.json')), 'arquivos do pane gravados mesmo sem a ACL');
  assert.equal((await w2.mgr.create({ role: 'builder', provider: 'gemini' })).ok, true); assert.equal(tries, 2, 'falhou = tenta de novo no próximo pane');
  // restrição que LANÇA: o pane abre sem a coordenação (sem arquivos), nunca com os arquivos fora da pasta protegida
  const d4 = path.join(fs.mkdtempSync(path.join(tmp, 'pane-lock-')), 'p');
  const w4 = world({ paneFilesDir: d4, hookNode: '/usr/bin/node', lockDir: () => { throw new Error('icacls'); } });
  const r4 = await w4.mgr.create({ role: 'builder', provider: 'gemini' }); assert.equal(r4.ok, true, r4.error);
  assert.ok(!fs.existsSync(path.join(d4, r4.session.id)), 'sem pasta do pane'); assert.equal(w4.spawned[0].opts.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH, undefined, 'sem a coordenação');
});

test('Cursor: a entrada forge-maestro no ~/.cursor/mcp.json — criada sem porta nem token, o resto preservado, cópia de segurança, nada gravado sem mudança; JSON inválido ou link não são tocados', async () => {
  const C = await import('../cursor-mcp.js');
  const home = fs.mkdtempSync(path.join(tmp, 'home-')), file = path.join(home, '.cursor', 'mcp.json');
  assert.deepEqual(C.ensureCursorMcpEntry({ homeDir: home }), { ok: true, changed: true }, 'sem arquivo: cria');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { 'forge-maestro': { url: '${env:FORGE_MCP_URL}', headers: { Authorization: 'Bearer ${env:FORGE_MCP_TOKEN}' } } } });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(C.ensureCursorMcpEntry({ homeDir: home }), { ok: true, changed: false }, 'igual: nada a gravar');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { meu: { url: 'https://x' }, 'forge-maestro': { url: 'velho' } }, outra: 1 })); fs.chmodSync(file, 0o644);
  assert.deepEqual(C.ensureCursorMcpEntry({ homeDir: home }), { ok: true, changed: true });
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(j.mcpServers.meu, { url: 'https://x' }, 'os servidores do usuário ficam'); assert.equal(j.outra, 1); assert.equal(j.mcpServers['forge-maestro'].url, '${env:FORGE_MCP_URL}');
  assert.match(fs.readFileSync(`${file}.forge-backup`, 'utf8'), /"velho"/, 'cópia de segurança do arquivo antes da mudança');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o644, 'mantém a permissão do arquivo do usuário');
  assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')), 'sem temporário largado');
  for (const bad of ['{ // comentário', '[1]', '{"mcpServers": []}']) {
    fs.writeFileSync(file, bad); const r = C.ensureCursorMcpEntry({ homeDir: home });
    assert.equal(r.ok, false, bad); assert.match(r.why, /não mexe nele/); assert.equal(fs.readFileSync(file, 'utf8'), bad, 'intocado');
  }
  if (process.platform !== 'win32') {
    const h2 = fs.mkdtempSync(path.join(tmp, 'home-')), real = path.join(h2, 'real.json'); fs.mkdirSync(path.join(h2, '.cursor')); fs.writeFileSync(real, '{}'); fs.symlinkSync(real, path.join(h2, '.cursor', 'mcp.json'));
    assert.equal(C.ensureCursorMcpEntry({ homeDir: h2 }).ok, false, 'link simbólico não é seguido'); assert.equal(fs.readFileSync(real, 'utf8'), '{}');
  }
  assert.equal(C.ensureCursorMcpEntry({ homeDir: '' }).ok, false);
});

test('terminais: o pane do Cursor grava a entrada global, recebe endereço e token só no ambiente; falha ao gravar = pane sem coordenação; Maestro e etapa recusados; vaga de time aceita', async () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const w = world({ homeDir: home, findTemplate: () => ({ id: 'tpl_c', name: 'T', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'cursor' }] }) });
  const r = await w.mgr.create({ role: 'builder', provider: 'cursor', templateId: 'tpl_c', slotIndex: 1 });
  assert.equal(r.ok, true, r.error); assert.equal(w.issued[0].file, false);
  const env = w.spawned[0].opts.env;
  assert.equal(env.FORGE_MCP_URL, 'http://127.0.0.1:4999/mcp'); assert.equal(env.FORGE_MCP_TOKEN, 'e'.repeat(48));
  assert.ok(!w.spawned[0].args.some((x) => x.includes('e'.repeat(48)) || x.includes('--approve-mcps')), 'sem token na linha de comando e sem aprovar TODOS os servidores');
  const cfg = fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'); assert.ok(!cfg.includes('e'.repeat(48)) && !cfg.includes('4999'), 'nem token nem porta no arquivo');
  assert.equal((await w.mgr.create({ role: 'maestro', provider: 'cursor' })).code, 'provider_no_lead');
  assert.equal((await w.mgr.create({ role: 'builder', provider: 'cursor' }, { flowWorktreeId: 'wt_1' })).code, 'provider_no_step');
  const h2 = fs.mkdtempSync(path.join(tmp, 'home-')); fs.mkdirSync(path.join(h2, '.cursor')); fs.writeFileSync(path.join(h2, '.cursor', 'mcp.json'), 'lixo');
  const w2 = world({ homeDir: h2 });
  const r2 = await w2.mgr.create({ role: 'builder', provider: 'cursor' });
  assert.equal(r2.ok, true, 'o terminal abre mesmo assim'); assert.equal(w2.spawned[0].opts.env.FORGE_MCP_URL, undefined, 'sem a entrada, sem o endereço: o Maestro o trata como livre');
  assert.equal(fs.readFileSync(path.join(h2, '.cursor', 'mcp.json'), 'utf8'), 'lixo');
});
