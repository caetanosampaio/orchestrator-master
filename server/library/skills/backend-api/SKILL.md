---
name: backend-api
description: "Backend e APIs em qualquer stack: desenho de contratos, validação estrita de entrada, erros e códigos HTTP, autenticação e autorização no servidor, persistência e migrações reversíveis, transações, idempotência, concorrência, paginação, logs sem segredos, desempenho e testes de contrato e integração. Use ao criar ou alterar rotas, serviços, regras de negócio ou acesso a banco."
---

# Backend e APIs

Vale para qualquer linguagem e framework. As convenções que o projeto já usa mandam; este guia decide o que elas não cobrem.

## 1. Antes de escrever código
- Leia a rota ou o serviço mais parecido que já existe e copie o padrão: estrutura de pastas, tratamento de erro, validação, logs, testes.
- Escreva o **contrato** primeiro: método, caminho, corpo aceito, respostas (sucesso e cada erro), efeitos colaterais. Se outra parte do sistema (cliente, fila, outro serviço) consome isso, o contrato é público: mudar campo ou significado é quebra.
- Compatibilidade: acrescente campos opcionais em vez de renomear ou remover. Quebra inevitável é declarada e versionada.

## 2. Entrada nunca é confiável
- Valide no servidor, sempre, mesmo que o cliente já valide. Tipos, tamanhos mínimos e máximos, formatos, listas fechadas para enumerações.
- Recuse propriedades desconhecidas (ou ignore de forma explícita e documentada); nunca copie o corpo inteiro para o banco.
- Normalize antes de comparar (espaços, maiúsculas, Unicode) e limite o tamanho do corpo da requisição.
- Identificadores vindos de fora são conferidos contra o dono: o recurso existe **e** pertence a quem pede.

## 3. Erros e códigos HTTP
- 400 entrada inválida, 401 sem autenticação, 403 autenticado sem permissão, 404 não existe (ou não pode saber que existe), 409 conflito de estado, 422 só se o projeto já usa, 429 limite, 5xx falha do servidor.
- Corpo de erro estável e útil: mensagem para o usuário e um código de máquina. Sem stack trace, SQL, caminhos de disco ou versões internas na resposta.
- Falha parcial não deixa estado pela metade: desfaça o que já foi aplicado ou use transação.

## 4. Autenticação e autorização
- A checagem é no servidor, em toda rota, inclusive nas de leitura. Esconder botão na tela não protege nada.
- Autorização por recurso, não só por rota: o usuário A não lê nem altera o pedido do usuário B trocando o id na URL.
- Menor privilégio para credenciais de banco e de serviços. Segredos vêm do ambiente ou de um cofre, nunca do código.

## 5. Persistência
- Consultas sempre parametrizadas; nada de montar SQL ou filtros com concatenação de texto do usuário.
- Migrações pequenas, reversíveis e que não travem tabela grande; separe "acrescentar coluna" de "remover a antiga" em entregas diferentes.
- Leitura tolerante a dados antigos: campo ausente ou inesperado não derruba a aplicação.
- Transações em tudo que precisa ser atômico; mantenha-as curtas e sem chamadas de rede dentro.

## 6. Idempotência e concorrência
- Operações que podem ser repetidas (reenvio do cliente, retentativa de fila) aceitam uma chave de idempotência ou são naturalmente idempotentes.
- Duas requisições ao mesmo tempo: use restrição única no banco, bloqueio otimista (versão) ou fila. Verificar e depois gravar sem proteção é condição de corrida.
- Tempo limite em toda chamada externa, com retentativa limitada e espaçada só quando a operação é segura de repetir.

## 7. Listas e desempenho
- Toda listagem é paginada e tem limite máximo no servidor. Prefira cursor a deslocamento em tabelas grandes.
- Evite N+1: carregue relações em lote. Crie índice para os filtros e ordenações que a rota usa.
- Meça antes de otimizar; registre o tempo das operações lentas.

## 8. Observabilidade
- Logs estruturados com o que ajuda a investigar: rota, id de correlação, duração, resultado.
- Nunca registre senha, token, cookie, chave, documento pessoal ou corpo inteiro de requisição.
- Erro inesperado é registrado uma vez, com contexto, no ponto em que é tratado.

## 9. Testes
- Teste de contrato para cada rota alterada: sucesso, cada erro previsto, entrada nos limites (vazio, máximo, máximo mais um), propriedade desconhecida, falta de permissão.
- Teste de integração com banco e serviços **temporários** (contêiner, banco em memória, diretório temporário), nunca com dados reais.
- Falha de gravação simulada prova que nada ficou pela metade.

## Armadilhas comuns
- Confiar no id do usuário enviado no corpo em vez do id da sessão.
- Retornar a entidade inteira do banco, com campos internos ou sensíveis.
- Capturar a exceção e responder 200 com mensagem de erro.
- Migração que funciona no banco vazio de teste e trava o banco de produção.

## Ao terminar
Relate: contrato final (o que mudou e se quebra algo), comandos de teste rodados e o resultado real, o que não foi verificado.
