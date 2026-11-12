# Arquitetura do FORGE

Visão técnica do FORGE 0.1.0. Para instalar e usar, veja o [README](../README.md); para a integração com cada agente, [AGENTES.md](AGENTES.md).

## Camadas

```
Electron (desktop/)  ->  servidor Node + Express (server/, só 127.0.0.1)  ->  CLIs dos agentes (node-pty)
      |                          |                                              Claude Code / Codex CLI
 token de sessão          db.json, history/, mcp/                                      ^
      v                          v                                                     |
 React + Vite (client/) <-- API REST + SSE --  Maestro (MCP local em /mcp) ------------+
```

| Camada | Pasta | Papel |
|---|---|---|
| Desktop | `desktop/` | Electron 43: sobe o servidor, gera o token de sessão, migra dados do nome antigo, rotaciona logs, reinicia o servidor se cair (máx. 3 em 2 min), empacota Windows (Setup e Portable) e macOS (`.dmg`, Intel). |
| Servidor | `server/` | API Node (ESM, Express 4; dependências de execução: `express` e `node-pty`). Escuta só em `127.0.0.1`. |
| Cliente | `client/` | React 18 + Vite + `@xterm/xterm`. A lógica de visão fica em módulos `.js` puros (`env-view.js`, `provider-view.js`, `layout-state.js`...), testados a partir de `server/test/`. |
| Testes | `server/test/` | `node:test`, cerca de 170 arquivos. `fake-cli.mjs` simula o agente; `manual/` tem scripts que usam o Claude de verdade. |

## Servidor

**Terminais e agentes**
- `terminals.js`: cria e fecha PTYs, transmite a saída por SSE, retoma e reabre sessões, mantém limites (50 simultâneos) e o estado de cada agente.
- `providers/`: adaptadores `claude.js` e `codex.js` atrás de uma interface comum (ver [AGENTES.md](AGENTES.md)).
- `maestro.js`: servidor MCP local; tarefas pendentes até a aprovação do usuário.
- `agent-status.js` e `agent-status-hook.mjs`: estado do Claude Code por hooks. O do Codex é lido do terminal.
- `loadouts.js`: skills e MCPs por papel, como plugin de sessão em pasta própria (fora do projeto).
- `usage-api.js`: uso **real** da conta consultado no provedor (Claude: `/api/oauth/usage`; Codex: `wham/usage`), somando o gasto dentro e fora do FORGE (terminal externo, navegador). Lê o token de login (`.credentials.json` / `auth.json`) só em memória, hosts fixos, sem redirecionamento, sem renovar token; formato inesperado ou falha cai nas fontes locais. Superfície sensível (credencial + rede). Desliga com `ORCH_LIMITS_API=off`; em testes (`ORCH_DATA_DIR`/`NODE_TEST_CONTEXT`) fica desligado.
- `rate-limits.js` e `claude-statusline-hook.mjs` (fallback local quando a API não está disponível; o rodapé da status line mostra só `FORGE`): limite **real** de uso por conta (janela de 5 h e janela semanal, % usado e instante de reset), em `GET /api/limits` (somente leitura, sem caminhos, ids de sessão nem e-mails, mesma checagem Host/Origin). Claude Code: o pane abre com `--settings <arquivo>` (gerado na pasta de dados) que liga a status line ao script; ele recebe `rate_limits` no stdin (só assinantes Pro/Max, só depois da 1ª resposta da sessão) e grava só as duas janelas em `rate-limits/<session_id>.json`; vale, por janela, o dado mais novo entre as sessões da conta (maior `resetsAt`; em empate, maior `usedPct`; o `at` do hook só desempata, pois não é o instante da medição). Se a resposta traz só uma janela, o hook mantém a outra gravada enquanto o reset dela estiver no futuro. Escrita com `.tmp` aleatório e flag `wx`. Codex: o último `rate_limits` dos rollouts recentes (`codex-usage.js`, nível de conta). Janela cujo reset já passou é omitida. Efeito colateral aceito: com status line configurada o Claude Code esconde a maioria das dicas do rodapé; por isso o script imprime uma linha curta (`FORGE · 5h 23% · semana 41%`), `ORCH_CLAUDE_STATUSLINE=off` desliga a injeção e ela não acontece se o `settings.json` de usuário da conta já define `statusLine` (a conta aparece como `statusline-propria`). O `--settings` tem precedência sobre o `settings.json` de **projeto**: um `statusLine` definido só no projeto é substituído.
- `terminal-usage.js`: tokens (entrada + saída, o mesmo número que o terminal mostra ao vivo; o contexto em cache fica à parte no tooltip) e custo do Claude Code a partir do transcript, com preços só do `pricing.json` do usuário.
- `codex-usage.js`: leitura dos limites de uso da conta do Codex (`payload.rate_limits` dos rollouts em `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl`; somente leitura, só números, sem seguir links), usada por `rate-limits.js`.

**Isolamento e contas**
- `worktrees.js`: worktrees git por agente ou por equipe, com detecção de conflito e integração controlada. Só roda Git com argumentos fixos, sem shell, sem hooks e sem rede.
- `accounts.js`, `account-login.js`, `claude-cli.js`: contas do Claude Code como pastas de configuração próprias, login pelo navegador, conta padrão. O Codex aparece na lista de provedores com o estado do login dele, mas o FORGE não o gerencia.
- `trust.js`: resposta à pergunta "confiar nesta pasta?" do Claude Code; o Codex recebe a confiança por argumento.

**Infraestrutura**
- `store.js`: persistência em JSON com gravação atômica (arquivo temporário + rename). Falha de gravação desfaz o estado parcial (`saveOrThrow` + rollback).
- `instance-lock.js`, `orphans.js`, `child-registry.js`, `shutdown.js`, `proc.js`: trava de instância, limpeza de processos órfãos (no Windows os filhos não morrem com o pai) e encerramento ordenado (filhos, flush, trava).
- `origin-guard.js` e `session-token.js`: proteção de rede e token de sessão (ver Segurança).
- `layouts.js`, `ui-settings.js`, `topics.js`, `conversations.js`: layout da grade por workspace, preferências, tópicos e histórico de conversas.

**Ciclo de missões (sem tela hoje)**
`cycle.js`, `planner.js`, `executor/`, `plan.js`, `policy.js`, `verify.js`, `evidence.js`, `scope.js`, `supervisor.js`, `delivery.js`, `limits.js`: ciclo autônomo Planner, Executor, verificações reais, evidência, supervisão e relatório de entrega. O Planner só escolhe `continue`, `complete` ou `blocked`, e o backend valida formato, decisão e evidência; concluir exige evidência `verified`, exceto por aceitação humana explícita e registrada. Está exposto em `/api/missions/...` e coberto por testes, mas a interface atual (grade de terminais) não tem telas para ele. As telas antigas do ciclo (`Missions`, `CyclePanel`, `DeliveryReport` e afins) foram removidas do cliente; continuam no histórico do Git se o ciclo voltar a ter interface.

## Fluxos principais

**Abrir um terminal.** O cliente envia `POST /api/terminals` com papel e provedor (de listas fechadas). O servidor valida o workspace, decide o worktree (um por agente que edita quando há mais de um), confere a configuração de projeto não revisada, monta os argumentos com o adaptador, emite a credencial do Maestro e inicia o PTY. A saída segue por SSE (`/api/terminals/:id/stream`).

**Estado do agente.** Claude: hooks gravam eventos em arquivos que o servidor lê. Codex: o servidor interpreta a sequência OSC 7501 na saída do PTY. Os dois viram `idle`, `running`, `waiting`, `completed` ou `error`; o cliente deriva o estado do painel, do workspace (sidebar) e global a partir disso (`paneState`, `wsTone`).

**Tarefa do Maestro.** O Maestro chama `send_task` por MCP; com o maestro autônomo ligado (padrão, preferência gravada) o texto é entregue na hora ao terminal de destino do jeito que a CLI dele espera; desligado, a tarefa fica pendente e o usuário aprova ou recusa (`/api/maestro/tasks/:id/approve|reject`). Um vigia acompanha as tarefas entregues e, quando o terminal termina sem `report_done`, conclui a tarefa e digita o relatório no Maestro.

## Segurança

- Escuta só em loopback; `Host` e `Origin` validados (protege de CSRF e DNS rebinding, **não** é autenticação).
- No desktop, token de sessão por boot nas ações que alteram estado e nas leituras de conteúdo sensível (terminais e sessões, conversas, contas, missões, chat, fila do Maestro, atividade, eventos e worktrees); o servidor o remove de `process.env` para os filhos não herdarem. Estado, workspaces, layouts e preferências seguem de leitura aberta (só Host/Origin).
- Sem shell em tudo que executa processo, com argumentos fixos. Exceção: os wrappers `.cmd` do npm no Windows passam pelo `cmd.exe`, com a linha de comando montada pelo servidor (caminho com metacaractere do `cmd.exe` não é executado).
- Credencial do Maestro por terminal: guardada em memória; no Claude Code também vai num arquivo `--mcp-config` de modo restrito, e no Codex só no ambiente do processo.
- Configuração de projeto executável não revisada no Git (hooks, MCP, comandos) exige confirmação ao abrir o terminal. A exigência vem **ligada por padrão**; `ORCH_STRICT_PROJECT_CONFIG=0` a desliga. O FORGE também grava a confiança da pasta no `.claude.json` do Claude Code (`ORCH_NO_TRUST=1` desliga).
- Os agentes rodam com as permissões do usuário (limite assumido e documentado).
- Limites aceitos: terminais interativos não passam pela política e pela evidência do ciclo; as rotas do Maestro só conferem `Host`/`Origin` fora do desktop; `releasePty` mexe em campos internos do `node-pty`.

## Decisões técnicas

- **Poucas dependências:** Express e node-pty no servidor; testes com `node:test`.
- **JSON em arquivo** em vez de banco: simples e inspecionável; escrita atômica.
- **Adaptador de provedor:** novos agentes entram sem mexer no núcleo; o que a CLI não tem fica `false` em `capabilities`.
- **Estado vindo do agente**, não de adivinhação pela saída, sempre que a CLI informa (hooks no Claude, OSC no Codex).
- **Contratos legados preservados** no rebranding para FORGE: `ORCH_*`, `x-orch-token`, `orch/wt_*`, compatibilidade de leitura do nome MCP antigo.
- **Dados do usuário protegidos nos testes:** `ORCH_DATA_DIR` temporário em toda suíte.

## Testes e CI

A suíte completa leva alguns minutos e deve rodar com `ORCH_DATA_DIR` temporário. A CI (`.github/workflows/ci.yml`) roda a suíte no Windows, Linux e macOS (os três bloqueiam o resultado) e confere o build do cliente. Testes específicos de um sistema ficam em arquivos próprios (`posix-process.test.mjs` e `win-process.test.mjs`) e aparecem como ignorados nos outros sistemas.
