import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { VERSUS_STATUS_LABEL, type VersusMatchDto } from "@ranksight/shared";
import { colors, radius } from "@/lib/theme";
import { Avatar } from "./ui";
import { FlairBadge } from "./Flair";

const RESULT: Record<string, [string, string]> = {
  me: ["Victoire", colors.success],
  opponent: ["Défaite", colors.danger],
  draw: ["Égalité", colors.ink],
};

/** Résumé d'un duel dans les listes. */
export function VersusCard({ m, actions }: { m: VersusMatchDto; actions?: React.ReactNode }) {
  const [label, color] = m.result ? RESULT[m.result] : [VERSUS_STATUS_LABEL[m.status], m.status === "ACTIVE" ? colors.neon : colors.violetSoft];
  const played = m.status === "ACTIVE" || m.status === "FINISHED";
  const opponentName = m.opponent?.displayName ?? "Adversaire au hasard";
  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 14, gap: 10 }}>
      <Pressable
        onPress={() => router.push({ pathname: "/versus/[id]", params: { id: m.id } })}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
        accessibilityRole="button"
      >
        <Avatar name={opponentName} url={m.opponent?.avatarUrl ?? null} size={40} frame={m.opponent?.flair.frame} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={{ flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>contre {opponentName}</Text>
            {m.opponent && <FlairBadge flair={m.opponent.flair} size={11} />}
          </View>
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={2}>
            {m.game?.name ?? "Tous les jeux"}
            {m.status === "ACTIVE" && m.live ? ` · manche ${m.live.round}/${m.rounds}` : ""}
            {m.forfeit ? " · abandon" : ""}
            {m.finishedAt ? ` · ${new Date(m.finishedAt).toLocaleDateString("fr-FR")}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={{ color, fontWeight: "700", fontSize: 12 }}>{label}</Text>
          {played && m.opponent && (
            <Text style={{ color: colors.ink, fontVariant: ["tabular-nums"] }}>{m.me.score} – {m.opponent.score}</Text>
          )}
        </View>
      </Pressable>
      {actions}
    </View>
  );
}
