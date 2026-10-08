"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameDto, RankDto } from "@ranksight/shared";
import { API, adminFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { RankEmblem } from "@/components/RankEmblem";

const MAX_BYTES = 512 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

/** Images des rangs affichées aux joueurs. Sans image, un emblème aux couleurs du rang est utilisé. */
export default function RanksPage() {
  const confirm = useConfirm();
  const [games, setGames] = useState<GameDto[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API}/games`, { cache: "no-store" }).then((r) => r.json()).then(setGames, () => setMessage({ text: "Impossible de charger les jeux.", ok: false }));
  }, []);
  useEffect(load, [load]);

  const upload = async (rank: RankDto, file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setMessage({ text: "Formats acceptés : PNG, JPEG ou WebP.", ok: false });
    if (file.size > MAX_BYTES) return setMessage({ text: "Image trop lourde (512 Ko maximum).", ok: false });
    setBusy(rank.id);
    try {
      await adminFetch(`/ranks/${rank.id}/icon`, { method: "PUT", body: JSON.stringify({ dataUrl: await readAsDataUrl(file) }) });
      setMessage({ text: `Image de « ${rank.name} » mise à jour.`, ok: true });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const reset = async (rank: RankDto) => {
    const ok = await confirm({ title: `Retirer l'image de « ${rank.name} » ?`, message: "L'emblème par défaut, aux couleurs du rang, sera affiché à la place.", confirmLabel: "Retirer" });
    if (ok === false) return;
    try {
      await adminFetch(`/ranks/${rank.id}/icon`, { method: "DELETE" });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, ok: false });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Rangs</h1>
        <p className="text-sm text-muted">
          Images montrées aux joueurs au moment de choisir un rang et sur le résultat. PNG, JPEG ou WebP, 512 Ko maximum,
          format carré conseillé (256 × 256). N&apos;utilise que des images dont tu as le droit de te servir.
        </p>
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      {games.map((g) => (
        <div key={g.id} className="glass space-y-3 p-5">
          <h2 className="font-display text-lg font-semibold">{g.name}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {g.ranks.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <RankEmblem rank={r} size={48} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium" style={{ color: r.color }}>{r.name}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <label className="cursor-pointer text-violet-soft hover:underline">
                      {busy === r.id ? "Envoi…" : r.iconUrl ? "Remplacer" : "Ajouter une image"}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void upload(r, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                    {r.iconUrl && <button onClick={() => reset(r)} className="text-muted hover:text-danger">Retirer</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
