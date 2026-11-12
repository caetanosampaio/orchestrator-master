// Visão de ambientes e grade do Cockpit (client/src/env-view.js): lógica pura, sem rede nem processos. Só reorganiza dados reais do servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerSummary, providerOf, pendingByPane, paneName } from '../../client/src/env-view.js';
import { GRID, BOX, PAD } from '../../client/src/brand-mark.mjs';
import { friendlyNames, environments, paneState, gridShape, evenTracks, dragTracks, dividerAt, MIN_TRACK } from '../../client/src/env-view.js';

const ws = (id, name, p) => ({ id, name, path: p });
const sess = (id, workspaceId, over = {}) => ({ id, workspaceId, status: 'running', exitCode: null, ...over });

test('friendlyNames: usa o nome do workspace ou a pasta; nomes repetidos ganham a pasta-mãe', () => {
  const m = friendlyNames([ws('a', 'Loja', 'C:\\x\\loja'), ws('b', '', 'C:\\x\\api\\'), ws('c', 'app', 'C:\\clientes\\app'), ws('d', 'App', 'C:\\interno\\app')]);
  assert.equal(m.get('a'), 'Loja'); assert.equal(m.get('b'), 'api');
  assert.equal(m.get('c'), 'app (clientes)'); assert.equal(m.get('d'), 'App (interno)');
});

test('environments: todos os workspaces cadastrados aparecem; contadores e atenção vêm dos dados reais', () => {
  const workspaces = [ws('a', 'A', '/a'), ws('b', 'B', '/b'), ws('c', 'C', '/c')];
  const sessions = [sess('t1', 'a'), sess('t2', 'a', { status: 'exited', exitCode: 1 }), sess('t3', 'a', { status: 'exited', exitCode: null }), sess('t4', 'b')];
  const out = environments({ workspaces, sessions, activeId: 'c', workingIds: new Set(['t1']), maestroTasks: [{ status: 'pending', to: 't4' }, { status: 'done', to: 't1' }, { status: 'pending', to: 'inexistente' }] });
  assert.deepEqual(out.map((e) => e.id), ['a', 'b', 'c'], 'ordem de cadastro');
  const a = out[0], b = out[1], c = out[2];
  assert.deepEqual([a.total, a.running, a.working, a.exited, a.failed, a.pendingTasks, a.attention], [3, 1, 1, 2, 1, 0, true], 'saída com código 1 pede atenção; encerrado sem código (fechado por você) não');
  assert.deepEqual([b.running, b.pendingTasks, b.attention], [1, 1, true], 'tarefa do maestro aguardando aprovação num pane do ambiente');
  assert.deepEqual([c.total, c.active, c.attention], [0, true, false], 'o ativo aparece mesmo sem sessões');
  const semSessoes = environments({ workspaces, sessions: [], activeId: null });
  assert.deepEqual(semSessoes.map((e) => e.id), ['a', 'b', 'c'], 'workspace sem sessão continua na lista (trocar de ambiente não o remove)');
  assert.ok(semSessoes.every((e) => e.total === 0 && !e.active && !e.attention), 'sem sessões: contadores zerados, nada inventado');
  const trocado = environments({ workspaces, sessions, activeId: 'b' });
  assert.deepEqual(trocado.map((e) => [e.id, e.active]), [['a', false], ['b', true], ['c', false]], 'só muda qual está ativo; cada um mantém as suas sessões');
  assert.equal(trocado[0].total, 3);
  assert.deepEqual(environments(), [], 'sem dados');
});

test('paneState: encerrado, falha, trabalhando ou ocioso', () => {
  const w = new Set(['x']);
  assert.equal(paneState(sess('x', 'a'), w), 'working'); assert.equal(paneState(sess('y', 'a'), w), 'idle');
  assert.equal(paneState(sess('z', 'a', { status: 'exited', exitCode: 0 }), w), 'exited'); assert.equal(paneState(sess('z', 'a', { status: 'exited', exitCode: null }), w), 'exited');
  assert.equal(paneState(sess('z', 'a', { status: 'exited', exitCode: 2 }), w), 'failed');
});

test('gridShape: 1, 2, 4, 6 e mais terminais; ímpar em 2 colunas prolonga o último', () => {
  assert.deepEqual(gridShape(0), { cols: 1, rows: 1, spanLast: false }); assert.deepEqual(gridShape(1), { cols: 1, rows: 1, spanLast: false });
  assert.deepEqual(gridShape(2), { cols: 2, rows: 1, spanLast: false }); assert.deepEqual(gridShape(3), { cols: 2, rows: 2, spanLast: true });
  assert.deepEqual(gridShape(4), { cols: 2, rows: 2, spanLast: false }); assert.deepEqual(gridShape(6), { cols: 3, rows: 2, spanLast: false });
  assert.deepEqual(gridShape(9), { cols: 3, rows: 3, spanLast: false }); assert.deepEqual(gridShape(10), { cols: 4, rows: 3, spanLast: false });
  assert.deepEqual(gridShape('x'), { cols: 1, rows: 1, spanLast: false });
});

test('dragTracks: mantém a soma, respeita o mínimo e ignora entradas inválidas; dividerAt dá a posição em %', () => {
  const t = evenTracks(3); assert.deepEqual(t, [1, 1, 1]);
  const m = dragTracks(t, 0, 0.5); assert.deepEqual(m, [1.5, 0.5, 1]); assert.equal(m.reduce((s, x) => s + x, 0), 3);
  const lim = dragTracks(t, 1, 5); assert.ok(Math.abs(lim[2] - MIN_TRACK) < 1e-9 && Math.abs(lim[1] + lim[2] - 2) < 1e-9, 'a vizinha nunca passa do mínimo');
  const neg = dragTracks(t, 0, -9); assert.ok(Math.abs(neg[0] - MIN_TRACK) < 1e-9);
  assert.deepEqual(dragTracks(t, 2, 0.3), t, 'não há divisor depois da última trilha'); assert.deepEqual(dragTracks(t, 0, NaN), t); assert.deepEqual(dragTracks(t, 0.5, 1), t);
  assert.notEqual(dragTracks(t, 0, 0.1), t, 'devolve cópia'); assert.deepEqual(t, [1, 1, 1], 'a entrada não é alterada');
  assert.equal(Math.round(dividerAt([1, 1, 1], 0)), 33); assert.equal(dividerAt([1, 1], 0), 50);
});

test('friendlyNames: o nome personalizado (displayName) vence; o original continua disponível e a identidade (id/path) não muda', () => {
  const w = [{ id: 'a', name: 'api', displayName: 'Loja', path: 'C:/x/api' }, { id: 'b', name: 'web', displayName: '  ', path: 'C:/x/web' }];
  const m = friendlyNames(w);
  assert.equal(m.get('a'), 'Loja'); assert.equal(m.get('b'), 'web', 'rótulo em branco não vale');
  const e = environments({ workspaces: w, activeId: 'a' });
  assert.deepEqual([e[0].name, e[0].original, e[0].renamed, e[0].path], ['Loja', 'api', true, 'C:/x/api']);
});

test('providerSummary: contagens vêm só das sessões reais; encerrado não é ativo; Codex existe como provider e só conta o que for real', () => {
  const S = (id, over = {}) => ({ id, workspaceId: 'a', status: 'running', exitCode: null, ...over });
  const sessions = [S('1'), S('2'), S('3'), S('4', { status: 'exited', exitCode: 1 }), S('5', { status: 'exited', exitCode: 0 })];
  const [claude, codex] = providerSummary(sessions, new Set(['1', '5']));  // '5' encerrado: estar em workingIds não o torna ativo
  assert.deepEqual([claude.total, claude.active, claude.working, claude.idle, claude.failed, claude.exited], [5, 3, 1, 2, 1, 1]);
  assert.deepEqual([codex.id, codex.available, codex.total, codex.active], ['codex', true, 0, 0]);
  const mixed = providerSummary([S('1'), S('c1', { provider: 'codex' }), S('c2', { provider: 'codex', status: 'exited', exitCode: 0 })], new Set(['c1']));
  assert.deepEqual([mixed[0].total, mixed[1].total, mixed[1].active, mixed[1].working], [1, 2, 1, 1], 'panes do Codex entram na linha do Codex');
  assert.equal(providerOf({}), 'claude');
  const none = providerSummary([], new Set());
  assert.deepEqual(none.map((r) => r.total), [0, 0], 'sem sessões: nada é inventado');
  const extra = providerSummary([S('9', { provider: 'outro' })]);
  assert.equal(extra.find((r) => r.id === 'outro').total, 1, 'provider desconhecido aparece com a contagem real');
});

test('marca: o Elmo em Chamas, capacete de cúpula redonda com detalhes de armadura (14x14) cabe na caixa de 16 (escala inteira em 16/32/48/64/128/256 px), com o desenho esperado', () => {
  assert.equal(BOX, 16); assert.equal(GRID.length, 14); assert.ok(GRID.every((r) => r.length === 14));
  assert.ok(GRID[0].length + PAD * 2 <= BOX && GRID.length + PAD * 2 <= BOX, 'cabe com margem');
  const count = (k) => GRID.flatMap((r) => [...r]).filter((ch) => ch === k).length;
  assert.deepEqual('KDGHLREOY'.split('').map(count), [10, 28, 11, 15, 8, 5, 14, 10, 8], 'encaixe dos olhos e ventilação, sombra, chapa, realce, rebites e brilho, fogo, gema e olhos ao rubro do ícone estático');
});

test('pendingByPane: só tarefas pendentes, agrupadas pelo pane de destino; some quando a decisão é tomada', () => {
  const tasks = [{ id: 'a', status: 'pending', to: 't1', text: 'x' }, { id: 'b', status: 'pending', to: 't1' }, { id: 'c', status: 'pending', to: 't2' }, { id: 'd', status: 'done', to: 't1' }, { id: 'e', status: 'rejected', to: 't3' }, { id: 'f', status: 'pending' }, null];
  const m = pendingByPane(tasks);
  assert.deepEqual([...m.keys()], ['t1', 't2']); assert.deepEqual(m.get('t1').map((t) => t.id), ['a', 'b']);
  const after = pendingByPane(tasks.map((t) => (t?.id === 'c' ? { ...t, status: 'delivered' } : t)));
  assert.equal(after.has('t2'), false, 'aprovada: o indicador some');
  assert.equal(pendingByPane().size, 0); assert.equal(pendingByPane('x').size, 0);
});

test('paneName: não repete o papel quando o título já o contém', () => {
  assert.deepEqual(paneName({ title: 'Construtor S1.2', roleLabel: 'Construtor' }, null), { role: '', name: 'Construtor S1.2' });
  assert.deepEqual(paneName({ title: 'api-fix', roleLabel: 'Revisor' }, null), { role: 'Revisor', name: 'api-fix' });
  assert.deepEqual(paneName({ title: '' }, { label: 'Scout' }), { role: '', name: 'Scout' });
});

test('environments: `agent` (logo da sidebar) é o provider do maestro; sem maestro, o do terminal executando; sem terminal ativo, null', () => {
  const W = [ws('a', 'A', 'C:/a'), ws('b', 'B', 'C:/b'), ws('c', 'C', 'C:/c')];
  const s = [
    sess('m', 'a', { role: 'maestro', provider: 'codex' }), sess('x', 'a', { role: 'builder', agent: { state: 'running' } }),
    sess('y', 'b', { role: 'builder', provider: 'claude' }), sess('z', 'b', { role: 'builder', provider: 'codex', agent: { state: 'running' } }),
    sess('q', 'c', { status: 'exited', exitCode: 0, role: 'maestro', provider: 'codex' }),
  ];
  const by = Object.fromEntries(environments({ workspaces: W, sessions: s }).map((e) => [e.id, e.agent]));
  assert.deepEqual(by, { a: 'codex', b: 'codex', c: null });
  assert.equal(environments({ workspaces: [ws('d', 'D', 'C:/d')], sessions: [sess('k', 'd', { role: 'maestro' })] })[0].agent, 'claude', 'sessão sem o campo provider vale Claude Code');
});

test('workingCount: "!" do forge-app conta terminais executando em qualquer workspace pelo estado real do agente (hooks), com a saída só como reserva', async () => {
  const { workingCount } = await import('../../client/src/env-view.js');
  const s = (id, ws, agent, status = 'running') => ({ id, workspaceId: ws, status, ...(agent ? { agent: { state: agent } } : {}) });
  assert.equal(workingCount([s('a', 'w1', 'running'), s('b', 'w2', 'running')], new Set()), 2, 'hooks dizem executando mesmo sem a saída crescer (agente rodando em silêncio)');
  assert.equal(workingCount([s('a', 'w1', 'idle'), s('b', 'w1', 'completed')], new Set(['a', 'b'])), 0, 'hooks mandam: ocioso/concluído não conta, mesmo com saída recente');
  assert.equal(workingCount([s('a', 'w1', null)], new Set(['a'])), 1, 'sem hooks vale a leitura pela saída');
  assert.equal(workingCount([s('a', 'w1', null)], new Set()), 0);
  assert.equal(workingCount([s('a', 'w1', 'running', 'exited')], new Set(['a'])), 0, 'terminal encerrado nunca conta');
  assert.equal(workingCount([s('a', 'w1', 'waiting')], new Set(['a'])), 0, 'aguardando você não é "executando"');
  assert.equal(workingCount(undefined), 0); assert.equal(workingCount(null, new Set(), null), 0);
});
