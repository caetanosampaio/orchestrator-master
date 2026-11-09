// Limites das contas (cliente, funções puras): cor da barra pelo uso, tempo até o reset, normalização da rota e guardas de interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { providerSummary, clampPct, usageColor, usageBand, fmtReset, fmtResetLong, fmtResetAt, normalizeLimits, visibleAccounts, resetLabel, sourceNote, limitsSummary, WINDOWS, DASH } from '../../client/src/limits-view.js';

const src = (f) => fs.readFileSync(new URL(`../../client/src/${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const at = (ms) => new Date(NOW + ms).toISOString();
const hue = (c) => Number(/hsl\((\d+)/.exec(c)[1]);

test('cor da barra: verde com folga e cada vez mais vermelha perto do limite (contínua e monótona)', () => {
  assert.equal(hue(usageColor(0)), 142); assert.equal(hue(usageColor(35)), 142, 'verde puro até ~35 %');
  let prev = 143; for (let p = 0; p <= 100; p += 5) { const h = hue(usageColor(p)); assert.ok(h <= prev, `o matiz nunca sobe (${p}%: ${h} depois de ${prev})`); prev = h; }
  assert.ok(hue(usageColor(60)) > 40 && hue(usageColor(60)) < 142, 'a 60 % já esquentou'); assert.ok(hue(usageColor(85)) < 40, 'a 85 % é laranja avermelhado');
  assert.equal(hue(usageColor(95)), 0); assert.equal(hue(usageColor(100)), 0, 'a partir de ~95 % é vermelho pleno');
  assert.equal(usageColor(null), 'hsl(0 0% 40%)'); assert.equal(usageColor(undefined), usageColor(NaN), 'sem dado = cinza');
  assert.equal(clampPct(140), 100); assert.equal(clampPct(-3), 0); assert.equal(clampPct('x'), null);
  assert.deepEqual([null, 10, 60, 84.9, 85, 100].map(usageBand), ['none', 'ok', 'warn', 'warn', 'crit', 'crit']);
});

test('tempo até o reset: compacto como na barra (min, h, d), por extenso no painel, e janela já reiniciada = null', () => {
  assert.equal(fmtReset(at(40 * 60e3), NOW), '40min'); assert.equal(fmtReset(at(30e3), NOW), '1min', 'nunca 0');
  assert.equal(fmtReset(at(9 * 3600e3 + 120e3), NOW), '9h'); assert.equal(fmtReset(at(23.9 * 3600e3), NOW), '23h');
  assert.equal(fmtReset(at(24 * 3600e3), NOW), '1d'); assert.equal(fmtReset(at(3 * 86400e3 + 5 * 3600e3), NOW), '3d');
  assert.equal(fmtReset(at(-1000), NOW), null); assert.equal(fmtReset('lixo', NOW), null); assert.equal(fmtReset(undefined, NOW), null);
  assert.equal(fmtResetLong(at(2 * 3600e3 + 10 * 60e3), NOW), '2 h 10 min'); assert.equal(fmtResetLong(at(3 * 86400e3 + 4 * 3600e3), NOW), '3 d 4 h'); assert.equal(fmtResetLong(at(86400e3), NOW), '1 d'); assert.equal(fmtResetLong(at(5 * 60e3), NOW), '5 min');
  assert.equal(fmtResetLong(at(-5), NOW), null);
  assert.match(fmtResetAt(at(3600e3), NOW), /^(hoje|amanhã) \d\d:\d\d$/); assert.match(fmtResetAt(at(3 * 86400e3), NOW), /^(dom|seg|ter|qua|qui|sex|sáb) \d\d:\d\d$/); assert.equal(fmtResetAt('x', NOW), null);
});

const RAW = () => ({ updatedAt: at(0), providers: [
  { provider: 'claude', label: 'Claude Code', accounts: [
    { id: 'system', label: 'Sistema', connected: true, plan: 'max', source: 'statusline', session: { usedPct: 12, resetsAt: at(9 * 3600e3), windowMinutes: 300 }, week: { usedPct: 96, resetsAt: at(5 * 3600e3), windowMinutes: 10080 }, updatedAt: at(-1000) },
    { id: 'acc_11111111', label: '', connected: false, source: 'sem-dados', session: null, week: null },
    { id: 'acc_22222222', label: 'Pessoal', connected: null, source: 'estranha', session: { usedPct: 250, resetsAt: at(3600e3) }, week: { usedPct: 10, resetsAt: at(-5000) } },
    null, { label: 'sem id' } ] },
  { provider: 'codex', label: 'Codex CLI', accounts: [{ id: 'codex', label: 'Codex', connected: true, plan: 'plus', source: 'rollout', session: { usedPct: 2, resetsAt: at(3 * 3600e3) }, week: { usedPct: 8, resetsAt: at(86400e3) } }] },
] });

test('normalizeLimits: aceita o contrato, recusa o resto (servidor antigo = null), sanitiza e numera as contas do Claude', () => {
  assert.equal(normalizeLimits(null, NOW), null); assert.equal(normalizeLimits({}, NOW), null); assert.equal(normalizeLimits({ providers: 'x' }, NOW), null); assert.equal(normalizeLimits('texto', NOW), null);
  const n = normalizeLimits(RAW(), NOW), cl = n.providers[0].accounts;
  assert.equal(cl.length, 3, 'entradas sem id são descartadas'); assert.deepEqual(cl.map((a) => a.index), [1, 2, 3]); assert.equal(n.providers[1].accounts[0].index, null, 'o Codex não é numerado');
  assert.equal(cl[1].label, 'acc_11111111', 'sem nome usa o id'); assert.equal(cl[2].source, 'sem-dados', 'fonte desconhecida vira sem-dados'); assert.equal(cl[2].connected, null);
  assert.equal(cl[2].session.usedPct, 100, 'percentual acima de 100 é limitado'); assert.equal(cl[2].week, null, 'janela cujo reset já passou é descartada, mesmo se o servidor a mandou');
  assert.equal(cl[0].critical, 'week', 'a janela mais perto do limite define o tempo mostrado'); assert.equal(resetLabel(cl[0], NOW), '5h');
  assert.equal(cl[1].critical, null); assert.equal(resetLabel(cl[1], NOW), DASH);
  assert.deepEqual(visibleAccounts(n.providers[0]).map((a) => a.id), ['system', 'acc_22222222'], 'conta desconectada não ocupa a faixa');
});

test('textos: motivo da falta de leitura e resumo para leitor de tela', () => {
  assert.match(sourceNote({ source: 'statusline-propria' }, 'claude'), /status line própria/); assert.match(sourceNote({ source: 'desligado' }, 'claude'), /ORCH_CLAUDE_STATUSLINE=off/);
  assert.match(sourceNote({ source: 'sem-dados' }, 'claude'), /primeira resposta/); assert.match(sourceNote({ source: 'sem-dados' }, 'codex'), /Codex/); assert.equal(sourceNote({ source: 'statusline' }, 'claude'), null);
  const sum = limitsSummary(normalizeLimits(RAW(), NOW), NOW);
  assert.match(sum, /Claude Code conta 1 \(Sistema\): 5 h 12% \(reseta em 9 h\), semana 96% \(reseta em 5 h\)/); assert.match(sum, /Codex CLI: 5 h 2%/); assert.doesNotMatch(sum, /acc_11111111/);
  assert.equal(limitsSummary(null, NOW), 'Limites das contas: sem leitura.'); assert.match(limitsSummary({ providers: [] }, NOW), /nenhuma conta conectada/);
  assert.deepEqual(WINDOWS.map((w) => w.key), ['session', 'week']);
});

test('interface: a faixa de limites mora no canto superior direito (botão do status global), com um ícone por provedor e o painel traz os detalhes', () => {
  const ss = src('components/SystemStatus.jsx'), ls = src('components/LimitsStrip.jsx'), tb = src('components/Topbar.jsx');
  assert.match(tb, /<SystemStatus \/>/); assert.match(ss, /<LimitsBars limits=\{limits\} now=\{now\} refresh=\{refresh\} \/>/); assert.match(ss, /useLimits\(\)/);
  assert.doesNotMatch(ss, /cell\(s\.ativos/, 'os contadores saíram do botão (estão no cabeçalho do painel e no tooltip)'); assert.match(ss, /statusLine\(s\)/);
  assert.match(ls, /<ProviderLogo id=\{sum\.provider\} size=\{14\} \/><Bars source=\{sum\} \/>/, 'cada provedor: o ícone e as SUAS 2 barras'); assert.match(ls, /sums\.map\(\(s, i\) =>/, 'um botão por provedor, separados'); assert.match(ls, /function ProviderPanel/, 'clicar nas barras do provedor abre os limites das contas dele'); assert.match(ls, /win\.label/); assert.match(ls, /WINDOWS\.map/); assert.match(ls, /role="progressbar"/);
  assert.match(src('use-limits.js'), /\/api\/limits/); assert.match(src('use-limits.js'), /document\.hidden/, 'não consulta com a aba escondida');
  assert.match(src('limits.css'), /\.lm-bar u \{[^}]*transition/, 'a barra anima ao mudar'); assert.match(src('limits.css'), /prefers-reduced-motion/);
});

test('uma dupla de barras por PROVEDOR: vale a conta mais perto do limite em cada janela e o painel lista as contas do provedor', () => {
  const n = normalizeLimits(RAW(), NOW), cl = providerSummary(n.providers[0]), cx = providerSummary(n.providers[1]);
  assert.deepEqual(cl.accounts.map((a) => a.id), ['system', 'acc_22222222'], 'só contas conectadas');
  assert.equal(cl.session.usedPct, 100, 'a conta mais usada define a barra diária (100 % da Pessoal contra 12 % da Sistema)');
  assert.equal(cl.week.usedPct, 96, 'e a semanal (a semana da Pessoal já reiniciou: sobra a da Sistema)');
  assert.equal(cl.critical, 'session'); assert.equal(resetLabel(cl, NOW), '1h'); assert.equal(cl.provider, 'claude');
  assert.deepEqual([cx.session.usedPct, cx.week.usedPct, cx.critical], [2, 8, 'week'], 'o Codex tem as suas próprias barras, separadas das do Claude'); assert.equal(resetLabel(cx, NOW), '1d');
  assert.deepEqual(providerSummary({ provider: 'claude', label: 'C', accounts: [] }), { provider: 'claude', label: 'C', accounts: [], session: null, week: null, critical: null });
  const empate = providerSummary({ provider: 'claude', label: 'C', accounts: [{ id: 'a', connected: true, session: { usedPct: 50, resetsAt: at(5 * 3600e3) }, week: null }, { id: 'b', connected: true, session: { usedPct: 50, resetsAt: at(2 * 3600e3) }, week: null }] });
  assert.equal(empate.session.resetsAt, at(2 * 3600e3), 'empate de uso: vale o reset mais cedo'); assert.equal(empate.critical, 'session');
});
