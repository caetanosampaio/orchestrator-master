// Golem de liga (Configurações > Golem): o golem cresce com os tokens de todas as IAs (calculado no cliente a partir de GET /api/provider-activity) e
// aqui só se guarda o que é do usuário: o NOME e a última fase que ele já viu (`seenStage`), para a animação de evolução tocar uma vez só, mesmo trocando de navegador
// ou de porta do app. Validação estrita; falha ao gravar desfaz (padrão saveOrThrow + rollback).
import * as store from './store.js';

export const NAME_MAX = 20, MAX_STAGE = 6;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** Leitura tolerante de db.golem: { name, seenStage (0..6 ou null) }. */
export function readGolem(db) {
  const r = isObj(db.golem) ? db.golem : {};
  return {
    name: typeof r.name === 'string' && r.name.length <= NAME_MAX && !CONTROL.test(r.name) ? r.name : '',
    seenStage: Number.isInteger(r.seenStage) && r.seenStage >= 0 && r.seenStage <= MAX_STAGE ? r.seenStage : null,
  };
}

/** Corpo do PUT (parcial): { name?, seenStage? }. Devolve { patch } ou { error }; nada é corrigido em silêncio. */
export function validateGolemPatch(b) {
  if (!isObj(b)) return { error: 'O corpo deve ser um objeto.' };
  const extra = Object.keys(b).filter((k) => k !== 'name' && k !== 'seenStage');
  if (extra.length) return { error: `Propriedades não permitidas: ${extra.join(', ')}.` };
  const patch = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || CONTROL.test(b.name) || b.name.trim().length > NAME_MAX) return { error: `O nome deve ter até ${NAME_MAX} caracteres, sem caracteres de controle.` };
    patch.name = b.name.trim();
  }
  if (b.seenStage !== undefined) {
    if (!Number.isInteger(b.seenStage) || b.seenStage < 0 || b.seenStage > MAX_STAGE) return { error: `seenStage deve ser um inteiro de 0 a ${MAX_STAGE}.` };
    patch.seenStage = b.seenStage;
  }
  return { patch };
}

/** GET /api/golem e PUT /api/golem { name?, seenStage? }. */
export function setupGolem(app, { db, save = store.saveOrThrow } = {}) {
  app.get('/api/golem', (req, res) => res.set('Cache-Control', 'no-store').json(readGolem(db)));
  app.put('/api/golem', (req, res) => {
    const v = validateGolemPatch(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const had = Object.hasOwn(db, 'golem'), prev = db.golem;
    db.golem = { ...readGolem(db), ...v.patch };
    try { save(); } catch {
      if (had) db.golem = prev; else delete db.golem;
      return res.status(500).json({ error: 'Não foi possível gravar o golem: o banco não pôde ser gravado; nada foi alterado.' });
    }
    return res.json(readGolem(db));
  });
}
