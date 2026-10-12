"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, session, type Me } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Report = { at: string; rejectedExpired: number; deletedFiles: number; freedBytes: number; processed: number; errors: number };
type Overview = {
  driver: "local" | "s3";
  ffmpeg: boolean;
  files: number;
  totalBytes: number;
  byFolder: Record<string, { files: number; bytes: number }>;
  clips: { withFiles: number; rejectedWithFiles: number; waitingCompression: number; compressed: number; savedBytes: number };
  rules: { maxHeight: number; rejectedKeepDays: number; orphanAfterHours: number };
  lastCleanup: Report | null;
};

const FOLDERS: Record<string, string> = { raw: "Envois d'origine", clips: "Vidéos compressées", posters: "Images d'aperçu", hls: "Flux adaptatifs", avatars: "Photos de profil" };

function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** Stockage des vidéos (fondateur) : place occupée, compression, nettoyage automatique (chaque nuit) ou manuel. */
export default function StoragePage() {
  const confirm = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<Overview>("/storage").then(setData, (e: Error) => setMessage(e.message));
  }, []);
  useEffect(() => {
    load();
    session.me().then(setMe, () => setMe(null));
  }, [load]);

  const cleanup = async () => {
    const ok = await confirm({
      title: "Lancer le nettoyage maintenant ?",
      message: "Compression des vidéos en attente, puis suppression des fichiers inutiles : clips supprimés, clips refusés depuis plus de 14 jours, envois abandonnés. Les clips jouables ne sont jamais touchés.",
      confirmLabel: "Nettoyer",
    });
    if (ok === false) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await adminFetch<Report>("/storage/cleanup", { method: "POST" });
      setMessage(`Nettoyage terminé : ${r.deletedFiles} fichier(s) supprimé(s), ${formatBytes(r.freedBytes)} libérés, ${r.processed} vidéo(s) compressée(s).`);
      load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-muted">{message ?? "Chargement…"}</p>;

  const cards: [string, string][] = [
    ["Espace utilisé", formatBytes(data.totalBytes)],
    ["Fichiers", data.files.toLocaleString("fr-FR")],
    ["Gagné par la compression", formatBytes(Math.max(0, data.clips.savedBytes))],
    ["Vidéos à compresser", String(data.clips.waitingCompression)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Stockage</h1>
        {me?.siteOwner && (
          <button onClick={cleanup} disabled={busy} className="btn-primary !py-2">{busy ? "Nettoyage…" : "Nettoyer maintenant"}</button>
        )}
      </div>
      {message && <p role="status" className="glass p-3 text-sm">{message}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([k, v]) => (
          <div key={k} className="glass p-5">
            <p className="hud-label">{k}</p>
            <p className="mt-1 font-display text-3xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass space-y-3 p-6">
          <h2 className="font-display text-lg font-semibold">Configuration</h2>
          <ul className="space-y-2 text-sm">
            <li>
              <span className="text-muted">Stockage : </span>
              {data.driver === "s3" ? "service S3 (Cloudflare R2)" : "disque du serveur (développement)"}
            </li>
            <li>
              <span className="text-muted">Compression : </span>
              {data.ffmpeg
                ? <span className="text-success">active ({data.rules.maxHeight}p, H.264)</span>
                : <span className="text-warn">inactive : ffmpeg n&apos;est pas installé sur le serveur</span>}
            </li>
            <li><span className="text-muted">Clips refusés : </span>vidéo supprimée après {data.rules.rejectedKeepDays} jours</li>
            <li><span className="text-muted">Envois abandonnés : </span>supprimés après {data.rules.orphanAfterHours} heures</li>
            <li><span className="text-muted">Nettoyage automatique : </span>chaque nuit à 3 h 30 (UTC)</li>
          </ul>
        </div>

        <div className="glass space-y-3 p-6">
          <h2 className="font-display text-lg font-semibold">Par dossier</h2>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(data.byFolder).map(([folder, v]) => (
                <tr key={folder} className="border-t border-line/60 first:border-0">
                  <td className="py-2">{FOLDERS[folder] ?? folder}</td>
                  <td className="text-right text-muted">{v.files} fichier(s)</td>
                  <td className="text-right font-medium">{formatBytes(v.bytes)}</td>
                </tr>
              ))}
              {Object.keys(data.byFolder).length === 0 && <tr><td className="py-2 text-muted">Aucun fichier.</td></tr>}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            {data.clips.withFiles} clip(s) avec vidéo, dont {data.clips.rejectedWithFiles} refusé(s) · {data.clips.compressed} compressé(s).
          </p>
        </div>
      </div>

      <div className="glass p-6 text-sm">
        <h2 className="mb-2 font-display text-lg font-semibold">Dernier nettoyage</h2>
        {data.lastCleanup ? (
          <p>
            Le {new Date(data.lastCleanup.at).toLocaleString("fr-FR")} : {data.lastCleanup.deletedFiles} fichier(s) supprimé(s),{" "}
            {formatBytes(data.lastCleanup.freedBytes)} libérés, {data.lastCleanup.rejectedExpired} clip(s) refusé(s) expiré(s),{" "}
            {data.lastCleanup.processed} vidéo(s) compressée(s){data.lastCleanup.errors ? `, ${data.lastCleanup.errors} erreur(s)` : ""}.
          </p>
        ) : (
          <p className="text-muted">Pas encore de nettoyage.</p>
        )}
      </div>
    </div>
  );
}
