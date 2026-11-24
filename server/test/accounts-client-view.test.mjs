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
  assert.deepEqual(v.accountState({ status: { checked: true, loggedIn: true, email: 'a@b.com', plan: 'max', orgName: 'Org' } }), { kind: 'ok', text: 'Conectada', detail: 'a@b.com · Max · Org' });
  assert.equal(v.accountSummary({ status: { subscriptionType: 'max' } }), '', 'o campo antigo saiu do contrato (agora é `plan`)');
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

test('accountActions: um login por vez; login só onde o FORGE sabe logar; qualquer conta sai (a do computador é desvinculada); sem "padrão"', () => {
  const a = { id: 'acc_00000001', provider: 'claude', home: 'forge', canLogin: true }, m = { id: 'acc_00000002', provider: 'claude', home: 'machine', canLogin: true }, cx = { id: 'acc_00000003', provider: 'codex', home: 'machine', canLogin: false };
  assert.deepEqual(v.accountActions(a), { canLogin: true, login: true, loginReason: '', rename: true, remove: true, removeLabel: 'Remover' });
  const s = v.accountActions(m); assert.equal(s.remove, true); assert.equal(s.removeLabel, 'Desvincular'); assert.equal(s.login, true, 'a do computador do Claude também pode entrar');
  const c = v.accountActions(cx); assert.deepEqual([c.canLogin, c.login, c.remove, c.removeLabel], [false, false, true, 'Desvincular'], 'o login do Codex é no próprio CLI');
  assert.equal(v.accountActions(cx, { loginRunningId: 'x' }).loginReason, '', 'sem login pelo FORGE, não há motivo de bloqueio a mostrar');
  const other = v.accountActions(a, { loginRunningId: 'x' }); assert.equal(other.login, false); assert.match(other.loginReason, /em andamento/); assert.equal(other.remove, true);
  const mine = v.accountActions(a, { loginRunningId: 'acc_00000001' }); assert.equal(mine.login, false); assert.equal(mine.remove, false); assert.equal(mine.rename, false); assert.equal(mine.loginReason, '');
  const busy = v.accountActions(a, { busy: true }); assert.equal(busy.login, false); assert.equal(busy.remove, false); assert.equal(busy.rename, false);
  assert.equal(Object.hasOwn(v.accountActions(a), 'makeDefault'), false, 'não existe conta padrão');
  assert.match(v.removalPrompt(m), /não faz logout nem apaga nada/); assert.match(v.removalPrompt({ ...a, label: 'X' }), /apagados do FORGE/);
});

test('groupByProvider e machineCandidates: grupos na ordem dos providers, a do computador primeiro; vincular só provider instalado e sem conta do computador', () => {
  const providers = [{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex CLI', available: true }, { id: 'kimi', label: 'Kimi', available: false }];
  const accounts = [{ id: 'acc_1', provider: 'claude', home: 'forge' }, { id: 'acc_2', provider: 'claude', home: 'machine' }, { id: 'acc_3', provider: 'gemini', home: 'forge', providerLabel: 'Gemini' }];
  const g = v.groupByProvider(accounts, providers);
  assert.deepEqual(g.map((x) => [x.id, x.label, x.accounts.map((a) => a.id)]), [['claude', 'Claude Code', ['acc_2', 'acc_1']], ['codex', 'Codex CLI', []], ['gemini', 'Gemini', ['acc_3']]], 'provider instalado sem conta aparece vazio; não instalado e sem conta, não');
  assert.deepEqual(v.machineCandidates(providers, accounts).map((p) => p.id), ['codex']);
  assert.deepEqual(v.machineCandidates(null, accounts), []); assert.deepEqual(v.groupByProvider([], []), []);
});

test('seletor de conta: pickAccount (escolhida > última usada > o servidor decide) e paneAccountTag só com mais de uma conta do provider', () => {
  const accounts = [{ id: 'acc_a', provider: 'claude', label: 'A' }, { id: 'acc_b', provider: 'claude', label: 'B', home: 'machine' }, { id: 'acc_c', provider: 'codex', label: 'C' }];
  assert.deepEqual(v.accountsOf(accounts, 'claude').map((a) => a.id), ['acc_b', 'acc_a'], 'a do computador primeiro');
  assert.equal(v.pickAccount({ accounts, provider: 'claude', chosen: 'acc_a', lastUsed: { claude: 'acc_b' } }), 'acc_a');
  assert.equal(v.pickAccount({ accounts, provider: 'claude', chosen: 'acc_c', lastUsed: { claude: 'acc_b' } }), 'acc_b', 'escolhida de outro provider não vale');
  assert.equal(v.pickAccount({ accounts, provider: 'claude', chosen: 'acc_sumiu', lastUsed: { claude: 'acc_sumiu2' } }), null, 'nenhuma válida: o servidor decide');
  assert.equal(v.pickAccount({ accounts, provider: 'claude' }), null); assert.equal(v.pickAccount({ accounts: null, provider: 'claude', chosen: 'acc_a' }), null);
  assert.equal(v.paneAccountTag({ provider: 'claude', accountId: 'acc_a' }, accounts), 'A');
  assert.equal(v.paneAccountTag({ provider: 'codex', accountId: 'acc_c' }, accounts), null, 'uma conta só do provider: a etiqueta não diz nada');
  assert.equal(v.paneAccountTag({ accountId: 'acc_b' }, accounts), 'B', 'sem provider vale claude'); assert.equal(v.paneAccountTag(null, accounts), null);
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
  assert.deepEqual(v.normalizeAccounts(null), { accounts: [], providers: [], lastUsed: {} });
  const n = v.normalizeAccounts({ accounts: [{ id: 'acc_m', label: 'Claude Code', provider: 'claude', providerLabel: 'Claude Code', home: 'machine', canLogin: true }, { label: 'sem id' }, null, { id: 'acc_a', label: 'Trabalho' }], providers: [{ id: 'claude' }, 5], lastUsed: { claude: 'acc_a', codex: 'acc_a', gemini: 'acc_sumiu', x: 5 } });
  assert.deepEqual(n.accounts.map((a) => [a.id, a.provider, a.home, a.canLogin]), [['acc_m', 'claude', 'machine', true], ['acc_a', 'claude', 'forge', false]], 'sem provider = claude; sem home = forge (linha antiga)');
  assert.equal(n.providers.length, 1);
  assert.deepEqual(n.lastUsed, { claude: 'acc_a' }, 'só ids que existem e são do provider');
  assert.equal(Object.hasOwn(n.accounts[0], 'system') || Object.hasOwn(n.accounts[0], 'isDefault'), false, 'sem os campos da conta Sistema');
  const list = [{ id: 'acc_m', label: 'Claude Code', home: 'machine' }, { id: 'acc_a', label: ' Trabalho ' }];
  assert.equal(v.accountTagName('acc_a', list), 'Trabalho'); assert.equal(v.accountTagName('acc_m', list), 'Claude Code', 'a do computador é uma conta comum');
  assert.equal(v.accountTagName('zzz', list), null);
  assert.equal(v.accountTagName('acc_a', []), null); assert.equal(v.accountTagName(undefined, list), null); assert.equal(v.accountTagName('acc_a', undefined), null);
});

test('login: métodos e texto; passo do popup aponta para Contas', () => {
  assert.deepEqual(v.LOGIN_METHODS.map((m) => m.id), ['claudeai', 'console', 'sso']); assert.equal(v.DEFAULT_METHOD, 'claudeai');
  assert.match(v.LOGIN_INTRO, /detecta sozinho/);
  assert.match(PREREQ.login.steps[0], /^Clique em Entrar na conta \(ou em Configurações > Contas\)/);
  assert.match(PREREQ.login.steps[0], /`codex login`/, 'o passo vale para qualquer IA');
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
