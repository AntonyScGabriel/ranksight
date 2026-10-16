import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  GAME_NAMES, GAME_SLUGS, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_MAX_PLAYERS, ROOM_ROUND_CHOICES, ROOM_RULES, ROOM_STATUS_LABEL,
  ROOM_TIME_CHOICES, TOKEN_REASON_LABEL, normalizeRoomCode, type GameSlug, type RoomsOverviewDto, type TokensDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";
import { Chips } from "@/components/Chips";


type Format = "solo" | "teams2" | "teams3" | "impostor";
const FORMATS: readonly Format[] = ["solo", "teams2", "teams3", "impostor"];
const FORMAT_LABEL: Record<Format, string> = { solo: "Chacun pour soi", teams2: "2 contre 2", teams3: "3 contre 3", impostor: "Intrus" };

/** Salons privés : rejoindre avec un code (gratuit), créer un salon (VIP), invitations reçues, dernières parties. */
export default function RoomsScreen() {
  const { me, loading } = useSession();
  const { onRoom } = useChat();
  const [data, setData] = useState<RoomsOverviewDto | null>(null);
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [rounds, setRounds] = useState<number>(ROOM_DEFAULT_ROUNDS);
  const [roundSec, setRoundSec] = useState<number>(ROOM_DEFAULT_TIME);
  const [suddenDeath, setSuddenDeath] = useState(true);
  const [confidence, setConfidence] = useState(false);
  const [format, setFormat] = useState<Format>("solo");
  const [tokens, setTokens] = useState<TokensDto | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.rooms().then(setData, () => setData((d) => d ?? { canHost: false, current: null, invites: [], recent: [] }));
    api.tokens().then(setTokens, () => undefined);
  }, [me]);
  useFocusEffect(load);
  useEffect(() => onRoom(load), [onRoom, load]);

  const open = (id: string) => router.push({ pathname: "/rooms/[id]", params: { id } });

  const join = async (value: string) => {
    setJoinError(null);
    const normalized = normalizeRoomCode(value);
    if (!normalized) {
      setJoinError("Le code fait 8 caractères (lettres et chiffres), par exemple K7QM-2XPA.");
      return;
    }
    setBusy(true);
    try {
      open((await api.joinRoom(normalized)).id);
    } catch (e) {
      setJoinError(errorMessage(e, "Impossible de rejoindre ce salon."));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      open((await api.createRoom({
        game, rounds, roundSec, suddenDeath,
        confidence: format !== "impostor" && confidence,
        teamSize: format === "teams2" ? 2 : format === "teams3" ? 3 : 0,
        impostor: format === "impostor",
      })).id);
    } catch (e) {
      setError(errorMessage(e, "Le salon n'a pas pu être créé."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!me) {
    return (
      <View style={{ padding: 16 }}>
        <LoginRequired text="Connecte-toi pour créer ou rejoindre un salon privé. Rejoindre un salon est gratuit." />
      </View>
    );
  }
  if (!data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Muted>
        Jusqu&apos;à {ROOM_MAX_PLAYERS} amis devinent le même clip au même moment. Seul le joueur qui crée le salon doit être VIP : rejoindre, jouer et
        voir les résultats est gratuit pour tout le monde.
      </Muted>

      <Pressable onPress={() => router.push("/tournaments")} accessibilityRole="button" accessibilityLabel="Tournois privés">
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Tournois privés · 4 à 16 joueurs</Text>
            <Muted>Tableau à élimination directe entre amis. Seul le créateur doit être VIP.</Muted>
          </View>
          <Text style={{ color: colors.neon, fontSize: 20 }}>›</Text>
        </Card>
      </Pressable>

      {data.current && (
        <Card style={{ gap: 10, borderColor: colors.neon }}>
          <Hud>{ROOM_STATUS_LABEL[data.current.status]}</Hud>
          <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>
            Salon de {data.current.host} · {data.current.game.name} · {data.current.players}/{data.current.maxPlayers}
          </Text>
          <PrimaryButton label={data.current.status === "ACTIVE" ? "Reprendre la partie" : "Retourner au salon"} onPress={() => open(data.current!.id)} />
        </Card>
      )}

      {data.invites.map((i) => (
        <Card key={i.roomId} style={{ gap: 10 }}>
          <Hud>Invitation</Hud>
          <Text style={{ color: colors.ink }}>
            <Text style={{ fontWeight: "700" }}>{i.from}</Text> t&apos;invite sur {i.game.name} · {i.players}/{i.maxPlayers} joueurs
          </Text>
          <PrimaryButton label="Rejoindre" disabled={busy} onPress={() => join(i.code)} />
          <GhostButton label="Ignorer" onPress={() => void api.declineRoomInvite(i.roomId).catch(() => undefined).then(load)} />
        </Card>
      ))}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Rejoindre un salon</Text>
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
          accessibilityLabel="Code du salon"
          style={{ color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, padding: 12, fontSize: 18, letterSpacing: 3, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
          onSubmitEditing={() => void join(code)}
        />
        {joinError && <Text style={{ color: colors.danger }}>{joinError}</Text>}
        <PrimaryButton label="Rejoindre" disabled={busy || !code.trim()} onPress={() => void join(code)} />
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Créer un salon</Text>
          <Text style={{ color: "black", backgroundColor: colors.warn, borderRadius: 4, paddingHorizontal: 5, fontSize: 10, fontWeight: "800", overflow: "hidden" }}>VIP</Text>
        </View>
        <Hud>Format</Hud>
        <Chips value={format} options={FORMATS} onChange={setFormat} label={(f) => FORMAT_LABEL[f]} />
        {format === "impostor" && <Muted>Un joueur reçoit un autre clip sans le savoir ; après les réponses, tout le monde vote pour le démasquer. 4 joueurs minimum.</Muted>}
        <Hud>Jeu</Hud>
        <Chips value={game} options={GAME_SLUGS} onChange={setGame} label={(s) => GAME_NAMES[s]} />
        <Hud>Manches</Hud>
        <Chips value={rounds} options={ROOM_ROUND_CHOICES} onChange={setRounds} label={(n) => String(n)} />
        <Hud>Temps de réponse</Hud>
        <Chips value={roundSec} options={ROOM_TIME_CHOICES} onChange={setRoundSec} label={(n) => `${n} s`} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "700" }}>Mort subite</Text>
            <Muted>En cas d&apos;égalité en tête, manche décisive entre les ex aequo.</Muted>
          </View>
          <Switch value={suddenDeath} onValueChange={setSuddenDeath} trackColor={{ true: colors.violet, false: colors.line }} accessibilityLabel="Mort subite" />
        </View>
        {format !== "impostor" && <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "700" }}>Mode Confiance</Text>
            <Muted>Chaque réponse engage 1 à 3 jetons virtuels, jamais achetables.</Muted>
          </View>
          <Switch value={confidence} onValueChange={setConfidence} trackColor={{ true: colors.violet, false: colors.line }} accessibilityLabel="Mode Confiance" />
        </View>}
        {data.canHost ? (
          <PrimaryButton label="Créer le salon" disabled={busy} onPress={create} />
        ) : (
          <View style={{ gap: 10, borderWidth: 1, borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}14`, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: colors.ink, lineHeight: 20 }}>
              Créer un salon est réservé aux joueurs VIP. Tes amis n&apos;ont pas besoin d&apos;être VIP : ils rejoignent et jouent gratuitement.
            </Text>
            <GhostButton label={Platform.OS === "android" ? "Devenir VIP" : "Mon VIP"} onPress={() => router.push("/shop")} />
          </View>
        )}
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      </Card>

      {tokens && (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Mes jetons</Text>
              <Muted>Virtuels : ni achat, ni retrait, ni échange.</Muted>
            </View>
            <Text style={{ color: colors.warn, fontSize: 28, fontWeight: "800" }}>{tokens.balance}</Text>
          </View>
          {tokens.canRefill && (
            <GhostButton
              label={`Recharge gratuite du jour (jusqu'à ${tokens.refillTo})`}
              onPress={() => void api.refillTokens().then(setTokens, (e) => setError(errorMessage(e)))}
            />
          )}
          {tokens.history.slice(0, 5).map((t) => (
            <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.muted, flex: 1 }} numberOfLines={1}>{TOKEN_REASON_LABEL[t.reason]}{t.round ? ` · manche ${t.round}` : ""}</Text>
              <Text style={{ color: t.delta >= 0 ? colors.success : colors.danger, fontWeight: "700" }}>{t.delta >= 0 ? `+${t.delta}` : t.delta}</Text>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {ROOM_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>

      {data.recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <Hud>Dernières parties</Hud>
          {data.recent.map((r) => (
            <Pressable key={r.id} onPress={() => open(r.id)} accessibilityRole="button">
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
                <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>Salon de {r.host} · {r.game.name} · {r.players} joueurs</Text>
                <Text style={{ color: r.placement === 1 ? colors.neon : colors.muted, fontWeight: "700" }}>
                  {r.placement === 1 ? "Victoire" : r.placement ? `${r.placement}e` : "Terminé"}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
