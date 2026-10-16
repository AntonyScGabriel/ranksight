import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { ROOM_MODE_LABEL, type RoomHistoryDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { RecentRoom } from "@/components/RecentRoom";
import { Card, GhostButton, Hud, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";

/** Historique des salons personnalisés et statistiques de victoires (séparées du classement compétitif). */
export default function RoomHistoryScreen() {
  const { me, loading } = useSession();
  const [data, setData] = useState<RoomHistoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!me) return;
    api.roomHistory().then(setData, (e) => setError(errorMessage(e, "L'historique n'a pas pu être chargé.")));
  }, [me]);

  const loadMore = async () => {
    if (!data?.nextCursor || more) return;
    setMore(true);
    try {
      const next = await api.roomHistory(data.nextCursor);
      setData({ ...next, items: [...data.items, ...next.items] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMore(false);
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour voir l'historique de tes salons." /></View>;
  if (error && !data) return <Message title="Historique indisponible" text={error} />;
  if (!data) return <Loading />;

  const open = (id: string) => router.push({ pathname: "/rooms/[id]", params: { id } });
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Muted>Parties personnalisées terminées (hors tournois). Ces résultats ne comptent pas pour le classement compétitif.</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {([
          ["Parties", data.stats.played],
          ["Victoires", data.stats.wins],
          ["Défaites", data.stats.played - data.stats.wins],
          ["Podiums", data.stats.podiums],
        ] as const).map(([label, value]) => (
          <Card key={label} style={{ flexBasis: "47%", flexGrow: 1, alignItems: "center", gap: 2 }}>
            <Hud>{label}</Hud>
            <Text style={{ color: colors.ink, fontSize: 24, ...font.display }}>{value}</Text>
          </Card>
        ))}
      </View>
      {data.stats.byMode.length > 0 && (
        <Card style={{ gap: 6 }}>
          <Hud>Par mode</Hud>
          {data.stats.byMode.map((m) => (
            <View key={m.mode} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.ink }}>{ROOM_MODE_LABEL[m.mode]}</Text>
              <Muted>{m.wins} victoire{m.wins > 1 ? "s" : ""} sur {m.played}</Muted>
            </View>
          ))}
        </Card>
      )}
      {data.items.length ? (
        data.items.map((r) => <RecentRoom key={r.id} r={r} onOpen={open} />)
      ) : (
        <Card style={{ gap: 10 }}>
          <Muted center>Aucune partie terminée pour l&apos;instant.</Muted>
          <PrimaryButton label="Trouver une partie" onPress={() => router.replace("/rooms")} />
        </Card>
      )}
      {data.nextCursor && <GhostButton label={more ? "Chargement…" : "Voir plus"} onPress={() => void loadMore()} />}
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
    </ScrollView>
  );
}
