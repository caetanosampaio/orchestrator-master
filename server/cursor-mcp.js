// Entrada do FORGE no ~/.cursor/mcp.json (autorizada pelo usuário em 2026-11-24). O Cursor CLI só lê servidores MCP de arquivo (.cursor/mcp.json do projeto ou o global); o FORGE
// nunca grava no projeto, só a entrada GLOBAL, e só quando um terminal do Cursor abre. A entrada não tem porta nem token: o endereço e a credencial vêm do ambiente que só os
// terminais do FORGE recebem (`${env:FORGE_MCP_URL}` e `${env:FORGE_MCP_TOKEN}`, interpolação documentada em cursor.com/docs/context/mcp). Assim o mesmo arquivo serve ao servidor de
// desenvolvimento (4317) e ao app (porta livre a cada abertura). Fora dos terminais do FORGE (ex.: o editor Cursor) as variáveis não existem e a entrada só aparece com erro de conexão.
// Cuidados: nada que não seja JSON de objeto é tocado; link simbólico não é seguido (renomear por cima trocaria o link por arquivo); o resto do arquivo é preservado; cópia de segurança
// antes da primeira mudança; gravação atômica (temporário + rename) com a permissão original; sem mudança, nada é gravado.
import fs from 'node:fs';
import path from 'node:path';

export const CURSOR_MCP_NAME = 'forge-maestro';
export const CURSOR_MCP_ENTRY = Object.freeze({ url: '${env:FORGE_MCP_URL}', headers: Object.freeze({ Authorization: 'Bearer ${env:FORGE_MCP_TOKEN}' }) });
const MAX_BYTES = 1024 * 1024;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Garante a entrada em `<homeDir>/.cursor/mcp.json`. Devolve { ok: true, changed } ou { ok: false, why } (nunca lança). */
export function ensureCursorMcpEntry({ homeDir }) {
  try {
    if (typeof homeDir !== 'string' || !homeDir) return { ok: false, why: 'pasta pessoal desconhecida' };
    const dir = path.join(homeDir, '.cursor'), file = path.join(dir, 'mcp.json');
    let cfg = {}, mode = 0o600, exists = false;
    let st = null; try { st = fs.lstatSync(file); } catch { st = null; }
    if (st) {
      if (st.isSymbolicLink() || !st.isFile()) return { ok: false, why: 'o ~/.cursor/mcp.json é um link ou não é um arquivo comum: o FORGE não mexe nele' };
      if (st.size > MAX_BYTES) return { ok: false, why: 'o ~/.cursor/mcp.json é grande demais' };
      let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch { return { ok: false, why: 'o ~/.cursor/mcp.json não é um JSON válido: o FORGE não mexe nele' }; }
      if (!isObj(j) || (j.mcpServers !== undefined && !isObj(j.mcpServers))) return { ok: false, why: 'o ~/.cursor/mcp.json tem um formato inesperado: o FORGE não mexe nele' };
      cfg = j; mode = st.mode & 0o777; exists = true;
    }
    if (same(cfg.mcpServers?.[CURSOR_MCP_NAME], CURSOR_MCP_ENTRY)) return { ok: true, changed: false };
    const next = { ...cfg, mcpServers: { ...(cfg.mcpServers ?? {}), [CURSOR_MCP_NAME]: CURSOR_MCP_ENTRY } };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (exists) { const bak = `${file}.forge-backup`; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak, fs.constants.COPYFILE_EXCL); }
    // `wx`: o temporário nunca é um arquivo (ou link) que já existia; se a gravação ou o rename falhar (ex.: EPERM no Windows com o arquivo aberto), ele é apagado.
    const tmpFile = `${file}.forge-${process.pid}.tmp`;
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* sobra de uma execução anterior com o mesmo pid: o wx abaixo recusa se não sair */ }
    try {
      fs.writeFileSync(tmpFile, `${JSON.stringify(next, null, 2)}\n`, { mode, flag: 'wx' });
      fs.renameSync(tmpFile, file);
    } catch (e) { try { fs.rmSync(tmpFile, { force: true }); } catch { /* melhor esforço */ } throw e; }
    return { ok: true, changed: true };
  } catch (e) { return { ok: false, why: `não foi possível gravar o ~/.cursor/mcp.json (${String(e?.code || e?.message || e).slice(0, 60)})` }; }
}
