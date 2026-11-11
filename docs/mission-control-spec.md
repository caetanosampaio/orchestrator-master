# Mission Control: especificação da reformulação

Documento de trabalho dos dois construtores. Origem: briefing do usuário (reformular o Mission Control do FORGE com referência visual em overclock.sh e no Cockpit).

## Objetivo
Um workflow visual de agentes, centralizado, de tamanho equilibrado, que mostra como a missão está sendo executada e se atualiza em tempo real. Parece um editor profissional de workflows de agentes, não um dashboard administrativo.

## Suposições (o usuário pode vetar)
1. "Mission Control" = a página Missions (`client/src/pages/Missions.jsx`).
2. O workflow é gerado das etapas REAIS. Fonte 1 (squad): tarefas do Maestro (`/api/maestro`, `useStore().maestro`) endereçadas a panes do workspace da missão. Fonte 2 (ciclo): se não houver tarefas do Maestro para o workspace, mantém-se o grafo atual do ciclo (planner, etapas do plano, entrega).
3. Tarefas do Maestro não têm `dependsOn`. A dependência é INFERIDA pelo tempo: B depende de A se `A.doneAt <= B.createdAt`. As demais ficam em paralelo. N tarefas simultâneas = N ramos; sequência = linha reta. Nó final 'delivery' liga os nós sem filhos.
4. Modelo e esforço do squad vêm da sessão do pane (`session.model`, `session.effort`). O Planner/Executor do ciclo roda em processo próprio e o servidor não informa modelo/esforço: fica `null` (mostrar "não informado"), nunca inventar.

## Contrato de dados (missions-view.js, dono: PARTE A)
- `buildWorkflow(m, ctx = { sessions: [], maestro: null })` -> `{ nodes, edges, cols, rows }`.
- `nodeDetail(m, nodeId, ctx = { sessions, activity, maestro })`.
- `ctx.sessions` = `/api/terminals.sessions`; `ctx.maestro` = `{ autonomous, tasks: [{ id, to, toRole, toTitle, status, text, taskType, summary, note, createdAt, doneAt }] }`.
- Nó: `{ id, kind: 'mission'|'planner'|'step'|'delivery'|'maestro'|'task', title, subtitle?, state: 'idle'|'working'|'completed'|'attention'|'approval'|'cancelled', col, row, agent, currentTask, terminalId, source: 'squad'|'ciclo', ...campos atuais }`.
- `agent`: `{ name, role, provider: 'claude'|'codex', providerLabel, model: string|null, effort: string|null } | null`.
- `currentTask`: string até 120 caracteres, só quando `state === 'working'`, senão `null`.
- `terminalId`: id da sessão do terminal do agente, ou `null`.
- `nodeDetail` mantém os campos atuais e acrescenta `agent`, `terminalId`, `context` (texto da tarefa ou instruções da etapa), `errors`.
- Mapeamento de status das tarefas do Maestro: conferir os status reais em `server/maestro.js` (pending, entregue/em andamento, done, rejected, expirada, falha). pending -> approval; em andamento -> working; done -> completed; recusada/expirada/falha -> attention.
- Ausente = `null`. Nada simulado.

## PARTE A: dados e workflow (construtor term_06963ac9)
Arquivos: `client/src/missions-view.js`, `client/src/components/MissionWorkflow.jsx`, `client/src/missions-workflow.css`, `server/test/missions-view.test.mjs`.
- Implementar o contrato acima.
- UI do workflow: nós COMPACTOS com nome, papel, provedor+modelo, esforço, status (ponto de estado) e tarefa atual numa linha. Sem cartões pesados nem bordas grossas. Conectores ortogonais com curva suave; traço animado discreto só nos ramos ativos; ramificações visíveis. Centralizado, tamanho equilibrado (largura máx ~1000px, altura entre 320 e 480px, rolagem interna se passar).
- Atualiza em tempo real: é só função do estado recebido (a página re-renderiza com os dados do servidor).
- Testes: N tarefas paralelas = N ramos; sequência = linear; fallback do ciclo; campos agent/currentTask/terminalId; ausência vira null.

## PARTE B: página e painel lateral (construtor term_cf0b2e5d)
Arquivos: `client/src/pages/Missions.jsx`, `client/src/components/MissionPanel.jsx`, `MissionNodeDetail.jsx`, `MissionActivity.jsx`, `client/src/missions.css`; `client/src/App.jsx` só se precisar repassar o terminal selecionado.
- Manter `MissionSidebar` à esquerda.
- Centro: cabeçalho COMPACTO da missão (título, objetivo resumido, estado, progresso, duração; ações Iniciar/Retomar/Cancelar discretas) e o workflow como protagonista logo abaixo.
- Selecionar um nó abre PAINEL LATERAL (drawer à direita; fecha com Esc e botão): contexto, erros, atividade, evidências/aprovação (manter Aprovar/Rejeitar e a lógica de decisão existente) e botão para abrir o terminal correspondente (`onOpenCockpit(workspaceId, terminalId)`). Se o Cockpit não suportar focar o terminal, abrir o workspace e avisar no relatório, sem mexer em `Cockpit.jsx`.
- Informação complementar (atividade geral, custo/tokens, controle, equipe) em `<details>` expansíveis fechados por padrão.
- Evitar excesso de cartões, indicadores, bordas e dados técnicos permanentemente expostos.
- Passar `maestro` (de `useStore()`) no `ctx` de `buildWorkflow`/`nodeDetail`.
- Remover CSS órfão de `missions.css`.

## Estilo (as duas partes)
Retro-terminal do FORGE, igual ao Cockpit (ver `cockpit.css`, `overclock.css`, `tokens.css`): preto forte de fundo, fonte mono, vermelho de menor intensidade e SEM glow (nada de `box-shadow`/`text-shadow` de brilho), animações discretas, respeitar reduced-motion (`html[data-motion="reduced"]` e `prefers-reduced-motion`), hierarquia visual clara, acessível (foco visível, aria, teclado).

## Regras
- Testes só com `ORCH_DATA_DIR` temporário; NUNCA tocar `data/db.json`.
- Sem commit, sem push, sem novas dependências.
- Cada construtor edita só os seus arquivos (os dois compartilham o mesmo worktree).
- Pronto = `npm test` verde e `npm run build` ok, com a saída real no relatório.
