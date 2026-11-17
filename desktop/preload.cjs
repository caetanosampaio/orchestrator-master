// Preload da janela: expõe à página SÓ o que ela precisa para saber que roda no app desktop: a plataforma e a versão do app (passada pelo processo principal em --forge-version).
// Nada de Node nem de ipc: a página continua sem nenhum acesso ao sistema (contextIsolation e sandbox ligados). A única exceção é `pathForFile`: o caminho de um
// arquivo que o PRÓPRIO usuário arrastou e soltou num terminal (webUtils só responde para objetos File de um drop; não lista nem lê nada).
const { contextBridge, webUtils } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--forge-version='));
const version = arg ? arg.slice('--forge-version='.length).replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 32) : '';
const pathForFile = (file) => { try { const p = webUtils.getPathForFile(file); return typeof p === 'string' ? p : ''; } catch { return ''; } };
contextBridge.exposeInMainWorld('forgeDesktop', Object.freeze({ platform: process.platform, version, pathForFile }));
