// Planos e dados da plataforma (preço, suporte, empresa), vindos da nuvem.
import { api, IS_APP } from './store';

export interface Plan { id: string; name: string; price: number; days: number; highlight?: string }
export interface PlatformInfo { plans: Plan[]; supportWhatsApp: string | null; company: string | null; companyDoc: string | null; companyEmail: string | null; checkout: boolean; mpPublicKey?: string | null; recover?: boolean; metaPixelId?: string | null; googleTagId?: string | null; googleAdsSignup?: string | null; googleAdsPurchase?: string | null }

const FALLBACK: PlatformInfo = {
  plans: [
    { id: 'mensal', name: 'Mensal', price: 79.9, days: 30 },
    { id: 'anual', name: 'Anual', price: 799, days: 365, highlight: '2 meses grátis' },
  ],
  supportWhatsApp: null, company: null, companyDoc: null, companyEmail: null, checkout: false,
};

let cache: Promise<PlatformInfo> | null = null;
export function getPlatform(): Promise<PlatformInfo> {
  if (!cache) {
    cache = api<PlatformInfo>('/api/plans').then((p) => {
      try { localStorage.setItem('vision-platform', JSON.stringify(p)); } catch { /* ok */ }
      return p;
    }).catch(() => {
      cache = null;
      try { return JSON.parse(localStorage.getItem('vision-platform') || '') as PlatformInfo; } catch { return FALLBACK; }
    });
  }
  return cache;
}

/** Aberto dentro do app de Windows ou do celular (não mostra a página de vendas). */
export const IS_NATIVE = IS_APP || /VisionPDVApp/.test(navigator.userAgent);

export const whatsLink = (phone: string, text: string) => {
  const d = phone.replace(/\D/g, '');
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}?text=${encodeURIComponent(text)}`;
};
