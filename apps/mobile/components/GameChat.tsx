import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { GAME_CHAT_MAX, TEAM_COLORS, TEAM_NAMES, type GameChatMessageDto, type GameChatScope } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { colors } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { Card, Hud } from "./ui";
import { ReportSheet, type ReportTarget } from "./ReportSheet";

/**
 * Tchat d'un salon (salle d'attente et partie) ou d'un tournoi. En duel par équipes, l'onglet « Équipe » n'est lu que
 * par ses coéquipiers. Messages en direct par la connexion du chat ; relus à la reconnexion.
 */
/**
 * `team` : équipe actuelle du joueur dans le salon ; quand elle change, le tchat est relu (canal de la nouvelle équipe).
 * Appui long sur un message : le signaler, le supprimer (le sien, ou tout message pour l'organisateur du tournoi et l'équipe) ;
 * tournoi : réduire son auteur au silence ou lui rendre la parole (`mutedIds`, puis `onModerated` relit le tournoi).
 */
export function GameChat({ scope, id, meId, team = null, mutedIds = [], onModerated }: {
  scope: GameChatScope; id: string; meId: string; team?: number | null; mutedIds?: string[]; onModerated?: () => void;
}) {
  const { onGameChat, onConnect } = useChat();
  const [messages, setMessages] = useState<GameChatMessageDto[]>([]);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [myTeam, setMyTeam] = useState<number | null>(null);
  const [tab, setTab] = useState<"all" | "team">("all");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const list = useRef<ScrollView>(null);

  const load = useCallback(() => {
    api.gameChat(scope, id).then((c) => {
      setMessages(c.messages);
      setOpen(c.open);
      setMuted(c.muted);
      setCanModerate(c.canModerate);
      setMyTeam(c.myTeam);
    }, () => undefined);
  }, [scope, id]);

  useEffect(() => {
    load();
    const offConnect = onConnect(load);
    const offMessage = onGameChat((e) => {
      if (e.scope !== scope || e.id !== id) return;
      if (e.deletedId) setMessages((m) => m.filter((x) => x.id !== e.deletedId));
      const message = e.message;
      if (message) setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message].slice(-200)));
    });
    return () => {
      offConnect();
      offMessage();
    };
  }, [load, onConnect, onGameChat, scope, id]);

  useEffect(() => {
    if (team !== myTeam) load();
  }, [team, myTeam, load]);

  const shown = messages.filter((m) => (tab === "team" ? m.team !== null : m.team === null));

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await api.sendGameChat(scope, id, body, tab === "team");
      setMessages((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      setText("");
    } catch (e) {
      setError(errorMessage(e, "Message non envoyé."));
    } finally {
      setSending(false);
    }
  };

  /** Appui long : actions sur le message (supprimer ; tournoi : réduire au silence ou rendre la parole) */
  const actions = (m: GameChatMessageDto) => {
    const mine = m.author.id === meId;
    const isMuted = mutedIds.includes(m.author.id);
    const run = (fn: () => Promise<unknown>, fail: string) => () => void fn().catch((e) => setError(errorMessage(e, fail)));
    Alert.alert(mine ? "Ton message" : `Message de ${m.author.displayName}`, m.body, [
      ...(!mine ? [{ text: "Signaler", onPress: () => setReporting({ id: m.author.id, name: m.author.displayName, gameMessageId: m.id }) }] : []),
      ...(mine || canModerate ? [{ text: "Supprimer", style: "destructive" as const, onPress: run(async () => {
        await api.deleteGameChat(scope, id, m.id);
        setMessages((l) => l.filter((x) => x.id !== m.id));
      }, "Message non supprimé.") }] : []),
      ...(canModerate && scope === "tournament" && !mine
        ? [{ text: isMuted ? "Rendre la parole" : "Réduire au silence", onPress: run(async () => {
          await api.muteInTournament(id, m.author.id, !isMuted);
          onModerated?.();
        }, "Action impossible.") }]
        : []),
      { text: "Annuler", style: "cancel" as const },
    ]);
  };

  const teamColor = myTeam ? TEAM_COLORS[myTeam as 1 | 2] : colors.violet;
  return (
    <Card style={{ gap: 10 }} testID="game-chat">
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Hud>Tchat</Hud>
        {myTeam && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["all", "team"] as const).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}
                style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: tab === t ? `${t === "team" ? teamColor : colors.violet}33` : "transparent" }}>
                <Text style={{ color: tab === t ? colors.ink : colors.muted, fontSize: 12, fontWeight: "700" }}>{t === "all" ? "Salon" : `Équipe (${TEAM_NAMES[myTeam as 1 | 2]?.toLowerCase()})`}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <ScrollView ref={list} style={{ maxHeight: 220 }} nestedScrollEnabled onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}>
        {shown.length === 0 && <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 16 }}>{tab === "team" ? "Rien encore dans le canal de ton équipe." : "Aucun message pour l'instant. Dis bonjour !"}</Text>}
        {shown.map((m) => (
          <Text key={m.id} onLongPress={() => actions(m)} style={{ color: colors.ink, marginBottom: 6 }}>
            <Text style={{ fontWeight: "700", color: m.author.id === meId ? colors.neon : colors.ink }}>{m.author.id === meId ? "Toi" : m.author.displayName}</Text>
            {mutedIds.includes(m.author.id) && <Text style={{ color: colors.warn }}> 🔇</Text>}
            <Text style={{ color: colors.muted, fontSize: 11 }}> · {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}{"\n"}</Text>
            {m.body}
          </Text>
        ))}
      </ScrollView>
      {open ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput value={text} onChangeText={setText} maxLength={GAME_CHAT_MAX} placeholder={tab === "team" ? "Message à ton équipe…" : "Message…"} placeholderTextColor={colors.muted}
            onSubmitEditing={send} returnKeyType="send" style={{ flex: 1, color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }} />
          <Pressable onPress={send} disabled={!text.trim() || sending} accessibilityRole="button" style={{ borderRadius: 10, backgroundColor: colors.violet, paddingHorizontal: 14, justifyContent: "center", opacity: !text.trim() || sending ? 0.5 : 1 }}>
            <Text style={{ color: "white", fontWeight: "700" }}>Envoyer</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center" }}>{muted ? "Tu as été réduit au silence dans ce tchat." : "Tchat fermé."}</Text>
      )}
      {error && <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text>}
    </Card>
  );
}
