import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Text, View } from "react-native";
import { ROOM_IDLE_KICK_SEC, roomIdleState, type RoomIdleState } from "@ranksight/shared";
import { colors } from "@/lib/theme";
import { Card, PrimaryButton } from "./ui";

/**
 * Salle d'attente : après quelques minutes sans toucher l'écran (application en arrière-plan comprise), demande
 * « Tu es toujours là ? ». Sans réponse dans les 30 secondes, `onIdle` fait quitter le salon. `touch` est à brancher sur
 * les touchers de l'écran (onTouchStart, qui remonte depuis les éléments touchés).
 */
export function useIdleGuard(enabled: boolean, onIdle: () => void, onActive?: () => void, onAway?: () => void) {
  // Écran du salon quitté (ou surveillance arrêtée) : le serveur cesse de surveiller l'inactivité
  const away = useRef(onAway);
  useEffect(() => {
    away.current = onAway;
  }, [onAway]);
  useEffect(() => {
    if (enabled) return () => away.current?.();
  }, [enabled]);
  const last = useRef(0);
  const lastPing = useRef(0);
  // Gestes signalés au serveur (au plus toutes les 20 s), qui retire aussi les joueurs inactifs
  const ping = useCallback(() => {
    if (Date.now() - lastPing.current < 20_000) return;
    lastPing.current = Date.now();
    onActive?.();
  }, [onActive]);
  const fired = useRef(false);
  const [state, setState] = useState<RoomIdleState>({ phase: "active" });

  useEffect(() => {
    if (!enabled) return;
    last.current = Date.now();
    lastPing.current = 0;
    ping();
    fired.current = false;
    const id = setInterval(() => {
      const s = roomIdleState(last.current, Date.now());
      setState(s);
      if (s.phase === "kick" && !fired.current) {
        fired.current = true;
        onIdle();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, onIdle, ping]);

  // Un toucher ne compte plus une fois l'alerte affichée : il faut répondre « Je suis là »
  const touch = useCallback(() => {
    if (roomIdleState(last.current, Date.now()).phase !== "active") return;
    last.current = Date.now();
    ping();
  }, [ping]);
  const stillHere = useCallback(() => {
    last.current = Date.now();
    lastPing.current = 0;
    ping();
    setState({ phase: "active" });
  }, [ping]);
  return { warning: enabled && state.phase === "warning" ? state.secondsLeft : null, touch, stillHere };
}

export function IdleWarning({ secondsLeft, onStay }: { secondsLeft: number | null; onStay: () => void }) {
  return (
    <Modal visible={secondsLeft !== null} transparent animationType="fade" onRequestClose={onStay}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 24 }}>
        <Card style={{ gap: 12 }} testID="idle-warning">
          <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }}>Tu es toujours là ?</Text>
          <Text style={{ color: colors.muted, textAlign: "center" }}>
            Sans réponse, tu quitteras le salon dans <Text style={{ color: colors.warn, fontWeight: "700" }}>{secondsLeft ?? 0} s</Text> pour laisser la place aux autres joueurs.
          </Text>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" }}>
            <View style={{ width: `${((secondsLeft ?? 0) / ROOM_IDLE_KICK_SEC) * 100}%`, height: 6, backgroundColor: colors.warn }} />
          </View>
          <PrimaryButton label="Je suis là" onPress={onStay} />
        </Card>
      </View>
    </Modal>
  );
}
