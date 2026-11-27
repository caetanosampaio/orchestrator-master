// Grava no atalho o mesmo AppUserModelID da janela do FORGE DEV (o WScript.Shell não sabe fazer isso): fixado, atalho e janela viram um botão só.
const { app, shell } = require('electron');
const file = process.argv[process.argv.length - 1];
app.whenReady().then(() => {
  const ok = shell.writeShortcutLink(file, 'update', { ...shell.readShortcutLink(file), appUserModelId: 'local.forge-dev.source' });
  console.log(ok ? 'atalho ligado à janela do FORGE DEV' : 'não foi possível gravar o id no atalho');
  app.exit(ok ? 0 : 1);
});
