import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, setSetting } from '../lib/db';
import { DEFAULT_THEME, type StoreInfo, type Theme } from '../lib/theme';

// "Primeiros passos": lista que se marca sozinha conforme a loja vai sendo configurada.

export function Onboarding() {
  const s = useLiveQuery(async () => {
    const get = async <T,>(id: string) => (await db.settings.get(id))?.value as T | undefined;
    if (await get<boolean>('onboardingDone')) return null;
    const store = (await get<StoreInfo>('store')) || ({} as StoreInfo);
    const theme = (await get<Theme>('theme')) || DEFAULT_THEME;
    const pay = (await db.device.get('payCfg'))?.value as { mercadoPago?: boolean } | undefined;
    const steps: [string, string, boolean][] = [
      ['Coloque a logo e as cores da loja', '/config?aba=loja', !!store.logo || theme.primary !== DEFAULT_THEME.primary || theme.secondary !== DEFAULT_THEME.secondary],
      ['Preencha os dados do cupom (CNPJ e endereço)', '/config?aba=cupom', !!(store.cnpj || store.address)],
      ['Cadastre ou importe seus produtos', '/importar', (await db.products.filter((p) => !p.deleted).count()) > 0],
      ['Configure o PIX ou a maquininha', '/config?aba=pagamentos', !!(await get('pixKey')) || !!pay?.mercadoPago],
      ['Cadastre seus funcionários', '/usuarios', (await db.users.filter((u) => !u.deleted).count()) > 1],
      ['Faça a primeira venda', '/pdv', (await db.sales.filter((x) => !x.deleted && x.status === 'completed').count()) > 0],
    ];
    return steps;
  }, []);
  if (!s) return null;
  const done = s.filter((x) => x[2]).length;
  const close = () => setSetting('onboardingDone', true);
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="spread">
        <div>
          <h2 style={{ fontSize: 19 }}>Primeiros passos</h2>
          <span className="muted small">{done === s.length ? 'Tudo pronto! Sua loja está configurada.' : `${done} de ${s.length} concluídos`}</span>
        </div>
        <button className="btn sm ghost" onClick={close}>{done === s.length ? 'Fechar' : 'Esconder'}</button>
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${(done / s.length) * 100}%` }} /></div>
      <ul className="steps-list">
        {s.map(([label, to, ok]) => (
          <li key={label} className={ok ? 'done' : ''}><Link to={to}><span className="ck">{ok ? '✓' : ''}</span>{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
