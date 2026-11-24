// Guarda das Contas v2 (docs/contas-v2-plano.md, etapa 10): o modelo antigo ("conta Sistema", conta padrão) só pode existir em server/account-compat.js,
// que traduz os registros antigos. Em qualquer outro arquivo de PRODUÇÃO (server/, client/src/, desktop/) o teste falha se reaparecer:
//   - o literal 'system' entre aspas (a referência da conta virtual). Exceção única: `log('system', …)`, o tipo de entrada do log de atividade (store.js), que não é conta;
//   - `defaultAccountId` (a conta padrão do servidor) e `isDefault` (o selo "Padrão" da interface);
//   - o rótulo "Sistema (padrão)" e a rota /api/accounts/:id/default.
// Só lê arquivos: não sobe servidor nem toca no banco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = new Set(['server/account-compat.js']);
const SKIP_DIRS = new Set(['node_modules', 'test', 'dist', 'build', 'release', 'out', '.git']); // builds e o app empacotado (desktop/release) são cópias, não código-fonte
const EXT = /\.(?:js|mjs|cjs|jsx)$/;

/** Arquivos de produção (relativos à raiz, com `/`), sem testes, dependências nem builds. */
function productionFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
      if (e.isFile() && EXT.test(e.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  for (const d of ['server', 'client/src']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  // desktop/: só os arquivos do 1º nível (main.cjs etc.); as subpastas (stage/, release/, build/) são cópias empacotadas de builds antigos, não código-fonte
  const desk = path.join(ROOT, 'desktop');
  if (fs.existsSync(desk)) for (const e of fs.readdirSync(desk, { withFileTypes: true })) if (e.isFile() && EXT.test(e.name)) out.push(`desktop/${e.name}`);
  return out.sort();
}

const RULES = [
  { id: "literal 'system'", re: /(['"`])system\1/g, allow: (line, at) => /\blog\(\s*$/.test(line.slice(0, at)) },
  { id: 'defaultAccountId', re: /\bdefaultAccountId\b/g },
  { id: 'isDefault', re: /\bisDefault\b/g },
  { id: '"Sistema (padrão)"', re: /Sistema \(padrão\)/g },
  { id: 'rota /default de contas', re: /\/api\/accounts\/[^\s'"`]*\/default\b/g },
];

/** Ocorrências proibidas num texto: [{ rule, line, text }]. */
export function violations(src) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) if (!r.allow?.(line, m.index)) out.push({ rule: r.id, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
  return out;
}

test('controle: o detector acha cada padrão proibido e respeita só a exceção do log de atividade', () => {
  const bad = ["if (id === 'system') x();", 'const a = "system";', 'db.defaultAccountId = x;', '{a.isDefault && <b/>}', "title: 'Conta: Sistema (padrão)'", "api.post(`/api/accounts/${id}/default`)"];
  for (const s of bad) assert.equal(violations(s).length, 1, s);
  assert.deepEqual(violations("log('system', 'Falha ao gravar o banco')"), [], 'tipo do log de atividade não é conta');
  assert.equal(violations("log('info', 'x'); f('system')").length, 1, 'a exceção vale só para o 1º argumento de log(');
  assert.deepEqual(violations('// system-reminder e systemStatus são outra coisa\nconst systemPrompt = 1;'), [], 'palavra sem aspas não conta');
});

test('nenhum arquivo de produção fora de account-compat.js usa a conta Sistema ou a conta padrão', () => {
  const files = productionFiles();
  assert.ok(files.includes('server/accounts.js') && files.includes('client/src/accounts-view.js') && files.includes('server/account-compat.js'), 'a varredura enxerga o código de verdade');
  assert.ok(!files.some((f) => f.startsWith('server/test/')), 'testes ficam de fora (eles exercitam a migração do modelo antigo)');
  assert.ok(files.includes('desktop/main.cjs') || !fs.existsSync(path.join(ROOT, 'desktop/main.cjs')), 'o código do desktop entra');
  assert.ok(!files.some((f) => /^desktop\/.+\//.test(f)), 'cópias empacotadas (desktop/stage, desktop/release) ficam de fora');
  const found = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    for (const v of violations(fs.readFileSync(path.join(ROOT, f), 'utf8'))) found.push(`${f}:${v.line} [${v.rule}] ${v.text}`);
  }
  assert.deepEqual(found, [], `Modelo antigo de contas fora de server/account-compat.js:\n${found.join('\n')}`);
});

test('account-compat.js continua sendo o lugar da tradução (o guarda não está passando por arquivo vazio)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/account-compat.js'), 'utf8');
  assert.ok(violations(src).some((v) => v.rule === "literal 'system'"), 'a tradução da referência antiga mora aqui');
  assert.match(src, /export function migrateAccountsV2/);
});
