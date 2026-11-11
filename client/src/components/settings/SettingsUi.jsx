import React from 'react';

/** Peças comuns das seções de Configurações. Só visual: sem estado nem rede. */
export const Row = ({ title, hint, children }) => <div className="set-row"><div className="set-row-t"><b>{title}</b>{hint && <span className="dim small">{hint}</span>}</div><div className="set-row-c">{children}</div></div>;
export const Switch = ({ checked, onChange, label }) => (
  <label className="oc-switch"><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="oc-switch-track" aria-hidden="true"><i /></span><span className="sr">{label}</span></label>
);
/** Bloco com título e uma frase de apoio ao lado (como "Cara  — a forma, o nome…"); o conteúdo vem abaixo. */
export const Block = ({ title, hint = null, children, id = undefined }) => (
  <section className="set-block" aria-labelledby={id ? `${id}-t` : undefined}>
    <h3 className="set-block-h" id={id ? `${id}-t` : undefined}>{title}{hint && <span className="dim">{hint}</span>}</h3>
    {children}
  </section>
);
/** Cartão que agrupa linhas: fundo preto elevado, contorno fino e divisórias entre as linhas. */
export const Card = ({ children, className = '' }) => <div className={`set-card${className ? ` ${className}` : ''}`}>{children}</div>;
export const Segmented = ({ options, value, onChange, label }) => (
  <div className="oc-seg" role="radiogroup" aria-label={label}>
    {options.map(([v, l, title]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} title={title}>{l}</button>)}
  </div>
);
