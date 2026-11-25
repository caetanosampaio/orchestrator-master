// Provedor Kimi Code (`kimi`, da Moonshot AI; a kimi-cli antiga foi arquivada e aponta para ela). NÍVEL 1 (só terminal).
// Conferido contra a documentação oficial (moonshotai.github.io/kimi-code, nov/2026), NÃO contra a CLI instalada:
//   - `--plan` começa no modo de planejamento (ferramentas de leitura); `--yolo` dispensa a aprovação de escrita e de comandos (acesso total);
//   - MCP só por arquivo (~/.kimi-code/mcp.json ou .kimi-code/mcp.json do projeto), sem variável nos cabeçalhos: sem coordenação. Os apelidos de modelo vêm da configuração
//     do usuário, então o FORGE não escolhe modelo (lista vazia = "padrão da CLI").
import { cliProvider } from './cli-path.js';

export const kimiProvider = cliProvider({
  id: 'kimi', label: 'Kimi Code', names: ['kimi'],
  install: 'npm install -g @moonshot-ai/kimi-code',
  capabilities: { readOnly: true },
  projectDirs: ['.kimi-code'],
  paneArgs: ({ fullAccess, readOnly }) => (readOnly ? ['--plan'] : fullAccess ? ['--yolo'] : []),
});
