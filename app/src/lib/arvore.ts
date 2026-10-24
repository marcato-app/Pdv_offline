// Árvore mercadológica do Vision PDV (5 níveis). Vem junto com o sistema e funciona sem internet.
// Cada caminho: [Segmento, Departamento, Categoria, Subcategoria, Tipo]. O "Tipo" pode ser vazio.
import type { Product } from './db';

export type Path = [string, string, string, string, string];
export const LEVELS = ['Segmento', 'Departamento', 'Categoria', 'Subcategoria', 'Tipo'] as const;
export const LEVEL_KEYS = ['segment', 'department', 'category', 'subcategory', 'family'] as const satisfies readonly (keyof Product)[];

let cache: Promise<Path[]> | null = null;
export function loadTree(): Promise<Path[]> {
  cache ??= import('../data/arvore.json').then((m) => m.default as unknown as Path[]);
  return cache;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Busca por palavras em qualquer nível ("oleo soja", "sorvete palito"). Os caminhos mais específicos vêm primeiro. */
export function searchTree(tree: Path[], q: string, limit = 40): Path[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: [number, Path][] = [];
  for (const p of tree) {
    const hay = norm(p.join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    // Pontua mais quando a palavra está no nível mais baixo (o que o produto é).
    const low = norm(`${p[3]} ${p[4]}`);
    const score = words.reduce((s, w) => s + (low.includes(w) ? 2 : 1), 0) + (p[4] ? 0.5 : 0);
    scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

export const pathOf = (p: Partial<Product>) => LEVEL_KEYS.map((k) => (p[k] as string | undefined) || '');
export const fmtPath = (parts: string[], sep = ' › ') => parts.filter(Boolean).join(sep);
