// Avisos de "confiar nesta pasta?": gravação segura da confiança do Claude Code (trust.js), argumento de confiança do Codex e o gancho do gerenciador de terminais.
// NUNCA toca no ~/.claude.json real: todo arquivo de estado aqui é temporário e injetado. PTY SIMULADO.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-trust-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { trustClaudeFolder, claudeStateFile } = await import('../trust.js');
const { codexProvider } = await import('../providers/codex.js');
const T = await import('../terminals.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const stateFile = (content, mode = 0o600) => { const f = path.join(tmp, `claude-${++n}.json`); if (content !== undefined) fs.writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content, null, 2), { mode }); return f; };
const folder = () => { const d = path.join(tmp, `proj-${++n}`); fs.mkdirSync(d); return fs.realpathSync.native(d); };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// No Windows o trust.js registra a pasta também com barras normais (/); nas outras plataformas só há uma chave.
const keysOf = (p) => (process.platform === 'win32' ? [p, p.replace(/\\/g, '/')] : [p]);

test('trust: pasta nova ganha hasTrustDialogAccepted; o resto do arquivo, as permissões e as outras pastas ficam intactos; nenhum temporário sobra', () => {
  const other = folder(), dir = folder();
  const f = stateFile({ numStartups: 7, theme: 'dark', projects: { [other]: { hasTrustDialogAccepted: true, allowedTools: ['Bash(ls)'], lastCost: 1.5 } } }, 0o600);
  const r = trustClaudeFolder(dir, { file: f });
  assert.deepEqual(r, { ok: true, changed: true });
  const j = read(f);
  assert.equal(j.numStartups, 7); assert.equal(j.theme, 'dark'); assert.deepEqual(j.projects[other], { hasTrustDialogAccepted: true, allowedTools: ['Bash(ls)'], lastCost: 1.5 });
  assert.equal(j.projects[dir].hasTrustDialogAccepted, true); assert.deepEqual(j.projects[dir].allowedTools, []); assert.deepEqual(j.projects[dir].mcpServers, {});
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600); // o Windows não tem modo POSIX (reporta 0o666)
  assert.deepEqual(fs.readdirSync(tmp).filter((x) => x.includes('.forge-')), []);
});

test('trust: pasta já confiável não reescreve o arquivo; entrada existente só vira confiável (mantém allowedTools e demais campos)', () => {
  const dir = folder();
  const f = stateFile({ projects: Object.fromEntries(keysOf(dir).map((k) => [k, { hasTrustDialogAccepted: true }])) });
  const before = fs.readFileSync(f, 'utf8'); fs.utimesSync(f, new Date(1e12), new Date(1e12));
  assert.deepEqual(trustClaudeFolder(dir, { file: f }), { ok: true, changed: false });
  assert.equal(fs.readFileSync(f, 'utf8'), before); assert.equal(fs.statSync(f).mtimeMs, 1e12, 'nem tocou no arquivo');
  const g = stateFile({ projects: { [dir]: { hasTrustDialogAccepted: false, allowedTools: ['Edit'], hasClaudeMdExternalIncludesApproved: true } } });
  assert.equal(trustClaudeFolder(dir, { file: g }).changed, true);
  assert.deepEqual([read(g).projects[dir].hasTrustDialogAccepted, read(g).projects[dir].allowedTools, read(g).projects[dir].hasClaudeMdExternalIncludesApproved], [true, ['Edit'], true]);
});

test('trust: arquivo ausente, ilegível, link, sem objeto ou com entrada estranha => não mexe em nada e não lança', () => {
  const dir = folder();
  const none = stateFile(undefined); assert.equal(trustClaudeFolder(dir, { file: none }).ok, false); assert.ok(!fs.existsSync(none), 'não cria o arquivo');
  const bad = stateFile('{ isto não é json'); assert.equal(trustClaudeFolder(dir, { file: bad }).ok, false); assert.equal(fs.readFileSync(bad, 'utf8'), '{ isto não é json');
  for (const c of ['[]', '"texto"', 'null', '{"projects":[]}', '{"projects":"x"}', JSON.stringify({ projects: { [dir]: null } }), JSON.stringify({ projects: { [dir]: [1] } })]) {
    const f = stateFile(c); const b = fs.readFileSync(f, 'utf8'); assert.equal(trustClaudeFolder(dir, { file: f }).ok, false, c); assert.equal(fs.readFileSync(f, 'utf8'), b, c);
  }
  const real = stateFile({ projects: {} }), link = path.join(tmp, `link-${++n}.json`); fs.symlinkSync(real, link);
  assert.equal(trustClaudeFolder(dir, { file: link }).ok, false); assert.deepEqual(read(real), { projects: {} }, 'link simbólico não é seguido');
  const nop = stateFile({ numStartups: 1 }); assert.equal(trustClaudeFolder(dir, { file: nop }).changed, true); assert.equal(read(nop).projects[dir].hasTrustDialogAccepted, true, 'sem o campo projects, ele é criado');
});

test('trust: pasta alcançada por link simbólico é registrada pelo caminho real E pelo dado', () => {
  const real = folder(), link = path.join(tmp, `ln-${++n}`); fs.symlinkSync(real, link);
  const f = stateFile({ projects: {} });
  assert.equal(trustClaudeFolder(link, { file: f }).changed, true);
  assert.deepEqual(Object.keys(read(f).projects).sort(), [real, path.resolve(link)].flatMap(keysOf).sort());
});

test('claudeStateFile: pasta da conta > CLAUDE_CONFIG_DIR do ambiente > pasta pessoal do usuário', () => {
  assert.equal(claudeStateFile({ configDir: '/c/conta', home: '/h', env: { CLAUDE_CONFIG_DIR: '/e' } }), path.join('/c/conta', '.claude.json'));
  assert.equal(claudeStateFile({ home: '/h', env: { CLAUDE_CONFIG_DIR: '/e' } }), path.join('/e', '.claude.json'));
  assert.equal(claudeStateFile({ home: '/h', env: {} }), path.join('/h', '.claude.json'));
});

test('codex.paneArgs: trustDir vira confiança só deste processo (-c projects.<pasta>.trust_level); pasta estranha fica sem o argumento', () => {
  const trust = (o) => codexProvider.paneArgs({ prompt: 'x', ...o }).filter((a, i, l) => l[i - 1] === '-c' && a.startsWith('projects.'));
  assert.deepEqual(trust({ trustDir: '/home/u/meu projeto' }), ["projects.'/home/u/meu projeto'.trust_level='trusted'"]);
  assert.deepEqual(trust({}), []); assert.deepEqual(trust({ trustDir: null }), []);
  assert.deepEqual(trust({ trustDir: "/home/u/it's" }), [], 'aspa simples encerraria a chave literal'); assert.deepEqual(trust({ trustDir: '/x\n/y' }), []);
  assert.deepEqual(trust({ trustDir: 'C:\\Users\\u\\proj', quote: false }), ["projects.'C:\\Users\\u\\proj'.trust_level='trusted'"]);
  assert.deepEqual(trust({ trustDir: 'C:\\a&b', quote: false }), [], 'wrapper .cmd: metacaractere do cmd.exe fica de fora');
});

function world(over = {}) {
  const spawned = [], trusted = []; let pid = 1_930_000_000, n2 = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n2).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }),
    inspectConfig: async () => [], sweepMs: 0, usage: null, persist: () => {}, accounts: { defaultId: () => 'acc1', usable: () => true, configDirOf: (id) => (id === 'acc1' ? '/contas/acc1' : undefined) },
    trustFolders: (info) => trusted.push(info), ...over });
  return { spawned, mgr, trusted, ws };
}

test('terminais: com trustFolders o Claude tem a pasta confiada ANTES do spawn (na pasta da conta) e o Codex recebe a confiança por argumento', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder' }); assert.equal(a.status, 201, a.error);
  assert.deepEqual(w.trusted[0], { provider: 'claude', cwd: w.ws, configDir: '/contas/acc1' });
  assert.ok(!w.spawned[0].args.some((x) => x.startsWith('projects.')), 'o Claude não recebe argumento de confiança');
  const b = await w.mgr.create({ role: 'builder', provider: 'codex' }); assert.equal(b.status, 201, b.error);
  assert.deepEqual(w.trusted[1], { provider: 'codex', cwd: w.ws, configDir: null });
  assert.ok(w.spawned[1].args.includes(`projects.'${w.ws}'.trust_level='trusted'`), w.spawned[1].args.join(' '));
});

test('terminais: sem trustFolders nada muda (testes e ORCH_NO_TRUST); trustFolders que lança nunca impede o terminal de abrir', async () => {
  const off = world({ trustFolders: null });
  const a = await off.mgr.create({ role: 'builder', provider: 'codex' }); assert.equal(a.status, 201); assert.ok(!off.spawned[0].args.some((x) => x.startsWith('projects.')));
  const boom = world({ trustFolders: () => { throw new Error('disco cheio'); } });
  const b = await boom.mgr.create({ role: 'builder' }); assert.equal(b.status, 201, b.error); assert.equal(boom.spawned.length, 1);
});
