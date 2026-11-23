// Sonda do Claude Code (`claude --version`): alimenta `prereqs.claude` e `executor` em GET /api/state.
// Extraída do executor do ciclo antigo (executor/index.js) com o MESMO comportamento: binário resolvido como nos terminais (claude-cli.js; `.cmd` via cmd.exe
// só com argumentos da lista permitida), sem shell, timeout de 8 s, cache de 15 s e UMA chamada em andamento compartilhada (várias rotas consultam juntas).
// Resultado: { available: false, detail } ou { available: true, version, detail } (os textos são os de antes; prereqsOf e /api/state dependem deles).
import { execFile } from 'node:child_process';
import { launchSpec } from './claude-cli.js';

const TTL_MS = 15_000;
const TIMEOUT_MS = 8000;
export const CLAUDE_NOT_FOUND = 'Claude Code não encontrado no PATH';
export const CLAUDE_UNSAFE_CMD = 'Claude Code não pôde ser iniciado com segurança (caminho do claude.cmd inválido).';
export const CLAUDE_READY = 'Claude Code detectado e pronto para executar tarefas autorizadas';

/**
 * `command`/`prefixArgs` só existem para os testes injetarem um Claude falso (node + script); o servidor usa o padrão (resolução como nos terminais).
 * Devolve uma função `probe()` com `probe.reset()` ("Verificar novamente": a próxima chamada consulta de verdade) e `probe.cachedAvailability()` (true/false, ou null sem consulta).
 */
export function createClaudeProbe({ command, prefixArgs = [], ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS, run = execFile } = {}) {
  const injected = command !== undefined;
  let cache = { at: 0, value: null };
  let inFlight = null;
  function probe() {
    if (Date.now() - cache.at < ttlMs && cache.value) return Promise.resolve(cache.value);
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve) => {
      const spec = launchSpec({ injected, command, prefixArgs }, ['--version']);
      const done = (value) => { cache = { at: Date.now(), value }; inFlight = null; resolve(value); };
      if (spec.error) return done({ available: false, detail: CLAUDE_UNSAFE_CMD });
      try {
        run(spec.file, spec.args, { timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: spec.verbatim }, (err, stdout) => {
          done(err
            ? { available: false, detail: CLAUDE_NOT_FOUND }
            : { available: true, version: String(stdout).trim(), detail: CLAUDE_READY });
        });
      } catch { done({ available: false, detail: CLAUDE_NOT_FOUND }); }
    });
    return inFlight;
  }
  probe.reset = () => { cache = { at: 0, value: null }; };
  probe.cachedAvailability = () => (cache.value ? cache.value.available : null);
  return probe;
}
