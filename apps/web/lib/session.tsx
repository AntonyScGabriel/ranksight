"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type Me } from "./api";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  me: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

/** Profil du joueur connecté, ou null s'il n'y a pas de session. */
function loadMe(): Promise<Me | null> {
  return api.me().catch(() => null);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((user: Me | null) => {
    setMe(user);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => apply(await loadMe()), [apply]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setMe(null);
    window.location.assign("/");
  }, []);

  useEffect(() => {
    loadMe().then(apply);
  }, [apply]);

  return <SessionContext.Provider value={{ me, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
