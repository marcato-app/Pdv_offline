// Atualização do sistema: compara a versão deste aparelho com a publicada na nuvem.
import { useEffect, useState } from 'react';
import { CLOUD_URL, IS_APP } from './store';

export const APP_VERSION = __APP_VERSION__;

let latest: string | null = null;
const listeners = new Set<(v: string | null) => void>();

export async function checkForUpdate(): Promise<string | null> {
  if (!navigator.onLine) return latest;
  try {
    const base = IS_APP ? CLOUD_URL : location.origin;
    const r = await fetch(`${base}/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return latest;
    const { version } = (await r.json()) as { version: string };
    latest = version && version > APP_VERSION ? version : null;
    listeners.forEach((l) => l(latest));
  } catch {
    /* sem internet */
  }
  return latest;
}

/** Aplica a atualização: pega a versão nova da nuvem e recarrega o sistema. */
export async function applyUpdate() {
  if (IS_APP) {
    // Instalação antiga que roda com arquivos locais: precisa do instalador novo.
    window.open('https://github.com/marcato-app/Pdv_offline/releases/latest', '_blank');
    return;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* segue */ }
  location.reload();
}

export function startUpdateChecks() {
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60_000);
  window.addEventListener('focus', () => checkForUpdate());
  window.addEventListener('online', () => checkForUpdate());
}

export function useUpdate() {
  const [v, setV] = useState<string | null>(latest);
  useEffect(() => {
    listeners.add(setV);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}
