// Bichinho do FORGE (estilo Tamagotchi): guarda o estado em db.pet. A mecânica (tempo, fome, crescimento) mora no cliente (client/src/pet.js); aqui só se guarda e se confere o FORMATO,
// para um corpo malformado nunca entrar no banco. Os PETISCOS são um saldo à parte, que só o servidor muda: +1 por fim de trabalho de agente ou missão concluída (chave deduplicada,
// para duas abas ou um recarregamento não contarem o mesmo fim duas vezes) e -1 quando o bichinho come um. Falha ao gravar desfaz (padrão saveOrThrow + rollback).
import * as store from './store.js';

export const PET_VERSION = 1;
export const MAX_TREATS = 99, MAX_TREAT_KEYS = 300, NAME_MAX = 20;
const STAGES = ['egg', 'baby', 'child', 'adult'], FORMS = ['radiante', 'curioso', 'travesso'];
const ACC_KEYS = ['hunger', 'joy', 'energy', 'rest', 'poop', 'dirty', 'starve', 'sleep'];
const STATE_KEYS = ['v', 'name', 'stage', 'form', 'eggAt', 'bornAt', 'at', 'hunger', 'joy', 'energy', 'poops', 'sick', 'asleep', 'weight', 'care', 'mistakes', 'games', 'wins', 'patAt', 'acc'];
const MAX_ACC = 7 * 86_400_000;
const KEY_RE = /^[A-Za-z0-9:._-]{1,80}$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isIso = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

/** Confere o estado enviado pelo cliente (PUT /api/pet). Devolve { state } ou { error }. Propriedade desconhecida ou fora do tipo é recusada, nunca corrigida. */
export function validatePetState(s) {
  if (!isObj(s)) return { error: 'O estado do bichinho deve ser um objeto.' };
  const extra = Object.keys(s).filter((k) => !STATE_KEYS.includes(k));
  if (extra.length) return { error: `Propriedades não permitidas: ${extra.join(', ')}.` };
  if (s.v !== PET_VERSION) return { error: 'Versão do bichinho desconhecida.' };
  if (typeof s.name !== 'string' || s.name.length > NAME_MAX || CONTROL.test(s.name)) return { error: `O nome deve ter até ${NAME_MAX} caracteres, sem caracteres de controle.` };
  if (!STAGES.includes(s.stage)) return { error: 'Fase inválida.' };
  if (!(s.form === null || (s.stage === 'adult' && FORMS.includes(s.form)))) return { error: 'Forma inválida.' };
  if (!isIso(s.eggAt) || !isIso(s.at)) return { error: 'Datas inválidas.' };
  if (!(s.stage === 'egg' ? s.bornAt === null : isIso(s.bornAt))) return { error: 'Data de nascimento inválida.' };
  if (!(s.patAt === null || isIso(s.patAt))) return { error: 'Data do carinho inválida.' };
  for (const k of ['hunger', 'joy', 'energy']) if (!isInt(s[k], 0, 4)) return { error: `${k} deve ser um inteiro de 0 a 4.` };
  if (!isInt(s.poops, 0, 3)) return { error: 'poops deve ser um inteiro de 0 a 3.' };
  if (!isInt(s.weight, 1, 99) || !isInt(s.care, 0, 100)) return { error: 'Peso ou cuidado fora da faixa.' };
  for (const k of ['mistakes', 'games', 'wins']) if (!isInt(s[k], 0, 99999)) return { error: `${k} fora da faixa.` };
  if (typeof s.sick !== 'boolean' || typeof s.asleep !== 'boolean') return { error: 'sick e asleep devem ser verdadeiro ou falso.' };
  if (!isObj(s.acc) || Object.keys(s.acc).some((k) => !ACC_KEYS.includes(k)) || ACC_KEYS.some((k) => typeof s.acc[k] !== 'number' || !Number.isFinite(s.acc[k]) || s.acc[k] < 0 || s.acc[k] > MAX_ACC)) return { error: 'Contadores de tempo inválidos.' };
  const state = { ...s, acc: Object.fromEntries(ACC_KEYS.map((k) => [k, Math.round(s.acc[k])])) };
  return { state };
}

/** Leitura tolerante: { state: objeto|null, treats, keys }. Banco antigo ou editado à mão nunca derruba nada (estado inválido vira null: o cliente choca um ovo novo). */
export function readPet(db) {
  const r = isObj(db.pet) ? db.pet : {};
  const state = isObj(r.state) && !validatePetState(r.state).error ? r.state : null;
  return { state, treats: isInt(r.treats, 0, MAX_TREATS) ? r.treats : 0, keys: Array.isArray(r.treatKeys) ? r.treatKeys.filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(-MAX_TREAT_KEYS) : [] };
}

/** GET /api/pet, PUT /api/pet { state }, POST /api/pet/treats { key } (ganha) e POST /api/pet/treats/use (gasta). */
export function setupPet(app, { db, save = store.saveOrThrow } = {}) {
  const bad = (res, error, status = 400, code) => res.status(status).json({ error, ...(code ? { code } : {}) });
  const view = () => { const p = readPet(db); return { state: p.state, treats: p.treats }; };
  /** Aplica `next` (o db.pet inteiro) e grava; falha desfaz. */
  const commit = (res, next) => {
    const had = Object.hasOwn(db, 'pet'), prev = db.pet;
    db.pet = next;
    try { save(); } catch { if (had) db.pet = prev; else delete db.pet; bad(res, 'Não foi possível gravar o bichinho: o banco não pôde ser gravado; nada foi alterado.', 500); return false; }
    return true;
  };
  const body = (req) => (isObj(req.body) ? req.body : {});

  app.get('/api/pet', (req, res) => res.set('Cache-Control', 'no-store').json(view()));
  app.put('/api/pet', (req, res) => {
    const b = body(req), extra = Object.keys(b).filter((k) => k !== 'state');
    if (extra.length) return bad(res, `Propriedades não permitidas: ${extra.join(', ')}.`);
    const v = validatePetState(b.state); if (v.error) return bad(res, v.error);
    const cur = readPet(db);
    if (commit(res, { state: v.state, treats: cur.treats, treatKeys: cur.keys })) res.json(view());
  });
  app.post('/api/pet/treats', (req, res) => {
    const key = body(req).key;
    if (typeof key !== 'string' || !KEY_RE.test(key)) return bad(res, 'key deve ter de 1 a 80 caracteres (letras, números, : . _ -).');
    const cur = readPet(db);
    if (cur.keys.includes(key)) return res.json({ ...view(), added: false }); // o mesmo fim já contou (outra aba, recarregamento)
    const treats = Math.min(MAX_TREATS, cur.treats + 1);
    if (commit(res, { state: cur.state, treats, treatKeys: [...cur.keys, key].slice(-MAX_TREAT_KEYS) })) res.json({ ...view(), added: treats > cur.treats });
  });
  app.post('/api/pet/treats/use', (req, res) => {
    const cur = readPet(db);
    if (cur.treats <= 0) return bad(res, 'Sem petiscos: eles vêm quando os seus agentes terminam um trabalho ou uma missão.', 409, 'no_treats');
    if (commit(res, { state: cur.state, treats: cur.treats - 1, treatKeys: cur.keys })) res.json(view());
  });
}
