// B1: remover um workspace é recusado enquanto há terminal aberto ou worktree ainda não removido; missões/ciclos antigos NÃO bloqueiam mais (o ciclo antigo foi removido).
// A rota é montada com `setupWorkspaceRemoval` num Express próprio (porta aleatória, db injetado, banco TEMPORÁRIO);
// o index.js (porta 4317, banco real) nunca é importado.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-wsrm-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const DB_FILE = path.join(process.env.ORCH_DATA_DIR, 'db.json');

const { default: express } = await import('express');
const store = await import('../store.js');
const { workspaceRemovalBlocker, setupWorkspaceRemoval } = await import('../workspaces.js');

let db, server, base, liveTerminals = [];
const diskDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const del = (id) => fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE', headers: { origin: 'http://localhost:5173' } });

before(async () => {
  db = store.load();
  const app = express();
  setupWorkspaceRemoval(app, { db, terminals: { list: () => liveTerminals } });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); server.closeAllConnections?.(); await new Promise((r) => setTimeout(r, 600)); fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
function setup() { const id = `ws${++seq}`; db.workspaces.push({ id, name: `W${seq}`, path: tmp }); return id; }

test('regra pura: só terminal rodando e worktree ainda não removido do MESMO workspace bloqueiam', () => {
  const t = (over) => [{ workspaceId: 'w', status: 'running', ...over }];
  assert.match(workspaceRemovalBlocker({}, 'w', { list: () => t() }), /terminal\(is\) aberto\(s\)/);
  assert.equal(workspaceRemovalBlocker({}, 'w', { list: () => t({ status: 'exited' }) }), null, 'terminal encerrado não bloqueia');
  assert.equal(workspaceRemovalBlocker({}, 'w', { list: () => t({ workspaceId: 'outro' }) }), null, 'outro workspace não interfere');
  assert.equal(workspaceRemovalBlocker({}, 'w', { list: () => { throw new Error('boom'); } }), null, 'falha ao listar não bloqueia nem lança');
  for (const state of ['ready', 'in_use', 'integrated']) assert.match(workspaceRemovalBlocker({ worktrees: [{ workspaceId: 'w', state }] }, 'w'), /worktrees isolados/, state);
  for (const state of ['removed', 'failed']) assert.equal(workspaceRemovalBlocker({ worktrees: [{ workspaceId: 'w', state }] }, 'w'), null, state);
  assert.equal(workspaceRemovalBlocker({ worktrees: [{ workspaceId: 'outro', state: 'ready' }] }, 'w'), null);
  assert.equal(workspaceRemovalBlocker({}, 'w'), null, 'sem terminais nem worktrees');
});

test('dados antigos: missões com ciclo ativo/bloqueado ou tarefa running no banco NÃO bloqueiam a remoção (o ciclo antigo não existe mais)', () => {
  const missions = [{ workspaceId: 'w', tasks: [{ status: 'running' }], cycle: { status: 'running' } }, { workspaceId: 'w', tasks: [], cycle: { status: 'blocked' } }];
  assert.equal(workspaceRemovalBlocker({ missions }, 'w'), null);
});

test('rota: 409 com mensagem clara e NADA muda com terminal aberto; depois que ele encerra, a exclusão passa', async () => {
  const id = setup(); liveTerminals = [{ workspaceId: id, status: 'running' }];
  const r = await del(id);
  assert.equal(r.status, 409); assert.match((await r.json()).error, /terminal\(is\) aberto\(s\)/);
  assert.ok(db.workspaces.some((w) => w.id === id), 'nada foi removido');
  liveTerminals = [];
  assert.equal((await del(id)).status, 204);
});

test('rota: 409 com worktree isolado pendente e NADA muda', async () => {
  const id = setup(); db.worktrees = [{ id: 'wt_x', workspaceId: id, state: 'ready' }];
  const r = await del(id);
  assert.equal(r.status, 409); assert.match((await r.json()).error, /worktrees isolados/);
  assert.ok(db.workspaces.some((w) => w.id === id));
  db.worktrees = [];
});

test('rota: 204, remove, persiste, ajusta o workspace ativo e registra a atividade (mesmo com missão antiga do workspace no banco)', async () => {
  for (const legacy of [false, true]) {
    const keep = setup();                                            // outro workspace para virar o ativo
    const id = setup();
    if (legacy) (db.missions ??= []).push({ id: `m${id}`, title: 'antiga', workspaceId: id, tasks: [], cycle: { status: 'running' } });
    db.settings.activeWorkspaceId = id;
    const r = await del(id);
    assert.equal(r.status, 204, `legado=${legacy}`);
    assert.ok(!db.workspaces.some((w) => w.id === id), 'removido da memória');
    assert.notEqual(db.settings.activeWorkspaceId, id, 'o workspace ativo deixou de apontar para o removido');
    assert.ok(db.activity.some((a) => a.type === 'workspace' && /Workspace removido do cadastro: W\d+ \(arquivos intactos\)/.test(a.message)));
    const disk = diskDb();
    assert.ok(!disk.workspaces.some((w) => w.id === id), 'removido do disco (db TEMPORÁRIO)'); assert.ok(disk.workspaces.some((w) => w.id === keep));
  }
});

test('rota: workspace inexistente => 404; terminal aberto de OUTRO workspace não bloqueia', async () => {
  const r = await del('ws_nao_existe');
  assert.equal(r.status, 404); assert.match((await r.json()).error, /não encontrado/);
  const busy = setup(), free = setup(); liveTerminals = [{ workspaceId: busy, status: 'running' }];
  assert.equal((await del(free)).status, 204);
  assert.ok(db.workspaces.some((w) => w.id === busy), 'o workspace em uso não foi tocado');
  assert.equal((await del(busy)).status, 409); liveTerminals = [];
});
