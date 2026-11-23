// Caminho do npm-cli.js que acompanha o Node em execução: quem roda npm o chama como `node npm-cli.js ...`, sem shell (worktrees.js, flow-verify.js).
// Procura ao lado do executável (instalação do Windows) e em ../lib/node_modules (Linux/macOS). Devolve null se não houver npm.
import fs from 'node:fs';
import path from 'node:path';

export function resolveNpmCli({ execPath = process.execPath, exists = fs.existsSync } = {}) {
  const bin = path.dirname(execPath);
  return [path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((p) => exists(p)) || null;
}
