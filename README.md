# FORGE

Central local para coordenar agentes de IA (o **Claude Code**) no desenvolvimento de software: vários terminais lado a lado, um maestro que distribui tarefas, worktrees do git por equipe e um ciclo de missões com revisão e relatório de entrega. Tudo roda na sua máquina.

> **Versão 0.1.0, pré-lançamento.** Funciona de ponta a ponta, mas ainda não tem assinatura de código nem atualização automática (veja [Limitações conhecidas](#limitações-conhecidas)).

## O que você precisa antes de usar

| Requisito | Para quê | Como conferir |
|---|---|---|
| **Claude Code** instalado e com login feito | É o agente que o FORGE executa. O FORGE **não** inclui nem substitui o Claude Code. | No terminal: `claude --version`, e depois rode `claude` uma vez para entrar com a sua conta. |
| **Git** | Worktrees, relatórios de entrega e histórico. | `git --version` (download: https://git-scm.com/downloads) |
| Windows 10/11 (x64) ou macOS (pacote para Intel/x64; em Apple Silicon ainda não foi validado) | Sistemas dos instaladores. | |

Quando falta algo, o FORGE abre um popup **"Antes de começar"** no centro da tela (com o fundo escurecido) explicando o que fazer: Claude Code não encontrado (bloqueia o uso até você instalar), conta do Claude Code não conectada e Git não encontrado.

**Custos:** cada agente é uma sessão do Claude Code na **sua** conta, então o uso consome o **seu** plano ou os seus créditos. O FORGE mostra tokens e custo estimado por terminal (o custo usa a tabela de preços que você informa em `pricing.json`; não há preços embutidos).

## Instalação

- **Windows:** use `FORGE-0.1.0-Setup.exe` (instalador) ou `FORGE-0.1.0-Portable.exe` (sem instalar). Como o app ainda não é assinado, o Windows pode mostrar "Windows protegeu o computador": clique em **Mais informações** e depois em **Executar assim mesmo**.
- **macOS:** abra o `.dmg` e arraste o app para Aplicativos. Como o app ainda não é assinado nem notarizado, na primeira vez clique com o botão direito no app e escolha **Abrir**.

## Primeiros passos

1. Instale o Claude Code e o Git (veja a tabela acima).
2. Entre na sua conta pelo FORGE: **Configurações > Contas > Entrar**. O FORGE abre o navegador para você autorizar e detecta sozinho quando a conta conecta. Você pode cadastrar mais de uma conta e escolher a padrão.
3. Clique em **+** ao lado de *Workspaces* para escolher a pasta do seu projeto.
4. Abra um ou mais terminais (equipes como Dupla, Squad ou Construtor). Cada terminal é uma sessão do Claude Code naquela pasta; com *Worktree* ligado, cada equipe trabalha numa cópia isolada do código.
5. O ícone da marca (o elmo) acende e solta faíscas enquanto houver alguma tarefa rodando, e esfria quando termina.

> **Atenção:** os agentes leem e **executam comandos** na pasta do projeto com as permissões do seu usuário. Abra no FORGE apenas projetos em que você confia, e revise o que o agente pede para fazer.

## Onde ficam os dados

| O quê | Windows | macOS |
|---|---|---|
| Dados (`db.json`, `history/`, `loadouts/`, `mcp/`, `agent-status/`, `pricing.json`) | `%APPDATA%\FORGE\data` | `~/Library/Application Support/FORGE/data` |
| Log do servidor | `%APPDATA%\FORGE\logs\server.log` | `~/Library/Application Support/FORGE/logs/server.log` |

Desinstalar o app **não** apaga esses dados. Para remover tudo, apague a pasta `FORGE` indicada acima. O que é gravado, por quanto tempo e como apagar está em [PRIVACIDADE.md](PRIVACIDADE.md).

## Como reportar um problema

No menu **Ajuda** (no Windows, pressione `Alt` para exibir o menu) use **Copiar informações de diagnóstico** e cole no seu relato, junto com o passo a passo para repetir o problema. **Abrir pasta de logs** leva ao `server.log`. O diagnóstico traz a versão do app, do Electron e do sistema e os caminhos das pastas de logs e de dados (que no Windows contêm o seu nome de usuário). Não inclui senhas, tokens nem o conteúdo dos seus projetos.

## Segurança em resumo

- O servidor interno escuta **somente** em `127.0.0.1` (a própria máquina), numa porta livre, e valida `Host` e `Origin` de cada requisição.
- No app desktop, ações que alteram estado (aprovar tarefas, escrever em terminais) exigem um token de sessão gerado a cada abertura e injetado só na janela do app.
- Cada conta cadastrada tem a sua pasta de login dentro dos dados do FORGE, e os agentes rodam com as suas permissões e podem lê-las: abra apenas projetos em que você confia.
- Concluir uma missão exige evidência verificada; a única exceção é a **aceitação humana explícita**, registrada.
- O FORGE não envia dados a nenhum servidor próprio. Quem fala com a Anthropic é o Claude Code. A única outra chamada de rede é o preparo opcional de um worktree (`npm ci --ignore-scripts`), que só roda depois de você aprovar o plano mostrado e baixa pacotes do registro do npm.

## Limitações conhecidas

- Instaladores **sem assinatura de código** e **sem atualização automática**: novas versões precisam ser instaladas manualmente.
- macOS: pacote apenas para processadores Intel (x64); Apple Silicon ainda não foi validado.
- Interface apenas em português.
- Máximo de 50 terminais simultâneos.

## Para desenvolvedores

```bash
npm run install:all       # dependências da raiz e do client
npm run server            # API em 127.0.0.1:4317 (usa o banco REAL em data/)
npm run dev               # servidor + Vite (também usa o banco real)
npm run build             # gera client/dist, que o servidor serve
```

**Testes** (a suíte completa leva cerca de 11 minutos). Aponte sempre `ORCH_DATA_DIR` para uma pasta temporária, senão alguns testes usam `data/`:

```bash
# bash
export ORCH_DATA_DIR="$(mktemp -d -t orch-suite-XXXX)"; npm test
# PowerShell
$env:ORCH_DATA_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP "orch-suite-$(Get-Random)")).FullName; npm test
```

Um arquivo só: `node --test server/test/<arquivo>.test.mjs`. Os scripts `npm run test:real` e `npm run test:real-cycle` chamam o Claude de verdade e **consomem créditos**.

**Empacotar o desktop** (rode dentro de `desktop/`, onde estão os scripts):

```bash
cd desktop && npm install
npm run dist       # Windows: Setup.exe e Portable.exe em desktop/release/
npm run dist:mac   # macOS: .dmg (só em um Mac)
```

Estrutura: `server/` (API Node + Express, ciclo de missões, terminais PTY, worktrees), `client/` (React 18 + Vite), `desktop/` (Electron), `server/test/` (testes com `node:test`).

## Licença

Veja [LICENSE](LICENSE).
