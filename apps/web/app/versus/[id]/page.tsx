"use client";

import { use, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VERSUS_STATUS_LABEL, type FlairDto, type VersusMatchDto, type VersusRoundDto } from "@ranksight/shared";
import { api, ApiError, media } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { useLiveDuel, type VersusClip } from "@/lib/versus";
import { Avatar } from "@/components/Header";
import { FlairBadge, TitleText } from "@/components/Flair";
import { errorMessage } from "@/components/AuthForm";
import { ClipPlayer } from "@/components/ClipPlayer";
import { PlayerLink } from "@/components/PlayerLink";
import { RankEmblem } from "@/components/RankEmblem";
import { RankPicker } from "@/components/RankPicker";
import { LoginRequired, Panel, Skeleton } from "@/components/States";

/** Duel en direct : attente de l'adversaire, manches synchronisées avec chrono, révélation des réponses, résultat. */
export default function VersusMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, loading } = useSession();
  const router = useRouter();
  const confirm = useConfirm();
  const duel = useLiveDuel(id, !!me);
  const { match, phase } = duel;
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<VersusMatchDto | unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "status" in r) duel.apply(r as VersusMatchDto);
      else duel.load();
    } catch (e) {
      setError(errorMessage(e));
      duel.load();
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next={`/versus/${id}`} text="Connecte-toi pour rejoindre ce duel." />;
  if (duel.missing) return <Panel title="Duel introuvable" text="Ce duel n'existe pas ou ne te concerne pas."><Link href="/versus" className="btn-ghost mx-auto w-fit">Mes duels</Link></Panel>;
  if (!match) return <Skeleton />;

  const opp = match.opponent;
  const lastRound = match.details.at(-1);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/versus" className="text-sm text-muted hover:text-ink">← Duels</Link>
        {match.status === "ACTIVE" && (
          <button
            onClick={async () => {
              const ok = await confirm({ title: "Abandonner le duel ?", message: `${opp?.displayName ?? "Ton adversaire"} remportera la victoire.`, confirmLabel: "Abandonner", danger: true });
              if (ok !== false) void act(() => api.forfeitVersus(id));
            }}
            className="text-sm text-muted hover:text-danger"
          >
            Abandonner
          </button>
        )}
      </div>

      <Scoreboard match={match} />
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}

      {phase === "waiting" && (
        <div className="glass space-y-4 p-8 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-violet border-t-transparent" aria-hidden />
          <p className="font-display text-xl font-semibold">
            {match.status === "OPEN" ? "Recherche d'un adversaire…" : `En attente de ${opp?.displayName ?? "ton ami"}…`}
          </p>
          <p className="text-sm text-muted">
            {match.status === "OPEN"
              ? "Le duel démarre dès qu'un autre joueur lance une recherche. Reste sur cette page."
              : "Ton ami a reçu l'invitation. Le duel démarre dès qu'il accepte. Reste sur cette page."}
          </p>
          <button onClick={() => act(async () => { await api.cancelVersus(id); router.push("/versus"); })} className="btn-ghost mx-auto">
            Annuler
          </button>
        </div>
      )}

      {phase === "invited" && (
        <div className="glass space-y-4 p-8 text-center">
          <p className="font-display text-xl font-semibold">{opp?.displayName} te défie{match.game ? ` sur ${match.game.name}` : ""} !</p>
          <p className="text-sm text-muted">5 clips, 30 secondes par manche, en même temps que ton adversaire.</p>
          <div className="flex justify-center gap-3">
            <button onClick={() => act(() => api.acceptVersus(id))} className="btn-primary">Accepter et jouer</button>
            <button onClick={() => act(async () => { await api.declineVersus(id); router.push("/versus"); })} className="btn-ghost">Refuser</button>
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div className="space-y-6">
          {lastRound && <RoundReveal round={lastRound} opponentName={opp?.displayName ?? "Adversaire"} />}
          <div className="glass p-8 text-center">
            <p className="hud-label">{match.live!.round === 1 ? "Le duel commence" : `Manche ${match.live!.round}/${match.rounds}`}</p>
            <p className="font-display text-6xl font-bold text-neon" aria-live="polite">{duel.secondsLeft}</p>
          </div>
        </div>
      )}

      {phase === "playing" && (duel.clip ? (
        <LiveRound
          key={duel.clip.playToken}
          clip={duel.clip}
          secondsLeft={duel.secondsLeft}
          progress={duel.roundProgress}
          onSubmitted={() => duel.markSubmitted(duel.clip!.position)}
          onClosed={duel.load}
        />
      ) : (
        <Skeleton className="h-96" />
      ))}

      {(phase === "answered" || phase === "timeout") && match.live && (
        <div className="glass space-y-3 p-8 text-center">
          <p className="font-display text-xl font-semibold">
            {phase === "timeout" && !match.live.answered ? "Temps écoulé !" : "Réponse envoyée"}
          </p>
          <p className="text-sm text-muted">
            {match.live.opponentAnswered ? `${opp?.displayName} a répondu aussi.` : `${opp?.displayName} réfléchit encore…`}
            {phase === "answered" && ` Fin de la manche dans ${duel.secondsLeft} s au plus tard.`}
          </p>
          <TimerBar progress={duel.roundProgress} />
        </div>
      )}

      {phase === "over" && <FinalResult match={match} />}
    </section>
  );
}

function TimerBar({ progress }: { progress: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className={`h-full transition-[width] duration-200 ${progress < 0.25 ? "bg-danger" : "bg-neon"}`} style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

/** Tableau des scores : les deux joueurs, la manche en cours ou le statut. */
function Scoreboard({ match }: { match: VersusMatchDto }) {
  const opp = match.opponent;
  const result = match.result === "me" ? "Victoire !" : match.result === "opponent" ? "Défaite" : match.result === "draw" ? "Égalité" : null;
  return (
    <div className="glass flex items-center justify-between gap-4 p-5">
      <Side name="Toi" avatar={match.me.avatarUrl} display={match.me.displayName} score={match.me.score} flair={match.me.flair} />
      <div className="text-center">
        <p className="text-xs text-muted">{match.game?.name ?? "Tous les jeux"}</p>
        <p className="font-display text-2xl font-bold">{result ?? (match.live ? `Manche ${match.live.round}/${match.rounds}` : "VS")}</p>
        <p className="text-xs text-muted">{match.forfeit ? "Abandon" : VERSUS_STATUS_LABEL[match.status]}</p>
      </div>
      {opp ? (
        <Side id={opp.id} name={opp.displayName} avatar={opp.avatarUrl} display={opp.displayName} score={opp.score} flair={opp.flair} />
      ) : (
        <div className="w-28 text-center text-sm text-muted">?</div>
      )}
    </div>
  );
}

function Side({
  id, name, avatar, display, score, flair,
}: { id?: string; name: string; avatar: string | null; display: string; score: number; flair: FlairDto }) {
  const content = (
    <div className="flex w-28 flex-col items-center gap-1 text-center">
      <Avatar name={display} url={avatar} size={48} frame={flair.frame} />
      <p className="flex max-w-full items-center gap-1 truncate text-sm font-medium">{name}<FlairBadge flair={flair} size={11} /></p>
      {flair.title && <TitleText title={flair.title} className="max-w-full truncate !text-[10px]" />}
      <p className="font-display text-2xl font-bold">{score}</p>
    </div>
  );
  return id ? <PlayerLink id={id}>{content}</PlayerLink> : content;
}

/** Manche en cours : clip, choix du rang et chrono. Le résultat n'est dévoilé qu'à la fin de la manche, pour les deux joueurs. */
function LiveRound({
  clip, secondsLeft, progress, onSubmitted, onClosed,
}: { clip: VersusClip; secondsLeft: number; progress: number; onSubmitted: () => void; onClosed: () => void }) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchedMs = useRef(0);
  const onWatched = useCallback((ms: number) => { watchedMs.current = ms; }, []);

  const submit = async () => {
    if (!rankId) return;
    setPending(true);
    setError(null);
    try {
      await api.guess({ playToken: clip.playToken, rankId, watchedMs: watchedMs.current });
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "ROUND_OVER" || e.code === "ALREADY_ANSWERED")) onClosed();
      setError(errorMessage(e, "Ta réponse n'a pas pu être envoyée, réessaie."));
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="hud-label">Manche {clip.position}/{clip.rounds} · {clip.game.name}</p>
        <p className={`font-display text-2xl font-bold ${secondsLeft <= 5 ? "text-danger" : ""}`} aria-live="polite">{secondsLeft} s</p>
      </div>
      <TimerBar progress={progress} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <ClipPlayer src={media(clip.videoUrl)} poster={clip.posterUrl ? media(clip.posterUrl) : null} onWatched={onWatched} />
        <div className="glass space-y-5 p-6">
          <h2 className="font-display text-2xl font-bold">Quel est son rang&nbsp;?</h2>
          <RankPicker ranks={clip.ranks} value={rankId} onChange={setRankId} disabled={pending} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button onClick={submit} disabled={!rankId || pending} className="btn-primary w-full">{pending ? "Envoi…" : "Valider"}</button>
        </div>
      </div>
    </div>
  );
}

/** Révélation de la manche qui vient de se terminer : rang réel et réponses des deux joueurs. */
function RoundReveal({ round, opponentName }: { round: VersusRoundDto; opponentName: string }) {
  const answer = (a: VersusRoundDto["me"], who: string) => (
    <div className="flex flex-col items-center gap-1 text-center">
      <p className="hud-label">{who}</p>
      {a ? <RankEmblem rank={a.rank} size={48} /> : <div className="grid h-12 w-12 place-items-center text-2xl text-muted">—</div>}
      <p className="text-sm">{a ? a.rank.name : "Pas de réponse"}</p>
      <p className={`font-display text-lg font-bold ${a && a.score > 0 ? "text-success" : "text-muted"}`}>+{a?.score ?? 0}</p>
    </div>
  );
  return (
    <div className="glass grid grid-cols-3 items-center gap-4 p-6">
      {answer(round.me, "Toi")}
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="hud-label">Manche {round.position} · rang réel</p>
        <RankEmblem rank={round.correctRank} size={72} />
        <p className="font-display text-lg font-bold" style={{ color: round.correctRank.color }}>{round.correctRank.name}</p>
      </div>
      {answer(round.opponent, opponentName)}
    </div>
  );
}

/** Fin du duel : résultat et détail manche par manche. */
function FinalResult({ match }: { match: VersusMatchDto }) {
  const opp = match.opponent;
  if (match.status !== "FINISHED") {
    const text = match.status === "DECLINED" ? `${opp?.displayName ?? "Ton ami"} a refusé le duel.` : match.status === "EXPIRED" ? "Personne n'a rejoint ce duel à temps." : "Ce duel a été annulé.";
    return (
      <Panel title={VERSUS_STATUS_LABEL[match.status]} text={text}>
        <Link href="/versus" className="btn-primary mx-auto w-fit">Lancer un autre duel</Link>
      </Panel>
    );
  }
  return (
    <div className="space-y-6">
      {match.forfeit && (
        <p className="text-center text-sm text-muted">
          {match.result === "me" ? `${opp?.displayName} a abandonné.` : "Tu as abandonné ce duel."}
        </p>
      )}
      {match.details.length > 0 && (
        <div className="glass overflow-x-auto p-6">
          <h2 className="mb-3 font-display text-lg font-semibold">Manche par manche</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="py-1 font-normal">#</th><th className="font-normal">Rang réel</th><th className="font-normal">Toi</th><th className="font-normal">{opp?.displayName ?? "Adversaire"}</th></tr>
            </thead>
            <tbody>
              {match.details.map((d) => (
                <tr key={d.position} className="border-t border-line/60">
                  <td className="py-2">{d.position}</td>
                  <td>
                    <span className="flex items-center gap-2 font-semibold" style={{ color: d.correctRank.color }}>
                      <RankEmblem rank={d.correctRank} size={24} /> {d.correctRank.name}
                    </span>
                    <span className="text-xs text-muted">{d.game.name}</span>
                  </td>
                  <td>{d.me ? `${d.me.rank.name} · ${d.me.score} pts` : "—"}</td>
                  <td>{d.opponent ? `${d.opponent.rank.name} · ${d.opponent.score} pts` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-center">
        <Link href="/versus" className="btn-primary">Nouveau duel</Link>
      </div>
    </div>
  );
}
