"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DAILY_PER_GAME, DAILY_STATUS_LABEL, type DailyGameDto, type DailyOverviewDto, type SeasonDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { ErrorPanel, LoginRequired, Skeleton } from "@/components/States";

type State = "loading" | "ready" | "auth" | "error";

/** « Défis du jour » : 3 clips par jeu, le joueur choisit celui qu'il veut jouer. */
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
          <p className="text-sm text-muted">
            {DAILY_PER_GAME} clips par jeu, une seule tentative par défi. Nouveaux clips chaque jour à minuit (UTC).
          </p>
        </div>
        <div className="glass flex gap-6 px-5 py-3">
          <Stat label="Joués" value={`${data.played}/${data.total}`} />
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

      {data.total > 0 && data.played >= data.total && (
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
  const { game, status, challenges, score } = item;
  const played = challenges.filter((c) => c.status === "PLAYED").length;
  const next = challenges.find((c) => c.status === "AVAILABLE");
  return (
    <li
      className="glass relative flex h-full flex-col gap-4 overflow-hidden p-6"
      style={{ background: `linear-gradient(135deg, ${game.accent}26, transparent 60%)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">{game.name}</h2>
          <p className="text-sm text-muted">
            {played}/{challenges.length} joué{played > 1 ? "s" : ""}
            {played > 0 && <> · <span className="font-semibold text-ink">{score} pts</span></>}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status === "AVAILABLE" ? "bg-success/15 text-success" : status === "PLAYED" ? "bg-violet/20 text-violet-soft" : "bg-white/5 text-muted"
          }`}
        >
          {DAILY_STATUS_LABEL[status]}
        </span>
      </div>
      <ol className="grid grid-cols-3 gap-2">
        {challenges.map((c) => {
          const label = `Défi ${c.slot}`;
          if (c.status === "AVAILABLE") {
            return (
              <li key={c.slot}>
                <Link
                  href={`/play/daily/${game.slug}?slot=${c.slot}`}
                  aria-label={`${game.name} — ${label} disponible`}
                  className="flex h-full flex-col items-center justify-center rounded-xl border border-success/40 bg-success/10 px-2 py-3 text-center transition hover:brightness-125"
                >
                  <span className="text-xs text-muted">{label}</span>
                  <span className="font-display font-semibold text-neon">Jouer →</span>
                </Link>
              </li>
            );
          }
          if (c.status === "PLAYED" && c.result) {
            return (
              <li
                key={c.slot}
                title={`Rang réel : ${c.result.correctRank.name} · ta réponse : ${c.result.guessedRank.name}`}
                className="flex flex-col items-center justify-center rounded-xl border border-line bg-white/5 px-2 py-3 text-center"
              >
                <span className="text-xs text-muted">{label}</span>
                <span className="font-display text-xl font-bold">+{c.result.score}</span>
                <span className="truncate text-[11px] font-semibold" style={{ color: c.result.correctRank.color }}>{c.result.correctRank.name}</span>
              </li>
            );
          }
          return (
            <li key={c.slot} className="flex flex-col items-center justify-center rounded-xl border border-line/50 px-2 py-3 text-center text-muted">
              <span className="text-xs">{label}</span>
              <span className="text-xs">Bientôt</span>
            </li>
          );
        })}
      </ol>
      {next && (
        <Link href={`/play/daily/${game.slug}?slot=${next.slot}`} className="mt-auto font-display font-semibold text-neon hover:underline">
          {played ? "Continuer →" : "Jouer →"}
        </Link>
      )}
      {status === "UNAVAILABLE" && <p className="mt-auto text-sm text-muted">De nouveaux clips arrivent bientôt.</p>}
    </li>
  );
}
