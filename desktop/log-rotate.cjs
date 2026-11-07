// Rotação do log do servidor (server.log -> .1 -> .2). Módulo puro (sem Electron); nunca lança em falha de disco.
const fs = require('node:fs');

/** Roda a rotação se o arquivo passou de `maxBytes`: descarta o mais antigo, desloca os demais e move o atual para `.1`. */
function rotateIfNeeded({ file, maxBytes = 5 * 1024 * 1024, backups = 2, fsImpl = fs } = {}) {
  try {
    if (fsImpl.statSync(file).size <= maxBytes) return false;
    try { fsImpl.rmSync(`${file}.${backups}`, { force: true }); } catch { /* ignora */ }
    for (let i = backups - 1; i >= 1; i--) { try { fsImpl.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch { /* backup ausente */ } }
    fsImpl.renameSync(file, `${file}.1`);
    return true;
  } catch { return false; } // arquivo ausente ou disco com problema: segue gravando sem rotacionar
}

/** Gravador de linhas com checagem barata de tamanho (a cada `checkEvery` gravações; `check()` extra para o boot e um timer). */
function createLogWriter({ file, maxBytes = 5 * 1024 * 1024, backups = 2, checkEvery = 200, fsImpl = fs } = {}) {
  let n = 0;
  const check = () => rotateIfNeeded({ file, maxBytes, backups, fsImpl });
  const write = (line) => {
    try {
      if (++n % checkEvery === 0) check();
      fsImpl.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
      return true;
    } catch { return false; }
  };
  return { write, check };
}

module.exports = { rotateIfNeeded, createLogWriter };
