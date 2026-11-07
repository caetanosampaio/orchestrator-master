// Login de conta com a CLI FALSA (fake-claude-auth.mjs): URL permitida, needsCode, entrada, cancelamento, timeout, um por vez, árvore morta, `done` só com status loggedIn.
// Nunca executa `claude auth login` real (abriria o navegador). ORCH_DATA_DIR temporário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-acc-login-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'store');
const { uid } = await import('../store.js');
const A = await import('../accounts.js');
const L = await import('../account-login.js');
const { pidAlive } = await import('../instance-lock.js');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claude-auth.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(30); } return false; };
let n = 0;
function world({ mode = 'ok', loginOver = {}, baseEnv = {}, accOver = {} } = {}) {
  const k = ++n, dataDir = path.join(tmp, `data${k}`), sysDir = path.join(tmp, `sys${k}`), logFile = path.join(tmp, `calls${k}.jsonl`), pidFile = path.join(tmp, `pids${k}.json`);
  fs.mkdirSync(sysDir, { recursive: true });
  const db = { settings: {} }, st = { mode };
  const env = () => ({ ...process.env, ...baseEnv, FAKE_AUTH_LOG: logFile, FAKE_SYSTEM_DIR: sysDir, FAKE_LOGIN_MODE: st.mode, FAKE_PID_FILE: pidFile });
  const ref = { logins: null };
  const accounts = A.createAccounts({ db, dataDir, persist: () => {}, uid, command: process.execPath, prefixArgs: [FAKE], env, isLoginActive: (id) => ref.logins?.isActive(id) === true, ...accOver });
  const logins = ref.logins = L.createLoginManager({ accounts, command: process.execPath, prefixArgs: [FAKE], env, minIntervalMs: 0, ...loginOver }); // minIntervalMs 0: os testes iniciam logins em sequência; o limite real tem teste próprio
  const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const acc = accounts.create({ provider: 'claude', label: 'Conta' }).account;
  const pids = () => JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  return { st, accounts, logins, calls, acc, pids, sysDir, pidFile, dir: accounts.configDirOf(acc.id) };
}
const snap = (w, id = w.acc.id) => w.logins.snapshot(id);
const finished = (w, id = w.acc.id) => until(() => snap(w, id).state !== 'running');

test('antes de iniciar: estado idle', () => {
  const w = world(); assert.deepEqual(snap(w), { state: 'idle', url: null, needsCode: false, lines: [], startedAt: null, error: null });
});

test('login: `claude auth login --claudeai` com CLAUDE_CONFIG_DIR da conta; URL só de host permitido; needsCode; código certo => done (status loggedIn)', async () => {
  const w = world({ baseEnv: { ANTHROPIC_API_KEY: 'chave-do-ambiente' } });
  const r = w.logins.start(w.acc.id); assert.deepEqual([r.ok, r.status], [true, 202]);
  assert.ok(await until(() => snap(w).needsCode), 'a CLI pediu o código colado');
  const s = snap(w); assert.equal(s.state, 'running'); assert.equal(s.url, 'https://claude.ai/oauth/authorize?code=true&state=abc', 'a 1ª URL permitida, sem o ponto final'); assert.ok(s.startedAt);
  assert.ok(s.lines.length <= 12 && s.lines.every((l) => l.length <= 300)); assert.ok(s.lines.some((l) => /Paste code/.test(l)), 'o prompt sem quebra de linha aparece');
  const call = w.calls().find((c) => c.cmd === 'login'); assert.deepEqual(call.args, ['auth', 'login', '--claudeai']); assert.equal(call.dir, w.dir); assert.equal(call.apiKey, null, 'a chave de API do ambiente não sobrepõe o login da conta');
  assert.equal((await w.accounts.statusOf(w.acc.id)).loggedIn, false, 'ainda sem login');
  const i = w.logins.input(w.acc.id, 'GOOD'); assert.equal(i.ok, true);
  assert.ok(await finished(w)); const f = snap(w); assert.deepEqual([f.state, f.error, f.needsCode], ['done', null, false]);
  assert.equal((await w.accounts.statusOf(w.acc.id)).loggedIn, true, 'o cache do status foi invalidado ao concluir'); assert.ok(!JSON.stringify(f).includes('GOOD'));
  assert.deepEqual(snap(w, 'system').state, 'idle', 'o estado é por conta');
});

test('métodos: console e sso mudam o argumento; padrão claudeai; método inválido recusado; lista fechada (nada de --email)', async () => {
  for (const [method, flag] of [['console', '--console'], ['sso', '--sso'], ['claudeai', '--claudeai'], [undefined, '--claudeai']]) {
    const w = world({ mode: 'hang' }); assert.equal(w.logins.start(w.acc.id, method).ok, true, String(method));
    assert.ok(await until(() => w.calls().some((c) => c.cmd === 'login'))); assert.deepEqual(w.calls().find((c) => c.cmd === 'login').args, ['auth', 'login', flag]); await w.logins.cancel(w.acc.id);
  }
  const w = world({ mode: 'hang' });
  for (const bad of ['email', '--email', 'CLAUDEAI', '', 'claudeai --email x', 5, null, {}, ['console'], '__proto__', 'constructor']) { const r = w.logins.start(w.acc.id, bad); assert.deepEqual([r.ok, r.status], [false, 400], String(bad)); }
  assert.equal(w.calls().length, 0, 'nenhum processo iniciado');
});

test('a conta Sistema também faz login (sem CLAUDE_CONFIG_DIR); conta desconhecida 404; Claude Code ausente 409', async () => {
  const w = world({ mode: 'auto' }); assert.equal(w.logins.start('system').ok, true); assert.ok(await finished(w, 'system'));
  assert.equal(snap(w, 'system').state, 'done'); assert.equal(w.calls().find((c) => c.cmd === 'login').dir, null);
  assert.equal(w.logins.start('acc_deadbeef').status, 404); assert.equal(w.logins.start('../x').status, 404);
  const u = world({ loginOver: { unavailable: true } }); const r = u.logins.start(u.acc.id); assert.deepEqual([r.status, r.code], [409, 'claude_missing']);
  const m = world({ loginOver: { command: path.join(tmp, 'nao-existe.exe'), prefixArgs: [] } }); assert.equal(m.logins.start(m.acc.id).ok, true); assert.ok(await finished(m)); assert.equal(snap(m).state, 'failed');
});

test('URLs: só https de claude.ai/claude.com/console.anthropic.com/anthropic.com (e subdomínios), sem credenciais, sem porta; o resto é ignorado', () => {
  const ok = ['https://claude.ai/a', 'https://CLAUDE.AI/a', 'https://claude.com/x?y=1', 'https://console.anthropic.com/oauth', 'https://anthropic.com/', 'https://docs.anthropic.com/x', 'https://www.claude.ai/x'];
  for (const u of ok) assert.ok(L.allowedUrl(u), u);
  const bad = ['http://claude.ai/a', 'https://claude.ai.evil.com/a', 'https://evilclaude.ai/a', 'https://notanthropic.com/', 'https://user:pw@claude.ai/a', 'https://claude.ai@evil.com/a', 'https://claude.ai:8443/a', 'https://evil.com/?u=https://claude.ai', 'ftp://claude.ai/', 'javascript:alert(1)'];
  for (const u of bad) assert.equal(L.allowedUrl(u), null, u);
  assert.equal(L.findUrl('veja https://evil.com/x e depois https://claude.ai/ok. fim'), 'https://claude.ai/ok');
  assert.equal(L.findUrl('(https://claude.ai/ok)'), 'https://claude.ai/ok'); assert.equal(L.findUrl('https://evil.com/x https://claude.ai.evil.com/y'), null);
  assert.equal(L.findUrl('https://claude.ai/parcial', false), null, 'no meio do fluxo, a URL que termina no fim do texto pode estar cortada');
});

test('saída da CLI: ANSI, caracteres de controle e CR removidos; linhas até 300; no máximo 12; a URL longa (>300) sai inteira em `url`', async () => {
  const w = world({ mode: 'ansi' }); w.logins.start(w.acc.id); assert.ok(await until(() => snap(w).state !== 'running' || snap(w).url));
  await sleep(300); const s = snap(w);
  for (const l of s.lines) { assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(l), JSON.stringify(l)); assert.ok(l.length <= 300); assert.ok(!l.includes('[1;32m')); }
  assert.ok(s.lines.includes('Abrindo o navegador')); assert.ok(s.lines.includes('progresso 10%') && s.lines.includes('progresso 90%'), 'CR quebra linha');
  assert.ok(s.url.length > 300 && s.url.startsWith('https://claude.ai/oauth/authorize?code=true') && !/[\u0000-\u001f]/.test(s.url));
  const big = L.cleanLines(`${'x\n'.repeat(50)}\u001b[2J\u001b]8;;http://x\u0007fim`); assert.equal(big.at(-1), 'fim');
});

test('saída com muitas linhas: só as últimas 12', async () => {
  const w = world({ mode: 'hang' }); w.logins.start(w.acc.id); assert.ok(await until(() => snap(w).lines.length > 0));
  assert.ok(snap(w).lines.length <= 12); await w.logins.cancel(w.acc.id);
});

test('input: só em `running`, 1 a 2048 caracteres, sem controle; nunca para outra conta; código errado => failed com erro curto (sem saída bruta)', async () => {
  const w = world(); assert.equal(w.logins.input(w.acc.id, 'x').status, 409, 'sem login em andamento');
  w.logins.start(w.acc.id); assert.ok(await until(() => snap(w).needsCode));
  for (const bad of ['', 'a\nb', 'a\u0000b', 'a\u001b[31m', 'a'.repeat(2049), 5, null, undefined, '\r', '\t', 'a\u2028b']) assert.equal(w.logins.input(w.acc.id, bad).status, 400, JSON.stringify(bad));
  assert.equal(w.logins.input('system', 'GOOD').status, 409, 'não escreve no login de outra conta'); assert.equal(w.logins.input(w.acc.id, 'a'.repeat(2048)).ok, true, 'exatamente 2048 passa');
  assert.ok(await finished(w)); const f = snap(w); assert.equal(f.state, 'failed'); assert.match(f.error, /^O login não foi concluído/); assert.ok(!/boom|segredo/.test(f.error));
  assert.equal(w.logins.input(w.acc.id, 'GOOD').status, 409, 'depois de terminar não há entrada');
  assert.equal(w.calls().filter((c) => c.cmd === 'login-input').length, 1, 'só a entrada válida chegou à CLI'); assert.equal(w.calls().find((c) => c.cmd === 'login-input').len, 2048);
});

test('falha da CLI (saída com erro) => failed com erro curto em português, sem vazar a saída bruta no `error`', async () => {
  const w = world({ mode: 'fail' }); w.logins.start(w.acc.id); assert.ok(await finished(w)); const f = snap(w);
  assert.equal(f.state, 'failed'); assert.equal(f.error, 'O login não foi concluído (a CLI do Claude Code encerrou com erro).'); assert.ok(!f.error.includes('/etc/segredo'));
});

test('`done` só com código 0 E status loggedIn: CLI que sai 0 sem login real => failed', async () => {
  const w = world({ mode: 'nologin' }); w.logins.start(w.acc.id); assert.ok(await finished(w)); const f = snap(w);
  assert.equal(f.state, 'failed'); assert.match(f.error, /não aparece como conectada/); assert.equal((await w.accounts.statusOf(w.acc.id)).loggedIn, false);
  const ok = world({ mode: 'auto' }); ok.logins.start(ok.acc.id); assert.ok(await finished(ok)); assert.equal(snap(ok).state, 'done');
});

test('um login por vez no servidor (outro => 409), em qualquer conta; depois de cancelar libera', async () => {
  const w = world({ mode: 'hang' }); assert.equal(w.logins.start(w.acc.id).ok, true);
  let r = w.logins.start(w.acc.id); assert.deepEqual([r.status, r.code], [409, 'login_busy']); r = w.logins.start('system'); assert.deepEqual([r.status, r.code], [409, 'login_busy']);
  assert.equal(w.calls().filter((c) => c.cmd === 'login').length <= 1, true);
  assert.equal((await w.logins.cancel(w.acc.id)).ok, true); assert.equal(snap(w).state, 'cancelled');
  assert.equal(w.logins.start('system').ok, true); assert.equal(snap(w, 'system').state, 'running'); await w.logins.cancel('system');
});

test('cancelar: estado cancelled, processo encerrado; sem login ativo => 409; cancelar a conta errada não mexe no login', async () => {
  const w = world({ mode: 'tree' }); w.logins.start(w.acc.id); assert.ok(await until(() => fs.existsSync(w.pidFile) && w.calls().some((c) => c.cmd === 'login')));
  const { child, grandchild } = w.pids(); assert.ok(pidAlive(child) && pidAlive(grandchild));
  assert.equal((await w.logins.cancel('system')).status, 409); assert.equal(snap(w).state, 'running');
  assert.equal((await w.logins.cancel(w.acc.id)).ok, true); const s = snap(w); assert.deepEqual([s.state, s.error], ['cancelled', null]);
  assert.ok(await until(() => !pidAlive(child) && !pidAlive(grandchild)), 'a ÁRVORE inteira morreu (filho e neto)');
  assert.equal((await w.logins.cancel(w.acc.id)).status, 409);
});

test('timeout: passado o prazo o login falha com erro claro e a árvore de processos é encerrada', async () => {
  const w = world({ mode: 'tree', loginOver: { timeoutMs: 1500 } }); w.logins.start(w.acc.id); assert.ok(await until(() => fs.existsSync(w.pidFile)));
  const { child, grandchild } = w.pids(); assert.ok(pidAlive(child) && pidAlive(grandchild));
  assert.ok(await finished(w)); const s = snap(w); assert.equal(s.state, 'failed'); assert.match(s.error, /Tempo esgotado/);
  assert.ok(await until(() => !pidAlive(child) && !pidAlive(grandchild)), 'árvore morta no timeout');
  assert.equal(w.logins.start(w.acc.id).ok, true, 'o lock foi liberado'); await w.logins.cancel(w.acc.id);
});

test('shutdown: killActiveSync encerra a árvore do login em andamento', async () => {
  const w = world({ mode: 'tree' }); w.logins.start(w.acc.id); assert.ok(await until(() => fs.existsSync(w.pidFile) && w.calls().some((c) => c.cmd === 'login')));
  const { child, grandchild } = w.pids(); w.logins.killActiveSync();
  assert.ok(await until(() => !pidAlive(child) && !pidAlive(grandchild))); w.logins.killActiveSync(); // sem login ativo: não faz nada
});

test('child-registry: o PID é registrado e liberado ao terminar; registro que falha impede o login e mata o processo', async () => {
  const reg = []; const track = (kind, pid, extra) => { const r = { kind, pid, extra, released: false }; reg.push(r); return { release() { r.released = true; } }; };
  const w = world({ mode: 'auto', loginOver: { track } }); w.logins.start(w.acc.id); assert.ok(await finished(w));
  assert.equal(reg.length, 1); assert.deepEqual([reg[0].kind, Number.isInteger(reg[0].pid), reg[0].released], [L.LOGIN_TRACK_KIND, true, true]);
  const b = world({ mode: 'tree', loginOver: { track: () => { throw new Error('sem disco'); } } }); const r = b.logins.start(b.acc.id);
  assert.deepEqual([r.ok, r.status], [false, 503]); assert.equal(snap(b).state, 'idle');
  // em máquina lenta o processo morre antes de gravar o PID (também vale); se gravou, a árvore tem que estar morta
  if (await until(() => fs.existsSync(b.pidFile), 3000)) { const { child, grandchild } = b.pids(); assert.ok(await until(() => !pidAlive(child) && !pidAlive(grandchild)), 'o processo não ficou vivo sem registro'); }
});

test('remover conta com login em andamento => 409 (e nada é apagado)', async () => {
  const w = world({ mode: 'hang' }); w.logins.start(w.acc.id);
  const r = await w.accounts.remove(w.acc.id); assert.deepEqual([r.status, r.code], [409, 'account_in_use']); assert.equal(fs.existsSync(w.dir), true);
  await w.logins.cancel(w.acc.id); assert.equal((await w.accounts.remove(w.acc.id)).ok, true);
});

test('caminho .cmd (Windows): argumentos de `claude auth` passam na lista permitida; metacaracteres são recusados', async () => {
  const { launchSpec, shellSafeArgs } = await import('../claude-cli.js');
  for (const a of [['auth', 'status'], ['auth', 'logout'], ['auth', 'login'], ['auth', 'login', '--claudeai'], ['auth', 'login', '--console'], ['auth', 'login', '--sso']]) assert.equal(shellSafeArgs(a), true, a.join(' '));
  assert.equal(shellSafeArgs(['auth', 'login', '--email', 'a&b@x.com']), false);
  const cmd = () => ({ file: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\x\\claude.cmd'], viaShell: true });
  const sp = launchSpec({ injected: false }, ['auth', 'login', '--console'], { resolve: cmd }); assert.equal(sp.verbatim, true); assert.equal(sp.args[3], '""C:\\x\\claude.cmd" auth login --console"');
  assert.match(launchSpec({ injected: false }, ['auth', 'x&calc'], { resolve: cmd }).error, /Argumento recusado/);
});

// ---- correções pós-revisão ----
test('limites: no máximo 20 entradas por login (429 input_limit) e intervalo mínimo de 2 s entre inícios (429 login_too_soon, com a espera na mensagem)', async () => {
  assert.deepEqual([L.MAX_INPUTS_PER_LOGIN, L.MIN_START_INTERVAL_MS], [20, 2000]);
  const w = world({ mode: 'hang' }); w.logins.start(w.acc.id);
  for (let i = 0; i < 20; i++) assert.equal(w.logins.input(w.acc.id, `x${i}`).ok, true, `entrada ${i + 1}`);
  const r = w.logins.input(w.acc.id, 'a mais'); assert.deepEqual([r.ok, r.status, r.code], [false, 429, 'input_limit']); assert.equal(w.logins.input(w.acc.id, '').status, 400, 'a validação vem antes');
  await w.logins.cancel(w.acc.id);
  // intervalo mínimo, com relógio simulado
  let t = 10_000; const u = world({ mode: 'hang', loginOver: { minIntervalMs: 2000, clock: () => t } });
  assert.equal(u.logins.start(u.acc.id).ok, true); await u.logins.cancel(u.acc.id);
  let x = u.logins.start(u.acc.id); assert.deepEqual([x.ok, x.status, x.code], [false, 429, 'login_too_soon']); assert.match(x.error, /Aguarde 2 s/);
  t += 1500; x = u.logins.start(u.acc.id); assert.equal(x.status, 429); assert.match(x.error, /Aguarde 1 s/);
  t += 500; assert.equal(u.logins.start(u.acc.id).ok, true, 'passados 2 s'); await u.logins.cancel(u.acc.id);
  const busy = world({ mode: 'hang', loginOver: { minIntervalMs: 2000 } }); busy.logins.start(busy.acc.id); assert.equal(busy.logins.start(busy.acc.id).code, 'login_busy', 'um por vez tem precedência'); await busy.logins.cancel(busy.acc.id);
});

test('saída 0 com status inconclusivo: repete UMA vez; se persistir => failed com a mensagem de confirmação (não "não aparece como conectada")', async () => {
  const w = world({ mode: 'auto', baseEnv: { FAKE_STATUS_GARBAGE: '1' } }); w.logins.start(w.acc.id); assert.ok(await finished(w)); const f = snap(w);
  assert.equal(f.state, 'failed'); assert.equal(f.error, 'Não foi possível confirmar o estado da conta. Feche e confira em Contas.');
  assert.equal(w.calls().filter((c) => c.cmd === 'status').length, 2, 'uma consulta + UMA repetição');
  // inconclusivo na 1ª e conclusivo na 2ª => done
  let n = 0; const run = async () => (++n === 1 ? { err: null, stdout: 'lixo' } : { err: null, stdout: JSON.stringify({ loggedIn: true, email: 'a@b.test' }) });
  const ok = world({ mode: 'auto', accOver: { run } }); ok.logins.start(ok.acc.id); assert.ok(await finished(ok)); assert.equal(snap(ok).state, 'done'); assert.equal(n, 2);
  // conclusivo "não logado" não repete e mantém a mensagem antiga
  let m = 0; const run2 = async () => { m++; return { err: null, stdout: JSON.stringify({ loggedIn: false }) }; };
  const no = world({ mode: 'auto', accOver: { run: run2 } }); no.logins.start(no.acc.id); assert.ok(await finished(no)); assert.match(snap(no).error, /não aparece como conectada/); assert.equal(m, 1);
});

test('janela de confirmação: depois da saída 0, input e cancelar respondem 409 login_closing; ao fim o estado é done', async () => {
  const w = world({ mode: 'auto', baseEnv: { FAKE_STATUS_SLEEP: '1200' } }); w.logins.start(w.acc.id);
  let r; assert.ok(await until(() => { r = w.logins.input(w.acc.id, 'x'); return r.code === 'login_closing'; }, 8000), 'entrou na janela de confirmação');
  assert.deepEqual([r.ok, r.status], [false, 409]); const c = await w.logins.cancel(w.acc.id); assert.deepEqual([c.ok, c.status, c.code], [false, 409, 'login_closing']);
  assert.equal(snap(w).state, 'running'); assert.equal(w.logins.start(w.acc.id).code, 'login_busy', 'o lock segue ocupado');
  assert.ok(await finished(w)); assert.equal(snap(w).state, 'done');
});

test('child-registry: cancelar e timeout só liberam o registro DEPOIS de a morte da árvore ser confirmada; sem confirmação o registro fica', async () => {
  const mkTrack = (reg) => (kind, pid) => { const r = { pid, released: false, aliveAtRelease: null }; reg.push(r); return { release() { r.released = true; r.aliveAtRelease = pidAlive(pid); } }; };
  let reg = []; const w = world({ mode: 'tree', loginOver: { track: mkTrack(reg) } }); w.logins.start(w.acc.id); assert.ok(await until(() => fs.existsSync(w.pidFile) && w.calls().some((c) => c.cmd === 'login')));
  assert.equal(reg[0].released, false); await w.logins.cancel(w.acc.id); assert.deepEqual([reg[0].released, reg[0].aliveAtRelease], [true, false], 'cancelar: liberado só com o processo morto');
  reg = []; const t = world({ mode: 'tree', loginOver: { track: mkTrack(reg), timeoutMs: 1200 } }); t.logins.start(t.acc.id); assert.ok(await finished(t));
  assert.ok(await until(() => reg[0].released), 'timeout: liberado depois'); assert.equal(reg[0].aliveAtRelease, false);
  // encerramento NÃO confirmado: o registro permanece (o boot reclama)
  reg = []; const u = world({ mode: 'tree', loginOver: { track: mkTrack(reg), killTree: async () => {}, goneTimeoutMs: 300 } }); u.logins.start(u.acc.id); assert.ok(await until(() => fs.existsSync(u.pidFile) && u.calls().some((c) => c.cmd === 'login')));
  const { child, grandchild } = u.pids(); await u.logins.cancel(u.acc.id); assert.equal(snap(u).state, 'cancelled'); assert.equal(reg[0].released, false, 'processo ainda vivo: registro mantido');
  u.logins.killActiveSync(); const { killTreeSync } = await import('../orphans.js'); killTreeSync(child); killTreeSync(grandchild); assert.ok(await until(() => !pidAlive(child) && !pidAlive(grandchild)));
});
