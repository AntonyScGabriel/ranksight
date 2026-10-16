import { Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useChat } from "@/lib/chat";
import { colors, radius } from "@/lib/theme";

/** Invitation à un duel en direct ou dans un salon : bandeau en haut de l'écran, où que soit le joueur. */
export function InviteBanner() {
  const { invite, dismissInvite } = useChat();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (!invite || pathname.startsWith(`/versus/${invite.id}`)) return <RoomInviteBanner />;
  return (
    <View
      accessibilityRole="alert"
      style={{
        position: "absolute", top: insets.top + 8, left: 12, right: 12, zIndex: 50,
        flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
        backgroundColor: colors.surface2, borderColor: colors.neon, borderWidth: 1, borderRadius: radius.card,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.neon, fontSize: 11, letterSpacing: 2, fontWeight: "700" }}>DUEL EN DIRECT</Text>
        <Text style={{ color: colors.ink }} numberOfLines={2}>
          <Text style={{ fontWeight: "700" }}>{invite.opponent?.displayName}</Text> te défie{invite.game ? ` sur ${invite.game.name}` : ""} et t&apos;attend.
        </Text>
      </View>
      <Pressable
        onPress={() => {
          dismissInvite();
          router.push({ pathname: "/versus/[id]", params: { id: invite.id } });
        }}
        style={{ backgroundColor: colors.violet, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}
        accessibilityRole="button"
      >
        <Text style={{ color: "white", fontWeight: "700" }}>Rejoindre</Text>
      </Pressable>
      <Pressable onPress={dismissInvite} hitSlop={10} accessibilityLabel="Fermer">
        <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
      </Pressable>
    </View>
  );
}

function RoomInviteBanner() {
  const { roomInvite, dismissRoomInvite } = useChat();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (!roomInvite || pathname.startsWith("/rooms")) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        position: "absolute", top: insets.top + 8, left: 12, right: 12, zIndex: 50,
        flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
        backgroundColor: colors.surface2, borderColor: colors.neon, borderWidth: 1, borderRadius: radius.card,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.neon, fontSize: 11, letterSpacing: 2, fontWeight: "700" }}>SALON PRIVÉ</Text>
        <Text style={{ color: colors.ink }} numberOfLines={2}>
          <Text style={{ fontWeight: "700" }}>{roomInvite.from}</Text> t&apos;invite sur {roomInvite.game.name} ({roomInvite.players}/{roomInvite.maxPlayers}).
        </Text>
      </View>
      <Pressable
        onPress={() => {
          dismissRoomInvite();
          router.push({ pathname: "/rooms/join/[code]", params: { code: roomInvite.code } });
        }}
        style={{ backgroundColor: colors.violet, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 }}
        accessibilityRole="button"
      >
        <Text style={{ color: "white", fontWeight: "700" }}>Voir</Text>
      </Pressable>
      <Pressable onPress={dismissRoomInvite} hitSlop={10} accessibilityLabel="Fermer">
        <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
      </Pressable>
    </View>
  );
}
