# Site do FORGE

Página estática (HTML, CSS e JS puros, sem build nem dependências) que vende o FORGE como produto: a ADE para trabalhar com agentes de IA todo dia, usando as assinaturas que a pessoa já paga. A estrutura segue a de sites de ADE como o do Orca (hero com a janela do app, faixa de compatibilidade, recursos em abas, agentes, vitrine, comparação, planos, perguntas e chamada final), com a identidade do FORGE: grafite, logo do ferreiro e cor só para estado. Só em português.

Seções, de cima para baixo:

1. **Topo**: título de produto, botões de download e a janela simulada do FORGE (barra lateral, abas, quatro agentes trabalhando com raios entre os terminais, barra de status com o uso das assinaturas).
2. **Faixa de IAs**: as disponíveis (Claude Code e Codex) e as "em breve".
3. **Recursos** em seis abas: Maestro, aprovação, cópias isoladas, revisão e merge, contas e uso, terminais.
4. **Agentes**: as 11 IAs do catálogo do app, com o estado de cada uma.
5. **Quem faz cada tarefa**: a tabela de rotas de fábrica com fios animados até o modelo.
6. **Fluxos**: três workflows em grafo que rodam ao vivo.
7. **Entrega**: relatório animado.
8. **E mais**, **Comparação**, **Segurança**, **Planos** (oculta enquanto não houver planos), **Perguntas** e **Comece agora**.

- `index.html`: conteúdo. A logo do ferreiro está em `<defs>` (traços de `client/src/forge-logo.mjs`); logos das IAs e ícones estão no segundo bloco `<defs>` como `<symbol>`.
- `styles.css`: tokens do app (`client/src/forge.css`), base, nav, topo, janela do app e mascote.
- `sections.css`: as seções depois do topo.
- `app.js`: roteiros das demonstrações. As animações pausam fora da tela e, com `prefers-reduced-motion`, mostram direto o estado final.

## Páginas legais

`termos.html` (Termos de Uso), `privacidade.html` (Política de Privacidade, LGPD) e `reembolso.html` (Política de Reembolso, com o arrependimento de 7 dias do CDC) usam `legal.css` e o mesmo cabeçalho e rodapé do site; o rodapé do `index.html` tem a coluna "Legal" com os três links. São HTML estático: edite direto.

**São rascunho** e precisam de revisão jurídica antes de publicar. Tudo o que só o titular sabe está marcado em laranja (`<mark class="todo">[...]</mark>`): nome ou razão social, CPF/CNPJ, e-mail de suporte, provedor de pagamento, hospedagem, foro, prazo do estorno e prazo de guarda de mensagens. Para listar o que ainda falta: `grep -o 'class="todo">[^<]*' site/*.html`. O site só pode ir ao ar sem nenhuma ocorrência.

Os textos descrevem o produto como ele deve ser quando a cobrança existir: o app só envia ao serviço de licenças a chave de licença e a versão, e **nunca** código, pedidos, conversas, caminhos nem credenciais. Se a implementação da licença enviar mais do que isso, ajuste a política (seção "Quais dados tratamos") antes de publicar. A política também afirma que o site não usa cookies nem análise de visitas: ao incluir qualquer um deles, atualize-a.

## O que preencher

- **Planos:** a lista `PLANOS` em `app.js` (Grátis, Pro e Equipes, com preço mensal e anual; a chave Mensal/Anual troca os valores). Ponha em `link` a página de assinatura de cada plano; sem ele, o botão leva à seção de download. Com a lista vazia, a seção e os links para ela somem. Ao mudar preços, ajuste também a pergunta "Quanto custa?" em `index.html`. Os cartões mostram os destaques (`itens`, cada um com nome técnico `t` e explicação `d`); a tabela completa "Compare os planos" fica no HTML da seção `#planos`: ao mudar o que cada plano inclui, altere os dois.
- **Requisitos:** o FORGE não exige o Claude instalado; para funcionar, basta conectar uma assinatura de IA (Claude ou ChatGPT/Codex). O Git é listado porque as cópias isoladas do código dependem dele.
- **Downloads:** `DOWNLOADS` no começo de `app.js`. Sem link, o botão leva à seção "Comece agora" e avisa que o instalador ainda não foi publicado.
- **Nova IA integrada:** na faixa (`.strip-logos`) troque o `<li>` dela para `class="on"`; na grade de agentes (`.ag-list`) troque para `class="ag on"`, ponha os modelos em `<small>` e o selo para `<span class="ag-chip ok">disponível</span>`. Ajuste também a pergunta "Quais IAs funcionam?".

## De onde vêm os dados

| No site | Fonte no código |
|---|---|
| IAs disponíveis e "em breve" | `CATALOG` em `client/src/provider-catalog.js` |
| Modelos e esforços | `server/providers/claude.js`, `server/providers/codex.js` |
| Tabela "Quem faz cada tarefa" (`data-to`, `data-effort`, `data-skills`) | `TASK_TYPES` e `PILOT_DEFAULT` em `server/harness.js` |
| Limites dos fluxos (12 etapas, 4 em paralelo, `continueFrom`) | `server/flows.js` |
| Ferramentas MCP do Maestro | `server/maestro.js` |

Os fluxos de exemplo, os números de uso na barra de status e a sessão do topo são demonstração simulada, e a página diz isso.

## Logos

Claude, Anthropic e OpenAI vêm do [Simple Icons](https://simpleicons.org) (CC0); Gemini, Cursor, Copilot, Grok, Kimi, Kiro, Antigravity, OpenCode e Muse vêm do [LobeHub Icons](https://github.com/lobehub/lobe-icons). Aparecem para indicar compatibilidade ou integração planejada, e o rodapé traz o aviso de marcas.

## Ver localmente

Use um servidor estático (por exemplo `python -m http.server -d site`). Abrir o `index.html` direto do disco funciona, mas o navegador bloqueia as fontes por CORS em `file://`.
