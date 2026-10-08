import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { GLOBAL_MESSAGE_MAX, ROLE_TAG, isStaffRole, type GlobalMessageDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Avatar, Loading, LoginRequired } from "@/components/ui";
import { errorMessage } from "@/components/AuthUi";
import { ReportSheet, type ReportTarget } from "@/components/ReportSheet";
import { ModSheet, SlowModeBar, slowModeLabel } from "@/components/ModSheet";
import { FlairBadge, TitleText } from "@/components/Flair";
import { KeyboardView } from "@/components/Keyboard";

const openProfile = (id: string) => router.push({ pathname: "/player/[id]", params: { id } });

const PAGE = 50;

function formatTime(iso: string) {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Chat global : salon public commun à tous les joueurs connectés (distinct des messages privés entre amis). */
export default function GlobalChatScreen() {
  const { me, loading } = useSession();
  const { joinGlobal } = useChat();
  const confirm = useConfirm();
  const [messages, setMessages] = useState<GlobalMessageDto[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<GlobalMessageDto>>(null);
  const atBottom = useRef(true);

  const isModerator = isStaffRole(me?.role);

  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [moderating, setModerating] = useState<GlobalMessageDto | null>(null);
  const [slowModeSec, setSlowModeSec] = useState(0);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Joueurs bloqués : leurs nouveaux messages en direct sont ignorés (l'historique est filtré par le serveur)
  const blocked = useRef(new Set<string>());

  useEffect(() => {
    if (!me) return;
    api.blocks().then((b) => { blocked.current = new Set(b.map((x) => x.id)); }, () => undefined);
    api.chatSettings().then((c) => setSlowModeSec(c.slowModeSec), () => undefined);
    api
      .globalMessages()
      .then((m) => {
        setMessages(m);
        setHasMore(m.length === PAGE);
      })
      .catch(() => setError("Impossible de charger le chat pour le moment."));
    return joinGlobal({
      onMessage: (m) => {
        if (blocked.current.has(m.author.id)) return;
        setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m]));
      },
      onDeleted: ({ id }) => setMessages((list) => list?.filter((x) => x.id !== id) ?? list),
      onSettings: (c) => setSlowModeSec(c.slowModeSec),
    });
  }, [me, joinGlobal]);

  const loadOlder = useCallback(async () => {
    const first = messages?.[0];
    if (!first || !hasMore) return;
    const older = await api.globalMessages(first.createdAt).catch(() => []);
    atBottom.current = false;
    setMessages((list) => [...older, ...(list ?? [])]);
    setHasMore(older.length === PAGE);
  }, [messages, hasMore]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    atBottom.current = true;
    try {
      const m = await api.sendGlobal(body);
      setDraft("");
      setMessages((list) => (list?.some((x) => x.id === m.id) ? list : [...(list ?? []), m]));
    } catch (e) {
      setError(errorMessage(e, "Message non envoyé, réessaie."));
    } finally {
      setSending(false);
    }
  };

  const remove = async (m: GlobalMessageDto) => {
    const ok = await confirm({ title: "Supprimer ce message ?", message: m.body.slice(0, 120), confirmLabel: "Supprimer", danger: true });
    if (ok === false) return;
    api.deleteGlobal(m.id).then(
      () => setMessages((list) => list?.filter((x) => x.id !== m.id) ?? list),
      (e) => setError(errorMessage(e, "Suppression impossible.")),
    );
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired text="Connecte-toi pour discuter avec les autres joueurs." /></View>;

  return (
    <KeyboardView>
      {isModerator && <SlowModeBar value={slowModeSec} onChange={setSlowModeSec} onError={(text) => setNotice({ text, ok: false })} />}
      {slowModeSec > 0 && (
        <Text style={{ color: colors.warn, fontSize: 12, textAlign: "center", paddingVertical: 6, backgroundColor: `${colors.warn}14` }}>
          Mode lent : un message toutes les {slowModeLabel(slowModeSec)}{isModerator ? " (sauf l'équipe)" : ""}
        </Text>
      )}
      {notice && (
        <Text onPress={() => setNotice(null)} style={{ color: notice.ok ? colors.success : colors.danger, fontSize: 13, textAlign: "center", paddingVertical: 6 }}>
          {notice.text}
        </Text>
      )}
      {messages === null && !error ? (
        <Loading />
      ) : (
        <FlatList
          ref={listRef}
          data={messages ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
          // Défilement automatique vers les nouveaux messages, sauf si le joueur remonte l'historique
          onContentSizeChange={() => atBottom.current && listRef.current?.scrollToEnd({ animated: true })}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
          }}
          scrollEventThrottle={100}
          ListHeaderComponent={hasMore ? <Text onPress={loadOlder} style={{ color: colors.muted, textAlign: "center", fontSize: 12 }}>Messages précédents</Text> : null}
          ListEmptyComponent={<Text style={{ color: colors.muted, textAlign: "center", marginTop: 60 }}>Aucun message pour l&apos;instant. Lance la discussion !</Text>}
          renderItem={({ item }) => {
            const mine = item.author.id === me.id;
            return (
              <Pressable
                onLongPress={
                  mine
                    ? () => void remove(item)
                    : isModerator
                      ? () => setModerating(item)
                      : () => setReporting({ id: item.author.id, name: item.author.displayName, globalMessageId: item.id })
                }
                accessibilityHint={mine ? "Appui long pour supprimer" : isModerator ? "Appui long pour modérer" : "Appui long pour signaler"}
                style={{ flexDirection: "row", gap: 10 }}
              >
                <Pressable onPress={() => openProfile(item.author.id)} accessibilityLabel={`Voir le profil de ${item.author.displayName}`}>
                  <Avatar name={item.author.displayName} url={item.author.avatarUrl} size={34} frame={item.author.flair.frame} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
                    <Text
                      onPress={() => openProfile(item.author.id)}
                      style={{ color: mine ? colors.neon : colors.ink, fontWeight: "700", fontSize: 14 }}
                    >
                      {item.author.displayName}
                    </Text>
                    <FlairBadge flair={item.author.flair} size={11} />
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {item.author.vip ? <Text style={{ color: colors.warn }}>VIP  </Text> : null}
                      {isStaffRole(item.author.role) ? `${(ROLE_TAG[item.author.role] ?? "").toUpperCase()}  ` : ""}
                      {formatTime(item.createdAt)}
                    </Text>
                  </View>
                  {item.author.flair.title && <TitleText title={item.author.flair.title} size={10} />}
                  <Text style={{ color: colors.ink, marginTop: 2 }}>{item.body}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
      {(isModerator || messages?.some((m) => m.author.id === me.id)) && (
        <Text style={{ color: colors.muted, fontSize: 11, textAlign: "center", paddingBottom: 4 }}>
          {isModerator ? "Appui long sur un message pour le modérer" : "Appui long sur ton message pour le supprimer"}
        </Text>
      )}
      {error && <Text style={{ color: colors.danger, paddingHorizontal: 16, paddingBottom: 6 }}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.abyss }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          maxLength={GLOBAL_MESSAGE_MAX}
          placeholder="Écris un message à tous les joueurs"
          placeholderTextColor={colors.muted}
          style={{ flex: 1, color: colors.ink, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending} style={{ backgroundColor: colors.violet, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center", opacity: !draft.trim() || sending ? 0.4 : 1 }}>
          <Text style={{ color: "white", fontWeight: "700" }}>Envoyer</Text>
        </Pressable>
      </View>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
      <ModSheet
        message={moderating}
        onClose={() => setModerating(null)}
        onDeleted={(id) => setMessages((list) => list?.filter((x) => x.id !== id) ?? list)}
        onNotice={(text, ok) => setNotice({ text, ok })}
      />
    </KeyboardView>
  );
}
