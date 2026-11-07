// Política de reinício do servidor após queda inesperada. Módulo puro, com relógio injetável.
// Permite no máximo `max` reinícios dentro de `windowMs`; acima disso desiste (o chamador mostra o erro e sai).
function createRestartPolicy({ max = 3, windowMs = 120000, now = Date.now } = {}) {
  let stamps = [];
  return {
    /** Registra uma queda e responde se deve reiniciar. `count` = reinícios dentro da janela (incluindo este). */
    decide() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) return { restart: false, count: stamps.length };
      stamps.push(t);
      return { restart: true, count: stamps.length };
    },
    reset() { stamps = []; },
  };
}

/**
 * Depois que o reinício do servidor falha com uma exceção: o app deve avisar (fail) ou deixar o handler de saída do filho decidir?
 * - encerramento pedido pelo usuário: nunca avisa;
 * - falhou ANTES de existir um filho (startServer lançou): ninguém mais decidirá nada, então avisa;
 * - o filho nasceu: se ainda está vivo (ex.: não ficou pronto a tempo) avisa; se já saiu, o handler de saída dele decide (reinicia ou desiste).
 */
function shouldFailRestart({ quitting = false, started = false, hasChild = false } = {}) {
  if (quitting) return false;
  return !started || hasChild;
}

module.exports = { createRestartPolicy, shouldFailRestart };
