// Provedor Grok Build (`grok`, da xAI; repositório oficial xai-org/grok-build). NÍVEL 1 (só terminal).
// Conferido contra a documentação oficial (docs.x.ai/build, nov/2026), NÃO contra a CLI instalada:
//   - `--always-approve` aprova tudo (acesso total). Sem modo somente leitura documentado: não abre o planejador;
//   - MCP só por arquivo (~/.grok/config.toml ou .grok/config.toml; ele também lê .mcp.json e .cursor/mcp.json): sem coordenação.
//   - ATENÇÃO: existem CLIs da comunidade que também se instalam como `grok`, com outras opções. O FORGE abre o `grok` que estiver no PATH.
import { cliProvider } from './cli-path.js';

export const grokProvider = cliProvider({
  id: 'grok', label: 'Grok Build', names: ['grok'],
  install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
  projectDirs: ['.grok', '.cursor'], projectFiles: ['.mcp.json'],
  paneArgs: ({ fullAccess }) => (fullAccess ? ['--always-approve'] : []),
});
