import React from 'react';
import { AGENT_SIZE, agentPath } from '../agent-mark.mjs';
const AGENT_D = agentPath();

import { STATUS, statusLabel } from '../labels.js';
export { STATUS, statusLabel };

export const Status = ({ value, masc, label }) => (
  <span className={`status s-${value}`}><i />{label ?? statusLabel(value, masc)}</span>
);

export const Btn = ({ kind = '', ...p }) => <button className={`btn ${kind}`} {...p} />;

// Glifo de cada estado: a forma (não só a cor) diz o que é. Ver .glyph em styles.css.
export const GLYPH = { active: 'g-run', idle: 'g-ring', live: 'g-ring', awaiting: 'g-diamond', disconnected: 'g-dash', unavailable: 'g-dash', error: 'g-tri', done: 'g-ok', interrupted: 'g-sq', queued: 'g-dring' };

export const fmtTime = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

/** Último incidente de gravação do servidor (/api/state.persistenceIncident): só o código do erro, quando começou, quantas falhas e se a gravação já voltou. */
export const PersistenceNote = ({ incident }) => (incident ? (
  <span>
    Incidente de gravação: erro <b>{incident.error}</b> desde {fmtTime(incident.failedAt)} · {incident.failures} {incident.failures === 1 ? 'falha' : 'falhas'} ·{' '}
    {incident.recoveredAt ? `gravação restabelecida em ${fmtTime(incident.recoveredAt)}` : 'a gravação ainda não voltou'}
  </span>
) : null);

// Ícones de traço único (24x24), usados em toda a interface. Decorativos (aria-hidden): o texto ao lado sempre diz o mesmo.
const ICONS = {
  // Configurações (traço 1.6, 24x24, no mesmo desenho dos demais): IAs, contas, golem, roteamento, skills, orquestração, worktrees e visualização
  cpu: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9.5 9.5h5v5h-5zM9 1.5V4M15 1.5V4M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5',
  key: 'M15 15a6 6 0 1 0-5.66-4L3 17.34V21h3.5v-2.2h2.2v-2.2h2.2l1.3-1.3A6 6 0 0 0 15 15zM16.5 7.5h.01',
  flame: 'M12 21.5c4 0 6.8-2.7 6.8-6.4 0-3.5-2.5-5.4-3.7-8-.4 1.7-1.4 2.7-2.7 3.2.3-3-.8-5.8-3.4-7.3.2 3.5-2 5.6-3.4 7.7A7.6 7.6 0 0 0 5.2 15c0 3.8 2.8 6.5 6.8 6.5zM12 21.5c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.5-2.5 2.2-4 .9 1.2 3.4 2.1 3.4 4 0 1.6-1.1 2.8-2.8 2.8z',
  route: 'M6 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 18.5H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5',
  book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6M9 11h4',
  network: 'M12 8.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM5 21a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM19 21a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM12 8.5v3.5M12 12l-5 4M12 12l5 4',
  branch: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  menu: 'M4 7h16M4 12h16M4 17h16', close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', send: 'M12 19V5M5 12l7-7 7 7', check: 'M5 12l5 5 9-10',
  chevronUp: 'M6 15l6-6 6 6', chevronDown: 'M6 9l6 6 6-6', chevronRight: 'M9 6l6 6-6 6', chevronsUpDown: 'M8 9l4-4 4 4M8 15l4 4 4-4', stop: 'M7 7h10v10H7z', alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', panel: 'M4 5h16v14H4zM9 5v14', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6', xCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6', alertCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5M12 16h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', paperclip: 'M20 12l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8', play: 'M8 5.5l11 6.5-11 6.5z', arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', cockpit: 'M4 4h7v8H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 14h7v6H4z',
  missions: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', agents: 'M12 4a3.2 3.2 0 1 0 0 6.4A3.2 3.2 0 0 0 12 4zM5 20a7 7 0 0 1 14 0',
  workspace: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', folderOpen: 'M3 18V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2M3 18l2.6-7.2A2 2 0 0 1 7.5 9.5H21a1 1 0 0 1 1 1.3L19.7 17a2 2 0 0 1-1.9 1.3H4a1 1 0 0 1-1-.3z', activity: 'M3 12h4l3-8 4 16 3-8h4',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  planner: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17c7 0 2-10 8-10', executor: 'M4 6l6 6-6 6M12 18h8',
  gate: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4', queue: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  task: 'M5 5h14v14H5zM9 12l2 2 4-4', minus: 'M5 12h14', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', copy: 'M9 9h10v10H9zM5 15V5h10',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4', layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  restore: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5', sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  pencil: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17zM14 7l3 3',
  briefcase: 'M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5', external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18',
};
export const Icon = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICONS[name]} /></svg>
);

/** Três barras que sobem e descem: há saída sendo produzida AGORA (dado real: a saída do pane cresceu na última consulta). Parada sob prefers-reduced-motion. */
/** Glifo de atividade da sidebar: 3 células verticais; um ponto brilhante desce topo → meio → base em passos (animação em oc.css). Decorativo: o estado real vai no aria-label da linha. */
export const Scan = () => <span className="oc-scan" aria-hidden="true"><i /><i /><i /></span>;
/** Ícone de agente (pixel art) da sidebar: herda a cor do texto (currentColor), que a linha define pelo estado. Decorativo. */
export const AgentMark = ({ size = 16 }) => <svg className="tp-mark" width={size} height={size} viewBox={`0 0 ${AGENT_SIZE} ${AGENT_SIZE}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" focusable="false"><path d={AGENT_D} /></svg>;
/** Estrela de "executando" (laranja da marca do Claude, gira devagar): o mesmo ícone na sidebar e nos terminais. */
export const WorkStar = ({ size = 16 }) => <svg className="wstar" width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M9 1.8v14.4M1.8 9h14.4M3.9 3.9l10.2 10.2M14.1 3.9L3.9 14.1" /></svg>;
export const Equalizer = () => <span className="oc-eq" aria-hidden="true"><i /><i /><i /></span>;
