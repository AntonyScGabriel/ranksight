"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { io } from "socket.io-client";
import { GAME_NAMES, GAME_SLUGS, type LeaderboardEntryDto, type LeaderboardGame, type SeasonDto } from "@ranksight/shared";
import { api, WS_URL } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { VipBadge } from "@/components/VipBadge";
import { PlayerLink } from "@/components/PlayerLink";
import { FlairBadge, TitleText } from "@/components/Flair";
import { LoginRequired, Skeleton } from "@/components/States";

const SCOPES = [["global", "Global"], ["friends", "Amis"]] as const;
const PERIODS = [["daily", "Jour"], ["weekly", "Semaine"], ["season", "Saison"], ["all_time", "Total"], ["infinite", "Infini"]] as const;
const GAMES = [["all", "Tous les jeux"], ...GAME_SLUGS.map((s) => [s, GAME_NAMES[s]] as const)] as const;

type Board = { entries: LeaderboardEntryDto[]; me: { rank: number; score: number } | null };

export default function LeaderboardPage() {
  return (
    <Suspense>
      <Leaderboard />
    </Suspense>
  );
}

function Leaderboard() {
  const { me, loading } = useSession();
  const initialPeriod = useSearchParams().get("period");
  const [scope, setScope] = useState<string>("global");
  const [period, setPeriod] = useState<string>(PERIODS.some(([k]) => k === initialPeriod) ? initialPeriod! : "daily");
  const [game, setGame] = useState<LeaderboardGame>("all");
  // Le mode Infini n'a qu'un classement, tous jeux confondus
  const effectiveGame: LeaderboardGame = period === "infinite" ? "all" : game;
  const [data, setData] = useState<Board | null>(null);
  const [seasons, setSeasons] = useState<SeasonDto[]>([]);
  const [seasonKey, setSeasonKey] = useState<string>("");
  const season = seasons.find((s) => s.key === seasonKey) ?? seasons[0];
  const pastSeason = period === "season" && season && !season.current ? season.key : undefined;

  useEffect(() => {
    if (me) api.seasons().then(setSeasons).catch(() => setSeasons([]));
  }, [me]);

  const load = useCallback(() => {
    api.leaderboard(period, scope, effectiveGame, pastSeason).then(setData).catch(() => setData({ entries: [], me: null }));
  }, [period, scope, effectiveGame, pastSeason]);

  useEffect(() => {
    if (!me) return;
    load();
    // Saison terminée : classement définitif, pas de temps réel
    if (pastSeason) return;
    // Temps réel : le serveur signale un changement, on recharge la page affichée
    const socket = io(`${WS_URL}/ws/leaderboards`, { transports: ["websocket"] });
    api.leaderboardKeys(effectiveGame).then((keys) => keys[period] && socket.emit("subscribe", keys[period])).catch(() => undefined);
    socket.on("lb:changed", load);
    return () => {
      socket.disconnect();
    };
  }, [me, period, effectiveGame, pastSeason, load]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/leaderboard" text="Connecte-toi pour voir les classements." />;

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Classements</h1>
      <div className="flex flex-wrap gap-2">
        <Tabs items={SCOPES} value={scope} onChange={setScope} />
        <Tabs items={PERIODS} value={period} onChange={setPeriod} />
        {period === "season" && seasons.length > 0 && (
          <select value={season?.key ?? ""} onChange={(e) => setSeasonKey(e.target.value)} aria-label="Saison" className="input !w-auto">
            {seasons.map((s) => <option key={s.key} value={s.key}>{s.label}{s.current ? " (en cours)" : ""}</option>)}
          </select>
        )}
        {period !== "infinite" && (
          <select value={game} onChange={(e) => setGame(e.target.value as LeaderboardGame)} aria-label="Jeu" className="input !w-auto">
            {GAMES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
      </div>

      {period === "season" && season && <SeasonBanner season={season} />}

      {data?.me && (
        <div className="glass flex items-center justify-between border-violet/50 p-4">
          <span className="hud-label">Ta position</span>
          <span className="font-mono text-lg">#{data.me.rank} · {data.me.score} pts</span>
        </div>
      )}

      <ol className="glass divide-y divide-line/60 overflow-hidden">
        {data?.entries.map((e) => (
          <li key={e.userId} className={`flex items-center gap-4 px-4 py-3 ${e.userId === me.id ? "bg-violet/10" : ""}`}>
            <span className={`w-8 font-mono ${e.rank <= 3 ? "text-neon" : "text-muted"}`}>{e.rank}</span>
            <PlayerLink id={e.userId}><Avatar name={e.username} url={e.avatarUrl} size={36} frame={e.flair.frame} /></PlayerLink>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                <PlayerLink id={e.userId}>{e.username}</PlayerLink>
                <FlairBadge flair={e.flair} size={12} />
                {e.vip && <VipBadge />}
              </span>
              {e.flair.title && <TitleText title={e.flair.title} className="block" />}
            </span>
            <span className="font-mono">{e.score}</span>
          </li>
        ))}
        {data && data.entries.length === 0 && (
          <li className="p-8 text-center text-muted">
            {scope === "friends" ? (
              <>Ajoute des amis pour comparer vos scores. <Link href="/friends" className="text-neon underline">Trouver des joueurs</Link></>
            ) : (
              "Personne n'a encore marqué de points sur cette période."
            )}
          </li>
        )}
      </ol>
    </section>
  );
}

function Tabs({ items, value, onChange }: { items: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface p-1">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className={`rounded-lg px-3 py-1.5 text-sm transition ${value === k ? "bg-violet text-white" : "text-muted hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SeasonBanner({ season }: { season: SeasonDto }) {
  // Heure figée à l'affichage de la page (suffisant pour un décompte en jours)
  const [now] = useState(() => Date.now());
  const daysLeft = Math.max(0, Math.ceil((new Date(season.endsAt).getTime() - now) / 86_400_000));
  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 border-violet/40 p-4">
      <div>
        <p className="font-display text-lg font-semibold">{season.label}</p>
        <p className="text-sm text-muted">
          {season.current
            ? `Se termine dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""} (dernier jour du mois, minuit UTC). Le 1er remporte le titre « Champion », le top 3 le titre « Podium » et le top 10 un badge.`
            : "Saison terminée : classement définitif."}
        </p>
      </div>
      {season.current && <span className="rounded-full bg-violet/20 px-3 py-1 text-xs font-semibold text-violet-soft">En cours</span>}
    </div>
  );
}
