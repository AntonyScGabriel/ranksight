"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomDto } from "@ranksight/shared";
import type { LiveClip } from "@/components/LiveRound";
import { api, ApiError } from "./api";
import { useChat } from "./chat";

export type RoomPhase = "lobby" | "countdown" | "playing" | "answered" | "timeout" | "left" | "over";

/**
 * État d'un salon en direct : horloge recalée sur celle du serveur, mises à jour en temps réel (Socket.IO),
 * récupération du clip au début de chaque manche et rechargement automatique après une coupure de connexion.
 */
export function useLiveRoom(id: string, enabled: boolean) {
  const { onRoom } = useChat();
  const [room, setRoom] = useState<RoomDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [clip, setClip] = useState<LiveClip | null>(null);
  const [submittedRound, setSubmittedRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const fetching = useRef(0);

  const apply = useCallback((r: RoomDto) => {
    if (r.live) offset.current = new Date(r.live.serverNow).getTime() - Date.now();
    setOffline(false);
    setRoom(r);
  }, []);

  const load = useCallback(() => {
    api.room(id).then(apply, (e) => {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setOffline(true);
    });
  }, [id, apply]);

  useEffect(() => {
    if (!enabled) return;
    load();
    // Retour sur l'onglet ou reconnexion : l'état est relu sur le serveur
    const refresh = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", load);
    const off = onRoom((e) => e.id === id && load());
    return () => {
      off();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", load);
    };
  }, [enabled, id, load, onRoom]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => window.clearInterval(t);
  }, []);

  const live = room?.status === "ACTIVE" ? room.live : null;
  const startsAt = live ? new Date(live.startsAt).getTime() : 0;
  const endsAt = live ? new Date(live.endsAt).getTime() : 0;
  const answered = !!live && (live.answered || submittedRound === live.round);

  let phase: RoomPhase = "over";
  if (room?.status === "LOBBY") phase = "lobby";
  else if (room?.status === "ACTIVE" && room.left) phase = "left";
  else if (live) phase = now < startsAt ? "countdown" : answered ? "answered" : now < endsAt ? "playing" : "timeout";

  // Début de manche : récupération du clip (une fois par manche)
  const round = live?.round ?? 0;
  useEffect(() => {
    if (phase !== "playing" || clip?.position === round || fetching.current === round) return;
    fetching.current = round;
    api.roomNext(id).then(setClip, () => {
      fetching.current = 0;
      load();
    });
  }, [phase, round, clip, id, load]);

  // Filet de sécurité : fin de manche non reçue en direct (connexion coupée) → rechargement régulier
  const stalled = (phase === "timeout" && now > endsAt + 4000) || offline;
  useEffect(() => {
    if (!stalled) return;
    const t = window.setInterval(load, 2000);
    return () => window.clearInterval(t);
  }, [stalled, load]);

  return {
    room, missing, offline, phase, load, apply,
    clip: clip && clip.position === round ? clip : null,
    secondsLeft: Math.max(0, Math.ceil(((phase === "countdown" ? startsAt : endsAt) - now) / 1000)),
    roundProgress: live ? Math.min(1, Math.max(0, (endsAt - now) / (endsAt - startsAt))) : 0,
    markSubmitted: (r: number) => setSubmittedRound(r),
  };
}
