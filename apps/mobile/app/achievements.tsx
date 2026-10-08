import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_CATEGORY_LABEL, type AchievementDto, type AchievementsOverviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { colors, radius } from "@/lib/theme";
import { Card, GhostButton, Hud, Loading, Message } from "@/components/ui";

type Filter = "all" | "unlocked" | "locked";

/** Mes succès : obtenus et à obtenir, avec l'avancement de chacun. */
export default function AchievementsScreen() {
  const [data, setData] = useState<AchievementsOverviewDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    api.achievements().then((d) => {
      setData(d);
      setFailed(false);
    }, () => setFailed(true));
  }, []);
  useFocusEffect(load);

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

  const visible = data.items.filter((a) => (filter === "all" ? true : filter === "unlocked" ? !!a.unlockedAt : !a.unlockedAt));
  const pct = data.total ? Math.round((data.unlocked / data.total) * 100) : 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Card style={{ gap: 8 }}>
        <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>{data.unlocked} sur {data.total} obtenus</Text>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surface2 }}>
          <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: colors.violet }} />
        </View>
        <Text style={{ color: colors.muted }}>Série de victoires : {data.winStreak} · record : {data.bestWinStreak}</Text>
      </Card>

      <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4 }}>
        {([["all", "Tous"], ["unlocked", "Obtenus"], ["locked", "À débloquer"]] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={{ flex: 1, paddingVertical: 8, borderRadius: 9, backgroundColor: filter === k ? colors.violet : "transparent" }}>
            <Text style={{ color: filter === k ? "white" : colors.muted, textAlign: "center", fontWeight: "600" }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {ACHIEVEMENT_CATEGORIES.map((category) => {
        const items = visible.filter((a) => a.category === category);
        if (!items.length) return null;
        return (
          <View key={category} style={{ gap: 8 }}>
            <Hud>{ACHIEVEMENT_CATEGORY_LABEL[category]}</Hud>
            {items.map((a) => <Item key={a.id} a={a} />)}
          </View>
        );
      })}
      {visible.length === 0 && <Text style={{ color: colors.muted, textAlign: "center" }}>Aucun succès dans cette liste.</Text>}
    </ScrollView>
  );
}

function Item({ a }: { a: AchievementDto }) {
  const done = !!a.unlockedAt;
  const pct = a.progress ? Math.round((a.progress.current / a.progress.target) * 100) : 0;
  return (
    <View
      style={{
        flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.card, borderWidth: 1,
        borderColor: done ? colors.violet : colors.line, backgroundColor: colors.surface, opacity: done ? 1 : 0.85,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: done ? colors.violet : colors.surface2 }}>
        <Text style={{ fontSize: 22 }}>{a.hidden && !done ? "?" : a.category === "SEASON" ? "👑" : done ? "🏆" : "🔒"}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "700", flexShrink: 1 }}>{a.name}</Text>
          <Text style={{ color: colors.neon, fontSize: 12 }}>+{a.xpReward} XP</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{a.description}</Text>
        {done ? (
          <Text style={{ color: colors.success, fontSize: 12 }}>Obtenu le {new Date(a.unlockedAt!).toLocaleDateString("fr-FR")}</Text>
        ) : a.progress ? (
          <View style={{ gap: 3 }}>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.surface2 }}>
              <View style={{ width: `${pct}%`, height: 5, borderRadius: 3, backgroundColor: colors.violet }} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{a.progress.current} / {a.progress.target}</Text>
          </View>
        ) : a.category === "SEASON" ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Attribué à la fin de la saison, d&apos;après le classement général.</Text>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {a.rarity > 0 ? `Obtenu par ${Math.max(1, Math.round(a.rarity * 100))} % des joueurs` : "Personne ne l'a encore obtenu"}
        </Text>
      </View>
    </View>
  );
}
