// Terminais das Missões: abrem num dock dentro da página Missões e ficam fora do Cockpit e da barra lateral.
// A lógica pura vive em client/src/flow-terminals.js (o cliente não tem testes próprios); aqui também se confere a fiação nos componentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flowTerminalIds, withoutFlowTerminals, flowTerminalTabs, pickTerminalTab, plannerTabs, isPlannerSession, teamSlotRoles } from '../../client/src/flow-terminals.js';

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

// ---------- Planejador de missão (criar por briefing, docs/missions-v2-briefing.md) ----------
test('Planejador: fica fora do Cockpit e da barra lateral (como os terminais de missão); sem nada a esconder a lista continua a MESMA', () => {
  const sessions = [{ id: 'a', role: 'builder' }, { id: 'p1', role: 'planner' }, { id: 't1', role: 'builder' }];
  assert.equal(isPlannerSession(sessions[1]), true); assert.equal(isPlannerSession(sessions[0]), false); assert.equal(isPlannerSession(null), false);
  assert.deepEqual(withoutFlowTerminals(sessions, new Set()).map((s) => s.id), ['a', 't1'], 'só o planejador sai');
  assert.deepEqual(withoutFlowTerminals(sessions, new Set(['t1'])).map((s) => s.id), ['a'], 'planejador e terminal de missão saem');
  assert.deepEqual(withoutFlowTerminals(sessions, null).map((s) => s.id), ['a', 't1']);
  const plain = [{ id: 'a', role: 'builder' }, { id: 'm', role: 'maestro' }];
  assert.equal(withoutFlowTerminals(plain, new Set()), plain, 'referência estável sem planejador nem ids escondidos');
});

test('Planejador: uma aba por terminal planner (com ou sem missão), na ordem de abertura, numerada quando há vários, e só ela pode ser fechada no dock', () => {
  const ws = [{ id: 'ws_1', displayName: 'Loja' }];
  const sessions = [
    { id: 'p2', role: 'planner', workspaceId: 'ws_x', startedAt: '2026-11-19T11:00:00.000Z', status: 'running' },
    { id: 'b1', role: 'builder', workspaceId: 'ws_1', startedAt: '2026-11-19T09:00:00.000Z' },
    { id: 'p1', role: 'planner', workspaceId: 'ws_1', startedAt: '2026-11-19T10:00:00.000Z', status: 'exited' },
    { id: '', role: 'planner' },
  ];
  const tabs = plannerTabs(sessions, { workspaces: ws });
  assert.deepEqual(tabs.map((t) => [t.terminalId, t.title, t.workspaceName, t.kind, t.closable, t.session.id]), [['p1', 'Planejador 1', 'Loja', 'planner', true, 'p1'], ['p2', 'Planejador 2', null, 'planner', true, 'p2']]);
  assert.equal(plannerTabs([sessions[2]])[0].title, 'Planejador', 'um só: sem número');
  assert.deepEqual(plannerTabs(null), []);
  assert.equal(pickTerminalTab([...tabs, { terminalId: 'x', stepStatus: 'running' }], 'p2'), 'p2', 'o Planejador recém-aberto fica à vista');
  // abas de etapa continuam sem fechar
  const step = flowTerminalTabs(flow({ activeRun: { steps: [rs('s1', 'running', 't1')] } }), []);
  assert.deepEqual([step[0].kind, step[0].closable], ['step', false]);
  const dock = src('components/FlowTerminals.jsx');
  assert.ok(dock.includes('sess && active.closable && onCloseTab ?') && dock.includes('onClose={() => onCloseTab(active)}'), 'só a aba que pode fechar (Planejador) recebe o botão de encerrar');
  assert.ok(dock.includes('aria-label={label}'), 'região com rótulo do que está aberto');
});

// ---------- revisão do briefing: Planejador fora das vagas de equipe e do "terminou" da barra lateral ----------
test('vagas de equipe: o seletor de papéis não oferece o Planejador (o servidor recusa); o Maestro continua', () => {
  const roles = [{ id: 'maestro', label: 'Maestro' }, { id: 'builder', label: 'Construtor' }, { id: 'planner', label: 'Planejador' }, { id: 'reviewer', label: 'Revisor' }, null, { label: 'sem id' }, { id: '' }];
  assert.deepEqual(teamSlotRoles(roles).map((r) => r.id), ['maestro', 'builder', 'reviewer']);
  assert.deepEqual(teamSlotRoles(null), []);
  const cmp = src('components/TeamComposer.jsx');
  assert.ok(cmp.includes('const slotRoles = teamSlotRoles(roles);') && cmp.includes('{slotRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}'));
  assert.ok(!/label=\{`Papel da vaga \$\{i \+ 1\}`\}[^\n]*\{roles\.map\(/.test(cmp), 'o seletor da vaga não usa a lista crua');
});

test('barra lateral: terminais de missão e do Planejador não contam no "terminou" (!) dos workspaces; o estado dos panes (workingIds) continua para o dock', () => {
  const st = src('store.jsx'), app = src('App.jsx');
  assert.ok(st.includes("workEnd.current.update(new Set(withoutFlowTerminals(d.sessions, hiddenRef.current).filter((x) => x.workspaceId && paneState(x, act) === 'working')"), 'fim do trabalho só dos terminais do Cockpit');
  assert.ok(st.includes("finishedStamps({ sessions: withoutFlowTerminals(terminals?.sessions, hiddenTerms).filter((x) => x.status === 'running')"), 'carimbos de término sem missão nem Planejador');
  assert.ok(st.includes('setWorkingIds((prev) => (prev.size === act.size') && st.includes('const act = tracker.current.update(d.sessions);'), 'workingIds segue com todos (o dock de Missões usa)');
  assert.ok(st.includes('setHiddenTerminals') && app.includes('useEffect(() => { setHiddenTerminals?.(flowTermIds); }, [flowTermIds, setHiddenTerminals]);'), 'o App informa os terminais das missões');
});
