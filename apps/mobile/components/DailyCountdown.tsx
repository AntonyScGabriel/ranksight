import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { formatCountdown, nextDailyReset } from "@ranksight/shared";
import { colors } from "@/lib/theme";

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
        setTimeout(() => reset.current?.(), 1500);
      }
      setState({ left: target - now, at: at(target) });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) return null;
  return (
    <Text style={{ color: colors.muted }} testID="daily-countdown">
      Prochains défis dans{" "}
      <Text style={{ color: colors.ink, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatCountdown(state.left)}</Text>
      <Text style={{ fontSize: 12 }}> (à {state.at})</Text>
    </Text>
  );
}
