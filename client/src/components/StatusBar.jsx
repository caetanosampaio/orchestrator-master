import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { useUi } from '../hooks.js';
import { useLimits } from '../use-limits.js';
import { providerSummary, usageBand, DASH } from '../limits-view.js';
import { systemStatus } from '../system-status.js';
import { untilShort } from '../forge-shell.js';
import ProviderLogo from './ProviderLogo.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import SystemStatus from './SystemStatus.jsx';
import { ProviderPanel } from './LimitsStrip.jsx';
import { Icon } from './ui.jsx';
import PetCreature from './PetCreature.jsx';
import { usePet, petMood } from '../use-pet.js';
import '../pet.css';

/** "42% 2h 48m": uso da janela e quanto falta para ela reiniciar. Sem leitura = "—". */
const win = (w, now) => (w ? `${Math.round(w.usedPct)}%${untilShort(w.resetsAt, now) ? ` ${untilShort(w.resetsAt, now)}` : ''}` : DASH);

/** Um provedor na barra: logo, a barra fina do uso da janela de 5 h e os dois números (5 h · semana), como no rodapé do Orca. Clicar abre os limites das contas. */
function ProviderItem({ sum, now, refresh }) {
  const [open, setOpen] = useState(false), btn = useRef(null);
  const pct = sum.session?.usedPct ?? null, band = usageBand(sum.critical ? sum[sum.critical].usedPct : null);
  const text = `${win(sum.session, now)} · ${win(sum.week, now)}`;
  return (
    <>
      <button type="button" ref={btn} className={`fx-sb-i fx-sb-lim band-${band}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`lm-pop-${sum.provider}`}
        aria-label={`Limites do ${sum.label}: janela de 5 h ${win(sum.session, now)}, semana ${win(sum.week, now)}`} title={`${sum.label}: janela de 5 h · semana. Clique para ver as contas.`}
        onClick={() => { setOpen((o) => !o); refresh?.(); }}>
        <ProviderLogo id={sum.provider} size={12} />
        <i className="fx-sb-bar" aria-hidden="true"><u style={{ width: `${pct === null ? 0 : Math.max(pct > 0 ? 4 : 0, Math.min(100, pct))}%` }} /></i>
        <span className="fx-sb-t">{text}</span>
      </button>
      {open && <ProviderPanel sum={sum} now={now} anchor={btn} onClose={() => setOpen(false)} />}
    </>
  );
}

/** O bichinho em miniatura: abre Configurações > Bichinho; um ponto avisa quando ele precisa de você (como o bipe do Tamagotchi). */
function PetBadge() {
  const s = usePet(), m = petMood(s);
  if (!s.pet || !m) return null;
  const name = s.pet.name || 'bichinho', need = m.needs.length > 0;
  return (
    <button type="button" className={`fx-sb-i fx-sb-btn fx-sb-pet${need ? ' need' : ''}`} onClick={() => { location.hash = '#/settings/bichinho'; }} title={need ? `${name} precisa de você` : `${name} está ${m.label}`} aria-label={need ? `Abrir o bichinho: ${name} precisa de você` : `Abrir o bichinho (${m.label})`}>
      <PetCreature stage={s.pet.stage} form={s.pet.form} mood={m.id} size={16} />{need && <i className="fx-sb-pet-dot" aria-hidden="true" />}
    </button>
  );
}

/**
 * Barra de status do FORGE (rodapé de ponta a ponta, como no Orca): à esquerda os LIMITES das contas por provedor; à direita os agentes trabalhando agora
 * (abre o painel de status com executando · aguardando · falhas), os terminais ocupados, o estado da sincronização e o botão do painel Live.
 */
export default function StatusBar({ liveOpen = false, onToggleLive = null }) {
  const { terminals, maestro, workingIds, workspaces, error } = useStore();
  const [ui] = useUi();
  const { limits, now, refresh } = useLimits();
  const sums = (limits?.providers ?? []).map(providerSummary).filter((s) => s.accounts.length > 0);
  const s = useMemo(() => systemStatus({ sessions: terminals?.sessions, workingIds, tasks: maestro?.tasks, workspaces, max: terminals?.maxSessions, providers: terminals?.providers }), [terminals, workingIds, maestro, workspaces]);
  const offline = !!error || ui.status?.state === 'offline' || ui.status?.state === 'error';
  const tone = s.falhas ? 'failed' : s.aguardando ? 'waiting' : s.executando ? 'working' : 'idle';
  const label = (
    <span className="fx-sb-agents">
      <StatusGlyph state={tone} size={12} />
      <span>{s.executando ? `${s.executando} executando` : s.aguardando ? `${s.aguardando} aguardando` : s.falhas ? `${s.falhas} com falha` : 'ocioso'}</span>
    </span>
  );
  return (
    <footer className="fx-sb" aria-label="Barra de status">
      <div className="fx-sb-g" role="group" aria-label="Limites das contas">
        {sums.length ? sums.map((x) => <ProviderItem key={x.provider} sum={x} now={now} refresh={refresh} />) : <span className="fx-sb-i dim">{limits ? 'sem contas conectadas' : 'limites: —'}</span>}
      </div>
      <span className="grow" />
      <div className="fx-sb-g">
        <PetBadge />
        <span className="fx-sb-status"><SystemStatus limits={false} label={label} /></span>
        <span className="fx-sb-i dim" title={s.max ? `${s.ativos} de ${s.max} terminais em uso (todos os workspaces)` : `${s.ativos} terminais em uso`}><Icon name="terminal" size={13} />{s.max ? `${s.ativos}/${s.max}` : s.ativos}</span>
        <span className={`fx-sb-i${offline ? ' err' : ' dim'}`} role="status" title={offline ? 'Sem conexão com o servidor do FORGE' : 'Conectado ao servidor do FORGE'}><i className={`fx-sb-dot${offline ? ' off' : ''}`} aria-hidden="true" />{offline ? 'offline' : 'conectado'}</span>
        {onToggleLive && <button type="button" className={`fx-sb-i fx-sb-btn${liveOpen ? ' on' : ''}`} onClick={onToggleLive} aria-pressed={liveOpen} title={liveOpen ? 'Fechar o painel Live' : 'Abrir o painel Live: preview do localhost e a equipe em tempo real'}><Icon name="panel" size={13} />Live</button>}
      </div>
    </footer>
  );
}
