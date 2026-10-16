import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { InviteBanner } from "@/components/InviteBanner";
import { TermsGate } from "@/components/TermsGate";
import { VerifyEmailGate } from "@/components/VerifyEmailGate";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ChatProvider } from "@/lib/chat";
import { ConfirmProvider } from "@/lib/confirm";
import { onNotificationTap } from "@/lib/notifications";
import { SessionProvider } from "@/lib/session";
import { StaffGuardProvider } from "@/lib/staff";
import { colors } from "@/lib/theme";

const header = {
  headerStyle: { backgroundColor: colors.void },
  headerTintColor: colors.ink,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.void },
};

export default function RootLayout() {
  // Tap sur une notification : ouvre la conversation, le duel, mes clips (décision de la modération) ou les défis du jour
  useEffect(
    () =>
      onNotificationTap((url) => {
        const chat = url?.match(/chat\/([0-9a-f-]{36})/);
        const versus = url?.match(/versus\/([0-9a-f-]{36})/);
        const room = url?.match(/^rooms\/join\/([A-Z0-9]{8})$/);
        const tournament = url?.match(/^tournaments\/([0-9a-f-]{36})$/);
        if (chat) router.push({ pathname: "/chat/[id]", params: { id: chat[1] } });
        else if (versus) router.push({ pathname: "/versus/[id]", params: { id: versus[1] } });
        else if (room) router.push({ pathname: "/rooms/join/[code]", params: { code: room[1] } });
        else if (tournament) router.push({ pathname: "/tournaments/[id]", params: { id: tournament[1] } });
        else if (url === "my-clips") router.push("/my-clips");
        else if (url === "suggestions") router.push("/suggestions");
        else router.push("/");
      }),
    [],
  );

  return (
    <KeyboardProvider>
    <SessionProvider>
      <ConfirmProvider>
      <StaffGuardProvider>
      <ChatProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.void } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ presentation: "modal" }} />
          <Stack.Screen name="signup" options={{ presentation: "modal" }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: true, title: "Mot de passe oublié", ...header }} />
          <Stack.Screen name="daily/[game]" options={{ headerShown: true, title: "Défi du jour", ...header }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: "", ...header }} />
          <Stack.Screen name="my-clips" options={{ headerShown: true, title: "Mes clips", ...header }} />
          <Stack.Screen name="achievements" options={{ headerShown: true, title: "Mes succès", ...header }} />
          <Stack.Screen name="rewards" options={{ headerShown: true, title: "Titres, badges et cadres", ...header }} />
          <Stack.Screen name="shop" options={{ headerShown: true, title: Platform.OS === "android" ? "Boutique VIP" : "Mon VIP", ...header }} />
          <Stack.Screen name="player/[id]" options={{ headerShown: true, title: "Profil du joueur", ...header }} />
          <Stack.Screen name="versus/[id]" options={{ headerShown: true, title: "Duel", ...header }} />
          <Stack.Screen name="higher-lower" options={{ headerShown: true, title: "Plus haut / Plus bas", ...header }} />
          <Stack.Screen name="rooms/index" options={{ headerShown: true, title: "Salons privés", ...header }} />
          <Stack.Screen name="rooms/[id]" options={{ headerShown: true, title: "Salon privé", ...header }} />
          <Stack.Screen name="rooms/join/[code]" options={{ headerShown: true, title: "Rejoindre un salon", ...header }} />
          <Stack.Screen name="tournaments/index" options={{ headerShown: true, title: "Tournois privés", ...header }} />
          <Stack.Screen name="tournaments/[id]" options={{ headerShown: true, title: "Tournoi", ...header }} />
          <Stack.Screen name="tournaments/join/[code]" options={{ headerShown: true, title: "S'inscrire au tournoi", ...header }} />
          <Stack.Screen name="submit" options={{ headerShown: true, title: "Proposer un clip", ...header }} />
          <Stack.Screen name="suggestions" options={{ headerShown: true, title: "Suggestions", ...header }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
        </Stack>
        <InviteBanner />
        <TermsGate />
        <VerifyEmailGate />
      </ChatProvider>
      </StaffGuardProvider>
      </ConfirmProvider>
    </SessionProvider>
    </KeyboardProvider>
  );
}
