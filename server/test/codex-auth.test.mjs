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

test('só o código 1 é "não conectado"; outro código (ex.: subcomando inexistente) é desconhecido, sem falso alarme', async () => {
  for (const code of [2, 127, 255]) {
    const r = await createCodexAuthProbe({ resolve: () => spec, run: fakeRun(Object.assign(new Error('x'), { code })) })();
    assert.equal(r.known, false, `código ${code}`); assert.equal(r.loggedIn, null);
  }
});

test('estourou o tempo: encerra a árvore do processo da consulta (no Windows o execFile mata só o cmd.exe) e fica desconhecido', async () => {
  const killed = [];
  const run = (file, args, opts, cb) => { setImmediate(() => cb(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM', code: null }))); return { pid: 4242 }; };
  const r = await createCodexAuthProbe({ resolve: () => spec, run, killTree: (pid) => killed.push(pid) })();
  assert.deepEqual(killed, [4242]);
  assert.equal(r.known, false); assert.equal(r.loggedIn, null);
});

test('reset durante uma consulta: o resultado antigo não volta ao cache e a próxima chamada consulta de novo', async () => {
  const calls = []; let release = null;
  const run = (file, args, opts, cb) => { calls.push(1); const n = calls.length; if (n === 1) release = () => cb(Object.assign(new Error('x'), { code: 1 })); else setImmediate(() => cb(null)); return { pid: 1 }; };
  const p = createCodexAuthProbe({ resolve: () => spec, run });
  const first = p();
  p.reset();
  const second = await p();
  assert.equal(second.loggedIn, true, 'consulta nova depois do reset');
  release();
  assert.equal((await first).loggedIn, false, 'a consulta antiga ainda devolve o seu resultado a quem a pediu');
  assert.equal((await p()).loggedIn, true, 'mas o cache guarda o resultado novo');
  assert.equal(calls.length, 2);
});

// Wrapper .cmd do npm (Windows) num caminho com espaço: antes o `cmd /s` quebrava a linha, saía com 1 e o Codex conectado aparecia como "não conectado".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loginStatusCommand, resolveCodex } from '../providers/codex.js';
const WIN = process.platform === 'win32' ? false : 'só se aplica ao Windows (wrapper .cmd)';

test('loginStatusCommand: CLI direta leva só `login status`; .cmd monta a linha do cmd.exe; caminho com metacaractere não executa', () => {
  assert.deepEqual(loginStatusCommand({ file: '/x/codex', args: [], viaShell: false }), { args: ['login', 'status'], opts: {} });
  const c = loginStatusCommand({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\Users\\Nome Sobrenome\\npm\\codex.cmd'], viaShell: true });
  assert.deepEqual(c.args, ['/d', '/s', '/c', '""C:\\Users\\Nome Sobrenome\\npm\\codex.cmd" login status"']);
  assert.equal(c.opts.windowsVerbatimArguments, true);
  for (const bad of ['C:\a&b\codex.cmd', 'C:\a"b\codex.cmd', 'C:\a%PATH%\codex.cmd', 'C:\a^b\codex.cmd', '']) {
    assert.equal(loginStatusCommand({ file: 'cmd.exe', args: ['/d', '/s', '/c', bad], viaShell: true }), null, bad);
  }
});

test('codex.cmd REAL num diretório com espaço: 0 = conectado, 1 = não conectado, outro = desconhecido', { skip: WIN }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-cx '));
  try {
    const mk = (code) => { const d = path.join(base, `bin ${code}`); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'codex.cmd'), `@echo off\r\nif not "%1"=="login" exit /b 99\r\nif not "%2"=="status" exit /b 98\r\nexit /b ${code}\r\n`); return d; };
    const probeFor = (dir) => createCodexAuthProbe({ resolve: () => resolveCodex({ env: { PATH: dir }, platform: 'win32' }), ttlMs: 0 });
    assert.equal((await probeFor(mk(0))()).loggedIn, true);
    const off = await probeFor(mk(1))(); assert.equal(off.known, true); assert.equal(off.loggedIn, false);
    const other = await probeFor(mk(7))(); assert.equal(other.known, false);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('atualização rápida: desconectado reconsulta em retryMs, conectado só em ttlMs; mudança do arquivo de login invalida na hora', async () => {
  let t = 0, sig = 'a', code = 1, calls = 0;
  const run = (file, args, opts, cb) => { calls++; setImmediate(() => cb(code === 0 ? null : Object.assign(new Error('x'), { code }))); return { pid: 1 }; };
  const p = createCodexAuthProbe({ resolve: () => spec, run, now: () => t, ttlMs: 30_000, retryMs: 8_000, signature: () => sig });
  assert.equal((await p()).loggedIn, false); assert.equal(calls, 1);
  t = 5_000; await p(); assert.equal(calls, 1, 'dentro de retryMs: cache');
  t = 9_000; code = 0; assert.equal((await p()).loggedIn, true); assert.equal(calls, 2, 'passou retryMs: reconsulta e vê o login');
  t = 20_000; await p(); assert.equal(calls, 2, 'conectado: cache até ttlMs');
  sig = 'b'; code = 1; assert.equal((await p()).loggedIn, false); assert.equal(calls, 3, 'o arquivo de login mudou (logout): invalida na hora');
  sig = 'c'; code = 0; assert.equal((await p()).loggedIn, true); assert.equal(calls, 4, 'login: invalida na hora, sem esperar o tempo');
});

test('authSignature: só data e tamanho de auth.json (o conteúdo não é lido); sem arquivo = sem-arquivo; muda com login e logout', async () => {
  const { authSignature } = await import('../providers/codex.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-sig-'));
  try {
    assert.equal(authSignature({ CODEX_HOME: home }), 'sem-arquivo');
    const f = path.join(home, 'auth.json');
    fs.writeFileSync(f, '{"x":1}');
    const a = authSignature({ CODEX_HOME: home });
    assert.match(a, /^\d+(\.\d+)?:7$/);
    assert.ok(!a.includes('"x"'), 'nada do conteúdo na assinatura');
    fs.writeFileSync(f, '{"x":123456}');
    assert.notEqual(authSignature({ CODEX_HOME: home }), a);
    fs.rmSync(f);
    assert.equal(authSignature({ CODEX_HOME: home }), 'sem-arquivo');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
