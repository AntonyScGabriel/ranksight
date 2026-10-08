"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GAME_NAMES, GAME_SLUGS, type UserSummaryDto, type VersusMatchDto, type VersusStatsDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Skeleton } from "@/components/States";
import { VersusCard } from "@/components/VersusCard";

/** Duels : lancer un défi (au hasard ou contre un ami), répondre aux invitations, suivre ses duels. */
export default function VersusPage() {
  const { me, loading } = useSession();
  const { onVersus } = useChat();
  const router = useRouter();
  const confirm = useConfirm();
  const [data, setData] = useState<{ matches: VersusMatchDto[]; stats: VersusStatsDto } | null>(null);
  const [friends, setFriends] = useState<UserSummaryDto[]>([]);
  const [game, setGame] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.versusList().then(setData, () => setData({ matches: [], stats: { wins: 0, losses: 0, draws: 0 } }));
  }, []);
  useEffect(() => {
    if (!me) return;
    load();
    api.friends().then(setFriends, () => setFriends([]));
    return onVersus(load);
  }, [me, load, onVersus]);

  const start = async (opponent: string) => {
    setBusy(true);
    setError(null);
    try {
      const m = await api.createVersus(opponent, game);
      router.push(`/versus/${m.id}`);
    } catch (e) {
      setError(errorMessage(e, "Le duel n'a pas pu être créé."));
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/versus" text="Connecte-toi pour défier d'autres joueurs." />;
  if (!data) return <Skeleton />;

  const invitations = data.matches.filter((m) => m.canAccept);
  const ongoing = data.matches.filter((m) => !m.canAccept && ["OPEN", "PENDING", "ACTIVE"].includes(m.status));
  const done = data.matches.filter((m) => !["OPEN", "PENDING", "ACTIVE"].includes(m.status));
  const inProgress = ongoing.some((m) => m.status === "ACTIVE");

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Duels</h1>
          <p className="max-w-xl text-sm text-muted">
            Duel en direct : 5 clips, les mêmes pour les deux joueurs, au même moment. 30 secondes par manche, puis les deux
            réponses sont dévoilées. Le meilleur total l&apos;emporte.
          </p>
        </div>
        <div className="glass flex gap-6 px-5 py-3 text-center">
          <div><p className="font-display text-xl font-bold text-success">{data.stats.wins}</p><p className="hud-label">Victoires</p></div>
          <div><p className="font-display text-xl font-bold">{data.stats.draws}</p><p className="hud-label">Égalités</p></div>
          <div><p className="font-display text-xl font-bold text-danger">{data.stats.losses}</p><p className="hud-label">Défaites</p></div>
        </div>
      </header>

      <div className="glass space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Nouveau duel</h2>
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Jeu du duel" className="input !w-auto">
            <option value="all">Tous les jeux</option>
            {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
          </select>
        </div>
        <button disabled={busy || inProgress} onClick={() => start("random")} className="btn-primary w-full sm:w-auto">Trouver un adversaire</button>
        {inProgress && <p className="text-sm text-warn">Tu as un duel en cours : termine-le avant d&apos;en lancer un autre.</p>}
        <div>
          <p className="hud-label mb-2">Ou défie un ami</p>
          {friends.length ? (
            <ul className="flex flex-wrap gap-2">
              {friends.map((f) => (
                <li key={f.id}>
                  <button disabled={busy || inProgress} onClick={() => start(f.id)} className="btn-ghost">
                    <Avatar name={f.displayName} url={f.avatarUrl} size={22} /> {f.displayName}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Ajoute des amis pour pouvoir les défier.</p>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      {invitations.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Invitations reçues</h2>
          <ul className="space-y-3">
            {invitations.map((m) => (
              <VersusCard
                key={m.id}
                m={m}
                actions={
                  <div className="flex gap-2">
                    <button onClick={() => run(async () => { await api.acceptVersus(m.id); router.push(`/versus/${m.id}`); })} className="btn-primary !py-2 text-sm">Accepter et jouer</button>
                    <button onClick={() => run(() => api.declineVersus(m.id))} className="btn-ghost">Refuser</button>
                  </div>
                }
              />
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="hud-label">En cours</h2>
        {ongoing.length ? (
          <ul className="space-y-3">
            {ongoing.map((m) => (
              <VersusCard
                key={m.id}
                m={m}
                actions={
                  <div className="flex gap-2">
                    <button onClick={() => router.push(`/versus/${m.id}`)} className="btn-primary !py-2 text-sm">
                      {m.status === "ACTIVE" ? "Reprendre" : "Ouvrir"}
                    </button>
                    {m.canCancel && (
                      <button
                        onClick={async () => {
                          const ok = await confirm({ title: "Annuler ce duel ?", message: "Le duel n'a pas encore commencé : il sera annulé.", confirmLabel: "Annuler le duel", danger: true });
                          if (ok !== false) void run(() => api.cancelVersus(m.id));
                        }}
                        className="btn-ghost"
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Aucun duel en cours.</p>
        )}
      </div>

      {done.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Historique</h2>
          <ul className="space-y-3">{done.map((m) => <VersusCard key={m.id} m={m} />)}</ul>
        </div>
      )}
    </section>
  );
}
