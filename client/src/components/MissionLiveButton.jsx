import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../mission-live.css';
import { copyText, describeLinkState, expiryMs, mintLiveLink, openLiveLink, revokeLiveLink } from '../live-link.js';

const DEMO_TIP = 'Missão demonstrativa: nada foi executado, então não há o que acompanhar no navegador.';

/**
 * Acompanhamento ao vivo da missão no navegador. Cunha (ou reaproveita) o link de capacidade no servidor, abre numa nova aba e permite copiar/encerrar.
 * A URL (com o token no caminho) fica SÓ no estado deste componente: nunca em armazenamento do navegador, console, `data-*` ou título. O pai usa `key={mission.id}`
 * para o estado não vazar entre missões.
 */
export default function MissionLiveButton({ mission }) {
  const demo = !!mission?.demo;
  const [link, setLink] = useState(null); // { url, expiresAt }
  const [busy, setBusy] = useState(null); // 'open' | 'copy' | 'revoke'
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text }
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const info = describeLinkState(link, now);
  const active = info.status === 'active';
  useEffect(() => { // relógio leve só enquanto há link válido, para a validade expirar na tela
    if (!link || info.status !== 'active') return undefined;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [link, info.status]);

  const say = (kind, text) => { if (alive.current) setMsg({ kind, text }); };

  // Garante um link válido (reaproveita o da tela; senão pede ao servidor, que também reaproveita o da missão).
  const ensure = useCallback(async () => {
    if (link && describeLinkState(link, Date.now()).status === 'active') return link;
    const r = await mintLiveLink(mission.id);
    if (!alive.current) return null;
    if (!r.ok) { setLink(null); say('error', r.message); return null; }
    setLink(r.link); setNow(Date.now());
    return r.link;
  }, [link, mission?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = async () => {
    setBusy('open'); setMsg(null);
    try {
      const l = await ensure(); if (!l) return;
      const how = openLiveLink(l.url);
      say(how === 'requested' ? 'ok' : 'error', how === 'requested' ? 'Link pedido ao navegador. Se nada abrir, copie o link abaixo e cole no navegador.' : 'Não foi possível abrir uma nova aba. Copie o link abaixo e abra no navegador.');
    } finally { if (alive.current) setBusy(null); }
  };
  const onCopy = async () => {
    setBusy('copy'); setMsg(null);
    try {
      const l = await ensure(); if (!l) return;
      const ok = await copyText(l.url);
      say(ok ? 'ok' : 'error', ok ? 'Link copiado.' : 'Não foi possível copiar sozinho. Selecione o link abaixo e copie com Ctrl+C.');
    } finally { if (alive.current) setBusy(null); }
  };
  const onRevoke = async () => {
    setBusy('revoke'); setMsg(null);
    try {
      const r = await revokeLiveLink(mission.id);
      if (!alive.current) return;
      if (r.ok) { setLink(null); say('ok', 'Link encerrado. Quem tinha o endereço não consegue mais abrir.'); } else say('error', r.message);
    } finally { if (alive.current) setBusy(null); }
  };

  const off = busy !== null;
  return (
    <section className="mi-live" aria-label="Acompanhamento ao vivo no navegador">
      <div className="mi-live-row">
        <p className="mi-kicker"><i aria-hidden="true" /><span>Ao vivo</span></p>
        <div className="mi-live-actions">
          <button type="button" className="mi-btn mi-btn-primary" onClick={onOpen} disabled={demo || off} aria-busy={busy === 'open'} aria-describedby={demo ? 'mi-live-demo' : undefined} title={demo ? DEMO_TIP : 'Abre o acompanhamento em tempo real desta missão numa nova aba do navegador'}>
            {busy === 'open' ? 'Gerando link…' : 'Acompanhar no navegador'}
          </button>
          <button type="button" className="mi-btn" onClick={onCopy} disabled={demo || off} aria-busy={busy === 'copy'} title={demo ? DEMO_TIP : 'Copia o link de acompanhamento (somente leitura)'}>
            {busy === 'copy' ? 'Copiando…' : 'Copiar link'}
          </button>
          <button type="button" className="mi-btn mi-btn-danger" onClick={onRevoke} disabled={demo || off || !link} aria-busy={busy === 'revoke'} title={link ? 'Revoga o link: o endereço deixa de funcionar' : 'Não há link ativo para encerrar'}>
            {busy === 'revoke' ? 'Encerrando…' : 'Encerrar link'}
          </button>
        </div>
      </div>
      {demo && <p id="mi-live-demo" className="mi-live-note">{DEMO_TIP}</p>}
      {!demo && link && (
        <div className="mi-live-link">
          <p className={`mi-live-state is-${info.status}`}>
            <span className="mi-live-dot" aria-hidden="true" />
            {active ? <span>Link ativo{info.until ? <> · válido até <time dateTime={new Date(expiryMs(link.expiresAt)).toISOString()}>{info.until}</time></> : ''} · somente leitura</span> : <span>Link expirado. Gere outro com “Acompanhar no navegador”.</span>}
          </p>
          {active && (
            <>
              <label className="mi-live-lab" htmlFor="mi-live-url">Link para abrir no navegador</label>
              <input id="mi-live-url" className="mi-live-url" type="text" readOnly value={link.url} autoComplete="off" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
            </>
          )}
        </div>
      )}
      {!demo && !link && !msg && <p className="mi-live-note">Mostra, em tempo real num navegador, o que esta missão está fazendo. O link é privado, somente leitura e expira sozinho.</p>}
      <p className="mi-live-msg is-ok" role="status">{msg?.kind === 'ok' ? msg.text : ''}</p>
      {msg?.kind === 'error' && <p className="mi-live-msg is-error" role="alert">{msg.text}</p>}
    </section>
  );
}
