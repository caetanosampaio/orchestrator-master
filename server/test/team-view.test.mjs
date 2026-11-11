// Equipe do workspace: presets, nomes, composição e impacto da troca (client/src/team-view.js) + persistência por workspace no layout (servidor e cliente). PURO.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRESETS, PRESET_IDS, isPresetId, presetById, missingRoles, extraRoles, changeImpact, inferTeam } from '../../client/src/team-view.js';
import { readLayout, validateLayoutPatch, TEAM_PRESETS } from '../layouts.js';
import { createLayoutSync, sanitizeLayout } from '../../client/src/layout-state.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');

test('nomes e composição: Dupla 2, Squad 4, Squad de 6 = 6, Construtor 1; ids internos preservados; "Squad de 4" não existe mais', () => {
  assert.deepEqual(PRESETS.map((p) => [p.id, p.label, p.roles.length]), [['duo', 'Dupla', 2], ['squad', 'Squad', 4], ['full', 'Squad de 6', 6], ['builder', 'Construtor', 1]]);
  assert.deepEqual(presetById('squad').roles, ['maestro', 'builder', 'builder', 'reviewer'], 'a composição real do squad não mudou');
  assert.deepEqual(presetById('full').roles, ['maestro', 'scout', 'builder', 'builder', 'builder', 'reviewer']);
  for (const f of ['team-view.js', 'components/TerminalGrid.jsx', 'components/TeamMenu.jsx', 'pages/Settings.jsx']) assert.doesNotMatch(src(f), /Squad de 4/, `${f} ainda cita "Squad de 4"`);
  assert.ok(isPresetId('duo') && !isPresetId('squad4') && !isPresetId(undefined));
});

test('missingRoles/extraRoles: multiconjunto; nunca sugere encerrar', () => {
  assert.deepEqual(missingRoles(['maestro', 'builder', 'builder', 'reviewer'], ['builder', 'reviewer']), ['maestro', 'builder']);
  assert.deepEqual(missingRoles(['builder', 'reviewer'], ['builder', 'builder', 'reviewer', 'scout']), []);
  assert.deepEqual(extraRoles(['builder', 'reviewer'], ['builder', 'builder', 'reviewer', 'scout']), ['builder', 'scout']);
  assert.deepEqual(missingRoles(presetById('duo').roles, []), ['builder', 'reviewer']);
});

test('impacto da troca: informa o que continua rodando e o que será aberto, respeita o limite e só pede confirmação com terminais ativos', () => {
  const label = { maestro: 'Maestro', builder: 'Construtor', reviewer: 'Revisor', scout: 'Batedor' };
  const im = changeImpact({ from: 'duo', to: 'squad', liveRoles: ['builder', 'reviewer'], labelOf: (r) => label[r] ?? r, room: 8 });
  assert.equal(im.needsConfirm, true); assert.deepEqual(im.open, ['maestro', 'builder']);
  assert.match(im.text, /2 terminais ativos continuam rodando: nenhum processo, sessão ou worktree é encerrado/); assert.match(im.text, /Serão abertos 2 terminais novos.*Maestro, Construtor/);
  const tight = changeImpact({ from: 'duo', to: 'full', liveRoles: ['builder', 'reviewer'], room: 1 }); assert.equal(tight.open.length, 1); assert.equal(tight.skipped, 3); assert.match(tight.text, /3 terminais não cabem/);
  assert.equal(changeImpact({ from: null, to: 'duo', liveRoles: [], room: 8 }).needsConfirm, false);
  assert.equal(changeImpact({ from: 'duo', to: 'duo', liveRoles: ['builder', 'reviewer'], room: 8 }).open.length, 0);
  assert.equal(changeImpact({ to: 'nada', liveRoles: [] }), null);
});

test('servidor: a equipe é um campo opcional do layout do workspace, validado por lista fixa; workspaces antigos mantêm o formato de sempre', () => {
  assert.deepEqual(TEAM_PRESETS, PRESET_IDS, 'os ids do servidor e do cliente são os mesmos');
  assert.deepEqual(readLayout({ order: [] }), { order: [], maximized: null, grids: {} }, 'sem equipe: nenhum campo novo aparece');
  assert.equal(readLayout({ team: 'squad' }).team, 'squad'); assert.equal('team' in readLayout({ team: 'hacker' }), false); assert.equal('team' in readLayout({ team: null }), false);
  assert.deepEqual(validateLayoutPatch({ team: 'full' }).patch, { team: 'full' }); assert.deepEqual(validateLayoutPatch({ team: null }).patch, { team: null });
  assert.match(validateLayoutPatch({ team: 'squad de 4' }).error, /team deve ser/); assert.match(validateLayoutPatch({ team: 3 }).error, /team deve ser/);
  assert.match(validateLayoutPatch({ team: 'duo', foo: 1 }).error, /Propriedades não permitidas: foo/);
});

test('cliente: sanitizeLayout mantém só equipe válida; setTeam grava por workspace e um não afeta o outro; limpar e repetir o mesmo valor não gravam à toa', async () => {
  assert.equal(sanitizeLayout({ team: 'duo' }).team, 'duo'); assert.equal('team' in sanitizeLayout({ team: 'x' }), false);
  const puts = [];
  const sync = createLayoutSync({ get: async () => ({ layouts: {} }), put: async (ws, body) => { puts.push([ws, body]); return { layout: { order: [], maximized: null, grids: {}, ...(body.team ? { team: body.team } : {}) } }; }, storage: null, debounceMs: 0, retryMs: 10, setTimer: (fn) => { fn(); return 0; }, clearTimer() {} });
  await sync.load();
  sync.actions.setTeam('wsA', 'squad'); sync.actions.setTeam('wsB', 'duo');
  await sync.flush(); await sync.flush();
  assert.equal(sync.getSnapshot().layouts.wsA.team, 'squad'); assert.equal(sync.getSnapshot().layouts.wsB.team, 'duo');
  assert.deepEqual(puts.map(([w, b]) => [w, b.team]).sort(), [['wsA', 'squad'], ['wsB', 'duo']]);
  const n = puts.length; sync.actions.setTeam('wsA', 'squad'); sync.actions.setTeam('wsA', 'não-existe'); await sync.flush(); assert.equal(puts.length, n, 'mesmo valor ou valor inválido: nada é gravado');
  sync.actions.setTeam('wsA', null); await sync.flush(); assert.equal(puts.at(-1)[1].team, null); assert.equal(sync.getSnapshot().layouts.wsA.team ?? null, null); assert.equal(sync.getSnapshot().layouts.wsB.team, 'duo', 'o outro workspace não foi tocado');
});

test('toolbar: só os controles operacionais (sem chip de workspace nem menu de equipe); equipes e workspace moraram fora do Cockpit; sem seletor de agente solto, Visualização e Histórico fora da barra', () => {
  const g = src('components/TerminalGrid.jsx');
  assert.match(g, /className="oc-bar tbx"/); assert.equal((g.match(/className="tbx-g/g) ?? []).length, 1, 'um grupo só: controles operacionais');
  assert.doesNotMatch(g, /oc-wschip|TeamMenu|TeamComposer|name="workspace"/, 'o chip do workspace e a gestão de equipe saíram da barra do Cockpit');
  assert.doesNotMatch(g, /tbx-presets|oc-prov-sel/, 'sem presets nem seletor de agente soltos na barra');
  assert.match(g, /<SquadGallery /); assert.match(g, /onManage=\{\(\) => onOpenSettings\?\.\('equipes'\)\}/, 'o estado vazio leva a Configurações > Equipes');
  assert.doesNotMatch(g, /Novo terminal<|<Icon name="plus" size=\{14\} \/> Terminal/, 'o + Terminal destacado saiu da barra');
  assert.doesNotMatch(g, /LAYOUT_MODES|oc-seg|aria-label="Histórico"|setHistOpen|<SessionHistory/, 'Grade/Colunas/Linhas/Foco e Histórico saíram da tela principal');
  const menu = src('components/TeamMenu.jsx');
  for (const t of ['Composição atual', 'Alterar preset', 'Adicionar agente ou terminal', 'Redefinir equipe']) assert.match(menu, new RegExp(t));
  assert.match(menu, /aria-label=\{s\.status === 'running' \? `Encerrar/);
  const css = src('retro.css'); assert.match(css, /--tb-h: 24px/); assert.match(css, /@container \(max-width: 760px\)/); assert.match(css, /@container \(max-width: 520px\)/);
});

test('Visualização mora nas Configurações e as Sessões (histórico) moram no rodapé da barra lateral do Cockpit, com o mesmo conteúdo de antes', () => {
  const st = ['pages/Settings.jsx', 'settings-nav.js', 'components/settings/SettingsUi.jsx', 'components/settings/AppSections.jsx', 'components/settings/TeamSections.jsx', 'components/settings/AisSection.jsx', 'components/settings/MascotsSection.jsx'].map(src).join('\n');
  assert.match(st, /item\('visualizacao', 'Visualização'/); assert.match(st, /LAYOUT_MODES\.map/); assert.match(st, /useLayoutMode\(openWs\?\.id\)/);
  assert.doesNotMatch(st, /item\('historico'|SessionHistoryBody|HistorySection/, 'o histórico de sessões saiu das Configurações');
  const dlg = src('components/SessionsDialog.jsx'); assert.match(dlg, /<SessionHistoryBody ws=\{ws\}/); assert.match(dlg, /onAutoRestore=\{setAutoRestore\}/, 'o interruptor da restauração automática continua no histórico');
  assert.match(src('App.jsx'), /dialog === 'sessions' && <SessionsDialog onClose=\{closeDialog\} \/>/); assert.match(src('components/Sidebar.jsx'), /onClick=\{onOpenSessions\}/);
  assert.match(src('components/TerminalGrid.jsx'), /useLayoutMode\(ws\?\.id\)/, 'o cockpit lê o mesmo modo que as Configurações gravam');
  assert.match(src('components/TerminalGrid.jsx'), /onOpenSessions\?\.\(\)/, 'o botão "Restaurar sessões" do estado vazio abre as Sessões'); assert.doesNotMatch(src('components/TerminalGrid.jsx'), /onOpenSettings\?\.\('historico'\)/);
});

// ---- equipe mista ----
import { LEAD_ROLES, MIXES, mixAgents, availableMixes, defaultMix, composeProblem, mixSummary, mixById } from '../../client/src/team-view.js';

test('mixAgents: atalhos por vaga (Squad = maestro, builder, builder, reviewer)', () => {
  const squad = ['maestro', 'builder', 'builder', 'reviewer'];
  assert.deepEqual(mixAgents(squad, 'all-claude'), ['claude', 'claude', 'claude', 'claude']);
  assert.deepEqual(mixAgents(squad, 'all-codex'), ['codex', 'codex', 'codex', 'codex']);
  assert.deepEqual(mixAgents(squad, 'claude-leads'), ['claude', 'codex', 'codex', 'claude']);
  assert.deepEqual(mixAgents(squad, 'codex-leads'), ['codex', 'claude', 'claude', 'codex']);
  assert.deepEqual(mixAgents(['maestro', 'scout', 'builder', 'builder', 'builder', 'reviewer'], 'claude-leads'), ['claude', 'claude', 'codex', 'codex', 'codex', 'claude'], 'Squad de 6: batedor também lidera');
  assert.deepEqual(mixAgents(['builder', 'reviewer'], 'desconhecido', 'codex'), ['codex', 'codex'], 'atalho desconhecido: tudo no fallback');
  assert.deepEqual(mixAgents(null, 'all-claude'), []);
  assert.ok(LEAD_ROLES.includes('maestro') && !LEAD_ROLES.includes('builder'));
  assert.equal(mixById('claude-leads').needs.length, 2); assert.equal(mixById('x'), null);
});

test('availableMixes / defaultMix: só atalhos cujos provedores existem; padrão é Claude lidera quando há os dois', () => {
  assert.deepEqual(availableMixes(['claude', 'codex']).map((m) => m.id), MIXES.map((m) => m.id));
  assert.deepEqual(availableMixes(['claude']).map((m) => m.id), ['all-claude']);
  assert.deepEqual(availableMixes(['codex']).map((m) => m.id), ['all-codex']);
  assert.deepEqual(availableMixes([]).map((m) => m.id), []);
  assert.equal(defaultMix(['claude', 'codex']), 'claude-leads'); assert.equal(defaultMix(['claude']), 'all-claude'); assert.equal(defaultMix(['codex']), 'all-codex');
});

test('composeProblem: vazio, sem vagas, agente indisponível e plano válido', () => {
  assert.match(composeProblem([], ['claude']), /Escolha uma equipe/);
  assert.match(composeProblem(['claude', 'codex', 'claude'], ['claude', 'codex'], 2), /3 vagas e há 2 livres/);
  assert.match(composeProblem(['claude', 'codex'], ['claude']), /"codex" não está disponível/);
  assert.equal(composeProblem(['claude', 'codex'], ['claude', 'codex'], 10), null);
});

test('mixSummary: contagem por agente na ordem de aparição', () => {
  const label = { claude: 'Claude Code', codex: 'Codex CLI' };
  assert.equal(mixSummary(['claude', 'codex', 'codex', 'claude'], (id) => label[id]), '2 Claude Code, 2 Codex CLI');
  assert.equal(mixSummary([], (id) => id), '');
});

test('tela sem terminais: galeria de equipes ligada ao cockpit (gestão em Configurações > Equipes); cada terminal abre com o agente, o modelo e o esforço da sua vaga', () => {
  const g = src('components/TerminalGrid.jsx');
  assert.match(g, /<SquadGallery /); assert.doesNotMatch(g, /<TeamComposer /, 'o editor mora em Configurações > Equipes'); assert.match(g, /useSquads\(\)/);
  assert.match(g, /providers: perSlot = null/); assert.match(g, /\(perSlot && perSlot\[i\]\) \|\| useProvider/, 'o agente de cada vaga vai no POST');
  assert.match(g, /perModel\?\.\[i\] \? \{ model: perModel\[i\] \}/); assert.match(g, /perEffort\?\.\[i\] \? \{ effort: perEffort\[i\] \}/, 'modelo e esforço por vaga vão no POST só quando escolhidos');
  assert.match(g, /openPlan\(launchPlan\(/, 'abrir uma equipe usa o plano (papéis, agentes, modelos e esforços por vaga)');
  assert.doesNotMatch(g, /Equipe mista…/, 'o botão antigo foi substituído pela galeria de equipes');
  const gal = src('components/SquadGallery.jsx');
  for (const t of ['Equipes do FORGE', 'Minhas equipes', 'Nova equipe', 'Gerenciar times', 'role="alertdialog"']) assert.match(gal, new RegExp(t), t);
  const cmp = src('components/TeamComposer.jsx');
  for (const t of ['Adicionar vaga', 'Salvar squad', 'Abrir equipe', 'Começar de', 'Modelo da vaga', 'Esforço da vaga']) assert.match(cmp, new RegExp(t), t);
  const css = src('retro.css'); for (const k of ['sq-in', 'sq-boot', 'sq-glow', 'sq-wave', 'sq-flash']) assert.match(css, new RegExp(`@keyframes ${k}`), `animação ${k}`);
});

test('troca de preset: um passo por vez, escolha Manter/Fechar explícita e botão fixo sem animação', () => {
  const menu = src('components/TeamMenu.jsx'), css = src('retro.css');
  assert.match(menu, /\{!plan && <>/, 'durante a troca o menu mostra só a troca');
  assert.match(menu, /className="tm-seg"/); assert.match(menu, />Manter<\/button>/); assert.match(menu, />Fechar<\/button>/);
  assert.match(menu, /Trocar para \{target\.label\}<\/Btn>/, 'o botão diz o destino da troca'); assert.match(menu, /<b>Resultado:<\/b>/, 'o resultado em palavras fica acima do botão');
  assert.match(menu, /Voltar aos presets/); assert.doesNotMatch(menu, /nunca encerra processos/, 'a troca pode fechar terminais (com confirmação): o texto não pode negar isso');
  const act = css.slice(css.indexOf('.tm-plan-act {')); assert.match(act, /position: sticky/); assert.doesNotMatch(css, /tm-cta|animation:[^;}]*tm-/, 'o botão de aplicar não pisca');
});
