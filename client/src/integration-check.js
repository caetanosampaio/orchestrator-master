// "Testar integração" (Configurações > Suas IAs). PURO: decide se a IA pode ser testada, monta o pedido do terminal de teste e lê o resultado da listagem de terminais.
// O teste abre um terminal Batedor DE VERDADE no workspace ativo (aparece no Cockpit: se a CLI pedir para aprovar o servidor do FORGE, confiar na pasta ou entrar na conta,
// é ali que você responde) e espera o campo `maestro` do terminal (GET /api/terminals) virar 'connected', a mesma prova de conexão que libera as tarefas do Maestro
// às IAs ainda não verificadas. Conectou: o terminal de teste é fechado. Não conectou no prazo: ele fica aberto para você ver o motivo (e o teste segue de olho nele).
// O acompanhamento (que sobrevive a sair da tela) fica em integration-runner.js.

/** Prazo do teste: o mesmo que uma etapa de missão dá a um terminal recém-aberto para se conectar (CONNECT_GRACE_MS do maestro.js). */
export const INTEGRATION_WAIT_MS = 90_000;
/** Depois do prazo, o teste continua de olho no terminal de teste aberto (você pode estar respondendo a um pedido da IA) por até este tempo. */
export const INTEGRATION_WATCH_MS = 10 * 60_000;

/** Só faz sentido para IA instalada que conversa com o Maestro (as de terminal livre não recebem credencial). */
export const canTestIntegration = (row) => !!row && row.available === true && row.capabilities?.mcp !== false;

/** Corpo do POST /api/terminals do terminal de teste. Batedor: o papel que não altera arquivos; na pasta do workspace (sem worktree), como um terminal comum. */
export function integrationTerminalBody({ provider, name = provider, accountId = null, ack = false } = {}) {
  return { provider, role: 'scout', title: `Teste de integração · ${name}`, isolate: false, ...(typeof accountId === 'string' && accountId ? { accountId } : {}), ...(ack ? { acknowledgeProjectConfig: true } : {}) };
}

/** Texto do erro ao ABRIR o terminal de teste (código do servidor), com a saída que existe para cada caso. */
export function integrationOpenError(e) {
  if (e?.code === 'account_required') return 'Há mais de uma conta desta IA e nenhuma escolhida: escolha a conta no seletor da barra do workspace (Cockpit) e teste de novo.';
  if (e?.code === 'project_config_unreviewed') return 'Teste cancelado: o projeto tem configuração não revisada e ela não foi confirmada.';
  return e?.message || 'Não foi possível abrir o terminal de teste.';
}

/**
 * Resultado do teste a partir do terminal na listagem (`session`, ou null se ele não está nela) e do tempo desde a abertura. `listed` = o terminal já apareceu na listagem
 * alguma vez: logo depois de abrir, a listagem ainda pode não tê-lo, e isso não é "terminou".
 * kind: 'waiting' (no prazo) | 'ok' (conectou) | 'ended' (o terminal acabou antes) | 'timeout' (não conectou no prazo; o terminal segue aberto) |
 *       'nocoord' (abriu sem a ligação com o Maestro) | 'outdated' (servidor sem o campo `maestro`).
 * `done` = resultado final (não muda mais); 'timeout' não é final: se conectar depois, vira 'ok'.
 */
export function integrationVerdict({ session, listed = true, startedAt, now, waitMs = INTEGRATION_WAIT_MS }) {
  const secs = Math.max(0, Math.round((now - startedAt) / 1000)), limit = Math.round(waitMs / 1000);
  if (!session && !listed) {
    return now - startedAt < waitMs ? { kind: 'waiting', done: false, text: 'Abrindo o terminal de teste…' }
      : { kind: 'ended', done: true, text: 'O terminal de teste não apareceu na lista de terminais. Veja o Cockpit e o Histórico, e teste de novo.' };
  }
  if (!session || session.status !== 'running') {
    const code = session && Number.isInteger(session.exitCode) ? ` (código ${session.exitCode})` : '';
    return { kind: 'ended', done: true, text: `O terminal de teste terminou${code} antes de se conectar ao Maestro. Veja a saída dele no Cockpit ou no Histórico.` };
  }
  if (!('maestro' in session)) return { kind: 'outdated', done: true, text: 'O servidor do FORGE em execução é de uma versão anterior e não informa a ligação com o Maestro: feche e abra o FORGE de novo e teste outra vez.' };
  if (session.maestro === 'connected') return { kind: 'ok', done: true, text: `Conectou ao Maestro em ${secs} s: a coordenação funciona nesta máquina.` };
  if (session.maestro !== 'waiting') return { kind: 'nocoord', done: true, text: 'O terminal abriu sem a ligação com o Maestro: o FORGE não conseguiu preparar a coordenação desta IA (veja o log do servidor). O terminal de teste continua aberto no Cockpit.' };
  if (now - startedAt >= waitMs) return { kind: 'timeout', done: false, text: `Não se conectou ao Maestro em ${limit} s. O terminal de teste continua aberto no Cockpit: veja se a IA está pedindo para se atualizar, aprovar o servidor do FORGE, confiar na pasta ou entrar na conta. O teste segue de olho: se conectar, o resultado muda sozinho.` };
  return { kind: 'waiting', done: false, text: `Aguardando a IA se conectar ao Maestro (${secs} s de ${limit} s)…` };
}
