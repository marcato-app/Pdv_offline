import { getSetting } from './db';

export interface StoreInfo {
  name: string;
  logo?: string; // data URL
  cnpj?: string;
  address?: string;
  phone?: string;
  receiptFooter?: string;
}

export interface Theme {
  primary: string; // verde: botões e ações
  secondary: string; // lilás: cabeçalho e menu
}

export const DEFAULT_THEME: Theme = { primary: '#15803D', secondary: '#5B3FA8' };
export const DEFAULT_STORE: StoreInfo = { name: 'Minha Loja' };

export const PRIMARY_OPTIONS = ['#15803D', '#047857', '#0F766E', '#1D4ED8', '#B45309', '#BE123C'];
export const SECONDARY_OPTIONS = ['#5B3FA8', '#6D28D9', '#7E22CE', '#1E3A8A', '#334155', '#9D174D'];

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function applyTheme(t: Theme) {
  const s = document.documentElement.style;
  s.setProperty('--primary', t.primary);
  s.setProperty('--primary-dark', shade(t.primary, -0.25));
  s.setProperty('--primary-soft', shade(t.primary, 0.88));
  s.setProperty('--secondary', t.secondary);
  s.setProperty('--secondary-dark', shade(t.secondary, -0.3));
  s.setProperty('--secondary-soft', shade(t.secondary, 0.9));
}

export async function loadTheme() {
  applyTheme(await getSetting<Theme>('theme', DEFAULT_THEME));
}

/** Reduz uma imagem para caber no banco (e na sincronização). */
export function resizeImage(file: File, max = 320, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
