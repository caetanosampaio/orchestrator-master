import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Workflow da missão como PIPELINE EM FASES (esquerda -> direita), de nós COMPACTOS. Cada coluna é uma fase (Maestro/Planner, fases de tarefas por dependência, entrega);
// tarefas da mesma fase não dependem entre si (rodam em paralelo = ramos). Conectores ortogonais com curva suave, desenhados a partir das posições REAIS dos nós.
// Visual retro-terminal do Cockpit: preto, mono, SEM brilho; movimento discreto (ponto piscando, cursor, traço marchando só nos ramos ativos).
// Só apresenta `buildWorkflow(mission, ctx)`: nada é inventado, o que falta aparece como "não informado". Atualiza sozinho: é função pura do `workflow` recebido.

const STATE_LABEL = { idle: 'na fila', working: 'trabalhando', completed: 'concluída', attention: 'atenção', approval: 'aprovação', cancelled: 'cancelada' };
const KIND_LABEL = { mission: 'Missão', maestro: 'Maestro', planner: 'Planner', step: 'Etapa', task: 'Tarefa', delivery: 'Entrega' };
const KIND_GLYPH = { maestro: '❯', planner: '❯', delivery: '▣' };
const PHASE_KINDS = new Set(['step', 'task']);
const ACTIVE_ORDER = ['attention', 'approval', 'working'];
const GAP = 48; // folga entre colunas, igual ao `gap` de .mwf-stage (o cotovelo do conector fica no meio dela)
const ANCHOR = 16; // altura (px, a partir do topo do nó) onde os conectores entram e saem: o meio da linha do nome
const RADIUS = 8; // raio da curva dos cotovelos
const NOT_INFORMED = 'não informado';
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pad2 = (n) => String(n).padStart(2, '0');

/** Conector ortogonal com cotovelos arredondados: horizontal, desce/sobe no meio da folga e segue horizontal até o destino. Sem desnível, reta. */
export function edgePath(x1, y1, x2, y2, mx, r = RADIUS) {
  const dy = y2 - y1;
  if (Math.abs(dy) < 1) return `M ${x1} ${y1} H ${x2}`;
  const k = Math.min(r, Math.abs(dy) / 2, Math.max(0, (mx - x1) / 2)), s = Math.sign(dy);
  return `M ${x1} ${y1} H ${mx - k} Q ${mx} ${y1} ${mx} ${y1 + s * k} V ${y2 - s * k} Q ${mx} ${y2} ${mx + k} ${y2} H ${x2}`;
}

/** Linha de identidade do agente: papel · provedor modelo · esforço. Ausente aparece como "não informado" (nunca inventado). */
function agentLine(node) {
  const a = node.agent;
  if (!a) return null;
  const prov = [a.providerLabel, a.model ?? NOT_INFORMED].filter(Boolean).join(' ');
  return { role: a.role, prov, effort: a.effort ?? NOT_INFORMED };
}

function ariaOf(n) {
  const a = n.agent, parts = [`${KIND_LABEL[n.kind] ?? 'Etapa'} ${n.title}: ${STATE_LABEL[n.state] ?? n.state}`];
  if (a) parts.push(`agente ${a.name}${a.role ? `, ${a.role}` : ''}`, `${a.providerLabel ?? 'provedor'} ${a.model ?? NOT_INFORMED}`, `esforço ${a.effort ?? NOT_INFORMED}`);
  if (n.currentTask) parts.push(`tarefa atual: ${n.currentTask}`);
  if (n.kind === 'step' && n.stages) parts.push(`execução ${n.stages.exec.label}`, `verificações ${n.stages.verify.label}`);
  if (n.round) parts.push(`rodada ${n.round}`);
  if (n.attempts > 1) parts.push(`${n.attempts} tentativas`);
  if (n.uncertain) parts.push('resultado incerto');
  if (n.approvalId || (n.kind === 'task' && n.state === 'approval')) parts.push('aguarda a sua decisão');
  return parts.join('; ');
}

function Node({ node, selected, onSelect, register, delay }) {
  const a = node.agent, id = agentLine(node), working = node.state === 'working';
  // Agente nomeado quando há; senão o próprio título do nó (Entrega, etapa do ciclo sem agente próprio).
  const name = node.kind === 'task' ? (a?.name ?? node.subtitle ?? node.title) : node.kind === 'step' ? node.title : (a?.name && node.kind !== 'delivery' ? a.name : node.title);
  // Tarefa: trabalhando mostra a tarefa atual (com cursor); parada mostra o texto da tarefa (task) ou o resumo dos estágios (etapa do ciclo).
  const line = working ? node.currentTask : node.kind === 'task' ? node.title : node.kind === 'step' && node.stages ? `exec ${node.stages.exec.label} · verif ${node.stages.verify.label}` : node.subtitle;
  return (
    <button type="button" ref={(el) => register(node.id, el)} data-node-id={node.id}
      className={`mwf-node mwf-k-${node.kind} mwf-s-${node.state}${selected ? ' on' : ''}`} style={{ '--d': `${delay}ms` }}
      aria-pressed={selected} aria-label={ariaOf(node)} onClick={() => onSelect?.(node.id)}>
      <span className="mwf-row">
        <i className="mwf-dot" aria-hidden="true" />
        <span className="mwf-name">{KIND_GLYPH[node.kind] && <span className="mwf-kind" aria-hidden="true">{KIND_GLYPH[node.kind]} </span>}{name}</span>
        <span className="mwf-state">{STATE_LABEL[node.state] ?? node.state}</span>
      </span>
      {id && (
        <span className="mwf-meta">
          {id.role && <span className="mwf-role">{id.role}</span>}
          <span className="mwf-prov">{id.prov}</span>
          <span className="mwf-eff">esforço {id.effort}</span>
        </span>
      )}
      {line ? <span className={`mwf-task${working ? ' live' : ''}`}>{line}{working && <i className="mwf-caret" aria-hidden="true">▍</i>}</span> : null}
      {(node.uncertain || node.attempts > 1) && (
        <span className="mwf-flags">
          {node.uncertain && <span className="mwf-chip warn" title="Interrompida sem relatório final: os efeitos no workspace são desconhecidos">incerta</span>}
          {node.attempts > 1 && <span className="mwf-chip" title={`${node.attempts} tentativas`}>×{node.attempts}</span>}
        </span>
      )}
    </button>
  );
}

export default function MissionWorkflow({ workflow, selectedId, onSelect }) {
  // O nó "missão" do modelo não é desenhado: a missão já é o cabeçalho da página, e o pipeline começa no Maestro (ou Planner).
  const nodes = useMemo(() => (workflow?.nodes ?? []).filter((n) => n.kind !== 'mission'), [workflow]);
  const edges = useMemo(() => (workflow?.edges ?? []).filter((e) => e.from !== 'mission' && e.to !== 'mission'), [workflow]);
  const viewport = useRef(null), stage = useRef(null), els = useRef(new Map());
  const [geom, setGeom] = useState({ w: 0, h: 0, rects: {} });
  const [entering, setEntering] = useState(true); // cascata só na montagem (o pai remonta por missão)
  useEffect(() => { const t = setTimeout(() => setEntering(false), 900); return () => clearTimeout(t); }, []);

  // Colunas (fases) na ordem de `col`; dentro, a ordem de `row`.
  const columns = useMemo(() => {
    const by = new Map();
    for (const n of nodes) { const l = by.get(n.col) ?? []; l.push(n); by.set(n.col, l); }
    let phase = 0;
    return [...by.keys()].sort((a, b) => a - b).map((col, i) => {
      const list = by.get(col).slice().sort((a, b) => a.row - b.row), kind = list[0].kind;
      const label = PHASE_KINDS.has(kind) ? `Fase ${++phase}` : KIND_LABEL[kind] ?? 'Fase';
      const steps = list.filter((n) => PHASE_KINDS.has(n.kind));
      return { col, index: i + 1, label, list, parallel: steps.length, live: steps.filter((n) => n.state === 'working').length };
    });
  }, [nodes]);

  const register = (id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); };

  // Mede os nós (posição relativa ao stage) para desenhar os conectores; só atualiza o estado quando algo mudou de fato.
  useLayoutEffect(() => {
    const st = stage.current; if (!st) return undefined;
    const measure = () => {
      const rects = {};
      for (const [id, el] of els.current) rects[id] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      const next = { w: st.scrollWidth, h: st.scrollHeight, rects };
      setGeom((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro) { ro.observe(st); for (const el of els.current.values()) ro.observe(el); }
    return () => ro?.disconnect();
  }, [workflow]);

  // Mantém o nó que pede atenção à vista, rolando só o viewport do workflow (nunca a página).
  const activeId = useMemo(() => ACTIVE_ORDER.map((s) => nodes.find((n) => n.state === s)).find(Boolean)?.id ?? null, [nodes]);
  useEffect(() => {
    const vp = viewport.current, el = activeId ? els.current.get(activeId) : null;
    if (!vp || !el || vp.scrollWidth <= vp.clientWidth) return;
    // rolagem MÍNIMA: só o bastante para o nó caber (com folga para a fase seguinte); o começo do pipeline fica à vista sempre que possível
    const start = el.offsetLeft, end = el.offsetLeft + el.offsetWidth, view = vp.clientWidth;
    let left = vp.scrollLeft;
    if (end + GAP > left + view) left = end + GAP - view;
    if (start < left) left = Math.max(0, start - 16);
    if (left !== vp.scrollLeft) vp.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [activeId]);

  const paths = useMemo(() => edges.map((e) => {
    const a = geom.rects[e.from], b = geom.rects[e.to];
    if (!a || !b) return null;
    // âncora na linha do nome (não no centro): nós vizinhos na mesma linha ficam ligados por um traço reto, mesmo com alturas diferentes
    const x1 = a.x + a.w, y1 = a.y + ANCHOR, x2 = b.x, y2 = b.y + ANCHOR, mx = Math.round(x2 - GAP / 2) + 0.5;
    return { ...e, d: edgePath(x1, y1, x2 - 5, y2, mx), x2, y2, mx };
  }).filter(Boolean), [edges, geom]);

  if (!nodes.length) return <div className="mwf-root mwf-empty" role="group" aria-label="Workflow da missão"><p>Sem etapas ainda.</p></div>;

  return (
    <div className={`mwf-root${entering ? ' mwf-enter' : ''}`} role="group" aria-label="Workflow da missão">
      <div className="mwf-viewport" ref={viewport}>
        <div className="mwf-stage" ref={stage}>
          <svg className="mwf-edges" width={geom.w} height={geom.h} aria-hidden="true" focusable="false">
            {paths.map((p) => (
              <g key={p.id} className={`mwf-edge mwf-e-${p.state}`}>
                <path d={p.d} />
                <path className="mwf-arrow" d={`M ${p.x2} ${p.y2} l -5 -3 v 6 z`} />
              </g>
            ))}
          </svg>
          {columns.map((c) => (
            <section key={c.col} className="mwf-col" aria-label={c.label}>
              <header className="mwf-col-h">
                <span className="mwf-col-n">{pad2(c.index)}</span>
                <span className="mwf-col-l">{c.label}</span>
                {c.parallel > 1 && <span className={`mwf-chip mwf-par${c.live > 1 ? ' live' : ''}`} title={`${c.parallel} tarefas sem dependência entre si${c.live > 1 ? `; ${c.live} trabalhando agora` : ''}`}>×{c.parallel}</span>}
              </header>
              {c.list.map((n) => <Node key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} register={register} delay={(c.index - 1) * 40} />)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
