// Contas do Claude Code no FORGE. Cada conta é uma pasta de configuração isolada (CLAUDE_CONFIG_DIR) e um login próprio.
//   - "Sistema" (id `system`): virtual, não é gravada, é o Claude Code da própria pessoa (vale o ambiente do processo). Sempre existe e não pode ser removida.
//   - Contas do FORGE: db.accounts = [{ id: 'acc_xxxxxxxx', provider: 'claude', label, createdAt }]; db.settings.defaultAccountId.
// A pasta da conta é SEMPRE <dados>/accounts/<id>/claude, derivada do id gerado pelo servidor (nunca de entrada do cliente).
// Nunca lemos arquivos de credenciais: o estado de login vem só da saída JSON de `claude auth status`, e só os campos do contrato saem daqui.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { asyncRoute } from './async-route.js';
import { launchSpec, envForAccount } from './claude-cli.js';
import { resolveClaude } from './providers/claude.js';

export const SYSTEM_ID = 'system';
export const ACCOUNT_ID_RE = /^acc_[0-9a-f]{8}$/;
export const MAX_ACCOUNTS = 10;
export const LABEL_MAX = 60;
export const STATUS_TTL_MS = 45_000;
const FAILURE_TTL_MS = 5_000; // falha de consulta (CLI ausente, tempo esgotado) não fica em cache por 45 s: instalar o Claude ou tentar de novo deve valer logo
export const NOT_FOUND = 'Claude Code não encontrado';
// Pasta que nunca existe: leitores de transcrição (conversas, consumo) que recebem uma conta já removida não encontram nada, em vez de cair na pasta global.
const GONE = '__conta-removida__';

export const PROVIDERS = Object.freeze([
  { id: 'claude', label: 'Claude Code', canLogin: true },
  { id: 'codex', label: 'Codex', available: false, comingSoon: true },
]);

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const clean = (v, max) => (typeof v === 'string' && !CONTROL.test(v) ? v.trim().slice(0, max) || null : null);

/** label: texto de 1 a 60 caracteres depois de aparar, sem caracteres de controle. */
export function validateLabel(v) {
  if (typeof v !== 'string') return { ok: false, error: 'Informe um nome para a conta.' };
  if (CONTROL.test(v)) return { ok: false, error: 'O nome da conta não pode ter caracteres de controle.' };
  const label = v.trim();
  if (!label) return { ok: false, error: 'Informe um nome para a conta.' };
  if (label.length > LABEL_MAX) return { ok: false, error: `O nome da conta deve ter no máximo ${LABEL_MAX} caracteres.` };
  return { ok: true, label };
}

const emptyStatus = (error = null, checked = false) => ({ checked, loggedIn: null, authMethod: null, email: null, orgName: null, subscriptionType: null, loginExpiresAt: null, error });

/** Só os campos do contrato, com tipos conferidos (a saída da CLI é dado não confiável). */
export function normalizeStatus(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.loggedIn !== 'boolean') return null;
  const expires = o.loginExpiresAt;
  return {
    checked: true, loggedIn: o.loggedIn, authMethod: clean(o.authMethod, 40), email: clean(o.email, 200), orgName: clean(o.orgName, 200), subscriptionType: clean(o.subscriptionType, 60),
    loginExpiresAt: typeof expires === 'string' ? clean(expires, 40) : (typeof expires === 'number' && Number.isFinite(expires) && Math.abs(expires) < 8.64e15 ? new Date(expires).toISOString() : null), error: null,
  };
}

/**
 * `command`/`prefixArgs` só são injetados pelos testes (CLI falsa); `unavailable: true` = tratar o Claude Code como ausente (testes que sobem o servidor sem CLI de contas).
 * `isInUse(id)` diz se um terminal em execução usa a conta. `env()` = ambiente base dos filhos.
 */
export function createAccounts({ db, dataDir, persist, now = () => new Date().toISOString(), uid, command, prefixArgs = [], unavailable = false, resolve = resolveClaude, env = () => process.env, isInUse = () => false, isLoginActive = () => false, isCycleBusy = () => false, statusTtlMs = STATUS_TTL_MS, statusTimeoutMs = 8000, run = null } = {}) {
  if (!db || !dataDir || typeof persist !== 'function') throw new Error('createAccounts: db, dataDir e persist são obrigatórios');
  const injected = command !== undefined;
  const root = path.join(dataDir, 'accounts');
  const list = () => (Array.isArray(db.accounts) ? db.accounts.filter((a) => a && ACCOUNT_ID_RE.test(String(a.id))) : []);
  const removing = new Set(); // contas em remoção: já não aceitam terminal nem login novos
  const find = (id) => list().find((a) => a.id === id) ?? null;
  const exists = (id) => id === SYSTEM_ID || find(id) !== null;
  const usable = (id) => exists(id) && !removing.has(id);
  const defaultId = () => (typeof db.settings?.defaultAccountId === 'string' && exists(db.settings.defaultAccountId) ? db.settings.defaultAccountId : SYSTEM_ID);
  /** Pasta de configuração: null = Sistema (ambiente do processo); conta removida/desconhecida = pasta inexistente (nunca a global). */
  const configDirOf = (id) => (id === undefined || id === null || id === SYSTEM_ID ? null : find(id) ? path.join(root, id, 'claude') : path.join(root, GONE));
  const available = () => !unavailable && (injected || !!resolve());
  const envOf = (id) => envForAccount(env(), configDirOf(id));

  function ensureDir(id) {
    if (id === SYSTEM_ID) return; // o Sistema usa a pasta do próprio usuário: nada a criar
    if (!ACCOUNT_ID_RE.test(String(id))) throw new Error('id inválido');
    const dir = path.join(root, id, 'claude'); // direto do id validado (a conta ainda pode não estar no banco)
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // 0700 só tem efeito em macOS/Linux; no Windows vale a ACL do perfil do usuário
  }

  // ---- execução de `claude auth <status|logout>` (execFile, SEM shell) ----
  function runAuth(id, sub) {
    const spec = launchSpec({ injected, command, prefixArgs }, ['auth', sub], { resolve });
    if (spec.error) return Promise.resolve({ spawnError: 'unsafe' });
    if (run) return run(spec, envOf(id));
    return new Promise((resolve_) => {
      try {
        execFile(spec.file, spec.args, { timeout: statusTimeoutMs, windowsHide: true, windowsVerbatimArguments: spec.verbatim, env: envOf(id), maxBuffer: 256 * 1024, encoding: 'utf8' }, (err, stdout) => {
          resolve_({ err, stdout: String(stdout ?? '') });
        });
      } catch (e) { resolve_({ err: e, stdout: '' }); }
    });
  }

  const cache = new Map(); // chave (pasta | 'system') -> { at, ttl, value }
  const inflight = new Map(); // chave -> Promise (chamadas simultâneas dividem UMA consulta)
  const keyOf = (id) => configDirOf(id) ?? SYSTEM_ID;
  async function fetchStatus(id) {
    if (!available()) return emptyStatus(NOT_FOUND);
    const r = await runAuth(id, 'status');
    if (r.spawnError) return emptyStatus('Não foi possível consultar o Claude Code com segurança.');
    // `claude auth status` sai com código != 0 quando não há login, mas ainda imprime o JSON: o que vale é o JSON.
    let parsed = null; try { parsed = JSON.parse(r.stdout); } catch { /* abaixo */ }
    const st = normalizeStatus(parsed);
    if (st) return st;
    if (r.err?.code === 'ENOENT') return emptyStatus(NOT_FOUND);
    if (r.err?.killed || r.err?.signal || r.err?.code === 'ETIMEDOUT') return emptyStatus('Tempo esgotado ao consultar o Claude Code.');
    return emptyStatus('Não foi possível consultar o estado do login.');
  }
  /** Estado de login da conta (cache de ~45 s por pasta, chamadas simultâneas deduplicadas). Nunca lança. */
  function statusOf(id) {
    const key = keyOf(id), hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);
    const gen = (generation.get(key) ?? 0);
    const p = fetchStatus(id).catch(() => emptyStatus('Não foi possível consultar o estado do login.')).then((value) => {
      if ((generation.get(key) ?? 0) === gen) cache.set(key, { at: Date.now(), ttl: value.checked ? statusTtlMs : FAILURE_TTL_MS, value }); // invalidado durante a consulta: o resultado antigo não entra
      return value;
    }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }
  const generation = new Map();
  /** Login/logout concluído: descarta o cache e qualquer consulta em andamento (o resultado dela é do estado ANTERIOR). */
  function invalidate(id) { const key = keyOf(id); generation.set(key, (generation.get(key) ?? 0) + 1); cache.delete(key); inflight.delete(key); }
  const freshStatus = (id) => { invalidate(id); return statusOf(id); };

  const view = async (a) => ({ id: a.id, provider: a.provider, label: a.label, system: a.id === SYSTEM_ID, isDefault: a.id === defaultId(), status: await statusOf(a.id) });
  const SYSTEM = Object.freeze({ id: SYSTEM_ID, provider: 'claude', label: 'Sistema' });
  const publicOf = (a) => ({ id: a.id, provider: a.provider, label: a.label, createdAt: a.createdAt });

  /** `status:false` = sem consultar a CLI (status vazio); `fresh` = descarta o cache de todas as contas antes. */
  async function listView({ status = true, fresh = false } = {}) {
    if (fresh) for (const a of [SYSTEM, ...list()]) invalidate(a.id);
    const accounts = await Promise.all([SYSTEM, ...list()].map(async (a) => (status ? view(a) : { id: a.id, provider: a.provider, label: a.label, system: a.id === SYSTEM_ID, isDefault: a.id === defaultId(), status: emptyStatus(null, false) })));
    return { accounts, defaultId: defaultId(), providers: PROVIDERS.map((p) => (p.id === 'claude' ? { ...p, available: available() } : { ...p })) };
  }

  const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

  function create({ provider, label } = {}) {
    if (provider !== 'claude') return fail(400, provider === 'codex' ? 'O Codex ainda não está disponível: em breve.' : 'Provedor indisponível.', { code: 'provider_unavailable' });
    const v = validateLabel(label); if (!v.ok) return fail(400, v.error);
    if (list().length >= MAX_ACCOUNTS) return fail(409, `Limite de ${MAX_ACCOUNTS} contas atingido: remova uma antes de adicionar outra.`, { code: 'accounts_limit' });
    let id; do { id = uid('acc'); } while (exists(id) || !ACCOUNT_ID_RE.test(id));
    const account = { id, provider: 'claude', label: v.label, createdAt: now() };
    try { ensureDir(id); } catch { return fail(500, 'Não foi possível criar a pasta da conta; nada foi alterado.'); }
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

  function setDefault(id) {
    if (typeof id !== 'string' || !exists(id)) return fail(404, 'Conta não encontrada.');
    const had = Object.hasOwn(db.settings, 'defaultAccountId'), prev = db.settings.defaultAccountId;
    db.settings.defaultAccountId = id;
    try { persist(); } catch {
      if (had) db.settings.defaultAccountId = prev; else delete db.settings.defaultAccountId;
      return fail(500, 'Não foi possível salvar a conta padrão: o banco não pôde ser gravado; nada foi alterado.');
    }
    return { ok: true, status: 200, defaultId: id };
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

  /** Logout (melhor esforço), depois a pasta, depois o banco. Recusa o Sistema, conta em uso por terminal ou com login em andamento. */
  async function remove(id) {
    if (id === SYSTEM_ID) return fail(400, 'A conta Sistema é o seu Claude Code e não pode ser removida.', { code: 'system_account' });
    const a = typeof id === 'string' ? find(id) : null; if (!a) return fail(404, 'Conta não encontrada.');
    if (removing.has(id)) return fail(409, 'Esta conta já está sendo removida.');
    const busy = () => (isInUse(id) ? fail(409, 'Há um terminal em execução usando esta conta: feche-o antes de removê-la.', { code: 'account_in_use' })
      : isLoginActive(id) ? fail(409, 'Há um login em andamento nesta conta: cancele-o antes de removê-la.', { code: 'account_in_use' })
      : id === defaultId() && isCycleBusy() ? fail(409, 'Esta é a conta padrão e o ciclo autônomo (Executor ou Planner) está em execução com ela: aguarde terminar ou troque a conta padrão antes de removê-la.', { code: 'account_in_use' }) : null);
    const b0 = busy(); if (b0) return b0;
    if (!inspectDir(id).ok) return fail(500, 'A pasta desta conta não é segura para apagar (link ou caminho fora de accounts/); nada foi removido. Apague-a manualmente.', { code: 'unsafe_dir' });
    removing.add(id);
    try {
      if (available() && inspectDir(id).dir) { try { await runAuth(id, 'logout'); } catch { /* melhor esforço */ } }
      const b1 = busy(); if (b1) return b1; // um terminal pode ter aberto durante o logout
      const prevList = db.accounts, hadDefault = Object.hasOwn(db.settings, 'defaultAccountId'), prevDefault = db.settings.defaultAccountId;
      db.accounts = list().filter((x) => x.id !== id);
      const wasDefault = db.settings.defaultAccountId === id; // (a conta já saiu da lista: defaultId() não serve aqui)
      if (db.settings.defaultAccountId === id) db.settings.defaultAccountId = SYSTEM_ID;
      try { persist(); } catch {
        db.accounts = prevList; if (hadDefault) db.settings.defaultAccountId = prevDefault; else delete db.settings.defaultAccountId; // rollback: a conta e a pasta seguem como estavam
        return fail(500, 'Não foi possível remover a conta: o banco não pôde ser gravado; nada foi alterado.');
      }
      invalidate(id);
      let folderRemoved = false;
      try { const r = removeDir(id); folderRemoved = r.ok; } catch { folderRemoved = false; }
      return { ok: true, status: 200, id, folderRemoved, ...(wasDefault ? { defaultChangedTo: SYSTEM_ID } : {}) };
    } finally { removing.delete(id); }
  }

  return { list: () => list().map(publicOf), listView, create, remove, setDefault, statusOf, freshStatus, invalidate, exists, usable, defaultId, configDirOf, envOf, ensureDir, available, runAuth, inspectDir };
}

// ---- rotas ----
const ID_PARAM = /^(?:system|acc_[0-9a-f]{8})$/;
const LOGIN_ID = (req, res) => { if (ID_PARAM.test(req.params.id)) return true; res.status(404).json({ error: 'Conta não encontrada.' }); return false; };

/** GET/POST/DELETE /api/accounts[...] e o login por conta. Leituras exigem o token de sessão (session-token.js); mutações já passam pelo guard. */
export function setupAccounts(app, { accounts, logins }) {
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  const out = (res, r, pick = (x) => x) => (r.ok ? res.status(r.status).json(pick(r)) : res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) }));
  app.get('/api/accounts', asyncRoute(async (req, res) => { res.json(await accounts.listView({ status: req.query.status !== '0', fresh: req.query.fresh === '1' })); }));
  app.post('/api/accounts', (req, res) => out(res, accounts.create({ provider: body(req).provider, label: body(req).label }), (r) => r.account));
  app.post('/api/accounts/:id/default', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, accounts.setDefault(req.params.id), (r) => ({ ok: true, defaultId: r.defaultId })); });
  app.delete('/api/accounts/:id', asyncRoute(async (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, await accounts.remove(req.params.id), (r) => ({ ok: true, id: r.id, folderRemoved: r.folderRemoved, ...(r.defaultChangedTo ? { defaultChangedTo: r.defaultChangedTo } : {}) })); }));
  app.get('/api/accounts/:id/login', (req, res) => { if (!LOGIN_ID(req, res)) return; res.json(logins.snapshot(req.params.id)); });
  app.post('/api/accounts/:id/login', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, logins.start(req.params.id, body(req).method), () => ({ ok: true })); });
  app.post('/api/accounts/:id/login/input', (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, logins.input(req.params.id, body(req).text), () => ({ ok: true })); });
  app.post('/api/accounts/:id/login/cancel', asyncRoute(async (req, res) => { if (!LOGIN_ID(req, res)) return; out(res, await logins.cancel(req.params.id), () => ({ ok: true })); }));
}
