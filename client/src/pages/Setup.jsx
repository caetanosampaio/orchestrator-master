import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { usePrefs, usePrefersReduced } from '../hooks.js';
import { mountScene } from '../forge-scene.js';
import { logoSvg } from '../forge-logo.mjs';
import { prereqIssues } from '../prereqs.js';
import AccountsPanel from '../components/AccountsPanel.jsx';
import StatusGlyph from '../components/StatusGlyph.jsx';
import ProviderLogo from '../components/ProviderLogo.jsx';
import { Icon } from '../components/ui.jsx';

const STEPS = [
  { id: 'welcome', label: 'Boas-vindas' },
  { id: 'tools', label: 'Ferramentas' },
  { id: 'account', label: 'Conta' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'done', label: 'Pronto' },
];
const LOGO = logoSvg({ variant: 'mark', ink: 'currentColor', stroke: 2.6 });

/** A cena da forja animada (pixel art própria, forge-scene.js), escalada sem suavizar. Para com "Animações reduzidas". */
function Scene() {
  const ref = useRef(null), reduced = usePrefersReduced();
  useEffect(() => (ref.current ? mountScene(ref.current, { reduced }) : undefined), [reduced]);
  return <canvas ref={ref} className="fx-setup-canvas" role="img" aria-label="Um ferreiro martela na bigorna diante da fornalha acesa; a chaminé solta fumaça." />;
}

/** Uma ferramenta no passo "Ferramentas": glifo de estado, nome, detalhe e se é obrigatória. */
function ToolRow({ logo, name, ok, required, detail, label }) {
  return (
    <li className={`fx-setup-tool${ok ? ' ok' : ''}`}>
      <StatusGlyph state={ok ? 'done' : required ? 'failed' : 'idle'} size={15} />
      {logo ? <ProviderLogo id={logo} size={16} /> : <Icon name="layers" size={16} />}
      <span className="fx-setup-tool-t"><b>{name}</b><span>{detail}</span></span>
      <span className={`fx-chip${required && !ok ? ' warn' : ''}`}>{label ?? (required ? 'obrigatório' : 'opcional')}</span>
    </li>
  );
}

/**
 * Setup do primeiro uso (o "instalador" com personalidade): a forja animada à esquerda e, à direita, os passos (boas-vindas, ferramentas,
 * conta, primeiro workspace e pronto). Usa só o que o app já tem de verdade: /api/state (pré-requisitos), Configurações > Contas (login) e as rotas de workspace.
 * Concluir ou pular grava `setupDone` nas preferências do SERVIDOR (o Electron troca de porta a cada abertura; o localStorage não serviria).
 */
export default function Setup({ onFinish }) {
  const { state, workspaces, terminals, refresh, notify } = useStore();
  const [prefs, setPref] = usePrefs();
  const [i, setI] = useState(0), [dir, setDir] = useState(1);
  const [name, setName] = useState(prefs.name || '');
  const [checking, setChecking] = useState(false);
  const [path, setPath] = useState(''), [wsName, setWsName] = useState(''), [check, setCheck] = useState(null), [busy, setBusy] = useState(false);
  const step = STEPS[i];
  const p = state?.prereqs ?? {};
  const issues = useMemo(() => prereqIssues(state, terminals?.providers), [state, terminals]);
  const claudeOk = p.claude ? p.claude.available === true : state?.executor?.available !== false;
  const codex = (terminals?.providers ?? []).find((x) => x.id === 'codex');
  const anyAi = claudeOk || codex?.available === true; // nenhuma IA é obrigatória em si: basta uma delas
  const loginOk = !(p.login?.known === true && p.login.loggedIn === false); // alguma conta conectada de alguma IA (o servidor decide)
  const go = (n) => { setDir(n > i ? 1 : -1); setI(Math.max(0, Math.min(STEPS.length - 1, n))); };
  const finish = () => { setPref('setupDone', true); onFinish?.(); };
  const recheck = async () => { setChecking(true); try { await api.get('/api/state?fresh=1').catch(() => {}); await refresh(); } finally { setChecking(false); } };
  const validate = async () => { try { setCheck(await api.post('/api/workspaces/validate', { path })); } catch (e) { setCheck({ ok: false, error: e.message }); } };
  const addWs = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const ws = await api.post('/api/workspaces', { path, name: wsName });
      await api.post(`/api/workspaces/${ws.id}/activate`);
      notify(`Workspace "${ws.name}" pronto.`); await refresh(); go(4);
    } catch (err) { setCheck({ ok: false, error: err.message }); } finally { setBusy(false); }
  };
  // Enter avança nos passos sem formulário; Esc não fecha (o setup só sai por "Pular" ou "Abrir o Forge")
  const card = useRef(null);
  useEffect(() => { card.current?.querySelector('[data-autofocus]')?.focus(); }, [i]);

  return (
    <div className="fx-setup" role="dialog" aria-modal="true" aria-labelledby="fx-setup-t">
      <div className="fx-setup-art">
        <div className="fx-setup-brand"><span className="fx-setup-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: LOGO }} /><b>Forge</b></div>
        <div className="fx-setup-stage"><Scene /></div>
        <p className="fx-setup-tag">Seus agentes de IA, trabalhando juntos na mesma forja.</p>
      </div>
      <div className="fx-setup-side">
        <ol className="fx-setup-steps" aria-label="Etapas do setup">
          {STEPS.map((s, n) => (
            <li key={s.id} className={n === i ? 'on' : n < i ? 'past' : ''} aria-current={n === i ? 'step' : undefined}>
              <i aria-hidden="true">{n < i ? <StatusGlyph state="done" size={12} /> : n + 1}</i><span>{s.label}</span>
            </li>
          ))}
        </ol>
        <section key={step.id} ref={card} className={`fx-setup-card ${dir > 0 ? 'fwd' : 'back'}`}>
          {step.id === 'welcome' && <>
            <h1 id="fx-setup-t">Bem-vindo ao Forge</h1>
            <p className="fx-setup-lead">Aqui cada agente (Claude Code, Codex) trabalha no próprio terminal, e você acompanha a equipe inteira ao vivo. Vamos acender a forja em poucos passos.</p>
            <label className="fx-setup-field">Como quer ser chamado?
              <input data-autofocus="" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Seu nome (opcional)" onKeyDown={(e) => { if (e.key === 'Enter') { setPref('name', name); go(1); } }} />
            </label>
            <div className="fx-setup-actions"><button type="button" className="btn primary" onClick={() => { setPref('name', name); go(1); }}>Começar<Icon name="arrowRight" size={14} /></button></div>
          </>}
          {step.id === 'tools' && <>
            <h1 id="fx-setup-t">As ferramentas da forja</h1>
            <p className="fx-setup-lead">O Forge abre os agentes que já estão instalados neste computador. Você precisa de pelo menos uma IA, a que preferir.</p>
            <ul className="fx-setup-tools">
              <ToolRow logo="claude" name="Claude Code" required={!anyAi} label={anyAi ? 'opcional' : 'precisa de uma IA'} ok={claudeOk} detail={claudeOk ? (p.claude?.version || 'instalado') : 'não encontrado'} />
              <ToolRow logo="codex" name="Codex CLI" required={!anyAi} label={anyAi ? 'opcional' : 'precisa de uma IA'} ok={!!codex?.available} detail={codex?.available ? 'instalado' : 'não encontrado (pode instalar depois)'} />
              <ToolRow name="Git" ok={p.git?.available !== false} detail={p.git?.available === false ? 'não encontrado: worktrees e relatórios ficam desligados' : (p.git?.version || 'instalado')} />
            </ul>
            {issues.filter((x) => x.id !== 'login').map((x) => <p key={x.id} className="fx-setup-note">{x.steps[0]}</p>)}
            <div className="fx-setup-actions">
              <button type="button" className="btn quiet" onClick={() => go(0)}>Voltar</button>
              <span className="grow" />
              <button type="button" className="btn" onClick={recheck} disabled={checking}>{checking ? 'Verificando…' : 'Verificar de novo'}</button>
              <button type="button" className="btn primary" data-autofocus="" onClick={() => go(2)}>{anyAi ? 'Continuar' : 'Continuar mesmo assim'}<Icon name="arrowRight" size={14} /></button>
            </div>
          </>}
          {step.id === 'account' && <>
            <h1 id="fx-setup-t">Conecte a sua conta</h1>
            <p className="fx-setup-lead">{loginOk ? 'Encontramos uma conta conectada. Você pode adicionar outras agora ou depois, em Configurações > Contas.' : 'O Forge precisa de uma conta conectada de alguma IA. A do Claude Code entra pelo navegador e volta para cá sozinha; a do Codex, com codex login num terminal.'}</p>
            <div className="fx-setup-embed"><AccountsPanel /></div>
            <div className="fx-setup-actions">
              <button type="button" className="btn quiet" onClick={() => go(1)}>Voltar</button>
              <span className="grow" />
              <button type="button" className="btn primary" data-autofocus="" onClick={() => go(3)}>Continuar<Icon name="arrowRight" size={14} /></button>
            </div>
          </>}
          {step.id === 'workspace' && <>
            <h1 id="fx-setup-t">Escolha o primeiro projeto</h1>
            <p className="fx-setup-lead">Um workspace é a pasta de um projeto: os terminais dos agentes abrem nela. Cadastrar não executa nada.</p>
            {workspaces.length > 0 && <p className="fx-setup-note"><StatusGlyph state="done" size={12} /> Você já tem {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}; pode adicionar outro ou seguir.</p>}
            <form className="fx-setup-form" onSubmit={addWs}>
              <label className="fx-setup-field">Caminho da pasta
                <input className="mono" data-autofocus="" value={path} onChange={(e) => { setPath(e.target.value); setCheck(null); }} placeholder={navigator.platform?.startsWith('Win') ? 'C:\\projetos\\meu-repo' : '~/projetos/meu-repo'} />
              </label>
              <label className="fx-setup-field">Nome (opcional)
                <input value={wsName} maxLength={80} onChange={(e) => setWsName(e.target.value)} placeholder="como aparece na barra lateral" />
              </label>
              {check && (check.ok ? <p className="fx-setup-note ok" role="status"><StatusGlyph state="done" size={12} /> Pasta válida · {check.hasGit ? 'repositório Git' : 'sem Git'}</p> : <p className="fx-setup-note err" role="alert">{check.error}</p>)}
              <div className="fx-setup-actions">
                <button type="button" className="btn quiet" onClick={() => go(2)}>Voltar</button>
                <span className="grow" />
                <button type="button" className="btn" onClick={validate} disabled={!path.trim()}>Validar</button>
                {path.trim() ? <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Adicionando…' : 'Adicionar e continuar'}</button>
                  : <button type="button" className="btn primary" onClick={() => go(4)}>{workspaces.length ? 'Continuar' : 'Fazer depois'}<Icon name="arrowRight" size={14} /></button>}
              </div>
            </form>
          </>}
          {step.id === 'done' && <>
            <h1 id="fx-setup-t">A forja está acesa{prefs.name ? `, ${prefs.name}` : ''}.</h1>
            <p className="fx-setup-lead">Abra uma equipe pronta no Cockpit ou um terminal avulso. No painel Live, à direita, você vê o localhost do projeto e o que cada agente está fazendo.</p>
            <ul className="fx-setup-tips">
              <li><kbd>⌘K</kbd> busca workspaces e terminais</li>
              <li><Icon name="panel" size={13} /> o painel Live abre pela barra de status</li>
              <li><Icon name="gear" size={13} /> refaça este setup em Configurações &gt; Preferências gerais</li>
            </ul>
            <div className="fx-setup-actions"><span className="grow" /><button type="button" className="btn primary" data-autofocus="" onClick={finish}>Abrir o Forge<Icon name="arrowRight" size={14} /></button></div>
          </>}
        </section>
        {step.id !== 'done' && <button type="button" className="fx-setup-skip" onClick={finish}>Pular o setup</button>}
      </div>
    </div>
  );
}
