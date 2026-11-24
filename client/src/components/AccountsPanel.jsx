import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Btn as BaseBtn } from './ui.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import {
  LOGIN_METHODS, DEFAULT_METHOD, LOGIN_INTRO, LOGIN_POLL_MS, NAME_MAX, MAX_ACCOUNTS,
  safeLoginUrl, accountState, loginButtonLabel, accountActions, canAddAccount, providerSelectable, validateName,
  canSendCode, tailLines, normalizeAccounts, isLoginRunning, apiErrorText, shouldRestoreCode, removalMessage, removalPrompt, loginInterrupted, LOGIN_INTERRUPTED,
  groupByProvider, machineCandidates,
} from '../accounts-view.js';

/** Btn do projeto usa `kind` (classes); aqui `variant`/`size` ficam legíveis. */
const Btn = ({ variant = '', size = '', ...p }) => <BaseBtn kind={`${variant} ${size}`.trim()} type="button" {...p} />;

const FALLBACK_PROVIDERS = [{ id: 'claude', label: 'Claude Code', available: true, canLogin: true }, { id: 'codex', label: 'Codex CLI', canLogin: false, note: 'O login é feito no próprio Codex CLI ("codex login" num terminal); o FORGE não gerencia contas do Codex.' }];

/** Painel de login de UMA conta: escolha do método, andamento (link, código, saída) e resultado. O servidor guarda o login; aqui só se consulta a cada ~1,5 s enquanto `running`. */
function LoginPanel({ account, resume, onFinished, onClose, onRunning }) {
  const [method, setMethod] = useState(DEFAULT_METHOD);
  const [phase, setPhase] = useState(resume ? 'run' : 'choose'); // 'choose' | 'run'
  const [login, setLogin] = useState(null);
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const finished = useRef(false);
  const id = account.id;

  // consulta enquanto estiver em 'run' e o login não terminou; para ao desmontar (flag + clearTimeout)
  useEffect(() => {
    if (phase !== 'run') return undefined;
    let stop = false, timer = null;
    const tick = async () => {
      let next = null;
      try { next = await api.get(`/api/accounts/${encodeURIComponent(id)}/login`); } catch (e) { if (!stop) setErr(e.message || 'Não foi possível consultar o login.'); }
      if (stop) return;
      if (next) {
        if (loginInterrupted('run', next)) { next = { ...next, state: 'failed', error: LOGIN_INTERRUPTED }; } // servidor reiniciou no meio do login
        setLogin(next); setErr(''); onRunning?.(next.state === 'running');
        if (next.state === 'done' && !finished.current) { finished.current = true; onFinished(); return; }
        if (next.state !== 'running') return; // failed, cancelled, idle: para de consultar
      }
      timer = setTimeout(tick, LOGIN_POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [phase, id, onFinished]);

  const start = async () => {
    setStarting(true); setErr(''); setLogin(null); setCode('');
    try { await api.post(`/api/accounts/${encodeURIComponent(id)}/login`, { method }); onRunning?.(true); setPhase('run'); }
    catch (e) { setErr(e.code === 'login_too_soon' ? apiErrorText(e) : e.status === 409 ? 'Já há um login em andamento. Termine ou cancele esse primeiro.' : apiErrorText(e, 'Não foi possível iniciar o login.')); }
    finally { setStarting(false); }
  };
  const send = async (e) => {
    e.preventDefault();
    if (!canSendCode(code, login) || sending) return;
    const text = code; setCode(''); setSending(true); // limpa na hora: o código nunca fica no campo nem em estado depois de enviado
    try { await api.post(`/api/accounts/${encodeURIComponent(id)}/login/input`, { text }); } catch (er) { if (shouldRestoreCode(er.code)) setCode((cur) => cur || text); setErr(apiErrorText(er, 'Não foi possível enviar o código.')); } // devolve o código ao campo para não precisar colar de novo finally { setSending(false); }
  };
  const cancel = async () => {
    try { await api.post(`/api/accounts/${encodeURIComponent(id)}/login/cancel`); } catch { /* já terminou */ }
    onClose();
  };

  const running = isLoginRunning(login) || (phase === 'run' && !login);
  const url = safeLoginUrl(login?.url);
  const lines = tailLines(login?.lines);
  const failed = login?.state === 'failed', cancelled = login?.state === 'cancelled';

  if (phase === 'choose') {
    return (
      <div className="acc-login" role="group" aria-label={`Entrar na conta ${account.label}`}>
        <label className="acc-field"><span>Como você quer entrar?</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={starting}>
            {LOGIN_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        {err && <p className="oc-note err" role="alert">{err}</p>}
        <div className="acc-actions">
          <Btn variant="primary" onClick={start} disabled={starting}>{starting ? 'Iniciando…' : 'Entrar'}</Btn>
          <Btn variant="quiet" onClick={onClose} disabled={starting}>Fechar</Btn>
        </div>
      </div>
    );
  }
  return (
    <div className="acc-login" role="group" aria-label={`Login da conta ${account.label}`}>
      {(running || (!failed && !cancelled)) && <p className="small" role="status">{LOGIN_INTRO}</p>}
      {url && <p className="small acc-url"><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p>}
      {login?.url && !url && <p className="oc-note err" role="status">O servidor devolveu um link que não é de um endereço oficial da Anthropic; por segurança ele não foi exibido. Cancele e tente de novo.</p>}
      {running && login?.needsCode === true && (
        <form className="acc-code" onSubmit={send}>
          <label className="acc-field"><span>Cole aqui o código que a página mostrou</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-autofocus="" />
          </label>
          <Btn type="submit" variant="primary" disabled={!canSendCode(code, login) || sending}>{sending ? 'Enviando…' : 'Enviar código'}</Btn>
        </form>
      )}
      {lines.length > 0 && <pre className="acc-log mono" role="log" aria-label="Saída do login" tabIndex={0}>{lines.join('\n')}</pre>}
      {failed && <p className="oc-note err" role="alert">{login.error || 'O login não foi concluído.'}</p>}
      {cancelled && <p className="oc-note" role="status">Login cancelado.</p>}
      {err && <p className="oc-note err" role="alert">{err}</p>}
      <div className="acc-actions">
        {running && <Btn onClick={cancel}>Cancelar</Btn>}
        {(failed || cancelled) && <Btn variant="primary" onClick={() => { setPhase('choose'); setLogin(null); setErr(''); }}>Tentar de novo</Btn>}
        {!running && <Btn variant="quiet" onClick={onClose}>Fechar</Btn>}
      </div>
    </div>
  );
}

/** Renomear uma conta (PATCH /api/accounts/:id, só o rótulo). */
function RenameForm({ account, onDone, onCancel }) {
  const [name, setName] = useState(account.label);
  const [err, setErr] = useState(''), [saving, setSaving] = useState(false);
  const v = validateName(name);
  const save = async (e) => {
    e.preventDefault();
    if (!v.ok || saving) return;
    setSaving(true); setErr('');
    try { await api.patch(`/api/accounts/${encodeURIComponent(account.id)}`, { label: v.value }); onDone(); }
    catch (er) { setErr(apiErrorText(er, 'Não foi possível renomear a conta.')); setSaving(false); }
  };
  return (
    <form className="acc-confirm" onSubmit={save} aria-label={`Renomear a conta ${account.label}`}>
      <label className="acc-field"><span>Novo nome</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} data-autofocus="" autoComplete="off" />
      </label>
      {!v.ok && name && <p className="dim small" role="status">{v.error}</p>}
      {err && <p className="oc-note err" role="alert">{err}</p>}
      <div className="acc-actions">
        <Btn type="submit" variant="primary" size="sm" disabled={!v.ok || saving || v.value === account.label}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
        <Btn variant="quiet" size="sm" onClick={onCancel} disabled={saving}>Cancelar</Btn>
      </div>
    </form>
  );
}

/**
 * Aba "Contas" das Configurações: as contas de TODAS as IAs, agrupadas por provider. Não existe conta "Sistema" nem "padrão": a conta deste computador é uma conta comum
 * (o login que você já usa fora do FORGE), que pode ser desvinculada e vinculada de novo; as outras são isoladas, com o login guardado pelo FORGE (só onde o FORGE sabe logar).
 */
export default function AccountsPanel() {
  const { refresh, loadAccounts } = useStore();
  const [data, setData] = useState({ accounts: [], providers: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }
  const [loginFor, setLoginFor] = useState(null); // { id, resume }
  const [runningId, setRunningId] = useState(null); // conta com login em andamento (um por vez)
  const [confirmId, setConfirmId] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [prov, setProv] = useState('claude');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false); // "Verificar de novo" (contas cujo login é feito no próprio CLI)
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (fresh = false) => {
    try {
      const d = await api.get(fresh ? '/api/accounts?fresh=1' : '/api/accounts');
      if (!alive.current) return null;
      const n = normalizeAccounts(d); setData(n); setLoadErr(''); setLoaded(true);
      loadAccounts?.();
      return n;
    } catch (e) {
      if (alive.current) { setLoadErr(e.status === 404 ? 'Este servidor ainda não tem o recurso de contas. Atualize o FORGE.' : (e.message || 'Não foi possível carregar as contas.')); setLoaded(true); }
      return null;
    }
  }, [loadAccounts]);

  // ao abrir: carrega e descobre um login que já esteja rodando (aba fechada e reaberta no meio do login)
  useEffect(() => {
    let off = false;
    (async () => {
      const n = await load(true); if (!n || off) return; // ao abrir: ignora o cache (o login pode ter sido feito fora do FORGE)
      for (const a of n.accounts) {
        try {
          const l = await api.get(`/api/accounts/${encodeURIComponent(a.id)}/login`);
          if (off) return;
          if (l?.state === 'running') { setRunningId(a.id); setLoginFor((cur) => cur ?? { id: a.id, resume: true }); break; }
        } catch { /* sem a rota */ }
      }
    })();
    return () => { off = true; };
  }, [load]);

  // Atualização automática enquanto a aba está aberta: um login feito fora do FORGE (ex.: `codex login`) aparece em poucos segundos. Pausa com a aba oculta e durante um login em andamento.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden && !runningId) load(false); }, 5000);
    return () => clearInterval(t);
  }, [load, runningId]);

  const providers = data.providers.length ? data.providers : FALLBACK_PROVIDERS;
  const selected = providers.find((p) => p.id === prov);

  const run = async (id, fn, okText) => {
    setBusyId(id); setMsg(null);
    try { const r = await fn(); if (r?.text) setMsg(r); else if (okText) setMsg({ kind: 'ok', text: okText }); }
    catch (e) { setMsg({ kind: 'err', text: apiErrorText(e, 'A operação falhou.') }); }
    finally { if (alive.current) setBusyId(null); await load(); }
  };
  const onFinished = useCallback(() => {
    setMsg({ kind: 'ok', text: 'Conta conectada.' }); setLoginFor(null); setRunningId(null);
    load(); refresh?.();
  }, [load, refresh]);
  const closeLogin = useCallback(() => { setLoginFor(null); setRunningId(null); load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    const chk = canAddAccount({ count: data.accounts.length, name, provider: selected });
    if (!chk.ok || saving) return;
    setSaving(true); setMsg(null);
    try {
      const a = await api.post('/api/accounts', { provider: prov, label: name.trim() });
      setName(''); setAdding(false);
      setMsg({ kind: 'ok', text: 'Conta adicionada. Clique em Entrar para conectá-la.' });
      await load();
      if (a?.id) setLoginFor({ id: a.id, resume: false });
    } catch (er) { setMsg({ kind: 'err', text: er.message || 'Não foi possível adicionar a conta.' }); }
    finally { setSaving(false); }
  };
  const addState = canAddAccount({ count: data.accounts.length, name, provider: selected });
  const groups = groupByProvider(data.accounts, data.providers);
  const machines = machineCandidates(data.providers, data.accounts);
  const recheck = async () => { setChecking(true); try { await load(true); } finally { if (alive.current) setChecking(false); } };
  const linkMachine = (p) => run(`machine:${p.id}`, async () => { await api.post('/api/accounts', { provider: p.id, home: 'machine' }); refresh?.(); }, `Conta deste computador vinculada ao ${p.label}.`);

  const card = (a, provider) => {
    const st = accountState(a), act = accountActions(a, { busy: busyId === a.id, loginRunningId: runningId });
    const open = loginFor?.id === a.id, confirming = confirmId === a.id, renaming = renameId === a.id;
    const idle = !open && !confirming && !renaming;
    return (
      <li key={a.id} className="acc-card">
        <div className="acc-head">
          <b className="acc-name">{a.label}</b>
          {a.home === 'machine' && <span className="oc-pill" title="O login que este computador já usa fora do FORGE. Desvincular não faz logout.">deste computador</span>}
        </div>
        <div className={`oc-state ${st.kind === 'ok' ? 'ok' : st.kind === 'bad' ? 'bad' : ''}`} role="status">
          <i aria-hidden="true" /><span>{st.text}</span>
        </div>
        {st.detail && <p className="dim small acc-sum">{st.detail}</p>}
        {!act.canLogin && st.kind !== 'ok' && <p className="dim small">{provider?.note || 'O login desta IA é feito no próprio CLI, num terminal.'}</p>}
        {idle && (
          <div className="acc-actions">
            {act.canLogin
              ? <Btn variant="primary" size="sm" onClick={() => setLoginFor({ id: a.id, resume: false })} disabled={!act.login} title={act.loginReason || undefined}>{loginButtonLabel(a)}</Btn>
              : <Btn size="sm" disabled={checking} onClick={recheck}>{checking ? 'Verificando…' : 'Verificar de novo'}</Btn>}
            <Btn size="sm" onClick={() => { setRenameId(a.id); setMsg(null); }} disabled={!act.rename}>Renomear</Btn>
            <Btn variant="danger" size="sm" onClick={() => setConfirmId(a.id)} disabled={!act.remove}>{act.removeLabel}</Btn>
          </div>
        )}
        {!open && act.loginReason && <p className="dim small">{act.loginReason}</p>}
        {renaming && <RenameForm account={a} onCancel={() => setRenameId(null)} onDone={() => { setRenameId(null); setMsg({ kind: 'ok', text: 'Conta renomeada.' }); load(); }} />}
        {confirming && (
          <div className="acc-confirm" role="alertdialog" aria-label={`${act.removeLabel} a conta ${a.label}`}>
            <p className="small">{removalPrompt(a)}</p>
            <div className="acc-actions">
              <Btn variant="danger" size="sm" data-autofocus="" onClick={async () => { setConfirmId(null); await run(a.id, async () => { const r = await api.del(`/api/accounts/${encodeURIComponent(a.id)}`); refresh?.(); return removalMessage({ ...r, id: a.id }); }); }}>{a.home === 'machine' ? 'Desvincular' : 'Remover conta'}</Btn>
              <Btn variant="quiet" size="sm" onClick={() => setConfirmId(null)}>Cancelar</Btn>
            </div>
          </div>
        )}
        {open && <LoginPanel account={a} resume={loginFor.resume} onFinished={onFinished} onClose={closeLogin} onRunning={(v) => setRunningId(v ? a.id : null)} />}
      </li>
    );
  };

  return (
    <div className="acc">
      <p className="dim small oc-lead">O FORGE usa as contas que você conectar aqui, de qualquer IA (Claude Code, Codex CLI). A conta “deste computador” é o login que você já usa fora do FORGE; as outras ficam isoladas, com o login guardado só pelo FORGE. Basta uma conta conectada de alguma IA.</p>
      {msg && <p className={`oc-note ${msg.kind === 'err' ? 'err' : 'ok'}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
      {loadErr && <p className="oc-note err" role="alert">{loadErr}</p>}
      {!loaded && <p className="dim small" role="status">Carregando contas…</p>}
      {groups.map((g) => (
        <section key={g.id} className="acc-group" aria-label={`Contas do ${g.label}`}>
          <h3 className="acc-gh"><ProviderLogo id={g.id} size={14} />{g.label}</h3>
          {g.accounts.length > 0
            ? <ul className="acc-list" aria-label={`Contas do ${g.label}`}>{g.accounts.map((a) => card(a, g.provider))}</ul>
            : <p className="dim small">Nenhuma conta do {g.label} ainda.</p>}
        </section>
      ))}
      {loaded && !loadErr && !data.accounts.length && !groups.length && <p className="dim small">Nenhuma conta ainda. Instale o Claude Code ou o Codex CLI e verifique de novo.</p>}
      {loaded && !loadErr && machines.length > 0 && (
        <div className="acc-actions">
          {machines.map((p) => <Btn key={p.id} onClick={() => linkMachine(p)} disabled={busyId === `machine:${p.id}`} title={`Usar no FORGE o login do ${p.label} que este computador já tem (não faz login nem logout).`}>{busyId === `machine:${p.id}` ? 'Vinculando…' : `Adicionar conta deste computador (${p.label})`}</Btn>)}
        </div>
      )}

      {!loadErr && (adding ? (
        <form className="acc-add" onSubmit={add} aria-label="Adicionar conta">
          <label className="acc-field"><span>Nome da conta</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder="Ex.: Trabalho" data-autofocus="" autoComplete="off" />
          </label>
          <fieldset className="acc-prov"><legend>Provedor</legend>
            {providers.map((p) => {
              const ok = providerSelectable(p);
              return (
                <label key={p.id} className={`acc-popt${ok ? '' : ' off'}`}>
                  <input type="radio" name="acc-prov" value={p.id} checked={prov === p.id} disabled={!ok} onChange={() => setProv(p.id)} />
                  <span>{p.label}</span>{!ok && <span className="oc-pill" title={p.note || undefined}>{p.canLogin === false ? 'login no próprio CLI' : 'indisponível'}</span>}
                </label>
              );
            })}
          </fieldset>
          {addState.reason && name && <p className="dim small" role="status">{addState.reason}</p>}
          <div className="acc-actions">
            <Btn type="submit" variant="primary" disabled={!addState.ok || saving}>{saving ? 'Adicionando…' : 'Adicionar'}</Btn>
            <Btn variant="quiet" onClick={() => { setAdding(false); setName(''); }} disabled={saving}>Cancelar</Btn>
          </div>
        </form>
      ) : (
        <div className="acc-actions">
          <Btn onClick={() => { setAdding(true); setMsg(null); }} disabled={data.accounts.length >= MAX_ACCOUNTS} title={data.accounts.length >= MAX_ACCOUNTS ? `Limite de ${MAX_ACCOUNTS} contas atingido.` : 'Uma conta isolada, com o login guardado só pelo FORGE (por exemplo, a do trabalho ao lado da pessoal).'}>Adicionar conta</Btn>
        </div>
      ))}
    </div>
  );
}
