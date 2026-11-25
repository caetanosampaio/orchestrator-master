// Registro de provedores de agentes (CLIs). Claude Code e Codex CLI (integrados por completo); Gemini CLI e Cursor CLI no nível 2 (com o Maestro, a confirmar por conexão real;
// o Cursor e o Copilot CLI só em vagas que recebem tarefas); OpenCode, Antigravity, Kimi Code, Kiro CLI e Grok Build no nível 1 (só terminal).
//
// Interface de um provedor (tudo fixo no servidor; nada vem do cliente):
//   id          : identificador estável, gravado nas sessões ('claude')
//   label       : nome para a interface
//   resolve()   : { file, args, viaShell } da CLI no PATH, ou null se não estiver instalada
//   paneArgs()  : argumentos do terminal interativo para new | resume | fork (ver claude.js)
//   capabilities: { resume, fork, hooks, plugins, accounts, transcript, mcp, readOnly } (ausente = true; `mcp: false` = sem o Maestro: fica fora de missões e times;
//                 `readOnly: false` = a CLI não garante somente leitura: não abre o planejador; `mcpVerified: false` = coordenação não verificada com a CLI real: o Maestro só
//                 manda tarefa ao pane depois que ele se conecta de fato ao MCP; `planner: false` = não abre o planejador de missão; `state: false` = sem estado do
//                 agente (o FORGE não sabe quando ele está livre): fora das etapas de missão e do papel de Maestro; `rolePrompt: false` = o papel não chega ao agente: não é Maestro);
//   prepare({ mcp, homeDir }) (opcional): preparo fora da pasta do pane antes do spawn (o Cursor grava a entrada do FORGE em ~/.cursor/mcp.json); falha = pane sem coordenação;
//   paneFiles({ dir, prompt, mcp, node, platform }) (opcional): arquivos que o terminals.js grava numa pasta só do pane (0600, apagada no fim) + ambiente que aponta para eles; submit: { bracketed, delayMs } (entrega de tarefas do Maestro); notFoundMessage; projectConfig/envFor (opcionais)
//   account     : contrato de conta (opcional; ver accountSpecOf no fim do arquivo)
import { claudeProvider } from './claude.js';
import { codexProvider } from './codex.js';
import { geminiProvider } from './gemini.js';
import { opencodeProvider } from './opencode.js';
import { cursorProvider } from './cursor.js';
import { antigravityProvider } from './antigravity.js';
import { kimiProvider } from './kimi.js';
import { kiroProvider } from './kiro.js';
import { copilotProvider } from './copilot.js';
import { grokProvider } from './grok.js';

export const DEFAULT_PROVIDER = 'claude';
const PROVIDERS = Object.freeze(Object.fromEntries([claudeProvider, codexProvider, geminiProvider, opencodeProvider, cursorProvider, antigravityProvider, kimiProvider, kiroProvider, copilotProvider, grokProvider].map((p) => [p.id, p])));

export const providerIds = () => Object.keys(PROVIDERS);
/** O id é um provedor cadastrado? (Object.hasOwn: `__proto__`, `constructor` e afins nunca passam.) */
export const isProvider = (id) => typeof id === 'string' && Object.hasOwn(PROVIDERS, id);
/** Provedor pelo id; sem id (sessões antigas, gravadas antes de existir o campo) vale o padrão. Lança Error se o id não existe. */
export function getProvider(id = DEFAULT_PROVIDER) {
  if (!isProvider(id)) throw new Error(`Provedor desconhecido: ${typeof id === 'string' ? id.slice(0, 40) : typeof id}`);
  return PROVIDERS[id];
}

/** O provedor tem a capacidade? Ausente vale true (como no terminals.js); id desconhecido, false. */
export const providerCan = (id, cap) => isProvider(id) && PROVIDERS[id].capabilities?.[cap] !== false;
/** Coordenação com o Maestro (MCP): sem ela o provedor só abre terminal livre, fora de missões e times. */
export const coordinates = (id) => providerCan(id, 'mcp');
/** Coordenação ainda não verificada com a CLI real: vale só depois que o pane se conecta ao MCP (maestro.js). */
export const needsProof = (id) => isProvider(id) && PROVIDERS[id].capabilities?.mcpVerified === false;
/** Pode ser o planejador de missão (propõe a missão pelo MCP, somente leitura)? */
export const canPlan = (id) => coordinates(id) && providerCan(id, 'readOnly') && providerCan(id, 'planner');
/** Pode ser o Maestro? Recebe relatórios digitados (precisa do estado do agente) e coordena pelo papel (precisa recebê-lo). */
export const canLead = (id) => coordinates(id) && providerCan(id, 'state') && providerCan(id, 'rolePrompt');
/** Pode ser etapa de missão? A missão entrega a etapa só com o agente livre (precisa do estado). */
export const canStep = (id) => coordinates(id) && providerCan(id, 'state');
/**
 * Recusa de uso coordenado num lugar só (terminals.js, times, missões): `role` do terminal, `group` = vaga de time ou squad, `step` = etapa de missão. null = pode.
 * Devolve { code, message }.
 */
export function coordinationBlock(id, { role = 'builder', group = false, step = false } = {}) {
  if (!isProvider(id)) return null;
  const label = PROVIDERS[id].label;
  if (!coordinates(id) && (role === 'maestro' || group || step)) return { code: 'provider_no_coordination', message: noCoordinationMessage(id) };
  if (role === 'maestro' && !canLead(id)) return { code: 'provider_no_lead', message: `${label} ainda não pode ser o Maestro: o FORGE não consegue passar o papel a ele nem saber quando ele está livre. Use-o numa vaga que recebe tarefas.` };
  if (step && !canStep(id)) return { code: 'provider_no_step', message: `${label} ainda não entra em etapas de missão: o FORGE não sabe quando ele está livre para receber a etapa. Use-o num time, numa vaga que recebe tarefas.` };
  return null;
}
/** Mensagem única para quem recusa um provedor sem coordenação. */
export const noCoordinationMessage = (id) => `${isProvider(id) ? PROVIDERS[id].label : 'Esta IA'} ainda não conversa com o Maestro (sem coordenação): use num terminal livre, fora de missões e times.`;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** Opções fechadas de cada provedor: { <id>: { models:[{id,label}], efforts:[{id,label}] } } (cópia nova; vai para a interface). */
export function providerOptions() {
  const out = {};
  for (const id of providerIds()) { const o = PROVIDERS[id].options; out[id] = { models: (o?.models ?? []).map((m) => ({ id: m.id, label: m.label })), efforts: (o?.efforts ?? []).map((e) => ({ id: e.id, label: e.label })) }; }
  return out;
}
const inList = (list, v) => typeof v === 'string' && (list ?? []).some((x) => x.id === v);
/**
 * Valida model/effort de UMA vaga/terminal contra as listas FECHADAS do provedor. `undefined`/`null` = omitido (padrão da CLI). Qualquer outra coisa (texto fora da lista, vazio, número, objeto) é recusada:
 * nada que não esteja na lista chega à linha de comando. Devolve { value: { model?, effort? } } ou { error, field }.
 */
export function validateChoice(providerId, { model, effort } = {}) {
  if (!isProvider(providerId)) return { error: 'Provedor inválido.', field: 'provider' };
  const o = PROVIDERS[providerId].options, value = {};
  if (model !== undefined && model !== null) { if (!inList(o?.models, model)) return { error: `model inválido para ${PROVIDERS[providerId].label}.`, field: 'model' }; value.model = model; }
  if (effort !== undefined && effort !== null) { if (!inList(o?.efforts, effort)) return { error: `effort inválido para ${PROVIDERS[providerId].label}.`, field: 'effort' }; value.effort = effort; }
  return { value };
}
/** Leitura TOLERANTE (banco/registro antigo): devolve só o model/effort ainda válidos para o provedor; o resto é ignorado em silêncio. */
export function tolerantChoice(providerId, src) {
  if (!isObj(src) || !isProvider(providerId)) return {};
  const o = PROVIDERS[providerId].options, out = {};
  if (inList(o?.models, src.model)) out.model = src.model;
  if (inList(o?.efforts, src.effort)) out.effort = src.effort;
  return out;
}
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// CONTAS (contrato `account`). O FORGE não tem conta própria: toda conta é um login de algum provedor. Um provedor novo (cursor, kimi, gemini...) entra só declarando o bloco
// `account`; quem consome usa `accountSpecOf(id)` e nunca importa o provedor direto. Provedor sem bloco (ou com bloco inválido) simplesmente não oferece contas: nada quebra.
//
// Bloco `account` de um provedor:
//   label       : nome real da CLI ('Claude Code', 'Codex CLI'); sem ele vale o label do provedor
//   note        : texto de orientação para a interface (ou ausente)
//   homeEnv     : variável da pasta de configuração da conta ('CLAUDE_CONFIG_DIR', 'CODEX_HOME') ou null = só existe a conta da máquina
//   detect(env) : a CLI está instalada? (boolean; só procura no PATH, não executa nada)
//   status(ctx) : Promise do estado de login { checked, loggedIn, plan, authMethod, email, orgName, loginExpiresAt, error } (nunca credencial)
//   env(base, home): ambiente para rodar a CLI daquela conta (home null = conta da máquina)
//   logoutSpec  : (opcional) como encerrar o login de uma conta ISOLADA ao removê-la; a conta da máquina nunca sofre logout
//   canLogin    : o FORGE conduz o login? Se true, loginSpec({ method, home, env, resolve }) -> { file, args, verbatim, env } | { error, code }
//   limits(ctx) : Promise dos limites da conta ou null (ponto de extensão; os consumidores atuais ainda usam rate-limits.js)
// ctx = { home (pasta isolada | null), env (ambiente BASE do processo), run (assinatura do execFile; injetável nos testes), ...opções do provedor }.
const ACCOUNT_STATUS_ERROR = 'Não foi possível consultar o estado do login.';
const HOME_ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const text = (v, max) => (typeof v === 'string' && !CONTROL.test(v) ? v.trim().slice(0, max) || null : null);
const emptyAccountStatus = (error = null) => ({ checked: false, loggedIn: null, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error });

/** Filtro final do status de QUALQUER provedor: só os campos do contrato, com tipo conferido. Um provedor que devolva a mais (token, texto da CLI) não vaza nada por aqui. */
export function pickAccountStatus(o) {
  if (!isObj(o)) return emptyAccountStatus(ACCOUNT_STATUS_ERROR);
  const checked = o.checked === true;
  return {
    checked, loggedIn: checked && typeof o.loggedIn === 'boolean' ? o.loggedIn : null, plan: text(o.plan, 60), authMethod: text(o.authMethod, 40), email: text(o.email, 200), orgName: text(o.orgName, 200),
    loginExpiresAt: text(o.loginExpiresAt, 40), error: text(o.error, 300),
  };
}

const validBlock = (a) => isObj(a) && typeof a.detect === 'function' && typeof a.status === 'function' && typeof a.env === 'function' && typeof a.limits === 'function'
  && typeof a.canLogin === 'boolean' && (!a.canLogin || typeof a.loginSpec === 'function') && (a.homeEnv === null || (typeof a.homeEnv === 'string' && HOME_ENV_RE.test(a.homeEnv)));

/** Bloco `account` do provedor -> especificação normalizada e congelada (ou null se ausente/inválido). As funções nunca lançam, exceto env() com pasta isolada num provedor sem isolamento. */
function accountSpecFrom(id, provider) {
  const a = provider?.account;
  if (!validBlock(a)) return null;
  const label = text(a.label, 60) ?? text(provider.label, 60) ?? id, note = text(a.note, 400), isolated = a.homeEnv !== null;
  const hasHome = (ctx) => typeof ctx?.home === 'string' && ctx.home !== '';
  return Object.freeze({
    providerId: id, label, note, homeEnv: a.homeEnv, isolated, canLogin: a.canLogin,
    loginMethods: Object.freeze(Array.isArray(a.loginMethods) ? a.loginMethods.filter((m) => typeof m === 'string') : []),
    detect(env = process.env) { try { return a.detect(env) === true; } catch { return false; } },
    async status(ctx = {}) {
      if (!isolated && hasHome(ctx)) return emptyAccountStatus(`${label} só tem a conta da máquina.`);
      try { return pickAccountStatus(await a.status(ctx)); } catch { return emptyAccountStatus(ACCOUNT_STATUS_ERROR); }
    },
    // Sem fallback silencioso: cair na conta da máquina quando se pediu uma pasta isolada usaria o login errado.
    env(base = process.env, home = null) {
      if (!isolated && typeof home === 'string' && home) throw new Error(`${label} só tem a conta da máquina.`);
      return a.env(base, home);
    },
    loginSpec(opts = {}) {
      if (!a.canLogin) return { error: note ?? `O FORGE não faz o login do ${label}.`, code: 'login_unsupported' };
      if (!isolated && typeof opts?.home === 'string' && opts.home) return { error: `${label} só tem a conta da máquina.`, code: 'not_isolated' };
      try { return a.loginSpec(opts); } catch { return { error: 'Não foi possível preparar o login.', code: 'login_error' }; }
    },
    /** Logout da conta isolada (opcional; usado ao remover a conta). null = o provedor não tem logout, ou a conta é a da máquina (nunca se faz logout dela). */
    logoutSpec(opts = {}) {
      if (typeof a.logoutSpec !== 'function' || (typeof opts?.home !== 'string' || !opts.home)) return null;
      try { return a.logoutSpec(opts) ?? null; } catch { return null; }
    },
    async limits(ctx = {}) { try { return (await a.limits(ctx)) ?? null; } catch { return null; } },
  });
}

/** Registro de contas a partir de um mapa { id: provedor }. O padrão usa os provedores cadastrados; os testes montam um com provedores falsos sem mexer no registro real. */
export function createAccountRegistry(providers) {
  const specs = {};
  if (isObj(providers)) for (const id of Object.keys(providers)) { const s = accountSpecFrom(id, providers[id]); if (s) specs[id] = s; }
  Object.freeze(specs);
  const ids = Object.freeze(Object.keys(specs));
  return Object.freeze({
    /** Especificação de conta do provedor, ou null (id desconhecido, `__proto__` e afins, ou provedor sem bloco). */
    specOf: (id) => (typeof id === 'string' && Object.hasOwn(specs, id) ? specs[id] : null),
    ids: () => [...ids],
    /** Vista pública (vai para a interface): sem funções. */
    list: () => ids.map((id) => ({ id, label: specs[id].label, canLogin: specs[id].canLogin, isolated: specs[id].isolated, ...(specs[id].note ? { note: specs[id].note } : {}) })),
  });
}

const ACCOUNTS = createAccountRegistry(PROVIDERS);
export const accountSpecOf = (id) => ACCOUNTS.specOf(id);
export const accountProviderIds = () => ACCOUNTS.ids();
export const accountProviders = () => ACCOUNTS.list();

export { claudeProvider, codexProvider, geminiProvider, opencodeProvider, cursorProvider, antigravityProvider, kimiProvider, kiroProvider, copilotProvider, grokProvider };
