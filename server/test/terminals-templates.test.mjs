// Abrir terminal de um time (POST /api/terminals com templateId + slotIndex): o servidor confere o time e a vaga, soma as skills da vaga às do papel, acrescenta a instrução
// do time ao prompt, grava o vínculo no histórico e recalcula tudo na retomada. PTY simulado, nenhuma CLI real, banco e pastas TEMPORÁRIOS.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-termtpl-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { default: express } = await import('express');
const T = await import('../terminals.js');
const L = await import('../loadouts.js');
const { findTeam } = await import('../team-templates.js');
const { presetById } = await import('../team-presets.js');
const { apiGuard } = await import('../origin-guard.js');

const SAVED = { id: 'tpl_abcdef01', name: 'Meu time', instruction: 'Sempre rode os testes antes de relatar.', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'claude', skills: ['backend-api', 'relato-de-conclusao'] }, { role: 'builder', provider: 'codex' }], createdAt: null, updatedAt: null };
let pid = 1_950_000_000, n = 0;
function world({ findTemplate = 'real', viaShell = false, pluginDirFor = null, settings = {} } = {}) {
  const spawned = [];
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData() {}, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = path.join(root, `ws${++n}`); fs.mkdirSync(ws, { recursive: true });
  const db = { settings: { activeWorkspaceId: 'ws1', ...settings }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [], teamTemplates: [JSON.parse(JSON.stringify(SAVED))] };
  const real = L.createLoadouts({ db, dir: path.join(root, `plugins${n}`) });
  const loadouts = pluginDirFor ? { ...real, pluginDirFor } : real;
  const mgr = T.createTerminalManager({ db, ptyLib: lib, loadouts, resolveCommand: () => ({ file: viaShell ? 'cmd.exe' : '/fake/claude', args: [], viaShell }), resolveCommands: { codex: () => ({ file: '/fake/codex', args: [], viaShell: false }) },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp: null, track: () => ({ release() {} }), inspectConfig: async () => [], sweepMs: 0,
    usage: { read: () => null, has: () => true, forget() {} }, persist: () => {}, ...(findTemplate === 'real' ? { findTemplate: (id) => findTeam(db, id) } : findTemplate ? { findTemplate } : {}) });
  return { spawned, db, mgr, ws };
}
const argOf = (args, flag) => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
const skillDirs = (args) => { const d = argOf(args, '--plugin-dir'); return d ? fs.readdirSync(path.join(d, 'skills')).sort() : null; };

test('preset: a vaga do Construtor abre com as skills do papel + as da vaga, a instrução do time no prompt e o vínculo no histórico e na sessão', async () => {
  const w = world(), web = presetById('preset:web');
  const r = await w.mgr.create({ role: 'builder', templateId: 'preset:web', slotIndex: 1 });
  assert.equal(r.ok, true, r.error);
  const want = [...L.ROLE_DEFAULTS.builder, 'frontend-design', 'qualidade-e-testes'];
  assert.deepEqual(r.session.skills, want); assert.equal(r.session.templateId, 'preset:web'); assert.equal(r.session.slotIndex, 1);
  assert.deepEqual(skillDirs(w.spawned[0].args), [...want].sort());
  assert.ok(fs.existsSync(path.join(argOf(w.spawned[0].args, '--plugin-dir'), 'skills', 'frontend-design', 'LICENSE.txt')), 'a vendorizada vai com a licença');
  const prompt = argOf(w.spawned[0].args, '--append-system-prompt');
  assert.ok(prompt.startsWith(T.ROLES.builder.prompt)); assert.ok(prompt.endsWith(` Instrucao do time escolhido pelo usuario: ${web.instruction}`));
  assert.doesNotMatch(prompt, /[&|<>^%"`]/);
  const rec = w.db.terminalSessions[0]; assert.equal(rec.templateId, 'preset:web'); assert.equal(rec.slotIndex, 1);
  assert.deepEqual(w.mgr.get(r.session.id).skills, want); assert.deepEqual(w.mgr.peek(r.session.id).skills, want);
});

test('sem time: tudo como antes (skills só do papel, prompt do papel, templateId e slotIndex nulos, registro sem os campos)', async () => {
  const w = world(); const r = await w.mgr.create({ role: 'reviewer' });
  assert.equal(r.ok, true, r.error); assert.deepEqual(r.session.skills, [...L.ROLE_DEFAULTS.reviewer]); assert.equal(r.session.templateId, null); assert.equal(r.session.slotIndex, null);
  assert.equal(argOf(w.spawned[0].args, '--append-system-prompt'), T.ROLES.reviewer.prompt);
  assert.equal(Object.hasOwn(w.db.terminalSessions[0], 'templateId'), false);
});

test('time salvo: skills da vaga e instrução do time; o Maestro recebe orquestrar-briefing e a instrução também', async () => {
  const w = world();
  const b = await w.mgr.create({ role: 'builder', templateId: SAVED.id, slotIndex: 1 }); assert.equal(b.ok, true, b.error);
  assert.deepEqual(b.session.skills, [...L.ROLE_DEFAULTS.builder, 'backend-api'], 'relato-de-conclusao já vinha do papel: não repete');
  const m = await w.mgr.create({ role: 'maestro', templateId: SAVED.id, slotIndex: 0 }); assert.equal(m.ok, true, m.error);
  assert.ok(m.session.skills.includes('orquestrar-briefing'));
  assert.match(argOf(w.spawned[1].args, '--append-system-prompt'), /Instrucao do time escolhido pelo usuario: Sempre rode os testes antes de relatar\.$/);
});

test('vaga Codex: nenhuma skill (sem plugin), mas a instrução do time vai nas instruções do Codex', async () => {
  const w = world(); const r = await w.mgr.create({ role: 'builder', provider: 'codex', templateId: SAVED.id, slotIndex: 2 });
  assert.equal(r.ok, true, r.error); assert.deepEqual(r.session.skills, []); assert.equal(argOf(w.spawned[0].args, '--plugin-dir'), null);
  assert.ok(w.spawned[0].args.some((a) => a.startsWith('developer_instructions=') && a.includes('Instrucao do time escolhido pelo usuario: Sempre rode os testes')));
  const cb = await w.mgr.create({ role: 'builder', provider: 'codex', templateId: 'preset:code-build', slotIndex: 1 }); assert.equal(cb.ok, true, cb.error); assert.deepEqual(cb.session.skills, []);
});

test('nada confia no cliente: só um dos campos, tipos errados, time inexistente, vaga fora da lista, papel ou agente diferente => 400 com o código e NENHUM processo', async () => {
  const w = world();
  const cases = [
    [{ role: 'builder', templateId: 'preset:web' }, 'template_invalid'],
    [{ role: 'builder', slotIndex: 1 }, 'template_invalid'],
    [{ role: 'builder', templateId: 7, slotIndex: 1 }, 'template_invalid'],
    [{ role: 'builder', templateId: 'preset:web', slotIndex: '1' }, 'template_invalid'],
    [{ role: 'builder', templateId: 'preset:web', slotIndex: -1 }, 'template_invalid'],
    [{ role: 'builder', templateId: 'preset:web', slotIndex: 1.5 }, 'template_invalid'],
    [{ role: 'builder', templateId: 'preset:web', slotIndex: 99 }, 'template_invalid'],
    [{ role: 'builder', templateId: 'preset:nao-existe', slotIndex: 0 }, 'template_not_found'],
    [{ role: 'builder', templateId: 'tpl_00000000', slotIndex: 0 }, 'template_not_found'],
    [{ role: 'builder', templateId: '__proto__', slotIndex: 0 }, 'template_not_found'],
    [{ role: 'builder', templateId: '../../x', slotIndex: 0 }, 'template_not_found'],
    [{ role: 'reviewer', templateId: 'preset:web', slotIndex: 1 }, 'template_mismatch'],
    [{ templateId: 'preset:web', slotIndex: 0 }, 'template_mismatch'], // papel padrão (builder) contra a vaga do maestro
    [{ role: 'builder', templateId: 'preset:code-build', slotIndex: 1 }, 'template_mismatch'], // vaga Codex aberta no Claude
    [{ role: 'builder', provider: 'codex', templateId: 'preset:web', slotIndex: 1 }, 'template_mismatch'],
  ];
  for (const [opts, code] of cases) { const r = await w.mgr.create(opts); assert.equal(r.ok, false, JSON.stringify(opts)); assert.equal(r.status, 400, JSON.stringify(opts)); assert.equal(r.code, code, JSON.stringify(opts)); }
  assert.equal(w.spawned.length, 0); assert.equal((w.db.terminalSessions ?? []).length, 0);
  const off = world({ findTemplate: null }); const r = await off.mgr.create({ role: 'builder', templateId: 'preset:web', slotIndex: 1 });
  assert.equal(r.code, 'template_not_found', 'sem o resolvedor de times nenhum templateId é aceito');
  const boom = world({ findTemplate: () => { throw new Error('x'); } }); assert.equal((await boom.mgr.create({ role: 'builder', templateId: 'preset:web', slotIndex: 1 })).code, 'template_not_found');
});

test('teto de 12 skills: as do papel primeiro, as da vaga até completar', async () => {
  const many = Object.keys(L.SKILLS).filter((id) => id !== 'orquestrar-briefing').slice(0, 9);
  const w = world({ settings: { loadouts: { builder: { skills: many } } } });
  w.db.teamTemplates[0].slots[1].skills = ['backend-api', 'frontend-design', 'seguranca-pratica', 'qualidade-e-testes', 'depuracao-metodica', 'conteudo-e-copy', 'pesquisa-web-segura'];
  const r = await w.mgr.create({ role: 'builder', templateId: SAVED.id, slotIndex: 1 }); assert.equal(r.ok, true, r.error);
  assert.equal(r.session.skills.length, L.MAX_SKILLS_PER_ROLE); assert.deepEqual(r.session.skills.slice(0, many.length), many);
});

test('plugin omitido (wrapper .cmd com caminho perigoso ou falha ao gravar): o pane abre e as skills efetivas são []', async () => {
  const w = world({ viaShell: true, pluginDirFor: () => 'C:/a&b/plugins/builder-x' });
  const r = await w.mgr.create({ role: 'builder', templateId: 'preset:web', slotIndex: 1 }); assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.session.skills, []); assert.equal(r.session.templateId, 'preset:web');
  const f = world({ pluginDirFor: () => { throw new Error('disco cheio'); } });
  const r2 = await f.mgr.create({ role: 'builder', templateId: 'preset:web', slotIndex: 1 }); assert.equal(r2.ok, true); assert.deepEqual(r2.session.skills, []);
});

test('instrução do time editada à mão no banco com caracteres perigosos chega limpa ao prompt', async () => {
  const w = world(); w.db.teamTemplates[0].instruction = 'Use "aspas" & pipes | e <tags> ^ 50% `crase`\nnova linha';
  const r = await w.mgr.create({ role: 'builder', templateId: SAVED.id, slotIndex: 1 }); assert.equal(r.ok, true, r.error);
  const p = argOf(w.spawned[0].args, '--append-system-prompt'); assert.doesNotMatch(p, /[&|<>^%"`\n]/); assert.match(p, /Instrucao do time escolhido pelo usuario: Use aspas pipes e tags 50 crase nova linha$/);
});

test('retomada: skills e instrução recalculadas a partir do time ATUAL; time excluído volta só com as do papel, sem erro', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', templateId: SAVED.id, slotIndex: 1 }); assert.equal(a.ok, true, a.error); w.spawned[0].exit(0);
  const rec = w.db.terminalSessions[0];
  w.db.teamTemplates[0].slots[1].skills = ['seguranca-pratica']; // o usuário mudou o time depois
  const again = await w.mgr.resume({ recordId: rec.id }); assert.equal(again.ok, true, again.error);
  assert.deepEqual(again.session.skills, [...L.ROLE_DEFAULTS.builder, 'seguranca-pratica']); assert.equal(again.session.templateId, SAVED.id); assert.equal(again.session.slotIndex, 1);
  assert.deepEqual(skillDirs(w.spawned[1].args), [...L.ROLE_DEFAULTS.builder, 'seguranca-pratica'].sort());
  w.spawned[1].exit(0);
  w.db.teamTemplates = []; // time excluído
  const fork = await w.mgr.resume({ recordId: rec.id, fork: true }); assert.equal(fork.ok, true, fork.error);
  assert.deepEqual(fork.session.skills, [...L.ROLE_DEFAULTS.builder]);
  const forkRec = w.db.terminalSessions.find((x) => x.id === fork.session.recordId); assert.equal(forkRec.templateId, SAVED.id, 'o fork mantém o vínculo (informativo)');
  w.spawned[2].exit(0);
  // vaga que mudou de papel: não aplica as skills de outra vaga
  w.db.teamTemplates = [{ ...JSON.parse(JSON.stringify(SAVED)), slots: [{ role: 'maestro', provider: 'claude' }, { role: 'reviewer', provider: 'claude', skills: ['backend-api'] }] }];
  const mism = await w.mgr.resume({ recordId: rec.id }); assert.equal(mism.ok, true, mism.error); assert.deepEqual(mism.session.skills, [...L.ROLE_DEFAULTS.builder]);
});

test('reabrir (sessão interrompida que não se retoma): a instrução do time vai de novo no prompt do terminal novo', async () => {
  const w = world();
  const a = await w.mgr.create({ role: 'builder', templateId: SAVED.id, slotIndex: 1 }); assert.equal(a.ok, true);
  const rec = w.db.terminalSessions[0]; Object.assign(rec, { state: 'interrupted', interruptedAt: new Date().toISOString(), endedAt: new Date().toISOString(), closedReason: 'crash' });
  w.spawned[0].exit(0); rec.state = 'interrupted';
  const r = await w.mgr.resume({ recordId: rec.id, reopen: true }); assert.equal(r.ok, true, r.error);
  assert.match(argOf(w.spawned.at(-1).args, '--append-system-prompt'), /Instrucao do time escolhido pelo usuario: Sempre rode os testes/);
  assert.deepEqual(r.session.skills, [...L.ROLE_DEFAULTS.builder, 'backend-api']);
});

test('HTTP: POST /api/terminals repassa templateId e slotIndex; erro sai com o código', async () => {
  const w = world(); const app = express(); app.use('/api', apiGuard); app.use(express.json()); T.setupTerminals(app, { manager: w.mgr });
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = async (body) => { const r = await fetch(`${base}/api/terminals`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
  try {
    const ok = await post({ role: 'builder', templateId: 'preset:backend', slotIndex: 1 }); assert.equal(ok.status, 201, JSON.stringify(ok.j));
    assert.deepEqual(ok.j.session.skills, [...L.ROLE_DEFAULTS.builder, 'backend-api', 'seguranca-pratica', 'qualidade-e-testes']); assert.equal(ok.j.session.templateId, 'preset:backend');
    const bad = await post({ role: 'builder', templateId: 'preset:backend' }); assert.equal(bad.status, 400); assert.equal(bad.j.code, 'template_invalid');
    const nf = await post({ role: 'builder', templateId: 'tpl_ffffffff', slotIndex: 0 }); assert.equal(nf.status, 400); assert.equal(nf.j.code, 'template_not_found');
    const mm = await post({ role: 'scout', templateId: 'preset:backend', slotIndex: 1 }); assert.equal(mm.status, 400); assert.equal(mm.j.code, 'template_mismatch');
    const list = await (await fetch(`${base}/api/terminals`)).json(); assert.ok(list.sessions.every((s) => Array.isArray(s.skills) && 'templateId' in s && 'slotIndex' in s));
  } finally { srv.close(); srv.closeAllConnections?.(); }
});
