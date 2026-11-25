import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { uid, now } from './store.js';
import { gitInfo } from './git.js';
import { asyncRoute } from './async-route.js';
import { createGitProbe, prereqsOf, probeLogin } from './prereqs.js';
import { createClaudeProbe } from './claude-probe.js';
import { validateDir, setupWorkspaceRemoval, setupWorkspaceRename } from './workspaces.js';
import { topicsState, openAndActivate, snapshotTabs, restoreTabs, setupWorkspaceTabs, setupTopics } from './topics.js';
import { setupUiSettings } from './ui-settings.js';
import { setupGolem } from './golem.js';
import { createLoadouts, setupLoadouts } from './loadouts.js';
import { createAgentStatus, hooksJson } from './agent-status.js';
import { setupLayouts } from './layouts.js';
import { setupTeamTemplates, findTeam } from './team-templates.js';
import { setupHarness, terminalDefaults, routesForMaestro, routeFor, taskHint } from './harness.js';
import { createConversationStore, setupConversations, startConversationCapture } from './conversations.js';
import { createWorktreeManager, setupWorktrees } from './worktrees.js';
import { createTerminalManager, setupTerminals } from './terminals.js';
import { setupFlows } from './flows.js';
import { createPreviewManager, setupLivePreview } from './live-preview.js';
import { createChangesService, setupLiveChanges } from './live-changes.js';
import { createAccounts, setupAccounts, migrateAtBoot, createDbBackup } from './accounts.js';
import { createLoginManager } from './account-login.js';
import { createUsageReader, claudeConfigDir } from './terminal-usage.js';
import { createProviderActivity, parseDaysParam } from './provider-activity.js';
import { createOpenCodeUsage } from './opencode-usage.js';
import { createRateLimits } from './rate-limits.js';
import { createUsageApi } from './usage-api.js';
import { createMaestro, setupMaestro, stableServerName } from './maestro.js';
import { migrateLegacyDir } from './legacy-dirs.js';
import { acquireInstanceLock, pidAlive } from './instance-lock.js';
import { UI_CSP } from './csp.js';
import { createChildRegistry } from './child-registry.js';
import { installShutdown } from './shutdown.js';
import { apiGuard } from './origin-guard.js';
import { trustClaudeFolder } from './trust.js';
import { resolveAutonomous } from './maestro-default.js';
import { strictProjectConfig } from './project-config.js';
import { configureCodexCatalog } from './providers/codex.js';
import { codexHomeDir } from './codex-usage.js';
import { consumeApiTokenFromEnv, createTokenGuard } from './session-token.js';

const apiToken = consumeApiTokenFromEnv(); // M2: lido e REMOVIDO de process.env antes de qualquer processo filho existir (ver session-token.js)

// Costura de teste: só código em processo (nunca env, rede ou requisição) pode injetar sondas e CLIs simuladas.
const testDeps = globalThis.__ORCH_TEST_DEPS__ ?? {};
const claudeProbe = testDeps.claudeProbe ?? createClaudeProbe(); // sonda do Claude Code (claude-probe.js) de /api/state
const probeGit = testDeps.gitProbe ?? createGitProbe();
// Só registra no log: uma rejeição esquecida não derruba o servidor nem os terminais. (Nenhum handler de uncaughtException de propósito: estado corrompido deve derrubar.)
process.on('unhandledRejection', (reason) => { console.error('[forge] rejeição não tratada:', reason?.code || reason?.message || reason); });
const childRegistry = createChildRegistry(); // PIDs dos processos filhos (terminais, logins, preparação de worktrees) no banco (db.childProcesses), para o boot reclamar o que um servidor anterior deixou vivo

const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1'; // somente local
// Trava de instância ANTES de qualquer operação que possa tocar o banco (load, recover): uma 2ª instância sai sem alterar nada.
const lock = acquireInstanceLock({ dir: store.dataDir, autoRelease: true });
if (!lock.ok) { console.error(`[forge] ${lock.message}`); process.exit(1); }
let livePreview = null; // gerenciador do preview do painel Live (criado junto das rotas); o encerramento o fecha
let flowsManager = null; // Missions v2 (criado junto das rotas): o encerramento para o runner e o agendador das automações antes de matar os terminais
installShutdown({ lock, children: [{ killActiveSync: () => worktrees.killActiveSync() }, { killActiveSync: () => terminals.killAllSync() }, { killActiveSync: () => logins.killActiveSync() }, { killActiveSync: () => { void livePreview?.close(); } }, { killActiveSync: () => flowsManager?.stop() }], store }); // ao sair: encerra os filhos (preparação de worktrees, terminais, logins, preview), grava o que está pendente e libera a trava
const db = store.load();
// Worktrees (modo Git das missões v2 e dos terminais). A recuperação só concilia o registro com o Git: não relança nada nem remove nada.
const worktrees = createWorktreeManager({ db, track: childRegistry.track, children: childRegistry });
// Credenciais MCP dos panes: com ORCH_DATA_DIR (testes, app desktop) ficam na pasta de dados; no modo dev, FORA do repositório (um agente com cwd no repositório leria data/ sem pedir permissão).
const devHome = path.join(process.env.LOCALAPPDATA || os.homedir(), 'forge'); // modo dev; antes era 'ai-dev-orchestrator' (o histórico e os loadouts são copiados no boot, ver legacy-dirs.js)
const legacyDevHome = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ai-dev-orchestrator');
const mcpDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'mcp') : path.join(devHome, 'mcp'); // mcp tem tokens por sessão, regenerados a cada terminal: não se migra
// Maestro autônomo (também liga o acesso total dos terminais novos): instalação NOVA começa DESLIGADO; instalação já usada continua ligada, gravado de forma explícita (maestro-default.js).
const autonomyBoot = resolveAutonomous(db);
if (autonomyBoot.changed) { try { store.saveOrThrow(); } catch { /* sem gravar, o próximo boot repete a mesma decisão */ } }
const maestro = createMaestro({ autonomous: autonomyBoot.autonomous, getTerminals: () => terminals, harness: { routes: () => routesForMaestro(db), route: (type) => routeFor(db, type), hint: taskHint }, mcpDir, url: `http://127.0.0.1:${PORT}/mcp`, serverName: stableServerName(db, { save: store.saveOrThrow }) }); // nome com sufixo aleatório POR INSTALAÇÃO (estável entre boots, ver maestro.js): um .mcp.json homônimo não herda a pré-autorização // coordenação entre panes por MCP local (aprovação do usuário por padrão)
// Conversas copiadas: com ORCH_DATA_DIR (testes, app desktop) na pasta de dados; no modo dev, FORA do repositório (mesmo motivo do mcpDir).
const historyDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'history') : path.join(devHome, 'history');
if (!process.env.ORCH_DATA_DIR) for (const name of ['history', 'loadouts']) { const r = migrateLegacyDir(path.join(legacyDevHome, name), path.join(devHome, name)); if (r.status === 'migrated') console.log(`[forge] ${name} copiado de ${legacyDevHome} (a pasta original foi mantida)`); else if (r.status === 'error') console.error(`[forge] não foi possível copiar ${name} da pasta anterior: ${r.error}`); }
// Skills por papel (loadouts.js): plugins de sessão gerados numa pasta própria, FORA do workspace do usuário (mesmo critério do mcpDir/historyDir).
const loadoutsDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'loadouts') : path.join(devHome, 'loadouts');
// Estado real do agente (running/waiting/completed/error): hooks do Claude Code gravam eventos aqui, fora do workspace (agent-status.js). Sem caminho seguro, os hooks não são registrados e a tela usa a leitura pela saída.
const statusDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'agent-status') : path.join(devHome, 'agent-status');
const paneFilesDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'pane-files') : path.join(devHome, 'pane-files'); // arquivos por terminal (Gemini: padrões com o MCP e o papel, sem token; Copilot: mcp.json COM o token do pane): pasta com ACL só do usuário, apagados no fim
const agentStatus = createAgentStatus({ dir: statusDir });
const loadouts = createLoadouts({ db, dir: loadoutsDir, hooks: hooksJson({ node: process.execPath, script: fileURLToPath(new URL('./agent-status-hook.mjs', import.meta.url)), dir: statusDir }) });
// Contas (accounts.js, modelo v2): toda conta é um login de algum provider (a do computador ou uma pasta isolada). Testes que injetam a sonda e não injetam `accountsCli` rodam SEM CLI (nunca chamam a real).
const accountsCli = testDeps.accountsCli ?? (testDeps.claudeProbe ? { unavailable: true } : {});
let logins = null;
const accounts = createAccounts({ db, dataDir: store.dataDir, persist: store.saveOrThrow, uid, ...accountsCli, isInUse: (id) => terminals.usesAccount(id), isLoginActive: (id) => logins?.isActive(id) === true });
// Migração v2 ANTES do gerente de terminais: adota as contas do computador (CLIs instaladas) e reescreve as referências antigas, com cópia única do banco antes (db.json.pre-accounts-v2).
// Falha de cópia ou de gravação desfaz tudo em memória: o servidor segue em modo compatível e tenta de novo no próximo boot.
migrateAtBoot({ db, persist: store.saveOrThrow, installed: accounts.installedMap(), uid, now, backup: createDbBackup(store.dataDir), log: (m) => console.log(`[forge] ${m}`) });
logins = createLoginManager({ accounts, ...(accountsCli.unavailable ? { unavailable: true } : {}), track: childRegistry.track });
// Limite real de uso das contas (janela de 5 h e semanal): a status line do Claude Code grava aqui (claude-statusline-hook.mjs) e o Codex vem dos rollouts; e, quando o login permite, o uso REAL da conta vem do provedor (usage-api.js: lê o token só em memória e consulta o endpoint de uso; desliga com ORCH_LIMITS_API=off) (rate-limits.js). Pasta fora do workspace.
const limitsDir = process.env.ORCH_DATA_DIR ? path.join(store.dataDir, 'rate-limits') : path.join(devHome, 'rate-limits');
// Uso real da conta no provedor (inclui o gasto fora do FORGE): só no servidor de verdade; testes com ORCH_DATA_DIR não leem credenciais nem usam a rede, salvo ORCH_LIMITS_API=on.
// Por conta: a pasta padrão do ambiente só para a conta do computador DAQUELE provider; conta isolada usa só a pasta dela, e conta desconhecida não tem pasta (nunca cai no login do computador).
const usageApi = (!process.env.ORCH_DATA_DIR && !process.env.NODE_TEST_CONTEXT) || String(process.env.ORCH_LIMITS_API ?? '').toLowerCase() === 'on' ? createUsageApi({
  isMachine: (id, provider) => { const a = accounts.find(id); return !!a && a.home === 'machine' && a.provider === provider; },
  credsDirOf: (id, provider) => { const a = accounts.find(id); return a && a.provider === provider && a.home !== 'machine' ? accounts.configDirOf(id) : null; },
}) : null;
// Contas = accounts.list() (todos os providers); login/plano de accounts.statusOf; o Codex lê os rollouts da pasta de cada conta (CODEX_HOME do ambiente para a do computador).
const rateLimits = createRateLimits({ db, accounts, dir: limitsDir, script: fileURLToPath(new URL('./claude-statusline-hook.mjs', import.meta.url)), usageApi });
if (usageApi) rateLimits.view(); // aquece a 1ª leitura do uso real
rateLimits.sweep();
const conversations = createConversationStore({ dir: historyDir, db, configDirOf: (id) => accounts.configDirOf(id) }); // histórico de conversas próprio, por workspace (texto das trocas; ver conversations.js); cada sessão é lida na pasta da conta dela
// Avisos ao abrir terminais: (1) "confiar nesta pasta?" do Claude Code e do Codex é respondido pelo FORGE (trust.js; o Codex recebe por argumento); (2) a confirmação "Abrir mesmo assim?" por configuração de projeto
// não revisada no Git (project-config.js) é EXIGIDA por padrão (hooks, MCP e comandos do projeto não rodam sem o usuário confirmar). Para DESLIGAR a confirmação: ORCH_STRICT_PROJECT_CONFIG=0; para não gravar a confiança do Claude Code: ORCH_NO_TRUST=1. Testes ficam de fora.
const inTest = Object.keys(testDeps).length > 0 || !!process.env.NODE_TEST_CONTEXT;
// Modelos do Codex: a lista que o usuário escolhe vem do catálogo do próprio Codex (<CODEX_HOME>/models_cache.json). Só o servidor de verdade o lê; nos testes vale a lista de reserva.
if (!inTest) configureCodexCatalog({ home: codexHomeDir() });
const trustOptions = inTest ? {} : {
  ...(process.env.ORCH_NO_TRUST === '1' ? {} : { trustFolders: ({ provider, cwd, configDir }) => { if (provider === 'claude') trustClaudeFolder(cwd, { configDir }); } }),
  ...(strictProjectConfig() ? {} : { inspectConfig: async () => [] }),
};
const terminals = createTerminalManager({ ...trustOptions, ...(inTest ? {} : { autoFullAccess: () => maestro.isAutonomous() }), db, defaults: (role, providerId) => terminalDefaults(db, role, providerId), findTemplate: (id) => findTeam(db, id), accounts, loadouts, agentStatus, statusLine: rateLimits, onEnd: (rec) => { if ((rec.provider ?? 'claude') === 'claude' && db.workspaces.some((w) => w.id === rec.workspaceId)) conversations.sync(rec); }, track: childRegistry.track, worktrees, mcp: maestro, paneFilesDir, persist: store.saveOrThrow, isChildAlive: (terminalId) => childRegistry.pending().some((r) => r && r.kind === 'terminal' && r.terminalId === terminalId && pidAlive(r.pid)), usage: createUsageReader({ pricesFile: path.join(store.dataDir, 'pricing.json') }) }); // terminais interativos (PTY) do Claude Code: um processo por pane, em paralelo
let worktreeRecovery = { settled: [], inconsistent: [], unregistered: [], unverified: [] }; // E3: preenchido logo DEPOIS do reclaim dos processos filhos (abaixo)
const app = express();
// Host válido em toda a /api, Origin permitido quando enviado e OBRIGATÓRIO em POST/PUT/PATCH/DELETE (CSRF, DNS rebinding e chamadas locais sem Origin; ver origin-guard.js).
// ANTES do parser de JSON: uma requisição recusada nem chega a ter o corpo lido (e um corpo malformado vindo de origem externa dá 403, não 400).
app.use('/api', apiGuard);
if (apiToken) app.use('/api', createTokenGuard(apiToken)); // M2: com token (app desktop), ações mutáveis e fluxos de terminal só da interface
app.use(express.json({ limit: '100kb' }));

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const find = (arr, id) => arr.find((x) => x.id === id);
const commit = () => store.save();

// ---------- Estado geral ----------
// Login do /api/state: espera no máximo ~1,5 s pelo status (a 1ª consulta a frio leva ~1 s ou mais). Se estourar, devolve "desconhecido"; a consulta continua em segundo plano e aquece o cache.
const LOGIN_WAIT_MS = 1500, LOGIN_UNKNOWN = { known: false, loggedIn: null, detail: '' };
const withTimeout = (p, ms, fallback) => new Promise((resolve) => { const t = setTimeout(() => resolve(fallback), ms); t.unref?.(); Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); }); });
app.get('/api/state', asyncRoute(async (req, res) => {
  if (req.query.fresh === '1') { for (const a of accounts.list()) accounts.invalidate(a.id); claudeProbe.reset?.(); probeGit.reset?.(); } // "Verificar novamente": enxerga um login feito fora do FORGE (em qualquer conta) sem esperar o cache
  const [probe, git] = await Promise.all([claudeProbe(), probeGit()]); // a sonda deduplica a chamada em andamento
  res.json({
    prereqs: prereqsOf(probe, git, await withTimeout((testDeps.loginProbe ?? (() => probeLogin({ accounts })))(), LOGIN_WAIT_MS, LOGIN_UNKNOWN)), // aditivo: { claude, git, login } = { available, version, detail } e { known, loggedIn, detail } (login = alguma conta conectada de algum provider, pelo status de cada conta, com cache de ~45 s)
    executor: { id: 'claude-code', connected: probe.available, ...probe }, // sonda do Claude Code (available, version, detail): a tela de Setup e a de IAs leem daqui
    persistenceIncident: store.persistenceIncident(), // aditivo (M2): último incidente de gravação (início, nº de falhas, quando foi reconciliado); null se nunca houve
    persistence: store.persistenceStatus(), // aditivo: ok, código do último erro, quando falhou e quantas falhas seguidas (sem caminhos)
    settings: db.settings,
    worktrees: { items: worktrees.list(), unregistered: worktreeRecovery.unregistered },
    activeWorkspace: find(db.workspaces, db.settings.activeWorkspaceId) || null,
    ...topicsState(db), // aditivo: openWorkspaceIds[] (abas), topics[] (só não arquivados) e activeTopicIds{ wsId: topicId }
  });
}));

// ---------- Workspaces ----------
app.get('/api/workspaces', (req, res) => res.json(db.workspaces));

app.post('/api/workspaces/validate', (req, res) => res.json(validateDir(req.body?.path)));

app.post('/api/workspaces', (req, res) => {
  const v = validateDir(req.body?.path);
  if (!v.ok) return bad(res, v.error);
  if (db.workspaces.some((w) => w.path.toLowerCase() === v.path.toLowerCase())) {
    return bad(res, 'Workspace já cadastrado.', 409);
  }
  const ws = {
    id: uid('ws'),
    name: str(req.body?.name, 80) || path.basename(v.path),
    path: v.path,
    hasGit: v.hasGit,
    hasPackageJson: v.hasPackageJson,
    createdAt: now(),
  };
  const snap = snapshotTabs(db);
  try {
    db.workspaces.push(ws);
    if (!db.settings.activeWorkspaceId) openAndActivate(db, ws.id); // o novo só vira ativo (e abre a aba) se não havia nenhum; senão fica cadastrado e fechado até open/activate
    store.saveOrThrow();
  } catch {
    db.workspaces.pop(); restoreTabs(db, snap);
    return bad(res, 'Não foi possível cadastrar o workspace: o banco não pôde ser gravado; nada foi alterado.', 500);
  }
  store.log('workspace', `Workspace cadastrado: ${ws.name}`, { workspaceId: ws.id });
  commit();
  res.status(201).json(ws);
});

app.post('/api/workspaces/:id/activate', (req, res) => {
  const ws = find(db.workspaces, req.params.id);
  if (!ws) return bad(res, 'Workspace não encontrado.', 404);
  const snap = snapshotTabs(db);
  try { openAndActivate(db, ws.id); store.saveOrThrow(); } catch { // ativar abre a aba implicitamente
    restoreTabs(db, snap);
    return bad(res, 'Não foi possível ativar o workspace: o banco não pôde ser gravado; nada foi alterado.', 500);
  }
  store.log('workspace', `Workspace ativo: ${ws.name}`, { workspaceId: ws.id });
  commit();
  res.json(ws);
});

app.get('/api/workspaces/:id/git', asyncRoute(async (req, res) => {
  const ws = find(db.workspaces, req.params.id);
  if (!ws) return bad(res, 'Workspace não encontrado.', 404);
  res.json(await (testDeps.gitInfo ?? gitInfo)(ws.path));
}));

// ---------- Atividade ----------
app.get('/api/activity', (req, res) => res.json(db.activity.slice(0, 200)));

// ---------- Frontend buildado (opcional) ----------
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  const CSP = UI_CSP; // csp.js: restritiva; o iframe do painel Live só aceita loopback
  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/') || req.path === '/mcp' || req.path.startsWith('/mcp/')) return next();
    res.setHeader('Content-Security-Policy', CSP); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.static(dist));
  app.get(/^(?!\/api)(?!\/mcp(?:\/|$)).*/, (req, res) => res.sendFile(path.join(dist, 'index.html'))); // /mcp nunca cai no SPA: o cliente MCP espera 405/401, não HTML
}

childRegistry.reclaim(); // órfãos de um servidor anterior (terminais, logins, preparação de worktrees): antes da conciliação dos worktrees e de ouvir a porta
worktreeRecovery = await worktrees.recover(); // E3: a conciliação dos worktrees (inclusive `prepare` interrompido) só roda DEPOIS do reclaim: ela depende de saber se o preparador ainda vive
setupWorkspaceRemoval(app, { db, terminals, onRemoved: (id) => conversations.removeWorkspace(id) });
setupWorkspaceRename(app, { db });
setupWorkspaceTabs(app, { db });
setupTopics(app, { db });
setupLoadouts(app, { loadouts }); // skills por papel: GET/PUT /api/loadouts
setupUiSettings(app, { db }); // preferências da interface (db.settings.ui): GET/PUT /api/ui
setupGolem(app, { db }); // golem de liga (db.golem: nome e a última fase vista); ele cresce com os tokens de GET /api/provider-activity, calculado no cliente
setupLayouts(app, { db }); // layout da grade por workspace
setupHarness(app, { db }); // "Quem faz cada tarefa": a tabela de tipos de tarefa, o piloto (Maestro) e os agentes do usuário: /api/harness
setupTeamTemplates(app, { db }); // squads salvos (equipes nomeadas com o agente de cada vaga): GET/POST /api/team-templates, PUT/DELETE /api/team-templates/:id
setupConversations(app, { db, conversations }); // GET/DELETE /api/workspaces/:id/conversations[/:rec]
{ const capture = startConversationCapture({ db, conversations }); setTimeout(() => { capture.sweep().catch(() => {}); }, 3000).unref?.(); } // captura ao vivo das sessões rodando + varredura única das interrompidas // layout da grade de terminais por workspace (db.settings.layouts): GET /api/layouts, PUT /api/workspaces/:id/layout
setupWorktrees(app, { db, manager: worktrees });
setupTerminals(app, { manager: terminals });
livePreview = createPreviewManager({ db, dataDir: store.dataDir }); // painel Live: preview da pasta do workspace (somente leitura) em listener próprio 127.0.0.1:<porta efêmera>, origem diferente da API
setupLivePreview(app, { db, manager: livePreview }); // POST/GET /api/live/preview (Origin + token de sessão no desktop)
setupLiveChanges(app, { db, service: createChangesService({ db }) }); // GET /api/live/changes: arquivos criados/alterados (git status/numstat ou varredura por mtime)
flowsManager = setupFlows(app, { db, terminals, maestro, worktrees, accounts }); // Missions v2: /api/flows (missões em etapas com agentes em terminais reais; recover() deixa run órfão de um boot anterior `interrupted`, esperando Retomar) + agendador das automações (o boot não inicia nada: horário vencido vira pulo). `worktrees` liga o modo Git (branch da missão + worktree por etapa); recoverGit() concilia os diários em segundo plano, depois do a conciliação dos worktrees acima
maestro.setPlanner(flowsManager.plannerPort()); // missões por briefing: mission_options/propose_mission do papel planner (o maestro.js não importa flows.js)
// Limite real de uso por conta (5 h e semana), somente leitura, sem caminhos/ids/e-mails; a interface consulta a cada ~15-30 s (memo de 2 s). Mesmo apiGuard (Host/Origin) das demais rotas de /api.
app.get('/api/limits', (req, res) => { try { res.set('Cache-Control', 'no-store').json(rateLimits.view()); } catch { bad(res, 'Não foi possível ler os limites de uso.', 500); } });
// Tokens por provider e por dia (Claude Code de TODAS as contas + Codex), lidos dos transcripts/rollouts em disco: só contagens, somente leitura, varredura incremental em segundo plano (provider-activity.js). ?days=30|90|0 (0 = desde o início).
const providerActivity = createProviderActivity({ claudeDirs: () => [claudeConfigDir(), ...accounts.list().map((a) => accounts.configDirOf(a.id))].filter((d) => typeof d === 'string' && d), extraSources: inTest ? [] : [createOpenCodeUsage()] }); // OpenCode (banco SQLite dele): só no servidor de verdade, nunca nos testes
if (!inTest) { const warm = setTimeout(() => { try { providerActivity.view({ days: 0 }); } catch { /* aquecimento é opcional */ } }, 2000); warm.unref?.(); } // aquece a 1ª varredura; testes não leem ~/.claude nem ~/.codex
app.get('/api/provider-activity', (req, res) => {
  const days = parseDaysParam(req.query.days);
  if (days === null) return bad(res, 'Parâmetro days inválido (use 30, 90 ou 0).', 400);
  try { res.set('Cache-Control', 'no-store').json(providerActivity.view({ days })); } catch { bad(res, 'Não foi possível ler a atividade de tokens.', 500); }
});
setupAccounts(app, { accounts, logins }); // GET/POST/PATCH/DELETE /api/accounts[/:id[/login...]]: leituras com token de sessão quando configurado
setupMaestro(app, { maestro, onAutonomy: (enabled) => { // a escolha do usuário sobrevive ao reinício; falha ao gravar desfaz o estado parcial
  db.settings ??= {};
  const had = Object.hasOwn(db.settings, 'maestro'), prev = db.settings.maestro;
  db.settings.maestro = { autonomous: enabled };
  try { store.saveOrThrow(); } catch (e) { if (had) db.settings.maestro = prev; else delete db.settings.maestro; throw e; }
} });

app.use('/api', (req, res) => bad(res, 'Rota não encontrada.', 404));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'Requisição grande demais (o limite é 100 KB).', 413);
  return bad(res, err.type === 'entity.parse.failed' ? 'JSON inválido.' : 'Erro interno.', err.status || 500);
});
app.listen(PORT, HOST, () => console.log(`FORGE API em http://${HOST}:${PORT}`));
