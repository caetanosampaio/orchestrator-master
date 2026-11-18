// Endurecimento do preview do painel Live: corrida determinística entre a validação e o open (TOCTOU) e socket parado (cliente que não lê).
// Servidor real em 127.0.0.1:0, diretórios temporários; o banco real não é tocado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-livehard-')));
process.env.ORCH_DATA_DIR = path.join(tmp, 'orch-data');
const { createPreviewManager } = await import('../live-preview.js');

const managers = [];
const mk = (opts = {}) => { const m = createPreviewManager({ dataDir: path.join(tmp, 'orch-data'), ...opts, limits: { memoMs: 0, ...(opts.limits ?? {}) } }); managers.push(m); return m; };
after(async () => { for (const m of managers) await m.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
const newWs = (files) => { const dir = path.join(tmp, `ws${++seq}`); fs.mkdirSync(dir, { recursive: true }); for (const [rel, c] of Object.entries(files)) { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } return { id: `ws_${String(seq).padStart(8, '0')}`, name: 'w', path: dir }; };
const req = (port, target = '/') => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: target, agent: false, headers: { host: `127.0.0.1:${port}` } }, (res) => { const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch) })); }).on('error', reject);
});
const junctionOk = (() => { const a = path.join(tmp, 'probe-a'), b = path.join(tmp, 'probe-b'); fs.mkdirSync(a); try { fs.symlinkSync(a, b, 'junction'); fs.rmdirSync(b); return true; } catch { return false; } })();
/** Troca a pasta `dir` por uma junção para `target` (a original vai para `dir_orig`) e a restaura depois. */
const toJunction = (dir, target) => { fs.renameSync(dir, `${dir}_orig`); fs.symlinkSync(target, dir, 'junction'); };
const restore = (dir) => { fs.rmdirSync(dir); fs.renameSync(`${dir}_orig`, dir); };

function raceFixture() {
  const ws = newWs({ 'site/index.html': 'ok', 'site/d/x.txt': 'DENTRO' });
  const outside = path.join(tmp, `fora${seq}`); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'x.txt'), 'VAZOU-FORA');
  return { ws, outside, dir: path.join(ws.path, 'site', 'd') };
}

test('TOCTOU: pasta trocada por junção DEPOIS da validação e ANTES do open => 404 (o arquivo de fora não vaza)', { skip: !junctionOk && 'sem permissão para junção' }, async () => {
  const { ws, outside, dir } = raceFixture(); let armed = true, proved = false;
  const m = mk({ hooks: { beforeOpen: async () => { if (!armed) return; armed = false; toJunction(dir, outside); proved = fs.readFileSync(path.join(dir, 'x.txt'), 'utf8') === 'VAZOU-FORA'; } } });
  const { port } = await m.ensure(ws);
  const r = await req(port, '/d/x.txt');
  assert.equal(proved, true, 'a troca aconteceu de fato: sem a reverificação o open leria o arquivo de fora');
  assert.equal(r.status, 404); assert.ok(!r.body.toString().includes('VAZOU'));
  restore(dir); assert.equal((await req(port, '/d/x.txt')).body.toString(), 'DENTRO', 'sem corrida o arquivo legítimo continua servido');
});

test('TOCTOU: junção só durante o open e pasta restaurada logo depois (o realpath final parece certo) => 404 pela identidade dev/ino', { skip: !junctionOk && 'sem permissão para junção' }, async () => {
  const { ws, outside, dir } = raceFixture(); let armed = true;
  const m = mk({ hooks: { beforeOpen: async () => { if (armed) toJunction(dir, outside); }, afterOpen: async () => { if (armed) { armed = false; restore(dir); } } } });
  const { port } = await m.ensure(ws);
  const r = await req(port, '/d/x.txt');
  assert.equal(r.status, 404); assert.ok(!r.body.toString().includes('VAZOU'));
  assert.equal(armed, false, 'os dois ganchos rodaram'); assert.equal((await req(port, '/d/x.txt')).body.toString(), 'DENTRO');
});

test('TOCTOU: o descritor aberto não vaza nem quando o ARQUIVO é trocado por um link depois da validação (quando o SO permite)', async (t) => {
  const ws = newWs({ 'index.html': 'ok', 'a.txt': 'DENTRO' }); const secret = path.join(tmp, `segredo${seq}.txt`); fs.writeFileSync(secret, 'VAZOU-FORA');
  const f = path.join(ws.path, 'a.txt'); let armed = true, linked = false;
  const m = mk({ hooks: { beforeOpen: async () => { if (!armed) return; armed = false; fs.rmSync(f); try { fs.symlinkSync(secret, f, 'file'); linked = true; } catch { fs.writeFileSync(f, 'DENTRO'); } } } });
  const { port } = await m.ensure(ws); const r = await req(port, '/a.txt');
  if (!linked) { t.skip('symlink de arquivo indisponível (EPERM): só o caso de pasta foi verificado'); return; }
  assert.equal(r.status, 404); assert.ok(!r.body.toString().includes('VAZOU'));
});

test('socket parado: conexões que pedem arquivo grande e não leem são derrubadas e o servidor volta a responder', async () => {
  const ws = newWs({ 'index.html': 'ok' }); const big = Buffer.alloc(48 * 1024 * 1024, 0x61); fs.writeFileSync(path.join(ws.path, 'grande.txt'), big);
  const m = mk({ limits: { maxConnections: 3, socketTimeoutMs: 500, maxFileBytes: 64 * 1024 * 1024, keepAliveTimeout: 60000 } });
  const { port } = await m.ensure(ws);
  const stalled = [];
  for (let i = 0; i < 3; i++) {
    const s = net_connect(port); stalled.push(s);
    await new Promise((r) => s.once('connect', r)); s.write(`GET /grande.txt HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`); s.pause(); // pediu e NÃO lê
  }
  await new Promise((r) => setTimeout(r, 150));
  await assert.rejects(req(port, '/'), 'enquanto os 3 sockets parados seguram as conexões, o limite (3) recusa uma nova');
  let ok = null; const t0 = Date.now();
  while (Date.now() - t0 < 8000) { try { ok = await req(port, '/'); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  for (const s of stalled) s.destroy();
  assert.ok(ok && ok.status === 200 && ok.body.toString() === 'ok', 'depois do tempo de inatividade o servidor derrubou os sockets parados e voltou a responder');
});

import net from 'node:net';
function net_connect(port) { return net.connect(port, '127.0.0.1'); }
