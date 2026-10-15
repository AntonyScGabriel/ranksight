
import { useCallback, useEffect, useRef, useState } from "react";
import { VERSUS_HEARTBEAT_SEC, type VersusMatchDto } from "@ranksight/shared";
import type { LiveClip } from "@/components/LiveRound";
import { api } from "./api";
import { useChat } from "./chat";

export type VersusClip = LiveClip;
export type DuelPhase = "waiting" | "invited" | "countdown" | "playing" | "answered" | "timeout" | "over";

/**
 * État d'un duel en direct, partagé par l'écran de jeu :
 * horloge recalée sur celle du serveur, mises à jour en temps réel (Socket.IO), signal de présence pendant l'attente
 * et récupération automatique du clip au début de chaque manche.
 */
export function useLiveDuel(id: string, enabled: boolean) {
  const { onVersus } = useChat();
  const [match, setMatch] = useState<VersusMatchDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [clip, setClip] = useState<VersusClip | null>(null);
  const [submittedRound, setSubmittedRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const fetching = useRef(0);

  const apply = useCallback((m: VersusMatchDto) => {
    if (m.live) offset.current = new Date(m.live.serverNow).getTime() - Date.now();
    setMatch(m);
  }, []);

  const load = useCallback(() => {
    api.versus(id).then(apply, () => setMissing(true));
  }, [id, apply]);

  useEffect(() => {
    if (!enabled) return;
    load();
    return onVersus((e) => e.id === id && load());
  }, [enabled, id, load, onVersus]);

  // Horloge locale recalée sur le serveur
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, []);

  // Recherche ou invitation : signal de présence tant que la page est ouverte
  const waiting = !!match && match.isCreator && (match.status === "OPEN" || match.status === "PENDING");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void api.versusWait(id).then(apply, () => undefined), VERSUS_HEARTBEAT_SEC * 1000);
    return () => clearInterval(t);
  }, [waiting, id, apply]);

  const live = match?.status === "ACTIVE" ? match.live : null;
  const startsAt = live ? new Date(live.startsAt).getTime() : 0;
  const endsAt = live ? new Date(live.endsAt).getTime() : 0;
  const answered = !!live && (live.answered || submittedRound === live.round);

  let phase: DuelPhase = "over";
  if (match?.status === "OPEN" || (match?.status === "PENDING" && match.isCreator)) phase = "waiting";
  else if (match?.status === "PENDING") phase = "invited";
  else if (live) phase = now < startsAt ? "countdown" : answered ? "answered" : now < endsAt ? "playing" : "timeout";

  // Début de manche : récupération du clip (une fois par manche)
  const round = live?.round ?? 0;
  useEffect(() => {
    if (phase !== "playing" || clip?.position === round || fetching.current === round) return;
    fetching.current = round;
    api.versusNext(id).then(setClip, () => {
      fetching.current = 0;
      load();
    });
  }, [phase, round, clip, id, load]);

  // Filet de sécurité : si la fin de manche n'arrive pas en direct (connexion coupée), on recharge
  const stalled = phase === "timeout" && now > endsAt + 4000;
  useEffect(() => {
    if (!stalled) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [stalled, load]);

  return {
    match, missing, phase, now, load, apply,
    clip: clip && clip.position === round ? clip : null,
    secondsLeft: Math.max(0, Math.ceil(((phase === "countdown" ? startsAt : endsAt) - now) / 1000)),
    roundProgress: live ? Math.min(1, Math.max(0, (endsAt - now) / (endsAt - startsAt))) : 0,
    markSubmitted: (r: number) => setSubmittedRound(r),
  };
}
