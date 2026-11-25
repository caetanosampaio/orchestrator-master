// Provedor Kiro CLI (`kiro-cli`, da AWS). NÍVEL 1 (só terminal).
// Conferido contra a documentação oficial (kiro.dev/docs/cli e /docs/reference/cli-commands, nov/2026), NÃO contra a CLI instalada:
//   - `kiro-cli chat` abre a conversa; `--trust-all-tools` aprova todas as ferramentas (acesso total). Sem modo somente leitura documentado: não abre o planejador;
//   - MCP só por arquivo (~/.kiro/settings/mcp.json ou .kiro/settings/mcp.json) ou por agente gravado: sem coordenação.
import { cliProvider } from './cli-path.js';

export const kiroProvider = cliProvider({
  id: 'kiro', label: 'Kiro CLI', names: ['kiro-cli'],
  install: 'curl -fsSL https://cli.kiro.dev/install | bash',
  projectDirs: ['.kiro'],
  paneArgs: ({ fullAccess }) => ['chat', ...(fullAccess ? ['--trust-all-tools'] : [])],
});
