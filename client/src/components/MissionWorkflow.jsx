import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Workflow da missão como PIPELINE EM FASES (esquerda -> direita). Cada coluna é uma fase numerada (missão, planner, fases de etapas por dependência, entrega);
// etapas da mesma fase não dependem entre si (podem rodar em paralelo). Conectores ortogonais desenhados a partir das posições REAIS dos cartões.
// Visual alinhado ao Overclock: sem brilho; movimento mecânico (piscar, cursor, traço marchando, equalizador, carimbo). Só apresenta `buildWorkflow(mission)`: nada é inventado.

const STATE_LABEL = { idle: 'na fila', working: 'trabalhando', completed: 'concluída', attention: 'atenção', approval: 'aprovação', cancelled: 'cancelada' };
const KIND_LABEL = { mission: 'Missão', planner: 'Planner', step: 'Etapa', delivery: 'Entrega' };
const KIND_GLYPH = { mission: '◎', planner: '❯', delivery: '▣' };
const ACTIVE_ORDER = ['attention', 'approval', 'working'];
const GAP = 56; // folga entre colunas, igual ao `gap` de .mwf-stage (o cotovelo do conector fica no meio dela)
const ANCHOR = 19.5; // altura (px, a partir do topo do cartão) onde os conectores entram e saem: o meio da linha do ponto de estado
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pad2 = (n) => String(n).padStart(2, '0');

/** Linha de estágio no estilo terminal: `exec  executando▍` / `verif verificada`. */
function StageLine({ name, stage }) {
  const st = stage?.state ?? 'idle';
  return (
    <span className={`mwf-stage-l mwf-g-${st}`}>
      <span className="mwf-stage-g" aria-hidden="true">{st === 'working' ? <span className="mwf-eq"><i /><i /><i /></span> : st === 'completed' ? '✓' : st === 'attention' ? '✕' : '·'}</span>
      <span className="mwf-stage-n">{name}</span>
      <span className="mwf-stage-v">{stage?.label ?? '—'}{st === 'working' && <i className="mwf-caret" aria-hidden="true">▍</i>}</span>
    </span>
  );
}

function ariaOf(n) {
  const parts = [`${KIND_LABEL[n.kind] ?? 'Etapa'} ${n.title}: ${STATE_LABEL[n.state] ?? n.state}`];
  if (n.kind === 'step' && n.stages) parts.push(`execução ${n.stages.exec.label}`, `verificações ${n.stages.verify.label}`);
  if (n.round) parts.push(`rodada ${n.round}`);
  if (n.attempts > 1) parts.push(`${n.attempts} tentativas`);
  if (n.uncertain) parts.push('resultado incerto');
  if (n.approvalId) parts.push('aguarda a sua decisão');
  return parts.join('; ');
}

function Node({ node, selected, onSelect, register, delay }) {
  // Carimbo: só quando o nó MUDA para concluído depois de montado (nunca na montagem nem a cada render).
  const prev = useRef(node.state);
  const [stamp, setStamp] = useState(false);
  useEffect(() => {
    if (prev.current !== node.state) { if (node.state === 'completed') setStamp(true); prev.current = node.state; }
  }, [node.state]);
  return (
    <button type="button" ref={(el) => register(node.id, el)} data-node-id={node.id}
      className={`mwf-node mwf-k-${node.kind} mwf-s-${node.state}${selected ? ' on' : ''}`} style={{ '--d': `${delay}ms` }}
      aria-pressed={selected} aria-label={ariaOf(node)} onClick={() => onSelect?.(node.id)}>
      <span className="mwf-row">
        <i className="mwf-dot" aria-hidden="true" />
        <span className={`mwf-state${stamp ? ' stamp' : ''}`} onAnimationEnd={() => setStamp(false)}>{STATE_LABEL[node.state] ?? node.state}</span>
        <span className="mwf-chips">
          {node.uncertain && <span className="mwf-chip warn" title="Interrompida sem relatório final: os efeitos no workspace são desconhecidos">incerta</span>}
          {node.attempts > 1 && <span className="mwf-chip" title={`${node.attempts} tentativas`}>×{node.attempts}</span>}
          {node.round ? <span className="mwf-chip" title={`Rodada ${node.round}`}>R{node.round}</span> : null}
        </span>
      </span>
      <span className="mwf-title">{KIND_GLYPH[node.kind] && <span className="mwf-kind" aria-hidden="true">{KIND_GLYPH[node.kind]} </span>}<span className="mwf-title-t">{node.title}</span></span>
      {node.subtitle && <span className="mwf-sub">{node.subtitle}</span>}
      {node.kind === 'step' && node.stages && <span className="mwf-stages"><StageLine name="exec" stage={node.stages.exec} /><StageLine name="verif" stage={node.stages.verify} /></span>}
      {node.state === 'approval' && <span className="mwf-gate">◆ gate · aguarda a sua decisão</span>}
      {node.state === 'working' && <i className="mwf-meter" aria-hidden="true" />}
    </button>
  );
}

export default function MissionWorkflow({ workflow, selectedId, onSelect }) {
  // O nó "missão" do modelo não é desenhado: a missão já é o cabeçalho da página, e o pipeline começa no Planner.
  const nodes = useMemo(() => (workflow?.nodes ?? []).filter((n) => n.kind !== 'mission'), [workflow]);
  const edges = useMemo(() => (workflow?.edges ?? []).filter((e) => e.from !== 'mission' && e.to !== 'mission'), [workflow]);
  const viewport = useRef(null), stage = useRef(null), els = useRef(new Map());
  const [geom, setGeom] = useState({ w: 0, h: 0, rects: {} });
  const [entering, setEntering] = useState(true); // cascata só na montagem (o pai remonta por missão)
  useEffect(() => { const t = setTimeout(() => setEntering(false), 1100); return () => clearTimeout(t); }, []);

  // Colunas (fases) na ordem de `col`; dentro, a ordem de `row`.
  const columns = useMemo(() => {
    const by = new Map();
    for (const n of nodes) { const l = by.get(n.col) ?? []; l.push(n); by.set(n.col, l); }
    let phase = 0;
    return [...by.keys()].sort((a, b) => a - b).map((col, i) => {
      const list = by.get(col).slice().sort((a, b) => a.row - b.row), kind = list[0].kind;
      const label = kind === 'mission' ? 'Missão' : kind === 'planner' ? 'Planner' : kind === 'delivery' ? 'Entrega' : `Fase ${++phase}`;
      const steps = list.filter((n) => n.kind === 'step');
      return { col, index: i + 1, label, list, parallel: steps.length, live: steps.filter((n) => n.state === 'working').length };
    });
  }, [nodes]);

  const register = (id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); };

  // Mede os cartões (posição relativa ao stage) para desenhar os conectores; só atualiza o estado quando algo mudou de fato.
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
    // âncora na linha do cabeçalho do cartão (não no centro): cartões vizinhos na mesma linha ficam ligados por um traço reto, mesmo com alturas diferentes
    const x1 = a.x + a.w, y1 = a.y + ANCHOR, x2 = b.x, y2 = b.y + ANCHOR, mx = Math.round(x2 - GAP / 2) + 0.5;
    return { ...e, d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2 - 5}`, x2, y2, mx };
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
                <path className="mwf-arrow" d={`M ${p.x2} ${p.y2} l -6 -3.5 v 7 z`} />
                {p.state === 'wait' && <rect className="mwf-edge-gate" x={p.mx - 3.5} y={p.y2 - 3.5} width="7" height="7" transform={`rotate(45 ${p.mx} ${p.y2})`} />}
              </g>
            ))}
          </svg>
          {columns.map((c) => (
            <section key={c.col} className="mwf-col" aria-label={c.label}>
              <header className="mwf-col-h">
                <span className="mwf-col-n">{pad2(c.index)}</span>
                <span className="mwf-col-l">{c.label}</span>
                {c.parallel > 1 && <span className={`mwf-chip mwf-par${c.live > 1 ? ' live' : ''}`} title={`${c.parallel} etapas sem dependência entre si${c.live > 1 ? `; ${c.live} trabalhando agora` : ''}`}>×{c.parallel}</span>}
              </header>
              {c.list.map((n) => <Node key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} register={register} delay={(c.index - 1) * 50} />)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
