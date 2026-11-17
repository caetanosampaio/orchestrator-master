// Consumo da máquina para a barra de menus (macOS) e a área de notificação (Windows/Linux): CPU, RAM e GPU.
// Regra de honestidade: sem leitura confiável = null (a interface mostra "—"), nunca um número inventado. As leituras externas (ioreg, nvidia-smi)
// rodam com execFile (sem shell), com tempo-limite curto, e falha vira null. As funções de PARSE são puras e testadas em server/test/desktop-tray.test.mjs.
const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

/** CPU total entre duas amostras de os.cpus(): 0..100 (arredondado) ou null. */
function cpuPercent(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length || !prev.length) return null;
  let idle = 0, total = 0;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]?.times, b = next[i]?.times; if (!a || !b) return null;
    const t = (k) => (b[k] ?? 0) - (a[k] ?? 0);
    const sum = t('user') + t('nice') + t('sys') + t('idle') + t('irq');
    idle += t('idle'); total += sum;
  }
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : null;
}

/** RAM em uso (0..100). No macOS o "livre" do sistema ignora o cache: quem chama passa `available` (Electron: process.getSystemMemoryInfo) quando existe. */
function ramPercent({ total, free, available = null }) {
  const t = Number(total), f = Number(available ?? free);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(f) || f < 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - f / t) * 100)));
}

/** macOS: `ioreg -r -d 1 -w 0 -c IOAccelerator` traz "Device Utilization %"=NN por GPU; vale a maior. */
function parseIoreg(text) {
  const vals = [...String(text ?? '').matchAll(/"Device Utilization %"\s*=\s*(\d{1,3})/g)].map((m) => Number(m[1])).filter((n) => n >= 0 && n <= 100);
  return vals.length ? Math.max(...vals) : null;
}
/** `nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits`: um número por linha (uma GPU por linha); vale a maior. */
function parseNvidiaSmi(text) {
  const vals = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}$/.test(l)).map(Number).filter((n) => n <= 100);
  return vals.length ? Math.max(...vals) : null;
}
/** Linux (AMD/Intel com amdgpu): /sys/class/drm/cardN/device/gpu_busy_percent. */
function parseBusyPercent(text) { const n = Number(String(text ?? '').trim()); return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null; }

const run = (cmd, args, timeout = 2500) => new Promise((resolve) => {
  try { execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out))); } catch { resolve(null); }
});

/** Leitura da GPU no sistema atual (assíncrona, melhor esforço). */
async function readGpu(platform = process.platform) {
  if (platform === 'darwin') return parseIoreg(await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']));
  const nv = parseNvidiaSmi(await run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits']));
  if (nv !== null || platform !== 'linux') return nv;
  try { for (const d of fs.readdirSync('/sys/class/drm')) { if (!/^card\d+$/.test(d)) continue; const v = parseBusyPercent(fs.readFileSync(`/sys/class/drm/${d}/device/gpu_busy_percent`, 'utf8')); if (v !== null) return v; } } catch { /* sem sysfs */ }
  return null;
}

/** Amostrador: chama `onSample({ cpu, ram, gpu })` a cada `intervalMs` (a GPU, mais cara, a cada `gpuEvery` amostras). Devolve stop(). */
function createSampler({ intervalMs = 2000, gpuEvery = 3, memInfo = null, onSample }) {
  let prev = os.cpus(), n = 0, gpu = null, stopped = false;
  const tick = async () => {
    if (stopped) return;
    const next = os.cpus(), cpu = cpuPercent(prev, next); prev = next;
    let available = null; try { const m = memInfo?.(); if (m && Number.isFinite(m.free)) available = (m.free + (m.fileBacked ?? 0) + (m.purgeable ?? 0)) * 1024; } catch { /* sem a API */ }
    const ram = ramPercent({ total: os.totalmem(), free: os.freemem(), available });
    if (n++ % gpuEvery === 0) gpu = await readGpu();
    if (!stopped) onSample({ cpu, ram, gpu });
  };
  const t = setInterval(tick, intervalMs); t.unref?.(); tick();
  return () => { stopped = true; clearInterval(t); };
}

/** "CPU 23% · RAM 61% · GPU —": a linha de consumo do menu. */
const metricsLine = ({ cpu, ram, gpu } = {}) => [['CPU', cpu], ['RAM', ram], ['GPU', gpu]].map(([k, v]) => `${k} ${Number.isFinite(v) ? `${v}%` : '—'}`).join(' · ');

module.exports = { cpuPercent, ramPercent, parseIoreg, parseNvidiaSmi, parseBusyPercent, readGpu, createSampler, metricsLine };
