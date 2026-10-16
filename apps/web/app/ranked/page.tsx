"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  GAME_NAMES, RATING_MIN_GAMES, RATING_RULES, RATING_SCOPES, RATING_START, RATING_UNCOUNTED_LABEL, ratingTier, tierProgress,
  type GameSlug, type MyRatingsDto, type RatingBoardDto, type RatingScope,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { FlairBadge } from "@/components/Flair";
import { PlayerLink } from "@/components/PlayerLink";
import { LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

const scopeName = (s: RatingScope) => (s === "global" ? "Global" : GAME_NAMES[s as GameSlug]);

/** Classement compétitif : cote globale et par jeu, alimentée par les seuls duels au hasard ; saison, progression, historique. */
export default function RankedPage() {
  const { me, loading } = useSession();
  const [scope, setScope] = useState<RatingScope>("global");
  const [board, setBoard] = useState<RatingBoardDto | null>(null);
  const [mine, setMine] = useState<MyRatingsDto | null>(null);

  const load = useCallback(() => {
    api.ratingBoard(scope).then(setBoard, () => setBoard({ scope, season: null, entries: [], me: null }));
  }, [scope]);
  useEffect(() => {
    if (!me) return;
    load();
  }, [me, load]);
  useEffect(() => {
    if (!me) return;
    api.myRatings().then(setMine, () => setMine({ ratings: [], history: [] }));
  }, [me]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/ranked" text="Connecte-toi pour voir le classement compétitif." />;

  // Classement affiché seulement s'il correspond à l'onglet choisi (sinon chargement en cours)
  const shown = board?.scope === scope ? board : null;
  const my = shown?.me;
  const progress = tierProgress(my?.rating ?? RATING_START);
  const tier = progress.tier;
  const season = shown?.season ?? board?.season ?? null;
  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">Classement compétitif</h1>
          <p className="max-w-2xl text-sm text-muted">
            Ta cote monte et descend avec tes duels « au hasard ». Les duels entre amis, les salons et les tournois ne comptent pas, et le VIP n&apos;apporte aucun point.
          </p>
          <p className="text-sm">
            {season
              ? <>{season.name} · fin le {new Date(season.endsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</>
              : "Entre deux saisons : tes duels comptent pour la prochaine."}{" "}
            · <Link href="/ranked/seasons" className="text-neon underline">Saisons précédentes</Link>
          </p>
        </div>
        <Link href="/versus" className="btn-primary">Lancer un duel au hasard</Link>
      </header>

      <div role="tablist" aria-label="Classement" className="flex flex-wrap gap-2">
        {RATING_SCOPES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => setScope(s)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${scope === s ? "border-neon bg-neon/10 text-ink" : "border-line text-muted hover:text-ink"}`}
          >
            {scopeName(s)}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="glass overflow-x-auto p-2">
          {!shown ? (
            <Skeleton className="h-64" />
          ) : shown.entries.length ? (
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-left text-muted">
                <tr><th className="px-3 py-2 font-normal">#</th><th className="font-normal">Joueur</th><th className="font-normal">Palier</th><th className="font-normal">Duels</th><th className="pr-3 text-right font-normal">Cote</th></tr>
              </thead>
              <tbody>
                {shown.entries.map((e) => {
                  const t = ratingTier(e.rating);
                  return (
                    <tr key={e.userId} className={`border-t border-line/60 ${e.userId === me.id ? "bg-violet/10" : ""}`}>
                      <td className="px-3 py-2 font-display font-bold text-muted">{e.rank}</td>
                      <td>
                        <PlayerLink id={e.userId} className="flex items-center gap-2">
                          <Avatar name={e.displayName} url={e.avatarUrl} size={26} frame={e.flair.frame} />
                          <span className="truncate">{e.displayName}</span>
                          <FlairBadge flair={e.flair} size={11} />
                          {e.vip && <VipBadge />}
                        </PlayerLink>
                      </td>
                      <td style={{ color: t.color }}>{t.name}</td>
                      <td className="text-muted">{e.games} · {e.wins} V</td>
                      <td className="pr-3 text-right font-display text-lg font-bold">{e.rating}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-center text-sm text-muted">Personne n&apos;a encore {RATING_MIN_GAMES} duels classés ici. Sois le premier !</p>
          )}
        </div>

        <aside className="space-y-6">
          <div className="glass space-y-2 p-6 text-center">
            <p className="hud-label">Ma cote · {scopeName(scope)}</p>
            <p className="font-display text-5xl font-bold">{my?.rating ?? RATING_START}</p>
            <p className="font-semibold" style={{ color: tier.color }}>{tier.name}{my?.provisional ? " · placement en cours" : ""}</p>
            {progress.next ? (
              <div className="space-y-1 pt-1">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)} aria-label={`Progression vers ${progress.next.name}`}>
                  <div className="h-full" style={{ width: `${progress.progress * 100}%`, background: progress.next.color }} />
                </div>
                <p className="text-xs text-muted">{progress.pointsToNext} point{progress.pointsToNext! > 1 ? "s" : ""} avant {progress.next.name}</p>
              </div>
            ) : (
              <p className="text-xs text-muted">Rang le plus haut atteint</p>
            )}
            <p className="text-sm text-muted">
              {my
                ? my.rank
                  ? `${my.rank === 1 ? "1re" : `${my.rank}e`} place · ${my.wins} V / ${my.losses} D / ${my.draws} N · record ${my.peak}`
                  : `${my.games}/${RATING_MIN_GAMES} duels cette saison pour apparaître dans le classement`
                : "Pas encore de duel classé ici."}
            </p>
          </div>
          <div className="glass space-y-2 p-6">
            <h2 className="font-display text-lg font-semibold">Règles</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{RATING_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </aside>
      </div>

      {mine && mine.history.length > 0 && (
        <div className="glass overflow-x-auto p-6">
          <h2 className="mb-3 font-display text-lg font-semibold">Mes derniers duels classés</h2>
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="text-left text-muted">
              <tr><th className="py-1 font-normal">Date</th><th className="font-normal">Classement</th><th className="font-normal">Adversaire</th><th className="font-normal">Résultat</th><th className="text-right font-normal">Cote</th></tr>
            </thead>
            <tbody>
              {mine.history.map((h) => (
                <tr key={`${h.matchId}-${h.scope}`} className="border-t border-line/60">
                  <td className="py-2 text-muted">{new Date(h.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</td>
                  <td>{scopeName(h.scope)}</td>
                  <td>{h.opponent}</td>
                  <td>{h.result === "WIN" ? "Victoire" : h.result === "LOSS" ? "Défaite" : "Nul"}</td>
                  <td className="text-right">
                    {h.counted ? (
                      <>{h.after} <span className={h.delta > 0 ? "text-success" : h.delta < 0 ? "text-danger" : "text-muted"}>({h.delta > 0 ? "+" : ""}{h.delta})</span></>
                    ) : (
                      <span className="text-muted" title={h.reason ? RATING_UNCOUNTED_LABEL[h.reason] : undefined}>
                        {h.reason === "EARLY_FORFEIT" ? "abandon immédiat : non compté" : "ne compte pas (limite par adversaire)"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
