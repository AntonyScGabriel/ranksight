import { Stack } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Loading, Message } from "@/components/ui";

const header = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.void },
  headerTintColor: colors.ink,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.void },
} as const;

/** Administration dans l'application : réservée à l'équipe (chaque écran vérifie aussi le rôle, et l'API reste seule juge). */
export default function AdminLayout() {
  const { me, loading } = useSession();
  if (loading) return <Loading />;
  if (!me || me.role === "USER") {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: colors.void }}>
        <Message title="Accès réservé" text="L'administration est réservée à l'équipe de RankGuess." />
      </View>
    );
  }
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: "Administration" }} />
      <Stack.Screen name="triage" options={{ title: "Tri des clips" }} />
      <Stack.Screen name="clips" options={{ title: "Clips à valider" }} />
      <Stack.Screen name="clip/[id]" options={{ title: "Clip" }} />
      <Stack.Screen name="reports" options={{ title: "Signalements" }} />
      <Stack.Screen name="suggestions" options={{ title: "Suggestions" }} />
      <Stack.Screen name="users" options={{ title: "Joueurs" }} />
      <Stack.Screen name="shop" options={{ title: "Boutique" }} />
      <Stack.Screen name="security" options={{ title: "Sécurité du compte" }} />
    </Stack>
  );
}
