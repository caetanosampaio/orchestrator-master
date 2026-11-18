// Caminhos do preview do painel Live (live-preview.js): funções que decidem O QUE uma URL pode pedir e qual pasta do workspace vira a raiz servida.
// Tudo aqui é conservador: um nome duvidoso (Windows: reservados, fluxos `:`, nomes 8.3, ponto/espaço final) é recusado, nunca "corrigido".
// Toda recusa de caminho vira o MESMO 404 genérico no servidor (não revela se o arquivo existe); só um %-inválido vira 400.
import fs from 'node:fs';
import path from 'node:path';
import { isGitName } from './evidence.js';

export const MAX_SEGMENT = 255;
export const MAX_PATH = 1024;
export const MAX_DEPTH = 20;

const TEXT = 'charset=utf-8';
/** Lista FECHADA de tipos servidos (extensão minúscula, sem ponto). Sem vídeo/áudio, sem Range. */
export const MIME = Object.freeze({
  html: `text/html; ${TEXT}`, htm: `text/html; ${TEXT}`, css: `text/css; ${TEXT}`, js: `text/javascript; ${TEXT}`, mjs: `text/javascript; ${TEXT}`,
  json: `application/json; ${TEXT}`, svg: `image/svg+xml; ${TEXT}`, png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: `text/plain; ${TEXT}`, webmanifest: `application/manifest+json; ${TEXT}`,
});

/** Extensão minúscula (sem ponto) do nome, ou '' quando não há. */
export const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i + 1).toLowerCase() : ''; };
/** Tipo de conteúdo da lista fechada para o nome, ou null (extensão fora da lista = não servir). */
export const mimeOf = (name) => { const e = extOf(name); return Object.hasOwn(MIME, e) ? MIME[e] : null; };

/** Nome reservado do Windows (CON PRN AUX NUL COM1-9 LPT1-9, também com extensão: `NUL.txt`, `com1.html`). Vale em qualquer SO: o preview não depende de onde roda. */
export function isReservedWindowsName(name) {
  const base = String(name ?? '').split('.')[0].replace(/[ ]+$/, '');
  return /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[1-9¹²³])$/i.test(base);
}

// Nomes que costumam guardar segredo ou configuração: nunca servidos pelo preview (mesmo dentro do docroot).
const SENSITIVE = /(secret|credential|token|password|passwd|private|id_rsa|\.pem|\.key|\.pfx|\.p12)/i;
// Configuração por NOME EXATO (não por regex ampla: config.css e settings.html continuam servidos): settings/config/appsettings(.ambiente).json e `key` (com qualquer extensão).
const SENSITIVE_EXACT = /^(?:(?:settings|config|configuration|appsettings)(?:\.[\w-]+)?\.json|key(?:\.[^.]+)?)$/i;
export function isSensitiveName(name) {
  const n = String(name ?? '');
  return /^package[^/]*\.json$/i.test(n) || /^tsconfig/i.test(n) || SENSITIVE_EXACT.test(n) || SENSITIVE.test(n);
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const BAD_CHARS = /[<>"|?*:\\/%]/; // `%` (resto de %-duplo), `:` (unidade/fluxo NTFS), `\`, `/` (veio de %2f) e os proibidos do Windows

/** Motivo (curto, para testes e depuração) de um segmento DECODIFICADO não poder ser servido, ou null se estiver tudo certo. */
export function segmentProblem(seg) {
  if (typeof seg !== 'string' || seg === '') return 'vazio';
  if (seg === '.' || seg === '..') return 'ponto';
  if (seg.length > MAX_SEGMENT) return 'longo';
  if (seg.startsWith('.')) return 'oculto';
  if (CONTROL.test(seg)) return 'controle';
  if (BAD_CHARS.test(seg)) return 'caractere';
  if (/[. ]$/.test(seg)) return 'final';
  if (/~\d/.test(seg)) return 'nome-curto';
  if (isReservedWindowsName(seg)) return 'reservado';
  if (isGitName(seg)) return 'git';
  if (seg.toLowerCase() === 'node_modules') return 'node_modules';
  if (isSensitiveName(seg)) return 'sensivel';
  return null;
}

/**
 * Passos 1-4 e 6 do contrato sobre o request-target BRUTO (`req.url`): decodifica cada segmento UMA vez (%-duplo fica literal e é recusado depois por `%`),
 * descarta a consulta, recusa segmentos vazios/`.`/`..` e valida cada nome. Devolve { ok:true, segments, dir } (dir = termina em barra ou é a raiz)
 * ou { ok:false, status } (400 só para %-inválido ou alvo que não começa com `/`; o resto é 404 genérico). A extensão (passo 5) é decidida por quem serve.
 */
export function decodeRequestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/')) return { ok: false, status: 400, reason: 'alvo' };
  const cut = target.search(/[?#]/);
  const rawPath = cut === -1 ? target : target.slice(0, cut);
  if (rawPath.length > MAX_PATH * 3) return { ok: false, status: 404, reason: 'longo' }; // %XX triplica o tamanho; o limite real vale no decodificado
  const parts = rawPath.slice(1).split('/');
  const dir = parts.length === 1 && parts[0] === '' ? true : parts[parts.length - 1] === '';
  if (parts[parts.length - 1] === '') parts.pop();
  const segments = [];
  for (const raw of parts) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch { return { ok: false, status: 400, reason: 'decodificação' }; }
    if (segmentProblem(seg)) return { ok: false, status: 404, reason: 'segmento' };
    segments.push(seg);
  }
  if (segments.length > MAX_DEPTH || segments.join('/').length > MAX_PATH) return { ok: false, status: 404, reason: 'limite' };
  return { ok: true, segments, dir };
}

// ---------- raiz servida do workspace ----------
export const DOCROOT_CANDIDATES = Object.freeze(['.', 'site', 'public', 'docs', 'dist', 'www']);
const norm = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p));
export const samePath = (a, b) => norm(a) === norm(b);
/** `child` é o próprio `parent` ou está dentro dele (comparação por caminho já resolvido). */
export const isInside = (child, parent) => { const c = norm(child), p = norm(parent).replace(/[\\/]+$/, ''); return c === p || c.startsWith(p + path.sep) || c.startsWith(p + '/'); };
export const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };

/**
 * Primeira pasta entre `.`, `site`, `public`, `docs`, `dist`, `www` com `index.html` (arquivo regular) DENTRO do realpath do workspace.
 * Pasta ou arquivo que seja link/junção (caminho real diferente do esperado) é recusado. Devolve { rel, real, realWorkspace } ou null (inclusive workspace ausente).
 * `dataReal` (opcional): pasta de dados do FORGE; uma raiz dentro dela é recusada.
 */
export function pickDocroot(workspacePath, { dataReal = null } = {}) {
  const realWorkspace = typeof workspacePath === 'string' && workspacePath ? realOf(workspacePath) : null;
  if (!realWorkspace) return null;
  try { if (!fs.statSync(realWorkspace).isDirectory()) return null; } catch { return null; }
  for (const rel of DOCROOT_CANDIDATES) {
    const abs = rel === '.' ? realWorkspace : path.join(realWorkspace, rel);
    const real = realOf(abs);
    if (!real || !samePath(real, abs) || !isInside(real, realWorkspace)) continue;
    if (dataReal && isInside(real, dataReal)) continue; // a raiz nunca fica dentro da pasta de dados (se a pasta de dados está DENTRO da raiz, os arquivos dela são recusados um a um)
    const idx = path.join(real, 'index.html');
    try {
      const st = fs.lstatSync(idx);
      if (!st.isFile()) continue;
      const ri = realOf(idx);
      if (!ri || !samePath(ri, idx)) continue;
    } catch { continue; }
    return { rel, real, realWorkspace };
  }
  return null;
}
