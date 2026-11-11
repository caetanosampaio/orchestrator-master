import React from 'react';
import { Icon } from '../ui.jsx';

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

/** Cabeçalho de uma página de seção que desenha o próprio título: voltar (nas páginas de dentro), título com etiqueta, frase de apoio e a ação à direita. */
export function Head({ title, tag = null, sub = null, back = null, backLabel = 'Voltar', action = null }) {
  return (
    <>
      {back && <button type="button" className="set-crumb" onClick={back}><Icon name="chevronRight" size={12} /><span>{backLabel}</span></button>}
      <div className="set-head">
        <div><h1 className="set-title">{title}{tag && <span className="set-title-tag">{tag}</span>}</h1>{sub && <p className="set-sub">{sub}</p>}</div>
        {action}
      </div>
    </>
  );
}

// ---------- painel de edição ÚNICO das Configurações ----------
// Cada ajuste é uma linha: à esquerda o nome e uma dica curta, à direita o controle certo (botões lado a lado para poucas opções, passos para o esforço, menu para listas longas, etiquetas marcáveis para skills).
// O mesmo painel serve ao Maestro, às linhas da tabela, aos agentes, ao compartilhar e ao editor de times: tudo com o mesmo desenho, em preto, caixas quadradas e contornos de 1px.

/** Contêiner de um editor: título, uma frase, "Restaurar padrão" opcional e um rodapé de apoio. */
export function EditPanel({ title, hint = null, onReset = null, resetLabel = 'Restaurar padrão', resetDisabled = false, footer = null, children, label = null }) {
  return (
    <section className="ep" aria-label={label ?? title}>
      <header className="ep-head">
        <div><b>{title}</b>{hint && <span>{hint}</span>}</div>
        {onReset && <button type="button" className="ep-reset" onClick={onReset} disabled={resetDisabled}>{resetLabel}</button>}
      </header>
      <div className="ep-body">{children}</div>
      {footer && <footer className="ep-foot">{footer}</footer>}
    </section>
  );
}
/** Uma linha do editor: o nome e a dica à esquerda, o controle à direita. */
export const EditRow = ({ label, hint = null, children }) => <div className="ep-row"><div className="ep-label"><b>{label}</b>{hint && <span>{hint}</span>}</div><div className="ep-ctl">{children}</div></div>;

/** Escolha de UMA opção entre poucas, em botões lado a lado (grupo de rádios). `options`: [{ id, label, icon? }]. */
export function Pills({ value, onChange, options, label, disabled = false }) {
  return (
    <div className="ep-pills" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.id)}>{o.icon}<span>{o.label}</span></button>
      ))}
    </div>
  );
}
/** O esforço em passos: cada opção mostra quantas barras acende, da menor para a maior. `options`: [{ id, label }] na ordem crescente. */
export function Steps({ value, onChange, options, label, disabled = false }) {
  return (
    <div className="ep-steps" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.id)}>
          <span className="ep-bars" aria-hidden="true">{options.map((_, k) => <i key={k} className={k <= i ? 'on' : ''} />)}</span><span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
/** Menu para listas mais longas, com o desenho do FORGE (a seta é nossa; o resto é o select de sempre, acessível). */
export function SelectBox({ value, onChange, label, disabled = false, children }) {
  return <span className="ep-select"><select value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.value)}>{children}</select><Icon name="chevronDown" size={12} /></span>;
}
/** Etiquetas marcáveis (várias ao mesmo tempo, com limite). `items`: [{ id, title? }]. */
export function CheckChips({ items, selected, onToggle, max = Infinity, label, disabled = false }) {
  return (
    <div className="ep-chips" role="group" aria-label={label}>
      {items.map((it) => {
        const on = selected.includes(it.id), full = !on && selected.length >= max;
        return <button key={it.id} type="button" role="checkbox" aria-checked={on} className={on ? 'on' : ''} disabled={disabled || full} title={it.title} onClick={() => onToggle(it.id)}><i aria-hidden="true">{on ? '✓' : ''}</i>{it.id}</button>;
      })}
    </div>
  );
}
/** Campo de texto e de várias linhas no desenho do painel. */
export const TextField = React.forwardRef(({ label, ...p }, ref) => <input ref={ref} className="ep-input" aria-label={label} {...p} />);
export const TextArea = React.forwardRef(({ label, ...p }, ref) => <textarea ref={ref} className="ep-input" aria-label={label} {...p} />);
