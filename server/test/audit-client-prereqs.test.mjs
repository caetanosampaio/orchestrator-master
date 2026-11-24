// Pré-requisitos do primeiro uso: a lógica (pura) que alimenta o popup "Antes de começar" (client/src/prereqs.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prereqIssues, issueKey, hasBlocking, canContinue, inlineParts, PREREQ, RESTART_HINT } from '../../client/src/prereqs.js';

const ok = { available: true, version: '1.0.0', detail: '' };
const off = (detail = 'não encontrado') => ({ available: false, version: null, detail });
const login = (loggedIn, known = true) => ({ known, loggedIn: known ? loggedIn : null, detail: '' });
const st = (p) => ({ prereqs: { claude: ok, git: ok, login: login(true), ...p } });
// provedores de /api/terminals: o Codex só entra na decisão com a lista carregada (array); o padrão aqui é "sem Codex"
const noCodex = [{ id: 'claude', available: false }, { id: 'codex', available: false }];
const withCodex = (auth) => [{ id: 'claude', available: false }, { id: 'codex', available: true, ...(auth ? { auth } : {}) }];
const ids = (s, providers = noCodex) => prereqIssues(s, providers).map((i) => i.id);

test('tudo certo, ou servidor ainda sem resposta: nenhuma pendência (o popup não aparece)', () => {
  assert.deepEqual(prereqIssues(st({})), []);
  assert.deepEqual(prereqIssues(null), []); assert.deepEqual(prereqIssues(undefined), []); assert.deepEqual(prereqIssues('x'), []);
});

test('nenhuma IA (Claude Code e Codex ausentes): pendência BLOQUEANTE e primeira da lista', () => {
  const [c] = prereqIssues(st({ claude: off() }), noCodex);
  assert.equal(c.id, 'agent'); assert.equal(c.blocking, true); assert.equal(hasBlocking([c]), true);
  assert.match(c.title, /Nenhuma IA encontrada/); assert.ok(c.steps.length >= 3);
  assert.match(c.text, /Claude Code ou Codex CLI/);
});

test('Claude Code ausente mas Codex instalado: NÃO bloqueia (basta uma IA); o login é o do servidor (alguma conta de alguma IA), não um aviso por IA', () => {
  assert.deepEqual(ids(st({ claude: off() }), withCodex()), [], 'Codex disponível e alguma conta conectada: nada a avisar');
  assert.deepEqual(ids(st({ claude: off() }), withCodex({ known: true, loggedIn: false })), [], 'a sonda própria do Codex não gera aviso: quem decide é prereqs.login');
  const [x] = prereqIssues(st({ claude: off(), login: login(false) }), withCodex());
  assert.equal(x.id, 'login'); assert.equal(x.blocking, false); assert.equal(hasBlocking([x]), false);
  assert.equal(canContinue({ issues: [x], tries: 0 }), true);
  assert.deepEqual(ids(st({ claude: off(), login: login(false, false) }), withCodex()), [], 'login desconhecido: sem aviso falso');
});

test('Claude Code instalado: o Codex ausente ou desconectado não gera pendência própria', () => {
  assert.deepEqual(prereqIssues(st({}), noCodex), []);
  assert.deepEqual(prereqIssues(st({}), [{ id: 'codex', available: true, auth: { known: true, loggedIn: false } }]), []);
  assert.equal(Object.hasOwn(PREREQ, 'codexLogin'), false, 'não há pendência de login por IA');
});

test('Claude Code ausente com os provedores ainda não carregados: espera (sem bloqueio piscando para quem usa só Codex)', () => {
  assert.deepEqual(prereqIssues(st({ claude: off() })), []); assert.deepEqual(prereqIssues(st({ claude: off() }), null), []); assert.deepEqual(prereqIssues(st({ claude: off() }), undefined), []);
  assert.deepEqual(prereqIssues(st({ claude: off(), git: off() }), null).map((i) => i.id), ['git'], 'o resto continua sendo avisado');
});

test('login: nenhuma conta conectada de NENHUMA IA, só quando o servidor TEM certeza; é informativo (não bloqueia)', () => {
  assert.deepEqual(ids(st({ login: login(false) })), ['login']);
  assert.equal(prereqIssues(st({ login: login(false) }))[0].blocking, false);
  assert.match(PREREQ.login.title, /Nenhuma conta conectada/); assert.doesNotMatch(PREREQ.login.title, /Claude/, 'o aviso não é de uma IA específica');
  assert.deepEqual(ids(st({ login: login(false, false) })), [], 'desconhecido: sem aviso falso');
  assert.deepEqual(ids(st({ login: login(true) })), []);
  assert.deepEqual(ids(st({ claude: off(), login: login(false) })), ['agent'], 'sem nenhuma IA instalada o login é irrelevante (a IA já bloqueia)');
  assert.deepEqual(ids(st({ claude: off(), login: login(false) }), null), [], 'Claude ausente e provedores ainda não carregados: espera');
  assert.deepEqual(ids({ prereqs: { claude: ok, git: ok } }), [], 'servidor sem o campo login: sem aviso');
});

test('Git ausente: informativo; ordem fixa IA, login, git', () => {
  const [g] = prereqIssues(st({ git: off() }));
  assert.equal(g.id, 'git'); assert.equal(g.blocking, false);
  assert.deepEqual(ids(st({ claude: off(), git: off() })), ['agent', 'git']);
  assert.deepEqual(ids(st({ login: login(false), git: off() })), ['login', 'git']);
});

test('servidor antigo (sem prereqs): cai no probe antigo do Claude Code; Git e login não são avisados', () => {
  assert.deepEqual(ids({ executor: { available: false, detail: 'x' } }), ['agent']);
  assert.deepEqual(ids({ executor: { available: true } }), []);
});

test('o detalhe do servidor só aparece quando acrescenta algo (não repete "não encontrado")', () => {
  const [c, g] = prereqIssues(st({ claude: off('Claude Code não encontrado no PATH'), git: off('Git não encontrado no PATH. Instale em https://git-scm.com/downloads') }), noCodex);
  assert.equal(c.detail, ''); assert.equal(g.detail, '');
  const [x] = prereqIssues(st({ claude: off('Claude Code não pôde ser iniciado com segurança (caminho do claude.cmd inválido).') }), noCodex);
  assert.match(x.detail, /caminho do claude\.cmd inválido/);
});

test('"Continuar mesmo assim": pendência informativa sempre pode ser dispensada; a bloqueante só depois de uma verificação que continuou falhando', () => {
  const info = prereqIssues(st({ git: off() })), blocking = prereqIssues(st({ claude: off() }), noCodex);
  assert.equal(canContinue({ issues: info, tries: 0 }), true);
  assert.equal(canContinue({ issues: blocking, tries: 0 }), false, 'sem verificar de novo, o popup bloqueia');
  assert.equal(canContinue({ issues: blocking, tries: 1 }), true, 'um falso negativo nunca prende o usuário fora do app');
  assert.equal(canContinue({ issues: [], tries: 0 }), true); assert.equal(canContinue(), true);
});

test('chave do conjunto: dispensar vale só até o conjunto de pendências mudar', () => {
  const a = prereqIssues(st({ git: off() })), b = prereqIssues(st({ git: off(), login: login(false) }));
  assert.equal(issueKey(a), 'git'); assert.equal(issueKey(b), 'login+git'); assert.notEqual(issueKey(a), issueKey(b)); assert.equal(issueKey([]), ''); assert.equal(issueKey(null), '');
});

test('texto do popup: sem links inventados (o único é o do Git) e com a orientação de reabrir o app', () => {
  const all = JSON.stringify(PREREQ) + RESTART_HINT;
  const urls = all.match(/https?:\/\/[^\s"')]+/g) ?? [];
  assert.deepEqual([...new Set(urls)].map((u) => u.replace(/[.,;]+$/, '')), ['https://git-scm.com/downloads']);
  assert.match(RESTART_HINT, /feche o FORGE por completo e abra de novo/);
  for (const k of ['agent', 'login', 'git']) { assert.ok(PREREQ[k].title && PREREQ[k].text && PREREQ[k].steps.length >= 2, k); assert.ok(Object.isFrozen(PREREQ[k])); }
});

test('inlineParts: `código` e links https viram elementos; nada de HTML cru e nenhum outro protocolo vira link', () => {
  assert.deepEqual(inlineParts('rode `claude` agora'), [{ kind: 'text', text: 'rode ' }, { kind: 'code', text: 'claude' }, { kind: 'text', text: ' agora' }]);
  const [t, l, d] = inlineParts('Instale em https://git-scm.com/downloads.');
  assert.deepEqual([t.kind, l.kind, l.href, d.kind], ['text', 'link', 'https://git-scm.com/downloads', 'text']);
  assert.ok(inlineParts('javascript:alert(1) e http://x.com').every((p) => p.kind !== 'link'), 'só https');
  assert.deepEqual(inlineParts('<b>oi</b>'), [{ kind: 'text', text: '<b>oi</b>' }], 'HTML fica como texto');
  assert.deepEqual(inlineParts(''), []); assert.deepEqual(inlineParts(null), []);
});
