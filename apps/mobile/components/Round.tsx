import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import {
  PLATFORM_LABEL, REGION_LABEL, scoreTable, type GuessResultDto, type Platform, type PlayableClipDto, type Region,
} from "@ranksight/shared";
import { api, ApiError, media } from "@/lib/api";
import { colors, font, radius } from "@/lib/theme";
import { Card, Hud, PrimaryButton } from "./ui";
import { RankEmblem } from "./RankEmblem";
import { CosmeticVisual } from "./Flair";
import { errorMessage } from "./AuthUi";

export type RoundResult = GuessResultDto & { run?: { lives: number; score: number; endedAt: string | null } };

/** Coupe ou rétablit le son du lecteur natif. */
function applySound(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}

const VERDICT = ["PILE DESSUS", "PROCHE", "À CÔTÉ"];

/** Une manche : clip, choix du rang, résultat. */
export function Round({
  clip, onResult, onNext, nextLabel = "Clip suivant",
}: { clip: PlayableClipDto; onResult?: (r: RoundResult) => void; onNext?: () => void; nextLabel?: string }) {
  const [rankId, setRankId] = useState<string | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const shownAt = useRef(0);
  const [muted, setMuted] = useState(false);

  // Son activé par défaut : l'ambiance du clip (annonces, communications) aide à deviner le rang
  const player = useVideoPlayer(media(clip.videoUrl), (p) => {
    p.loop = true;
    p.muted = false;
    p.volume = 1;
    p.play();
  });

  // Le lecteur est un objet natif : on lui applique l'état du bouton son
  useEffect(() => applySound(player, muted), [player, muted]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [clip.id]);

  const submit = async () => {
    if (!rankId) return;
    setPending(true);
    setError(null);
    try {
      // Temps écoulé depuis l'affichage du clip (borné par l'API)
      const watchedMs = Math.min(Date.now() - shownAt.current, 120_000);
      const r = await api.guess({ playToken: clip.playToken, rankId, watchedMs });
      void Haptics.notificationAsync(r.distance === 0 ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
      setResult(r);
      onResult?.(r);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "ALREADY_ANSWERED" ? e.message : errorMessage(e, "Ta réponse n'a pas pu être envoyée, réessaie."));
    } finally {
      setPending(false);
    }
  };

  const table = scoreTable();

  return (
    <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
      <View style={styles.video}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture={false} />
        <Pressable
          onPress={() => setMuted((m) => !m)}
          style={styles.sound}
          accessibilityRole="button"
          accessibilityLabel={muted ? "Activer le son" : "Couper le son"}
          hitSlop={8}
        >
          <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{muted ? "🔇 Son coupé" : "🔊 Son"}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Hud>{clip.game.name} · {Math.round(clip.durationSec)} s</Hud>
        <Text
          onPress={() => !reported && api.report(clip.id).then(() => setReported(true), () => setReported(true))}
          style={{ color: colors.muted, fontSize: 12 }}
        >
          {reported ? "Merci, le clip sera vérifié." : "⚑ Signaler"}
        </Text>
      </View>

      {!result ? (
        <Card style={{ gap: 14 }}>
          <Text style={styles.title}>Quel est son rang ?</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {table.map((pts, d) => (d === 0 ? `Exact : ${pts}` : `${d} rang${d > 1 ? "s" : ""} d'écart : ${pts}`)).join(" · ")} · au-delà : 0
          </Text>
          <View style={styles.grid}>
            {clip.ranks.map((r) => {
              const active = r.id === rankId;
              return (
                <Pressable
                  key={r.id}
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
          <PrimaryButton label={pending ? "Validation…" : "Valider"} onPress={submit} disabled={!rankId || pending} />
        </Card>
      ) : (
        <Card style={{ gap: 12 }}>
          <Text style={[styles.verdict, { color: result.score === 0 ? colors.danger : result.distance === 0 ? colors.success : result.distance <= 1 ? colors.neon : colors.warn }]}>
            {VERDICT[result.distance] ?? "RATÉ"}
          </Text>
          <Text style={styles.score}>+{result.score}</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={[styles.tile, { borderColor: result.correctRank.color }]}>
              <RankEmblem rank={result.correctRank} size={52} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>Rang réel</Text>
              <Text style={{ color: result.correctRank.color, fontWeight: "700" }} numberOfLines={1}>{result.correctRank.name}</Text>
            </View>
            <View style={styles.tile}>
              <RankEmblem rank={result.guessedRank} size={52} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>Ta réponse</Text>
              <Text style={{ color: colors.ink, fontWeight: "700" }} numberOfLines={1}>{result.guessedRank.name}</Text>
            </View>
          </View>
          <Text style={{ color: colors.muted }}>
            +{result.xpGained} XP{result.vipBoost ? " (boost VIP ×1,5)" : ""} · niveau {result.level} · série {result.dailyStreak}
          </Text>
          {result.clipPlayer && (
            <Text style={{ color: colors.muted }}>
              Joueur du clip : <Text style={{ color: colors.ink, fontWeight: "700" }}>{result.clipPlayer.inGamePseudo}</Text>
              {result.clipPlayer.platform ? ` · ${PLATFORM_LABEL[result.clipPlayer.platform as Platform] ?? result.clipPlayer.platform}` : ""}
              {result.clipPlayer.region ? ` · ${REGION_LABEL[result.clipPlayer.region as Region] ?? result.clipPlayer.region}` : ""}
            </Text>
          )}
          {result.winStreak > 1 && <Text style={{ color: colors.success }}>{result.winStreak} victoires d&apos;affilée</Text>}
          {result.unlockedAchievements.map((a) => (
            <Text key={a.code} style={{ color: colors.violetSoft }}>🏆 {a.name}</Text>
          ))}
          {result.unlockedRewards.length > 0 && (
            <Pressable
              onPress={() => router.push("/rewards")}
              accessibilityRole="button"
              style={{ borderWidth: 1, borderColor: `${colors.neon}66`, backgroundColor: `${colors.neon}14`, borderRadius: radius.chip, padding: 12, gap: 6 }}
            >
              <Hud>Nouvelle récompense</Hud>
              {result.unlockedRewards.map((r) => (
                <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <CosmeticVisual item={r} size={12} />
                  <Text style={{ color: r.color, fontWeight: "700" }}>{r.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{r.type === "TITLE" ? "titre" : r.type === "BADGE" ? "badge" : "cadre"}</Text>
                </View>
              ))}
              <Text style={{ color: colors.neon, fontSize: 12 }}>Toucher pour l&apos;équiper</Text>
            </Pressable>
          )}
          {onNext && <PrimaryButton label={nextLabel} onPress={onNext} />}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  video: { aspectRatio: 16 / 9, borderRadius: radius.card, overflow: "hidden", backgroundColor: "black", borderWidth: 1, borderColor: colors.line },
  title: { color: colors.ink, fontSize: 22, ...font.display },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { width: "31.5%", borderRadius: radius.chip, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface2, padding: 10, gap: 6, alignItems: "center" },
  sound: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  tile: { flex: 1, alignItems: "center", gap: 4, borderRadius: radius.chip, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface2, padding: 10 },
  chipText: { color: colors.ink, fontWeight: "600", fontSize: 13 },
  verdict: { ...font.display, fontSize: 13, letterSpacing: 3 },
  score: { color: colors.ink, fontSize: 56, ...font.display },
});
