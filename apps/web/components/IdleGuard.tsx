"use client";

import { useEffect, useRef, useState } from "react";
import { ROOM_IDLE_KICK_SEC, roomIdleState, type RoomIdleState } from "@ranksight/shared";

const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Salle d'attente : après quelques minutes sans aucun geste sur la page, demande « Tu es toujours là ? ». Sans réponse
 * dans les 30 secondes, `onIdle` fait quitter le salon (un hôte absent ne bloque plus le lancement).
 */
/**
 * `onActive` : signale les gestes au serveur (au plus toutes les 20 s), qui retire aussi les joueurs inactifs.
 * `onAway` : l'écran du salon est quitté (autre page) ; le serveur cesse alors de surveiller l'inactivité.
 */
export function IdleGuard({ onIdle, onActive, onAway }: { onIdle: () => void; onActive?: () => void; onAway?: () => void }) {
  const away = useRef(onAway);
  useEffect(() => {
    away.current = onAway;
  }, [onAway]);
  useEffect(() => () => away.current?.(), []);
  const last = useRef(0);
  const lastPing = useRef(0);
  const fired = useRef(false);
  const [state, setState] = useState<RoomIdleState>({ phase: "active" });

  useEffect(() => {
    last.current = Date.now();
    const ping = () => {
      if (Date.now() - lastPing.current < 20_000) return;
      lastPing.current = Date.now();
      onActive?.();
    };
    ping();
    // Un geste ne compte plus une fois l'alerte affichée : il faut cliquer sur « Je suis là »
    const touch = () => {
      if (roomIdleState(last.current, Date.now()).phase !== "active") return;
      last.current = Date.now();
      ping();
    };
    for (const e of ACTIVITY) window.addEventListener(e, touch, { passive: true });
    const id = window.setInterval(() => {
      const s = roomIdleState(last.current, Date.now());
      setState(s);
      if (s.phase === "kick" && !fired.current) {
        fired.current = true;
        onIdle();
      }
    }, 1000);
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch);
      window.clearInterval(id);
    };
  }, [onIdle, onActive]);

  if (state.phase !== "warning") return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" data-testid="idle-warning" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-sm space-y-4 p-6 text-center">
        <h2 id="idle-title" className="font-display text-xl font-bold">Tu es toujours là ?</h2>
        <p className="text-sm text-muted">
          Sans réponse, tu quitteras le salon dans <strong className="text-warn">{state.secondsLeft} s</strong> pour laisser la place aux autres joueurs.
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-warn transition-[width]" style={{ width: `${(state.secondsLeft / ROOM_IDLE_KICK_SEC) * 100}%` }} />
        </div>
        <button
          autoFocus
          onClick={() => {
            last.current = Date.now();
            lastPing.current = Date.now();
            onActive?.();
            setState({ phase: "active" });
          }}
          className="btn-primary w-full"
        >
          Je suis là
        </button>
      </div>
    </div>
  );
}
