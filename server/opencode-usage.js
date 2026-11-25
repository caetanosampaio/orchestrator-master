// Tokens do OpenCode por dia, lidos do banco SQLite que ele mesmo mantém (<XDG_DATA_HOME ou ~/.local/share>/opencode/opencode.db; confirmado no OpenCode 2.3.0 no Windows).
// Fonte extra do GET /api/provider-activity (provider-activity.js > extraSources). Somente leitura e só contagens: lê números de `session_v2` e a data das respostas do assistente
// em `session_message`. NUNCA seleciona conteúdo de conversa (`data`, `session_part`) nem as tabelas de conta/credencial (`account`, `control_account`, `credential`).
//
// O que o OpenCode grava (verificado no banco real, 25/11/2026): por SESSÃO, os totais `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`,
// `tokens_cache_write` e `cost`, mais `time_created`/`time_updated`; por mensagem NÃO há tokens (as respostas do assistente só têm tempo, modelo e fim). Logo, o consumo por DIA é
// uma estimativa: o total da sessão é repartido pelos dias das respostas do assistente, proporcionalmente ao número de respostas de cada dia (sessão de um dia só = exato; a soma
// de todos os dias é sempre exatamente a soma das sessões). Sessão sem resposta datada vai para o dia da última atividade.
//
// Mesmas convenções dos outros: io = entrada + saída; cache = leitura + escrita de cache. HIPÓTESE (não confirmada: nenhuma mensagem do banco traz tokens para comparar): o
// OpenCode guarda o raciocínio (`tokens_reasoning`) SEPARADO da saída, então ele entra em io (é gerado e cobrado como saída). Sessões-filhas (subagentes) têm contadores próprios e
// contam todas; se o pai já embutisse o consumo dos filhos haveria contagem em dobro (sem sessão-filha no banco usado na verificação, não deu para conferir).
//
// SQLite: `node:sqlite` (embutido no Node 22.5+; no servidor do app é o Node embutido 26). Sem ele (Node antigo) ou sem o banco, a fonte devolve null: o OpenCode simplesmente
// não aparece (nunca valor inventado). O banco é aberto somente para leitura (funciona com o OpenCode aberto, em modo WAL) e relido só quando ele (ou o `-wal`) muda e no máximo a cada
// `minIntervalMs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_SESSIONS = 50_000, MAX_ANSWER_GROUPS = 500_000; // sessões e grupos (sessão, dia) lidos, os mais recentes primeiro
const MAX_TOTAL = 1e12; // tokens plausíveis por campo de uma sessão
const MIN_DAY = '2023-01-01';
const p2 = (n) => String(n).padStart(2, '0');
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const num = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_TOTAL ? v : 0);

/** Banco do OpenCode: `$XDG_DATA_HOME/opencode/opencode.db` (caminho absoluto) ou `~/.local/share/opencode/opencode.db` (também no Windows, como ele grava). */
export function openCodeDbFile(env = process.env, home = os.homedir()) {
  const xdg = typeof env.XDG_DATA_HOME === 'string' && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share');
  return path.join(xdg, 'opencode', 'opencode.db');
}

/**
 * Reparte `total` (inteiro) entre os dias de `weights` (Map dia -> nº de respostas), proporcional ao peso, em inteiros, com a sobra no último dia (por ordem de data):
 * a soma é SEMPRE exatamente `total`. Sem pesos válidos, devolve null.
 */
export function splitByDays(total, weights) {
  const entries = [...weights.entries()].filter(([, w]) => Number.isSafeInteger(w) && w > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const sum = entries.reduce((a, [, w]) => a + w, 0);
  if (!sum || !Number.isSafeInteger(total) || total < 0) return null;
  const q = Math.floor(total / sum), r = total % sum, out = new Map(); let given = 0; // (r * w) < sum^2 <= 2.5e11: exato em ponto flutuante
  for (const [day, w] of entries) { const share = q * w + Math.floor((r * w) / sum); out.set(day, share); given += share; }
  const last = entries.at(-1)[0]; out.set(last, out.get(last) + (total - given));
  return out;
}

/**
 * Fonte de atividade do OpenCode: `{ id, label, read() }`. `read()` devolve `{ days: Map(dia -> [io, cache]), accounts: 1 }` ou null (sem banco, sem `node:sqlite`, banco ilegível).
 * `sqlite` (teste): o módulo `node:sqlite` a usar.
 */
export function createOpenCodeUsage({ dbFile = openCodeDbFile(), now = Date.now, minIntervalMs = 10_000, sqlite = undefined, maxFailures = 3 } = {}) {
  let memo = null, memoKey = null, lastRead = -Infinity, lastCostMs = 0, failures = 0;
  const statKey = () => {
    const parts = [];
    for (const f of [dbFile, `${dbFile}-wal`]) { try { const st = fs.lstatSync(f); parts.push(st.isFile() ? `${st.mtimeMs}:${st.size}` : 'x'); } catch { parts.push('-'); } }
    return parts[0] === '-' || parts[0] === 'x' ? null : parts.join('|'); // sem o arquivo do banco (ou link/pasta no lugar): nada a ler
  };

  /** Lê o banco. Devolve { days, accounts } ou null (sem `node:sqlite`); LANÇA se o banco não puder ser lido (travado, corrompido, esquema que mudou). */
  function load() {
    let mod = sqlite; if (mod === undefined) { try { mod = process.getBuiltinModule?.('node:sqlite') ?? null; } catch { mod = null; } }
    if (!mod?.DatabaseSync) return null;
    const db = new mod.DatabaseSync(dbFile, { readOnly: true });
    try {
      const maxDay = localDay(now() + 86_400_000);
      const dayOk = (ms) => { if (!Number.isSafeInteger(ms) || ms < 0) return null; const d = localDay(ms); return d >= MIN_DAY && d <= maxDay ? d : null; };
      // Só colunas numéricas e datas: nunca `data`, partes das mensagens nem tabelas de conta. CAST AS REAL: um valor que não cabe em inteiro seguro (banco adulterado ou corrompido)
      // não derruba a leitura inteira (o node:sqlite lança com inteiro > 2^53), e `num()` zera o que for absurdo. As respostas já vêm AGRUPADAS por sessão e dia (poucas linhas,
      // mesmo com centenas de milhares de mensagens); `localtime` é o mesmo fuso do `localDay` daqui. Os LIMIT pegam os mais recentes primeiro.
      const sessions = db.prepare('SELECT id, CAST(time_updated AS REAL) AS tu, CAST(tokens_input AS REAL) AS ti, CAST(tokens_output AS REAL) AS tout, CAST(tokens_reasoning AS REAL) AS tr, CAST(tokens_cache_read AS REAL) AS tcr, CAST(tokens_cache_write AS REAL) AS tcw FROM session_v2 ORDER BY time_updated DESC LIMIT ?').all(MAX_SESSIONS);
      const answers = new Map(); // sessão -> Map(dia -> respostas do assistente)
      for (const m of db.prepare("SELECT session_id, date(time_created / 1000, 'unixepoch', 'localtime') AS d, count(*) AS n FROM session_message WHERE type = 'assistant' GROUP BY session_id, d ORDER BY d DESC LIMIT ?").all(MAX_ANSWER_GROUPS)) {
        if (typeof m.session_id !== 'string' || typeof m.d !== 'string' || m.d < MIN_DAY || m.d > maxDay || !Number.isSafeInteger(m.n) || m.n <= 0) continue;
        let w = answers.get(m.session_id); if (!w) answers.set(m.session_id, w = new Map()); w.set(m.d, (w.get(m.d) ?? 0) + m.n);
      }
      const days = new Map();
      const add = (day, io, cache) => { const r = days.get(day) ?? [0, 0]; r[0] += io; r[1] += cache; days.set(day, r); };
      for (const s of sessions) {
        const io = num(s.ti) + num(s.tout) + num(s.tr), cache = num(s.tcr) + num(s.tcw);
        if (io + cache <= 0) continue;
        const w = answers.get(s.id), fallback = dayOk(s.tu);
        const ioBy = w ? splitByDays(io, w) : null, cacheBy = w ? splitByDays(cache, w) : null;
        if (ioBy && cacheBy) { for (const day of ioBy.keys()) add(day, ioBy.get(day), cacheBy.get(day)); } else if (fallback) add(fallback, io, cache);
      }
      return { days, accounts: 1 };
    } finally { try { db.close(); } catch { /* já fechado */ } }
  }

  return {
    id: 'opencode', label: 'OpenCode',
    estimated: true, // o consumo POR DIA é estimativa (o banco só tem o total de cada sessão): a tela avisa
    read() {
      const t = now();
      // intervalo mínimo entre leituras e, se a leitura é lenta, 10x o tempo que ela leva (banco grande não vira carga fixa no servidor)
      if (lastRead !== -Infinity && t - lastRead < Math.max(minIntervalMs, lastCostMs * 10)) return memo;
      lastRead = t;
      const key = statKey();
      if (!key) { memo = null; memoKey = null; failures = 0; return null; } // sem banco: o OpenCode não aparece
      if (key === memoKey && memo) return memo; // o banco não mudou desde a última leitura
      const t0 = performance.now();
      try {
        const r = load(); memo = r ?? null; memoKey = r ? key : null; failures = 0;
      } catch {
        // falha passageira (banco travado por um checkpoint, escrita em andamento): mantém o ÚLTIMO dado bom por até `maxFailures` tentativas seguidas; depois some (nunca valor inventado)
        failures += 1; if (failures >= maxFailures) { memo = null; memoKey = null; }
      }
      lastCostMs = performance.now() - t0;
      return memo;
    },
  };
}
