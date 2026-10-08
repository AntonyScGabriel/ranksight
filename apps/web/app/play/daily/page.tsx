"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DAILY_STATUS_LABEL, type DailyGameDto, type DailyOverviewDto, type SeasonDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { ErrorPanel, LoginRequired, Skeleton } from "@/components/States";

type State = "loading" | "ready" | "auth" | "error";

/** « Défis du jour » : un clip par jeu, le joueur choisit celui qu'il veut jouer. */
export default function DailyPage() {
  const [data, setData] = useState<DailyOverviewDto | null>(null);
  const [state, setState] = useState<State>("loading");
  const [season, setSeason] = useState<{ info: SeasonDto; rank: number | null; score: number } | null>(null);

  useEffect(() => {
    Promise.all([api.seasons(), api.leaderboard("season", "global")])
      .then(([seasons, board]) => {
        const info = seasons.find((s) => s.current);
        if (info) setSeason({ info, rank: board.me?.rank ?? null, score: board.me?.score ?? 0 });
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    api
      .dailyOverview()
      .then((d) => {
        setData(d);
        setState("ready");
      })
      .catch((e: ApiError) => setState(e.status === 401 ? "auth" : "error"));
  }, []);

  useEffect(load, [load]);

  if (state === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}
      </div>
    );
  }
  if (state === "auth") return <LoginRequired next="/play/daily" />;
  if (state === "error" || !data) {
    return (
      <ErrorPanel
        retry={() => {
          setState("loading");
          load();
        }}
      />
    );
  }

  const date = new Date(`${data.date}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="hud-label">{date}</p>
          <h1 className="font-display text-3xl font-bold">Défis du jour</h1>
          <p className="text-sm text-muted">Un clip par jeu, une seule tentative par défi. Nouveaux clips chaque jour à minuit (UTC).</p>
        </div>
        <div className="glass flex gap-6 px-5 py-3">
          <Stat label="Joués" value={`${data.played}/${data.games.length}`} />
          <Stat label="Score du jour" value={String(data.totalScore)} />
          <Stat label="Série" value={`🔥 ${data.dailyStreak}`} />
        </div>
      </header>

      {season && (
        <Link href="/leaderboard?period=season" className="glass flex flex-wrap items-center justify-between gap-3 border-violet/40 p-4 transition hover:brightness-110">
          <div>
            <p className="hud-label">Classement saisonnier</p>
            <p className="font-display text-lg font-semibold">{season.info.label}</p>
            <p className="text-sm text-muted">
              Fin le {new Date(season.info.endsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })} · chaque défi du jour compte
            </p>
          </div>
          <p className="font-display text-xl font-bold">
            {season.rank ? `#${season.rank} · ${season.score} pts` : "Pas encore classé"} <span className="text-neon">→</span>
          </p>
        </Link>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {data.games.map((g) => <DailyCard key={g.game.slug} item={g} />)}
      </ul>

      {data.played === data.games.length && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-muted">Tous les défis du jour sont terminés. Reviens demain pour de nouveaux clips.</p>
          <div className="flex gap-3">
            <Link href="/play/infinite" className="btn-primary">Mode Infini</Link>
            <Link href="/versus" className="btn-ghost">Lancer un duel</Link>
            <Link href="/leaderboard" className="btn-ghost">Classement</Link>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}

function DailyCard({ item }: { item: DailyGameDto }) {
  const { game, status, result } = item;
  const body = (
    <div
      className="glass relative h-full overflow-hidden p-6 transition"
      style={{ background: `linear-gradient(135deg, ${game.accent}26, transparent 60%)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl font-bold">{game.name}</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status === "AVAILABLE" ? "bg-success/15 text-success" : status === "PLAYED" ? "bg-violet/20 text-violet-soft" : "bg-white/5 text-muted"
          }`}
        >
          {DAILY_STATUS_LABEL[status]}
        </span>
      </div>
      {status === "AVAILABLE" && <p className="mt-6 font-display font-semibold text-neon">Jouer →</p>}
      {status === "PLAYED" && result && (
        <div className="mt-4 flex items-end justify-between">
          <div className="text-sm text-muted">
            <p>Rang réel : <span className="font-semibold" style={{ color: result.correctRank.color }}>{result.correctRank.name}</span></p>
            <p>Ta réponse : <span className="font-semibold" style={{ color: result.guessedRank.color }}>{result.guessedRank.name}</span></p>
          </div>
          <p className="font-display text-4xl font-bold">+{result.score}</p>
        </div>
      )}
      {status === "UNAVAILABLE" && <p className="mt-6 text-sm text-muted">De nouveaux clips arrivent bientôt.</p>}
    </div>
  );
  return (
    <li>
      {status === "AVAILABLE" ? (
        <Link href={`/play/daily/${game.slug}`} className="block h-full rounded-[var(--radius-card)] hover:brightness-110" aria-label={`${game.name} — Défi disponible`}>
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
