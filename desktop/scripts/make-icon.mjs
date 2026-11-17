// Gera TODA a arte do app a partir de duas fontes do cliente: a logo (client/src/forge-logo.mjs, o ferreiro de traço à mão) e a cena da forja
// (client/src/forge-scene.js, pixel art original). Roda em Windows, macOS e Linux: usa um Chromium instalado (Chrome, Edge, Chromium ou Brave),
// headless via CDP e com perfil temporário apagado no fim, só para rasterizar.
//
//   build/icon.ico, build/icon.png (512)            Windows (instalador, atalho, barra de tarefas) e janela
//   build/icon-mac.png (1024)                       macOS: na grade da Apple (conteúdo 824 px, cantos ~22%)
//   build/icons/<n>x<n>.png                         Linux (AppImage e .deb): 16 a 512
//   build/tray/trayTemplate[-work-N][@2x].png       barra de menus do macOS: imagem "template" (preta + alfa; o sistema inverte no tema escuro)
//   build/tray/tray[-work-N][@2x].png               área de notificação do Windows e do Linux (traço claro, legível na barra escura)
//   build/installerSidebar.bmp, uninstallerSidebar.bmp (164x314) e installerHeader.bmp (150x57)   NSIS: BMP 24 bits
//   build/dmg-background.png (660x400) e @2x        janela do .dmg
//   ../client/public/favicon.svg                    favicon da interface
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'build');
const { logoSvg, appIconSvg } = await import(pathToFileURL(path.join(ROOT, 'client', 'src', 'forge-logo.mjs')).href);
// a cena é um módulo ES do cliente: entra na página como script (sem `export`) para não depender de servir arquivos
const SCENE_JS = fs.readFileSync(path.join(ROOT, 'client', 'src', 'forge-scene.js'), 'utf8').replace(/^export /gm, '');

const BROWSERS = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
};
const BROWSER = process.env.FORGE_ART_BROWSER || (BROWSERS[process.platform] ?? []).find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('Nenhum Chrome/Edge/Chromium encontrado para rasterizar a arte (defina FORGE_ART_BROWSER com o caminho).');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-art-')), port = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

/** Uma página só: cada arte é desenhada num canvas pela função `paint` (texto JS) e volta como PNG (data URL) ou RGBA (para o BMP). */
async function withPage(fn) {
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* subindo */ } await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><body style="margin:0"></body></html>')}` }); await sleep(500);
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };
  await ev(`(() => { const s = document.createElement('script'); s.textContent = ${JSON.stringify(`${SCENE_JS}\nwindow.__scene = { drawScene, W, H };`)}; document.body.appendChild(s); return true; })()`);
  // helpers na página: carregar SVG como imagem e devolver o canvas como PNG ou RGBA
  await ev(`(() => {
    window.svgImg = (svg) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    window.canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
    window.sceneCanvas = (t) => { const [c, g] = canvas(__scene.W, __scene.H); __scene.drawScene(g, t); return c; };
    window.out = (c, rgba) => {
      if (!rgba) return c.toDataURL('image/png').split(',')[1];
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array((d.length / 4) * 3);
      for (let i = 0, j = 0; i < d.length; i += 4) { rgb[j++] = d[i]; rgb[j++] = d[i + 1]; rgb[j++] = d[i + 2]; }
      let s = ''; for (let i = 0; i < rgb.length; i += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(i, i + 0x8000)); // em blocos: sem estourar a pilha
      return btoa(s);
    };
    return true; })()`);
  try { return await fn(ev); } finally { ws.close(); }
}

const png = (b64) => Buffer.from(b64, 'base64');
/** Rasteriza um SVG num PNG de `size` px (fundo transparente). */
const svgPng = (ev, svg, size) => ev(`(async () => { const [c, g] = canvas(${size}, ${size}); g.imageSmoothingEnabled = true; g.drawImage(await svgImg(${JSON.stringify(svg)}), 0, 0, ${size}, ${size}); return out(c); })()`).then(png);

/** BMP 24 bits de baixo para cima (o formato que o NSIS aceita), a partir de RGB cru. */
function bmp24(rgbB64, w, h) {
  const rgb = Buffer.from(rgbB64, 'base64'), row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34); b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 3, d = 54 + (h - 1 - y) * row + x * 3; b[d] = rgb[s + 2]; b[d + 1] = rgb[s + 1]; b[d + 2] = rgb[s]; }
  return b;
}
/** ICO com PNGs embutidos (Vista+): ICONDIR + uma entrada de 16 bytes por imagem. */
function ico(images) {
  const dir = Buffer.alloc(6 + 16 * images.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let off = dir.length;
  images.forEach(([n, buf], i) => { const o = 6 + 16 * i; dir.writeUInt8(n >= 256 ? 0 : n, o); dir.writeUInt8(n >= 256 ? 0 : n, o + 1); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(off, o + 12); off += buf.length; });
  return Buffer.concat([dir, ...images.map(([, b]) => b)]);
}

const write = (rel, buf) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return rel; };
const made = [];
const STEAM_FRAMES = [{ dy: 0, opacity: 1 }, { dy: 1.5, opacity: 0.85 }, { dy: 3, opacity: 0.6 }, { dy: 4.5, opacity: 0.3 }, { dy: -1.5, opacity: 0.45 }, { dy: -0.5, opacity: 0.8 }]; // o vapor sobe, some e volta

try {
  await withPage(async (ev) => {
    // ---------- ícones do app ----------
    const winSizes = [16, 24, 32, 48, 64, 128, 256];
    const win = [];
    for (const n of winSizes) win.push([n, await svgPng(ev, appIconSvg({ size: n, platform: 'win' }), n)]);
    made.push(write('icon.ico', ico(win)));
    made.push(write('icon.png', await svgPng(ev, appIconSvg({ size: 512, platform: 'win' }), 512)));
    made.push(write('icon-mac.png', await svgPng(ev, appIconSvg({ size: 1024, platform: 'mac' }), 1024)));
    for (const n of [16, 32, 48, 64, 128, 256, 512]) made.push(write(`icons/${n}x${n}.png`, await svgPng(ev, appIconSvg({ size: n, platform: 'win' }), n)));

    // ---------- bandeja / barra de menus (parado + quadros do vapor enquanto os agentes trabalham) ----------
    for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
      const n = 18 * scale; // 18 pt: altura confortável na barra de menus do macOS; o Windows reduz para 16 sozinho
      made.push(write(`tray/trayTemplate${suffix}.png`, await svgPng(ev, logoSvg({ variant: 'mark', ink: '#000000', stroke: 3.6 }), n)));
      made.push(write(`tray/tray${suffix}.png`, await svgPng(ev, logoSvg({ variant: 'mark', ink: '#f2efe8', stroke: 3.6 }), n)));
      for (const [k, steam] of STEAM_FRAMES.entries()) {
        made.push(write(`tray/trayTemplate-work-${k}${suffix}.png`, await svgPng(ev, logoSvg({ variant: 'mark', ink: '#000000', stroke: 3.6, steam }), n)));
        made.push(write(`tray/tray-work-${k}${suffix}.png`, await svgPng(ev, logoSvg({ variant: 'mark', ink: '#f2efe8', stroke: 3.6, steam }), n)));
      }
    }

    // ---------- NSIS: lateral (164x314) e cabeçalho (150x57), quadros da cena ----------
    const LOGO_LIGHT = logoSvg({ variant: 'mark', ink: '#ece9e2', stroke: 2.8 });
    const sidebar = await ev(`(async () => {
      const [c, g] = canvas(164, 314);
      g.fillStyle = '#1d1e26'; g.fillRect(0, 0, 164, 314);
      const s = sceneCanvas(${1300 * 4 + 1300 * 0.9}); // instante logo depois do golpe: faíscas no ar
      g.drawImage(s, 52, 20, 82, 108, 0, 98, 164, 216); // recorte da bigorna e da fornalha, ampliado 2x (pixels inteiros)
      const grad = g.createLinearGradient(0, 90, 0, 150); grad.addColorStop(0, '#1d1e26'); grad.addColorStop(1, 'rgba(29,30,38,0)'); g.fillStyle = grad; g.fillRect(0, 90, 164, 60);
      g.imageSmoothingEnabled = true; g.drawImage(await svgImg(${JSON.stringify(LOGO_LIGHT)}), 18, 22, 34, 34);
      g.fillStyle = '#ece9e2'; g.font = '600 19px -apple-system, Segoe UI, sans-serif'; g.fillText('Forge', 58, 46);
      g.fillStyle = '#8f8d9b'; g.font = '11px -apple-system, Segoe UI, sans-serif'; g.fillText('Agentes de IA,', 18, 78); g.fillText('trabalhando juntos.', 18, 92);
      return out(c, true); })()`);
    made.push(write('installerSidebar.bmp', bmp24(sidebar, 164, 314)), write('uninstallerSidebar.bmp', bmp24(sidebar, 164, 314)));
    const header = await ev(`(async () => {
      const [c, g] = canvas(150, 57);
      g.fillStyle = '#1d1e26'; g.fillRect(0, 0, 150, 57);
      const s = sceneCanvas(${1300 * 4 + 1300 * 0.9}); g.drawImage(s, 76, 72, 60, 38, 46, 0, 104, 66); // bigorna e faíscas, à direita
      const grad = g.createLinearGradient(40, 0, 90, 0); grad.addColorStop(0, '#1d1e26'); grad.addColorStop(1, 'rgba(29,30,38,0)'); g.fillStyle = grad; g.fillRect(40, 0, 50, 57);
      g.imageSmoothingEnabled = true; g.drawImage(await svgImg(${JSON.stringify(LOGO_LIGHT)}), 10, 12, 32, 32);
      return out(c, true); })()`);
    made.push(write('installerHeader.bmp', bmp24(header, 150, 57)));

    // ---------- .dmg: fundo com a cena embaixo e a indicação de arrastar ----------
    for (const [k, suffix] of [[1, ''], [2, '@2x']]) {
      const b64 = await ev(`(async () => {
        const k = ${k}, [c, g] = canvas(660 * k, 400 * k);
        g.fillStyle = '#1d1e26'; g.fillRect(0, 0, 660 * k, 400 * k);
        const s = sceneCanvas(${1300 * 6 + 1300 * 0.4});
        const sc = 2 * k, sx = Math.round((660 * k - 192 * sc) / 2), top = 400 * k - 64 * sc; // cena 2x centralizada: só a faixa de baixo (fornalha, ferreiro e chão)
        g.drawImage(s, 0, 64, 192, 64, sx, top, 192 * sc, 64 * sc);
        g.fillStyle = '#3a2f28'; g.fillRect(0, 400 * k - (128 - 104) * sc, sx + 1, (128 - 104) * sc); g.fillRect(sx + 192 * sc - 1, 400 * k - (128 - 104) * sc, sx + 2, (128 - 104) * sc); // o chão continua até as bordas
        g.fillStyle = '#4b3c31'; g.fillRect(0, 400 * k - (128 - 104) * sc, 660 * k, sc); // e a linha do chão também
        for (const [x0, x1] of [[sx, sx + 70 * k], [sx + 192 * sc, sx + 192 * sc - 70 * k]]) { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, '#1d1e26'); gr.addColorStop(1, 'rgba(29,30,38,0)'); g.fillStyle = gr; g.fillRect(Math.min(x0, x1), top, 70 * k, 400 * k - (128 - 104) * sc - top); } // laterais da cena somem no fundo
        const grad = g.createLinearGradient(0, top, 0, top + 26 * k); grad.addColorStop(0, '#1d1e26'); grad.addColorStop(1, 'rgba(29,30,38,0)'); g.fillStyle = grad; g.fillRect(0, top, 660 * k, 26 * k);
        g.imageSmoothingEnabled = true;
        g.strokeStyle = 'rgba(236,233,226,.55)'; g.lineWidth = 2 * k; g.lineCap = 'round'; g.setLineDash([2 * k, 7 * k]);
        g.beginPath(); g.moveTo(262 * k, 130 * k); g.lineTo(396 * k, 130 * k); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.moveTo(388 * k, 123 * k); g.lineTo(398 * k, 130 * k); g.lineTo(388 * k, 137 * k); g.stroke();
        g.fillStyle = '#b8b5c2'; g.font = (13 * k) + 'px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('Arraste o Forge para Aplicativos', 330 * k, 222 * k);
        return out(c); })()`);
      made.push(write(`dmg-background${suffix}.png`, png(b64)));
    }
  });
  // ---------- favicon ----------
  fs.writeFileSync(path.join(ROOT, 'client', 'public', 'favicon.svg'), appIconSvg({ size: 64, platform: 'win' }));
  made.push('../client/public/favicon.svg');
} finally {
  proc.kill(); await sleep(800);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(600); } }
}
console.log(`arte gerada (${made.length} arquivos):\n  ${made.join('\n  ')}`);
