// Visão ao vivo da missão (server/mission-live-view.js): allowlist, redação, limites, linha do tempo, Markdown e robustez.
// Funções puras: nenhum banco real, rede ou processo. ORCH_DATA_DIR aponta para um diretório temporário (vazio) só por precaução.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-liveview-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const { buildLiveView, liveMarkdown, redactor, stripControl, squadTasksOf, LIMITS, LIVE_SCHEMA } = await import('../mission-live-view.js');
const { buildWorkflow, missionState, missionProgress } = await import('../../client/src/missions-view.js');
const { missionStatus } = await import('../mission-status.js');

const NOW = '2026-05-01T12:00:00.000Z';
const at = (min) => new Date(Date.parse('2026-05-01T10:00:00.000Z') + min * 60000).toISOString();
const WS = path.join(tmp, 'ws-root'), WT = path.join(tmp, 'wt-root'), DATA = process.env.ORCH_DATA_DIR;

const baseMission = (over = {}) => ({
  id: 'mis_1', workspaceId: 'ws1', title: 'Migrar o módulo de pagamentos', objective: 'Refatorar o módulo.\nSem quebrar a API.', createdAt: at(0), origin: 'user', tasks: [], ...over,
});
const baseCtx = (over = {}) => ({ workspace: { id: 'ws1', name: 'meu-projeto', path: WS, verifications: [] }, worktrees: [], now: () => NOW, ...over });
const cycleMission = () => baseMission({
  tasks: [{ id: 'task_1', title: 'Etapa 1', status: 'running', auto: true, agent: 'claude', startedAt: at(5), log: [
    '[sessão] modelo claude-x · cwd ' + WS, '[claude] Vou editar o arquivo.', '[ferramenta] Edit ' + path.join(WS, 'src', 'a.js'), '[ferramenta] Bash curl -H "Authorization: Bearer abcdefghijkl123" http://x',
    '[stderr] saida crua do terminal', '[stdout] mais saida crua', '[claude] Pronto.', '[erro de ferramenta] falhou ao ler', '[fim] success · 3 turnos',
  ] }],
  cycle: {
    id: 'cyc_1', status: 'running', maxIterations: 5, startedAt: at(1), finishedAt: null, plannerCalls: 2, blockedCode: null, blockedReason: null, blocks: [], humanNotes: [],
    plan: { id: 'plan_1', createdAt: at(2), rationale: 'r', steps: [{ id: 's1', title: 'Etapa 1', dependsOn: [], status: 'queued' }, { id: 's2', title: 'Etapa 2', dependsOn: ['s1'], status: 'queued' }] },
    rounds: [{ n: 1, status: 'running', taskId: 'task_1', agent: 'claude', planId: 'plan_1', stepId: 's1', startedAt: at(5), finishedAt: null, plan: { title: 'Etapa 1' }, report: null }],
    approvals: [], policyLog: [{ at: at(4), round: 1, decision: 'allow', outcome: 'started' }],
  },
});

// ---------- redação ----------
test('redactor: caminhos Windows, POSIX, UNC e raízes viram marcadores', () => {
  const R = redactor({ workspace: { path: 'C:\\Projetos\\Cliente X' }, worktrees: [{ path: 'D:/wt/abc', repoPath: 'C:\\Projetos\\Cliente X' }], dataDir: 'C:\\ORCH\\data', roots: [] });
  const r = (s) => R.text(s, 400);
  assert.equal(r('abrir C:\\Projetos\\Cliente X\\src\\a.js agora'), 'abrir «workspace»\\src\\a.js agora');
  assert.equal(r('c:/projetos/cliente x/src/a.js'), '«workspace»/src/a.js'); // caixa e separador diferentes
  assert.equal(r('em D:\\wt\\abc\\lib\\b.js'), 'em «worktree»\\lib\\b.js');
  assert.match(r('banco C:\\ORCH\\data\\db.json'), /^banco «dados»\\db\.json$/);
  assert.equal(r('ler C:\\Windows\\System32\\drivers\\etc\\hosts ok'), 'ler «caminho» ok');
  assert.equal(r('em \\\\srv01\\compart\\pasta\\x.txt fim'), 'em «caminho» fim');
  assert.equal(r('em /home/ana/projeto/a.js fim'), 'em «caminho» fim');
  assert.equal(r('em /Users/ana/Library/x e /var/log/app.log'), 'em «caminho» e «caminho»');
  assert.equal(r('abrir ~/.ssh/id_rsa agora'), 'abrir «caminho» agora');
  assert.equal(r('file:///C:/Users/ana/x.txt'), '«caminho»');
  assert.ok(!/ana/.test(r('/home/ana/x C:\\Users\\ana\\y')));
  // não destrói URLs nem rotas
  assert.equal(r('veja https://exemplo.com/home/x e GET /api/missions'), 'veja https://exemplo.com/home/x e GET /api/missions');
  // home do SO
  const home = os.homedir();
  if (home && home.length >= 3) assert.ok(!r(`arquivo ${path.join(home, 'segredo', 'x.txt')}`).includes(home));
  // a raiz do disco nunca vira marcador (não destrói o texto)
  assert.equal(redactor({ workspace: { path: '/' } }).text('a/b', 20), 'a/b');
  assert.equal(r('«workspace» e C:\\ProjetosX'), '«workspace» e «caminho»'); // vizinho de nome parecido não é a raiz, mas continua sendo caminho
});

test('redactor: corpus de segredos', () => {
  const R = redactor({}), r = (s) => R.text(s, 600);
  const secrets = [
    'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'sk-proj-abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
    'AKIAIOSFODNN7EXAMPLE', 'xoxb-123456789012-abcdefghijkl', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz',
    'hunter2senha', 'valorMuitoSecreto99',
  ];
  const text = [
    `a chave ${secrets[0]} e ${secrets[1]}`, `token ${secrets[2]}`, secrets[3], `aws ${secrets[4]}`, `slack ${secrets[5]}`, `jwt ${secrets[6]}`,
    'Authorization: Bearer abcdefghijklmnop12345', 'curl -H "Bearer tok_1234567890abcdef" x', `DB_PASSWORD=${secrets[7]}`, `API_KEY: "${secrets[8]}"`, `client_secret = ${secrets[8]}`, 'GITHUB_TOKEN=abc123xyz789',
    'git clone https://user:pass123@github.com/x/y.git',
  ].map(r).join('\n');
  for (const s of [...secrets, 'abcdefghijklmnop12345', 'tok_1234567890abcdef', 'abc123xyz789', 'pass123']) assert.ok(!text.includes(s), `vazou: ${s}`);
  assert.match(r('DB_PASSWORD=hunter2'), /DB_PASSWORD=\*\*\*/);
  // texto comum não é destruído
  assert.equal(r('Implementei a função de soma e os testes passaram.'), 'Implementei a função de soma e os testes passaram.');
  assert.equal(r('task-abcdefghijklmnopqrstuvwxyz'), 'task-abcdefghijklmnopqrstuvwxyz'); // "sk-" só vale como prefixo de palavra
  // idempotente
  const once = r('Bearer abcdefghijklmnop X_TOKEN=zzzzzzzz sk-abcdefghijklmnopqrst');
  assert.equal(r(once), once);
});

test('redactor: bloco PRIVATE KEY (inclusive em várias linhas de log) é removido por inteiro', () => {
  const R = redactor({});
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\n-----END RSA PRIVATE KEY-----';
  const out = R.block(`antes\n${pem}\ndepois`, 2000);
  assert.ok(!out.includes('MIIEow') && !out.includes('yyyyyyyy') && !out.includes('BEGIN'));
  assert.match(out, /antes\n«chave privada removida»\ndepois/);
  // sem o END (truncado): remove até o fim
  assert.ok(!R.text('x -----BEGIN PRIVATE KEY----- MIIEvgIBADANBgkqhkiG9w0BAQEFAASC resto', 300).includes('MIIEvg'));
  // via log da tarefa: cada linha é prefixada com [claude]
  const log = ['[claude] Aqui a chave:', '[claude] -----BEGIN OPENSSH PRIVATE KEY-----', '[claude] b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW', '[claude] -----END OPENSSH PRIVATE KEY-----', '[claude] Fim.'];
  const v = buildLiveView(baseMission({ tasks: [{ id: 't', status: 'running', startedAt: at(1), log }] }), baseCtx());
  const all = JSON.stringify(v);
  assert.ok(!all.includes('b3BlbnNz') && !all.includes('BEGIN OPENSSH'));
  assert.ok(v.recent.some((l) => l.text.includes('chave privada removida')));
});

test('redactor: entradas adversariais longas não causam backtracking explosivo', () => {
  const R = redactor({ workspace: { path: WS } });
  const t0 = Date.now();
  for (const s of ['y'.repeat(100000), 'a-'.repeat(50000), `${'k'.repeat(50000)}=`, `${'/'.repeat(50000)}x`, `${'C:\\'.repeat(20000)}`, `${'-----BEGIN PRIVATE KEY-----'.repeat(2000)}`, `${'Bearer '.repeat(10000)}`, `${'sk-'.repeat(30000)}`, ' '.repeat(100000) + 'x']) {
    R.text(s, 200); R.block(s, 5000);
  }
  assert.ok(Date.now() - t0 < 2000, `demorou ${Date.now() - t0} ms`);
  assert.equal(R.text(`antes ${'Qx9'.repeat(200)} depois`, 100), 'antes «texto longo omitido» depois'); // blob sem espaço não é texto humano nem fica parcialmente visível
});

test('stripControl e redação: ANSI e caracteres de controle removidos', () => {
  assert.equal(stripControl('\u001b[31mvermelho\u001b[0m \u001b]0;título\u0007ok\u0000\u0007\u001b[2K'), 'vermelho ok');
  const R = redactor({});
  assert.equal(R.text('a\u0000b\u0008c\r\nd\u202Ee\u200bf\u009b1mg', 100), 'abc defg'); // controle, bidi, zero-width e CSI C1 saem; a quebra de linha vira espa\u00e7o
  const v = buildLiveView(baseMission({ title: '\u001b[1mTítulo\u001b[0m\u0000 X', objective: 'linha1\u001b[31m\nlinha2\u0007' }), baseCtx());
  assert.equal(v.mission.title, 'Título X');
  assert.equal(v.mission.objective, 'linha1\nlinha2');
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(JSON.stringify(v).replace(/\\n/g, '')));
});

// ---------- allowlist ----------
test('allowlist: nenhum campo proibido; chaves de nível superior e de mission são fixas', () => {
  const m = cycleMission();
  Object.assign(m, { conversation: [{ role: 'user', text: 'SEGREDO-CONVERSA' }], workspacePath: WS, internalNote: 'CAMPO-INTERNO-X', pid: 4242 });
  m.cycle.rounds[0].report = { status: 'success', summary: 'ok', verifications: [{ script: 'test', command: 'npm run COMANDO-BRUTO', outputTail: 'SAIDA-VERIFICACAO', status: 'pass', durationMs: 7, reason: 'RAZAO-X' }], evidence: { level: 'verified', at: at(9) }, filesChanged: [{ path: 'src/a.js', status: 'M' }], exitCode: 0 };
  m.cycle.rounds[0].status = 'succeeded'; m.cycle.rounds[0].finishedAt = at(8); m.cycle.rounds[0].verification = 'passed'; m.cycle.rounds[0].phase = 'done';
  m.tasks[0].log.push('[stdout] SAIDA-CRUA-TERMINAL', '[stderr] ERRO-CRU');
  const ctx = baseCtx({ worktrees: [{ id: 'wt1', missionId: 'mis_1', path: WT, repoPath: WS, attempts: [{ kind: 'integrate', outcome: 'integrated', at: at(10), authorizedBy: 'user', digest: 'DIGEST-WT' }] }] });
  const v = buildLiveView(m, ctx), all = JSON.stringify(v);
  assert.deepEqual(Object.keys(v), ['schema', 'generatedAt', 'link', 'mission', 'progress', 'cycle', 'steps', 'rounds', 'squad', 'current', 'recent', 'approvals', 'verifications', 'delivery', 'timeline', 'notes']);
  assert.deepEqual(Object.keys(v.mission), ['title', 'objective', 'state', 'stateLabel', 'createdAt', 'startedAt', 'finishedAt', 'durationMs', 'workspaceName', 'demo', 'origin']);
  for (const bad of ['SEGREDO-CONVERSA', 'CAMPO-INTERNO-X', 'COMANDO-BRUTO', 'SAIDA-VERIFICACAO', 'RAZAO-X', 'SAIDA-CRUA-TERMINAL', 'ERRO-CRU', 'DIGEST-WT', 'outputTail', 'conversation', WS, WT, tmp, '"path":"C:']) assert.ok(!all.includes(bad), `vazou: ${bad}`);
  assert.deepEqual(Object.keys(v.verifications[0]), ['round', 'script', 'status', 'durationMs']);
  assert.equal(v.schema, LIVE_SCHEMA);
  assert.equal(v.mission.workspaceName, 'meu-projeto');
});

test('ferramentas de shell nunca mostram o comando; [stdout]/[stderr] ficam de fora; [claude] aparece recortado', () => {
  const v = buildLiveView(cycleMission(), baseCtx());
  const txt = v.recent.map((l) => `${l.kind}:${l.text}`);
  assert.ok(txt.includes('agent:Vou editar o arquivo.'));
  assert.ok(txt.includes('tool:Bash'), 'só o nome da ferramenta de shell');
  assert.ok(!JSON.stringify(v).includes('curl'));
  assert.ok(txt.some((t) => t.startsWith('tool:Edit «workspace»')), 'caminho de ferramenta relativo ao workspace');
  assert.ok(txt.includes('system:sessão iniciada (modelo claude-x)'));
  assert.ok(!txt.some((t) => t.includes('saida crua')));
  assert.ok(txt.includes('end:fim: success · 3 turnos'));
  assert.ok(v.recent.every((l) => l.text.length <= LIMITS.recentLine));
});

// ---------- limites ----------
test('limites: recent <= 30 linhas de <= 180; 50 tarefas x 600 linhas cabe em 256 KB', () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, title: `Tarefa ${i}`, status: i === 49 ? 'running' : 'completed', startedAt: at(i), log: Array.from({ length: 600 }, (__, k) => `[claude] linha ${i}-${k} ${'x'.repeat(2000)}`) }));
  const v = buildLiveView(baseMission({ tasks }), baseCtx());
  assert.equal(v.recent.length, LIMITS.recent);
  assert.ok(v.recent.every((l) => l.text.length <= LIMITS.recentLine && l.kind === 'agent'));
  assert.ok(v.recent.at(-1).text.startsWith('linha 49-599'), 'as mais recentes da tarefa mais recente');
  assert.ok(Buffer.byteLength(JSON.stringify(v)) <= LIMITS.bytes);
  assert.equal(v.current.what.startsWith('Executando a tarefa: Tarefa 49'), true);
});

test('limites: timeline <= 300 com omitted, arquivos <= 50, limitações <= 10, tudo <= 256 KB mesmo com texto enorme', () => {
  const m = cycleMission();
  m.cycle.blocks = Array.from({ length: 450 }, (_, i) => ({ code: 'c', reason: `motivo ${i} ${'y'.repeat(5000)}`, at: at(20 + i) }));
  m.cycle.humanNotes = Array.from({ length: 50 }, (_, i) => ({ at: at(600 + i), text: 'z'.repeat(3000) }));
  m.title = 'T'.repeat(9000); m.objective = 'O'.repeat(90000);
  const files = Array.from({ length: 120 }, (_, i) => ({ path: `src/f${i}.js`, status: 'M', added: i, removed: 0 }));
  const delivery = { schemaVersion: 1, state: { code: 'completed', delivered: true }, assurance: { level: 'verified' }, observed: { files: { total: 120, items: files } }, limitations: Array.from({ length: 25 }, (_, i) => `limitação ${i} ${'w'.repeat(900)}`) };
  const v = buildLiveView(m, baseCtx({ delivery }));
  assert.equal(v.timeline.items.length, LIMITS.timeline);
  assert.ok(v.timeline.omitted >= 450 + 50 - LIMITS.timeline);
  assert.equal(v.delivery.files.items.length, LIMITS.files);
  assert.equal(v.delivery.files.total, 120);
  assert.equal(v.delivery.limitations.length, LIMITS.limitations);
  assert.ok(v.delivery.limitations.every((l) => l.length <= 300));
  assert.ok(v.mission.title.length <= 200 && v.mission.objective.length <= 1000);
  assert.ok(v.notes.some((n) => /omitida/.test(n)));
  assert.ok(Buffer.byteLength(JSON.stringify(v)) <= LIMITS.bytes);
});

test('limites: o teto de 256 KB é imposto cortando as listas maiores (e a visão mínima é o último recurso)', () => {
  const m = cycleMission();
  const files = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, status: 'M' }));
  // 100 etapas + 60 rodadas + 100 verificações + 50 squad com textos grandes
  m.cycle.plan.steps = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, title: 'etapa '.repeat(200), dependsOn: Array.from({ length: 20 }, (__, k) => 'dep-' + 'd'.repeat(50) + '-' + k) }));
  m.cycle.rounds = Array.from({ length: 80 }, (_, i) => ({ n: i + 1, status: 'succeeded', agent: 'claude', startedAt: at(i), finishedAt: at(i + 1), plan: { title: 'rodada '.repeat(150) }, report: { verifications: Array.from({ length: 30 }, (__, k) => ({ script: 'script '.repeat(40), status: 'pass', durationMs: k })) } }));
  m.cycle.blocks = Array.from({ length: 400 }, (_, i) => ({ code: 'c', reason: `motivo ${i} ${'bloco '.repeat(80)}`, at: at(20 + i) }));
  m.cycle.approvals = Array.from({ length: 60 }, (_, i) => ({ id: `apr_${i}`, round: i, status: 'approved', createdAt: at(i), decidedAt: at(i + 1), action: { title: 'acao '.repeat(100) } }));
  const squad = { sessions: [{ id: 'p1', workspaceId: 'ws1', title: 'P'.repeat(500) }], tasks: Array.from({ length: 50 }, (_, i) => ({ id: `task_${i}`, to: 'p1', from: 'p1', status: 'done', text: 'texto '.repeat(800), summary: 'resumo '.repeat(800), createdAt: at(i), doneAt: at(i + 1) })) };
  const v = buildLiveView(m, baseCtx({ squad, delivery: { state: { code: 'x' }, observed: { files: { items: files } } } }));
  assert.ok(Buffer.byteLength(JSON.stringify(v)) <= LIMITS.bytes);
  assert.equal(v.schema, 1);
  assert.ok(v.notes.some((n) => /256 KB/.test(n)), 'o corte foi necessário e foi avisado');
  assert.ok(v.steps.length < 100 || v.rounds.length < 60 || v.verifications.length < 100);
});

// ---------- linha do tempo ----------
test('timeline: ordem cronológica estável, idempotente, itens sem data válida ficam de fora (com aviso)', () => {
  const m = cycleMission();
  const c = m.cycle;
  c.rounds[0] = { ...c.rounds[0], status: 'succeeded', finishedAt: at(8), verification: 'passed', phase: 'done', decision: { decision: 'continue', rationale: 'segue', at: at(9) }, report: { status: 'success', evidence: { level: 'verified', at: at(8.5) } } };
  c.approvals = [{ id: 'apr_1', round: 2, status: 'approved', createdAt: at(11), decidedAt: at(12), decidedBy: 'user', action: { title: 'Instalar dependência' } }];
  c.blocks = [{ code: 'approval_required', reason: 'aguardando', at: at(11) }];
  c.humanNotes = [{ at: at(13), text: 'use TypeScript' }, { at: 'ontem de manhã', text: 'sem data' }];
  c.acceptance = { kind: 'unverified_acceptance', by: 'user', at: at(14), round: 1, reason: 'aceito' };
  c.status = 'completed'; c.finishedAt = at(15);
  const ctx = baseCtx({ worktrees: [{ missionId: 'mis_1', path: WT, attempts: [{ kind: 'integrate', outcome: 'integrated', at: at(16) }, { kind: 'check', result: 'ok', at: at(3) }] }, { missionId: 'outra', attempts: [{ kind: 'x', at: at(1) }] }] });
  const a = buildLiveView(m, ctx), b = buildLiveView(JSON.parse(JSON.stringify(m)), ctx);
  assert.deepEqual(a, b, 'idempotente (mesmo agora)');
  const ts = a.timeline.items.map((i) => Date.parse(i.at));
  assert.deepEqual(ts, [...ts].sort((x, y) => x - y));
  const kinds = new Set(a.timeline.items.map((i) => i.kind));
  for (const k of ['mission', 'cycle', 'plan', 'round', 'decision', 'evidence', 'approval', 'policy', 'block', 'note', 'acceptance', 'worktree']) assert.ok(kinds.has(k), `sem ${k}`);
  assert.equal(a.timeline.items[0].text, 'Missão criada');
  assert.equal(a.timeline.items.at(-1).text, 'Worktree: integrate → integrated');
  assert.ok(a.notes.some((n) => /sem data válida/.test(n)));
  assert.ok(!a.timeline.items.some((i) => i.text.includes('sem data')));
  assert.equal(a.timeline.omitted, 0);
  assert.ok(a.timeline.items.every((i) => !i.text.includes(WT)));
  assert.equal(a.mission.state, 'completed');
});

test('timeline: instantes iguais mantêm a ordem de geração (estável)', () => {
  const m = baseMission({ cycle: { id: 'c', status: 'blocked', maxIterations: 3, startedAt: at(1), blocks: [{ code: 'A', reason: 'um', at: at(5) }, { code: 'B', reason: 'dois', at: at(5) }, { code: 'A', reason: 'um', at: at(5) }], rounds: [], humanNotes: [] } });
  const t = buildLiveView(m, baseCtx()).timeline.items.filter((i) => i.kind === 'block').map((i) => i.text);
  assert.deepEqual(t, ['Ciclo bloqueado (A): um', 'Ciclo bloqueado (B): dois']); // o duplicado exato some
});

// ---------- current, estados, progresso ----------
test('current: descreve o que a missão faz agora', () => {
  const run = buildLiveView(cycleMission(), baseCtx());
  assert.deepEqual(run.current, { what: 'Executando a rodada 1: Etapa 1', agent: 'Executor (claude)', since: at(5) });
  assert.equal(run.mission.state, 'working');
  assert.equal(run.mission.durationMs, Date.parse(NOW) - Date.parse(at(1)));
  assert.deepEqual(run.progress, { basis: 'etapas', done: 0, total: 2, pct: 0 });

  const planning = cycleMission(); planning.cycle.status = 'planning'; planning.cycle.rounds = []; planning.tasks = [];
  assert.equal(buildLiveView(planning, baseCtx()).current.agent, 'Planner');

  const verifying = cycleMission(); Object.assign(verifying.cycle.rounds[0], { status: 'succeeded', phase: 'verifying', finishedAt: at(7) });
  assert.match(buildLiveView(verifying, baseCtx()).current.what, /^Verificando a rodada 1/);

  const appr = cycleMission(); Object.assign(appr.cycle, { status: 'blocked', blockedCode: 'approval_required', blockedReason: 'precisa de aprovação', approvals: [{ id: 'apr_9', status: 'pending', round: 2, createdAt: at(30), action: { title: 'Rodar npm install' } }] });
  const va = buildLiveView(appr, baseCtx());
  assert.equal(va.mission.state, 'approval');
  assert.match(va.current.what, /^Aguardando a sua decisão: Rodar npm install/);
  assert.deepEqual(va.approvals, [{ id: 'apr_9', round: 2, title: 'Rodar npm install', status: 'pending', createdAt: at(30) }]);

  const blocked = cycleMission(); Object.assign(blocked.cycle, { status: 'blocked', blockedCode: 'no_progress', blockedReason: `parou em ${WS}\\x com token=abc12345`, blocks: [{ code: 'no_progress', reason: 'x', at: at(40) }] });
  const vb = buildLiveView(blocked, baseCtx());
  assert.equal(vb.mission.state, 'attention');
  assert.equal(vb.current.since, at(40));
  assert.ok(!JSON.stringify(vb).includes(WS) && !JSON.stringify(vb).includes('abc12345'));
  assert.equal(vb.cycle.blockedReason, 'parou em «workspace»\\x com token=***');

  const done = cycleMission(); done.cycle.status = 'completed'; done.cycle.finishedAt = at(20); done.tasks = [];
  const vd = buildLiveView(done, baseCtx());
  assert.equal(vd.current, null);
  assert.equal(vd.mission.finishedAt, at(20));
  assert.equal(vd.mission.durationMs, 19 * 60000);
});

test('paridade com o cliente: estado, progresso e vínculo de tarefas do Maestro', () => {
  const variants = [cycleMission(), baseMission(), baseMission({ tasks: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }] }), baseMission({ cycle: { id: 'c', status: 'limit_reached', rounds: [], maxIterations: 2 } })];
  const done = cycleMission(); done.cycle.status = 'completed'; variants.push(done);
  for (const m of variants) {
    const v = buildLiveView(m, baseCtx());
    const clientM = { ...m, status: missionStatus(m) };
    assert.equal(v.mission.state, missionState(clientM), 'estado');
    const p = missionProgress(clientM);
    if (v.progress) { assert.equal(v.progress.basis, p.basis); assert.equal(v.progress.total, p.total); assert.equal(v.progress.done, p.done); assert.equal(v.progress.pct, p.pct); } else assert.equal(p.basis, null);
  }
  // vínculo do Maestro: mesmos ids na mesma ordem que os nós "task" do workflow do cliente
  const m = baseMission({ cycle: { id: 'c', status: 'completed', startedAt: at(10), rounds: [] } });
  const sessions = [{ id: 'p1', workspaceId: 'ws1', status: 'running', title: 'Dev', role: 'dev' }, { id: 'p2', workspaceId: 'ws1', status: 'running', role: 'qa' }, { id: 'px', workspaceId: 'outro', status: 'running' }];
  const mt = [
    { id: 'old', to: 'p1', from: 'p2', status: 'done', createdAt: at(5), text: 'antiga' }, // antes do início da missão
    { id: 'k2', to: 'p2', from: 'p1', status: 'delivered', createdAt: at(30), text: 'segunda' },
    { id: 'k1', to: 'p1', from: 'p2', status: 'done', createdAt: at(20), doneAt: at(25), text: 'primeira' },
    { id: 'alien', to: 'px', from: 'p1', status: 'done', createdAt: at(21), text: 'de outro workspace' },
    { id: 'ghost', to: 'p-fechado', from: 'desconhecido', status: 'done', createdAt: at(22), text: 'pane sumido sem pista' },
    { id: 'viaFrom', to: 'p-fechado2', from: 'p1', status: 'done', createdAt: at(23), text: 'remetente do workspace' },
    { id: 'viaPane', to: 'p-fechado2', from: 'x', status: 'done', createdAt: at(24), text: 'mesmo pane já ligado' },
  ];
  const wf = buildWorkflow(m, { sessions, maestro: { tasks: mt } });
  const clientIds = wf.nodes.filter((n) => n.kind === 'task').map((n) => n.taskId);
  assert.deepEqual(squadTasksOf(m, { tasks: mt, sessions }).map((x) => x.task.id), clientIds);
  assert.deepEqual(clientIds, ['k1', 'viaFrom', 'viaPane', 'k2']);
  const v = buildLiveView(m, baseCtx({ squad: { tasks: mt, sessions } }));
  assert.deepEqual(v.squad.tasks.map((t) => t.id), clientIds);
  assert.match(v.squad.note, /só em memória/);
  assert.deepEqual(v.squad.tasks[0].to, { title: 'Dev', role: 'dev', provider: 'claude', model: null });
});

// ---------- missões atípicas ----------
test('missão sem ciclo e só squad: seção squad, linha do tempo e current do Maestro', () => {
  const sessions = [{ id: 'p1', workspaceId: 'ws1', status: 'running', title: 'Dev', roleLabel: 'Desenvolvedor', provider: 'codex', model: 'gpt-x' }];
  const tasks = [{ id: 'k1', to: 'p1', from: 'p1', toTitle: 'Dev', status: 'delivered', createdAt: at(3), text: 'Implementar login\ncom senha', summary: null }, { id: 'k0', to: 'p1', status: 'done', createdAt: at(1), doneAt: at(2), text: 'Ler o código', summary: 'feito em C:\\Users\\ana\\proj' }];
  const v = buildLiveView(baseMission(), baseCtx({ squad: { tasks, sessions } }));
  assert.equal(v.cycle, null); assert.deepEqual(v.steps, []);
  assert.deepEqual(v.squad.tasks.map((t) => t.id), ['k0', 'k1']);
  assert.equal(v.squad.tasks[0].summary, 'feito em «caminho»');
  assert.deepEqual(v.squad.tasks[1].to, { title: 'Dev', role: 'Desenvolvedor', provider: 'codex', model: 'gpt-x' });
  assert.equal(v.current.what, 'Maestro: 1 tarefa(s) em andamento: Implementar login');
  assert.equal(v.current.agent, 'Dev'); assert.equal(v.current.since, at(3));
  assert.equal(v.mission.state, 'idle'); // o estado da missão não é inventado pelo squad
  assert.ok(v.timeline.items.some((i) => i.kind === 'squad' && /concluída/.test(i.text)));
  // sem sessões, nada é ligado (nunca adivinhado), mas a seção existe para a missão sem ciclo
  const none = buildLiveView(baseMission(), baseCtx({ squad: { tasks } }));
  assert.deepEqual(none.squad.tasks, []);
  // sem `squad` no contexto, sem seção
  assert.equal(buildLiveView(baseMission(), baseCtx()).squad, null);
  // missão com ciclo e sem tarefas ligadas: sem seção
  assert.equal(buildLiveView(cycleMission(), baseCtx({ squad: { tasks: [], sessions } })).squad, null);
});

test('missão demonstrativa: nada executado, sem ciclo/log/entrega', () => {
  const m = cycleMission(); m.demo = true;
  const v = buildLiveView(m, baseCtx({ squad: { tasks: [{ id: 'k', to: 'p1' }], sessions: [{ id: 'p1', workspaceId: 'ws1' }] } }));
  assert.equal(v.mission.demo, true);
  assert.equal(v.current, null); assert.deepEqual(v.recent, []); assert.equal(v.delivery, null); assert.equal(v.squad, null);
  assert.ok(v.notes.includes('Missão demonstrativa: nada foi executado.'));
  assert.deepEqual(v.timeline.items.map((i) => i.text), ['Missão criada']);
});

test('ciclo legado: sem plano, sem relatório, campos ausentes viram null', () => {
  const m = baseMission({ cycle: { id: 'old', status: 'completed', rounds: [{ n: 1, status: 'succeeded', phase: 'done', plan: { title: 'x' } }, { n: 2, status: 'succeeded', phase: 'done', report: { verifications: [{ script: 'test', status: 'pass' }] } }] } });
  const v = buildLiveView(m, baseCtx());
  assert.equal(v.cycle.maxIterations, null); assert.equal(v.cycle.round, 2);
  assert.deepEqual(v.steps, []);
  assert.deepEqual(v.progress, { basis: 'rodadas', done: 2, total: null, pct: 100 });
  assert.equal(v.rounds[0].startedAt, null); assert.equal(v.rounds[1].title, '');
  assert.deepEqual(v.verifications, [{ round: 2, script: 'test', status: 'pass', durationMs: null }]);
  assert.equal(v.mission.startedAt, null); assert.equal(v.mission.durationMs, null);
});

test('NUNCA lança: valores malformados, tipos errados e objetos hostis', () => {
  const hostile = { get title() { throw new Error('boom'); } };
  const cyc = new Proxy({}, { get() { throw new Error('proxy'); }, ownKeys() { throw new Error('proxy'); } });
  const circular = { a: 1 }; circular.self = circular;
  const weird = [undefined, null, 0, 1, NaN, '', 'x', true, [], {}, [1, 2], () => 1, Symbol('s'), 10n, hostile, cyc, circular, new Date(NaN)].filter((x) => typeof x !== 'symbol' && typeof x !== 'bigint');
  for (const x of [...weird, Symbol('s'), 10n]) {
    assert.doesNotThrow(() => buildLiveView(x, baseCtx()), `missão ${String(typeof x)}`);
    assert.doesNotThrow(() => buildLiveView(baseMission(), x), `ctx ${String(typeof x)}`);
    const v = buildLiveView(x, x); assert.equal(v.schema, 1); assert.equal(typeof JSON.stringify(v), 'string');
  }
  for (const x of weird) {
    const m = baseMission({ title: x, objective: x, createdAt: x, origin: x, demo: x, tasks: x, cycle: x });
    assert.doesNotThrow(() => buildLiveView(m, baseCtx({ squad: x, worktrees: x, delivery: x, now: x, workspace: x })));
    const m2 = cycleMission();
    Object.assign(m2.cycle, { rounds: [x, { n: x, status: x, plan: x, report: x, decision: x, startedAt: x, agent: x }], plan: { steps: [x, { id: x, title: x, dependsOn: x }] }, approvals: [x, { id: x, action: x, createdAt: x }], policyLog: x, blocks: [x], humanNotes: x, acceptance: x, maxIterations: x, startedAt: x, finishedAt: x });
    m2.tasks = [x, { id: x, log: x, startedAt: x, status: x }, { id: 't', log: [x, 5, null, '[claude] ok'], status: 'running', startedAt: x }];
    const v = buildLiveView(m2, baseCtx({ squad: { tasks: [x, { id: 'k', to: x, text: x }], sessions: [x] }, worktrees: [x, { missionId: 'mis_1', attempts: [x, { at: x }] }] }));
    assert.equal(v.schema, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(v)) <= LIMITS.bytes);
    assert.doesNotThrow(() => liveMarkdown(v));
    assert.doesNotThrow(() => liveMarkdown(x));
  }
  // uma seção quebrada não derruba as demais
  const m3 = cycleMission(); m3.cycle.plan.steps = [{ id: 's1', get title() { throw new Error('x'); } }];
  const v3 = buildLiveView(m3, baseCtx());
  assert.deepEqual(v3.steps, []); assert.ok(v3.notes.some((n) => /etapas/.test(n))); assert.equal(v3.mission.title, 'Migrar o módulo de pagamentos');
});

test('idempotência: mesmo agora => resultado idêntico; agora diferente só muda generatedAt/duração', () => {
  const m = cycleMission();
  const a = buildLiveView(m, baseCtx()), b = buildLiveView(m, baseCtx());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = buildLiveView(m, baseCtx({ now: () => '2026-05-01T12:05:00.000Z' }));
  assert.notEqual(c.generatedAt, a.generatedAt);
  assert.equal(c.mission.durationMs - a.mission.durationMs, 5 * 60000);
  assert.deepEqual(c.timeline, a.timeline);
  // o mesmo agora em formatos diferentes
  assert.equal(buildLiveView(m, baseCtx({ now: NOW })).generatedAt, NOW);
  assert.equal(buildLiveView(m, baseCtx({ now: new Date(NOW) })).generatedAt, NOW);
  assert.equal(buildLiveView(m, baseCtx({ now: Date.parse(NOW) })).generatedAt, NOW);
  assert.equal(buildLiveView(m, baseCtx({ link: { expiresAt: at(900) } })).link.expiresAt, at(900));
  assert.equal(a.link.expiresAt, null);
  // não altera a missão
  const before = JSON.stringify(m); buildLiveView(m, baseCtx()); assert.equal(JSON.stringify(m), before);
});

test('entrega: recomputada de delivery.js quando o contexto não a traz; aceita { ok, report }', () => {
  const m = cycleMission();
  Object.assign(m.cycle, { status: 'completed', finishedAt: at(20) });
  Object.assign(m.cycle.rounds[0], { status: 'succeeded', phase: 'done', verification: 'none', report: { status: 'success', filesChanged: [{ path: 'src/a.js', status: 'M', added: 3, removed: 1 }], evidence: { level: 'verified' } } });
  const v = buildLiveView(m, baseCtx());
  assert.equal(v.delivery.code, 'completed');
  assert.deepEqual(v.delivery.files.items, [{ path: 'src/a.js', status: 'M', added: 3, removed: 1, preexisting: false }]);
  assert.ok(Array.isArray(v.delivery.limitations));
  const viaOk = buildLiveView(m, baseCtx({ delivery: { ok: true, report: { state: { code: 'blocked', delivered: false }, assurance: { level: 'x' }, limitations: [`ver ${WS}`] } } }));
  assert.equal(viaOk.delivery.code, 'blocked'); assert.deepEqual(viaOk.delivery.limitations, ['ver «workspace»']);
  assert.equal(buildLiveView(m, baseCtx({ delivery: { ok: false, error: 'x' } })).delivery, null);
});

// ---------- Markdown ----------
test('liveMarkdown: cercas maiores que qualquer sequência de crases, < escapado, ](…) e javascript: neutralizados', () => {
  const evil = 'x ```` fim ``` <script>alert(1)</script> [clique](javascript:alert(1)) JAVASCRIPT:alert(2) ![i](https://e.com/p.png) <https://auto.link>';
  const snap = buildLiveView(baseMission({ title: evil, objective: evil, tasks: [{ id: 't', status: 'running', startedAt: at(1), log: [`[claude] ${evil}`] }] }), baseCtx());
  snap.timeline.items.push({ at: at(1), kind: 'note', text: evil });
  snap.notes.push(evil); snap.delivery = { code: 'x', delivered: false, assurance: 'x', limitations: [evil], files: { total: 1, items: [{ path: evil, status: 'M' }] } };
  const md = liveMarkdown(snap);
  assert.equal(typeof md, 'string');
  assert.ok(!md.includes('<'), 'nenhum "<" cru (sem HTML nem autolink)');
  assert.ok(!md.includes(']('), 'sem sintaxe de link');
  assert.ok(!/javascript\s*:/i.test(md));
  // cada bloco cercado: a cerca de abertura é maior que qualquer sequência de crases do corpo e fecha de verdade
  const lines = md.split('\n'); let open = null, longestBody = 0, blocks = 0;
  for (const l of lines) {
    const fm = /^(`{3,})(text)?$/.exec(l);
    if (open === null && fm && fm[2]) { open = fm[1].length; longestBody = 0; continue; }
    if (open !== null && fm && !fm[2] && fm[1].length === open) { assert.ok(open > longestBody, `cerca ${open} <= crases do corpo ${longestBody}`); open = null; blocks++; continue; }
    if (open !== null) for (const run of l.match(/`+/g) ?? []) longestBody = Math.max(longestBody, run.length);
  }
  assert.equal(open, null, 'todo bloco fecha'); assert.ok(blocks >= 3);
  assert.ok(md.includes('````'), 'o objetivo (4 crases) exige cerca de 5');
  assert.ok(md.split('\n').some((l) => l === '`````text'));
  // sem crases cruas fora de cercas: o texto inline escapa
  const outside = []; let inFence = false;
  for (const l of lines) { if (/^`{3,}/.test(l)) { inFence = !inFence; continue; } if (!inFence) outside.push(l); }
  assert.ok(outside.every((l) => !/(^|[^\\])`/.test(l)), 'crases fora de cerca devem estar escapadas');
});

test('liveMarkdown: relatório coerente e não vaza o que a visão já removeu', () => {
  const m = cycleMission(); m.title = 'Título # com | símbolos *x*';
  const v = buildLiveView(m, baseCtx({ squad: { tasks: [], sessions: [] } }));
  const md = liveMarkdown(v);
  assert.ok(md.startsWith('# Título \\# com \\| símbolos \\*x\\*\n'));
  for (const sec of ['## Objetivo', '## Agora', '## Progresso', '## Etapas do plano', '## Rodadas', '## Linha do tempo', '## Atividade recente do agente']) assert.ok(md.includes(sec), sec);
  assert.ok(md.endsWith('\n'));
  assert.ok(!md.includes(WS) && !md.includes('Bearer abcdefghijkl123') && !md.includes('curl'));
  assert.equal(liveMarkdown(undefined).startsWith('# '), true);
  assert.equal(liveMarkdown('x').startsWith('# '), true);
  assert.equal(liveMarkdown(v), liveMarkdown(v), 'determinístico');
});
