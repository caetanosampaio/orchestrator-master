import React, { useEffect, useRef, useState } from 'react';
import PetCreature from '../PetCreature.jsx';
import { usePet, petActions } from '../../use-pet.js';
import {
  TIMING, MAX_HEARTS, NAME_MAX, STAGE_LABEL, FORM_LABEL, GAME_ROUNDS, GAME_WIN,
  mood as moodOf, speech, ageLabel, feedMeal, clean, medicine, toggleLight, pat, rename, newGame, playRound, finishGame, canPlay,
} from '../../pet.js';
import '../../pet.css';

/** Ícones da telinha (traço simples, do zero). */
const ICONS = {
  food: <path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7M9 3v7M17 3c-2 2-2 6 0 8v10" />,
  light: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></>,
  play: <><circle cx="12" cy="12" r="8" /><path d="M5 9c4 2 10 2 14 0M5 15c4-2 10-2 14 0" /></>,
  medicine: <><rect x="4" y="9" width="16" height="7" rx="3.5" transform="rotate(-40 12 12.5)" /><path d="M9.6 8.4l5 5" /></>,
  clean: <><path d="M14 3l-4 9" /><path d="M6 13h10l2 8H4z" /><path d="M8 17v3M12 17v3" /></>,
  status: <><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></>,
  attention: <><path d="M12 4v10" /><circle cx="12" cy="19" r="1.2" /></>,
};
const MENU = [
  { id: 'food', label: 'Comer' }, { id: 'light', label: 'Luz' }, { id: 'play', label: 'Brincar' }, { id: 'medicine', label: 'Remédio' },
  { id: 'clean', label: 'Limpar' }, { id: 'status', label: 'Status' },
];
const Ico = ({ id, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[id]}</svg>;
const Hearts = ({ n, label }) => (
  <span className="pt-hearts" role="img" aria-label={`${label}: ${n} de ${MAX_HEARTS}`}>
    {Array.from({ length: MAX_HEARTS }, (_, i) => <svg key={i} viewBox="0 0 24 24" className={i < n ? 'on' : ''} aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>)}
  </span>
);

/** Efeito curto sobre a criatura depois de uma ação (comer, carinho, limpar...). */
const FX = { eat: '🍙', treat: '🍬', love: '♥', giggle: '♪', clean: '✦', heal: '✚', win: '★', lose: '…', no: '✕', wake: '☀', sleep: 'z', wobble: '' };

/**
 * Configurações > Bichinho: um aparelhinho estilo Tamagotchi com uma criatura NOVA (vetor, não os mascotes antigos). Tela com os ícones do menu, três botões (A escolhe,
 * B confirma, C volta), e ao lado o nome, os corações e como cuidar. Os petiscos vêm do trabalho dos seus agentes. O estado é do servidor (use-pet.js).
 */
export function PetSection() {
  const { pet, treats, loaded, error } = usePet();
  const [screen, setScreen] = useState('home'); // home | food | game | status
  const [sel, setSel] = useState(-1), [opt, setOpt] = useState(0), [page, setPage] = useState(0);
  const [fx, setFx] = useState(null), [msg, setMsg] = useState('');
  const [game, setGame] = useState(null), [facing, setFacing] = useState('front');
  const [name, setName] = useState(null);
  const dev = useRef(null), fxTimer = useRef(null);
  useEffect(() => () => clearTimeout(fxTimer.current), []);
  const isEgg = pet?.stage === 'egg', [, redraw] = useState(0);
  useEffect(() => { if (!isEgg) return undefined; const t = setInterval(() => redraw((x) => x + 1), 1000); return () => clearInterval(t); }, [isEgg]); // o ovo racha aos poucos: redesenha a cada segundo enquanto choca

  if (!loaded) return <p className="dim small" role="status">Procurando o seu bichinho…</p>;
  if (error && !pet) return <p className="oc-note err" role="alert">{error}</p>;
  if (!pet) return null;

  const m = moodOf(pet), egg = pet.stage === 'egg';
  const crack = egg ? Math.min(1, (Date.now() - Date.parse(pet.eggAt)) / TIMING.hatch) : 0;
  const show = (r, okText = '') => {
    setMsg(r.ok ? okText : r.message || '');
    clearTimeout(fxTimer.current); setFx({ id: r.effect, at: Date.now() });
    fxTimer.current = setTimeout(() => setFx(null), 1400);
  };
  const home = () => { setScreen('home'); setGame(null); setFacing('front'); };

  const run = (id) => {
    setMsg('');
    if (id === 'food') { if (egg) return show({ ok: false, effect: 'no', message: 'Ele ainda está no ovo.' }); setScreen('food'); setOpt(0); return undefined; }
    if (id === 'light') return show(petActions.apply(toggleLight), pet.asleep ? 'Bom dia!' : 'Boa noite…');
    if (id === 'medicine') return show(petActions.apply(medicine), 'Melhorou!');
    if (id === 'clean') return show(petActions.apply(clean), 'Tudo limpinho.');
    if (id === 'status') { setScreen('status'); setPage(0); return undefined; }
    if (id === 'play') { const c = canPlay(pet); if (!c.ok) return show({ ok: false, effect: 'no', message: c.message }); setGame(newGame()); setScreen('game'); return undefined; }
    return undefined;
  };
  const eat = async (which) => {
    home();
    if (which === 0) return show(petActions.apply(feedMeal), 'Nham!');
    const r = await petActions.eatTreat(); return show(r, 'Que delícia!');
  };
  const guess = (side) => {
    if (!game || game.over) return;
    const actual = Math.random() < 0.5 ? 'left' : 'right';
    const g = playRound(game, side, actual); setGame(g); setFacing(actual);
    if (g.over) { const r = petActions.apply(finishGame, g); setTimeout(() => { home(); show(r, r.won ? `Ganhou! ${g.hits} de ${GAME_ROUNDS}.` : `Não foi dessa vez: ${g.hits} de ${GAME_ROUNDS}.`); }, 900); }
  };

  // botões físicos
  const A = () => {
    if (screen === 'home') setSel((s) => (s + 1) % MENU.length);
    else if (screen === 'food') setOpt((o) => (o + 1) % 2);
    else if (screen === 'status') setPage((p) => (p + 1) % 2);
    else if (screen === 'game') guess('left');
  };
  const B = () => {
    if (screen === 'home') { if (sel >= 0) run(MENU[sel].id); else show(petActions.apply(pat), ''); }
    else if (screen === 'food') eat(opt);
    else if (screen === 'status') home();
    else if (screen === 'game') guess('right');
  };
  const C = () => { if (screen !== 'home') home(); else setSel(-1); setMsg(''); };
  const onKey = (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); if (screen === 'game') guess('right'); else A(); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); if (screen === 'game') guess('left'); else if (screen === 'home') setSel((s) => (s <= 0 ? MENU.length - 1 : s - 1)); else A(); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); B(); }
    else if (k === 'Escape') { e.preventDefault(); C(); }
  };

  const walking = screen === 'home' && !egg && !pet.asleep && !pet.sick && m.id !== 'tired';
  const line = msg || (screen === 'home' ? speech(pet) : screen === 'food' ? 'A: trocar · B: dar' : screen === 'game' ? `Para que lado ele vai olhar? A ← · B → (${game?.round ?? 0}/${GAME_ROUNDS})` : 'A: próxima página · B/C: voltar');
  const saveName = (e) => { e.preventDefault(); petActions.apply((p) => ({ ok: true, effect: 'love', pet: rename(p, name ?? '') })); setName(null); };
  const title = pet.name || (egg ? 'Ovo misterioso' : 'Sem nome');

  return (
    <div className="pt">
      <div className="pt-device-wrap">
        <div className="pt-device" ref={dev} tabIndex={0} onKeyDown={onKey} role="group" aria-label={`Bichinho ${title}: use as setas para escolher, Enter para confirmar e Esc para voltar`}>
          <span className="pt-chain" aria-hidden="true" />
          <div className="pt-bezel">
            <div className={`pt-screen${pet.asleep ? ' dark' : ''}`}>
              <ul className="pt-menu top">
                {MENU.slice(0, 4).map((it, i) => <li key={it.id}><button type="button" className={sel === i ? 'on' : ''} onClick={() => { setSel(i); run(it.id); }} aria-label={it.label} title={it.label}><Ico id={it.id} /></button></li>)}
              </ul>
              <div className="pt-stage">
                {screen === 'home' && (
                  <>
                    <button type="button" className={`pt-pet${walking ? ' walk' : ''}${fx?.id === 'no' ? ' shake' : ''}${fx && ['love', 'win', 'eat', 'treat'].includes(fx.id) ? ' hop' : ''}${egg ? ' egg' : ''}`} onClick={() => show(petActions.apply(pat), '')} aria-label={egg ? 'Tocar no ovo' : `Fazer carinho em ${title}`}>
                      <PetCreature stage={pet.stage} form={pet.form} mood={m.id} crack={crack} size={egg ? 74 : pet.stage === 'baby' ? 78 : pet.stage === 'child' ? 104 : 118} />
                    </button>
                    {pet.poops > 0 && <span className="pt-poops" aria-label={`${pet.poops} sujeira(s) no chão`}>{Array.from({ length: pet.poops }, (_, i) => <i key={i} className="pt-poop"><b /></i>)}</span>}
                    {pet.asleep && <span className="pt-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>}
                    {pet.sick && !pet.asleep && <span className="pt-sick" aria-hidden="true">✚</span>}
                    {fx?.id && FX[fx.id] && <span key={fx.at} className={`pt-fx fx-${fx.id}`} aria-hidden="true">{FX[fx.id]}</span>}
                  </>
                )}
                {screen === 'food' && (
                  <div className="pt-list" role="listbox" aria-label="O que ele vai comer">
                    {[['Refeição', '+1 de fome'], [`Petisco × ${treats}`, '+2 de alegria']].map(([t, d], i) => (
                      <button key={t} type="button" role="option" aria-selected={opt === i} className={opt === i ? 'on' : ''} onClick={() => eat(i)} disabled={i === 1 && treats <= 0}><b>{t}</b><span>{d}</span></button>
                    ))}
                  </div>
                )}
                {screen === 'status' && (
                  <div className="pt-status">
                    {page === 0 ? <>
                      <p><span>Fome</span><Hearts n={pet.hunger} label="Fome" /></p>
                      <p><span>Alegria</span><Hearts n={pet.joy} label="Alegria" /></p>
                      <p><span>Energia</span><Hearts n={pet.energy} label="Energia" /></p>
                    </> : <>
                      <p><span>Idade</span><b>{ageLabel(pet)}</b></p>
                      <p><span>Peso</span><b>{pet.weight} g</b></p>
                      <p><span>Cuidado</span><b>{pet.care}%</b></p>
                    </>}
                  </div>
                )}
                {screen === 'game' && (
                  <div className="pt-game">
                    <PetCreature stage={pet.stage} form={pet.form} mood={game?.last ? (game.last.hit ? 'happy' : 'sad') : 'ok'} facing={facing} size={pet.stage === 'adult' ? 96 : 80} />
                    <div className="pt-game-btns">
                      <button type="button" onClick={() => guess('left')} disabled={game?.over} aria-label="Esquerda">←</button>
                      <span>{game?.hits ?? 0} acerto(s)</span>
                      <button type="button" onClick={() => guess('right')} disabled={game?.over} aria-label="Direita">→</button>
                    </div>
                  </div>
                )}
              </div>
              <ul className="pt-menu bottom">
                {MENU.slice(4).map((it, i) => <li key={it.id}><button type="button" className={sel === i + 4 ? 'on' : ''} onClick={() => { setSel(i + 4); run(it.id); }} aria-label={it.label} title={it.label}><Ico id={it.id} /></button></li>)}
                <li><span className={`pt-attn${m.needs.length ? ' on' : ''}`} title={m.needs.length ? 'Ele precisa de você' : 'Tudo bem'} aria-label={m.needs.length ? 'Ele precisa de você' : 'Tudo bem'}><Ico id="attention" /></span></li>
              </ul>
              <p className="pt-line" role="status" aria-live="polite">{line}</p>
            </div>
          </div>
          <div className="pt-buttons">
            <button type="button" onClick={A} aria-label="Botão A: escolher">A</button>
            <button type="button" onClick={B} aria-label="Botão B: confirmar">B</button>
            <button type="button" onClick={C} aria-label="Botão C: voltar">C</button>
          </div>
        </div>
      </div>

      <div className="pt-side">
        {name === null
          ? <div className="pt-name"><h2>{title}</h2><button type="button" className="btn quiet" onClick={() => setName(pet.name)}>{pet.name ? 'Renomear' : 'Dar um nome'}</button></div>
          : <form className="pt-name" onSubmit={saveName}><input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Nome do bichinho" aria-label="Nome do bichinho" autoFocus /><button type="submit" className="btn primary">Salvar</button><button type="button" className="btn quiet" onClick={() => setName(null)}>Cancelar</button></form>}
        <p className="pt-sub">{egg ? 'Chocando… toque no ovo.' : `${STAGE_LABEL[pet.stage]}${pet.form ? ` ${FORM_LABEL[pet.form].toLowerCase()}` : ''} · ${ageLabel(pet)} · ${m.label}`}</p>
        {!egg && (
          <div className="pt-card">
            <p><span>Fome</span><Hearts n={pet.hunger} label="Fome" /></p>
            <p><span>Alegria</span><Hearts n={pet.joy} label="Alegria" /></p>
            <p><span>Energia</span><Hearts n={pet.energy} label="Energia" /></p>
            <p><span>Petiscos</span><b>{treats}</b></p>
          </div>
        )}
        {m.needs.length > 0 && <p className="pt-needs" role="status">Precisa de você: {m.needs.map((n) => ({ remedio: 'remédio', comida: 'comida', limpeza: 'limpeza', brincar: 'brincar', dormir: 'dormir' })[n]).join(', ')}.</p>}
        <details className="pt-help">
          <summary>Como cuidar</summary>
          <ul>
            <li>O tempo corre de verdade: a fome, a alegria e a energia caem aos poucos, e ele suja o chão.</li>
            <li><b>Comer</b>: refeição (+1 de fome) ou petisco (+2 de alegria). <b>Petiscos</b> chegam quando os seus agentes terminam um trabalho ou uma missão.</li>
            <li><b>Brincar</b>: adivinhe para que lado ele vai olhar; acertando {GAME_WIN} de {GAME_ROUNDS}, ele fica mais feliz.</li>
            <li><b>Luz</b> apaga para ele dormir e recuperar energia. <b>Limpar</b> tira a sujeira; sujeira demais ou fome por muito tempo deixam ele doente (<b>Remédio</b> cura).</li>
            <li>Ele cresce: bebê, criança (1 dia) e adulto (3 dias). A forma adulta depende de como você cuidou.</li>
            <li>Na telinha: A escolhe, B confirma, C volta (ou use as setas, Enter e Esc). Clique nele para um carinho.</li>
          </ul>
        </details>
        <details className="pt-help">
          <summary>Testar o tempo</summary>
          <p className="dim small">Adianta o relógio do bichinho, para ver as mudanças sem esperar.</p>
          <div className="pt-test">
            {[['+1 h', 3_600_000], ['+6 h', 21_600_000], ['+1 dia', 86_400_000]].map(([t, d]) => <button key={t} type="button" className="btn" onClick={() => petActions.fastForward(d)}>{t}</button>)}
            <button type="button" className="btn danger" onClick={() => { if (window.confirm('Recomeçar com um ovo novo? O bichinho atual vai embora.')) { petActions.restart(); home(); } }}>Recomeçar</button>
          </div>
        </details>
      </div>
    </div>
  );
}
