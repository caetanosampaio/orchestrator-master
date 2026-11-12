import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import Dialog from './Dialog.jsx';
import { Btn } from './ui.jsx';
import { PROFILE_TITLE, SCOPE_NOTE, normalizeInfo, enableBlock, canSubmitEnable, buildPutBody, errorText, needsReload, auditLine, profileSeal, fmtWhen } from '../permission-profile.js';

/** Selo do perfil: discreto no padrão, vermelho e com "!" no bypass (a forma e o texto dizem o estado, não só a cor). */
export function ProfileSeal({ profile, className = '', as: Tag = 'span', ...rest }) {
  const s = profileSeal(profile);
  return <Tag className={`pp-seal pp-seal-${s.tone}${className ? ` ${className}` : ''}`} title={s.title} {...rest}>{s.glyph && <b aria-hidden="true">{s.glyph}</b>}{s.text}</Tag>;
}

const url = (id) => `/api/workspaces/${encodeURIComponent(id)}/permission-profile`;

/**
 * Perfil de permissão de UM workspace (padrão | sem confirmação). Tudo vem do servidor (GET): aviso e versão, lista pré-aprovada, auditoria e se dá para ligar.
 * Ligar exige a caixa "Entendo os riscos" (e, sem token de sessão, uma segunda caixa); nada liga sem o clique do usuário. Desligar é um clique.
 * @param {{ workspace: {id:string, name?:string}, onClose: () => void }} props
 */
export default function PermissionProfileDialog({ workspace, onClose }) {
  const { refresh, notify } = useStore();
  const uid = useId();
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [loadErr, setLoadErr] = useState('');
  const [confirmed, setConfirmed] = useState(false), [ackNoToken, setAckNoToken] = useState(false);
  const [busy, setBusy] = useState(false), [saveErr, setSaveErr] = useState('');
  const alive = useRef(true), seq = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setPhase('loading'); setLoadErr('');
    try {
      const d = normalizeInfo(await api.get(url(workspace.id)));
      if (!alive.current || my !== seq.current) return;
      if (!d) throw Object.assign(new Error('Resposta inesperada do servidor.'), { status: 502 });
      setInfo(d); setPhase('ready');
    } catch (e) {
      if (!alive.current || my !== seq.current) return;
      setInfo(null); setLoadErr(errorText(e, 'load')); setPhase('error');
    }
  }, [workspace.id]);
  useEffect(() => { load(); }, [load]);

  const apply = async (profile) => {
    if (busy) return;
    const body = buildPutBody(profile, info, { confirmed, ackNoToken });
    if (!body) return; // ligar sem as confirmações do usuário nunca vira pedido
    setBusy(true); setSaveErr('');
    try {
      const d = normalizeInfo(await api.put(url(workspace.id), body));
      if (!alive.current) return;
      if (d) setInfo(d); else await load();
      setConfirmed(false); setAckNoToken(false);
      notify(profile === 'bypass' ? 'Perfil sem confirmação ligado para as missões deste workspace.' : 'Perfil padrão restaurado.');
      refresh();
    } catch (e) {
      if (!alive.current) return;
      setSaveErr(errorText(e, 'save'));
      if (needsReload(e)) { setConfirmed(false); setAckNoToken(false); load(); }
    } finally { if (alive.current) setBusy(false); }
  };

  const bypass = info?.profile === 'bypass';
  const block = info && !bypass ? enableBlock(info) : null;
  const ready = canSubmitEnable(info, { confirmed, ackNoToken });
  const name = workspace.name || workspace.id;

  return (
    <Dialog title="Permissões do workspace" onClose={onClose} id="pp-dlg">
      <div className="pp">
        <p className="pp-ws"><span className="dim">Workspace</span> <b>{name}</b></p>
        <p className="pp-scope" role="note"><b>Vale só para missões.</b> {SCOPE_NOTE}</p>

        {phase === 'loading' && <p className="pp-note" role="status" aria-live="polite">Lendo o perfil de permissão…</p>}
        {phase === 'error' && (
          <div className="pp-note pp-err" role="alert">
            <p>{loadErr}</p>
            <div className="oc-actions"><Btn type="button" onClick={load}>Tentar de novo</Btn></div>
          </div>
        )}

        {phase === 'ready' && info && (
          <>
            <section className={`pp-state pp-state-${bypass ? 'bypass' : 'default'}`} aria-label="Perfil atual">
              <div className="pp-state-h">
                <span className="pp-state-k">Perfil atual</span>
                <ProfileSeal profile={info.profile} />
              </div>
              <p>
                {bypass
                  ? <>Nas missões deste workspace o Executor roda comandos, acessa a rede e instala pacotes <b>sem pedir confirmação</b>{info.since ? <> (desde {fmtWhen(info.since)})</> : null}. Aprovação humana de segredos e arquivos sensíveis continua valendo.</>
                  : <>{PROFILE_TITLE.default}: nas missões o Executor edita arquivos do workspace e roda só os comandos pré-aprovados abaixo; o resto é negado.</>}
              </p>
            </section>

            {bypass ? (
              <section className="pp-sec" aria-label="Voltar ao padrão">
                <div className="oc-actions pp-actions">
                  <Btn type="button" kind="primary" onClick={() => apply('default')} disabled={busy} aria-busy={busy || undefined}>{busy ? 'Voltando…' : 'Voltar ao perfil padrão'}</Btn>
                </div>
                <p className="dim small">Desligar vale na hora. Uma execução que já esteja em curso não é interrompida.</p>
              </section>
            ) : (
              <section className="pp-sec" aria-label="Ligar o perfil sem confirmação">
                <h3 className="oc-h">Ligar &quot;sem confirmação&quot;</h3>
                {info.warning ? (
                  <div className="pp-warn" role="group" aria-labelledby={`${uid}-w`}>
                    <p id={`${uid}-w`} className="pp-warn-t"><b aria-hidden="true">!</b> Aviso <span className="dim small">(versão {info.warning.version})</span></p>
                    <p className="pp-pre">{info.warning.text}</p>
                  </div>
                ) : null}
                {info.warning && (
                  <label className="pp-check">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy || !!block} />
                    <span>Entendo os riscos</span>
                  </label>
                )}
                {info.warning && !info.tokenProtected && info.warning.noTokenText.trim() && (
                  <>
                    <div className="pp-warn pp-warn-token" role="group" aria-labelledby={`${uid}-t`}>
                      <p id={`${uid}-t`} className="pp-warn-t"><b aria-hidden="true">!</b> Sem token de sessão</p>
                      <p className="pp-pre">{info.warning.noTokenText}</p>
                    </div>
                    <label className="pp-check">
                      <input type="checkbox" checked={ackNoToken} onChange={(e) => setAckNoToken(e.target.checked)} disabled={busy || !!block} />
                      <span>Entendo que não há proteção real contra o agente ligar isto sozinho</span>
                    </label>
                  </>
                )}
                {block && <p className="pp-note pp-block" role="status" id={`${uid}-b`}>{block}</p>}
                <div className="oc-actions pp-actions">
                  <button type="button" className="btn pp-danger" onClick={() => apply('bypass')} disabled={!ready || busy} aria-busy={busy || undefined} aria-describedby={block ? `${uid}-b` : undefined}>{busy ? 'Ligando…' : 'Ligar sem confirmação'}</button>
                </div>
              </section>
            )}

            {info.notice && <p className="pp-note" role="status">{info.notice}</p>}
            {saveErr &&<p className="pp-note pp-err" role="alert">{saveErr}</p>}

            <section className="pp-sec" aria-label="Comandos pré-aprovados">
              <h3 className="oc-h">Pré-aprovados no perfil padrão</h3>
              {info.defaultAllow.length
                ? <ul className="pp-allow mono">{info.defaultAllow.map((r) => <li key={r}>{r}</li>)}</ul>
                : <p className="dim small">O servidor não enviou a lista de comandos pré-aprovados.</p>}
              <p className="dim small">Fora da lista (instalar pacotes, rede, push, apagar) o perfil padrão nega. No perfil sem confirmação a lista deixa de limitar o Executor.</p>
            </section>

            <section className="pp-sec" aria-label="Auditoria">
              <h3 className="oc-h">Últimas mudanças</h3>
              {info.audit.length
                ? <ol className="pp-audit mono">{info.audit.map((e) => <li key={e.id} className={e.to === 'bypass' ? 'on' : ''}>{auditLine(e)}</li>)}</ol>
                : <p className="dim small">Nenhuma mudança registrada neste workspace.</p>}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
