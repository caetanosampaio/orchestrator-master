// "Testar integração" (Configurações > Suas IAs): o campo `maestro` de cada terminal na listagem (server/terminals.js), a lógica pura (client/src/integration-check.js) e o
// acompanhamento (client/src/integration-runner.js). Tudo com PTY, Maestro, API e relógio simulados, em pastas temporárias: nenhuma CLI real é aberta, nenhum dado real é tocado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-integ-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.CODEX_HOME = path.join(tmp, 'codex-home'); // terminais do Codex simulados: nunca o ~/.codex real (o models_cache.json lido ao abrir o pane)
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
const T = await import('../terminals.js');
const IC = await import('../../client/src/integration-check.js');
const { createIntegrationRunner } = await import('../../client/src/integration-runner.js');
const src = (rel) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'src', rel), 'utf8');

function world(over = {}) {
  const spawned = [], seen = new Set(); let pid = 1_950_000_000, n = 0;
  const lib = { spawn(file, args, opts) { const p = { pid: ++pid, file, args, opts, onData(cb) { p.feed = cb; }, onExit(cb) { p.exitCb = cb; }, write() {}, resize() {}, exit(code = 0) { p.exitCb({ exitCode: code }); } }; spawned.push(p); return p; } };
  const ws = fs.mkdtempSync(path.join(tmp, 'ws-'));
  const db = { settings: { activeWorkspaceId: 'ws1' }, workspaces: [{ id: 'ws1', name: 'W', path: ws }], worktrees: [], topics: [] };
  const mcp = { serverName: 'forge_ab12cd', issue: (a) => (a.file === false ? { token: 'e'.repeat(48), url: 'http://127.0.0.1:4999/mcp' } : { configPath: path.join(tmp, `${a.terminalId}.json`) }), revoke: (id) => seen.delete(id), connected: (id) => seen.has(id) };
  const fake = (id) => () => ({ file: `/fake/${id}`, args: [], viaShell: false });
  const mgr = T.createTerminalManager({ db, ptyLib: lib, resolveCommand: fake('claude'), resolveCommands: { codex: fake('codex'), gemini: fake('gemini'), opencode: fake('opencode') },
    killTree: () => {}, waitFor: () => true, newSessionId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, mcp, track: () => ({ release() {} }),
    inspectConfig: async () => [], sweepMs: 0, usage: { read: () => null, has: () => true, forget() {} }, persist: () => {}, paneFilesDir: path.join(tmp, `pane-${Math.random().toString(16).slice(2)}`), hookNode: '/usr/bin/node', lockDir: () => true, ...over });
  return { mgr, spawned, seen };
}

test('listagem de terminais: `maestro` = waiting até o terminal autenticar no MCP, connected depois; null sem coordenação ou depois que o terminal acaba', async () => {
  const w = world();
  for (const id of ['claude', 'codex', 'gemini']) {
    const r = await w.mgr.create({ provider: id, role: 'scout', title: `Teste de integração · ${id}` }); assert.equal(r.ok, true, `${id}: ${r.error}`);
    assert.equal(w.mgr.get(r.session.id).maestro, 'waiting', `${id}: recebeu a credencial, ainda não falou com o Maestro`);
    w.seen.add(r.session.id);
    assert.equal(w.mgr.get(r.session.id).maestro, 'connected', `${id}: autenticou`);
    assert.equal(w.mgr.list().find((s) => s.id === r.session.id).maestro, 'connected', `${id}: a listagem (GET /api/terminals) traz o mesmo valor`);
  }
  const free = await w.mgr.create({ provider: 'opencode', role: 'scout' }); assert.equal(free.ok, true, free.error);
  assert.equal(w.mgr.get(free.session.id).maestro, null, 'terminal livre: sem coordenação');
  const g = w.mgr.list().find((s) => s.provider === 'gemini'); w.spawned.find((p) => p.file === '/fake/gemini').exit(0);
  const ended = w.mgr.get(g.id); assert.ok(ended, 'o terminal que acabou continua na listagem'); assert.notEqual(ended.status, 'running'); assert.equal(ended.maestro, null, 'terminal que acabou não aparece como conectado');
});

test('listagem: a credencial foi emitida mas a coordenação NÃO chegou à CLI (arquivos do pane não gravados) = maestro null, não "aguardando" para sempre', async () => {
  const w = world({ paneFilesDir: null }); // sem pasta para os arquivos do pane: o Gemini abre sem o MCP
  const r = await w.mgr.create({ provider: 'gemini', role: 'scout' }); assert.equal(r.ok, true, r.error);
  assert.equal(w.spawned[0].opts.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH, undefined, 'a CLI não recebeu o arquivo com o MCP');
  assert.equal(w.mgr.get(r.session.id).maestro, null);
  const c = await w.mgr.create({ provider: 'claude', role: 'scout' }); assert.equal(w.mgr.get(c.session.id).maestro, 'waiting', 'o Claude recebe o MCP pela linha de comando: não depende dos arquivos do pane');
});

test('integration-check: só IA instalada e com coordenação pode ser testada; o terminal de teste é um Batedor na pasta do workspace; erros de abertura com saída', () => {
  assert.equal(IC.canTestIntegration({ id: 'gemini', available: true, capabilities: { mcp: true, mcpVerified: false } }), true);
  assert.equal(IC.canTestIntegration({ id: 'claude', available: true, capabilities: { mcp: true } }), true);
  assert.equal(IC.canTestIntegration({ id: 'opencode', available: true, capabilities: { mcp: false } }), false, 'terminal livre: nada a testar');
  assert.equal(IC.canTestIntegration({ id: 'gemini', available: false, capabilities: { mcp: true } }), false, 'não instalada');
  assert.equal(IC.canTestIntegration(null), false);
  assert.deepEqual(IC.integrationTerminalBody({ provider: 'gemini', name: 'Gemini' }), { provider: 'gemini', role: 'scout', title: 'Teste de integração · Gemini', isolate: false });
  assert.deepEqual(IC.integrationTerminalBody({ provider: 'claude', name: 'Claude', accountId: 'acc_1', ack: true }), { provider: 'claude', role: 'scout', title: 'Teste de integração · Claude', isolate: false, accountId: 'acc_1', acknowledgeProjectConfig: true });
  assert.equal('acknowledgeProjectConfig' in IC.integrationTerminalBody({ provider: 'x' }), false, 'nunca confirma a configuração do projeto sozinho');
  assert.equal(IC.INTEGRATION_WAIT_MS, 90_000, 'o mesmo prazo que uma etapa de missão dá a um terminal recém-aberto');
  assert.match(IC.integrationOpenError({ code: 'account_required', message: 'x' }), /seletor da barra do workspace/, 'várias contas: diz onde escolher');
  assert.equal(IC.integrationOpenError({ message: 'Nenhum espaço de trabalho ativo' }), 'Nenhum espaço de trabalho ativo');
});

test('integration-check: veredito (abrindo, aguardando, conectou, terminou, sem coordenação, servidor antigo, prazo esgotado que ainda pode virar ok)', () => {
  const t0 = 1_000_000, run = (s, dt, listed = true) => IC.integrationVerdict({ session: s, listed, startedAt: t0, now: t0 + dt });
  const S = (o) => ({ id: 'term_1', status: 'running', maestro: 'waiting', ...o });
  assert.deepEqual([run(null, 500, false).kind, run(null, 500, false).done], ['waiting', false], 'logo depois de abrir a listagem ainda não tem o terminal');
  assert.equal(run(null, 3000, true).kind, 'ended', 'já tinha aparecido e sumiu: terminou');
  assert.match(run(null, 90_000, false).text, /não apareceu na lista/, 'nunca apareceu no prazo');
  const w = run(S(), 12_000); assert.deepEqual([w.kind, w.done], ['waiting', false]); assert.match(w.text, /12 s de 90 s/);
  const ok = run(S({ maestro: 'connected' }), 7_400); assert.deepEqual([ok.kind, ok.done], ['ok', true]); assert.match(ok.text, /em 7 s/);
  assert.equal(run(S({ maestro: 'connected' }), 120_000).kind, 'ok', 'conectou depois do prazo também vale');
  const end = run(S({ status: 'exited', exitCode: 1 }), 5_000); assert.equal(end.kind, 'ended'); assert.match(end.text, /código 1/);
  assert.equal(run(S({ maestro: null }), 2_000).kind, 'nocoord');
  const { maestro, ...old } = S(); assert.equal(run(old, 2_000).kind, 'outdated', 'servidor antigo (sem o campo): pede para reabrir o FORGE, não diz "sem coordenação"');
  const late = run(S(), 90_000); assert.deepEqual([late.kind, late.done], ['timeout', false], 'prazo esgotado não é final'); assert.match(late.text, /continua aberto no Cockpit/); assert.match(late.text, /se atualizar/, 'cita a atualização da CLI (o Codex para nessa pergunta ao abrir)');
});

/** API e relógio simulados para o acompanhamento: `sessions` é o que GET /api/terminals devolve; `posts` registra os POSTs. */
function apiWorld({ createError = null, closeFails = false } = {}) {
  let clock = 1_000_000, seq = 0; const sessions = [], posts = []; let ticker = null, getFails = false;
  const post = async (url, body) => {
    posts.push([url, body]);
    if (url === '/api/terminals') {
      if (createError && !(body.acknowledgeProjectConfig && createError.code === 'project_config_unreviewed')) throw createError;
      const s = { id: `term_t${++seq}`, status: 'running', maestro: 'waiting' }; sessions.push(s); return { session: { id: s.id } };
    }
    const m = /^\/api\/terminals\/([^/]+)\/close$/.exec(url); if (m) { if (closeFails) throw new Error('falhou'); const s = sessions.find((x) => x.id === decodeURIComponent(m[1])); if (s) s.status = 'exited'; return { closed: true }; }
    throw new Error(`rota inesperada ${url}`);
  };
  const get = async () => { if (getFails) throw new Error('fora do ar'); return { sessions: sessions.map((s) => ({ ...s })) }; };
  const confirms = [];
  const runner = createIntegrationRunner({ post, get, now: () => clock, every: (fn) => (ticker = fn), cancel: () => { ticker = null; }, confirm: (e) => { confirms.push(e.code); return true; } });
  return { runner, sessions, posts, confirms, advance: (ms) => { clock += ms; }, ticking: () => !!ticker, setGetFails: (v) => { getFails = v; } };
}

test('acompanhamento: conectou = o terminal de teste é fechado e o teste termina; o estado sobrevive ao componente (um por IA)', async () => {
  const w = apiWorld();
  await w.runner.start({ provider: 'gemini', name: 'Gemini' });
  assert.deepEqual(w.posts[0], ['/api/terminals', { provider: 'gemini', role: 'scout', title: 'Teste de integração · Gemini', isolate: false }]);
  assert.equal(w.runner.state('gemini').busy, true); assert.equal(w.runner.state('gemini').verdict.kind, 'waiting'); assert.equal(w.ticking(), true);
  await w.runner.start({ provider: 'gemini' }); assert.equal(w.posts.length, 1, 'clicar de novo durante o teste não abre outro terminal');
  w.advance(5_000); w.sessions[0].maestro = 'connected'; await w.runner.tick();
  const st = w.runner.state('gemini'); assert.equal(st.verdict.kind, 'ok'); assert.equal(st.open, false); assert.equal(st.busy, false);
  assert.deepEqual(w.posts.at(-1), ['/api/terminals/term_t1/close', undefined], 'o terminal de teste é fechado'); assert.equal(w.sessions[0].status, 'exited');
  assert.equal(w.ticking(), false, 'nada mais a acompanhar: o intervalo para');
  assert.equal(w.runner.state('codex'), null, 'outra IA: nenhum teste');
});

test('acompanhamento: prazo esgotado deixa o terminal aberto e segue de olho (se conectar depois, vira ok); servidor fora do ar não vira "terminou"', async () => {
  const w = apiWorld();
  await w.runner.start({ provider: 'cursor' });
  w.setGetFails(true); w.advance(30_000); await w.runner.tick(); assert.equal(w.runner.state('cursor').verdict.kind, 'waiting', 'leitura falhou: veredito não muda');
  w.setGetFails(false); w.advance(70_000); await w.runner.tick();
  let st = w.runner.state('cursor'); assert.equal(st.verdict.kind, 'timeout'); assert.equal(st.open, true); assert.equal(st.busy, false, 'pode testar de novo'); assert.equal(w.ticking(), true, 'segue de olho');
  assert.ok(!w.posts.some(([u]) => u.endsWith('/close')), 'não fecha o terminal no prazo esgotado');
  w.advance(60_000); w.sessions[0].maestro = 'connected'; await w.runner.tick();
  st = w.runner.state('cursor'); assert.equal(st.verdict.kind, 'ok', 'você aprovou na IA e ela conectou: o resultado muda sozinho'); assert.equal(w.sessions[0].status, 'exited');
  // sem conectar por 10 min: para de acompanhar e deixa o terminal no Cockpit
  const w2 = apiWorld(); await w2.runner.start({ provider: 'copilot' }); w2.advance(10 * 60_000); await w2.runner.tick();
  assert.equal(w2.runner.state('copilot').verdict.kind, 'ended'); assert.match(w2.runner.state('copilot').verdict.text, /parou de acompanhar/); assert.equal(w2.ticking(), false);
  assert.equal(w2.runner.state('copilot').open, true, 'parou de acompanhar com o terminal aberto: o botão de fechar continua'); await w2.runner.close('copilot'); assert.equal(w2.sessions[0].status, 'exited');
  // o terminal terminou sozinho: nada a fechar
  const w3 = apiWorld(); await w3.runner.start({ provider: 'gemini' }); w3.sessions[0].status = 'exited'; await w3.runner.tick(); assert.deepEqual([w3.runner.state('gemini').verdict.kind, w3.runner.state('gemini').open], ['ended', false]);
});

test('acompanhamento: duplo clique em "Testar de novo" abre UM terminal; leitura atrasada não sobrescreve um teste novo; falha ao fechar é avisada', async () => {
  const w = apiWorld();
  await w.runner.start({ provider: 'gemini' }); w.advance(91_000); await w.runner.tick();
  await Promise.all([w.runner.start({ provider: 'gemini' }), w.runner.start({ provider: 'gemini' })]);
  assert.equal(w.sessions.length, 2, 'só um terminal novo'); assert.equal(w.sessions.filter((s) => s.status === 'running').length, 1);
  // leitura em andamento (presa fechando o terminal que conectou) enquanto o usuário fecha o teste: ao terminar, ela NÃO ressuscita o teste como "ok"
  let release; const slowClose = new Promise((res) => { release = res; });
  const r = createIntegrationRunner({ now: () => 0, every: () => 1, cancel: () => {}, get: async () => ({ sessions: [{ id: 'term_a', status: 'running', maestro: 'connected' }] }),
    post: async (url) => { if (url === '/api/terminals') return { session: { id: 'term_a' } }; await slowClose; return {}; } });
  const opening = r.start({ provider: 'cursor' }); // o tick do start fica preso no close do term_a
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
  const closing = r.close('cursor'); release(); await Promise.all([opening, closing]);
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
  assert.equal(r.state('cursor'), null, 'o teste fechado pelo usuário continua fechado');
  // falha ao fechar no "Testar de novo" e no "Fechar": avisa e mantém o terminal para nova tentativa
  const f = apiWorld({ closeFails: true }); await f.runner.start({ provider: 'kimi' }); f.advance(91_000); await f.runner.tick();
  await f.runner.start({ provider: 'kimi' }); assert.equal(f.runner.state('kimi').verdict.kind, 'error'); assert.match(f.runner.state('kimi').verdict.text, /terminal de teste anterior/); assert.equal(f.sessions.length, 1, 'não abriu outro');
  assert.equal(f.runner.state('kimi').open, true, 'o botão de fechar continua para tentar de novo');
  await f.runner.close('kimi'); assert.match(f.runner.state('kimi').verdict.text, /Não foi possível fechar/);
});

test('acompanhamento: "Testar de novo" fecha o terminal de teste anterior (um só por IA); "Fechar terminal de teste" fecha e esquece', async () => {
  const w = apiWorld();
  await w.runner.start({ provider: 'gemini' }); w.advance(91_000); await w.runner.tick(); assert.equal(w.runner.state('gemini').verdict.kind, 'timeout');
  await w.runner.start({ provider: 'gemini' });
  assert.equal(w.sessions[0].status, 'exited', 'o terminal anterior foi fechado'); assert.equal(w.sessions.filter((s) => s.status === 'running').length, 1, 'um só terminal de teste aberto');
  await w.runner.close('gemini'); assert.equal(w.sessions[1].status, 'exited'); assert.equal(w.runner.state('gemini'), null); assert.equal(w.ticking(), false);
});

test('acompanhamento: configuração do projeto não revisada só abre com a confirmação; recusa, várias contas e falha ao fechar viram mensagens claras', async () => {
  const cfg = Object.assign(new Error('Este espaço de trabalho tem configuração do Gemini CLI…'), { code: 'project_config_unreviewed', status: 409 });
  const w = apiWorld({ createError: cfg });
  await w.runner.start({ provider: 'gemini' });
  assert.deepEqual(w.confirms, ['project_config_unreviewed'], 'perguntou'); assert.equal(w.posts[1][1].acknowledgeProjectConfig, true, 'só depois da confirmação');
  const no = apiWorld({ createError: cfg }); no.runner = createIntegrationRunner({ post: async () => { throw cfg; }, get: async () => ({ sessions: [] }), confirm: () => false });
  await no.runner.start({ provider: 'gemini' }); assert.equal(no.runner.state('gemini').verdict.kind, 'error'); assert.match(no.runner.state('gemini').verdict.text, /não foi confirmada/);
  const acc = createIntegrationRunner({ post: async () => { throw Object.assign(new Error('Há mais de uma conta'), { code: 'account_required' }); }, get: async () => ({ sessions: [] }) });
  await acc.start({ provider: 'claude' }); assert.match(acc.state('claude').verdict.text, /seletor da barra do workspace/);
  const cf = apiWorld({ closeFails: true }); await cf.runner.start({ provider: 'gemini' }); cf.sessions[0].maestro = 'connected'; await cf.runner.tick();
  assert.equal(cf.runner.state('gemini').verdict.kind, 'ok'); assert.match(cf.runner.state('gemini').verdict.text, /feche-o no Cockpit/, 'avisa quando não conseguiu fechar');
});

test('Suas IAs: o botão usa o acompanhamento único do app e a confirmação da configuração é uma pergunta ao usuário', () => {
  const s = src('components/settings/AisSection.jsx');
  assert.match(s, /canTestIntegration\(row\) && <IntegrationTest/);
  assert.match(s, /const integration = createIntegrationRunner\(/, 'um acompanhamento no módulo (fora do componente): sobrevive a sair da tela');
  assert.match(s, /confirm: \(e\) => window\.confirm\(/);
});
