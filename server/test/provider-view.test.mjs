// Estado dos providers na interface (client/src/provider-view.js, env-view.js, system-status.js): só dados do servidor, nada presumido; sem "em breve".
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerStatus, providerById, codexAccountState, withClaudeLogin } from '../../client/src/provider-view.js';
import { providerSummary } from '../../client/src/env-view.js';
import { systemStatus } from '../../client/src/system-status.js';

test('providerStatus: não instalado, não conectado, conectado e instalado (login desconhecido não alerta)', () => {
  assert.deepEqual(providerStatus(undefined), { kind: 'off', text: 'indisponível' });
  assert.deepEqual(providerStatus({ available: false }), { kind: 'off', text: 'não instalado' });
  assert.deepEqual(providerStatus({ available: true, auth: { known: true, loggedIn: false } }), { kind: 'bad', text: 'não conectado' });
  assert.deepEqual(providerStatus({ available: true, auth: { known: true, loggedIn: true } }), { kind: 'ok', text: 'conectado' });
  assert.deepEqual(providerStatus({ available: true, auth: { known: false, loggedIn: null } }), { kind: 'ok', text: 'instalado' });
  assert.deepEqual(providerStatus({ available: true }), { kind: 'ok', text: 'instalado' });
  assert.equal(providerById([{ id: 'codex', label: 'x' }], 'codex').label, 'x');
  assert.equal(providerById(null, 'codex'), undefined);
});

test('codexAccountState: orienta cada caso e nunca diz "em breve"', () => {
  const cases = [undefined, { available: false }, { available: true, auth: { known: true, loggedIn: false } }, { available: true, auth: { known: true, loggedIn: true } }, { available: true }];
  const out = cases.map(codexAccountState);
  assert.deepEqual(out.map((s) => s.kind), ['off', 'off', 'bad', 'ok', 'ok']);
  assert.deepEqual(out.map((s) => s.text), ['indisponível', 'não instalado', 'não conectado', 'conectado', 'login não verificado']);
  for (const s of out) { assert.ok(s.detail.length > 10); assert.doesNotMatch(`${s.text} ${s.detail}`, /em breve/i); }
  assert.match(out[1].detail, /npm i -g @openai\/codex/);
  assert.match(out[2].detail, /codex login/);
});

test('providerSummary com a lista real do servidor: disponibilidade e login; sem a lista vale o padrão estático', () => {
  const live = [{ id: 'claude', available: true }, { id: 'codex', available: true, auth: { known: true, loggedIn: false, detail: 'x' } }];
  const r = Object.fromEntries(providerSummary([], new Set(), live).map((x) => [x.id, x]));
  assert.equal(r.claude.available, true);
  assert.equal(r.codex.available, true);
  assert.equal(r.codex.auth.loggedIn, false);
  const off = Object.fromEntries(providerSummary([], new Set(), [{ id: 'claude', available: true }]).map((x) => [x.id, x]));
  assert.equal(off.codex.available, false, 'provider ausente da lista do servidor = não instalado');
  assert.ok(providerSummary([], new Set()).every((x) => x.available === true));
});

test('systemStatus: providers trazem disponibilidade e login reais', () => {
  const s = systemStatus({ sessions: [], providers: [{ id: 'claude', available: true }, { id: 'codex', available: false }] });
  assert.deepEqual(s.providers.map((p) => [p.id, p.available]), [['claude', true], ['codex', false]]);
});

test('providerStatus: ativo (terminais em uso) vence conectado e instalado, mas não vence "não conectado" nem "não instalado"', () => {
  const ok = { available: true, auth: { known: true, loggedIn: true } };
  assert.deepEqual(providerStatus({ ...ok, active: 0 }), { kind: 'ok', text: 'conectado' });
  assert.deepEqual(providerStatus({ ...ok, active: 2 }), { kind: 'ok', text: 'ativo' });
  assert.deepEqual(providerStatus({ available: true, active: 1 }), { kind: 'ok', text: 'ativo' }, 'login desconhecido com terminal em uso: ativo');
  assert.deepEqual(providerStatus({ available: true, active: 1, auth: { known: true, loggedIn: false } }), { kind: 'bad', text: 'não conectado' }, 'terminal parado na tela de login não é "ativo"');
  assert.deepEqual(providerStatus({ available: false, active: 1 }), { kind: 'off', text: 'não instalado' });
});

test('withClaudeLogin: o login da conta padrão vira `auth` do Claude; sem informação, a lista segue igual', () => {
  const list = [{ id: 'claude', available: true }, { id: 'codex', available: true, auth: { known: true, loggedIn: true } }];
  const r = withClaudeLogin(list, { known: true, loggedIn: true });
  assert.deepEqual(r[0].auth, { known: true, loggedIn: true });
  assert.equal(r[1], list[1]);
  assert.deepEqual(withClaudeLogin(list, { known: true, loggedIn: false })[0].auth, { known: true, loggedIn: false });
  assert.equal(withClaudeLogin(list, { known: false, loggedIn: null }), list);
  assert.equal(withClaudeLogin(list, undefined), list);
  assert.equal(withClaudeLogin(null, { known: true, loggedIn: true }), null);
});

test('integração: providerSummary + status dão ativo para quem tem terminal rodando e conectado para quem só está logado', () => {
  const live = withClaudeLogin([{ id: 'claude', available: true }, { id: 'codex', available: true, auth: { known: true, loggedIn: true } }], { known: true, loggedIn: true });
  const sessions = [{ id: 't1', status: 'running', provider: 'claude', agent: { state: 'running' } }, { id: 't2', status: 'exited', exitCode: 0, provider: 'codex' }];
  const rows = Object.fromEntries(providerSummary(sessions, new Set(), live).map((r) => [r.id, providerStatus(r).text]));
  assert.deepEqual(rows, { claude: 'ativo', codex: 'conectado' });
  const both = providerSummary([...sessions, { id: 't3', status: 'running', provider: 'codex', agent: { state: 'idle' } }], new Set(), live).map((r) => providerStatus(r).text);
  assert.deepEqual(both, ['ativo', 'ativo']);
});
