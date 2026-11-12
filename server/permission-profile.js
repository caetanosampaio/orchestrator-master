// Rotas do perfil de permissão do Executor por workspace (exec-profile.js):
//   GET /api/workspaces/:id/permission-profile   estado atual, aviso vigente, lista pré-aprovada e auditoria (aberto: nada sensível)
//   PUT /api/workspaces/:id/permission-profile   ÚNICA escrita de `ws.permissionProfile`; passa pelo apiGuard e (com token) pelo tokenGuard, que já cobrem todo método mutante.
// O campo NUNCA vem de POST /api/workspaces, do Planner, do Maestro/MCP nem do chat: este módulo não é exposto a nenhum deles.
// Ligar o bypass exige `confirm:true` e a versão vigente do aviso; sem token de sessão ativo exige também `acknowledgeNoToken:true` (e a auditoria registra `tokenGuarded:false`):
// sem o token, um processo local (inclusive o agente) consegue forjar a chamada, e o usuário decidiu permitir isso com aviso explícito. Desligar é sempre permitido.
import * as store from './store.js';
import { profileOf, PROFILES, DEFAULT_ALLOW, WARNING } from './exec-profile.js';

export const MAX_AUDIT = 500;
const VIEW_AUDIT = 20;
const ACTIVE_CYCLE = ['planning', 'running'];

/** Há ciclo ativo ou tarefa rodando neste workspace? (mesmo critério de PUT /verifications, mais a tarefa em execução). */
export const profileChangeBlocker = (db, workspaceId) => (db.missions.some((m) => m.workspaceId === workspaceId && ((m.cycle && ACTIVE_CYCLE.includes(m.cycle.status)) || m.tasks.some((t) => t.status === 'running'))) ? 'active_cycle' : null);

// Só os campos conhecidos, com tipo checado: o que está no disco nunca vaza texto livre para a resposta.
const publicEntry = (e) => ({ id: String(e.id), at: String(e.at), workspaceId: String(e.workspaceId), workspaceName: String(e.workspaceName ?? ''), from: e.from, to: e.to, by: 'user', tokenGuarded: e.tokenGuarded === true, warningVersion: e.warningVersion });
const wellFormed = (e) => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.at === 'string' && typeof e.workspaceId === 'string' && PROFILES.includes(e.from) && PROFILES.includes(e.to);

export function setupPermissionProfile(app, { db, tokenActive = false }) {
  const find = (id) => db.workspaces.find((w) => w.id === id);
  const err = (res, status, code, error) => res.status(status).json({ error, code });

  function view(ws) {
    const blocked = profileChangeBlocker(db, ws.id);
    const audit = (Array.isArray(db.permissionAudit) ? db.permissionAudit : []).filter((e) => wellFormed(e) && e.workspaceId === ws.id).slice(-VIEW_AUDIT).reverse().map(publicEntry); // mais recente primeiro
    return {
      profile: profileOf(ws),
      since: typeof ws.permissionProfileAt === 'string' ? ws.permissionProfileAt : null,
      defaultAllow: [...DEFAULT_ALLOW],
      warning: { version: WARNING.version, text: WARNING.text, noTokenText: WARNING.noTokenText },
      tokenProtected: !!tokenActive,
      canEnable: !blocked,
      ...(blocked ? { reason: blocked } : {}),
      audit,
    };
  }

  app.get('/api/workspaces/:id/permission-profile', (req, res) => {
    const ws = find(req.params.id);
    if (!ws) return err(res, 404, 'workspace_not_found', 'Workspace não encontrado.');
    res.json(view(ws));
  });

  app.put('/api/workspaces/:id/permission-profile', (req, res) => {
    const ws = find(req.params.id);
    if (!ws) return err(res, 404, 'workspace_not_found', 'Workspace não encontrado.');
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const to = b.profile;
    if (typeof to !== 'string' || !PROFILES.includes(to)) return err(res, 400, 'invalid_profile', `"profile" deve ser ${PROFILES.join(' ou ')}.`);
    const enabling = to === 'bypass';
    // Desligar (voltar ao padrão) é o sentido seguro: não exige confirmação. Ligar exige tudo abaixo.
    if (enabling) {
      if (b.confirm !== true) return err(res, 400, 'confirm_required', 'É preciso confirmar (confirm: true) que você entendeu os riscos.');
      if (b.warningVersion !== WARNING.version) return err(res, 400, 'warning_version', 'A versão do aviso mudou ou não foi informada; leia o aviso atual e confirme de novo.');
      if (!tokenActive && b.acknowledgeNoToken !== true) return err(res, 400, 'no_token_ack_required', 'Sem o token de sessão do aplicativo não há proteção real contra o agente ligar o próprio bypass; confirme com acknowledgeNoToken: true se aceita esse risco.');
    }
    const from = profileOf(ws);
    if (from === to) return res.json(view(ws)); // sem mudança: nada a gravar nem a auditar
    if (enabling && profileChangeBlocker(db, ws.id)) return err(res, 409, 'active_cycle', 'Há um ciclo ou uma execução ativa neste workspace; aguarde ou cancele antes de ligar o modo sem confirmação.');

    const at = store.now();
    const entry = { id: store.uid('pa'), at, workspaceId: ws.id, workspaceName: String(ws.displayName || ws.name || '').slice(0, 80), from, to, by: 'user', tokenGuarded: !!tokenActive, warningVersion: WARNING.version };
    const had = { profile: Object.hasOwn(ws, 'permissionProfile'), profileV: ws.permissionProfile, at: Object.hasOwn(ws, 'permissionProfileAt'), atV: ws.permissionProfileAt, audit: db.permissionAudit };
    try {
      ws.permissionProfile = to; ws.permissionProfileAt = at;
      db.permissionAudit = [...(Array.isArray(had.audit) ? had.audit : []), entry].slice(-MAX_AUDIT);
      store.saveOrThrow();
    } catch {
      if (had.profile) ws.permissionProfile = had.profileV; else delete ws.permissionProfile;
      if (had.at) ws.permissionProfileAt = had.atV; else delete ws.permissionProfileAt;
      if (had.audit === undefined) delete db.permissionAudit; else db.permissionAudit = had.audit;
      return err(res, 500, 'persistence_failed', 'Não foi possível gravar o perfil de permissão: o banco não pôde ser gravado; nada foi alterado.');
    }
    store.log('workspace', `Perfil de permissão do Executor em "${entry.workspaceName}": ${from} -> ${to}${tokenActive ? '' : ' (sem token de sessão)'}`, { workspaceId: ws.id }); // espelho informativo; a trilha durável é db.permissionAudit
    try { store.save(); } catch { /* o espelho é informativo: o estado e a auditoria já foram gravados */ }
    const out = view(ws);
    if (!enabling && profileChangeBlocker(db, ws.id)) out.notice = 'Uma execução em andamento neste workspace não é interrompida: ela termina com o perfil com que começou.';
    res.json(out);
  });
  return { view };
}
