// Squads salvos (server/team-templates.js): validação estrita, CRUD, nomes únicos, limites, rollback ao falhar a gravação e leitura tolerante. Express próprio, banco TEMPORÁRIO.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-tpl-'));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
assert.ok(fs.realpathSync.native(path.dirname(process.env.ORCH_DATA_DIR)).startsWith(fs.realpathSync.native(os.tmpdir())));

const { default: express } = await import('express');
const store = await import('../store.js');
const T = await import('../team-templates.js');
const { apiGuard } = await import('../origin-guard.js');

let db, server, base;
const call = (url, method = 'GET', body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
const jr = async (r) => ({ status: r.status, j: await r.json() });
const slots = (...pairs) => pairs.map(([role, provider]) => ({ role, provider }));
const SQUAD = slots(['maestro', 'claude'], ['builder', 'codex'], ['builder', 'codex'], ['reviewer', 'claude']);

before(async () => {
  db = store.load();
  const app = express();
  app.use('/api', apiGuard); app.use(express.json());
  T.setupTeamTemplates(app, { db });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });

test('começa vazio e informa os limites', async () => {
  const r = await jr(await call('/api/team-templates'));
  assert.equal(r.status, 200); assert.deepEqual(r.j.templates, []); assert.deepEqual(r.j.limits, { maxTemplates: T.MAX_TEMPLATES, maxSlots: T.MAX_SLOTS, maxName: T.MAX_NAME });
});

test('criar: grava, devolve id tpl_xxxxxxxx e persiste no disco', async () => {
  const r = await jr(await call('/api/team-templates', 'POST', { name: '  Claude lidera, Codex constrói  ', slots: SQUAD }));
  assert.equal(r.status, 201); const t = r.j.template;
  assert.match(t.id, /^tpl_[0-9a-f]{8}$/); assert.equal(t.name, 'Claude lidera, Codex constrói'); assert.deepEqual(t.slots, SQUAD);
  assert.ok(t.createdAt && t.updatedAt);
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.ORCH_DATA_DIR, 'db.json'), 'utf8'));
  assert.equal(disk.teamTemplates.length, 1); assert.equal(disk.teamTemplates[0].id, t.id);
  assert.equal((await jr(await call('/api/team-templates'))).j.templates.length, 1);
});

test('validação estrita: papel/provedor fora da lista, vagas demais ou de menos, nome vazio/longo, propriedade desconhecida e corpo inválido', async () => {
  const bad = async (body, re) => { const r = await jr(await call('/api/team-templates', 'POST', body)); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.j.error, re); };
  await bad({ name: 'x', slots: slots(['hacker', 'claude']) }, /slots/);
  await bad({ name: 'x', slots: slots(['builder', 'gemini']) }, /slots/);
  await bad({ name: 'x', slots: slots(['__proto__', 'claude']) }, /slots/);
  await bad({ name: 'x', slots: [] }, /slots/);
  await bad({ name: 'x', slots: Array.from({ length: T.MAX_SLOTS + 1 }, () => ({ role: 'builder', provider: 'claude' })) }, /slots/);
  await bad({ name: 'x', slots: [{ role: 'builder' }] }, /slots/);
  await bad({ name: 'x', slots: [{ role: 'builder', provider: 'claude', extra: 1 }].map(({ extra, ...s }) => s), nope: 1 }, /não permitidas/);
  await bad({ name: '   ', slots: SQUAD }, /name/);
  await bad({ name: 'a'.repeat(T.MAX_NAME + 1), slots: SQUAD }, /name/);
  await bad({ name: 42, slots: SQUAD }, /name/);
  await bad({ slots: SQUAD }, /name/);
  await bad([], /objeto/);
  assert.equal((await jr(await call('/api/team-templates'))).j.templates.length, 1, 'nada inválido foi gravado');
});

test('nome único (sem diferenciar maiúsculas), limpeza de caracteres de controle e nome com acento', async () => {
  const dup = await jr(await call('/api/team-templates', 'POST', { name: 'CLAUDE LIDERA, CODEX CONSTRÓI', slots: SQUAD }));
  assert.equal(dup.status, 409); assert.match(dup.j.error, /Já existe/);
  const ok = await jr(await call('/api/team-templates', 'POST', { name: 'Dupla\u0000 ‮mista', slots: slots(['builder', 'codex'], ['reviewer', 'claude']) }));
  assert.equal(ok.status, 201); assert.equal(ok.j.template.name, 'Dupla mista', 'controles e direção de texto removidos, espaços colapsados');
});

test('editar (PUT parcial): renomear, trocar vagas, mesmo nome do próprio squad, nome de outro, id inexistente', async () => {
  const [a, b] = (await jr(await call('/api/team-templates'))).j.templates;
  const ren = await jr(await call(`/api/team-templates/${a.id}`, 'PUT', { name: 'Meu squad' }));
  assert.equal(ren.status, 200); assert.equal(ren.j.template.name, 'Meu squad'); assert.deepEqual(ren.j.template.slots, a.slots, 'vagas intactas');
  const sl = await jr(await call(`/api/team-templates/${a.id}`, 'PUT', { slots: slots(['builder', 'claude']) }));
  assert.deepEqual(sl.j.template.slots, slots(['builder', 'claude'])); assert.equal(sl.j.template.name, 'Meu squad');
  assert.equal((await jr(await call(`/api/team-templates/${a.id}`, 'PUT', { name: 'meu SQUAD' }))).status, 200, 'o próprio nome em outra caixa é permitido');
  assert.equal((await jr(await call(`/api/team-templates/${a.id}`, 'PUT', { name: b.name }))).status, 409, 'nome de outro squad');
  assert.equal((await jr(await call(`/api/team-templates/${a.id}`, 'PUT', {}))).status, 400);
  assert.equal((await jr(await call(`/api/team-templates/${a.id}`, 'PUT', { name: 'x', slots: slots(['x', 'claude']) }))).status, 400);
  assert.equal((await jr(await call('/api/team-templates/tpl_00000000', 'PUT', { name: 'x' }))).status, 404);
  assert.equal((await jr(await call('/api/team-templates/lixo', 'PUT', { name: 'x' }))).status, 404);
});

test('excluir: remove e persiste; id inexistente ou inválido dá 404', async () => {
  const [a] = (await jr(await call('/api/team-templates'))).j.templates;
  const r = await jr(await call(`/api/team-templates/${a.id}`, 'DELETE'));
  assert.equal(r.status, 200); assert.equal(r.j.removed, a.id);
  assert.equal((await jr(await call(`/api/team-templates/${a.id}`, 'DELETE'))).status, 404);
  assert.equal((await jr(await call('/api/team-templates/lixo', 'DELETE'))).status, 404);
  const disk = JSON.parse(fs.readFileSync(path.join(process.env.ORCH_DATA_DIR, 'db.json'), 'utf8'));
  assert.ok(!disk.teamTemplates.some((t) => t.id === a.id));
});

test('limite de squads e rollback quando a gravação falha (nada fica pela metade)', async () => {
  const before = (await jr(await call('/api/team-templates'))).j.templates.length;
  const orig = store.saveOrThrow;
  // falha de gravação: o estado volta ao que era
  const real = db.teamTemplates;
  const handler = Object.getOwnPropertyDescriptor(store, 'saveOrThrow');
  assert.ok(handler, 'saveOrThrow existe');
  // sem poder trocar o export do ESM: força o erro tornando o arquivo de dados um diretório
  const dbFile = path.join(process.env.ORCH_DATA_DIR, 'db.json'), tmpFile = dbFile + '.tmp';
  fs.rmSync(tmpFile, { force: true }); fs.mkdirSync(tmpFile);
  try {
    const r = await jr(await call('/api/team-templates', 'POST', { name: 'Vai falhar', slots: SQUAD }));
    assert.equal(r.status, 500); assert.match(r.j.error, /nada foi alterado/);
  } finally { fs.rmSync(tmpFile, { recursive: true, force: true }); }
  assert.equal(db.teamTemplates, real, 'a lista em memória é a mesma de antes');
  assert.equal((await jr(await call('/api/team-templates'))).j.templates.length, before);
  // limite
  for (let i = before; i < T.MAX_TEMPLATES; i++) assert.equal((await jr(await call('/api/team-templates', 'POST', { name: `Squad ${i}`, slots: SQUAD }))).status, 201);
  const over = await jr(await call('/api/team-templates', 'POST', { name: 'Demais', slots: SQUAD }));
  assert.equal(over.status, 409); assert.match(over.j.error, /Limite/);
  void orig;
});

test('leitura tolerante: entradas inválidas, duplicadas ou de papel/provedor desconhecido são ignoradas; nome muito longo é cortado', () => {
  const good = { id: 'tpl_aaaaaaaa', name: 'Bom', slots: slots(['builder', 'claude']) };
  const r = T.readTemplates({ teamTemplates: [good, good, null, 'x', { id: 'tpl_bbbbbbbb', name: 'Sem vagas', slots: [] }, { id: 'tpl_cccccccc', name: 'Papel ruim', slots: slots(['ninja', 'claude']) }, { id: 'xx', name: 'Id ruim', slots: slots(['builder', 'claude']) }, { id: 'tpl_dddddddd', name: 'n'.repeat(80), slots: slots(['builder', 'codex']) }] });
  assert.deepEqual(r.map((t) => t.id), ['tpl_aaaaaaaa', 'tpl_dddddddd']);
  assert.equal(r[1].name.length, T.MAX_NAME);
  assert.deepEqual(T.readTemplates({}), []); assert.deepEqual(T.readTemplates(null), []); assert.deepEqual(T.readTemplates({ teamTemplates: 'lixo' }), []);
});
