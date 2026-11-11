// Times prontos (server/team-presets.js) e o contrato novo de /api/team-templates: instrução do time, skills por vaga (só Claude Code), presets no GET,
// validação estrita, leitura tolerante e findTeam. Express próprio, banco TEMPORÁRIO, nenhum agente real.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-presets-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');

const { default: express } = await import('express');
const store = await import('../store.js');
const T = await import('../team-templates.js');
const { TEAM_PRESETS, presetById } = await import('../team-presets.js');
const { SKILLS } = await import('../loadouts.js');
const { cleanLine } = await import('../harness.js');
const { apiGuard } = await import('../origin-guard.js');

let db, server, base;
const call = (url, method = 'GET', body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
const jr = async (r) => ({ status: r.status, j: await r.json() });
const disk = () => JSON.parse(fs.readFileSync(path.join(process.env.ORCH_DATA_DIR, 'db.json'), 'utf8'));
before(async () => {
  db = store.load();
  const app = express(); app.use('/api', apiGuard); app.use(express.json());
  T.setupTeamTemplates(app, { db });
  server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const roles = (p) => p.slots.map((s) => `${s.role}:${s.provider}:${s.model}:${s.effort}:${(s.skills ?? []).join('+')}`);

// ---------- presets ----------
test('presets: os 7 times prontos, ids preset:<slug>, congelados, e cada um passa INTACTO pela validação estrita da API', () => {
  assert.deepEqual(TEAM_PRESETS.map((p) => p.id), ['preset:web', 'preset:backend', 'preset:fullstack', 'preset:bugs', 'preset:pesquisa-conteudo', 'preset:code-build', 'preset:audit']);
  assert.ok(Object.isFrozen(TEAM_PRESETS) && TEAM_PRESETS.every((p) => Object.isFrozen(p) && Object.isFrozen(p.slots) && p.slots.every(Object.isFrozen)));
  for (const p of TEAM_PRESETS) {
    assert.deepEqual(Object.keys(p).sort(), ['about', 'id', 'instruction', 'name', 'slots', 'tagline'], p.id);
    const v = T.validateTemplateBody({ name: p.name, slots: p.slots, instruction: p.instruction });
    assert.equal(v.error, undefined, `${p.id}: ${v.error}`);
    assert.deepEqual(v.value, { name: p.name, slots: JSON.parse(JSON.stringify(p.slots)), instruction: p.instruction }, `${p.id}: nada muda na validação (já está limpo)`);
    assert.ok(p.instruction.length >= 200 && p.instruction.length <= T.MAX_INSTRUCTION, `${p.id}: instrução com ${p.instruction.length}`);
    assert.equal(cleanLine(p.instruction, 5000), p.instruction); assert.doesNotMatch(p.instruction, /[&|<>^%"`]/);
    assert.ok(p.tagline.length > 20 && p.about.length > 60 && /Use para/.test(p.about), `${p.id}: o about diz quando usar`);
    assert.equal(presetById(p.id), p);
    for (const s of p.slots) {
      if (s.provider === 'codex') assert.equal(s.skills, undefined, `${p.id}: vaga Codex sem skills`);
      for (const id of s.skills ?? []) assert.ok(Object.hasOwn(SKILLS, id), `${p.id}: ${id}`);
    }
  }
  assert.equal(presetById('preset:nao-existe'), null); assert.equal(presetById(7), null);
});

test('presets: vagas exatamente como o contrato (papel, agente, modelo, esforço e skills)', () => {
  const by = Object.fromEntries(TEAM_PRESETS.map((p) => [p.id, roles(p)]));
  assert.deepEqual(by['preset:web'], ['maestro:claude:opus:high:', 'builder:claude:sonnet:high:frontend-design+qualidade-e-testes', 'builder:claude:sonnet:high:frontend-design+qualidade-e-testes', 'reviewer:claude:opus:high:qualidade-e-testes+seguranca-pratica']);
  assert.deepEqual(by['preset:backend'], ['maestro:claude:opus:high:', 'builder:claude:sonnet:high:backend-api+seguranca-pratica+qualidade-e-testes', 'builder:claude:sonnet:high:backend-api+seguranca-pratica+qualidade-e-testes', 'reviewer:claude:opus:high:seguranca-pratica+qualidade-e-testes', 'scout:claude:sonnet:medium:backend-api']);
  assert.deepEqual(by['preset:fullstack'], ['maestro:claude:opus:high:', 'builder:claude:sonnet:high:frontend-design+qualidade-e-testes', 'builder:claude:sonnet:high:backend-api+seguranca-pratica+qualidade-e-testes', 'reviewer:claude:opus:high:seguranca-pratica+qualidade-e-testes']);
  assert.deepEqual(by['preset:bugs'], ['maestro:claude:opus:high:', 'scout:claude:opus:high:depuracao-metodica', 'builder:claude:sonnet:high:depuracao-metodica+qualidade-e-testes', 'reviewer:claude:opus:high:qualidade-e-testes+seguranca-pratica']);
  assert.deepEqual(by['preset:pesquisa-conteudo'], ['maestro:claude:opus:high:', 'scout:claude:sonnet:medium:pesquisa-web-segura', 'scout:claude:sonnet:medium:pesquisa-web-segura', 'builder:claude:sonnet:medium:conteudo-e-copy+pesquisa-web-segura']);
  // porte dos times que viviam no cliente: mesmas vagas, modelos e textos
  assert.deepEqual(by['preset:code-build'], ['maestro:claude:opus:high:', 'builder:codex:gpt-5-codex:medium:', 'builder:codex:gpt-5-codex:medium:', 'reviewer:claude:opus:high:']);
  assert.deepEqual(by['preset:audit'], ['maestro:claude:opus:high:', 'scout:codex:gpt-5:medium:', 'reviewer:claude:opus:max:seguranca-pratica+qualidade-e-testes', 'reviewer:codex:gpt-5:high:']);
  const cb = presetById('preset:code-build'), au = presetById('preset:audit');
  assert.equal(cb.name, 'Construção de código'); assert.equal(cb.tagline, 'O Claude planeja e revisa; dois Codex escrevem o código em paralelo.');
  assert.equal(au.name, 'Revisão e segurança'); assert.match(au.about, /^Use para auditar uma branch ou um pull request\./);
  assert.deepEqual(TEAM_PRESETS.slice(0, 5).map((p) => p.name), ['Web e Frontend', 'Backend e API', 'Full stack', 'Bugs e qualidade', 'Pesquisa e conteúdo']);
});

// ---------- API ----------
test('GET: devolve presets (só leitura) e os limites novos', async () => {
  const { status, j } = await jr(await call('/api/team-templates'));
  assert.equal(status, 200); assert.deepEqual(j.presets, JSON.parse(JSON.stringify(TEAM_PRESETS)));
  assert.equal(j.limits.maxInstruction, 1500); assert.equal(j.limits.maxSlotSkills, 8); assert.deepEqual(j.templates, []);
});

test('POST: instrução e skills por vaga gravam, limpas; lista vazia e instrução vazia ficam ausentes', async () => {
  const r = await jr(await call('/api/team-templates', 'POST', { name: 'Meu time', instruction: '  Foco em "API" & testes | sem <html> ^ 100%\n`crase`  ', slots: [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'claude', model: 'sonnet', skills: ['backend-api', 'qualidade-e-testes'] }, { role: 'builder', provider: 'codex', skills: [] }, { role: 'reviewer', provider: 'claude', skills: null }] }));
  assert.equal(r.status, 201, JSON.stringify(r.j));
  const t = r.j.template;
  assert.equal(t.instruction, 'Foco em API testes sem html 100 crase'); assert.doesNotMatch(t.instruction, /[&|<>^%"`\n]/);
  assert.deepEqual(t.slots, [{ role: 'maestro', provider: 'claude' }, { role: 'builder', provider: 'claude', model: 'sonnet', skills: ['backend-api', 'qualidade-e-testes'] }, { role: 'builder', provider: 'codex' }, { role: 'reviewer', provider: 'claude' }]);
  assert.deepEqual(disk().teamTemplates[0], t);
  const blank = await jr(await call('/api/team-templates', 'POST', { name: 'Sem instrução', instruction: ' \u0007 ', slots: [{ role: 'builder', provider: 'claude' }] }));
  assert.equal(blank.status, 201); assert.equal(Object.hasOwn(blank.j.template, 'instruction'), false);
  const nul = await jr(await call('/api/team-templates', 'POST', { name: 'Nulo', instruction: null, slots: [{ role: 'builder', provider: 'claude' }] }));
  assert.equal(nul.status, 201); assert.equal(Object.hasOwn(nul.j.template, 'instruction'), false);
  const exact = await jr(await call('/api/team-templates', 'POST', { name: 'Limite', instruction: 'i'.repeat(1500), slots: [{ role: 'builder', provider: 'claude' }] }));
  assert.equal(exact.status, 201); assert.equal(exact.j.template.instruction.length, 1500);
});

test('validação estrita: skills em vaga Codex, desconhecidas, repetidas, demais ou mal formadas; propriedade desconhecida na vaga; instrução longa ou não-texto => 400 e nada gravado', async () => {
  const before = disk().teamTemplates.length;
  const bad = async (body, re) => { const r = await jr(await call('/api/team-templates', 'POST', { name: `Ruim ${Math.random()}`, ...body })); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.j.error, re); };
  const one = (slot) => ({ slots: [slot] });
  await bad(one({ role: 'builder', provider: 'codex', skills: ['backend-api'] }), /O Codex CLI ainda não recebe skills: tire as skills desta vaga ou use o Claude Code\./);
  await bad(one({ role: 'builder', provider: 'claude', skills: ['nao-existe'] }), /skills/);
  await bad(one({ role: 'builder', provider: 'claude', skills: ['backend-api', 'backend-api'] }), /sem repetir/);
  await bad(one({ role: 'builder', provider: 'claude', skills: Object.keys(SKILLS).slice(0, 9) }), /até 8/);
  await bad(one({ role: 'builder', provider: 'claude', skills: 'backend-api' }), /skills/);
  await bad(one({ role: 'builder', provider: 'claude', skills: [{ id: 'x' }] }), /skills/);
  await bad(one({ role: 'builder', provider: 'claude', skills: ['__proto__'] }), /skills/);
  await bad(one({ role: 'builder', provider: 'claude', skills: ['../../etc/passwd'] }), /skills/);
  await bad(one({ role: 'builder', provider: 'claude', extra: 1 }), /slots\[0\]: propriedades não permitidas: extra/);
  await bad(one({ role: 'builder', provider: 'claude', id: 'x' }), /não permitidas/);
  await bad({ ...one({ role: 'builder', provider: 'claude' }), instruction: 'x'.repeat(1501) }, /instruction deve ter até 1500/);
  await bad({ ...one({ role: 'builder', provider: 'claude' }), instruction: 5 }, /instruction deve ser um texto/);
  await bad({ ...one({ role: 'builder', provider: 'claude' }), instruction: ['a'] }, /instruction/);
  await bad({ ...one({ role: 'builder', provider: 'claude' }), presets: [] }, /Propriedades não permitidas: presets/);
  assert.equal(disk().teamTemplates.length, before);
});

test('PUT parcial: muda só a instrução; null e "" REMOVEM; vagas sem tocar na instrução a mantêm; skills em Codex no PUT => 400', async () => {
  const id = disk().teamTemplates[0].id;
  let r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { instruction: 'Nova instrução do time.' }));
  assert.equal(r.status, 200); assert.equal(r.j.template.instruction, 'Nova instrução do time.'); assert.equal(r.j.template.name, 'Meu time');
  r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { slots: [{ role: 'builder', provider: 'claude', skills: ['frontend-design'] }] }));
  assert.equal(r.j.template.instruction, 'Nova instrução do time.', 'trocar vagas mantém a instrução'); assert.deepEqual(r.j.template.slots, [{ role: 'builder', provider: 'claude', skills: ['frontend-design'] }]);
  r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { instruction: null })); assert.equal(r.status, 200); assert.equal(Object.hasOwn(r.j.template, 'instruction'), false);
  assert.equal(Object.hasOwn(disk().teamTemplates.find((t) => t.id === id), 'instruction'), false, 'removida também no disco');
  await call(`/api/team-templates/${id}`, 'PUT', { instruction: 'De novo.' });
  r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { instruction: '' })); assert.equal(Object.hasOwn(r.j.template, 'instruction'), false, '"" também remove');
  r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { instruction: null })); assert.equal(r.status, 200, 'remover o que não existe é inofensivo');
  r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { slots: [{ role: 'builder', provider: 'codex', skills: ['frontend-design'] }] })); assert.equal(r.status, 400); assert.match(r.j.error, /Codex CLI ainda não recebe skills/);
  assert.equal((await jr(await call(`/api/team-templates/${id}`, 'PUT', {}))).status, 400);
});

test('rollback: falha ao gravar uma instrução nova devolve o estado anterior e responde 500', async () => {
  const id = disk().teamTemplates[0].id, cur = db.teamTemplates, tmpFile = path.join(process.env.ORCH_DATA_DIR, 'db.json.tmp');
  fs.rmSync(tmpFile, { force: true }); fs.mkdirSync(tmpFile);
  try { const r = await jr(await call(`/api/team-templates/${id}`, 'PUT', { instruction: 'vai falhar' })); assert.equal(r.status, 500); assert.match(r.j.error, /nada foi alterado/); }
  finally { fs.rmSync(tmpFile, { recursive: true, force: true }); }
  assert.equal(db.teamTemplates, cur);
});

test('leitura tolerante: skill desconhecida some, skills em vaga Codex somem, instrução inválida some; banco antigo lê igual', () => {
  const r = T.readTemplates({ teamTemplates: [
    { id: 'tpl_a1a1a1a1', name: 'Antigo', slots: [{ role: 'builder', provider: 'claude' }] },
    { id: 'tpl_b2b2b2b2', name: 'Sujo', instruction: 'x'.repeat(1600), slots: [{ role: 'builder', provider: 'claude', skills: ['backend-api', 'sumiu', 'backend-api', 7, '__proto__'] }, { role: 'builder', provider: 'codex', skills: ['backend-api'] }, { role: 'reviewer', provider: 'claude', skills: 'lixo' }] },
    { id: 'tpl_c3c3c3c3', name: 'Instrução suja', instruction: 'Faça "tudo" & teste\u0007', slots: [{ role: 'builder', provider: 'claude', skills: Object.keys(SKILLS) }] },
    { id: 'tpl_d4d4d4d4', name: 'Instrução não texto', instruction: { x: 1 }, slots: [{ role: 'builder', provider: 'claude' }] },
  ] });
  assert.deepEqual(r[0], { id: 'tpl_a1a1a1a1', name: 'Antigo', slots: [{ role: 'builder', provider: 'claude' }], createdAt: null, updatedAt: null });
  assert.equal(Object.hasOwn(r[1], 'instruction'), false, 'longa demais: some (não é cortada)');
  assert.deepEqual(r[1].slots, [{ role: 'builder', provider: 'claude', skills: ['backend-api'] }, { role: 'builder', provider: 'codex' }, { role: 'reviewer', provider: 'claude' }]);
  assert.equal(r[2].instruction, 'Faça tudo teste'); assert.equal(r[2].slots[0].skills.length, T.MAX_SLOT_SKILLS);
  assert.equal(Object.hasOwn(r[3], 'instruction'), false);
});

test('findTeam: time salvo por id, preset por preset:<slug>; o resto é null', () => {
  const d = { teamTemplates: [{ id: 'tpl_a1a1a1a1', name: 'Antigo', slots: [{ role: 'builder', provider: 'claude' }] }] };
  assert.equal(T.findTeam(d, 'tpl_a1a1a1a1').name, 'Antigo'); assert.equal(T.findTeam(d, 'preset:web'), presetById('preset:web'));
  for (const x of ['tpl_00000000', 'tpl_A1A1A1A1', 'preset:', 'preset:nao', '__proto__', '', null, 7, {}]) assert.equal(T.findTeam(d, x), null, String(x));
  assert.equal(T.findTeam(null, 'tpl_a1a1a1a1'), null);
});
