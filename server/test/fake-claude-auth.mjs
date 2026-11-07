// CLI FALSA do `claude auth ...` SÓ para os testes. Nunca abre navegador, nunca fala com a Anthropic, nunca lê credenciais reais.
// "Login" = existir <CLAUDE_CONFIG_DIR>/fake-login.json (ou <FAKE_SYSTEM_DIR>/fake-login.json na conta Sistema).
// Controles por ambiente: FAKE_AUTH_LOG (arquivo onde cada chamada deixa uma linha JSON), FAKE_LOGIN_MODE, FAKE_STATUS_SLEEP (ms), FAKE_STATUS_GARBAGE, FAKE_PID_FILE.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const dir = process.env.CLAUDE_CONFIG_DIR || process.env.FAKE_SYSTEM_DIR || '';
const stateFile = path.join(dir, 'fake-login.json');
const log = (o) => { if (process.env.FAKE_AUTH_LOG) fs.appendFileSync(process.env.FAKE_AUTH_LOG, `${JSON.stringify({ args, dir: process.env.CLAUDE_CONFIG_DIR ?? null, apiKey: process.env.ANTHROPIC_API_KEY ?? null, ...o })}\n`); };
const out = (t) => process.stdout.write(t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args[0] === '--version') { out('0.0.0-fake-auth\n'); process.exit(0); }
if (args[0] !== 'auth') { process.exit(2); }

if (args[1] === 'status') {
  log({ cmd: 'status' });
  if (process.env.FAKE_STATUS_SLEEP) await sleep(Number(process.env.FAKE_STATUS_SLEEP));
  if (process.env.FAKE_STATUS_GARBAGE) { out('isto nao e json\n'); process.exit(0); }
  const on = fs.existsSync(stateFile);
  out(`${JSON.stringify(on
    ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'pessoa@example.test', orgName: 'Org Teste', subscriptionType: 'pro', planTier: 'x', loginExpiresAt: '2030-01-01T00:00:00.000Z', configDirectory: dir, segredo: 'NAO-PODE-SAIR' }
    : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', configDirectory: dir })}\n`);
  process.exit(on ? 0 : 1);
}

if (args[1] === 'logout') { log({ cmd: 'logout' }); try { fs.rmSync(stateFile); } catch { /* já deslogado */ } out('Logged out\n'); process.exit(0); }

if (args[1] === 'login') {
  const mode = process.env.FAKE_LOGIN_MODE || 'ok';
  log({ cmd: 'login', mode });
  const done = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(stateFile, '{}'); };
  if (mode === 'fail') { out('Error: boom com detalhes internos /etc/segredo\n'); process.exit(1); }
  if (mode === 'ansi') {
    const long = `https://claude.ai/oauth/authorize?code=true&client_id=x&state=${'a'.repeat(400)}`;
    out(`\u001b[1;32mAbrindo o navegador\u001b[0m\u0007\u0001\u001b]0;titulo\u0007\r\nprogresso 10%\rprogresso 90%\r\nVisite: ${long}\r\n`);
    await sleep(100); process.exit(0);
  }
  out('Opening browser to sign in...\n');
  out('Se o navegador nao abrir: https://evil.example.com/login?next=https://claude.ai/x\n');
  out('Outra: https://claude.ai.evil.com/x e https://user:pw@claude.ai/y e http://claude.ai/z e https://notclaude.ai/w\n');
  out('Visite https://claude.ai/oauth/authorize?code=true&state=abc.\n');
  if (mode === 'auto') { done(); process.exit(0); }
  if (mode === 'nologin') process.exit(0);
  if (mode === 'tree') {
    const gc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, JSON.stringify({ child: process.pid, grandchild: gc.pid }));
    setInterval(() => {}, 1000);
  } else if (mode === 'hang') {
    setInterval(() => {}, 1000);
  } else { // 'ok': espera o código colado
    out('Paste code here if prompted > ');
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (c) => {
      buf += c; const i = buf.indexOf('\n'); if (i < 0) return;
      const line = buf.slice(0, i).replace(/\r$/, '');
      log({ cmd: 'login-input', len: line.length, good: line === 'GOOD' });
      if (line === 'GOOD') { done(); out('\nLogin successful\n'); process.exit(0); }
      out('\nCodigo invalido\n'); process.exit(1);
    });
  }
} else process.exit(2);
