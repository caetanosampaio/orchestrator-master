// Correções vindas da revisão independente do diff da auditoria:
//  1) restauração automática no Windows: o servidor devolve `interruptedAt` no histórico e preenche `endedAt` em registros que JÁ estavam interrompidos;
//  2) reinício do servidor: a decisão "avisar ou deixar o handler de saída decidir" não engole falha de startServer;
//  3) reconexão do fluxo de terminais: um pane novo não fura o recuo crescente.
// Tudo em diretório TEMPORÁRIO; nenhum banco real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-audit-review-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
const { createTerminalManager } = await import('../terminals.js');
const { createTerminalStream } = await import('../../client/src/terminal-stream.js');
const { lastShutdownRestore } = await import('../../client/src/session-history.js');
const require = createRequire(import.meta.url);
const { shouldFailRestart, createRestartPolicy } = require('../../desktop/restart-policy.cjs');
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const mk = (terminalSessions) => {
  const db = { settings: {}, workspaces: [], worktrees: [], terminalSessions };
  const mgr = createTerminalManager({ db, ptyLib: { spawn() { throw new Error('não usado'); } }, persist: () => {}, now: () => '2026-11-07T12:00:00.000Z', track: () => ({ release() {} }) });
  return { db, mgr };
};

test('boot: registro que JÁ estava interrompido sem endedAt ganha endedAt = interruptedAt (uma vez); os que não têm interruptedAt ou já têm endedAt ficam como estavam', () => {
  const { db } = mk([
    { id: 'ses_00000001', state: 'interrupted', interruptedAt: '2026-11-06T10:00:00.000Z', endedAt: null },
    { id: 'ses_00000002', state: 'interrupted', interruptedAt: '2026-11-06T10:00:00.000Z', endedAt: '2026-11-06T10:00:05.000Z' },
    { id: 'ses_00000003', state: 'interrupted', endedAt: null },
    { id: 'ses_00000004', state: 'exited', endedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const [a, b, c, d] = db.terminalSessions;
  assert.equal(a.endedAt, '2026-11-06T10:00:00.000Z', 'preenchido a partir de interruptedAt');
  assert.equal(b.endedAt, '2026-11-06T10:00:05.000Z', 'já tinha endedAt: intacto');
  assert.equal(c.endedAt, null, 'sem interruptedAt não há o que inferir');
  assert.equal(d.endedAt, '2026-01-01T00:00:00.000Z');
});

test('histórico do servidor devolve interruptedAt e, com isso, a restauração automática enxerga as sessões interrompidas pelo taskkill (fluxo real, sem injetar campos à mão)', () => {
  const { mgr } = mk([
    { id: 'ses_00000001', role: 'builder', state: 'running', endedAt: null, claudeSessionId: null, startedAt: '2026-11-07T11:00:00.000Z', restore: true },
    { id: 'ses_00000002', role: 'builder', state: 'interrupted', interruptedAt: '2026-11-06T10:00:00.000Z', endedAt: null, claudeSessionId: null, startedAt: '2026-11-06T09:00:00.000Z', restore: true },
  ]);
  const rows = mgr.history();
  assert.ok(rows.every((r) => 'interruptedAt' in r), 'o payload tem o campo interruptedAt');
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.ses_00000001.interruptedAt, '2026-11-07T12:00:00.000Z', 'queda de agora');
  assert.equal(byId.ses_00000002.interruptedAt, '2026-11-06T10:00:00.000Z', 'queda antiga (já no banco)');
  // As datas do payload REAL do servidor alimentam a restauração. (`restore` do cliente também exige `resumable`, que depende de haver um transcript do Claude em disco; aqui só se prova o caminho das datas.)
  const rowsForClient = rows.map((r) => ({ ...r, restore: r.state === 'interrupted' }));
  assert.deepEqual(lastShutdownRestore(rowsForClient).map((r) => r.id), ['ses_00000001'], 'só as do ÚLTIMO encerramento: a de ontem fica fora da janela');
  assert.ok(rows.every((r) => r.endedAt), 'e as duas têm endedAt: antes do ajuste a antiga ficava sem data para sempre');
});

test('reinício do servidor: a decisão de avisar não engole falha do startServer (nenhum filho) e respeita encerramento pedido e filho que já saiu', () => {
  assert.equal(shouldFailRestart({ quitting: true, started: false, hasChild: false }), false, 'o usuário mandou fechar: nunca avisa');
  assert.equal(shouldFailRestart({ quitting: false, started: false, hasChild: false }), true, 'startServer lançou antes de criar o filho: ninguém mais decide, então avisa');
  assert.equal(shouldFailRestart({ quitting: false, started: true, hasChild: true }), true, 'o filho está vivo mas não ficou pronto: avisa');
  assert.equal(shouldFailRestart({ quitting: false, started: true, hasChild: false }), false, 'o filho já saiu: o handler de saída dele decide (reinicia ou desiste)');
  const p = createRestartPolicy({ max: 3, windowMs: 1000, now: () => 0 });
  assert.deepEqual([p.decide().restart, p.decide().restart, p.decide().restart, p.decide().restart], [true, true, true, false], 'o limite de 3 continua valendo');
});

test('fluxo de terminais: com uma reabertura já agendada, um pane novo NÃO reabre a conexão na hora (o recuo crescente vale para todos)', () => {
  const sources = [], timers = [];
  class FakeES { constructor(url) { this.url = url; this.readyState = 0; this.l = {}; sources.push(this); } addEventListener(t, f) { this.l[t] = f; } close() { this.readyState = 2; } drop() { this.readyState = 2; this.onerror?.({}); } }
  const setT = (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return t; };
  const clearT = (t) => { if (t) t.off = true; };
  const stream = createTerminalStream({ EventSourceImpl: FakeES, setTimeoutImpl: setT, clearTimeoutImpl: clearT });
  stream.subscribe('t1', {});
  assert.equal(sources.length, 1);
  sources[0].drop();                              // queda definitiva: agenda a reabertura
  assert.equal(stream.status(), 'reconnecting');
  stream.subscribe('t2', {}); stream.subscribe('t3', {}); // panes novos durante o recuo
  assert.equal(sources.length, 1, 'nenhuma conexão nova antes da hora');
  const pending = timers.filter((t) => !t.off).pop(); pending.off = true; pending.fn(); // a hora chegou
  assert.equal(sources.length, 2, 'uma única reabertura, serve a todos os panes');
});
