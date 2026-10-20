"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { errorMessage } from "./AuthForm";

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Profil : appareils connectés au compte, chacun déconnectable (celui-ci se ferme avec « Se déconnecter ») */
export function AccountDevices() {
  const [sessions, setSessions] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sessions().then(setSessions, () => setSessions([]));
  }, []);
  useEffect(load, [load]);

  const revoke = async (s: SessionDto) => {
    setError(null);
    try {
      await api.revokeSession(s.id);
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  return (
    <div className="space-y-2" data-testid="devices">
      <p className="text-sm text-muted">Appareils connectés</p>
      {sessions === null ? (
        <p className="text-xs text-muted">Chargement…</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  {s.device}
                  {s.current && <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">cet appareil</span>}
                </p>
                <p className="text-xs text-muted">Connecté le {when(s.createdAt)} · actif le {when(s.lastActiveAt)}</p>
              </div>
              {!s.current && (
                <button onClick={() => revoke(s)} className="text-xs text-muted hover:text-danger">Déconnecter</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
