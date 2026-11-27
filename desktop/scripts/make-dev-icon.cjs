// Ícones do FORGE DEV: a arte do FORGE (já gerada por make-icon.mjs) com um selo "DEV" em laranja. Rasteriza com o próprio Electron:
//   desktop> npx electron scripts/make-dev-icon.cjs
// Gera build/icon-dev.ico, build/icon-dev.png (512) e build/tray-dev/*.png (Windows/Linux). Os ícones do app instalado não mudam.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILD = path.resolve(__dirname, '..', 'build');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-dev-icon-'));
app.setPath('userData', profile);

// Roda na página. Letras em grade 3x5: continuam legíveis em 16 px; acima de 48 px usa fonte pesada.
function paint(base64, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, size, size);
      const GLYPHS = { D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], V: ['101', '101', '101', '101', '010'] };
      const ORANGE = '#ff7a1a', DARK = '#14100d';
      if (size <= 48) {
        const k = Math.max(1, Math.floor(size / 16)), w = 13 * k, h = 7 * k, x = Math.round((size - w) / 2), y = size - h;
        g.fillStyle = DARK; g.fillRect(x, y, w, h);
        g.fillStyle = ORANGE;
        [...'DEV'].forEach((ch, i) => GLYPHS[ch].forEach((row, r) => [...row].forEach((bit, col) => { if (bit === '1') g.fillRect(x + (1 + i * 4 + col) * k, y + (1 + r) * k, k, k); })));
      } else {
        const w = size * 0.86, h = size * 0.36, x = (size - w) / 2, y = size - h - size * 0.02, line = Math.max(2, size * 0.022);
        g.beginPath(); g.roundRect(x, y, w, h, h * 0.24); g.fillStyle = DARK; g.fill(); g.lineWidth = line; g.strokeStyle = ORANGE; g.stroke();
        g.fillStyle = ORANGE; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${Math.round(h * 0.78)}px "Segoe UI", sans-serif`;
        g.fillText('DEV', size / 2, y + h * 0.54, w * 0.86);
      }
      resolve(c.toDataURL('image/png').split(',')[1]);
    };
    img.src = `data:image/png;base64,${base64}`;
  });
}

/** ICO com PNGs embutidos: ICONDIR + uma entrada de 16 bytes por imagem. */
function ico(images) {
  const dir = Buffer.alloc(6 + 16 * images.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let off = dir.length;
  images.forEach(([n, buf], i) => { const o = 6 + 16 * i; dir.writeUInt8(n >= 256 ? 0 : n, o); dir.writeUInt8(n >= 256 ? 0 : n, o + 1); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(off, o + 12); off += buf.length; });
  return Buffer.concat([dir, ...images.map(([, b]) => b)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('about:blank');
  const render = async (source, size) => Buffer.from(await win.webContents.executeJavaScript(`(${paint.toString()})(${JSON.stringify(fs.readFileSync(source).toString('base64'))}, ${size})`), 'base64');
  const sourceFor = (n) => { const f = path.join(BUILD, 'icons', `${n}x${n}.png`); return fs.existsSync(f) ? f : path.join(BUILD, 'icon.png'); };
  const images = [];
  for (const n of [16, 24, 32, 48, 64, 128, 256]) images.push([n, await render(sourceFor(n), n)]);
  fs.writeFileSync(path.join(BUILD, 'icon-dev.ico'), ico(images));
  fs.writeFileSync(path.join(BUILD, 'icon-dev.png'), await render(path.join(BUILD, 'icon.png'), 512));
  const out = path.join(BUILD, 'tray-dev'); fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(path.join(BUILD, 'tray')).filter((f) => /^tray(-work-\d)?(@2x)?\.png$/.test(f))) {
    fs.writeFileSync(path.join(out, name), await render(path.join(BUILD, 'tray', name), name.includes('@2x') ? 36 : 18));
  }
  console.log('ícones do FORGE DEV gerados em', BUILD);
  app.exit(0);
}).catch((e) => { console.error(e); app.exit(1); });
app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temporário do sistema */ } });
