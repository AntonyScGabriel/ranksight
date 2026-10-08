"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch, API } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";

type Day = {
  id: string; date: string;
  game: { slug: string; name: string };
  clip: { id: string; inGamePseudo: string | null; rank: { name: string } };
  _count: { guesses: number };
};
type Game = { id: string; slug: string; name: string };
type Approved = { id: string; createdAt: string; inGamePseudo: string | null; rank: { name: string } };

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Défis du jour : un clip par jeu et par jour. Objectif : au moins 7 jours d'avance pour chaque jeu. */
export default function DailyPlanning() {
  const confirm = useConfirm();
  const [days, setDays] = useState<Day[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [game, setGame] = useState("");
  const [approved, setApproved] = useState<Approved[]>([]);
  const [date, setDate] = useState(todayUtc());
  const [clipId, setClipId] = useState("");
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

  useEffect(() => {
    if (!game) return;
    void adminFetch<{ items: Approved[] }>(`/clips?status=APPROVED&game=${game}`).then((r) => setApproved(r.items));
  }, [game]);

  const schedule = async () => {
    try {
      await adminFetch("/daily", { method: "PUT", body: JSON.stringify({ date, clipId }) });
      setStatus(`Clip ${games.find((g) => g.slug === game)?.name} planifié pour le ${date}.`);
      setClipId("");
      loadDays();
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
      setStatus("Clip retiré du planning.");
    } catch (e) {
      setStatus((e as Error).message);
    }
    loadDays();
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
  const cell = (d: string, slug: string) => days.find((x) => x.date.slice(0, 10) === d && x.game.slug === slug);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Défis du jour</h1>
      <p className="text-sm text-muted">Un clip par jeu et par jour. Un jour sans planification reçoit automatiquement un clip accepté du jeu, tiré au sort.</p>
      <ul className="flex flex-wrap gap-3">
        {games.map((g) => {
          const ahead = days.filter((d) => d.game.slug === g.slug && d.date.slice(0, 10) > todayUtc()).length;
          return (
            <li key={g.slug} className={`glass px-4 py-2 text-sm ${ahead < 7 ? "text-warn" : "text-success"}`}>
              {g.name} : {ahead} jour(s) d&apos;avance
            </li>
          );
        })}
      </ul>

      <div className="glass flex flex-wrap gap-3 p-4">
        <select value={game} onChange={(e) => { setGame(e.target.value); setClipId(""); }} className="rounded-lg border border-line bg-surface p-2 text-sm">
          {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </select>
        <input type="date" value={date} min={todayUtc()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-surface p-2" />
        <select value={clipId} onChange={(e) => setClipId(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface p-2 text-sm">
          <option value="">Choisir un clip accepté</option>
          {approved.map((c) => (
            <option key={c.id} value={c.id}>{c.rank.name} · {c.inGamePseudo ?? "sans pseudo"} · {c.id.slice(0, 8)}</option>
          ))}
        </select>
        <button onClick={schedule} disabled={!date || !clipId} className="btn-primary !py-2">Planifier</button>
      </div>
      {game && approved.length === 0 && <p className="text-sm text-muted">Aucun clip accepté pour ce jeu pour le moment.</p>}
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
                  const c = cell(d, g.slug);
                  return (
                    <td key={g.slug} className="p-3">
                      {c ? (
                        <>
                          <p className="font-medium">{c.clip.rank.name}</p>
                          <p className="text-xs text-muted">{c.clip.inGamePseudo ?? "—"} · {c._count.guesses} réponse(s)</p>
                          {d >= todayUtc() && (
                            <p className="mt-1 flex gap-2 text-xs">
                              {c._count.guesses === 0 && (
                                <button onClick={() => unschedule(c)} className="text-muted hover:text-ink">Retirer</button>
                              )}
                              <button onClick={() => removeClip(c)} className="text-muted hover:text-danger">Supprimer le clip</button>
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">Tirage au sort</span>
                      )}
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
