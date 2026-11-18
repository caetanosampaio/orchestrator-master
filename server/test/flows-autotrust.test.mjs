// Missions v2: o terminal de uma missão responde sozinho à pergunta "confiar nesta pasta?" do Claude Code (ninguém precisa clicar em "confio").
// Terminais e Maestro SIMULADOS, relógio e temporizadores injetados: nenhum Claude real, nenhum processo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-flows-trust-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporário */ } });
const F = await import('../flows.js');

const ESC = String.fromCharCode(27);
const hex = (n) => n.toString(16).padStart(8, '0');
const PROMPT = `${ESC}[2J Do you trust the files in this folder?\r\n C:\\Users\\x\\proj\r\n ${ESC}[36m❯ 1. Yes, proceed${ESC}[0m\r\n   2. No, exit`;

function world() {
  const db = { settings: {}, workspaces: [{ id: 'ws_1', name: 'Projeto', path: '/x' }], flows: [], flowRuns: [] };
  const terms = new Map(), outputs = new Map(), writes = [], tasks = new Map();
  let tn = 0, un = 0, clock = Date.parse('2026-11-10T10:00:00.000Z');
  const w = { db, terms, outputs, writes, advance: (ms) => { clock += ms; } };
  w.terminals = {
    async create(o) { const id = `term_${hex(++tn)}`; terms.set(id, { id, status: 'running', agent: { state: 'idle' }, role: o.role }); return { ok: true, status: 201, session: { id } }; },
    peek: (id) => terms.get(id) ?? null, close: () => ({ ok: true }), count: () => terms.size, providers: () => [{ id: 'claude', label: 'Claude Code', available: true }],
    readOutput: (id) => outputs.get(id) ?? '',
    write: (id, d) => { writes.push([id, d]); return { ok: true }; },
  };
  w.maestro = {
    dispatch(d) { if (w.busy) return { ok: false, transient: true, error: 'O terminal de destino ainda não está pronto.' }; const id = `task_${hex(++tn)}`; tasks.set(id, { status: 'delivered' }); return { ok: true, taskId: id }; },
    taskState: (id) => tasks.get(id) ?? null,
  };
  w.busy = true; // enquanto a pergunta está na tela o agente não recebe a etapa (o Maestro recusa como "ainda não pronto")
  w.flows = F.createFlows({ db, terminals: w.terminals, maestro: w.maestro, persist: () => {}, now: () => new Date(clock).toISOString(), uid: (p) => `${p}_${hex(++un)}`, setTimer: () => ({ unref() {} }), clearTimer: () => {}, pollMs: 0, onError: (e) => { throw e; } });
  w.start = async () => {
    const f = w.flows.create({ workspaceId: 'ws_1', title: 'Missão X', goal: 'Meta Y', steps: [{ id: 's1', title: 'Etapa s1', prompt: 'Faça s1', provider: 'claude', role: 'builder' }] }); assert.equal(f.ok, true, f.error);
    const r = w.flows.startRun(f.body.id); assert.equal(r.ok, true, r.error); w.flow = f.body; w.run = r.body; await w.flows.tick();
    w.tid = w.flows.getRun(w.flow.id, w.run.id).body.steps[0].terminalId; assert.ok(w.tid);
  };
  return w;
}

test('trustPromptShown: reconhece as perguntas de confiança de pasta do Claude Code só quando estão no FIM da tela', () => {
  assert.equal(F.trustPromptShown(PROMPT), true);
  assert.equal(F.trustPromptShown('Quick safety check: Is this a project you created or one you trust?\n 1. Yes, I trust this folder'), true);
  assert.equal(F.trustPromptShown(''), false); assert.equal(F.trustPromptShown(null), false); assert.equal(F.trustPromptShown('Bem-vindo ao Claude Code'), false);
  assert.equal(F.trustPromptShown('Do you trust the files in this folder?\n' + 'linha de trabalho\n'.repeat(200)), false, 'aviso antigo no meio de muita saída não conta');
});

test('o terminal da missão que mostra a pergunta recebe Enter sozinho, uma vez; depois que ela sai da tela nada mais é enviado', async () => {
  const w = world(); await w.start();
  assert.deepEqual(w.writes, [], 'sem a pergunta na tela nada é enviado');
  w.outputs.set(w.tid, PROMPT); await w.flows.tick();
  assert.deepEqual(w.writes, [[w.tid, '\r']], 'Enter (opção padrão "Yes") no terminal da missão');
  w.advance(500); await w.flows.tick(); assert.equal(w.writes.length, 1, 'não repete antes do intervalo mínimo');
  w.outputs.set(w.tid, 'Bem-vindo ao Claude Code'); w.advance(5000); await w.flows.tick(); assert.equal(w.writes.length, 1, 'respondida (saiu da tela): nada mais é enviado');
});

test('se o Enter for engolido e a pergunta continuar na tela, tenta de novo a cada 3 s, no máximo 3 vezes', async () => {
  const w = world(); await w.start();
  w.outputs.set(w.tid, PROMPT);
  for (let i = 0; i < 8; i++) { w.advance(3500); await w.flows.tick(); }
  assert.equal(w.writes.length, 3);
  assert.ok(w.writes.every(([id, d]) => id === w.tid && d === '\r'));
});

test('depois do Enter a tela mudou para OUTRO diálogo que ainda cita "trust": nenhum Enter extra (o aceite do bypass tem "sair" como padrão)', async () => {
  const w = world(); await w.start();
  w.outputs.set(w.tid, PROMPT); await w.flows.tick(); assert.equal(w.writes.length, 1);
  w.outputs.set(w.tid, PROMPT + ' WARNING: Bypass Permissions mode ... 1. No, exit  2. Yes, I accept'); // a pergunta de confiança ainda está nos últimos caracteres, mas a tela mudou
  for (let i = 0; i < 5; i++) { w.advance(3500); await w.flows.tick(); }
  assert.equal(w.writes.length, 1, 'só um Enter: a tela mudou depois dele');
});

test('depois de a etapa ser entregue, e em terminal que não é de nenhum run, nunca se envia Enter', async () => {
  const w = world(); w.busy = false; await w.start();
  assert.ok(w.flows.getRun(w.flow.id, w.run.id).body.steps[0].taskId, 'etapa entregue');
  w.outputs.set(w.tid, PROMPT); w.advance(5000); await w.flows.tick(); assert.deepEqual(w.writes, [], 'agente já trabalhando: a tela é dele');
  w.terms.set('term_user', { id: 'term_user', status: 'running', agent: { state: 'idle' } }); w.outputs.set('term_user', PROMPT); w.advance(5000); await w.flows.tick();
  assert.ok(!w.writes.some(([id]) => id === 'term_user'), 'terminal aberto pelo usuário nunca é tocado');
});

test('terminais sem readOutput/write (outra implementação) não quebram o runner', async () => {
  const w = world(); delete w.terminals.readOutput; delete w.terminals.write; await w.start();
  w.advance(5000); await w.flows.tick(); assert.deepEqual(w.writes, []);
});

test('trustPromptShown recusa a tela que cita outro diálogo (aceite do bypass, servidor MCP) mesmo com "trust" no fim', () => {
  assert.equal(F.trustPromptShown(PROMPT + ' WARNING: Bypass Permissions mode 1. No, exit 2. Yes, I accept'), false);
  assert.equal(F.trustPromptShown('New MCP server found in .mcp.json: yes, i trust this folder?'), false);
  assert.equal(F.trustPromptShown(PROMPT), true, 'a opção "No, exit" da própria pergunta de confiança não a invalida');
});
