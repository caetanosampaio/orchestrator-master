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

// Alterações de arquivos (status + numstat), argumentos fixos e somente leitura.
export async function gitChanges(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { isRepo: false, files: [] };
  try {
    const [st, ns] = await Promise.all([run(dir, ['status', '--porcelain=v1', '-uall']), run(dir, ['diff', '--no-ext-diff', '--numstat']).catch(() => '')]);
    const stat = new Map(ns.split('\n').filter(Boolean).map((l) => { const [a, r, ...p] = l.split('\t'); return [p.join('\t'), { added: Number(a) || 0, removed: Number(r) || 0 }]; }));
    const files = st.split('\n').filter(Boolean).slice(0, 200).map((l) => {
      const p = l.slice(3).replace(/^"|"$/g, '');
      const n = stat.get(p);
      return { path: p, status: l.slice(0, 2).trim() || '?', added: n ? n.added : null, removed: n ? n.removed : null };
    });
    return { isRepo: true, files };
  } catch { return { isRepo: true, files: [], error: 'Falha ao ler alterações do Git' }; }
}

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // árvore vazia do Git (repositório SHA-1): base quando o agente fez o PRIMEIRO commit

/** Commit atual (HEAD) do repositório, ou null (sem Git, sem commits, saída inesperada). Argumentos fixos, somente leitura. */
export async function gitHead(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  try { const out = (await run(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).trim(); return SHA.test(out) ? out : null; } catch { return null; }
}

/**
 * Arquivos que mudaram ENTRE dois commits (`diff --numstat before..after`), para os commits feitos pelo agente durante a execução. `before` null = sem commit anterior (árvore vazia).
 * Os dois ids vêm do próprio gitHead, mas são revalidados aqui: nada que não seja um SHA inteiro chega ao Git. Devolve [] se algo falhar (nunca lança).
 * @returns {Promise<{path:string, status:string, added:number|null, removed:number|null}[]>}
 */
export async function gitCommittedFiles(dir, before, after) {
  const from = before ?? EMPTY_TREE;
  if (!SHA.test(String(from)) || !SHA.test(String(after ?? '')) || from === after) return [];
  try {
    const [ns, st] = await Promise.all([
      run(dir, ['diff', '--no-ext-diff', '--no-renames', '--numstat', '-z', from, after]),
      run(dir, ['diff', '--no-ext-diff', '--no-renames', '--name-status', '-z', from, after]).catch(() => ''),
    ]);
    const status = new Map(); const t = st.split('\0');
    for (let i = 0; i + 1 < t.length; i += 2) status.set(t[i + 1], t[i].slice(0, 1) || '?');
    return ns.split('\0').filter(Boolean).slice(0, 200).map((rec) => {
      const [a, r, ...p] = rec.split('\t'), file = p.join('\t'); // -z: "added\tremoved\tpath"
      return { path: file, status: status.get(file) ?? '?', added: Number(a) || 0, removed: Number(r) || 0 };
    });
  } catch { return []; }
}
