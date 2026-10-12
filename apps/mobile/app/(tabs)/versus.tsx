import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { GAME_NAMES, GAME_SLUGS, type UserSummaryDto, type VersusMatchDto, type VersusStatsDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Avatar, Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";
import { VersusCard } from "@/components/VersusCard";

const LIVE = ["OPEN", "PENDING", "ACTIVE"];

/** Duels : défier un joueur au hasard ou un ami, répondre aux invitations, suivre ses duels. */
export default function VersusScreen() {
  const { me, loading } = useSession();
  const { onVersus } = useChat();
  const confirm = useConfirm();
  const [data, setData] = useState<{ matches: VersusMatchDto[]; stats: VersusStatsDto } | null>(null);
  const [friends, setFriends] = useState<UserSummaryDto[]>([]);
  const [game, setGame] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.versusList().then(setData, () => setData((d) => d ?? { matches: [], stats: { wins: 0, losses: 0, draws: 0 } }));
    api.friends().then(setFriends, () => setFriends([]));
  }, [me]);
  useFocusEffect(load);
  useEffect(() => onVersus(load), [onVersus, load]);

  const start = async (opponent: string) => {
    setBusy(true);
    setError(null);
    try {
      const m = await api.createVersus(opponent, game);
      router.push({ pathname: "/versus/[id]", params: { id: m.id } });
    } catch (e) {
      setError(errorMessage(e, "Le duel n'a pas pu être créé."));
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    load();
  };

  if (loading) return <Loading />;
  if (!me) {
    return (
      <View style={{ padding: 16 }}>
        <LoginRequired text="Connecte-toi pour défier d'autres joueurs." />
      </View>
    );
  }
  if (!data) return <Loading />;

  const invitations = data.matches.filter((m) => m.canAccept);
  const ongoing = data.matches.filter((m) => !m.canAccept && LIVE.includes(m.status));
  const done = data.matches.filter((m) => !LIVE.includes(m.status));
  const inProgress = ongoing.some((m) => m.status === "ACTIVE");

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Muted>
        Duel en direct : 5 clips, les mêmes pour les deux joueurs, au même moment. 30 secondes par manche (plus pour un clip long), puis les deux réponses
        sont dévoilées. Le meilleur total l&apos;emporte.
      </Muted>

      <Card style={{ flexDirection: "row", justifyContent: "space-around" }}>
        {([["Victoires", data.stats.wins, colors.success], ["Égalités", data.stats.draws, colors.ink], ["Défaites", data.stats.losses, colors.danger]] as const).map(
          ([label, value, color]) => (
            <View key={label} style={{ alignItems: "center" }}>
              <Text style={{ color, fontSize: 22, ...font.display }}>{value}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
            </View>
          ),
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Nouveau duel</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[["all", "Tous les jeux"] as const, ...GAME_SLUGS.map((s) => [s, GAME_NAMES[s]] as const)].map(([slug, name]) => (
            <Pressable
              key={slug}
              onPress={() => setGame(slug)}
              style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: game === slug ? colors.violet : colors.surface2 }}
            >
              <Text style={{ color: game === slug ? "white" : colors.muted, fontWeight: "600", fontSize: 13 }}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <PrimaryButton label="Trouver un adversaire" disabled={busy || inProgress} onPress={() => start("random")} />
        {inProgress && <Text style={{ color: colors.warn }}>Tu as un duel en cours : termine-le avant d&apos;en lancer un autre.</Text>}
        <Hud>Ou défie un ami</Hud>
        {friends.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {friends.map((f) => (
              <Pressable
                key={f.id}
                disabled={busy || inProgress}
                onPress={() => start(f.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 5, paddingLeft: 5, paddingRight: 12 }}
              >
                <Avatar name={f.displayName} url={f.avatarUrl} size={24} frame={f.flair.frame} />
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{f.displayName}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Muted>Ajoute des amis pour pouvoir les défier.</Muted>
        )}
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      </Card>

      {invitations.length > 0 && (
        <View style={{ gap: 10 }}>
          <Hud>Invitations reçues</Hud>
          {invitations.map((m) => (
            <VersusCard
              key={m.id}
              m={m}
              actions={
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label="Accepter et jouer"
                      onPress={() =>
                        run(async () => {
                          await api.acceptVersus(m.id);
                          router.push({ pathname: "/versus/[id]", params: { id: m.id } });
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <GhostButton label="Refuser" onPress={() => run(() => api.declineVersus(m.id))} />
                  </View>
                </View>
              }
            />
          ))}
        </View>
      )}

      <View style={{ gap: 10 }}>
        <Hud>En cours</Hud>
        {ongoing.length ? (
          ongoing.map((m) => (
            <VersusCard
              key={m.id}
              m={m}
              actions={
                (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        label={m.status === "ACTIVE" ? "Reprendre" : "Ouvrir"}
                        onPress={() => router.push({ pathname: "/versus/[id]", params: { id: m.id } })}
                      />
                    </View>
                    {m.canCancel && (
                      <View style={{ flex: 1 }}>
                        <GhostButton
                          label="Annuler"
                          danger
                          onPress={async () => {
                            const ok = await confirm({
                              title: "Annuler ce duel ?",
                              message: "Le duel n'a pas encore commencé : il sera annulé.",
                              confirmLabel: "Annuler le duel",
                              danger: true,
                            });
                            if (ok !== false) void run(() => api.cancelVersus(m.id));
                          }}
                        />
                      </View>
                    )}
                  </View>
                )
              }
            />
          ))
        ) : (
          <Muted>Aucun duel en cours.</Muted>
        )}
      </View>

      {done.length > 0 && (
        <View style={{ gap: 10 }}>
          <Hud>Historique</Hud>
          {done.map((m) => <VersusCard key={m.id} m={m} />)}
        </View>
      )}
    </ScrollView>
  );
}
