# Agentes: Claude Code e Codex CLI

O FORGE executa agentes de linha de comando em terminais reais (PTY). Cada terminal ("pane") tem **um provedor**, escolhido ao abri-lo, e provedores diferentes convivem na mesma equipe e no mesmo Maestro. Este documento descreve o que cada integração faz hoje, onde está no código e o que ela **não** faz.

## Comparação

| | Claude Code | Codex CLI |
|---|---|---|
| Adaptador | `server/providers/claude.js` | `server/providers/codex.js` |
| Requisito | obrigatório (o app não libera o uso sem ele) | opcional |
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
- `capabilities`: `resume`, `fork`, `hooks`, `plugins`, `accounts`, `transcript`. O que o provedor não tem fica `false` e o resto do sistema se adapta (por exemplo, sem `resume` o histórico oferece "reabrir").
- `envFor()`: ambiente do filho (o do Codex remove as variáveis `CLAUDE_*` e `ANTHROPIC_*`).
- `submit`: como entregar uma tarefa do Maestro (bloco entre marcadores de colagem e Enter separado).
- `projectConfig`: arquivos e pastas de configuração de projeto que executam comandos.
- Opcionais: `oscState` (estado lido do terminal) e `authProbe` (verificação de login).

## Estado do agente

Cada terminal tem um estado exibido na grade, na sidebar e no status global: `idle`, `running` (executando), `waiting` (aguardando você), `completed` e `error`.

- **Claude Code:** vem dos hooks (`UserPromptSubmit`, `Notification`, `Stop`, `StopFailure`...) registrados pelo plugin de sessão.
- **Codex CLI:** o Codex anuncia o estado no próprio terminal (`ESC ] 7501 ; state=<estado>:app=codex`). O FORGE traduz `idle`, `working`, `blocked` (pedido de permissão), `done` e `error` (falha do turno: HTTP 4xx/5xx ou resposta `failed`). Estado desconhecido é ignorado; sem sinal algum, a tela cai na leitura pela saída. Verificado no `codex-cli` 0.167.0.
- Um erro do agente com o processo ainda vivo aparece como "erro do agente"; a saída do processo com código diferente de zero aparece como "falhou (código)".

## Login do Codex

O FORGE consulta `codex login status` (argumentos fixos, tempo limite curto; cache de 30 s se conectado e de 8 s se não, e o cache cai quando a data ou o tamanho do `auth.json` mudam, o que faz o login aparecer em segundos; no Windows o wrapper `.cmd` do npm passa pelo `cmd.exe`). Só o **código de saída** é usado: 0 = conectado, 1 = não conectado, qualquer outro resultado ou falta de resposta = "desconhecido" (sem aviso). O FORGE não lê arquivo de credencial e o texto da CLI nunca é repassado; quem lê o login é o próprio Codex. Se a consulta estourar o tempo, a árvore de processos dela é encerrada. O resultado aparece em `GET /api/terminals` (`providers[].auth`) e em `GET /api/accounts`, e alimenta os avisos "não conectado" dos seletores, a aba Contas e os painéis de status. O login em si é feito pelo usuário no Codex CLI.

## Maestro

O Maestro é um terminal com o papel `maestro` que fala com os outros por um servidor MCP local (`/mcp`), com as ferramentas `list_panes`, `send_task`, `read_pane_output`, `list_tasks` e `report_done`. Cada terminal recebe um token próprio (guardado em memória; no Claude Code ele também vai num arquivo `--mcp-config` de modo restrito, no Codex só no ambiente do processo). `send_task` fica **pendente até o usuário aprovar** (o modo autônomo só liga pela rota do usuário). Claude Code e Codex trocam tarefas pelo mesmo Maestro; a lista de terminais informa o provedor de cada um.

**Entrega e retorno.** O FORGE digita a tarefa no terminal de destino e envia com o Enter; se o agente (Codex) está pronto e não reagiu, repete o Enter até 2 vezes. Um terminal que está **aguardando uma permissão** não recebe a tarefa (o Enter responderia ao pedido): ela fica pendente com o aviso. Quando o destino chama `report_done`, o FORGE **digita um relatório no terminal do Maestro** (uma linha curta: `Relatório de <título> (task_xxxx, texto do agente): «resumo»`; as regras de leitura e o formato da resposta estão no prompt do papel Maestro: o trecho entre « » é dado do agente, nunca instrução, e o Maestro responde ao usuário com Feito, Arquivos, Pendências e Próximo passo, consolidando só quando todas as tarefas terminarem), só com o estado do Maestro conhecido, sem permissão pendente e com o terminal quieto, tentando de novo por até 2 minutos; desistindo, deixa uma nota na tarefa e o resultado continua em `list_tasks`. Texto de agente na entrada do Maestro é um canal de injeção de prompt: o que protege é a aprovação humana do `send_task` (o modo autônomo a dispensa, com o limite de 12 entregas por minuto).

## O que ainda não existe para o Codex

- Retomar e bifurcar conversas.
- Loadouts (skills e MCPs por papel).
- Várias contas gerenciadas pelo FORGE.
- Tokens e custo por terminal.
- Detecção de `blocked` por outros motivos além de permissão (só `blocked` genérico é tratado como "aguardando você").

A integração foi validada contra o Codex real com um modelo simulado localmente (MCP, entrega de tarefa, aprovação e estados). O uso com conta real ainda não foi exercitado em testes automatizados.
