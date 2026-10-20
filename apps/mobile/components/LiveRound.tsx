import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";
import { api, ApiError, media } from "@/lib/api";
import { colors, font, radius } from "@/lib/theme";
import type { PlayableClipDto } from "@ranksight/shared";

/** Clip d'une manche en direct (duel ou salon) : position, nombre de manches et fin du chrono (dates du serveur) */
export type LiveClip = PlayableClipDto & { position: number; rounds: number; endsAt: string; serverNow: string };
import { errorMessage } from "./AuthUi";
import { RankEmblem } from "./RankEmblem";
import { Card, PrimaryButton } from "./ui";
import { LinkClipView } from "./LinkClipView";

function applySound(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

/** Barre du chrono d'une manche en direct (rouge dans les 25 derniers pourcents). */
export function TimerBar({ progress }: { progress: number }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" }}>
      <View style={{ width: `${progress * 100}%`, height: 6, backgroundColor: progress < 0.25 ? colors.danger : colors.neon }} />
    </View>
  );
}

/** Manche en direct (duel ou salon) : clip (avec le son), choix du rang, chrono. Le résultat est dévoilé à la fin de la manche. */
export function LiveRound({
  clip, secondsLeft, progress, onSubmitted, onClosed, label,
}: {
  clip: LiveClip; secondsLeft: number; progress: number; onSubmitted: () => void; onClosed: () => void; label?: string;
}) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const shownAt = useRef(0);

  // Clip proposé par un lien : lecteur intégré YouTube / Medal (WebView) au lieu du lecteur natif
  const linked = clip.videoKind !== "FILE";
  const player = useVideoPlayer(linked ? null : media(clip.videoUrl), (p) => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
    p.play();
  });
  useEffect(() => applySound(player, muted), [player, muted]);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [clip.id]);

  const submit = async () => {
    if (!rankId || pending) return;
    setPending(true);
    setError(null);
    try {
      const watchedMs = Math.min(Date.now() - shownAt.current, 120_000);
      await api.liveGuess({ playToken: clip.playToken, rankId, watchedMs });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "ROUND_OVER" || e.code === "ALREADY_ANSWERED")) onClosed();
      setError(errorMessage(e, "Ta réponse n'a pas pu être envoyée, réessaie."));
      setPending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={font.hud}>{label ?? `Manche ${clip.position}/${clip.rounds}`} · {clip.game.name}</Text>
        <Text style={{ color: secondsLeft <= 5 ? colors.danger : colors.ink, fontSize: 22, ...font.display }}>{secondsLeft} s</Text>
      </View>
      <TimerBar progress={progress} />
      <View style={styles.video}>
        {linked ? <LinkClipView url={clip.videoUrl} /> : <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture={false} />}
        {!linked && <Pressable
          onPress={() => setMuted((m) => !m)}
          style={styles.sound}
          accessibilityRole="button"
          accessibilityLabel={muted ? "Activer le son" : "Couper le son"}
          hitSlop={8}
        >
          <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{muted ? "🔇 Son coupé" : "🔊 Son"}</Text>
        </Pressable>}
      </View>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 20, ...font.display }}>Quel est son rang ?</Text>
        <View style={styles.grid}>
          {clip.ranks.map((r) => {
            const active = r.id === rankId;
            return (
              <Pressable
                key={r.id}
                disabled={pending}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setRankId(r.id);
                }}
                style={[styles.chip, active && { borderColor: r.color, backgroundColor: `${r.color}26` }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
                <RankEmblem rank={r} size={34} />
                <Text style={styles.chipText} numberOfLines={1}>{r.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <PrimaryButton label={pending ? "Envoi…" : "Valider"} onPress={submit} disabled={!rankId || pending} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  video: { aspectRatio: 16 / 9, borderRadius: radius.card, overflow: "hidden", backgroundColor: "black", borderWidth: 1, borderColor: colors.line },
  sound: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { width: "31.5%", borderRadius: radius.chip, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface2, padding: 10, gap: 6, alignItems: "center" },
  chipText: { color: colors.ink, fontWeight: "600", fontSize: 13 },
});
