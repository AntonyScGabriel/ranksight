"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DECIDED_BY_LABEL, ROOM_MIN_PLAYERS, ROOM_RULES, SUDDEN_DEATH_RULES, formatRoomCode, type RoomDto, type RoomPlayerDto, type RoomRoundDto, type UserSummaryDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useLiveRoom } from "@/lib/rooms";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { errorMessage } from "@/components/AuthForm";
import { FlairBadge } from "@/components/Flair";
import { LiveRound, TimerBar } from "@/components/LiveRound";
import { PlayerLink } from "@/components/PlayerLink";
import { RankEmblem } from "@/components/RankEmblem";
import { LoginRequired, Panel, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

/** Salon privé : salle d'attente (code, joueurs, invitations), manches synchronisées, révélations, classement final. */
export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = useSession();
  const router = useRouter();
  const confirm = useConfirm();
  const live = useLiveRoom(id, !!me);
  const { room, phase } = live;
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<RoomDto | unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "players" in r) live.apply(r as RoomDto);
      else live.load();
    } catch (e) {
      setError(errorMessage(e));
      live.load();
    }
  };

  const leave = async () => {
    if (!room) return;
    const playing = room.status === "ACTIVE";
    const ok = await confirm({
      title: playing ? "Quitter la partie ?" : "Quitter le salon ?",
      message: playing ? "Tu gardes tes points, mais tu ne pourras plus répondre ni revenir dans la partie." : "Tu pourras revenir avec le code tant que la partie n'a pas commencé.",
      confirmLabel: "Quitter",
      danger: true,
    });
    if (ok === false) return;
    await act(async () => {
      await api.leaveRoom(id);
      if (!playing) router.push("/rooms");
    });
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={`/rooms/${id}`} text="Connecte-toi pour rejoindre ce salon. Pas besoin d'être VIP." />;
  if (live.missing) return <Panel title="Salon introuvable" text="Ce salon n'existe pas ou tu n'en fais pas partie."><Link href="/rooms" className="btn-ghost mx-auto w-fit">Salons privés</Link></Panel>;
  if (!room) return <Skeleton />;

  const lastRound = room.details.at(-1);
  const canLeave = (room.status === "LOBBY" || room.status === "ACTIVE") && !room.left;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/rooms" className="text-sm text-muted hover:text-ink">← Salons</Link>
        {canLeave && <button onClick={leave} className="text-sm text-muted hover:text-danger">Quitter</button>}
      </div>
      {live.offline && <p role="status" className="text-center text-sm text-warn">Connexion perdue : reconnexion en cours…</p>}
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}

      {phase === "lobby" && <Lobby room={room} meId={me.id} act={act} />}

      {room.status === "ACTIVE" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
          <div className="min-w-0 space-y-6">
            {phase === "countdown" && (
              <>
                {lastRound && <RoundReveal round={lastRound} players={room.players} meId={me.id} />}
                <div className="glass p-8 text-center">
                  <p className={`hud-label ${room.live!.suddenDeath ? "!text-warn" : ""}`}>
                    {room.live!.round === 1 ? "La partie commence" : room.live!.suddenDeath ? "Mort subite · manche décisive" : `Manche ${room.live!.round}/${room.rounds}`}
                  </p>
                  <p className="font-display text-6xl font-bold text-neon" aria-live="polite">{live.secondsLeft}</p>
                  {room.live!.suddenDeath && (
                    <p className="mt-2 text-sm text-muted">
                      Égalité en tête : {room.players.filter((p) => p.finalist).map((p) => (p.id === me.id ? "toi" : p.displayName)).join(" contre ")}. Le meilleur score de cette manche l&apos;emporte.
                    </p>
                  )}
                </div>
              </>
            )}
            {phase === "playing" && (live.clip ? (
              <LiveRound
                key={live.clip.playToken}
                clip={live.clip}
                secondsLeft={live.secondsLeft}
                progress={live.roundProgress}
                onSubmitted={() => live.markSubmitted(live.clip!.position)}
                onClosed={live.load}
                label={room.live?.suddenDeath ? "Mort subite · manche décisive" : undefined}
              />
            ) : (
              <Skeleton className="h-96" />
            ))}
            {(phase === "answered" || phase === "timeout") && room.live && (
              <div className="glass space-y-3 p-8 text-center">
                <p className="font-display text-xl font-semibold">{phase === "timeout" && !room.live.answered ? "Temps écoulé !" : "Réponse envoyée"}</p>
                <p className="text-sm text-muted">
                  {room.players.filter((p) => !p.left && p.answered).length}/{room.players.filter((p) => !p.left).length} joueurs ont répondu.
                  {phase === "answered" && ` Fin de la manche dans ${live.secondsLeft} s au plus tard.`}
                </p>
                <TimerBar progress={live.roundProgress} />
              </div>
            )}
            {phase === "spectating" && room.live && (
              <div className="glass space-y-3 p-8 text-center">
                <p className="hud-label !text-warn">Mort subite</p>
                <p className="font-display text-xl font-semibold">
                  {room.players.filter((p) => p.finalist).map((p) => p.displayName).join(" contre ")} se départagent
                </p>
                <p className="text-sm text-muted">Seuls les joueurs à égalité en tête répondent à cette manche. Résultat dans {live.secondsLeft} s au plus tard.</p>
                <TimerBar progress={live.roundProgress} />
              </div>
            )}
            {phase === "left" && (
              <Panel title="Tu as quitté la partie" text="Tes points sont conservés. Le classement final s'affichera ici à la fin de la partie." />
            )}
          </div>
          <Scoreboard room={room} meId={me.id} />
        </div>
      )}

      {phase === "over" && <FinalResult room={room} meId={me.id} />}
    </section>
  );
}

function PlayerName({ p, meId }: { p: RoomPlayerDto; meId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{p.id === meId ? "Toi" : p.displayName}</span>
      <FlairBadge flair={p.flair} size={11} />
      {p.vip && <VipBadge />}
      {p.isHost && <span title="Hôte du salon" className="text-xs text-warn">★</span>}
      {p.finalist && <span title="Dispute la mort subite" className="rounded bg-warn/15 px-1 text-[10px] font-bold text-warn">MS</span>}
    </span>
  );
}

/** Salle d'attente : code à partager, joueurs, invitations d'amis, réglages et règles ; l'hôte lance la partie. */
function Lobby({ room, meId, act }: { room: RoomDto; meId: string; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [friends, setFriends] = useState<UserSummaryDto[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.friends().then(setFriends, () => setFriends([]));
  }, []);

  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? formatRoomCode(room.code) : `${window.location.origin}/rooms/join/${formatRoomCode(room.code)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copie ce texte :", text);
    }
  };

  const active = room.players.filter((p) => !p.left);
  const free = room.maxPlayers - active.length;
  const invitable = friends.filter((f) => !room.players.some((p) => p.id === f.id));
  const host = room.players.find((p) => p.isHost);

  return (
    <div className="space-y-6">
      <div className="glass space-y-4 p-6 text-center">
        <p className="hud-label">Code du salon</p>
        <p className="font-mono text-4xl font-bold tracking-[0.2em] text-neon sm:text-5xl" aria-label={`Code ${room.code.split("").join(" ")}`}>{formatRoomCode(room.code)}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => copy("code")} className="btn-ghost">{copied === "code" ? "Code copié ✓" : "Copier le code"}</button>
          <button onClick={() => copy("link")} className="btn-ghost">{copied === "link" ? "Lien copié ✓" : "Copier le lien d'invitation"}</button>
        </div>
        <p className="text-sm text-muted">
          {room.game.name} · {room.rounds} manches · {room.roundSec} s par manche{room.suddenDeath ? " · mort subite" : ""} · rejoindre est gratuit
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="glass space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Joueurs</h2>
            <p className="text-sm text-muted">{active.length}/{room.maxPlayers} · {free > 0 ? `${free} place${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}` : "complet"}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {active.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface/60 p-3">
                <Avatar name={p.displayName} url={p.avatarUrl} size={36} frame={p.flair.frame} />
                <div className="min-w-0 flex-1 text-sm"><PlayerName p={p} meId={meId} /></div>
                {room.isHost && p.id !== meId && (
                  <button onClick={() => act(() => api.kickFromRoom(room.id, p.id))} className="text-xs text-muted hover:text-danger" aria-label={`Retirer ${p.displayName}`}>
                    Retirer
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: free }, (_, i) => (
              <li key={`free-${i}`} className="rounded-xl border border-dashed border-line/60 p-3 text-center text-sm text-muted">Place libre</li>
            ))}
          </ul>
          {room.isHost ? (
            <div className="space-y-2">
              <button disabled={!room.canStart} onClick={() => act(() => api.startRoom(room.id))} className="btn-primary w-full sm:w-auto">Lancer la partie</button>
              {!room.canStart && <p className="text-sm text-muted">Il faut au moins {ROOM_MIN_PLAYERS} joueurs pour lancer la partie.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">En attente du lancement par {host?.displayName ?? "l'hôte"}…</p>
          )}
        </div>

        <div className="space-y-6">
          <div className="glass space-y-3 p-6">
            <h2 className="font-display text-lg font-semibold">Inviter des amis</h2>
            {invitable.length ? (
              <ul className="space-y-2">
                {invitable.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={f.displayName} url={f.avatarUrl} size={24} />
                    <span className="min-w-0 flex-1 truncate">{f.displayName}</span>
                    <button
                      disabled={invited.has(f.id) || free === 0}
                      onClick={() => act(async () => {
                        await api.inviteToRoom(room.id, f.id);
                        setInvited((s) => new Set(s).add(f.id));
                      })}
                      className="btn-ghost !px-3 !py-1 text-xs"
                    >
                      {invited.has(f.id) ? "Invité ✓" : "Inviter"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Partage le code ou le lien : tout joueur avec un compte peut rejoindre.</p>
            )}
          </div>
          <div className="glass space-y-2 p-6">
            <h2 className="font-display text-lg font-semibold">Règles</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {[...ROOM_RULES, ...(room.suddenDeath ? SUDDEN_DEATH_RULES : [])].map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Classement en direct : score de chaque joueur et qui a déjà répondu (jamais la réponse elle-même). */
function Scoreboard({ room, meId }: { room: RoomDto; meId: string }) {
  return (
    <aside className="glass h-fit space-y-3 p-5">
      <p className="hud-label">{room.game.name} · {room.live?.suddenDeath ? "mort subite" : `manche ${room.live?.round ?? room.rounds}/${room.rounds}`}</p>
      <ol className="space-y-2">
        {room.players.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-2 text-sm ${p.left ? "opacity-50" : ""}`}>
            <span className="w-4 text-right text-muted">{i + 1}</span>
            <Avatar name={p.displayName} url={p.avatarUrl} size={24} frame={p.flair.frame} />
            <div className="min-w-0 flex-1"><PlayerName p={p} meId={meId} /></div>
            {p.left ? <span className="text-xs text-muted">parti</span> : p.answered && <span className="text-xs text-success" title="A répondu">✓</span>}
            <span className="w-12 text-right font-display font-bold">{p.score}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** Fin de manche : rang réel et réponse de chaque joueur. */
function RoundReveal({ round, players: all, meId }: { round: RoomRoundDto; players: RoomPlayerDto[]; meId: string }) {
  // Manche décisive : seuls les finalistes y ont répondu
  const players = round.suddenDeath ? all.filter((p) => round.answers.some((a) => a.userId === p.id) || p.finalist) : all;
  return (
    <div className="glass space-y-4 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="hud-label">{round.suddenDeath ? "Mort subite" : `Manche ${round.position}`} · rang réel</p>
        <RankEmblem rank={round.correctRank} size={64} />
        <p className="font-display text-lg font-bold" style={{ color: round.correctRank.color }}>{round.correctRank.name}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {players.map((p) => {
          const a = round.answers.find((x) => x.userId === p.id);
          return (
            <li key={p.id} className="flex items-center gap-2 rounded-lg bg-surface/60 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><PlayerName p={p} meId={meId} /></div>
              <span className="text-muted">{a ? a.rank.name : "—"}</span>
              <span className={`w-12 text-right font-bold ${a && a.score > 0 ? "text-success" : "text-muted"}`}>+{a?.score ?? 0}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Fin de partie : classement final (places partagées en cas d'égalité) et détail manche par manche. */
function FinalResult({ room, meId }: { room: RoomDto; meId: string }) {
  if (room.status === "CLOSED") {
    return (
      <Panel title="Salon fermé" text="Ce salon a été fermé avant le lancement de la partie.">
        <Link href="/rooms" className="btn-primary mx-auto w-fit">Salons privés</Link>
      </Panel>
    );
  }
  const me = room.players.find((p) => p.id === meId);
  const winners = room.players.filter((p) => p.placement === 1);
  return (
    <div className="space-y-6">
      <div className="glass space-y-2 p-8 text-center">
        <p className="hud-label">Partie terminée · {room.game.name}</p>
        <p className="font-display text-3xl font-bold">
          {me?.placement === 1 ? (winners.length > 1 ? "Victoire partagée !" : "Victoire !") : me?.placement ? `${me.placement}e place` : "Partie terminée"}
        </p>
        <p className="text-sm text-muted">
          {winners.length > 1 ? `Égalité en tête : ${winners.map((w) => w.displayName).join(", ")}` : `Vainqueur : ${winners[0]?.displayName ?? "—"}`}
        </p>
        {room.decidedBy && room.decidedBy !== "POINTS" && <p className="text-sm text-warn">{DECIDED_BY_LABEL[room.decidedBy]}</p>}
      </div>

      <ol className="glass divide-y divide-line/60 p-2">
        {room.players.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-3">
            <span className={`w-8 text-center font-display text-lg font-bold ${p.placement === 1 ? "text-neon" : "text-muted"}`}>{p.placement ?? "—"}</span>
            <PlayerLink id={p.id} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={p.displayName} url={p.avatarUrl} size={32} frame={p.flair.frame} />
              <div className="min-w-0 text-sm"><PlayerName p={p} meId={meId} /></div>
            </PlayerLink>
            {p.left && <span className="text-xs text-muted">parti en cours de partie</span>}
            <span className="font-display text-xl font-bold">{p.score}</span>
          </li>
        ))}
      </ol>

      {room.details.length > 0 && (
        <div className="glass overflow-x-auto p-6">
          <h2 className="mb-3 font-display text-lg font-semibold">Manche par manche</h2>
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 font-normal">Joueur</th>
                {room.details.map((d) => (
                  <th key={d.position} className="font-normal">
                    <span className="flex items-center gap-1" style={{ color: d.correctRank.color }}>
                      {d.suddenDeath ? "MS" : `#${d.position}`} <RankEmblem rank={d.correctRank} size={18} /> {d.correctRank.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {room.players.map((p) => (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="py-2 pr-3">{p.id === meId ? "Toi" : p.displayName}</td>
                  {room.details.map((d) => {
                    const a = d.answers.find((x) => x.userId === p.id);
                    return <td key={d.position} className="pr-3">{a ? `${a.rank.name} · ${a.score}` : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-center">
        <Link href="/rooms" className="btn-primary">Nouveau salon</Link>
      </div>
    </div>
  );
}
