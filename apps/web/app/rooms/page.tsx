"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GAME_NAMES, GAME_SLUGS, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_MAX_PLAYERS, ROOM_ROUND_CHOICES, ROOM_RULES, ROOM_STATUS_LABEL,
  ROOM_TIME_CHOICES, TOKEN_REASON_LABEL, formatRoomCode, normalizeRoomCode, type GameSlug, type RoomSummaryDto, type RoomsOverviewDto,
  type TokensDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

type Format = "solo" | "teams2" | "teams3" | "impostor";

/** Salons privés : créer un salon (VIP), rejoindre avec un code (gratuit), invitations reçues, dernières parties. */
export default function RoomsPage() {
  const { me, loading } = useSession();
  const { onRoom } = useChat();
  const router = useRouter();
  const [data, setData] = useState<RoomsOverviewDto | null>(null);
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [rounds, setRounds] = useState<number>(ROOM_DEFAULT_ROUNDS);
  const [roundSec, setRoundSec] = useState<number>(ROOM_DEFAULT_TIME);
  const [suddenDeath, setSuddenDeath] = useState(true);
  const [confidence, setConfidence] = useState(false);
  const [format, setFormat] = useState<Format>("solo");
  const [tokens, setTokens] = useState<TokensDto | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.rooms().then(setData, () => setData({ canHost: false, current: null, invites: [], recent: [] }));
    api.tokens().then(setTokens, () => setTokens(null));
  }, []);
  useEffect(() => {
    if (!me) return;
    load();
    return onRoom(load);
  }, [me, load, onRoom]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom({
        game, rounds, roundSec, suddenDeath,
        confidence: format !== "impostor" && confidence,
        teamSize: format === "teams2" ? 2 : format === "teams3" ? 3 : 0,
        impostor: format === "impostor",
      });
      router.push(`/rooms/${room.id}`);
    } catch (e) {
      setError(errorMessage(e, "Le salon n'a pas pu être créé."));
      setBusy(false);
    }
  };

  const join = async (value: string) => {
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
  if (!me) return <LoginRequired next="/rooms" text="Connecte-toi pour créer ou rejoindre un salon privé. Rejoindre un salon est gratuit." />;
  if (!data) return <Skeleton />;

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold">Salons privés</h1>
        <p className="max-w-2xl text-sm text-muted">
          Jusqu&apos;à {ROOM_MAX_PLAYERS} amis devinent le même clip au même moment. Seul le joueur qui crée le salon doit être VIP :
          rejoindre, jouer et voir les résultats est gratuit pour tout le monde.
        </p>
      </header>

      <Link href="/tournaments" className="glass flex flex-wrap items-center justify-between gap-3 p-5 transition hover:border-violet">
        <div>
          <p className="font-display text-lg font-semibold">Tournois privés <span className="text-sm font-normal text-muted">· 4 à 16 joueurs</span></p>
          <p className="text-sm text-muted">Tableau à élimination directe entre amis. Seul le créateur doit être VIP, l&apos;inscription est gratuite.</p>
        </div>
        <span className="btn-ghost">Ouvrir</span>
      </Link>

      {data.current && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 border-neon/40 p-5">
          <div>
            <p className="hud-label text-neon">{ROOM_STATUS_LABEL[data.current.status]}</p>
            <p className="mt-1 font-display text-lg font-semibold">
              Salon de {data.current.host} · {data.current.game.name} · {data.current.players}/{data.current.maxPlayers} joueurs
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
        <div className="glass space-y-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold">Rejoindre un salon</h2>
            <span className="rounded bg-success/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-success">Gratuit</span>
          </div>
          <p className="text-sm text-muted">Entre le code donné par ton ami.</p>
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

        <div className="glass space-y-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-semibold">Créer un salon</h2>
            <VipBadge />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="hud-label">Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)} className="input">
                <option value="solo">Chacun pour soi (2 à 8)</option>
                <option value="teams2">Équipes 2 contre 2</option>
                <option value="teams3">Équipes 3 contre 3</option>
                <option value="impostor">Intrus (4 à 8)</option>
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
              <span className="block text-muted">En cas d&apos;égalité en tête, manche décisive entre les ex aequo (3 au maximum, puis la réponse la plus rapide).</span>
            </span>
          </label>
          {format === "impostor" ? (
            <p className="text-sm text-muted">
              Intrus : à chaque manche, un joueur reçoit un autre clip sans le savoir ; après les réponses, tout le monde vote pour le démasquer.
            </p>
          ) : (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={confidence} onChange={(e) => setConfidence(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-neon)]" />
              <span>
                <span className="font-semibold">Mode Confiance</span>
                <span className="block text-muted">Chaque réponse engage 1 à 3 jetons virtuels (gratuits, jamais achetables). Tes amis jouent avec leurs propres jetons.</span>
              </span>
            </label>
          )}
          {data.canHost ? (
            <button disabled={busy} onClick={create} className="btn-primary w-full sm:w-auto">Créer le salon</button>
          ) : (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
              <p>
                Créer un salon est réservé aux joueurs VIP. Tes amis n&apos;ont pas besoin d&apos;être VIP : ils rejoignent et jouent gratuitement.
              </p>
              <Link href="/shop" className="btn-primary mt-3 inline-flex !py-2 text-sm">Devenir VIP</Link>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </div>

      {tokens && (
        <div className="glass space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Mes jetons</h2>
              <p className="text-sm text-muted">Jetons virtuels du mode Confiance : ni achat, ni retrait, ni échange.</p>
            </div>
            <p className="font-display text-3xl font-bold text-warn">{tokens.balance}</p>
          </div>
          {tokens.canRefill && (
            <button
              onClick={async () => {
                try {
                  setTokens(await api.refillTokens());
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
              className="btn-ghost"
            >
              Recharge gratuite du jour (jusqu&apos;à {tokens.refillTo})
            </button>
          )}
          <p className="text-xs text-muted">Bénéfice du jour : {tokens.profitToday} / {tokens.dailyProfitCap} jetons au maximum.</p>
          {tokens.history.length > 0 && (
            <ul className="divide-y divide-line/60 text-sm">
              {tokens.history.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-1.5">
                  <span className="text-muted">
                    {TOKEN_REASON_LABEL[t.reason]}{t.roomCode ? ` · salon ${formatRoomCode(t.roomCode)}, manche ${t.round}` : ""}
                  </span>
                  <span className={t.delta >= 0 ? "text-success" : "text-danger"}>{t.delta >= 0 ? `+${t.delta}` : t.delta}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="glass space-y-3 p-6">
        <h2 className="font-display text-lg font-semibold">Règles</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          {ROOM_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      {data.recent.length > 0 && (
        <div className="space-y-3">
          <h2 className="hud-label">Dernières parties</h2>
          <ul className="space-y-2">{data.recent.map((r) => <RecentRoom key={r.id} r={r} />)}</ul>
        </div>
      )}
    </section>
  );
}

function RecentRoom({ r }: { r: RoomSummaryDto }) {
  return (
    <li>
      <Link href={`/rooms/${r.id}`} className="glass flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-violet">
        <span className="text-sm">
          Salon de {r.host} · {r.game.name} · {r.players} joueurs
          <span className="ml-2 font-mono text-xs text-muted">{formatRoomCode(r.code)}</span>
        </span>
        <span className="text-sm font-semibold">
          {r.placement === 1 ? <span className="text-neon">Victoire</span> : r.placement ? `${r.placement}e place` : "Terminé"}
        </span>
      </Link>
    </li>
  );
}
