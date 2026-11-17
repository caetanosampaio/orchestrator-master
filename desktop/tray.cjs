// O FORGE na barra de menus (macOS) e na área de notificação (Windows/Linux): o ferreiro da logo, com o VAPOR subindo enquanto algum agente
// trabalha; no macOS, a CPU ao vivo ao lado do ícone (opcional); no Windows, a barra de tarefas mostra o progresso indeterminado (animação nativa)
// enquanto há trabalho. O menu traz o consumo (CPU, RAM, GPU), os agentes trabalhando, os workspaces, a captura de tela e as opções do FORGE.
// Os dados vêm do MESMO servidor local (com o token de sessão do boot), nunca de leitura própria do banco.
const fs = require('node:fs');
const path = require('node:path');
const { metricsLine } = require('./metrics.cjs');

const FRAMES = 6, FRAME_MS = 170, POLL_MS = 2500;

/** Quantos agentes trabalham agora e quantos esperam por você, pela mesma regra dos hooks que a interface usa (agent.state). */
function agentCounts(sessions) {
  const live = (Array.isArray(sessions) ? sessions : []).filter((s) => s && s.status === 'running');
  return { running: live.length, working: live.filter((s) => s.agent?.state === 'running').length, waiting: live.filter((s) => s.agent?.state === 'waiting').length };
}
/** Título curto ao lado do ícone na barra de menus do macOS: só a CPU (o resto fica no menu, para a barra não ficar larga). */
const menuBarTitle = ({ cpu } = {}, enabled = true) => (enabled && Number.isFinite(cpu) ? ` ${String(cpu).padStart(2, ' ')}%` : '');
/** Linha de estado do topo do menu. */
function statusLine({ working, waiting, running }) {
  if (working) return `${working} ${working === 1 ? 'agente trabalhando' : 'agentes trabalhando'}${waiting ? ` · ${waiting} aguardando você` : ''}`;
  if (waiting) return `${waiting} ${waiting === 1 ? 'agente aguardando você' : 'agentes aguardando você'}`;
  return running ? `${running} ${running === 1 ? 'terminal aberto' : 'terminais abertos'}, todos ociosos` : 'Nenhum terminal aberto';
}

function readPrefs(file) { try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return { cpuInMenuBar: p.cpuInMenuBar !== false }; } catch { return { cpuInMenuBar: true }; } }
function writePrefs(file, prefs) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(prefs, null, 2)); } catch { /* conveniência: falha não quebra nada */ } }

/**
 * Cria a bandeja. Tudo do Electron entra por injeção. `api(path, init)` chama o servidor local com o token; `showWindow(hash)` mostra a janela
 * principal e navega a interface (ex.: '#/cockpit'); `capture(kind)` faz a captura ('area' | 'screen').
 */
function createForgeTray({ Tray, Menu, nativeImage, platform = process.platform, iconsDir, prefsFile, api, showWindow, capture, sampler, getWindow, quit }) {
  const mac = platform === 'darwin', win = platform === 'win32';
  const name = (base, k) => path.join(iconsDir, `${mac ? 'trayTemplate' : 'tray'}${k === null ? '' : `-work-${k}`}.png`);
  const load = (file) => { const img = nativeImage.createFromPath(file); if (mac) img.setTemplateImage(true); return img; };
  const idle = load(name('', null)), frames = Array.from({ length: FRAMES }, (_, k) => load(name('', k)));
  const tray = new Tray(idle);
  tray.setToolTip('Forge');
  let prefs = readPrefs(prefsFile), metrics = {}, counts = { running: 0, working: 0, waiting: 0 }, workspaces = [], activeId = null, frame = 0, anim = null, poll = null, stopSampler = null;

  const setTitle = () => { if (mac) tray.setTitle(menuBarTitle(metrics, prefs.cpuInMenuBar), { fontType: 'monospacedDigit' }); };
  const animate = (on) => {
    if (on && !anim) { anim = setInterval(() => { frame = (frame + 1) % FRAMES; tray.setImage(frames[frame]); }, FRAME_MS); anim.unref?.(); }
    if (!on && anim) { clearInterval(anim); anim = null; tray.setImage(idle); }
    const w = getWindow?.(); if (w && !w.isDestroyed() && !mac) w.setProgressBar(on ? 2 : -1, { mode: on ? 'indeterminate' : 'none' }); // Windows/Linux: animação nativa no botão da barra de tarefas
  };
  const openWorkspace = async (id) => {
    try { await api(`/api/workspaces/${id}/open`, { method: 'POST' }); await api(`/api/workspaces/${id}/activate`, { method: 'POST' }); } catch { /* a janela abre mesmo assim */ }
    showWindow('#/cockpit');
  };
  const rebuild = () => {
    const tpl = [
      { label: `Forge · ${statusLine(counts)}`, enabled: false },
      { label: metricsLine(metrics), enabled: false },
      { type: 'separator' },
      { label: 'Abrir o Forge', click: () => showWindow(null) },
      { label: 'Terminais', click: () => showWindow('#/cockpit') },
      { label: 'Missões', click: () => showWindow('#/missions') },
      { label: 'Workspaces', enabled: workspaces.length > 0, submenu: workspaces.length ? workspaces.slice(0, 20).map((w) => ({ label: `${w.id === activeId ? '● ' : ''}${w.displayName || w.name}`, click: () => openWorkspace(w.id) })) : [{ label: 'Nenhum workspace', enabled: false }] },
      { type: 'separator' },
      { label: 'Capturar área da tela…', accelerator: 'CommandOrControl+Shift+2', click: () => capture('area') },
      { label: 'Capturar tela inteira', click: () => capture('screen') },
      { type: 'separator' },
      ...(mac ? [{ label: 'Mostrar a CPU na barra de menus', type: 'checkbox', checked: prefs.cpuInMenuBar, click: (item) => { prefs = { ...prefs, cpuInMenuBar: item.checked }; writePrefs(prefsFile, prefs); setTitle(); } }] : []),
      { label: 'Configurações', click: () => showWindow('#/settings') },
      { type: 'separator' },
      { label: 'Sair do Forge', click: () => quit() },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(tpl));
  };
  const refresh = async () => {
    try {
      const [t, ws, st] = await Promise.all([api('/api/terminals'), api('/api/workspaces'), api('/api/state')]);
      counts = agentCounts(t?.sessions); workspaces = Array.isArray(ws) ? ws : []; activeId = st?.activeWorkspace?.id ?? null;
    } catch { /* servidor subindo ou reiniciando: mantém o último */ }
    animate(counts.working > 0);
    tray.setToolTip(`Forge · ${statusLine(counts)}\n${metricsLine(metrics)}`);
    rebuild();
  };
  if (!mac) tray.on('click', () => showWindow(null)); // Windows/Linux: clique simples abre a janela; o menu fica no botão direito
  stopSampler = sampler((m) => { metrics = m; setTitle(); });
  refresh(); poll = setInterval(refresh, POLL_MS); poll.unref?.();
  return { tray, destroy() { clearInterval(poll); animate(false); stopSampler?.(); if (!tray.isDestroyed()) tray.destroy(); } };
}

module.exports = { createForgeTray, agentCounts, menuBarTitle, statusLine, readPrefs, FRAMES };
