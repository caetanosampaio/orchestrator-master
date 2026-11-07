// Limpeza da trava do servidor depois do taskkill. Módulo puro (sem Electron).
// No Windows o encerramento é `taskkill /F`: o servidor não roda o desligamento gracioso e o `server.lock` sobra. Se o PID for reaproveitado por outro
// processo, o próximo boot recusaria abrir. Aqui a trava só é removida quando pertence EXATAMENTE ao processo que acabamos de encerrar.
const fs = require('node:fs');
const path = require('node:path');

const LOCK_NAME = 'server.lock';

/** Remove `<dir>/server.lock` somente se o pid gravado nela for `pid`. Nunca lança. Retorna { removed, reason }. */
function removeLockIfOwned({ dir, pid, fsImpl = fs } = {}) {
  try {
    if (!dir || !Number.isInteger(pid) || pid <= 0) return { removed: false, reason: 'invalid' };
    const lockPath = path.join(dir, LOCK_NAME);
    let info;
    try { info = JSON.parse(fsImpl.readFileSync(lockPath, 'utf8')); } catch (e) { return { removed: false, reason: e && e.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
    if (!info || info.pid !== pid) return { removed: false, reason: 'other-owner' }; // trava de outro processo: não é nossa
    fsImpl.unlinkSync(lockPath);
    return { removed: true, reason: 'owned' };
  } catch {
    return { removed: false, reason: 'error' };
  }
}

module.exports = { removeLockIfOwned, LOCK_NAME };
