"use client";

import { useCallback, useRef, useState } from "react";
import type { GuessResultDto, PlayableClipDto } from "@ranksight/shared";
import { scoreTable } from "@ranksight/shared";
import { errorMessage } from "./AuthForm";
import { api, ApiError, media } from "@/lib/api";
import { ClipPlayer } from "./ClipPlayer";
import { RankPicker } from "./RankPicker";
import { ResultCard } from "./ResultCard";

/** Une manche : clip → choix du rang → validation → résultat. Partagé par les défis du jour et le mode Infini. */
export function GameRound({
  clip,
  onResult,
  onNext,
  nextLabel,
}: {
  clip: PlayableClipDto;
  onResult?: (r: GuessResultDto & { run?: { lives: number; score: number; endedAt: string | null } }) => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [result, setResult] = useState<GuessResultDto | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const watchedMs = useRef(0);
  const onWatched = useCallback((ms: number) => { watchedMs.current = ms; }, []);

  const submit = async () => {
    if (!rankId) return;
    setPending(true);
    setError(null);
    try {
      const r = await api.guess({ playToken: clip.playToken, rankId, watchedMs: watchedMs.current });
      setResult(r);
      onResult?.(r);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "ALREADY_ANSWERED" ? e.message : errorMessage(e, "Ta réponse n'a pas pu être envoyée, réessaie."));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="hud-label">{clip.game.name} · {Math.round(clip.durationSec)} s</p>
          <p className="hud-label">Difficulté {"◆".repeat(clip.difficulty)}{"◇".repeat(5 - clip.difficulty)}</p>
        </div>
        <ClipPlayer src={media(clip.videoUrl)} poster={clip.posterUrl ? media(clip.posterUrl) : null} onWatched={onWatched} kind={clip.videoKind} durationSec={clip.durationSec} />
        <button
          onClick={() => api.report(clip.id, "WRONG_RANK").then(() => setReported(true), () => setReported(true))}
          disabled={reported}
          className="text-xs text-muted hover:text-danger disabled:hover:text-muted"
        >
          {reported ? "Merci, le clip sera vérifié." : "⚑ Signaler ce clip"}
        </button>
      </div>

      {result ? (
        <ResultCard result={result} ranks={clip.ranks} gameName={clip.game.name} onNext={onNext} nextLabel={nextLabel} />
      ) : (
        <div className="glass space-y-5 p-6">
          <div>
            <h2 className="font-display text-2xl font-bold">Quel est son rang&nbsp;?</h2>
            <p className="text-sm text-muted">
              {scoreTable().map((pts, d) => (d === 0 ? `Rang exact : ${pts} pts` : `${d} rang${d > 1 ? "s" : ""} d'écart : ${pts}`)).join(" · ")} · au-delà : 0
            </p>
          </div>
          <RankPicker ranks={clip.ranks} value={rankId} onChange={setRankId} disabled={pending} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={submit} disabled={!rankId || pending} className="btn-primary w-full">
            {pending ? "Validation…" : "Valider"}
          </button>
        </div>
      )}
    </div>
  );
}
