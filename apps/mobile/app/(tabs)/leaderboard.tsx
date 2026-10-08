import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { io } from "socket.io-client";
import { GAME_NAMES, GAME_SLUGS, type LeaderboardEntryDto, type LeaderboardGame, type SeasonDto } from "@ranksight/shared";
import { API_ORIGIN, api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Avatar, Loading, LoginRequired } from "@/components/ui";
import { FlairBadge, TitleText } from "@/components/Flair";

const SCOPES = [["global", "Global"], ["friends", "Amis"]] as const;
const PERIODS = [["daily", "Jour"], ["weekly", "Sem."], ["season", "Saison"], ["all_time", "Total"], ["infinite", "Infini"]] as const;
const GAMES: [LeaderboardGame, string][] = [["all", "Tous les jeux"], ...GAME_SLUGS.map((s) => [s, GAME_NAMES[s]] as [LeaderboardGame, string])];

export default function LeaderboardScreen() {
  const { me, loading } = useSession();
  const [scope, setScope] = useState("global");
  const [period, setPeriod] = useState("daily");
  const [game, setGame] = useState<LeaderboardGame>("all");
  // Le mode Infini n'a qu'un classement, tous jeux confondus
  const effectiveGame: LeaderboardGame = period === "infinite" ? "all" : game;
  const [entries, setEntries] = useState<LeaderboardEntryDto[]>([]);
  const [mine, setMine] = useState<{ rank: number; score: number } | null>(null);
  const [seasons, setSeasons] = useState<SeasonDto[]>([]);
  const [seasonKey, setSeasonKey] = useState("");
  const season = seasons.find((s) => s.key === seasonKey) ?? seasons[0];
  const pastSeason = period === "season" && season && !season.current ? season.key : undefined;

  useEffect(() => {
    if (me) api.seasons().then(setSeasons).catch(() => setSeasons([]));
  }, [me]);

  const load = useCallback(() => {
    api
      .leaderboard(period, scope, effectiveGame, pastSeason)
      .then((d) => {
        setEntries(d.entries);
        setMine(d.me);
      })
      .catch(() => undefined);
  }, [period, scope, effectiveGame, pastSeason]);

  useEffect(() => {
    if (!me) return;
    load();
    // Saison terminée : classement définitif, pas de temps réel
    if (pastSeason) return;
    // Temps réel : le serveur signale un changement, on recharge
    const socket = io(`${API_ORIGIN}/ws/leaderboards`, { transports: ["websocket"] });
    api.leaderboardKeys(effectiveGame).then((keys) => keys[period] && socket.emit("subscribe", keys[period])).catch(() => undefined);
    socket.on("lb:changed", load);
    return () => {
      socket.disconnect();
    };
  }, [me, period, effectiveGame, pastSeason, load]);

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired text="Connecte-toi pour voir les classements." /></View>;

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Segmented items={SCOPES} value={scope} onChange={setScope} />
      <Segmented items={PERIODS} value={period} onChange={setPeriod} small />
      {period === "season" && season && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>{season.label}</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {season.current ? `Se termine le ${new Date(season.endsAt).toLocaleDateString("fr-FR", { timeZone: "UTC" })} à minuit (UTC). Le 1er remporte le succès « Champion de saison ».` : "Saison terminée : classement définitif."}
          </Text>
          {seasons.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
              {seasons.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => setSeasonKey(s.key)}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: s.key === season.key ? colors.violet : colors.line }}
                >
                  <Text style={{ color: s.key === season.key ? colors.ink : colors.muted, fontSize: 12, fontWeight: "600" }}>Saison {s.number}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
      {period !== "infinite" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
          {GAMES.map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setGame(k)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: game === k ? colors.violet : colors.line, backgroundColor: game === k ? `${colors.violet}33` : "transparent" }}
            >
              <Text style={{ color: game === k ? colors.ink : colors.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {mine && <Text style={{ color: colors.neon, fontWeight: "700" }}>Ta position : #{mine.rank} · {mine.score} pts</Text>}
      <FlatList
        data={entries}
        keyExtractor={(e) => e.userId}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/player/[id]", params: { id: item.userId } })}
            accessibilityRole="button"
            accessibilityLabel={`Voir le profil de ${item.username}`}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ width: 28, color: item.rank <= 3 ? colors.neon : colors.muted, fontWeight: "700" }}>{item.rank}</Text>
            <Avatar name={item.username} url={item.avatarUrl} size={32} frame={item.flair.frame} />
            <View style={{ flex: 1, gap: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ flexShrink: 1, color: item.userId === me.id ? colors.violetSoft : colors.ink, fontWeight: "600" }} numberOfLines={1}>
                  {item.username}
                  {item.vip ? <Text style={{ color: colors.warn, fontSize: 11 }}>  VIP</Text> : null}
                </Text>
                <FlairBadge flair={item.flair} size={11} />
              </View>
              {item.flair.title && <TitleText title={item.flair.title} size={10} />}
            </View>
            <Text style={{ color: colors.ink, fontVariant: ["tabular-nums"] }}>{item.score}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40 }} onPress={scope === "friends" ? () => router.push("/friends") : undefined}>
            {scope === "friends" ? "Ajoute des amis pour comparer vos scores." : "Personne n'a encore marqué de points sur cette période."}
          </Text>
        }
      />
    </View>
  );
}

function Segmented({ items, value, onChange, small }: { items: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12, padding: 4 }}>
      {items.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ flex: 1, paddingVertical: small ? 6 : 8, borderRadius: 9, backgroundColor: value === k ? colors.violet : "transparent" }}>
          <Text style={{ color: value === k ? "white" : colors.muted, textAlign: "center", fontWeight: "600", fontSize: small ? 12 : 14 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
