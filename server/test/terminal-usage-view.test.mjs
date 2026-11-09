// Formatação de tokens e custo dos panes (cliente, funções puras): ausente é "—", nunca zero; custo do squad só quando todos os panes têm custo.
import test from 'node:test';
import assert from 'node:assert/strict';
const V = await import('../../client/src/usage-view.js');

const u = (total, costUsd, extra = {}) => ({ input: total, output: 0, cacheWrite: 0, cacheRead: 0, total, turns: 1, model: 'm', costUsd, ...extra });

test('pane: sem uso = "—"; com uso mostra tokens, custo (ou "—") e detalhamento', () => {
  assert.deepEqual(V.paneUsage(null).tokens, '—'); assert.equal(V.paneUsage(null).cost, '—');
  const a = V.paneUsage(u(12345, 0.0123)); assert.equal(a.tokens, '12.345'); assert.match(a.cost, /US\$/); assert.match(a.title, /entrada 12\.345/);
  assert.equal(V.paneUsage(u(5, null)).cost, '—');
  assert.equal(V.paneUsage(u(0, 0)).tokens, '0', 'zero real é zero');
});

test('squad: soma tokens; custo só se todos os panes com consumo têm custo; custo parcial nunca vira total', () => {
  assert.deepEqual(V.squadUsage([]), { tokens: '—', cost: '—', panes: 0, partialCost: false });
  assert.deepEqual(V.squadUsage([{ usage: null }, {}]).panes, 0);
  const all = V.squadUsage([{ usage: u(100, 0.01) }, { usage: u(200, 0.02) }, { usage: null }]); assert.equal(all.tokens, '300'); assert.equal(all.panes, 2); assert.match(all.cost, /0,03/); assert.equal(all.partialCost, false);
  const part = V.squadUsage([{ usage: u(100, 0.01) }, { usage: u(200, null) }]); assert.equal(part.tokens, '300'); assert.equal(part.cost, '—'); assert.equal(part.partialCost, true);
  assert.equal(V.squadUsage(undefined).panes, 0);
});

test('tokens do pane: entrada + saída, como o terminal mostra ao vivo; o contexto em cache (gravado e lido) fica de fora: um `pwd` não vale 100 mil', () => {
  // números reais de um `pwd` no Claude Code: 2 chamadas, ~24 mil de contexto gravado e ~85 mil relidos do cache; o terminal mostra só os ~193 tokens de saída
  const pwd = { input: 4, output: 193, cacheWrite: 23576, cacheRead: 84671, total: 108444, io: 197, turns: 2, model: 'm', costUsd: null };
  assert.equal(V.newTokens(pwd), 197); assert.equal(V.paneUsage(pwd).tokens, '197');
  assert.match(V.paneUsage(pwd).title, /gravado 23\.576 · lido 84\.671 \(relido a cada resposta\)/);
  assert.equal(V.newTokens({ input: 10, output: 5, cacheWrite: 7, cacheRead: 9999, total: 10021 }), 15, 'servidor antigo sem io: entrada + saída');
  assert.equal(V.newTokens({ total: 42 }), 42); assert.equal(V.newTokens(null), null); assert.equal(V.newTokens({}), null);
  assert.equal(V.squadUsage([{ usage: pwd }, { usage: { ...pwd, io: 100 } }]).tokens, '297');
});
