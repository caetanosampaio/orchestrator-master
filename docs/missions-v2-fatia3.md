# Missions v2, fatia 3: verificação, envio ao remoto e parada por limite

Documenta o que foi construído depois da fatia 2 (2026-11-20) e endurecido na revisão de 2026-11-23. Complementa `docs/missions-v2-spec.md` (fatia 1), `docs/missions-v2-fatia2.md` (paralelo isolado, integração, retomada, agenda) e `docs/missions-v2-briefing.md` (criação por briefing). Descreve o contrato atual do código; em caso de dúvida vale o código e os testes citados no fim.

## Decisões do usuário (fixas)
1. **Verificação opcional antes de integrar**: um comando do usuário (ex.: `npm test`) roda numa cópia isolada do commit da missão. Não passou = nada é integrado.
2. **Envio ao remoto** só depois da integração final, só do commit integrado, nunca com `--force`, e o automático só com a verificação aprovada.
3. **Parada por limite de uso da conta** só explica a parada: nunca conclui nem falha a etapa sozinha.
4. **A2 (2026-11-23): sem confirmação quando o agente altera `package.json`, `.npmrc` ou testes.** O comando de verificação executa o código da missão (inclusive scripts e testes que os agentes editaram) com o usuário do FORGE. Isso é aceito e está dito na interface (formulário) e no código (`flow-git.js`). Não propor confirmação por arquivo alterado.
5. **M1 (2026-11-23): não há confirmação atada ao valor de `verifyCommand`/`autoPush`.** Sem `ORCH_API_TOKEN` o `apiGuard` é só checagem de Host e Origin, não autenticação; exigir token no servidor puro quebraria o uso normal. Reavaliar se o token virar obrigatório.

## A. Modelo de dados
**Flow** (`db.flows[]`), novos campos (compatíveis: flow antigo sem eles = sem verificação e sem envio automático):
- `verifyCommand: null | { args: string[], timeoutSec }`. `args`: 1 a 16 itens de texto, até 200 caracteres cada, sem caracteres de controle; `args[0]` é o executável (não vazio). `timeoutSec`: inteiro de 10 a 1800 (padrão 300). Valor inválido no banco vale como `null`.
- `autoPush: boolean` (padrão `false`). Só pode ser `true` com `verifyCommand` definido; remover o comando com `autoPush` ligado é recusado (400).
- Só o **usuário** define os dois: o planejador nunca (`PLANNER_DENIED_KEYS`). Com run ativo só `schedule`, `autoIntegrate` e `autoPush` podem mudar (`RUN_SAFE_PATCH_KEYS`); `verifyCommand` não muda com run ativo, então a verificação que passou é a do comando atual.

**Run** (`run.git`, só em modo Git):
- `verifying: null | { startedAt, command }`: marca gravada ANTES de rodar a verificação; some com o resultado.
- `verification: null | { status: 'pass'|'fail'|'timeout'|'error', command, exitCode, durationMs, outputTail (últimos 4000 caracteres, segredos ocultados), truncated, at, tip }`. `tip` é a ponta da branch da missão que foi verificada.
- `pushTarget: { remote, mergeRef, branch, url (sem credencial), urlHash, at }`, gravado logo depois de criar a branch da missão, ANTES de qualquer agente rodar (sem rede). Sem remoto configurado: campos `null` com `reason`.
- `push: { state: 'pushing'|'pushed'|'blocked'|'failed', by: 'auto'|'user', code, error, remote, branch, url, from, to, commits: [{ sha, subject }], more, already, at }`. Falha no envio nunca desfaz a integração.

**Etapa**: `stopReason: 'limit' | null` e `limitResets: string | null` (horário de reset como a CLI mostrou); `continues` e `continuedAt` contam as decisões `continue`; `continueResume` é interno.

## B. Verificação (`server/flow-verify.js`, `finishGit` em `flows.js`)
- Roda no fim do run em modo Git, ANTES da integração final, sob o passo comum do runner. Passou: segue o fluxo de sempre (integração automática ou `ready_to_integrate`). Não passou (`fail`, `timeout` ou `error`): `ready_to_integrate` com `run.error` "Verificação falhou: …" e nada integrado, mesmo com `autoIntegrate`; Integrar pelo usuário continua liberado e a interface mostra o aviso e o fim da saída.
- A mesma ponta já aprovada não roda de novo (`verification.status === 'pass'` e `tip` igual).
- **Execução**: cópia isolada (`git clone --local --no-hardlinks --no-checkout` para uma pasta temporária + `checkout --detach <sha>`, pelo `git` de `worktrees.js`: hooks desligados, sem prompt); nada é escrito no repositório do usuário; a cópia é apagada num `finally` (também após timeout, falha ou saída gigante). `spawn` sem shell, `cwd` = a cópia, timeout com `killTree`, teto de saída de 2 MB (só o fim é guardado). `npm`/`npx` rodam por `node` + `npm-cli.js`/`npx-cli.js`; `.cmd`/`.bat` não rodam sem shell no Windows (erro claro em português).
- **Ambiente por LISTA PERMITIDA** (+ `CI=1`, sem notificações do npm): `PATH`, pastas do sistema, do usuário e temporárias, idioma e fuso, a localização de toolchains (`JAVA_HOME`, `GOPATH`, `GOROOT`, `CARGO_HOME`, `RUSTUP_HOME`, `DOTNET_ROOT`, `VIRTUAL_ENV`, `NVM_DIR`, `VOLTA_HOME`, `PSModulePath`) e o CA corporativo (`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`). Ficam de fora, seja qual for o nome: URLs com senha, PATs, webhooks, `NODE_OPTIONS`, `GIT_*`, `LD_*`, proxies, `npm_*` e tudo que case com `key|token|secret|passw|credential|auth`. Uma verificação que dependa de outra variável falha; ampliar a lista é uma mudança de `ENV_ALLOW`.
- **Cancelar** durante a verificação encerra o processo e a cópia; **reinício do servidor** durante ela vira `ready_to_integrate` com `verification.status: 'error'` ("o servidor reiniciou durante a verificação"), sem integrar.
- Em modo pasta (sem Git) não há verificação.

## C. Envio ao remoto (`server/flow-push.js`)
Só o commit integrado (`run.git.integration.to`) vai para a branch que a do usuário acompanha (`branch.<base>.remote`/`.merge`), por refspec explícito `<sha>:<refs/heads/…>`, **sem `+`, sem `--force`, sem tags, sem submódulos, sem assinatura, hooks desligados**, só por `https` ou `ssh` (`GIT_ALLOW_PROTOCOL`), sem prompt de login (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`) e com tempo limite (90 s o envio, 30 s a consulta). As credenciais são as do Git da máquina; o FORGE não lê nem grava token e a URL mostrada passa por `scrubGitText`. Não cria branch no remoto.

**Avaliação** (`assess(run)`, só leitura): devolve `{ remote, branch, mergeRef, url, from, to, commits (até 50), more, reasons: [{ code, message }], already, digest }`. Códigos de `reasons`:
- Impedimentos para os dois modos: `not_integrated`, `nothing`, `no_upstream`, `git_unknown`, `branch_moved`, `remote_unknown`, `no_remote_branch`, `remote_ahead`, `verify_not_passed` (só no automático) e os dois abaixo, que **cortam a avaliação antes de qualquer chamada de rede**:
  - `target_changed`: remoto, branch ou URL de envio diferentes dos gravados em `pushTarget` (um agente trocou o remoto, uma `pushurl` ou um `insteadOf`);
  - `unsafe_config`: a configuração LOCAL do repositório tem chaves que executam comando ou redirecionam o envio (`core.sshCommand`, `core.gitProxy`, `core.askPass`, `core.alternateRefsCommand`, `credential.*`, `remote.*.pushurl/proxy/…`, `url.*.insteadOf`, `include*`, `protocol.*`, `http.*proxy`, `gpg.*`). Motivo: o `git ls-remote` executaria o comando do agente com o ambiente completo do FORGE.
- Avisos que só bloqueiam o automático e o manual aceita com a sua confirmação (`USER_OK`): `local_unpushed` (a branch tinha commits não enviados antes da missão), `foreign_commits` (o commit integrado não é a ponta verificada: integração por merge ou "já estava") e `target_unknown` (o destino não foi gravado no início).
- `already: true` quando o remoto já contém o commit integrado (igual ou à frente).
- `digest` = sha256 de `[run.id, remote, mergeRef, urlHash, from, to, códigos dos avisos]`.

**Automático** (`autoPushAfter`, depois da integração final): só com `flow.autoPush`, `verification.status === 'pass'` na mesma ponta integrada e integração `ff` com `to === verification.tip`; senão registra `blocked` (`verify_not_passed` ou `foreign_commits`). Roda em segundo plano (`void`), sem segurar o runner.

**Manual** (botão "Enviar ao remoto"):
- `GET /api/flows/:id/runs/:runId/push`: prévia (consulta o remoto) → `{ remote, branch, url, from, to, commits, more, already, reasons, digest, canPush }`. 409 `not_integrated` se a execução não foi integrada.
- `POST /api/flows/:id/runs/:runId/push` `{ expect: <digest da prévia> }` (obrigatório, 32 hex): 200 com a visão do run; 400 corpo inválido; 409 com `code` (`changed` = o que seria enviado mudou desde a prévia, `busy` = já há um envio em andamento, ou qualquer motivo de impedimento); 500 falha de gravação.
- Um envio por vez por execução; a marca `pushing` é gravada ANTES (sem gravar, não envia). Depois do `git push` o remoto é relido e só então vira `pushed` (senão `unconfirmed`).
- Um envio que já deu certo para o mesmo commit **não é apagado** por uma tentativa posterior que falhe; o erro volta na resposta, o registro `pushed` fica.
- **Reinício do servidor**: `pushing` vira `failed/interrupted` ("confira o remoto e envie de novo (repetir é seguro)"). Missão integrada com `autoPush` ligado, sem registro de envio e não editada depois de integrar (`integration.at >= flow.updatedAt`) ganha `failed/interrupted` ("o servidor reiniciou antes do envio automático: use Enviar agora").

## D. Parada por limite de uso (`server/limit-stop.js`, `flows.js`)
- `detectLimitStop(texto)` olha só os últimos 700 caracteres do terminal e reconhece frases de PARADA ("hit/reached your … limit", "usage limit reached", "5-hour/weekly/session limit reached"), nunca de aviso. Devolve `{ resets }` (horário curto e limpo, até 48 caracteres, só ASCII seguro) ou `null`.
- Etapa que parou (relatório automático do Maestro ou agente parado) com esse texto leva `stopReason: 'limit'` e `limitResets`; a decisão e o gate não mudam: a etapa segue `waiting` com `unconfirmed: true`.
- **Decisão `continue`** (`POST .../steps/:stepId/decision` `{ decision: 'accept'|'reject'|'continue' }`): só em run `running`, etapa `unconfirmed` e agente parado (409 caso contrário). Terminal vivo: o Maestro entrega o texto fixo "continue de onde parou; ao terminar chame report_done." na mesma conversa; terminal encerrado: reabre pelo caminho do Retomar. Falhou ao reabrir: a etapa volta a esperar a decisão com o motivo (`continueResume`); continuar nunca tira a opção de aceitar ou recusar. Nenhum dado do usuário ou do agente vai ao terminal. Nada conclui sozinho: só o `report_done` ou outra decisão sua.
- Run `interrupted` (servidor reiniciou): a parada continua visível e o caminho é Retomar.

## D2. Contas da missão e consumo por etapa (Contas v2, etapa 7; `server/flows.js`, 2026-11-23)
Não existe conta "Sistema" nem conta padrão (ver `docs/contas-v2-plano.md`): todo terminal de missão roda numa conta real (`acc_<8hex>`) de algum provedor, e o gasto entra no limite dela.

**Flow** (`db.flows[]`), campo novo `accounts: null | { <provider>: 'acc_xxxxxxxx' }`: seletor **por provedor** (não por etapa).
- Formato fechado (`validateFlowAccounts`): chave = provedor conhecido; valor = id `acc_` + 8 hex (nada vira caminho; a referência antiga da conta virtual é recusada); `null`/`{}`/valor `null` = sem escolha. Só provedores usados pelas etapas (outro = 400). Editar as etapas e deixar de usar um provedor poda a escolha dele em silêncio.
- `POST`/`PATCH /api/flows` conferem cada conta pedida: inexistente = 400 `account_not_found`; de outro provedor = 400 `account_provider_mismatch` (a resposta traz `provider`). Desconexão NÃO é conferida aqui (só no início do run).
- Ausente/`null` = no início do run vale a regra do `accounts.resolveFor`: a ÚNICA conta utilizável do provedor.
- `accounts` fica FORA de `RUN_SAFE_PATCH_KEYS` (com run ativo, mudar a conta = 409) e entra em `PLANNER_DENIED_KEYS` (o planejador nunca escolhe conta; a proposta sai com `accounts: null`).
- Banco editado à mão com formato inválido: a visão mostra `null` e o run usa a regra do `resolveFor`.

**Run**, campo novo `accounts: { <provider>: 'acc_…' } | null` (`null` só em servidor sem módulo de contas): resolvido no `startRun` para CADA provedor das etapas, ANTES de qualquer efeito (a CLI ausente é conferida antes, como no Cockpit), e gravado com o run (falha de gravação = nada criado). A conta fica **fixada**: o terminal de cada etapa nasce com `accountId: run.accounts[step.provider]` e mudar a missão depois não muda o run. Recusa = o run não nasce:
- `POST /api/flows/:id/runs` → 409 `{ error, code, provider }` com `code` do `resolveFor`: `account_required` (2+ contas do provedor e nenhuma escolhida), `no_account`, `account_disconnected`, `account_missing` (em remoção) e, para a conta escolhida que sumiu ou mudou de provedor, `account_not_found`/`account_provider_mismatch` (409 aqui: o pedido é válido, o estado é que mudou). O texto começa pelo nome do provedor e diz o que fazer ("Escolha a conta deste provedor na missão (Editar missão)…"). 500 `account_error` se o módulo de contas lançar.
- **Retomar** (`POST …/resume`) e **Continuar** com o terminal encerrado conferem de novo a conta fixada (removida/desconectada = 409 com o mesmo `code` e `provider`; o run continua `interrupted`, a etapa continua esperando). Reabrir a MESMA conversa usa a conta gravada no registro da sessão (a mesma do run); terminal novo usa `run.accounts`. Run anterior a esta etapa (sem `accounts`) resolve e fixa ao retomar.
- **Agenda**: a recusa vira o pulo `start_failed` já existente, REGISTRADO com a mensagem (ex.: "Claude Code: Há mais de uma conta do Claude Code: escolha qual usar. Escolha a conta…", até 300 caracteres) e visível em `scheduleSkips`; `startScheduled` devolve também o `code`.
- **Briefing**: ver `docs/missions-v2-briefing.md` (`accountId` opcional no corpo, escolhido pelo usuário; recusa com `code` e `provider`).

**Consumo da etapa** (pendência da revisão de 2026-11-23): `step.usage` (no run) = o último consumo conhecido do TERMINAL da etapa, gravado pelo servidor:
`{ input, output, cacheWrite, cacheRead, total, io, turns, model: string|null, costUsd: number|null, accountId: 'acc_…'|null, terminalId, at }`.
- Mesmo formato de `session.usage` do Cockpit (`terminal-usage.js`; `io` = entrada + saída, o número que o terminal mostra), mais a conta debitada (a do terminal) e o terminal medido. Inteiros ≥ 0; `model` só no formato de id de modelo (senão `null`); `costUsd` arredondado a 6 casas ou `null` (sem tabela de preços). Nunca leva o id da sessão nem caminho de transcrição.
- Quando: ao concluir/falhar/ser decidida a etapa, no fim do run (folder) ou falha do run, e SEMPRE antes de o runner fechar terminais (`cancelRun` grava na mesma mutação do cancelamento, com rollback; `closeIdleTerminals` depois da integração final/descartar/limpar). Sem leitura (provedor sem transcrição, como o Codex hoje; terminal já fechado; valor inválido) nada é gravado e o snapshot anterior fica.
- Etapas que compartilham terminal (`continueFrom`) levam o MESMO `terminalId` e um número cumulativo: some uma vez por `terminalId`.
- **Para o cliente (etapa 9)**: terminal vivo na lista de sessões = use o ao vivo (`session.usage`, `session.accountId`); senão use `step.usage` (e `step.usage.accountId` para nomear a conta). `run.accounts` diz a conta de cada provedor do run. O rótulo "Sistema (padrão)" sai: conta desconhecida = omitir.
- Limite conhecido: retomada com terminal NOVO (Codex ou reabertura) começa outra sessão; o consumo do terminal anterior só fica se tiver sido gravado antes (o servidor que caiu não grava nada).

## E. Interface (`client/src`)
- **Formulário de missão** (`FlowForm.jsx`): "Verificação antes de integrar" (comando, tempo limite, avisos de que o comando não usa shell e de que **executa o código da missão**) e "Enviar para o remoto (push) depois de integrar" (travado sem verificação; o servidor também recusa).
- **Cabeçalho** (`FlowHeader.jsx`): chips "envio automático", "enviada para origin/main · <sha>" ou "envio pendente" com o motivo; "Enviar ao remoto" abre `PushDialog` com a prévia (commits, destino, avisos). `target_changed` e `unsafe_config` aparecem como "Não dá para enviar agora" (botão desabilitado); `local_unpushed`, `foreign_commits` e `target_unknown` aparecem como "Confira antes de enviar". `PUSH_WARN` no cliente é igual a `USER_OK` no servidor.
- **Execução pronta para integrar**: o resultado da verificação (`falhou`, comando, código de saída, duração) e o fim da saída. **Etapa parada no limite**: "parou no limite da conta (reseta <horário>): clique em Continuar" e o selo "parou no limite".
- Lógica pura em `client/src/flows-view.js` (`pushInfo`, `validateVerifyDraft`, …), testada por `server/test/flows-view.test.mjs`.

## F. Limites conhecidos
- O comando de verificação roda com o usuário do FORGE e `HOME`/`USERPROFILE`: pode ler `~/.npmrc`, `~/.ssh` e credenciais em arquivo (decisão 4). A lista de ambiente reduz o que vaza por variável, não por arquivo.
- Sem `ORCH_API_TOKEN` a API só confere Host e Origin; qualquer processo local do mesmo usuário pode definir `verifyCommand`/`autoPush` (decisão 5).
- Queda do servidor no meio da integração final: o aviso de envio automático interrompido só aparece no boot seguinte (o `recover()` roda antes do `recoverGit`).
- A prévia do envio é um `GET` com efeito de rede (consulta o remoto), mas nunca executa configuração insegura (ver C).
- `core.alternateRefsCommand` e as demais chaves de `UNSAFE_KEY_RE` só valem para a configuração LOCAL do repositório; configuração global/de sistema do Git não é inspecionada.
- O cliente não valida os limites de 16 argumentos e 200 caracteres por argumento do comando (só o servidor, com 400).
- Resolução do executável no Windows: um `node.exe` commitado na cópia pode ser achado primeiro pelo `cwd` (a verificação já executa código da missão; o risco é da mesma classe).
- Falhas já existentes e fora desta fatia: `evidence-git-case` (`.GIT` x `.github`, Windows).

## G. Testes (todos com `ORCH_DATA_DIR` temporário; Git real em repositórios temporários e remoto bare local; sem rede)
`server/test/flow-verify.test.mjs`, `flows-verify-gate.test.mjs`, `flow-push.test.mjs` (inclui o sentinela em `core.sshCommand`), `flows-push.test.mjs`, `limit-stop.test.mjs`, `flows-validation.test.mjs`, `flows-view.test.mjs` e, para as contas e o consumo por etapa (D2), `flows-accounts.test.mjs` e `flows-git-runner.test.mjs`. Validação visual feita em 2026-11-23 com o Edge headless contra uma instância isolada (porta própria, banco temporário, missões semeadas em sete estados).
