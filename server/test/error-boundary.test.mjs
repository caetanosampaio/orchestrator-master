// Cliente: a exceção de renderização não deixa a tela em branco. O componente REAL é empacotado (esbuild) e renderizado com react-dom/server;
// o servidor não renderiza error boundaries, então o fluxo getDerivedStateFromError -> render é exercitado chamando o ciclo do componente diretamente.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '..', '..', 'client');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-errbound-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('ErrorBoundary: sem erro entrega os filhos; com erro mostra a mensagem (como texto) e o botão de recarregar', async () => {
  const esbuild = createRequire(path.join(CLIENT, 'package.json'))('esbuild');
  const entry = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import EB, { ErrorFallback } from './components/ErrorBoundary.jsx';
    export const derive = (e) => EB.getDerivedStateFromError(e);
    export const healthy = () => { const b = new EB({ children: React.createElement('p', null, 'conteúdo') }); return renderToStaticMarkup(b.render()); };
    export const failed = (e) => { const b = new EB({ children: React.createElement('p', null, 'conteúdo') }); b.state = EB.getDerivedStateFromError(e); return renderToStaticMarkup(b.render()); };
    export const fallback = (e) => renderToStaticMarkup(React.createElement(ErrorFallback, { error: e, onReload() {} }));`;
  const out = await esbuild.build({ stdin: { contents: entry, resolveDir: path.join(CLIENT, 'src'), loader: 'jsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', absWorkingDir: CLIENT, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  const file = path.join(root, 'eb-bundle.cjs'); fs.writeFileSync(file, out.outputFiles[0].text);
  const m = createRequire(import.meta.url)(file);

  assert.match(m.healthy(), /conteúdo/); assert.ok(!m.healthy().includes('data-testid="error-boundary"'), 'sem erro nada de erro aparece');
  const err = new Error('falhou <b>x</b>');
  assert.equal(m.derive(err).error, err);
  const html = m.failed(err);
  assert.match(html, /data-testid="error-boundary"/); assert.match(html, /role="alert"/); assert.match(html, /Recarregar a interface/); assert.ok(!html.includes('conteúdo'), 'o filho que quebrou não é renderizado');
  assert.ok(html.includes('falhou &lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'), 'a mensagem do erro é texto, nunca HTML');
  assert.ok(m.fallback(null).includes('erro desconhecido'), 'erro sem mensagem não derruba o fallback');
  assert.ok(m.fallback(new Error('x'.repeat(1000))).length < 3000, 'mensagem enorme é cortada');
  assert.ok(m.derive(undefined).error instanceof Error, 'erro lançado vazio (throw undefined) ainda ativa o fallback');
});
