// Aparência deste aparelho: Vibrante (degradê, padrão no celular), Escuro, Clássico ou Automático (segue o celular).
import { useEffect, useState } from 'react';

export type Appearance = 'auto' | 'vibrante' | 'escuro' | 'classico';
const KEY = 'vision-appearance';
const listeners = new Set<() => void>();

export function getAppearance(): Appearance {
  try { return (localStorage.getItem(KEY) as Appearance) || 'auto'; } catch { return 'auto'; }
}

const prefersDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Escuro ou vibrante de fato, resolvendo o "Automático". */
export function resolvedAppearance(a = getAppearance()): Exclude<Appearance, 'auto'> {
  return a === 'auto' ? (prefersDark() ? 'escuro' : 'vibrante') : a;
}

export function applyAppearance() {
  const r = resolvedAppearance();
  const h = document.documentElement;
  h.classList.toggle('mv', r === 'vibrante');
  h.classList.toggle('md', r === 'escuro');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'escuro' ? '#0b0816' : r === 'vibrante' ? '#6d4fc4' : '#5B3FA8');
  // Barra de status do app (relógio/bateria) clara sobre o fundo colorido.
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: r === 'classico' ? Style.Dark : Style.Dark }).catch(() => undefined);
      StatusBar.setOverlaysWebView({ overlay: r !== 'classico' }).catch(() => undefined);
    }).catch(() => undefined);
  }
  listeners.forEach((f) => f());
}

export function setAppearance(a: Appearance) {
  try { localStorage.setItem(KEY, a); } catch { /* ok */ }
  applyAppearance();
}

/** Liga a aparência e acompanha a troca de claro/escuro do celular. */
export function startAppearance() {
  applyAppearance();
  matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getAppearance() === 'auto') applyAppearance(); });
}

export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [a, setA] = useState(getAppearance());
  useEffect(() => { const f = () => setA(getAppearance()); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return [a, setAppearance];
}

export const APPEARANCE_LABELS: Record<Appearance, string> = { auto: 'Automático', vibrante: 'Vibrante', escuro: 'Escuro', classico: 'Clássico' };
