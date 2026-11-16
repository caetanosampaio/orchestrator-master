// Relatório de entrega e mensagem de resultado quando o ciclo foi fechado pelo SERVIDOR (cycle.closedBy = 'system'): o texto NÃO é uma declaração do Planner.
// Funções puras; banco TEMPORÁRIO (o módulo importa o store); nenhum modelo é chamado.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-delivery-ac-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { buildDelivery } = await import('../delivery.js');
const { resultMessageOf } = await import('../result-message.js');

const W = { id: 'w', name: 'WS', verifications: [{ script: 'test', required: true, command: 'npm run test' }] };
const PASS = { id: 'test', script: 'test', required: true, command: 'npm run test', source: 'backend', status: 'pass', exitCode: 0, durationMs: 5, outputTail: '', truncated: false, reason: null };
const round = { n: 1, status: 'succeeded', phase: 'done', taskId: 't1', agent: 'code', plan: { title: 'Rodada 1', rationale: 'r' }, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:01:00.000Z',
  verification: 'passed', report: { status: 'success', summary: 'feito', filesChanged: [], filesKnown: true, checks: [], checksReported: true, errors: [], blockers: [], exitCode: 0, usage: null, verifications: [PASS],
    evidence: { level: 'verified', basis: 'real_verification', reasons: [], executorClaim: { status: 'success', pass: 0, fail: 0, notRun: 0, note: 'x' }, system: { verification: 'passed', expectedFiles: [] } } } };
const mission = (over = {}) => ({ id: 'mx', demo: false, title: 'Missão X', objective: 'obj', workspaceId: 'w', createdAt: 'T0', tasks: [],
  cycle: { id: 'cy1', status: 'completed', maxIterations: 5, rounds: [round], plannerCalls: 0, humanNotes: [], rejections: [], blocks: [], blockedCode: null, blockedReason: null, startedAt: 'A', finishedAt: 'B',
    finalSummary: 'Fechamento automático: todas as etapas concluídas com evidência verificada.', evidence: ['Etapa s1: ok.'], assurance: 'verified', ...over } });

test('closedBy "system": o resumo declarado é do servidor, com origem e rótulo próprios', () => {
  const r = buildDelivery(mission({ closedBy: 'system' }), W, { now: () => 'AGORA' });
  assert.equal(r.declared.plannerSummary.origin, 'system');
  assert.match(r.declared.plannerSummary.label, /fechamento automático do servidor/);
  assert.doesNotMatch(r.declared.plannerSummary.label, /Planner/);
});

test('closedBy "planner" ou ausente (ciclo antigo): continua sendo a declaração do Planner', () => {
  for (const over of [{ closedBy: 'planner' }, {}]) {
    const r = buildDelivery(mission(over), W, { now: () => 'AGORA' });
    assert.equal(r.declared.plannerSummary.origin, 'planner'); assert.match(r.declared.plannerSummary.label, /declaração do Planner/);
  }
});

test('mensagem de resultado: o fechamento do servidor não é atribuído ao Planner', () => {
  const sys = mission({ closedBy: 'system' }), pl = mission({ closedBy: 'planner' });
  const a = resultMessageOf(buildDelivery(sys, W, { now: () => 'AGORA' }), sys), b = resultMessageOf(buildDelivery(pl, W, { now: () => 'AGORA' }), pl);
  const text = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
  assert.match(text(a), /Fechamento automático do servidor/); assert.doesNotMatch(text(a), /Resumo do Planner/);
  assert.match(text(b), /Resumo do Planner \(declaração, não prova\)/);
});

test('limpeza do diretório temporário', () => { fs.rmSync(tmp, { recursive: true, force: true }); });
