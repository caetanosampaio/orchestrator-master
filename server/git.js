// Informações somente-leitura do Git, com argumentos fixos (sem comandos arbitrários).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const run = (cwd, args) =>
  new Promise((resolve, reject) =>
    // `core.fsmonitor` de um repositório hostil seria um comando executado pelo `git status`; fica desligado (e sem travas opcionais, para não competir com o Git do usuário)
    execFile('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, timeout: 8000, windowsHide: true, maxBuffer: 1 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (e, out) => (e ? reject(e) : resolve(out))));

export async function gitInfo(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { isRepo: false };
  try {
    const out = await run(dir, ['status', '--porcelain=v1', '-b']);
    const lines = out.split('\n').filter(Boolean);
    const branch = (lines[0] || '').replace(/^## /, '').split('...')[0];
    const changes = lines.slice(1).map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }));
    return { isRepo: true, branch, dirty: changes.length > 0, changes: changes.slice(0, 50), changeCount: changes.length };
  } catch (e) {
    return { isRepo: true, error: 'Falha ao ler o status do Git' };
  }
}
