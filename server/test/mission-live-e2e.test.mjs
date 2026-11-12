// Acompanhamento ao vivo de cada missão (E2E): servidor REAL (server/index.js via audit-server-boot.mjs) em processo filho, SEMPRE com ORCH_DATA_DIR temporário e porta livre própria,
// com e sem ORCH_API_TOKEN (app desktop). Prova a ligação em index.js: /live não cai no catch-all do SPA, o link de capacidade só nasce por rota protegida, a visão não vaza
// caminho nem token e o link some com a missão. Nenhum modelo é chamado.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audit-server-boot.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-live-e2e-'));
const children = new Set();
after(async () => { for (const c of children) { try { c.kill(); } catch { /* já encerrado */ } } await new Promise((r) => setTimeout(r, 400)); fs.rmSync(root, { recursive: true, force: true }); });

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const TOKEN = 'T0kenDeTesteDaSessao_abcdefghijklmnopqrstuvwxyz0123456789';
let n = 0;
async function boot(extraEnv = {}) {
  const dir = path.join(root, `d${++n}`); fs.mkdirSync(dir);
  const port = await freePort();
  const child = spawn(process.execPath, [BOOT], { env: { ...process.env, PORT: String(port), ORCH_DATA_DIR: dir, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let out = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  for (let i = 0; i < 100 && !/FORGE API em/.test(out); i++) await Promise.race([new Promise((r) => setTimeout(r, 100)), exited]);
  assert.match(out, /FORGE API em/, `o servidor não subiu: ${out}`);
  const base = `http://127.0.0.1:${port}`;
  const call = (method, p, body, { token = false } = {}) => fetch(base + p, { method, headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...(token ? { 'x-orch-token': TOKEN } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { child, dir, base, call, out: () => out };
}

async function newMission(s, opts) {
  const wsDir = path.join(root, `ws${++n}`); fs.mkdirSync(wsDir);
  const ws = await (await s.call('POST', '/api/workspaces', { path: wsDir }, opts)).json();
  assert.ok(ws.id, 'workspace criado');
  const m = await (await s.call('POST', '/api/missions', { title: 'Missão de teste ao vivo', objective: `Objetivo em ${wsDir}`, workspaceId: ws.id }, opts)).json();
  assert.ok(m.id, 'missão criada');
  return { ws, m, wsDir };
}
const tokenOf = (url) => /\/live\/([A-Za-z0-9_-]{40,})\/$/.exec(url)?.[1];

test('sem token de sessão: cunhar, abrir a página, ler a visão redigida, baixar o relatório e encerrar o link', async () => {
  const s = await boot();
  const { m, wsDir } = await newMission(s);
  const r = await s.call('POST', `/api/missions/${m.id}/live-link`);
  assert.equal(r.status, 201); assert.match(r.headers.get('cache-control'), /no-store/);
  const { url, expiresAt } = await r.json();
  const tok = tokenOf(url); assert.ok(tok, 'URL de capacidade /live/<token>/'); assert.ok(url.startsWith(s.base), 'usa o host e a porta da requisição'); assert.ok(!url.includes(m.id), 'a URL nunca carrega o id da missão');
  assert.ok(Date.parse(expiresAt) > Date.now());

  // a página: HTML estático de /live (não o index.html do SPA), com a CSP estrita
  const page = await fetch(url);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text(); assert.match(html, /\/live\/_\/live\.js/); assert.ok(!/id="root"/.test(html), 'não é o SPA');
  const csp = page.headers.get('content-security-policy'); assert.match(csp, /script-src 'self'/); assert.ok(!/unsafe-inline/.test(csp));
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(`${s.base}/live/_/live.js`)).status, 200); assert.equal((await fetch(`${s.base}/live/_/live.css`)).status, 200);
  assert.equal((await fetch(`${s.base}/live/${tok}`, { redirect: 'manual' })).status, 302, 'sem a barra final, redireciona');

  // a visão: schema 1, sem caminho do workspace, sem o token, sem o id interno exposto como credencial
  const dataRes = await fetch(`${url}data`); assert.equal(dataRes.status, 200);
  const raw = await dataRes.text(), snap = JSON.parse(raw);
  assert.equal(snap.schema, 1); assert.equal(snap.mission.title, 'Missão de teste ao vivo'); assert.ok(snap.link?.expiresAt);
  assert.ok(!raw.includes(wsDir) && !raw.includes(wsDir.replace(/\\/g, '/')), 'a visão não vaza o caminho do workspace'); assert.ok(!raw.includes(tok), 'a visão não traz o token'); assert.ok(!raw.includes(os.homedir()), 'nem o home');
  const again = await fetch(`${url}data`, { headers: { 'if-none-match': dataRes.headers.get('etag') ?? '' } }); assert.ok([200, 304].includes(again.status));

  // o relatório em Markdown
  const rep = await fetch(`${url}report.md`); assert.equal(rep.status, 200); assert.match(rep.headers.get('content-disposition'), /attachment/); assert.ok(!(await rep.text()).includes(wsDir));

  // o SSE manda o primeiro snapshot na hora
  const ac = new AbortController(); const sse = await fetch(`${url}stream`, { signal: ac.signal });
  assert.equal(sse.status, 200); assert.match(sse.headers.get('content-type'), /text\/event-stream/);
  const reader = sse.body.getReader(); let got = ''; const t0 = Date.now();
  while (!/event: snapshot/.test(got) && Date.now() - t0 < 5000) { const { value, done } = await reader.read(); if (done) break; got += Buffer.from(value).toString('utf8'); }
  ac.abort(); assert.match(got, /event: snapshot/); assert.ok(!got.includes(wsDir));

  // token inválido: 404 genérico; métodos que escrevem: 405
  assert.equal((await fetch(`${s.base}/live/${'a'.repeat(43)}/data`)).status, 404);
  assert.equal((await fetch(`${url}data`, { method: 'POST' })).status, 405);

  // encerrar o link (e a missão revoga o link)
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}/live-link`)).status, 204);
  assert.equal((await fetch(`${url}data`)).status, 404, 'link revogado');
  const r2 = await s.call('POST', `/api/missions/${m.id}/live-link`); assert.equal(r2.status, 201);
  const url2 = (await r2.json()).url; assert.notEqual(tokenOf(url2), tok, 'depois de revogar nasce um token novo');
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}`)).status, 204);
  assert.equal((await fetch(`${url2}data`)).status, 404, 'remover a missão revoga o link');
  assert.equal(s.child.exitCode, null, 'o servidor segue de pé');
});

test('com token de sessão (app desktop): só a interface cunha o link; o navegador externo lê só a visão daquela missão', async () => {
  const s = await boot({ ORCH_API_TOKEN: TOKEN });
  const { m, wsDir } = await newMission(s, { token: true });
  // cunhar é mutável: sem o token da sessão, 403 (um agente com shell não cunha link)
  assert.equal((await s.call('POST', `/api/missions/${m.id}/live-link`)).status, 403);
  const r = await s.call('POST', `/api/missions/${m.id}/live-link`, undefined, { token: true }); assert.equal(r.status, 201);
  const { url } = await r.json(); const tok = tokenOf(url);
  // as leituras de missões continuam protegidas; a página ao vivo funciona sem o token (o link é a credencial)
  assert.equal((await s.call('GET', '/api/missions')).status, 403, 'sem o token, /api/missions segue protegida');
  const data = await fetch(`${url}data`); assert.equal(data.status, 200);
  const raw = await data.text(); assert.ok(!raw.includes(wsDir) && !raw.includes(tok) && !raw.includes(TOKEN));
  assert.equal((await fetch(url)).status, 200);
  // o token da sessão e o do link não aparecem na atividade nem no estado
  for (const p of ['/api/activity', '/api/state']) { const body = await (await s.call('GET', p, undefined, { token: true })).text(); assert.ok(!body.includes(tok), `${p} não traz o token do link`); assert.ok(!body.includes(TOKEN), `${p} não traz o token da sessão`); }
  assert.ok(!s.out().includes(tok), 'o log do servidor não traz o token do link');
  // sem o token, não revoga
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}/live-link`)).status, 403);
  assert.equal((await s.call('DELETE', `/api/missions/${m.id}/live-link`, undefined, { token: true })).status, 204);
});

test('ORCH_LIVE=off desliga as rotas /live e a criação de links', async () => {
  const s = await boot({ ORCH_LIVE: 'off' });
  const { m } = await newMission(s);
  const r = await s.call('POST', `/api/missions/${m.id}/live-link`); assert.equal(r.status, 404); assert.match((await r.json()).error, /ORCH_LIVE=off/);
  assert.equal((await fetch(`${s.base}/live/_/live.js`)).status, 404);
});
