# O que é pwd

## Resumo

`pwd` significa **print working directory** (imprimir o diretório de trabalho). É um utilitário de linha de comandos de sistemas Unix-like (Linux, macOS) e também existe no PowerShell do Windows, onde é um apelido (alias) de `Get-Location`. Ele mostra o caminho completo (absoluto) da pasta em que o usuário está no momento.

## Para que serve

- Saber em que pasta você está.
- Conferir se está no projeto certo antes de rodar outras ferramentas.
- Montar caminhos relativos corretamente.
- Ajudar a depurar scripts que dependem da pasta atual.

## Como usar

Basta digitar `pwd` e pressionar Enter. A saída é uma única linha com o caminho completo da pasta atual.

Existem duas opções:

- `-L`: mostra o caminho **lógico**, seguindo os links simbólicos como foram percorridos.
- `-P`: mostra o caminho **físico**, resolvendo os links simbólicos.

Sem opções, o comportamento padrão costuma ser o lógico.

## Relação com o orquestrador

Neste projeto, o Executor só enxerga a pasta do workspace, e a pasta de trabalho de cada etapa é a raiz desse workspace.
