"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROOM_MODE_LABEL, type RoomHistoryDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { RecentRoom } from "@/components/RecentRoom";
import { LoginRequired, Panel, Skeleton } from "@/components/States";

/** Historique des salons personnalisés et statistiques de victoires (séparées du classement compétitif). */
export default function RoomHistoryPage() {
  const { me, loading } = useSession();
  const [data, setData] = useState<RoomHistoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!me) return;
    api.roomHistory().then(setData, (e) => setError(errorMessage(e, "L'historique n'a pas pu être chargé.")));
  }, [me]);

  const loadMore = async () => {
    if (!data?.nextCursor || more) return;
    setMore(true);
    try {
      const next = await api.roomHistory(data.nextCursor);
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/rooms/history" text="Connecte-toi pour voir l'historique de tes salons." />;
  if (error && !data) return <Panel title="Historique indisponible" text={error}><Link href="/rooms" className="btn-ghost mx-auto w-fit">Salons</Link></Panel>;
  if (!data) return <Skeleton />;

  const rate = (wins: number, played: number) => (played ? `${Math.round((wins / played) * 100)} %` : "—");
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link href="/rooms" className="text-sm text-muted hover:text-ink">← Salons</Link>
        <h1 className="font-display text-3xl font-bold">Historique des salons</h1>
        <p className="text-sm text-muted">Parties personnalisées terminées (hors tournois). Ces résultats ne comptent pas pour le classement compétitif.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Parties", data.stats.played],
          ["Victoires", data.stats.wins],
          ["Défaites", data.stats.played - data.stats.wins],
          ["Podiums", data.stats.podiums],
        ].map(([label, value]) => (
          <div key={label} className="glass p-4 text-center">
            <p className="hud-label">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {data.stats.byMode.length > 0 && (
        <div className="glass p-5">
          <h2 className="hud-label mb-3">Par mode</h2>
          <ul className="divide-y divide-line/60 text-sm">
            {data.stats.byMode.map((m) => (
              <li key={m.mode} className="flex items-center justify-between py-2">
                <span>{ROOM_MODE_LABEL[m.mode]}</span>
                <span className="text-muted">{m.wins} victoire{m.wins > 1 ? "s" : ""} sur {m.played} · {rate(m.wins, m.played)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.items.length ? (
        <ul className="space-y-2">{data.items.map((r) => <RecentRoom key={r.id} r={r} />)}</ul>
      ) : (
        <Panel title="Aucune partie terminée" text="Lance « Jouer maintenant » ou rejoins un salon : tes résultats apparaîtront ici.">
          <Link href="/rooms" className="btn-primary mx-auto w-fit">Trouver une partie</Link>
        </Panel>
      )}
      {data.nextCursor && (
        <button disabled={more} onClick={loadMore} className="btn-ghost mx-auto block">{more ? "Chargement…" : "Voir plus"}</button>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
