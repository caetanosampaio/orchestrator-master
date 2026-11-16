// Níveis de modelo/esforço (tiers) do Executor: uma tabela PROTEGIDA e funções puras. O Planner/chat/usuário só escolhem o NOME do nível
// (leve | padrao | profunda); o servidor traduz para modelo+esforço aqui, e NADA que não esteja na tabela chega à CLI (routeArgs confere de novo).
// O papel (`role`) é só rótulo (UI e prefixo do prompt): NUNCA concede ferramenta ou permissão; o perfil de permissão é o do workspace (agents.js/exec-profile.js).

export const ROLES = Object.freeze(['implementacao', 'testes', 'revisao', 'docs', 'analise']);
export const DEFAULT_ROLE = 'implementacao';
export const TIER_NAMES = Object.freeze(['leve', 'padrao', 'profunda']); // a ordem é a do escalonamento
export const DEFAULT_TIER = 'padrao';

export const TIERS = Object.freeze({
  leve: Object.freeze({ model: 'claude-haiku-5-5', effort: 'low' }),
  padrao: Object.freeze({ model: 'claude-sonnet-5-5', effort: 'medium' }),
  profunda: Object.freeze({ model: 'claude-opus-5-5', effort: 'high' }),
});

// Mesmas regras de planner.js (MODEL_RE e PLANNER_EFFORTS não são exportados de lá; replicadas aqui e travadas por teste em tiers.test.mjs):
// o modelo começa por letra ou dígito (nunca vira uma opção da CLI) e o esforço é de lista fechada.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,63}$/;
export const TIER_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

export const isRole = (x) => typeof x === 'string' && ROLES.includes(x);
export const isTier = (x) => typeof x === 'string' && TIER_NAMES.includes(x);

const ENV_OF = Object.freeze({ leve: 'ORCH_TIER_LEVE', padrao: 'ORCH_TIER_PADRAO', profunda: 'ORCH_TIER_PROFUNDA' });

/**
 * Tabela EFETIVA: TIERS com os overrides de ambiente `ORCH_TIER_LEVE|PADRAO|PROFUNDA` (formato `modelo:esforco`), validados na leitura.
 * Valor inválido lança Error (o servidor não sobe, como as outras ORCH_). Vazio/ausente = padrão. O esforço é o que vem depois do ÚLTIMO ":" (o modelo pode ter ":").
 */
export function tiersFromEnv(env = process.env) {
  const out = {};
  for (const name of TIER_NAMES) {
    const varName = ENV_OF[name], raw = env?.[varName];
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) { out[name] = TIERS[name]; continue; }
    const cut = v.lastIndexOf(':'), model = cut > 0 ? v.slice(0, cut) : '', effort = cut > 0 ? v.slice(cut + 1) : '';
    if (!MODEL_RE.test(model)) throw new Error(`${varName} inválido: use modelo:esforco, com o modelo só de letras, números e . _ : - [ ] (até 64 caracteres, começando por letra ou número).`);
    if (!TIER_EFFORTS.includes(effort)) throw new Error(`${varName} inválido: o esforço deve ser um de ${TIER_EFFORTS.join(', ')}.`);
    out[name] = Object.freeze({ model, effort });
  }
  return Object.freeze(out);
}

/**
 * Resolve a rota (nível + modelo + esforço) de uma etapa. Puro e determinístico.
 *  - `pin` válido (escolha do usuário) vence e NUNCA sobe: source 'pinned'.
 *  - sem pin e attempt > 1: sobe UM nível a partir de `tier ?? padrao` (teto `profunda`): 'escalated'; no teto fica 'planner' ou 'default' conforme a origem.
 *  - sem pin e attempt <= 1: tier válido = 'planner'; ausente ou inválido (banco editado à mão) = `padrao`, 'default'.
 * O modelo/esforço SEMPRE saem de `table`; nunca do valor recebido.
 * @returns {{tier:string, model:string, effort:string, source:'pinned'|'escalated'|'planner'|'default'}}
 */
export function resolveRoute({ tier, pin, attempt = 1, table = TIERS } = {}) {
  const pick = (name, source) => ({ tier: name, model: table[name].model, effort: table[name].effort, source });
  if (isTier(pin)) return pick(pin, 'pinned');
  const known = isTier(tier), base = known ? tier : DEFAULT_TIER, origin = known ? 'planner' : 'default';
  const idx = TIER_NAMES.indexOf(base), next = Number.isFinite(attempt) && attempt > 1 ? Math.min(idx + 1, TIER_NAMES.length - 1) : idx;
  return next !== idx ? pick(TIER_NAMES[next], 'escalated') : pick(base, origin);
}

/**
 * Argumentos da CLI para a rota: `--model` e `--effort`. Lança Error se o par não for EXATAMENTE um dos pares da tabela (defesa em profundidade).
 * Sem `table`, vale o par de TIERS ou da tabela efetiva do ambiente (tiersFromEnv): ambas protegidas e validadas; nome livre de modelo nunca passa.
 */
export function routeArgs(route, table = undefined) {
  const tables = table ? [table] : [TIERS, tiersFromEnv()];
  const ok = route !== null && typeof route === 'object' && typeof route.model === 'string' && typeof route.effort === 'string'
    && tables.some((t) => TIER_NAMES.some((n) => t[n]?.model === route.model && t[n]?.effort === route.effort));
  if (!ok) throw new Error('Rota de modelo inválida: o par modelo/esforço não está na tabela de níveis.');
  return ['--model', route.model, '--effort', route.effort];
}
