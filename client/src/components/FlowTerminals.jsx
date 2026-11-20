import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { usePrefs } from '../hooks.js';
import { paneState, pendingByPane } from '../env-view.js';
import { pickTerminalTab } from '../flow-terminals.js';
import { Icon } from './ui.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { TerminalPane } from './TerminalGrid.jsx';

const H_KEY = 'forge.flows.dockH', H_MIN = 160, H_DEF = 340;
const readH = () => { try { const n = Number(localStorage.getItem(H_KEY)); return Number.isFinite(n) && n >= H_MIN ? n : H_DEF; } catch { return H_DEF; } };

/** Estado do glifo de uma aba: o do terminal real; sem sessão (o servidor já a esqueceu) usa o status da etapa. */
function tabState(t, workingIds, pending) {
  if (t.session) return paneState(t.session, workingIds, pending);
  return t.stepStatus === 'failed' ? 'failed' : t.stepStatus === 'completed' ? 'done' : t.stepStatus === 'waiting' ? 'waiting' : t.stepStatus === 'running' ? 'working' : 'exited';
}

/**
 * Dock de terminais DENTRO da página Missões: uma aba por etapa que já tem terminal, com o terminal real (o mesmo xterm do Cockpit) embaixo do workflow, e uma aba
 * por Planejador aberto (criar por briefing; vale com ou sem missão selecionada). Fechado, vira uma faixa fina com o estado de cada agente. Esses terminais não
 * aparecem no Cockpit nem na barra lateral (App/flow-terminals.js).
 * Etapa de missão não tem botão de encerrar: encerrar é "Cancelar missão" (fechar uma etapa no meio a faria falhar). Só o Planejador (`closable`) se fecha aqui (`onCloseTab`).
 */
export default function FlowTerminals({ tabs, open, wanted, onWanted, onOpen, onClose, onCloseTab = null, stream, label = 'Terminais da missão' }) {
  const { terminals, maestro, workingIds } = useStore();
  const [prefs] = usePrefs();
  const [h, setH] = useState(readH), [max, setMax] = useState(false);
  const hRef = useRef(h); hRef.current = h;
  const waitingBy = useMemo(() => pendingByPane(maestro?.tasks), [maestro]);
  const pending = useMemo(() => new Set(waitingBy.keys()), [waitingBy]);
  const byRole = useMemo(() => Object.fromEntries((terminals?.roles ?? []).map((r) => [r.id, r])), [terminals?.roles]);
  const activeId = pickTerminalTab(tabs, wanted);
  const active = tabs.find((t) => t.terminalId === activeId) ?? null;
  const states = tabs.map((t) => ({ t, st: tabState(t, workingIds, pending) }));

  const onDown = useCallback((e) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture?.(e.pointerId);
    const y0 = e.clientY, h0 = hRef.current;
    document.body.classList.add('fx-resizing');
    const move = (ev) => setH(Math.max(H_MIN, Math.min(window.innerHeight - 220, h0 + (y0 - ev.clientY))));
    const up = () => {
      document.body.classList.remove('fx-resizing');
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      try { localStorage.setItem(H_KEY, String(hRef.current)); } catch { /* conveniência local */ }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }, []);
  const onKey = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const n = Math.max(H_MIN, Math.min(window.innerHeight - 220, h + (e.key === 'ArrowUp' ? 32 : -32)));
    setH(n); try { localStorage.setItem(H_KEY, String(n)); } catch { /* conveniência local */ }
  };

  if (!tabs.length) return null;

  if (!open) {
    return (
      <div className="fl-dock closed" role="region" aria-label={label}>
        <button type="button" className="fl-dock-bar" onClick={() => onOpen(null)} aria-label={`Abrir ${tabs.length === 1 ? 'o terminal' : `os ${tabs.length} terminais`}: ${label}`} title={`Abrir: ${label}`}>
          <Icon name="terminal" size={13} /><span className="fl-dock-t">{label}</span>
          <span className="fl-dock-dots">{states.map(({ t, st }) => <span key={t.terminalId} className={`fl-dock-dot st-${st}`} title={`${t.title}: ${st}`}><StatusGlyph state={st} size={11} /></span>)}</span>
          <span className="oc-pgrow" /><Icon name="chevronUp" size={13} />
        </button>
      </div>
    );
  }

  const sess = active?.session ?? null;
  return (
    <div className={`fl-dock open${max ? ' max' : ''}`} role="region" aria-label={label} style={max ? undefined : { height: h }}>
      {!max && <div className="fl-dock-gutter" role="separator" aria-orientation="horizontal" aria-label="Redimensionar o dock de terminais" tabIndex={0} onPointerDown={onDown} onKeyDown={onKey} onDoubleClick={() => { setH(H_DEF); try { localStorage.removeItem(H_KEY); } catch { /* ok */ } }} />}
      <div className="fl-dock-head">
        <div className="fl-dock-tabs" role="tablist" aria-label="Terminais abertos nesta página">
          {states.map(({ t, st }) => (
            <button key={t.terminalId} type="button" role="tab" aria-selected={t.terminalId === activeId} className={`fl-dock-tab st-${st}${t.kind === 'planner' ? ' is-planner' : ''}${t.terminalId === activeId ? ' on' : ''}`} onClick={() => onWanted(t.terminalId)}
              title={`${t.title}${t.workspaceName ? ` · ${t.workspaceName}` : ''}${t.session?.model ? ` · ${t.session.model}` : ''}`}>
              <StatusGlyph state={st} size={12} />{t.session && <ProviderLogo id={t.session.provider || 'claude'} size={12} />}<span>{t.title}</span>
            </button>
          ))}
        </div>
        <span className="oc-pgrow" />
        <button type="button" className="fx-ibtn sm" onClick={() => setMax((v) => !v)} aria-label={max ? 'Restaurar o dock de terminais' : 'Ampliar o dock de terminais'} title={max ? 'Restaurar' : 'Ampliar'}><Icon name="fit" size={13} /></button>
        <button type="button" className="fx-ibtn sm" onClick={onClose} aria-label="Recolher o dock de terminais" title="Recolher (os terminais continuam rodando)"><Icon name="chevronDown" size={13} /></button>
      </div>
      <div className="fl-dock-body">
        {sess && active.closable && onCloseTab ? (
          // Planejador: o usuário fecha quando quiser (o botão do próprio painel)
          <TerminalPane key={sess.id} session={sess} stream={stream} role={byRole[sess.role]} state={paneState(sess, workingIds, pending)} waiting={waitingBy.get(sess.id)} fontSize={prefs.fontSize} maximized={max} onMaximize={() => setMax((v) => !v)} onClose={() => onCloseTab(active)} />
        ) : sess ? (
          <TerminalPane key={sess.id} session={sess} stream={stream} role={byRole[sess.role]} state={paneState(sess, workingIds, pending)} waiting={waitingBy.get(sess.id)} fontSize={prefs.fontSize} maximized={max} onMaximize={() => setMax((v) => !v)} onClose={null} />
        ) : (
          <p className="fl-note" role="status">{active ? `O terminal da etapa “${active.title}” já foi encerrado e removido. O resumo da etapa está no painel do workflow.` : 'Nenhum terminal selecionado.'}</p>
        )}
      </div>
    </div>
  );
}
