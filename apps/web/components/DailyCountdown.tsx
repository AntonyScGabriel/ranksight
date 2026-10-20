"use client";

import { useEffect, useRef, useState } from "react";
import { formatCountdown, nextDailyReset } from "@ranksight/shared";

/**
 * Temps restant avant les prochains défis du jour (minuit UTC), avec l'heure locale du changement. À zéro, `onReset`
 * recharge les défis.
 */
export function DailyCountdown({ onReset }: { onReset?: () => void }) {
  const [state, setState] = useState<{ left: number; at: string } | null>(null);
  const reset = useRef(onReset);
  useEffect(() => {
    reset.current = onReset;
  }, [onReset]);

  useEffect(() => {
    let target = nextDailyReset();
    const at = (t: number) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const tick = () => {
      const now = Date.now();
      if (now >= target) {
        target = nextDailyReset(now);
        // Laisse au serveur une seconde pour passer au nouveau jour
        window.setTimeout(() => reset.current?.(), 1500);
      }
      setState({ left: target - now, at: at(target) });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!state) return null;
  return (
    <p className="text-sm text-muted" data-testid="daily-countdown">
      Prochains défis dans <span className="font-mono font-semibold text-ink tabular-nums">{formatCountdown(state.left)}</span>
      <span className="text-xs"> (à {state.at}, heure locale)</span>
    </p>
  );
}
