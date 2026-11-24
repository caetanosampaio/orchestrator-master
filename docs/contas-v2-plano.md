# Contas v2: o FORGE sem "conta Sistema" (plano e estado)

Requisito do usuário (2026-11-23): o FORGE é uma ADE agnóstica de provider. Não existe "conta Sistema" nem "padrão do FORGE": o FORGE só precisa de UMA conta logada de ALGUM provider (claude, codex e, no futuro, cursor, kimi, gemini...). O login do Claude do computador passa a ser uma conta comum, igual à do Codex. Na missão, um seletor mostra o provider real, o rótulo, o plano e se a conta está conectada. Os tokens de toda missão já entram no limite da conta (o terminal da etapa nasce pelo mesmo `terminals.create` do Cockpit); a tela de Missões mostra os tokens por etapa e o total com a conta debitada.

## Modelo-alvo
- Conta = linha em `db.accounts`: `{ id: 'acc_xxxxxxxx', provider, label, home: 'machine' | 'forge', createdAt }`. `machine` = login do computador (ambiente do processo); `forge` = pasta isolada `<dados>/accounts/<id>/<provider>`. Linha antiga sem `home` = `forge`.
- View de `GET /api/accounts`: `{ id, provider, providerLabel, label, home, canLogin, createdAt, status: { checked, loggedIn, plan, authMethod, email, orgName, loginExpiresAt, error } }`. Saem `system`, `isDefault`, `defaultId` e `subscriptionType` (vira `plan`).
- Cada provider declara um bloco `account` (`detect`, `status`, `homeEnv`, `env`, `canLogin`/`loginSpec`, `limits`, `label`, `note`); provider novo entra só com o bloco. O literal `'system'` só existe em `server/account-compat.js`.
- Sem conta padrão no servidor: `accounts.resolveFor(provider, pedido?)` = a conta pedida (precisa existir, ser do provider e não estar sabidamente desconectada), senão a ÚNICA utilizável do provider, senão 409 `account_required` (várias) ou `no_account` (nenhuma). A interface pré-seleciona a última usada por provider (`db.settings.lastAccountByProvider`).
- Missão: `flow.accounts = { <provider>: 'acc_…' }` (seletor por provider, não por etapa); `startRun` resolve e grava `run.accounts`; `createArgs` passa `accountId`; `accounts` entra em `PLANNER_DENIED_KEYS` e fica fora de `RUN_SAFE_PATCH_KEYS`.

## Decisões adotadas (recomendações do plano; o usuário pode mudar)
1. Várias contas do mesmo provider sem escolha = 409 `account_required`, com pré-seleção da última usada (sem "conta preferida").
2. Contas da máquina: adoção automática por CLI instalado; remover = "Desvincular" (nunca faz logout nem apaga pasta); "Adicionar conta deste computador" reaproveita o id anterior.
3. Seletor por provider agora; por etapa depois, se precisar.
4. Os registros antigos são REESCRITOS no banco (com backup único `db.json.pre-accounts-v2`, idempotente e reversível); leitura tolerante continua como rede de segurança.
5. Renomear o rótulo da conta (`PATCH /api/accounts/:id`, só `label`).
6. (revisão de 2026-11-23) "Sabidamente desconectada" só bloqueia conta ISOLADA de provider com login pelo FORGE: a do computador pode autenticar por variável de ambiente e o Codex faz o login dentro do próprio terminal.

## Migração (no boot, antes do gerente de terminais)
`migrateAccountsV2(db, { installed, uid, now, backup })` (pura, em `account-compat.js`): cria as linhas `machine` por provider, reescreve `accountId: 'system'`/ausente dos registros PELO provider do registro (o do Codex vai para a conta do Codex), não apaga `defaultAccountId` (só semeia `lastAccountByProvider`), grava `db.accountsModel = { v: 2, at, adopted, machineIds }`. `translateLimitKeys` traduz `claude:system`/`codex` do `rate-limits/last-known.json` para `provider:acc_…` ANTES da poda. Transcripts em `~/.claude` não mudam.

## Estado (2026-11-23)
| Etapa | Arquivos | Estado |
|---|---|---|
| 1. Compatibilidade e migração | `server/account-compat.js`, `server/test/accounts-migration.test.mjs` | **Feita** (22 testes); ainda não ligada ao boot |
| 2. Bloco `account` nos providers | `server/providers/{claude,codex,index}.js`, `server/test/providers.test.mjs` | **Feita** (15 testes); nenhum consumidor usa ainda. Há código duplicado temporário de `accounts.js`/`claude-cli.js`/`account-login.js` marcado nos comentários |
| 3. Núcleo de contas | `accounts.js`, `account-login.js`, `claude-cli.js`, `index.js` (boot + rotas) | **Feita** (2026-11-23, sem commit): `createAccounts` genérico pelo bloco `account`; `create` (isolada ou `home:'machine'`), `rename` (`PATCH`), `remove` (desvincular a do computador), `resolveFor`, `lastUsed`/`remember`; `migrateAtBoot` + `createDbBackup` ligados ao boot com rollback; rota `/default` removida; cópias temporárias apagadas (resta `CMD_SAFE_ARG`). Ponte TRANSITÓRIA marcada em `accounts.js` (`defaultId`, `configDirOf`/`usable`/`statusOf` aceitando a referência antiga) até as etapas 4 a 6 |
| 4. Terminais | `terminals.js`, `conversations.js` | **Feita** (2026-11-23, sem commit): `resolveFor` para qualquer provider (Codex também exige conta), `remember` após abrir, ambiente pelo bloco `account`, registros antigos por `resolveLegacyAccountId`, CLI ausente checada antes da conta. Testes: `accounts-use`, `trust`, `terminals-accounts-v2` (novo) |
| 5. Limites | `rate-limits.js`, `usage-api.js` | **Feita** (2026-11-23, sem commit): contas reais (sem `system`/`codex`), chaves `<provider>:acc_…`, `translateLimitKeys` antes da poda (legada sem conta correspondente fica PRESERVADA no arquivo), `plan` do `statusOf`, `usage-api` com `isMachine`/`credsDirOf` sem cair no login do computador. `/api/limits` ganhou `provider` e `home` por conta. Testes: `rate-limits`, `limits-persist`, `usage-api` |
| 6. Prereqs | `prereqs.js` + linhas de `index.js` | **Feita** (2026-11-23, sem commit): `prereqs.login` = ALGUMA conta conectada de algum provider (detail só com o nome do provider); variável de ambiente vale na conta do computador do Claude; `/api/state?fresh=1` invalida todas as contas. Ponte TRANSITÓRIA removida de `accounts.js` (nenhum `'system'`/`defaultAccountId` fora de `account-compat.js` na produção) |
| 7. Missões (servidor) | `flows.js`, testes `flows-*`, `docs/missions-v2-fatia3.md` | **Feita** (2026-11-23, sem commit): `flow.accounts` por provider (validado; fora de `RUN_SAFE_PATCH_KEYS`; em `PLANNER_DENIED_KEYS`), `run.accounts` resolvido no `startRun` antes de qualquer efeito, `accountId` nos terminais das etapas e no briefing, pulo da agenda registrado com a mensagem de conta, `step.usage` (snapshot do consumo gravado antes de fechar o terminal). Contrato em `docs/missions-v2-fatia3.md` (D2). Teste novo `flows-accounts` |
| 8. Cliente: Contas, Setup, limites, Cockpit | `accounts-view.js`, `AccountsPanel.jsx`, `provider-view.js`, `prereqs.js`, `PrereqModal.jsx`, `Setup.jsx`, `AisSection.jsx`, `limits-view.js`, `LimitsStrip.jsx`, `StatusBar.jsx`, `TerminalGrid.jsx` | A fazer |
| 9. Cliente: Missões | `flows-view.js`, `FlowForm.jsx`, `FlowBriefing.jsx`, `Missions.jsx`, `FlowWorkflow.jsx`, `FlowHeader.jsx`, `store.jsx` | A fazer (os textos "Sistema (padrão)" saem aqui) |
| 10. Limpeza e guarda | teste que falha se aparecer `'system'`/`defaultAccountId` fora de `account-compat.js` | Por último |

Ordem crítica: 3 antes de 4, 5, 6, 7; 7 antes da 9; 10 por último. 4, 5 e 7 podem ir em paralelo (arquivos disjuntos; `index.js` com um dono só por vez). Modelo dos agentes: código = Opus high; testes, revisão e planejamento = Sonnet high; não lançar muitos Opus ao mesmo tempo.

## Riscos e o que verificar
- A migração altera o `data/db.json` real no primeiro boot com a versão nova: só reiniciar a 4317 com ela depois de tudo testado, e avisar o usuário.
- Cockpit e briefing precisam de seletor de conta quando houver mais de uma do mesmo provider (senão 409 `account_required`).
- Variáveis de autenticação do Codex removidas na conta isolada (`OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`) e o login isolado por `CODEX_HOME` não foram conferidos contra a CLI real.
- O pulo da agenda quando `startRun` falha por conta deve ser registrado com a mensagem: verificar.

## Pendências da revisão de 2026-11-23 (remoção do ciclo antigo; nenhuma bloqueadora)
- Tokens da missão (`flows-view.js` `stepUsage`/`flowUsage`): hoje vêm só do terminal VIVO; quando o runner fecha o terminal da etapa, o número some. Gravar o consumo no passo do run ao fechar o terminal (`flows.js` `closeIdleTerminals`/cancelamento) — mudança de contrato, junto da etapa 7.
- Rótulo "Sistema (padrão)" ainda aparece no tooltip/chip de tokens quando a conta não é conhecida: sai na etapa 9 (ou antes, omitindo a conta desconhecida).
- `README.md` ainda descreve o ciclo autônomo, `/api/missions` e `test:real*`: atualizar.
- Código/comentários mortos: `client/src/worktree-view.js` `worktreeForm`, `server/worktrees.js` `resolveWorktreeIsolation`, comentários de executor em `child-registry.js`, `proc.js`, `prereqs.js`, `project-config.js`, `session-token.js`, `shutdown.js`; `requireApproval`/`showDemoData` em `store.js` `initial()` sem leitor.
- `desktop/main.cjs:163` ainda faz `POST /api/execution/stop` (agora 404, inofensivo) e trata `/live/<token>`: limpar no próximo empacotamento do desktop.
- Segurança (opcional): teste de paridade entre as cópias temporárias em `providers/claude.js` (`CLAUDE_AUTH_ENV`, `CMD_SAFE_ARG`) e `claude-cli.js` até apagar as cópias; conferir `CODEX_AUTH_ENV` contra a CLI real.

## Pendências da revisão das etapas 3 a 5 (2026-11-23; nenhuma bloqueadora)
- Adoção da conta do computador só no boot: CLI instalada depois dá `no_account` até reiniciar ou usar "Adicionar conta deste computador" (`POST /api/accounts { provider, home: 'machine' }`) — a etapa 8 precisa do botão; avaliar adoção preguiçosa.
- ~~Etapa 6: atalho de variável de ambiente e ponte transitória~~ — resolvido na etapa 6.
- ~~Etapa 7: terminais de missão sem `accountId`~~ — resolvido na etapa 7. Também resolvida a pendência dos tokens da missão (`step.usage`).
- `conversations.js`: referência inválida (não legada, não `acc_…`) e legado com a conta do computador desvinculada leem a pasta padrão, enquanto a retomada bloqueia; trocar pela pasta inexistente para ficar coerente.
- `claude-cli.js`: o re-export `envForAccount` ficou sem consumidor de produção (só `accounts-model.test.mjs`); apagar junto com o teste.
- Testes: falta cobrir a rota HTTP `POST /api/terminals` (e `accountId` no SSE `init`) com o contrato novo; hoje os testes chamam o gerente direto.
- Etapa 10: o guarda deve procurar o literal `'system'` entre aspas (há `system-reminder` em `conversations.js` e `log('system', …)` em `store.js`, que são outra coisa).
