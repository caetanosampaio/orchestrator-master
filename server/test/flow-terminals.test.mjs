// Terminais das Missões: abrem num dock dentro da página Missões e ficam fora do Cockpit e da barra lateral.
// A lógica pura vive em client/src/flow-terminals.js (o cliente não tem testes próprios); aqui também se confere a fiação nos componentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowTerminalIds, withoutFlowTerminals, flowTerminalTabs, pickTerminalTab } from '../../client/src/flow-terminals.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(here, '../../client/src', f), 'utf8');
const rs = (stepId, status, terminalId = null) => ({ stepId, status, terminalId });
const flow = (o = {}) => ({ id: 'f1', steps: [{ id: 's1', title: 'Pesquisa' }, { id: 's2', title: 'Construção' }, { id: 's3', title: 'Revisão' }], activeRun: null, lastRun: null, ...o });

test('flowTerminalIds junta os terminais do run ativo e do último run; ignora ausentes e valores inválidos', () => {
  const ids = flowTerminalIds([
    flow({ activeRun: { steps: [rs('s1', 'running', 't1'), rs('s2', 'pending', null)] } }),
    flow({ id: 'f2', lastRun: { steps: [rs('s1', 'completed', 't2'), rs('s2', 'completed', 123), { stepId: 's3' }] } }),
    null,
  ]);
  assert.deepEqual([...ids].sort(), ['t1', 't2']);
  assert.equal(flowTerminalIds(null).size, 0);
  assert.equal(flowTerminalIds([flow()]).size, 0);
});

test('withoutFlowTerminals tira só os terminais de missões e devolve a mesma lista quando não há o que esconder', () => {
  const sessions = [{ id: 'a' }, { id: 't1' }, { id: 'b' }];
  assert.deepEqual(withoutFlowTerminals(sessions, new Set(['t1'])).map((s) => s.id), ['a', 'b']);
  assert.equal(withoutFlowTerminals(sessions, new Set()), sessions, 'referência estável sem ids escondidos');
  assert.equal(withoutFlowTerminals(sessions, null), sessions);
  assert.deepEqual(withoutFlowTerminals(undefined, new Set(['x'])), []);
});

test('abas do dock: uma por terminal do run atual, na ordem da definição; continueFrom (terminal repetido) vira uma aba só', () => {
  const run = { steps: [rs('s3', 'pending', null), rs('s2', 'running', 't2'), rs('s1', 'completed', 't1'), rs('s4', 'completed', 't1')] };
  const tabs = flowTerminalTabs(flow({ activeRun: run }), [{ id: 't2', title: 'x' }]);
  assert.deepEqual(tabs.map((t) => [t.terminalId, t.title]), [['t1', 'Pesquisa'], ['t2', 'Construção']]);
  assert.equal(tabs[0].session, null, 'sessão que o servidor já esqueceu: a aba continua, sem sessão');
  assert.equal(tabs[1].session.id, 't2');
  assert.deepEqual(flowTerminalTabs(flow(), []), [], 'sem run = sem abas');
  assert.equal(flowTerminalTabs(flow({ lastRun: { steps: [rs('s1', 'completed', 't9')] } }), [])[0].terminalId, 't9', 'sem run ativo usa o último');
});

test('aba ativa: a pedida; senão a que espera você; senão a em execução; senão a primeira', () => {
  const tabs = [{ terminalId: 'a', stepStatus: 'completed' }, { terminalId: 'b', stepStatus: 'running' }, { terminalId: 'c', stepStatus: 'waiting' }];
  assert.equal(pickTerminalTab(tabs, 'a'), 'a');
  assert.equal(pickTerminalTab(tabs, 'zzz'), 'c', 'pedida inexistente cai na que espera você');
  assert.equal(pickTerminalTab(tabs.slice(0, 2)), 'b');
  assert.equal(pickTerminalTab(tabs.slice(0, 1)), 'a');
  assert.equal(pickTerminalTab([]), null);
});

test('fiação: App compartilha UMA conexão e esconde os terminais de missões; Missões abre o dock; encerrar o terminal não é oferecido', () => {
  const app = src('App.jsx'), cockpit = src('pages/Cockpit.jsx'), grid = src('components/TerminalGrid.jsx'), sb = src('components/Sidebar.jsx'), page = src('pages/Missions.jsx'), dock = src('components/FlowTerminals.jsx');
  for (const t of ['const flowTermIds = useMemo(() => flowTerminalIds(flowsData.flows)', '<Cockpit stream={termStream} hiddenIds={flowTermIds}', '<Missions onOpenCockpit={openCockpit} data={flowsData} stream={termStream} />', 'hiddenIds: flowTermIds']) assert.ok(app.includes(t), t);
  assert.ok(cockpit.includes('stream: shared = null'), 'o Cockpit usa a conexão do App quando existe');
  assert.ok(grid.includes('withoutFlowTerminals(terminals?.sessions, hiddenIds)'), 'a grade do Cockpit não monta terminais de missões');
  assert.ok(sb.includes('withoutFlowTerminals(terminals?.sessions, hiddenIds)'), 'a barra lateral não aninha terminais de missões nos workspaces');
  assert.ok(page.includes('<FlowTerminals ') && !page.includes('onOpenCockpit(flow'), 'Missões abre os terminais no dock, não no Cockpit');
  assert.ok(grid.includes('export function TerminalPane') && grid.includes('{onClose && <button'), 'sem onClose o painel não mostra o botão de encerrar');
  assert.ok(dock.includes('onClose={null}'), 'o dock não oferece encerrar a etapa');
});
