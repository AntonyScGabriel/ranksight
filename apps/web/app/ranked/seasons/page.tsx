"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  GAME_NAMES, RATING_SCOPES, tierByKey,
  type GameSlug, type RatingScope, type RatingSeasonsDto, type SeasonArchiveDto, type SeasonResultDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { Avatar } from "@/components/Header";
import { PlayerLink } from "@/components/PlayerLink";
import { LoginRequired, Panel, Skeleton } from "@/components/States";

const scopeName = (s: RatingScope) => (s === "global" ? "Global" : GAME_NAMES[s as GameSlug]);
const place = (n: number) => (n === 1 ? "1re" : `${n}e`);

/** Archives du classement compétitif : classement final de chaque saison terminée et résultats du joueur. */
export default function RatingSeasonsPage() {
  const { me, loading } = useSession();
  const [data, setData] = useState<RatingSeasonsDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<RatingScope>("global");
  const [archive, setArchive] = useState<SeasonArchiveDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api.ratingSeasons().then(
      (d) => { setData(d); setSelected(d.past[0]?.key ?? null); },
      (e) => setError(errorMessage(e, "Les archives n'ont pas pu être chargées.")),
    );
  }, [me]);
  useEffect(() => {
    if (!selected) return;
    api.ratingArchive(selected, scope).then(setArchive, (e) => setError(errorMessage(e)));
  }, [selected, scope]);

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/ranked/seasons" text="Connecte-toi pour voir les saisons précédentes." />;
  if (error && !data) return <Panel title="Archives indisponibles" text={error}><Link href="/ranked" className="btn-ghost mx-auto w-fit">Classement</Link></Panel>;
  if (!data) return <Skeleton />;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link href="/ranked" className="text-sm text-muted hover:text-ink">← Classement compétitif</Link>
        <h1 className="font-display text-3xl font-bold">Saisons précédentes</h1>
        <p className="max-w-2xl text-sm text-muted">
          À la fin de chaque saison, le classement est archivé et chaque cote repart au seuil du rang atteint.
        </p>
      </header>

      {data.past.length === 0 ? (
        <Panel title="Aucune saison terminée" text="Le classement de la saison en cours sera archivé ici à sa fin." />
      ) : (
        <>
          {data.mine.length > 0 && (
            <div className="glass overflow-x-auto p-6">
              <h2 className="mb-3 font-display text-lg font-semibold">Mes résultats</h2>
              <table className="w-full min-w-[30rem] text-sm">
                <thead className="text-left text-muted">
                  <tr><th className="py-1 font-normal">Saison</th><th className="font-normal">Classement</th><th className="font-normal">Rang</th><th className="font-normal">Place</th><th className="text-right font-normal">Saison suivante</th></tr>
                </thead>
                <tbody>
                  {data.mine.flatMap((m) => m.results.map((r) => <MyResult key={`${m.season}-${r.scope}`} season={data.past.find((s) => s.key === m.season)?.name ?? m.season} r={r} />))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <label className="space-y-1 text-sm">
              <span className="hud-label">Saison</span>
              <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)} className="input">
                {data.past.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="hud-label">Classement</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as RatingScope)} className="input">
                {RATING_SCOPES.map((s) => <option key={s} value={s}>{scopeName(s)}</option>)}
              </select>
            </label>
          </div>

          <div className="glass overflow-x-auto p-2">
            {!archive || archive.season.key !== selected || archive.scope !== scope ? (
              <Skeleton className="h-48" />
            ) : archive.entries.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">Aucun joueur classé dans ce classement pour cette saison.</p>
            ) : (
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="text-left text-muted">
                  <tr><th className="px-3 py-2 font-normal">#</th><th className="font-normal">Joueur</th><th className="font-normal">Rang</th><th className="pr-3 text-right font-normal">Cote finale</th></tr>
                </thead>
                <tbody>
                  {archive.entries.map((e) => {
                    const t = tierByKey(e.tier);
                    return (
                      <tr key={e.userId} className={`border-t border-line/60 ${e.userId === me.id ? "bg-violet/10" : ""}`}>
                        <td className="px-3 py-2 font-display font-bold text-muted">{e.placement}</td>
                        <td>
                          <PlayerLink id={e.userId} className="flex items-center gap-2">
                            <Avatar name={e.displayName} url={e.avatarUrl} size={24} />
                            <span className="truncate">{e.displayName}</span>
                          </PlayerLink>
                        </td>
                        <td style={{ color: t.color }}>{t.name}</td>
                        <td className="pr-3 text-right font-display font-bold">{e.rating}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MyResult({ season, r }: { season: string; r: SeasonResultDto }) {
  const t = tierByKey(r.tier);
  return (
    <tr className="border-t border-line/60">
      <td className="py-2">{season}</td>
      <td>{scopeName(r.scope)}</td>
      <td style={{ color: t.color }}>{t.name} · {r.rating}</td>
      <td className="text-muted">{r.placement ? `${place(r.placement)} place` : "non classé"} · {r.wins} V / {r.losses} D</td>
      <td className="text-right">{r.resetTo}</td>
    </tr>
  );
}
