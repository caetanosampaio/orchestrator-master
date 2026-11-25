// Provedor Antigravity CLI (`agy`, do Google; sucessora do Gemini CLI para contas pessoais desde 18/06/2026). NÍVEL 1 (só terminal).
// Conferido contra a documentação oficial (antigravity.google/docs/cli, nov/2026), NÃO contra a CLI instalada:
//   - modos: `--mode=plan` (só ferramentas de leitura: o planejador do terminal), `--dangerously-skip-permissions` (acesso total); sem eles, o modo padrão pede aprovação;
//   - MCP só por arquivo (~/.gemini/config/mcp_config.json ou .agents/mcp_config.json do projeto) e nenhuma forma documentada de passar instruções extras: sem coordenação.
import { cliProvider } from './cli-path.js';

export const antigravityProvider = cliProvider({
  id: 'antigravity', label: 'Antigravity CLI', names: ['agy'],
  install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
  capabilities: { readOnly: true },
  projectDirs: ['.agents'], // mcp_config.json do workspace (e as regras e skills do Antigravity)
  paneArgs: ({ fullAccess, readOnly }) => (readOnly ? ['--mode=plan'] : fullAccess ? ['--dangerously-skip-permissions'] : []),
});
