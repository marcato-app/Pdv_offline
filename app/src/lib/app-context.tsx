import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type User } from './db';
import { DEFAULT_STORE, DEFAULT_THEME, applyTheme, type StoreInfo, type Theme } from './theme';
import { onSyncStatus, getSyncStatus, type SyncStatus } from './sync';

interface Ctx {
  user: User | null;
  setUser: (u: User | null) => void;
  store: StoreInfo;
  theme: Theme;
  sync: SyncStatus;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);

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

  // Mantém o login enquanto o app está aberto (sobrevive a recarregar a página).
  useEffect(() => {
    const id = sessionStorage.getItem('uid');
    if (id) db.users.get(id).then((u) => u && !u.deleted && u.active && setUserState(u));
  }, []);
  const setUser = (u: User | null) => {
    if (u) sessionStorage.setItem('uid', u.id);
    else sessionStorage.removeItem('uid');
    setUserState(u);
  };

  return <AppCtx.Provider value={{ user, setUser, store, theme, sync }}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
