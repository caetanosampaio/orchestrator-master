import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { edgePathDown, NOT_INFORMED } from '../flows-view.js';

// Workflow da missão v2: pipeline em fases de CIMA PARA BAIXO, com nós compactos, um por etapa, mais o nó de ENTREGA. Reaproveita o estilo do MissionWorkflow
// (classes mwf-*); os conectores saem da base de cada nó e descem até o topo dos que dependem dele, medidos a partir dos nós reais. A entrada é `buildWorkflow(flow, run)`
// de flows-view.js. Nada é simulado. Ramos paralelos = nós lado a lado na mesma fase (mesma linha). `waiting` ("aguardando você") ganha destaque próprio (classe fl-wait) além do âmbar do estado.

const TONE_CLASS = { idle: 'idle', work: 'working', wait: 'approval', ok: 'completed', err: 'attention', skip: 'idle', cancel: 'cancelled' };
const GAP = 44; // altura do corredor entre fases (igual ao `gap` de .fl-wf .mwf-stage em flows.css): o conector anda na horizontal no meio dele
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pad2 = (n) => String(n).padStart(2, '0');
// Selo curto de integração por etapa (modo Git). `none` (modo pasta, run antigo, etapa ainda sem resultado) não mostra nada; o rótulo completo vai para o leitor de tela.
const INT_BADGE = { pending: 'pendente', integrating: 'integrando', integrated: 'integrada', empty: 'sem alterações', conflict: 'conflito', blocked: 'bloqueada', error: 'erro' };
const intBadge = (n) => (n.kind === 'step' && INT_BADGE[n.integration?.state] ? { text: INT_BADGE[n.integration.state], tone: n.integration.tone, label: n.integration.label } : null);

function ariaOf(n) {
  const parts = [`${n.kind === 'delivery' ? 'Entrega' : 'Etapa'} ${n.title}: ${n.stateLabel}`];
  if (n.agent) parts.push(`agente ${n.agent.roleLabel}`, `${n.agent.providerLabel} ${n.agent.model ?? NOT_INFORMED}`, `esforço ${n.agent.effort ?? NOT_INFORMED}`);
  if (n.waiting && !n.unconfirmed) parts.push('o agente espera a sua resposta no terminal'); // a etapa sem confirmação já diz o que fazer na própria linha
  const b = intBadge(n);
  if (b) parts.push(`integração: ${b.label}`);
  if (n.line) parts.push(n.line);
  return parts.join('; ');
}

function Node({ node, selected, onSelect, register, delay }) {
  const a = node.agent, running = node.state === 'running', badge = intBadge(node);
  // integração travada ou entrega pronta para integrar também pedem você: borda âmbar (fl-ask) sem recolorir o estado da etapa (que pode estar "concluída")
  const asks = !node.waiting && (badge?.tone === 'wait' || (node.kind === 'delivery' && node.state === 'ready_to_integrate'));
  const cls = ['mwf-node', `mwf-k-${node.kind}`, `mwf-s-${TONE_CLASS[node.tone] ?? 'idle'}`, node.state === 'skipped' ? 'fl-skipped' : '', node.waiting ? 'fl-wait' : '', asks ? 'fl-ask' : '', selected ? 'on' : ''].filter(Boolean).join(' ');
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
      {badge && <span className={`fl-int fl-t-${badge.tone}`} title={badge.label}>integração: {badge.text}</span>}
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

  // Mantém à vista o nó que espera você (ou o que trabalha): rola só o mínimo necessário, e só quando esse nó muda.
  const activeId = useMemo(() => (nodes.find((n) => n.state === 'waiting') ?? nodes.find((n) => n.integration?.needsAction) ?? nodes.find((n) => n.state === 'running'))?.id ?? null, [nodes]);
  useEffect(() => {
    const el = activeId ? els.current.get(activeId) : null;
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [activeId]);

  const paths = useMemo(() => edges.map((e) => {
    const a = geom.rects[e.from], b = geom.rects[e.to];
    if (!a || !b) return null;
    const x1 = Math.round(a.x + a.w / 2) + 0.5, y1 = a.y + a.h, x2 = Math.round(b.x + b.w / 2) + 0.5, y2 = b.y, my = Math.round(y2 - GAP / 2) + 0.5;
    return { ...e, d: edgePathDown(x1, y1, x2, y2 - 5, my), x2, y2 };
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
                <path className="mwf-arrow" d={`M ${p.x2} ${p.y2} l -3 -5 h 6 z`} />
              </g>
            ))}
          </svg>
          {columns.map((c) => (
            <section key={c.col} className="mwf-col fl-phase" aria-label={c.label}>
              <header className="mwf-col-h fl-phase-h">
                <span className="mwf-col-n">{pad2(c.index)}</span>
                <span className="mwf-col-l">{c.label}</span>
                {c.parallel > 1 && <span className={`mwf-chip mwf-par${c.live > 1 ? ' live' : ''}`} title={`${c.parallel} etapas sem dependência entre si${c.live > 1 ? `; ${c.live} ativas agora` : ''}`}>×{c.parallel}</span>}
              </header>
              <div className="fl-phase-nodes">
                {c.list.map((n) => <Node key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} register={register} delay={(c.index - 1) * 40} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
