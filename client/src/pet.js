// Bichinho do FORGE (estilo Tamagotchi): lógica PURA (sem React, sem rede). O estado vem do servidor (GET/PUT /api/pet, server/pet.js) e o tempo corre de verdade:
// a fome, a alegria e a energia caem, ele suja o chão e pode ficar doente se ninguém cuidar. Choca de um ovo e cresce (bebê, criança, adulto); a forma adulta depende do cuidado.
// Os PETISCOS são ganhos quando os agentes do FORGE terminam um trabalho ou uma missão (contados no servidor). Testado em server/test/pet.test.mjs.

export const PET_VERSION = 1;
export const MAX_HEARTS = 4, MAX_POOPS = 3, NAME_MAX = 20;
export const STEP_MS = 60_000;                 // o tempo é processado em passos de 1 minuto
export const MAX_CATCH_UP_MS = 7 * 86_400_000; // ausência mais longa que 7 dias conta como 7 dias
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const TIMING = Object.freeze({
  hatch: 45_000,          // o ovo choca 45 s depois de aparecer
  hunger: 2 * HOUR,       // acordado: 1 coração de fome a cada 2 h (ritmo de quem trabalha: um dia longe não o derruba)
  joy: 3 * HOUR,          // 1 de alegria a cada 3 h (doente: o dobro da velocidade)
  energy: 4 * HOUR,       // 1 de energia a cada 4 h acordado
  rest: 30 * MIN,         // dormindo: recupera 1 de energia a cada 30 min
  poop: 4 * HOUR,         // uma sujeira a cada 4 h acordado
  sleepSlow: 4,           // dormindo, fome e alegria caem 4 vezes mais devagar
  dirtySick: 1 * HOUR,    // 3 sujeiras por 1 h = fica doente
  starveSick: 4 * HOUR,   // 4 h com fome zerada = fica doente
  wakeAfter: 2 * HOUR,    // com energia cheia, acorda sozinho depois de 2 h dormindo
  pat: 10 * MIN,          // carinho conta para a alegria no máximo a cada 10 min
  child: 1 * DAY,         // bebê vira criança com 1 dia
  adult: 3 * DAY,         // criança vira adulto com 3 dias
});
export const STAGES = Object.freeze(['egg', 'baby', 'child', 'adult']);
export const FORMS = Object.freeze(['radiante', 'curioso', 'travesso']);
export const STAGE_LABEL = Object.freeze({ egg: 'Ovo', baby: 'Bebê', child: 'Criança', adult: 'Adulto' });
export const FORM_LABEL = Object.freeze({ radiante: 'Radiante', curioso: 'Curioso', travesso: 'Travesso' });

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : d);
const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : null; };
const iso = (t) => new Date(t).toISOString();
const ACC_KEYS = ['hunger', 'joy', 'energy', 'rest', 'poop', 'dirty', 'starve', 'sleep'];

/** Um ovo novinho. */
export function newPet(now = Date.now()) {
  return { v: PET_VERSION, name: '', stage: 'egg', form: null, eggAt: iso(now), bornAt: null, at: iso(now), hunger: MAX_HEARTS, joy: MAX_HEARTS, energy: MAX_HEARTS, poops: 0, sick: false, asleep: false, weight: 5, care: 50, mistakes: 0, games: 0, wins: 0, patAt: null, acc: Object.fromEntries(ACC_KEYS.map((k) => [k, 0])) };
}

/** Nome: até 20 caracteres, sem caracteres de controle. */
export const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, NAME_MAX) : '');

/** Leitura TOLERANTE (servidor antigo, banco editado à mão): campo inválido volta ao padrão; sem estado válido, nasce um ovo. */
export function normalizePet(raw, now = Date.now()) {
  if (!isObj(raw) || raw.v !== PET_VERSION || !STAGES.includes(raw.stage) || ms(raw.eggAt) === null || ms(raw.at) === null) return newPet(now);
  const d = newPet(now), acc = isObj(raw.acc) ? raw.acc : {};
  return {
    v: PET_VERSION, name: cleanName(raw.name), stage: raw.stage, form: raw.stage === 'adult' && FORMS.includes(raw.form) ? raw.form : null,
    eggAt: iso(ms(raw.eggAt)), bornAt: raw.stage === 'egg' ? null : ms(raw.bornAt) !== null ? iso(ms(raw.bornAt)) : iso(ms(raw.eggAt)), at: iso(Math.min(ms(raw.at), now)),
    hunger: int(raw.hunger, 0, MAX_HEARTS, d.hunger), joy: int(raw.joy, 0, MAX_HEARTS, d.joy), energy: int(raw.energy, 0, MAX_HEARTS, d.energy), poops: int(raw.poops, 0, MAX_POOPS, 0),
    sick: raw.sick === true, asleep: raw.asleep === true && raw.stage !== 'egg', weight: int(raw.weight, 1, 99, d.weight), care: int(raw.care, 0, 100, d.care),
    mistakes: int(raw.mistakes, 0, 9999, 0), games: int(raw.games, 0, 99999, 0), wins: int(raw.wins, 0, 99999, 0), patAt: ms(raw.patAt) !== null ? iso(ms(raw.patAt)) : null,
    acc: Object.fromEntries(ACC_KEYS.map((k) => [k, int(acc[k], 0, MAX_CATCH_UP_MS, 0)])),
  };
}

const formFor = (care) => (care >= 65 ? 'radiante' : care >= 35 ? 'curioso' : 'travesso');

/** Um passo de 1 minuto. Muda `p` no lugar (cópia feita por `tick`). */
function step(p, t) {
  const a = p.acc;
  if (p.asleep) {
    a.sleep += STEP_MS; a.rest += STEP_MS;
    if (a.rest >= TIMING.rest) { a.rest -= TIMING.rest; p.energy = Math.min(MAX_HEARTS, p.energy + 1); }
    a.hunger += STEP_MS / TIMING.sleepSlow; a.joy += STEP_MS / TIMING.sleepSlow;
    if (p.energy >= MAX_HEARTS && a.sleep >= TIMING.wakeAfter) { p.asleep = false; a.sleep = 0; a.rest = 0; }
  } else {
    a.hunger += STEP_MS; a.joy += STEP_MS * (p.sick ? 2 : 1); a.energy += STEP_MS; a.poop += STEP_MS;
    if (a.energy >= TIMING.energy) { a.energy -= TIMING.energy; p.energy = Math.max(0, p.energy - 1); }
    if (a.poop >= TIMING.poop) { a.poop -= TIMING.poop; p.poops = Math.min(MAX_POOPS, p.poops + 1); }
  }
  if (a.hunger >= TIMING.hunger) { a.hunger -= TIMING.hunger; if (p.hunger > 0 && --p.hunger === 0) { p.mistakes++; p.care = clamp(p.care - 6, 0, 100); } }
  if (a.joy >= TIMING.joy) { a.joy -= TIMING.joy; if (p.joy > 0 && --p.joy === 0) { p.mistakes++; p.care = clamp(p.care - 6, 0, 100); } }
  // doença: chão sujo ou fome zerada por tempo demais
  a.dirty = p.poops >= MAX_POOPS ? a.dirty + STEP_MS : 0;
  a.starve = p.hunger === 0 ? a.starve + STEP_MS : 0;
  if (!p.sick && (a.dirty >= TIMING.dirtySick || a.starve >= TIMING.starveSick)) { p.sick = true; p.care = clamp(p.care - 8, 0, 100); }
  // crescimento
  const age = t - ms(p.bornAt);
  if (p.stage === 'baby' && age >= TIMING.child) p.stage = 'child';
  if (p.stage === 'child' && age >= TIMING.adult) { p.stage = 'adult'; p.form = formFor(p.care); }
}

/** Faz o tempo correr até `now` (no máximo 7 dias de atraso). Devolve um NOVO estado; `p.at` avança só em passos inteiros. */
export function tick(pet, now = Date.now()) {
  const p = normalizePet(pet, now);
  p.acc = { ...p.acc };
  let t = ms(p.at);
  if (now - t > MAX_CATCH_UP_MS) t = now - MAX_CATCH_UP_MS;
  if (p.stage === 'egg') {
    const hatchAt = ms(p.eggAt) + TIMING.hatch;
    if (now < hatchAt) return p; // ainda chocando: nada corre
    p.stage = 'baby'; p.bornAt = iso(hatchAt); t = Math.max(t, hatchAt);
  }
  while (now - t >= STEP_MS) { t += STEP_MS; step(p, t); }
  p.at = iso(t);
  return p;
}

/**
 * Adianta o relógio do bichinho em `delta` ms (para testar sem esperar): faz o tempo correr até `now + delta` e depois recua todas as datas em `delta`,
 * o que equivale a esse tempo ter passado de verdade.
 */
export function fastForward(pet, delta, now = Date.now()) {
  const d = clamp(Math.round(delta), 0, MAX_CATCH_UP_MS);
  const p = tick(pet, now + d), back = (v) => (ms(v) === null ? v : iso(ms(v) - d));
  return { ...p, eggAt: back(p.eggAt), bornAt: back(p.bornAt), at: back(p.at), patAt: back(p.patAt) };
}

/** Idade em texto curto ("3 h", "2 d"). */
export function ageLabel(pet, now = Date.now()) {
  const b = ms(pet?.bornAt); if (b === null) return 'ainda no ovo';
  const d = Math.max(0, now - b);
  return d < HOUR ? `${Math.max(1, Math.floor(d / MIN))} min` : d < DAY ? `${Math.floor(d / HOUR)} h` : `${Math.floor(d / DAY)} d`;
}

/**
 * Humor exibido, do mais urgente ao mais tranquilo: ovo, dormindo, doente, com fome, sujo, triste, cansado, feliz ou normal.
 * `needs` = o que precisa de você agora (para o aviso de atenção).
 */
export function mood(pet) {
  const p = pet ?? {};
  const needs = [];
  if (p.stage === 'egg') return { id: 'egg', label: 'chocando', needs };
  if (p.sick) needs.push('remedio');
  if (p.hunger <= 1) needs.push('comida');
  if (p.poops >= 2) needs.push('limpeza');
  if (p.joy <= 1) needs.push('brincar');
  if (!p.asleep && p.energy <= 1) needs.push('dormir');
  if (p.asleep) return { id: 'asleep', label: 'dormindo', needs: needs.filter((n) => n !== 'dormir') };
  const id = p.sick ? 'sick' : p.hunger <= 1 ? 'hungry' : p.poops >= 2 ? 'dirty' : p.joy <= 1 ? 'sad' : p.energy <= 1 ? 'tired' : p.hunger >= 3 && p.joy >= 3 ? 'happy' : 'ok';
  const label = { sick: 'doente', hungry: 'com fome', dirty: 'incomodado com a sujeira', sad: 'triste', tired: 'com sono', happy: 'feliz', ok: 'tranquilo' }[id];
  return { id, label, needs };
}

/** Fala curta do bichinho (balão), pelo humor. */
export function speech(pet) {
  const m = mood(pet);
  return ({ egg: 'Toc, toc… tem alguém aqui dentro.', asleep: 'Zzz…', sick: 'Tô dodói… tem remédio?', hungry: 'Tô com fome!', dirty: 'Eca, limpa aqui?', sad: 'Brinca comigo?', tired: 'Tô com soninho…', happy: 'Que dia bom!', ok: 'Tudo certo por aqui.' })[m.id];
}

const done = (pet, effect, extra = {}) => ({ pet, effect, ok: true, ...extra });
const refuse = (pet, message) => ({ pet, effect: 'no', ok: false, message });
const awake = (p) => (p.stage === 'egg' ? 'Ele ainda está no ovo.' : p.asleep ? 'Ele está dormindo. Acenda a luz primeiro.' : null);

/** Refeição: +1 de fome. Cheio = recusa (e engorda um pouco, como no original). */
export function feedMeal(pet) {
  const why = awake(pet); if (why) return refuse(pet, why);
  if (pet.sick) return refuse(pet, 'Doente, ele não quer comer. Dê o remédio.');
  if (pet.hunger >= MAX_HEARTS) return refuse({ ...pet, weight: Math.min(99, pet.weight + 1) }, 'Ele está cheio!');
  return done({ ...pet, hunger: pet.hunger + 1, weight: Math.min(99, pet.weight + 1), care: clamp(pet.care + (pet.hunger <= 1 ? 3 : 1), 0, 100) }, 'eat');
}
/** Petisco (gasto no servidor antes): +2 de alegria e +2 de peso. */
export function feedTreat(pet) {
  const why = awake(pet); if (why) return refuse(pet, why);
  if (pet.sick) return refuse(pet, 'Doente, ele não quer petisco. Dê o remédio.');
  return done({ ...pet, joy: Math.min(MAX_HEARTS, pet.joy + 2), weight: Math.min(99, pet.weight + 2), care: clamp(pet.care + 1, 0, 100) }, 'treat');
}
/** Limpar o chão. */
export function clean(pet) {
  if (pet.stage === 'egg') return refuse(pet, 'Não há nada para limpar.');
  if (!pet.poops) return refuse(pet, 'Está tudo limpo.');
  return done({ ...pet, poops: 0, acc: { ...pet.acc, dirty: 0 }, care: clamp(pet.care + 2, 0, 100) }, 'clean');
}
/** Remédio: cura a doença. Sem doença, recusa. */
export function medicine(pet) {
  if (pet.stage === 'egg') return refuse(pet, 'Ele ainda está no ovo.');
  if (!pet.sick) return refuse(pet, 'Ele não está doente.');
  return done({ ...pet, sick: false, acc: { ...pet.acc, dirty: 0, starve: 0 }, care: clamp(pet.care + 2, 0, 100) }, 'heal');
}
/** Apagar/acender a luz: dormir ou acordar. */
export function toggleLight(pet) {
  if (pet.stage === 'egg') return refuse(pet, 'Ele ainda está no ovo.');
  return done({ ...pet, asleep: !pet.asleep, acc: { ...pet.acc, sleep: 0, rest: 0 }, care: clamp(pet.care + (!pet.asleep && pet.energy <= 1 ? 3 : 0), 0, 100) }, pet.asleep ? 'wake' : 'sleep');
}
/** Carinho (clique no bichinho): +1 de alegria no máximo a cada 10 min; fora disso ele só reage. */
export function pat(pet, now = Date.now()) {
  if (pet.stage === 'egg') return done(pet, 'wobble');
  if (pet.asleep) return refuse(pet, 'Shh… ele está dormindo.');
  const last = ms(pet.patAt);
  if (last !== null && now - last < TIMING.pat) return done(pet, 'giggle');
  return done({ ...pet, joy: Math.min(MAX_HEARTS, pet.joy + 1), patAt: iso(now) }, 'love');
}
/** Renomear. */
export const rename = (pet, name) => ({ ...pet, name: cleanName(name) });

// ---------- o joguinho: "Para que lado?" (como no original). 5 rodadas; ele olha para um lado e você tenta adivinhar ----------
export const GAME_ROUNDS = 5, GAME_WIN = 3;
export const newGame = () => ({ round: 0, hits: 0, last: null, over: false });
/** Uma rodada. `guess` e `actual`: 'left' | 'right'. */
export function playRound(game, guess, actual) {
  if (game.over) return game;
  const hit = guess === actual, round = game.round + 1;
  return { round, hits: game.hits + (hit ? 1 : 0), last: { guess, actual, hit }, over: round >= GAME_ROUNDS };
}
/** Fim do jogo: ganhou (3+ acertos) = +1 de alegria e -1 de peso; perdeu = só conta o jogo. Gasta um pouco de energia. */
export function finishGame(pet, game) {
  const why = awake(pet); if (why) return refuse(pet, why);
  const won = game.hits >= GAME_WIN;
  return done({ ...pet, games: pet.games + 1, wins: pet.wins + (won ? 1 : 0), joy: Math.min(MAX_HEARTS, pet.joy + (won ? 1 : 0)), weight: Math.max(1, pet.weight - (won ? 1 : 0)), care: clamp(pet.care + (won ? 1 : 0), 0, 100) }, won ? 'win' : 'lose', { won });
}
export function canPlay(pet) {
  const why = awake(pet); if (why) return { ok: false, message: why };
  if (pet.sick) return { ok: false, message: 'Doente, ele não quer brincar. Dê o remédio.' };
  if (pet.energy <= 0) return { ok: false, message: 'Ele está exausto. Apague a luz para ele dormir.' };
  return { ok: true, message: '' };
}

/** Chave estável de um fim de trabalho (petisco deduplicado no servidor). Só caracteres seguros, até 80. */
export const treatKey = (kind, id, at) => `${kind}:${id}:${at}`.replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 80);
