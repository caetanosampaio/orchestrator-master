// Padrão do Maestro autônomo no boot: instalação nova começa DESLIGADO; instalação já usada continua LIGADA (gravado de forma explícita); a escolha gravada sempre vence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAutonomous, isUsedInstall } from '../maestro-default.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('instalação nova (banco vazio): desligado, e a decisão é gravada para o próximo boot não vê-la como "já usada"', () => {
  const db = { workspaces: [], terminalSessions: [], settings: {} };
  assert.equal(isUsedInstall(db), false);
  assert.deepEqual(resolveAutonomous(db), { autonomous: false, changed: true });
  assert.deepEqual(db.settings.maestro, { autonomous: false });
  // depois do setup (workspace criado, setupDone) o boot seguinte continua desligado: a escolha gravada vence
  db.workspaces.push({ id: 'ws_1' }); db.settings.ui = { setupDone: true };
  assert.equal(isUsedInstall(db), true);
  assert.deepEqual(resolveAutonomous(db), { autonomous: false, changed: false });
});

test('instalação que já era usada e nunca escolheu: continua ligada (como sempre foi) e isso é gravado de forma explícita', () => {
  for (const db of [{ workspaces: [{ id: 'ws_1' }] }, { terminalSessions: [{ id: 'ses_1' }] }, { settings: { ui: { setupDone: true } } }]) {
    assert.equal(isUsedInstall(db), true);
    assert.deepEqual(resolveAutonomous(db), { autonomous: true, changed: true });
    assert.deepEqual(db.settings.maestro, { autonomous: true });
    assert.deepEqual(resolveAutonomous(db), { autonomous: true, changed: false }, 'o segundo boot não altera nada');
  }
});

test('a escolha gravada do usuário sempre vence, em instalação nova ou usada', () => {
  for (const used of [false, true]) for (const saved of [true, false]) {
    const db = { workspaces: used ? [{ id: 'ws_1' }] : [], settings: { maestro: { autonomous: saved } } };
    assert.deepEqual(resolveAutonomous(db), { autonomous: saved, changed: false }, `usada=${used} gravado=${saved}`);
  }
});

test('valor gravado inválido é tratado como "sem escolha" e settings.maestro estranho não quebra', () => {
  const novo = { settings: { maestro: { autonomous: 'sim', outro: 1 } } };
  assert.deepEqual(resolveAutonomous(novo), { autonomous: false, changed: true }); assert.deepEqual(novo.settings.maestro, { autonomous: false, outro: 1 });
  const estranho = { workspaces: [{ id: 'w' }], settings: { maestro: 'x' } };
  assert.deepEqual(resolveAutonomous(estranho), { autonomous: true, changed: true }); assert.deepEqual(estranho.settings.maestro, { autonomous: true });
  assert.deepEqual(resolveAutonomous(null), { autonomous: false, changed: false }, 'sem banco: desligado e nada a gravar');
});

test('index.js usa resolveAutonomous no boot e só o `autonomous` decidido liga o Maestro; o aviso da tela não diz mais "padrão ligado"', () => {
  const idx = fs.readFileSync(path.join(here, '../index.js'), 'utf8'), ctl = fs.readFileSync(path.join(here, '../../client/src/components/MaestroControls.jsx'), 'utf8');
  assert.ok(idx.includes('const autonomyBoot = resolveAutonomous(db);') && idx.includes('createMaestro({ autonomous: autonomyBoot.autonomous,'));
  assert.ok(!ctl.includes('Ligado (padrão)'));
});
