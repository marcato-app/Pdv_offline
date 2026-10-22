// Vibração curta ao bipar (no celular). No app das lojas usa a vibração nativa; no navegador, a do Android.
import { IS_STORE_APP } from './store';

type Kind = 'ok' | 'erro';
let native: Promise<typeof import('@capacitor/haptics') | null> | null = null;

export function vibrate(kind: Kind = 'ok') {
  if (IS_STORE_APP) {
    native ??= import('@capacitor/haptics').catch(() => null);
    native.then((m) => {
      if (!m) return;
      if (kind === 'ok') m.Haptics.impact({ style: m.ImpactStyle.Light }).catch(() => undefined);
      else m.Haptics.notification({ type: m.NotificationType.Error }).catch(() => undefined);
    });
    return;
  }
  try { navigator.vibrate?.(kind === 'ok' ? 40 : [80, 60, 80]); } catch { /* sem vibração */ }
}
