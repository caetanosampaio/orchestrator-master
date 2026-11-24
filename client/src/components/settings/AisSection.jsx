import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useStore } from '../../store.jsx';
import { providerSummary } from '../../env-view.js';
import { providerStatus, withAccountsLogin } from '../../provider-view.js';
import { accountsOf } from '../../accounts-view.js';
import { plannedAis, aiName } from '../../provider-catalog.js';
import { slotOptions } from '../../squads.js';
import { useSquads } from '../../use-squads.js';
import { AiIcon } from '../ProviderLogo.jsx';
import { Btn } from '../ui.jsx';
import { Row, Card, Block } from './SettingsUi.jsx';

/**
 * Configurações > Suas IAs (no formato da tela "Suas IAs" de referência, em preto; cada IA aparece com o ÍCONE oficial dela, não com o mascote): "Ligadas agora" = os agentes instalados de verdade (Claude Code e Codex CLI, de GET /api/terminals), com o estado real;
 * clicar num cartão mostra os detalhes logo abaixo. "Para ligar" = as outras IAs, que o FORGE ainda NÃO integra: aparecem só para acompanhar o que pode vir, sem botão que finja ligar.
 */
function Detail({ row, go, accounts }) {
  const { state, refresh } = useStore();
  const mine = accountsOf(accounts, row.id), on = mine.filter((a) => a.status?.loggedIn === true).length;
  const [checking, setChecking] = useState(false);
  const ex = state?.executor, st = providerStatus(row);
  const { options } = useSquads();
  const o = slotOptions(options, row.id);
  const recheck = async () => { setChecking(true); try { await refresh(); } finally { setChecking(false); } };
  return (
    <Card className="ai-detail">
      <div className="ai-detail-h">
        <AiIcon id={row.id} size={40} />
        <div><b>{aiName(row.id, row.label)}</b><span className="dim small">{row.id === 'claude' ? 'Agente padrão dos terminais.' : 'Ao lado do Claude Code, no mesmo Maestro.'}</span></div>
        <span className={`oc-pill${st.kind === 'ok' ? ' ok' : st.kind === 'bad' ? ' bad' : ''}`}>{st.text}</span>
      </div>
      <Row title="Terminais" hint="Quantos terminais deste agente estão abertos agora.">{row.active > 0 ? `${row.active} ${row.active === 1 ? 'aberto' : 'abertos'}` : 'nenhum aberto'}</Row>
      <Row title="Modelos e esforço" hint="O que dá para escolher por vaga em Times prontos.">{o ? `${o.models.length} ${o.models.length === 1 ? 'modelo' : 'modelos'} · ${o.efforts.length} ${o.efforts.length === 1 ? 'nível' : 'níveis'}` : 'padrão da CLI'}</Row>
      {row.id === 'claude' && <>
        <Row title="Claude Code CLI" hint="Os terminais executam o comando claude encontrado no PATH, com o seu login e as suas permissões.">
          {!state ? <span className="dim">verificando…</span> : ex?.available
            ? <span className="oc-state ok"><i aria-hidden="true" />Detectado{ex.version ? ` · ${ex.version}` : ''}</span>
            : <span className="oc-state bad"><i aria-hidden="true" />Não encontrado no PATH</span>}
        </Row>
        {state && !ex?.available && <p className="oc-note err" role="status">Instale o Claude Code, entre com o seu login rodando <span className="mono">claude</span> uma vez num terminal e verifique de novo.</p>}
        <Row title="Verificar de novo" hint="A detecção é guardada por alguns segundos."><Btn onClick={recheck} disabled={checking}>{checking ? 'Verificando…' : 'Verificar'}</Btn></Row>
        <Row title="Permissões" hint="O terminal interativo pede permissões no próprio terminal. Quando o projeto tem configuração do Claude Code que executa comandos e não está revisada no Git, o FORGE pede a sua confirmação antes de abrir." />
      </>}
      {row.id === 'codex' && <Row title="Codex CLI" hint="Instale com npm i -g @openai/codex e entre com codex login no terminal. O FORGE usa a conta do Codex deste computador; retomada de sessão ainda não existe para o Codex." />}
      <Row title="Contas" hint={row.id === 'claude' ? 'Entre com mais de uma conta e escolha qual cada terminal usa.' : 'As contas desta IA que o FORGE usa.'}>
        <span className="dim small">{!accounts ? 'verificando…' : mine.length ? `${mine.length} ${mine.length === 1 ? 'conta' : 'contas'} · ${on} ${on === 1 ? 'conectada' : 'conectadas'}` : 'nenhuma conta'}</span>{' '}
        <Btn onClick={() => go('accounts')}>Gerenciar contas</Btn>
      </Row>
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
  return (
    <>
      <Block title="Ligadas agora" hint="Clique para ver os detalhes." id="ais-on">
        {!rows ? <p className="dim small">Consultando os agentes instalados…</p> : installed.length === 0
          ? <p className="oc-note err" role="status">Nenhum agente instalado. Instale o Claude Code ou o Codex CLI e verifique de novo.</p>
          : <div className="ai-cards" role="group" aria-label="Agentes instalados">
            {installed.map((r) => {
              const st = providerStatus(r);
              return (
                <button key={r.id} type="button" className={`ai-card${current?.id === r.id ? ' on' : ''}`} aria-pressed={current?.id === r.id} onClick={() => setSel(r.id)}>
                  <AiIcon id={r.id} size={32} />
                  <b className="ai-card-n">{aiName(r.id, r.label)}</b>
                  <span className="dim small">{st.text}{r.active > 0 ? ` · ${r.active} ${r.active === 1 ? 'terminal' : 'terminais'}` : ''}</span>
                </button>
              );
            })}
          </div>}
      </Block>
      {current && <Detail row={current} go={go} accounts={accounts} />}
      <Block title="Para ligar" hint="IAs que o FORGE ainda não integra. Aparecem aqui para você acompanhar o que pode vir." id="ais-next">
        <ul className="ai-next" aria-label="IAs ainda não integradas">
          {plannedAis().map((a) => (
            <li key={a.id} className="ai-next-i" style={{ '--pm': a.color }}>
              <AiIcon id={a.id} size={26} />
              <b className="ai-card-n">{a.label}</b>
              <span className="dim small">em breve</span>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}
