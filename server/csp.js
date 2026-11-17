// CSP da interface (só para as páginas do SPA; /api e /mcp não recebem). A UI renderiza saída de terminal e texto de agentes: um XSS alcançaria a API local
// sem autenticação, então nada de eval, script inline ou host externo; 'unsafe-inline' só em estilos (atributos style do React).
// frame-src: o painel Live mostra no iframe o servidor de desenvolvimento que a equipe sobe (localhost:<porta>). Só loopback, com porta; nenhum host externo.
// A própria interface continua impossível de embutir (frame-ancestors 'none' + X-Frame-Options DENY).
export const FRAME_SOURCES = Object.freeze(['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*', 'https://127.0.0.1:*']);
export const UI_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src ${FRAME_SOURCES.join(' ')}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
