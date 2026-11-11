import React from 'react';
import { useStore } from '../store.jsx';
import { useLayouts, useAutoRestore } from '../hooks.js';
import { SessionHistoryBody } from './SessionHistory.jsx';
import Dialog from './Dialog.jsx';

/**
 * Sessões: o histórico de sessões de terminal do workspace aberto, para retomar (abre pelo botão Sessões, no rodapé da barra lateral do Cockpit, e pelo "Restaurar N sessões" do estado vazio).
 * É o mesmo conteúdo que ficava em Configurações > Histórico de sessões, com o interruptor da restauração automática.
 */
export default function SessionsDialog({ onClose }) {
  const { state } = useStore();
  const [layouts] = useLayouts(), [autoRestore, setAutoRestore] = useAutoRestore();
  const ws = state?.activeWorkspace ?? null, name = ws ? (ws.displayName || ws.name) : '';
  return (
    <Dialog title={ws ? `Sessões · ${name}` : 'Sessões'} onClose={onClose} size="lg" id="sess-dlg">
      <div className="sess-body">
        {ws
          ? <SessionHistoryBody ws={ws} topicId={null} where={name} order={layouts[ws.id]?.order ?? []} autoRestore={autoRestore} onAutoRestore={setAutoRestore} />
          : <p className="dim small">Abra um workspace para ver o histórico de sessões dele.</p>}
      </div>
    </Dialog>
  );
}
