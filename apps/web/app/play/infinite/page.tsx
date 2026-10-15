"use client";

import { useState } from "react";
import Link from "next/link";
import type { PlayableClipDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { GameRound } from "@/components/GameRound";
import { LoginRequired, NoClip, Skeleton } from "@/components/States";

export default function InfinitePage() {
  const { me, loading } = useSession();
  const [runId, setRunId] = useState<string | null>(null);
  const [clip, setClip] = useState<PlayableClipDto | null>(null);
  const [run, setRun] = useState({ lives: 3, score: 0, ended: false });
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    setRunId(null);
    setClip(null);
    if (e instanceof ApiError && e.status === 404) setEmpty(true);
    else setError("Impossible de lancer la partie pour le moment.");
  };

  const start = async () => {
    setError(null);
    setEmpty(false);
    try {
      const r = await api.startRun();
      setRunId(r.id);
      setRun({ lives: r.lives, score: 0, ended: false });
      setClip(await api.nextInfinite(r.id));
    } catch (e) {
      fail(e);
    }
  };

  const next = async () => {
    if (!runId) return;
    try {
      setClip(await api.nextInfinite(runId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setRun((r) => ({ ...r, ended: true }));
      else fail(e);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/play/infinite" />;
  if (empty) return <NoClip action={<Link href="/play/daily" className="btn-ghost mx-auto">Retour aux défis du jour</Link>} />;

  if (!runId || !clip) {
    return (
      <div className="glass animate-rise mx-auto max-w-lg space-y-4 p-8 text-center">
        <p className="hud-label">Mode Infini</p>
        <h1 className="font-display text-4xl font-bold">Jusqu&apos;où iras-tu&nbsp;?</h1>
        <p className="text-muted">3 vies. Tu en perds une à 2 rangs d&apos;écart ou plus. La difficulté monte tous les 3 clips.</p>
        <button onClick={start} className="btn-primary">Lancer une partie</button>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="border-t border-line/60 pt-4 text-sm text-muted">
          Autre défi solo : <Link href="/play/higher-lower" className="text-neon hover:underline">Plus haut / Plus bas</Link>, le rang du clip suivant est-il plus haut ou plus bas&nbsp;?
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Infini</h1>
        <div className="flex items-center gap-4 font-mono">
          <span aria-label={`${run.lives} vies restantes`}>
            {"♥".repeat(Math.max(run.lives, 0))}
            <span className="text-muted">{"♡".repeat(Math.max(0, 3 - run.lives))}</span>
          </span>
          <span className="text-neon">{run.score} pts</span>
        </div>
      </header>
      <GameRound
        key={clip.id}
        clip={clip}
        onResult={(r) => r.run && setRun({ lives: r.run.lives, score: r.run.score, ended: !!r.run.endedAt })}
        onNext={run.ended ? undefined : next}
      />
      {run.ended && (
        <div className="glass animate-rise p-6 text-center">
          <p className="font-display text-2xl font-bold">Partie terminée : {run.score} pts</p>
          <button onClick={start} className="btn-primary mt-4">Rejouer</button>
        </div>
      )}
    </section>
  );
}
