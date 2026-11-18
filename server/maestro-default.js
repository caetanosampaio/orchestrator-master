// Padrão do Maestro autônomo (que também liga o acesso total dos terminais novos), decidido no boot. PURO: só lê e ajusta o `db` recebido; quem chama grava.
//   - escolha gravada (true/false): sempre vence;
//   - sem escolha gravada e instalação JÁ USADA (tem workspace, sessão de terminal ou setup concluído): continua LIGADO, como era antes, e a decisão é gravada de forma explícita (changed = true);
//   - sem escolha gravada e instalação NOVA: DESLIGADO, também gravado de forma explícita (senão, depois do setup, o próximo boot veria uma instalação "já usada" e ligaria). O usuário liga pelas Configurações, com a confirmação de sempre.

/** A instalação já foi usada? (mesma ideia do setup animado em ui-settings.js: quem já tem workspace não é "primeiro uso"). */
export function isUsedInstall(db) {
  return (db?.workspaces ?? []).length > 0 || (db?.terminalSessions ?? []).length > 0 || db?.settings?.ui?.setupDone === true;
}

/** Devolve { autonomous, changed }. Quando `changed`, o `db` foi alterado (settings.maestro.autonomous = true) e precisa ser gravado. */
export function resolveAutonomous(db) {
  if (!db || typeof db !== 'object') return { autonomous: false, changed: false };
  const saved = db.settings?.maestro?.autonomous;
  if (saved === true || saved === false) return { autonomous: saved, changed: false };
  if (isUsedInstall(db)) {
    db.settings ??= {};
    db.settings.maestro = { ...(db.settings.maestro && typeof db.settings.maestro === 'object' ? db.settings.maestro : {}), autonomous: true };
    return { autonomous: true, changed: true };
  }
  db.settings ??= {};
  db.settings.maestro = { ...(db.settings.maestro && typeof db.settings.maestro === 'object' ? db.settings.maestro : {}), autonomous: false };
  return { autonomous: false, changed: true };
}
