"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GAME_NAMES, GAME_SLUGS, ROOM_CREATE_VIP_HINT, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_MAX_PLAYERS, ROOM_MODES, ROOM_MODE_LABEL,
  ROOM_ROUND_CHOICES, ROOM_RULES, ROOM_STATUS_LABEL, ROOM_SYSTEM_LABEL, ROOM_TIME_CHOICES, ROOM_VISIBILITY_HINT, ROOM_VISIBILITY_LABEL, modeSettings,
  normalizeRoomCode,
  type GameSlug, type PublicRoomDto, type RoomMode, type RoomVisibility, type RoomsOverviewDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { QuickPlay } from "@/components/QuickPlay";
import { RecentRoom } from "@/components/RecentRoom";
import { LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

/**
 * Salons personnalisés (jamais classés), section à part de l'onglet Duels : « Jouer maintenant », salons publics à
 * rejoindre (dont les salons gratuits par défaut), code d'un salon privé, création d'un salon (VIP), invitations reçues
 * et dernières parties.
 */
export default function RoomsPage() {
  const { me, loading } = useSession();
  const { onRoom } = useChat();
  const router = useRouter();
  const [data, setData] = useState<RoomsOverviewDto | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.rooms().then(setData, () => setData({ canCreate: false, vip: false, current: null, invites: [], recent: [] }));
  }, []);
  useEffect(() => {
    if (!me) return;
    load();
    return onRoom(load);
  }, [me, load, onRoom]);

  const join = async (value: string) => {
    if (busy) return;
    setJoinError(null);
    const normalized = normalizeRoomCode(value);
    if (!normalized) {
      setJoinError("Le code fait 8 caractères (lettres et chiffres), par exemple K7QM-2XPA.");
      return;
    }
    setBusy(true);
    try {
      const room = await api.joinRoom(normalized);
      router.push(`/rooms/${room.id}`);
    } catch (e) {
      setJoinError(errorMessage(e, "Impossible de rejoindre ce salon."));
      setBusy(false);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/rooms" text="Connecte-toi pour jouer dans un salon. Rejoindre un salon est gratuit." />;
  if (!data) return <Skeleton />;

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold">Salons</h1>
        <p className="max-w-2xl text-sm text-muted">
          Jusqu&apos;à {ROOM_MAX_PLAYERS} joueurs devinent le même clip au même moment. Rejoindre un salon public et y jouer est
          gratuit ; créer un salon est réservé aux VIP. Parties personnalisées : elles rapportent de l&apos;XP mais ne changent
          jamais ta cote du <Link href="/ranked" className="text-neon underline">classement compétitif</Link>, réservée aux duels au hasard.
        </p>
      </header>

      {data.current && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 border-neon/40 p-5">
          <div>
            <p className="hud-label text-neon">{ROOM_STATUS_LABEL[data.current.status]} · {ROOM_VISIBILITY_LABEL[data.current.visibility]}</p>
            <p className="mt-1 font-display text-lg font-semibold">
              {data.current.host ? `Salon de ${data.current.host}` : ROOM_SYSTEM_LABEL} · {data.current.game.name} · {data.current.players}/{data.current.maxPlayers} joueurs
            </p>
          </div>
          <Link href={`/rooms/${data.current.id}`} className="btn-primary">{data.current.status === "ACTIVE" ? "Reprendre la partie" : "Retourner au salon"}</Link>
        </div>
      )}

      {data.invites.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Invitations reçues</h2>
          <ul className="space-y-3">
            {data.invites.map((i) => (
              <li key={i.roomId} className="glass flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm">
                  <strong>{i.from}</strong> t&apos;invite sur {i.game.name} · {i.players}/{i.maxPlayers} joueurs
                </p>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => join(i.code)} className="btn-primary !py-2 text-sm">Rejoindre</button>
                  <button
                    onClick={async () => {
                      await api.declineRoomInvite(i.roomId).catch(() => undefined);
                      load();
                    }}
                    className="btn-ghost"
                  >
                    Ignorer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <QuickPlay vip={data.vip} />
        <div className="glass space-y-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold">Rejoindre avec un code</h2>
            <span className="rounded bg-success/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-success">Gratuit</span>
          </div>
          <p className="text-sm text-muted">Pour un salon privé : entre le code donné par ton ami.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join(code);
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="K7QM-2XPA"
              aria-label="Code du salon"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              className="input font-mono tracking-widest"
            />
            <button disabled={busy || !code.trim()} className="btn-primary shrink-0">Rejoindre</button>
          </form>
          {joinError && <p role="alert" className="text-sm text-danger">{joinError}</p>}
        </div>
      </div>

      <PublicRooms />

      <CreateRoom vip={data.vip} />

      <Link href="/tournaments" className="glass flex flex-wrap items-center justify-between gap-3 p-5 transition hover:border-violet">
        <div>
          <p className="font-display text-lg font-semibold">Tournois privés <span className="text-sm font-normal text-muted">· 4 à 16 joueurs</span></p>
          <p className="text-sm text-muted">Tableau à élimination directe entre amis. Seul le créateur doit être VIP, l&apos;inscription est gratuite.</p>
        </div>
        <span className="btn-ghost">Ouvrir</span>
      </Link>

      <div className="glass space-y-3 p-6">
        <h2 className="font-display text-lg font-semibold">Règles</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {ROOM_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="hud-label">Dernières parties</h2>
          <Link href="/rooms/history" className="text-sm text-neon underline">Historique et statistiques</Link>
        </div>
        {data.recent.length ? (
          <ul className="space-y-2">{data.recent.map((r) => <RecentRoom key={r.id} r={r} />)}</ul>
        ) : (
          <p className="text-sm text-muted">Aucune partie terminée pour l&apos;instant.</p>
        )}
      </div>
    </section>
  );
}

/** Liste des salons publics, filtrable par jeu, mode et places disponibles ; actualisée en direct et toutes les 15 s. */
function PublicRooms() {
  const router = useRouter();
  const { onRoom } = useChat();
  const [game, setGame] = useState<GameSlug | "">("");
  const [mode, setMode] = useState<RoomMode | "">("");
  const [available, setAvailable] = useState(true);
  const [rooms, setRooms] = useState<PublicRoomDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(() => {
    api.publicRooms({ game: game || undefined, mode: mode || undefined, available }).then(
      (r) => { setRooms(r); setError(null); },
      (e) => setError(errorMessage(e, "La liste des salons n'a pas pu être chargée.")),
    );
  }, [game, mode, available]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    const off = onRoom(load);
    return () => { clearInterval(t); off(); };
  }, [load, onRoom]);

  const join = async (id: string) => {
    if (joining) return;
    setJoining(id);
    setError(null);
    try {
      const room = await api.joinPublicRoom(id);
      router.push(`/rooms/${room.id}`);
    } catch (e) {
      setError(errorMessage(e, "Impossible de rejoindre ce salon."));
      setJoining(null);
      load();
    }
  };

  return (
    <div className="glass space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Salons publics</h2>
        <button onClick={load} className="btn-ghost !py-1 text-sm">Actualiser</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="hud-label">Jeu</span>
          <select value={game} onChange={(e) => setGame(e.target.value as GameSlug | "")} className="input">
            <option value="">Tous les jeux</option>
            {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as RoomMode | "")} className="input">
            <option value="">Tous les modes</option>
            {ROOM_MODES.map((m) => <option key={m} value={m}>{ROOM_MODE_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} className="h-4 w-4 accent-[var(--color-neon)]" />
          Places disponibles seulement
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!rooms ? (
        <p className="text-sm text-muted">Chargement des salons…</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-muted">Aucun salon public ne correspond. Les salons gratuits par défaut sont peut-être complets ou en cours : réessaie dans un instant.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {rooms.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {r.game.name} · {ROOM_MODE_LABEL[r.mode]}
                  <span className="ml-2 rounded bg-success/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-success">
                    {r.system ? ROOM_SYSTEM_LABEL : "Public"}
                  </span>
                </p>
                <p className="text-muted">
                  {r.host ? `Salon de ${r.host}` : "En attente de joueurs"} · {r.rounds} manches · {r.roundSec} s{r.suddenDeath ? " · mort subite" : ""} · {ROOM_STATUS_LABEL[r.status]}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${r.joinable ? "" : "text-muted"}`}>{r.players}/{r.maxPlayers}</span>
                {r.joinable ? (
                  <button disabled={!!joining} onClick={() => join(r.id)} className="btn-primary !py-2 text-sm">
                    {joining === r.id ? "Connexion…" : "Rejoindre"}
                  </button>
                ) : (
                  <span className="text-xs text-muted">{r.status === "ACTIVE" ? "En cours" : "Complet"}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Création d'un salon (public ou privé, tous modes) : réservée aux VIP, comme le vérifie le serveur. Sans VIP, le bloc
 * explique l'avantage et renvoie vers les salons publics gratuits, sans rien bloquer d'autre.
 */
function CreateRoom({ vip }: { vip: boolean }) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<RoomVisibility>("PUBLIC");
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [mode, setMode] = useState<RoomMode>("CLASSIC");
  const [rounds, setRounds] = useState<number>(ROOM_DEFAULT_ROUNDS);
  const [roundSec, setRoundSec] = useState<number>(ROOM_DEFAULT_TIME);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vip) {
    return (
      <div className="glass space-y-3 p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">Créer un salon <VipBadge /></h2>
        <p className="text-sm text-muted">{ROOM_CREATE_VIP_HINT}</p>
        <p className="text-sm text-muted">
          Avantage VIP : salons publics ou privés, tous les modes (chacun pour soi, équipes, Intrus), nombre de manches, temps
          de réponse et mort subite au choix. Tes amis te rejoignent gratuitement.
        </p>
        <Link href="/shop" className="btn-primary inline-flex !py-2 text-sm">Devenir VIP</Link>
      </div>
    );
  }

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom({ game, visibility, suddenDeath, rounds, roundSec, ...modeSettings(mode) });
      router.push(`/rooms/${room.id}`);
    } catch (e) {
      setError(errorMessage(e, "Le salon n'a pas pu être créé."));
      setBusy(false);
    }
  };

  return (
    <div className="glass space-y-4 p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">Créer un salon <VipBadge /></h2>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="hud-label mb-2">Visibilité</legend>
        {(["PUBLIC", "PRIVATE"] as const).map((v) => (
          <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${visibility === v ? "border-neon" : "border-line/60"}`}>
            <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} className="mt-1 h-4 w-4 accent-[var(--color-neon)]" />
            <span>
              <span className="font-semibold">{ROOM_VISIBILITY_LABEL[v]}</span>
              <span className="block text-muted">{ROOM_VISIBILITY_HINT[v]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="hud-label">Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as RoomMode)} className="input">
            {ROOM_MODES.map((m) => <option key={m} value={m}>{ROOM_MODE_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Jeu</span>
          <select value={game} onChange={(e) => setGame(e.target.value as GameSlug)} className="input">
            {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Manches</span>
          <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="input">
            {ROOM_ROUND_CHOICES.map((n) => <option key={n} value={n}>{n} manches</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Temps de réponse</span>
          <select value={roundSec} onChange={(e) => setRoundSec(Number(e.target.value))} className="input">
            {ROOM_TIME_CHOICES.map((n) => <option key={n} value={n}>{n} secondes</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={suddenDeath} onChange={(e) => setSuddenDeath(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-neon)]" />
        <span>
          <span className="font-semibold">Mort subite</span>
          <span className="block text-muted">
            En cas d&apos;égalité en tête, manche décisive entre les ex aequo (3 joueurs au maximum, puis la réponse la plus rapide).
            Les autres joueurs n&apos;ont pas besoin d&apos;être VIP.
          </span>
        </span>
      </label>
      {mode === "IMPOSTOR" && (
        <p className="text-sm text-muted">
          Intrus (4 à 8 joueurs) : à chaque manche, un joueur reçoit un autre clip sans le savoir ; après les réponses, tout le monde vote pour le démasquer.
        </p>
      )}
      <button disabled={busy} onClick={create} className="btn-primary w-full sm:w-auto">
        {busy ? "Création…" : visibility === "PUBLIC" ? "Créer le salon public" : "Créer le salon privé"}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
