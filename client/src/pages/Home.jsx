import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { environments, wsTone } from '../env-view.js';
import { useProviderActivity } from '../use-provider-activity.js';
import {
  PERIODS, MODES, periodById, modeById, windowOf, providerTotals, peakDay, buildSeries, axisTicks, totalCaption, longDate,
  fmtTokens, fmtExact, fmtPct, recentWorkspaces, continueTarget,
} from '../home-view.js';
import { ForgeMascot } from '../components/ForgeMascot.jsx';
import { WsIcon } from '../components/Sidebar.jsx';
import { Icon } from '../components/ui.jsx';

const PREFS_KEY = 'forge.home.prefs';
const readPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; return { period: periodById(p.period).id, mode: modeById(p.mode).id, cache: p.cache === true }; } catch { return { period: '30', mode: 'daily', cache: false }; } };
const RECENT_LIMIT = 6, SEARCH_LIMIT = 8;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Grupo de botões de uma escolha só (botões com aria-pressed, como os filtros do resto do app). */
function Segmented({ label, items, value, onPick }) {
  return (
    <div className="hm-seg" role="group" aria-label={label}>
      {items.map((it) => <button key={it.id} type="button" className={`hm-segbtn${value === it.id ? ' on' : ''}`} aria-pressed={value === it.id} onClick={() => onPick(it.id)}>{it.label}</button>)}
    </div>
  );
}

/**
 * Barras empilhadas por provider (SVG). O gráfico é um grupo focável: com o mouse, a dica segue a barra sob o ponteiro; com o teclado, as setas percorrem as barras (Home/End, Esc fecha)
 * e um aviso falado (região viva) descreve a barra atual. Uma tabela só para leitores de tela traz TODOS os valores.
 */
function Chart({ series, looks, modeNoun, caption }) {
  const { buckets, ids, max } = series, n = buckets.length;
  const [cursor, setCursor] = useState(null);
  const box = useRef(null);
  useEffect(() => { setCursor(null); }, [n]); // outra janela ou agrupamento (muda o número de barras): a barra marcada deixa de valer; atualizações de dados mantêm a dica
  const ticks = useMemo(() => axisTicks(buckets), [buckets]);
  const at = (e) => { const r = box.current.getBoundingClientRect(); return r.width ? Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))) : null; };
  const key = (e) => {
    const k = e.key, cur = cursor ?? (k === 'ArrowLeft' || k === 'End' ? n : -1);
    let next = null;
    if (k === 'ArrowRight') next = Math.min(n - 1, cur + 1); else if (k === 'ArrowLeft') next = Math.max(0, cur - 1); else if (k === 'Home') next = 0; else if (k === 'End') next = n - 1;
    else if (k === 'Escape' && cursor !== null) { e.preventDefault(); setCursor(null); return; } else return;
    e.preventDefault(); setCursor(next);
  };
  const b = cursor !== null ? buckets[cursor] : null;
  const say = b ? `${b.label}: ${fmtTokens(b.total)} tokens. ${ids.filter((id) => b.values[id] > 0).map((id) => `${looks[id].label} ${fmtTokens(b.values[id])}`).join(', ')}` : '';
  const pos = cursor === null ? 0 : ((cursor + 0.5) / n) * 100;
  return (
    <div className="hm-chartwrap">
      <div ref={box} className="hm-chart" tabIndex={0} role="group" aria-roledescription="gráfico de barras"
        aria-label={`Gráfico de barras empilhadas por provider, uma barra por ${modeNoun}, ${n} barras. Use as setas para percorrer. A tabela completa vem logo depois.`}
        onPointerMove={(e) => { if (e.pointerType !== 'touch' || e.buttons) setCursor(at(e)); }} onPointerDown={(e) => setCursor(at(e))} onPointerLeave={() => setCursor(null)} onBlur={() => setCursor(null)} onKeyDown={key}>
        <svg viewBox={`0 0 ${n * 10} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
          {cursor !== null && <rect className="hm-hl" x={cursor * 10} y="0" width="10" height="100" />}
          {buckets.map((bk, i) => {
            let y = 100;
            return <g key={bk.key}>{ids.map((id) => {
              const v = bk.values[id]; if (!(v > 0) || !(max > 0)) return null;
              const h = Math.max(0.9, (v / max) * 100); y -= h;
              return <rect key={id} x={i * 10 + 1.2} y={y} width="7.6" height={h} fill={looks[id].color} />;
            })}</g>;
          })}
        </svg>
        {b && (
          <div className={`hm-tip${cursor / n > 0.7 ? ' left' : cursor / n < 0.3 ? ' right' : ''}`} style={{ left: `${pos}%` }} aria-hidden="true">
            <b>{b.label}</b>
            <span className="hm-tip-total">{fmtExact(b.total)} tokens</span>
            {ids.filter((id) => b.values[id] > 0).map((id) => <span key={id} className="hm-tip-row"><i style={{ background: looks[id].color }} />{looks[id].label}<em>{fmtExact(b.values[id])}</em></span>)}
            {!ids.some((id) => b.values[id] > 0) && <span className="hm-tip-row">sem consumo</span>}
          </div>
        )}
      </div>
      <div className="hm-axis" aria-hidden="true">{ticks.map((t) => <span key={t.index} style={{ left: `${(t.index / n) * 100}%` }}>{t.label}</span>)}</div>
      <div className="hm-sr" role="status" aria-live="polite">{say}</div>
      <table className="hm-sr">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Período</th>{ids.map((id) => <th key={id} scope="col">{looks[id].label}</th>)}<th scope="col">Total</th></tr></thead>
        <tbody>{buckets.filter((bk) => bk.total > 0).map((bk) => <tr key={bk.key}><th scope="row">{bk.label}</th>{ids.map((id) => <td key={id}>{fmtExact(bk.values[id])}</td>)}<td>{fmtExact(bk.total)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Bloco "Atividade de tokens": consumo real das contas conectadas (dentro e fora do FORGE), lido pelo servidor. Nada aqui é simulado. */
function TokenActivity() {
  const [prefs, setPrefs] = useState(readPrefs);
  const set = (patch) => setPrefs((p) => { const next = { ...p, ...patch }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* só conveniência */ } return next; });
  const period = periodById(prefs.period), mode = modeById(prefs.mode), withCache = prefs.cache;
  const { status, data, error, scanning } = useProviderActivity({ days: period.days });
  const [today, setToday] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setToday(new Date()), 60_000); return () => clearInterval(t); }, []); // vira o dia sem recarregar
  const win = useMemo(() => windowOf(data, period.days, today), [data, period.days, today]);
  const view = useMemo(() => {
    if (!data) return null;
    const totals = providerTotals(data, win, withCache);
    return { totals, sum: totals.reduce((s, t) => s + t.total, 0), peak: peakDay(data, win, withCache), series: buildSeries(data, { win, mode: mode.id, withCache }), looks: Object.fromEntries(totals.map((t) => [t.id, t])) };
  }, [data, win, withCache, mode.id]);
  const has = !!view && view.sum > 0;
  const since = longDate(win.start);
  const caption = `Tokens por ${mode.noun}${mode.id === 'cumulative' ? ' (acumulado)' : ''} e por provider, ${withCache ? 'com cache' : 'entrada e saída'}, desde ${since}`;

  return (
    <section className="hm-act" aria-labelledby="hm-act-h">
      <h2 id="hm-act-h" className="hm-h2">Atividade de tokens</h2>
      <div className="hm-ctrls">
        <span className="hm-since">desde {since}</span>
        <Segmented label="Período" items={PERIODS} value={period.id} onPick={(id) => set({ period: id })} />
        <Segmented label="Agrupamento" items={MODES} value={mode.id} onPick={(id) => set({ mode: id })} />
      </div>
      <div className="hm-totalrow">
        <p className="hm-total" title={has ? `${fmtExact(view.sum)} tokens` : undefined}>
          <strong>{has ? fmtTokens(view.sum) : '—'}</strong> <span>{totalCaption(withCache)} desde {since}</span>
        </p>
        <button type="button" role="switch" aria-checked={withCache} className="hm-switch" onClick={() => set({ cache: !withCache })} title="Soma também o contexto lido do cache (leitura e criação)">
          <i aria-hidden="true" /><span>somar o cache</span>
        </button>
      </div>

      {status === 'error' && <p className="hm-note err" role="alert">{error}{data ? ' Mostrando a última leitura.' : ''}</p>}
      {scanning && status !== 'error' && <p className="hm-note" role="status">lendo o histórico das contas... os números sobem conforme a leitura avança.</p>}

      {!data && status === 'loading' && <p className="hm-empty" role="status" aria-busy="true">Lendo o consumo das contas conectadas...</p>}
      {!data && status === 'error' && <p className="hm-empty">Sem dados de consumo para mostrar.</p>}
      {data && !has && !scanning && <p className="hm-empty">Nenhum consumo encontrado nas contas conectadas{period.days > 0 ? ` nos últimos ${period.days} dias` : ''}.</p>}
      {data && !has && scanning && <p className="hm-empty">Ainda sem consumo lido.</p>}

      {has && (
        <>
          <p className="hm-peak">maior dia: {view.peak ? <><b>{fmtTokens(view.peak.total)}</b> <span>({longDate(view.peak.day)})</span></> : '—'}</p>
          <Chart series={view.series} looks={view.looks} modeNoun={mode.noun} caption={caption} />
          <div className="hm-share" role="img" aria-label={`Proporção por provider: ${view.totals.map((t) => `${t.label} ${fmtPct(t.total, view.sum)}`).join(', ')}`}>
            {view.totals.map((t) => <i key={t.id} style={{ flexGrow: t.total, background: t.color }} />)}
          </div>
          <ul className="hm-legend" aria-label="Consumo por provider">
            {view.totals.map((t) => (
              <li key={t.id} title={`${fmtExact(t.total)} tokens`}>
                <i style={{ background: t.color }} aria-hidden="true" /><span className="hm-lg-name">{t.label}</span><span className="hm-lg-val">{fmtTokens(t.total)}</span><span className="hm-lg-pct">{fmtPct(t.total, view.sum)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Coluna "Workspaces": busca e os usados mais recentemente (do registro real de atividade, terminais, missões e tópicos). Clicar abre o workspace no Cockpit. */
function WorkspaceColumn({ recents, count, query, setQuery, envOf, onOpenWorkspace, onOpenWorkspaces }) {
  const list = query.trim() ? recents.slice(0, SEARCH_LIMIT) : recents.slice(0, RECENT_LIMIT);
  return (
    <aside className="hm-side" aria-label="Workspaces">
      <div className="hm-sidehead">
        <h2 className="hm-h3">Workspaces <span className="hm-n">{count}</span></h2>
        <button type="button" className="hm-link" onClick={onOpenWorkspaces}>Todos <Icon name="chevronRight" size={12} /></button>
      </div>
      <div className="hm-search">
        <Icon name="search" size={14} />
        <input type="search" value={query} placeholder="Buscar workspace" aria-label="Buscar workspace" autoComplete="off" spellCheck={false} maxLength={80}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } else if (e.key === 'Enter' && list[0]) { e.preventDefault(); onOpenWorkspace(list[0].id); } }} />
      </div>
      <h3 className="hm-sub"><span>{query.trim() ? 'Resultados' : 'Recentes'}</span>{!query.trim() && <span>por último uso</span>}</h3>
      {count === 0
        ? <p className="hm-muted">Nenhum workspace ainda. <button type="button" className="hm-link" onClick={onOpenWorkspaces}>Adicionar um workspace</button></p>
        : list.length === 0
          ? <p className="hm-muted" role="status">Nenhum workspace encontrado.</p>
          : (
            <ul className="hm-recents">
              {list.map((r) => {
                const e = envOf.get(r.id);
                return (
                  <li key={r.id}>
                    <button type="button" className="hm-recent" onClick={() => onOpenWorkspace(r.id)} title={r.path} aria-label={`${r.name}${r.ago ? `, usado ${r.ago}` : ''}`}>
                      <span className="hm-rname">{r.name}</span>
                      <WsIcon tone={e ? wsTone(e) : 'idle'} agent={e?.agent ?? null} />
                      <span className="hm-ago">{r.ago}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
    </aside>
  );
}

/**
 * Página Início (a de abertura do app): cabeçalho com o Forjador, faixa CONTINUAR, atividade de tokens por provider e a coluna de workspaces.
 * Tudo vem do servidor (workspaces, atividade, terminais, missões e /api/provider-activity); sem dado, a tela diz isso em vez de preencher.
 */
export default function Home({ onOpenWorkspaces, onOpenWorkspace, missions = null }) {
  const { workspaces, activity, terminals, topics, activeTopicIds, state, workingIds, maestro } = useStore();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []); // "há 39 min" anda sozinho
  const sessions = terminals?.sessions ?? [], ms = Array.isArray(missions) ? missions : [];
  const base = { workspaces, activity, sessions, missions: ms, topics, now };
  const recents = useMemo(() => recentWorkspaces({ ...base, query }), [workspaces, activity, terminals, missions, topics, query, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const cont = useMemo(() => continueTarget({ ...base, activeTopicIds }), [workspaces, activity, terminals, missions, topics, activeTopicIds, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const envOf = useMemo(() => new Map(environments({ workspaces, sessions, activeId: state?.activeWorkspace?.id ?? null, workingIds, maestroTasks: maestro?.tasks ?? [] }).map((e) => [e.id, e])), [workspaces, terminals, state, workingIds, maestro]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="hm-scroll" data-testid="home-page">
      <div className="hm">
        <header className="hm-head">
          <ForgeMascot size={54} />
          <div className="hm-title">
            <h1>Início</h1>
            <p>{plural(workspaces.length, 'workspace', 'workspaces')}</p>
          </div>
          <button type="button" className="hm-new" onClick={onOpenWorkspaces}><Icon name="plus" size={13} /><span>Novo workspace</span></button>
        </header>

        {cont && (
          <button type="button" className="hm-continue" onClick={() => onOpenWorkspace(cont.workspaceId)} aria-label={`Continuar: ${cont.parts.join(', ')}`}>
            <b>Continuar</b>
            <span className="hm-cont-path">{cont.parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <em aria-hidden="true"> › </em>}<span>{p}</span></React.Fragment>)}</span>
            <Icon name="chevronRight" size={14} />
          </button>
        )}

        <div className="hm-cols">
          <TokenActivity />
          <WorkspaceColumn recents={recents} count={workspaces.length} query={query} setQuery={setQuery} envOf={envOf} onOpenWorkspace={onOpenWorkspace} onOpenWorkspaces={onOpenWorkspaces} />
        </div>
      </div>
    </div>
  );
}
