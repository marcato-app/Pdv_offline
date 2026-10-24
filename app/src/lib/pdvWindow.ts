// Frente de caixa em janela própria e em tela cheia (cobre até a barra de tarefas do Windows).
import { IS_APP } from './store';

const NAME = 'vision-pdv';
const bridge = () => window.visionDesktop;
// Endereço do caixa nesta mesma instalação (site: /pdv; app sem internet: #/pdv).
const pdvUrl = () => (IS_APP ? location.href.split('#')[0] + '#/pdv' : location.origin + '/pdv');
const bigScreen = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches && window.innerWidth >= 1000;

/** Esta janela é a do caixa (aberta à parte)? */
export const isPdvWindow = () => !!bridge()?.isPdvWindow || window.name === NAME;

/** Abre o caixa numa janela à parte. Devolve false quando o aparelho não usa janelas (celular, app antigo): aí abre na mesma tela. */
export function openPdvWindow(): boolean {
  const d = bridge();
  if (d?.openPdv) { d.openPdv(pdvUrl()); return true; }
  if (IS_APP || !bigScreen()) return false;
  const w = window.open(pdvUrl(), NAME, `popup,left=0,top=0,width=${screen.availWidth},height=${screen.availHeight}`);
  if (!w) return false; // bloqueador de janelas
  w.focus();
  return true;
}

/** Volta para a janela da gestão (quando o caixa está em janela própria). */
export function focusMainWindow(): boolean {
  const d = bridge();
  if (d?.isPdvWindow && d.focusMain) { d.focusMain(); return true; }
  if (window.name === NAME && window.opener && !window.opener.closed) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    window.opener.focus();
    return true;
  }
  return false;
}

/** No caixa: deixa a tela cheia. No Windows o app faz isso direto; no navegador precisa de um clique ou tecla. */
export function startPdvFullscreen(): () => void {
  const d = bridge();
  if (d?.setFullScreen) { d.setFullScreen(true); return () => { if (!d.isPdvWindow) d.setFullScreen?.(false); }; }
  if (IS_APP || window.name !== NAME || !document.documentElement.requestFullscreen) return () => undefined;
  const go = () => {
    if (document.fullscreenElement) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      // Assim o Esc continua servindo ao caixa (segurar Esc sai da tela cheia).
      (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(['Escape']).catch(() => undefined);
    }).catch(() => undefined);
  };
  window.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go);
  return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
}
