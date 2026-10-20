import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { DAILY_PER_GAME, DAILY_STATUS_LABEL, type DailyGameDto, type DailyOverviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Card, GhostButton, Hud, Loading, LoginRequired, Message, PrimaryButton } from "@/components/ui";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { DailyCountdown } from "@/components/DailyCountdown";

/** « Défis du jour » : 3 clips par jeu, le joueur choisit celui qu'il veut jouer. */
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
      <Text style={{ color: colors.muted }}>{DAILY_PER_GAME} clips par jeu, une seule tentative par défi.</Text>
      <DailyCountdown onReset={load} />
      <Card style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Stat label="Joués" value={`${data.played}/${data.total}`} />
        <Stat label="Score du jour" value={String(data.totalScore)} />
        <Stat label="Série" value={`🔥 ${data.dailyStreak}`} />
      </Card>
      {data.games.map((g) => <GameCard key={g.game.slug} item={g} />)}
      {data.total > 0 && data.played >= data.total && (
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
  const { game, status, challenges, score } = item;
  const badge = status === "AVAILABLE" ? colors.success : status === "PLAYED" ? colors.violetSoft : colors.muted;
  const played = challenges.filter((c) => c.status === "PLAYED").length;
  const open = (slot: number) => router.push({ pathname: "/daily/[game]", params: { game: game.slug, slot: String(slot) } });
  return (
    <View
      style={{
        borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12,
        backgroundColor: colors.surface, borderLeftWidth: 4, borderLeftColor: game.accent,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>{game.name}</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {played}/{challenges.length} joué{played > 1 ? "s" : ""}{played ? ` · ${score} pts` : ""}
          </Text>
        </View>
        <Text style={{ color: badge, fontSize: 12, fontWeight: "700" }}>{DAILY_STATUS_LABEL[status]}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {challenges.map((c) => {
          const available = c.status === "AVAILABLE";
          return (
            <Pressable
              key={c.slot}
              disabled={!available}
              onPress={() => open(c.slot)}
              accessibilityRole="button"
              accessibilityLabel={`${game.name} — défi ${c.slot} : ${available ? "à jouer" : c.result ? `${c.result.score} points` : "bientôt"}`}
              style={({ pressed }) => ({
                flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, borderWidth: 1,
                borderColor: available ? `${colors.success}88` : colors.line,
                backgroundColor: available ? (pressed ? `${colors.success}33` : `${colors.success}1a`) : colors.surface2,
              })}
            >
              <Text style={{ color: colors.muted, fontSize: 11 }}>Défi {c.slot}</Text>
              {available ? (
                <Text style={{ color: colors.neon, fontWeight: "800" }}>Jouer</Text>
              ) : c.result ? (
                <>
                  <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>+{c.result.score}</Text>
                  <Text numberOfLines={1} style={{ color: c.result.correctRank.color, fontSize: 11, fontWeight: "700" }}>{c.result.correctRank.name}</Text>
                </>
              ) : (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Bientôt</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {status === "UNAVAILABLE" && <Text style={{ color: colors.muted }}>De nouveaux clips arrivent bientôt.</Text>}
    </View>
  );
}
