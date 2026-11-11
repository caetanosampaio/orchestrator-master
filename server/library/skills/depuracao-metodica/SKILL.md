---
name: depuracao-metodica
description: "Depuração metódica em qualquer projeto: reproduzir o defeito, isolar a causa com hipóteses e evidências, bisseção no histórico (git bisect), uso de logs, correção mínima acompanhada de teste de regressão e relato que separa causa provável de causa confirmada. Use ao investigar um erro, uma regressão, um teste que falha ou um comportamento inesperado."
---

# Depuração metódica

Depurar é reduzir o espaço de busca com evidências, não tentar mudanças até algo funcionar.

**Se o seu papel é somente leitura** (batedor, revisor, investigação): não edite arquivos, não crie testes, não adicione logs e não rode `git bisect` nem nada que troque arquivos ou o commit atual da pasta, que pode ser a mesma em que outros agentes trabalham. Leia, rode só comandos que não alteram nada e entregue a causa provável e os passos (o teste de reprodução, o bisect, os logs) para quem implementa.

**Comandos que mudam a pasta** (`git bisect`, `git checkout`, `git stash`, logs temporários) só numa pasta própria e limpa, de preferência um worktree só seu, nunca na pasta de trabalho compartilhada.

## 1. Entenda o sintoma
- Anote exatamente: o que acontece, o que deveria acontecer, mensagem de erro completa, onde aparece, desde quando.
- Junte o contexto: versão, ambiente, sistema operacional, dados de entrada, último deploy ou commit que mexeu na área.
- Leia a mensagem de erro e a pilha de chamadas até o fim, do frame mais próximo do seu código para fora.

## 2. Reproduza
- Consiga um passo a passo que mostra o defeito sempre (ou com frequência conhecida). Sem reprodução, qualquer correção é palpite.
- Reduza até o mínimo: menos dados, menos passos, menos módulos. O caso mínimo costuma revelar a causa.
- Transforme a reprodução num teste automatizado que falha. Ele será o teste de regressão.
- Reproduza com dados e ambiente temporários, nunca mexendo em dados reais.

## 3. Hipóteses e evidências
- Liste as hipóteses possíveis e, para cada uma, a observação que a confirmaria ou descartaria.
- Comece pela mais provável e mais barata de testar. Mude **uma** coisa por vez.
- Evidência vale mais que intuição: valores reais de variáveis, logs, saída de comandos, diferença entre o que funciona e o que não funciona.
- Desconfie das suposições ("isso não pode ser nulo", "essa função não é chamada"): confira.

## 4. Ferramentas que encurtam o caminho
- **Bisseção no histórico**: se funcionava antes, `git bisect` com o teste de reprodução encontra o commit que introduziu o defeito em poucos passos (`git bisect start`, `git bisect bad`, `git bisect good <commit>`, `git bisect run <comando>`). Termine com `git bisect reset`.
- **Bisseção no código ou nos dados**: desligue metade do que pode influenciar e veja se o defeito some.
- **Logs temporários**: registre entradas, saídas e decisões nos pontos suspeitos, com marcador fácil de procurar. Remova antes de terminar. Nunca registre segredos.
- **Depurador**: ponto de parada condicional no ponto em que o valor fica errado, inspecionando quem o alterou.
- **Comparação**: ambiente que funciona contra o que falha (versões, variáveis, configuração, dados).

## 5. Causas que se repetem
- Estado compartilhado entre testes ou requisições; ordem de execução.
- Concorrência: duas operações sobre o mesmo recurso, promessa não aguardada, evento antes do ouvinte.
- Tempo: fuso horário, horário de verão, relógio, tempo limite curto.
- Dados: valor vazio, nulo, Unicode, número como texto, formato antigo gravado em disco.
- Ambiente: caminho com espaço ou acento, fins de linha diferentes, variável ausente, versão de dependência.
- Cache ou artefato velho de build.

## 6. Correção
- Corrija a causa, não o sintoma. Mudança mínima, no estilo do código ao redor.
- O teste de reprodução agora passa; rode também os testes da área para ver se nada mais quebrou.
- Procure o mesmo padrão de defeito em lugares vizinhos e relate o que encontrar.
- Não altere nem enfraqueça testes existentes para acomodar a correção.

## 7. Relato
- **Sintoma** e como reproduzir.
- **Causa**: diga se é **confirmada** (reproduzida e explicada, com evidência) ou **provável** (compatível com as evidências, mas não demonstrada). Nunca apresente hipótese como fato.
- **Evidências**: arquivo e linha, saída relevante, commit encontrado pela bisseção.
- **Correção** feita ou proposta, teste de regressão e resultado real dos testes.
- **Pendências**: o que não foi possível verificar e o próximo passo sugerido.

## Armadilhas comuns
- Mudar várias coisas de uma vez e não saber qual resolveu.
- Declarar resolvido porque o erro sumiu uma vez em um defeito intermitente.
- Envolver o erro num try/catch silencioso.
- Deixar logs de depuração e código comentado para trás.
