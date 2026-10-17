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
        // 8 onglets : libellés compacts pour tenir sur les petits écrans
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Défis du jour", tabBarLabel: "Défis", tabBarIcon: icon("◎") }} />
      <Tabs.Screen name="infinite" options={{ title: "Infini", tabBarIcon: icon("∞") }} />
      <Tabs.Screen
        name="versus"
        options={{ title: "Duels", tabBarIcon: icon("⚔"), tabBarBadge: versusPending > 0 ? versusPending : undefined }}
      />
      {/* Salons : section à part des duels 1 contre 1 (même écran que /rooms) */}
      <Tabs.Screen
        name="salons"
        options={{ title: "Salons", tabBarIcon: icon("▦"), tabBarBadge: roomInvites > 0 ? roomInvites : undefined }}
      />
      <Tabs.Screen name="leaderboard" options={{ title: "Classements", tabBarLabel: "Top", tabBarIcon: icon("▲") }} />
      <Tabs.Screen name="chat" options={{ title: "Chat global", tabBarLabel: "Chat", tabBarIcon: icon("✉") }} />
      <Tabs.Screen
        name="friends"
        options={{ title: "Amis", tabBarIcon: icon("☺"), tabBarBadge: unread > 0 ? (unread > 9 ? "9+" : unread) : undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: icon("◉"), tabBarBadge: newRewards > 0 ? newRewards : undefined }} />
    </Tabs>
  );
}
