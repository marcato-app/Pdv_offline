// Pixels de anúncio (Meta/Facebook e Google). Só carregam no site, nunca no app instalado.
import { getPlatform, IS_NATIVE, type PlatformInfo } from './platform';

type Fn = (...a: unknown[]) => void;
type W = Window & { fbq?: Fn & { q?: unknown[]; loaded?: boolean; version?: string; queue?: unknown[]; callMethod?: Fn; push?: Fn }; _fbq?: unknown; dataLayer?: unknown[]; gtag?: Fn };
const w = window as W;
let ready: Promise<PlatformInfo | null> | null = null;

function addScript(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

// Consentimento de cookies (LGPD): os pixels só carregam depois que a pessoa aceita.
const KEY = 'vision-cookies';
export function cookieChoice(): 'sim' | 'nao' | null {
  try { const v = localStorage.getItem(KEY); return v === 'sim' || v === 'nao' ? v : null; } catch { return null; }
}
export function setCookieChoice(v: 'sim' | 'nao' | null) {
  try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* ok */ }
  if (v === 'sim') initTracking();
  window.dispatchEvent(new Event('vision-cookies'));
}

/** Carrega os pixels configurados no painel do dono e marca a visita (só com o aceite dos cookies). */
export function initTracking(): Promise<PlatformInfo | null> {
  if (IS_NATIVE || !location.protocol.startsWith('http') || cookieChoice() !== 'sim') return Promise.resolve(null);
  ready ??= getPlatform().then((p) => {
    if (p.metaPixelId && !w.fbq) {
      const f = function (...a: unknown[]) { f.callMethod ? f.callMethod(...a) : f.queue!.push(a); } as NonNullable<W['fbq']>;
      f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
      w.fbq = f; w._fbq = f;
      addScript('https://connect.facebook.net/en_US/fbevents.js');
      w.fbq('init', p.metaPixelId);
      w.fbq('track', 'PageView');
    }
    if (p.googleTagId && !w.gtag) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function () { // eslint-disable-next-line prefer-rest-params
        w.dataLayer!.push(arguments);
      };
      addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(p.googleTagId)}`);
      w.gtag('js', new Date());
      w.gtag('config', p.googleTagId);
      const ads = [p.googleAdsSignup, p.googleAdsPurchase].map((x) => x?.split('/')[0]).find((x) => x && x !== p.googleTagId);
      if (ads) w.gtag('config', ads);
    }
    return p;
  }).catch(() => null);
  return ready;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cadastro concluído (conversão principal dos anúncios). Espera um pouco para o envio sair antes de trocar de página. */
export async function trackSignup() {
  const p = await initTracking();
  if (!p) return;
  w.fbq?.('track', 'CompleteRegistration');
  w.fbq?.('track', 'StartTrial', { value: 0, currency: 'BRL' });
  w.gtag?.('event', 'sign_up', { method: 'email' });
  if (p.googleAdsSignup) w.gtag?.('event', 'conversion', { send_to: p.googleAdsSignup });
  if (w.fbq || w.gtag) await wait(800);
}

/** Assinatura paga. */
export async function trackPurchase(value: number, plan?: string) {
  const p = await initTracking();
  if (!p) return;
  w.fbq?.('track', 'Purchase', { value, currency: 'BRL', content_name: plan });
  w.gtag?.('event', 'purchase', { value, currency: 'BRL', items: plan ? [{ item_name: plan }] : undefined });
  if (p.googleAdsPurchase) w.gtag?.('event', 'conversion', { send_to: p.googleAdsPurchase, value, currency: 'BRL' });
}
