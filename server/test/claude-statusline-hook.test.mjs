// Hook da status line do Claude Code (server/claude-statusline-hook.mjs): grava SÓ as janelas de limite (5 h e semanal) em <pasta>/<session_id>.json.
// Pastas TEMPORÁRIAS; nenhum Claude real, nenhum dado do usuário.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, record, lineFor, clampPct, epochSeconds, REWRITE_MS } from '../claude-statusline-hook.mjs';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-slhook-')));
after(() => { fs.rmSync(root, { recursive: true, force: true }); });
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'claude-statusline-hook.mjs');
const SID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
let n = 0; const mk = () => { const d = path.join(root, `d${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const T0 = Date.parse('2026-11-09T12:00:00.000Z'), SEC0 = Math.floor(T0 / 1000);
const input = (over = {}) => ({ session_id: SID, model: { id: 'x' }, cwd: 'C:/secreto', transcript_path: 'C:/t.jsonl', rate_limits: { five_hour: { used_percentage: 23.5, resets_at: SEC0 + 3600 }, seven_day: { used_percentage: 41, resets_at: SEC0 + 86400 } }, ...over });
const fileOf = (d, sid = SID) => path.join(d, `${sid}.json`);
const read = (d, sid = SID) => JSON.parse(fs.readFileSync(fileOf(d, sid), 'utf8'));

test('parse: extrai SÓ as duas janelas e o session_id; o resto do JSON é ignorado', () => {
  const p = parse(input());
  assert.deepEqual(p, { sessionId: SID, fiveHour: { usedPct: 23.5, resetsAt: SEC0 + 3600 }, sevenDay: { usedPct: 41, resetsAt: SEC0 + 86400 } });
  assert.deepEqual(parse(JSON.stringify(input())), p, 'aceita texto JSON');
  assert.deepEqual(parse(input({ rate_limits: { five_hour: { used_percentage: 5, resets_at: SEC0 + 1 } } })).sevenDay, null, 'cada janela pode faltar');
  assert.deepEqual(parse(input({ rate_limits: undefined })), { sessionId: SID, fiveHour: null, sevenDay: null });
});

test('parse: session_id inválido (traversal, vazio, não-UUID, tipo errado) = null', () => {
  for (const bad of ['../evil', '..\\..\\x', '', ' ', 'abc', `${SID}/../x`, `${SID}\n`, 'x'.repeat(2000), null, 42, {}, [SID]]) assert.equal(parse(input({ session_id: bad })), null, JSON.stringify(bad));
  for (const bad of [null, undefined, 'não é json', '{', '[]', 7, []]) assert.equal(parse(bad), null);
  assert.equal(parse({ rate_limits: input().rate_limits }), null, 'sem session_id');
});

test('janelas: percentual limitado a 0..100; NaN, texto, negativos e números absurdos; epoch em ms é normalizado para segundos', () => {
  const w = (pct, at) => parse(input({ rate_limits: { five_hour: { used_percentage: pct, resets_at: at } } })).fiveHour;
  assert.deepEqual(w(150, SEC0 + 5), { usedPct: 100, resetsAt: SEC0 + 5 }, 'acima de 100 vira 100');
  assert.deepEqual(w(-20, SEC0 + 5), { usedPct: 0, resetsAt: SEC0 + 5 }, 'negativo vira 0');
  assert.deepEqual(w(12.3456, SEC0 + 5), { usedPct: 12.35, resetsAt: SEC0 + 5 });
  assert.deepEqual(w(1e308, SEC0 + 5), { usedPct: 100, resetsAt: SEC0 + 5 });
  for (const bad of [NaN, Infinity, -Infinity, '50', null, undefined, {}, [], true]) assert.equal(w(bad, SEC0 + 5), null, `pct ${String(bad)}`);
  for (const bad of [NaN, Infinity, 0, -5, '1700000000', null, undefined, 4_200_000_000, 1e20, {}]) assert.equal(w(10, bad), null, `resets_at ${String(bad)}`);
  assert.deepEqual(w(10, (SEC0 + 5) * 1000), { usedPct: 10, resetsAt: SEC0 + 5 }, 'epoch em milissegundos (>= 1e11) é normalizado, não recusado');
  assert.equal(parse(input({ rate_limits: { five_hour: 'x', seven_day: [1] } })).fiveHour, null);
  assert.equal(clampPct(Number.MAX_VALUE), 100); assert.equal(epochSeconds(1e11), 1e8, 'fronteira: 1e11 já é ms');
});

test('record: grava só os campos esperados, de forma atômica (sem .tmp sobrando), e nada do resto do stdin', () => {
  const d = mk(), r = record(d, input(), () => T0);
  assert.equal(r.at, new Date(T0).toISOString());
  assert.deepEqual(read(d), { at: new Date(T0).toISOString(), fiveHour: { usedPct: 23.5, resetsAt: SEC0 + 3600 }, sevenDay: { usedPct: 41, resetsAt: SEC0 + 86400 } });
  assert.deepEqual(fs.readdirSync(d), [`${SID}.json`]);
  const text = fs.readFileSync(fileOf(d), 'utf8'); assert.ok(!text.includes('secreto') && !text.includes('transcript'));
});

test('record: session_id inválido não grava nada (nem fora da pasta)', () => {
  const d = mk();
  for (const bad of ['../evil', '', 'abc', `..${path.sep}${SID}`]) assert.equal(record(d, input({ session_id: bad }), () => T0), null);
  assert.equal(record(d, input({ session_id: undefined }), () => T0), null);
  assert.equal(record('', input(), () => T0), null); assert.equal(record(undefined, input(), () => T0), null);
  assert.deepEqual(fs.readdirSync(d), []); assert.ok(!fs.existsSync(path.join(d, '..', 'evil.json')));
});

test('record: sem rate_limits (ou sem janela válida) NÃO apaga nem altera o arquivo anterior', () => {
  const d = mk(); record(d, input(), () => T0);
  const before = fs.readFileSync(fileOf(d), 'utf8');
  const kept = record(d, input({ rate_limits: undefined }), () => T0 + 60_000);
  assert.equal(fs.readFileSync(fileOf(d), 'utf8'), before); assert.equal(kept.fiveHour.usedPct, 23.5, 'devolve o que já estava gravado');
  record(d, input({ rate_limits: { five_hour: { used_percentage: 'x', resets_at: 'y' } } }), () => T0 + 120_000);
  assert.equal(fs.readFileSync(fileOf(d), 'utf8'), before);
  assert.equal(record(mk(), input({ rate_limits: undefined }), () => T0), null, 'sem arquivo anterior e sem dado: nada a gravar');
});

test('record: não regrava se nada mudou e o arquivo tem < 10 s; regrava se mudou ou a cada >= 10 s', () => {
  const d = mk(); record(d, input(), () => T0);
  const m0 = fs.statSync(fileOf(d)).mtimeMs; const at0 = read(d).at;
  record(d, input(), () => T0 + REWRITE_MS - 1); assert.equal(read(d).at, at0, 'igual e recente: intacto');
  record(d, input({ rate_limits: { five_hour: { used_percentage: 24, resets_at: SEC0 + 3600 }, seven_day: { used_percentage: 41, resets_at: SEC0 + 86400 } } }), () => T0 + 1000);
  assert.equal(read(d).fiveHour.usedPct, 24, 'mudou: regrava na hora'); assert.equal(read(d).at, new Date(T0 + 1000).toISOString());
  record(d, input({ rate_limits: { five_hour: { used_percentage: 24, resets_at: SEC0 + 3600 }, seven_day: { used_percentage: 41, resets_at: SEC0 + 86400 } } }), () => T0 + 1000 + REWRITE_MS);
  assert.equal(read(d).at, new Date(T0 + 1000 + REWRITE_MS).toISOString(), '>= 10 s: regrava para o `at` seguir recente'); void m0;
});

test('record: resposta com UMA janela só mantém a outra gravada enquanto o resetsAt dela está no futuro; vencida ou sem anterior = null', () => {
  const d = mk(); record(d, input(), () => T0); // as duas janelas
  record(d, input({ rate_limits: { seven_day: { used_percentage: 70, resets_at: SEC0 + 999 } } }), () => T0 + 1000);
  assert.deepEqual(read(d), { at: new Date(T0 + 1000).toISOString(), fiveHour: { usedPct: 23.5, resetsAt: SEC0 + 3600 }, sevenDay: { usedPct: 70, resetsAt: SEC0 + 999 } }, 'a 5 h anterior (ainda vigente) fica');
  const later = T0 + 4000 * 1000; // a janela de 5 h gravada já venceu (resetsAt = SEC0 + 3600)
  record(d, input({ rate_limits: { seven_day: { used_percentage: 71, resets_at: SEC0 + 5000 } } }), () => later);
  assert.deepEqual(read(d).fiveHour, null, 'janela anterior vencida não é mantida'); assert.equal(read(d).sevenDay.usedPct, 71);
  const e = mk(); record(e, input({ rate_limits: { seven_day: { used_percentage: 70, resets_at: SEC0 + 999 } } }), () => T0);
  assert.deepEqual(read(e), { at: new Date(T0).toISOString(), fiveHour: null, sevenDay: { usedPct: 70, resetsAt: SEC0 + 999 } }, 'sem anterior: a ausente é null');
});

test('record: .tmp previsível plantado como symlink não é seguido (nome aleatório + flag wx); sem sobras', (t) => {
  const d = mk(), alvo = path.join(mk(), 'alvo.txt'); fs.writeFileSync(alvo, 'intacto');
  const file = fileOf(d);
  try { fs.symlinkSync(alvo, `${file}.${process.pid}.tmp`); } catch { t.skip('sem permissão para criar link simbólico'); return; }
  record(d, input(), () => T0);
  assert.equal(fs.readFileSync(alvo, 'utf8'), 'intacto', 'o alvo do link não foi sobrescrito'); assert.equal(read(d).fiveHour.usedPct, 23.5);
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith('.tmp')), [`${SID}.json.${process.pid}.tmp`], 'só o link plantado sobrou; nenhum .tmp nosso');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('script: sem rate_limits e com UMA janela, a linha reúne a recebida e a anterior vigente', () => {
  const d = mk(); run(JSON.stringify(input({ rate_limits: { five_hour: { used_percentage: 30, resets_at: future(600) }, seven_day: { used_percentage: 60, resets_at: future(6000) } } })), d);
  const r = run(JSON.stringify(input({ rate_limits: { five_hour: { used_percentage: 31, resets_at: future(600) } } })), d);
  assert.equal(r.stdout, 'FORGE\n');
  assert.equal(read(d).fiveHour.usedPct, 31); assert.equal(read(d).sevenDay.usedPct, 60); // o arquivo (lido pelo cockpit) segue reunindo as duas janelas
});

test('record: arquivo anterior corrompido ou enorme não impede a gravação nova', () => {
  const d = mk(); fs.writeFileSync(fileOf(d), 'lixo{'); record(d, input(), () => T0); assert.equal(read(d).fiveHour.usedPct, 23.5);
  fs.writeFileSync(fileOf(d), 'x'.repeat(100_000)); record(d, input(), () => T0 + 1); assert.equal(read(d).fiveHour.usedPct, 23.5);
});

test('lineFor: o rodapé é sempre só FORGE (sem percentuais, que ficavam velhos entre terminais); nunca lança', () => {
  assert.equal(lineFor({ fiveHour: { usedPct: 23.4, resetsAt: SEC0 + 10 }, sevenDay: { usedPct: 40.6, resetsAt: SEC0 + 10 } }, T0), 'FORGE');
  for (const bad of [null, undefined, {}, 'x', 5, { fiveHour: { usedPct: NaN, resetsAt: 'a' } }]) assert.equal(lineFor(bad, T0), 'FORGE');
  assert.doesNotMatch(lineFor(), /[\r\n\x1b%]/);
});

// ---------- o script de verdade (processo filho) ----------
const run = (stdin, dir, extra = {}) => spawnSync(process.execPath, [SCRIPT, ...(dir === undefined ? [] : [dir])], { input: stdin, encoding: 'utf8', timeout: 15000, windowsHide: true, ...extra });
const future = (s) => Math.floor(Date.now() / 1000) + s;

test('script: stdin válido grava o arquivo, imprime UMA linha e sai com 0', () => {
  const d = mk();
  const r = run(JSON.stringify(input({ rate_limits: { five_hour: { used_percentage: 23.4, resets_at: future(3600) }, seven_day: { used_percentage: 41, resets_at: future(86400) } } })), d);
  assert.equal(r.status, 0); assert.equal(r.stdout, 'FORGE\n'); assert.equal(r.stderr, '');
  assert.equal(read(d).fiveHour.usedPct, 23.4);
});

test('script: sem dados, JSON inválido, stdin vazio, session_id perigoso e pasta ausente: imprime FORGE, sai com 0 e não grava', () => {
  const d = mk();
  for (const stdin of ['', 'não é json', '{', '[]', 'null', JSON.stringify(input({ rate_limits: undefined })), JSON.stringify(input({ session_id: '../x' }))]) {
    const r = run(stdin, d); assert.equal(r.status, 0, stdin); assert.equal(r.stdout, 'FORGE\n', stdin);
  }
  assert.deepEqual(fs.readdirSync(d), []);
  const noDir = run(JSON.stringify(input()), undefined); assert.equal(noDir.status, 0); assert.equal(noDir.stdout.split('\n').length, 2, 'uma linha só');
});

test('script: erro de disco (a pasta é um arquivo) nunca falha e imprime FORGE', () => {
  const f = path.join(root, 'arquivo'); fs.writeFileSync(f, 'x');
  const r = run(JSON.stringify(input({ rate_limits: { five_hour: { used_percentage: 50, resets_at: future(60) } } })), path.join(f, 'sub'));
  assert.equal(r.status, 0); assert.equal(r.stdout, 'FORGE\n');
});

test('script: sem rate_limits na chamada usa o arquivo anterior da sessão para a linha (se ainda vigente)', () => {
  const d = mk(); run(JSON.stringify(input({ rate_limits: { five_hour: { used_percentage: 30, resets_at: future(600) } } })), d);
  const r = run(JSON.stringify(input({ rate_limits: undefined })), d); assert.equal(r.status, 0); assert.equal(r.stdout, 'FORGE\n');
});
