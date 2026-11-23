// Compatibilidade e migração do modelo de contas (v2). O FORGE não tem "conta Sistema": toda conta é um login de algum provider.
//   - Conta (linha em db.accounts): { id: 'acc_xxxxxxxx', provider, label, home: 'machine' | 'forge', createdAt }.
//     `machine` = login do computador (ambiente do processo); `forge` = pasta isolada em <dados>/accounts/<id>/<provider>.
//     Linhas antigas (sem `home`) são contas nomeadas do Claude com pasta própria: valem como `forge` e NÃO são reescritas (ver accountHome).
//   - O id legado `system` (conta virtual) e as chaves legadas de limites (`claude:system`, `codex`) só existem AQUI: o resto do código lê ids novos.
// Funções puras sobre `db` (sem I/O): o chamador decide quais CLIs estão instalados, faz a cópia de segurança e persiste.
// Nunca lê nem grava credenciais; só mexe em ids e rótulos.

export const LEGACY_SYSTEM_ID = 'system';
export const ACCOUNT_ID_RE = /^acc_[0-9a-f]{8}$/;
export const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,19}$/;
/** Chaves legadas do last-known de limites (rate-limits.js): o Claude por conta, o Codex sem conta. */
export const LEGACY_LIMIT_KEYS = Object.freeze({ claude: `claude:${LEGACY_SYSTEM_ID}`, codex: 'codex' });
export const LEGACY_LIMIT_KEY_RE = /^(?:codex|claude:system)$/;
/** Chave nova de limites: `<provider>:<id da conta>`. */
export const LIMIT_KEY_RE = /^[a-z][a-z0-9_-]{0,19}:acc_[0-9a-f]{8}$/;
export const ACCOUNTS_MODEL_VERSION = 2;
/** Rótulo semente da conta `machine` de cada provider (o usuário pode renomear depois); provider desconhecido usa o próprio id. */
export const MACHINE_LABELS = Object.freeze({ claude: 'Claude Code', codex: 'Codex CLI' });

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const MAX_UID_TRIES = 50;
const defaultUid = (p) => `${p}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
const machineLabel = (p) => (Object.hasOwn(MACHINE_LABELS, p) ? MACHINE_LABELS[p] : p);

/** `home` efetivo de uma linha de conta: só `machine` explícito é machine; linhas antigas (sem o campo) são contas `forge`. */
export const accountHome = (a) => (isObj(a) && a.home === 'machine' ? 'machine' : 'forge');
/** Provider de um registro (terminal/conta): ausente = 'claude' (registros antigos); inválido = null (não se mexe nele). */
const providerOf = (r) => (r.provider === undefined || r.provider === null ? 'claude' : typeof r.provider === 'string' && PROVIDER_ID_RE.test(r.provider) ? r.provider : null);
/** O registro aponta para a conta legada (id `system` ou campo ausente)? */
const isLegacyRef = (id) => id === undefined || id === null || id === LEGACY_SYSTEM_ID;
const rowsOf = (db) => (Array.isArray(db.accounts) ? db.accounts : []);
const validRows = (db) => rowsOf(db).filter((a) => isObj(a) && typeof a.id === 'string' && ACCOUNT_ID_RE.test(a.id));

/** Estado v2 já gravado (ou um vazio): só entradas válidas são aproveitadas. */
function modelOf(db) {
  const m = isObj(db.accountsModel) && db.accountsModel.v === ACCOUNTS_MODEL_VERSION ? db.accountsModel : null;
  const adopted = {}, machineIds = {};
  if (m && isObj(m.adopted)) for (const [p, v] of Object.entries(m.adopted)) if (PROVIDER_ID_RE.test(p) && v === true) adopted[p] = true;
  if (m && isObj(m.machineIds)) for (const [p, id] of Object.entries(m.machineIds)) if (PROVIDER_ID_RE.test(p) && typeof id === 'string' && ACCOUNT_ID_RE.test(id)) machineIds[p] = id;
  return { present: !!m, adopted, machineIds };
}

/** Conta machine existente do provider: primeiro a registrada em machineIds, depois qualquer linha `home:'machine'` dele. */
function findMachine(db, provider, machineIds) {
  const rows = validRows(db);
  const known = machineIds[provider];
  if (known) { const row = rows.find((a) => a.id === known); if (row && accountHome(row) === 'machine' && (row.provider ?? 'claude') === provider) return row.id; }
  return rows.find((a) => accountHome(a) === 'machine' && a.provider === provider)?.id ?? null;
}

/**
 * Migra o banco para o modelo v2. Síncrona e PURA sobre `db` (muta o objeto e devolve o relatório); sem I/O.
 * `installed` = { [provider]: boolean } (CLIs instalados, decidido pelo chamador); `uid(prefixo)` gera ids; `now()` dá o carimbo ISO;
 * `backup()` é chamado UMA vez, ANTES da primeira alteração, e só quando há algo a alterar (se lançar, o banco fica intacto e o erro sobe).
 * Idempotente: sem referências legadas a reescrever, sem adoção nem semente pendentes, não muda nada (changed:false).
 * @returns {{ changed: boolean, adopted: string[], created: string[], rewritten: number, seeded: string[], map: Record<string,string> }}
 */
export function migrateAccountsV2(db, { installed = {}, uid = defaultUid, now = () => new Date().toISOString(), backup } = {}) {
  const none = { changed: false, adopted: [], created: [], rewritten: 0, seeded: [], map: {} };
  if (!isObj(db)) return none;
  const model = modelOf(db);
  const machineIds = { ...model.machineIds };
  const settings = isObj(db.settings) ? db.settings : null;
  const legacyDefault = settings ? settings.defaultAccountId : undefined;

  // ---- plano (nada é alterado aqui) ----
  const need = new Set(); // providers que precisam de uma conta machine garantida nesta execução
  const toRewrite = []; // [registro, provider]
  for (const r of Array.isArray(db.terminalSessions) ? db.terminalSessions : []) {
    if (!isObj(r) || !isLegacyRef(r.accountId)) continue;
    const p = providerOf(r); if (!p) continue; // provider inválido: o registro fica como está (a sanitização do store cuida dele)
    toRewrite.push([r, p]); need.add(p);
  }
  if (legacyDefault === LEGACY_SYSTEM_ID && !model.adopted.claude) need.add('claude');
  if (isObj(installed)) for (const [p, on] of Object.entries(installed)) if (on === true && PROVIDER_ID_RE.test(p) && !model.adopted[p]) need.add(p);

  const taken = new Set(rowsOf(db).filter(isObj).map((a) => a.id));
  const creates = []; // linhas machine novas
  const adopt = [];
  for (const p of [...need].sort()) {
    const found = findMachine(db, p, machineIds);
    if (found) { machineIds[p] = found; if (!model.adopted[p]) adopt.push(p); continue; }
    // Recria com o id já registrado (mantém as chaves de limites) quando ele está livre; senão gera um novo, sem colidir.
    let id = machineIds[p] && !taken.has(machineIds[p]) ? machineIds[p] : null;
    for (let i = 0; !id && i < MAX_UID_TRIES; i++) { const c = uid('acc'); if (typeof c === 'string' && ACCOUNT_ID_RE.test(c) && !taken.has(c)) id = c; }
    if (!id) throw new Error('migrateAccountsV2: não foi possível gerar um id de conta válido e livre');
    taken.add(id); machineIds[p] = id;
    creates.push({ id, provider: p, label: machineLabel(p), home: 'machine' });
    if (!model.adopted[p]) adopt.push(p);
  }

  // Semente da pré-seleção da interface (defaultAccountId fica IGNORADO, nunca apagado nem reescrito): só preenche provider ainda sem escolha.
  const seeds = {};
  if (settings && typeof legacyDefault === 'string') {
    let p = null, id = null;
    if (legacyDefault === LEGACY_SYSTEM_ID) { p = 'claude'; id = creates.find((c) => c.provider === 'claude')?.id ?? findMachine(db, 'claude', machineIds); } // id registrado de uma linha já removida não serve
    else if (ACCOUNT_ID_RE.test(legacyDefault)) { const row = validRows(db).find((a) => a.id === legacyDefault); const rp = row ? providerOf(row) : null; if (rp) { p = rp; id = row.id; } }
    const last = isObj(settings.lastAccountByProvider) ? settings.lastAccountByProvider : {};
    if (p && id && !(typeof last[p] === 'string' && last[p])) seeds[p] = id;
  }

  const changed = toRewrite.length > 0 || creates.length > 0 || adopt.length > 0 || Object.keys(seeds).length > 0;
  if (!changed) return { ...none, map: { ...machineIds } };

  // ---- aplicação: cópia de segurança antes da primeira alteração ----
  if (typeof backup === 'function') backup();
  const at = now();
  if (creates.length) {
    if (!Array.isArray(db.accounts)) db.accounts = [];
    for (const c of creates) db.accounts.push({ ...c, createdAt: at });
  }
  for (const [r, p] of toRewrite) r.accountId = machineIds[p]; // pelo provider DO REGISTRO: Codex vai para a machine do Codex, nunca para a do Claude
  if (Object.keys(seeds).length) settings.lastAccountByProvider = { ...(isObj(settings.lastAccountByProvider) ? settings.lastAccountByProvider : {}), ...seeds };
  const adopted = { ...model.adopted }; for (const p of adopt) adopted[p] = true;
  db.accountsModel = { v: ACCOUNTS_MODEL_VERSION, at, adopted, machineIds: { ...machineIds } };
  return { changed: true, adopted: adopt, created: creates.map((c) => c.id), rewritten: toRewrite.length, seeded: Object.keys(seeds), map: { ...machineIds } };
}

/**
 * Desfaz a migração v2 (NÃO é chamada no boot): registros que apontam para contas machine voltam a `system`, as linhas machine saem,
 * a semente de pré-seleção e o db.accountsModel são removidos. Registros que antes não tinham accountId voltam como `system` (equivalente no modelo antigo).
 * @returns {{ changed: boolean, restored: number, removed: string[] }}
 */
export function reverseAccountsV2(db) {
  if (!isObj(db) || !isObj(db.accountsModel)) return { changed: false, restored: 0, removed: [] };
  const { machineIds } = modelOf(db);
  // O modelo antigo não conhece `machine`: qualquer linha machine (as da migração e as criadas depois) volta a ser a conta virtual.
  const machine = new Set([...Object.values(machineIds), ...validRows(db).filter((a) => accountHome(a) === 'machine').map((a) => a.id)]);
  let restored = 0;
  for (const r of Array.isArray(db.terminalSessions) ? db.terminalSessions : []) if (isObj(r) && machine.has(r.accountId)) { r.accountId = LEGACY_SYSTEM_ID; restored++; }
  const removed = [];
  if (Array.isArray(db.accounts)) db.accounts = db.accounts.filter((a) => { const drop = isObj(a) && machine.has(a.id) && accountHome(a) === 'machine'; if (drop) removed.push(a.id); return !drop; });
  if (isObj(db.settings)) delete db.settings.lastAccountByProvider;
  delete db.accountsModel;
  return { changed: true, restored, removed };
}

/**
 * Leitura tolerante (modo compatibilidade, p. ex. quando a migração não pôde ser persistida): `system` ou ausente -> conta machine do provider
 * (null se não houver); id novo válido passa intacto; qualquer outra coisa -> null.
 */
export function resolveLegacyAccountId(db, rawId, providerId) {
  if (typeof rawId === 'string' && ACCOUNT_ID_RE.test(rawId)) return rawId;
  if (!isLegacyRef(rawId) && rawId !== '') return null;
  const p = providerId === undefined || providerId === null ? 'claude' : typeof providerId === 'string' && PROVIDER_ID_RE.test(providerId) ? providerId : null;
  if (!p || !isObj(db)) return null;
  return findMachine(db, p, modelOf(db).machineIds);
}

/** Chave nova de limites para a conta (`<provider>:<acc_...>`), ou null se algum dos dois for inválido. */
export const limitKey = (provider, accountId) => (typeof provider === 'string' && PROVIDER_ID_RE.test(provider) && typeof accountId === 'string' && ACCOUNT_ID_RE.test(accountId) ? `${provider}:${accountId}` : null);

/**
 * Traduz as chaves do last-known de limites: `claude:system` -> `claude:<machine do Claude>`, `codex` -> `codex:<machine do Codex>`.
 * Chaves novas passam intactas e têm precedência sobre a tradução de uma legada; legada sem conta machine correspondente e lixo saem.
 * Pura: devolve um objeto novo (os valores são os mesmos objetos, sem cópia profunda).
 */
export function translateLimitKeys(obj, machineIds = {}) {
  const out = {};
  if (!isObj(obj)) return out;
  const ids = isObj(machineIds) ? machineIds : {};
  const keys = Object.keys(obj);
  for (const k of keys) if (LIMIT_KEY_RE.test(k)) out[k] = obj[k];
  for (const k of keys) {
    if (!LEGACY_LIMIT_KEY_RE.test(k)) continue;
    const p = k === LEGACY_LIMIT_KEYS.codex ? 'codex' : 'claude';
    const nk = limitKey(p, ids[p]);
    if (nk && !Object.hasOwn(out, nk)) out[nk] = obj[k];
  }
  return out;
}
