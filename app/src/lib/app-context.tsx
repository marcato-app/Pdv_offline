import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type User } from './db';
import { DEFAULT_STORE, DEFAULT_THEME, applyTheme, type StoreInfo, type Theme } from './theme';
import { onSyncStatus, getSyncStatus, type SyncStatus } from './sync';
import { STORE_SLUG } from './store';

const UID_KEY = `vision-uid-${STORE_SLUG}`;

interface Ctx {
  user: User | null;
  setUser: (u: User | null) => void;
  store: StoreInfo;
  theme: Theme;
  sync: SyncStatus;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const AppCtxRef = AppCtx;

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  const storeRow = useLiveQuery(() => db.settings.get('store'), []);
  const themeRow = useLiveQuery(() => db.settings.get('theme'), []);
  const store = (storeRow?.value as StoreInfo) || DEFAULT_STORE;
  const theme = (themeRow?.value as Theme) || DEFAULT_THEME;

  useEffect(() => applyTheme(theme), [theme.primary, theme.secondary]);
  useEffect(() => {
    const off = onSyncStatus(setSync);
    return () => { off(); };
  }, []);
  useEffect(() => {
    document.title = `${store.name} · Vision PDV`;
  }, [store.name]);

  // Fica conectado neste aparelho até tocar em "Sair".
  useEffect(() => {
    const id = localStorage.getItem(UID_KEY);
    if (id) db.users.get(id).then((u) => (u && !u.deleted && u.active ? setUserState(u) : localStorage.removeItem(UID_KEY)));
  }, []);
  const setUser = (u: User | null) => {
    if (u) localStorage.setItem(UID_KEY, u.id);
    else localStorage.removeItem(UID_KEY);
    setUserState(u);
  };

  return <AppCtx.Provider value={{ user, setUser, store, theme, sync }}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
