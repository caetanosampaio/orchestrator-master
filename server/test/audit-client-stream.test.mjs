// Reconexão do fluxo de terminais (client/src/terminal-stream.js) com EventSource e timers falsos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalStream } from '../../client/src/terminal-stream.js';

function rig() {
  const sources = [], timers = [];
  class FakeES {
    constructor(url) { this.url = url; this.readyState = 0; this.l = {}; this.closedByUs = false; sources.push(this); }
    addEventListener(t, f) { this.l[t] = f; }
    close() { this.closedByUs = true; this.readyState = 2; }
    emit(t, obj) { this.l[t]?.({ data: JSON.stringify(obj) }); }
    drop() { this.readyState = 2; this.onerror?.({}); }
  }
  const setT = (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return t; };
  const clearT = (t) => { if (t) t.off = true; };
  const fire = () => { const t = timers.filter((x) => !x.off).pop(); t.off = true; t.fn(); return t; };
  const stream = createTerminalStream({ EventSourceImpl: FakeES, setTimeoutImpl: setT, clearTimeoutImpl: clearT });
  return { sources, timers, fire, stream };
}

test('queda definitiva reabre com espera crescente (1s, 2s, 4s...) limitada a 15s', () => {
  const { sources, timers, fire, stream } = rig(); stream.subscribe('t1', {});
  const waits = [];
  for (let i = 0; i < 6; i++) { sources.at(-1).drop(); waits.push(timers.filter((t) => !t.off).at(-1).ms); fire(); }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.equal(sources.length, 7); assert.equal(stream.status(), 'reconnecting');
});

test('erro com a conexão ainda em CONNECTING não reabre (o navegador cuida)', () => {
  const { sources, timers, stream } = rig(); stream.subscribe('t1', {});
  sources[0].readyState = 0; sources[0].onerror({});
  assert.equal(timers.length, 0); assert.equal(stream.status(), 'connecting');
});

test('dado de volta zera a espera e o estado vira open; avisa os ouvintes', () => {
  const { sources, timers, fire, stream } = rig(); const seen = []; stream.onStatus((s) => seen.push(s));
  stream.subscribe('t1', {});
  sources[0].drop(); fire(); sources[1].drop(); fire();            // 1s, 2s
  sources[2].emit('data', { id: 't1', d: 'oi' });
  assert.equal(stream.status(), 'open');
  sources[2].drop(); assert.equal(timers.filter((t) => !t.off).at(-1).ms, 1000);
  assert.deepEqual(seen, ['reconnecting', 'open', 'reconnecting']);
});

test('destruir cancela a reabertura pendente e não reabre', () => {
  const { sources, timers, stream } = rig(); stream.subscribe('t1', {});
  sources[0].drop(); assert.equal(timers.filter((t) => !t.off).length, 1);
  stream.close(); assert.equal(timers.filter((t) => !t.off).length, 0);
  assert.equal(sources.length, 1);
  stream.subscribe('t1', {}); assert.equal(sources.length, 1);
});

test('a tela guardada é reposta pelo init da nova conexão', () => {
  const { sources, fire, stream } = rig(); const got = [];
  stream.subscribe('t1', { onReset: (t) => got.push(t) });
  sources[0].emit('init', { id: 't1', replay: 'A' }); sources[0].drop(); fire();
  sources[1].emit('init', { id: 't1', replay: 'AB' });
  assert.deepEqual(got, ['A', 'AB']);
});
