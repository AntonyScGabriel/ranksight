"use client";

import { useCallback, useEffect, useState } from "react";
import { DAILY_PER_GAME } from "@ranksight/shared";
import { adminFetch, API } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Day = {
  id: string; date: string; slot: number;
  game: { slug: string; name: string };
  clip: { id: string; inGamePseudo: string | null; rank: { name: string } };
  _count: { guesses: number };
};
type Game = { id: string; slug: string; name: string };
type Approved = { id: string; createdAt: string; inGamePseudo: string | null; rank: { name: string } };

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Défis du jour : 3 clips par jeu et par jour. Objectif : au moins 7 jours d'avance pour chaque jeu. */
export default function DailyPlanning() {
  const confirm = useConfirm();
  const [days, setDays] = useState<Day[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [game, setGame] = useState("");
  const [approved, setApproved] = useState<Approved[]>([]);
  const [date, setDate] = useState(todayUtc());
  const [clipId, setClipId] = useState("");
  /** Numéro du défi (0 = première place libre du jour) */
  const [slot, setSlot] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const loadDays = useCallback(() => {
    void adminFetch<Day[]>("/daily").then(setDays);
  }, []);

  useEffect(() => {
    loadDays();
    void fetch(`${API}/games`).then((r) => r.json()).then((g: Game[]) => {
      setGames(g);
      setGame((current) => current || g[0]?.slug || "");
    });
  }, [loadDays]);

  // Clips acceptés jamais passés en défi : un clip planifié pour une journée disparaît de la liste
  const loadApproved = useCallback(() => {
    if (!game) return;
    void adminFetch<{ items: Approved[] }>(`/clips?status=AVAILABLE&game=${game}`).then((r) => setApproved(r.items));
  }, [game]);
  useEffect(loadApproved, [loadApproved]);

  const schedule = async () => {
    try {
      const r = await adminFetch<{ slot: number }>("/daily", { method: "PUT", body: JSON.stringify({ date, clipId, ...(slot ? { slot } : {}) }) });
      setStatus(`Clip ${games.find((g) => g.slug === game)?.name} planifié pour le ${date} (défi n° ${r.slot}).`);
      setClipId("");
      loadDays();
      loadApproved();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  /** Retire le clip du planning (sans le supprimer) : un autre clip sera tiré au sort ce jour-là */
  const unschedule = async (c: Day) => {
    const ok = await confirm({
      title: "Retirer ce clip du planning ?",
      message: `${c.game.name} · ${c.clip.rank.name} : le clip reste disponible, un autre sera tiré au sort pour ce jour.`,
      confirmLabel: "Retirer",
    });
    if (ok === false) return;
    try {
      await adminFetch(`/daily/${c.id}`, { method: "DELETE" });
      setStatus("Clip retiré du planning : il est de nouveau proposé dans la liste.");
    } catch (e) {
      setStatus((e as Error).message);
    }
    loadDays();
    loadApproved();
  };

  /** Supprime le clip : il disparaît du jeu, le défi est remplacé immédiatement */
  const removeClip = async (c: Day) => {
    const ok = await confirm({
      title: "Supprimer ce clip ?",
      message: `${c.game.name} · ${c.clip.rank.name} : le clip est supprimé du jeu et un autre clip le remplace en défi du jour.${c._count.guesses ? ` Les ${c._count.guesses} joueur(s) qui ont déjà répondu gardent leur résultat.` : ""}`,
      confirmLabel: "Supprimer le clip",
      danger: true,
    });
    if (ok === false) return;
    try {
      await adminFetch(`/clips/${c.clip.id}`, { method: "DELETE" });
      setStatus("Clip supprimé : le défi a été remplacé.");
    } catch (e) {
      setStatus((e as Error).message);
    }
    loadDays();
  };

  const dates = [...new Set(days.map((d) => d.date.slice(0, 10)))].sort();
  const cell = (d: string, slug: string) => days.filter((x) => x.date.slice(0, 10) === d && x.game.slug === slug).sort((a, b) => a.slot - b.slot);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Défis du jour</h1>
      <p className="text-sm text-muted">
        {DAILY_PER_GAME} clips par jeu et par jour. Un défi sans planification reçoit automatiquement un clip accepté du jeu, tiré
        au sort (jamais deux fois le même clip le même jour).
      </p>
      <ul className="flex flex-wrap gap-3">
        {games.map((g) => {
          // Jours à venir dont les 3 défis sont prévus
          const future = days.filter((d) => d.game.slug === g.slug && d.date.slice(0, 10) > todayUtc());
          const perDay = new Map<string, number>();
          for (const d of future) perDay.set(d.date.slice(0, 10), (perDay.get(d.date.slice(0, 10)) ?? 0) + 1);
          const ahead = [...perDay.values()].filter((n) => n >= DAILY_PER_GAME).length;
          return (
            <li key={g.slug} className={`glass px-4 py-2 text-sm ${ahead < 7 ? "text-warn" : "text-success"}`}>
              {g.name} : {ahead} jour(s) complet(s) d&apos;avance · {future.length} clip(s) prévu(s)
            </li>
          );
        })}
      </ul>

      <div className="glass flex flex-wrap gap-3 p-4">
        <select value={game} onChange={(e) => { setGame(e.target.value); setClipId(""); }} className="rounded-lg border border-line bg-surface p-2 text-sm">
          {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </select>
        <input type="date" value={date} min={todayUtc()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-surface p-2" />
        <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="Numéro du défi" className="rounded-lg border border-line bg-surface p-2 text-sm">
          <option value={0}>Première place libre</option>
          {Array.from({ length: DAILY_PER_GAME }, (_, i) => <option key={i + 1} value={i + 1}>Défi n° {i + 1}</option>)}
        </select>
        <select value={clipId} onChange={(e) => setClipId(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface p-2 text-sm">
          <option value="">Choisir un clip accepté</option>
          {approved.map((c) => (
            <option key={c.id} value={c.id}>{c.rank.name} · {c.inGamePseudo ?? "sans pseudo"} · {c.id.slice(0, 8)}</option>
          ))}
        </select>
        <button onClick={schedule} disabled={!date || !clipId} className="btn-primary !py-2">Planifier</button>
      </div>
      {game && approved.length === 0 && <p className="text-sm text-muted">Aucun clip accepté et pas encore passé en défi pour ce jeu.</p>}
      {status && <p className="text-sm">{status}</p>}
      <p className="text-xs text-muted">
        Les défis changent à minuit UTC (2 h du matin à Paris en été). Un défi auquel des joueurs ont déjà répondu ne peut plus être
        replanifié ; pour le changer quand même, supprime son clip : un autre clip le remplace aussitôt et les joueurs qui ont déjà
        répondu gardent leur résultat.
      </p>

      <div className="glass overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="p-3 font-normal">Jour</th>
              {games.map((g) => <th key={g.slug} className="p-3 font-normal">{g.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-line/60">
                <td className="p-3 whitespace-nowrap">{new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</td>
                {games.map((g) => {
                  const list = cell(d, g.slug);
                  return (
                    <td key={g.slug} className="p-3 align-top">
                      <ol className="space-y-2">
                        {Array.from({ length: DAILY_PER_GAME }, (_, i) => {
                          const c = list.find((x) => x.slot === i + 1);
                          return (
                            <li key={i} className="text-xs">
                              <span className="text-muted">{i + 1}. </span>
                              {c ? (
                                <>
                                  <span className="font-medium text-ink">{c.clip.rank.name}</span>
                                  <span className="text-muted"> · {c.clip.inGamePseudo ?? "—"} · {c._count.guesses} rép.</span>
                                  {d >= todayUtc() && (
                                    <span className="ml-2 inline-flex gap-2">
                                      {c._count.guesses === 0 && (
                                        <button onClick={() => unschedule(c)} className="text-muted hover:text-ink">Retirer</button>
                                      )}
                                      <button onClick={() => removeClip(c)} className="text-muted hover:text-danger">Supprimer</button>
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-muted">Tirage au sort</span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </td>
                  );
                })}
              </tr>
            ))}
            {dates.length === 0 && (
              <tr><td colSpan={games.length + 1} className="p-6 text-center text-muted">Aucun défi planifié.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
