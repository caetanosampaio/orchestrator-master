import React, { useCallback, useState } from 'react';
import { useStore } from '../../store.jsx';
import { useHarness } from '../../use-harness.js';
import { Block, Card, Head, EditPanel, EditRow, Pills, Steps, SelectBox } from '../settings/SettingsUi.jsx';
import { TcBtn } from '../TeamCards.jsx';
import { Intro, EffortBars, AiCell, RowEditor, AgentsPanel, SharePanel, aiOptions, aiName, effortLabel, modelLabel } from './HarnessParts.jsx';
import { filterRows, groupRows, changedFields, filterChoices, agentName, snippet } from '../../harness-view.js';
import { providerColor } from '../../provider-view.js';

const ids = (opt, kind) => (opt?.[kind] ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id }));
const MAESTRO_TEXT = 'O papel do Maestro: não edita arquivos, divide o pedido em tarefas pequenas, escolhe o agente de cada uma e cobra os resultados. É a instrução com que ele nasce; um agente seu entra junto dela.';

/**
 * Configurações > Quem faz cada tarefa (formato da tela de referência, em preto): introdução, o Maestro (IA, modelo, esforço, reserva e agente), e a tabela dos ajudantes por tipo de tarefa (IA, modelo, quanto pensa,
 * skills e agente de cada linha, com filtro por IA), os seus agentes e o compartilhar por código. Tudo vem de e vai para /api/harness (use-harness.js): o que você muda vale para os Maestros e as tarefas novas.
 */
export default function HarnessSection() {
  const { terminals, notify } = useStore();
  const h = useHarness();
  const [filter, setFilter] = useState(null), [openRow, setOpenRow] = useState(null), [agentsOpen, setAgentsOpen] = useState(false), [shareOpen, setShareOpen] = useState(false), [editPilot, setEditPilot] = useState(false);
  const getCode = useCallback(() => h.exportCode(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (h.error === 'missing') return <p className="oc-note err" role="status">Este servidor ainda não tem a tabela "Quem faz cada tarefa". Atualize o FORGE.</p>;
  if (h.error && !h.data) return <p className="oc-note err" role="status">{h.error}</p>;
  if (!h.data) return <p className="dim small" role="status">Lendo a tabela…</p>;
  const d = h.data, tp = terminals?.providers ?? [], labelOf = (id) => aiName(id, tp.find((p) => p.id === id)?.label);
  const act = async (fn, okText = null) => { try { const r = await fn(); if (okText) notify(okText); return r ?? true; } catch (e) { notify(e?.message || 'Não foi possível gravar.', 'error'); return false; } };
  const pilot = d.pilot.effective, opt = d.options?.[pilot.provider] ?? { models: [], efforts: [] };
  const groups = groupRows(filterRows(d.rows, filter), d.groups), choices = filterChoices(d, tp), customCount = d.rows.filter((r) => r.customized).length;
  const saved = h.savedAt ? <span className="hz-saved" role="status"><i aria-hidden="true" />Salvo</span> : null;

  return (
    <>
      <Head title="Quem faz cada tarefa" tag="Harness" sub="Para cada tipo de tarefa, qual IA faz, com qual modelo, quanto ela pensa e com qual agente."
        action={<span className="hz-head-act">{saved}<TcBtn icon="copy" onClick={() => setShareOpen((v) => !v)} aria-expanded={shareOpen}>Compartilhar</TcBtn></span>} />
      {shareOpen && <SharePanel getCode={getCode} busy={h.busy} onClose={() => setShareOpen(false)} onImport={(code) => act(() => h.importCode(code), 'Tabela importada.')} />}
      <Intro />

      <Block title="O Maestro" hint="Quem lê o seu pedido, decide os passos e passa cada um a um ajudante." id="hz-pilot">
        <Card className="hz-pilot">
          <div className="hz-pilot-line">
            <i className="hz-sq" style={{ background: providerColor(pilot.provider) }} aria-hidden="true" />
            <AiCell provider={pilot.provider} label={labelOf(pilot.provider)} />
            <span className="hz-model">{modelLabel(d.options, pilot.provider, pilot.model)}</span>
            <span className="hz-eff"><EffortBars effort={pilot.effort} /><span>{effortLabel(d.options, pilot.provider, pilot.effort)}</span></span>
            <span className="dim">Reserva: {modelLabel(d.options, pilot.provider, pilot.reserveModel)}</span>
            <span className="dim hz-pilot-skills">Skills da base do Maestro: {d.pilot.skills.map((s) => <code key={s}>{s}</code>)}</span>
            <TcBtn kind="quiet" onClick={() => setEditPilot((v) => !v)} aria-expanded={editPilot}>{editPilot ? 'Fechar' : 'Mudar'}</TcBtn>
          </div>
          {editPilot && (
            <EditPanel title="Ajustar o Maestro" hint="Vale para os Maestros que você abrir a partir de agora." onReset={() => act(() => h.resetPilot(), 'Maestro no padrão.')} resetDisabled={h.busy || !d.pilot.customized}
              footer={<span>A reserva é o modelo que o Maestro usa quando o limite do principal acaba.</span>}>
              <EditRow label="IA" hint="Quem coordena o trabalho."><Pills label="IA do Maestro" value={pilot.provider} options={aiOptions(d, labelOf)} disabled={h.busy} onChange={(v) => act(() => h.setPilot({ provider: v }))} /></EditRow>
              <EditRow label="Modelo" hint="O modelo principal."><Pills label="Modelo do Maestro" value={pilot.model} options={ids(opt, 'models')} disabled={h.busy} onChange={(v) => act(() => h.setPilot({ model: v }))} /></EditRow>
              <EditRow label="Quanto pensa" hint="Quanto ele raciocina antes de decidir."><Steps label="Esforço do Maestro" value={pilot.effort} options={ids(opt, 'efforts')} disabled={h.busy} onChange={(v) => act(() => h.setPilot({ effort: v }))} /></EditRow>
              <EditRow label="Reserva" hint="Entra quando o limite do principal acaba."><Pills label="Modelo de reserva do Maestro" value={pilot.reserveModel} options={ids(opt, 'models')} disabled={h.busy} onChange={(v) => act(() => h.setPilot({ reserveModel: v }))} /></EditRow>
            </EditPanel>
          )}
          <div className="hz-pilot-agent">
            <div><span className="hz-agent-name"><b>{agentName(d.agents, pilot.agentId, 'maestro-do-forge')}</b><span className="tc-tag">agente</span><span className="dim small">{pilot.agentId ? 'seu' : 'do FORGE'}</span></span>
              <p>{pilot.agentId ? snippet(d.agents.find((a) => a.id === pilot.agentId)?.instruction, 260) : MAESTRO_TEXT}</p></div>
            <SelectBox label="Agente do Maestro" value={pilot.agentId ?? ''} disabled={h.busy} onChange={(v) => act(() => h.setPilot({ agentId: v || null }))}>
              <option value="">maestro-do-forge (padrão)</option>{d.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </SelectBox>
          </div>
        </Card>
      </Block>

      <Block title="Os ajudantes, por tipo de tarefa" hint="A sua tabela vence o padrão de fábrica; o Maestro a consulta ao delegar." id="hz-helpers">
        <div className="hz-filter" role="group" aria-label="Filtrar por IA">
          <button type="button" className={filter === null ? 'on' : ''} aria-pressed={filter === null} onClick={() => setFilter(null)}>Todas</button>
          {choices.map((c) => <button key={c.id} type="button" className={filter === c.id ? 'on' : ''} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>{c.label}</button>)}
          {customCount > 0 && <TcBtn kind="quiet" disabled={h.busy} onClick={() => { if (window.confirm('Voltar todas as linhas ao padrão de fábrica?')) act(() => h.resetRows(), 'Tabela no padrão de fábrica.'); }}>Restaurar a tabela ({customCount})</TcBtn>}
        </div>
        <Card className="hz-table-card">
          <div className="hz-table-head">
            <div><b>Agente de cada ajudante</b>
              <p>O Maestro escolhe entre os seus agentes, ou nenhum, em todas as linhas. A tabela vai com ele pela ferramenta <code>list_routes</code>, e a tarefa enviada leva o tipo, as skills e o agente da linha. Para fixar um agente numa linha, abra a linha.</p></div>
            <TcBtn onClick={() => setAgentsOpen((v) => !v)} aria-expanded={agentsOpen}>{agentsOpen ? 'Fechar os agentes' : 'Ver os seus agentes'}</TcBtn>
          </div>
          {agentsOpen && <AgentsPanel agents={d.agents} limits={d.limits} busy={h.busy} defaultText={MAESTRO_TEXT}
            onCreate={(n, i) => act(() => h.createAgent(n, i), 'Agente criado.')} onUpdate={(id, p) => act(() => h.updateAgent(id, p), 'Agente salvo.')} onRemove={(id) => act(() => h.removeAgent(id), 'Agente excluído.')} />}
          <div className="hz-table" role="table" aria-label="Tipos de tarefa">
            <div className="hz-tr hz-th" role="row"><span role="columnheader">Tipo de tarefa</span><span role="columnheader">IA</span><span role="columnheader">Modelo</span><span role="columnheader">Quanto pensa</span><span role="columnheader">Skills</span></div>
            {groups.length === 0 && <p className="dim small hz-none" role="status">Nenhum tipo de tarefa usa esta IA agora.</p>}
            {groups.map(({ group, rows }) => (
              <div key={group} className="hz-group" role="rowgroup">
                <div className="hz-gt">{group}</div>
                {rows.map((r) => {
                  const e = r.effective, open = openRow === r.id, ch = changedFields(r);
                  return (
                    <div key={r.id} className={`hz-item${open ? ' open' : ''}`}>
                      <button type="button" className="hz-tr hz-row" role="row" aria-expanded={open} onClick={() => setOpenRow(open ? null : r.id)}>
                        <span className="hz-name"><i className="hz-caret" aria-hidden="true" />{r.label}{r.customized && <em title={`Mudou: ${ch.join(', ')}`}>mudou</em>}</span>
                        <AiCell provider={e.provider} label={labelOf(e.provider)} />
                        <span>{modelLabel(d.options, e.provider, e.model)}</span>
                        <span className="hz-eff"><EffortBars effort={e.effort} /><span>{effortLabel(d.options, e.provider, e.effort)}</span></span>
                        <span className="hz-skill-list">{e.skills.length ? e.skills.map((s) => <code key={s}>{s}</code>) : <span className="dim">nenhuma</span>}</span>
                      </button>
                      {open && <RowEditor row={r} data={d} labelOf={labelOf} busy={h.busy} onPatch={(p) => act(() => h.setRow(r.id, p))} onReset={() => act(() => h.resetRow(r.id), 'Linha no padrão.')} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>
      </Block>
    </>
  );
}
