// Contas: mensagens de erro por código, pós-remoção e login interrompido (client/src/accounts-view.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as v from '../../client/src/accounts-view.js';

test('errorMessageFor / apiErrorText por código', () => {
  assert.equal(v.errorMessageFor('login_closing'), 'Aguarde: o FORGE está confirmando a conta.');
  assert.equal(v.errorMessageFor('input_limit'), 'Muitas tentativas de código. Cancele e comece o login de novo.');
  assert.equal(v.errorMessageFor('login_too_soon'), 'Aguarde um instante e tente de novo.');
  assert.equal(v.errorMessageFor('account_in_use'), null); assert.equal(v.errorMessageFor(undefined), null);
  assert.equal(v.apiErrorText({ code: 'account_in_use', message: 'Conta em uso por um terminal.' }, 'x'), 'Conta em uso por um terminal.');
  assert.equal(v.apiErrorText({ code: 'input_limit', message: 'x' }, 'f'), v.errorMessageFor('input_limit'));
  assert.equal(v.apiErrorText({}, 'padrão'), 'padrão'); assert.equal(v.apiErrorText(null, 'padrão'), 'padrão');
});

test('código colado: restaura, exceto em login_closing', () => {
  assert.equal(v.shouldRestoreCode('login_closing'), false);
  for (const c of [undefined, 'input_limit', 'x']) assert.equal(v.shouldRestoreCode(c), true);
});

test('removalMessage', () => {
  assert.deepEqual(v.removalMessage({ folderRemoved: true, id: 'a' }), { kind: 'ok', text: 'Conta removida.' });
  assert.deepEqual(v.removalMessage({ id: 'a' }), { kind: 'ok', text: 'Conta removida.' }, 'servidor antigo sem o campo');
  assert.match(v.removalMessage({ folderRemoved: true, defaultChangedTo: 'system', id: 'a' }).text, /A conta padrão voltou a ser Sistema\./);
  const e = v.removalMessage({ folderRemoved: false, id: 'acc-9' });
  assert.equal(e.kind, 'err'); assert.match(e.text, /accounts\/acc-9 dentro da pasta de dados do FORGE/);
});

test('loginInterrupted: só na fase run com idle', () => {
  assert.equal(v.loginInterrupted('run', { state: 'idle' }), true);
  assert.equal(v.loginInterrupted('choose', { state: 'idle' }), false);
  for (const s of ['running', 'done', 'failed', 'cancelled']) assert.equal(v.loginInterrupted('run', { state: s }), false);
  assert.equal(v.loginInterrupted('run', null), false);
  assert.match(v.LOGIN_INTERRUPTED, /interrompido/);
});

test('fiação: poll leve, abertura fresca e Verificar novamente sem cache', () => {
  const rd = (f) => fs.readFileSync(f, 'utf8');
  assert.match(rd('client/src/store.jsx'), /\/api\/accounts\?status=0/);
  assert.match(rd('client/src/components/AccountsPanel.jsx'), /\/api\/accounts\?fresh=1/);
  assert.match(rd('client/src/components/PrereqModal.jsx'), /\/api\/state\?fresh=1/);
});
