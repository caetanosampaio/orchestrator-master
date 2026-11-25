# FORGE

Central local para coordenar agentes de IA no desenvolvimento de software. O FORGE abre vários terminais lado a lado, cada um com um agente de linha de comando (**Claude Code**, **Codex CLI** ou outra das [10 IAs suportadas](docs/AGENTES.md)), e oferece um **Maestro** que distribui tarefas entre eles, **worktrees do git** isolados por agente ou equipe, estado em tempo real e custo por terminal. Tudo roda na sua máquina.

> **Versão 0.1.0, pré-lançamento.** Funciona de ponta a ponta, mas ainda não tem assinatura de código nem atualização automática (veja [Limitações conhecidas](#limitações-conhecidas)).

## O que você precisa antes de usar

| Requisito | Para quê | Como conferir |
|---|---|---|
| **Uma assinatura de IA que o FORGE suporta**, com a CLI dela instalada e o login feito | O FORGE **não** inclui nem substitui a IA: cada agente é a CLI da sua própria assinatura. Basta **uma** das 10, e dá para ter várias. | Veja as linhas abaixo. |
| **Claude Code** (se for usar) | Agente da assinatura Claude. Integração completa. | `claude --version`; o login deste computador já vale, ou use **Configurações > Contas > Entrar**. |
| **Codex CLI** (se for usar) | Agente da assinatura ChatGPT/Codex. Integração completa, sem retomada. | `codex --version`. Instale com `npm i -g @openai/codex` e entre com `codex login` num terminal. |
| **Outras IAs** (se for usar) | Gemini CLI, Cursor CLI e Copilot CLI (recebem tarefas do Maestro); OpenCode, Antigravity CLI, Kimi Code, Kiro CLI e Grok Build (terminal livre). | O comando de instalação de cada uma aparece em **Configurações > Suas IAs**; o login é feito na própria CLI. Detalhes em [docs/AGENTES.md](docs/AGENTES.md). |
| **Git** | Worktrees, relatórios e histórico. | `git --version` (download: https://git-scm.com/downloads) |
| Windows 10/11 (x64) ou macOS (pacote para Intel/x64; em Apple Silicon ainda não foi validado) | Sistemas dos instaladores. | |

Quando falta algo, o FORGE abre o popup **"Antes de começar"** (com o fundo escurecido) explicando o que fazer: nenhuma IA encontrada (bloqueia o uso até você instalar alguma das IAs suportadas), nenhuma conta conectada e Git não encontrado. O FORGE não depende de uma IA específica: basta **uma** conta conectada de **alguma** IA. Com pelo menos uma IA instalada nada bloqueia; o aviso de conta é só informativo.

**Custos:** cada agente é uma sessão da CLI na **sua** conta, então o uso consome o **seu** plano ou os seus créditos. O FORGE mostra tokens e custo estimado por terminal **do Claude Code** (o custo usa a tabela de preços que você informa em `pricing.json`; não há preços embutidos). Para terminais do Codex ainda não há custo por terminal, e para as outras 8 IAs ainda não há tokens nem custo em lugar nenhum (Home, golem e limites só mostram Claude e Codex).

## Instalação

- **Windows:** use `FORGE-0.1.0-Setup.exe` (instalador) ou `FORGE-0.1.0-Portable.exe` (sem instalar). Como o app ainda não é assinado, o Windows pode mostrar "Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.
- **macOS:** abra o `.dmg` e arraste o app para Aplicativos. Como o app ainda não é assinado nem notarizado, na primeira vez clique com o botão direito no app e escolha **Abrir**.

## Primeiros passos

1. Instale o Git e a CLI de pelo menos uma IA (veja a tabela acima).
2. Confira as contas em **Configurações > Contas**. O login que este computador já usa em cada IA aparece como a conta **"deste computador"** (no primeiro uso o FORGE vincula sozinho as CLIs instaladas; uma CLI instalada depois entra pelo botão **Adicionar conta deste computador**). No Claude Code dá para adicionar outras contas isoladas (por exemplo, a do trabalho ao lado da pessoal) com **Adicionar conta > Entrar**: o FORGE abre o navegador e detecta sozinho quando a conta conecta. No Codex o login é feito com `codex login` num terminal. Não existe conta "padrão": com uma conta só, ela é usada; com várias da mesma IA, você escolhe (o FORGE pré-seleciona a última usada).
3. Clique em **+** ao lado de *Workspaces* para escolher a pasta do seu projeto.
4. Escolha a IA dos terminais novos e abra uma equipe (Dupla, Squad, Squad de 6 ou Construtor). Cada terminal é uma sessão da CLI escolhida naquela pasta; com *Worktree* ligado, cada equipe trabalha numa cópia isolada do código. Se a IA tiver mais de uma conta, a barra do workspace mostra um seletor com a conta dos próximos terminais.
5. O golem da barra lateral martela enquanto houver agentes trabalhando e para aos poucos quando eles terminam. Clique nele para ver o nível.

> **Atenção:** os agentes leem e **executam comandos** na pasta do projeto com as permissões do seu usuário. Abra no FORGE apenas projetos em que você confia, e revise o que o agente pede para fazer.

## O que o FORGE faz hoje

- **Grade de terminais** (PTY real): vários agentes lado a lado, com layouts (grade, colunas, linhas, foco), trilhas arrastáveis e layout salvo por workspace.
- **Dez IAs**, escolhidas por terminal e misturáveis na mesma equipe, em três níveis de integração:
  - **completa:** Claude Code e Codex CLI;
  - **recebem tarefas do Maestro:** Gemini CLI, Cursor CLI e Copilot CLI. O Maestro só entrega a tarefa depois que o terminal prova que se conectou a ele;
  - **terminal livre:** OpenCode, Antigravity CLI, Kimi Code, Kiro CLI e Grok Build. Abrem na pasta do projeto, mas não são Maestro, vaga de time nem etapa de missão, e o papel não chega a elas.

  Em **Configurações > Suas IAs**, o botão **Testar integração** abre um terminal de teste e mostra se a IA se conectou de fato ao Maestro nesta máquina. Veja [docs/AGENTES.md](docs/AGENTES.md).
- **Papéis e equipes**: Maestro, Construtor, Revisor e Batedor, cada um com o seu prompt; equipes prontas (Dupla, Squad, Squad de 6 e Construtor).
- **Maestro**: um terminal que divide o pedido e envia tarefas aos outros por um servidor MCP local. O **modo autônomo** vem ligado: as tarefas são entregues na hora (até 12 por minuto) e os terminais novos de **todas** as IAs abrem com acesso total, sem pedir confirmação. Desligado (por você, nas Configurações), cada tarefa fica **pendente até você aprovar** e os terminais pedem confirmação como de costume.
- **Worktrees do git**: um por agente que edita, ou um compartilhado por equipe, com verificação de conflitos e integração controlada.
- **Estado em tempo real** de cada terminal e de cada workspace (executando, aguardando você, concluído, com erro), na grade, na sidebar e no status global.
- **Sessões**: histórico, retomada automática da equipe ao reabrir o app e, nos terminais do Claude Code, retomar e bifurcar conversas.
- **Contas por IA**: a conta deste computador de cada IA instalada e, no Claude Code, contas isoladas com login próprio pelo navegador; renomear, desvincular e escolher a conta por terminal e por missão. Os limites de uso (janela de 5 h e semana) aparecem por conta na barra de status.
- **Missões**: missões em etapas, cada etapa executada por um agente num terminal real (o mesmo do Cockpit), com dependências, paralelo isolado em worktrees, verificação antes de integrar, integração na branch do workspace, envio opcional ao remoto, automações agendadas e criação por briefing com um Planejador. Cada IA da missão usa a conta escolhida, e os tokens de cada etapa entram no limite dessa conta. Veja [docs/missions-v2-spec.md](docs/missions-v2-spec.md).
- **Loadouts**: skills e MCPs por papel, entregues ao Claude Code por um plugin de sessão fora do seu projeto.
- **Desktop** (Electron) para Windows e macOS, com log rotativo, reinício automático do servidor e menu Ajuda com diagnóstico.


## Arquitetura em resumo

```
Electron (desktop/)  ->  servidor Node + Express (server/, só 127.0.0.1)  ->  CLIs dos agentes (node-pty)
      |                          |                                              Claude Code, Codex CLI e as outras IAs
 token de sessão          db.json, history/, mcp/                                      ^
      v                          v                                                     |
 React + Vite (client/) <-- API REST + SSE --  Maestro (MCP local) -------------------+
```

- `server/`: API Node (ESM, Express 4), terminais PTY (`terminals.js`), Maestro (`maestro.js`), missões (`flows.js`), worktrees (`worktrees.js`), contas (`accounts.js`; a tradução do modelo antigo fica só em `account-compat.js`), limites (`rate-limits.js`), persistência em JSON (`store.js`) e, em `providers/`, o adaptador de cada CLI (inclusive o bloco `account` de cada uma). O núcleo só conhece a interface do provedor, nunca os argumentos da CLI.
- `client/`: React 18 + Vite. A lógica de visão fica em módulos puros testados a partir de `server/test/`.
- `desktop/`: Electron que sobe o servidor, gera o token de sessão e empacota instaladores.

Detalhes, contratos e decisões em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Onde ficam os dados

| O quê | Windows | macOS |
|---|---|---|
| Dados (`db.json`, `history/`, `loadouts/`, `mcp/`, `agent-status/`, `accounts/`, `pricing.json`) | `%APPDATA%\FORGE\data` | `~/Library/Application Support/FORGE/data` |
| Log do servidor | `%APPDATA%\FORGE\logs\server.log` | `~/Library/Application Support/FORGE/logs/server.log` |

O FORGE **não** guarda o login das contas "deste computador": ele fica com a própria CLI (`~/.claude` no Claude Code, `~/.codex` no Codex). Só as contas isoladas do Claude Code têm o login numa pasta própria em `accounts/`. Desinstalar o app **não** apaga os dados do FORGE. Para remover tudo, apague a pasta `FORGE` indicada acima. O que é gravado, por quanto tempo e como apagar está em [PRIVACIDADE.md](PRIVACIDADE.md).

## Como reportar um problema

No menu **Ajuda** (no Windows, pressione `Alt` para exibir o menu) use **Copiar informações de diagnóstico** e cole no seu relato, junto com o passo a passo para repetir o problema. **Abrir pasta de logs** leva ao `server.log`. O diagnóstico traz a versão do app, do Electron e do sistema e os caminhos das pastas de logs e de dados (que no Windows contêm o seu nome de usuário). Não inclui senhas, tokens nem o conteúdo dos seus projetos.

## Segurança em resumo

- O servidor interno escuta **somente** em `127.0.0.1` (a própria máquina), numa porta livre, e valida `Host` e `Origin` de cada requisição.
- No app desktop, ações que alteram estado (aprovar tarefas, escrever em terminais) e leituras de conteúdo sensível (saída dos terminais, conversas, contas) exigem um token de sessão gerado a cada abertura e injetado só na janela do app.
- Cada conta isolada do Claude Code tem a sua pasta de login dentro dos dados do FORGE (desvincular a conta deste computador nunca faz logout nem apaga nada), e os agentes rodam com as suas permissões e podem lê-las: abra apenas projetos em que você confia.
- O Codex é aberto com o sandbox `workspace-write` e aprovação `on-request`; a credencial do Maestro vai só no ambiente do processo, nunca em arquivo nem na linha de comando.
- Configuração de projeto que executa comandos e não está revisada no Git exige a sua confirmação antes de abrir **e** antes de reabrir o terminal. Cada IA tem os seus caminhos: `.claude/settings.json`, `.mcp.json`, `.claude/agents` e `.claude/skills` no Claude Code, `.codex` no Codex, `.gemini`, `opencode.json` e assim por diante (lista completa em [docs/AGENTES.md](docs/AGENTES.md)). Em "Restaurar todas", a confirmação é pedida por IA.
- Gemini, Cursor e Copilot recebem a credencial do Maestro no ambiente do processo. O Copilot também a recebe num arquivo da pasta do terminal, que tem acesso só do seu usuário e é apagada quando o terminal fecha. Para o Cursor, o FORGE acrescenta a entrada `forge-maestro` (sem porta nem token) ao seu `~/.cursor/mcp.json`, com uma cópia `.forge-backup` antes da primeira mudança. O FORGE não toca o arquivo se ele for um link ou não for um JSON válido.
- Missões: o acesso total (sem pedir confirmação) é opcional por missão; integrar e enviar ao remoto passam pela verificação que você define, e a etapa que para sem concluir espera a sua decisão (continuar, aceitar ou recusar), registrada.
- O FORGE não envia dados a nenhum servidor próprio. Quem fala com cada empresa de IA é a própria CLI dela (o Claude Code com a Anthropic, o Codex CLI com a OpenAI e assim por diante). A única outra chamada de rede do FORGE é o preparo opcional de um worktree (`npm ci --ignore-scripts`), que só roda depois de você aprovar o plano mostrado e baixa pacotes do registro do npm.

## Limitações conhecidas

- Instaladores **sem assinatura de código** e **sem atualização automática**: novas versões precisam ser instaladas manualmente.
- macOS: pacote apenas para processadores Intel (x64); Apple Silicon ainda não foi validado.
- **Codex CLI**: não retoma nem bifurca conversas (um terminal Codex interrompido volta como terminal novo), não tem loadouts nem tokens e custo por terminal, usa só a conta deste computador (o login é feito no próprio Codex CLI) e o isolamento por `CODEX_HOME` não foi conferido contra a CLI real. A integração foi validada contra o Codex real com um modelo simulado; o uso com conta real ainda não foi exercitado em testes.
- **As outras 8 IAs** (Gemini, Cursor, Copilot, OpenCode, Antigravity, Kimi, Kiro e Grok) foram integradas pela documentação oficial e testadas só com terminal simulado: nenhuma foi rodada de verdade. Não retomam conversas, não têm contas no FORGE, loadouts nem tokens e custo. No Windows, o hook do papel do Gemini assume que o shell do hook é o PowerShell (não verificado).
- O OpenCode, por padrão, **não pede confirmação** para nada (a política dele é permitir tudo).
- O `claude auth login` real (pelo FORGE) só foi testado com uma CLI simulada.
- Interface apenas em português e com um tema só (escuro).
- Máximo de 50 terminais simultâneos.

## Para desenvolvedores

```bash
npm run install:all       # dependências da raiz e do client
npm run server            # API em 127.0.0.1:4317 (usa o banco REAL em data/)
npm run dev               # servidor + Vite (também usa o banco real)
npm run build             # gera client/dist, que o servidor serve
```

**Testes** (a suíte completa leva alguns minutos). Aponte sempre `ORCH_DATA_DIR` para uma pasta temporária, senão alguns testes usam `data/`:

```bash
# bash
export ORCH_DATA_DIR="$(mktemp -d -t orch-suite-XXXX)"; npm test
# PowerShell
$env:ORCH_DATA_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP "orch-suite-$(Get-Random)")).FullName; npm test
```

Um arquivo só: `node --test server/test/<arquivo>.test.mjs`. A suíte usa CLIs simuladas e não consome créditos. Alguns testes só valem para um sistema (`posix-process.test.mjs` no macOS/Linux e `win-process.test.mjs` no Windows) e aparecem como ignorados nos outros. A integração contínua (`.github/workflows/ci.yml`) roda a suíte no Windows, Linux e macOS a cada push na `main` e em cada pull request.

**Empacotar o desktop** (rode dentro de `desktop/`, onde estão os scripts):

```bash
cd desktop && npm install
npm run dist       # Windows: Setup.exe e Portable.exe em desktop/release/
npm run dist:mac   # macOS: .dmg (só em um Mac)
npm run dir:mac    # macOS: só o FORGE.app em desktop/release/mac (sem .dmg), para testar
```

**Migração das contas (v2):** o primeiro boot de uma versão com as Contas v2 reescreve o `db.json` (as referências à antiga conta "Sistema" viram a conta deste computador de cada IA) e guarda antes uma cópia única em `db.json.pre-accounts-v2`, na mesma pasta. Plano e estado em [docs/contas-v2-plano.md](docs/contas-v2-plano.md).

Estrutura: `server/` (API Node + Express, terminais PTY, Maestro, worktrees, contas, missões), `server/providers/` (um adaptador por IA; as de terminal livre usam a fábrica `cliProvider` de `cli-path.js`), `client/` (React 18 + Vite), `desktop/` (Electron), `server/test/` (testes com `node:test`).

## Licença

Veja [LICENSE](LICENSE).
