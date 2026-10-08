"use client";

import { useEffect, useState } from "react";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_CATEGORY_LABEL, type AchievementDto, type AchievementsOverviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ErrorPanel, LoginRequired, Skeleton } from "@/components/States";

type Filter = "all" | "unlocked" | "locked";

/** Mes succès : obtenus et à obtenir, avec l'avancement de chacun. */
export default function AchievementsPage() {
  const { me, loading } = useSession();
  const [data, setData] = useState<AchievementsOverviewDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (me) api.achievements().then(setData, () => setFailed(true));
  }, [me]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/achievements" text="Connecte-toi pour voir tes succès." />;
  if (failed) return <ErrorPanel retry={() => { setFailed(false); api.achievements().then(setData, () => setFailed(true)); }} />;
  if (!data) return <Skeleton />;

  const visible = data.items.filter((a) => (filter === "all" ? true : filter === "unlocked" ? !!a.unlockedAt : !a.unlockedAt));
  const pct = data.total ? Math.round((data.unlocked / data.total) * 100) : 0;

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Mes succès</h1>
          <p className="text-muted">{data.unlocked} sur {data.total} obtenus · {pct} %</p>
          <div className="mt-2 h-2 w-64 max-w-full rounded-full bg-white/5">
            <div className="h-full rounded-full bg-gradient-to-r from-violet to-neon" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="glass flex gap-6 px-5 py-3">
          <div>
            <p className="hud-label">Série de victoires</p>
            <p className="font-display text-xl font-bold">{data.winStreak}</p>
          </div>
          <div>
            <p className="hud-label">Record</p>
            <p className="font-display text-xl font-bold">{data.bestWinStreak}</p>
          </div>
        </div>
      </header>

      <div className="inline-flex rounded-xl border border-line bg-surface p-1">
        {([["all", "Tous"], ["unlocked", "Obtenus"], ["locked", "À débloquer"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 text-sm transition ${filter === k ? "bg-violet text-white" : "text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>

      {ACHIEVEMENT_CATEGORIES.map((category) => {
        const items = visible.filter((a) => a.category === category);
        if (!items.length) return null;
        return (
          <div key={category} className="space-y-3">
            <h2 className="hud-label">{ACHIEVEMENT_CATEGORY_LABEL[category]}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => <AchievementCard key={a.id} a={a} />)}
            </ul>
          </div>
        );
      })}
      {visible.length === 0 && <p className="text-center text-muted">Aucun succès dans cette liste.</p>}
    </section>
  );
}

function AchievementCard({ a }: { a: AchievementDto }) {
  const done = !!a.unlockedAt;
  const pct = a.progress ? Math.round((a.progress.current / a.progress.target) * 100) : 0;
  return (
    <li className={`glass flex gap-4 p-4 ${done ? "border-violet/60" : "opacity-80"}`}>
      <span
        aria-hidden
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl ${done ? "bg-gradient-to-br from-violet to-neon-blue" : "bg-white/5 grayscale"}`}
      >
        {a.hidden && !done ? "?" : a.category === "SEASON" ? "👑" : done ? "🏆" : "🔒"}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-display font-semibold">{a.name}</p>
          <span className="shrink-0 font-mono text-xs text-neon">+{a.xpReward} XP</span>
        </div>
        <p className="text-sm text-muted">{a.description}</p>
        {done ? (
          <p className="text-xs text-success">Obtenu le {new Date(a.unlockedAt!).toLocaleDateString("fr-FR")}</p>
        ) : a.progress ? (
          <div>
            <div className="h-1.5 rounded-full bg-white/5">
              <div className="h-full rounded-full bg-violet" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted">{a.progress.current.toLocaleString("fr-FR")} / {a.progress.target.toLocaleString("fr-FR")}</p>
          </div>
        ) : a.category === "SEASON" ? (
          <p className="text-xs text-muted">Attribué à la fin de la saison, d&apos;après le classement général.</p>
        ) : null}
        <p className="text-[11px] text-muted">{a.rarity > 0 ? `Obtenu par ${Math.max(1, Math.round(a.rarity * 100))} % des joueurs` : "Personne ne l'a encore obtenu"}</p>
      </div>
    </li>
  );
}
