import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui';
import { loadTree, searchTree, LEVELS, fmtPath, type Path } from '../lib/arvore';

/** Escolher o lugar do produto na árvore mercadológica: busca por palavra ou navega nível por nível. */
export function TreePicker({ value, onChange }: { value: string[]; onChange: (p: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const has = value.some(Boolean);
  return (
    <div className="field" style={{ gridColumn: '1 / -1' }}>
      <label>Árvore mercadológica</label>
      <button type="button" className="tree-value" onClick={() => setOpen(true)}>
        {has ? (
          <span className="tree-crumbs">{value.map((v, i) => v && <span key={i}><small>{LEVELS[i]}</small>{v}</span>)}</span>
        ) : <span className="muted">Escolher segmento, departamento, categoria…</span>}
        <b>{has ? 'Trocar' : 'Escolher'}</b>
      </button>
      {open && <TreeModal value={value} onClose={() => setOpen(false)} onPick={(p) => { onChange(p); setOpen(false); }} />}
    </div>
  );
}

function TreeModal({ value, onClose, onPick }: { value: string[]; onClose: () => void; onPick: (p: string[]) => void }) {
  const [tree, setTree] = useState<Path[] | null>(null);
  const [q, setQ] = useState('');
  const [nav, setNav] = useState<string[]>(() => value.slice(0, 4).filter(Boolean));
  useEffect(() => { loadTree().then(setTree); }, []);
  const found = useMemo(() => (tree && q.trim().length >= 2 ? searchTree(tree, q) : []), [tree, q]);
  // Navegação: opções do próximo nível dentro do caminho escolhido até aqui.
  const level = nav.length;
  const options = useMemo(() => {
    if (!tree) return [];
    const inside = tree.filter((p) => nav.every((v, i) => p[i] === v));
    return [...new Set(inside.map((p) => p[level]).filter(Boolean))].sort();
  }, [tree, nav, level]);
  const pickNav = (v: string) => {
    const next = [...nav, v];
    const inside = tree!.filter((p) => next.every((x, i) => p[i] === x));
    const deeper = inside.some((p) => p[next.length]);
    if (!deeper || next.length >= 5) onPick([...next, '', '', '', '', ''].slice(0, 5));
    else setNav(next);
  };
  return (
    <Modal title="Árvore mercadológica" onClose={onClose} wide>
      <input className="input" autoFocus placeholder="Buscar: óleo de soja, sorvete palito, sabão em pó…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!tree && <span className="muted">Carregando…</span>}
      {q.trim().length >= 2 ? (
        <div className="tree-list">
          {found.length === 0 && <span className="muted" style={{ padding: 12 }}>Nada encontrado. Tente outra palavra.</span>}
          {found.map((p) => (
            <button key={p.join('|')} type="button" onClick={() => onPick([...p])}>
              <b>{p[4] || p[3]}</b><small>{fmtPath(p.slice(0, p[4] ? 4 : 3))}</small>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="tree-nav">
            <button type="button" className={nav.length ? '' : 'on'} onClick={() => setNav([])}>Início</button>
            {nav.map((v, i) => <button key={i} type="button" className={i === nav.length - 1 ? 'on' : ''} onClick={() => setNav(nav.slice(0, i + 1))}>{v}</button>)}
          </div>
          <span className="muted small">Escolha {['o segmento', 'o departamento', 'a categoria', 'a subcategoria', 'o tipo'][level]}</span>
          <div className="tree-list">
            {nav.length > 0 && <button type="button" onClick={() => onPick([...nav, '', '', '', '', ''].slice(0, 5))}><b>Usar “{nav[nav.length - 1]}”</b><small>Sem escolher o próximo nível</small></button>}
            {options.map((o) => <button key={o} type="button" onClick={() => pickNav(o)}><b>{o}</b><small>{LEVELS[level]}</small></button>)}
          </div>
        </>
      )}
      {value.some(Boolean) && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => onPick(['', '', '', '', ''])}>Tirar da árvore</button>}
    </Modal>
  );
}
