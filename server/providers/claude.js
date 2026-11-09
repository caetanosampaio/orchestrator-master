// Provedor Claude Code: TUDO o que é específico da CLI `claude` num terminal interativo (pane) fica aqui: onde ela está, como ela é iniciada e retomada.
// O terminals.js só conhece a interface do provedor (ver providers/index.js), nunca os argumentos da CLI. Nada aqui vem do cliente.
import fs from 'node:fs';
import path from 'node:path';

/** Claude Code no PATH (arquivo real, nunca por shell). `.cmd`/`.bat` precisam do cmd.exe. null se não achar. */
export function resolveClaude({ env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d.replace(/^"|"$/g, ''), n);
    try { if (fs.statSync(f).isFile()) return /\.(cmd|bat)$/i.test(f) ? { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f], viaShell: true } : { file: f, args: [], viaShell: false }; } catch { /* próximo */ }
  }
  return null;
}

export const claudeProvider = Object.freeze({
  id: 'claude',
  label: 'Claude Code',
  resolve: resolveClaude,
  notFoundMessage: 'Claude Code não foi encontrado no PATH.',
  // O que a CLI sabe fazer; o terminals.js só liga o recurso quando o provedor declara a capacidade.
  capabilities: Object.freeze({ resume: true, fork: true, hooks: true, plugins: true, accounts: true, transcript: true, statusLine: true }),
  mcpTransport: 'file', // credencial do Maestro em arquivo (--mcp-config)
  // Variáveis acrescentadas ao ambiente do pane (só se o ambiente ainda não define a variável: quem quiser outro valor exporta antes). CLAUDE_CODE_NO_FLICKER=1 liga o renderer em tela cheia
  // (alt-screen, preenche o terminal). Sem isto o Claude Code o DESLIGA SOZINHO na máquina quando um lançamento "não terminou de iniciar" (acontece quando o servidor reinicia e mata os panes
  // durante a partida) e os panes seguintes abrem no modo clássico, sem preencher o terminal, até alguém rodar /tui fullscreen em cada um. A variável vence essa desativação automática.
  paneEnv: Object.freeze({ CLAUDE_CODE_NO_FLICKER: '1' }),
  // Como uma tarefa do Maestro é entregue: o texto vai como bloco (o Claude Code o trata como colagem) e o Enter segue separado, `delayMs` depois.
  submit: Object.freeze({ bracketed: false, delayMs: 200 }),
  /**
   * Argumentos do pane. mode: 'new' (--session-id fixo, papel e nome), 'resume' (mesma sessão) ou 'fork' (cópia com UUID novo; a original fica intacta).
   * Na retomada o Claude Code restaura histórico, prompt de sistema, nome e permission mode: NÃO se repassa nada disso.
   * `mcp` = { configPath, serverName } quando o pane tem coordenação (Maestro); sem ele, nenhum argumento de MCP.
   * `pluginDir` = plugin de sessão com as skills do papel (loadouts.js); vale também na retomada, porque o plugin não faz parte da sessão gravada.
   *   Vem ANTES dos argumentos de MCP: `--mcp-config` e `--allowedTools` aceitam vários valores e um argumento depois deles seria lido como valor.
   */
  paneArgs({ mode, prompt, label, sessionId, resumeSessionId, mcp = null, pluginDir = null, settingsFile = null }) {
    // `settingsFile` = arquivo JSON com a status line do FORGE (rate-limits.js), que grava o limite real da conta. Vale nos três modos, junto do plugin e ANTES do MCP; sem ele, nenhum argumento.
    const pluginArgs = [...(pluginDir ? ['--plugin-dir', pluginDir] : []), ...(settingsFile ? ['--settings', settingsFile] : [])];
    const mcpArgs = mcp ? ['--mcp-config', mcp.configPath, '--allowedTools', `mcp__${mcp.serverName ?? 'forge'}`] : [];
    if (mode === 'new') return ['--append-system-prompt', prompt, '--name', label, '--session-id', sessionId, ...pluginArgs, ...mcpArgs];
    return ['--resume', resumeSessionId, ...(mode === 'fork' ? ['--fork-session', '--session-id', sessionId] : []), ...pluginArgs, ...mcpArgs];
  },
});
