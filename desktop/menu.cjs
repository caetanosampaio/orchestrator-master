// Menu do app desktop (Ajuda + diagnóstico). Módulo puro: app/shell/dialog/clipboard entram por injeção para testar sem Electron.
const { macMenuTemplate } = require('./mac-env.cjs');

/** Texto de diagnóstico para o cliente colar num chamado. Só metadados do app: nunca token, variáveis de ambiente, workspaces nem conteúdo do banco. */
function diagnosticText({ app, versions = process.versions, platform = process.platform, arch = process.arch, osRelease = '', logsDir, dataDir }) {
  return [
    `${app.getName()} ${app.getVersion()}`,
    `Electron ${versions.electron || '?'} (Node embutido ${versions.node || '?'}, Chrome ${versions.chrome || '?'})`,
    `Sistema: ${platform} ${osRelease} ${arch}`.replace(/\s+/g, ' ').trim(),
    `Pasta de logs: ${logsDir}`,
    `Pasta de dados: ${dataDir}`,
  ].join('\n');
}

function helpMenu({ app, shell, dialog, clipboard, logsDir, dataDir, osRelease, versions, platform, arch, getWindow = () => undefined }) {
  return {
    label: 'Ajuda',
    submenu: [
      { label: 'Abrir pasta de logs', click: () => { shell.openPath(logsDir); } },
      { label: 'Copiar informações de diagnóstico', click: () => { clipboard.writeText(diagnosticText({ app, versions, platform, arch, osRelease, logsDir, dataDir })); } },
      { type: 'separator' },
      { label: 'Sobre o FORGE', click: () => { dialog.showMessageBox(getWindow(), { type: 'info', title: 'Sobre o FORGE', message: `FORGE ${app.getVersion()}`, detail: `Electron ${(versions || process.versions).electron || '?'}`, buttons: ['OK'] }); } },
    ],
  };
}

/** Windows/Linux: Editar (atalhos Ctrl+C/V) + Ajuda; macOS: o menu existente + Ajuda. Nada do menu anterior é removido. */
function buildMenuTemplate(opts) {
  const help = helpMenu(opts);
  if ((opts.platform || process.platform) === 'darwin') return [...macMenuTemplate(), help];
  return [{ role: 'editMenu' }, help];
}

module.exports = { buildMenuTemplate, diagnosticText };
