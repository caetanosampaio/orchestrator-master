import React, { useState } from 'react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { friendlyNames } from '../env-view.js';
import Dialog from './Dialog.jsx';
import { Btn, Icon } from './ui.jsx';
import PermissionProfileDialog, { ProfileSeal } from './PermissionProfileDialog.jsx';
import { profileOf } from '../permission-profile.js';

/** Abrir um workspace já cadastrado ou cadastrar um novo (caminho de uma pasta). Usa as mesmas rotas de sempre; nada é executado ao cadastrar. */
export default function WorkspaceDialog({ onClose, onPicked = null }) { // onPicked: chamado quando o usuário escolhe ou cadastra um workspace (o Início o usa para seguir ao Cockpit, mesmo se for o que já estava ativo)
  const { workspaces, state, act, notify } = useStore();
  const [path, setPath] = useState(''), [name, setName] = useState(''), [check, setCheck] = useState(null), [busy, setBusy] = useState(false), [permFor, setPermFor] = useState(null); // permFor: workspace cujo perfil de permissão está aberto (substitui esta lista até fechar)
  const names = friendlyNames(workspaces), activeId = state?.activeWorkspace?.id;

  const open = async (w) => { await act(() => api.post(`/api/workspaces/${w.id}/activate`)); onClose(); onPicked?.(); };
  const validate = async () => { try { setCheck(await api.post('/api/workspaces/validate', { path })); } catch (e) { setCheck({ ok: false, error: e.message }); } };
  const add = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const ws = await api.post('/api/workspaces', { path, name });
      await api.post(`/api/workspaces/${ws.id}/activate`); // um workspace recém-cadastrado já abre o ambiente dele
      notify(`Ambiente "${ws.name}" aberto.`); onClose(); onPicked?.();
    } catch (err) { notify(err.message, 'error'); setCheck({ ok: false, error: err.message }); } finally { setBusy(false); }
    await act(async () => null);
  };

  return (
    permFor ? <PermissionProfileDialog workspace={{ id: permFor.id, name: names.get(permFor.id) }} onClose={() => setPermFor(null)} /> :
    <Dialog title="Arquivos" onClose={onClose} id="ws-dlg">
      {workspaces.length > 0 && (
        <section aria-label="Workspaces cadastrados">
          <h3 className="oc-h">Cadastrados</h3>
          <ul className="oc-wslist">
            {workspaces.map((w) => (
              <li key={w.id} className="pp-wsli">
                <button type="button" className={`oc-wsrow${w.id === activeId ? ' on' : ''}`} onClick={() => open(w)} title={w.path}>
                  <Icon name="workspace" size={16} />
                  <span className="oc-wsrow-t"><b>{names.get(w.id)}</b><span className="mono dim small">{w.path}</span></span>
                  {w.id === activeId ? <span className="oc-pill ok">aberto</span> : <span className="oc-pill">abrir</span>}
                </button>
                <button type="button" className="pp-wsperm" onClick={() => setPermFor(w)} aria-label={`Permissões das missões em ${names.get(w.id)}: perfil ${profileOf(w) === 'bypass' ? 'sem confirmação' : 'padrão'}`} title="Perfil de permissão das missões deste workspace"><ProfileSeal profile={profileOf(w)} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Adicionar workspace">
        <h3 className="oc-h">Adicionar</h3>
        <form onSubmit={add} className="oc-form">
          <label>Caminho da pasta do projeto
            <input className="mono" data-autofocus={workspaces.length === 0 ? '' : undefined} value={path} onChange={(e) => { setPath(e.target.value); setCheck(null); }} placeholder="C:\projetos\meu-repo" required />
          </label>
          <label>Nome (opcional)
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="como aparece na barra lateral" />
          </label>
          {check && (check.ok
            ? <p className="oc-note ok" role="status">Pasta válida · {check.hasGit ? 'repositório Git' : 'sem Git (o isolamento por worktree não estará disponível)'}</p>
            : <p className="oc-note err" role="alert">{check.error}</p>)}
          <div className="oc-actions"><Btn type="button" onClick={validate} disabled={!path.trim()}>Validar</Btn><Btn kind="primary" type="submit" disabled={busy || !path.trim()}>Adicionar e abrir</Btn></div>
        </form>
        <p className="dim small">Os terminais deste ambiente abrem nessa pasta. Cadastrar não executa nada.</p>
      </section>
    </Dialog>
  );
}
