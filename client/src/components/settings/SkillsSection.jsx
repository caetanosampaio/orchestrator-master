import React, { useState } from 'react';
import { useStore } from '../../store.jsx';
import { useSkills } from '../../use-skills.js';
import { callName, rolesLoading, tasksUsing, toggleSkill, diffFromDefault, firstSentence, filterByRole, summary, ROLE_ORDER, skillGroup, groupLabel, groupSkills, skillSource } from '../../skills-view.js';
import { Block, Card, Head, EditPanel, EditRow, CheckChips } from './SettingsUi.jsx';
import { TcBtn } from '../TeamCards.jsx';

const FALLBACK_ROLES = { maestro: { label: 'Maestro', color: '#ec4899' }, builder: { label: 'Construtor', color: '#a3e635' }, reviewer: { label: 'Revisor', color: '#8b5cf6' }, scout: { label: 'Batedor', color: '#1d4ed8' } };
const MCP_TOOLS = [['Todos os papéis', 'list_panes, list_tasks e report_done (a conclusão da própria tarefa)'], ['Só o Maestro', 'send_task, read_pane_output e list_routes (a tabela "Quem faz cada tarefa")']];

const Stat = ({ n, label }) => <div className="sk-stat"><b>{n}</b><span>{label}</span></div>;
const RoleDot = ({ role }) => <span className="sk-role" style={{ '--c': role.color }}><i aria-hidden="true" />{role.label}</span>;

/** Um cartão do catálogo: o nome (como o agente chama), o que faz, quem recebe, onde a tabela cita e o texto que o agente recebe. */
function SkillCard({ skill, roles, loadouts, rows, go, copy }) {
  const [open, setOpen] = useState(false);
  const who = rolesLoading(loadouts, skill.id), tasks = tasksUsing(rows, skill.id), shown = tasks.slice(0, 3), src = skillSource(skill);
  return (
    <article className={`sk-card${open ? ' open' : ''}`}>
      <div className="sk-main">
        <div className="sk-head"><code className="sk-name">{skill.id}</code><span className="tc-tag sk-group">{groupLabel(skillGroup(skill))}</span>{src.vendored && <span className="tc-tag">de terceiros</span>}<button type="button" className="sk-call" onClick={() => copy(callName(skill.id))} title="Copiar como o agente chama esta skill">{callName(skill.id)}</button></div>
        <p className="sk-desc">{firstSentence(skill.description, 220)}</p>
        <dl className="sk-meta">
          <div><dt>Quem recebe</dt><dd>{who.length ? who.map((r) => <RoleDot key={r} role={roles[r] ?? { label: r, color: 'var(--dim)' }} />) : <span className="dim">nenhum papel</span>}</dd></div>
          <div><dt>Na tabela</dt><dd>{tasks.length
            ? <>{shown.map((t) => <button key={t.id} type="button" className="sk-task" onClick={() => go?.('tarefas')} title="Abrir Quem faz cada tarefa">{t.label}</button>)}{tasks.length > shown.length && <span className="dim">+{tasks.length - shown.length}</span>}</>
            : <span className="dim">nenhum tipo de tarefa</span>}</dd></div>
          {src.vendored && <div><dt>Origem</dt><dd className="sk-origin">{src.origin ?? 'não informada'}</dd></div>}
          {src.vendored && <div><dt>Licença</dt><dd>{src.license ?? 'não informada'}</dd></div>}
        </dl>
      </div>
      <button type="button" className="sk-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}><i className="hz-caret" aria-hidden="true" />{open ? 'Esconder o texto' : 'Ver o texto que o agente recebe'}</button>
      {open && <div className="sk-body"><p className="dim small">{skill.description}</p><pre>{skill.body}</pre></div>}
    </article>
  );
}

/**
 * Configurações > Skills: só as skills que existem hoje (catálogo fixo do servidor, loadouts.js). "Por papel" marca o que cada papel do squad recebe ao abrir um terminal (vale para os terminais abertos a partir de agora);
 * "Catálogo" mostra cada skill, quem a recebe, em quais tipos de tarefa da tabela "Quem faz cada tarefa" ela é citada e o texto que o agente recebe; e o servidor MCP do FORGE, que já vem em todo terminal.
 */
export default function SkillsSection({ go = null }) {
  const { terminals, notify } = useStore();
  const k = useSkills();
  const [filter, setFilter] = useState(null);
  if (k.error === 'missing') return <p className="oc-note err" role="status">Este servidor ainda não oferece as skills. Atualize o FORGE.</p>;
  if (k.error && !k.loadouts) return <p className="oc-note err" role="status">{k.error}</p>;
  if (!k.loadouts) return <p className="dim small" role="status">Lendo as skills…</p>;
  const d = k.loadouts, catalog = d.catalog.skills, max = d.limits.maxSkillsPerRole;
  const roles = { ...FALLBACK_ROLES, ...Object.fromEntries((terminals?.roles ?? []).map((r) => [r.id, { label: r.label, color: r.color || 'var(--dim)' }])) };
  const order = [...ROLE_ORDER.filter((r) => d.roles[r]), ...Object.keys(d.roles).filter((r) => !ROLE_ORDER.includes(r))];
  const sum = summary(d, k.rows), list = filterByRole(catalog, d, filter);
  const act = async (fn, okText) => { try { await fn(); if (okText) notify(okText); } catch (e) { notify(e?.message || 'Não foi possível gravar.', 'error'); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); notify(`Copiado: ${text}`); } catch { notify('Não foi possível copiar.', 'error'); } };

  return (
    <>
      <Head title="Skills" tag="Squad" sub="As instruções curtas que cada papel do squad carrega ao abrir um terminal. O agente as aciona sozinho, quando a tarefa pede."
        action={k.savedAt ? <span className="hz-saved" role="status"><i aria-hidden="true" />Salvo</span> : null} />
      <div className="sk-stats" role="group" aria-label="Resumo">
        <Stat n={sum.skills} label={sum.skills === 1 ? 'skill' : 'skills'} /><Stat n={sum.roles} label="papéis" /><Stat n={sum.inTable} label="citadas na tabela" /><Stat n={sum.customized} label={sum.customized === 1 ? 'papel personalizado' : 'papéis personalizados'} />
      </div>

      <Block title="Por papel" hint="Vale para os terminais que você abrir a partir de agora." id="sk-roles">
        <EditPanel title="O que cada papel recebe" hint={`Marque as skills de cada papel (até ${max}). A mudança é salva na hora.`} label="Skills de cada papel">
          {order.map((r) => {
            const role = roles[r] ?? { label: r, color: 'var(--dim)' }, data = d.roles[r], diff = diffFromDefault(data);
            return (
              <EditRow key={r} label={<span className="sk-role big" style={{ '--c': role.color }}><i aria-hidden="true" />{role.label}</span>}
                hint={data.customized ? `Personalizado: ${[...diff.added.map((s) => `+${s}`), ...diff.removed.map((s) => `−${s}`)].join(' ') || 'mesma lista, outra ordem'}` : `Padrão do FORGE · ${data.skills.length} ${data.skills.length === 1 ? 'skill' : 'skills'}`}>
                <CheckChips label={`Skills de ${role.label}`} items={catalog.map((s) => ({ id: s.id, title: s.description }))} selected={data.skills} max={max} disabled={k.busy}
                  onToggle={(id) => { const next = toggleSkill(data.skills, id, max); if (next) act(() => k.setRoleSkills(r, next)); }} />
                {data.customized && <TcBtn kind="quiet" disabled={k.busy} onClick={() => act(() => k.resetRole(r), `${role.label}: padrão do FORGE.`)}>Restaurar o padrão de {role.label}</TcBtn>}
              </EditRow>
            );
          })}
        </EditPanel>
      </Block>

      <Block title="Catálogo" hint="Só as skills que existem hoje. O texto é fixo e vem com o FORGE; as de terceiros mostram a origem e a licença." id="sk-catalog">
        <div className="hz-filter" role="group" aria-label="Filtrar por papel">
          <button type="button" className={filter === null ? 'on' : ''} aria-pressed={filter === null} onClick={() => setFilter(null)}>Todas</button>
          {order.map((r) => <button key={r} type="button" className={filter === r ? 'on' : ''} aria-pressed={filter === r} onClick={() => setFilter(r)}>{roles[r]?.label ?? r}</button>)}
        </div>
        {groupSkills(list).map((g) => (
          <section key={g.id} className="sk-group-sec" aria-labelledby={`sk-g-${g.id}`}>
            <h4 className="sk-group-h" id={`sk-g-${g.id}`}>{g.label}<span className="dim">{g.id === 'dominio' ? 'Conhecimento de uma área (frontend, backend, testes…). Entra pelas vagas dos times.' : 'Como o squad trabalha junto: dividir, entregar, revisar.'}</span></h4>
            <div className="sk-list">{g.skills.map((s) => <SkillCard key={s.id} skill={s} roles={roles} loadouts={d} rows={k.rows} go={go} copy={copy} />)}</div>
          </section>
        ))}
        {list.length === 0 && <p className="dim small" role="status">Nenhuma skill para este papel.</p>}
      </Block>

      <Block title="Servidor MCP do FORGE" hint="Já vem em todo terminal; não é uma skill." id="sk-mcp">
        {d.catalog.mcp.map((m) => (
          <Card key={m.id} className="sk-mcp">
            <div className="sk-mcp-h"><b>{m.label}</b>{m.builtin && <span className="tc-tag">embutido</span>}</div>
            <p>{m.description}</p>
            <dl className="sk-meta">{MCP_TOOLS.map(([who, tools]) => <div key={who}><dt>{who}</dt><dd><code>{tools}</code></dd></div>)}</dl>
          </Card>
        ))}
      </Block>
    </>
  );
}
