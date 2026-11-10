import React from 'react';

/** Tela de erro: sem hooks e sem o store (ele pode ser a causa da falha). Os terminais vivem no servidor, então o erro de interface não encerra os agentes. */
export function ErrorFallback({ error, onReload }) {
  const detail = String(error?.message || error || 'erro desconhecido').slice(0, 300);
  return (
    <div role="alert" data-testid="error-boundary" style={{ maxWidth: 560, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 12px' }}>A interface encontrou um erro</h1>
      <p style={{ margin: '0 0 12px' }}>Os terminais e os agentes continuam rodando no servidor; só a tela travou. Recarregue para voltar.</p>
      <pre style={{ whiteSpace: 'pre-wrap', margin: '0 0 16px', opacity: 0.75, fontSize: 12 }}>{detail}</pre>
      <button type="button" className="btn primary" onClick={onReload}>Recarregar a interface</button>
    </div>
  );
}

/** Uma exceção de renderização não deixa mais a tela em branco: mostra o erro e oferece recarregar. */
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error: error ?? new Error('erro desconhecido') }; }
  componentDidCatch(error, info) { console.error('[forge] erro de renderização:', error, info?.componentStack); }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} onReload={() => location.reload()} />;
    return this.props.children;
  }
}
