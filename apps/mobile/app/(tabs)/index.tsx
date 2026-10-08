import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { DAILY_STATUS_LABEL, type DailyGameDto, type DailyOverviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Card, GhostButton, Hud, Loading, LoginRequired, Message, PrimaryButton } from "@/components/ui";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";

/** « Défis du jour » : un clip par jeu, le joueur choisit celui qu'il veut jouer. */
export default function DailyScreen() {
  const { me, loading } = useSession();
  const [data, setData] = useState<DailyOverviewDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!me) return;
    setFailed(false);
    api.dailyOverview().then(setData, () => setFailed(true));
  }, [me]);

  useFocusEffect(load);

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired /></View>;
  if (failed && !data) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Connexion au serveur impossible" text="Vérifie ta connexion internet puis réessaie.">
          <GhostButton label="Réessayer" onPress={load} />
        </Message>
      </View>
    );
  }
  if (!data) return <Loading />;

  const date = new Date(`${data.date}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <AnnouncementBanner />
      <Hud>{date}</Hud>
      <Text style={{ color: colors.muted }}>Un clip par jeu, une seule tentative par défi.</Text>
      <Card style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Stat label="Joués" value={`${data.played}/${data.games.length}`} />
        <Stat label="Score du jour" value={String(data.totalScore)} />
        <Stat label="Série" value={`🔥 ${data.dailyStreak}`} />
      </Card>
      {data.games.map((g) => <GameCard key={g.game.slug} item={g} />)}
      {data.played === data.games.length && (
        <Message title="Tous les défis sont terminés" text="Reviens demain pour de nouveaux clips. En attendant, le mode Infini t'attend.">
          <PrimaryButton label="Mode Infini" onPress={() => router.push("/infinite")} />
        </Message>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Hud>{label}</Hud>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

function GameCard({ item }: { item: DailyGameDto }) {
  const { game, status, result } = item;
  const badge = status === "AVAILABLE" ? colors.success : status === "PLAYED" ? colors.violetSoft : colors.muted;
  return (
    <Pressable
      disabled={status !== "AVAILABLE"}
      onPress={() => router.push({ pathname: "/daily/[game]", params: { game: game.slug } })}
      accessibilityRole="button"
      accessibilityLabel={`${game.name} — ${DAILY_STATUS_LABEL[status]}`}
      style={({ pressed }) => ({
        borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 10,
        backgroundColor: pressed ? colors.surface2 : colors.surface, borderLeftWidth: 4, borderLeftColor: game.accent,
      })}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700", flexShrink: 1 }}>{game.name}</Text>
        <Text style={{ color: badge, fontSize: 12, fontWeight: "700" }}>{DAILY_STATUS_LABEL[status]}</Text>
      </View>
      {status === "AVAILABLE" && <Text style={{ color: colors.neon, fontWeight: "700" }}>Jouer →</Text>}
      {status === "PLAYED" && result && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={{ color: colors.muted }}>Rang réel : <Text style={{ color: result.correctRank.color, fontWeight: "700" }}>{result.correctRank.name}</Text></Text>
            <Text style={{ color: colors.muted }}>Ta réponse : <Text style={{ color: result.guessedRank.color, fontWeight: "700" }}>{result.guessedRank.name}</Text></Text>
          </View>
          <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800" }}>+{result.score}</Text>
        </View>
      )}
      {status === "UNAVAILABLE" && <Text style={{ color: colors.muted }}>De nouveaux clips arrivent bientôt.</Text>}
    </Pressable>
  );
}
