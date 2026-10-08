"use client";

import { isAdminRole } from "@ranksight/shared";
import { useCallback, useEffect, useState } from "react";
import { adminFetch, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Entry = { rank: number; userId: string; username: string; score: number };
type Season = {
  key: string; number: number; label: string; startsAt: string; endsAt: string; current: boolean;
  status: "current" | "closed" | "to_close"; players: number; top: Entry[]; closedAt: string | null;
};

const STATUS: Record<Season["status"], [string, string]> = {
  current: ["En cours", "bg-success/15 text-success"],
  closed: ["Clôturée", "bg-violet/20 text-violet-soft"],
  to_close: ["À clôturer", "bg-warn/15 text-warn"],
};

/** Saisons mensuelles : classement en cours, saisons clôturées et clôture manuelle si besoin. */
export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();

  const load = useCallback(() => {
    adminFetch<Season[]>("/seasons").then(setSeasons).catch((e: Error) => setMessage(e.message));
  }, []);
  useEffect(() => {
    load();
    session.me().then(setMe).catch(() => setMe(null));
  }, [load]);

  const close = async (s: Season) => {
    const ok = await confirm({
      title: `Clôturer ${s.label} ?`,
      message: "Le classement sera figé et les succès de saison (Champion, Podium, Top 10) attribués. Cette action est définitive.",
      confirmLabel: "Clôturer",
    });
    if (ok === false) return;
    setBusy(s.key);
    setMessage(null);
    try {
      const r = await adminFetch<{ players: number; alreadyClosed: boolean }>(`/seasons/${s.key}/close`, { method: "POST" });
      setMessage(r.alreadyClosed ? `${s.label} était déjà clôturée.` : `${s.label} clôturée : ${r.players} joueur(s) classé(s).`);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!seasons) return message ? <p className="text-danger">{message}</p> : <div className="glass h-40 animate-pulse" />;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Saisons</h1>
        <p className="text-sm text-muted">
          Une saison = un mois civil (heure UTC). Au début de chaque mois, la saison précédente est clôturée automatiquement :
          classement figé et succès de saison attribués (Champion, Podium, Top 10). La clôture manuelle ne sert que si le serveur
          était arrêté à ce moment-là.
        </p>
      </div>
      {message && <p className="text-sm">{message}</p>}

      <ul className="space-y-4">
        {seasons.map((s) => {
          const [label, style] = STATUS[s.status];
          return (
            <li key={s.key} className="glass space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold">{s.label}</p>
                  <p className="text-xs text-muted">
                    Du {new Date(s.startsAt).toLocaleDateString("fr-FR", { timeZone: "UTC" })} au {new Date(s.endsAt).toLocaleDateString("fr-FR", { timeZone: "UTC" })}
                    {" · "}{s.players} joueur(s) classé(s)
                    {s.closedAt && ` · clôturée le ${new Date(s.closedAt).toLocaleString("fr-FR")}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{label}</span>
                  {s.status === "to_close" && isAdminRole(me?.role) && (
                    <button onClick={() => close(s)} disabled={busy === s.key} className="btn-primary !py-2 text-sm">
                      {busy === s.key ? "Clôture…" : "Clôturer"}
                    </button>
                  )}
                </div>
              </div>
              {s.top.length > 0 ? (
                <ol className="divide-y divide-line/60 text-sm">
                  {s.top.map((e) => (
                    <li key={e.userId} className="flex items-center gap-3 py-2">
                      <span className={`w-6 font-mono ${e.rank <= 3 ? "text-neon" : "text-muted"}`}>{e.rank}</span>
                      <span className="flex-1">{e.username}{e.rank === 1 && (s.status === "closed" ? " 👑" : "")}</span>
                      <span className="font-mono">{e.score} pts</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Aucun point marqué pendant cette saison.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
