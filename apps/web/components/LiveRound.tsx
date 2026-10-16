"use client";

import { useCallback, useRef, useState } from "react";
import type { PlayableClipDto } from "@ranksight/shared";
import { api, ApiError, media } from "@/lib/api";
import { errorMessage } from "@/components/AuthForm";
import { ClipPlayer } from "@/components/ClipPlayer";
import { RankPicker } from "@/components/RankPicker";

/** Clip d'une manche en direct (duel ou salon) : position, nombre de manches et fin du chrono (dates du serveur) */
export type LiveClip = PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string };

export function TimerBar({ progress }: { progress: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className={`h-full transition-[width] duration-200 ${progress < 0.25 ? "bg-danger" : "bg-neon"}`} style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

/**
 * Manche en cours d'un duel ou d'un salon : clip, choix du rang et chrono.
 * La réponse est enregistrée sans rien dévoiler : le rang réel n'apparaît qu'à la fin de la manche, pour tout le monde.
 */
export function LiveRound({
  clip, secondsLeft, progress, onSubmitted, onClosed, label,
}: {
  clip: LiveClip; secondsLeft: number; progress: number; onSubmitted: () => void; onClosed: () => void; label?: string;
}) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchedMs = useRef(0);
  const onWatched = useCallback((ms: number) => { watchedMs.current = ms; }, []);

  const submit = async () => {
    if (!rankId || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.liveGuess({ playToken: clip.playToken, rankId, watchedMs: watchedMs.current });
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "ROUND_OVER" || e.code === "ALREADY_ANSWERED")) onClosed();
      setError(errorMessage(e, "Ta réponse n'a pas pu être envoyée, réessaie."));
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="hud-label">{label ?? `Manche ${clip.position}/${clip.rounds}`} · {clip.game.name}</p>
        <p className={`font-display text-2xl font-bold ${secondsLeft <= 5 ? "text-danger" : ""}`} aria-live="polite">{secondsLeft} s</p>
      </div>
      <TimerBar progress={progress} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <ClipPlayer src={media(clip.videoUrl)} poster={clip.posterUrl ? media(clip.posterUrl) : null} onWatched={onWatched} />
        <div className="glass space-y-5 p-6">
          <h2 className="font-display text-2xl font-bold">Quel est son rang&nbsp;?</h2>
          <RankPicker ranks={clip.ranks} value={rankId} onChange={setRankId} disabled={pending} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={submit} disabled={!rankId || pending} className="btn-primary w-full">{pending ? "Envoi…" : "Valider"}</button>
        </div>
      </div>
    </div>
  );
}
