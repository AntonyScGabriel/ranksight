import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import {
  GAME_NAMES, RATING_MIN_GAMES, RATING_RULES, RATING_SCOPES, RATING_START, ratingTier,
  type GameSlug, type MyRatingsDto, type RatingBoardDto, type RatingScope,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { Chips } from "@/components/Chips";
import { Avatar, Card, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";

const scopeName = (s: RatingScope) => (s === "global" ? "Global" : GAME_NAMES[s as GameSlug]);

/** Classement compétitif : cote Elo globale et par jeu (duels au hasard), ma cote et mes derniers duels classés. */
export default function RankedScreen() {
  const { me, loading } = useSession();
  const [scope, setScope] = useState<RatingScope>("global");
  const [board, setBoard] = useState<RatingBoardDto | null>(null);
  const [mine, setMine] = useState<MyRatingsDto | null>(null);

  const load = useCallback(() => {
    api.ratingBoard(scope).then(setBoard, () => setBoard({ scope, entries: [], me: null }));
  }, [scope]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);
  useEffect(() => {
    if (me) api.myRatings().then(setMine, () => setMine({ ratings: [], history: [] }));
  }, [me]);

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour voir le classement compétitif." /></View>;

  const shown = board?.scope === scope ? board : null;
  const my = shown?.me;
  const tier = ratingTier(my?.rating ?? RATING_START);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Muted>Ta cote monte et descend avec tes duels « au hasard ». Les parties entre amis ne comptent pas, et le VIP n&apos;apporte aucun point.</Muted>
      <Chips value={scope} options={RATING_SCOPES} onChange={setScope} label={scopeName} />

      <Card style={{ alignItems: "center", gap: 4 }}>
        <Hud>Ma cote · {scopeName(scope)}</Hud>
        <Text style={{ color: colors.ink, fontSize: 40, ...font.display }}>{my?.rating ?? RATING_START}</Text>
        <Text style={{ color: tier.color, fontWeight: "700" }}>{tier.name}</Text>
        <Muted center>
          {my
            ? my.rank
              ? `${my.rank === 1 ? "1re" : `${my.rank}e`} place · ${my.wins} V / ${my.losses} D / ${my.draws} N · record ${my.peak}`
              : `${my.games}/${RATING_MIN_GAMES} duels pour apparaître dans le classement`
            : "Pas encore de duel classé ici."}
        </Muted>
        <View style={{ alignSelf: "stretch" }}>
          <PrimaryButton label="Lancer un duel au hasard" onPress={() => router.push("/versus")} />
        </View>
      </Card>

      <Card style={{ gap: 8 }}>
        {!shown ? (
          <Loading />
        ) : shown.entries.length ? (
          shown.entries.map((e) => {
            const t = ratingTier(e.rating);
            return (
              <Pressable
                key={e.userId}
                onPress={() => router.push({ pathname: "/player/[id]", params: { id: e.userId } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: e.userId === me.id ? `${colors.violet}1A` : "transparent", borderRadius: 8, padding: 4 }}
              >
                <Text style={{ width: 26, textAlign: "right", color: colors.muted, ...font.display }}>{e.rank}</Text>
                <Avatar name={e.displayName} url={e.avatarUrl} size={26} frame={e.flair.frame} />
                <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>{e.displayName}</Text>
                <Text style={{ color: t.color, fontSize: 12 }}>{t.name}</Text>
                <Text style={{ width: 52, textAlign: "right", color: colors.ink, ...font.display }}>{e.rating}</Text>
              </Pressable>
            );
          })
        ) : (
          <Muted center>Personne n&apos;a encore {RATING_MIN_GAMES} duels classés ici.</Muted>
        )}
      </Card>

      {mine && mine.history.length > 0 && (
        <Card style={{ gap: 6 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Mes derniers duels classés</Text>
          {mine.history.map((h) => (
            <View key={`${h.matchId}-${h.scope}`} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>
                {h.result === "WIN" ? "Victoire" : h.result === "LOSS" ? "Défaite" : "Nul"} contre {h.opponent} · {scopeName(h.scope)}
              </Text>
              <Text style={{ color: !h.counted ? colors.muted : h.delta > 0 ? colors.success : h.delta < 0 ? colors.danger : colors.muted }}>
                {h.counted ? `${h.delta > 0 ? "+" : ""}${h.delta}` : "—"}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {RATING_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>
    </ScrollView>
  );
}
