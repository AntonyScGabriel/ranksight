import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { ACHIEVEMENT_CATEGORY_LABEL, COSMETIC_TYPE_LABEL, type AchievementCategory, type PublicProfileDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Avatar, Card, GhostButton, Hud, Loading, Message, PrimaryButton } from "@/components/ui";
import { BadgeChip, FlairBadge, TitleText } from "@/components/Flair";
import { ReportSheet } from "@/components/ReportSheet";

/** Profil public d'un joueur : statistiques, succès, ajout en ami, duel et message. */
export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { me } = useSession();
  const confirm = useConfirm();
  const [p, setP] = useState<PublicProfileDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(() => {
    api.profile(id).then(
      (profile) => {
        setP(profile);
        navigation.setOptions({ title: profile.displayName });
      },
      () => setMissing(true),
    );
  }, [id, navigation]);
  useEffect(load, [load, me]);

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
      load();
    } catch (e) {
      setNotice({ text: errorMessage(e, "Action impossible pour le moment."), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const challenge = async () => {
    if (!p) return;
    setBusy(true);
    setNotice(null);
    try {
      const m = await api.createVersus(p.id, "all");
      router.push({ pathname: "/versus/[id]", params: { id: m.id } });
    } catch (e) {
      setNotice({ text: errorMessage(e, "Le duel n'a pas pu être créé."), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const unfriend = async () => {
    if (!p) return;
    const ok = await confirm({
      title: "Retirer cet ami ?",
      message: `${p.displayName} ne fera plus partie de tes amis et votre conversation ne sera plus accessible.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (ok !== false) void act(() => api.removeFriend(p.id), `${p.displayName} a été retiré de tes amis.`);
  };

  const block = async () => {
    if (!p) return;
    const ok = await confirm({
      title: `Bloquer ${p.displayName} ?`,
      message: "Vous ne serez plus amis, il ne pourra plus t'écrire, t'envoyer de demande d'ami ni te défier, et tu ne verras plus ses messages dans le chat global.",
      confirmLabel: "Bloquer",
      danger: true,
    });
    if (ok !== false) void act(() => api.block(p.id), `${p.displayName} est bloqué.`);
  };

  if (missing) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Joueur introuvable" text="Ce compte n'existe pas ou a été supprimé." />
      </View>
    );
  }
  if (!p) return <Loading />;

  const stats: [string, string | number][] = [
    ["Niveau", p.level],
    ["Réponses", p.stats.totalGuesses],
    ["Rangs exacts", p.stats.totalGuesses ? `${Math.round(p.stats.exactRate * 100)} %` : "—"],
    ["Record victoires", p.stats.bestWinStreak],
    ["Meilleure série", `${p.stats.bestDailyStreak} j`],
    ["Record Infini", p.stats.infiniteBest],
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Card style={{ alignItems: "center", gap: 10 }}>
        <Avatar name={p.displayName} url={p.avatarUrl} size={84} frame={p.flair.frame} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 24, ...font.display }}>
            {p.displayName}
            {p.vip ? <Text style={{ color: colors.warn, fontSize: 14 }}>  VIP</Text> : null}
          </Text>
          <FlairBadge flair={p.flair} size={15} />
        </View>
        {p.flair.title && <TitleText title={p.flair.title} size={12} />}
        <Text style={{ color: colors.muted, fontSize: 12 }}>Membre depuis le {new Date(p.createdAt).toLocaleDateString("fr-FR")}</Text>

        <View style={{ alignSelf: "stretch", gap: 8 }}>
          {p.relation === null && <PrimaryButton label="Se connecter pour l'ajouter" onPress={() => router.push("/login")} />}
          {p.relation === "self" && <GhostButton label="Modifier mon profil" onPress={() => router.push("/profile")} />}
          {p.relation === "none" && (
            <PrimaryButton label="Ajouter en ami" disabled={busy} onPress={() => act(() => api.sendFriendRequest(p.id), "Demande d'ami envoyée.")} />
          )}
          {p.relation === "request_sent" && (
            <GhostButton label="Demande envoyée · Annuler" onPress={() => !busy && act(() => api.declineFriend(p.id), "Demande annulée.")} />
          )}
          {p.relation === "request_received" && (
            <>
              <PrimaryButton
                label="Accepter la demande"
                disabled={busy}
                onPress={() => act(() => api.acceptFriend(p.id), `${p.displayName} fait maintenant partie de tes amis.`)}
              />
              <GhostButton label="Refuser" onPress={() => !busy && act(() => api.declineFriend(p.id), "Demande refusée.")} />
            </>
          )}
          {p.relation === "friends" && (
            <>
              <PrimaryButton label="Défier en duel" disabled={busy} onPress={challenge} />
              <GhostButton label="Envoyer un message" onPress={() => router.push({ pathname: "/chat/[id]", params: { id: p.id, name: p.displayName } })} />
              <GhostButton label="Retirer des amis" danger onPress={() => !busy && void unfriend()} />
            </>
          )}
        </View>
        {notice && <Text style={{ color: notice.ok ? colors.success : colors.danger, textAlign: "center" }}>{notice.text}</Text>}
        {p.relation !== null && p.relation !== "self" && (
          <View style={{ flexDirection: "row", gap: 24 }}>
            <Text onPress={() => setReporting(true)} style={{ color: colors.muted }}>Signaler</Text>
            {p.blockedByMe ? (
              <Text onPress={() => !busy && act(() => api.unblock(p.id), `${p.displayName} est débloqué.`)} style={{ color: colors.muted }}>Débloquer</Text>
            ) : (
              <Text onPress={() => !busy && void block()} style={{ color: colors.muted }}>Bloquer</Text>
            )}
          </View>
        )}
      </Card>
      <ReportSheet target={reporting ? { id: p.id, name: p.displayName } : null} onClose={() => setReporting(false)} />

      <Card style={{ gap: 8 }}>
        <Hud>Bilan des duels</Hud>
        <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
          {([["Victoires", p.versus.wins, colors.success], ["Égalités", p.versus.draws, colors.ink], ["Défaites", p.versus.losses, colors.danger]] as const).map(
            ([label, value, color]) => (
              <View key={label} style={{ alignItems: "center" }}>
                <Text style={{ color, fontSize: 22, ...font.display }}>{value}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
              </View>
            ),
          )}
        </View>
      </Card>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {stats.map(([k, v]) => (
          <Card key={k} style={{ width: "48%", padding: 14, gap: 4 }}>
            <Hud>{k}</Hud>
            <Text style={{ color: colors.ink, fontSize: 24, ...font.display }}>{v}</Text>
          </Card>
        ))}
      </View>

      {p.collection.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Titres et badges ({p.collection.length})</Text>
          <View style={{ gap: 8 }}>
            {p.collection.map((c) => (
              <View key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: `${c.color}55`, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
                {c.type === "BADGE" ? <BadgeChip badge={{ name: c.name, color: c.color, icon: c.icon }} size={11} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.color }} />}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.color, fontWeight: "600", fontSize: 13 }}>
                    {c.name} <Text style={{ color: colors.muted, fontWeight: "400", fontSize: 11 }}>· {COSMETIC_TYPE_LABEL[c.type]}</Text>
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{c.hint}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Succès obtenus ({p.achievements.length})</Text>
        {p.achievements.length ? (
          p.achievements.map((a) => (
            <View key={a.code} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Text style={{ fontSize: 18 }}>{a.category === "SEASON" ? "👑" : "🏆"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{a.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {ACHIEVEMENT_CATEGORY_LABEL[a.category as AchievementCategory] ?? a.category} · {new Date(a.unlockedAt).toLocaleDateString("fr-FR")}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={{ color: colors.muted }}>Aucun succès pour l&apos;instant.</Text>
        )}
      </Card>
    </ScrollView>
  );
}
