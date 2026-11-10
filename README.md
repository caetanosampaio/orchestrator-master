# FORGE

Central local para coordenar agentes de IA no desenvolvimento de software. O FORGE abre vários terminais lado a lado, cada um com um agente de linha de comando (**Claude Code** ou **Codex CLI**), e oferece um **Maestro** que distribui tarefas entre eles, **worktrees do git** isolados por agente ou equipe, estado em tempo real e custo por terminal. Tudo roda na sua máquina.

> **Versão 0.1.0, pré-lançamento.** Funciona de ponta a ponta, mas ainda não tem assinatura de código nem atualização automática (veja [Limitações conhecidas](#limitações-conhecidas)).

## O que você precisa antes de usar

| Requisito | Para quê | Como conferir |
|---|---|---|
| **Claude Code** instalado e com login feito | Agente principal. O FORGE **não** inclui nem substitui o Claude Code, e sem ele o app não libera o uso. | `claude --version`; depois rode `claude` uma vez para entrar, ou use **Configurações > Contas > Entrar**. |
| **Git** | Worktrees, relatórios e histórico. | `git --version` (download: https://git-scm.com/downloads) |
| **Codex CLI** (opcional) | Segundo agente, ao lado do Claude Code. | `codex --version`. Instale com `npm i -g @openai/codex` e entre com `codex login` num terminal. |
| Windows 10/11 (x64) ou macOS (pacote para Intel/x64; em Apple Silicon ainda não foi validado) | Sistemas dos instaladores. | |

Quando falta algo, o FORGE abre o popup **"Antes de começar"** (com o fundo escurecido) explicando o que fazer: Claude Code não encontrado (bloqueia o uso até você instalar), conta do Claude Code não conectada e Git não encontrado. O Codex é opcional e não bloqueia nada: se ele estiver instalado mas sem login, o seletor de agente avisa "não conectado".

**Custos:** cada agente é uma sessão da CLI na **sua** conta, então o uso consome o **seu** plano ou os seus créditos. O FORGE mostra tokens e custo estimado por terminal **do Claude Code** (o custo usa a tabela de preços que você informa em `pricing.json`; não há preços embutidos). Para terminais do Codex ainda não há tokens nem custo.

## Instalação

- **Windows:** use `FORGE-0.1.0-Setup.exe` (instalador) ou `FORGE-0.1.0-Portable.exe` (sem instalar). Como o app ainda não é assinado, o Windows pode mostrar "Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.
- **macOS:** abra o `.dmg` e arraste o app para Aplicativos. Como o app ainda não é assinado nem notarizado, na primeira vez clique com o botão direito no app e escolha **Abrir**.

## Primeiros passos

1. Instale o Claude Code e o Git (veja a tabela acima). Se quiser usar o Codex, instale-o também e rode `codex login` num terminal.
2. Entre na sua conta do Claude Code pelo FORGE: **Configurações > Contas > Entrar**. O FORGE abre o navegador para você autorizar e detecta sozinho quando a conta conecta. Você pode cadastrar mais de uma conta e escolher a padrão. A mesma aba mostra se o Codex está conectado (o login dele é do próprio Codex CLI).
3. Clique em **+** ao lado de *Workspaces* para escolher a pasta do seu projeto.
4. Escolha o agente dos terminais novos (Claude Code ou Codex) e abra uma equipe (Dupla, Squad, Squad de 6 ou Construtor). Cada terminal é uma sessão da CLI escolhida naquela pasta; com *Worktree* ligado, cada equipe trabalha numa cópia isolada do código.
5. O ícone da marca (o elmo) acende e solta faíscas enquanto houver alguma tarefa rodando, e esfria quando termina.

> **Atenção:** os agentes leem e **executam comandos** na pasta do projeto com as permissões do seu usuário. Abra no FORGE apenas projetos em que você confia, e revise o que o agente pede para fazer.

## O que o FORGE faz hoje

- **Grade de terminais** (PTY real): vários agentes lado a lado, com layouts (grade, colunas, linhas, foco), trilhas arrastáveis e layout salvo por workspace.
- **Dois agentes**: Claude Code e Codex CLI, escolhidos por terminal e misturáveis na mesma equipe. Veja [docs/AGENTES.md](docs/AGENTES.md).
- **Papéis e equipes**: Maestro, Construtor, Revisor e Batedor, cada um com o seu prompt; equipes prontas (Dupla, Squad, Squad de 6 e Construtor).
- **Maestro**: um terminal que divide o pedido e envia tarefas aos outros por um servidor MCP local. Cada tarefa fica **pendente até você aprovar** (o modo autônomo é opcional e só se liga por você).
- **Worktrees do git**: um por agente que edita, ou um compartilhado por equipe, com verificação de conflitos e integração controlada.
- **Estado em tempo real** de cada terminal e de cada workspace (executando, aguardando você, concluído, com erro), na grade, na sidebar e no status global.
- **Sessões**: histórico, retomada automática da equipe ao reabrir o app e, nos terminais do Claude Code, retomar e bifurcar conversas.
- **Contas do Claude Code**: perfis com login próprio, conta padrão, login pelo navegador.
- **Loadouts**: skills e MCPs por papel, entregues ao Claude Code por um plugin de sessão fora do seu projeto.
- **Desktop** (Electron) para Windows e macOS, com log rotativo, reinício automático do servidor e menu Ajuda com diagnóstico.

O servidor também mantém um **ciclo autônomo de missões** (Planner, Executor, verificações reais, evidência e relatório de entrega), exposto na API (`/api/missions/...`) e coberto por testes, mas **sem tela na interface atual**.

## Arquitetura em resumo

```
Electron (desktop/)  ->  servidor Node + Express (server/, só 127.0.0.1)  ->  CLIs dos agentes (node-pty)
      |                          |                                              Claude Code / Codex CLI
 token de sessão          db.json, history/, mcp/                                      ^
      v                          v                                                     |
 React + Vite (client/) <-- API REST + SSE --  Maestro (MCP local) -------------------+
```

- `server/`: API Node (ESM, Express 4), terminais PTY (`terminals.js`), Maestro (`maestro.js`), worktrees (`worktrees.js`), contas (`accounts.js`), persistência em JSON (`store.js`) e, em `providers/`, o adaptador de cada CLI. O núcleo só conhece a interface do provedor, nunca os argumentos da CLI.
- `client/`: React 18 + Vite. A lógica de visão fica em módulos puros testados a partir de `server/test/`.
- `desktop/`: Electron que sobe o servidor, gera o token de sessão e empacota instaladores.

Detalhes, contratos e decisões em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Onde ficam os dados

| O quê | Windows | macOS |
|---|---|---|
| Dados (`db.json`, `history/`, `loadouts/`, `mcp/`, `agent-status/`, `accounts/`, `pricing.json`) | `%APPDATA%\FORGE\data` | `~/Library/Application Support/FORGE/data` |
| Log do servidor | `%APPDATA%\FORGE\logs\server.log` | `~/Library/Application Support/FORGE/logs/server.log` |

O FORGE **não** guarda o login do Codex: ele fica com o próprio Codex CLI (em `~/.codex`). Desinstalar o app **não** apaga os dados do FORGE. Para remover tudo, apague a pasta `FORGE` indicada acima. O que é gravado, por quanto tempo e como apagar está em [PRIVACIDADE.md](PRIVACIDADE.md).

## Como reportar um problema

No menu **Ajuda** (no Windows, pressione `Alt` para exibir o menu) use **Copiar informações de diagnóstico** e cole no seu relato, junto com o passo a passo para repetir o problema. **Abrir pasta de logs** leva ao `server.log`. O diagnóstico traz a versão do app, do Electron e do sistema e os caminhos das pastas de logs e de dados (que no Windows contêm o seu nome de usuário). Não inclui senhas, tokens nem o conteúdo dos seus projetos.

## Segurança em resumo

- O servidor interno escuta **somente** em `127.0.0.1` (a própria máquina), numa porta livre, e valida `Host` e `Origin` de cada requisição.
- No app desktop, ações que alteram estado (aprovar tarefas, escrever em terminais) e leituras de conteúdo sensível (saída dos terminais, conversas, contas) exigem um token de sessão gerado a cada abertura e injetado só na janela do app.
- Cada conta do Claude Code cadastrada tem a sua pasta de login dentro dos dados do FORGE, e os agentes rodam com as suas permissões e podem lê-las: abra apenas projetos em que você confia.
- O Codex é aberto com o sandbox `workspace-write` e aprovação `on-request`; a credencial do Maestro vai só no ambiente do processo, nunca em arquivo nem na linha de comando.
- Configuração de projeto que executa comandos (`.claude/settings.json`, `.mcp.json`, `.claude/agents`, `.claude/skills` e, para o Codex, a pasta `.codex`) e não está revisada no Git exige a sua confirmação antes de abrir o terminal.
- Concluir uma missão do ciclo autônomo exige evidência verificada; a única exceção é a **aceitação humana explícita**, registrada.
- O FORGE não envia dados a nenhum servidor próprio. Quem fala com a Anthropic é o Claude Code e quem fala com a OpenAI é o Codex CLI. A única outra chamada de rede do FORGE é o preparo opcional de um worktree (`npm ci --ignore-scripts`), que só roda depois de você aprovar o plano mostrado e baixa pacotes do registro do npm.

## Limitações conhecidas

- Instaladores **sem assinatura de código** e **sem atualização automática**: novas versões precisam ser instaladas manualmente.
- macOS: pacote apenas para processadores Intel (x64); Apple Silicon ainda não foi validado.
- **Codex CLI**: não retoma nem bifurca conversas (um terminal Codex interrompido volta como terminal novo), não tem loadouts, contas separadas do FORGE nem tokens e custo por terminal, e o login é feito no próprio Codex CLI. A integração foi validada contra o Codex real com um modelo simulado; o uso com conta real ainda não foi exercitado em testes.
- O `claude auth login` real (pelo FORGE) só foi testado com uma CLI simulada.
- Interface apenas em português.
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

Um arquivo só: `node --test server/test/<arquivo>.test.mjs`. Os scripts `npm run test:real` e `npm run test:real-cycle` chamam o Claude de verdade e **consomem créditos**. Alguns testes só valem para um sistema (`posix-process.test.mjs` no macOS/Linux e `win-process.test.mjs` no Windows) e aparecem como ignorados nos outros. A integração contínua (`.github/workflows/ci.yml`) roda a suíte no Windows, Linux e macOS a cada push na `main` e em cada pull request.

**Empacotar o desktop** (rode dentro de `desktop/`, onde estão os scripts):

```bash
cd desktop && npm install
npm run dist       # Windows: Setup.exe e Portable.exe em desktop/release/
npm run dist:mac   # macOS: .dmg (só em um Mac)
```

Estrutura: `server/` (API Node + Express, terminais PTY, Maestro, worktrees, contas, ciclo de missões), `server/providers/` (adaptadores do Claude Code e do Codex CLI), `client/` (React 18 + Vite), `desktop/` (Electron), `server/test/` (testes com `node:test`).

## Licença

Veja [LICENSE](LICENSE).
