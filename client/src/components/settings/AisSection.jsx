import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { providerSummary } from '../../env-view.js';
import { providerStatus, withAccountsLogin } from '../../provider-view.js';
import { accountsOf } from '../../accounts-view.js';
import { plannedAis, aiShortName } from '../../provider-catalog.js';
import { slotOptions } from '../../squads.js';
import { useSquads } from '../../use-squads.js';
import { AiIcon } from '../ProviderLogo.jsx';
import { Btn } from '../ui.jsx';
import { Row, Card, Block } from './SettingsUi.jsx';

/**
 * Configurações > Suas IAs, enxuta: cada IA com o ÍCONE oficial (pequeno) e só o nome dela ("Claude", "Codex"). "Ligadas agora" = os agentes instalados de verdade
 * (de GET /api/terminals), com um ponto de estado (o texto do estado fica no título e nos detalhes); clicar num cartão mostra os detalhes logo abaixo.
 * "Para instalar" = as que o servidor já integra mas não achou no PATH (Gemini, OpenCode, Cursor…), com o comando de instalação. As integradas no nível 1 (sem o Maestro:
 * capabilities.mcp === false) abrem só como terminal livre pelo "+" do Cockpit, e o detalhe diz isso.
 * "Para ligar" = as outras IAs, que o FORGE ainda NÃO integra (em breve): aparecem só para acompanhar o que pode vir, sem botão que finja ligar.
 */
function Detail({ row, go, accounts }) {
  const { state, refresh } = useStore();
  const mine = accountsOf(accounts, row.id), on = mine.filter((a) => a.status?.loggedIn === true).length;
  const [checking, setChecking] = useState(false);
  const ex = state?.executor, st = providerStatus(row);
  const { options } = useSquads();
  const o = slotOptions(options, row.id);
  const recheck = async () => { setChecking(true); try { await refresh(); } finally { setChecking(false); } };
  const free = row.capabilities?.mcp === false; // integrada no nível 1: só terminal
  const unverified = !free && row.capabilities?.mcpVerified === false; // nível 2 ainda não verificado com a CLI real (Gemini, Cursor)
  const tasksOnly = !free && (row.capabilities?.state === false || row.capabilities?.rolePrompt === false); // Cursor: só nas vagas que recebem tarefas
  const extra = row.id !== 'claude' && row.id !== 'codex';
  return (
    <Card className="ai-detail">
      <div className="ai-detail-h">
        <AiIcon id={row.id} size={26} />
        <div><b>{aiShortName(row.id, row.label)}</b><span className="dim small">{row.id === 'claude' ? 'Agente padrão dos terminais.' : free ? 'Terminal livre: ainda não conversa com o Maestro.' : tasksOnly ? 'Recebe tarefas do Maestro (a confirmar na prática).' : unverified ? 'Conversa com o Maestro (a confirmar na prática).' : 'Ao lado do Claude Code, no mesmo Maestro.'}</span></div>
        <span className={`oc-pill${st.kind === 'ok' ? ' ok' : st.kind === 'bad' ? ' bad' : ''}`}>{st.text}</span>
      </div>
      <Row title="Terminais" hint="Quantos terminais deste agente estão abertos agora.">{row.active > 0 ? `${row.active} ${row.active === 1 ? 'aberto' : 'abertos'}` : 'nenhum aberto'}</Row>
      <Row title="Modelos e esforço" hint="O que dá para escolher por vaga em Times prontos.">{o ? `${o.models.length} ${o.models.length === 1 ? 'modelo' : 'modelos'} · ${o.efforts.length} ${o.efforts.length === 1 ? 'nível' : 'níveis'}` : 'padrão da CLI'}</Row>
      {row.id === 'claude' && <>
        <Row title="Instalação" hint="Os terminais executam o comando claude encontrado no PATH, com o seu login e as suas permissões.">
          {!state ? <span className="dim">verificando…</span> : ex?.available
            ? <span className="oc-state ok"><i aria-hidden="true" />Detectado{ex.version ? ` · ${ex.version}` : ''}</span>
            : <span className="oc-state bad"><i aria-hidden="true" />Não encontrado no PATH</span>}
        </Row>
        {state && !ex?.available && <p className="oc-note err" role="status">Instale o Claude Code, entre com o seu login rodando <span className="mono">claude</span> uma vez num terminal e verifique de novo.</p>}
        <Row title="Verificar de novo" hint="A detecção é guardada por alguns segundos."><Btn onClick={recheck} disabled={checking}>{checking ? 'Verificando…' : 'Verificar'}</Btn></Row>
        <Row title="Permissões" hint="O terminal interativo pede permissões no próprio terminal. Quando o projeto tem configuração do Claude Code que executa comandos e não está revisada no Git, o FORGE pede a sua confirmação antes de abrir." />
      </>}
      {row.id === 'codex' && <Row title="Instalação" hint="Instale com npm i -g @openai/codex e entre com codex login no terminal. O FORGE usa a conta do Codex deste computador; retomada de sessão ainda não existe para o Codex." />}
      {extra && <>
        <Row title="Instalação" hint="Encontrada no PATH. O login é feito na própria CLI, ao abrir o terminal."><span className="oc-state ok"><i aria-hidden="true" />Detectada</span></Row>
        {free && <Row title="Coordenação" hint="Abre como terminal livre pelo + do Cockpit. Missões, times e o Maestro ficam para quando a coordenação for verificada com a CLI real." />}
        {unverified && tasksOnly && <Row title="Coordenação" hint={`Entra em times, nas vagas que recebem tarefas (não como Maestro nem em etapas de missão: o FORGE não consegue passar o papel a ele nem saber quando está livre). O Maestro só manda tarefa depois que o terminal se conecta de fato.${row.id === 'cursor' ? ' Ao abrir o primeiro terminal, o FORGE grava a entrada forge-maestro no ~/.cursor/mcp.json (sem porta nem token, com cópia de segurança); na primeira vez, o Cursor pode pedir para aprovar esse servidor no próprio terminal.' : ''}`} />}
        {unverified && !tasksOnly && <Row title="Coordenação" hint="Entra em times, missões e no Maestro, mas a ligação com o Maestro ainda não foi verificada com a CLI real: o Maestro só manda tarefa a um terminal depois que ele se conecta de fato. O papel do terminal chega no primeiro pedido de cada sessão. Não abre o planejador de missão." />}
        {row.note && <Row title="Permissões" hint={row.note} />}
      </>}
      {(!extra || mine.length > 0) && <Row title="Contas" hint={row.id === 'claude' ? 'Entre com mais de uma conta e escolha qual cada terminal usa.' : 'As contas desta IA que o FORGE usa.'}>
        <span className="dim small">{!accounts ? 'verificando…' : mine.length ? `${mine.length} ${mine.length === 1 ? 'conta' : 'contas'} · ${on} ${on === 1 ? 'conectada' : 'conectadas'}` : 'nenhuma conta'}</span>{' '}
        <Btn onClick={() => go('accounts')}>Gerenciar contas</Btn>
      </Row>}
    </Card>
  );
}

export function AisSection({ go }) {
  const { terminals, workingIds } = useStore();
  const [sel, setSel] = useState(null);
  // Login por provider vem das contas dele (com status). Uma leitura ao abrir: o status custa uma consulta à CLI por conta (com cache no servidor).
  const [accounts, setAccounts] = useState(null);
  useEffect(() => { let off = false; api.get('/api/accounts').then((d) => { if (!off) setAccounts(Array.isArray(d?.accounts) ? d.accounts : []); }).catch(() => { if (!off) setAccounts([]); }); return () => { off = true; }; }, []);
  const rows = Array.isArray(terminals?.providers) ? providerSummary(terminals.sessions ?? [], workingIds, withAccountsLogin(terminals.providers, accounts)) : null;
  const installed = (rows ?? []).filter((r) => r.available !== false), current = installed.find((r) => r.id === sel) ?? installed[0] ?? null;
  const toInstall = (rows ?? []).filter((r) => r.available === false && typeof r.install === 'string'); // integradas pelo servidor, ainda não instaladas
  return (
    <>
      <Block title="Ligadas agora" hint="Clique para ver os detalhes." id="ais-on">
        {!rows ? <p className="dim small">Consultando os agentes instalados…</p> : installed.length === 0
          ? <p className="oc-note err" role="status">Nenhum agente instalado. Instale o Claude Code ou o Codex CLI e verifique de novo.</p>
          : <div className="ai-cards" role="group" aria-label="Agentes instalados">
            {installed.map((r) => {
              const st = providerStatus(r);
              return (
                <button key={r.id} type="button" className={`ai-card${current?.id === r.id ? ' on' : ''}`} aria-pressed={current?.id === r.id} onClick={() => setSel(r.id)} title={st.text}>
                  <AiIcon id={r.id} size={20} />
                  <b className="ai-card-n">{aiShortName(r.id, r.label)}</b>
                  <i className={`ai-dot ${st.kind}`} aria-hidden="true" /><span className="sr">{st.text}</span>
                </button>
              );
            })}
          </div>}
      </Block>
      {current && <Detail row={current} go={go} accounts={accounts} />}
      {toInstall.length > 0 && <Block title="Para instalar" hint="O FORGE já abre estas IAs num terminal: instale a CLI e verifique de novo." id="ais-install">
        <ul className="ai-install" aria-label="IAs integradas que ainda não estão instaladas">
          {toInstall.map((r) => (
            <li key={r.id}>
              <AiIcon id={r.id} size={16} />
              <span className="ai-card-n">{aiShortName(r.id, r.label)}</span>
              <code className="mono" title="Comando de instalação (rode num terminal)">{r.install}</code>
            </li>
          ))}
        </ul>
      </Block>}
      <Block title="Para ligar" hint="IAs que o FORGE ainda não integra. Aparecem aqui para você acompanhar o que pode vir." id="ais-next">
        <ul className="ai-next" aria-label="IAs ainda não integradas">
          {plannedAis((rows ?? []).map((r) => r.id)).map((a) => (
            <li key={a.id} className="ai-next-i" title={`${a.label}: em breve`}>
              <AiIcon id={a.id} size={16} />
              <span className="ai-card-n">{a.label}</span>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}
