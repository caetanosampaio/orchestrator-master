import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { paneState, pendingPanes, paneName } from '../env-view.js';
import { detectLocalUrls, safePreviewUrl, urlLabel, lastLines, elapsed, eventLabel } from '../forge-shell.js';
import ProviderLogo from './ProviderLogo.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { Icon } from './ui.jsx';

const STATE_LABEL = { working: 'executando', idle: 'ocioso', done: 'concluído', waiting: 'aguardando você', exited: 'encerrado', failed: 'falhou' };
const TAIL = 8000; // caracteres guardados por terminal só para achar URLs e a última linha (a tela inteira fica no stream)
const URL_KEY = 'forge.live.url'; // conveniência por workspace, só neste navegador
const readUrls = () => { try { return JSON.parse(localStorage.getItem(URL_KEY) || '{}') || {}; } catch { return {}; } };
const writeUrl = (ws, url) => { try { const all = readUrls(); if (url) all[ws] = url; else delete all[ws]; localStorage.setItem(URL_KEY, JSON.stringify(all)); } catch { /* sem armazenamento: vale só nesta sessão */ } };
// portas do próprio FORGE (API e, no desenvolvimento, o Vite): nunca entram no iframe
const ownPorts = () => [location.port || (location.protocol === 'https:' ? '443' : '80'), '4317'];

/**
 * Lê a saída AO VIVO dos terminais do workspace pelo MESMO stream SSE da grade (nenhuma conexão nova): guarda a cauda de cada um e devolve,
 * a cada ~400 ms no máximo, as URLs locais citadas (da mais recente) e as últimas linhas de cada terminal.
 */
function useLiveTail(stream, sessions) {
  const tails = useRef(new Map());
  const [snap, setSnap] = useState({ urls: [], lines: {} });
  const ids = sessions.map((s) => s.id).join(',');
  useEffect(() => {
    if (!stream) return undefined;
    let timer = null;
    const flush = () => {
      timer = null;
      const urls = [], lines = {};
      for (const s of sessions) {
        const t = tails.current.get(s.id) ?? '';
        for (const u of detectLocalUrls(t)) if (!urls.some((x) => x.url === u)) urls.push({ url: u, from: s });
        lines[s.id] = lastLines(t, 3);
      }
      setSnap({ urls, lines });
    };
    const later = () => { if (!timer) timer = setTimeout(flush, 400); };
    const subs = sessions.map((s) => stream.subscribe(s.id, {
      onReset: (text) => { tails.current.set(s.id, String(text ?? '').slice(-TAIL)); later(); },
      onData: (d) => { tails.current.set(s.id, ((tails.current.get(s.id) ?? '') + d).slice(-TAIL)); later(); },
    }));
    later();
    return () => { clearTimeout(timer); subs.forEach((u) => u()); };
  }, [stream, ids]); // eslint-disable-line react-hooks/exhaustive-deps -- a lista muda junto com `ids`
  return snap;
}

/** Preview de um servidor local num iframe isolado (sandbox, sem referrer): só loopback com porta, nunca o próprio FORGE. */
function Preview({ wsId, urls }) {
  const saved = readUrls()[wsId] ?? null;
  const [url, setUrl] = useState(saved);
  const [draft, setDraft] = useState(saved ?? '');
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState('idle'); // idle | loading | ready
  const [err, setErr] = useState('');
  const auto = !saved; // sem URL escolhida à mão, acompanha a mais recente que um terminal citou
  useEffect(() => { const s = readUrls()[wsId] ?? null; setUrl(s); setDraft(s ?? ''); setErr(''); }, [wsId]);
  const detected = urls[0]?.url ?? null;
  const target = safePreviewUrl(url ?? (auto ? detected : null), ownPorts());
  useEffect(() => { if (auto && detected && !url) setDraft(detected); }, [auto, detected, url]);
  useEffect(() => { if (target) setState('loading'); }, [target, nonce]);
  const go = (raw) => {
    const ok = safePreviewUrl(raw, ownPorts());
    if (!ok) { setErr('Use um endereço local com porta, como localhost:5173 (o próprio FORGE não abre aqui).'); return; }
    setErr(''); setUrl(ok); setDraft(ok); writeUrl(wsId, ok); setNonce((n) => n + 1);
  };
  const follow = () => { setUrl(null); writeUrl(wsId, null); setDraft(detected ?? ''); setErr(''); };
  return (
    <div className="fx-pv">
      <form className="fx-pv-bar" onSubmit={(e) => { e.preventDefault(); go(draft); }}>
        <span className={`fx-pv-dot ${target ? state : 'idle'}`} aria-hidden="true" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="localhost:5173" aria-label="Endereço do servidor local" spellCheck="false" autoComplete="off" />
        <button type="button" className="fx-ibtn sm" onClick={() => setNonce((n) => n + 1)} disabled={!target} aria-label="Recarregar" title="Recarregar"><Icon name="refresh" size={13} /></button>
        <a className={`fx-ibtn sm${target ? '' : ' disabled'}`} href={target ?? undefined} target="_blank" rel="noopener noreferrer" aria-label="Abrir no navegador" title="Abrir no navegador" aria-disabled={!target}><Icon name="external" size={13} /></a>
      </form>
      {err && <p className="fx-pv-err" role="alert">{err}</p>}
      {urls.length > 0 && (
        <div className="fx-pv-chips" role="group" aria-label="Servidores detectados nos terminais">
          {urls.slice(0, 4).map((u) => (
            <button key={u.url} type="button" className={`fx-chip btn${target === safePreviewUrl(u.url, ownPorts()) ? ' on' : ''}`} onClick={() => go(u.url)} title={`Citado por ${u.from.title}`}>
              <ProviderLogo id={u.from.provider || 'claude'} size={10} />{urlLabel(u.url)}
            </button>
          ))}
          {url && detected && <button type="button" className="fx-chip btn ghost" onClick={follow} title="Voltar a seguir o servidor mais recente citado pelos terminais">seguir automático</button>}
        </div>
      )}
      <div className="fx-pv-frame">
        {target
          ? <iframe key={`${target}#${nonce}`} src={target} title="Preview do servidor local" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" referrerPolicy="no-referrer" onLoad={() => setState('ready')} />
          : (
            <div className="fx-pv-empty">
              <span className="fx-pv-empty-ico"><Icon name="globe" size={22} /></span>
              <b>Nenhum servidor local ainda</b>
              <p>Quando um terminal subir um servidor (ex.: <code>npm run dev</code>), ele aparece aqui sozinho. Ou digite o endereço acima.</p>
            </div>
          )}
        {target && state === 'loading' && <span className="fx-pv-load" aria-hidden="true" />}
      </div>
    </div>
  );
}

/** Um agente no feed: estado, quem é, o que o hook diz e as últimas linhas da saída, em tempo real. */
function TeamRow({ s, state, lines, now, full }) {
  const nm = paneName(s, null);
  const ev = state === 'working' ? eventLabel(s.agent?.event) : '';
  const shown = full ? lines : lines.slice(-1);
  return (
    <li className={`fx-team-r st-${state}`}>
      <div className="fx-team-h">
        <StatusGlyph state={state} size={12} />
        <ProviderLogo id={s.provider || 'claude'} size={12} />
        <b title={s.title}>{nm.name}</b>
        {s.roleLabel && !String(s.title).toLowerCase().includes(String(s.roleLabel).toLowerCase()) && <span className="fx-chip">{s.roleLabel}</span>}
        <span className="grow" />
        <span className="fx-team-m">{[STATE_LABEL[state], elapsed(s.startedAt, now)].filter(Boolean).join(' · ')}</span>
      </div>
      {(shown.length > 0 || ev) && (
        <div className="fx-team-out">
          {ev && <span className="fx-team-ev">{ev}</span>}
          {shown.map((l, i) => <code key={`${i}:${l}`} className={i === shown.length - 1 ? 'last' : ''}>{l}</code>)}
        </div>
      )}
    </li>
  );
}

/**
 * Painel Live (lateral direita do Cockpit, onde o Orca mostra os arquivos): o PREVIEW do servidor local que a equipe está construindo, com a URL
 * detectada sozinha na saída dos terminais, e o feed da EQUIPE ao vivo (o que cada terminal está fazendo agora). Tudo do workspace aberto.
 */
export default function LivePanel({ stream, onClose }) {
  const { state, terminals, maestro, workingIds } = useStore();
  const ws = state?.activeWorkspace;
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('forge.live.tab') === 'team' ? 'team' : 'preview'; } catch { return 'preview'; } });
  const pick = (t) => { setTab(t); try { localStorage.setItem('forge.live.tab', t); } catch { /* conveniência local */ } };
  const [teamOpen, setTeamOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const sessions = useMemo(() => (terminals?.sessions ?? []).filter((s) => ws && s.workspaceId === ws.id), [terminals, ws]);
  const pending = useMemo(() => pendingPanes(maestro?.tasks ?? []), [maestro]);
  const live = useLiveTail(stream, sessions);
  const rows = sessions.map((s) => ({ s, state: paneState(s, workingIds, pending) })).sort((a, b) => (a.s.status === 'running' ? 0 : 1) - (b.s.status === 'running' ? 0 : 1));
  const busy = rows.filter((r) => r.state === 'working').length;

  return (
    <aside className="fx-live" aria-label="Painel Live">
      <header className="fx-live-h">
        <div className="fx-live-tabs" role="tablist" aria-label="Painel Live">
          <button type="button" role="tab" aria-selected={tab === 'preview'} className={`fx-ibtn${tab === 'preview' ? ' on' : ''}`} onClick={() => pick('preview')} title="Preview do localhost"><Icon name="globe" size={15} /></button>
          <button type="button" role="tab" aria-selected={tab === 'team'} className={`fx-ibtn${tab === 'team' ? ' on' : ''}`} onClick={() => pick('team')} title="Equipe ao vivo"><Icon name="activity" size={15} /></button>
        </div>
        <span className="fx-live-t">{tab === 'preview' ? 'Preview' : 'Equipe ao vivo'}</span>
        <span className="grow" />
        {busy > 0 && <span className="fx-live-busy" title={`${busy} trabalhando agora`}><StatusGlyph state="working" size={12} />{busy}</span>}
        <button type="button" className="fx-ibtn" onClick={onClose} aria-label="Fechar o painel Live" title="Fechar o painel"><Icon name="panel" size={15} /></button>
      </header>
      {!ws ? <div className="fx-pv-empty"><b>Abra um workspace</b><p>O painel mostra o servidor local e a equipe do workspace aberto.</p></div> : tab === 'preview' ? (
        <>
          <Preview wsId={ws.id} urls={live.urls} />
          <section className={`fx-team mini${teamOpen ? ' open' : ''}`} aria-label="Equipe ao vivo">
            <button type="button" className="fx-team-toggle" onClick={() => setTeamOpen((o) => !o)} aria-expanded={teamOpen}>
              <Icon name={teamOpen ? 'chevronDown' : 'chevronRight'} size={12} /><span>Equipe</span><span className="fx-n">{rows.length}</span>
            </button>
            {teamOpen && (rows.length ? <ul>{rows.map((r) => <TeamRow key={r.s.id} s={r.s} state={r.state} lines={live.lines[r.s.id] ?? []} now={now} />)}</ul> : <p className="fx-team-empty">Nenhum terminal aberto neste workspace.</p>)}
          </section>
        </>
      ) : (
        <section className="fx-team full" aria-label="Equipe ao vivo">
          {rows.length ? <ul>{rows.map((r) => <TeamRow key={r.s.id} s={r.s} state={r.state} lines={live.lines[r.s.id] ?? []} now={now} full />)}</ul> : <p className="fx-team-empty">Nenhum terminal aberto neste workspace.</p>}
        </section>
      )}
    </aside>
  );
}
