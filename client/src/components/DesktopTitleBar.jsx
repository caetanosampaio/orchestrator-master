import React from 'react';

/**
 * Faixa da janela do app desktop no macOS (a janela abre sem a barra nativa, ver desktop/main.cjs): os botões de fechar, minimizar e ampliar ficam à esquerda (o sistema os desenha) e o texto "FORGE <versão>" vem logo depois.
 * Só aparece dentro do app (o preload expõe window.forgeDesktop); no navegador, e no Windows (que mantém a barra nativa, já com o título "FORGE <versão>"), não renderiza nada. É a área de arrastar a janela.
 */
export const desktopInfo = (w = typeof window !== 'undefined' ? window : null) => {
  const d = w?.forgeDesktop;
  return d && typeof d === 'object' && typeof d.platform === 'string' ? { platform: d.platform, version: typeof d.version === 'string' ? d.version : '' } : null;
};
export default function DesktopTitleBar() {
  const d = desktopInfo();
  if (!d || d.platform !== 'darwin') return null;
  return <div className="oc-titlebar" role="presentation"><span><b>FORGE</b>{d.version}</span></div>;
}
