// Endurecimento da aba Construção (server/live-changes.js): filtros/drivers do Git definidos pelo repositório, memo/single-flight sem `since` em modo git,
// limite global de execuções simultâneas e corrida (TOCTOU) na contagem de linhas. Git REAL em repositórios temporários; nada toca o banco real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-livechg2-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'orch-data');
const { git: realGit } = await import('../worktrees.js');
const { createChangesService } = await import('../live-changes.js');
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
const G = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', '-c', 'safe.directory=*'];
const sh = (cwd, ...a) => execFileSync('git', [...G, ...a], { cwd, stdio: 'ignore' });
const put = (root, rel, content) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; };
const newRepo = () => { const d = path.join(tmp, `repo${++seq}`); fs.mkdirSync(d); sh(d, 'init', '-q'); return d; };
const wsOf = (dir) => ({ id: `ws_${String(++seq).padStart(8, '0')}`, name: 'w', path: dir });
const q = (p) => `node ${JSON.stringify(p.replace(/\\/g, '/'))}`;
const marker = (name) => { const m = path.join(tmp, `${name}-${++seq}.flag`), h = path.join(tmp, `${name}-${seq}.js`); fs.writeFileSync(h, `require('node:fs').writeFileSync(${JSON.stringify(m)}, 'x'); process.stdout.write('x');`); return { m, h }; };

// [nome, atributo, chaves de configuração (recebem o comando), comando cru que deve executá-lo]
const CASES = [
  ['filter.clean', '*.txt filter=pwn\n', (c) => ['filter.pwn.clean', c], 'status'],
  ['diff.textconv', '*.txt diff=evil\n', (c) => ['diff.evil.textconv', c], 'diff'],
  ['diff.command', '*.txt diff=evil\n', (c) => ['diff.evil.command', c], 'diff'],
];

for (const [name, attr, cfg, rawCmd] of CASES) {
  test(`${name} no .git/config: status/diff NÃO são chamados, o marcador não é criado e o resultado vem em modo scan com aviso (controle: o git cru executaria)`, async () => {
    const d = newRepo(); const { m, h } = marker(name.replace('.', '-'));
    put(d, 'a.txt', 'v1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b');
    put(d, '.gitattributes', attr); put(d, 'a.txt', 'v2\n'); // mesmo tamanho: o Git precisa comparar o CONTEÚDO (é aí que o filtro clean rodaria)
    const [key, val] = cfg(q(h)); sh(d, 'config', key, val);
    try { execFileSync('git', rawCmd === 'status' ? ['status', '--porcelain'] : ['diff'], { cwd: d, stdio: 'ignore' }); } catch { /* o que importa é o marcador */ }
    const control = fs.existsSync(m); fs.rmSync(m, { force: true });
    const calls = []; const spy = (cwd, args, opts) => { calls.push(args.filter((a) => !a.startsWith('-')).slice(0, 1)[0]); return realGit(cwd, args, opts); };
    const r = await createChangesService({ git: spy }).changes(wsOf(d));
    assert.equal(fs.existsSync(m), false, `${name} do repositório não pode ser executado`);
    assert.ok(!calls.includes('status') && !calls.includes('diff'), `status/diff não foram chamados (${calls.join(',')})`);
    assert.equal(r.mode, 'scan'); assert.match(r.error, /filtros ou comandos do Git/); assert.ok(r.files.some((f) => f.path === 'a.txt'), 'a varredura lista o arquivo alterado');
    if (!control) console.warn(`[aviso] controle: este Git não executou ${name} no comando cru; o teste só confirma o modo scan com aviso.`);
  });
}

test('filtro definido num arquivo incluído pelo .git/config (include.path) também é detectado', async () => {
  const d = newRepo(); const { m, h } = marker('incl');
  put(d, 'a.txt', '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, '.gitattributes', '*.txt filter=pwn\n'); put(d, 'a.txt', '1\n2\n');
  fs.writeFileSync(path.join(d, '.git', 'extra.cfg'), `[filter "pwn"]\n\tclean = ${q(h)}\n`); sh(d, 'config', 'include.path', 'extra.cfg');
  const r = await createChangesService({}).changes(wsOf(d));
  assert.equal(fs.existsSync(m), false); assert.equal(r.mode, 'scan'); assert.match(r.error, /filtros/);
});

test('sem filtros nem drivers: segue em modo git (sem aviso); falha na verificação da configuração => scan com aviso, sem status/diff', async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, 'a.txt', '1\n2\n');
  sh(d, 'config', 'diff.algorithm', 'patience'); // chave diff.* inofensiva (não é textconv/command)
  const ok = await createChangesService({}).changes(wsOf(d)); assert.equal(ok.mode, 'git'); assert.equal(ok.error, undefined);
  const calls = []; const broken = (cwd, args, opts) => { calls.push(args[0]); return args[0] === 'config' ? Promise.resolve({ code: 129, out: '', err: 'usage', failed: false, timedOut: false }) : realGit(cwd, args, opts); };
  const r = await createChangesService({ git: broken }).changes(wsOf(d)); assert.equal(r.mode, 'scan'); assert.match(r.error, /verificar a configuração/); assert.ok(!calls.includes('status') && !calls.includes('diff'));
});

test('modo git: chamadas concorrentes com `since` DIFERENTES executam o Git uma única vez (a chave do memo não inclui since)', async () => {
  const d = newRepo(); put(d, 'a.txt', '1\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, 'a.txt', '1\n2\n');
  const calls = []; const spy = (cwd, args, opts) => { calls.push(args); return realGit(cwd, args, opts); };
  const svc = createChangesService({ git: spy }); const ws = wsOf(d); const now = Date.now();
  const rs = await Promise.all([null, now - 1000, now - 2000, now - 3000, now - 4000, now - 5000, 0].map((since) => svc.changes(ws, { since })));
  assert.equal(calls.filter((a) => a.includes('status')).length, 1, 'um único git status para 7 chamadas'); assert.equal(calls.filter((a) => a.includes('diff')).length, 1);
  assert.ok(rs.every((r) => r === rs[0]) && rs[0].mode === 'git');
  await svc.changes(ws, { since: now - 9000 }); assert.equal(calls.filter((a) => a.includes('status')).length, 1, 'dentro da janela de 1,5 s continua o mesmo resultado');
});

test('limite global: no máximo 2 computações simultâneas mesmo com vários workspaces ao mesmo tempo', async () => {
  let active = 0, peak = 0; const slow = async (cwd, args, opts) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 40)); try { return await realGit(cwd, args, opts); } finally { active--; } };
  const svc = createChangesService({ git: slow }); const wss = [];
  for (let i = 0; i < 6; i++) { const d = newRepo(); put(d, 'a.txt', '1\n'); wss.push(wsOf(d)); }
  const rs = await Promise.all(wss.map((w) => svc.changes(w))); assert.equal(rs.length, 6); assert.ok(rs.every((r) => r.mode === 'git')); assert.ok(peak <= 2, `pico de ${peak} execuções simultâneas`); assert.ok(peak >= 1);
});

const junctionOk = (() => { const a = path.join(tmp, 'pa'), b = path.join(tmp, 'pb'); fs.mkdirSync(a); try { fs.symlinkSync(a, b, 'junction'); fs.rmdirSync(b); return true; } catch { return false; } })();
test('TOCTOU na contagem de linhas: pasta trocada por junção entre a checagem e o open => added:null (o arquivo de fora não é lido)', { skip: !junctionOk && 'sem permissão para junção' }, async () => {
  for (const variant of ['antes-do-open', 'so-durante-o-open']) {
    const d = newRepo(); put(d, 'base.txt', 'x\n'); sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', 'b'); put(d, 'd/x.txt', 'dentro\n');
    const outside = path.join(tmp, `fora${++seq}`); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'x.txt'), 'a\nb\nc\nd\ne\n');
    const dir = path.join(d, 'd'); let armed = true, swapped = false;
    const toJunction = () => { fs.renameSync(dir, `${dir}_orig`); fs.symlinkSync(outside, dir, 'junction'); swapped = fs.readFileSync(path.join(dir, 'x.txt'), 'utf8').startsWith('a\n'); };
    const back = () => { fs.rmdirSync(dir); fs.renameSync(`${dir}_orig`, dir); };
    const hooks = { beforeOpen: async () => { if (armed) toJunction(); }, afterOpen: async () => { if (armed) { armed = false; if (variant === 'so-durante-o-open') back(); } } };
    const r = await createChangesService({ limits: { hooks } }).changes(wsOf(d));
    const f = r.files.find((x) => x.path === 'd/x.txt'); assert.ok(f, variant); assert.equal(swapped, true, `${variant}: a troca aconteceu`);
    assert.equal(f.added, null, `${variant}: o arquivo de fora (5 linhas) não pode ser contado`);
  }
});
