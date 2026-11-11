---
name: qualidade-e-testes
description: "Estratégia e escrita de testes em qualquer projeto: escolher entre unidade, integração e ponta a ponta, escrever o teste que falha pelo motivo certo, cobrir regressões e o que mudou, isolar dados e ambiente, tratar testes intermitentes e nunca enfraquecer um teste para fazer passar. Use ao escrever, corrigir ou revisar testes, ou antes de declarar uma tarefa pronta."
---

# Qualidade e testes

O objetivo de um teste é falhar quando o comportamento quebra e passar quando ele está certo. Todo o resto (cobertura, número de testes) é consequência.

## 1. Comece pelo projeto
- Descubra como os testes rodam: o script do gerenciador de pacotes, o arquivo de configuração, a pasta dos testes, como rodar um arquivo só e um teste só.
- Rode os testes da área **antes** de mudar qualquer coisa. Falha que já existia é anotada e relatada, não atribuída à sua mudança nem escondida.
- Siga o estilo dos testes vizinhos: mesma biblioteca de asserção, mesmas fábricas de dados, mesmos auxiliares.

## 2. Que tipo de teste
- **Unidade**: lógica pura, regras de negócio, formatação, validação. Rápido e sem disco, rede ou relógio real.
- **Integração**: rota com banco, serviço com fila, módulo com o sistema de arquivos. Usa recursos reais, mas temporários.
- **Ponta a ponta**: poucos, para os fluxos que mais importam ao usuário. Caros e mais frágeis; não teste regra de negócio por aqui.
- Regra prática: teste no nível mais baixo que ainda prova o comportamento que interessa.

## 3. O teste que falha pelo motivo certo
- Para correção de defeito: escreva primeiro o teste que reproduz o defeito, veja-o falhar com a mensagem esperada, depois corrija.
- Uma ideia por teste, com nome que diz o comportamento ("recusa e-mail sem arroba"), não a implementação.
- Asserções específicas: valor exato, código de erro, mensagem relevante. Evite "não lançou" ou "é verdadeiro" quando dá para conferir o valor.
- Cubra as bordas: vazio, nulo, um, muitos, o limite exato e o limite mais um, texto com acentos e caracteres especiais, entrada maliciosa.

## 4. Cobertura do que mudou
- Todo comportamento novo ou alterado tem teste que falharia sem a mudança. Confira desfazendo a mudança mentalmente ou de fato.
- Caminhos de erro contam tanto quanto o caminho feliz: permissão negada, recurso inexistente, falha de gravação, tempo esgotado.
- Contrato público (rota, formato gravado em disco, evento) ganha teste que fixa o formato.

## 5. Dados e ambiente isolados
- Cada teste prepara o que precisa e limpa o que criou. Nenhum depende da ordem dos outros.
- Banco, diretórios e portas temporários; nunca o banco, a pasta ou o serviço reais do usuário. Confira a variável de ambiente que aponta o diretório de dados antes de rodar a suíte.
- Relógio, aleatoriedade e rede são injetados ou simulados. Sem esperas fixas (sleep) para "dar tempo".

## 6. Testes intermitentes
- Intermitente é defeito, no teste ou no código. Rode várias vezes para confirmar e procure a causa: ordem entre testes, estado compartilhado, tempo, concorrência, porta ocupada, fuso horário.
- Não resolva com retentativa automática nem aumentando o tempo limite sem entender a causa.
- Se não der para corrigir agora, relate com a evidência (quantas vezes falhou, com qual mensagem).

## 7. Nunca enfraqueça um teste
- Não apague, não pule, não afrouxe asserção e não troque valor esperado só para ficar verde.
- Se o teste fixa um comportamento que a tarefa muda de propósito, ajuste o mínimo e explique no relato por quê.
- Se o teste parece errado, relate o defeito com a evidência em vez de alterá-lo por conta própria.

## Armadilhas comuns
- Teste que passa mesmo com a função apagada (asserção fraca ou simulação demais).
- Simular a própria unidade sob teste.
- Comparar texto inteiro gerado quando só um trecho importa, tornando o teste frágil.
- Testes que gravam no diretório do projeto ou deixam arquivos para trás.

## Ao terminar
Informe os comandos rodados e o resultado real (quantos passaram, quantos falharam e quais), o que não foi testado e por quê. Nunca escreva "testes passando" sem ter visto a saída.
