// Aparência deste aparelho: tema preto e branco com modo Claro, Escuro ou Automático (segue o celular/computador).
import { useEffect, useState } from 'react';

export type Appearance = 'auto' | 'claro' | 'escuro';
const KEY = 'vision-appearance';
const listeners = new Set<() => void>();

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    // Nomes antigos (Vibrante / Clássico) viram Claro.
    return v === 'escuro' ? 'escuro' : v === 'auto' || !v ? 'auto' : 'claro';
  } catch { return 'auto'; }
}

const prefersDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Claro ou escuro de fato, resolvendo o "Automático". */
export function resolvedAppearance(a = getAppearance()): 'claro' | 'escuro' {
  return a === 'auto' ? (prefersDark() ? 'escuro' : 'claro') : a;
}

export function applyAppearance() {
  const dark = resolvedAppearance() === 'escuro';
  const h = document.documentElement;
  h.classList.add('vt');
  h.classList.toggle('dk', dark);
  h.classList.remove('mv', 'md');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0B0E' : '#F6F6F7');
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
      StatusBar.setBackgroundColor?.({ color: dark ? '#0B0B0E' : '#F6F6F7' }).catch(() => undefined);
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
    }).catch(() => undefined);
  }
  listeners.forEach((f) => f());
}

export function setAppearance(a: Appearance) {
  try { localStorage.setItem(KEY, a); } catch { /* ok */ }
  applyAppearance();
}

/** Liga o tema e acompanha a troca de claro/escuro do aparelho. */
export function startAppearance() {
  applyAppearance();
  matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getAppearance() === 'auto') applyAppearance(); });
}

export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [a, setA] = useState(getAppearance());
  useEffect(() => { const f = () => setA(getAppearance()); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return [a, setAppearance];
}

export const APPEARANCE_LABELS: Record<Appearance, string> = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };
