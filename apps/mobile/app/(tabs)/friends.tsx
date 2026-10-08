import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { ConversationDto, FriendRequestsDto, UserSearchResultDto, UserSummaryDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Avatar, Hud, Loading, LoginRequired, Muted } from "@/components/ui";
import { FlairBadge, TitleText } from "@/components/Flair";

export default function FriendsScreen() {
  const confirm = useConfirm();
  const { me, loading } = useSession();
  const { onMessage } = useChat();
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [requests, setRequests] = useState<FriendRequestsDto>({ received: [], sent: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResultDto[]>([]);

  const load = useCallback(() => {
    if (!me) return;
    Promise.all([api.conversations(), api.friendRequests()])
      .then(([c, r]) => {
        setConversations(c);
        setRequests(r);
      })
      .catch(() => undefined);
  }, [me]);

  useFocusEffect(load);
  useEffect(() => onMessage(load), [onMessage, load]);

  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => api.searchUsers(query).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [query, searching]);
  const visibleResults = searching ? results : [];

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      load();
      if (query.trim().length >= 2) setResults(await api.searchUsers(query));
    } catch (e) {
      Alert.alert("Action impossible", e instanceof ApiError ? e.message : "Réessaie dans un instant.");
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired text="Connecte-toi pour retrouver tes amis et discuter avec eux." /></View>;

  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={conversations}
      keyExtractor={(c) => c.friend.id}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 8 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un joueur"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12 }}
          />
          {visibleResults.map((u) => (
            <Row key={u.id} user={u}>
              {u.relation === "none" && <Action label="Ajouter" onPress={() => act(() => api.sendFriendRequest(u.id))} />}
              {u.relation === "request_received" && <Action label="Accepter" onPress={() => act(() => api.acceptFriend(u.id))} />}
              {u.relation === "request_sent" && <Text style={{ color: colors.muted, fontSize: 12 }}>Envoyée</Text>}
              {u.relation === "friends" && <Text style={{ color: colors.success, fontSize: 12 }}>Ami</Text>}
            </Row>
          ))}
          {searching && visibleResults.length === 0 && <Muted>Aucun joueur trouvé.</Muted>}

          {requests.received.length > 0 && <Hud>Demandes reçues</Hud>}
          {requests.received.map((u) => (
            <Row key={u.id} user={u}>
              <Action label="Accepter" onPress={() => act(() => api.acceptFriend(u.id))} />
              <Text onPress={() => act(() => api.declineFriend(u.id))} style={{ color: colors.muted, fontSize: 12, padding: 6 }}>Refuser</Text>
            </Row>
          ))}
          {requests.sent.length > 0 && <Hud>Demandes envoyées</Hud>}
          {requests.sent.map((u) => (
            <Row key={u.id} user={u}>
              <Text onPress={() => act(() => api.declineFriend(u.id))} style={{ color: colors.muted, fontSize: 12, padding: 6 }}>Annuler</Text>
            </Row>
          ))}
          <Hud>Mes amis ({conversations.length})</Hud>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.friend.id, name: item.friend.displayName } })}
          onLongPress={async () => {
            const ok = await confirm({
              title: "Retirer cet ami ?",
              message: `${item.friend.displayName} ne fera plus partie de tes amis et votre conversation ne sera plus accessible.`,
              confirmLabel: "Retirer",
              danger: true,
            });
            if (ok !== false) act(() => api.removeFriend(item.friend.id));
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }}
        >
          <Pressable
            onPress={() => router.push({ pathname: "/player/[id]", params: { id: item.friend.id } })}
            accessibilityLabel={`Voir le profil de ${item.friend.displayName}`}
            hitSlop={6}
          >
            <Avatar name={item.friend.displayName} url={item.friend.avatarUrl} size={42} frame={item.friend.flair.frame} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={{ color: colors.ink, fontWeight: "600" }}>{item.friend.displayName}</Text>
              <FlairBadge flair={item.friend.flair} size={11} />
            </View>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
              {item.lastMessage ? `${item.lastMessage.senderId === me.id ? "Toi : " : ""}${item.lastMessage.body}` : `Niveau ${item.friend.level}`}
            </Text>
          </View>
          {item.unread > 0 && (
            <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
              <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{item.unread}</Text>
            </View>
          )}
        </Pressable>
      )}
      ListEmptyComponent={<Muted>Recherche un joueur par son pseudo pour l&apos;ajouter.</Muted>}
    />
  );
}

function Row({ user, children }: { user: UserSummaryDto; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Pressable
        onPress={() => router.push({ pathname: "/player/[id]", params: { id: user.id } })}
        accessibilityRole="button"
        accessibilityLabel={`Voir le profil de ${user.displayName}`}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <Avatar name={user.displayName} url={user.avatarUrl} size={34} frame={user.flair.frame} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{user.displayName}</Text>
            <FlairBadge flair={user.flair} size={11} />
          </View>
          {user.flair.title && <TitleText title={user.flair.title} size={10} />}
          <Text style={{ color: colors.muted, fontSize: 12 }}>@{user.username} · niveau {user.level}</Text>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: colors.violet, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
      <Text style={{ color: "white", fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
