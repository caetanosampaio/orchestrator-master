// Linha de comando de CLIs com wrapper .cmd no Windows (server/win-cmdline.js). A parte pura roda em qualquer sistema; a prova REAL (cmd.exe + node-pty + wrapper em pasta com
// espaço, o caso do perfil "Joe Smith") só no Windows. Tudo em pastas temporárias; nenhuma CLI real é aberta.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-wincmd-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const { shellPtyArgs } = await import('../win-cmdline.js');

const SHELL = (script) => ({ file: 'C:\\WINDOWS\\system32\\cmd.exe', args: ['/d', '/s', '/c', script], viaShell: true });
const WRAPPER = 'C:\\Users\\Joe Smith\\AppData\\Roaming\\npm\\codex.cmd';

test('shellPtyArgs: sem wrapper .cmd ou sem espaço no caminho nada muda (a lista de sempre)', () => {
  assert.deepEqual(shellPtyArgs({ file: '/bin/codex', args: [], viaShell: false }, ['-c', 'a b']), ['-c', 'a b']);
  assert.deepEqual(shellPtyArgs(SHELL('C:\\npm\\codex.cmd'), ['-c', 'a b']), ['/d', '/s', '/c', 'C:\\npm\\codex.cmd', '-c', 'a b'], 'sem espaço no caminho: lista do node-pty (verificada com o cmd.exe real)');
  assert.deepEqual(shellPtyArgs(null, ['x']), ['x']);
});

test('shellPtyArgs: caminho do wrapper COM espaço vira a linha inteira entre aspas externas (o que o cmd /s exige), com /v:off; argumentos com espaço entre aspas, barras finais dobradas', () => {
  const s = shellPtyArgs(SHELL(WRAPPER), ['--no-alt-screen', '-c', 'developer_instructions=Voce e o CONSTRUTOR (rapido)', '-c', "projects={'C:\\proj\\'={trust_level='trusted'}}", '--dir', 'C:\\com espaco\\', '']);
  assert.equal(typeof s, 'string');
  assert.equal(s, `/d /s /v:off /c ""${WRAPPER}" --no-alt-screen -c "developer_instructions=Voce e o CONSTRUTOR (rapido)" -c projects={'C:\\proj\\'={trust_level='trusted'}} --dir "C:\\com espaco\\\\" """`);
});

test('shellPtyArgs: metacaractere do cmd.exe (& | < > ^ parênteses) vai entre aspas MESMO sem espaço (defesa em profundidade); ! é texto comum; vazio vira ""', () => {
  const s = shellPtyArgs(SHELL(WRAPPER), ['a&b', 'x|y', 'p^q', '<f', 'g>', '(p)', 'Seja!', 'x\\', '']);
  assert.equal(s, `/d /s /v:off /c ""${WRAPPER}" "a&b" "x|y" "p^q" "<f" "g>" "(p)" Seja! x\\ """`, 'só o que tem metacaractere ou espaço leva aspas');
});

test('shellPtyArgs: % (o cmd.exe expande), aspa e controles no wrapper ou nos argumentos = null (nunca tenta mesmo assim); no CAMINHO também ! & | < > ^; formato desconhecido também', () => {
  for (const bad of ['C:\\a b\\100%\\x.cmd', 'C:\\a b\\"x.cmd', 'C:\\a b\\x!.cmd', 'C:\\a b\\x\n.cmd', 'C:\\a&b c\\x.cmd', 'C:\\a b\\x|y.cmd', 'C:\\a b\\x^y.cmd', 'C:\\a b\\<x>.cmd']) assert.equal(shellPtyArgs(SHELL(bad), []), null, JSON.stringify(bad));
  for (const bad of ['%PATH%', 'a"b', 'a\nb', 'a\u0000b', 'a\u007fb']) assert.equal(shellPtyArgs(SHELL('C:\\a b\\x.cmd'), ['ok', bad]), null, JSON.stringify(bad));
  assert.equal(shellPtyArgs({ file: 'cmd.exe', args: ['/c', 'C:\\a b\\x.cmd'], viaShell: true }, []), null, 'resolve() com outro formato: não arrisca');
  assert.equal(shellPtyArgs(SHELL('C:\\a b\\x.cmd'), [7]), null, 'argumento que não é texto');
  assert.equal(typeof shellPtyArgs(SHELL('C:\\a b (x86)\\x.cmd'), ['a & b']), 'string', 'parênteses no caminho são seguros entre aspas');
});

test('Windows REAL: wrapper .cmd em pasta COM espaço recebe os argumentos intactos pelo cmd.exe + node-pty (e a lista antiga falhava), inclusive & | ^ < > ! vazio e barra final', { skip: process.platform !== 'win32' && 'só no Windows (cmd.exe)' }, async () => {
  const require = createRequire(import.meta.url), pty = require('node-pty');
  const base = fs.mkdtempSync(path.join(tmp, 'pasta com espaco ')), bin = path.join(base, 'npm global bin (x86)'); fs.mkdirSync(bin);
  const dump = path.join(base, 'dump.js'); fs.writeFileSync(dump, "require('fs').writeFileSync(process.env.DUMP_OUT, JSON.stringify(process.argv.slice(2)));");
  const shim = path.join(bin, 'fakecli.cmd'); fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${dump}" %*\r\n`); // o formato do shim do npm
  const cmd = { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', shim], viaShell: true };
  const run = (spawnArgs) => new Promise((resolve) => {
    const out = path.join(base, `out-${Math.random().toString(16).slice(2)}.json`);
    const p = pty.spawn(cmd.file, spawnArgs, { name: 'xterm-256color', cols: 120, rows: 30, cwd: base, env: { ...process.env, DUMP_OUT: out }, useConpty: true });
    const t = setTimeout(() => { try { p.kill(); } catch { /* já saiu */ } }, 10_000);
    p.onExit(() => {
      clearTimeout(t); try { p.kill(); } catch { /* já saiu */ } // libera o agente do ConPTY: sem isso o processo de teste não encerra
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); } catch { resolve(null); }
    });
  });
  const args = ['--no-alt-screen', '-c', "projects={'C:\\proj ect\\wt_1'={trust_level='trusted'}}", '-c', 'developer_instructions=Voce e o CONSTRUTOR. Faca (rapido): ok. Seja direto!', '-c', "notice.model_migrations={'gpt-5.6-sol'='gpt-6.2-sol','gpt-5.6-terra'='gpt-6.1-terra'}", '-c', 'mcp_servers.forge_ab12cd.url=http://127.0.0.1:4999/mcp'];
  assert.equal(await run([...cmd.args, ...args]), null, 'a lista antiga não abre (o defeito): o cmd.exe corta o caminho no espaço');
  assert.deepEqual(await run(shellPtyArgs(cmd, args)), args, 'com a linha entre aspas externas, todos os argumentos chegam intactos');
  assert.deepEqual(await run(shellPtyArgs(cmd, [])), [], 'sem argumentos também abre');
  const hostis = ['a&b', 'x|y', 'p^q', '<f', 'g>', '(p)', 'Seja direto!', '!PATH!', 'x\\', 'dir com espaco\\', '', 'a & b']; // o que o cmd.exe interpretaria, sem aspas
  assert.deepEqual(await run(shellPtyArgs(cmd, hostis)), hostis, 'metacaracteres chegam como TEXTO (não viram comando nem redirecionamento)');
  assert.ok(!fs.existsSync(path.join(base, 'f')) && !fs.existsSync(path.join(base, 'g')), 'nenhum arquivo foi criado por < ou >');
});

test('Windows REAL: o gerenciador de terminais abre uma CLI cujo wrapper .cmd está em pasta COM espaço (antes: "não é reconhecido como um comando"), com os argumentos do FORGE intactos', { skip: process.platform !== 'win32' && 'só no Windows (cmd.exe)' }, async () => {
  const T = await import('../terminals.js');
  const base = fs.mkdtempSync(path.join(tmp, 'perfil com espaco ')), bin = path.join(base, 'npm global bin'), ws = path.join(base, 'workspace'); fs.mkdirSync(bin); fs.mkdirSync(ws);
  const out = path.join(base, 'argv.json'), dump = path.join(base, 'dump.js');
  fs.writeFileSync(dump, `require('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2))); setTimeout(() => {}, 30000);`);
  const shim = path.join(bin, 'claude.cmd'); fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${dump}" %*\r\n`);
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mgr = T.createTerminalManager({ db, resolveCommand: () => ({ file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', shim], viaShell: true }), inspectConfig: async () => [], persist: () => {}, sweepMs: 0, mcp: null });
  try {
    const r = await mgr.create({ role: 'builder', title: 'Perfil com espaço' }); assert.equal(r.ok, true, r.error);
    let argv = null; for (let i = 0; i < 80 && !argv; i++) { await new Promise((res) => setTimeout(res, 100)); try { argv = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* ainda não gravou */ } }
    assert.ok(Array.isArray(argv), 'a CLI abriu: o wrapper com espaço foi executado pelo cmd.exe');
    assert.ok(argv.includes('--session-id') && argv.includes('--append-system-prompt'), `argumentos do Claude Code intactos: ${argv.slice(0, 4).join(' ')}…`);
    assert.equal(argv[argv.indexOf('--append-system-prompt') + 1].startsWith('Voce e o CONSTRUTOR'), true, 'o papel (texto com espaços e parênteses) chegou inteiro');
  } finally { mgr.killAllSync(); }
});
