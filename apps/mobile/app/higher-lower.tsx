import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import {
  GAME_NAMES, GAME_SLUGS, HIGHER_LOWER_RULES, type GameSlug, type HigherLowerAnswerDto, type HigherLowerChoice,
  type HigherLowerOverviewDto, type HigherLowerRunDto,
} from "@ranksight/shared";
import { api, media } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { RankEmblem } from "@/components/RankEmblem";
import { Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";

function Clip({ url }: { url: string }) {
  const player = useVideoPlayer(media(url), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <View style={{ aspectRatio: 16 / 9, borderRadius: radius.card, overflow: "hidden", backgroundColor: "black", borderWidth: 1, borderColor: colors.line }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture={false} />
    </View>
  );
}

/** Plus haut / Plus bas : le rang du clip suivant est-il plus haut ou plus bas que celui du clip affiché ? */
export default function HigherLowerScreen() {
  const { me, loading } = useSession();
  const [overview, setOverview] = useState<HigherLowerOverviewDto | null>(null);
  const [run, setRun] = useState<HigherLowerRunDto | null>(null);
  const [last, setLast] = useState<HigherLowerAnswerDto | null>(null);
  const [game, setGame] = useState<GameSlug>("valorant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.higherLower().then((o) => {
      setOverview(o);
      setRun((current) => current ?? o.active);
    }, () => setError("Impossible de charger le mode pour le moment."));
  }, [me]);
  useFocusEffect(load);
  useEffect(load, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setLast(null);
    try {
      setRun(await api.startHigherLower(game));
      load();
    } catch (e) {
      setError(errorMessage(e, "La série n'a pas pu démarrer."));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (choice: HigherLowerChoice) => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.answerHigherLower(run.id, run.round, choice);
      void Haptics.notificationAsync(r.correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
      setLast(r);
      if (!r.correct || r.run.status === "ENDED") load();
    } catch (e) {
      setError(errorMessage(e, "Ta réponse n'a pas pu être envoyée."));
      api.higherLowerRun(run.id).then(setRun, () => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired /></View>;
  if (!overview) return error ? <View style={{ padding: 16 }}><Muted center>{error}</Muted></View> : <Loading />;

  // Mode VIP : le serveur refuse le lancement sans VIP (une série déjà lancée se termine) ; l'écran l'explique et propose l'offre
  const canStart = overview.vip;
  const shown = last ? last.run : run;
  const revealing = !!last && last.correct && last.run.status === "ACTIVE";
  const playing = !!shown && shown.status === "ACTIVE" && !last;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Card style={{ flexDirection: "row", justifyContent: "space-around" }}>
        <Stat label="Série" value={shown && shown.status === "ACTIVE" ? String(shown.score) : "—"} color={colors.neon} />
        <Stat label="Record" value={String(Math.max(overview.best, shown?.best ?? 0))} />
        <Stat label="Accès" value="VIP" color={colors.warn} />
      </Card>
      {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}

      {playing && shown.next && (
        <>
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Hud>Clip de référence</Hud>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <RankEmblem rank={shown.current.rank} size={24} />
                <Text style={{ color: shown.current.rank.color, fontWeight: "800" }}>{shown.current.rank.name}</Text>
              </View>
            </View>
            <Clip key={shown.current.id} url={shown.current.videoUrl} />
          </Card>
          <Card style={{ gap: 8 }}>
            <Hud>Clip à comparer</Hud>
            <Clip key={shown.next.id} url={shown.next.videoUrl} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><PrimaryButton label="▲ Plus haut" disabled={busy} onPress={() => void answer("higher")} /></View>
              <View style={{ flex: 1 }}><PrimaryButton label="▼ Plus bas" disabled={busy} onPress={() => void answer("lower")} /></View>
            </View>
          </Card>
        </>
      )}

      {last && (
        <Card style={{ alignItems: "center", gap: 6 }}>
          <RankEmblem rank={last.revealed} size={64} />
          <Text style={{ color: last.correct ? colors.success : colors.danger, fontSize: 22, fontWeight: "800" }}>{last.correct ? "Bonne réponse !" : "Perdu"}</Text>
          <Muted center>
            Le clip était {last.revealed.name}.
            {last.correct ? (last.record ? " Nouveau record !" : "") : ` Série terminée : ${last.run.score} bonne${last.run.score > 1 ? "s" : ""} réponse${last.run.score > 1 ? "s" : ""}.`}
          </Muted>
          {revealing && <View style={{ alignSelf: "stretch" }}><PrimaryButton label="Clip suivant" onPress={() => { setRun(last.run); setLast(null); }} /></View>}
        </Card>
      )}

      {(!shown || shown.status === "ENDED") && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Nouvelle série</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {GAME_SLUGS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setGame(s)}
                accessibilityRole="radio"
                accessibilityState={{ checked: s === game }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.chip, borderWidth: 1.5, borderColor: s === game ? colors.neon : colors.line, backgroundColor: colors.surface2 }}
              >
                <Text style={{ color: s === game ? colors.neon : colors.ink, fontWeight: "600" }}>{GAME_NAMES[s]}</Text>
              </Pressable>
            ))}
          </View>
          {canStart ? (
            <PrimaryButton label="Commencer" disabled={busy} onPress={() => void start()} />
          ) : (
            <View style={{ gap: 10, borderWidth: 1, borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}14`, borderRadius: 12, padding: 12 }}>
              <Text style={{ color: colors.ink, lineHeight: 20 }}>
                Plus haut / Plus bas est un mode VIP, sans limite de séries. Deviner le rang, le mode Infini, les salons publics et les
                duels classés restent gratuits. Le VIP n&apos;apporte aucun point au classement compétitif.
              </Text>
              <GhostButton label={Platform.OS === "android" ? "Devenir VIP" : "Mon VIP"} onPress={() => router.push("/shop")} />
            </View>
          )}
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {HIGHER_LOWER_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value, color = colors.ink }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Text style={{ color, fontSize: 20, fontWeight: "800" }}>{value}</Text>
      <Hud>{label}</Hud>
    </View>
  );
}
