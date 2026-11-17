// Captura de tela do FORGE: o usuário seleciona uma área (ou a tela inteira), a imagem vai para a pasta de dados (captures/) e aparece uma
// miniatura flutuante no canto da tela, que ele ARRASTA para um terminal (o caminho entra na conversa do agente) ou copia.
// Ferramentas nativas, sempre por execFile (sem shell): macOS `screencapture -i`; Windows o recorte do sistema (ms-screenclip:) lido da área
// de transferência; Linux gnome-screenshot, spectacle ou grim+slurp. Tela inteira usa o desktopCapturer do Electron em qualquer sistema.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const KEEP = 50; // capturas guardadas; as mais antigas saem
const NAME_RE = /^forge-\d{8}-\d{6}-\d{3}\.png$/;

/** forge-AAAAMMDD-HHMMSS-mmm.png (hora local): ordena por nome e nunca colide na mesma pasta. */
function captureName(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `forge-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}.png`;
}
/** Apaga as capturas além das `keep` mais novas (só arquivos com o nome do FORGE: nada mais da pasta é tocado). */
function prune(dir, keep = KEEP) {
  let files = []; try { files = fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).sort(); } catch { return 0; }
  const old = files.slice(0, Math.max(0, files.length - keep));
  for (const f of old) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* em uso */ } }
  return old.length;
}

const run = (cmd, args, timeout = 120000) => new Promise((resolve) => { try { execFile(cmd, args, { timeout, windowsHide: true }, (err) => resolve(!err)); } catch { resolve(false); } });
const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const which = (bin) => (process.env.PATH ?? '').split(path.delimiter).some((d) => { try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return true; } catch { return false; } });

/** Captura uma ÁREA escolhida pelo usuário. Devolve o caminho do PNG ou null (cancelou ou sem ferramenta). */
async function captureArea({ dir, clipboard, shell, platform = process.platform, waitMs = 60000 }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, captureName());
  if (platform === 'darwin') { await run('screencapture', ['-i', '-x', '-t', 'png', file]); return exists(file) ? file : null; } // Esc no seletor = cancelado (sem arquivo)
  if (platform === 'win32') {
    // o recorte do Windows copia para a área de transferência: espera uma imagem NOVA aparecer lá
    const before = clipboard.readImage(); const sig = before.isEmpty() ? '' : before.toDataURL().slice(-64);
    await shell.openExternal('ms-screenclip:');
    for (let t = 0; t < waitMs; t += 400) {
      await new Promise((r) => setTimeout(r, 400));
      const img = clipboard.readImage();
      if (!img.isEmpty() && img.toDataURL().slice(-64) !== sig) { fs.writeFileSync(file, img.toPNG()); return file; }
    }
    return null;
  }
  // Linux: a primeira ferramenta disponível
  if (which('gnome-screenshot') && await run('gnome-screenshot', ['-a', '-f', file]) && exists(file)) return file;
  if (which('spectacle') && await run('spectacle', ['-r', '-b', '-n', '-o', file]) && exists(file)) return file;
  if (which('slurp') && which('grim')) {
    const geo = await new Promise((resolve) => { try { execFile('slurp', [], { timeout: waitMs }, (err, out) => resolve(err ? null : String(out).trim())); } catch { resolve(null); } });
    if (geo && /^\d+,\d+ \d+x\d+$/.test(geo) && await run('grim', ['-g', geo, file]) && exists(file)) return file;
  }
  return null;
}

/** Captura a tela inteira (a tela onde está o cursor) pelo desktopCapturer. */
async function captureScreen({ dir, desktopCapturer, screen }) {
  fs.mkdirSync(dir, { recursive: true });
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(d.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  const file = path.join(dir, captureName()); fs.writeFileSync(file, src.thumbnail.toPNG());
  return file;
}

/** HTML da miniatura flutuante (página local, sem rede): a imagem entra como data URL; o texto é fixo. */
function cardHtml(dataUrl) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;font:12px -apple-system,'Segoe UI',system-ui,sans-serif;color:#eee;-webkit-user-select:none;user-select:none;overflow:hidden}
.c{position:absolute;inset:8px;border-radius:12px;background:#232323;border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;animation:in .28s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(10px) scale(.97)}}
.img{flex:1;min-height:0;display:grid;place-items:center;background:#1a1a1a;cursor:grab;padding:8px}
.img:active{cursor:grabbing}
.img img{max-width:100%;max-height:100%;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.08);pointer-events:none}
.bar{display:flex;align-items:center;gap:4px;padding:7px 8px;border-top:1px solid rgba(255,255,255,.07)}
.hint{flex:1;color:#a1a1a1}
button{border:0;border-radius:6px;background:transparent;color:#d8d8d8;font:inherit;padding:4px 8px;cursor:pointer}
button:hover{background:rgba(255,255,255,.08);color:#fff}
.x{width:24px;padding:4px 0}
</style></head><body><div class="c">
<div class="img" id="drag" draggable="true" title="Arraste para um terminal do Forge"><img src="${dataUrl}" alt="Captura de tela"></div>
<div class="bar"><span class="hint">Arraste para um terminal</span><button id="copy">Copiar</button><button id="show">Pasta</button><button class="x" id="close" aria-label="Fechar">✕</button></div>
</div><script>
const f = window.forgeCapture;
document.getElementById('drag').addEventListener('dragstart', (e) => { e.preventDefault(); f.drag(); });
document.getElementById('copy').addEventListener('click', () => f.copy());
document.getElementById('show').addEventListener('click', () => f.show());
document.getElementById('close').addEventListener('click', () => f.close());
let t = setTimeout(() => f.close(), 25000);
document.body.addEventListener('mouseenter', () => clearTimeout(t));
document.body.addEventListener('mouseleave', () => { t = setTimeout(() => f.close(), 8000); });
</script></body></html>`;
}

/**
 * Mostra a miniatura da captura no canto da tela (sempre por cima, sem roubar o foco). A página fala com o processo principal só por 4 mensagens
 * (arrastar, copiar, mostrar na pasta, fechar), conferidas pelo remetente: nenhuma outra janela pode pedir para arrastar um arquivo.
 */
function showCaptureCard({ file, BrowserWindow, ipcMain, nativeImage, clipboard, shell, screen, preload }) {
  const img = nativeImage.createFromPath(file); if (img.isEmpty()) return null;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width: iw, height: ih } = img.getSize(), W = 300, H = Math.round(Math.min(260, Math.max(150, (W - 32) * (ih / Math.max(1, iw)) + 70)));
  const card = new BrowserWindow({ width: W, height: H, x: area.x + area.width - W - 16, y: area.y + area.height - H - 16, frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false, hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload, devTools: false } });
  card.setAlwaysOnTop(true, 'floating');
  const thumb = img.resize({ width: Math.min(560, iw) });
  const handlers = {
    'forge-capture:drag': () => card.webContents.startDrag({ file, icon: img.resize({ width: 96 }) }),
    'forge-capture:copy': () => clipboard.writeImage(img),
    'forge-capture:show': () => shell.showItemInFolder(file),
    'forge-capture:close': () => { if (!card.isDestroyed()) card.close(); },
  };
  const listeners = Object.entries(handlers).map(([ch, fn]) => { const l = (e) => { if (e.sender === card.webContents) fn(); }; ipcMain.on(ch, l); return [ch, l]; });
  card.on('closed', () => listeners.forEach(([ch, l]) => ipcMain.removeListener(ch, l)));
  card.webContents.on('will-navigate', (e) => e.preventDefault());
  card.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  card.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cardHtml(thumb.toDataURL()))}`);
  card.once('ready-to-show', () => card.showInactive());
  return card;
}

module.exports = { captureName, prune, captureArea, captureScreen, cardHtml, showCaptureCard, KEEP, NAME_RE };
