import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { ReportSheet, type ReportTarget } from "@/components/ReportSheet";
import { CHAT_EVENTS, type ChatMessageDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { KeyboardView } from "@/components/Keyboard";

export default function ChatScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const { me } = useSession();
  const { onMessage, socket, refreshUnread } = useChat();
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTyping = useRef(0);

  const markRead = useCallback(() => {
    api.markRead(id).then(refreshUnread).catch(() => undefined);
  }, [id, refreshUnread]);

  useEffect(() => {
    api
      .messages(id)
      .then((m) => {
        setMessages(m.reverse());
        markRead();
      })
      .catch(() => setError("Impossible de charger la conversation."));
  }, [id, markRead]);

  useEffect(
    () =>
      onMessage((m) => {
        if (m.senderId !== id && m.recipientId !== id) return;
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [m, ...list]));
        if (m.senderId === id) {
          setTyping(false);
          markRead();
        }
      }),
    [onMessage, id, markRead],
  );

  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = ({ from }: { from: string }) => {
      if (from !== id) return;
      setTyping(true);
      clearTimeout(timer);
      timer = setTimeout(() => setTyping(false), 3000);
    };
    socket.on(CHAT_EVENTS.typing, handler);
    return () => {
      socket.off(CHAT_EVENTS.typing, handler);
      clearTimeout(timer);
    };
  }, [socket, id]);

  const loadOlder = async () => {
    const oldest = messages[messages.length - 1];
    if (!oldest || messages.length < 50) return;
    const older = await api.messages(id, oldest.createdAt).catch(() => []);
    setMessages((list) => [...list, ...older.reverse()]);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setError(null);
    try {
      const m = await api.sendMessage(id, body);
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [m, ...list]));
    } catch (e) {
      setDraft(body);
      setError(e instanceof ApiError ? e.message : "Message non envoyé, réessaie.");
    }
  };

  const onChange = (text: string) => {
    setDraft(text);
    if (socket && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      socket.emit(CHAT_EVENTS.typing, { to: id });
    }
  };

  return (
    <KeyboardView>
      <Stack.Screen options={{ title: name ?? "Conversation", headerRight: () => (typing ? <Text style={{ color: colors.muted, fontSize: 12 }}>écrit…</Text> : null) }} />
      {messages.length === 0 ? (
        // Hors de la liste inversée : sous Android, son retournement inverserait aussi ce texte
        <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", padding: 16 }}>
          <Text style={{ color: colors.muted }}>Lance la conversation.</Text>
        </View>
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          contentContainerStyle={{ padding: 16, gap: 6 }}
          renderItem={({ item }) => {
            const mine = item.senderId === me?.id;
            return (
              <Pressable
                onLongPress={mine ? undefined : () => setReporting({ id, name: name ?? "ce joueur", directMessageId: item.id })}
                accessibilityHint={mine ? undefined : "Appui long pour signaler"}
                style={{ alignItems: mine ? "flex-end" : "flex-start" }}
              >
                <Text
                  style={{
                    maxWidth: "80%",
                    color: mine ? "white" : colors.ink,
                    backgroundColor: mine ? colors.violet : colors.surface2,
                    paddingHorizontal: 14,
                    paddingVertical: 9,
                    borderRadius: 18,
                    overflow: "hidden",
                  }}
                >
                  {item.body}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      {error && <Text style={{ color: colors.danger, paddingHorizontal: 16 }}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.line }}>
        <TextInput
          value={draft}
          onChangeText={onChange}
          placeholder="Écris un message"
          placeholderTextColor={colors.muted}
          maxLength={1000}
          multiline
          style={{ flex: 1, color: colors.ink, backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120 }}
        />
        <Pressable onPress={send} disabled={!draft.trim()} style={{ backgroundColor: colors.violet, borderRadius: 18, paddingHorizontal: 16, justifyContent: "center", opacity: draft.trim() ? 1 : 0.4 }}>
          <Text style={{ color: "white", fontWeight: "700" }}>Envoyer</Text>
        </Pressable>
      </View>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </KeyboardView>
  );
}
