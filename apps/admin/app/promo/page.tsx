"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/api";

type Removal = {
  id: string; clipId: string; reference: string; platform: string; url: string; reason: string;
  requestedAt: string; dueAt: string; status: "OPEN" | "DONE"; doneAt: string | null;
};

const fmt = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/**
 * Vidéos promotionnelles à retirer des comptes officiels après la fin d'un accord (délai annoncé : 30 jours).
 * Les réseaux ne permettent pas de les supprimer automatiquement : la suppression est faite à la main, puis confirmée ici.
 */
export default function PromoRemovalsPage() {
  const [status, setStatus] = useState<"OPEN" | "DONE">("OPEN");
  const [items, setItems] = useState<Removal[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<Removal[]>(`/promo/removals?status=${status}`).then(setItems, (e: Error) => setError(e.message));
  }, [status]);
  useEffect(load, [load]);

  const done = async (id: string) => {
    try {
      await adminFetch(`/promo/removals/${id}/done`, { method: "POST", body: JSON.stringify({ note: notes[id] ?? "" }) });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Vidéos promotionnelles à retirer</h1>
        <p className="text-sm text-muted">
          Publications des comptes officiels dont l&apos;accord a pris fin. Supprime la vidéo sur le réseau, puis confirme ici avec une note
          (date, compte). Les copies faites par des tiers ne peuvent pas être supprimées par RankSight.
        </p>
      </header>
      <div className="flex gap-2">
        {(["OPEN", "DONE"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-lg px-3 py-1.5 text-sm ${status === s ? "bg-violet text-white" : "text-muted"}`}>
            {s === "OPEN" ? "À faire" : "Faites"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Aucune demande.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => {
            const late = r.status === "OPEN" && new Date(r.dueAt) < new Date();
            return (
              <li key={r.id} className="glass space-y-2 p-4 text-sm">
                <p className="font-medium">
                  {r.platform} · <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.url}</a>
                </p>
                <p className="text-xs text-muted">
                  Clip {r.clipId} · vidéo {r.reference} · {r.reason} · demandée le {fmt(r.requestedAt)} ·{" "}
                  <span className={late ? "text-danger" : ""}>{r.status === "OPEN" ? `à faire avant le ${fmt(r.dueAt)}` : `faite le ${r.doneAt ? fmt(r.doneAt) : "—"}`}</span>
                </p>
                {r.status === "OPEN" && (
                  <div className="flex gap-2">
                    <input
                      value={notes[r.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                      maxLength={300}
                      placeholder="Note obligatoire (ex. supprimée le 03/12 sur le compte officiel)"
                      className="input flex-1 !py-1.5 text-xs"
                    />
                    <button onClick={() => done(r.id)} disabled={(notes[r.id] ?? "").trim().length < 3} className="btn-primary !py-1.5 text-xs">
                      Suppression faite
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
