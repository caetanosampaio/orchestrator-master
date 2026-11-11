---
name: seguranca-pratica
description: "Segurança aplicada a qualquer projeto: OWASP Top 10 na prática, entrada não confiável, injeção de SQL, de comando e de caminho, XSS e CSRF, segredos fora do código, menor privilégio, dependências, upload de arquivos e logs. Inclui como relatar um achado com severidade e evidência. Use ao implementar ou revisar autenticação, permissões, formulários, uploads, integrações ou qualquer código que trate dados do usuário."
---

# Segurança prática

Toda entrada vinda de fora do processo é hostil até prova em contrário: corpo e parâmetros da requisição, cabeçalhos, cookies, arquivos enviados, variáveis de projeto, respostas de outros serviços e texto de páginas web.

## 1. Controle de acesso (o defeito mais comum)
- Autorização no servidor, em cada rota e para cada recurso: existe **e** pertence a quem pede. Teste trocando o id na URL.
- Negar por padrão; liberar explicitamente. Rotas administrativas protegidas também na leitura.
- Sessão: cookie com HttpOnly, Secure e SameSite; expiração; invalidação no logout e na troca de senha.

## 2. Injeção
- **SQL e NoSQL**: consulta parametrizada sempre. Nome de coluna ou ordenação vindos do usuário passam por lista fechada.
- **Comando**: evite o shell. Use a função que recebe o programa e a lista de argumentos separados; nada de texto do usuário concatenado numa linha de comando. Se o shell for inevitável, lista fechada de valores.
- **Caminho**: resolva o caminho absoluto e confira que ele continua dentro da pasta permitida (cuidado com `..`, links simbólicos, maiúsculas no Windows). Nome de arquivo vindo de fora vira um id gerado pelo servidor.
- **Modelos e expressões**: não avalie texto do usuário como código, modelo ou expressão regular sem limites.

## 3. XSS e CSRF
- Escape na saída, conforme o contexto (HTML, atributo, URL, JavaScript). Prefira o mecanismo do framework e evite inserir HTML cru.
- Política de segurança de conteúdo (CSP) restritiva quando o projeto permite.
- Ações que mudam estado exigem proteção contra CSRF: token, SameSite e checagem de Origin. Nunca mude estado em GET.

## 4. Segredos
- Fora do código e do controle de versão: ambiente ou cofre. Arquivos de segredo ficam no ignore do Git.
- Não leia, não copie e não exiba segredos em mensagens, relatos, logs ou testes. Em teste use valores falsos.
- Segredo exposto é considerado comprometido: o certo é trocá-lo, não só apagar o commit.

## 5. Menor privilégio
- Cada processo, credencial e token com o mínimo necessário e prazo curto quando possível.
- Serviços locais escutam só no endereço necessário (loopback quando for uso local).
- Permissões de arquivo restritas para o que guarda credenciais.

## 6. Dependências
- Não acrescente dependência sem necessidade comprovada. Prefira bibliotecas mantidas, com poucas dependências transitivas.
- Versões travadas no arquivo de lock; rode a auditoria do gerenciador de pacotes e trate os achados críticos que alcançam o código usado.
- Cuidado com nomes parecidos (typosquatting) e scripts de instalação.

## 7. Upload de arquivos
- Limite de tamanho e de quantidade; tipo conferido pelo conteúdo, não pela extensão.
- Nome gerado pelo servidor, armazenamento fora da pasta servida como código, sem execução.
- Imagens e documentos processados com biblioteca atualizada e limites de memória.

## 8. Logs e erros
- Registre eventos de segurança (login, falha de permissão, mudança de senha) sem dados sensíveis.
- Resposta de erro sem detalhes internos (stack, SQL, caminhos, versões).
- Limite de taxa em login, recuperação de senha e rotas caras.

## Como relatar um achado
Uma linha por achado, em ordem de severidade:
`[severidade] arquivo:linha - o problema - como explorar (cenário curto) - correção mínima`
- **Crítica**: exploração remota sem autenticação, vazamento de segredo, execução de comando.
- **Alta**: acesso a dados de outro usuário, injeção com autenticação, contorno de permissão.
- **Média**: XSS refletido, CSRF em ação relevante, falta de limite de taxa.
- **Baixa**: cabeçalho ausente, mensagem de erro detalhada, endurecimento.
Separe o que foi **confirmado** (reproduzido ou visto no código) do que é **suspeita**. Nunca rode exploração contra sistemas reais ou de terceiros: prove com teste local.

## Armadilhas comuns
- Validar só no cliente.
- Lista de bloqueio em vez de lista de permissão.
- Confiar em cabeçalhos como X-Forwarded-For ou Host sem configuração explícita.
- Corrigir o sintoma em uma rota e deixar a mesma falha nas rotas vizinhas.
