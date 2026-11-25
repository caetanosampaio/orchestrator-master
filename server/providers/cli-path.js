// Detecção de uma CLI de agente no PATH, comum aos provedores novos (Gemini, OpenCode, Cursor). Mesma regra do Codex (codex.js > resolveCodex): só arquivos reais do PATH,
// nunca por shell; no Windows os wrappers .cmd/.bat do npm vão pelo cmd.exe (`viaShell`), e quem monta a linha de comando trata as aspas.
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/; // nomes fixos do código (gemini, opencode, agent…): nada vindo de fora vira nome de executável

/**
 * Primeiro executável encontrado no PATH entre `names` (na ordem). Devolve { file, args, viaShell } ou null. No Windows procura `<nome>.exe`, `.cmd` e `.bat`.
 * `env`/`platform` só existem para os testes.
 */
export function resolveOnPath(names, { env = process.env, platform = process.platform } = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => typeof n === 'string' && NAME_RE.test(n));
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const name of list) {
    const files = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
    for (const d of dirs) for (const n of files) {
      const f = path.join(d.replace(/^"|"$/g, ''), n);
      try { if (fs.statSync(f).isFile()) return /\.(cmd|bat)$/i.test(f) ? { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', f], viaShell: true } : { file: f, args: [], viaShell: false }; } catch { /* próximo */ }
    }
  }
  return null;
}

// Variáveis do Claude Code que não fazem sentido em outra CLI (e a sessão pai do Claude que abriu o servidor), como no Codex.
const DROP_ENV = /^(CLAUDE_|ANTHROPIC_)/i;
/** Ambiente do filho: o do processo, sem as variáveis do Claude. */
export function withoutClaudeEnv(base = process.env) {
  const env = { ...base };
  for (const k of Object.keys(env)) if (DROP_ENV.test(k)) delete env[k];
  return env;
}

const frozenList = (items) => Object.freeze(items.map(([id, label]) => Object.freeze({ id, label })));
export { frozenList };

/**
 * Fábrica dos provedores "de terminal" (nível 1 por padrão): só o que muda entre as CLIs vem em `spec`. Padrões: sem retomada, sem plugins, sem contas, sem consumo, sem
 * coordenação (mcp: false), sem planejador; colagem entre colchetes (HIPÓTESE comum aos TUIs, como no Codex); ambiente sem as variáveis do Claude.
 * `paneArgs(opts)` recebe { model, fullAccess, readOnly } e só é chamado com mode 'new' (retomada e bifurcação são recusadas aqui).
 */
export function cliProvider(spec) {
  const capabilities = Object.freeze({ resume: false, fork: false, hooks: false, plugins: false, accounts: false, transcript: false, mcp: false, readOnly: false, planner: false, ...(spec.capabilities ?? {}) });
  return Object.freeze({
    id: spec.id, label: spec.label, install: spec.install,
    resolve: (opts = {}) => resolveOnPath(spec.names, opts),
    options: Object.freeze({ models: frozenList(spec.models ?? []), efforts: frozenList([]) }),
    notFoundMessage: `O ${spec.label} não foi encontrado no PATH (instale com "${spec.install}" e entre na sua conta pela própria CLI).`,
    capabilities,
    submit: Object.freeze({ bracketed: true, delayMs: 300 }),
    projectConfig: Object.freeze({ files: Object.freeze([...(spec.projectFiles ?? [])]), dirs: Object.freeze([...(spec.projectDirs ?? [])]), ...(spec.projectFiles?.length ? { keys: '*' } : {}) }),
    envFor: withoutClaudeEnv,
    ...(spec.extra ?? {}),
    paneArgs(opts = {}) {
      const { mode = 'new', readOnly = false } = opts;
      if (mode !== 'new') throw new Error(`O ${spec.label} não oferece retomada nem bifurcação neste adaptador.`);
      if (readOnly === true && capabilities.readOnly === false) throw new Error(`O ${spec.label} não garante somente leitura.`);
      return spec.paneArgs({ model: opts.model ?? null, fullAccess: opts.fullAccess === true, readOnly: readOnly === true });
    },
  });
}
