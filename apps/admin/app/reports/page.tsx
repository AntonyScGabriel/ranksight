"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/api";

type Report = { id: string; reason: string; details: string | null; createdAt: string; clip: { id: string; reportCount: number; game: { slug: string } }; reporter: { displayName: string } };

export default function ReportsPage() {
  const [items, setItems] = useState<Report[]>([]);
  const load = () => adminFetch<{ items: Report[] }>("/reports?status=OPEN").then((r) => setItems(r.items));
  useEffect(() => { void load(); }, []);

  const resolve = async (id: string, status: "RESOLVED" | "DISMISSED", archiveClip = false) => {
    await adminFetch(`/reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ status, resolution: status === "RESOLVED" ? "Corrigé" : "Non fondé", archiveClip }) });
    void load();
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Signalements ouverts ({items.length})</h1>
      <div className="glass overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left"><tr className="hud-label">{["Motif", "Jeu", "Clip (nb)", "Par", "Date", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line/60">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><span className="rounded bg-danger/15 px-2 py-0.5 text-xs text-danger">{r.reason}</span> {r.details}</td>
                <td className="px-4 py-3">{r.clip.game.slug}</td>
                <td className="px-4 py-3 font-mono">{r.clip.id.slice(0, 8)} ({r.clip.reportCount})</td>
                <td className="px-4 py-3">{r.reporter.displayName}</td>
                <td className="px-4 py-3 text-muted">{new Date(r.createdAt).toLocaleString("fr-FR")}</td>
                <td className="space-x-2 whitespace-nowrap px-4 py-3 text-right">
                  <button onClick={() => resolve(r.id, "RESOLVED", true)} className="btn-ghost !py-1">Archiver le clip</button>
                  <button onClick={() => resolve(r.id, "DISMISSED")} className="btn-ghost !py-1">Rejeter</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
