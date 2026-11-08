// Confiança de pasta do Claude Code: a pergunta "Do you trust the files in this folder?" aparece em cada pasta nova (e cada worktree novo é uma pasta nova). O Claude Code guarda a resposta em
// `projects["<pasta>"].hasTrustDialogAccepted` no arquivo `.claude.json` da pasta de configuração (a da conta do FORGE ou ~/.claude.json). Aqui o FORGE grava essa resposta ANTES de abrir o pane,
// só para a pasta do próprio pane (o workspace cadastrado pelo usuário ou um worktree que o FORGE criou dele).
//
// Cuidados (melhor esforço, nunca derruba a abertura do terminal):
//   - só altera um arquivo que JÁ existe e é JSON válido (Claude Code ainda não configurado: nada a fazer, a pergunta aparece normalmente);
//   - se a pasta já está confiável, não escreve nada;
//   - leitura e gravação em seguida, sem pausa; a gravação é atômica (arquivo temporário + rename) e mantém as permissões do original; link simbólico é ignorado;
//   - o Claude Code regrava esse arquivo com frequência. Se ele gravar no mesmo milissegundo, uma das duas escritas pode se perder: o pior caso é a pergunta aparecer de novo (ou perder uma estatística de uso).
// Limite honesto: a pergunta existe para você não executar, sem querer, hooks e MCP de um projeto desconhecido. Com a confiança gravada, o que está nos arquivos do projeto roda sem perguntar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;
// Forma que o Claude Code grava para uma pasta que ele mesmo registrou (campos que ele espera encontrar).
const DEFAULT_PROJECT = Object.freeze({ allowedTools: [], mcpContextUris: [], mcpServers: {}, enabledMcpjsonServers: [], disabledMcpjsonServers: [], hasTrustDialogAccepted: false, hasClaudeMdExternalIncludesApproved: false, hasClaudeMdExternalIncludesWarningShown: false });

/** Arquivo de estado do Claude Code para uma pasta de configuração (null = a padrão do processo/usuário). */
export function claudeStateFile({ configDir = null, home = os.homedir(), env = process.env } = {}) {
  const base = configDir || env.CLAUDE_CONFIG_DIR || home;
  return path.join(base, '.claude.json');
}

/** Chaves sob as quais a pasta pode estar registrada: caminho real e caminho como foi dado (no macOS /var é /private/var); no Windows também com barras normais. */
function keysFor(dir) {
  const out = new Set();
  const abs = path.resolve(String(dir));
  let real = abs; try { real = fs.realpathSync.native(abs); } catch { /* pasta sumiu: vale o caminho dado */ }
  for (const p of [real, abs]) { out.add(p); if (process.platform === 'win32') out.add(p.replace(/\\/g, '/')); }
  return [...out];
}

/**
 * Marca a pasta como confiável no estado do Claude Code. Devolve { ok, changed, reason? }: ok=false (com motivo) quando não pôde/ não deveu mexer; nunca lança.
 * `file` é injetável nos testes (nunca toque no ~/.claude.json real a partir de um teste).
 */
export function trustClaudeFolder(dir, { configDir = null, file = null, home = os.homedir(), env = process.env } = {}) {
  try {
    const target = file ?? claudeStateFile({ configDir, home, env });
    let st; try { st = fs.lstatSync(target); } catch { return { ok: false, changed: false, reason: 'sem arquivo de estado' }; }
    if (!st.isFile()) return { ok: false, changed: false, reason: 'o arquivo de estado é um link ou não é arquivo' }; // lstat: link simbólico não é seguido
    if (st.size > MAX_BYTES) return { ok: false, changed: false, reason: 'arquivo de estado grande demais' };
    let j; try { j = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return { ok: false, changed: false, reason: 'arquivo de estado ilegível' }; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, changed: false, reason: 'arquivo de estado inesperado' };
    const projects = j.projects && typeof j.projects === 'object' && !Array.isArray(j.projects) ? j.projects : null;
    if (j.projects !== undefined && !projects) return { ok: false, changed: false, reason: 'campo projects inesperado' };
    const keys = keysFor(dir);
    const all = projects ?? {};
    if (keys.every((k) => all[k]?.hasTrustDialogAccepted === true)) return { ok: true, changed: false };
    for (const k of keys) {
      if (Object.hasOwn(all, k) && (all[k] === null || typeof all[k] !== 'object' || Array.isArray(all[k]))) return { ok: false, changed: false, reason: 'entrada da pasta inesperada' };
      all[k] = { ...DEFAULT_PROJECT, ...(all[k] ?? {}), hasTrustDialogAccepted: true };
    }
    j.projects = all;
    const tmp = `${target}.forge-${process.pid}-${Date.now()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: st.mode & 0o777 }); fs.renameSync(tmp, target); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* sem sobra */ } return { ok: false, changed: false, reason: `não foi possível gravar (${String(e?.code || e?.message || e).slice(0, 60)})` }; }
    return { ok: true, changed: true };
  } catch (e) { return { ok: false, changed: false, reason: String(e?.message || e).slice(0, 80) }; }
}
