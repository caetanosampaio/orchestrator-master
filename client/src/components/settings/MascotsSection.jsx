import React, { useState } from 'react';
import { useStore } from '../../store.jsx';
import { CATALOG, FORGE_MASCOT, catalogById, aiName } from '../../provider-catalog.js';
import { providerStatus, providerById } from '../../provider-view.js';
import { ProviderMascot } from '../ProviderLogo.jsx';
import { Block } from './SettingsUi.jsx';

/**
 * Configurações > Mascotes (no formato da tela "Cara" de referência, em preto): à esquerda o mascote grande escolhido (pixel art), à direita a grade com o FORGE e todas as IAs.
 * O corpo é o mesmo em todos e só a cor muda. É um CATÁLOGO: escolher um mascote só mostra os detalhes dele, não muda nada no app. O estado ("integrado") vem dos agentes instalados de verdade.
 */
const TILES = [FORGE_MASCOT, ...CATALOG];

export function MascotsSection() {
  const { terminals } = useStore();
  const [sel, setSel] = useState('forge');
  const a = catalogById(sel) ?? FORGE_MASCOT, live = providerById(terminals?.providers, a.id), st = live ? providerStatus(live) : null;
  const sub = a.brand ? 'O mascote do FORGE' : !a.integrated ? 'Ainda não integrado ao FORGE' : st ? `Integrado · ${st.text}` : 'Integrado ao FORGE';
  return (
    <Block title="Cara" hint="O corpo é o mesmo para todos; só a cor muda." id="mascots">
      <div className="mc-wrap">
        <div className="mc-preview" style={{ '--pm': a.color }}>
          <ProviderMascot id={a.id} size={92} crest={!!a.crest} />
          <b className="mc-name">{a.brand ? 'FORGE' : aiName(a.id, live?.label)}</b>
          <span className="dim small">{sub}</span>
        </div>
        <div className="mc-grid" role="radiogroup" aria-label="Mascotes">
          {TILES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={sel === t.id} className={`mc-tile${sel === t.id ? ' on' : ''}`} style={{ '--pm': t.color }} onClick={() => setSel(t.id)}>
              <ProviderMascot id={t.id} size={38} crest={!!t.crest} />
              <span className="mc-tile-n">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Block>
  );
}
