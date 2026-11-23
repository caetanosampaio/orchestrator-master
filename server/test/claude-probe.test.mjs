// Sonda do Claude Code (claude-probe.js): resultado e textos, cache de 15 s, chamada em andamento compartilhada, reset ("Verificar novamente") e falhas.
// Só Claude FALSO (node + script em diretório temporário); nenhum banco, nenhuma CLI real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createClaudeProbe, CLAUDE_NOT_FOUND, CLAUDE_UNSAFE_CMD, CLAUDE_READY } from '../claude-probe.js';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-claude-probe-')));
const realPath = process.env.PATH;
after(() => { process.env.PATH = realPath; fs.rmSync(tmp, { recursive: true, force: true }); });

let n = 0;
/** Claude falso: conta as chamadas num arquivo e responde `--version` (com atraso opcional, para observar chamadas simultâneas). */
function fakeClaude({ delayMs = 0, exitCode = 0 } = {}) {
  const counter = path.join(tmp, `count${++n}.txt`), script = path.join(tmp, `claude${n}.mjs`);
  fs.writeFileSync(counter, '');
  fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(counter)}, 'x'); setTimeout(() => { console.log('  9.8.7 (Claude Code falso)  '); process.exit(${exitCode}); }, ${delayMs});`);
  return { script, calls: () => fs.readFileSync(counter, 'utf8').length };
}

test('disponível: { available, version (sem espaços), detail } com os textos de sempre; cachedAvailability só depois da 1ª consulta', async () => {
  const f = fakeClaude();
  const probe = createClaudeProbe({ command: process.execPath, prefixArgs: [f.script] });
  assert.equal(probe.cachedAvailability(), null, 'sem consulta: desconhecida');
  const r = await probe();
  assert.deepEqual(r, { available: true, version: '9.8.7 (Claude Code falso)', detail: CLAUDE_READY });
  assert.equal(CLAUDE_READY, 'Claude Code detectado e pronto para executar tarefas autorizadas');
  assert.equal(probe.cachedAvailability(), true);
});

test('cache de 15 s: a 2ª consulta não executa de novo; chamadas simultâneas compartilham UMA execução; reset força nova consulta', async () => {
  const f = fakeClaude({ delayMs: 200 });
  const probe = createClaudeProbe({ command: process.execPath, prefixArgs: [f.script] });
  const [a, b, c] = await Promise.all([probe(), probe(), probe()]);
  assert.equal(f.calls(), 1, 'uma única execução em andamento'); assert.equal(a, b); assert.equal(b, c);
  assert.equal(await probe(), a, 'dentro do cache: o mesmo resultado'); assert.equal(f.calls(), 1);
  probe.reset(); assert.equal(probe.cachedAvailability(), null, 'reset descarta o cache');
  const d = await probe(); assert.equal(f.calls(), 2, 'depois do reset consulta de verdade'); assert.notEqual(d, a); assert.deepEqual(d, a);
});

test('cache vencido (ttlMs) consulta de novo', async () => {
  const f = fakeClaude();
  const probe = createClaudeProbe({ command: process.execPath, prefixArgs: [f.script], ttlMs: 0 });
  await probe(); await probe();
  assert.equal(f.calls(), 2);
});

test('falha: binário inexistente, saída com erro e exceção ao iniciar = indisponível com "não encontrado no PATH"; a falha também fica em cache', async () => {
  const gone = createClaudeProbe({ command: path.join(tmp, 'claude-que-nao-existe') });
  assert.deepEqual(await gone(), { available: false, detail: CLAUDE_NOT_FOUND });
  assert.equal(CLAUDE_NOT_FOUND, 'Claude Code não encontrado no PATH');
  assert.equal(gone.cachedAvailability(), false);

  const f = fakeClaude({ exitCode: 3 });
  const failing = createClaudeProbe({ command: process.execPath, prefixArgs: [f.script] });
  assert.deepEqual(await failing(), { available: false, detail: CLAUDE_NOT_FOUND });
  await failing(); assert.equal(f.calls(), 1, 'falha em cache: não repete dentro dos 15 s');

  let runs = 0;
  const throwing = createClaudeProbe({ command: 'x', run: () => { runs++; throw new Error('spawn EINVAL'); } });
  assert.deepEqual(await throwing(), { available: false, detail: CLAUDE_NOT_FOUND });
  assert.equal(runs, 1);
  const again = await throwing(); assert.equal(again.available, false); assert.equal(runs, 1, 'sem chamada em andamento presa: o resultado ficou em cache');
});

test('argumentos: com comando injetado, exatamente prefixArgs + --version, sem shell, com timeout e sem janela', async () => {
  let seen = null;
  const probe = createClaudeProbe({ command: 'node-falso', prefixArgs: ['script.mjs'], run: (file, args, opts, cb) => { seen = { file, args, opts }; cb(null, '1.0.0\n'); } });
  assert.deepEqual(await probe(), { available: true, version: '1.0.0', detail: CLAUDE_READY });
  assert.deepEqual(seen, { file: 'node-falso', args: ['script.mjs', '--version'], opts: { timeout: 8000, windowsHide: true, windowsVerbatimArguments: false } });
});

test('claude.cmd com caminho que o cmd.exe interpretaria (Windows): nada é executado e o motivo é o de sempre', { skip: process.platform !== 'win32' }, async () => {
  const dir = path.join(tmp, 'bin&x'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\necho 1.0.0\r\n');
  process.env.PATH = dir;
  try {
    let runs = 0;
    const probe = createClaudeProbe({ run: () => { runs++; } }); // padrão: resolve como os terminais
    assert.deepEqual(await probe(), { available: false, detail: CLAUDE_UNSAFE_CMD });
    assert.equal(CLAUDE_UNSAFE_CMD, 'Claude Code não pôde ser iniciado com segurança (caminho do claude.cmd inválido).');
    assert.equal(runs, 0, 'recusado antes de iniciar qualquer processo');
  } finally { process.env.PATH = realPath; }
});
