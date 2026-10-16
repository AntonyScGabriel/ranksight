import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  GAME_NAMES, GAME_SLUGS, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_MAX_PLAYERS, ROOM_ROUND_CHOICES, ROOM_RULES, ROOM_STATUS_LABEL,
  ROOM_TIME_CHOICES, normalizeRoomCode, type GameSlug, type RoomsOverviewDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";

/** Choix parmi quelques valeurs (jeu, manches, temps) */
function Chips<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: (v: T) => string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.chip, borderWidth: 1.5, borderColor: active ? colors.neon : colors.line, backgroundColor: active ? `${colors.neon}1A` : colors.surface2 }}
          >
            <Text style={{ color: active ? colors.neon : colors.ink, fontWeight: "600" }}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Salons privés : rejoindre avec un code (gratuit), créer un salon (VIP), invitations reçues, dernières parties. */
export default function RoomsScreen() {
  const { me, loading } = useSession();
  const { onRoom } = useChat();
  const [data, setData] = useState<RoomsOverviewDto | null>(null);
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [rounds, setRounds] = useState<number>(ROOM_DEFAULT_ROUNDS);
  const [roundSec, setRoundSec] = useState<number>(ROOM_DEFAULT_TIME);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.rooms().then(setData, () => setData((d) => d ?? { canHost: false, current: null, invites: [], recent: [] }));
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
      open((await api.createRoom({ game, rounds, roundSec })).id);
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
        <Hud>Jeu</Hud>
        <Chips value={game} options={GAME_SLUGS} onChange={setGame} label={(s) => GAME_NAMES[s]} />
        <Hud>Manches</Hud>
        <Chips value={rounds} options={ROOM_ROUND_CHOICES} onChange={setRounds} label={(n) => String(n)} />
        <Hud>Temps de réponse</Hud>
        <Chips value={roundSec} options={ROOM_TIME_CHOICES} onChange={setRoundSec} label={(n) => `${n} s`} />
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
