"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  STAGE_NAME, TOURNAMENT_DECIDED_BY_LABEL, TOURNAMENT_MIN_PLAYERS, TOURNAMENT_RULES, TOURNAMENT_STATUS_LABEL, formatRoomCode, stageCount,
  type TournamentDecidedBy, type TournamentDto, type TournamentMatchDto, type TournamentPlayerDto,
} from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { Avatar } from "@/components/Header";
import { errorMessage } from "@/components/AuthForm";
import { FlairBadge } from "@/components/Flair";
import { PlayerLink } from "@/components/PlayerLink";
import { LoginRequired, Panel, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

/** Tournoi : inscriptions (code), match du joueur (« Je suis prêt »), tableau, classement final. */
export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = useSession();
  const { onTournament } = useChat();
  const router = useRouter();
  const confirm = useConfirm();
  const [t, setT] = useState<TournamentDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const lastStatus = useRef<{ id: string; status: string } | null>(null);

  const apply = useCallback((d: TournamentDto) => {
    offset.current = new Date(d.serverNow).getTime() - Date.now();
    setT(d);
  }, []);
  const load = useCallback(() => {
    api.tournament(id).then(apply, (e) => e instanceof ApiError && e.status === 404 && setMissing(true));
  }, [id, apply]);

  useEffect(() => {
    if (!me) return;
    load();
    const refresh = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", refresh);
    const off = onTournament((e) => e.id === id && load());
    return () => {
      off();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [me, id, load, onTournament]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => window.clearInterval(timer);
  }, []);

  const myMatch = t?.matches.find((m) => m.id === t.myMatch) ?? null;
  // Le salon du match vient d'être créé : direction le match (une fois)
  // Le salon du match vient d'être créé pendant que la page est ouverte (« prêt » → « en cours ») : direction le match.
  // Pas au premier affichage : un joueur qui revient d'un match terminé n'y est pas renvoyé.
  useEffect(() => {
    if (!myMatch) return;
    const before = lastStatus.current;
    lastStatus.current = { id: myMatch.id, status: myMatch.status };
    if (before?.id === myMatch.id && before.status === "READY" && myMatch.status === "PLAYING" && myMatch.roomId) {
      router.push(`/rooms/${myMatch.roomId}`);
    }
  }, [myMatch, router]);

  // Heure limite dépassée sans nouvelle du serveur (connexion coupée) : on relit l'état
  const deadline = myMatch?.deadlineAt ? new Date(myMatch.deadlineAt).getTime() : 0;
  const overdue = !!deadline && now > deadline + 4000;
  useEffect(() => {
    if (!overdue) return;
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [overdue, load]);

  const act = async (action: () => Promise<TournamentDto | unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "matches" in r) apply(r as TournamentDto);
      else load();
    } catch (e) {
      setError(errorMessage(e));
      load();
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={`/tournaments/${id}`} text="Connecte-toi pour suivre ce tournoi. L'inscription est gratuite." />;
  if (missing) return <Panel title="Tournoi introuvable" text="Ce tournoi n'existe pas ou tu n'y es pas inscrit."><Link href="/tournaments" className="btn-ghost mx-auto w-fit">Tournois</Link></Panel>;
  if (!t) return <Skeleton />;

  const name = (uid: string | null) => (uid ? (uid === me.id ? "Toi" : t.players.find((p) => p.id === uid)?.displayName ?? "?") : null);
  const meP = t.players.find((p) => p.id === me.id)!;
  const canLeave = (t.status === "LOBBY" || t.status === "ACTIVE") && !t.left;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/tournaments" className="text-sm text-muted hover:text-ink">← Tournois</Link>
        {canLeave && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: "Quitter le tournoi ?",
                message: t.status === "ACTIVE"
                  ? "Tu perdras ton match en cours ou à venir par forfait."
                  : t.isHost
                    ? "L'organisation passera à un inscrit VIP. S'il n'y en a aucun, le tournoi restera en attente : un joueur VIP inscrit pourra reprendre l'organisation."
                    : "Tu pourras te réinscrire avec le code tant que le tournoi n'a pas commencé.",
                confirmLabel: "Quitter",
                danger: true,
              });
              if (ok === false) return;
              await act(async () => {
                await api.leaveTournament(id);
                if (t.status === "LOBBY") router.push("/tournaments");
              });
            }}
            className="text-sm text-muted hover:text-danger"
          >
            Quitter
          </button>
        )}
      </div>

      <header className="glass flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="hud-label">{TOURNAMENT_STATUS_LABEL[t.status]}</p>
          <h1 className="font-display text-2xl font-bold">Tournoi · {t.game.name}</h1>
          <p className="text-sm text-muted">{t.rounds} manches par match · {t.roundSec} s par manche · {t.players.length}/{t.capacity} joueurs</p>
        </div>
        {t.status === "LOBBY" && <CodeBox code={t.code} />}
      </header>
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}

      {t.status === "LOBBY" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="glass space-y-4 p-6">
            <h2 className="font-display text-lg font-semibold">Inscrits</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {t.players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface/60 p-3 text-sm">
                  <Avatar name={p.displayName} url={p.avatarUrl} size={32} frame={p.flair.frame} />
                  <PlayerName p={p} meId={me.id} />
                </li>
              ))}
            </ul>
            {t.isHost ? (
              <div className="space-y-2">
                <button disabled={!t.canStart} onClick={() => act(() => api.startTournament(id))} className="btn-primary w-full sm:w-auto">Lancer le tournoi</button>
                {!t.canStart && <p className="text-sm text-muted">Il faut au moins {TOURNAMENT_MIN_PLAYERS} inscrits pour lancer le tournoi.</p>}
              </div>
            ) : t.hostLeft ? (
              <div className="space-y-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
                <p>
                  L&apos;organisateur a quitté le tournoi et aucun inscrit VIP ne pouvait le remplacer. Un joueur VIP inscrit peut reprendre
                  l&apos;organisation pour le lancer. Sinon, le tournoi sera fermé au départ du dernier inscrit ou à l&apos;expiration de la salle
                  d&apos;attente ({new Date(t.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}).
                </p>
                {t.canClaimHost ? (
                  <button onClick={() => act(() => api.claimTournamentHost(id))} className="btn-primary">Reprendre l&apos;organisation</button>
                ) : (
                  <Link href="/shop" className="inline-flex items-center gap-2 text-neon hover:underline">Organiser un tournoi est réservé aux VIP <VipBadge /></Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">En attente du lancement par {t.players.find((p) => p.isHost)?.displayName ?? "l'hôte"}…</p>
            )}
          </div>
          <Rules />
        </div>
      )}

      {t.status === "ACTIVE" && (
        <MyMatchCard t={t} match={myMatch} me={meP} now={now} name={name} onReady={() => act(() => api.readyForMatch(id))} />
      )}

      {t.status === "FINISHED" && <Standings t={t} meId={me.id} />}

      {t.status === "CLOSED" && <Panel title="Tournoi fermé" text="Ce tournoi a été fermé avant son lancement." />}

      {t.bracketSize && <Bracket t={t} name={name} meId={me.id} />}
      {t.status === "ACTIVE" && <Rules />}
    </section>
  );
}

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? formatRoomCode(code) : `${window.location.origin}/tournaments/join/${formatRoomCode(code)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copie ce texte :", text);
    }
  };
  return (
    <div className="space-y-2 text-center">
      <p className="font-mono text-3xl font-bold tracking-[0.2em] text-neon">{formatRoomCode(code)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={() => copy("code")} className="btn-ghost !px-3 !py-1 text-xs">{copied === "code" ? "Code copié ✓" : "Copier le code"}</button>
        <button onClick={() => copy("link")} className="btn-ghost !px-3 !py-1 text-xs">{copied === "link" ? "Lien copié ✓" : "Copier le lien"}</button>
      </div>
    </div>
  );
}

function Rules() {
  return (
    <div className="glass h-fit space-y-2 p-6">
      <h2 className="font-display text-lg font-semibold">Règles</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{TOURNAMENT_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

function PlayerName({ p, meId }: { p: TournamentPlayerDto; meId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{p.id === meId ? "Toi" : p.displayName}</span>
      <FlairBadge flair={p.flair} size={11} />
      {p.vip && <VipBadge />}
      {p.isHost && <span title="Hôte du tournoi" className="text-xs text-warn">★</span>}
    </span>
  );
}

/** Match du joueur : adversaire, heure limite et « Je suis prêt » ; ou son élimination. */
function MyMatchCard({
  t, match, me, now, name, onReady,
}: { t: TournamentDto; match: TournamentMatchDto | null; me: TournamentPlayerDto; now: number; name: (id: string | null) => string | null; onReady: () => void }) {
  if (me.left) return <Panel title="Tu as quitté le tournoi" text="Tu peux continuer à suivre le tableau." />;
  if (!match) {
    return (
      <Panel title={me.eliminated ? "Éliminé" : "Qualifié"} text={me.eliminated ? `Tu termines à la ${me.placement}e place. Suis la suite du tableau ci-dessous.` : "En attente de la suite du tableau."} />
    );
  }
  const stage = STAGE_NAME(t.bracketSize!, match.stage);
  const meFirst = match.player1 === me.id;
  const opponent = meFirst ? match.player2 : match.player1;
  const imReady = meFirst ? match.ready1 : match.ready2;
  const theyReady = meFirst ? match.ready2 : match.ready1;
  const left = match.deadlineAt ? Math.max(0, Math.ceil((new Date(match.deadlineAt).getTime() - now) / 1000)) : 0;
  return (
    <div className="glass space-y-4 border-neon/40 p-6 text-center">
      <p className="hud-label text-neon">{stage} · ton match</p>
      {match.status === "WAITING" ? (
        <p className="font-display text-xl font-semibold">En attente de ton adversaire (match précédent en cours)</p>
      ) : match.status === "PLAYING" && match.roomId ? (
        <>
          <p className="font-display text-xl font-semibold">Match en cours contre {name(opponent)}</p>
          <Link href={`/rooms/${match.roomId}`} className="btn-primary mx-auto w-fit">Rejoindre le match</Link>
        </>
      ) : (
        <>
          <p className="font-display text-2xl font-bold">Toi contre {name(opponent)}</p>
          <p className="text-sm text-muted">
            {imReady ? (theyReady ? "Lancement du match…" : `En attente de ${name(opponent)}…`) : theyReady ? `${name(opponent)} est prêt et t'attend.` : "Clique quand tu es prêt : le match démarre dès que vous l'êtes tous les deux."}
          </p>
          <button disabled={imReady} onClick={onReady} className="btn-primary mx-auto">{imReady ? "Prêt ✓" : "Je suis prêt"}</button>
          {match.deadlineAt && (
            <p className={`text-sm ${left <= 60 ? "text-danger" : "text-muted"}`}>
              Heure limite dans {Math.floor(left / 60)} min {String(left % 60).padStart(2, "0")} s : le joueur absent perd par forfait.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Tableau : une colonne par tour, chaque match avec ses deux joueurs, le score et le vainqueur. */
function Bracket({ t, name, meId }: { t: TournamentDto; name: (id: string | null) => string | null; meId: string }) {
  const size = t.bracketSize!;
  const seed = (id: string | null) => t.players.find((p) => p.id === id)?.seed;
  const stages = Array.from({ length: stageCount(size) }, (_, i) => i + 1);
  const side = (m: TournamentMatchDto, n: 1 | 2) => {
    const pid = n === 1 ? m.player1 : m.player2;
    const score = n === 1 ? m.score1 : m.score2;
    const won = !!pid && m.winnerId === pid;
    const lost = !!pid && !!m.winnerId && m.winnerId !== pid;
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-sm ${won ? "font-semibold text-ink" : lost ? "text-muted line-through decoration-muted/50" : "text-ink"} ${pid === meId ? "bg-violet/10" : ""}`}>
        <span className="w-5 text-right text-xs text-muted">{seed(pid) ?? ""}</span>
        <span className="min-w-0 flex-1 truncate">{name(pid) ?? (m.decidedBy === "BYE" ? "—" : "à venir")}</span>
        {score !== null && <span className="font-display">{score}</span>}
        {won && <span className="text-success" aria-label="Vainqueur">✓</span>}
      </div>
    );
  };
  return (
    <div className="glass space-y-3 p-6">
      <h2 className="font-display text-lg font-semibold">Tableau</h2>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {stages.map((s) => (
            <div key={s} className="flex w-56 flex-col justify-around gap-3">
              <p className="hud-label text-center">{STAGE_NAME(size, s)}</p>
              {t.matches.filter((m) => m.stage === s).map((m) => (
                <div key={m.id} className="overflow-hidden rounded-xl border border-line/60 bg-surface/60">
                  {side(m, 1)}
                  <div className="border-t border-line/60" />
                  {side(m, 2)}
                  {m.decidedBy && m.decidedBy !== "POINTS" && m.decidedBy !== "BYE" && (
                    <p className="border-t border-line/60 px-3 py-1 text-[11px] text-muted">{TOURNAMENT_DECIDED_BY_LABEL[m.decidedBy as TournamentDecidedBy]}</p>
                  )}
                  {m.status === "PLAYING" && <p className="border-t border-line/60 px-3 py-1 text-[11px] text-neon">En cours</p>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Classement final et statistiques (victoires hors qualifications d'office, points marqués en match). */
function Standings({ t, meId }: { t: TournamentDto; meId: string }) {
  const winner = t.players.find((p) => p.placement === 1);
  const me = t.players.find((p) => p.id === meId);
  return (
    <div className="space-y-4">
      <div className="glass space-y-1 p-8 text-center">
        <p className="hud-label">Tournoi terminé</p>
        <p className="font-display text-3xl font-bold">{me?.placement === 1 ? "Tu remportes le tournoi !" : `Vainqueur : ${winner?.displayName ?? "—"}`}</p>
        {me?.placement && me.placement !== 1 && <p className="text-sm text-muted">Tu termines à la {me.placement}e place.</p>}
      </div>
      <div className="glass overflow-x-auto p-2">
        <table className="w-full min-w-[26rem] text-sm">
          <thead className="text-left text-muted">
            <tr><th className="px-3 py-2 font-normal">Place</th><th className="font-normal">Joueur</th><th className="font-normal">Victoires</th><th className="pr-3 text-right font-normal">Points</th></tr>
          </thead>
          <tbody>
            {t.players.map((p) => (
              <tr key={p.id} className="border-t border-line/60">
                <td className={`px-3 py-2 font-display text-lg font-bold ${p.placement === 1 ? "text-neon" : "text-muted"}`}>{p.placement ?? "—"}</td>
                <td>
                  <PlayerLink id={p.id} className="flex items-center gap-2">
                    <Avatar name={p.displayName} url={p.avatarUrl} size={26} frame={p.flair.frame} />
                    <PlayerName p={p} meId={meId} />
                    {p.left && <span className="text-xs text-muted">(parti)</span>}
                  </PlayerLink>
                </td>
                <td>{p.wins}</td>
                <td className="pr-3 text-right font-display">{p.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
