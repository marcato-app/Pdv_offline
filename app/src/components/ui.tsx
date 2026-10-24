import { CategoryArt } from './CategoryArt';
import type { Product } from '../lib/db';
import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../lib/app-context';
import { timeOnly } from '../lib/format';

export function Logo({ size = 44 }: { size?: number }) {
  const { store } = useApp();
  return (
    <div className="logo-box" style={{ width: size, height: size }}>
      {store.logo ? <img src={store.logo} alt={store.name} /> : 'LOGO'}
    </div>
  );
}

export function SyncBadge() {
  const { sync } = useApp();
  if (!sync.configured) return <span className="chip warn"><span className="dot" />Só neste aparelho</span>;
  if (!sync.online) return <span className="chip warn"><span className="dot" />Offline · {sync.pending} na fila</span>;
  if (sync.error) return <span className="chip danger" title={sync.error}><span className="dot" />Erro ao sincronizar</span>;
  if (sync.syncing || sync.pending) return <span className="chip ok"><span className="dot" />Sincronizando…</span>;
  return <span className="chip ok"><span className="dot" />Online{sync.lastSync ? ` · ${timeOnly(sync.lastSync)}` : ''}</span>;
}

export function Modal({ title, onClose, children, footer, wide, right }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; right?: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h2>
          {right}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

/** Foto do produto. Sem foto, mostra a imagem de exemplo do tipo do produto (se o produto for informado). */
export function Photo({ src, size = 200, label = 'Sem foto', product }: { src?: string; size?: number; label?: string; product?: Partial<Product> | null }) {
  if (!src && product && (product.segment || product.description)) return <CategoryArt product={product} size={size} />;
  return <div className="photo" style={{ width: size, height: size }}>{src ? <img src={src} alt="" /> : label}</div>;
}

export function confirmBox(msg: string) {
  return window.confirm(msg);
}
