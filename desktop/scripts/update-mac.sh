#!/usr/bin/env bash
# Atualiza o FORGE instalado em /Applications com a main mais recente, mantendo o MESMO caminho
# (o ícone fixado no Dock continua valendo). Os dados ficam em ~/Library/Application Support/FORGE e não são tocados.
set -euo pipefail

DESKTOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$DESKTOP/.." && pwd)"
DEST="/Applications/FORGE.app"

# Substituir um app aberto corrompe a cópia e o servidor segura a trava do banco.
if pgrep -x FORGE >/dev/null 2>&1; then
  echo "O FORGE está aberto. Feche-o (Cmd+Q) e rode de novo." >&2
  exit 1
fi

cd "$REPO"
git pull --ff-only
cd "$DESKTOP"
npm run dir:mac

SRC="$DESKTOP/release/mac/FORGE.app"
[ -d "$SRC" ] || { echo "Build não gerou $SRC" >&2; exit 1; }

# rsync atualiza no lugar (mesmo caminho/inode da pasta), sem apagar o app antes.
rsync -a --delete "$SRC/" "$DEST/"
echo "FORGE atualizado em $DEST"
