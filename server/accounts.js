// Contas do FORGE (modelo v2). O FORGE é agnóstico de provider: não existe "conta Sistema" nem "padrão do FORGE". Conta = um login de algum provider.
//   db.accounts = [{ id: 'acc_xxxxxxxx', provider, label, home: 'machine' | 'forge', createdAt }]
//   - `machine`: o login do computador (ambiente do processo; nenhuma pasta é criada nem apagada). Remover = "Desvincular": nunca faz logout nem apaga pasta.
//   - `forge`: pasta isolada <dados>/accounts/<id>/<provider>, derivada do id gerado pelo servidor (nunca de entrada do cliente). Linha antiga sem `home` vale `forge`.
// Tudo que é específico de uma CLI vem do bloco `account` do provider (providers/index.js > accountSpecOf); aqui não há nome de CLI, variável de ambiente nem argumento de provider.
// Sem conta padrão no servidor: resolveFor(provider, pedido?) escolhe a conta pedida ou a ÚNICA utilizável do provider; a interface pré-seleciona a última usada (db.settings.lastAccountByProvider).
// Nunca lemos arquivos de credenciais: o estado de login vem só do bloco `account` do provider, e só os campos do contrato saem daqui.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { asyncRoute } from './async-route.js';
import { accountSpecOf, accountProviderIds, pickAccountStatus } from './providers/index.js';
import { resolveClaude } from './providers/claude.js';
import { ACCOUNT_ID_RE, MACHINE_LABELS, ACCOUNTS_MODEL_VERSION, accountHome, migrateAccountsV2 } from './account-compat.js';

export { ACCOUNT_ID_RE };
export const MAX_ACCOUNTS = 10;
export const LABEL_MAX = 60;
export const STATUS_TTL_MS = 45_000;
const FAILURE_TTL_MS = 5_000; // falha de consulta (CLI ausente, tempo esgotado) não fica em cache por 45 s: instalar a CLI ou tentar de novo deve valer logo
// Pasta que nunca existe: leitores de transcrição (conversas, consumo) que recebem uma conta já removida não encontram nada, em vez de cair na pasta global.
const GONE = '__conta-removida__';
export const BACKUP_NAME = 'db.json.pre-accounts-v2';

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** label: texto de 1 a 60 caracteres depois de aparar, sem caracteres de controle. */
export function validateLabel(v) {
  if (typeof v !== 'string') return { ok: false, error: 'Informe um nome para a conta.' };
  if (CONTROL.test(v)) return { ok: false, error: 'O nome da conta não pode ter caracteres de controle.' };
  const label = v.trim();
  if (!label) return { ok: false, error: 'Informe um nome para a conta.' };
  if (label.length > LABEL_MAX) return { ok: false, error: `O nome da conta deve ter no máximo ${LABEL_MAX} caracteres.` };
  return { ok: true, label };
}

const emptyStatus = (error = null, checked = false) => ({ checked, loggedIn: null, plan: null, authMethod: null, email: null, orgName: null, loginExpiresAt: null, error });

/**
 * `command`/`prefixArgs` só são injetados pelos testes (CLI falsa do Claude); `unavailable: true` = tratar as CLIs como ausentes (testes que sobem o servidor sem CLI de contas).
 * `providerCtx` = { [provider]: opções extras de ctx do bloco `account` } e `detect` = { [provider]: () => boolean } (testes: CLI falsa sem depender do PATH). `run` = assinatura do execFile (testes). `env()` = ambiente base dos filhos.
 * `isInUse(id)` diz se um terminal em execução usa a conta; `isLoginActive(id)`, se há login em andamento nela.
 */
export function createAccounts({ db, dataDir, persist, now = () => new Date().toISOString(), uid = (p) => `${p}_${globalThis.crypto.randomUUID().slice(0, 8)}`, command, prefixArgs = [], unavailable = false, resolve = resolveClaude, env = () => process.env, isInUse = () => false, isLoginActive = () => false, statusTtlMs = STATUS_TTL_MS, statusTimeoutMs = 8000, run, providerCtx = {}, detect = {} } = {}) {
  if (!db || !dataDir || typeof persist !== 'function') throw new Error('createAccounts: db, dataDir e persist são obrigatórios');
  const injected = command !== undefined;
  const root = path.join(dataDir, 'accounts');
  const removing = new Set(); // contas em remoção: já não aceitam terminal nem login novos

  /** Linhas válidas, normalizadas (provider ausente = claude; provider sem bloco `account` não aparece). Cópias rasas: quem muda o banco usa `rowOf`. */
  const rawRows = () => (Array.isArray(db.accounts) ? db.accounts.filter((a) => isObj(a) && typeof a.id === 'string' && ACCOUNT_ID_RE.test(a.id)) : []);
  const providerOf = (a) => (a.provider === undefined || a.provider === null ? 'claude' : a.provider);
  const list = () => rawRows().filter((a) => accountSpecOf(providerOf(a)) !== null).map((a) => ({ id: a.id, provider: providerOf(a), label: a.label, home: accountHome(a), createdAt: a.createdAt }));
  const find = (id) => (typeof id === 'string' ? list().find((a) => a.id === id) ?? null : null);
  const exists = (id) => find(id) !== null;
  const usable = (id) => exists(id) && !removing.has(id);
  const specOf = (provider) => accountSpecOf(provider);
  const isolatedHome = (a) => a.home === 'forge' && specOf(a.provider)?.isolated === true;
  const dirOfRow = (a) => path.join(root, a.id, a.provider);
  /** Pasta de configuração: null = conta da máquina (ambiente do processo); conta removida/desconhecida = pasta inexistente (nunca a global). */
  const configDirOf = (id) => { const a = find(id); return a ? (isolatedHome(a) ? dirOfRow(a) : null) : path.join(root, GONE); };

  const ctxResolve = (provider) => (provider === 'claude' ? (injected ? () => ({ file: command, args: prefixArgs, viaShell: false }) : resolve) : providerCtx[provider]?.resolve);
  const providerAvailable = (provider) => {
    const spec = specOf(provider);
    if (!spec || unavailable) return false;
    if (Object.hasOwn(detect, provider)) { try { return detect[provider]() === true; } catch { return false; } }
    if (provider === 'claude' && injected) return true;
    try { return spec.detect(env()); } catch { return false; }
  };
  /** { [provider]: instalado } de todos os providers com bloco `account` (entrada da migração do boot). */
  const installedMap = () => Object.fromEntries(accountProviderIds().map((p) => [p, providerAvailable(p)]));

  function ensureDir(id) {
    const a = find(id);
    if (!a) throw new Error('conta desconhecida');
    if (!isolatedHome(a)) return; // a conta da máquina usa a pasta do próprio usuário: nada a criar
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(dirOfRow(a), { recursive: true, mode: 0o700 }); // 0700 só tem efeito em macOS/Linux; no Windows vale a ACL do perfil do usuário
  }
  /** Pasta ANTES de a linha existir no banco (criação): derivada de um id validado e do provider já checado. */
  function ensureNewDir(id, provider) {
    if (!ACCOUNT_ID_RE.test(String(id))) throw new Error('id inválido');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(root, id, provider), { recursive: true, mode: 0o700 });
  }

  // ---- estado de login (cache de ~45 s por conta; chamadas simultâneas dividem UMA consulta) ----
  const cache = new Map(); // chave -> { at, ttl, value }
  const inflight = new Map();
  const generation = new Map();
  const keyOf = (a) => `${a.provider}|${configDirOf(a.id) ?? 'machine'}`;
  async function fetchStatus(a) {
    const spec = specOf(a.provider);
    if (!spec) return emptyStatus('Provedor indisponível.');
    if (!providerAvailable(a.provider)) return emptyStatus(`${spec.label} não encontrado`);
    // O bloco do provider nunca lança, mas o resultado passa pelo filtro final de qualquer jeito (só os campos do contrato).
    return pickAccountStatus(await spec.status({ home: configDirOf(a.id), env: env(), run, resolve: ctxResolve(a.provider), timeoutMs: statusTimeoutMs, ...(providerCtx[a.provider] ?? {}) }));
  }
  /** Estado de login da conta (cache, deduplicado). Nunca lança. */
  function statusOf(id) {
    const a = find(id);
    if (!a) return Promise.resolve(emptyStatus('Conta não encontrada.'));
    const key = keyOf(a), hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);
    const gen = generation.get(key) ?? 0;
    const p = fetchStatus(a).catch(() => emptyStatus('Não foi possível consultar o estado do login.')).then((value) => {
      if ((generation.get(key) ?? 0) === gen) cache.set(key, { at: Date.now(), ttl: value.checked ? statusTtlMs : FAILURE_TTL_MS, value }); // invalidado durante a consulta: o resultado antigo não entra
      return value;
    }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }
  /** Login/logout concluído: descarta o cache e qualquer consulta em andamento (o resultado dela é do estado ANTERIOR). */
  function invalidate(id) {
    const a = find(id); if (!a) return;
    const key = keyOf(a); generation.set(key, (generation.get(key) ?? 0) + 1); cache.delete(key); inflight.delete(key);
  }
  const freshStatus = (id) => { invalidate(id); return statusOf(id); };
  /**
   * A conta está SABIDAMENTE desconectada (resposta recente em cache)? Só leitura de cache: nunca consulta a CLI.
   * Vale só para conta ISOLADA de provider em que o FORGE faz o login: a do computador pode estar autenticada por variável de ambiente (chave de API, Bedrock, Vertex),
   * e o provider sem login pelo FORGE (Codex) faz o login justamente dentro do terminal — bloquear o terminal impediria o próprio login.
   */
  const knownDisconnected = (id) => {
    const a = find(id); if (!a || a.home !== 'forge' || specOf(a.provider)?.canLogin !== true) return false;
    const hit = cache.get(keyOf(a)); return !!hit && Date.now() - hit.at < hit.ttl && hit.value.checked === true && hit.value.loggedIn === false;
  };

  const providerView = (id) => { const s = specOf(id); return { id, label: s.label, canLogin: s.canLogin, isolated: s.isolated, ...(s.note ? { note: s.note } : {}), available: providerAvailable(id) }; };
  const viewOf = async (a, withStatus) => {
    const spec = specOf(a.provider);
    return { id: a.id, provider: a.provider, providerLabel: spec.label, label: a.label, home: a.home, canLogin: spec.canLogin, createdAt: a.createdAt ?? null, status: withStatus ? await statusOf(a.id) : emptyStatus(null, false) };
  };
  /**
   * `status:false` = sem consultar as CLIs (status vazio); `fresh` = descarta o cache de todas as contas antes.
   * `lastUsed` = { [provider]: id | null }: a última conta usada de cada provider, para a interface pré-selecionar no seletor (só ids que ainda existem).
   */
  async function listView({ status = true, fresh = false } = {}) {
    if (fresh) for (const a of list()) invalidate(a.id);
    const ids = accountProviderIds();
    return { accounts: await Promise.all(list().map((a) => viewOf(a, status))), providers: ids.map(providerView), lastUsed: Object.fromEntries(ids.map((p) => [p, lastUsed(p)])) };
  }

  const fail = (st, error, extra = {}) => ({ ok: false, status: st, error, ...extra });
  const rowOf = (id) => (Array.isArray(db.accounts) ? db.accounts.find((a) => isObj(a) && a.id === id) : undefined); // a linha de verdade (para alterar)
  const freshId = () => { let id; for (let i = 0; i < 50; i++) { const c = uid('acc'); if (ACCOUNT_ID_RE.test(c) && !rawRows().some((a) => a.id === c)) { id = c; break; } } return id; };

  /** Registra a conta machine do provider ("Adicionar conta deste computador"): reaproveita o id anterior (as sessões antigas seguem retomáveis; a última leitura de limites é podada ao desvincular e volta na próxima consulta). */
  function addMachine(provider, label) {
    const spec = specOf(provider);
    if (list().some((a) => a.provider === provider && a.home === 'machine')) return fail(409, `Este computador já está vinculado ao ${spec.label}.`, { code: 'machine_exists' });
    if (!providerAvailable(provider)) return fail(409, `${spec.label} não encontrado neste computador.`, { code: 'cli_missing' });
    const v = validateLabel(label ?? MACHINE_LABELS[provider] ?? spec.label); if (!v.ok) return fail(400, v.error);
    const prevModel = db.accountsModel, known = isObj(prevModel) && prevModel.v === ACCOUNTS_MODEL_VERSION && isObj(prevModel.machineIds) ? prevModel.machineIds[provider] : null;
    const id = typeof known === 'string' && ACCOUNT_ID_RE.test(known) && !rawRows().some((a) => a.id === known) ? known : freshId();
    if (!id) return fail(500, 'Não foi possível gerar um identificador para a conta.');
    const hadList = Array.isArray(db.accounts), row = { id, provider, label: v.label, home: 'machine', createdAt: now() };
    if (!hadList) db.accounts = [];
    db.accounts.push(row);
    const m = isObj(prevModel) && prevModel.v === ACCOUNTS_MODEL_VERSION ? prevModel : null;
    db.accountsModel = { v: ACCOUNTS_MODEL_VERSION, at: m?.at ?? row.createdAt, adopted: { ...(isObj(m?.adopted) ? m.adopted : {}), [provider]: true }, machineIds: { ...(isObj(m?.machineIds) ? m.machineIds : {}), [provider]: id } };
    try { persist(); } catch {
      db.accounts.pop(); if (!hadList) delete db.accounts;
      if (prevModel === undefined) delete db.accountsModel; else db.accountsModel = prevModel;
      return fail(500, 'Não foi possível salvar a conta: o banco não pôde ser gravado; nada foi alterado.');
    }
    invalidate(id);
    return { ok: true, status: 201, account: publicOf(row) };
  }
  const publicOf = (a) => ({ id: a.id, provider: providerOf(a), label: a.label, home: accountHome(a), createdAt: a.createdAt });

  /** `home: 'machine'` = vincular o login do computador; senão uma conta isolada (só providers que o FORGE sabe logar). */
  function create({ provider, label, home = 'forge' } = {}) {
    const spec = typeof provider === 'string' ? specOf(provider) : null;
    if (!spec) return fail(400, 'Provedor indisponível.', { code: 'provider_unavailable' });
    if (home === 'machine') return addMachine(provider, label);
    if (home !== 'forge') return fail(400, 'Tipo de conta inválido.', { code: 'invalid_home' });
    if (!spec.isolated || !spec.canLogin) return fail(400, spec.note ?? `O FORGE não cria contas isoladas do ${spec.label}.`, { code: 'provider_unavailable' });
    const v = validateLabel(label); if (!v.ok) return fail(400, v.error);
    if (list().length >= MAX_ACCOUNTS) return fail(409, `Limite de ${MAX_ACCOUNTS} contas atingido: remova uma antes de adicionar outra.`, { code: 'accounts_limit' });
    const id = freshId(); if (!id) return fail(500, 'Não foi possível gerar um identificador para a conta.');
    const account = { id, provider, label: v.label, home: 'forge', createdAt: now() };
    try { ensureNewDir(id, provider); } catch { return fail(500, 'Não foi possível criar a pasta da conta; nada foi alterado.'); }
    const hadList = Array.isArray(db.accounts);
    if (!hadList) db.accounts = [];
    db.accounts.push(account);
    try { persist(); } catch {
      db.accounts.pop(); if (!hadList) delete db.accounts; // desfaz: nada fica só na memória
      try { removeDir(id); } catch { /* pasta vazia recém-criada: resíduo inofensivo */ }
      return fail(500, 'Não foi possível salvar a conta: o banco não pôde ser gravado; nada foi alterado.');
    }
    return { ok: true, status: 201, account: publicOf(account) };
  }

  /** Renomeia (só o rótulo). Desfaz se o banco não puder ser gravado. */
  function rename(id, label) {
    const row = typeof id === 'string' && exists(id) ? rowOf(id) : null; if (!row) return fail(404, 'Conta não encontrada.');
    const v = validateLabel(label); if (!v.ok) return fail(400, v.error);
    const prev = row.label; row.label = v.label;
    try { persist(); } catch { row.label = prev; return fail(500, 'Não foi possível renomear a conta: o banco não pôde ser gravado; nada foi alterado.'); }
    return { ok: true, status: 200, account: publicOf(row) };
  }

  /**
   * Conta de um provider para uma tarefa: a PEDIDA (existe, é do provider, não está em remoção nem sabidamente desconectada), senão a ÚNICA utilizável do provider.
   * Várias sem pedido = 409 account_required; nenhuma = 409 no_account. Síncrona: só lê o cache de login (nunca chama a CLI).
   */
  function resolveFor(provider, requested) {
    if (typeof provider !== 'string' || !specOf(provider)) return fail(400, 'Provedor indisponível.', { code: 'provider_unavailable' });
    if (requested !== undefined && requested !== null) {
      if (typeof requested !== 'string') return fail(400, 'accountId deve ser o identificador de uma conta.', { code: 'account_not_found' });
      const a = find(requested);
      if (!a) return fail(404, 'Conta não encontrada.', { code: 'account_not_found' });
      if (a.provider !== provider) return fail(400, 'Esta conta não é do provedor escolhido.', { code: 'account_provider_mismatch' });
      if (removing.has(a.id)) return fail(409, 'Esta conta está sendo removida.', { code: 'account_missing' });
      if (knownDisconnected(a.id)) return fail(409, `A conta "${a.label}" está desconectada: faça o login em Contas.`, { code: 'account_disconnected' });
      return { ok: true, status: 200, account: a };
    }
    const mine = list().filter((a) => a.provider === provider && !removing.has(a.id));
    const ok = mine.filter((a) => !knownDisconnected(a.id));
    if (ok.length === 1) return { ok: true, status: 200, account: ok[0] };
    const label = specOf(provider).label;
    if (ok.length > 1) return fail(409, `Há mais de uma conta do ${label}: escolha qual usar.`, { code: 'account_required' });
    return fail(409, mine.length ? `As contas do ${label} estão desconectadas: faça o login em Contas.` : `Nenhuma conta do ${label}: adicione uma em Contas.`, { code: 'no_account' });
  }

  /** Última conta usada do provider (pré-seleção da interface), se ainda existe; senão null. */
  function lastUsed(provider) {
    const id = isObj(db.settings?.lastAccountByProvider) ? db.settings.lastAccountByProvider[provider] : null;
    return typeof id === 'string' && find(id)?.provider === provider ? id : null;
  }
  /** Grava a última conta usada do provider. Melhor esforço: falha de gravação não derruba quem abriu o terminal (a escolha só deixa de ser lembrada). */
  function remember(provider, id) {
    if (!isObj(db.settings) || find(id)?.provider !== provider) return false;
    const prev = db.settings.lastAccountByProvider;
    if (isObj(prev) && prev[provider] === id) return true;
    db.settings.lastAccountByProvider = { ...(isObj(prev) ? prev : {}), [provider]: id };
    try { persist(); return true; } catch { if (prev === undefined) delete db.settings.lastAccountByProvider; else db.settings.lastAccountByProvider = prev; return false; }
  }

  // ---- remoção da pasta: só dentro de <dados>/accounts/<id>, nunca por link ----
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  /** { ok:true, dir|null } se a pasta pode ser apagada (null = não existe); { ok:false } se o id ou o caminho real não for seguro. */
  function inspectDir(id) {
    if (typeof id !== 'string' || !ACCOUNT_ID_RE.test(id)) return { ok: false };
    let rootReal; try { rootReal = fs.realpathSync(root); } catch { return { ok: true, dir: null }; } // sem a pasta raiz não há o que apagar
    let dataReal; try { dataReal = fs.realpathSync(dataDir); } catch { return { ok: false }; }
    if (!same(rootReal, path.join(dataReal, 'accounts'))) return { ok: false }; // a própria accounts/ não pode ser um link para fora da pasta de dados
    const target = path.join(root, id);
    let st; try { st = fs.lstatSync(target); } catch (e) { return e?.code === 'ENOENT' ? { ok: true, dir: null } : { ok: false }; }
    if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false }; // link simbólico/junction (ou arquivo): nunca
    let real; try { real = fs.realpathSync(target); } catch { return { ok: false }; }
    if (!same(real, path.join(rootReal, id))) return { ok: false }; // o caminho real tem de ser exatamente <raiz real>/<id>
    return { ok: true, dir: target };
  }
  function removeDir(id) {
    const r = inspectDir(id);
    if (!r.ok) return { ok: false };
    if (r.dir) fs.rmSync(r.dir, { recursive: true, force: true }); // rm recursivo NÃO segue links: um link dentro da pasta é removido, nunca o alvo
    return { ok: true, removed: !!r.dir };
  }

  /** Logout (melhor esforço, só de conta isolada), depois a pasta, depois o banco. Conta da máquina: só desvincula. Recusa conta em uso por terminal ou com login em andamento. */
  function runLogout(a) {
    const spec = specOf(a.provider); if (!spec || !providerAvailable(a.provider)) return Promise.resolve();
    const ls = spec.logoutSpec({ home: configDirOf(a.id), env: env(), resolve: ctxResolve(a.provider) });
    if (!ls || ls.error) return Promise.resolve();
    return new Promise((done) => {
      try { (run ?? execFile)(ls.file, ls.args, { timeout: statusTimeoutMs, windowsHide: true, windowsVerbatimArguments: ls.verbatim, env: ls.env, maxBuffer: 256 * 1024, encoding: 'utf8' }, () => done()); } catch { done(); }
    });
  }
  async function remove(id) {
    const a = typeof id === 'string' ? find(id) : null; if (!a) return fail(404, 'Conta não encontrada.');
    if (removing.has(id)) return fail(409, 'Esta conta já está sendo removida.');
    const busy = () => (isInUse(id) ? fail(409, 'Há um terminal em execução usando esta conta: feche-o antes de removê-la.', { code: 'account_in_use' })
      : isLoginActive(id) ? fail(409, 'Há um login em andamento nesta conta: cancele-o antes de removê-la.', { code: 'account_in_use' }) : null);
    const b0 = busy(); if (b0) return b0;
    const folder = isolatedHome(a); // só a conta isolada tem pasta; a da máquina é apenas desvinculada
    const cacheKey = keyOf(a);
    if (folder && !inspectDir(id).ok) return fail(500, 'A pasta desta conta não é segura para apagar (link ou caminho fora de accounts/); nada foi removido. Apague-a manualmente.', { code: 'unsafe_dir' });
    removing.add(id);
    try {
      if (folder && inspectDir(id).dir) { try { await runLogout(a); } catch { /* melhor esforço */ } }
      const b1 = busy(); if (b1) return b1; // um terminal pode ter aberto durante o logout
      const prevList = db.accounts;
      const last = isObj(db.settings?.lastAccountByProvider) ? db.settings.lastAccountByProvider : null, hadLast = last?.[a.provider] === id;
      db.accounts = db.accounts.filter((x) => !(isObj(x) && x.id === id)); // linhas inválidas ficam como estão
      if (hadLast) { db.settings.lastAccountByProvider = { ...last }; delete db.settings.lastAccountByProvider[a.provider]; }
      try { persist(); } catch {
        db.accounts = prevList; if (hadLast) db.settings.lastAccountByProvider = last; // rollback: a conta e a pasta seguem como estavam
        return fail(500, 'Não foi possível remover a conta: o banco não pôde ser gravado; nada foi alterado.');
      }
      cache.delete(cacheKey); inflight.delete(cacheKey); // chave calculada ANTES: com a linha fora do banco, keyOf daria a pasta inexistente
      let folderRemoved = false;
      if (folder) { try { folderRemoved = removeDir(id).ok; } catch { folderRemoved = false; } }
      return { ok: true, status: 200, id, unlinked: !folder, folderRemoved };
    } finally { removing.delete(id); }
  }

  return {
    list: () => list().map(publicOf), find, listView, create, rename, remove, resolveFor, lastUsed, remember, knownDisconnected,
    statusOf, freshStatus, invalidate, exists, usable, configDirOf, ensureDir, available: (provider) => providerAvailable(provider), installedMap, ctxResolve, inspectDir,
  };
}

// ---- migração no boot ----
/** Cópia ÚNICA de segurança do banco antes da primeira alteração do modelo v2 (idempotente: se já existe, não sobrescreve). Banco inexistente = nada a copiar. */
export function createDbBackup(dataDir) {
  return () => {
    const src = path.join(dataDir, 'db.json'), dst = path.join(dataDir, BACKUP_NAME);
    if (!fs.existsSync(src) || fs.existsSync(dst)) return;
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  };
}

/**
 * Roda a migração v2 e a persiste. Se a cópia de segurança ou a gravação falhar, o banco em memória volta exatamente ao que era (rollback) e o servidor segue em modo
 * compatível (leitura tolerante; a migração é tentada de novo no próximo boot). Nunca lança. @returns o relatório da migração + `error` se não pôde concluir.
 */
export function migrateAtBoot({ db, persist, installed, uid, now, backup, log = () => {} }) {
  const sessions = Array.isArray(db.terminalSessions) ? db.terminalSessions : [];
  const snap = {
    accounts: Array.isArray(db.accounts) ? [...db.accounts] : undefined, model: db.accountsModel, hadModel: Object.hasOwn(db, 'accountsModel'),
    last: db.settings?.lastAccountByProvider, hadLast: isObj(db.settings) && Object.hasOwn(db.settings, 'lastAccountByProvider'),
    ids: sessions.map((r) => [r, isObj(r) && Object.hasOwn(r, 'accountId'), isObj(r) ? r.accountId : undefined]),
  };
  const restore = () => {
    if (snap.accounts === undefined) delete db.accounts; else db.accounts = snap.accounts;
    if (snap.hadModel) db.accountsModel = snap.model; else delete db.accountsModel;
    if (isObj(db.settings)) { if (snap.hadLast) db.settings.lastAccountByProvider = snap.last; else delete db.settings.lastAccountByProvider; }
    for (const [r, had, v] of snap.ids) if (isObj(r)) { if (had) r.accountId = v; else delete r.accountId; }
  };
  let report;
  try { report = migrateAccountsV2(db, { installed, uid, now, backup }); } catch (e) { restore(); log(`migração de contas v2 não aplicada (${e?.code || e?.message || 'erro'}); o servidor segue em modo compatível`); return { changed: false, adopted: [], created: [], rewritten: 0, seeded: [], map: {}, error: String(e?.code || e?.message || e) }; }
  if (!report.changed) return report;
  try { persist(); } catch (e) { restore(); log(`migração de contas v2 não gravada (${e?.code || e?.message || 'erro'}); será tentada de novo no próximo boot`); return { changed: false, adopted: [], created: [], rewritten: 0, seeded: [], map: {}, error: String(e?.code || e?.message || e) }; }
  log(`contas v2: ${report.created.length} conta(s) do computador criada(s), ${report.rewritten} registro(s) reescrito(s)`);
  return report;
}

// ---- rotas ----
const LOGIN_ID = (req, res) => { if (ACCOUNT_ID_RE.test(req.params.id)) return true; res.status(404).json({ error: 'Conta não encontrada.' }); return false; };

/** GET/POST/PATCH/DELETE /api/accounts[...] e o login por conta. Leituras exigem o token de sessão (session-token.js); mutações já passam pelo guard. */
export function setupAccounts(app, { accounts, logins }) {
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  const out = (res, r, pick = (x) => x) => (r.ok ? res.status(r.status).json(pick(r)) : res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }));
  app.get('/api/accounts', asyncRoute(async (req, res) => { res.json(await accounts.listView({ status: req.query.status !== '0', fresh: req.query.fresh === '1' })); }));
  app.post('/api/accounts', (req, res) => out(res, accounts.create({ provider: body(req).provider, label: body(req).label, ...(body(req).home === undefined ? {} : { home: body(req).home }) }), (r) => r.account));
  app.patch('/api/accounts/:id', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, accounts.rename(req.params.id, body(req).label), (r) => r.account); });
  app.delete('/api/accounts/:id', asyncRoute(async (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, await accounts.remove(req.params.id), (r) => ({ ok: true, id: r.id, unlinked: r.unlinked, folderRemoved: r.folderRemoved })); }));
  app.get('/api/accounts/:id/login', (req, res) => { if (!LOGIN_ID(req, res)) return; res.json(logins.snapshot(req.params.id)); });
  app.post('/api/accounts/:id/login', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, logins.start(req.params.id, body(req).method), () => ({ ok: true })); });
  app.post('/api/accounts/:id/login/input', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, logins.input(req.params.id, body(req).text), () => ({ ok: true })); });
  app.post('/api/accounts/:id/login/cancel', asyncRoute(async (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, await logins.cancel(req.params.id), () => ({ ok: true })); }));
}
