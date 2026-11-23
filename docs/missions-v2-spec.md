# Missions v2: especificação (fatia 1: missão de projeto + workflow)

> Continuação: `docs/missions-v2-fatia2.md` (paralelo isolado, integração, retomada, agenda), `docs/missions-v2-briefing.md` (criação por briefing) e `docs/missions-v2-fatia3.md` (verificação, envio ao remoto e parada por limite).

Origem: decisão do usuário. Missions deixa de ter Planner/Executor. Passa a ser o ambiente para criar **missões** em workspaces, em que cada **etapa** é executada por um **agente de CLI num terminal real** (os mesmos PTY do Cockpit: Claude/Codex, com as permissões do usuário, editando arquivos, rodando comandos). Duas famílias de missão: **projeto** (algo maior, feito em etapas, com progresso) e **automação** (roda de forma recorrente; vem na fatia 2). A tela mostra um **workflow** com os agentes e o progresso REAL de cada etapa.

## Decisões já tomadas (não reabrir)
1. Agentes rodam nos **terminais do Cockpit** (`terminals.js`), visíveis e interativos. Nada de `claude -p` escondido.
2. O ciclo Planner/Executor antigo (`cycle.js`, `plan.js`, `policy.js`, `delivery.js`, `planner.js`, `executor/`) **fica dormente**: não apagar, não alterar o comportamento, não chamar no fluxo novo. A página Missions deixa de usá-lo na UI; a remoção é uma etapa futura, em commit separado.
3. Fatia 1 = missão de **projeto** + workflow. **Sem agendamento** ainda (campo `schedule` fica reservado, sempre `null`).
4. Dados novos em coleções NOVAS (`db.flows`, `db.flowRuns`); `db.missions` legado não é tocado nem migrado.

## Modelo
**Flow** (definição, `db.flows[]`):
```
{ id: 'flow_xxxxxxxx', workspaceId, title (<=120), goal (<=2000), kind: 'project'|'automation',
  fullAccess: boolean,            // "acesso total": os terminais da missão sobem sem pedir confirmação de permissão (opt-in explícito, por missão)
  maxParallel: 1..4 (padrão 1),   // etapas independentes simultâneas
  schedule: null,                 // reservado (fatia 2)
  steps: [{ id: 's1', title (<=120), prompt (<=2000), provider: 'claude'|'codex', role (id de ROLES), model?: string|null, effort?: string|null,
            dependsOn: [stepId], continueFrom?: stepId|null /* reaproveita o terminal dessa etapa */ }],
  createdAt, updatedAt, archived: false }
```
**Run** (execução, `db.flowRuns[]`, no máximo 1 ativa por flow):
```
{ id: 'run_xxxxxxxx', flowId, status: 'running'|'completed'|'failed'|'cancelled', startedAt, finishedAt|null, trigger: 'manual',
  steps: [{ stepId, status: 'pending'|'running'|'waiting'|'completed'|'failed'|'skipped'|'cancelled',
            terminalId|null, taskId|null, startedAt|null, finishedAt|null, summary|null, error|null }] }
```
`waiting` = o agente pediu uma permissão e espera o usuário no terminal (sinal real vindo de `agent-status`/Maestro; nunca inventado).

## Execução (server/flows.js)
- Um **runner** por run percorre o DAG de `steps`. Etapa pronta = todas as dependências `completed`. Respeita `maxParallel`.
- Para cada etapa pronta: cria o terminal por `terminals.create({ workspaceId, role, provider, model, effort, ... })` (ou reaproveita o de `continueFrom` se ainda estiver vivo) e entrega o texto da etapa pelo Maestro (nova API interna `maestro.dispatch`, abaixo). O contexto da missão (título e objetivo) entra no início do texto.
- **Contexto entre etapas** (2026-11-19): além de título e objetivo, a etapa recebe o resumo das dependências diretas concluídas (texto de agente, marcado como referência; sem « » [ ] e parecidos, e com `@` trocado por `＠`), no espaço que sobra do limite do Maestro. Prioridade: prompt > objetivo > resultados; entram com resumo os que couberem (mais curtos primeiro) e os demais só pelo título. A etapa que continua um terminal (`continueFrom`) não recebe o resumo dele de novo. Etapa aceita pelo usuário passa só o título (o resumo dela é o fim do terminal, não um relato do agente).
- **Conclusão confirmada** (2026-11-19): só o `report_done` do agente conclui sozinho (`completedBy: 'agent'`). O relatório automático do Maestro (`taskState().auto === true`) deixa a etapa `waiting` com `unconfirmed: true` até o agente chamar `report_done` ou o usuário decidir em `POST /api/flows/:id/runs/:runId/steps/:stepId/decision` `{ decision: 'accept' | 'reject' }` (registra `decidedBy: 'user'`, `decidedAt`; aceitar = `completedBy: 'user'`; recusar = `failed`, dependentes pulados). Tarefa que saiu do Maestro ou terminal fechado não decidem por ele. Enquanto espera, o agente continua acompanhado: se voltar a trabalhar a etapa volta a `running` (ainda `unconfirmed`), se pedir permissão fica `waiting` com `agentBusy: true`, e a decisão é recusada (409) nesses casos (estado conferido ao vivo). Cancelar zera `unconfirmed`; reiniciar o servidor o mantém (a etapa volta a esperar a decisão depois de Retomar).
- **Etapas que editam** (2026-11-19): papéis com `ROLES[role].edits` (Construtor) nunca rodam ao mesmo tempo no mesmo run (todos usam a pasta do workspace, sem worktree); `maxParallel` vale para quem só lê. Limites conhecidos: não serializa entre runs de missões diferentes nem com terminais abertos à mão no mesmo workspace; o terminal de uma etapa encerrada (falha/aceita) segue aberto e, se o usuário o reativar, não é contado; Revisor e Batedor "só leem" por instrução, não por permissão. Paralelo real com worktree por etapa é uma fatia futura.
- **Fim da etapa**: o Maestro marca a tarefa `done` pelo `report_done` do agente → etapa `completed` com `summary`. Tarefa `failed`/`expired`/`rejected`, ou terminal que terminou antes → etapa `failed` com `error`. Etapas que dependem de uma falha ficam `skipped`; o run vira `failed`. Nada é marcado `completed` sem o `report_done` do agente, exceto pela aceitação humana explícita e registrada descrita acima.
- **Cancelar**: marca o run `cancelled`, as etapas em andamento `cancelled`, e fecha os terminais criados por este run que ainda rodam (nunca os que o usuário abriu).
- **Reinício do servidor** (atualizado na fatia 2, ver `docs/missions-v2-fatia2.md` seção D): run `running` vira `interrupted` e só volta pelo botão Retomar (`POST .../runs/:runId/resume`), nunca sozinho no boot. Etapas em andamento ficam `interrupted`; a que esperava a sua confirmação (`unconfirmed`) continua esperando.
- `fullAccess: true` → o terminal sobe com o modo sem confirmação do provedor (Claude: `--dangerously-skip-permissions`; Codex: `--dangerously-bypass-approvals-and-sandbox`). Opção nova de `terminals.create` (`fullAccess`), só aceita `true` estrito, nunca vem de texto livre, e a sessão grava `fullAccess` para a tela mostrar. Sem a flag, o agente roda no modo padrão e pode ficar `waiting`.
- Limites: no máximo 12 etapas por missão, 50 flows, 200 runs guardados (os mais antigos finalizados saem).
- Persistência: `saveOrThrow` + rollback do estado parcial em toda mutação.

## API (server; `index.js` só monta as rotas)
Todas conferem Host/Origin como as demais rotas (origin-guard). Erros: `{ error: 'mensagem em português' }`.
- `GET  /api/flows` → `[{ ...flow, workspaceName, lastRun: run|null, activeRun: run|null }]`
- `POST /api/flows` (valida tudo: workspace existente, providers/roles/model/effort de listas fechadas, DAG sem ciclo e sem dependência desconhecida, `continueFrom` apontando para etapa anterior da cadeia de dependências, tamanhos) → 201 flow
- `PATCH /api/flows/:id` (título, objetivo, etapas, fullAccess, maxParallel, archived) → 409 se houver run ativo
- `DELETE /api/flows/:id` → 409 se houver run ativo (os runs desse flow saem junto)
- `POST /api/flows/:id/runs` → 201 run (409 se já houver run ativo, ou sem terminais disponíveis)
- `GET  /api/flows/:id/runs` → runs do flow (mais recente primeiro, até 20); `GET /api/flows/:id/runs/:runId`
- `POST /api/flows/:id/runs/:runId/cancel` → run
Contrato de leitura por polling (o cliente consulta a cada ~2,5 s, como `use-missions.js`).

## Arquivos e donos
**Backend (`backend-developer`)**: `server/flows.js` (modelo, validação, runner, rotas `setupFlows`), `server/maestro.js` (acrescentar `dispatch({ to, text, from, source }) → { ok, taskId }` e `taskState(id) → { status, summary, note, doneAt }`, sem mudar o comportamento atual), `server/terminals.js` e `server/providers/{claude,codex}.js` (opção `fullAccess`), `server/store.js` (coleções novas com padrão `[]`), `server/index.js` (só montar), testes novos `server/test/flows-*.test.mjs` (fake de terminais e de Maestro injetados; NUNCA Claude/Codex reais).
**Frontend (`frontend-developer`)**: `client/src/flows-view.js` (modelo de visão puro, testado a partir de `server/test/flows-view.test.mjs`), `client/src/use-flows.js`, `client/src/pages/Missions.jsx` (reescrita para o modelo novo), `client/src/components/Flow*.jsx`, `client/src/flows.css`; reaproveita `MissionWorkflow.jsx`/`missions-workflow.css` (nós compactos, conectores) adaptando a entrada. Não mexer em `Cockpit.jsx`; abrir o terminal pela mesma callback `onOpenCockpit(workspaceId, terminalId)` que a tela usa hoje.

## Tela (estilo retro-terminal do FORGE, igual ao Cockpit; sem glow; reduced-motion respeitado)
- Esquerda: lista de missões por workspace (título, tipo, estado do último run, progresso `n/m`), botão "Nova missão".
- Centro: cabeçalho compacto (título, objetivo resumido, estado, progresso, duração; Iniciar / Cancelar) e o **workflow** como protagonista: um nó por etapa com agente (provedor, papel, modelo, esforço), estado (ponto de cor; `waiting` destacado como "aguardando você"), tarefa atual e conectores pelas dependências; ramos paralelos visíveis; nó final de entrega.
- Selecionar um nó abre o painel lateral: texto da etapa, resumo/erro, tempos, botão "Abrir terminal".
- "Nova missão": formulário com título, objetivo, workspace, "acesso total" (com aviso claro), e editor de etapas (agente, prompt, dependências).
- Histórico dos runs em `<details>` fechado por padrão. A fatia 2 acrescenta o editor de agendamento.
- Tudo vem do estado real; ausência = "não informado", nunca simulado.

## Regras (todos)
- Testes só com `ORCH_DATA_DIR` temporário e porta própria; NUNCA tocar `data/db.json` nem `client/dist`; não reiniciar a 4317; não rodar `test:real*` nem missões/CLIs reais; sem commit, push, deploy ou novas dependências.
- Strings em português; comentários curtos explicando o porquê; falha de persistência desfaz o estado parcial.
- Pronto = testes novos + suítes tocadas verdes e o build do cliente ok, com a saída real no relatório. O build NÃO pode reescrever `client/dist` (é do usuário): rode o Vite com a saída em um diretório temporário (ex.: `cd client && npx vite build --outDir "$(mktemp -d -t orch-build-XXXX)" --emptyOutDir`) e remova-o depois.
