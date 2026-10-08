"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GAME_PLATFORMS, InGamePseudo, PLATFORM_LABEL, REGION_LABEL, REGIONS, firstIssue,
  type GameDto, type GameSlug, type Platform, type Region,
} from "@ranksight/shared";
import { api, ApiError, uploadToSignedUrl, videoDuration } from "@/lib/api";
import { useSession } from "@/lib/session";
import { LoginRequired, Skeleton } from "@/components/States";

const MAX_BYTES = 80 * 1024 * 1024;

export default function SubmitPage() {
  const { me, loading } = useSession();
  const [games, setGames] = useState<GameDto[]>([]);
  const [gameId, setGameId] = useState("");
  const [rankId, setRankId] = useState("");
  const [inGamePseudo, setInGamePseudo] = useState("");
  const [pseudoError, setPseudoError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform | "">("");
  const [region, setRegion] = useState<Region | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.games().then(setGames).catch(() => setError("Impossible de charger la liste des jeux."));
  }, []);

  const game = games.find((g) => g.id === gameId);
  const platforms = game ? GAME_PLATFORMS[game.slug as GameSlug] ?? [] : [];

  const chooseGame = (id: string) => {
    setGameId(id);
    setRankId("");
    setPlatform("");
    // Pré-remplit avec le dernier pseudo en jeu utilisé pour ce jeu (modifiable)
    const slug = games.find((g) => g.id === id)?.slug;
    const last = me?.inGamePseudos.find((p) => p.game.slug === slug)?.inGamePseudo;
    if (last && !inGamePseudo.trim()) setInGamePseudo(last);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pseudo = InGamePseudo.safeParse(inGamePseudo);
    if (!pseudo.success) return setPseudoError(firstIssue(pseudo.error));
    if (!file || !game || !rankId || !rights) return;
    setError(null);
    if (!["video/mp4", "video/webm"].includes(file.type)) return setError("Formats acceptés : MP4 ou WebM.");
    if (file.size > MAX_BYTES) return setError("La vidéo dépasse 80 Mo.");
    let durationSec: number;
    try {
      durationSec = await videoDuration(file);
    } catch {
      return setError("Cette vidéo ne peut pas être lue.");
    }
    if (durationSec < 15 || durationSec > 30.5) return setError("Le clip doit durer entre 15 et 30 secondes.");

    setSending(true);
    try {
      const { key, url } = await api.uploadUrl(file.type, file.size);
      await uploadToSignedUrl(url, file, setProgress);
      await api.submitClip({
        gameId: game.id,
        rankId,
        inGamePseudo: pseudo.data,
        platform: platform || (platforms.length === 1 ? platforms[0] : undefined),
        region: region || undefined,
        storageKey: key,
        durationSec,
        proofUrl: proofUrl.trim() || undefined,
        note: note.trim() || undefined,
        ownsRights: true,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "L'envoi a échoué, réessaie.");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/submit" text="Connecte-toi pour proposer un clip." />;

  if (done) {
    return (
      <div className="glass animate-rise mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="font-display text-2xl font-bold">Clip envoyé</h1>
        <p className="text-muted">Il est en attente de validation. Tu peux suivre son statut dans « Mes clips ».</p>
        <div className="flex justify-center gap-3">
          <Link href="/my-clips" className="btn-primary">Mes clips</Link>
          <button onClick={() => { setDone(false); setFile(null); setProgress(0); setNote(""); setProofUrl(""); setRights(false); }} className="btn-ghost">En proposer un autre</button>
        </div>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Proposer un clip</h1>
        <p className="mt-1 text-muted">Ton clip sera vérifié avant d&apos;être proposé aux autres joueurs.</p>
      </header>

      <form onSubmit={submit} className="glass space-y-4 p-6">
        <Field label="Jeu">
          <select value={gameId} onChange={(e) => chooseGame(e.target.value)} required className="input">
            <option value="">Choisir un jeu</option>
            {games.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Clip vidéo (MP4 ou WebM, 15 à 30 s, 80 Mo max)">
          <input type="file" accept="video/mp4,video/webm" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-4 file:rounded-lg file:border-0 file:bg-violet file:px-4 file:py-2 file:text-white" />
        </Field>
        <Field label="Pseudo en jeu *">
          <input
            value={inGamePseudo}
            onChange={(e) => { setInGamePseudo(e.target.value); setPseudoError(null); }}
            onBlur={() => inGamePseudo && setPseudoError(InGamePseudo.safeParse(inGamePseudo).success ? null : firstIssue(InGamePseudo.safeParse(inGamePseudo).error!))}
            required
            maxLength={32}
            placeholder="Ex. Player123#EUW"
            aria-invalid={!!pseudoError}
            className={`input ${pseudoError ? "border-danger" : ""}`}
          />
          {pseudoError ? (
            <span className="block text-xs text-danger">{pseudoError}</span>
          ) : (
            <span className="block text-xs text-muted">
              Le pseudo du joueur dans la partie (Riot ID, nom Steam, Epic…). Il n&apos;est montré aux joueurs qu&apos;après leur réponse.
              Ton pseudo RankGuess ({me.displayName}) reste distinct.
            </span>
          )}
        </Field>
        <Field label="Rang réel du joueur">
          <select value={rankId} onChange={(e) => setRankId(e.target.value)} required disabled={!game} className="input">
            <option value="">{game ? "Choisir un rang" : "Choisis d'abord un jeu"}</option>
            {game?.ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plateforme (facultatif)">
            <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform | "")} disabled={platforms.length < 2} className="input">
              <option value="">{platforms.length === 1 ? PLATFORM_LABEL[platforms[0]] : "Non précisée"}</option>
              {platforms.length > 1 && platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Région (facultatif)">
            <select value={region} onChange={(e) => setRegion(e.target.value as Region | "")} className="input">
              <option value="">Non précisée</option>
              {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Preuve du rang (facultatif)">
          <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="Lien vers ton profil tracker ou l'historique de la partie" className="input" />
        </Field>
        <Field label="Contexte (facultatif)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="Mode de jeu, saison, ce qu'il faut savoir sur ce clip…" className="input" />
        </Field>
        <ul className="list-inside list-disc space-y-1 text-xs text-muted">
          <li>Le pseudo, le rang et les indices de classement ne doivent pas être visibles.</li>
          <li>Pas de contenu choquant ni de propos offensants.</li>
        </ul>
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1" />
          Je suis l&apos;auteur de ce clip ou j&apos;ai l&apos;accord de son auteur pour le publier.
        </label>
        {sending && progress > 0 && (
          <div className="h-2 rounded-full bg-white/5"><div className="h-full rounded-full bg-neon transition-[width]" style={{ width: `${progress * 100}%` }} /></div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <button disabled={!file || !rankId || !inGamePseudo.trim() || !rights || sending} className="btn-primary w-full">{sending ? "Envoi en cours…" : "Envoyer le clip"}</button>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="hud-label">{label}</span>
      {children}
    </label>
  );
}
