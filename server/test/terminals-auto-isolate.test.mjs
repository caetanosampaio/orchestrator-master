// Isolamento AUTOMÁTICO (`isolate: 'auto'`): quem decide é o servidor. Só panes que editam (papel builder, de qualquer provedor) entram na conta; o 1º editor sozinho roda na pasta normal,
// do 2º em diante (ou com equipe anunciada em `expectEditors`) cada um ganha um worktree próprio; sem Git o pane abre na pasta normal COM aviso. PTY e worktrees SIMULADOS, banco em memória.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-autoiso-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const T = await import('../terminals.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function world({ wtFail = null, inspect = async () => [] } = {}) {
  const spawned = [], created = [], released = []; let pid = 1_920_000_000, n = 0, w = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(tmp, `ws${Math.random().toString(16).slice(2)}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const worktrees = {
    create: async ({ mission }) => {
      await new Promise((r) => setImmediate(r)); // cede a vez: criações simultâneas se sobrepõem de verdade
      if (wtFail) return { ok: false, status: 409, error: wtFail };
      const id = `wt_${++w}`, dir = path.join(tmp, id); fs.mkdirSync(dir, { recursive: true });
      const record = { id, path: dir, branch: `orch/${id}`, workspaceId: 'ws1', state: 'active' }; db.worktrees.push(record); created.push(mission.id); return { ok: true, record };
    },
    markInUse() {}, release: (id) => released.push(id),
  };
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: () => ({ file: '/fake/claude', args: [], viaShell: false }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }),
    inspectConfig: inspect, sweepMs: 0, usage: { read: () => null, has: () => true, forget() {} }, persist: () => {}, worktrees });
  return { spawned, db, mgr, created, released, ws };
}

test('auto: o 1º editor sozinho abre na pasta normal; o 2º (qualquer provedor) ganha worktree próprio, com branch visível; cada worktree tem a sua chave de squad', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', isolate: 'auto' });
  assert.equal(a.status, 201); assert.equal(a.session.worktreeId, null); assert.equal(a.session.cwd, w.ws); assert.equal(a.session.branch, null); assert.equal(w.created.length, 0);
  const b = await w.mgr.create({ role: 'builder', provider: 'codex', isolate: 'auto' });
  assert.equal(b.status, 201, b.error); assert.ok(b.session.worktreeId); assert.notEqual(b.session.cwd, w.ws); assert.match(b.session.branch, /^orch\/wt_/); assert.equal(b.session.provider, 'codex');
  const c = await w.mgr.create({ role: 'builder', isolate: 'auto' });
  assert.notEqual(c.session.worktreeId, b.session.worktreeId, 'um worktree por agente, não um compartilhado'); assert.notEqual(c.session.squadId, b.session.squadId);
  assert.equal(w.created.length, 2);
  assert.equal(w.db.terminalSessions[1].worktreeId, b.session.worktreeId);
});

test('auto: só quem edita conta e só quem edita é isolado — maestro, revisor e batedor nunca ganham worktree, nem entram na contagem', async () => {
  const w = world();
  for (const role of ['maestro', 'reviewer', 'scout']) { const r = await w.mgr.create({ role, isolate: 'auto' }); assert.equal(r.session.worktreeId, null, role); }
  const first = await w.mgr.create({ role: 'builder', isolate: 'auto' });
  assert.equal(first.session.worktreeId, null, 'os não-editores não contam: este ainda é o 1º editor'); assert.equal(w.created.length, 0);
  const more = await w.mgr.create({ role: 'scout', isolate: 'auto' }); assert.equal(more.session.worktreeId, null);
});

test('auto: equipe anunciada (expectEditors) isola já o 1º editor; expectEditors 1 ou lixo não muda nada', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', isolate: 'auto', expectEditors: 3 }); assert.ok(a.session.worktreeId);
  const w2 = world();
  for (const x of [1, 0, -4, 'abc', null, undefined]) { const r = await w2.mgr.create({ role: 'builder', isolate: 'auto', expectEditors: x, workspaceId: 'ws1' }); w2.spawned.at(-1).exit(0); assert.equal(r.session.worktreeId, null, String(x)); }
});

test('auto: criações SIMULTÂNEAS se contam — de dois builders abertos juntos, exatamente um fica isolado', async () => {
  const w = world();
  const [a, b] = await Promise.all([w.mgr.create({ role: 'builder', isolate: 'auto' }), w.mgr.create({ role: 'builder', provider: 'codex', isolate: 'auto' })]);
  assert.equal([a, b].filter((r) => r.session.worktreeId).length, 1); assert.equal(w.created.length, 1);
});

test('auto: quando os editores saem, o próximo volta a ser o 1º (pasta normal); criação que falha não deixa reserva presa', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', isolate: 'auto' }); w.spawned[0].exit(0);
  const b = await w.mgr.create({ role: 'builder', isolate: 'auto' }); assert.equal(b.session.worktreeId, null, 'o 1º saiu: ninguém mais edita');
  w.spawned[1].exit(0);
  assert.equal((await w.mgr.create({ role: 'builder', isolate: 'auto', workspaceId: 'nao-existe' })).status, 400);
  const c = await w.mgr.create({ role: 'builder', isolate: 'auto' }); assert.equal(c.session.worktreeId, null, 'a falha acima não deixou editor fantasma');
  assert.ok(a.session.id);
});

test('auto: sem Git (worktree não criado) o pane abre na pasta normal COM aviso; o isolate explícito continua recusando com 409', async () => {
  const w = world({ wtFail: 'a pasta não é um repositório Git' });
  await w.mgr.create({ role: 'builder', isolate: 'auto' });
  const b = await w.mgr.create({ role: 'builder', isolate: 'auto' });
  assert.equal(b.status, 201); assert.equal(b.session.worktreeId, null); assert.equal(b.session.cwd, w.ws); assert.match(b.warning, /Worktree próprio não criado.*repositório Git.*mesmos arquivos/);
  const hard = await w.mgr.create({ role: 'builder', isolate: true }); assert.equal(hard.status, 409); assert.match(hard.error, /Isolamento não criado/);
});

test('auto: o fallback sem Git também confere a configuração de projeto do provedor; a confirmação libera', async () => {
  const w = world({ wtFail: 'sem git', inspect: async (dir, spec) => (spec?.dirs?.includes('.codex') ? [{ path: '.codex', why: 'não versionado' }] : []) });
  await w.mgr.create({ role: 'builder', isolate: 'auto' }); // 1º editor (Claude): nada a conferir
  const r = await w.mgr.create({ role: 'builder', provider: 'codex', isolate: 'auto' });
  assert.equal(r.status, 409); assert.equal(r.code, 'project_config_unreviewed'); assert.equal(w.spawned.length, 1);
  const ok = await w.mgr.create({ role: 'builder', provider: 'codex', isolate: 'auto', acknowledgeProjectConfig: true }); assert.equal(ok.status, 201); assert.ok(ok.warning);
});

test('auto: com squadId explícito o servidor não decide nada (vale o squad pedido); squad desconhecido continua sendo recusado', async () => {
  const w = world();
  await w.mgr.create({ role: 'builder', isolate: 'auto' });
  const r = await w.mgr.create({ role: 'builder', isolate: 'auto', squadId: 'sq_inexistente' });
  assert.equal(r.status, 409); assert.equal(r.code, 'squad_not_found'); assert.equal(w.created.length, 0);
});

test('prompts dos papéis orientam sobre branches sem caracteres especiais de shell (wrapper .cmd)', () => {
  for (const [k, r] of Object.entries(T.ROLES)) assert.ok(!/[&|<>^%"]/.test(r.prompt), `${k} tem metacaractere de shell`);
  assert.match(T.ROLES.maestro.prompt, /branch/); assert.match(T.ROLES.builder.prompt, /branch propria/); assert.match(T.ROLES.reviewer.prompt, /branch ou um caminho de worktree/);
  assert.equal(T.ROLES.builder.edits, true); assert.ok(['maestro', 'reviewer', 'scout'].every((k) => T.ROLES[k].edits !== true));
});

test('rotas: provider, isolate "auto" e expectEditors chegam ao gerenciador; GET lista providers; aviso e erros saem em JSON', async () => {
  const w = world({ wtFail: 'sem git' }), app = express(); app.use(express.json({ limit: '100kb' })); T.setupTerminals(app, { manager: w.mgr });
  const srv = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); }), base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (p, b) => { const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
  try {
    const list = await (await fetch(`${base}/api/terminals`)).json();
    assert.deepEqual(list.providers.map((p) => [p.id, p.available]), [['claude', true], ['codex', true]]);
    let r = await post('/api/terminals', { role: 'builder', provider: 'codex' }); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.session.provider, 'codex'); assert.equal(w.spawned[0].file, '/fake/codex');
    r = await post('/api/terminals', { role: 'builder', provider: 'gemini' }); assert.deepEqual([r.status, r.body.code], [400, 'provider_invalid']);
    r = await post('/api/terminals', { role: 'builder', provider: { $ne: 1 } }); assert.equal(r.status, 400);
    r = await post('/api/terminals', { role: 'builder', isolate: 'auto', expectEditors: 2 }); assert.equal(r.status, 201); assert.match(r.body.warning, /Worktree próprio não criado/);
    r = await post('/api/terminals', { role: 'builder', isolate: 'qualquer' }); assert.equal(r.status, 201); assert.equal(r.body.warning, undefined, 'isolate só aceita true ou "auto"');
  } finally { srv.close(); }
});
