import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { edgePathDown, NOT_INFORMED } from '../flows-view.js';
import StatusGlyph from './StatusGlyph.jsx';
import ProviderLogo from './ProviderLogo.jsx';
import { toneGlyph } from './FlowHeader.jsx';

// Workflow da missão v2: pipeline em fases de CIMA PARA BAIXO, um cartão por etapa mais o nó de ENTREGA, na linguagem das superfícies do Cockpit (cartão grafite, contorno
// fino, glifo de estado do shell). À esquerda, uma trilha discreta numera as fases (o nó de Entrega leva a bandeira de chegada). Os conectores saem da base de cada nó e
// descem até o topo dos que dependem dele, medidos a partir dos nós reais; ficam neutros e acendem no ramo concluído ou ativo. A entrada é `buildWorkflow(flow, run)` de
// flows-view.js. Nada é simulado. Ramos paralelos = nós lado a lado na mesma fase. `waiting` ("aguardando você") ganha contorno quente próprio (classe fl-wait).
// Os nós mantêm a classe `mwf-node` (o nome do contrato com os testes); o desenho é todo de flows.css, escopado em .fl-wf.

const GAP = 44; // altura do corredor entre fases (igual ao `gap` de .fl-wf .mwf-stage em flows.css): o conector anda na horizontal no meio dele
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Selo curto de integração por etapa (modo Git). `none` (modo pasta, run antigo, etapa ainda sem resultado) não mostra nada; o rótulo completo vai para o leitor de tela.
const INT_BADGE = { pending: 'pendente', integrating: 'integrando', integrated: 'integrada', empty: 'sem alterações', conflict: 'conflito', blocked: 'bloqueada', error: 'erro' };
const intBadge = (n) => (n.kind === 'step' && INT_BADGE[n.integration?.state] ? { text: INT_BADGE[n.integration.state], tone: n.integration.tone, label: n.integration.label } : null);

const svg = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };
const FlagIcon = ({ size = 12 }) => <svg {...svg} width={size} height={size}><path d="M6 21V3.5" /><path d="M6 4h12l-3 4.5 3 4.5H6z" fill="currentColor" fillOpacity=".35" /></svg>; // chegada: a Entrega
const MergeIcon = () => <svg {...svg} width={11} height={11}><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8M8 6c5 0 8 2 8 4" /></svg>;

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
  const a = node.agent, running = node.state === 'running', badge = intBadge(node), delivery = node.kind === 'delivery';
  // integração travada ou entrega pronta para integrar também pedem você: contorno quente (fl-ask) sem recolorir o estado da etapa (que pode estar "concluída")
  const asks = !node.waiting && (badge?.tone === 'wait' || (delivery && node.state === 'ready_to_integrate'));
  const cls = ['mwf-node', 'fl-node', `fl-k-${node.kind}`, `fl-t-${node.tone ?? 'idle'}`, node.state === 'skipped' ? 'fl-skipped' : '', node.waiting ? 'fl-wait' : '', asks ? 'fl-ask' : '', running ? 'is-running' : '', selected ? 'on' : ''].filter(Boolean).join(' ');
  const model = [a?.model ?? `modelo ${NOT_INFORMED}`, `esforço ${a?.effort ?? NOT_INFORMED}`].join(' · ');
  return (
    <button type="button" ref={(el) => register(node.id, el)} data-node-id={node.id} className={cls} style={{ '--d': `${delay}ms` }}
      aria-pressed={selected} aria-label={ariaOf(node)} onClick={() => onSelect?.(node.id)}>
      {running && <i className="fl-node-meter" aria-hidden="true" />}
      <span className="fl-node-h">
        {delivery ? <span className="fl-flag" aria-hidden="true"><FlagIcon size={13} /></span> : <StatusGlyph state={toneGlyph(node.tone)} size={14} />}
        <span className="fl-node-t">{node.title}</span>
        {delivery && <StatusGlyph state={toneGlyph(node.tone)} size={14} />}
      </span>
      {a && (
        <span className="fl-node-agent" title={`${a.providerLabel} · ${model}`}>
          <ProviderLogo id={a.provider} size={12} />
          <span className="fl-node-role">{a.roleLabel}</span>
          <span className="fl-node-model">{a.provider === 'claude' || a.provider === 'codex' ? model : `${a.providerLabel} · ${model}`}</span>
        </span>
      )}
      {node.line ? <span className={`fl-node-line fl-line-${node.lineKind}${running ? ' live' : ''}`}>{node.line}{running && <i className="fl-caret" aria-hidden="true" />}</span> : null}
      <span className="fl-node-foot">
        <span className="fl-node-state">{node.stateLabel}</span>
        {node.usage && <span className="fl-node-tok" title={`${node.usage.title}${node.usage.account ? ` | Conta: ${node.usage.account}` : ''}${node.usage.live ? '' : ' | Último consumo gravado (o terminal da etapa já fechou)'} | O limite da conta (barra inferior) já conta este gasto.`}>{node.usage.tokens} tokens</span>}
        {badge && <span className={`fl-int fl-t-${badge.tone}`} title={`Integração: ${badge.label}`}><MergeIcon />{badge.text}</span>}
      </span>
    </button>
  );
}

export default function FlowWorkflow({ workflow, selectedId, onSelect }) {
  const nodes = workflow?.nodes ?? [], edges = workflow?.edges ?? [], columns = workflow?.columns ?? [];
  const viewport = useRef(null), stage = useRef(null), els = useRef(new Map());
  const [geom, setGeom] = useState({ w: 0, h: 0, rects: {} });
  const [entering, setEntering] = useState(true); // entrada só na montagem (a página remonta por missão)
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

  // conector: desce da base do pai (porta), anda no corredor com curvas suaves e chega ao topo do filho (porta)
  const paths = useMemo(() => edges.map((e) => {
    const a = geom.rects[e.from], b = geom.rects[e.to];
    if (!a || !b) return null;
    const x1 = Math.round(a.x + a.w / 2) + 0.5, y1 = a.y + a.h, x2 = Math.round(b.x + b.w / 2) + 0.5, y2 = b.y, my = Math.round(y2 - GAP / 2) + 0.5;
    return { ...e, d: edgePathDown(x1, y1 + 3, x2, y2 - 3, my, 12), x1, y1, x2, y2 };
  }).filter(Boolean), [edges, geom]);

  if (!nodes.length) return <div className="mwf-root fl-wf mwf-empty" role="group" aria-label="Workflow da missão"><p>Esta missão não tem etapas.</p></div>;

  return (
    <div className={`mwf-root fl-wf${entering ? ' fl-enter' : ''}`} role="group" aria-label="Workflow da missão">
      <div className="mwf-viewport" ref={viewport}>
        <div className="mwf-stage" ref={stage}>
          <svg className="mwf-edges" width={geom.w} height={geom.h} aria-hidden="true" focusable="false">
            {paths.map((p) => (
              <g key={p.id} className={`fl-edge fl-e-${p.state}${p.reuse ? ' fl-reuse' : ''}`}>
                <path d={p.d} />
                <circle className="fl-port" cx={p.x1} cy={p.y1} r="2.5" />
                <circle className="fl-port" cx={p.x2} cy={p.y2} r="2.5" />
              </g>
            ))}
          </svg>
          {columns.map((c) => {
            const steps = c.list.filter((n) => n.kind === 'step'), last = !steps.length;
            const done = last ? c.list.every((n) => n.state === 'completed') : steps.every((n) => n.state === 'completed');
            const live = c.list.some((n) => n.state === 'running' || n.state === 'waiting');
            const tip = last ? 'Entrega' : `${c.label}${c.parallel > 1 ? `: ${c.parallel} etapas em paralelo${c.live > 1 ? `, ${c.live} ativas agora` : ''}` : ''}`;
            return (
              <section key={c.col} className={`fl-phase${last ? ' is-end' : ''}${done ? ' is-done' : ''}${live ? ' is-live' : ''}`} aria-label={c.label}>
                <div className="fl-rail" aria-hidden="true" title={tip}>
                  <span className="fl-rail-n">{last ? <FlagIcon size={11} /> : c.index}</span>
                  {c.parallel > 1 && <span className={`fl-rail-par${c.live > 1 ? ' live' : ''}`}>×{c.parallel}</span>}
                </div>
                <div className="fl-phase-nodes">
                  {c.list.map((n) => <Node key={n.id} node={n} selected={n.id === selectedId} onSelect={onSelect} register={register} delay={(c.index - 1) * 50} />)}
                </div>
                <span className="fl-rail-end" aria-hidden="true" />
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
