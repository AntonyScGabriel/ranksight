import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import { registerForPush } from "./notifications";

interface SessionValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({ me: null, loading: true, refresh: async () => {}, logout: async () => {} });

type LoadResult = Me | null | "offline";

/** Profil du joueur connecté ; null sans session ; "offline" si le serveur est injoignable. */
function loadMe(): Promise<LoadResult> {
  return api.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : e instanceof ApiError && e.status > 0 ? null : "offline"));
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((result: LoadResult) => {
    // Hors ligne : on garde l'état actuel plutôt que de déconnecter
    if (result !== "offline") setMe(result);
    if (result && result !== "offline") registerForPush().catch(() => undefined);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => apply(await loadMe()), [apply]);

  const logout = useCallback(async () => {
    await api.logout();
    setMe(null);
  }, []);

  useEffect(() => {
    loadMe().then(apply);
  }, [apply]);

  return <SessionContext.Provider value={{ me, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
