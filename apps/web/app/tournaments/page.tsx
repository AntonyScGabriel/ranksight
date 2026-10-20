"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ALL_GAMES, GAME_NAMES, GAME_SLUGS, ROOM_TIME_CHOICES, TOURNAMENT_CAPACITIES, TOURNAMENT_ROUND_CHOICES, TOURNAMENT_RULES, TOURNAMENT_STATUS_LABEL, tournamentRewardLabel,
  normalizeRoomCode, type GameSlug, type TournamentSummaryDto, type TournamentsOverviewDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

/** Tournois privés : créer un tournoi (VIP), s'inscrire avec un code (gratuit), tournois en cours et terminés. */
export default function TournamentsPage() {
  const { me, loading } = useSession();
  const { onTournament } = useChat();
  const router = useRouter();
  const [data, setData] = useState<TournamentsOverviewDto | null>(null);
  // « Tous les jeux » : chaque manche tire un clip de n'importe quel jeu
  const [game, setGame] = useState<GameSlug | typeof ALL_GAMES.slug>(GAME_SLUGS[0]);
  const [capacity, setCapacity] = useState<number>(8);
  const [rounds, setRounds] = useState<number>(3);
  const [roundSec, setRoundSec] = useState<number>(30);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.tournaments().then(setData, () => setData({ canHost: false, current: [], recent: [], events: [], public: [] }));
  }, []);
  useEffect(() => {
    if (!me) return;
    load();
    return onTournament(load);
  }, [me, load, onTournament]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.createTournament({ game, capacity, rounds, roundSec, visibility });
      router.push(`/tournaments/${t.id}`);
    } catch (e) {
      setError(errorMessage(e, "Le tournoi n'a pas pu être créé."));
      setBusy(false);
    }
  };

  const join = async () => {
    setJoinError(null);
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setJoinError("Le code fait 8 caractères (lettres et chiffres), par exemple K7QM-2XPA.");
      return;
    }
    setBusy(true);
    try {
      const t = await api.joinTournament(normalized);
      router.push(`/tournaments/${t.id}`);
    } catch (e) {
      setJoinError(errorMessage(e, "Impossible de s'inscrire à ce tournoi."));
      setBusy(false);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/tournaments" text="Connecte-toi pour créer un tournoi ou t'inscrire à celui d'un ami. L'inscription est gratuite." />;
  if (!data) return <Skeleton />;

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <Link href="/rooms" className="text-sm text-muted hover:text-ink">← Salons</Link>
        <h1 className="font-display text-3xl font-bold">Tournois privés</h1>
        <p className="max-w-2xl text-sm text-muted">
          Tableau à élimination directe jusqu&apos;à 16 joueurs, chaque match en duel direct. Seul le créateur du tournoi doit être VIP :
          s&apos;inscrire, jouer et gagner est gratuit pour tout le monde.
        </p>
      </header>

      {data.public.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Tournois publics ouverts</h2>
          <ul className="space-y-2">{data.public.map((t) => <TournamentRow key={t.id} t={t} />)}</ul>
        </div>
      )}

      {data.events.length > 0 && (
        <div className="space-y-3" data-testid="events">
          <h2 className="hud-label">Événements RankGuess</h2>
          <ul className="space-y-2">{data.events.map((t) => <EventRow key={t.id} t={t} />)}</ul>
        </div>
      )}

      {data.current.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Mes tournois en cours</h2>
          <ul className="space-y-2">{data.current.map((t) => <TournamentRow key={t.id} t={t} />)}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass space-y-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold">S&apos;inscrire</h2>
            <span className="rounded bg-success/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-success">Gratuit</span>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void join(); }} className="flex flex-col gap-3 sm:flex-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="K7QM-2XPA"
              aria-label="Code du tournoi"
              autoComplete="off"
              maxLength={12}
              className="input font-mono tracking-widest"
            />
            <button disabled={busy || !code.trim()} className="btn-primary shrink-0">S&apos;inscrire</button>
          </form>
          {joinError && <p role="alert" className="text-sm text-danger">{joinError}</p>}
        </div>

        <div className="glass space-y-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold">Créer un tournoi</h2>
            <VipBadge />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="hud-label">Jeu</span>
              <select value={game} onChange={(e) => setGame(e.target.value as GameSlug | typeof ALL_GAMES.slug)} className="input">
                {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
                <option value={ALL_GAMES.slug}>{ALL_GAMES.name}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="hud-label">Places</span>
              <select value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className="input">
                {TOURNAMENT_CAPACITIES.map((n) => <option key={n} value={n}>{n} joueurs</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="hud-label">Manches par match</span>
              <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="input">
                {TOURNAMENT_ROUND_CHOICES.map((n) => <option key={n} value={n}>{n} manches</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="hud-label">Temps de réponse</span>
              <select value={roundSec} onChange={(e) => setRoundSec(Number(e.target.value))} className="input">
                {ROOM_TIME_CHOICES.map((n) => <option key={n} value={n}>{n} secondes</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="hud-label">Visibilité</span>
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as "PUBLIC" | "PRIVATE")} className="input">
                <option value="PRIVATE">Privé : inscription avec le code</option>
                <option value="PUBLIC">Public : listé, tout le monde peut s&apos;inscrire</option>
              </select>
            </label>
          </div>
          {data.canHost ? (
            <button disabled={busy} onClick={create} className="btn-primary w-full sm:w-auto">Créer le tournoi</button>
          ) : (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
              <p>Créer un tournoi est réservé aux joueurs VIP. Tes amis n&apos;ont pas besoin d&apos;être VIP pour s&apos;inscrire et jouer.</p>
              <Link href="/shop" className="btn-primary mt-3 inline-flex !py-2 text-sm">Devenir VIP</Link>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </div>

      <div className="glass space-y-3 p-6">
        <h2 className="font-display text-lg font-semibold">Règles</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{TOURNAMENT_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>

      {data.recent.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Derniers tournois</h2>
          <ul className="space-y-2">{data.recent.map((t) => <TournamentRow key={t.id} t={t} />)}</ul>
        </div>
      )}
    </section>
  );
}

/** Événement de l'équipe : nom, places, récompense du vainqueur ; ouvert à tous */
function EventRow({ t }: { t: TournamentSummaryDto }) {
  const reward = tournamentRewardLabel(t.reward);
  return (
    <li>
      <Link href={`/tournaments/${t.id}`} className="glass flex flex-wrap items-center justify-between gap-3 border-warn/40 p-4 transition hover:border-warn">
        <span className="space-y-0.5">
          <span className="block font-display font-semibold">🏆 {t.title}</span>
          <span className="block text-sm text-muted">{t.game.name} · {t.players}/{t.capacity} joueurs{reward ? ` · récompense : ${reward}` : ""}</span>
          {t.startsAt && t.status === "LOBBY" && <span className="block text-xs text-neon">Début : {new Date(t.startsAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</span>}
        </span>
        <span className="text-sm font-semibold text-warn">{t.status === "LOBBY" ? "Inscriptions ouvertes" : TOURNAMENT_STATUS_LABEL[t.status]}</span>
      </Link>
    </li>
  );
}

function TournamentRow({ t }: { t: TournamentSummaryDto }) {
  return (
    <li>
      <Link href={`/tournaments/${t.id}`} className="glass flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-violet">
        <span className="text-sm">{t.isEvent ? t.title : `Tournoi de ${t.host}`} · {t.game.name} · {t.players}/{t.capacity} joueurs</span>
        <span className="text-sm font-semibold">
          {t.status === "FINISHED" ? (t.placement === 1 ? <span className="text-neon">Vainqueur</span> : t.placement ? `${t.placement}e place` : "Terminé") : TOURNAMENT_STATUS_LABEL[t.status]}
        </span>
      </Link>
    </li>
  );
}
