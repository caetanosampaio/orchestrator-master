// Site do FORGE: animações das demonstrações. Sem dependências. Tudo é simulado e a página diz isso.
// Com prefers-reduced-motion, cada demonstração mostra direto o estado final (sem digitação, raios, brasas nem contagem).
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVGNS = 'http://www.w3.org/2000/svg';

  // Endereços públicos dos instaladores. Vazios até existir um lugar oficial de download.
  const DOWNLOADS = { win: '', mac: '' };

  const fmtTokens = (n) => (n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1).replace('.', ',')}k`);

  // Observa a entrada na tela; `once` desliga depois da primeira vez.
  function onView(el, cb, { once = true, threshold = 0.25 } = {}) {
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        cb(e.isIntersecting);
        if (once && e.isIntersecting) io.disconnect();
      }
    }, { threshold });
    io.observe(el);
  }

  // ---------------------------------------------------------------- mascote: o ferreiro da logo martelando
  // Corpo, cabeça e bigorna vêm de client/src/forge-logo.mjs; o antebraço e o martelo giram em torno do cotovelo (32.6, 48.1).
  function mascotSvg({ bolts = false } = {}) {
    const p = (d, extra = '') => `<path d="${d}"${extra}/>`;
    const body = [
      'M26.3 72.4 L26 78.3', 'M33.8 72.6 L34.2 78.4',
      'M24.9 52.4 C24.6 59 24.7 65.6 24.3 72.2 C28.4 72.6 32.4 72.5 36.6 72.2',
      'M24.9 39.2 C29 37.9 33.4 37.4 37.1 37.8 C39.9 40.4 39.6 47.6 38.6 54.4 C37.9 60.4 37.2 66.4 36.6 72.2',
      'M35.9 40.2 C34.6 44.6 34.7 50.2 35.8 54.1 C37.1 50 37.2 44.4 35.9 40.2',
      'M21.9 41.2 C19.6 42.6 18 44.4 18.1 46.4 C18.2 48.6 18.4 50.6 19.1 51.9 C20.8 50.4 22.6 49.9 24.8 51 L25 52.4',
      'M25 52.4 C28.2 52.2 31.2 52.6 34.2 52.9',
      'M23.2 41.6 C26.4 43.7 29.6 45.9 32.6 48.1', // braço até o cotovelo
    ].map((d) => p(d)).join('');
    const hair = p('M20.4 40.6 L19.9 38.9 L21.3 38.3 L21.5 36.9 L23 37.6 L24.4 36.8 L24.6 38.4 L25.9 39.2 L24.8 40.4 L25.1 41.8 L23.5 41.6 L22.4 42.7 L21.8 41.3 Z', ' fill="currentColor"');
    const apron = p('M31.6 62.4 L37.1 62 L36.7 72.1 L34.4 72.2 C33.6 68.8 32.8 65.4 31.6 62.4 Z', ' fill="currentColor" stroke-width=".8"');
    const arm = `<g class="m-arm">${p('M32.6 48.1 L37.5 55.5')}${p('M37.5 55.5 L48 61.6')}${p('M49.1 59.7 L46.7 63.85', ' stroke-width="3.6" stroke-linecap="butt"')}</g>`;
    const anvil = p('M42.6 64.4 L58.9 64.6 L58.6 66.9 L55.6 67.9 L49.6 68.2 L45.3 67.6 L42.8 66.4 Z', ' fill="currentColor"') + p('M47.1 68.4 L45.6 78') + p('M55.1 68.2 L57.2 78');
    const fire = `<g class="m-fire">${['M48.6 71.9 C49.4 74.2 48.2 75.9 49.1 77.9', 'M51.2 70.9 C52 73.6 50.6 75.6 51.5 77.9', 'M53.8 72.1 C53.1 74.4 54.4 76.1 53.6 77.8'].map((d) => p(d)).join('')}</g>`;
    const steam = `<g class="m-steam">${p('M54.4 56.4 C52.4 53.2 56.4 50.8 54.2 47.2')}${p('M58.4 54.2 C56.2 49.8 60.6 46.4 58.1 40.8')}</g>`;
    const ground = p('M7.6 78.1 C30 77.6 60 78.5 92.5 78.2');
    const sparks = [[-8, -9], [-4, -12], [2, -13], [7, -10], [11, -6], [-11, -4], [5, -4]]
      .map(([dx, dy], i) => `<circle class="m-spark" cx="48.6" cy="62.8" r="${i % 2 ? 0.55 : 0.75}" style="--dx:${dx}px;--dy:${dy}px"/>`).join('');
    const zaps = bolts
      ? `<g class="m-bolts" fill="none" stroke-linejoin="round" stroke-linecap="round"><path class="m-bolt" d="M64 44 L60.6 50.6 L64.2 51 L59.6 58.4"/><path class="m-bolt b2" d="M74.6 47 L71.4 51.6 L74 52.4 L70.6 57.4"/><path class="m-bolt b3" d="M70 56 L66.4 59.4 L69 60.6 L65.4 63.6"/></g>`
      : '';
    return `<svg viewBox="4 22 92 62" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">`
      + `<g class="m-body">${body}${hair}${apron}${arm}</g>${anvil}${fire}${ground}${steam}</g>`
      + `<rect class="m-metal" x="47" y="62.9" width="6.2" height="1.6" rx=".6"/>${zaps}<g class="m-sparks">${sparks}</g></svg>`;
  }
  for (const el of $$('[data-mascot]')) el.innerHTML = mascotSvg({ bolts: el.hasAttribute('data-mascot-bolts') || el.hasAttribute('data-report-mascot') });

  // ---------------------------------------------------------------- brasas subindo no fundo do topo
  const embersCanvas = $('[data-embers]');
  if (embersCanvas && !reduced && embersCanvas.getContext) embers(embersCanvas);

  function embers(canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, parts = [], raf = 0, running = false;
    const spawn = (initial) => ({
      x: Math.random() * w, y: initial ? Math.random() * h : h + 8,
      r: 0.5 + Math.random() * 1.5, vy: 0.18 + Math.random() * 0.55, vx: (Math.random() - 0.5) * 0.18,
      ph: Math.random() * Math.PI * 2, hue: Math.random() < 0.7 ? '240,150,60' : '227,179,65',
    });
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(14, Math.round(w / 34));
      parts = Array.from({ length: n }, () => spawn(true));
    }
    function frame(t) {
      ctx.clearRect(0, 0, w, h);
      for (const q of parts) {
        q.y -= q.vy; q.x += q.vx + Math.sin(t * 0.0012 + q.ph) * 0.15;
        if (q.y < -10) Object.assign(q, spawn(false));
        const life = Math.min(1, q.y / (h * 0.85));
        const a = Math.max(0, life) * (0.35 + 0.35 * Math.sin(t * 0.006 + q.ph * 3));
        ctx.beginPath();
        ctx.fillStyle = `rgba(${q.hue},${a.toFixed(3)})`;
        ctx.shadowColor = `rgba(${q.hue},${(a * 0.9).toFixed(3)})`;
        ctx.shadowBlur = 8;
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    const start = () => { if (!running && !document.hidden) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    resize();
    window.addEventListener('resize', () => { resize(); }, { passive: true });
    onView(canvas.parentElement, (v) => (v ? start() : stop()), { once: false, threshold: 0 });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }

  // ---------------------------------------------------------------- revelação e navegação
  for (const el of $$('.reveal')) onView(el, (v) => v && el.classList.add('in'), { threshold: 0.12 });
  for (const el of $$('.tile')) onView(el, (v) => v && el.classList.add('in'), { threshold: 0.3 });

  const nav = $('[data-nav]');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Item do menu aceso = a última seção do menu cuja borda superior já passou de ~35% da altura da janela. No topo (hero) e a partir de "Comece agora" nenhum fica aceso.
  // (Um observador por seção com limiar de área falhava em seções altas e nunca apagava o item ao sair.)
  const spy = $$('.nav-links a').map((a) => ({ a, sec: $(a.getAttribute('href')) })).filter((x) => x.sec);
  const endSec = $('#baixar');
  let spyQueued = false;
  const paintSpy = () => {
    spyQueued = false;
    const line = window.innerHeight * 0.35;
    let cur = null;
    for (const x of spy) if (!x.sec.hidden && x.sec.getBoundingClientRect().top <= line) cur = x;
    if (endSec && endSec.getBoundingClientRect().top <= line) cur = null;
    for (const x of spy) x.a.classList.toggle('active', x === cur);
  };
  const queueSpy = () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(paintSpy); } };
  window.addEventListener('scroll', queueSpy, { passive: true });
  window.addEventListener('resize', queueSpy);
  paintSpy();

  // ---------------------------------------------------------------- raios entre terminais
  // Caminho em zigue-zague entre as bordas de dois elementos, com amplitude maior no meio.
  function boltPath(x1, y1, x2, y2, amp) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, n = Math.max(6, Math.round(len / 22));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = i === 0 || i === n ? 0 : (Math.random() * 2 - 1) * amp * Math.sin(Math.PI * t);
      pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    return pts;
  }
  const toD = (pts) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`;

  function edgePoint(rect, box, tx, ty) {
    const cx = rect.left - box.left + rect.width / 2, cy = rect.top - box.top + rect.height / 2;
    const dx = tx - cx, dy = ty - cy;
    const s = Math.min((rect.width / 2) / (Math.abs(dx) || 1e-6), (rect.height / 2) / (Math.abs(dy) || 1e-6)) * 0.82;
    return [cx + dx * s, cy + dy * s];
  }

  function makeZapper(container, svg) {
    return function zap(fromEl, toEl, onHit) {
      if (reduced || !svg) { onHit && onHit(); return; }
      const box = container.getBoundingClientRect();
      const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      const ac = [a.left - box.left + a.width / 2, a.top - box.top + a.height / 2];
      const bc = [b.left - box.left + b.width / 2, b.top - box.top + b.height / 2];
      const [x1, y1] = edgePoint(a, box, bc[0], bc[1]);
      const [x2, y2] = edgePoint(b, box, ac[0], ac[1]);
      svg.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
      const pts = boltPath(x1, y1, x2, y2, Math.min(18, Math.hypot(x2 - x1, y2 - y1) * 0.09));
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'bolt');
      const mk = (cls, d) => { const el = document.createElementNS(SVGNS, 'path'); el.setAttribute('class', cls); el.setAttribute('d', d); g.append(el); return el; };
      const glow = mk('bolt-glow', toD(pts));
      const core = mk('bolt-core', toD(pts));
      // galho curto saindo do meio
      const mid = pts[Math.floor(pts.length / 2)];
      const br = boltPath(mid[0], mid[1], mid[0] + (Math.random() - 0.5) * 50, mid[1] + (Math.random() - 0.5) * 50, 6);
      const branch = mk('bolt-core thin', toD(br));
      for (const [cx, cy, r] of [[x1, y1, 3], [x2, y2, 5]]) {
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); c.setAttribute('class', 'bolt-node');
        g.append(c);
      }
      svg.append(g);
      for (const el of [glow, core, branch]) {
        const len = el.getTotalLength();
        el.style.strokeDasharray = `${len}`;
        el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
      }
      const anim = g.animate([
        { opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0.25, offset: 0.4 }, { opacity: 1, offset: 0.5 }, { opacity: 0 },
      ], { duration: 720, easing: 'linear' });
      anim.onfinish = () => g.remove();
      setTimeout(() => onHit && onHit(), 190);
    };
  }

  // ---------------------------------------------------------------- spinners das ações em andamento
  const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  const spinners = new Set();
  let spinIdx = 0;
  if (!reduced) setInterval(() => { spinIdx = (spinIdx + 1) % FRAMES.length; for (const s of spinners) s.textContent = FRAMES[spinIdx]; }, 90);

  // ---------------------------------------------------------------- cockpit (hero)
  const cockpit = $('[data-cockpit]');
  if (cockpit) heroDemo(cockpit);

  function heroDemo(root) {
    const STATES = { idle: ['dot-idle', 'ocioso'], work: ['dot-work', 'executando'], wait: ['dot-wait', 'aguardando'], ok: ['dot-ok', 'concluído'] };
    const panesEl = $('[data-panes]', root);
    const zap = makeZapper(panesEl, $('[data-bolts]', root));
    const panes = {};
    for (const el of $$('[data-pane]', root)) {
      panes[el.dataset.pane] = { el, out: $('[data-out]', el), state: 'idle', tokens: 0, shown: 0, tokEl: $('[data-tokens]', el), chip: $('[data-task]', el), spin: null };
    }
    const approveBox = $('[data-approve]', root);
    const approveBtn = $('[data-approve-btn]', root);
    const globalBadge = $('[data-global-status]', root);
    const wsLed = $('[data-ws-led]', root);
    const summary = $('[data-summary]', root);
    const mascot = $('[data-cockpit-mascot]', root);
    let run = 0;
    let visible = false;
    let wakers = [];
    let approveResolve = null;
    const CANCEL = Symbol('cancel');

    onView(root, (v) => { visible = v; if (v) { wakers.forEach((w) => w()); wakers = []; } }, { once: false, threshold: 0.15 });

    // Espera `ms` e, se o cockpit saiu da tela, segura até ele voltar.
    async function sleep(ms, id) {
      if (reduced) { if (id !== run) throw CANCEL; return; }
      await new Promise((r) => setTimeout(r, ms));
      while (!visible && id === run) await new Promise((r) => wakers.push(r));
      if (id !== run) throw CANCEL;
    }

    function stopSpin(p) {
      if (p.spin) { spinners.delete(p.spin); p.spin.textContent = '●'; p.spin.classList.add('done'); p.spin = null; }
    }

    function setState(name, st) {
      const p = panes[name];
      p.state = st;
      if (st !== 'work') stopSpin(p);
      const [cls, label] = STATES[st];
      const box = $('[data-state]', p.el);
      box.replaceChildren();
      const dot = document.createElement('span');
      dot.className = `dot ${cls}`;
      dot.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.textContent = label;
      box.append(dot, txt);
      p.el.classList.toggle('is-work', st === 'work');
      p.el.classList.toggle('is-ok', st === 'ok');
      refreshGlobal();
    }

    function setTask(name, id) {
      const chip = panes[name].chip;
      if (!chip) return;
      chip.textContent = id || '';
      chip.hidden = !id;
    }

    function refreshGlobal() {
      const list = Object.values(panes).map((p) => p.state);
      const count = (s) => list.filter((x) => x === s).length;
      const g = count('wait') ? 'wait' : count('work') ? 'work' : list.every((s) => s === 'ok') ? 'ok' : 'idle';
      const labels = { wait: 'aguardando você', work: 'forjando', ok: 'entregue', idle: 'parado' };
      globalBadge.replaceChildren();
      const dot = document.createElement('span');
      dot.className = `dot dot-${g}`;
      dot.setAttribute('aria-hidden', 'true');
      const t = document.createElement('span');
      t.textContent = labels[g];
      globalBadge.append(dot, t);
      wsLed.className = `ws-led ${g === 'idle' ? '' : g}`;
      if (mascot) mascot.classList.toggle('is-idle', g !== 'work');
      const parts = [`${list.length} agentes`];
      if (count('work')) parts.push(`${count('work')} executando`);
      if (count('wait')) parts.push(`${count('wait')} aguardando você`);
      if (count('ok')) parts.push(`${count('ok')} concluído${count('ok') > 1 ? 's' : ''}`);
      summary.textContent = parts.join(' · ');
    }

    // Contador de tokens que sobe suavemente até o alvo.
    function addTokens(name, n) {
      const p = panes[name];
      if (!p.tokEl) return;
      p.tokens += n;
      if (reduced) { p.shown = p.tokens; p.tokEl.textContent = fmtTokens(p.shown); return; }
      const from = p.shown, to = p.tokens, t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 600);
        p.shown = from + (to - from) * (1 - (1 - k) ** 3);
        p.tokEl.textContent = fmtTokens(p.shown);
        if (k < 1 && p.tokens === to) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    function hit(name) {
      const el = panes[name].el;
      el.classList.remove('hit');
      void el.offsetWidth;
      el.classList.add('hit');
    }

    function bolt(from, to) {
      return new Promise((r) => zap(panes[from].el, panes[to].el, () => { hit(to); r(); }));
    }

    // Linha de saída. Tipos: user, tool ("Verbo alvo", com spinner), ok, wait, dim, cmd, plain.
    function line(name, text, kind = 'plain') {
      const p = panes[name];
      stopSpin(p);
      const el = document.createElement('p');
      el.className = `c-${kind}`;
      if (kind === 'tool') {
        const [verb, ...rest] = text.split(' ');
        const sp = document.createElement('span');
        sp.className = 'spin';
        sp.textContent = reduced ? '●' : FRAMES[spinIdx];
        if (!reduced) { spinners.add(sp); p.spin = sp; }
        const b = document.createElement('b');
        b.textContent = verb;
        el.append(sp, ' ', b, ` ${rest.join(' ')}`);
      } else {
        el.textContent = text;
      }
      p.out.append(el);
      while (p.out.children.length > 12) p.out.firstElementChild.remove();
      return el;
    }

    async function typeLine(name, text, id, kind = 'user') {
      const el = line(name, '', kind);
      if (reduced) { el.textContent = text; return; }
      for (let i = 1; i <= text.length; i++) {
        el.textContent = text.slice(0, i);
        await sleep(20 + Math.random() * 28, id);
      }
    }

    // Linhas em sequência, com o ritmo de um agente trabalhando.
    async function lines(name, items, id, { gap = 520, tok = 900 } = {}) {
      for (const [kind, text, wait] of items) {
        await sleep(wait ?? gap + Math.random() * 260, id);
        line(name, text, kind);
        addTokens(name, Math.round(tok * (0.5 + Math.random())));
      }
    }

    function waitApproval(id) {
      return new Promise((resolve, reject) => {
        approveBox.hidden = false;
        let done = false;
        const finish = () => { if (done) return; done = true; approveBox.hidden = true; approveResolve = null; id === run ? resolve() : reject(CANCEL); };
        approveResolve = finish;
        if (reduced) { finish(); return; }
        // Sem clique, aprova sozinho para a demonstração seguir (o produto real nunca faz isso).
        sleep(4200, id).then(finish, () => { done = true; approveBox.hidden = true; reject(CANCEL); });
      });
    }
    approveBtn.addEventListener('click', () => approveResolve && approveResolve());

    function reset() {
      for (const name of Object.keys(panes)) {
        const p = panes[name];
        stopSpin(p);
        p.out.replaceChildren();
        p.tokens = 0; p.shown = 0;
        if (p.tokEl) p.tokEl.textContent = '0';
        setTask(name, '');
        setState(name, 'idle');
      }
      approveBox.hidden = true;
    }

    async function script(id) {
      reset();
      for (const n of ['builder', 'scout', 'review']) line(n, 'aguardando tarefa…', 'dim');
      line('maestro', 'maestro · ~/projetos/loja-api', 'dim');
      await sleep(700, id);
      setState('maestro', 'work');
      await typeLine('maestro', '> Adicionar cupom de desconto no checkout, com testes', id);
      await lines('maestro', [
        ['tool', 'Lendo package.json'],
        ['tool', 'Buscando "total|price" em src/checkout'],
        ['tool', 'Lendo src/checkout/total.js'],
        ['plain', 'Plano em 3 tarefas:', 700],
        ['dim', '  task_a1 → Construtor · cupom', 240],
        ['dim', '  task_b2 → Batedor · regras de preço', 240],
        ['dim', '  task_c3 → Revisor · revisão', 240],
      ], id, { tok: 1400 });
      setState('maestro', 'wait');
      line('maestro', '⏸ aguardando a sua aprovação', 'wait');
      await waitApproval(id);
      setState('maestro', 'work');
      line('maestro', '✓ plano aprovado por você', 'ok');
      await sleep(260, id);
      line('maestro', '⚡ distribuindo tarefas à equipe', 'cmd');
      setTask('builder', 'task_a1');
      setTask('scout', 'task_b2');
      setTask('review', 'task_c3');
      bolt('maestro', 'scout');
      await sleep(160, id);
      bolt('maestro', 'builder');

      const scout = (async () => {
        await sleep(320, id);
        panes.scout.out.replaceChildren();
        setState('scout', 'work');
        line('scout', 'Tarefa task_b2 · regras de preço', 'cmd');
        await lines('scout', [
          ['tool', 'Buscando "applyDiscount|price" em src/'],
          ['tool', 'Lendo src/checkout/total.js'],
          ['tool', 'Lendo test/checkout.test.mjs'],
          ['plain', 'Casos de borda encontrados:', 600],
          ['dim', '  · arredondamento em centavos', 280],
          ['dim', '  · cupom expirado e limite de uso', 280],
          ['dim', '  · frete fica fora do desconto', 280],
        ], id, { gap: 760 });
        await sleep(600, id);
        line('scout', '✓ entregue ao Maestro', 'ok');
        setState('scout', 'ok');
        await bolt('scout', 'maestro');
        line('maestro', '✓ task_b2 · 3 casos de borda', 'ok');
      })();

      const builder = (async () => {
        await sleep(480, id);
        panes.builder.out.replaceChildren();
        setState('builder', 'work');
        line('builder', 'Tarefa task_a1 · cópia forge/construtor-a1', 'cmd');
        await lines('builder', [
          ['tool', 'Lendo src/checkout/total.js'],
          ['tool', 'Criando src/checkout/coupon.js  +48'],
          ['tool', 'Editando src/checkout/total.js  +6 −2'],
          ['tool', 'Criando test/coupon.test.mjs  +61'],
        ], id, { gap: 820, tok: 1700 });
        await sleep(700, id);
        await typeLine('builder', '$ npm test', id, 'cmd');
        await lines('builder', [
          ['dim', '  ✔ checkout (9 testes)', 900],
          ['dim', '  ✔ coupon (5 testes)', 320],
          ['ok', '  14 passando · 0 falhando', 320],
          ['ok', '✓ entregue ao Maestro', 600],
        ], id, { tok: 600 });
        setState('builder', 'ok');
        await bolt('builder', 'maestro');
      })();

      await Promise.all([scout, builder]);
      await lines('maestro', [['ok', '✓ task_a1 · 14 testes passando', 200]], id);
      await sleep(420, id);
      line('maestro', '⚡ task_c3 → Revisor', 'cmd');
      await bolt('maestro', 'review');

      panes.review.out.replaceChildren();
      setState('review', 'work');
      line('review', 'Tarefa task_c3 · revisar a task_a1', 'cmd');
      await sleep(500, id);
      await typeLine('review', '$ git diff main...forge/construtor-a1', id, 'cmd');
      await lines('review', [
        ['tool', 'Lendo src/checkout/coupon.js'],
        ['tool', 'Lendo test/coupon.test.mjs'],
        ['ok', '  ok   limite de uso checado antes', 700],
        ['ok', '  ok   cupom expirado coberto', 360],
        ['dim', '  sug  arredondar em money.js', 360],
        ['ok', '✓ 0 bloqueadores · entregue', 700],
      ], id, { gap: 760, tok: 1200 });
      setState('review', 'ok');
      await bolt('review', 'maestro');
      await lines('maestro', [
        ['ok', '✓ revisão: 0 bloqueadores, 1 sugestão', 300],
        ['cmd', '◆ entrega pronta: forge/construtor-a1', 600],
      ], id);
      setState('maestro', 'ok');
    }

    async function loop() {
      const id = ++run;
      try {
        await script(id);
        if (reduced) return;
        await sleep(7000, id);
        loop();
      } catch (e) { if (e !== CANCEL) throw e; }
    }

    $('[data-replay]', root).addEventListener('click', () => { if (approveResolve) approveResolve(); loop(); });
    onView(root, (v) => v && loop(), { threshold: 0.15 });
  }

  // ================================================================================================
  // Seções de "Como funciona" até o rodapé. Os dados abaixo espelham o produto real:
  //   provedores e modelos (server/providers/*.js), tabela "Quem faz cada tarefa" (server/harness.js),
  //   misturas de agentes (client/src/team-view.js) e fluxos com dependências (server/flows.js).
  // ================================================================================================
  const PROV = {
    claude: { name: 'Claude Code', logo: 'i-claude', cls: '' },
    codex: { name: 'Codex CLI', logo: 'i-openai', cls: 'is-openai' },
  };
  const MODELS = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', 'gpt-5-codex': 'GPT-5 Codex', 'gpt-5': 'GPT-5', 'gpt-5-mini': 'GPT-5 mini' };
  const EFFORTS = { low: ['Baixo', 1], medium: ['Médio', 2], high: ['Alto', 3], xhigh: ['Muito alto', 4], max: ['Máximo', 5] };
  const ROLE_LABEL = { maestro: 'Maestro', builder: 'Construtor', reviewer: 'Revisor', scout: 'Batedor' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svgUse = (id, cls = '') => `<svg aria-hidden="true" focusable="false"${cls ? ` class="${cls}"` : ''}><use href="#${id}"/></svg>`;
  const logoOf = (p) => svgUse(PROV[p].logo, PROV[p].cls);
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  // Intervalo que só roda com o elemento na tela (e nunca com movimento reduzido).
  function every(el, ms, fn) {
    if (reduced) return;
    let t = 0, on = false;
    onView(el, (v) => {
      if (v && !on) { on = true; t = setInterval(fn, ms); }
      if (!v && on) { on = false; clearInterval(t); }
    }, { once: false, threshold: 0.2 });
  }


  // ---------------------------------------------------------------- recursos em abas (Maestro, aprovação, cópias, revisão, contas, terminais)
  const ftabs = $('[data-ftabs]');
  if (ftabs) featureTabs(ftabs);

  function featureTabs(root) {
    const tabs = $$('[role="tab"]', root);
    const STEP_MS = 7000;
    const TICKS = {
      scout: ['Buscando "price" em src/', 'Lendo test/checkout.test.mjs', '✓ 3 casos de borda · entregue'],
      builder: ['Lendo src/checkout/total.js', 'Criando src/checkout/coupon.js  +48', 'Editando src/checkout/total.js  +6 −2', '$ npm test', '✓ 9 passando · commit na a1'],
      codex: ['Lendo src/checkout/coupon.js', 'Criando test/coupon.test.mjs  +61', '$ npm test -- coupon', '✓ 5 passando · commit na a2'],
    };
    let current = 0, timer = null, auto = !reduced, inView = false, stepRun = 0;
    root.style.setProperty('--ft-dur', `${STEP_MS}ms`);
    const approveAll = $('[data-approve-all]', root);
    const panelOf = (t) => $(`#${t.getAttribute('aria-controls')}`);

    function select(i, { focus = false } = {}) {
      current = (i + tabs.length) % tabs.length;
      tabs.forEach((t, k) => {
        const on = k === current;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panelOf(t).hidden = !on;
      });
      if (focus) tabs[current].focus();
      // os painéis dividem a mesma célula (sem salto de altura): as animações do que aparece recomeçam do zero
      const panel = panelOf(tabs[current]);
      if (!reduced && panel.getAnimations) for (const a of panel.getAnimations({ subtree: true })) { a.cancel(); a.play(); }
      root.classList.remove('playing');
      void root.offsetWidth;
      if (auto && inView) root.classList.add('playing');
      enter(tabs[current].dataset.fp);
      clearTimeout(timer);
      if (auto && inView) timer = setTimeout(() => select(current + 1), STEP_MS);
    }
    function stopAuto() { auto = false; clearTimeout(timer); root.classList.remove('playing'); }

    function approve(badges, k) {
      const b = badges[k];
      if (!b || b.classList.contains('b-ok')) return;
      b.className = 'badge b-ok pop';
      b.textContent = 'aprovada';
      if (badges.every((x) => x.classList.contains('b-ok'))) { approveAll.disabled = true; approveAll.textContent = 'Aprovadas'; }
    }

    function enter(name) {
      const id = ++stepRun;
      const later = (fn, ms) => setTimeout(() => id === stepRun && fn(), reduced ? 0 : ms);
      if (name === 'maestro') {
        const target = $('[data-type-target]', root);
        const rows = $$('p', $('[data-plan]', root));
        const text = 'Adicionar cupom de desconto no checkout, com testes';
        rows.forEach((r) => r.classList.remove('on'));
        if (reduced) { target.textContent = text; rows.forEach((r) => r.classList.add('on')); return; }
        target.textContent = '';
        let i = 0;
        const tick = () => {
          if (id !== stepRun) return;
          target.textContent = text.slice(0, ++i);
          if (i < text.length) setTimeout(tick, 30);
          else rows.forEach((r, k) => later(() => r.classList.add('on'), 260 + k * 330));
        };
        setTimeout(tick, 250);
      }
      if (name === 'approve') {
        const badges = $$('[data-badge]', root);
        badges.forEach((b) => { b.className = 'badge b-wait'; b.textContent = 'pendente'; });
        approveAll.disabled = false;
        approveAll.textContent = 'Aprovar todas';
        badges.forEach((_, k) => later(() => approve(badges, k), 1800 + k * 600));
      }
      if (name === 'parallel') {
        const els = $$('[data-ticker]', root);
        const idx = Object.fromEntries(Object.keys(TICKS).map((k) => [k, 0]));
        const show = (el) => { el.textContent = TICKS[el.dataset.ticker][idx[el.dataset.ticker]]; restart(el, 'tick'); };
        if (reduced) { els.forEach((el) => { idx[el.dataset.ticker] = TICKS[el.dataset.ticker].length - 1; show(el); }); return; }
        els.forEach(show);
        const advance = () => {
          if (id !== stepRun) return;
          for (const el of els) { const k = el.dataset.ticker; if (idx[k] < TICKS[k].length - 1) { idx[k]++; show(el); } }
          setTimeout(advance, 950);
        };
        setTimeout(advance, 950);
      }
    }

    approveAll.addEventListener('click', () => { const badges = $$('[data-badge]', root); badges.forEach((_, k) => approve(badges, k)); });
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { stopAuto(); select(i); });
      t.addEventListener('keydown', (e) => {
        const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (e.key in keys) { e.preventDefault(); stopAuto(); select(current + keys[e.key], { focus: true }); }
        else if (e.key === 'Home') { e.preventDefault(); stopAuto(); select(0, { focus: true }); }
        else if (e.key === 'End') { e.preventDefault(); stopAuto(); select(tabs.length - 1, { focus: true }); }
      });
    });
    onView(root, (v) => {
      const was = inView;
      inView = v;
      if (v && !was) select(current);
      if (!v) { clearTimeout(timer); root.classList.remove('playing'); }
    }, { once: false, threshold: 0.3 });
  }

  // ---------------------------------------------------------------- SMIL dos diagramas: pausa fora da tela
  for (const s of $$('.paths-svg')) {
    if (!s.pauseAnimations) continue;
    if (reduced) { s.pauseAnimations(); continue; }
    onView(s, (v) => (v ? s.unpauseAnimations() : s.pauseAnimations()), { once: false, threshold: 0 });
  }

  // ---------------------------------------------------------------- 03 · quem faz cada tarefa: fios até o modelo
  const router = $('[data-router]');
  if (router) routerDemo(router);

  function routerDemo(root) {
    const body = $('[data-rt-body]', root), wires = $('[data-rt-wires]', root);
    const btns = $$('[data-rt]', root), models = $$('[data-model]', root);
    const D = {
      box: $('[data-rt-detail]', root), group: $('[data-rt-group]', root), label: $('[data-rt-label]', root), role: $('[data-rt-role]', root), prov: $('[data-rt-prov]', root),
      model: $('[data-rt-model]', root), eff: $('[data-rt-eff]', root), effort: $('[data-rt-effort]', root), skills: $('[data-rt-skills]', root), call: $('[data-rt-call]', root),
    };
    const counts = {};
    for (const b of btns) {
      let g = b.previousElementSibling;
      while (g && !g.classList.contains('rt-g')) g = g.previousElementSibling;
      b.dataset.group = g ? g.textContent : '';
      b.dataset.label = b.textContent.trim();
      const [prov, model] = b.dataset.to.split(':');
      counts[b.dataset.to] = (counts[b.dataset.to] || 0) + 1;
      const chip = document.createElement('span');
      chip.className = 'rt-chip';
      chip.innerHTML = `${logoOf(prov)}${esc(MODELS[model])}`;
      b.append(chip);
    }
    for (const m of models) $('[data-model-n]', m).textContent = `${counts[m.dataset.model] || 0} tipos`;

    let current = btns[0], paths = new Map(), pk = null, raf = 0, timer = 0, auto = !reduced, inView = false;
    D.box.setAttribute('aria-live', 'off'); // o ciclo automático não fala; vira "polite" quando a pessoa escolhe

    function layout() {
      wires.replaceChildren();
      paths = new Map();
      pk = null;
      if (getComputedStyle(wires).display === 'none') return;
      const box = body.getBoundingClientRect();
      wires.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
      for (const b of btns) {
        const m = models.find((x) => x.dataset.model === b.dataset.to);
        const a = b.getBoundingClientRect(), c = m.getBoundingClientRect();
        const x1 = a.right - box.left, y1 = a.top - box.top + a.height / 2, x2 = c.left - box.left, y2 = c.top - box.top + c.height / 2, dx = (x2 - x1) * 0.55;
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
        p.setAttribute('class', 'rt-wire');
        wires.append(p);
        paths.set(b, p);
      }
      pk = document.createElementNS(SVGNS, 'circle');
      pk.setAttribute('r', '3.2');
      pk.setAttribute('class', 'rt-pk');
      wires.append(pk);
      highlight();
    }

    function highlight() {
      const sel = paths.get(current);
      for (const [b, p] of paths) {
        const on = b === current;
        p.setAttribute('class', `rt-wire${on ? ` on${b.dataset.to.startsWith('codex') ? ' cx' : ''}` : b.dataset.to === current.dataset.to ? ' near' : ''}`);
      }
      if (sel) { wires.append(sel); if (pk) wires.append(pk); } // o fio escolhido e o pacote por cima dos outros
    }

    function select(b, user = false) {
      current = b;
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      models.forEach((m) => m.classList.toggle('on', m.dataset.model === b.dataset.to));
      const [prov, model] = b.dataset.to.split(':');
      const [elabel, level] = EFFORTS[b.dataset.effort];
      D.group.textContent = b.dataset.group;
      D.label.textContent = b.dataset.label;
      D.role.textContent = ROLE_LABEL[b.dataset.role];
      D.prov.innerHTML = `${logoOf(prov)}${esc(PROV[prov].name)}`;
      D.model.textContent = MODELS[model];
      $$('i', D.eff).forEach((i, k) => i.classList.toggle('on', k < level));
      D.effort.textContent = elabel;
      D.skills.replaceChildren(...b.dataset.skills.split(',').filter(Boolean).map((s) => { const e = document.createElement('span'); e.textContent = s; return e; }));
      D.call.textContent = `send_task(pane, tarefa, task_type: "${b.dataset.rt}")`;
      if (!reduced) restart(D.box, 'swap');
      highlight();
      if (user) { auto = false; clearInterval(timer); D.box.setAttribute('aria-live', 'polite'); }
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      const p = paths.get(current);
      if (!p || !pk) return;
      const k = (now % 1200) / 1200, pt = p.getPointAtLength(p.getTotalLength() * (1 - (1 - k) ** 2));
      pk.setAttribute('cx', pt.x.toFixed(1));
      pk.setAttribute('cy', pt.y.toFixed(1));
    }
    const cycle = () => { const i = btns.indexOf(current); select(btns[(i + 1) % btns.length]); };

    for (const b of btns) {
      b.addEventListener('click', () => select(b, true));
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') select(b, true); });
    }
    const relayout = () => requestAnimationFrame(layout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(body); else window.addEventListener('resize', relayout, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    onView(root, (v) => {
      inView = v;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      if (v && !reduced) raf = requestAnimationFrame(tick);
      if (v && auto) timer = setInterval(cycle, 2800);
    }, { once: false, threshold: 0.2 });
    select(current);
  }

  // ---------------------------------------------------------------- 04 · fluxos: etapas num grafo, rodando
  const FLOWS = {
    feature: {
      goal: 'Adicionar cupom de desconto no checkout, com testes e revisão de segurança.', par: 2,
      done: '4 etapas · 2 IAs · 14 testes · 0 bloqueadores',
      steps: [
        { id: 's1', title: 'Mapear regras de preço', role: 'scout', prov: 'claude', model: 'haiku', effort: 'medium', deps: [], dur: 3.2, log: ['Buscando "price|total" em src/', 'Lendo src/checkout/total.js', '3 casos de borda mapeados'] },
        { id: 's2', title: 'Implementar o cupom', role: 'builder', prov: 'claude', model: 'sonnet', effort: 'medium', deps: ['s1'], dur: 6, wait: { at: 0.55, text: 'permitir "npm test"?', ok: 'permitido por você' }, log: ['Criando src/checkout/coupon.js', 'Editando src/checkout/total.js', '$ npm test', '9 passando · commit na a1'] },
        { id: 's3', title: 'Escrever os testes', role: 'builder', prov: 'codex', model: 'gpt-5-codex', effort: 'medium', deps: ['s1'], dur: 4.6, log: ['Lendo src/checkout/coupon.js', 'Criando test/coupon.test.mjs', '$ npm test -- coupon', '5 passando · commit na a2'] },
        { id: 's4', title: 'Revisar a segurança', role: 'reviewer', prov: 'claude', model: 'opus', effort: 'max', deps: ['s2', 's3'], dur: 4, log: ['git diff main...a1 a2', 'Conferindo o limite de uso', '0 bloqueadores · 1 sugestão'] },
      ],
    },
    audit: {
      goal: 'Auditar o pull request #42 antes do merge, com duas revisões independentes.', par: 3,
      done: '5 etapas · 3 em paralelo · 1 achado confirmado pelas duas IAs',
      steps: [
        { id: 's1', title: 'Mapear o que mudou', role: 'scout', prov: 'codex', model: 'gpt-5', effort: 'medium', deps: [], dur: 3, log: ['git diff --stat main...pr-42', '12 arquivos · 3 áreas de risco', 'mapa entregue'] },
        { id: 's2', title: 'Revisão do Claude', role: 'reviewer', prov: 'claude', model: 'opus', effort: 'max', deps: ['s1'], dur: 5.2, log: ['Lendo src/auth/session.js', 'Conferindo a validação da entrada', '2 achados · 1 alto'] },
        { id: 's3', title: 'Revisão do Codex', role: 'reviewer', prov: 'codex', model: 'gpt-5', effort: 'high', deps: ['s1'], dur: 4.6, wait: { at: 0.4, text: 'on-request: ler .env.example?', ok: 'permitido por você' }, log: ['Lendo src/auth/', 'Procurando regressões', '2 achados · 1 em comum'] },
        { id: 's4', title: 'Mapear os riscos', role: 'scout', prov: 'claude', model: 'sonnet', effort: 'medium', deps: ['s1'], dur: 3.6, log: ['Procurando usos de session()', '4 chamadores afetados', 'riscos entregues'] },
        { id: 's5', title: 'Consolidar os achados', role: 'reviewer', prov: 'claude', model: 'sonnet', effort: 'medium', deps: ['s2', 's3', 's4'], dur: 3, log: ['Cruzando as duas revisões', 'achado das duas IAs pesa mais', 'relatório com arquivo e linha'] },
      ],
    },
    bug: {
      goal: 'O total do checkout erra por um centavo com cupom de 15%.', par: 1,
      done: '4 etapas em sequência · a etapa s3 continuou no terminal da s2',
      steps: [
        { id: 's1', title: 'Reproduzir e isolar a causa', role: 'scout', prov: 'claude', model: 'opus', effort: 'high', deps: [], dur: 4, log: ['Reproduzindo com cupom de 15%', 'Hipótese: arredondamento duplo', 'causa: src/money.js:42'] },
        { id: 's2', title: 'Teste que falha e correção', role: 'builder', prov: 'claude', model: 'sonnet', effort: 'medium', deps: ['s1'], dur: 4.4, wait: { at: 0.5, text: 'permitir editar money.js?', ok: 'permitido por você' }, log: ['Criando test/rounding.test.mjs', 'o teste falha, como esperado', 'Corrigindo src/money.js:42', 'o teste passa'] },
        { id: 's3', title: 'Rodar a suíte inteira', role: 'builder', prov: 'claude', model: 'sonnet', effort: 'medium', deps: ['s2'], cont: 's2', dur: 3, log: ['$ npm test', '128 passando · 0 falhando', 'commit na branch do construtor'] },
        { id: 's4', title: 'Conferir a causa e os vizinhos', role: 'reviewer', prov: 'claude', model: 'opus', effort: 'high', deps: ['s3'], dur: 3.4, log: ['Lendo o diff', 'Procurando o mesmo erro em tax.js', 'causa resolvida · 0 bloqueadores'] },
      ],
    },
  };
  const flowEl = $('[data-flow]');
  if (flowEl) flowDemo(flowEl);

  function flowDemo(root) {
    const cols = $('[data-flow-cols]', root), wires = $('[data-flow-wires]', root), canvas = $('[data-flow-canvas]', root);
    const tabs = $$('[data-flow-tab]', root), playBtn = $('[data-flow-play]', root), playLbl = $('span', playBtn);
    const clock = $('[data-flow-clock]', root), runEl = $('[data-flow-run]', root), goal = $('[data-flow-goal]', root), status = $('[data-flow-status]', root);
    const pips = $('[data-flow-pips]', root), parEl = $('[data-flow-par]', root);
    const STATE = { pending: ['dot-idle', 'na fila'], running: ['dot-work', 'executando'], waiting: ['dot-wait', 'aguardando você'], completed: ['dot-ok', 'concluída'] };
    const ACTIVE = new Set(['running', 'waiting']);
    const MAX_PARALLEL = 4;
    let key = 'feature', flow = FLOWS[key], st = {}, nodes = new Map(), edges = [], raf = 0, running = false, paused = false, last = 0, simT = 0, inView = false, played = new Set();

    pips.replaceChildren(...Array.from({ length: MAX_PARALLEL }, () => document.createElement('i')));
    const fmtClock = (t) => { const s = Math.floor(t * 20); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

    function nodeHtml(s) {
      const deps = s.deps.length ? `depois de ${s.deps.join(' e ')}` : 'sem dependências';
      return `${s.cont ? `<span class="fn-cont">mesmo terminal de ${s.cont}</span>` : ''}`
        + `<div class="fn-h"><span class="fn-id">${s.id}</span><span class="fn-state" data-st></span></div>`
        + `<b class="fn-title">${esc(s.title)}</b>`
        + `<div class="fn-agent">${logoOf(s.prov)}<span>${ROLE_LABEL[s.role]} · ${esc(MODELS[s.model])} · ${EFFORTS[s.effort][0]}</span></div>`
        + `<div class="fn-bar"><i></i></div><p class="fn-log" data-log>${deps}</p>`;
    }

    function render() {
      flow = FLOWS[key];
      const byId = new Map(flow.steps.map((s) => [s.id, s])), depth = new Map();
      const dep = (s) => {
        if (!depth.has(s.id)) depth.set(s.id, s.deps.length ? 1 + Math.max(...s.deps.map((x) => dep(byId.get(x)))) : 0);
        return depth.get(s.id);
      };
      flow.steps.forEach(dep);
      const n = Math.max(...depth.values()) + 1, colEls = [];
      cols.replaceChildren();
      nodes = new Map();
      for (let c = 0; c <= n; c++) {
        const col = document.createElement('div');
        col.className = 'fcol';
        const h = document.createElement('p');
        h.className = 'fcol-h';
        h.textContent = c === n ? 'entrega' : `fase ${c + 1}`;
        col.append(h);
        cols.append(col);
        colEls.push(col);
      }
      const add = (id, col, html, label, extra = '') => {
        const el = document.createElement('div');
        el.className = `fnode${extra}`;
        el.dataset.node = id;
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', label);
        el.innerHTML = html;
        col.append(el);
        nodes.set(id, { el, st: $('[data-st]', el), bar: $('.fn-bar i', el), log: $('[data-log]', el) });
      };
      for (const s of flow.steps) add(s.id, colEls[depth.get(s.id)], nodeHtml(s), `Etapa ${s.id}: ${s.title}, ${ROLE_LABEL[s.role]} no ${PROV[s.prov].name}`);
      add('delivery', colEls[n], `<div class="fn-h"><span class="fn-id">entrega</span><span class="fn-state" data-st></span></div><b class="fn-title">Relatório da missão</b>`
        + `<div class="fn-agent">${svgUse('i-check')}<span>só após todas as etapas</span></div><div class="fn-bar"><i></i></div><p class="fn-log" data-log>aguardando as etapas</p>`, 'Entrega: relatório da missão', ' is-delivery');
      goal.textContent = flow.goal;
      reset();
      requestAnimationFrame(layoutWires);
    }

    function layoutWires() {
      const box = canvas.getBoundingClientRect();
      wires.setAttribute('viewBox', `0 0 ${box.width.toFixed(0)} ${box.height.toFixed(0)}`);
      wires.replaceChildren();
      edges = [];
      const pairs = [];
      for (const s of flow.steps) for (const d of s.deps) pairs.push([d, s.id, s.cont === d]);
      const isDep = new Set(flow.steps.flatMap((s) => s.deps));
      for (const s of flow.steps) if (!isDep.has(s.id)) pairs.push([s.id, 'delivery', false]);
      for (const [from, to, cont] of pairs) {
        const a = nodes.get(from).el.getBoundingClientRect(), b = nodes.get(to).el.getBoundingClientRect();
        let d, ex, ey;
        if (b.left >= a.right - 2) { // lado a lado: do meio da direita ao meio da esquerda
          const x1 = a.right - box.left, y1 = a.top - box.top + a.height / 2, x2 = b.left - box.left, y2 = b.top - box.top + b.height / 2, dx = (x2 - x1) / 2;
          d = `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; ex = x2; ey = y2;
        } else { // empilhado (tela estreita): de baixo para cima
          const x1 = a.left - box.left + a.width / 2, y1 = a.bottom - box.top, x2 = b.left - box.left + b.width / 2, y2 = b.top - box.top, dy = (y2 - y1) / 2;
          d = `M${x1} ${y1} C${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`; ex = x2; ey = y2;
        }
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', d);
        const end = document.createElementNS(SVGNS, 'circle');
        end.setAttribute('cx', ex); end.setAttribute('cy', ey); end.setAttribute('r', '3');
        wires.append(path, end);
        if (cont) {
          const mid = path.getPointAtLength(path.getTotalLength() / 2), t = document.createElementNS(SVGNS, 'text');
          t.setAttribute('x', mid.x.toFixed(1)); t.setAttribute('y', (mid.y - 7).toFixed(1)); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'fw-tag');
          t.textContent = 'continua';
          wires.append(t);
        }
        edges.push({ from, to, cont, path, end });
      }
      paintEdges();
    }

    function paintEdges() {
      for (const e of edges) {
        const f = st[e.from]?.state, t = st[e.to]?.state;
        const cls = f === 'completed' && (t === 'completed') ? 'done' : f === 'completed' && ACTIVE.has(t) ? 'live' : '';
        e.path.setAttribute('class', `fw${e.cont ? ' cont' : ''}${cls ? ` ${cls}` : ''}`);
        e.end.setAttribute('class', `fw-end${cls ? ` ${cls}` : ''}`);
      }
    }

    function paintNode(id, state) {
      const n = nodes.get(id);
      st[id].state = state;
      n.el.dataset.state = state;
      const [cls, label] = id === 'delivery' && state === 'completed' ? ['dot-ok', 'pronta'] : STATE[state];
      n.st.replaceChildren();
      const dot = document.createElement('span');
      dot.className = `dot ${cls}`;
      dot.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.textContent = label;
      n.st.append(dot, txt);
      if (state === 'pending') bar(id, 0);
      if (state === 'completed') bar(id, 1);
    }
    const bar = (id, p) => nodes.get(id).bar.style.setProperty('--p', p.toFixed(3));
    const say = (id, text) => { const el = nodes.get(id).log; el.textContent = text; if (!reduced) restart(el, 'tick'); };

    function paintPar(active) {
      [...pips.children].forEach((p, i) => { p.classList.toggle('locked', i >= flow.par); p.classList.toggle('on', i < active); });
      parEl.textContent = `${active} de ${flow.par}`;
    }

    function reset() {
      cancelAnimationFrame(raf);
      running = false; paused = false; simT = 0;
      st = Object.fromEntries([...flow.steps.map((s) => [s.id, { state: 'pending', p: 0, li: -1, waited: false, waitT: 0 }]), ['delivery', { state: 'pending', p: 0 }]]);
      for (const id of nodes.keys()) paintNode(id, 'pending');
      clock.textContent = '00:00';
      runEl.textContent = 'run_—';
      playLbl.textContent = 'Rodar fluxo';
      playBtn.disabled = false;
      status.textContent = `${flow.steps.length} etapas · até ${flow.par} em paralelo · pronto para rodar`;
      paintPar(0);
      paintEdges();
    }

    function start() {
      reset();
      running = true;
      played.add(key);
      runEl.textContent = `run_${Array.from({ length: 8 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;
      playBtn.disabled = true;
      playLbl.textContent = 'Rodando…';
      status.textContent = `Rodando ${flow.steps.length} etapas, até ${flow.par} em paralelo.`;
      if (reduced) { finishAll(); return; }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function finishAll() {
      for (const s of flow.steps) { paintNode(s.id, 'completed'); say(s.id, `✓ ${s.log[s.log.length - 1]}`); }
      paintNode('delivery', 'completed');
      say('delivery', flow.done);
      done();
    }
    function done() {
      running = false;
      playBtn.disabled = false;
      playLbl.textContent = 'Rodar de novo';
      status.textContent = reduced ? `✓ Run concluído · ${flow.done}` : `✓ Run concluído em ${fmtClock(simT)} · ${flow.done}`;
      paintPar(0);
      paintEdges();
    }

    function frame(now) {
      if (!inView) { paused = true; return; } // retoma quando o fluxo volta à tela
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      simT += dt;
      advance(dt);
      clock.textContent = fmtClock(simT);
      if (st.delivery.state === 'completed') { done(); return; }
      raf = requestAnimationFrame(frame);
    }

    function advance(dt) {
      const active = () => flow.steps.filter((s) => ACTIVE.has(st[s.id].state)).length;
      let changed = false;
      // começa o que está pronto (dependências concluídas), sem passar do limite de paralelo
      for (const s of flow.steps) {
        if (st[s.id].state !== 'pending' || !s.deps.every((d) => st[d].state === 'completed') || active() >= flow.par) continue;
        paintNode(s.id, 'running');
        say(s.id, s.cont ? `continua no terminal de ${s.cont}` : `terminal aberto · ${PROV[s.prov].name}`);
        changed = true;
      }
      for (const s of flow.steps) {
        const x = st[s.id];
        if (x.state === 'running') {
          x.p = Math.min(1, x.p + dt / s.dur);
          if (s.wait && !x.waited && x.p >= s.wait.at) { // o agente pediu permissão: a etapa espera você
            x.waited = true; x.waitT = 1.8;
            paintNode(s.id, 'waiting');
            say(s.id, `⏸ ${s.wait.text}`);
            status.textContent = `⏸ ${s.id} aguardando você: ${s.wait.text}`;
            changed = true;
            continue;
          }
          const li = Math.min(s.log.length - 1, Math.floor(x.p * s.log.length));
          if (li !== x.li && x.p > 0.08) { x.li = li; say(s.id, s.log[li]); }
          bar(s.id, x.p);
          if (x.p >= 1) { paintNode(s.id, 'completed'); say(s.id, `✓ ${s.log[s.log.length - 1]}`); changed = true; }
        } else if (x.state === 'waiting') {
          x.waitT -= dt;
          if (x.waitT <= 0) { paintNode(s.id, 'running'); say(s.id, `✓ ${s.wait.ok}`); status.textContent = `Rodando: ${s.id} seguiu com a sua permissão.`; changed = true; }
        }
      }
      const dl = st.delivery;
      if (dl.state === 'pending' && flow.steps.every((s) => st[s.id].state === 'completed')) { paintNode('delivery', 'running'); say('delivery', 'montando o relatório…'); changed = true; }
      if (dl.state === 'running') {
        dl.p = Math.min(1, dl.p + dt / 1.3);
        bar('delivery', dl.p);
        if (dl.p >= 1) { paintNode('delivery', 'completed'); say('delivery', flow.done); changed = true; }
      }
      if (changed) { paintPar(active()); paintEdges(); }
    }

    function pick(k, { auto = false } = {}) {
      key = k;
      tabs.forEach((t) => { const on = t.dataset.flowTab === k; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      render();
      if (auto && inView && !reduced) setTimeout(() => { if (key === k && !running) start(); }, 500);
    }

    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t.dataset.flowTab, { auto: true }));
      t.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const next = tabs[(i + dir + tabs.length) % tabs.length];
        next.focus();
        pick(next.dataset.flowTab, { auto: true });
      });
    });
    playBtn.addEventListener('click', start);
    const relayout = () => requestAnimationFrame(layoutWires);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(canvas); else window.addEventListener('resize', relayout, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    onView(root, (v) => {
      inView = v;
      if (!v) return;
      if (running && paused) { paused = false; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!running && !played.has(key)) setTimeout(() => { if (inView && !running && !played.has(key)) start(); }, 600);
    }, { once: false, threshold: 0.3 });
    render();
  }

  // ---------------------------------------------------------------- 08 · recursos: peças vivas
  const layoutArt = $('[data-layout-art]');
  if (layoutArt) {
    const grid = $('.la-grid', layoutArt), label = $('[data-layout-label]', layoutArt), L = ['grade', 'colunas', 'linhas', 'foco'];
    let i = 0;
    every(layoutArt, 2400, () => { i = (i + 1) % L.length; grid.dataset.layout = L[i]; label.textContent = L[i]; restart(grid, 'swap'); });
  }
  const statesArt = $('[data-states-art]');
  if (statesArt) {
    const items = $$('span', statesArt);
    let i = 0;
    items[0].classList.add('on');
    every(statesArt, 1500, () => { items[i].classList.remove('on'); i = (i + 1) % items.length; items[i].classList.add('on'); });
  }
  const mcpArt = $('.mcp-art');
  if (mcpArt) {
    const items = $$('span', mcpArt);
    let i = 1;
    every(mcpArt, 1100, () => { items.forEach((x) => x.classList.remove('on')); i = (i + 1) % items.length; items[i].classList.add('on'); });
  }

  // ---------------------------------------------------------------- relatório de entrega
  const report = $('[data-report]');
  if (report) reportDemo(report);

  function reportDemo(root) {
    const rows = $$('[data-row]', root);
    const ring = $('[data-ring]', root);
    const status = $('[data-report-status]', root);
    const mascot = $('[data-report-mascot]', root);
    const cta = $('[data-report-cta]', root);
    const C = 2 * Math.PI * 18;
    let run = 0;
    ring.style.strokeDasharray = `${C}`;

    const setRing = (k) => { ring.style.strokeDashoffset = `${C * (1 - k)}`; };
    const setStatus = (done) => {
      status.replaceChildren();
      const dot = document.createElement('span');
      dot.className = `dot ${done ? 'dot-ok' : 'dot-work'}`;
      dot.setAttribute('aria-hidden', 'true');
      status.append(dot, done ? ' pronto para integrar' : ' forjando…');
      status.classList.toggle('done', done);
    };
    const fmt = (v, dec) => (dec ? v.toFixed(dec).replace('.', ',') : String(Math.round(v)));
    function countUp(el, id) {
      const to = parseFloat(el.dataset.num), dec = +(el.dataset.dec || 0), t0 = performance.now();
      const step = (now) => {
        if (id !== run) return;
        const k = Math.min(1, (now - t0) / 700);
        el.textContent = fmt(to * (1 - (1 - k) ** 3), dec);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    function play() {
      const id = ++run;
      if (reduced) { rows.forEach((r) => r.classList.add('in')); setRing(1); setStatus(true); mascot.classList.add('is-idle'); cta.classList.add('ready'); return; }
      rows.forEach((r) => r.classList.remove('in'));
      cta.classList.remove('ready');
      mascot.classList.remove('is-idle');
      setRing(0);
      setStatus(false);
      rows.forEach((r, k) => setTimeout(() => {
        if (id !== run) return;
        r.classList.add('in');
        $$('[data-num]', r).forEach((n) => countUp(n, id));
        setRing((k + 1) / rows.length);
        if (k === rows.length - 1) setTimeout(() => {
          if (id !== run) return;
          setStatus(true);
          mascot.classList.add('is-idle');
          cta.classList.add('ready');
        }, 700);
      }, 900 + k * 750));
    }

    $('[data-report-replay]', root).addEventListener('click', play);
    onView(root, (v) => v && play(), { threshold: 0.35 });
  }

  // ---------------------------------------------------------------- aprovação (segurança)
  const sec = $('[data-sec-term]');
  if (sec) {
    const stateEl = $('[data-sec-state]', sec);
    const lineEl = stateEl.parentElement;
    const dot = $('.dot', lineEl);
    const approve = $('[data-sec-approve]', sec);
    const reject = $('[data-sec-reject]', sec);
    let back = null;
    const decide = (ok) => {
      clearTimeout(back);
      lineEl.classList.toggle('ok', ok);
      lineEl.classList.toggle('err', !ok);
      dot.className = `dot ${ok ? 'dot-ok' : 'dot-err'}`;
      stateEl.textContent = ok ? 'aprovada por você: enviada ao construtor' : 'recusada: o construtor não recebe nada';
      approve.disabled = true;
      reject.disabled = true;
      back = setTimeout(() => {
        lineEl.classList.remove('ok', 'err');
        dot.className = 'dot dot-wait';
        stateEl.textContent = 'pendente: aguardando a sua aprovação';
        approve.disabled = false;
        reject.disabled = false;
      }, 4500);
    };
    approve.addEventListener('click', () => decide(true));
    reject.addEventListener('click', () => decide(false));
  }

  // ---------------------------------------------------------------- planos
  // Planos do FORGE, em reais. Enquanto a lista estiver vazia, a seção "Planos" e os links para ela ficam ocultos.
  // Cada plano: { nome, descricao, mensal: { preco, periodo, nota? }, anual: { preco, periodo, nota? }, itens: [{ t, d }], destaque?, selo?, botao?, link? }
  // Item = { t: nome técnico em destaque, d: explicação curta } (um texto simples também serve). `link` = página de assinatura; sem ele, o botão leva ao download.
  // A comparação completa, por categoria, está na tabela "Compare os planos" em index.html: mantenha as duas alinhadas.
  const PLANOS = [
    {
      nome: 'Grátis', descricao: 'Para conhecer o FORGE com a assinatura de IA que você já tem.',
      mensal: { preco: 'R$ 0', periodo: '' }, anual: { preco: 'R$ 0', periodo: '' },
      itens: [
        { t: 'Maestro via MCP', d: 'divide o pedido e envia as tarefas com a sua aprovação' },
        { t: '4 terminais em paralelo', d: 'num workspace' },
        { t: 'Worktrees isolados', d: 'uma cópia do código por agente' },
        { t: 'Claude Code e Codex CLI', d: 'com a assinatura que você já paga' },
        { t: 'Squads básicos', d: 'Dupla, Squad e Squad de 6' },
        { t: 'Limites em tempo real', d: 'janela de 5 h e semana de cada IA' },
      ],
      botao: 'Baixar grátis',
    },
    {
      nome: 'Pro', descricao: 'A ADE completa, para quem trabalha com agentes todo dia.', destaque: true, selo: 'Recomendado',
      mensal: { preco: 'R$ 49', periodo: '/mês' }, anual: { preco: 'R$ 39', periodo: '/mês', nota: 'R$ 468 cobrados uma vez por ano' },
      itens: [
        { t: 'Tudo do Grátis', d: 'em quantos workspaces quiser' },
        { t: '50 terminais em paralelo', d: 'agentes sem fila' },
        { t: 'Harness completo', d: '16 tipos de tarefa roteados por IA, modelo e esforço' },
        { t: 'Agentes personalizados', d: 'até 20 no harness, com instrução própria' },
        { t: '16 skills prontas', d: 'e loadouts de skills e MCPs por papel' },
        { t: '7 times prontos', d: 'e times montados vaga por vaga' },
        { t: 'Fluxos em DAG', d: 'até 12 etapas, 4 em paralelo, com continueFrom' },
        { t: 'Multi-conta e telemetria', d: 'tokens e custo por agente' },
        { t: 'Modo autônomo e Painel Live', d: 'opcionais, quando você quiser' },
      ],
      botao: 'Assinar o Pro',
    },
    {
      nome: 'Equipes', descricao: 'Para times que querem os mesmos padrões em todas as máquinas.',
      mensal: { preco: 'R$ 89', periodo: '/usuário/mês' }, anual: { preco: 'R$ 71', periodo: '/usuário/mês', nota: 'R$ 852 por usuário, cobrados uma vez por ano' },
      itens: [
        { t: 'Tudo do Pro', d: 'para cada pessoa do time' },
        { t: 'Harness compartilhado', d: 'as mesmas rotas, agentes e skills para todos' },
        { t: 'Times compartilhados', d: 'a mesma composição de squad em toda máquina' },
        { t: 'Gestão de assentos', d: 'adicione e remova pessoas quando quiser' },
        { t: 'Faturamento único', d: 'uma cobrança para a empresa' },
      ],
      botao: 'Assinar para a equipe',
    },
  ];
  const plansSec = $('[data-plans]');
  if (plansSec && PLANOS.length) {
    const grid = $('[data-plans-grid]', plansSec);
    const billBtns = $$('[data-bill-opt]', plansSec);
    const render = (bill) => {
      grid.innerHTML = PLANOS.map((p) => {
        const v = p[bill] || p.mensal;
        return `<article class="pplan${p.destaque ? ' hl' : ''}">`
          + `<p class="pp-n">${esc(p.nome)}${p.selo ? `<span class="pp-tag">${esc(p.selo)}</span>` : ''}</p>`
          + `<p class="pp-p"><strong>${esc(v.preco)}</strong>${v.periodo ? `<span>${esc(v.periodo)}</span>` : ''}</p>`
          + `<p class="pp-note">${v.nota ? esc(v.nota) : '&nbsp;'}</p>`
          + (p.descricao ? `<p class="pp-d">${esc(p.descricao)}</p>` : '')
          + `<ul>${(p.itens || []).map((x) => (typeof x === 'string'
            ? `<li>${svgUse('i-check')}<span>${esc(x)}</span></li>`
            : `<li>${svgUse('i-check')}<span><b>${esc(x.t)}</b>${x.d ? ` <em>${esc(x.d)}</em>` : ''}</span></li>`)).join('')}</ul>`
          + `<a class="btn ${p.destaque ? 'btn-primary' : 'btn-ghost'}" href="${esc(p.link || '#baixar')}">${esc(p.botao || 'Começar')}</a></article>`;
      }).join('');
      billBtns.forEach((b) => { const on = b.dataset.billOpt === bill; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    };
    billBtns.forEach((b, i) => {
      b.addEventListener('click', () => render(b.dataset.billOpt));
      b.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const next = billBtns[(i + dir + billBtns.length) % billBtns.length];
        next.focus();
        render(next.dataset.billOpt);
      });
    });
    render('mensal');
    plansSec.hidden = false;
    for (const li of $$('[data-plans-link]')) li.hidden = false;
  }

  // ---------------------------------------------------------------- downloads
  // Sem link público ainda: o botão leva à seção "Comece agora" e explica, em vez de baixar.
  const note = $('[data-dl-note]');
  for (const a of $$('[data-download]')) {
    const url = DOWNLOADS[a.dataset.download];
    if (url) { a.href = url; continue; }
    a.addEventListener('click', () => {
      if (note) note.textContent = 'O link público dos instaladores ainda não foi publicado. Ele aparece aqui assim que a versão estiver disponível.';
    });
  }
})();
