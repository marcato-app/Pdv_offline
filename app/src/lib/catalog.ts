// Cadastro automático: busca nome, marca, categoria, NCM e foto pelo código de barras
// no banco de produtos compartilhado do Vision PDV.
import { getDevice, type Product } from './db';
import { api } from './store';
import { resizeImage } from './theme';

export interface CatalogItem {
  barcode: string;
  description?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  segment?: string | null;
  department?: string | null;
  category?: string | null;
  subcategory?: string | null;
  family?: string | null;
  basket?: string | null;
  content?: string | null;
  ncm?: string | null;
  photo?: string | null;
  source?: string | null;
}

export async function lookupBarcode(code: string): Promise<CatalogItem | null> {
  const c = code.replace(/\D/g, '');
  if (c.length < 8 || c.length > 14 || !navigator.onLine) return null;
  const token = await getDevice<string | null>('token', null);
  if (!token) return null;
  try {
    const r = await api<{ found: boolean; item?: CatalogItem }>(`/api/catalog/${c}`, { token });
    return r.found && r.item ? r.item : null;
  } catch {
    return null;
  }
}

/** Baixa a foto e guarda dentro do produto (para aparecer mesmo sem internet). */
export async function photoToDataUrl(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    const blob = await r.blob();
    return await resizeImage(new File([blob], 'foto', { type: blob.type || 'image/jpeg' }));
  } catch {
    return undefined;
  }
}

/** Envia cadastros desta loja para completar o banco compartilhado (sem preço nem estoque). */
export async function contribute(products: Partial<Product>[]) {
  const token = await getDevice<string | null>('token', null);
  if (!token || !navigator.onLine) return;
  const items = products
    .filter((p) => p.barcode && /^\d{8,14}$/.test(p.barcode))
    .map((p) => ({ barcode: p.barcode, description: p.description, brand: p.brand, manufacturer: p.manufacturer, segment: p.segment, department: p.department, category: p.category, subcategory: p.subcategory, family: p.family, basket: p.basket, content: p.content, ncm: p.ncm }));
  for (let i = 0; i < items.length; i += 200) {
    await api('/api/catalog/contribute', { method: 'POST', token, body: JSON.stringify({ items: items.slice(i, i + 200) }) }).catch(() => undefined);
  }
}
