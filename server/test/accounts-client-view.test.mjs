// Contas: lógica pura da aba Contas (client/src/accounts-view.js) e o passo de login do popup "Antes de começar".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as v from '../../client/src/accounts-view.js';
import { PREREQ } from '../../client/src/prereqs.js';

test('safeLoginUrl: aceita só https nos hosts oficiais', () => {
  for (const u of ['https://claude.ai/oauth/authorize?code=true', 'https://claude.com/cai/oauth', 'https://console.anthropic.com/oauth/authorize?x=1', 'https://anthropic.com/x', 'https://auth.anthropic.com/a', 'https://CLAUDE.AI/x']) assert.ok(v.safeLoginUrl(u), u);
});

test('safeLoginUrl: rejeita URLs maliciosas ou fora da lista', () => {
  const bad = [
    'http://claude.ai/x', 'javascript:alert(1)', 'data:text/html,x', 'file:///c:/x', 'ftp://claude.ai/x',
    'https://claude.ai.evil.com/x', 'https://evilclaude.ai/x', 'https://claude.ai@evil.com/x', 'https://user:pw@claude.ai/x', 'https://user@claude.ai/x',
    'https://evil.com/?u=https://claude.ai', 'https://notanthropic.com/x', 'https://anthropic.com.evil.io/x', 'https://claude.ai:8443/x',
    'https://claude.ai/x y', 'https://claude.ai/\nx', '//claude.ai/x', 'claude.ai/x', '', '   ', null, undefined, 42, {}, 'https://',
  ];
  for (const u of bad) assert.equal(v.safeLoginUrl(u), null, String(u));
  assert.equal(v.safeLoginUrl('https://claude.ai/' + 'a'.repeat(5000)), null);
});

test('validateName: 1 a 60 caracteres, sem controle', () => {
  assert.equal(v.validateName('Trabalho').ok, true);
  assert.equal(v.validateName('  Pessoal  ').value, 'Pessoal');
  assert.equal(v.validateName('a'.repeat(60)).ok, true);
  for (const x of ['', '   ', 'a'.repeat(61), 'a\nb', 'a\u0000b', 'a\u001bb', 'a\u007fb', null, undefined, 5]) assert.equal(v.validateName(x).ok, false, JSON.stringify(x));
  assert.match(v.validateName('').error, /nome/i);
});

test('accountState: rótulos de estado', () => {
  assert.deepEqual(v.accountState({ status: { checked: true, loggedIn: true, email: 'a@b.com', subscriptionType: 'max', orgName: 'Org' } }), { kind: 'ok', text: 'Conectada', detail: 'a@b.com · Max · Org' });
  assert.equal(v.accountState({ status: { checked: true, loggedIn: false } }).text, 'Não conectada');
  assert.equal(v.accountState({ status: { checked: false, loggedIn: null } }).text, 'verificando…');
  assert.equal(v.accountState({ status: { checked: true, loggedIn: null } }).kind, 'wait');
  assert.equal(v.accountState({}).text, 'verificando…'); assert.equal(v.accountState(null).kind, 'wait');
  const e = v.accountState({ status: { checked: true, loggedIn: null, error: 'Claude Code não respondeu' } });
  assert.equal(e.kind, 'bad'); assert.equal(e.text, 'Claude Code não respondeu');
});

test('resumo e plano', () => {
  assert.equal(v.planLabel('pro'), 'Pro'); assert.equal(v.planLabel('MAX'), 'Max'); assert.equal(v.planLabel('custom'), 'Custom'); assert.equal(v.planLabel(null), '');
  assert.equal(v.accountSummary({ status: { email: 'a@b.com' } }), 'a@b.com');
  assert.equal(v.accountSummary({ status: {} }), ''); assert.equal(v.accountSummary(undefined), '');
});

test('loginButtonLabel: conectada reconecta', () => {
  assert.equal(v.loginButtonLabel({ status: { loggedIn: true } }), 'Reconectar');
  assert.equal(v.loginButtonLabel({ status: { loggedIn: false } }), 'Entrar'); assert.equal(v.loginButtonLabel({}), 'Entrar');
});

test('accountActions: um login por vez; Sistema não remove; padrão não vira padrão de novo', () => {
  const sys = { id: 'system', system: true, isDefault: true }, a = { id: 'a1', system: false, isDefault: false };
  assert.deepEqual(v.accountActions(a), { login: true, loginReason: '', makeDefault: true, remove: true, canRemove: true });
  const s = v.accountActions(sys); assert.equal(s.remove, false); assert.equal(s.canRemove, false); assert.equal(s.makeDefault, false); assert.equal(s.login, true);
  const other = v.accountActions(a, { loginRunningId: 'x' }); assert.equal(other.login, false); assert.match(other.loginReason, /em andamento/); assert.equal(other.remove, true);
  const mine = v.accountActions(a, { loginRunningId: 'a1' }); assert.equal(mine.login, false); assert.equal(mine.remove, false); assert.equal(mine.loginReason, '');
  const busy = v.accountActions(a, { busy: true }); assert.equal(busy.login, false); assert.equal(busy.remove, false); assert.equal(busy.makeDefault, false);
});

test('canAddAccount: nome, limite e provedor (o login do Codex é do próprio CLI)', () => {
  const claude = { id: 'claude', available: true, canLogin: true }, codex = { id: 'codex', available: true, canLogin: false, note: 'O login é feito no próprio Codex CLI.' };
  assert.equal(v.canAddAccount({ count: 1, name: 'x', provider: claude }).ok, true);
  assert.equal(v.canAddAccount({ count: 1, name: '', provider: claude }).ok, false);
  assert.equal(v.canAddAccount({ count: v.MAX_ACCOUNTS, name: 'x', provider: claude }).ok, false);
  const cx = v.canAddAccount({ count: 1, name: 'x', provider: codex });
  assert.equal(cx.ok, false);
  assert.equal(cx.reason, codex.note);
  assert.doesNotMatch(cx.reason, /em breve/i);
  assert.equal(v.canAddAccount({ count: 1, name: 'x', provider: null }).ok, false);
  assert.equal(v.canAddAccount({ count: 1, name: 'x', provider: claude, busy: true }).ok, false);
  assert.equal(v.providerSelectable(claude), true); assert.equal(v.providerSelectable(codex), false); assert.equal(v.providerSelectable(undefined), false);
});

test('canSendCode só com login rodando, needsCode e texto', () => {
  assert.equal(v.canSendCode('abc', { state: 'running', needsCode: true }), true);
  assert.equal(v.canSendCode('  ', { state: 'running', needsCode: true }), false);
  assert.equal(v.canSendCode('abc', { state: 'running', needsCode: false }), false);
  assert.equal(v.canSendCode('abc', { state: 'failed', needsCode: true }), false);
  assert.equal(v.canSendCode('abc', null), false);
});

test('tailLines: últimas linhas, sem vazias nem controle', () => {
  assert.deepEqual(v.tailLines(['a', '', '  ', 'b\u001b[x', 'c'], 2), ['b[x', 'c']);
  assert.deepEqual(v.tailLines(null), []); assert.equal(v.tailLines(['x'.repeat(999)])[0].length, 300);
});

test('normalizeAccounts e accountTagName', () => {
  assert.deepEqual(v.normalizeAccounts(null), { accounts: [], providers: [] });
  const n = v.normalizeAccounts({ accounts: [{ id: 'system', label: 'Sistema', system: true }, { label: 'sem id' }, null, { id: 'a', label: 'Trabalho' }], providers: [{ id: 'claude' }, 5] });
  assert.deepEqual(n.accounts.map((a) => a.id), ['system', 'a']); assert.equal(n.providers.length, 1);
  const list = [{ id: 'system', label: 'Sistema', system: true }, { id: 'a', label: ' Trabalho ' }];
  assert.equal(v.accountTagName('a', list), 'Trabalho');
  assert.equal(v.accountTagName('system', list), null); assert.equal(v.accountTagName('zzz', list), null);
  assert.equal(v.accountTagName('a', []), null); assert.equal(v.accountTagName(undefined, list), null); assert.equal(v.accountTagName('a', undefined), null);
});

test('login: métodos e texto; passo do popup aponta para Contas', () => {
  assert.deepEqual(v.LOGIN_METHODS.map((m) => m.id), ['claudeai', 'console', 'sso']); assert.equal(v.DEFAULT_METHOD, 'claudeai');
  assert.match(v.LOGIN_INTRO, /detecta sozinho/);
  assert.equal(PREREQ.login.steps[0], 'Clique em Entrar na conta (ou em Configurações > Contas) e conclua o login no navegador.');
});

test('segurança do componente: sem HTML cru nem console com código/e-mail', () => {
  for (const f of ['client/src/components/AccountsPanel.jsx', 'client/src/accounts-view.js']) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/dangerouslySetInnerHTML/.test(s), f); assert.ok(!/\bconsole\.(log|info|warn|error|debug)\(/.test(s), f);
  }
});

test('safeLoginUrl: subdomínios legítimos de claude.ai/claude.com passam; nomes parecidos continuam recusados', () => {
  for (const u of ['https://platform.claude.com/oauth/authorize', 'https://login.claude.ai/x', 'https://claude.com/cai/oauth']) assert.notEqual(v.safeLoginUrl(u), null, u);
  for (const u of ['https://evilclaude.com/x', 'https://claude.com.evil.io/x', 'https://notclaude.ai/x', 'https://claude.ai.evil.com/x', 'https://xclaude.com/x']) assert.equal(v.safeLoginUrl(u), null, u);
});
