// Perfil de permissão do workspace no cliente (client/src/permission-profile.js e os pontos de contato): lógica pura com fixtures no formato do contrato de
// GET/PUT /api/workspaces/:id/permission-profile. Sem rede, sem servidor e sem tocar `data/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  profileOf, profileSeal, normalizeInfo, sortAudit, auditLine, enableBlock, canSubmitEnable, buildPutBody, errorText, needsReload, executorProfile, executorSeal, fmtWhen, PROFILE_LABEL, SCOPE_NOTE,
} from '../../client/src/permission-profile.js';
import { environments } from '../../client/src/env-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

// Resposta do servidor no formato do contrato.
const warning = { version: 1, text: 'O agente roda comandos, acessa a rede e instala pacotes sem pedir confirmação.', noTokenText: 'Sem o token de sessão, um processo local pode forjar a chamada.' };
const audit = (over = {}) => ({ id: 'a1', at: '2026-11-10T10:00:00.000Z', workspaceId: 'ws_1', workspaceName: 'loja', from: 'default', to: 'bypass', by: 'user', tokenGuarded: true, warningVersion: 1, ...over });
const info = (over = {}) => ({ profile: 'default', since: null, defaultAllow: ['Bash(npm test:*)', 'Bash(git status:*)'], warning, tokenProtected: true, canEnable: true, audit: [], ...over });

test('profileOf: só o valor exato "bypass" liga; qualquer outra coisa é o padrão (falha segura, igual ao servidor)', () => {
  assert.equal(profileOf({ permissionProfile: 'bypass' }), 'bypass');
  for (const v of [undefined, null, 'BYPASS', 'Bypass', true, 1, {}, [], 'default', ' bypass']) assert.equal(profileOf({ permissionProfile: v }), 'default', String(v));
  assert.equal(profileOf(null), 'default'); assert.equal(profileOf(undefined), 'default'); assert.equal(profileOf({}), 'default');
});

test('profileSeal: discreto no padrão (sem "!"), vermelho e com "!" no bypass; o texto sempre diz o estado', () => {
  const d = profileSeal('default'), b = profileSeal('bypass');
  assert.deepEqual([d.tone, d.text, d.glyph], ['default', 'padrão', '']);
  assert.deepEqual([b.tone, b.text, b.glyph], ['bypass', 'sem confirmação', '!']);
  assert.equal(profileSeal('qualquer').tone, 'default', 'valor desconhecido nunca vira bypass');
  assert.match(b.title, /sem pedir confirmação/);
});

test('normalizeInfo: lê o contrato do GET; auditoria da mais recente para a mais antiga', () => {
  const n = normalizeInfo(info({ profile: 'bypass', since: '2026-11-10T10:00:00.000Z', audit: [audit({ id: 'old', at: '2026-11-01T10:00:00Z' }), audit({ id: 'new', at: '2026-11-10T10:00:00Z', from: 'bypass', to: 'default' }), audit({ id: 'sem-data', at: '' })] }));
  assert.equal(n.profile, 'bypass'); assert.equal(n.since, '2026-11-10T10:00:00.000Z');
  assert.deepEqual(n.defaultAllow, ['Bash(npm test:*)', 'Bash(git status:*)']);
  assert.deepEqual(n.warning, warning); assert.equal(n.tokenProtected, true); assert.equal(n.canEnable, true);
  assert.deepEqual(n.audit.map((e) => e.id), ['new', 'old', 'sem-data'], 'sem data válida vai para o fim');
});

test('normalizeInfo: falha segura com resposta malformada ou incompleta', () => {
  for (const bad of [null, undefined, 'x', 3, []]) assert.equal(normalizeInfo(bad), null, String(bad));
  const n = normalizeInfo({ profile: 'qualquer', defaultAllow: ['ok', 3, '', null], warning: { version: '1', text: 'x' }, audit: [null, 'x', { to: 'invalido' }, { to: 'bypass', from: 'xx', tokenGuarded: 'sim' }] });
  assert.equal(n.profile, 'default', 'perfil desconhecido = padrão');
  assert.deepEqual(n.defaultAllow, ['ok']);
  assert.equal(n.warning, null, 'versão que não é inteiro invalida o aviso');
  assert.equal(n.canEnable, false, 'sem canEnable === true não liga'); assert.equal(n.tokenProtected, false, 'sem tokenProtected === true conta como sem token');
  assert.equal(n.audit.length, 1); assert.deepEqual([n.audit[0].from, n.audit[0].tokenGuarded], [null, null]);
  assert.equal(normalizeInfo({ ...info(), canEnable: 'true' }).canEnable, false, 'só o booleano true vale');
  assert.equal(normalizeInfo(info({ notice: 'Uma execução em andamento não é interrompida.' })).notice, 'Uma execução em andamento não é interrompida.'); assert.equal(normalizeInfo(info()).notice, null, 'o aviso do PUT só existe quando o servidor o manda');
});

test('sortAudit: estável e sem alterar a lista original', () => {
  const l = [audit({ id: 'a', at: '2026-11-01T00:00:00Z' }), audit({ id: 'b', at: '2026-11-01T00:00:00Z' }), audit({ id: 'c', at: '2026-11-02T00:00:00Z' })];
  assert.deepEqual(sortAudit(l).map((e) => e.id), ['c', 'a', 'b']); assert.deepEqual(l.map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(sortAudit(null), []);
});

test('auditLine: mostra de/para, o token e a versão do aviso só ao ligar; data inválida vira "—"', () => {
  const on = auditLine(normalizeInfo(info({ audit: [audit({ tokenGuarded: false, warningVersion: 2 })] })).audit[0]);
  assert.match(on, /padrão → sem confirmação/); assert.match(on, /sem token de sessão/); assert.match(on, /aviso v2/);
  const guarded = auditLine({ at: '2026-11-10T10:00:00Z', from: 'default', to: 'bypass', tokenGuarded: true, warningVersion: 1 });
  assert.match(guarded, /com token de sessão/);
  const off = auditLine({ at: '2026-11-10T10:00:00Z', from: 'bypass', to: 'default', tokenGuarded: true, warningVersion: 1 });
  assert.match(off, /sem confirmação → padrão/); assert.doesNotMatch(off, /token|aviso/, 'ao desligar não há aviso nem token');
  assert.ok(auditLine({ at: 'xx', from: null, to: 'bypass' }).startsWith('— · — → sem confirmação'));
  assert.equal(fmtWhen(undefined), '—');
});

test('enableBlock: explica por que não dá para ligar (ciclo ativo, motivo desconhecido, aviso ausente) e nunca bloqueia desligar', () => {
  assert.equal(enableBlock(normalizeInfo(info())), null);
  assert.match(enableBlock(normalizeInfo(info({ canEnable: false, reason: 'active_cycle' }))), /ciclo de missão ou uma tarefa em execução/);
  assert.match(enableBlock(normalizeInfo(info({ canEnable: false, reason: 'outro_motivo' }))), /motivo: outro_motivo/);
  assert.match(enableBlock(normalizeInfo(info({ canEnable: false }))), /não permite ligar agora/);
  assert.match(enableBlock(normalizeInfo(info({ warning: null }))), /não enviou o texto do aviso/);
  assert.match(enableBlock(normalizeInfo(info({ tokenProtected: false, warning: { ...warning, noTokenText: '' } }))), /token de sessão/);
  assert.match(enableBlock(null), /indisponível/);
  assert.equal(enableBlock(normalizeInfo(info({ profile: 'bypass', canEnable: false, reason: 'active_cycle' }))), null, 'já em bypass: desligar nunca é bloqueado');
});

test('canSubmitEnable: exige "Entendo os riscos" e, sem token de sessão, também a segunda confirmação', () => {
  const com = normalizeInfo(info()), sem = normalizeInfo(info({ tokenProtected: false }));
  assert.equal(canSubmitEnable(com, {}), false); assert.equal(canSubmitEnable(com, { confirmed: false, ackNoToken: true }), false);
  assert.equal(canSubmitEnable(com, { confirmed: true }), true, 'com token basta a primeira caixa');
  assert.equal(canSubmitEnable(sem, { confirmed: true }), false, 'sem token falta a segunda');
  assert.equal(canSubmitEnable(sem, { ackNoToken: true }), false, 'a segunda sozinha não basta');
  assert.equal(canSubmitEnable(sem, { confirmed: true, ackNoToken: true }), true);
  assert.equal(canSubmitEnable(normalizeInfo(info({ canEnable: false, reason: 'active_cycle' })), { confirmed: true }), false, 'ciclo ativo: nem com as caixas');
  assert.equal(canSubmitEnable(normalizeInfo(info({ warning: null })), { confirmed: true }), false);
  assert.equal(canSubmitEnable(normalizeInfo(info({ profile: 'bypass' })), { confirmed: true }), false, 'já ligado');
  assert.equal(canSubmitEnable(null, { confirmed: true }), false);
  assert.equal(canSubmitEnable(com, { confirmed: 'true' }), false, 'só o booleano true vale');
});

test('buildPutBody: nunca monta um pedido de bypass sem as confirmações; corpo no formato do contrato', () => {
  const com = normalizeInfo(info()), sem = normalizeInfo(info({ tokenProtected: false, warning: { ...warning, version: 3 } }));
  assert.equal(buildPutBody('bypass', com, {}), null); assert.equal(buildPutBody('bypass', sem, { confirmed: true }), null);
  assert.deepEqual(buildPutBody('bypass', com, { confirmed: true }), { profile: 'bypass', confirm: true, warningVersion: 1 }, 'com token: sem acknowledgeNoToken');
  assert.deepEqual(buildPutBody('bypass', sem, { confirmed: true, ackNoToken: true }), { profile: 'bypass', confirm: true, warningVersion: 3, acknowledgeNoToken: true }, 'sem token: acknowledgeNoToken:true e a versão vigente do aviso');
  assert.deepEqual(buildPutBody('default', normalizeInfo(info({ profile: 'bypass' })), {}), { profile: 'default', confirm: true, warningVersion: 1 }, 'desligar é um clique');
  assert.equal(buildPutBody('default', normalizeInfo(info({ warning: null })), {}), null, 'sem versão do aviso não há corpo válido');
  assert.equal(buildPutBody('admin', com, { confirmed: true }), null); assert.equal(buildPutBody('bypass', null, { confirmed: true }), null);
});

test('errorText: rota ausente, ciclo ativo, token e servidor fora do ar têm mensagem honesta', () => {
  assert.match(errorText(Object.assign(new Error('Erro 404'), { status: 404 })), /não oferece o perfil de permissão/);
  assert.equal(errorText(Object.assign(new Error('workspace não encontrado'), { status: 404 })), 'workspace não encontrado', 'o 404 com mensagem do servidor é de workspace inexistente');
  assert.match(errorText(Object.assign(new Error('x'), { status: 400, code: 'no_token_ack_required' }), 'save'), /confirmar o risco extra/);
  assert.equal(errorText(Object.assign(new Error('Há um ciclo ativo'), { status: 409 }), 'save'), 'Há um ciclo ativo');
  assert.match(errorText(Object.assign(new Error(''), { status: 409 }), 'save'), /ciclo de missão/);
  assert.match(errorText(new TypeError('Failed to fetch')), /Servidor indisponível/);
  assert.equal(errorText(Object.assign(new Error('falhou ao salvar'), { status: 500 }), 'save'), 'falhou ao salvar');
  assert.equal(needsReload({ status: 400 }), true); assert.equal(needsReload({ status: 409 }), true); assert.equal(needsReload({ status: 500 }), false);
});

test('executorProfile: o gravado na rodada vence o atual do workspace; sem rodada vale o do workspace e a origem é dita', () => {
  const wsDefault = { id: 'ws_1', permissionProfile: undefined }, wsBypass = { id: 'ws_1', permissionProfile: 'bypass' };
  const rounds = [{ n: 1, policy: { profile: 'default' } }, { n: 2, policy: { profile: 'bypass' } }, { n: 3 }];
  const m = (o = {}) => ({ id: 'mis_1', workspaceId: 'ws_1', cycle: { rounds }, ...o });
  assert.deepEqual(executorProfile(m(), wsDefault), { profile: 'bypass', source: 'rodada', round: 2, current: 'default', differs: true }, 'última rodada com perfil gravado');
  assert.deepEqual(executorProfile(m({ cycle: { rounds: [{ n: 1, policy: { profile: 'default' } }] } }), wsBypass), { profile: 'default', source: 'rodada', round: 1, current: 'bypass', differs: true }, 'missão antiga em padrão não vira vermelha só porque o workspace ligou o bypass depois');
  assert.deepEqual(executorProfile({ id: 'm' }, wsBypass), { profile: 'bypass', source: 'workspace', round: null, current: 'bypass', differs: false });
  assert.deepEqual(executorProfile({ id: 'm', cycle: { rounds: [{ n: 1 }] }, tasks: [{ permissionProfile: 'bypass' }] }, wsDefault), { profile: 'bypass', source: 'tarefa', round: null, current: 'default', differs: true });
  assert.equal(executorProfile({ id: 'm' }, null), null, 'sem workspace nada é inventado');
  assert.equal(executorProfile({ cycle: { rounds: [{ n: 1, policy: { profile: 'qualquer' } }] } }, null), null, 'perfil gravado inválido é ignorado');
  assert.equal(executorProfile(null, undefined), null);
});

test('executorSeal: rótulo "Executor · …" e dica com a origem; avisa quando o workspace mudou depois', () => {
  const s = executorSeal({ cycle: { rounds: [{ n: 4, policy: { profile: 'bypass' } }] } }, { permissionProfile: 'default' });
  assert.equal(s.label, 'Executor · sem confirmação'); assert.equal(s.tone, 'bypass');
  assert.match(s.title, /gravado na rodada 4/); assert.match(s.title, /agora no perfil padrão/);
  const d = executorSeal({ id: 'm' }, { permissionProfile: 'default' });
  assert.equal(d.label, 'Executor · padrão'); assert.equal(d.tone, 'default'); assert.match(d.title, /perfil atual do workspace/);
  assert.equal(executorSeal({ id: 'm' }, null), null);
});

test('environments: cada ambiente carrega o perfil do workspace (`profile`), o bypass só quando é exatamente "bypass"', () => {
  const out = environments({ workspaces: [{ id: 'a', name: 'A', path: '/a', permissionProfile: 'bypass' }, { id: 'b', name: 'B', path: '/b' }, { id: 'c', name: 'C', path: '/c', permissionProfile: 'true' }] });
  assert.deepEqual(out.map((e) => e.profile), ['bypass', 'default', 'default']);
});

test('cliente: o perfil só é ligado pelo diálogo (PUT com buildPutBody), nunca em outro lugar, e a interface diz que vale só para missões', () => {
  const dlg = src('components/PermissionProfileDialog.jsx');
  assert.match(dlg, /buildPutBody\(profile, info, \{ confirmed, ackNoToken \}\)/); assert.match(dlg, /if \(!body\) return;/, 'sem corpo válido não há pedido');
  assert.match(dlg, /api\.put\(url\(workspace\.id\), body\)/); assert.match(dlg, /Entendo os riscos/);
  assert.match(dlg, /info\.warning\.noTokenText/); assert.match(dlg, /SCOPE_NOTE/); assert.match(dlg, /info\.defaultAllow/); assert.match(dlg, /info\.audit/);
  assert.match(SCOPE_NOTE, /MISSÕES/); assert.match(SCOPE_NOTE, /terminais/);
  assert.ok(!/useEffect\([^)]*apply\(/.test(dlg), 'nada liga sozinho');
  const files = ['components/Sidebar.jsx', 'components/WorkspaceDialog.jsx', 'components/MissionPanel.jsx', 'components/settings/AppSections.jsx', 'env-view.js', 'store.jsx', 'api.js', 'App.jsx', 'pages/Home.jsx', 'pages/Missions.jsx'];
  for (const f of files) assert.ok(!/api\/workspaces\/[^'"`]*permission-profile|\/permission-profile`|buildPutBody|api\.put/.test(src(f)), `${f} não chama a rota do perfil (só lê o campo e abre o diálogo)`);
  for (const f of ['components/Sidebar.jsx', 'components/WorkspaceDialog.jsx', 'components/settings/AppSections.jsx']) assert.match(src(f), /PermissionProfileDialog/, `${f} abre o diálogo`);
  assert.match(src('main.jsx'), /import '\.\/permission-profile\.css'/);
  assert.deepEqual(Object.keys(PROFILE_LABEL), ['default', 'bypass']);
});

test('css: o selo do bypass é vermelho e o diálogo respeita reduced-motion e telas estreitas', () => {
  const css = src('permission-profile.css');
  assert.match(css, /\.pp-seal-bypass \{[^}]*#c04048/); assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /max-width: 480px/);
  assert.ok(!/@keyframes|animation:\s*(?!none)/.test(css.replace(/animation: none !important/g, '')), 'sem animação própria');
});
