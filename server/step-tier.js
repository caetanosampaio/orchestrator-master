// Fixação (pin) do nível de modelo de UMA etapa ainda não executada:
//   POST /api/missions/:id/cycle/steps/:stepId/tier   corpo { "tier": "leve" | "padrao" | "profunda" | null }   (null remove o pin)
// É a ÚNICA escrita de `cycle.plan.pins` e passa pelo apiGuard (Host/Origin) e, com token de sessão ativo, pelo tokenGuard, que já cobrem todo método mutante em /api
// (mesmo mecanismo de permission-profile.js: nenhum guard novo). Só o NOME do nível é aceito; modelo e esforço saem da tabela protegida (tiers.js), nunca do corpo.
// O pin vive em `plan.pins`, FORA das definições das etapas: planProblem o valida e ele nunca invalida o plano. Só vale para etapa `queued` (derivada das rodadas);
// uma etapa em execução ou já executada não muda de nível. Escalonamento por retentativa nunca sobe acima de um pin (resolveRoute).
import * as store from './store.js';
import { isTier, TIER_NAMES } from './tiers.js';
import { syncPlan, stepRoute } from './plan.js';

const CLOSED = ['completed', 'cancelled']; // ciclo encerrado: não há mais o que executar
const MAX_ID = 64;

export function setupStepTier(app, { db }) {
  const err = (res, status, error) => res.status(status).json({ error });

  app.post('/api/missions/:id/cycle/steps/:stepId/tier', (req, res) => {
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
    if (!b || !Object.hasOwn(b, 'tier') || (b.tier !== null && !isTier(b.tier))) return err(res, 400, `"tier" deve ser ${TIER_NAMES.join(' | ')} ou null (remove a fixação).`);
    const m = db.missions.find((x) => x.id === req.params.id);
    if (!m) return err(res, 404, 'Missão não encontrada.');
    const c = m.cycle;
    if (!c || typeof c !== 'object') return err(res, 404, 'Esta missão não tem ciclo.');
    const plan = c.plan;
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return err(res, 404, 'O ciclo desta missão não tem plano.');
    const stepId = String(req.params.stepId).slice(0, MAX_ID);
    const step = plan.steps.find((s) => s && typeof s === 'object' && s.id === stepId);
    if (!step) return err(res, 404, 'Etapa não encontrada no plano.');
    if (CLOSED.includes(c.status)) return err(res, 409, 'O ciclo já terminou: o nível da etapa não pode mais ser alterado.');
    if (c.status === 'planning') return err(res, 409, 'O Planner está montando ou refazendo o plano: a fixação se perderia se ele o substituir. Tente de novo quando a etapa estiver na fila.');
    syncPlan(c); // o estado da etapa é DERIVADO das rodadas gravadas (nunca do que a interface acha)
    if (step.status !== 'queued') return err(res, 409, 'Só é possível fixar o nível de uma etapa que ainda não foi executada (estado "queued").');

    const tier = b.tier, hadPins = Object.hasOwn(plan, 'pins'), prevPins = plan.pins;
    const cur = prevPins && typeof prevPins === 'object' && !Array.isArray(prevPins) ? prevPins : {};
    const next = Object.fromEntries(Object.entries(cur).filter(([k]) => k !== stepId));
    if (tier !== null) next[stepId] = tier;
    const same = tier === null ? !Object.hasOwn(cur, stepId) : cur[stepId] === tier;
    if (!same) {
      const prevRoute = step.route;
      try {
        if (Object.keys(next).length) plan.pins = next; else delete plan.pins;
        syncPlan(c); // a rota derivada da etapa reflete o pin
        store.saveOrThrow();
      } catch {
        if (hadPins) plan.pins = prevPins; else delete plan.pins;
        step.route = prevRoute; // desfaz também o derivado em memória
        return err(res, 500, 'Não foi possível gravar o nível da etapa: o banco não pôde ser gravado; nada foi alterado.');
      }
      store.log('cycle', `Nível da etapa "${stepId}" ${tier === null ? 'liberado (volta ao escolhido pelo Planner)' : `fixado em ${tier}`}`, { missionId: m.id });
      try { store.save(); } catch { /* o espelho é informativo: o plano já foi gravado com confirmação */ }
    }
    res.json({ ok: true, stepId, tier, route: stepRoute(plan, step) });
  });
}
