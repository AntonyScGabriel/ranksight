import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { unread, versusPending, roomInvites } = useChat();
  const { me } = useSession();
  const newRewards = me?.newRewards ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.void },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.abyss, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.neon,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.void },
        // 5 onglets visibles ; Infini, Classements, Chat, Amis et Profil sont regroupés dans « Plus »
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Défis du jour", tabBarLabel: "Défis", tabBarIcon: icon("◎") }} />
      {/* Rubriques sans onglet (href: null) : ouvertes depuis « Plus », la barre du bas reste affichée */}
      <Tabs.Screen name="infinite" options={{ title: "Infini", href: null }} />
      <Tabs.Screen
        name="versus"
        options={{ title: "Duels", tabBarIcon: icon("⚔"), tabBarBadge: versusPending > 0 ? versusPending : undefined }}
      />
      {/* Salons : section à part des duels 1 contre 1 (même écran que /rooms) */}
      <Tabs.Screen
        name="salons"
        options={{ title: "Salons", tabBarIcon: icon("▦"), tabBarBadge: roomInvites > 0 ? roomInvites : undefined }}
      />
      <Tabs.Screen name="tournaments" options={{ title: "Tournois", tabBarIcon: icon("🏆") }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Classements", href: null }} />
      <Tabs.Screen name="chat" options={{ title: "Chat global", href: null }} />
      <Tabs.Screen name="friends" options={{ title: "Amis", href: null }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", href: null }} />
      <Tabs.Screen
        name="more"
        options={{ title: "Plus", tabBarIcon: icon("☰"), tabBarBadge: unread + newRewards > 0 ? (unread + newRewards > 9 ? "9+" : unread + newRewards) : undefined }}
      />
    </Tabs>
  );
}
