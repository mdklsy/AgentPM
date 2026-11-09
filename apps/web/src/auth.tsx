import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api/client.js';

export interface Me {
  name: string;
  displayName: string;
  type: 'HUMAN' | 'AGENT' | 'AVATAR';
  isAdmin: boolean;
  mustChangePassword: boolean;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  me: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ actor: Me }>('/v1/auth/me');
      setMe(r.actor);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/v1/auth/logout').catch(() => {});
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
