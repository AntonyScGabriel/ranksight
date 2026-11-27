"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/lib/api";

type ClipPromo = {
  source: "ADMIN" | "COMMUNITY";
  consent: boolean;
  consentAt: string | null;
  review: { status: "PENDING" | "APPROVED" | "REJECTED"; at: string | null; note: string | null; muteAudio: boolean };
  exportable: boolean;
  consentEvents: { action: "GRANT" | "WITHDRAW"; byOwner: boolean; termsVersion: string; reason: string | null; createdAt: string }[];
  uses: {
    id: string; tool: string; reference: string; consentVersion: string; createdAt: string; discardedAt: string | null;
    publications: { platform: string; url: string; publishedAt: string; removal: { status: string; dueAt: string; doneAt: string | null } | null }[];
  }[];
};

const fmt = (d: string) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const REVIEW_LABEL = { PENDING: "À vérifier", APPROVED: "Apte", REJECTED: "Non retenu" } as const;

/**
 * Promotion sur les réseaux sociaux : l'accord ne peut venir que de l'auteur (lecture seule ici). La modération vérifie
 * seulement que le clip peut être montré (voix, identifiants, musique, éléments protégés) et peut faire couper le son.
 */
export function PromoPanel({ clipId }: { clipId: string }) {
  const [data, setData] = useState<ClipPromo | null>(null);
  const [note, setNote] = useState("");
  const [muteAudio, setMuteAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<ClipPromo>(`/clips/${clipId}/promo`).then(
      (d) => {
        setData(d);
        setMuteAudio(d.review.muteAudio);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [clipId]);
  useEffect(load, [load]);

  const review = async (decision: "APPROVED" | "REJECTED") => {
    try {
      await adminFetch(`/clips/${clipId}/promo-review`, { method: "POST", body: JSON.stringify({ decision, muteAudio, note: note.trim() || undefined }) });
      setNote("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!data) return null;
  return (
    <section className="space-y-3 rounded-xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Vidéos promotionnelles</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${data.exportable ? "bg-success/15 text-success" : "bg-white/5 text-muted"}`}>
          {data.exportable ? "Utilisable" : "Non utilisable"}
        </span>
      </div>
      {data.source === "ADMIN" ? (
        <p className="text-xs text-muted">Clip ajouté par l&apos;équipe : jamais utilisé, car son auteur ne peut pas donner son accord sur le site.</p>
      ) : (
        <>
          <p className="text-xs text-muted">
            Accord de l&apos;auteur : <span className="text-ink">{data.consent && data.consentAt ? `donné le ${fmt(data.consentAt)}` : "absent ou retiré"}</span>{" "}
            (lui seul peut le donner ou le retirer). Vérification : <span className="text-ink">{REVIEW_LABEL[data.review.status]}</span>
            {data.review.note && ` (${data.review.note})`}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (voix, identifiants, musique…)" className="input flex-1 !py-1.5 text-xs" />
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={muteAudio} onChange={(e) => setMuteAudio(e.target.checked)} /> Couper le son
            </label>
            <button onClick={() => review("APPROVED")} className="btn-ghost !py-1.5 text-xs">Apte</button>
            <button onClick={() => review("REJECTED")} className="btn-ghost !py-1.5 text-xs">Non retenu</button>
          </div>
        </>
      )}
      {data.consentEvents.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {data.consentEvents.map((e) => (
            <li key={e.createdAt + e.action}>
              {fmt(e.createdAt)} · {e.action === "GRANT" ? "Accord" : "Retrait"} ({e.byOwner ? "auteur" : "système"}, conditions {e.termsVersion}){e.reason && ` · ${e.reason}`}
            </li>
          ))}
        </ul>
      )}
      {data.uses.map((u) => (
        <div key={u.id} className="rounded-lg bg-white/5 p-2 text-xs">
          <p>
            {u.tool} · {u.reference} · {fmt(u.createdAt)} · accord {u.consentVersion}
            {u.discardedAt && ` · abandonnée le ${fmt(u.discardedAt)}`}
          </p>
          {u.publications.map((p) => (
            <p key={p.platform} className="text-muted">
              {p.platform} · <a href={p.url} target="_blank" rel="noreferrer" className="underline">{p.url}</a> · {fmt(p.publishedAt)}
              {p.removal && ` · suppression ${p.removal.status === "OPEN" ? `à faire avant le ${fmt(p.removal.dueAt)}` : `faite le ${p.removal.doneAt ? fmt(p.removal.doneAt) : "—"}`}`}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
