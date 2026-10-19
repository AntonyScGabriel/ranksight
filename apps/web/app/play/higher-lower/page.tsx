"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  GAME_NAMES, GAME_SLUGS, HIGHER_LOWER_RULES, type GameSlug, type HigherLowerAnswerDto, type HigherLowerChoice,
  type HigherLowerOverviewDto, type HigherLowerRunDto,
} from "@ranksight/shared";
import { api, media } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthForm";
import { ClipPlayer } from "@/components/ClipPlayer";
import { RankEmblem } from "@/components/RankEmblem";
import { LoginRequired, Skeleton } from "@/components/States";
import { VipBadge } from "@/components/VipBadge";

const noop = () => undefined;

/** Plus haut / Plus bas : rang du clip suivant plus haut ou plus bas que celui du clip affiché. */
export default function HigherLowerPage() {
  const { me, loading } = useSession();
  const [overview, setOverview] = useState<HigherLowerOverviewDto | null>(null);
  const [run, setRun] = useState<HigherLowerRunDto | null>(null);
  const [last, setLast] = useState<HigherLowerAnswerDto | null>(null);
  const [game, setGame] = useState<GameSlug>("valorant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.higherLower().then((o) => {
      setOverview(o);
      setRun((current) => current ?? o.active);
    }, () => setError("Impossible de charger le mode pour le moment."));
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setLast(null);
    try {
      setRun(await api.startHigherLower(game));
      load();
    } catch (e) {
      setError(errorMessage(e, "La série n'a pas pu démarrer."));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: HigherLowerChoice) => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.answerHigherLower(run.id, run.round, choice);
      setLast(r);
      if (!r.correct || r.run.status === "ENDED") load();
    } catch (e) {
      setError(errorMessage(e, "Ta réponse n'a pas pu être envoyée."));
      api.higherLowerRun(run.id).then(setRun, noop);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton />;
  if (!me) return <LoginRequired next="/play/higher-lower" />;
  if (!overview) return error ? <p className="text-center text-danger">{error}</p> : <Skeleton />;

  // Mode VIP : le serveur refuse le lancement sans VIP (une série déjà lancée se termine) ; l'écran l'explique et propose l'offre
  const canStart = overview.vip;
  const shown = last ? last.run : run;
  // Après une bonne réponse, le joueur voit d'abord le rang dévoilé, puis passe au clip suivant
  const revealing = !!last && last.correct && last.run.status === "ACTIVE";

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-display text-3xl font-bold">Plus haut / Plus bas <VipBadge /></h1>
          <p className="text-sm text-muted">Le rang du clip suivant est-il plus haut ou plus bas ? Une erreur termine la série.</p>
        </div>
        <div className="glass flex gap-6 px-5 py-3 text-center">
          <div><p className="font-display text-xl font-bold text-neon">{shown && shown.status === "ACTIVE" ? shown.score : "—"}</p><p className="hud-label">Série</p></div>
          <div><p className="font-display text-xl font-bold">{Math.max(overview.best, shown?.best ?? 0)}</p><p className="hud-label">Record</p></div>
        </div>
      </header>
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}

      {shown && (shown.status === "ACTIVE" || last) ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="glass space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="hud-label">{revealing ? "Clip précédent" : "Clip de référence"}</p>
                <span className="flex items-center gap-2 font-display font-bold" style={{ color: (revealing ? last.revealed : shown.current.rank).color }}>
                  {revealing ? null : <RankEmblem rank={shown.current.rank} size={28} />}
                  {revealing ? "" : shown.current.rank.name}
                </span>
              </div>
              {!revealing && <ClipPlayer key={shown.current.id} src={media(shown.current.videoUrl)} poster={shown.current.posterUrl ? media(shown.current.posterUrl) : null} onWatched={noop} kind={shown.current.videoKind} durationSec={shown.current.durationSec} />}
              {revealing && (
                <div className="grid place-items-center gap-2 py-10 text-center">
                  <RankEmblem rank={last.revealed} size={72} />
                  <p className="font-display text-2xl font-bold text-success">Bonne réponse !</p>
                  <p className="text-sm text-muted">Le clip était <strong style={{ color: last.revealed.color }}>{last.revealed.name}</strong>.{last.record ? " Nouveau record !" : ""}</p>
                </div>
              )}
            </div>
            <div className="glass space-y-3 p-4">
              <p className="hud-label">{revealing ? "Il devient le clip de référence" : last && !last.correct ? "Clip comparé" : "Clip à comparer"}</p>
              {revealing ? (
                <div className="grid place-items-center gap-3 py-10">
                  <button onClick={() => { setRun(last.run); setLast(null); }} className="btn-primary">Clip suivant</button>
                </div>
              ) : last && !last.correct ? (
                <div className="grid place-items-center gap-2 py-10 text-center">
                  <RankEmblem rank={last.revealed} size={72} />
                  <p className="font-display text-2xl font-bold text-danger">Perdu</p>
                  <p className="text-sm text-muted">Le clip était <strong style={{ color: last.revealed.color }}>{last.revealed.name}</strong>. Série terminée : {last.run.score} bonne{last.run.score > 1 ? "s" : ""} réponse{last.run.score > 1 ? "s" : ""}.</p>
                </div>
              ) : shown.next ? (
                <>
                  <ClipPlayer key={shown.next.id} src={media(shown.next.videoUrl)} poster={shown.next.posterUrl ? media(shown.next.posterUrl) : null} onWatched={noop} kind={shown.next.videoKind} durationSec={shown.next.durationSec} />
                  <div className="grid grid-cols-2 gap-3">
                    <button disabled={busy} onClick={() => answer("higher")} className="btn-primary">▲ Plus haut</button>
                    <button disabled={busy} onClick={() => answer("lower")} className="btn-ghost">▼ Plus bas</button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          {last && last.run.status === "ENDED" && <NewRun game={game} setGame={setGame} canStart={canStart} busy={busy} start={start} />}
        </div>
      ) : (
        <NewRun game={game} setGame={setGame} canStart={canStart} busy={busy} start={start} />
      )}

      <div className="glass space-y-2 p-6">
        <h2 className="font-display text-lg font-semibold">Règles</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{HIGHER_LOWER_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>

      {overview.recent.length > 0 && (
        <div className="space-y-2">
          <h2 className="hud-label">Dernières séries</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {overview.recent.map((r) => (
              <li key={r.id} className="glass flex items-center justify-between p-3 text-sm">
                <span>{r.game} · {new Date(r.startedAt).toLocaleDateString("fr-FR")}</span>
                <span className="font-display font-bold">{r.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NewRun({
  game, setGame, canStart, busy, start,
}: { game: GameSlug; setGame: (g: GameSlug) => void; canStart: boolean; busy: boolean; start: () => void }) {
  return (
    <div className="glass space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold">Nouvelle série</h2>
        <select value={game} onChange={(e) => setGame(e.target.value as GameSlug)} aria-label="Jeu" className="input !w-auto">
          {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
        </select>
      </div>
      {canStart ? (
        <button disabled={busy} onClick={start} className="btn-primary">Commencer</button>
      ) : (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p>
            Plus haut / Plus bas est un mode VIP, sans limite de séries. Deviner le rang, le mode Infini, les salons publics et les
            duels classés restent gratuits. Le VIP n&apos;apporte aucun point au classement compétitif.
          </p>
          <Link href="/shop" className="btn-primary mt-3 inline-flex !py-2 text-sm">Devenir VIP <VipBadge className="ml-2" /></Link>
        </div>
      )}
    </div>
  );
}
