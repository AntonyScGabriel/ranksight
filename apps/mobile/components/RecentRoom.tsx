import { Pressable, Text } from "react-native";
import { ROOM_MODE_LABEL, ROOM_VISIBILITY_LABEL, type RoomSummaryDto } from "@ranksight/shared";
import { colors } from "@/lib/theme";
import { Card } from "@/components/ui";

/** Partie de salon terminée : jeu, mode, visibilité et place du joueur */
export function RecentRoom({ r, onOpen }: { r: RoomSummaryDto; onOpen: (id: string) => void }) {
  return (
    <Pressable onPress={() => onOpen(r.id)} accessibilityRole="button">
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
        <Text style={{ flex: 1, color: colors.ink }} numberOfLines={2}>
          {r.game.name} · {ROOM_MODE_LABEL[r.mode]} · {ROOM_VISIBILITY_LABEL[r.visibility].toLowerCase()} · {r.players} joueurs
        </Text>
        <Text style={{ color: r.placement === 1 ? colors.neon : colors.muted, fontWeight: "700" }}>
          {r.placement === 1 ? "Victoire" : r.placement ? `${r.placement}e` : "Terminé"}
        </Text>
      </Card>
    </Pressable>
  );
}
