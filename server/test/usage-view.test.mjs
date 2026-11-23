// Formatação de tokens do cliente (client/src/usage-view.js, funções puras). Sem React, servidor, banco ou CLI.
// Os tokens por pane (paneUsage, squadUsage, newTokens) são testados em terminal-usage-view.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DASH, fmtTokens, fmtUsd } from '../../client/src/usage-view.js';

test('formatação: ausente é "—", zero reportado continua 0, separador pt-BR', () => {
  for (const v of [null, undefined, NaN, '5', Infinity]) assert.equal(fmtTokens(v), DASH);
  assert.equal(fmtTokens(0), '0'); assert.equal(fmtTokens(1234), '1.234');
});

test('custo: ausente é "—" (nunca US$ 0); número vira dólar em pt-BR', () => {
  for (const v of [null, undefined, NaN, '0.5', Infinity]) assert.equal(fmtUsd(v), DASH);
  assert.match(fmtUsd(0), /US\$\s?0,00/); assert.match(fmtUsd(1.5), /US\$\s?1,50/);
});
