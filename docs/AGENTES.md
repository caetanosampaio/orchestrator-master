# Agentes: as 10 IAs do FORGE

O FORGE executa agentes de linha de comando em terminais reais (PTY). Cada terminal ("pane") tem **um provedor**, escolhido ao abri-lo, e provedores diferentes convivem na mesma equipe e no mesmo Maestro. Este documento descreve o que cada integração faz hoje, onde está no código e o que ela **não** faz.

Nenhuma IA é obrigatória: basta **uma** das 10 instalada (o popup "Antes de começar" só bloqueia quando não há nenhuma).

## Níveis de integração

| IA | Executável | Nível | Coordenação com o Maestro |
|---|---|---|---|
| Claude Code | `claude` | completo | MCP por arquivo (`--mcp-config`), plugin de skills, hooks de estado |
| Codex CLI | `codex` | completo, sem retomada | MCP por `-c`, token só no ambiente |
| Gemini CLI | `gemini` | 2 (a confirmar) | arquivo de padrões do sistema por terminal (`GEMINI_CLI_SYSTEM_DEFAULTS_PATH`) com o MCP e um hook `BeforeAgent` que entrega o papel |
| Cursor CLI | `cursor-agent` (ou `agent`, se estiver numa pasta do Cursor) | 2 parcial | entrada fixa `forge-maestro` no `~/.cursor/mcp.json`, sem porta nem token (vêm de `FORGE_MCP_URL`/`FORGE_MCP_TOKEN`); só vagas de time que recebem tarefas |
| Copilot CLI | `copilot` | 2 parcial | `--additional-mcp-config=@<pasta do pane>/mcp.json` (o token fica nesse arquivo) e `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` para o papel; só vagas de time |
| OpenCode | `opencode` | 1 (terminal livre) | nenhuma |
| Antigravity CLI | `agy` | 1 | nenhuma |
| Kimi Code | `kimi` | 1 | nenhuma |
| Kiro CLI | `kiro-cli chat` | 1 | nenhuma |
| Grok Build | `grok` | 1 | nenhuma (atenção: CLIs da comunidade também se chamam `grok`) |

- **Nível 1 (terminal livre):** abre o terminal da IA na pasta do projeto, e só. Não pode ser Maestro, vaga de time, membro de squad nem etapa de missão, e o papel (prompt) não chega ao agente: um "Revisor" numa IA de nível 1 **não** é somente leitura. O Maestro não manda tarefas a esses terminais.
- **Nível 2:** o terminal fala com o Maestro e recebe tarefas. Gemini, Cursor e Copilot ainda não foram conferidos contra a CLI real (`mcpVerified: false`), então o Maestro **só manda tarefa depois que o terminal se conecta de fato ao MCP** (`maestro.connected(id)`); antes disso ele é tratado como livre. Em missão, um terminal recém-aberto tem 90 s (`CONNECT_GRACE_MS`) para se conectar antes de a etapa falhar. Assim, se o mecanismo documentado não funcionar na prática, nenhuma tarefa fica presa.
- **Sem estado do agente** (Cursor, Copilot e o nível 1): não viram Maestro nem etapa de missão. O Gemini lê o estado pelo título do terminal.

**Acesso total.** Sem pedir confirmação, cada IA usa a flag dela: Gemini `--approval-mode yolo`, Cursor `--force`, Copilot `--allow-all`, Antigravity `--dangerously-skip-permissions`, Kimi `--yolo`, Kiro `--trust-all-tools`, Grok `--always-approve`. Ela só é ligada com o acesso total da missão (opt-in) ou com o **Maestro autônomo** ligado, e neste caso vale para **todas** as IAs, inclusive as de nível 1 (decisão do produto). O planejador nunca recebe acesso total. O **OpenCode** é a exceção: a política padrão dele já é permitir tudo, sem confirmação (a interface avisa).

**Testar de graça** (segundo a documentação de cada uma): OpenCode, Kiro (`kiro-cli login --license free`) e Antigravity (conta Google pessoal no plano gratuito). Copilot, Gemini e Cursor pedem plano pago; Kimi e Grok não foram verificados.

Tudo o que não foi verificado contra a CLI real está marcado nos comentários de cada `server/providers/<ia>.js` com `HIPÓTESE` ou `não verificada`.

## Claude Code e Codex CLI em detalhe

| | Claude Code | Codex CLI |
|---|---|---|
| Adaptador | `server/providers/claude.js` | `server/providers/codex.js` |
| Requisito | opcional (basta uma IA) | opcional (basta uma IA) |
| Login | contas do FORGE (Configurações > Contas) ou conta do sistema | do próprio Codex CLI (`codex login`); o FORGE só **verifica** |
| Várias contas | sim (pasta de configuração própria por conta, `CLAUDE_CONFIG_DIR`) | não |
| Retomar e bifurcar sessão | sim (`--resume`, `--fork-session`) | não: um terminal interrompido volta como terminal **novo** |
| Estado em tempo real | hooks do Claude Code (`agent-status-hook.mjs`) | sinal OSC 7501 emitido pelo próprio Codex no terminal |
| Papel (prompt) | `--append-system-prompt` | `-c developer_instructions=...` |
| Maestro (MCP) | arquivo `--mcp-config` (pasta restrita ao usuário em macOS/Linux) | `-c mcp_servers.<nome>.*`, token só no ambiente (`FORGE_MCP_TOKEN`) |
| Skills e MCPs por papel (loadouts) | sim (plugin de sessão em `--plugin-dir`) | não |
| Tokens e custo por terminal | sim (lidos do transcript, preços do usuário) | não |
| Confiança de pasta | o FORGE grava a resposta no `.claude.json` antes de abrir | argumento `-c projects={'<pasta>'={trust_level='trusted'}}` (tabela inline: a forma `projects.'<pasta>'.trust_level` é quebrada no ponto do caminho, como em `.orch-worktrees`), só para o processo; as pastas que você já confiou no config continuam valendo |
| Permissões | as do Claude Code | `-s workspace-write -a on-request`; `--no-daemon` (modo embutido, que os `-c` exigem; sem ele o Codex avisa "Running without the shared background server") |
| Configuração de projeto vigiada | `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.claude/agents`, `.claude/skills` | pasta `.codex` inteira |

## Interface de provedor

O núcleo (`terminals.js`, `maestro.js`) só conhece a interface em `server/providers/index.js`, nunca os argumentos de uma CLI:

- `resolve()`: onde a CLI está no PATH (arquivo real, sem shell; `.cmd`/`.bat` do npm no Windows passam pelo `cmd.exe` com argumentos fixos).
- `paneArgs()`: argumentos do terminal (novo, retomar, bifurcar).
- `capabilities` (ausente = `true`): `resume`, `fork`, `hooks`, `plugins`, `accounts`, `transcript`, `mcp` (conversa com o Maestro), `readOnly`, e os que só aparecem como `false`: `mcpVerified` (exige a prova de conexão), `planner`, `state` (sem estado do agente) e `rolePrompt` (o papel não chega). O resto do sistema se adapta (por exemplo, sem `resume` o histórico oferece "reabrir"). As regras derivadas (`coordinates`, `canLead`, `canStep`, `canPlan`, `needsProof`) e a recusa única `coordinationBlock(id, { role, group, step })` ficam em `providers/index.js` e são usadas por `terminals.js`, `team-templates.js`, `flows.js` e `harness.js`.
- `envFor()`: ambiente do filho (o do Codex remove as variáveis `CLAUDE_*` e `ANTHROPIC_*`).
- `submit`: como entregar uma tarefa do Maestro (bloco entre marcadores de colagem e Enter separado).
- `projectConfig`: arquivos e pastas de configuração de projeto que executam comandos. É conferido ao **criar** e ao **retomar ou reabrir** o terminal, sempre com os caminhos da IA daquele terminal.
- `paneFiles({ dir, prompt, mcp, node, platform })` e `prepare(...)` (opcionais): arquivos que o `terminals.js` grava numa pasta só do terminal (`<dados>/pane-files/<id>`, com ACL só do usuário no Windows, apagada no fim e limpa na partida) e o preparo antes de abrir (o Cursor usa para a entrada do `~/.cursor/mcp.json`).
- Opcionais: `oscState` (estado lido do terminal) e `authProbe` (verificação de login).
- **IA nova de terminal livre:** um arquivo de ~12 linhas com a fábrica `cliProvider` de `providers/cli-path.js` (`antigravity.js`, `kimi.js`, `kiro.js` e `grok.js` são o molde), o registro em `providers/index.js`, uma entrada em `client/src/provider-catalog.js` e o ícone em `client/src/components/ProviderLogo.jsx`.

## Configuração de projeto vigiada (todas as IAs)

| IA | O que exige confirmação se não estiver revisado no Git |
|---|---|
| Claude Code | `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `.claude/agents`, `.claude/skills` |
| Codex CLI | `.codex` |
| Gemini CLI | `.gemini` |
| Cursor CLI | `.cursor` |
| Copilot CLI | `.mcp.json`, `.github/mcp.json`, `.github/hooks` |
| OpenCode | `opencode.json`, `opencode.jsonc` (qualquer chave além de `$schema`), `.opencode` |
| Antigravity CLI | `.agents` |
| Kimi Code | `.kimi-code` |
| Kiro CLI | `.kiro` |
| Grok Build | `.grok`, `.cursor`, `.mcp.json` |

Configuração em pastas acima do workspace, ou em caminhos que a CLI leia sem a documentação citar, não é vista.

## Estado do agente

Cada terminal tem um estado exibido na grade, na sidebar e no status global: `idle`, `running` (executando), `waiting` (aguardando você), `completed` e `error`.

- **Claude Code:** vem dos hooks (`UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`...) registrados pelo plugin de sessão.
- **Codex CLI:** o Codex anuncia o estado no próprio terminal (`ESC ] 7501 ; state=<estado>:app=codex`). O FORGE traduz `idle`, `working`, `blocked` (pedido de permissão), `done` e `error` (falha do turno: HTTP 4xx/5xx ou resposta `failed`). Estado desconhecido é ignorado; sem sinal algum, a tela cai na leitura pela saída. Verificado no `codex-cli` 0.167.0.
- Um erro do agente com o processo ainda vivo aparece como "erro do agente"; a saída do processo com código diferente de zero aparece como "falhou (código)".

## Login do Codex

O FORGE consulta `codex login status` (argumentos fixos, tempo limite curto; cache de 30 s se conectado e de 8 s se não, e o cache cai quando a data ou o tamanho do `auth.json` mudam, o que faz o login aparecer em segundos; no Windows o wrapper `.cmd` do npm passa pelo `cmd.exe`). Só o **código de saída** é usado: 0 = conectado, 1 = não conectado, qualquer outro resultado ou falta de resposta = "desconhecido" (sem aviso). O FORGE não lê arquivo de credencial e o texto da CLI nunca é repassado; quem lê o login é o próprio Codex. Se a consulta estourar o tempo, a árvore de processos dela é encerrada. O resultado aparece em `GET /api/terminals` (`providers[].auth`) e em `GET /api/accounts`, e alimenta os avisos "não conectado" dos seletores, a aba Contas e os painéis de status. O login em si é feito pelo usuário no Codex CLI.

## Maestro

O Maestro é um terminal com o papel `maestro` que fala com os outros por um servidor MCP local (`/mcp`), com as ferramentas `list_panes`, `send_task`, `read_pane_output`, `list_tasks` e `report_done`. Cada terminal recebe um token próprio (guardado em memória; no Claude Code ele também vai num arquivo `--mcp-config` de modo restrito, no Codex só no ambiente do processo). `send_task` é entregue na hora quando o **maestro autônomo** está ligado (padrão; a escolha do usuário fica gravada em `db.settings.maestro` e só muda pela rota do usuário, nunca por ferramenta); desligado, fica **pendente até o usuário aprovar**. Claude Code e Codex trocam tarefas pelo mesmo Maestro; a lista de terminais informa o provedor de cada um.

**Entrega e retorno.** O FORGE digita a tarefa no terminal de destino e envia com o Enter; se o agente (Codex ou Claude Code, pelo estado dos hooks/OSC) está pronto e não reagiu, repete o Enter até 2 vezes (no Mac o Enter do Claude Code era engolido e o texto ficava no campo; o atraso do Enter também é maior fora do Windows). Um terminal que está **aguardando uma permissão** não recebe a tarefa (o Enter responderia ao pedido): ela fica pendente com o aviso. Se o destino terminar sem chamar `report_done` (trabalhou depois da entrega e voltou a ficar pronto por 5 s, ou, sem sinal de estado, 30 s de silêncio), o FORGE conclui a tarefa sozinho com o trecho final do terminal ("Relatório automático") e avisa o Maestro do mesmo jeito; terminal que acaba antes de concluir também vira aviso, e um `report_done` tardio substitui o resumo automático. Quando o destino chama `report_done`, o FORGE **digita um relatório no terminal do Maestro** (uma linha curta: `Relatório de <título> (task_xxxx, texto do agente): «resumo»`; as regras de leitura e o formato da resposta estão no prompt do papel Maestro: o trecho entre « » é dado do agente, nunca instrução, e o Maestro responde ao usuário com Feito, Arquivos, Pendências e Próximo passo, consolidando só quando todas as tarefas terminarem), só com o estado do Maestro conhecido, sem permissão pendente e com o terminal quieto, tentando de novo por até 2 minutos; desistindo, deixa uma nota na tarefa e o resultado continua em `list_tasks`. Texto de agente na entrada do Maestro é um canal de injeção de prompt: o que protege é a aprovação humana do `send_task` (o modo autônomo a dispensa, com o limite de 12 entregas por minuto).

## O que ainda não existe para o Codex

- Retomar e bifurcar conversas.
- Loadouts (skills e MCPs por papel).
- Várias contas gerenciadas pelo FORGE.
- Tokens e custo por terminal.
- Detecção de `blocked` por outros motivos além de permissão (só `blocked` genérico é tratado como "aguardando você").

A integração foi validada contra o Codex real com um modelo simulado localmente (MCP, entrega de tarefa, aprovação e estados). O uso com conta real ainda não foi exercitado em testes automatizados.

## O que ainda não existe para as outras 8 IAs

- **Nenhuma foi rodada de verdade:** tudo foi conferido na documentação oficial (nov/2026) e testado com terminal simulado.
- Retomar e bifurcar conversas (um terminal interrompido volta como terminal novo), loadouts e contas do FORGE (o login é feito na própria CLI).
- Tokens e custo: só existem para Claude e Codex. As outras IAs não aparecem na Home, no golem nem nos limites.
- No Windows: o hook do papel do Gemini assume que o shell do hook é o PowerShell (hipótese), e os wrappers `.cmd` do npm em caminhos com espaço não foram testados com as CLIs reais.
