import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import {
  GAME_NAMES, RATING_SCOPES, tierByKey,
  type GameSlug, type RatingScope, type RatingSeasonsDto, type SeasonArchiveDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Chips } from "@/components/Chips";
import { Avatar, Card, Hud, Loading, LoginRequired, Message, Muted } from "@/components/ui";

const scopeName = (s: RatingScope) => (s === "global" ? "Global" : GAME_NAMES[s as GameSlug]);
const place = (n: number) => (n === 1 ? "1re" : `${n}e`);

/** Archives du classement compétitif : classement final de chaque saison terminée et résultats du joueur. */
export default function RatingSeasonsScreen() {
  const { me, loading } = useSession();
  const [data, setData] = useState<RatingSeasonsDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<RatingScope>("global");
  const [archive, setArchive] = useState<SeasonArchiveDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api.ratingSeasons().then(
      (d) => { setData(d); setSelected(d.past[0]?.key ?? null); },
      (e) => setError(errorMessage(e, "Les archives n'ont pas pu être chargées.")),
    );
  }, [me]);
  useEffect(() => {
    if (!selected) return;
    api.ratingArchive(selected, scope).then(setArchive, (e) => setError(errorMessage(e)));
  }, [selected, scope]);

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour voir les saisons précédentes." /></View>;
  if (error && !data) return <Message title="Archives indisponibles" text={error} />;
  if (!data) return <Loading />;
  if (!data.past.length) {
    return <Message title="Aucune saison terminée" text="Le classement de la saison en cours sera archivé ici à sa fin." />;
  }

  const shown = archive && archive.season.key === selected && archive.scope === scope ? archive : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Muted>À la fin de chaque saison, le classement est archivé et chaque cote repart au seuil du rang atteint.</Muted>

      {data.mine.length > 0 && (
        <Card style={{ gap: 6 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Mes résultats</Text>
          {data.mine.flatMap((m) => m.results.map((r) => {
            const t = tierByKey(r.tier);
            const name = data.past.find((s) => s.key === m.season)?.name ?? m.season;
            return (
              <View key={`${m.season}-${r.scope}`} style={{ gap: 2, borderTopWidth: 1, borderColor: colors.line, paddingTop: 6 }}>
                <Text style={{ color: colors.ink }}>{name} · {scopeName(r.scope)}</Text>
                <Muted>
                  <Text style={{ color: t.color }}>{t.name}</Text> · {r.rating} · {r.placement ? `${place(r.placement)} place` : "non classé"} · {r.wins} V / {r.losses} D · saison suivante : {r.resetTo}
                </Muted>
              </View>
            );
          }))}
        </Card>
      )}

      <Hud>Saison</Hud>
      <Chips value={selected ?? data.past[0]!.key} options={data.past.map((s) => s.key)} onChange={setSelected} label={(k) => data.past.find((s) => s.key === k)?.name ?? k} />
      <Hud>Classement</Hud>
      <Chips value={scope} options={RATING_SCOPES} onChange={setScope} label={scopeName} />

      <Card style={{ gap: 8 }}>
        {!shown ? (
          <Loading />
        ) : shown.entries.length === 0 ? (
          <Muted center>Aucun joueur classé dans ce classement pour cette saison.</Muted>
        ) : (
          shown.entries.map((e) => {
            const t = tierByKey(e.tier);
            return (
              <Pressable
                key={e.userId}
                onPress={() => router.push({ pathname: "/player/[id]", params: { id: e.userId } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: e.userId === me.id ? `${colors.violet}1A` : "transparent", borderRadius: 8, padding: 4 }}
              >
                <Text style={{ width: 26, textAlign: "right", color: colors.muted, ...font.display }}>{e.placement}</Text>
                <Avatar name={e.displayName} url={e.avatarUrl} size={24} />
                <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>{e.displayName}</Text>
                <Text style={{ color: t.color, fontSize: 12 }}>{t.name}</Text>
                <Text style={{ width: 52, textAlign: "right", color: colors.ink, ...font.display }}>{e.rating}</Text>
              </Pressable>
            );
          })
        )}
      </Card>
    </ScrollView>
  );
}
