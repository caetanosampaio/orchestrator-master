// Cores dos tokens dos agentes (client/src/tokens.css): contraste AA e semântica. Lê os tokens reais; sem React nem servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ---- contraste dos tons (lê os tokens reais; guarda contra regressão) ----
const css = fs.readFileSync(new URL('../../client/src/tokens.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const resolve = (name, depth = 0) => { let v = tokens[name]; const ref = v?.match(/^var\((--[\w-]+)\)$/); return ref && depth < 5 ? resolve(ref[1], depth + 1) : v; };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('tokens dos agentes resolvem para cores reais e mantêm contraste AA (≥ 4,5:1) em todas as superfícies de texto', () => {
  const surfaces = ['--bg', '--surface', '--canvas', '--raise', '--raise2'].map((n) => [n, resolve(n)]);
  for (const t of ['--ag-idle', '--ag-run', '--ag-err', '--run', '--warn']) {
    const c = resolve(t);
    assert.match(c, /^#[0-9a-f]{6}$/i, `${t} não resolveu para uma cor: ${c}`);
    for (const [n, s] of surfaces) assert.ok(ratio(c, s) >= 4.5, `${t} sobre ${n}: ${ratio(c, s).toFixed(2)}:1`);
  }
  assert.equal(resolve('--ag-run'), resolve('--warn'), 'executando = âmbar');
  assert.equal(resolve('--ag-idle'), resolve('--muted'), 'inativo = cinza');
  assert.equal(resolve('--ag-err'), resolve('--err'), 'erro = vermelho');
  assert.notEqual(resolve('--ag-run'), resolve('--ok'), 'verde fica reservado a tarefas concluídas');
});
