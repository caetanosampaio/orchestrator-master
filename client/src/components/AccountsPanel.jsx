import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Btn as BaseBtn } from './ui.jsx';
import { providerById, codexAccountState } from '../provider-view.js';
import {
  LOGIN_METHODS, DEFAULT_METHOD, LOGIN_INTRO, LOGIN_POLL_MS, NAME_MAX, MAX_ACCOUNTS,
  safeLoginUrl, accountState, loginButtonLabel, accountActions, canAddAccount, providerSelectable,
  canSendCode, tailLines, normalizeAccounts, isLoginRunning, apiErrorText, shouldRestoreCode, removalMessage, loginInterrupted, LOGIN_INTERRUPTED,
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

/** Aba "Contas" das Configurações: contas do Claude Code (login pelo navegador, conta padrão e remoção) e o estado do login do Codex CLI (que é do próprio CLI). */
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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [prov, setProv] = useState('claude');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false); // "Verificar de novo" do cartão do Codex
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
  const codex = data.providers.length ? providerById(data.providers, 'codex') : null, cx = codex ? codexAccountState(codex) : null; // sem a lista do servidor (servidor antigo) o cartão não afirma nada
  const codexCard = cx && (
    <section className="acc-card acc-codex" aria-label="Codex CLI">
      <div className="acc-head"><b className="acc-name">{codex.label}</b><span className="oc-pill" title={codex.note || undefined}>login no próprio CLI</span></div>
      <div className={`oc-state ${cx.kind === 'ok' ? 'ok' : cx.kind === 'bad' ? 'bad' : ''}`} role="status"><i aria-hidden="true" /><span>{cx.text}</span></div>
      <p className="dim small acc-sum">{cx.detail}</p>
      <div className="acc-actions"><Btn size="sm" disabled={checking} onClick={async () => { setChecking(true); try { await load(true); } finally { if (alive.current) setChecking(false); } }}>{checking ? 'Verificando…' : 'Verificar de novo'}</Btn></div>
    </section>
  );

  return (
    <div className="acc">
      <p className="dim small oc-lead">Cada conta tem o próprio login do Claude Code, guardado só neste computador. A conta Sistema é a do Claude Code que você já usa fora do FORGE. O Codex CLI usa o login dele mesmo, mostrado mais abaixo.</p>
      {msg && <p className={`oc-note ${msg.kind === 'err' ? 'err' : 'ok'}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</p>}
      {loadErr && <p className="oc-note err" role="alert">{loadErr}</p>}
      {!loaded && <p className="dim small" role="status">Carregando contas…</p>}
      <ul className="acc-list" aria-label="Contas">
        {data.accounts.map((a) => {
          const st = accountState(a), act = accountActions(a, { busy: busyId === a.id, loginRunningId: runningId });
          const open = loginFor?.id === a.id, confirming = confirmId === a.id;
          return (
            <li key={a.id} className={`acc-card${a.isDefault ? ' def' : ''}`}>
              <div className="acc-head">
                <b className="acc-name">{a.label}</b>
                {a.system && <span className="oc-pill" title="É a conta do próprio Claude Code, fora do FORGE. Não pode ser removida.">Sistema</span>}
                {a.isDefault && <span className="oc-pill ok" title="Usada nos novos terminais">Padrão</span>}
              </div>
              <div className={`oc-state ${st.kind === 'ok' ? 'ok' : st.kind === 'bad' ? 'bad' : ''}`} role="status">
                <i aria-hidden="true" /><span>{st.text}</span>
              </div>
              {st.detail && <p className="dim small acc-sum">{st.detail}</p>}
              {!open && !confirming && (
                <div className="acc-actions">
                  <Btn variant="primary" size="sm" onClick={() => setLoginFor({ id: a.id, resume: false })} disabled={!act.login} title={act.loginReason || undefined}>{loginButtonLabel(a)}</Btn>
                  {!a.isDefault && <Btn size="sm" onClick={() => run(a.id, () => api.post(`/api/accounts/${encodeURIComponent(a.id)}/default`), 'Conta padrão atualizada.')} disabled={!act.makeDefault}>Tornar padrão</Btn>}
                  {act.canRemove && <Btn variant="danger" size="sm" onClick={() => setConfirmId(a.id)} disabled={!act.remove}>Remover</Btn>}
                </div>
              )}
              {!open && act.loginReason && <p className="dim small">{act.loginReason}</p>}
              {confirming && (
                <div className="acc-confirm" role="alertdialog" aria-label={`Remover a conta ${a.label}`}>
                  <p className="small">Remover a conta “{a.label}”? Ela será desconectada e os dados de login dela serão apagados do FORGE. Isso não pode ser desfeito.</p>
                  <div className="acc-actions">
                    <Btn variant="danger" size="sm" data-autofocus="" onClick={async () => { setConfirmId(null); await run(a.id, async () => { const r = await api.del(`/api/accounts/${encodeURIComponent(a.id)}`); return removalMessage({ ...r, id: a.id }); }); }}>Remover conta</Btn>
                    <Btn variant="quiet" size="sm" onClick={() => setConfirmId(null)}>Cancelar</Btn>
                  </div>
                </div>
              )}
              {open && <LoginPanel account={a} resume={loginFor.resume} onFinished={onFinished} onClose={closeLogin} onRunning={(v) => setRunningId(v ? a.id : null)} />}
            </li>
          );
        })}
      </ul>
      {loaded && !loadErr && !data.accounts.length && <p className="dim small">Nenhuma conta ainda.</p>}
      {loaded && !loadErr && codexCard}

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
          <Btn onClick={() => { setAdding(true); setMsg(null); }} disabled={data.accounts.length >= MAX_ACCOUNTS} title={data.accounts.length >= MAX_ACCOUNTS ? `Limite de ${MAX_ACCOUNTS} contas atingido.` : undefined}>Adicionar conta</Btn>
        </div>
      ))}
    </div>
  );
}
