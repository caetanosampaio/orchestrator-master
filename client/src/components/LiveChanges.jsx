import React, { useEffect, useState } from 'react';
import { useChanges } from '../use-live.js';
import { agoLabel, changeStatus, changesSummary, lineDelta, splitPath } from '../live-view.js';
import ProviderLogo from './ProviderLogo.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { Icon } from './ui.jsx';

// estado da etapa da missão -> estado do glifo (a forma diz o estado; o texto ao lado diz o mesmo)
const STEP_GLYPH = { running: 'working', waiting: 'waiting', completed: 'done', failed: 'failed', pending: 'idle', skipped: 'exited', cancelled: 'exited' };
const AGENT_LABEL = { working: 'executando', idle: 'ocioso', done: 'concluído', waiting: 'aguardando você', exited: 'encerrado', failed: 'falhou' };

/** Progresso da missão ativa: barra n/m e as etapas com o estado de cada uma. */
function Mission({ m }) {
  return (
    <section className="lv-sec" aria-label={`Missão em execução: ${m.title}`}>
      <h3 className="lv-h"><span>Missão</span><span className="lv-n">{m.label}</span></h3>
      <p className="lv-mt" title={m.title}>{m.title}</p>
      <div className="lv-bar" role="progressbar" aria-label={`Progresso de ${m.title}`} aria-valuemin={0} aria-valuemax={m.total} aria-valuenow={m.done} aria-valuetext={`${m.done} de ${m.total} etapas concluídas`}><i style={{ width: `${m.pct}%` }} /></div>
      {m.steps.length > 0 && (
        <ol className="lv-steps">
          {m.steps.map((s) => (
            <li key={s.id} className={`lv-step t-${s.tone}`}>
              <StatusGlyph state={STEP_GLYPH[s.state] ?? 'idle'} size={12} />
              <span className="lv-step-t" title={s.title}>{s.title}</span>
              <span className="lv-step-s">{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Última linha de cada agente do workspace (a mesma leitura ao vivo do painel Equipe). */
function Agents({ agents }) {
  if (!agents.length) return null;
  return (
    <section className="lv-sec" aria-label="Agentes">
      <h3 className="lv-h"><span>Agentes</span><span className="lv-n">{agents.length}</span></h3>
      <ul className="lv-agents">
        {agents.map((a) => (
          <li key={a.id} className={`lv-ag st-${a.state}`}>
            <div className="lv-ag-h">
              <StatusGlyph state={a.state} size={12} />
              <ProviderLogo id={a.provider || 'claude'} size={12} />
              <b title={a.name}>{a.name}</b>
              <span className="lv-ag-s">{AGENT_LABEL[a.state] ?? ''}</span>
            </div>
            {a.line && <code className="lv-ag-l" title={a.line}>{a.line}</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FileRow({ f, now }) {
  const st = changeStatus(f.status), { dir, name } = splitPath(f.path), d = lineDelta(f), ago = agoLabel(f.mtime, now);
  return (
    <li className={`lv-f s-${f.status === 'untracked' ? 'added' : f.status}`}>
      <span className={`lv-mark t-${st.tone}`} aria-hidden="true">{st.mark}</span>
      <span className="lv-fp" title={f.path}><span className="sr">{st.label}: </span>{dir && <span className="lv-dir">{dir}</span>}<span className="lv-name">{name}</span></span>
      <span className="lv-d">
        {d.text === 'binário' ? <span className="lv-bin">binário</span> : (
          <>
            {d.added !== null && <span className="lv-add">+{d.added}</span>}
            {d.removed !== null && <span className="lv-rem">−{d.removed}</span>}
          </>
        )}
      </span>
      {ago && <time className="lv-ago" dateTime={Number.isFinite(f.mtime) ? new Date(f.mtime).toISOString() : undefined}>{ago}</time>}
    </li>
  );
}

/**
 * Aba "Construção" do painel Live: o que a equipe está construindo agora. Progresso da missão ativa (do /api/flows já lido pelo App), última linha de
 * cada agente (leitura ao vivo do painel) e os arquivos criados/alterados do workspace (GET /api/live/changes: git, ou varredura por data sem Git).
 */
export default function LiveChanges({ wsId, active = true, busy = false, mission = null, agents = [] }) {
  const { data, failure, loading, refresh } = useChanges(wsId, active, busy);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  const sum = changesSummary(data);
  const files = Array.isArray(data?.files) ? data.files : [];
  return (
    <div className="lv" role="tabpanel" aria-label="Construção">
      {mission && <Mission m={mission} />}
      <Agents agents={agents} />
      <section className="lv-sec" aria-label="Arquivos alterados">
        <h3 className="lv-h">
          <span>Arquivos</span>
          {data?.branch && <span className="lv-br" title={`Branch ${data.branch}`}>{data.branch}</span>}
          <span className="grow" />
          <button type="button" className="fx-ibtn sm" onClick={refresh} aria-label="Atualizar a lista de arquivos" title="Atualizar agora"><Icon name="refresh" size={13} /></button>
        </h3>
        {failure && <p className="lv-msg err" role="alert">{failure}</p>}
        {!data && !failure && loading && <p className="lv-msg">Lendo as alterações do projeto…</p>}
        {data && (
          <>
            <p className={`lv-sum${sum.state === 'error' ? ' err' : ''}`}>
              {sum.text}
              {sum.state === 'ok' && <span className="lv-mode"> · {sum.mode === 'git' ? 'Git' : 'por data de modificação'}</span>}
            </p>
            {files.length > 0 && <ul className="lv-files">{files.map((f) => <FileRow key={`${f.status}:${f.path}`} f={f} now={now} />)}</ul>}
            {sum.extra > 0 && <p className="lv-more">e mais {sum.extra} {sum.extra === 1 ? 'arquivo' : 'arquivos'}</p>}
            {data.truncated && sum.extra === 0 && files.length > 0 && <p className="lv-more">lista cortada: há mais arquivos do que o painel mostra</p>}
          </>
        )}
      </section>
    </div>
  );
}
