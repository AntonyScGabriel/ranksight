import { Pressable, ScrollView, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Card } from "@/components/ui";

/**
 * Onglet « Plus » : les rubriques qui ne tiennent pas dans la barre du bas d'un téléphone (Infini, Classements, Chat,
 * Amis, Profil), avec leurs pastilles (messages non lus, nouvelles récompenses).
 */
export default function MoreScreen() {
  const { unread } = useChat();
  const { me } = useSession();
  const items: { href: Href; icon: string; label: string; hint: string; badge?: number }[] = [
    { href: "/infinite", icon: "∞", label: "Infini", hint: "Enchaîne les clips sans limite" },
    { href: "/leaderboard", icon: "▲", label: "Classements", hint: "Meilleurs joueurs et classement compétitif" },
    { href: "/chat", icon: "✉", label: "Chat global", hint: "Discute avec tous les joueurs connectés" },
    { href: "/friends", icon: "☺", label: "Amis", hint: "Ajoute des amis et discute en privé", badge: unread },
    { href: "/profile", icon: "◉", label: "Profil", hint: "Ton compte, tes récompenses et tes clips", badge: me?.newRewards ?? 0 },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      {items.map((i) => (
        <Pressable key={i.label} onPress={() => router.push(i.href)} accessibilityRole="button" accessibilityLabel={i.label}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
            <Text style={{ color: colors.neon, fontSize: 22, width: 28, textAlign: "center" }}>{i.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>{i.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{i.hint}</Text>
            </View>
            {!!i.badge && (
              <View style={{ minWidth: 22, borderRadius: 11, backgroundColor: colors.danger, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" }}>
                <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{i.badge > 9 ? "9+" : i.badge}</Text>
              </View>
            )}
            <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
