"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAT_REPORT_REASON_LABEL, type ChatReportReason, isAdminRole } from "@ranksight/shared";
import { adminFetch, media, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Status = "OPEN" | "RESOLVED" | "DISMISSED";
type Report = {
  id: string; createdAt: string; reason: ChatReportReason; details: string | null; excerpt: string | null; status: Status;
  resolution: string | null; resolvedAt: string | null; globalMessageId: string | null; directMessageId: string | null;
  reporter: { id: string; displayName: string };
  target: {
    id: string; displayName: string; username: string; status: string; chatMutedUntil: string | null; avatarUrl: string | null;
    _count: { chatReportsAbout: number };
  };
  resolver: { displayName: string } | null;
  globalMessage: { id: string; deletedAt: string | null } | null;
};

const TABS: [Status, string][] = [["OPEN", "À traiter"], ["RESOLVED", "Sanctionnés"], ["DISMISSED", "Classés sans suite"]];
const MUTES: [number, string][] = [[0, "Pas de sanction"], [1, "Chat coupé 1 h"], [24, "Chat coupé 24 h"], [168, "Chat coupé 7 jours"], [720, "Chat coupé 30 jours"]];

/** Signalements de joueurs (chat global, messages privés, profils) et sanctions. */
export default function ModerationPage() {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Status>("OPEN");
  const [data, setData] = useState<{ items: Report[]; total: number } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, { mute: number; del: boolean; note: string }>>({});

  const load = useCallback(() => {
    adminFetch<{ items: Report[]; total: number }>(`/player-reports?status=${tab}`).then(setData, (e: Error) => setMessage(e.message));
  }, [tab]);
  useEffect(load, [load]);
  useEffect(() => {
    session.me().then(setMe, () => setMe(null));
  }, []);

  const choice = (id: string) => choices[id] ?? { mute: 0, del: true, note: "" };
  const setChoice = (id: string, patch: Partial<{ mute: number; del: boolean; note: string }>) =>
    setChoices((c) => ({ ...c, [id]: { ...choice(id), ...patch } }));

  const resolve = async (r: Report, status: "RESOLVED" | "DISMISSED", ban = false) => {
    const c = choice(r.id);
    if (ban) {
      const ok = await confirm({ title: `Bannir ${r.target.displayName} ?`, message: "Le compte est suspendu et toutes ses sessions sont fermées.", confirmLabel: "Bannir", danger: true });
      if (ok === false) return;
    }
    setMessage(null);
    try {
      await adminFetch(`/player-reports/${r.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          status,
          resolution: c.note || undefined,
          deleteMessage: status === "RESOLVED" && c.del && !!r.globalMessageId,
          muteHours: status === "RESOLVED" ? c.mute : 0,
          ban,
        }),
      });
      setMessage(status === "DISMISSED" ? "Signalement classé sans suite." : "Signalement traité.");
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const removeAvatar = async (r: Report) => {
    const ok = await confirm({ title: `Retirer la photo de ${r.target.displayName} ?`, message: "L'initiale de son pseudo sera affichée à la place.", confirmLabel: "Retirer la photo", danger: true });
    if (ok === false) return;
    setMessage(null);
    try {
      await adminFetch(`/users/${r.target.id}/avatar`, { method: "DELETE" });
      setMessage(`Photo de ${r.target.displayName} retirée. Pense à traiter le signalement.`);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Signalements de joueurs</h1>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist">
          {TABS.map(([s, label]) => (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === s ? "bg-violet text-white" : "text-muted hover:text-ink"}`}>
              {label}{tab === s && data ? ` (${data.total})` : ""}
            </button>
          ))}
        </div>
      </div>
      {message && <p role="status" className="glass p-3 text-sm">{message}</p>}
      {!data ? <p className="text-muted">Chargement…</p> : data.items.length === 0 ? (
        <p className="glass p-6 text-center text-muted">Aucun signalement ici.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((r) => {
            const c = choice(r.id);
            return (
              <li key={r.id} className="glass space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {r.target.displayName} <span className="text-xs text-muted">@{r.target.username}</span>
                      {r.target.status !== "ACTIVE" && <span className="ml-2 rounded bg-danger/15 px-1.5 text-xs text-danger">{r.target.status === "BANNED" ? "banni" : r.target.status}</span>}
                      {r.target.chatMutedUntil && new Date(r.target.chatMutedUntil) > new Date() && <span className="ml-2 rounded bg-warn/15 px-1.5 text-xs text-warn">chat coupé</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {CHAT_REPORT_REASON_LABEL[r.reason]} · signalé par {r.reporter.displayName} le {new Date(r.createdAt).toLocaleString("fr-FR")}
                      {" "}· {r.target._count.chatReportsAbout} signalement(s) au total sur ce joueur
                    </p>
                  </div>
                  <span className="rounded-full bg-violet/20 px-2.5 py-0.5 text-xs text-violet-soft">
                    {r.globalMessageId ? "Chat global" : r.directMessageId ? "Message privé" : "Profil"}
                  </span>
                </div>
                {r.excerpt && (
                  <blockquote className={`rounded-lg border-l-2 border-danger/60 bg-surface-2 p-3 text-sm ${r.globalMessage?.deletedAt ? "line-through opacity-60" : ""}`}>
                    {r.excerpt}
                  </blockquote>
                )}
                {r.details && <p className="text-sm"><span className="text-muted">Précisions : </span>{r.details}</p>}
                {r.reason === "INAPPROPRIATE_AVATAR" && (
                  <div className="flex items-center gap-3 text-sm">
                    {r.target.avatarUrl ? (
                      <>
                        <img src={media(r.target.avatarUrl)} alt={`Photo de ${r.target.displayName}`} width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
                        {r.status === "OPEN" && <button onClick={() => removeAvatar(r)} className="btn-ghost !py-1 hover:!border-danger hover:!text-danger">Retirer la photo</button>}
                      </>
                    ) : (
                      <span className="text-muted">Le joueur n&apos;a plus de photo de profil.</span>
                    )}
                  </div>
                )}
                {r.status === "OPEN" ? (
                  <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-3 text-sm">
                    <select value={c.mute} onChange={(e) => setChoice(r.id, { mute: Number(e.target.value) })} className="input !w-auto" aria-label="Sanction">
                      {MUTES.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
                    </select>
                    {r.globalMessageId && !r.globalMessage?.deletedAt && (
                      <label className="flex items-center gap-2"><input type="checkbox" checked={c.del} onChange={(e) => setChoice(r.id, { del: e.target.checked })} className="accent-violet" /> Supprimer le message</label>
                    )}
                    <input value={c.note} onChange={(e) => setChoice(r.id, { note: e.target.value })} maxLength={300} placeholder="Note interne (facultatif)" className="input min-w-48 flex-1" />
                    <button onClick={() => resolve(r, "RESOLVED")} className="btn-primary !py-2">Sanctionner</button>
                    <button onClick={() => resolve(r, "DISMISSED")} className="btn-ghost">Classer sans suite</button>
                    {isAdminRole(me?.role) && r.target.status === "ACTIVE" && (
                      <button onClick={() => resolve(r, "RESOLVED", true)} className="btn-ghost hover:!border-danger hover:!text-danger">Bannir</button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Traité par {r.resolver?.displayName ?? "—"} le {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString("fr-FR") : "—"}
                    {r.resolution ? ` · ${r.resolution}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
