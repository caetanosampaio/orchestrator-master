// Pré-requisitos do primeiro uso: a lógica (pura) que alimenta o popup "Antes de começar" (client/src/prereqs.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prereqIssues, issueKey, hasBlocking, canContinue, inlineParts, PREREQ, RESTART_HINT } from '../../client/src/prereqs.js';

const ok = { available: true, version: '1.0.0', detail: '' };
const off = (detail = 'não encontrado') => ({ available: false, version: null, detail });
const login = (loggedIn, known = true) => ({ known, loggedIn: known ? loggedIn : null, detail: '' });
const st = (p) => ({ prereqs: { claude: ok, git: ok, login: login(true), ...p } });
const ids = (s) => prereqIssues(s).map((i) => i.id);

test('tudo certo, ou servidor ainda sem resposta: nenhuma pendência (o popup não aparece)', () => {
  assert.deepEqual(prereqIssues(st({})), []);
  assert.deepEqual(prereqIssues(null), []); assert.deepEqual(prereqIssues(undefined), []); assert.deepEqual(prereqIssues('x'), []);
});

test('Claude Code ausente: pendência BLOQUEANTE e primeira da lista', () => {
  const [c] = prereqIssues(st({ claude: off() }));
  assert.equal(c.id, 'claude'); assert.equal(c.blocking, true); assert.equal(hasBlocking([c]), true);
  assert.match(c.title, /Claude Code não encontrado/); assert.ok(c.steps.length >= 3);
});

test('login: só avisa com o Claude Code instalado e quando o servidor TEM certeza; é informativo (não bloqueia)', () => {
  assert.deepEqual(ids(st({ login: login(false) })), ['login']);
  assert.equal(prereqIssues(st({ login: login(false) }))[0].blocking, false);
  assert.deepEqual(ids(st({ login: login(false, false) })), [], 'macOS/desconhecido: sem aviso falso');
  assert.deepEqual(ids(st({ login: login(true) })), []);
  assert.deepEqual(ids(st({ claude: off(), login: login(false) })), ['claude'], 'sem o Claude Code o login é irrelevante');
  assert.deepEqual(ids({ prereqs: { claude: ok, git: ok } }), [], 'servidor sem o campo login: sem aviso');
});

test('Git ausente: informativo; ordem fixa claude, login, git', () => {
  const [g] = prereqIssues(st({ git: off() }));
  assert.equal(g.id, 'git'); assert.equal(g.blocking, false);
  assert.deepEqual(ids(st({ claude: off(), git: off() })), ['claude', 'git']);
  assert.deepEqual(ids(st({ login: login(false), git: off() })), ['login', 'git']);
});

test('servidor antigo (sem prereqs): cai no probe antigo do Claude Code; Git e login não são avisados', () => {
  assert.deepEqual(ids({ executor: { available: false, detail: 'x' } }), ['claude']);
  assert.deepEqual(ids({ executor: { available: true } }), []);
});

test('o detalhe do servidor só aparece quando acrescenta algo (não repete "não encontrado")', () => {
  const [c, g] = prereqIssues(st({ claude: off('Claude Code não encontrado no PATH'), git: off('Git não encontrado no PATH. Instale em https://git-scm.com/downloads') }));
  assert.equal(c.detail, ''); assert.equal(g.detail, '');
  const [x] = prereqIssues(st({ claude: off('Claude Code não pôde ser iniciado com segurança (caminho do claude.cmd inválido).') }));
  assert.match(x.detail, /caminho do claude\.cmd inválido/);
});

test('"Continuar mesmo assim": pendência informativa sempre pode ser dispensada; a bloqueante só depois de uma verificação que continuou falhando', () => {
  const info = prereqIssues(st({ git: off() })), blocking = prereqIssues(st({ claude: off() }));
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
  for (const k of ['claude', 'login', 'git']) { assert.ok(PREREQ[k].title && PREREQ[k].text && PREREQ[k].steps.length >= 2, k); assert.ok(Object.isFrozen(PREREQ[k])); }
});

test('inlineParts: `código` e links https viram elementos; nada de HTML cru e nenhum outro protocolo vira link', () => {
  assert.deepEqual(inlineParts('rode `claude` agora'), [{ kind: 'text', text: 'rode ' }, { kind: 'code', text: 'claude' }, { kind: 'text', text: ' agora' }]);
  const [t, l, d] = inlineParts('Instale em https://git-scm.com/downloads.');
  assert.deepEqual([t.kind, l.kind, l.href, d.kind], ['text', 'link', 'https://git-scm.com/downloads', 'text']);
  assert.ok(inlineParts('javascript:alert(1) e http://x.com').every((p) => p.kind !== 'link'), 'só https');
  assert.deepEqual(inlineParts('<b>oi</b>'), [{ kind: 'text', text: '<b>oi</b>' }], 'HTML fica como texto');
  assert.deepEqual(inlineParts(''), []); assert.deepEqual(inlineParts(null), []);
});
