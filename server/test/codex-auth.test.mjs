import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexAuthProbe } from '../providers/codex.js';
import { providerOptionLabel } from '../../client/src/env-view.js';

// `run` simula o execFile: o último argumento é o callback (err). Nada de CLI, rede ou login reais.
const spec = { file: 'codex', args: [], viaShell: false };
const fakeRun = (result, calls = []) => (file, args, opts, cb) => { calls.push({ file, args, opts }); setImmediate(() => cb(result)); };

test('codex login status com código 0: conectado, sem repassar texto da CLI', async () => {
  const calls = [];
  const p = createCodexAuthProbe({ resolve: () => spec, run: fakeRun(null, calls), env: () => ({ PATH: 'x', ANTHROPIC_API_KEY: 'k' }) });
  assert.deepEqual(await p(), { known: true, loggedIn: true, detail: 'Codex conectado.' });
  assert.deepEqual(calls[0].args, ['login', 'status']);
  assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined);
});

test('código de saída diferente de 0: não conectado; falha de execução: desconhecido', async () => {
  const off = createCodexAuthProbe({ resolve: () => spec, run: fakeRun(Object.assign(new Error('x'), { code: 1 })) });
  const r = await off();
  assert.equal(r.known, true); assert.equal(r.loggedIn, false);
  const unk = createCodexAuthProbe({ resolve: () => spec, run: fakeRun(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })) });
  const u = await unk();
  assert.equal(u.known, false); assert.equal(u.loggedIn, null);
});

test('sem a CLI no PATH: desconhecido, e o cache evita nova chamada dentro do TTL', async () => {
  assert.equal((await createCodexAuthProbe({ resolve: () => null })()).known, false);
  const calls = []; let t = 0;
  const p = createCodexAuthProbe({ resolve: () => spec, run: fakeRun(null, calls), now: () => t, ttlMs: 100 });
  await Promise.all([p(), p()]); await p();
  assert.equal(calls.length, 1);
  t = 500; await p();
  assert.equal(calls.length, 2);
});

test('rótulo do provider: avisa só quando sabe que não há login', () => {
  assert.equal(providerOptionLabel({ label: 'Codex CLI', available: false }), 'Codex CLI (não instalado)');
  assert.match(providerOptionLabel({ label: 'Codex CLI', available: true, auth: { known: true, loggedIn: false } }), /não conectado/);
  assert.equal(providerOptionLabel({ label: 'Codex CLI', available: true, auth: { known: false, loggedIn: null } }), 'Codex CLI');
  assert.equal(providerOptionLabel({ label: 'Claude Code CLI', available: true }), 'Claude Code CLI');
});
