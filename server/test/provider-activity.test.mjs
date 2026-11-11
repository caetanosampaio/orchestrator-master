// Atividade de tokens por provider/dia (server/provider-activity.js + GET /api/provider-activity).
// Tudo em pastas TEMPORÁRIAS (fixtures sintéticas de transcripts e rollouts, CLAUDE_CONFIG_DIR/CODEX_HOME falsos, ORCH_DATA_DIR temporário): nenhum ~/.claude, ~/.codex, data/ ou a porta 4317 é tocado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-provact-')));
process.env.ORCH_DATA_DIR = path.join(root, 'data');
const { createProviderActivity, parseDaysParam, localDay } = await import('../provider-activity.js');
after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0; const mk = (name = 'd') => { const d = path.join(root, `${name}${++n}`); fs.mkdirSync(d, { recursive: true }); return d; };
const p2 = (x) => String(x).padStart(2, '0');
// 12:00 local do dia (evita borda de fuso): timestamp ISO UTC equivalente
const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime(); // 11/nov/2026 12:00 local
const at = (daysAgo, h = 12, m = 0) => new Date(2026, 10, 11 - daysAgo, h, m, 0).toISOString();
const dayAgo = (daysAgo) => localDay(new Date(2026, 10, 11 - daysAgo, 12).getTime());

const asst = (id, ts, { i = 0, o = 0, cw = 0, cr = 0, model = 'claude-x' } = {}) => JSON.stringify({ type: 'assistant', uuid: `u-${id}-${Math.random()}`, timestamp: ts, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'SEGREDO-NAO-VAZAR' }], usage: { input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr } } });
function claudeFile(cfg, proj, name, lines, sub) {
  const dir = sub ? path.join(cfg, 'projects', proj, sub, 'subagents') : path.join(cfg, 'projects', proj);
  fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, lines.join('\n') + '\n'); return f;
}
const U = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
const tc = (ts, last, total) => JSON.stringify({ timestamp: ts, ordinal: 1, type: 'event_msg', payload: { type: 'token_count', info: last === null ? null : { total_token_usage: total, last_token_usage: last, model_context_window: 1000 }, rate_limits: null } });
const usage = (input, cached, output, tot) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: tot ?? input + output });
function rollout(home, daysAgo, k, lines) {
  const d = new Date(2026, 10, 11 - daysAgo, 12), dir = path.join(home, 'sessions', String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate()));
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `rollout-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T12-00-00-${U(k)}.jsonl`); fs.writeFileSync(f, lines.join('\n') + '\n'); return f;
}
const mkAct = (cfgs, home, extra = {}) => createProviderActivity({ claudeDirs: () => cfgs, codexHome: home, now: () => NOW, listTtlMs: 0, ...extra });
const settle = async (act, args = {}) => { act.view(args); await act.idle(); return act.view(args); };
const prov = (v, id) => v.providers.find((p) => p.id === id);

test('Claude: soma io e cache por dia local, dedupe por message.id (a última linha vence) e ignora sintético/sem consumo', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  claudeFile(cfg, 'proj-a', `${U(1)}.jsonl`, [
    asst('m1', at(0), { i: 10, o: 5, cw: 100, cr: 1000 }),
    asst('m1', at(0, 12, 1), { i: 10, o: 50, cw: 100, cr: 1000 }), // mesma mensagem (outro bloco): a última vence
    asst('m2', at(1), { i: 1, o: 2 }),
    asst('syn', at(0), { i: 99, o: 99, model: '<synthetic>' }),
    asst('zero', at(0), {}),
    JSON.stringify({ type: 'user', timestamp: at(0), message: { usage: { input_tokens: 777, output_tokens: 777 } } }),
    'linha quebrada {',
  ]);
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.equal(v.scanning, false);
  assert.deepEqual(v.providers.map((p) => p.id), ['claude']);
  const c = prov(v, 'claude');
  assert.equal(c.label, 'Claude'); assert.equal(c.accounts, 1);
  assert.deepEqual(c.days, { [dayAgo(1)]: { io: 3, cache: 0 }, [dayAgo(0)]: { io: 60, cache: 1100 } });
  assert.equal(v.sinceDay, dayAgo(1));
  assert.deepEqual(Object.keys(v), ['generatedAt', 'sinceDay', 'scanning', 'providers']);
  assert.ok(!JSON.stringify(v).includes('SEGREDO-NAO-VAZAR') && !JSON.stringify(v).includes('proj-a') && !JSON.stringify(v).includes(U(1)), 'só contagens: nada de texto/projeto/arquivo');
});

test('Claude: várias contas, subagentes e dedupe ENTRE arquivos (transcript retomado)', async () => {
  const a = mk('cfgA'), b = mk('cfgB'), home = mk('nocodex');
  claudeFile(a, 'p', `${U(1)}.jsonl`, [asst('m1', at(0), { i: 10, o: 10 }), asst('m2', at(0), { i: 5, o: 5 })]);
  claudeFile(a, 'p', 'agent-x.jsonl', [asst('s1', at(0), { i: 1, o: 1, cr: 7 })], U(1)); // <sessão>/subagents/*.jsonl
  claudeFile(b, 'q', `${U(2)}.jsonl`, [asst('m1', at(0), { i: 10, o: 10 }), asst('m3', at(0), { i: 100, o: 0 })]); // m1 repetida (resume)
  const v = await settle(mkAct([a, b, a, '', null], home), { days: 0 }); // pasta repetida/ inválida não duplica nem derruba
  const c = prov(v, 'claude');
  assert.equal(c.accounts, 2);
  assert.deepEqual(c.days[dayAgo(0)], { io: 20 + 10 + 2 + 100, cache: 7 });
});

test('Claude: arquivos só com consumo de outros dias, janela 30/90/0 e sinceDay', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('a', at(0), { i: 1 }), asst('b', at(29), { i: 2 }), asst('c', at(30), { i: 4 }), asst('d', at(89), { i: 8 }), asst('e', at(90), { i: 16 })]);
  const act = mkAct([cfg], home); await settle(act);
  const io = (v) => Object.fromEntries(Object.entries(prov(v, 'claude').days).map(([d, x]) => [d, x.io]));
  assert.deepEqual(io(act.view({ days: 30 })), { [dayAgo(29)]: 2, [dayAgo(0)]: 1 }); // hoje + 29 anteriores
  assert.equal(act.view({ days: 30 }).sinceDay, dayAgo(29));
  assert.deepEqual(io(act.view({ days: 90 })), { [dayAgo(89)]: 8, [dayAgo(30)]: 4, [dayAgo(29)]: 2, [dayAgo(0)]: 1 });
  assert.deepEqual(io(act.view({ days: 0 })), { [dayAgo(90)]: 16, [dayAgo(89)]: 8, [dayAgo(30)]: 4, [dayAgo(29)]: 2, [dayAgo(0)]: 1 });
  assert.equal(act.view({ days: 0 }).sinceDay, dayAgo(90));
  assert.deepEqual(io(act.view({ days: 1 })), { [dayAgo(0)]: 1 });
});

test('Codex: io = (entrada - cache) + saída, cache = cached_input; o mesmo acumulado repetido não soma de novo', async () => {
  const cfg = mk('cfgvazio'), home = mk('codex');
  rollout(home, 0, 1, [
    JSON.stringify({ timestamp: at(0), type: 'session_meta', payload: { text: 'SEGREDO-NAO-VAZAR' } }),
    tc(at(0, 12, 1), usage(1000, 800, 50, 1050), usage(1000, 800, 50, 1050)),
    tc(at(0, 12, 2), usage(1000, 800, 50, 1050), usage(1000, 800, 50, 1050)), // repetição do mesmo acumulado: ignorada
    tc(at(0, 12, 3), usage(2000, 1500, 30, 2030), usage(3000, 2300, 80, 3080)),
    tc(at(0, 12, 4), null, null), // info: null
    tc(at(0, 12, 5), usage(1, 0, 1, 2), usage(3000, 2300, 80, 3080)), // acumulado não avançou: ignorado
  ]);
  rollout(home, 1, 2, [tc(at(1), usage(10, 20, 5), usage(10, 20, 5))]); // cache > entrada: limitado à entrada (nunca negativo)
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.deepEqual(v.providers.map((p) => p.id), ['codex']);
  const c = prov(v, 'codex');
  assert.equal(c.label, 'Codex'); assert.equal(c.accounts, 1);
  assert.deepEqual(c.days[dayAgo(0)], { io: (200 + 50) + (500 + 30), cache: 800 + 1500 });
  assert.deepEqual(c.days[dayAgo(1)], { io: 5, cache: 10 });
  assert.ok(!JSON.stringify(v).includes('SEGREDO-NAO-VAZAR'));
});

test('Codex: rollout copiado em outro arquivo (mesmos eventos) conta uma vez; nome inválido e link simbólico são ignorados', async () => {
  const cfg = mk('cfgvazio'), home = mk('codex');
  const ev = [tc(at(0), usage(100, 0, 10, 110), usage(100, 0, 10, 110))];
  rollout(home, 0, 1, ev); rollout(home, 0, 2, ev);
  const dir = path.dirname(rollout(home, 0, 3, [])); // vazio
  fs.writeFileSync(path.join(dir, 'rollout-nome-errado.jsonl'), ev.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'outro.jsonl'), ev.join('\n') + '\n');
  const real = path.join(mk('fora'), 'x.jsonl'); fs.writeFileSync(real, tc(at(0), usage(5000, 0, 5000, 10000), usage(5000, 0, 5000, 10000)) + '\n');
  let linked = false; try { fs.symlinkSync(real, path.join(dir, `rollout-2026-11-11T12-00-00-${U(9)}.jsonl`)); linked = true; } catch { /* sem permissão de symlink */ }
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 110, cache: 0 }, linked ? 'symlink não foi seguido' : 'symlink indisponível neste ambiente');
});

test('sem dados / pastas ausentes: providers vazio, sinceDay null, scanning false', async () => {
  const act = mkAct([path.join(root, 'nao-existe')], path.join(root, 'nem-esta'));
  const v = act.view({ days: 30 });
  assert.deepEqual(v.providers, []); assert.equal(v.sinceDay, null); assert.equal(v.scanning, false);
  const cfg = mk('cfg'); fs.mkdirSync(path.join(cfg, 'projects', 'p'), { recursive: true });
  assert.deepEqual((await settle(mkAct([cfg], mk('c')))).providers, []);
});

test('incremental: só o acrescentado é lido; linha parcial espera o resto; arquivo que recomeça é relido', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const f = claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('a', at(0), { i: 10 })]);
  const act = mkAct([cfg], home); let v = await settle(act, { days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 10);
  const full = asst('b', at(0), { i: 5, o: 5 }), cut = Math.floor(full.length / 2);
  fs.appendFileSync(f, full.slice(0, cut)); // metade da linha
  v = act.view({ days: 0 }); assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 10, 'linha incompleta não conta');
  fs.appendFileSync(f, full.slice(cut) + '\n'); // resto
  v = act.view({ days: 0 }); await act.idle(); v = act.view({ days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 20, 'tempo real: o acrescentado entra sem nova varredura completa');
  fs.writeFileSync(f, asst('z', at(0), { i: 3 }) + '\n'); // recomeçou menor
  v = await settle(act, { days: 0 }); assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 3);
  fs.rmSync(f); v = await settle(act, { days: 0 }); assert.deepEqual(v.providers, [], 'arquivo removido deixa de contar');
});

test('linha com caractere multibyte atravessando o limite de leitura não perde nem corrompe o consumo', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const lines = []; for (let i = 0; i < 60; i++) lines.push(JSON.stringify({ type: 'assistant', timestamp: at(0), message: { id: `m${i}`, model: 'x', content: 'ã€😀'.repeat(20), usage: { input_tokens: 1, output_tokens: 1 } } }));
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, lines);
  const v = await settle(mkAct([cfg], home, { chunkBytes: 257 }), { days: 0 }); // fatias pequenas e desalinhadas
  assert.deepEqual(prov(v, 'claude').days[dayAgo(0)], { io: 120, cache: 0 });
});

test('1ª varredura em fatias: scanning true enquanto lê e false ao terminar', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  for (let i = 0; i < 6; i++) claudeFile(cfg, 'p', `${U(i + 1)}.jsonl`, Array.from({ length: 40 }, (_, k) => asst(`f${i}-${k}`, at(0), { i: 1 })));
  const act = mkAct([cfg], home, { chunkBytes: 600, tickMs: 0 });
  const first = act.view({ days: 0 });
  assert.equal(first.scanning, true, 'logo após o pedido ainda está lendo');
  assert.equal(act.scanning(), true);
  await act.idle();
  const done = act.view({ days: 0 });
  assert.equal(done.scanning, false); assert.equal(prov(done, 'claude').days[dayAgo(0)].io, 240);
});

test('falha de leitura de um arquivo (apagado ou trocado por pasta entre a listagem e a leitura) não derruba o resto', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const mkFiles = () => [1, 2, 3, 4].map((i) => claudeFile(cfg, 'p', `${U(i)}.jsonl`, Array.from({ length: 30 }, (_, k) => asst(`g${i}-${k}`, at(0), { i: 1 }))));
  const [a, b] = mkFiles();
  const act = mkAct([cfg], home, { chunkBytes: 400, tickMs: 0 });
  assert.equal(act.view({ days: 0 }).scanning, true); // listou e agendou a leitura em segundo plano
  fs.rmSync(a); fs.rmSync(b); fs.mkdirSync(b); // a: some; b: vira uma PASTA com o mesmo nome (nunca lida como arquivo)
  await act.idle();
  const v = act.view({ days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 60, 'os dois arquivos restantes contam por inteiro');
  assert.equal(v.partial, undefined);
});

test('arquivo vencedor do dedupe some: a cópia continua contando (Claude e Codex); relido em lote, uma só vez', async () => {
  const cfg = mk('cfg'), home = mk('codex');
  const lines = Array.from({ length: 5 }, (_, k) => asst(`dup${k}`, at(0), { i: 10, o: 1 }));
  const a = claudeFile(cfg, 'p', `${U(1)}.jsonl`, lines), b = claudeFile(cfg, 'q', `${U(2)}.jsonl`, lines), c = claudeFile(cfg, 'r', `${U(3)}.jsonl`, [...lines, asst('so-c', at(0), { i: 100 })]);
  const ev = [tc(at(0, 12, 1), usage(100, 0, 10, 110), usage(100, 0, 10, 110)), tc(at(0, 12, 2), usage(50, 10, 5, 55), usage(150, 10, 15, 165))];
  const ra = rollout(home, 0, 1, ev), rb = rollout(home, 0, 2, ev);
  const act = mkAct([cfg], home); let v = await settle(act, { days: 0 });
  assert.deepEqual(prov(v, 'claude').days[dayAgo(0)], { io: 55 + 100, cache: 0 }); assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 155, cache: 10 });
  fs.rmSync(a); fs.rmSync(ra); v = await settle(act, { days: 0 }); // os "vencedores" (lidos primeiro) somem
  assert.deepEqual(prov(v, 'claude').days[dayAgo(0)], { io: 55 + 100, cache: 0 }, 'Claude: b/c continuam contando as mesmas mensagens');
  assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 155, cache: 10 }, 'Codex: a cópia continua contando');
  fs.rmSync(b); v = await settle(act, { days: 0 }); assert.deepEqual(prov(v, 'claude').days[dayAgo(0)], { io: 55 + 100, cache: 0 }, 'só c sobrou e tem tudo');
  fs.rmSync(c); fs.rmSync(rb); v = await settle(act, { days: 0 }); assert.deepEqual(v.providers, [], 'sem arquivos, sem consumo');
});

test('Codex: evento sem total_token_usage também é deduplicado (mesmo timestamp em outro rollout; repetição no mesmo arquivo)', async () => {
  const cfg = mk('cfgvazio'), home = mk('codex');
  const noTotal = (ts, u) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: u } } });
  const e1 = noTotal(at(0, 12, 1), usage(100, 0, 10)), e2 = noTotal(at(0, 12, 2), usage(100, 0, 10)); // mesmo consumo, instantes diferentes: são 2 eventos
  rollout(home, 0, 1, [e1, e1, e2]); rollout(home, 0, 2, [e1, e2]);
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 220, cache: 0 });
});

test('muitos arquivos regravados (mesmo tamanho, mtime novo) são tirados em UMA passada, com custo igual ao das chaves deles', async () => {
  const cfg = mk('cfg'), home = mk('nocodex'), N = 300, PER = 3;
  const L = (id, i) => JSON.stringify({ type: 'assistant', uuid: 'u', timestamp: at(0), message: { id, model: 'x', usage: { input_tokens: i, output_tokens: 0 } } });
  const fs_ = []; for (let i = 0; i < N; i++) fs_.push(claudeFile(cfg, 'p', `${U(i + 1)}.jsonl`, Array.from({ length: PER }, (_, k) => L(`x${i}-${k}`, 1))));
  claudeFile(cfg, 'q', `${U(N + 5)}.jsonl`, [L('x0-0', 1)]); // um arquivo "perdedor" (cópia de x0-0) também existe
  const stats = {}; const act = mkAct([cfg], home, { stats }); await settle(act, { days: 0 });
  assert.equal(prov(act.view({ days: 0 }), 'claude').days[dayAgo(0)].io, N * PER);
  const before = { ...stats }, t = new Date(Date.now() + 9000);
  for (let i = 0; i < N; i++) { fs.writeFileSync(fs_[i], Array.from({ length: PER }, (_, k) => L(`x${i}-${k}`, 2)).join('\n') + '\n'); fs.utimesSync(fs_[i], t, t); }
  const v = await settle(act, { days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, N * PER * 2, 'todas relidas com os valores novos');
  assert.ok((stats.drops ?? 0) - (before.drops ?? 0) <= 3, `drops em lote: ${(stats.drops ?? 0) - (before.drops ?? 0)}`); // sem lote seriam >= N
  assert.ok((stats.keyVisits ?? 0) - (before.keyVisits ?? 0) <= N * PER + 10, `chaves visitadas: ${(stats.keyVisits ?? 0) - (before.keyVisits ?? 0)}`); // sem índice por arquivo seriam N x histórico
});

test('listagem incompleta (readdir transitório falha ou orçamento de pastas estoura): nada é descartado, partial:true; completa de novo, some', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  for (let i = 1; i <= 3; i++) claudeFile(cfg, `proj${i}`, `${U(i)}.jsonl`, [asst(`l${i}`, at(0), { i: 10 })]);
  const act = mkAct([cfg], home); let v = await settle(act, { days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 30); assert.equal(v.partial, undefined);
  const real = fs.readdirSync, boom = path.join(cfg, 'projects', 'proj2');
  fs.readdirSync = (d, o) => { if (path.resolve(String(d)) === boom) { const e = new Error('EPERM simulado'); e.code = 'EPERM'; throw e; } return real(d, o); };
  try { v = await settle(act, { days: 0 }); } finally { fs.readdirSync = real; }
  assert.equal(v.partial, true, 'falha transitória marca a resposta como parcial'); assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 30, 'o que não apareceu NÃO é tratado como sumido');
  v = await settle(act, { days: 0 }); assert.equal(v.partial, undefined); assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 30);
  fs.rmSync(path.join(cfg, 'projects', 'proj3'), { recursive: true }); v = await settle(act, { days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 20, 'listagem completa: o que sumiu de verdade deixa de contar');
  const small = mkAct([cfg], home, { maxDirs: 2 }); v = await settle(small, { days: 0 });
  assert.equal(v.partial, true, 'orçamento de pastas estourado');
});

test('teto de chaves de dedupe: o total nunca perde consumo e repetições próximas continuam deduplicadas', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const lines = []; for (let i = 0; i < 300; i++) { lines.push(asst(`k${i}`, at(0), { i: 1 })); lines.push(asst(`k${i}`, at(0), { i: 1, o: 1 })); } // cada mensagem em 2 linhas (blocos): a última vence
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, lines);
  const v = await settle(mkAct([cfg], home, { maxKeys: 50, chunkBytes: 700 }), { days: 0 });
  assert.equal(prov(v, 'claude').days[dayAgo(0)].io, 600);
});

test('meia-noite local: 23:59 e 00:01 caem em dias diferentes; instante com offset explícito cai no dia local correto', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const L = (id, ts, i) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'x', usage: { input_tokens: i, output_tokens: 0 } } });
  const off = '2026-11-10T23:59:30-03:00', offDay = localDay(Date.parse(off));
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [L('a', at(1, 23, 59), 1), L('b', at(0, 0, 0), 10), L('c', at(0, 0, 1), 100), L('d', off, 1000)]);
  const v = await settle(mkAct([cfg], home), { days: 0 }), d = prov(v, 'claude').days;
  const expected = { [dayAgo(1)]: 1, [dayAgo(0)]: 110 }; expected[offDay] = (expected[offDay] ?? 0) + 1000;
  assert.deepEqual(Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.io])), expected);
});

test('listagem re-feita só depois do TTL (arquivo novo só aparece após listTtlMs)', async () => {
  const cfg = mk('cfg'), home = mk('nocodex'); let t = NOW;
  const act = createProviderActivity({ claudeDirs: () => [cfg], codexHome: home, now: () => t, listTtlMs: 3000 });
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('a', at(0), { i: 1 })]); await settle(act, { days: 0 });
  claudeFile(cfg, 'p', `${U(2)}.jsonl`, [asst('b', at(0), { i: 2 })]);
  t += 1000; assert.equal(prov(act.view({ days: 0 }), 'claude').days[dayAgo(0)].io, 1, 'dentro do TTL não relista');
  t += 3000; act.view({ days: 0 }); await act.idle(); assert.equal(prov(act.view({ days: 0 }), 'claude').days[dayAgo(0)].io, 3);
});

test('números hostis (1e308, negativo, string, null, fracionário, > 1e9) viram 0: a resposta nunca tem null/Infinity/NaN', async () => {
  const cfg = mk('cfg'), home = mk('codex');
  const raw = (id, u) => JSON.stringify({ type: 'assistant', timestamp: at(0), message: { id, model: 'x', usage: u } });
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [
    raw('h1', { input_tokens: 1e308, output_tokens: 1e308 }), raw('h2', { input_tokens: -5, output_tokens: '10' }), raw('h3', { input_tokens: null, output_tokens: 1.5 }),
    raw('h4', { input_tokens: 2e9, output_tokens: 1e9 + 1 }), raw('h5', { input_tokens: 1e9, output_tokens: 4, cache_read_input_tokens: 1e9 }), raw('h6', { input_tokens: 7, output_tokens: 1e308 }),
  ]);
  rollout(home, 0, 1, [
    tc(at(0, 12, 1), usage(1e308, 0, 1e308, 5), usage(1, 0, 1, 2)), tc(at(0, 12, 2), usage(5, 1, 5, 10), usage(5, 1, 5, 1e308)), // acumulado inverossímil: evento descartado
    tc(at(0, 12, 3), usage(-1, -1, -1, 3), usage(1, 0, 1, 3)), tc(at(0, 12, 4), usage(8, 2, 4, 12), usage(8, 2, 4, 12)),
  ]);
  const v = await settle(mkAct([cfg], home), { days: 0 });
  const body = JSON.stringify(v); assert.ok(!/null|Infinity|NaN|e[+-]\d/.test(body), body);
  assert.deepEqual(prov(v, 'claude').days[dayAgo(0)], { io: 1e9 + 4 + 7, cache: 1e9 }); // h5 (1e9 é o teto, vale) + h6 (só a entrada 7 vale)
  assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 10, cache: 2 }); // só o último evento vale: o 1º não tem consumo válido, o 2º tem acumulado inverossímil e o 3º só números negativos
});

test('dias implausíveis e timestamps/ids malformados são ignorados', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const mkmsg = (id, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, model: 'x', usage: { input_tokens: 1, output_tokens: 0 } } });
  const okTs = at(0), longId = 'x'.repeat(129);
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [
    mkmsg('ok', okTs), mkmsg('old', '2022-12-31T12:00:00.000Z'), mkmsg('future', new Date(NOW + 3 * 86400000).toISOString()), mkmsg('nan', 'nao-e-data'), mkmsg('curto', '2026-11-11'),
    mkmsg('longo', okTs + ' '.repeat(40)), mkmsg('num', 1762800000000), mkmsg(longId, okTs), mkmsg('lixo', '2026-11-11T12:00' + 'z'.repeat(5)),
    JSON.stringify({ type: 'assistant', uuid: longId, timestamp: okTs, message: { model: 'x', usage: { input_tokens: 50 } } }),
  ]);
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.deepEqual(prov(v, 'claude').days, { [dayAgo(0)]: { io: 1, cache: 0 } });
  claudeFile(cfg, 'p', `${U(2)}.jsonl`, [mkmsg('amanha', new Date(NOW + 20 * 3600000).toISOString())]);
  const v2 = await settle(mkAct([cfg], home), { days: 0 });
  assert.equal(prov(v2, 'claude').days[localDay(NOW + 20 * 3600000)].io, 1, 'até amanhã é aceito');
});

test('Claude: a mensagem mais completa vence entre arquivos; só projects/*/*.jsonl e projects/*/<sessão>/subagents/*.jsonl são lidos', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('m1', at(0), { i: 1, o: 1 })]); // versão parcial
  const b = claudeFile(cfg, 'q', `${U(2)}.jsonl`, [asst('m1', at(0), { i: 1, o: 50 }), asst('m1', at(1), { i: 1, o: 60 })]); // completa (e a última linha dela vence: dia anterior)
  const nested = path.join(cfg, 'projects', 'p', U(1), 'outra', 'x'); fs.mkdirSync(nested, { recursive: true }); fs.writeFileSync(path.join(nested, 'z.jsonl'), asst('fundo', at(0), { i: 999 }) + '\n'); // fora do padrão: não lido
  fs.mkdirSync(path.join(cfg, 'projects', 'p', U(1), 'tool-results'), { recursive: true }); fs.writeFileSync(path.join(cfg, 'projects', 'p', U(1), 'tool-results', 't.jsonl'), asst('tr', at(0), { i: 999 }) + '\n');
  const act = mkAct([cfg], home); let v = await settle(act, { days: 0 });
  assert.deepEqual(prov(v, 'claude').days, { [dayAgo(1)]: { io: 61, cache: 0 } });
  fs.rmSync(b); v = await settle(act, { days: 0 });
  assert.deepEqual(prov(v, 'claude').days, { [dayAgo(0)]: { io: 2, cache: 0 } }, 'o vencedor sumiu: a cópia parcial que perdeu o dedupe passa a contar (era limitação; agora é relida)');
});

test('Codex: total MENOR que o anterior é reinício do acumulado (recomeça a contar); repetição exata continua ignorada', async () => {
  const cfg = mk('cfgvazio'), home = mk('codex');
  rollout(home, 0, 1, [
    tc(at(0, 12, 1), usage(100, 0, 10, 110), usage(100, 0, 10, 110)),
    tc(at(0, 12, 2), usage(200, 0, 20, 220), usage(300, 0, 30, 330)),
    tc(at(0, 12, 3), usage(50, 0, 5, 55), usage(50, 0, 5, 55)), // reinício (55 < 330): conta e recomeça dali
    tc(at(0, 12, 4), usage(60, 0, 6, 66), usage(110, 0, 11, 121)),
    tc(at(0, 12, 5), usage(60, 0, 6, 66), usage(110, 0, 11, 121)), // repetição do acumulado novo: ignorada
    tc(at(0, 12, 6), usage(1, 0, 1, 2), usage(111, 0, 12, 123)),
  ]);
  const v = await settle(mkAct([cfg], home), { days: 0 });
  assert.deepEqual(prov(v, 'codex').days[dayAgo(0)], { io: 110 + 220 + 55 + 66 + 2, cache: 0 });
});

test('arquivo regravado com o MESMO tamanho (mtime mudou) é relido', async () => {
  const cfg = mk('cfg'), home = mk('nocodex');
  const L = (i) => JSON.stringify({ type: 'assistant', uuid: 'u', timestamp: at(0), message: { id: 'a', model: 'x', usage: { input_tokens: i, output_tokens: 0 } } }); // comprimento fixo
  const f = claudeFile(cfg, 'p', `${U(1)}.jsonl`, [L(11)]);
  const act = mkAct([cfg], home); await settle(act, { days: 0 });
  assert.equal(prov(act.view({ days: 0 }), 'claude').days[dayAgo(0)].io, 11);
  fs.writeFileSync(f, L(22) + '\n'); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t); // mesmo comprimento, conteúdo e mtime novos
  assert.equal(prov(await settle(act, { days: 0 }), 'claude').days[dayAgo(0)].io, 22);
});

test('uma conta repetida com outra caixa de letras não duplica o consumo (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const cfg = mk('Cfg'), home = mk('nocodex');
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('a', at(0), { i: 5 })]);
  const v = await settle(mkAct([cfg, cfg.toUpperCase(), cfg.toLowerCase()], home), { days: 0 });
  assert.deepEqual([prov(v, 'claude').accounts, prov(v, 'claude').days[dayAgo(0)].io], [1, 5]);
});

test('parseDaysParam', () => {
  assert.equal(parseDaysParam(undefined), 30); assert.equal(parseDaysParam('0'), 0); assert.equal(parseDaysParam('90'), 90); assert.equal(parseDaysParam('3660'), 3660);
  for (const bad of ['', '-1', '1.5', 'abc', '3661', '99999', ['30', '90'], '30 ', '0x10', null]) assert.equal(parseDaysParam(bad), null, String(bad));
});

// ---------- servidor real: GET /api/provider-activity ----------
const INDEX_BOOT = path.join(here, 'accounts-boot.mjs'); // servidor real com executor falso e a CLI falsa de contas
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rawGet = (port, urlPath, headers) => new Promise((resolve, reject) => { const q = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }); q.on('error', reject); });
async function bootReal(env) {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`, emptyPath = mk('path-vazio');
  const base = { ...process.env }; for (const k of Object.keys(base)) if (k.toUpperCase() === 'PATH') delete base[k];
  const child = spawn(process.execPath, [INDEX_BOOT], { env: { ...base, PATH: emptyPath, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.on('exit', r));
  for (let i = 0; i < 100 && !/FORGE API em/.test(out); i++) await Promise.race([sleep(100), exited]);
  assert.match(out, /FORGE API em/, out);
  return { port, origin, stop: async () => { child.kill(); await exited; await sleep(300); } };
}

test('servidor real: rota lê a pasta padrão + a pasta de cada conta + o Codex; valida days; Host/Origin; no-store', async () => {
  const data = mk('data'), cfg = mk('claude'), codexHome = mk('codex'), ACC = 'acc_aaaaaaaa';
  claudeFile(cfg, 'p', `${U(1)}.jsonl`, [asst('d1', new Date().toISOString(), { i: 10, o: 5, cr: 100 })]); // conta padrão (CLAUDE_CONFIG_DIR)
  claudeFile(path.join(data, 'accounts', ACC, 'claude'), 'p', `${U(2)}.jsonl`, [asst('a1', new Date().toISOString(), { i: 20, o: 0, cw: 50 })]); // conta do FORGE
  const d = new Date(); const dir = path.join(codexHome, 'sessions', String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate())); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-2026-01-01T00-00-00-${U(3)}.jsonl`), tc(new Date().toISOString(), usage(100, 40, 10), usage(100, 40, 10)) + '\n');
  fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({ version: 1, settings: { activeWorkspaceId: null, requireApproval: true, showDemoData: false }, workspaces: [], missions: [], activity: [], accounts: [{ id: ACC, provider: 'claude', label: 'Trabalho', createdAt: new Date().toISOString() }], terminalSessions: [] }));
  const s = await bootReal({ ORCH_DATA_DIR: data, CLAUDE_CONFIG_DIR: cfg, CODEX_HOME: codexHome });
  try {
    let j, r;
    for (let i = 0; i < 50; i++) { r = await rawGet(s.port, '/api/provider-activity?days=0', { origin: s.origin }); j = JSON.parse(r.body); if (!j.scanning && j.providers.length) break; await sleep(100); }
    assert.equal(r.status, 200); assert.match(r.headers['content-type'], /json/); assert.equal(r.headers['cache-control'], 'no-store');
    const today = localDay(Date.now());
    assert.deepEqual(j.providers.map((p) => [p.id, p.accounts]), [['claude', 2], ['codex', 1]]);
    assert.deepEqual(j.providers[0].days, { [today]: { io: 35, cache: 150 } });
    assert.deepEqual(j.providers[1].days, { [today]: { io: 70, cache: 40 } });
    assert.equal(j.scanning, false); assert.equal(j.sinceDay, today);
    assert.equal(JSON.parse((await rawGet(s.port, '/api/provider-activity', { origin: s.origin })).body).providers.length, 2, 'days padrão = 30');
    for (const q of ['?days=abc', '?days=-5', '?days=7.5', '?days=99999', '?days=1&days=2']) assert.equal((await rawGet(s.port, `/api/provider-activity${q}`, { origin: s.origin })).status, 400, q);
    assert.equal((await rawGet(s.port, '/api/provider-activity', {})).status, 200, 'GET sem Origin é aceito, como nas demais leituras');
    assert.equal((await rawGet(s.port, '/api/provider-activity', { origin: 'http://evil.example' })).status, 403);
    assert.equal((await rawGet(s.port, '/api/provider-activity', { host: 'evil.example' })).status, 403);
    for (const bad of [data, cfg, codexHome, ACC]) assert.ok(!r.body.includes(bad.replaceAll('\\', '\\\\')) && !r.body.includes(bad), 'nenhum caminho/id de conta na resposta');
  } finally { await s.stop(); }
});
