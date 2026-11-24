// Missions v2: maestro.dispatch / maestro.taskState (API interna do runner de missões). Entrega pelo MESMO caminho do Maestro (sem aprovação por tarefa), com as mesmas regras de
// segurança de digitação; nada fica registrado quando a entrega não sai. Terminais SIMULADOS (nenhum Claude/Codex real), ORCH_DATA_DIR temporário.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-dispatch-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const M = await import('../maestro.js');

const MA = 'term_aaaaaaaa', B1 = 'term_bbbbbbbb';
const OLD = '2026-11-03T11:00:00.000Z';
function world() {
  const panes = new Map([[MA, { id: MA, role: 'maestro', title: 'Maestro', status: 'running' }], [B1, { id: B1, role: 'builder', title: 'Construtor 1', status: 'running', provider: 'claude', agent: { state: 'idle', at: OLD }, lastOutputAt: OLD }]]);
  const written = [], timers = []; let n = 0;
  const api = {
    get: (id) => panes.get(id) ?? null, list: () => [...panes.values()],
    write: (id, d) => { const p = panes.get(id); if (!p) return { ok: false, status: 404, error: 'Terminal não encontrado.' }; if (p.status !== 'running') return { ok: false, status: 409, error: 'O terminal já terminou.' }; written.push([id, d]); return { ok: true, status: 200 }; },
    readOutput: () => '',
  };
  const m = M.createMaestro({ getTerminals: () => api, mcpDir: path.join(tmp, 'mcp'), url: 'http://127.0.0.1:4999/mcp', uid: (p) => `${p}_${String(++n).padStart(8, '0')}`, setTimer: (fn) => { timers.push(fn); return { unref() {} }; }, watchTimer: () => ({ unref() {} }) });
  return { m, panes, written, timers, b: panes.get(B1) };
}
const typed = (w) => w.written.filter((x) => x[1] !== '\r');

test('dispatch: entrega pelo caminho do Maestro SEM aprovação (nem modo autônomo): linha de tarefa digitada, Enter depois, tarefa "delivered"', () => {
  const w = world();
  assert.equal(w.m.isAutonomous(), false);
  const r = w.m.dispatch({ to: B1, text: 'Crie o arquivo a.txt', source: 'flow' });
  assert.equal(r.ok, true); assert.match(r.taskId, /^task_\d{8}$/);
  assert.equal(typed(w).length, 1); assert.equal(typed(w)[0][0], B1);
  assert.match(typed(w)[0][1], new RegExp(`^\\[Tarefa ${r.taskId} do maestro\\] Crie o arquivo a\\.txt .*report_done.*${r.taskId}`));
  assert.equal(w.written.some((x) => x[1] === '\r'), false, 'o Enter vai depois, pelo temporizador');
  w.timers.shift()(); assert.equal(w.written.at(-1)[1], '\r');
  assert.deepEqual(w.m.taskState(r.taskId), { status: 'delivered', summary: null, note: null, doneAt: null, auto: false });
  const snap = w.m.snapshot().tasks[0]; assert.equal(snap.status, 'delivered'); assert.equal(snap.from, null); assert.equal(snap.decidedBy, 'flow');
});

test('dispatch: terminal ocupado, sem estado, aguardando permissão ou com saída recente => transitório, NADA digitado e NADA registrado', () => {
  const cases = [
    ['estado desconhecido', (p) => { delete p.agent; }],
    ['aguardando permissão', (p) => { p.agent = { state: 'waiting', at: OLD }; }],
    ['trabalhando', (p) => { p.agent = { state: 'running', at: new Date().toISOString() }; p.lastOutputAt = new Date().toISOString(); }],
    ['saída recente', (p) => { p.lastOutputAt = new Date().toISOString(); }],
  ];
  for (const [nome, mut] of cases) {
    const w = world(); mut(w.b);
    const r = w.m.dispatch({ to: B1, text: 'x' });
    assert.equal(r.ok, false, nome); assert.equal(r.transient, true, nome); assert.match(r.error, /terminal de destino/, nome);
    assert.equal(w.written.length, 0, nome); assert.equal(w.m.snapshot().tasks.length, 0, nome);
  }
  const w = world(); w.m.dispatch({ to: B1, text: 'primeira' }); // entrega em curso (Enter ainda não enviado)
  const r2 = w.m.dispatch({ to: B1, text: 'segunda' });
  assert.equal(r2.ok, false); assert.equal(r2.transient, true); assert.equal(typed(w).length, 1, 'duas tarefas nunca se colam na mesma linha'); assert.equal(w.m.snapshot().tasks.length, 1);
});

test('dispatch: entradas inválidas são recusadas sem efeito (id, terminal encerrado, maestro, vazio, acima do limite) e ESC/controles são saneados', () => {
  const w = world();
  for (const to of [undefined, null, 'x', 'term_zzzzzzzz', 'term_00000000', {}, ['term_bbbbbbbb']]) { const r = w.m.dispatch({ to, text: 'x' }); assert.equal(r.ok, false, String(to)); assert.equal(r.transient, undefined); }
  assert.match(w.m.dispatch({ to: MA, text: 'x' }).error, /maestro/);
  assert.match(w.m.dispatch({ to: B1, text: '   ' }).error, /vazia/);
  assert.match(w.m.dispatch({ to: B1, text: 'a'.repeat(M.MAX_TASK_TEXT + 1) }).error, /NÃO foi enviada/);
  assert.equal(w.written.length, 0); assert.equal(w.m.snapshot().tasks.length, 0);
  const ok = w.m.dispatch({ to: B1, text: 'a'.repeat(M.MAX_TASK_TEXT) }); assert.equal(ok.ok, true, 'exatamente no limite vale');
  const w2 = world(); w2.m.dispatch({ to: B1, text: 'linha1\nlinha2\x1b[31m\x07fim' });
  const line = typed(w2)[0][1]; assert.ok(!/[\x00-\x1f\x7f]/.test(line), 'sem controles nem ESC'); assert.ok(line.includes('linha1 linha2') && line.includes('fim'), line);
  w.panes.get(B1).status = 'exited'; assert.match(w.m.dispatch({ to: B1, text: 'x' }).error, /terminou/);
});

test('dispatch: `from` só vale como id de terminal válido e diferente do destino (senão ninguém é avisado)', () => {
  const w = world(); const r = w.m.dispatch({ to: B1, text: 'x', from: '../x' }); assert.equal(w.m.snapshot().tasks.find((t) => t.id === r.taskId).from, null);
  const w2 = world(); const r2 = w2.m.dispatch({ to: B1, text: 'x', from: B1 }); assert.equal(w2.m.snapshot().tasks.find((t) => t.id === r2.taskId).from, null);
  const w3 = world(); const r3 = w3.m.dispatch({ to: B1, text: 'x', from: MA }); assert.equal(w3.m.snapshot().tasks.find((t) => t.id === r3.taskId).from, MA);
});

test('dispatch: falha ao escrever no terminal não deixa tarefa registrada e devolve o erro (não transitório)', () => {
  const w2 = world();
  // o terminal some entre a checagem e a escrita: simulado por um write que recusa
  const m = M.createMaestro({ getTerminals: () => ({ get: (id) => w2.panes.get(id) ?? null, list: () => [], write: () => ({ ok: false, status: 409, error: 'O terminal não aceitou a entrada.' }), readOutput: () => '' }), mcpDir: path.join(tmp, 'mcp2'), url: 'http://127.0.0.1:4999/mcp', watchTimer: () => ({ unref() {} }), setTimer: () => ({ unref() {} }) });
  const r = m.dispatch({ to: B1, text: 'x' });
  assert.equal(r.ok, false); assert.equal(r.transient, undefined); assert.match(r.error, /não aceitou/); assert.equal(m.snapshot().tasks.length, 0);
});

test('taskState: id inexistente/inválido = null; report_done do destino => done com resumo; terminal que acaba => failed com nota; resumo só com a tarefa concluída', () => {
  const w = world();
  assert.equal(w.m.taskState('task_99999999'), null); assert.equal(w.m.taskState('x'), null); assert.equal(w.m.taskState(undefined), null);
  const r = w.m.dispatch({ to: B1, text: 'x' });
  const done = w.m.rpc({ terminalId: B1, role: 'builder' }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'report_done', arguments: { task_id: r.taskId, summary: 'Feito: a.txt' } } });
  assert.match(done.result.content[0].text, /^Concluída/);
  const s = w.m.taskState(r.taskId); assert.equal(s.status, 'done'); assert.equal(s.summary, 'Feito: a.txt'); assert.ok(s.doneAt); assert.equal(s.auto, false, 'report_done = conclusão confirmada');
  const w2 = world(); const r2 = w2.m.dispatch({ to: B1, text: 'y' }); w2.panes.get(B1).status = 'exited';
  const s2 = w2.m.taskState(r2.taskId); assert.equal(s2.status, 'failed'); assert.match(s2.note, /terminal acabou/); assert.equal(s2.summary, null);
});

test('o Maestro existente não mudou: send_task continua pendente (sem aprovação nada é digitado) e a lista de tarefas ignora `source`', () => {
  const w = world();
  const call = (name, args) => w.m.rpc({ terminalId: MA, role: 'maestro' }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
  const r = call('send_task', { pane_id: B1, task: 'tarefa normal' });
  assert.match(r.content[0].text, /AGUARDANDO aprovação/); assert.equal(w.written.length, 0);
  assert.equal(w.m.snapshot().tasks[0].status, 'pending');
  assert.deepEqual(Object.keys(w.m).sort(), ['authenticate', 'connected', 'decide', 'dispatch', 'isAutonomous', 'issue', 'revoke', 'rpc', 'serverName', 'setAutonomous', 'setPlanner', 'snapshot', 'taskState']); // setPlanner: porta do planejador de missões (docs/missions-v2-briefing.md), ligada no boot
});
