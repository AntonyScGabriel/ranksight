import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  ALL_GAMES, GAME_NAMES, GAME_SLUGS, ROOM_TIME_CHOICES, TOURNAMENT_CAPACITIES, TOURNAMENT_ROUND_CHOICES, TOURNAMENT_RULES, TOURNAMENT_STATUS_LABEL, tournamentRewardLabel,
  normalizeRoomCode, type GameSlug, type TournamentSummaryDto, type TournamentsOverviewDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Chips } from "@/components/Chips";
import { Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";

/** Tournois privés : s'inscrire avec un code (gratuit), créer un tournoi (VIP), tournois en cours et terminés. */
export default function TournamentsScreen() {
  const { me, loading } = useSession();
  const { onTournament } = useChat();
  const [data, setData] = useState<TournamentsOverviewDto | null>(null);
  // « Tous les jeux » : chaque manche tire un clip de n'importe quel jeu
  const [game, setGame] = useState<GameSlug | typeof ALL_GAMES.slug>(GAME_SLUGS[0]);
  const [capacity, setCapacity] = useState<number>(8);
  const [rounds, setRounds] = useState<number>(3);
  const [roundSec, setRoundSec] = useState<number>(30);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.tournaments().then(setData, () => setData((d) => d ?? { canHost: false, current: [], recent: [], events: [], public: [] }));
  }, [me]);
  useFocusEffect(load);
  useEffect(() => onTournament(load), [onTournament, load]);

  const open = (id: string) => router.push({ pathname: "/tournaments/[id]", params: { id } });

  const join = async () => {
    setJoinError(null);
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setJoinError("Le code fait 8 caractères (lettres et chiffres), par exemple K7QM-2XPA.");
      return;
    }
    setBusy(true);
    try {
      open((await api.joinTournament(normalized)).id);
    } catch (e) {
      setJoinError(errorMessage(e, "Impossible de s'inscrire à ce tournoi."));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      open((await api.createTournament({ game, capacity, rounds, roundSec, visibility })).id);
    } catch (e) {
      setError(errorMessage(e, "Le tournoi n'a pas pu être créé."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour créer un tournoi ou t'inscrire à celui d'un ami. L'inscription est gratuite." /></View>;
  if (!data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Muted>
        Tableau à élimination directe jusqu&apos;à 16 joueurs, chaque match en duel direct. Seul le créateur du tournoi doit être VIP : s&apos;inscrire,
        jouer et gagner est gratuit.
      </Muted>

      {data.public.length > 0 && <Hud>Tournois publics ouverts</Hud>}
      {data.public.map((t) => <Row key={t.id} t={t} onPress={() => open(t.id)} />)}

      {data.events.length > 0 && <Hud>Événements RankGuess</Hud>}
      {data.events.map((t) => <Row key={t.id} t={t} onPress={() => open(t.id)} />)}

      {data.current.map((t) => <Row key={t.id} t={t} onPress={() => open(t.id)} />)}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>S&apos;inscrire</Text>
          <Text style={{ color: colors.success, fontSize: 11, fontWeight: "800" }}>GRATUIT</Text>
        </View>
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="K7QM-2XPA"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          accessibilityLabel="Code du tournoi"
          style={{ color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, padding: 12, fontSize: 18, letterSpacing: 3, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
          onSubmitEditing={() => void join()}
        />
        {joinError && <Text style={{ color: colors.danger }}>{joinError}</Text>}
        <PrimaryButton label="S'inscrire" disabled={busy || !code.trim()} onPress={() => void join()} />
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Créer un tournoi</Text>
          <Text style={{ color: "black", backgroundColor: colors.warn, borderRadius: 4, paddingHorizontal: 5, fontSize: 10, fontWeight: "800", overflow: "hidden" }}>VIP</Text>
        </View>
        <Hud>Jeu</Hud>
        <Chips value={game} options={[...GAME_SLUGS, ALL_GAMES.slug]} onChange={setGame} label={(s) => (s === ALL_GAMES.slug ? ALL_GAMES.name : GAME_NAMES[s])} />
        <Hud>Places</Hud>
        <Chips value={capacity} options={TOURNAMENT_CAPACITIES} onChange={setCapacity} label={(n) => `${n} joueurs`} />
        <Hud>Manches par match</Hud>
        <Chips value={rounds} options={TOURNAMENT_ROUND_CHOICES} onChange={setRounds} label={(n) => String(n)} />
        <Hud>Temps de réponse</Hud>
        <Chips value={roundSec} options={ROOM_TIME_CHOICES} onChange={setRoundSec} label={(n) => `${n} s`} />
        <Hud>Visibilité</Hud>
        <Chips value={visibility} options={["PRIVATE", "PUBLIC"] as const} onChange={setVisibility} label={(v) => (v === "PUBLIC" ? "Public" : "Privé (code)")} />
        <Muted>{visibility === "PUBLIC" ? "Listé dans les tournois publics : tout le monde peut s'inscrire." : "Seuls ceux qui ont le code peuvent s'inscrire."}</Muted>
        {data.canHost ? (
          <PrimaryButton label="Créer le tournoi" disabled={busy} onPress={create} />
        ) : (
          <View style={{ gap: 10, borderWidth: 1, borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}14`, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: colors.ink, lineHeight: 20 }}>
              Créer un tournoi est réservé aux joueurs VIP. Tes amis n&apos;ont pas besoin d&apos;être VIP pour s&apos;inscrire et jouer.
            </Text>
            <GhostButton label={Platform.OS === "android" ? "Devenir VIP" : "Mon VIP"} onPress={() => router.push("/shop")} />
          </View>
        )}
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      </Card>

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {TOURNAMENT_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>

      {data.recent.length > 0 && <Hud>Derniers tournois</Hud>}
      {data.recent.map((t) => <Row key={t.id} t={t} onPress={() => open(t.id)} />)}
    </ScrollView>
  );
}

function Row({ t, onPress }: { t: TournamentSummaryDto; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: t.isEvent ? "700" : "400" }} numberOfLines={1}>{t.isEvent ? `🏆 ${t.title}` : `Tournoi de ${t.host}`} · {t.game.name} · {t.players}/{t.capacity}</Text>
          {t.reward && <Text style={{ color: colors.warn, fontSize: 12 }} numberOfLines={1}>Récompense : {tournamentRewardLabel(t.reward)}</Text>}
        </View>
        <Text style={{ color: t.placement === 1 ? colors.neon : colors.muted, fontWeight: "700" }}>
          {t.status === "FINISHED" ? (t.placement === 1 ? "Vainqueur" : t.placement ? `${t.placement}e` : "Terminé") : TOURNAMENT_STATUS_LABEL[t.status]}
        </Text>
      </Card>
    </Pressable>
  );
}
