// Estado dos providers na interface (client/src/provider-view.js, env-view.js, system-status.js): só dados do servidor, nada presumido; sem "em breve".
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerStatus, providerById, codexAccountState } from '../../client/src/provider-view.js';
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
