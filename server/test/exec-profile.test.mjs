// Perfil de permissão do Executor: contrato puro de exec-profile.js (argumentos, lista pré-aprovada, fail-safe) e provas ESTÁTICAS de que o perfil
// não é alcançável pelo Maestro/MCP, pelo Planner nem pelo chat. Nada aqui executa processo nem toca banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFILES, profileOf, BASE_ARGS, DEFAULT_ALLOW, executorArgs, executorLimitsText, WARNING } from '../exec-profile.js';
import { ALLOWED_SCRIPTS } from '../verify.js';
import { validateDecision } from '../cycle-schema.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');

test('PROFILES e profileOf: bypass SOMENTE com a string exata; todo o resto cai no padrão (fail-safe)', () => {
  assert.deepEqual([...PROFILES], ['default', 'bypass']); assert.equal(Object.isFrozen(PROFILES), true);
  assert.equal(profileOf({ permissionProfile: 'bypass' }), 'bypass');
  for (const v of [undefined, null, '', 'default', 'BYPASS', 'Bypass', ' bypass', 'bypass ', 'bypassPermissions', true, 1, 0, {}, [], ['bypass'], { toString: () => 'bypass' }, new String('bypass')]) assert.equal(profileOf({ permissionProfile: v }), 'default', JSON.stringify(v));
  for (const ws of [undefined, null, 0, '', 'bypass', [], {}, () => 'bypass', Object.create({ permissionProfile: 'bypass' })]) assert.equal(profileOf(ws), 'default', String(ws)); // inclusive propriedade só herdada
});

test('BASE_ARGS: iguais ao contrato; --setting-sources só `user` (nunca project); sem permission-mode/ferramentas/skip-permissions', () => {
  assert.deepEqual([...BASE_ARGS], ['-p', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'none', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'user']);
  assert.equal(Object.isFrozen(BASE_ARGS), true); assert.equal(BASE_ARGS[BASE_ARGS.indexOf('--setting-sources') + 1], 'user');
  assert.ok(!BASE_ARGS.some((a) => /project|local|permission-mode|tools|skip/i.test(a)));
});

test('DEFAULT_ALLOW: testes/build/lint (mesma fonte que verify.js) e git somente leitura; nada de install, npx, rede, rm ou push', () => {
  assert.equal(Object.isFrozen(DEFAULT_ALLOW), true);
  const want = ['Bash(npm test:*)', ...ALLOWED_SCRIPTS.map((s) => `Bash(npm run ${s}:*)`), 'Bash(node --test:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git branch --show-current)'];
  assert.deepEqual([...DEFAULT_ALLOW], want);
  assert.ok(DEFAULT_ALLOW.every((r) => /^Bash\([a-z]+ [^()]+\)$/.test(r)), 'uma regra por argumento, todas de Bash');
  assert.ok(!DEFAULT_ALLOW.some((r) => /install|npx|curl|wget|\brm\b|push|commit|reset|clean|checkout|WebFetch/.test(r)), 'nenhum comando fora do propósito');
});

test('executorArgs(default): BASE + acceptEdits + disallowed Web* + allowedTools POR ÚLTIMO, uma regra por argumento, sem --tools e sem skip-permissions', () => {
  const a = executorArgs('default');
  assert.deepEqual(a, [...BASE_ARGS, '--permission-mode', 'acceptEdits', '--disallowedTools', 'WebFetch', 'WebSearch', '--allowedTools', ...DEFAULT_ALLOW]);
  assert.equal(a.indexOf('--allowedTools') + 1 + DEFAULT_ALLOW.length, a.length, '--allowedTools é variádica: tem que ser a última opção');
  assert.ok(!a.includes('--tools') && !a.some((x) => /dangerously|bypassPermissions/.test(x)));
  assert.ok(a.slice(a.indexOf('--allowedTools') + 1).every((r) => !r.startsWith('-')));
});

test('executorArgs(bypass): BASE + bypassPermissions, sem allowedTools/disallowedTools/--tools e NUNCA --dangerously-skip-permissions', () => {
  const a = executorArgs('bypass');
  assert.deepEqual(a, [...BASE_ARGS, '--permission-mode', 'bypassPermissions']);
  assert.ok(!a.some((x) => /allowedTools|disallowedTools|--tools|dangerously/i.test(x)));
});

test('executorArgs: perfil inválido = default; devolve cópia nova (alterar o resultado não contamina chamadas futuras)', () => {
  for (const p of [undefined, null, 'x', 'BYPASS', 1, {}, ['bypass'], 'bypassPermissions']) assert.deepEqual(executorArgs(p), executorArgs('default'), String(p));
  const a = executorArgs('default'); a.push('--evil'); a[0] = 'x'; assert.deepEqual(executorArgs('default').slice(0, 2), ['-p', '--output-format']); assert.ok(!executorArgs('default').includes('--evil'));
  assert.notEqual(executorArgs('bypass'), executorArgs('bypass')); assert.throws(() => { 'use strict'; BASE_ARGS.push('x'); }); assert.throws(() => { 'use strict'; DEFAULT_ALLOW.push('x'); });
  assert.equal(executorArgs('default').includes('--allowedTools'), true, 'o objeto devolvido não é o congelado, mas as constantes seguem intactas');
});

test('executorLimitsText: descreve cada perfil em PT-BR (padrão: pré-aprovados e o que é negado; bypass: sem confirmação, aprovação humana continua, worktree não é fronteira)', () => {
  const d = executorLimitsText('default'), b = executorLimitsText('bypass');
  assert.match(d, /PADRÃO/); assert.match(d, /npm test/); assert.match(d, /git somente leitura/); assert.match(d, /negados automaticamente/); assert.doesNotMatch(d, /SEM CONFIRMAÇÃO/);
  assert.match(b, /SEM CONFIRMAÇÃO/); assert.match(b, /aprovação humana/); assert.match(b, /NÃO é uma fronteira/);
  assert.equal(executorLimitsText('lixo'), d); assert.equal(executorLimitsText(undefined), d);
});

test('WARNING: versão numérica e textos diretos (comandos, rede, instalação sem confirmação; push/deploy ainda pedem aprovação; worktree não é fronteira; sem token = forjável)', () => {
  assert.equal(Number.isInteger(WARNING.version), true); assert.ok(WARNING.version >= 1);
  for (const re of [/sem pedir confirmação/, /rede/, /instala pacotes/, /permissões do seu usuário/, /push, deploy/, /NÃO é uma fronteira/, /apenas|só para missões/]) assert.match(WARNING.text, re);
  for (const re of [/token de sessão/, /forjar/, /bypass|modo sem confirmação/, /aprovar as próprias etapas/, /risco/]) assert.match(WARNING.noTokenText, re);
});

// ---- o perfil NÃO é alcançável por Maestro, Planner, chat nem pela criação do workspace ----
test('estático: a lista TOOLS do maestro.js não cita perfil nem permissão (o Maestro/MCP nunca ganha ferramenta para isso)', () => {
  const src = read('maestro.js'); const a = src.indexOf('const TOOLS = ['), b = src.indexOf('const MAESTRO_ONLY');
  assert.ok(a > 0 && b > a, 'achou o bloco TOOLS');
  const block = src.slice(a, b);
  assert.doesNotMatch(block, /perfil|profile|permiss|bypass|confirma[cç]ão/i);
  assert.deepEqual([...block.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]), ['list_panes', 'send_task', 'list_routes', 'read_pane_output', 'list_tasks', 'report_done']);
  for (const f of ['maestro.js', 'planner.js', 'chat.js']) assert.doesNotMatch(read(f), /permission-profile|setupPermissionProfile/, `${f} não importa nem monta a rota do perfil`);
});

test('estático: só permission-profile.js escreve o perfil do workspace (nenhum outro módulo do servidor atribui ws.permissionProfile)', () => {
  const offenders = fs.readdirSync(SERVER, { recursive: true }).map(String).filter((f) => f.endsWith('.js') && !f.startsWith('test') && f !== 'permission-profile.js')
    .filter((f) => /\b(ws|workspace|w|wsp)\.permissionProfile(At)?\s*=(?!=)/.test(read(f)) || /permissionProfile(At)?\s*[:=](?!=)[^,;\n]*req\.body/.test(read(f)));
  assert.deepEqual(offenders, []);
  const index = read('index.js'); assert.equal((index.match(/setupPermissionProfile/g) || []).length, 2, 'import + uma montagem'); assert.match(index, /setupPermissionProfile\(app, \{ db, tokenActive: !!apiToken \}\)/);
  const post = index.slice(index.indexOf("app.post('/api/workspaces', "), index.indexOf("app.post('/api/workspaces/:id/activate'")); assert.doesNotMatch(post, /permissionProfile/, 'o cadastro do workspace nunca lê o campo');
});

test('o schema do Planner rejeita permissionProfile/profile em qualquer nível (continue, plan, complete, blocked)', () => {
  const task = { title: 'T', instructions: 'fazer', acceptance: ['o arquivo a.txt existe'] };
  const cases = [
    { decision: 'continue', rationale: 'r', task, permissionProfile: 'bypass' },
    { decision: 'continue', rationale: 'r', task: { ...task, permissionProfile: 'bypass' } },
    { decision: 'continue', rationale: 'r', task: { ...task, profile: 'bypass' } },
    { decision: 'continue', rationale: 'r', task, profile: 'bypass' },
    { decision: 'complete', rationale: 'r', evidence: ['e'], permissionProfile: 'bypass' },
    { decision: 'blocked', rationale: 'r', blockedReason: 'x', profile: 'bypass' },
  ];
  for (const c of cases) { const r = validateDecision(JSON.stringify(c)); assert.equal(r.ok, false, JSON.stringify(c)); assert.match(r.error, /chaves não permitidas/); }
  const plan = { decision: 'plan', rationale: 'r', steps: [{ id: 's1', title: 'T', instructions: 'fazer', acceptance: ['o arquivo a.txt existe'], permissionProfile: 'bypass' }] };
  const r = validateDecision(JSON.stringify(plan), { plan: true }); assert.equal(r.ok, false); assert.match(r.error, /chaves não permitidas/);
  assert.equal(validateDecision(JSON.stringify({ decision: 'continue', rationale: 'r', task }), {}).ok, true, 'controle: sem o campo é aceito');
});
