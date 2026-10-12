"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DAILY_PER_GAME, type PlayableClipDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { GameRound } from "@/components/GameRound";
import { ErrorPanel, LoginRequired, NoClip, Panel, Skeleton } from "@/components/States";

type State = { kind: "loading" } | { kind: "ready"; clip: PlayableClipDto & { slot: number }; remaining: number[] } | { kind: "auth" } | { kind: "none" } | { kind: "played"; message: string } | { kind: "error" };

/** Un des défis du jour d'un jeu (?slot=1 à 3, sinon le premier pas encore joué) : une seule tentative par défi. */
export default function DailyGamePage({ params, searchParams }: { params: Promise<{ game: string }>; searchParams: Promise<{ slot?: string }> }) {
  const { game } = use(params);
  const requested = Number(use(searchParams).slot);
  const slot = Number.isInteger(requested) && requested >= 1 && requested <= DAILY_PER_GAME ? requested : undefined;
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    Promise.all([api.daily(game, slot), api.dailyOverview().catch(() => null)])
      .then(([clip, overview]) => {
        // Défis de ce jeu encore à jouer après celui-ci
        const left = overview?.games.find((g) => g.game.slug === game)?.challenges.filter((c) => c.status === "AVAILABLE" && c.slot !== clip.slot) ?? [];
        setState({ kind: "ready", clip, remaining: left.map((c) => c.slot) });
      })
      .catch((e: ApiError) =>
        setState(
          e.status === 401 ? { kind: "auth" }
          : e.status === 409 ? { kind: "played", message: e.message }
          : e.status === 404 ? { kind: "none" }
          : { kind: "error" },
        ),
      );
  }, [game, slot]);

  useEffect(load, [load]);

  const back = (
    <Link href="/play/daily" className="btn-ghost mx-auto w-fit">← Défis du jour</Link>
  );

  if (state.kind === "loading") return <Skeleton className="aspect-video" />;
  if (state.kind === "auth") return <LoginRequired next={`/play/daily/${game}${slot ? `?slot=${slot}` : ""}`} />;
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

  const { clip, remaining } = state;
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="hud-label">
            Défi du jour n° {clip.slot}/{DAILY_PER_GAME} · {new Date(`${clip.dailyDate}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}
          </p>
          <h1 className="font-display text-3xl font-bold">{clip.game.name}</h1>
        </div>
        <Link href="/play/daily" className="btn-ghost">← Tous les défis</Link>
      </header>
      <GameRound
        key={clip.id}
        clip={clip}
        onNext={() => router.push(remaining.length ? `/play/daily/${game}?slot=${remaining[0]}` : "/play/daily")}
        nextLabel={remaining.length ? `Défi suivant (${remaining.length} restant${remaining.length > 1 ? "s" : ""})` : "Défis du jour"}
      />
    </section>
  );
}
