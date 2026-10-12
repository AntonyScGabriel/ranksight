"use client";

import { useEffect, useState } from "react";
import {
  CLIP_DURATION_LABEL, clipDurationOk,
  GAME_PLATFORMS, InGamePseudo, PLATFORM_LABEL, REGION_LABEL, REGIONS, firstIssue,
  type GameDto, type GameSlug, type Platform, type Region,
} from "@ranksight/shared";
import { adminFetch, uploadFile } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";

export default function UploadPage() {
  const [games, setGames] = useState<GameDto[]>([]);
  const [gameId, setGameId] = useState("");
  const [rankId, setRankId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [inGamePseudo, setInGamePseudo] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [region, setRegion] = useState<Region | "">("");
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { fetch(`${API}/games`).then((r) => r.json()).then(setGames); }, []);
  const game = games.find((g) => g.id === gameId);
  const platforms = game ? GAME_PLATFORMS[game.slug as GameSlug] ?? [] : [];

  const duration = (f: File) =>
    new Promise<number>((res) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); };
      v.src = URL.createObjectURL(f);
    });

  const submit = async () => {
    if (!file || !rankId || !consent) return;
    const pseudo = inGamePseudo.trim() ? InGamePseudo.safeParse(inGamePseudo) : null;
    if (pseudo && !pseudo.success) return setStatus(firstIssue(pseudo.error));
    try {
      const durationSec = await duration(file);
      if (!clipDurationOk(durationSec)) return setStatus(`Le clip doit durer de ${CLIP_DURATION_LABEL}.`);
      setStatus("Envoi…");
      const storageKey = await uploadFile(file, setProgress);
      await adminFetch("/clips", {
        method: "POST",
        body: JSON.stringify({
          gameId, rankId, storageKey, durationSec, proofUrl: proofUrl || undefined, creatorConsent: true,
          inGamePseudo: pseudo?.data, platform: platform || undefined, region: region || undefined,
        }),
      });
      setStatus("Clip publié : il fait maintenant partie des défis.");
      setFile(null); setProgress(0); setInGamePseudo("");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="glass max-w-xl space-y-5 p-6">
      <h1 className="font-display text-2xl font-bold">Ajouter un clip</h1>
      <p className="text-sm text-muted">Les clips ajoutés par l&apos;équipe sont publiés directement.</p>
      <select value={gameId} onChange={(e) => { setGameId(e.target.value); setRankId(""); setPlatform(""); }} className="w-full rounded-lg border border-line bg-surface p-2.5">
        <option value="">Choisir un jeu</option>
        {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <select value={rankId} onChange={(e) => setRankId(e.target.value)} disabled={!game} className="w-full rounded-lg border border-line bg-surface p-2.5">
        <option value="">{game ? "Rang réel du joueur" : "Choisis d'abord un jeu"}</option>
        {game?.ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <input value={inGamePseudo} onChange={(e) => setInGamePseudo(e.target.value)} maxLength={32} placeholder="Pseudo en jeu du joueur filmé (facultatif)" className="w-full rounded-lg border border-line bg-surface p-2.5" />
      <div className="grid gap-3 sm:grid-cols-2">
        <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | "")} disabled={platforms.length < 2} className="w-full rounded-lg border border-line bg-surface p-2.5">
          <option value="">{platforms.length === 1 ? PLATFORM_LABEL[platforms[0]] : "Plateforme (facultatif)"}</option>
          {platforms.length > 1 && platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value as Region | "")} className="w-full rounded-lg border border-line bg-surface p-2.5">
          <option value="">Région (facultatif)</option>
          {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
        </select>
      </div>
      <input type="url" placeholder="Preuve du rang (lien tracker / match history)" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="w-full rounded-lg border border-line bg-surface p-2.5" />
      <input type="file" accept="video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-violet file:px-4 file:py-2 file:text-white" />
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        L’auteur du clip a donné son accord écrit pour sa diffusion sur RankGuess.
      </label>
      {progress > 0 && <div className="h-2 rounded-full bg-white/5"><div className="h-full rounded-full bg-neon" style={{ width: `${progress * 100}%` }} /></div>}
      <button onClick={submit} disabled={!file || !rankId || !consent} className="btn-primary w-full">Envoyer</button>
      {status && <p className="text-sm">{status}</p>}
    </div>
  );
}
