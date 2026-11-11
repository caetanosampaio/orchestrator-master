import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';
import { ProviderMascot } from '../ProviderLogo.jsx';
import PixelMascot from '../PixelMascot.jsx';
import { ForgeScene } from '../ForgeMascot.jsx';
import { TcBtn } from '../TeamCards.jsx';
import { providerColor } from '../../provider-view.js';
import { aiName } from '../../provider-catalog.js';
import { effortBars, effortLabel, modelLabel, changedFields, snippet } from '../../harness-view.js';
import { EditPanel, EditRow, Pills, Steps, SelectBox, CheckChips, TextField, TextArea } from '../settings/SettingsUi.jsx';

/** Peças da tela "Quem faz cada tarefa": introdução, barra de esforço, IA da linha, editor de linha, painel de agentes e o compartilhar. Só mostram e pedem ação; quem grava é HarnessSection. */

export const EffortBars = ({ effort }) => (
  <span className="hz-bars" aria-hidden="true">{effortBars(effort).map((on, i) => <i key={i} className={on ? 'on' : ''} />)}</span>
);

/** A IA de uma linha: o mascote pequeno na cor dela e o nome. */
export const AiCell = ({ provider, label }) => (
  <span className="hz-ai" style={{ '--pm': providerColor(provider) }}><PixelMascot size={12} /><span>{label}</span></span>
);

export function Intro() {
  const steps = [
    ['Um objetivo vira tarefas', '"Corrigir o login" vira 4 passos. Quem divide é o Maestro, o agente que pensa mais.'],
    ['Cada uma na IA certa', 'Ler o código vai para um modelo pequeno; escrever a parte nova, para um médio.'],
    ['O limite da conta dura mais', 'O modelo caro só entra onde precisa decidir.'],
  ];
  return (
    <div className="hz-intro">
      <ForgeScene size={116} />
      <ol className="hz-steps">{steps.map(([t, d], i) => <li key={i}><i aria-hidden="true" /><b>{t}</b><span>{d}</span></li>)}</ol>
    </div>
  );
}

/** As opções de IA como botões com o mascote na cor de cada uma. */
export const aiOptions = (data, labelOf) => data.providers.map((id) => ({ id, label: labelOf(id), icon: <span className="hz-pill-mascot" style={{ '--pm': providerColor(id) }}><PixelMascot size={12} /></span> }));
const listOf = (opt, kind) => (opt?.[kind] ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id }));

/** Editor de UMA linha (aberto ao clicar nela): cada ajuste numa linha (IA, modelo, quanto pensa, agente, skills), salvo na hora, com "Restaurar padrão". */
export function RowEditor({ row, data, labelOf, onPatch, onReset, busy }) {
  const e = row.effective, opt = data.options?.[e.provider], changed = changedFields(row);
  const toggle = (id) => onPatch({ skills: e.skills.includes(id) ? e.skills.filter((x) => x !== id) : [...e.skills, id] });
  return (
    <EditPanel title={`Ajustar: ${row.label}`} hint="Cada mudança vale na hora e fica salva." onReset={onReset} resetDisabled={busy || !changed.length}
      footer={<span>{changed.length ? `Mudou em relação ao padrão: ${changed.join(', ')}.` : 'Está no padrão de fábrica.'}</span>}>
      <EditRow label="IA" hint="Quem faz este tipo de tarefa."><Pills label={`IA de ${row.label}`} value={e.provider} options={aiOptions(data, labelOf)} disabled={busy} onChange={(v) => onPatch({ provider: v })} /></EditRow>
      <EditRow label="Modelo" hint="O modelo que roda a tarefa."><Pills label={`Modelo de ${row.label}`} value={e.model} options={listOf(opt, 'models')} disabled={busy} onChange={(v) => onPatch({ model: v })} /></EditRow>
      <EditRow label="Quanto pensa" hint="Quanto o modelo raciocina antes de responder."><Steps label={`Esforço de ${row.label}`} value={e.effort} options={listOf(opt, 'efforts')} disabled={busy} onChange={(v) => onPatch({ effort: v })} /></EditRow>
      <EditRow label="Agente" hint="A instrução com que ele trabalha."><SelectBox label={`Agente de ${row.label}`} value={e.agentId ?? ''} disabled={busy} onChange={(v) => onPatch({ agentId: v || null })}><option value="">Padrão do papel</option>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</SelectBox></EditRow>
      <EditRow label="Skills" hint={`O Maestro as cita na tarefa (até ${data.limits.maxRowSkills}).`}><CheckChips label={`Skills de ${row.label}`} items={data.skills.map((s) => ({ id: s.id, title: s.description }))} selected={e.skills} max={data.limits.maxRowSkills} disabled={busy} onToggle={toggle} /></EditRow>
    </EditPanel>
  );
}

/** "Seus agentes": instruções com nome, que o Maestro (e as linhas) podem usar. Criar, editar e excluir; o padrão do FORGE aparece só para ler. */
export function AgentsPanel({ agents, limits, busy, onCreate, onUpdate, onRemove, defaultText }) {
  const [form, setForm] = useState(null), [asking, setAsking] = useState(null);
  const submit = async () => { const ok = form.id ? await onUpdate(form.id, { name: form.name, instruction: form.instruction }) : await onCreate(form.name, form.instruction); if (ok) setForm(null); };
  return (
    <div className="hz-agents">
      <div className="hz-agent default"><div className="hz-agent-h"><b>maestro-do-forge</b><span className="tc-tag">do FORGE</span></div><p>{defaultText}</p></div>
      {agents.map((a) => (
        <div key={a.id} className="hz-agent">
          <div className="hz-agent-h"><b>{a.name}</b><span className="tc-tag">meu</span>
            <span className="hz-agent-act"><TcBtn kind="quiet" icon="pencil" disabled={busy} onClick={() => setForm({ id: a.id, name: a.name, instruction: a.instruction })}>Editar</TcBtn>
              {asking === a.id ? <><TcBtn kind="danger" disabled={busy} onClick={() => { setAsking(null); onRemove(a.id); }}>Excluir mesmo</TcBtn><TcBtn kind="quiet" onClick={() => setAsking(null)}>Cancelar</TcBtn></> : <TcBtn kind="quiet" icon="close" disabled={busy} onClick={() => setAsking(a.id)}>Excluir</TcBtn>}</span></div>
          <p>{snippet(a.instruction, 220)}</p>
        </div>
      ))}
      {form ? (
        <form className="hz-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <EditPanel title={form.id ? 'Editar agente' : 'Novo agente'} hint="Uma instrução com nome, para usar no Maestro ou numa linha da tabela."
            footer={<><TcBtn kind="primary" type="submit" disabled={busy || !form.name.trim() || !form.instruction.trim()}>{form.id ? 'Salvar agente' : 'Criar agente'}</TcBtn><TcBtn kind="quiet" onClick={() => setForm(null)}>Cancelar</TcBtn></>}>
            <EditRow label="Nome" hint={`Até ${limits.maxName} caracteres.`}><TextField label="Nome do agente" value={form.name} maxLength={limits.maxName} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex.: revisor-rigoroso" autoComplete="off" data-autofocus="" /></EditRow>
            <EditRow label="Instrução" hint={`Como ele deve trabalhar. Até ${limits.maxInstruction} caracteres.`}><TextArea label="Instrução do agente" rows={5} value={form.instruction} maxLength={limits.maxInstruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} placeholder="O que fazer, o que nunca fazer…" /></EditRow>
          </EditPanel>
        </form>
      ) : <TcBtn icon="plus" disabled={busy || agents.length >= limits.maxAgents} onClick={() => setForm({ id: null, name: '', instruction: '' })}>{agents.length >= limits.maxAgents ? `Limite de ${limits.maxAgents} agentes` : 'Novo agente'}</TcBtn>}
    </div>
  );
}

/** Compartilhar: o código da configuração para copiar e um campo para importar o de outra pessoa (substitui a tabela, o Maestro e os agentes). */
export function SharePanel({ getCode, onImport, busy, onClose }) {
  const [code, setCode] = useState(''), [incoming, setIncoming] = useState(''), [copied, setCopied] = useState(false), [err, setErr] = useState('');
  const box = useRef(null);
  useEffect(() => { let on = true; getCode().then((c) => { if (on) setCode(c); }).catch((e) => { if (on) setErr(e?.message || 'Não foi possível gerar o código.'); }); return () => { on = false; }; }, [getCode]);
  const copy = async () => { try { await navigator.clipboard.writeText(code); } catch { box.current?.select(); document.execCommand?.('copy'); } setCopied(true); setTimeout(() => setCopied(false), 1800); };
  const importIt = async () => { if (!window.confirm('Importar substitui a sua tabela, o Maestro e os seus agentes por este código. Continuar?')) return; setErr(''); try { const ok = await onImport(incoming.trim()); if (ok) { setIncoming(''); onClose(); } } catch (e) { setErr(e?.message || 'Não foi possível importar.'); } };
  return (
    <EditPanel title="Compartilhar" hint="O código leva a sua tabela, o Maestro e os seus agentes. Não leva contas nem senhas." label="Compartilhar a tabela" footer={err ? <span className="ep-err" role="status">{err}</span> : <span>Importar substitui a tabela, o Maestro e os agentes que você tem agora.</span>}>
      <EditRow label="Seu código" hint="Copie e envie para outra pessoa."><div className="ep-inline"><TextArea label="Código para compartilhar" ref={box} readOnly rows={2} value={code || 'Gerando o código…'} onFocus={(e) => e.target.select()} /><TcBtn icon="copy" onClick={copy} disabled={!code}>{copied ? 'Copiado' : 'Copiar'}</TcBtn></div></EditRow>
      <EditRow label="Importar" hint="Cole o código de outra pessoa."><div className="ep-inline"><TextArea label="Código para importar" rows={2} value={incoming} onChange={(e) => setIncoming(e.target.value)} placeholder="forge-harness:1:…" /><TcBtn disabled={busy || !incoming.trim()} onClick={importIt}>Importar</TcBtn></div></EditRow>
    </EditPanel>
  );
}

export { aiName, effortLabel, modelLabel, ProviderMascot, Icon };
