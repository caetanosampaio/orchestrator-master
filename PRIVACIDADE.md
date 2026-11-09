# Privacidade e dados do FORGE

> **Rascunho técnico, não é um documento jurídico.** Descreve o que o código faz hoje. Antes de oferecer o FORGE a clientes, revise o texto com um profissional (LGPD).

## Resumo

O FORGE roda **inteiramente na sua máquina**. Ele não tem servidor próprio e não envia dados a ninguém. Quem conversa com a Anthropic é o **Claude Code** e, se você usar o Codex, quem conversa com a OpenAI é o **Codex CLI**: você os instala e usa com a sua conta, sob os termos de cada empresa.

## O que o FORGE grava em disco

Tudo fica na pasta de dados do app (`%APPDATA%\FORGE\data` no Windows; `~/Library/Application Support/FORGE/data` no macOS).

| Arquivo ou pasta | Conteúdo | Observação |
|---|---|---|
| `db.json` (e `db.json.bak`) | Caminhos dos workspaces, objetivos e relatórios das missões, tarefas, atividade e o registro das sessões de terminal | Texto simples. Pode conter trechos do seu código e dos seus pedidos. |
| `history/` | **Cópia do texto das conversas** (suas mensagens e as do assistente) de cada workspace, até 4 MB por sessão | Não copia saída de ferramentas, raciocínio nem anexos. A remoção automática de segredos (senhas, chaves) é de **melhor esforço**: não confie nela como garantia. |
| `loadouts/`, `agent-status/` | Configuração dos agentes e estado reportado por eles | |
| `rate-limits/` | Para cada sessão do Claude Code, só a **porcentagem usada e o instante de reset** das janelas de 5 h e semanal (recebidas pela status line do Claude Code), e o arquivo `claude-settings.json` que liga a status line | Só números e datas; nada do seu código, pedidos, caminhos ou conta. Nada sai da máquina. |
| `mcp/` | Credenciais temporárias do canal MCP entre o FORGE e os terminais | Em macOS/Linux a pasta tem permissão restrita ao seu usuário. Só o Claude Code usa arquivo; para o Codex a credencial vai apenas no ambiente do processo e não é gravada. |
| `accounts/<id>/claude/` | **Credenciais de login** de cada conta do Claude Code cadastrada em Configurações > Contas (e os históricos que o Claude Code grava para aquela conta) | É a pasta de configuração que o próprio Claude Code usa para a conta. Em Windows e Linux o login fica em arquivo dentro dela; trate-a como senha. Remover a conta no FORGE desconecta e apaga a pasta. A conta "Sistema" é o Claude Code da própria pessoa, fora dessa pasta. |
| `pricing.json` | Tabela de preços que **você** cria para estimar custos | |
| `logs/server.log` (pasta `logs`, ao lado de `data`) | Log técnico do servidor | Pode registrar caminhos e mensagens de erro. |

A **saída dos terminais** fica apenas em memória enquanto a sessão existe (cerca de 512 KB por terminal) e **não** é gravada em arquivo pelo FORGE.

## O que fica fora do controle do FORGE

- O Claude Code mantém os **próprios** históricos e transcritos (em `~/.claude`). Apagar dados no FORGE não apaga isso.
- O Codex CLI mantém o **próprio** login, configuração e históricos (em `~/.codex`). O FORGE **não** guarda nem lê as credenciais do Codex: só consulta `codex login status` (usando o código de saída para saber se há login) e observa a data e o tamanho do `auth.json`, sem abrir o arquivo, para perceber um login ou logout na hora. Apagar dados no FORGE não apaga o que está em `~/.codex`.
- **Limites de uso:** para mostrar quanto da cota de 5 h e semanal cada conta já usou, o FORGE lê (somente leitura, só números e datas) o final dos arquivos de sessão do Codex em `~/.codex/sessions` e recebe os limites do Claude Code pela status line que ele mesmo configura no terminal (`--settings`). Ele **não** lê arquivos de credencial, não faz chamadas de rede e não envia esses dados a ninguém. Só o `settings.json` de **usuário** da conta é consultado (apenas para saber se a chave `statusLine` existe; nada mais do conteúdo): se você já tem uma `statusLine` lá, o FORGE não a substitui. Uma `statusLine` definida só no **projeto** (`.claude/settings.json` ou `settings.local.json`) é sobreposta pelo `--settings` do FORGE nos terminais dele (precedência do Claude Code, não testada aqui com um Claude real). Efeito colateral: com status line configurada, o Claude Code deixa de mostrar a maioria das dicas do rodapé (por exemplo "esc to interrupt"); o FORGE imprime ali uma linha curta com o uso. `ORCH_CLAUDE_STATUSLINE=off` desliga a injeção (e a leitura do limite do Claude Code).
- Os arquivos do seu projeto, os worktrees e as branches que os agentes criam ficam nas suas pastas.
- **Os agentes rodam com as permissões do seu usuário.** Um agente (ou um projeto malicioso aberto num terminal) consegue ler a pasta de login de **todas** as contas cadastradas, não só da que ele usa. No Windows essas pastas não têm proteção extra de acesso. Abra apenas projetos em que você confia e não coloque a pasta de dados em locais sincronizados ou compartilhados (nuvem, rede).

## Rede

- O servidor do FORGE escuta somente em `127.0.0.1` (a própria máquina).
- O FORGE não faz chamadas de rede próprias, com uma exceção: o **preparo opcional de um worktree** executa `npm ci --ignore-scripts`, que baixa pacotes do registro do npm. Isso só acontece depois de você aprovar o plano mostrado.

## Retenção e como apagar

- Hoje **não há prazo de retenção automático**: os dados ficam até você apagá-los.
- Dentro do app, você pode apagar conversas e remover workspaces (o que remove o histórico do workspace).
- Para apagar **tudo**: feche o FORGE e apague a pasta `FORGE` indicada acima. Desinstalar o app **não** apaga os dados.
- Em computadores compartilhados ou com backup automático, lembre que esses arquivos estão em texto simples.

## Dúvidas

Veja o [README](README.md) para saber como gerar as informações de diagnóstico ao reportar um problema.
