"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlayableClipDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { GameRound } from "@/components/GameRound";
import { ErrorPanel, LoginRequired, NoClip, Panel, Skeleton } from "@/components/States";

type State = { kind: "loading" } | { kind: "ready"; clip: PlayableClipDto } | { kind: "auth" } | { kind: "none" } | { kind: "played"; message: string } | { kind: "error" };

/** Défi du jour d'un jeu : une seule tentative par jour. */
export default function DailyGamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = use(params);
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    api
      .daily(game)
      .then((clip) => setState({ kind: "ready", clip }))
      .catch((e: ApiError) =>
        setState(
          e.status === 401 ? { kind: "auth" }
          : e.status === 409 ? { kind: "played", message: e.message }
          : e.status === 404 ? { kind: "none" }
          : { kind: "error" },
        ),
      );
  }, [game]);

  useEffect(load, [load]);

  const back = (
    <Link href="/play/daily" className="btn-ghost mx-auto w-fit">← Défis du jour</Link>
  );

  if (state.kind === "loading") return <Skeleton className="aspect-video" />;
  if (state.kind === "auth") return <LoginRequired next={`/play/daily/${game}`} />;
  if (state.kind === "none") return <NoClip action={back} />;
  if (state.kind === "played") {
    return (
      <Panel title="Défi déjà joué" text={state.message}>
        <div className="flex justify-center gap-3">
          <Link href="/play/daily" className="btn-primary">Autres défis du jour</Link>
          <Link href="/leaderboard" className="btn-ghost">Classement</Link>
        </div>
      </Panel>
    );
  }
  if (state.kind === "error") {
    return (
      <ErrorPanel
        retry={() => {
          setState({ kind: "loading" });
          load();
        }}
      />
    );
  }

  const { clip } = state;
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label">
            Défi du jour · {new Date(`${clip.dailyDate}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}
          </p>
          <h1 className="font-display text-3xl font-bold">{clip.game.name}</h1>
        </div>
        <Link href="/play/daily" className="btn-ghost">← Tous les défis</Link>
      </header>
      <GameRound clip={clip} onNext={() => router.push("/play/daily")} nextLabel="Défis du jour" />
    </section>
  );
}
