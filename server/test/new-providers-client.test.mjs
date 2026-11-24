// Interface das IAs novas (Gemini, OpenCode, Cursor no nível 1): a lista do servidor chega à "Suas IAs" com capacidades e instalação; só IAs com o Maestro entram em times;
// skills só para quem declara plugins; pré-requisitos contam qualquer IA instalada; "Para ligar" não repete o que o servidor já integra; o status não lista IA não instalada.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

process.env.ORCH_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'orch-npc-'));
const { providerSummary, coordinating, providerOptionLabel } = await import('../../client/src/env-view.js');
const { plannedAis, aiShortName } = await import('../../client/src/provider-catalog.js');
const { takesSkills } = await import('../../client/src/squads.js');
const { prereqIssues } = await import('../../client/src/prereqs.js');
const { systemStatus } = await import('../../client/src/system-status.js');
const H = await import('../../server/harness.js');

const LIVE = [
  { id: 'claude', label: 'Claude Code', available: true, capabilities: { resume: true, plugins: true, mcp: true, readOnly: true } },
  { id: 'codex', label: 'Codex CLI', available: false, capabilities: { resume: false, plugins: false, mcp: true, readOnly: true } },
  { id: 'gemini', label: 'Gemini CLI', available: true, capabilities: { resume: false, plugins: false, mcp: false, readOnly: true }, install: 'npm i -g @google/gemini-cli' },
  { id: 'opencode', label: 'OpenCode', available: false, capabilities: { resume: false, plugins: false, mcp: false, readOnly: false }, install: 'npm i -g opencode-ai', note: 'As permissões seguem…' },
];

test('providerSummary: as IAs que o servidor conhece além das fixas entram depois delas, com capacidades, instalação e aviso; sem `live`, só as fixas', () => {
  const rows = providerSummary([], new Set(), LIVE);
  assert.deepEqual(rows.map((r) => [r.id, r.available]), [['claude', true], ['codex', false], ['gemini', true], ['opencode', false]]);
  assert.equal(rows[2].label, 'Gemini CLI'); assert.equal(rows[2].install, 'npm i -g @google/gemini-cli'); assert.equal(rows[2].capabilities.mcp, false);
  assert.equal(rows[3].note, 'As permissões seguem…'); assert.equal(rows[0].capabilities.plugins, true);
  const withSession = providerSummary([{ id: 't1', status: 'running', provider: 'gemini' }], new Set(['t1']), LIVE);
  assert.equal(withSession.filter((r) => r.id === 'gemini').length, 1, 'sessão da IA nova não duplica a linha'); assert.equal(withSession[2].working, 1);
  assert.deepEqual(providerSummary([], new Set()).map((r) => r.id), ['claude', 'codex']);
  assert.deepEqual(providerSummary([], new Set(), [null, { id: '' }, { label: 'sem id' }]).map((r) => r.id), ['claude', 'codex'], 'lixo do servidor é ignorado');
});

test('times só com IAs que conversam com o Maestro; skills só para quem declara plugins; rótulo de login não manda rodar "codex login" em outra IA', () => {
  assert.deepEqual(coordinating(LIVE).map((p) => p.id), ['claude', 'codex']);
  assert.deepEqual(coordinating([{ id: 'claude' }]).map((p) => p.id), ['claude'], 'servidor antigo (sem capabilities): conta como coordenado');
  assert.deepEqual(coordinating(null), []);
  assert.equal(takesSkills('gemini', LIVE), false); assert.equal(takesSkills('claude', LIVE), true);
  assert.equal(takesSkills('gemini'), false, 'sem a lista do servidor: só o Claude recebe skills'); assert.equal(takesSkills('claude'), true); assert.equal(takesSkills('codex'), false);
  assert.equal(providerOptionLabel({ id: 'gemini', label: 'Gemini CLI', available: true, auth: { known: true, loggedIn: false } }), 'Gemini CLI (não conectado)');
  assert.match(providerOptionLabel({ id: 'codex', label: 'Codex CLI', available: true, auth: { known: true, loggedIn: false } }), /codex login/);
  assert.equal(aiShortName('gemini', 'Gemini CLI'), 'Gemini'); assert.equal(aiShortName('cursor', 'Cursor CLI'), 'Cursor');
});

test('"Para ligar" não repete IA que o servidor já integra', () => {
  const ids = plannedAis().map((a) => a.id);
  assert.ok(['gemini', 'opencode', 'cursor'].every((id) => ids.includes(id)), 'sem o servidor, seguem como "em breve"');
  const after = plannedAis(['claude', 'codex', 'gemini', 'opencode', 'cursor']).map((a) => a.id);
  assert.ok(!after.includes('gemini') && !after.includes('opencode') && !after.includes('cursor')); assert.ok(after.includes('kimi'));
  assert.deepEqual(plannedAis('lixo').map((a) => a.id), ids);
});

test('pré-requisitos: só Gemini (ou outra IA nova) instalada já é uma IA, e o aviso de login (das contas do FORGE) não vale para ela', () => {
  const state = { prereqs: { claude: { available: false }, login: { known: true, loggedIn: false }, git: { available: true } } };
  assert.deepEqual(prereqIssues(state, [{ id: 'claude', available: false }, { id: 'codex', available: false }]).map((x) => x.id), ['agent']);
  assert.deepEqual(prereqIssues(state, [{ id: 'claude', available: false }, { id: 'gemini', available: true }]).map((x) => x.id), [], 'Gemini sozinho: sem bloqueio de IA nem de login');
  assert.deepEqual(prereqIssues(state, [{ id: 'claude', available: false }, { id: 'codex', available: true }, { id: 'gemini', available: true }]).map((x) => x.id), ['login'], 'com o Codex, o login dele segue valendo');
});

test('status do sistema: IA nova só aparece quando instalada ou em uso', () => {
  const s = systemStatus({ sessions: [], workingIds: new Set(), tasks: [], workspaces: [], max: 8, providers: LIVE });
  assert.deepEqual(s.providers.map((p) => p.id), ['claude', 'codex', 'gemini']);
});

test('Quem faz cada tarefa: só oferece IAs com o Maestro (o piloto e as linhas viram Maestro e etapas de missão)', () => {
  const v = H.harnessView({});
  assert.deepEqual(v.providers, ['claude', 'codex', 'gemini'], 'o Gemini (nível 2) entra; OpenCode e Cursor não');
});
