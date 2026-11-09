// Provedor Codex CLI: o que é específico do `codex` num terminal interativo (pane). Mesma interface do claude.js; o terminals.js só conhece essa interface.
//
// Diferenças em relação ao Claude Code (verificadas contra o codex-cli 0.167.0, sem login e sem rede):
//   - NÃO aceita id de sessão escolhido por quem chama: o id interno do FORGE (agentSessionId) é só uma chave nossa; por isso o pane do Codex não é retomável nem bifurcável (capabilities);
//   - o MCP do Maestro entra por `-c mcp_servers.<nome>.*` e o token vai SÓ no ambiente do processo (`bearer_token_env_var`): nenhum arquivo é escrito e nada vai para ~/.codex;
//   - o prompt do papel vai em `developer_instructions`; não há plugins (loadouts) nem hooks de estado ligados ainda (capabilities), então a tela cai na leitura pela saída;
//   - `--no-alt-screen` mantém a saída no fluxo normal do terminal, que é o que o `read_pane_output` do Maestro consegue ler;
//   - `--no-daemon`: o FORGE sempre passa `-c` (papel, MCP, confiança), e isso obriga o Codex ao modo embutido (sem o "servidor compartilhado em segundo plano"); pedir o modo embutido explicitamente evita os avisos
//     "Running without the shared background server" e "Running as administrator: shared background server disabled" (verificado no 0.167.0).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { killTreeSync } from '../orphans.js';

/** Codex no PATH (arquivo real, nunca por shell). `.cmd`/`.bat` (npm no Windows) precisam do cmd.exe. null se não achar. */
export function resolveCodex({ env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex'];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d.replace(/^"|"$/g, ''), n);
    try { if (fs.statSync(f).isFile()) return /\.(cmd|bat)$/i.test(f) ? { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f], viaShell: true } : { file: f, args: [], viaShell: false }; } catch { /* próximo */ }
  }
  return null;
}

/**
 * O Codex está com a conta conectada? Usa `codex login status` (argumentos fixos, sem shell, timeout curto): só o código de saída conta (0 = conectado, 1 = não conectado; qualquer outro resultado é "desconhecido"). O FORGE não lê arquivo de credencial
 * e o texto da CLI nunca é repassado (pode trazer e-mail). Estourou o tempo: encerra a ÁRVORE do processo (no Windows o execFile mata só o cmd.exe do wrapper e o codex neto ficaria vivo). Devolve { known, loggedIn, detail }; `known: false` quando a CLI não responde. Cache de `ttlMs` e uma única chamada em andamento.
 * Atualização rápida: o cache vale `ttlMs` (conectado) ou `retryMs` (desconectado ou desconhecido, para notar o login logo) e também cai quando a ASSINATURA do arquivo de login muda
 * (`authSignature`: só data e tamanho de `<CODEX_HOME>/auth.json`, o conteúdo NUNCA é lido). `resolve`/`run`/`killTree`/`signature` só existem para os testes.
 * `reset()` descarta o cache e a consulta em andamento (o resultado dela, antiga, não volta ao cache).
 */
export function createCodexAuthProbe({ resolve = resolveCodex, env = () => process.env, ttlMs = 30_000, retryMs = 8_000, timeoutMs = 6000, run = execFile, now = Date.now, killTree = killTreeSync, signature = authSignature } = {}) {
  let cache = { at: 0, value: null, sig: null }, inFlight = null, gen = 0;
  const sigNow = () => { try { return signature(env()); } catch { return 'erro'; } };
  const fresh = () => cache.value && now() - cache.at < (cache.value.loggedIn === true ? ttlMs : retryMs) && cache.sig === sigNow();
  const unknown = (detail) => ({ known: false, loggedIn: null, detail });
  function probe() {
    if (fresh()) return Promise.resolve(cache.value);
    if (inFlight) return inFlight;
    inFlight = new Promise((done) => {
      const g = gen, sig = sigNow();
      const finish = (value) => { if (g === gen) { cache = { at: now(), value, sig }; inFlight = null; } done(value); };
      let spec; try { spec = resolve({ env: env() }); } catch { spec = null; }
      if (!spec) return finish(unknown('O Codex CLI não foi encontrado no PATH.'));
      try {
        const cmd = loginStatusCommand(spec);
        if (!cmd) return finish(unknown('Não foi possível consultar o login do Codex (caminho do Codex não suportado).'));
        let child = null;
        child = run(spec.file, cmd.args, { timeout: timeoutMs, windowsHide: true, env: codexProvider.envFor(env()), ...cmd.opts }, (err) => {
          if (!err) return finish({ known: true, loggedIn: true, detail: 'Codex conectado.' });
          if (err.killed === true) { try { killTree(child?.pid); } catch { /* informativo */ } return finish(unknown('O Codex não respondeu a tempo ao consultar o login.')); }
          if (err.code === 1) return finish({ known: true, loggedIn: false, detail: 'O Codex não está conectado: rode "codex login" num terminal.' });
          finish(unknown('Não foi possível consultar o login do Codex.'));
        });
      } catch { finish(unknown('Não foi possível consultar o login do Codex.')); }
    });
    return inFlight;
  }
  probe.reset = () => { gen++; cache = { at: 0, value: null, sig: null }; inFlight = null; };
  return probe;
}

// O Codex avisa o estado por sequência OSC 7501 no próprio terminal (verificado no 0.167.0 contra um modelo falso): ESC ] 7501 ; state=<estado>:app=codex [:kind=...] (BEL ou ESC \).
// Mapa fechado para os estados do FORGE (agent-status.js); estado novo/desconhecido é ignorado e nunca derruba nada.
const OSC_STATE = Object.freeze({ idle: 'idle', working: 'running', blocked: 'waiting', done: 'completed', error: 'error' }); // `error`: falha do turno (HTTP 4xx/5xx, resposta `failed`), verificado no 0.167.0; sem ele o painel ficava em "executando" depois do erro
const OSC_RE = /\x1b\]7501;state=([a-z]{1,12}):app=codex(?::[A-Za-z0-9=_-]{0,40})*(?:\x07|\x1b\\)/g;
/** Estado mais recente anunciado nos dados do terminal (ou null). `carry` = resto da leitura anterior, para sequência cortada entre dois pedaços; devolve o novo `carry`. */
export function codexOscState(data, carry = '') {
  const text = carry + String(data);
  let state = null;
  for (const m of text.matchAll(OSC_RE)) state = OSC_STATE[m[1]] ?? state;
  const open = text.lastIndexOf('\x1b]7501;');
  return { state, carry: open >= 0 && text.length - open < 120 && !/(?:\x07|\x1b\\)/.test(text.slice(open)) ? text.slice(open) : '' };
}

/** Assinatura do arquivo de login do Codex (`<CODEX_HOME ou ~/.codex>/auth.json`): data e tamanho, ou "sem-arquivo". Só um `stat`: o conteúdo (credencial) nunca é aberto. Login e logout mudam a assinatura. */
export function authSignature(env = process.env) {
  const file = path.join(typeof env.CODEX_HOME === 'string' && env.CODEX_HOME ? env.CODEX_HOME : path.join(os.homedir(), '.codex'), 'auth.json');
  try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch { return 'sem-arquivo'; }
}

/**
 * Argumentos de `codex login status`. Wrapper .cmd (cmd.exe /d /s /c): o `/s` tira as aspas externas da linha, então o caminho do .cmd (que pode ter espaço, ex.: "C:\Users\Nome Sobrenome\...") vai entre aspas
 * DENTRO das externas e a linha segue verbatim. Caminho com aspa ou metacaractere do cmd.exe não é executado (null: login desconhecido, nunca "não conectado").
 */
export function loginStatusCommand(spec) {
  if (!spec?.viaShell) return { args: [...(spec?.args ?? []), 'login', 'status'], opts: {} };
  const f = spec.args.at(-1);
  if (typeof f !== 'string' || !f || /["&|<>^%!\r\n]/.test(f)) return null;
  return { args: [...spec.args.slice(0, -1), `""${f}" login status"`], opts: { windowsVerbatimArguments: true } };
}

export const MCP_TOKEN_ENV = 'FORGE_MCP_TOKEN';
const SERVER_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/; // chave TOML simples: o nome do servidor (forge_<hex>) sempre cabe aqui; qualquer outra coisa não vira argumento
// Variáveis do Claude Code que não fazem sentido no Codex (e a sessão pai do Claude que abriu o servidor).
const DROP_ENV = /^(CLAUDE_|ANTHROPIC_)/i;

/** Valor TOML de texto: entre aspas (JSON é um subconjunto válido de string TOML). Num wrapper .cmd (cmd.exe) as aspas quebram a linha de comando: vai o texto cru, que o Codex aceita como literal. */
const tomlStr = (v, quote) => (quote ? JSON.stringify(String(v)) : String(v));

export const codexProvider = Object.freeze({
  id: 'codex',
  label: 'Codex CLI',
  resolve: resolveCodex,
  oscState: codexOscState, // estado do agente lido do terminal (terminals.js), no lugar de hooks
  authProbe: createCodexAuthProbe(), // login do Codex (o terminals.js expõe em /api/terminals > providers[].auth)
  notFoundMessage: 'O Codex CLI não foi encontrado no PATH (instale com "npm i -g @openai/codex" e faça "codex login").',
  capabilities: Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false }),
  mcpTransport: 'env', mcpTokenEnv: MCP_TOKEN_ENV, // credencial do Maestro só no ambiente do processo
  // O TUI do Codex detecta colagem em rajada; o bloco vai entre marcadores de colagem entre colchetes e o Enter segue separado.
  submit: Object.freeze({ bracketed: true, delayMs: 300 }),
  // Configuração de projeto que o Codex carrega e executa: toda a pasta .codex (config.toml, hooks.json…); sem parser TOML, qualquer arquivo não versionado ou alterado pede confirmação.
  projectConfig: Object.freeze({ files: Object.freeze([]), dirs: Object.freeze(['.codex']) }),
  /** Ambiente do filho: o do processo, sem variáveis do Claude. O token do Maestro é acrescentado pelo terminals.js (só no ambiente do PTY). */
  envFor(base) {
    const env = { ...base };
    for (const k of Object.keys(env)) if (DROP_ENV.test(k)) delete env[k];
    return env;
  },
  /**
   * Argumentos do pane (sempre sessão nova). `mcp` = { url, serverName } quando o pane tem coordenação; o token vai no ambiente (MCP_TOKEN_ENV), nunca na linha de comando.
   * `quote: false` é para wrapper .cmd. As ferramentas do Maestro são pré-aprovadas só nesse servidor (default_tools_approval_mode), como o --allowedTools do Claude;
   * a aprovação humana das TAREFAS continua no próprio Maestro (send_task fica pendente até o usuário decidir).
   */
  paneArgs({ mode = 'new', prompt, mcp = null, quote = true, trustDir = null }) {
    if (mode !== 'new') throw new Error('O Codex CLI não oferece retomada nem bifurcação neste adaptador.');
    const args = ['--no-alt-screen', '--no-daemon', '-s', 'workspace-write', '-a', 'on-request'];
    // Confiança da pasta SÓ para este processo (o Codex não pergunta "confiar nesta pasta?"): nada é gravado no config do usuário. O caminho vai como CHAVE de uma tabela inline (`projects={'<pasta>'={trust_level='trusted'}}`) e não como
    // `projects.'<pasta>'.trust_level=...`: o parser do -c do Codex quebra a chave no PONTO mesmo entre aspas, e uma pasta com ponto (ex.: `C:\proj.orch-worktrees\wt_x`, a dos worktrees do FORGE) tinha a confiança IGNORADA, com o aviso
    // "Codex is ignoring 1 unrecognized configuration setting" e a pergunta de confiança na tela (verificado no 0.167.0). A tabela inline é mesclada ao config: as pastas que o usuário já confiou continuam valendo. Aspas simples (literal TOML) valem até no cmd.exe;
    // pasta com aspa simples, controle ou metacaractere do cmd.exe fica sem o argumento (a pergunta aparece normalmente).
    if (typeof trustDir === 'string' && trustDir && !/['\u0000-\u001f]/.test(trustDir) && (quote || !/[&|<>^%"!]/.test(trustDir))) args.push('-c', `projects={'${trustDir}'={trust_level='trusted'}}`);
    if (prompt) args.push('-c', `developer_instructions=${tomlStr(prompt, quote)}`);
    if (mcp && SERVER_KEY_RE.test(String(mcp.serverName)) && mcp.url) {
      const k = `mcp_servers.${mcp.serverName}`;
      args.push('-c', `${k}.url=${tomlStr(mcp.url, quote)}`, '-c', `${k}.bearer_token_env_var=${tomlStr(MCP_TOKEN_ENV, quote)}`, '-c', `${k}.default_tools_approval_mode=${tomlStr('approve', quote)}`, '-c', `${k}.startup_timeout_sec=20`);
    }
    return args;
  },
});
