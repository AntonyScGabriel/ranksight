"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GAME_NAMES, GAME_SLUGS, ROOM_MODES, ROOM_MODE_LABEL, type GameSlug, type RoomMode } from "@ranksight/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/components/AuthForm";

/** Attente : nouvelle recherche toutes les 5 secondes, pendant 2 minutes au plus */
const WAIT_EVERY_MS = 5_000;
const WAIT_MAX_MS = 120_000;

/**
 * « Jouer maintenant » : rejoint aussitôt un salon public compatible (même jeu, même mode). Sans salon ouvert, le joueur
 * choisit de créer un salon public ou de patienter. Partie personnalisée : aucun point de classement.
 */
export function QuickPlay({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [mode, setMode] = useState<RoomMode>("CLASSIC");
  const [state, setState] = useState<"idle" | "searching" | "none" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingSince = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const attempt = async (create: boolean) => {
    setError(null);
    try {
      const r = await api.quickPlay(game, mode, create);
      if (r.room) {
        router.push(`/rooms/${r.room.id}`);
        return true;
      }
      return false;
    } catch (e) {
      setError(errorMessage(e, "Impossible de trouver une partie pour le moment."));
      setState("idle");
      return true;
    }
  };

  const search = async () => {
    if (state === "searching") return;
    setState("searching");
    if (!(await attempt(false))) setState("none");
  };

  const wait = () => {
    setState("waiting");
    waitingSince.current = Date.now();
    const poll = async () => {
      if (await attempt(false)) return;
      if (Date.now() - waitingSince.current >= WAIT_MAX_MS) {
        setState("none");
        setError("Toujours personne sur ce jeu et ce mode. Crée un salon public : les prochains joueurs te rejoindront.");
        return;
      }
      timer.current = setTimeout(poll, WAIT_EVERY_MS);
    };
    timer.current = setTimeout(poll, WAIT_EVERY_MS);
  };

  const stopWaiting = () => {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
  };

  const create = async () => {
    stopWaiting();
    setState("searching");
    await attempt(true);
  };

  return (
    <div className="glass space-y-4 p-6">
      <div>
        <h2 className="font-display text-xl font-semibold">Jouer maintenant</h2>
        <p className="text-sm text-muted">
          Rejoins tout de suite une partie publique. Partie personnalisée : de l&apos;XP, mais aucun point de classement
          {compact ? "." : " (seuls les duels au hasard comptent pour le classement)."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="hud-label">Jeu</span>
          <select value={game} disabled={state === "searching" || state === "waiting"} onChange={(e) => { setGame(e.target.value as GameSlug); setState("idle"); }} className="input">
            {GAME_SLUGS.map((s) => <option key={s} value={s}>{GAME_NAMES[s]}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Mode</span>
          <select value={mode} disabled={state === "searching" || state === "waiting"} onChange={(e) => { setMode(e.target.value as RoomMode); setState("idle"); }} className="input">
            {ROOM_MODES.map((m) => <option key={m} value={m}>{ROOM_MODE_LABEL[m]}</option>)}
          </select>
        </label>
      </div>
      {state === "none" ? (
        <div className="space-y-3 rounded-xl border border-line/60 p-4 text-sm">
          <p>Aucun salon public ouvert sur {GAME_NAMES[game]} en mode « {ROOM_MODE_LABEL[mode]} » pour l&apos;instant.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={create} className="btn-primary !py-2">Créer un salon public</button>
            <button onClick={wait} className="btn-ghost">Patienter</button>
          </div>
        </div>
      ) : state === "waiting" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neon/40 p-4 text-sm" aria-live="polite">
          <p>Recherche d&apos;un salon… tu rejoindras le premier qui s&apos;ouvre.</p>
          <div className="flex gap-2">
            <button onClick={create} className="btn-ghost">Créer plutôt</button>
            <button onClick={stopWaiting} className="btn-ghost">Arrêter</button>
          </div>
        </div>
      ) : (
        <button onClick={search} disabled={state === "searching"} className="btn-primary w-full sm:w-auto">
          {state === "searching" ? "Recherche…" : "Jouer maintenant"}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
