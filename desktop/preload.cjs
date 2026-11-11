// Preload da janela: expõe à página SÓ o que ela precisa para saber que roda no app desktop: a plataforma e a versão do app (passada pelo processo principal em --forge-version).
// Nada de Node, de ipc nem de caminho: a página continua sem nenhum acesso ao sistema (contextIsolation e sandbox ligados).
const { contextBridge } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--forge-version='));
const version = arg ? arg.slice('--forge-version='.length).replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 32) : '';
contextBridge.exposeInMainWorld('forgeDesktop', Object.freeze({ platform: process.platform, version }));
