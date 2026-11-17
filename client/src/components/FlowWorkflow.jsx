import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { edgePath } from './MissionWorkflow.jsx';
import { NOT_INFORMED } from '../flows-view.js';

// Workflow da missão v2: pipeline em fases (esquerda -> direita) de nós compactos, um por etapa, mais o nó de ENTREGA. Reaproveita o desenho do MissionWorkflow
// (classes mwf-*, conectores ortogonais medidos a partir dos nós reais); aqui a entrada é `buildWorkflow(flow, run)` de flows-view.js. Nada é simulado.
// Ramos paralelos = nós na mesma coluna. `waiting` ("aguardando você") ganha destaque próprio (classe fl-wait) além do âmbar do estado.

const TONE_CLASS = { idle: 'idle', work: 'working', wait: 'approval', ok: 'completed', err: 'attention', skip: 'idle', cancel: 'cancelled' };
const GAP = 48, ANCHOR = 16;
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pad2 = (n) => String(n).padStart(2, '0');

function ariaOf(n) {
  const parts = [`${n.kind === 'delivery' ? 'Entrega' : 'Etapa'} ${n.title}: ${n.stateLabel}`];
  if (n.agent) parts.push(`agente ${n.agent.roleLabel}`, `${n.agent.providerLabel} ${n.agent.model ?? NOT_INFORMED}`, `esforço ${n.agent.effort ?? NOT_INFORMED}`);
  if (n.waiting) parts.push('o agente espera a sua resposta no terminal');
  if (n.line) parts.push(n.line);
  return parts.join('; ');
}

function Node({ node, selected, onSelect, register, delay }) {
  const a = node.agent, running = node.state === 'running';
  const cls = ['mwf-node', `mwf-k-${node.kind}`, `mwf-s-${TONE_CLASS[node.tone] ?? 'idle'}`, node.state === 'skipped' ? 'fl-skipped' : '', node.waiting ? 'fl-wait' : '', selected ? 'on' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" ref={(el) => register(node.id, el)} data-node-id={node.id} className={cls} style={{ '--d': `${delay}ms` }}
      aria-pressed={selected} aria-label={ariaOf(node)} onClick={() => onSelect?.(node.id)}>
      <span className="mwf-row">
        <i className="mwf-dot" aria-hidden="true" />
        <span className="mwf-name">{node.kind === 'delivery' && <span className="mwf-kind" aria-hidden="true">▣ </span>}{node.title}</span>
        <span className="mwf-state">{node.stateLabel}</span>
      </span>
      {a && (
        <span className="mwf-meta">
          <span className="mwf-role">{a.roleLabel}</span>
          <span className="mwf-prov">{[a.providerLabel, a.model ?? NOT_INFORMED].join(' ')}</span>
          <span className="mwf-eff">esforço {a.effort ?? NOT_INFORMED}</span>
        </span>
      )}
      {node.line ? <span className={`mwf-task fl-line-${node.lineKind}${running ? ' live' : ''}`}>{node.line}{running && <i className="mwf-caret" aria-hidden="true">▍</i>}</span> : null}
    </button>
  );
}

export default function FlowWorkflow({ workflow, selectedId, onSelect }) {
  const nodes = workflow?.nodes ?? [], edges = workflow?.edges ?? [], columns = workflow?.columns ?? [];
  const viewport = useRef(null), stage = useRef(null), els = useRef(new Map());
  const [geom, setGeom] = useState({ w: 0, h: 0, rects: {} });
  const [entering, setEntering] = useState(true); // cascata só na montagem (a página remonta por missão)
  useEffect(() => { const t = setTimeout(() => setEntering(false), 900); return () => clearTimeout(t); }, []);
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

  // Mantém à vista o nó que espera você (ou o que trabalha), rolando só o viewport do workflow (nunca a página).
  const activeId = useMemo(() => (nodes.find((n) => n.state === 'waiting') ?? nodes.find((n) => n.state === 'running'))?.id ?? null, [nodes]);
  useEffect(() => {
    const vp = viewport.current, el = activeId ? els.current.get(activeId) : null;
    if (!vp || !el || vp.scrollWidth <= vp.clientWidth) return;
    const start = el.offsetLeft, end = el.offsetLeft + el.offsetWidth, view = vp.clientWidth;
    let left = vp.scrollLeft;
    if (end + GAP > left + view) left = end + GAP - view;
    if (start < left) left = Math.max(0, start - 16);
    if (left !== vp.scrollLeft) vp.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [activeId]);

  const paths = useMemo(() => edges.map((e) => {
    const a = geom.rects[e.from], b = geom.rects[e.to];
    if (!a || !b) return null;
    const x1 = a.x + a.w, y1 = a.y + ANCHOR, x2 = b.x, y2 = b.y + ANCHOR, mx = Math.round(x2 - GAP / 2) + 0.5;
    return { ...e, d: edgePath(x1, y1, x2 - 5, y2, mx), x2, y2 };
  }).filter(Boolean), [edges, geom]);

  if (!nodes.length) return <div className="mwf-root mwf-empty" role="group" aria-label="Workflow da missão"><p>Esta missão não tem etapas.</p></div>;

  return (
    <div className={`mwf-root fl-wf${entering ? ' mwf-enter' : ''}`} role="group" aria-label="Workflow da missão">
      <div className="mwf-viewport" ref={viewport}>
        <div className="mwf-stage" ref={stage}>
          <svg className="mwf-edges" width={geom.w} height={geom.h} aria-hidden="true" focusable="false">
            {paths.map((p) => (
              <g key={p.id} className={`mwf-edge mwf-e-${p.state}${p.reuse ? ' fl-reuse' : ''}`}>
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
                {c.parallel > 1 && <span className={`mwf-chip mwf-par${c.live > 1 ? ' live' : ''}`} title={`${c.parallel} etapas sem dependência entre si${c.live > 1 ? `; ${c.live} ativas agora` : ''}`}>×{c.parallel}</span>}
              </header>
              {c.list.map((n) => <Node key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} register={register} delay={(c.index - 1) * 40} />)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
