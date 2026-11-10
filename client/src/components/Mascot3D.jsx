import React, { useEffect, useRef } from 'react';
import { PARTS, UNITS, pose } from '../mascot-3d.js';

/**
 * Bonequinho 3D (blocos em CSS 3D: corpo, braços, quatro pernas e dois olhos), na cor `--pm` herdada do pai. Não é imagem: cada peça é um cubo com seis faces sombreadas (os olhos são só a face da frente) e o conjunto gira no espaço.
 * Balança sozinho de lado a lado e pode ser ARRASTADO com o mouse ou o dedo (gira e volta devagar); as pernas dão passos ao passar o mouse na equipe (teams.css).
 * Um único laço de animação (a ~30 quadros por segundo) serve todos os bonecos e só mexe nos que estão visíveis; com "Animações reduzidas" fica numa pose parada de três quartos (o arrasto continua funcionando).
 */
const reducedMotion = () => { try { return document.documentElement.dataset.motion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const transformOf = (p, off, u) => `translateY(${(p.bob * u).toFixed(2)}px) rotateX(${(p.rx + off.rx).toFixed(2)}deg) rotateY(${(p.ry + off.ry).toFixed(2)}deg)`;

const items = new Set(); let raf = 0, last = 0;
function loop(now) {
  raf = 0; if (!items.size) return;
  if (now - last >= 33 && !document.hidden) {
    last = now;
    for (const it of items) if (it.visible) it.frame(now / 1000);
  }
  raf = requestAnimationFrame(loop);
}
const start = (it) => { items.add(it); if (!raf) raf = requestAnimationFrame(loop); };
const stop = (it) => { items.delete(it); if (!items.size && raf) { cancelAnimationFrame(raf); raf = 0; } };

function Cuboid({ p, u }) {
  const cx = (p.x + p.w / 2 - UNITS.w / 2) * u, cy = (p.y + p.h / 2 - UNITS.h / 2) * u, cz = p.z * u;
  return (
    <div className={`m3-c m3-${p.kind}${p.leg ? ` m3-leg-${p.leg}` : ''}`} style={{ '--w': `${p.w * u}px`, '--h': `${p.h * u}px`, '--d': `${p.d * u}px`, transform: `translate3d(${cx}px, ${cy}px, ${cz}px)` }}>
      <div className="m3-in">{p.kind === 'eye' ? <i className="ft" /> : <><i className="ft" /><i className="bk" /><i className="lf" /><i className="rt" /><i className="tp" /><i className="bt" /></>}</div>
    </div>
  );
}

export default function Mascot3D({ size = 40, label = null, className = '' }) {
  const u = (size * 1.25) / UNITS.w; // `size` é a mesma medida do desenho 2D antigo: a largura é size x 1,25
  const rig = useRef(null), root = useRef(null), phase = useRef(Math.random() * Math.PI * 2), off = useRef({ ry: 0, rx: 0 }), drag = useRef(null), reduced = useRef(false);

  useEffect(() => {
    const el = rig.current, box = root.current; if (!el || !box) return undefined;
    reduced.current = reducedMotion();
    const paint = (t = 0) => { el.style.transform = transformOf(pose(t, phase.current, reduced.current), off.current, u); };
    const it = {
      visible: true,
      frame(t) {
        if (!drag.current) { off.current.ry *= 0.93; off.current.rx *= 0.93; } // depois de arrastar, volta devagar ao balanço
        paint(t);
      },
    };
    paint(0);
    let io = null;
    if (typeof IntersectionObserver === 'function') { io = new IntersectionObserver(([e]) => { it.visible = e.isIntersecting; }); io.observe(box); }
    const apply = () => { reduced.current = reducedMotion(); if (reduced.current) { stop(it); paint(0); } else start(it); };
    apply();
    const mo = new MutationObserver(apply); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    return () => { stop(it); io?.disconnect(); mo.disconnect(); };
  }, [u]);

  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura: o arrasto segue dentro do boneco */ } };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    off.current.ry = clamp(off.current.ry + (e.clientX - d.x) * 0.9, -170, 170); off.current.rx = clamp(off.current.rx + (e.clientY - d.y) * 0.5, -40, 40); drag.current = { x: e.clientX, y: e.clientY };
    if (reduced.current && rig.current) rig.current.style.transform = transformOf(pose(0, 0, true), off.current, u); // parado: o arrasto se aplica direto
  };
  const onUp = () => { drag.current = null; };
  const p0 = pose(0, phase.current, false);

  return (
    <span ref={root} className={`m3${className ? ` ${className}` : ''}`} style={{ '--u': `${u}px` }} role={label ? undefined : 'img'} aria-label={label ?? undefined} aria-hidden={label ? true : undefined}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-3d="true">
      <span className="m3-rig" ref={rig} style={{ transform: transformOf(p0, { ry: 0, rx: 0 }, u) }}>
        {PARTS.map((p) => <Cuboid key={p.id} p={p} u={u} />)}
      </span>
    </span>
  );
}
