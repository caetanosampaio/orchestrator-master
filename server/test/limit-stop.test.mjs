// Reconhecimento da parada por limite de uso da conta no fim do terminal (server/limit-stop.js). Puro: sem processos, banco nem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLimitStop, LIMIT_WINDOW, MAX_RESETS } from '../limit-stop.js';

const AUTO = 'Relatório automático (sem report_done), fim do terminal: ';

test('mensagens de parada do Claude Code e do Codex são reconhecidas, com o horário de reset quando houver', () => {
  const cases = [
    ["⎿ You've hit your limit · resets 3pm (America/Sao_Paulo) > ? for shortcuts", '3pm (America/Sao_Paulo)'],
    ['● 5-hour limit reached ∙ resets 7pm /upgrade to increase your usage limit.', '7pm'],
    ['Weekly limit reached ∙ resets Oct 9, 10am', 'Oct 9, 10am'],
    ['Opus weekly limit reached ∙ resets Mon 2pm', 'Mon 2pm'],
    ['Claude AI usage limit reached|1754000000', null],
    ["■ You've hit your usage limit. Upgrade to Pro or try again at 3:05 PM.", '3:05 PM'],
    ["You've reached your usage limit. Try again in 2 hours.", '2 hours'],
    ['Session limit reached · resets 11:30pm', '11:30pm'],
  ];
  for (const [text, resets] of cases) assert.deepEqual(detectLimitStop(AUTO + text), { resets }, text);
});

test('avisos, texto comum e código NÃO são parada por limite', () => {
  for (const text of [
    'Approaching usage limit · resets at 3pm', 'Approaching 5-hour limit', 'Feito: criei server/flow-verify.js (validateVerifyCommand + testes).',
    "cycle.status = 'limit_reached'; // limite de rodadas", 'Limite de 8 rodadas atingido.', 'rate limit da API configurado em 60/min', '', null, undefined, 42,
  ]) assert.equal(detectLimitStop(text), null, String(text));
});

test('só o FIM conta: a mensagem citada bem antes e seguida de muito trabalho não vale', () => {
  const old = "You've hit your limit · resets 3pm " + 'x'.repeat(LIMIT_WINDOW + 50);
  assert.equal(detectLimitStop(old), null);
  assert.deepEqual(detectLimitStop('x'.repeat(5000) + " You've hit your limit · resets 3pm"), { resets: '3pm' });
});

test('saída crua do terminal: códigos ANSI e controles não atrapalham; o reset é curto e só com caracteres seguros', () => {
  assert.deepEqual(detectLimitStop("\x1b[31mYou've hit your limit\x1b[0m \x1b[2m· resets 3pm\x1b[0m\r\n"), { resets: '3pm' });
  const r = detectLimitStop("You've hit your limit · resets <script>alert(1)</script> amanhã"); assert.ok(r); assert.ok(!/[<>]/.test(r.resets ?? ''), r.resets);
  const u = detectLimitStop("You've hit your limit · resets 3pm‮ (Ｐａｒｉｓ) amanhã"); assert.ok(/^[\x20-\x7e]*$/.test(u.resets ?? ''), `só ASCII imprimível: ${u.resets}`);
  const long = detectLimitStop(`You've hit your limit · resets ${'9'.repeat(200)}`); assert.ok(long.resets.length <= MAX_RESETS);
  assert.deepEqual(detectLimitStop("You've hit your limit · resets 3pm (America/Sao_Pau"), { resets: '3pm' }, 'parêntese cortado sai');
});
