import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { usePrefs, useLayouts, useLayoutMode, useAutoRestore } from '../hooks.js';
import { orderSessions, mergeOrder, sameList, EMPTY as EMPTY_LAYOUT } from '../layout-state.js';
import { historyRows, resumeBody, needsConfigAck, restorePlan, batchSummary, lastShutdownRestore, attemptKey } from '../session-history.js';
import { paneAccountTag, accountsOf, pickAccount } from '../accounts-view.js';
import { Btn, Icon } from './ui.jsx';
import { paneUsage, squadUsage } from '../usage-view.js';
import { createTerminalStream, isOld } from '../terminal-stream.js';
import ProviderLogo from './ProviderLogo.jsx';
import StatusGlyph from './StatusGlyph.jsx';
import { elapsed, shortPath as shortCwd, dropText } from '../forge-shell.js';
import { paneState, pendingByPane, paneName, shapeFor, focusPlacement, evenTracks, dragTracks, dividerAt } from '../env-view.js';
import MaestroPopover from './MaestroPopover.jsx';
import SquadGallery from './SquadGallery.jsx';
import { useSquads } from '../use-squads.js';
import { launchPlan } from '../squads.js';
import { PRESETS } from '../team-view.js';
import { withoutFlowTerminals } from '../flow-terminals.js';

// Presets de equipe (team-view.js): o mesmo fluxo abre 2, 4 ou 6 terminais do Claude Code em paralelo, cada um com o seu papel. Os ids gravados continuam duo/squad/full; só o rótulo do squad de quatro virou "Squad".
export const SQUADS = PRESETS.filter((p) => p.id !== 'builder');
const MAX_CHUNK = 60_000; // o servidor aceita até 64 KB por entrada
const FONT_FAMILY = "'Geist Mono Variable', 'Geist Mono', 'Cascadia Mono', Consolas, monospace";
// Tema do xterm no tom do editor do shell (forge.css: --term-bg): grafite neutro, cursor claro, seleção discreta e ANSI dessaturado.
const THEME = { background: '#1c1c1c', foreground: '#d6d6d6', cursor: '#e8e8e8', cursorAccent: '#1c1c1c', selectionBackground: 'rgba(255, 255, 255, .16)', black: '#2a2a2a', brightBlack: '#6e6e6e', red: '#e06c6c', brightRed: '#f08080', green: '#7cc48a', brightGreen: '#98d4a3', yellow: '#d9b45a', brightYellow: '#e8c878', blue: '#7aa2e0', brightBlue: '#9ab9ea', magenta: '#c08bd8', brightMagenta: '#d2a6e4', cyan: '#6fc1c8', brightCyan: '#8fd2d8', white: '#d6d6d6', brightWhite: '#f4f4f4' };
const STATE_LABEL = { working: 'executando', idle: 'ocioso', done: 'concluído', waiting: 'aguardando', exited: 'encerrado', failed: 'falhou', boot: 'iniciando' };

/** Um pane = um terminal xterm ligado ao PTY do servidor: saída por SSE, entrada e tamanho por POST (nunca WebSocket: passa pela checagem de Host/Origin). */
export function TerminalPane({ session, role, state, waiting, maximized, fontSize, stream, onClose, onMaximize, onFocus }) {
  const { noteInteraction, notify, accounts } = useStore();
  const accTag = paneAccountTag(session, accounts); // só quando o provider do terminal tem mais de uma conta
  const hostRef = useRef(null), termRef = useRef(null), fitRef = useRef(null);
  const id = session.id, running = session.status === 'running';
  const runningRef = useRef(running); runningRef.current = running;
  const [conn, setConn] = useState(() => stream.status?.() ?? 'open');
  useEffect(() => stream.onStatus?.(setConn), [stream]); // 'reconnecting' aparece discreto no cabeçalho
  const [started, setStarted] = useState(false); // false até chegar a primeira saída: o Claude Code leva alguns segundos para iniciar (vários ao mesmo tempo, mais)
  // Autocorreção do tamanho: o PTY nasce com um tamanho padrão (e reabre assim depois de reiniciar o servidor); se o tamanho que o servidor informa diverge do que o xterm ocupa de verdade, reenvia o
  // do xterm sem precisar ampliar/restaurar o painel na mão. Só com o painel visível e depois da 1ª saída; uma tentativa por par de tamanhos (o servidor limita cols/rows: nunca vira laço).
  const syncTried = useRef('');
  useEffect(() => {
    const term = termRef.current, host = hostRef.current;
    if (!term || !host || !running || !started || host.clientWidth <= 40 || host.clientHeight <= 40) return undefined;
    if (term.cols === session.cols && term.rows === session.rows) return undefined;
    const key = `${term.cols}x${term.rows}>${session.cols}x${session.rows}`;
    if (syncTried.current === key) return undefined;
    const t = setTimeout(() => { syncTried.current = key; noteInteraction(id); api.post(`/api/terminals/${id}/resize`, { cols: term.cols, rows: term.rows }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [session.cols, session.rows, running, started, id]); // eslint-disable-line react-hooks/exhaustive-deps -- noteInteraction é estável

  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    const term = new Terminal({ fontFamily: FONT_FAMILY, fontSize, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, theme: THEME, allowProposedApi: false });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host);
    termRef.current = term; fitRef.current = fit;
    const doFit = () => { try { if (host.clientWidth > 40 && host.clientHeight > 40) fit.fit(); } catch { /* sem layout ainda */ } };
    doFit();
    // a fonte web carrega sob demanda: se o xterm mediu a célula com a fonte reserva (no Mac não existem Cascadia/Consolas), as colunas/linhas ficam erradas e o texto desalinha.
    // Quando a Geist Mono chega, força a remedição (o xterm ignora a opção se o valor não muda, por isso o desvio por 'monospace') e reajusta.
    let gone = false;
    try {
      if (document.fonts && !document.fonts.check(`${fontSize}px 'Geist Mono Variable'`)) {
        document.fonts.load(`${fontSize}px 'Geist Mono Variable'`).then(() => { if (gone) return; term.options.fontFamily = 'monospace'; term.options.fontFamily = FONT_FAMILY; doFit(); }).catch(() => {});
      }
    } catch { /* sem a API de fontes: segue com a medição atual */ }

    // entrada: uma fila só, para as teclas chegarem na ordem em que foram digitadas
    let chain = Promise.resolve();
    // Recusa (409 "ainda iniciando", terminal encerrado, rede) não pode ser silenciosa: avisa, no máximo 1 vez a cada 3 s por terminal, e a fila segue na ordem
    let lastWarn = 0;
    const warn = (e) => {
      const now = Date.now(); if (now - lastWarn < 3000) return; lastWarn = now;
      const why = e?.status === 409 ? 'o terminal ainda está iniciando ou já foi encerrado' : e?.message || 'falha de conexão com o servidor';
      notify(`A tecla não foi enviada para "${session.title}": ${why}.`, 'error');
    };
    const send = (data) => { for (let i = 0; i < data.length; i += MAX_CHUNK) { const part = data.slice(i, i + MAX_CHUNK); chain = chain.then(() => api.post(`/api/terminals/${id}/input`, { data: part })).catch(warn); } };
    // tudo que o xterm escreve no PTY (teclas, colar, relatórios de foco e de mouse) é interação da interface: o redesenho que o Claude Code faz em resposta não é trabalho
    // Reconstruir a tela de um terminal que JÁ existia reproduz a saída antiga, e nela estão as PERGUNTAS que o Claude Code fez ao terminal na partida (identificação, posição do cursor,
    // foco). O xterm responderia a todas de novo, e essas respostas chegariam ao Claude Code VIVO como teclas (vários ESC seguidos abrem o seletor de mensagens: o cursor some e as letras
    // são ignoradas). Por isso, durante o replay de um terminal com mais de REPLAY_QUIET_MS de vida o xterm fica mudo. Terminal recém-criado continua respondendo: o Claude Code espera isso.
    let muted = false;
    const inputSub = term.onData((d) => { if (muted) return; noteInteraction(id); if (runningRef.current) send(d); });

    // tamanho: o servidor limita cols/rows; só enviamos quando mudou, com pequeno atraso
    let timer = null, last = '';
    const pushSize = () => { const key = `${term.cols}x${term.rows}`; if (key === last || !runningRef.current) return; last = key; noteInteraction(id); api.post(`/api/terminals/${id}/resize`, { cols: term.cols, rows: term.rows }).catch(() => {}); };
    const sizeSub = term.onResize(() => { clearTimeout(timer); timer = setTimeout(pushSize, 150); });
    const ro = new ResizeObserver(() => doFit()); ro.observe(host);
    timer = setTimeout(pushSize, 200);

    // saída: UMA conexão compartilhada para todos os panes (o navegador limita ~6 por origem); a tela já impressa chega no onReset, então recarregar a página não perde nada
    const unsub = stream.subscribe(id, {
      onReset: (text) => { muted = isOld(session.startedAt); term.reset(); if (text) { term.write(text, () => { muted = false; }); setStarted(true); } else muted = false; },
      onData: (d) => { term.write(d); setStarted(true); },
      onExit: (c) => { term.write(`\r\n\x1b[2m[processo encerrado${c === null || c === undefined ? '' : `, código ${c}`}]\x1b[0m\r\n`); },
    });
    return () => { gone = true; clearTimeout(timer); ro.disconnect(); unsub(); inputSub.dispose(); sizeSub.dispose(); term.dispose(); termRef.current = null; fitRef.current = null; };
  }, [id, stream]); // eslint-disable-line react-hooks/exhaustive-deps -- o tamanho da fonte tem efeito próprio (abaixo): recriar o terminal perderia a tela

  // fonte (preferência): vale na hora, sem recriar o terminal
  useEffect(() => {
    const term = termRef.current; if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    try { fitRef.current?.fit(); } catch { /* sem layout */ }
  }, [fontSize]);

  // ao maximizar/restaurar o espaço muda: reajusta depois do layout
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60); return () => clearTimeout(t); }, [maximized]);

  // Soltar arquivos (do Finder/Explorer ou a miniatura da captura de tela) no terminal: o caminho vai para a entrada do agente. Só no app desktop
  // (o navegador não revela o caminho do arquivo); no navegador avisa em vez de falhar calado.
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const onDragOver = (e) => { if (!hasFiles(e) || !running) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropping) setDropping(true); };
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); setDropping(false);
    if (!running) return;
    const desk = window.forgeDesktop, paths = [...e.dataTransfer.files].map((f) => desk?.pathForFile?.(f) || '').filter(Boolean);
    if (!paths.length) { notify(desk ? 'Não foi possível ler o caminho do arquivo solto.' : 'Soltar arquivos num terminal funciona no app desktop do Forge (o navegador não revela o caminho).', 'error'); return; }
    noteInteraction(id);
    api.post(`/api/terminals/${id}/input`, { data: dropText(paths, desk?.platform) }).then(() => termRef.current?.focus()).catch((err) => notify(`O arquivo não foi enviado para "${session.title}": ${err?.message || 'erro'}.`, 'error'));
  };
  const use = paneUsage(session.usage);
  const boot = running && !started; // ainda sem a primeira saída: o processo existe, mas o Claude Code não terminou de iniciar
  const shown = boot ? 'boot' : state;
  const label = boot ? STATE_LABEL.boot : state === 'exited' ? (session.exitCode === null || session.exitCode === undefined ? 'encerrado' : `encerrado (${session.exitCode})`) : state === 'failed' ? (Number.isInteger(session.exitCode) ? `falhou (${session.exitCode})` : 'erro do agente') : STATE_LABEL[state];
  const nm = paneName(session, role), hasUse = !!session.usage && Number.isFinite(session.usage.total);
  const wait = waiting?.[0], waitText = wait ? String(wait.text ?? wait.note ?? '').replace(/\s+/g, ' ').trim() : '';
  const waitTitle = waiting?.length ? `Aguardando a sua decisão: ${waiting.map((t) => t.text || t.note || t.id).join(' | ')}\nAprove ou recuse no painel do Maestro.` : '';
  return (
    <section className={`oc-pane fx-pane st-${state}${waiting?.length ? ' has-wait' : ''}${maximized ? ' max' : ''}`} aria-label={`Terminal ${session.title}, ${label}${waiting?.length ? ', aguardando a sua decisão' : ''}`} onMouseDownCapture={() => noteInteraction(id)} onFocusCapture={() => noteInteraction(id)} onBlurCapture={() => noteInteraction(id)} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dropping && <div className="fx-drop" aria-hidden="true"><span>Solte para enviar a {session.title}</span></div>}
      <header className="oc-ph fx-ph" onDoubleClick={(e) => { if (!e.target.closest('button')) onMaximize(); }} title={`${session.title}\n${session.cwd}${session.branch ? `\nBranch ${session.branch}` : ''}\npid ${session.pid}`}>
        <span className={`fx-pstate st-${shown}`} role="status" aria-label={label}><StatusGlyph state={shown} size={13} /></span>
        <ProviderLogo id={session.provider || 'claude'} size={13} title={session.providerLabel || 'Claude Code'} />
        <b className="fx-ptitle">{nm.name}</b>
        {nm.role && <span className="fx-chip">{nm.role}</span>}
        <span className="fx-pmeta">{[label, session.model, elapsed(session.startedAt)].filter(Boolean).join(' · ')}</span>
        {waiting?.length > 0 && <span className="fx-chip warn fx-pwait" role="status" title={waitTitle}>{waiting.length > 1 ? `${waiting.length} tarefas aguardando você` : waitText ? `Aguardando você: ${waitText}` : 'Aguardando você'}</span>}
        <span className="oc-pgrow" />
        {conn === 'reconnecting' && <span className="fx-pmeta warn" role="status" title="A conexão com os terminais caiu; tentando de novo automaticamente.">reconectando…</span>}
        {accTag && <span className="fx-chip" title={`Conta: ${accTag}`}><span className="sr">Conta: </span>{accTag}</span>}
        {session.fullAccess === true && <span className="fx-chip warn" title="Acesso total: este agente executa sem pedir confirmação de permissão">acesso total</span>}
        {session.worktreeId && <span className="fx-chip" title={session.branch ? `Worktree próprio na branch ${session.branch}` : 'Roda num worktree próprio'}>{session.branch ? shortCwd(session.branch) : 'worktree'}</span>}
        {hasUse && <span className="fx-pmeta" title={use.title}><span className="sr">Consumo: </span>{use.tokens} tok<span aria-hidden="true"> · </span><span className="sr">custo </span>{use.cost}</span>}
        <span className="fx-pacts">
          {onFocus && <button type="button" className="fx-ibtn sm" onClick={onFocus} aria-label="Colocar este terminal em foco" title="Colocar em foco"><Icon name="fit" size={13} /></button>}
          <button type="button" className="fx-ibtn sm" onClick={onMaximize} aria-label={maximized ? 'Restaurar o terminal' : 'Ampliar o terminal'} title={maximized ? 'Restaurar (duplo clique no cabeçalho)' : 'Ampliar (duplo clique no cabeçalho)'}><Icon name={maximized ? 'restore' : 'fit'} size={13} /></button>
          {onClose && <button type="button" className="fx-ibtn sm close" onClick={onClose} aria-label={running ? 'Encerrar o terminal' : 'Remover o terminal'} title={running ? 'Encerrar' : 'Remover'}><Icon name="close" size={13} /></button>}
        </span>
      </header>
      <div className="oc-pbody" ref={hostRef}>{running && !started && <div className="oc-boot fx-boot" role="status"><StatusGlyph state="boot" size={14} />Iniciando {session.providerLabel || 'o agente'}…</div>}</div>
    </section>
  );
}

/** Divisor arrastável entre duas trilhas (mouse, toque e setas do teclado; duplo clique restaura). */
function Gutter({ axis, index, tracks, onTracks, gridRef, style, label }) {
  const onDown = (e) => {
    e.preventDefault();
    const el = e.currentTarget, g = gridRef.current; if (!g) return;
    el.setPointerCapture?.(e.pointerId);
    const start = tracks, size = axis === 'x' ? g.clientWidth : g.clientHeight, total = start.reduce((s, x) => s + x, 0), p0 = axis === 'x' ? e.clientX : e.clientY;
    g.classList.add('dragging');
    const move = (ev) => onTracks(dragTracks(start, index, (((axis === 'x' ? ev.clientX : ev.clientY) - p0) / size) * total));
    const up = () => { g.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onKey = (e) => {
    const dec = axis === 'x' ? 'ArrowLeft' : 'ArrowUp', inc = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault(); onTracks(dragTracks(tracks, index, e.key === inc ? 0.1 : -0.1));
  };
  return <div className={`oc-gutter ${axis}`} style={style} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'} aria-label={label} tabIndex={0} onPointerDown={onDown} onKeyDown={onKey} onDoubleClick={() => onTracks(evenTracks(tracks.length))} title="Arraste para redimensionar (duplo clique restaura)" />;
}


/** Aba de um terminal na faixa de abas (como as abas de arquivo do Orca): glifo de estado, logo do agente e nome; a ativa é o terminal ampliado. */
function TermTab({ s, state, on, onPick, onClose }) {
  return (
    <div className={`fx-tab${on ? ' on' : ''} st-${state}`} role="presentation">
      <button type="button" role="tab" aria-selected={on} className="fx-tab-b" onClick={onPick} title={`${s.title}${s.model ? ` · ${s.model}` : ''}`}>
        <StatusGlyph state={state} size={12} /><ProviderLogo id={s.provider || 'claude'} size={12} /><span>{s.title}</span>
      </button>
      <button type="button" className="fx-tab-x" onClick={onClose} aria-label={`${s.status === 'running' ? 'Encerrar' : 'Remover'} o terminal ${s.title}`} title={s.status === 'running' ? 'Encerrar' : 'Remover'}><Icon name="close" size={11} /></button>
    </div>
  );
}

export default function TerminalGrid({ onOpenWorkspaces, onOpenSettings, onOpenSessions, stream: shared = null, liveOpen = false, onToggleLive = null, narrow = false, onMenu = null, menuIcon = 'menu', focusRequest = null, onFocusHandled = null, hiddenIds = null }) {
  const { state, notify, terminals, maestro, setMaestro, workingIds, loadTerminals, accounts, lastAccount, loadAccounts } = useStore();
  const [prefs, setPref] = usePrefs();
  const [busy, setBusy] = useState(false);
  // Conta por provider ao abrir terminais: a escolhida no seletor (nesta sessão da tela), senão a última usada (servidor). Sem nenhuma das duas, o servidor escolhe a única ou responde account_required.
  const [chosenAccount, setChosenAccount] = useState({});
  const accountFor = (p) => pickAccount({ accounts, provider: p, chosen: chosenAccount[p], lastUsed: lastAccount });
  const sq = useSquads(); // equipes salvas (/api/team-templates); a gestão delas mora em Configurações > Equipes
  const [launchingId, setLaunchingId] = useState(null);
  const [layouts, layoutActions, layoutsReady] = useLayouts(); // layout por workspace (ordem, ampliado, trilhas), no servidor
  const [restorable, setRestorable] = useState(0); // sessões deste workspace que estavam abertas e podem voltar
  const [autoRestore] = useAutoRestore(); // restaurar sozinho as sessões do último encerramento ao entrar no workspace (liga/desliga em Configurações > Histórico de sessões)
  const attempted = useRef(new Set()), autoBusy = useRef(false); // 'já tentei' por registro+instante: uma sessão não é reaberta em laço nem notificada duas vezes
  const [focusBy, setFocusBy] = useState({}); // workspaceId -> id do terminal em foco (modo Foco)
  const ws = state?.activeWorkspace;
  const own = useMemo(() => (shared ? null : createTerminalStream()), [shared]); // uma conexão SSE para todos os terminais (o Cockpit a compartilha com o painel Live)
  useEffect(() => () => own?.close(), [own]);
  const stream = shared ?? own;
  const waitingBy = useMemo(() => pendingByPane(maestro?.tasks), [maestro]);
  const pendingIds = useMemo(() => new Set(waitingBy.keys()), [waitingBy]);

  const roles = terminals?.roles ?? [], byRole = Object.fromEntries(roles.map((r) => [r.id, r]));
  const isolate = prefs.isolate;
  const providers = terminals?.providers ?? [];
  const provider = providers.find((p) => p.id === prefs.provider && p.available) ? prefs.provider : 'claude'; // agente padrão ao abrir um terminal sem escolha da vaga (os times de Configurações trazem o agente de cada vaga)
  const sessions = useMemo(() => withoutFlowTerminals(terminals?.sessions, hiddenIds), [terminals?.sessions, hiddenIds]); // terminais de missões ficam na página Missões, fora desta grade
  // Sessões do workspace + tópico ativos. As demais seguem rodando e MONTADAS (ocultas): trocar de aba ou de tópico nunca encerra nem remonta terminal.
  const topicId = null; // a interface não usa mais tópicos: o workspace mostra todos os terminais dele e os novos nascem sem tópico
  const where = ws?.displayName || ws?.name || '';
  const L = (ws && layouts[ws.id]) || EMPTY_LAYOUT;
  const mine = ws ? orderSessions(sessions.filter((s) => s.workspaceId === ws.id), L.order) : []; // ordem salva (id da sessão); o DOM não muda de ordem: a posição visual vem do CSS `order`
  const mineIdx = new Map(mine.map((s, i) => [s.id, i]));
  const live = sessions.filter((s) => s.status === 'running').length;
  const liveMine = mine.filter((s) => s.status === 'running').length;
  const room = (terminals?.maxSessions ?? 8) - live;
  const total = squadUsage(mine);
  const [mode] = useLayoutMode(ws?.id); // escolhido em Configurações > Visualização
  const maxId = L.maximized ? (mine.find((s) => s.recordId === L.maximized)?.id ?? null) : null;

  // layout da grade: trilhas por formato (1x1, 2x1, 2x2, 3x2…); ao mudar o número de terminais volta a divisões iguais
  const focusIdx = Math.max(0, mine.findIndex((x) => x.id === (ws && focusBy[ws.id])));
  const focusPlan = mode === 'focus' && !maxId ? focusPlacement(mine.length, focusIdx) : null;
  const shape = maxId || focusPlan ? shapeFor('auto', 1) : shapeFor(mode, mine.length);
  const key = `${shape.cols}x${shape.rows}`;
  const baseLayout = useMemo(() => ({ cols: evenTracks(shape.cols), rows: evenTracks(shape.rows) }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = L.grids[key]; // trilhas salvas POR WORKSPACE e por formato; só valem se baterem com o formato atual
  const cur = saved && saved.cols.length === shape.cols && saved.rows.length === shape.rows ? saved : baseLayout;
  const setAxis = (axis, tracks) => { if (ws) layoutActions.setGrid(ws.id, key, { ...cur, [axis]: tracks }); };

  // ordem dos terminais abertos deste workspace: salva só depois de ler a do servidor; mantém quem não está vivo agora (restauração) e acrescenta os novos
  const liveIds = mine.map((s) => s.recordId).filter(Boolean);
  useEffect(() => {
    if (!ws || !layoutsReady || !liveIds.length) return;
    const next = mergeOrder(L.order, liveIds);
    if (!sameList(next, L.order)) layoutActions.setOrder(ws.id, next);
  }, [ws?.id, layoutsReady, liveIds.join(','), L.order.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // aviso no workspace vazio: há sessões que estavam abertas e podem voltar (usa o histórico que o servidor já mantém)
  useEffect(() => {
    if (!ws || mine.length > 0) { setRestorable(0); return undefined; }
    let alive = true;
    api.get('/api/terminals/history').then((d) => { if (alive) setRestorable(historyRows({ history: d?.sessions, workspaceId: ws.id }).restore.length); }).catch(() => {});
    return () => { alive = false; };
  }, [ws?.id, mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Restauração automática: workspace aberto, sem nenhum terminal, e o servidor diz que há sessões do último encerramento retomáveis. Nunca confirma sozinha a configuração de projeto não revisada.
  useEffect(() => {
    if (!ws || !autoRestore || !layoutsReady || !terminals || mine.length > 0 || autoBusy.current) return undefined;
    let alive = true; const wsId = ws.id;
    (async () => {
      let d; try { d = await api.get('/api/terminals/history'); } catch { return; }
      if (!alive) return;
      const rows = historyRows({ history: d?.sessions, workspaceId: wsId });
      const fresh = lastShutdownRestore(rows.restore).filter((r) => !attempted.current.has(attemptKey(r)));
      if (!fresh.length || autoBusy.current) return;
      const live = (terminals?.sessions ?? []).filter((x) => x.status === 'running').length;
      const plan = restorePlan(orderSessions(fresh, L.order, (r) => r.id), (terminals?.maxSessions ?? 10) - live);
      for (const r of fresh) attempted.current.add(attemptKey(r));
      if (!plan.open.length) return;
      autoBusy.current = true;
      notify(`Restaurando ${plan.open.length} ${plan.open.length === 1 ? 'sessão' : 'sessões'} de ${where} do ponto onde pararam…`);
      const results = [];
      try {
        for (const r of plan.open) {
          try { await api.post('/api/terminals/resume', resumeBody({ recordId: r.id, reopen: r.reopen })); results.push({ row: r, ok: true }); } catch (e) {
            const limit = e?.status === 409 && /Limite de/.test(e.message || '');
            results.push({ row: r, ok: false, error: limit ? 'limite de terminais' : needsConfigAck(e) ? 'precisa da sua confirmação: abra o Histórico' : (e?.message || 'erro') });
            if (limit) break;
          }
        }
      } finally {
        autoBusy.current = false;
        const sum = batchSummary(results, plan.skipped.length); notify(sum.text, sum.kind); loadTerminals();
      }
    })();
    return () => { alive = false; };
  }, [ws?.id, autoRestore, layoutsReady, !!terminals, mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const gridRef = useRef(null);

  const opening = useRef(false); // trava síncrona: dois cliques seguidos nunca abrem duas vezes (o estado `busy` só vale depois da renderização)
  const nextSquad = () => 1 + Math.max(0, ...sessions.map((x) => Number(/ S(\d+)\.\d+$/.exec(x.title)?.[1] ?? 0)));
  /** Abre os terminais. `join` = chave de squad (session.squadId) de um squad ATIVO deste workspace: o terminal entra no worktree dele. Devolve false se não abriu nada por decisão/trava. */
  const open = async (list, { squad = false, join = null, confirmMore = true, provider: useProvider = provider, providers: perSlot = null, models: perModel = null, efforts: perEffort = null, templateId = null, slotIndexes = null } = {}) => {
    if (opening.current) return false;
    if (!ws) { onOpenWorkspaces?.(); return false; }
    if (squad && confirmMore && liveMine > 0 && !window.confirm(`Já há ${liveMine} ${liveMine === 1 ? 'terminal ativo' : 'terminais ativos'} em ${where}. Abrir MAIS ${list.length} terminais de uma nova equipe?`)) return false;
    opening.current = true; setBusy(true);
    const n = squad ? nextSquad() : null;
    if (list.length > 1) notify(`Abrindo ${list.length} terminais; o agente leva alguns segundos para iniciar em cada um.`);
    try {
      // em paralelo: cada terminal é um processo próprio; as falhas são individuais. Os do squad levam o número dele no título (ex.: Construtor S1)
      const editors = list.filter((r) => byRole[r]?.edits).length;
      // Worktree DESLIGADO = automático: o servidor dá worktree próprio a cada agente que edita assim que há mais de um no workspace (qualquer agente); LIGADO = worktree sempre, um squad compartilha UM.
      // time salvo/pronto: `templateId` + `slotIndex` da vaga (sempre os dois juntos) e o servidor aplica as skills e a instrução do time, conferindo papel e agente da vaga
      const slotOfTeam = (i) => (templateId && Number.isInteger(slotIndexes?.[i]) ? { templateId, slotIndex: slotIndexes[i] } : {});
      const accOf = (i) => { const id = accountFor((perSlot && perSlot[i]) || useProvider); return id ? { accountId: id } : {}; };
      const spawn = (r, i, ack, squadId) => api.post('/api/terminals', { role: r, provider: (perSlot && perSlot[i]) || useProvider, ...accOf(i), ...(perModel?.[i] ? { model: perModel[i] } : {}), ...(perEffort?.[i] ? { effort: perEffort[i] } : {}), ...slotOfTeam(i), isolate: isolate ? true : 'auto', ...(!isolate && editors > 1 ? { expectEditors: editors } : {}), ...(squadId ? { squadId } : {}), workspaceId: ws.id, topicId, ...(ack ? { acknowledgeProjectConfig: true } : {}), ...(n ? { title: `${byRole[r]?.label ?? r} S${n}.${i + 1}` } : {}) });
      // Worktree: um squad inteiro compartilha UM worktree. O 1º terminal o cria; os outros entram nele (esperam o 1º para saber o id). Terminal avulso continua com o seu.
      let rs;
      if (isolate && squad && list.length > 1) {
        const head = await Promise.allSettled([spawn(list[0], 0, false)]);
        const squadId = head[0].status === 'fulfilled' ? head[0].value?.session?.squadId : null;
        const tail = squadId ? await Promise.allSettled(list.slice(1).map((r, i) => spawn(r, i + 1, false, squadId))) : list.slice(1).map(() => ({ status: 'rejected', reason: head[0].reason ?? new Error('o worktree do squad não foi criado') }));
        rs = [...head, ...tail];
      } else rs = await Promise.allSettled(list.map((r, i) => spawn(r, i, false, join)));
      // M3: configuração executável do projeto não revisada no Git: o servidor recusa e só abre com a confirmação explícita (uma pergunta para o lote inteiro)
      const held = rs.map((x, i) => (x.status === 'rejected' && x.reason?.code === 'project_config_unreviewed' ? i : -1)).filter((i) => i >= 0);
      if (held.length && window.confirm(`${rs[held[0]].reason.message}\n\nAbrir ${held.length === 1 ? 'o terminal' : `os ${held.length} terminais`} mesmo assim?`)) {
        const again = await Promise.allSettled(held.map((i) => spawn(list[i], i, true)));
        held.forEach((i, k) => { rs[i] = again[k]; });
      }
      for (const x of rs) if (x.status === 'fulfilled' && x.value?.warning) notify(x.value.warning, 'error'); // ex.: sem Git, o isolamento automático não pôde criar o worktree
      const bad = rs.filter((r) => r.status === 'rejected');
      const needAccount = bad.some((x) => x.reason?.code === 'account_required') ? ' Escolha a conta no seletor da barra do workspace.' : bad.some((x) => ['no_account', 'account_disconnected'].includes(x.reason?.code)) ? ' Veja Configurações > Contas.' : '';
      if (bad.length) notify(`${bad.length} de ${list.length} terminais não abriram: ${bad[0].reason?.message ?? 'erro'}${needAccount}`, 'error');
    } finally { opening.current = false; setBusy(false); loadTerminals(); loadAccounts?.(); } // o servidor lembra a última conta usada: relê para o seletor
    return true;
  };
  // ---- equipes ----
  /** Abre um plano { roles, providers, models?, efforts?, teamId, templateId, slotIndexes }: todos os terminais de uma vez, cada um com o agente, o modelo, o esforço e (pelo time) as skills da sua vaga; o preset só é gravado como equipe do workspace quando bate exatamente. */
  const openPlan = async (plan) => { const ran = await open(plan.roles, { squad: plan.roles.length > 1, providers: plan.providers, models: plan.models, efforts: plan.efforts, templateId: plan.templateId, slotIndexes: plan.slotIndexes }); if (ran !== false && ws && plan.teamId) layoutActions.setTeam(ws.id, plan.teamId); return ran; };
  const openSquad = async (s) => { setLaunchingId(s.id); try { await openPlan(launchPlan(s)); } finally { setLaunchingId(null); } };
  const closeAll = async () => {
    if (!mine.length || !window.confirm(`Encerrar os ${mine.length} terminais de ${where}? Os agentes em andamento serão interrompidos (worktrees são mantidos).`)) return;
    setBusy(true);
    const closed = [];
    try { for (const s of mine) { try { await api.post(`/api/terminals/${s.id}/close`); closed.push(s.recordId); } catch { /* segue com os demais */ } } }
    finally { setBusy(false); await loadTerminals(); for (const rid of closed) layoutActions.forget(ws.id, rid); } // esquece DEPOIS de a lista sair da tela: senão o efeito da ordem reacrescenta o id
  };
  const close = async (s) => {
    let closedRid = null;
    try {
      const r = await api.post(`/api/terminals/${s.id}/close`); closedRid = s.recordId;
      if (r?.worktreeId) notify('Terminal encerrado. O worktree dele foi mantido (pode ter trabalho): gerencie em Configurações > Workspaces e Worktrees.');
    } catch (e) { notify(e.message, 'error'); } finally { await loadTerminals(); if (closedRid) layoutActions.forget(ws.id, closedRid); }
  };

  const cell = (s, i, visible) => {
    const span = visible && !maxId && !focusPlan && shape.spanLast && i === mine.length - 1;
    const at = visible && focusPlan ? focusPlan.cells[i] : null, strip = !!at && at.col === 2;
    return (
      <div key={s.id} className={`oc-cell${maxId === s.id ? ' is-max' : ''}${strip ? ' is-strip' : ''}`} hidden={!visible || (!!maxId && maxId !== s.id)} style={{ ...(span ? { gridColumn: '1 / -1' } : {}), ...(at ? { gridColumn: at.col, gridRow: at.row } : {}), order: i }}>
        <TerminalPane session={s} stream={stream} role={byRole[s.role]} state={paneState(s, workingIds, pendingIds)} waiting={waitingBy.get(s.id)} fontSize={prefs.fontSize} maximized={maxId === s.id} onClose={() => close(s)} onMaximize={() => layoutActions.setMaximized(ws.id, maxId === s.id ? null : (s.recordId ?? null))} onFocus={strip ? () => setFocusBy({ ...focusBy, [ws.id]: s.id }) : undefined} />
      </div>
    );
  };
  const showGutters = !maxId && !focusPlan && mine.length > 1;
  const vBottom = shape.spanLast ? `${100 - dividerAt(cur.rows, cur.rows.length - 2)}%` : 0;

  // pedido de abrir um terminal em destaque (clique na sidebar): amplia quando a sessão já é deste workspace
  useEffect(() => {
    if (!focusRequest || !ws) return;
    const s = mine.find((x) => x.id === focusRequest.id);
    if (!s) return;
    if (s.recordId && L.maximized !== s.recordId) layoutActions.setMaximized(ws.id, s.recordId);
    onFocusHandled?.();
  }, [focusRequest, ws?.id, mine.map((x) => x.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeTab = (s) => { if (s.status === 'running' && !window.confirm(`Encerrar o terminal "${s.title}"? O agente em andamento será interrompido.`)) return; close(s); };
  const solo = () => open(['builder'], { squad: false });

  return (
    <div className={`tg fx-cockpit${maxId ? ' tg-full' : ''}`}>
      {/* faixa de abas (como as abas de arquivo do Orca): "Todos" mostra a grade; uma aba por terminal amplia aquele; "+" abre um terminal avulso */}
      <div className="fx-tabs" role="tablist" aria-label={ws ? `Terminais de ${where}` : 'Terminais'}>
        {narrow && onMenu && <button type="button" className="fx-ibtn fx-tabs-menu" onClick={onMenu} aria-label={menuIcon === 'menu' ? 'Abrir a navegação' : 'Mostrar a barra lateral'} title={menuIcon === 'menu' ? 'Navegação' : 'Mostrar a barra lateral'} {...(menuIcon === 'menu' ? { 'aria-haspopup': 'dialog', 'aria-controls': 'nav-drawer' } : {})}><Icon name={menuIcon} size={16} /></button>}
        {ws && mine.length > 0 && (
          <div className={`fx-tab all${!maxId ? ' on' : ''}`} role="presentation">
            <button type="button" role="tab" aria-selected={!maxId} className="fx-tab-b" onClick={() => maxId && layoutActions.setMaximized(ws.id, null)} title="Todos os terminais lado a lado"><Icon name="cockpit" size={13} /><span>Todos</span><span className="fx-n">{mine.length}</span></button>
          </div>
        )}
        {ws && mine.map((s) => <TermTab key={s.id} s={s} state={paneState(s, workingIds, pendingIds)} on={maxId === s.id} onPick={() => layoutActions.setMaximized(ws.id, maxId === s.id ? null : (s.recordId ?? null))} onClose={() => closeTab(s)} />)}
        {ws && <button type="button" className="fx-ibtn fx-tab-add" onClick={solo} disabled={busy || room <= 0} aria-label="Abrir um terminal" title={room <= 0 ? 'Limite de terminais atingido' : `Abrir um terminal (${providers.find((p) => p.id === provider)?.label ?? 'Claude Code'})`}><Icon name="plus" size={14} /></button>}
        <span className="grow" />
        {onToggleLive && <button type="button" className={`fx-ibtn${liveOpen ? ' on' : ''}`} onClick={onToggleLive} aria-pressed={liveOpen} aria-label={liveOpen ? 'Fechar o painel Live' : 'Abrir o painel Live'} title={liveOpen ? 'Fechar o painel Live' : 'Painel Live: preview do localhost e a equipe em tempo real'}><Icon name="panel" size={15} /></button>}
      </div>

      {ws && <div className="oc-bar tbx fx-path" role="toolbar" aria-label={`Controles dos terminais de ${where}`}>
        <span className="fx-crumb" title={ws.path}><b>{where}</b><span className="fx-crumb-sep" aria-hidden="true">/</span><span className="fx-crumb-p">{shortCwd(ws.path)}</span></span>
        {/* Controles operacionais (à direita). O workspace ("Arquivos") fica na sidebar; equipes, visualização e histórico, em Configurações */}
        <div className="tbx-g tbx-end">
            <label className="oc-iso fx-switch" title="Desligado (automático): cada agente que edita ganha um worktree Git próprio assim que há mais de um no workspace, sem conflito de arquivos (sem Git, abre na pasta normal e avisa). Ligado: sempre worktree, e um squad inteiro compartilha UM (os terminais do squad editam os mesmos arquivos). Exige repositório Git.">
              <input type="checkbox" role="switch" checked={isolate} onChange={(e) => setPref('isolate', e.target.checked)} /><span className="oc-switch-track" aria-hidden="true"><i /></span>Worktree
            </label>
            {/* Seletor de conta: só para a IA com MAIS de uma conta (com uma só, o servidor usa ela). Vale para os próximos terminais desta IA, avulsos ou de equipe. */}
            {providers.filter((p) => p.available && accountsOf(accounts, p.id).length > 1).map((p) => {
              const cur = accountFor(p.id) ?? '';
              return (
                <label key={p.id} className="acc-tbx" title={`Conta do ${p.label} nos próximos terminais`}>
                  <ProviderLogo id={p.id} size={12} />
                  <select value={cur} aria-label={`Conta do ${p.label} nos próximos terminais`} onChange={(e) => setChosenAccount((c) => ({ ...c, [p.id]: e.target.value || null }))}>
                    {!cur && <option value="">Escolher conta…</option>}
                    {accountsOf(accounts, p.id).map((a) => <option key={a.id} value={a.id}>{a.label}{a.home === 'machine' ? ' (deste computador)' : ''}</option>)}
                  </select>
                </label>
              );
            })}
            {total.panes > 0 && <span className="oc-total" title={total.partialCost ? 'Há panes sem custo conhecido: o total em dólares não é exibido. Crie data/pricing.json com os preços por modelo (USD por milhão de tokens) para ver o custo.' : total.cost === '—' ? 'Custo indisponível: crie data/pricing.json com os preços por modelo (USD por milhão de tokens).' : 'Soma dos terminais deste workspace'}>{total.tokens} tok · {total.cost}</span>}
            {mine.length > 1 && <Btn kind="quiet" disabled={busy} onClick={closeAll} title="Encerrar todos os terminais deste workspace (pede confirmação)" aria-label="Encerrar todos">Encerrar<span className="tbx-l"> todos</span></Btn>}
            {maestro && (maestro.autonomous || maestro.tasks.length > 0 || mine.some((x) => x.role === 'maestro' && x.status === 'running')) && <MaestroPopover onOpenSettings={onOpenSettings} />}
        </div>
      </div>}

      {!ws ? (
        <div className="oc-empty">
          <span className="oc-empty-ico"><Icon name="folderPlus" size={26} /></span>
          <h3>Escolha um workspace</h3>
          <p className="dim">Cada ambiente é uma pasta de projeto. Os terminais dos agentes abrem nela.</p>
          <Btn kind="primary" onClick={onOpenWorkspaces}>Abrir ou adicionar workspace</Btn>
        </div>
      ) : mine.length === 0 ? (
        <div className="oc-empty min has-squads">
          <Icon name="terminal" size={18} />
          <h3>{where}</h3>
          <p className="dim">Nenhum terminal ativo. Abra uma equipe com um clique.</p>
          <SquadGallery mine={sq.missing ? [] : sq.squads} mineTitle="Times prontos" mineHint="os que você instalou ou montou em Configurações" byRole={byRole} providers={providers} busy={busy} launchingId={launchingId} room={room} onOpen={openSquad} onManage={() => onOpenSettings?.('equipes')}
            empty={<div className="oc-noteams"><b>{sq.ready ? 'Nenhum time pronto ainda' : 'Carregando os times…'}</b><p className="dim small">Os times que abrem aqui vêm de Configurações. Instale um time pronto ou monte o seu, e escolha qual abrir em cada workspace.</p>{sq.ready && <Btn kind="primary" onClick={() => onOpenSettings?.('equipes')}>Abrir Times prontos</Btn>}</div>} />
          {restorable > 0 && <div className="oc-empty-act"><Btn kind="quiet" onClick={() => onOpenSessions?.()} title="Abre as Sessões para retomá-las, na ordem em que estavam">Restaurar {restorable} {restorable === 1 ? 'sessão' : 'sessões'}</Btn></div>}
          <p className="dim small oc-foot">Os terminais <b>não passam</b> pelas aprovações do ciclo automático: o que o agente faz ali é decisão sua.</p>
        </div>
      ) : null}

      <div className="oc-gridwrap" hidden={mine.length === 0}>
        <div ref={gridRef} className={`oc-grid${maxId ? ' has-max' : ''}`} style={focusPlan ? { gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gridTemplateRows: `repeat(${focusPlan.rows}, minmax(0, 1fr))` } : { gridTemplateColumns: cur.cols.map((f) => `minmax(0, ${f}fr)`).join(' '), gridTemplateRows: cur.rows.map((f) => `minmax(0, ${f}fr)`).join(' ') }}>
          {sessions.map((s) => cell(s, mineIdx.get(s.id) ?? -1, mineIdx.has(s.id)))} {/* ordem estável: o React não move (nem remonta) os terminais ao trocar de aba ou tópico */}
          {showGutters && cur.cols.slice(0, -1).map((_, i) => <Gutter key={`x${i}`} axis="x" index={i} tracks={cur.cols} onTracks={(t) => setAxis('cols', t)} gridRef={gridRef} label={`Redimensionar colunas ${i + 1} e ${i + 2}`} style={{ left: `calc(${dividerAt(cur.cols, i)}% - 5px)`, top: 0, bottom: vBottom }} />)}
          {showGutters && cur.rows.slice(0, -1).map((_, i) => <Gutter key={`y${i}`} axis="y" index={i} tracks={cur.rows} onTracks={(t) => setAxis('rows', t)} gridRef={gridRef} label={`Redimensionar linhas ${i + 1} e ${i + 2}`} style={{ top: `calc(${dividerAt(cur.rows, i)}% - 5px)`, left: 0, right: 0 }} />)}
        </div>
      </div>
    </div>
  );
}
