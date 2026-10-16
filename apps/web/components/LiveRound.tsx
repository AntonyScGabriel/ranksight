"use client";

import { useCallback, useRef, useState } from "react";
import { CONFIDENCE_STAKES, CONFIDENCE_STAKE_LABEL, type PlayableClipDto } from "@ranksight/shared";
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
  clip, secondsLeft, progress, onSubmitted, onClosed, label, tokens,
}: {
  clip: LiveClip; secondsLeft: number; progress: number; onSubmitted: () => void; onClosed: () => void; label?: string;
  /** Mode Confiance : solde du joueur ; la réponse engage alors 1 à 3 jetons (0 seulement avec un solde vide) */
  tokens?: number;
}) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [stake, setStake] = useState(tokens === undefined ? 0 : Math.min(1, tokens));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchedMs = useRef(0);
  const onWatched = useCallback((ms: number) => { watchedMs.current = ms; }, []);

  const submit = async () => {
    if (!rankId) return;
    setPending(true);
    setError(null);
    try {
      await api.liveGuess({ playToken: clip.playToken, rankId, watchedMs: watchedMs.current, ...(tokens !== undefined ? { stake } : {}) });
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
          {tokens !== undefined && (
            <div className="space-y-2">
              <p className="hud-label">Ta mise · {tokens} jeton{tokens > 1 ? "s" : ""}</p>
              {tokens === 0 ? (
                <p className="text-sm text-muted">Solde vide : tu réponds sans mise. Recharge gratuite chaque jour dans « Salons ».</p>
              ) : (
                <div role="radiogroup" aria-label="Mise" className="grid grid-cols-3 gap-2">
                  {CONFIDENCE_STAKES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={stake === n}
                      disabled={pending || n > tokens}
                      onClick={() => setStake(n)}
                      className={`rounded-xl border px-2 py-2 text-sm transition disabled:opacity-40 ${stake === n ? "border-warn bg-warn/15 text-ink" : "border-line text-muted hover:text-ink"}`}
                    >
                      <span className="block font-display text-lg font-bold">{n}</span>
                      {CONFIDENCE_STAKE_LABEL[n]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={submit} disabled={!rankId || pending} className="btn-primary w-full">{pending ? "Envoi…" : "Valider"}</button>
        </div>
      </div>
    </div>
  );
}
