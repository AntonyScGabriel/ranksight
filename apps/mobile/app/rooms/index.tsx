import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  GAME_NAMES, GAME_SLUGS, ROOM_DEFAULT_ROUNDS, ROOM_DEFAULT_TIME, ROOM_MAX_PLAYERS, ROOM_MODES, ROOM_MODE_LABEL, ROOM_ROUND_CHOICES, ROOM_RULES,
  ROOM_STATUS_LABEL, ROOM_TIME_CHOICES, ROOM_VISIBILITY_HINT, ROOM_VISIBILITY_LABEL, modeSettings, normalizeRoomCode,
  type GameSlug, type PublicRoomDto, type RoomMode, type RoomVisibility, type RoomsOverviewDto,
} from "@ranksight/shared";
import { api } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Card, GhostButton, Hud, Loading, LoginRequired, Muted, PrimaryButton } from "@/components/ui";
import { Chips } from "@/components/Chips";
import { QuickPlay } from "@/components/QuickPlay";
import { RecentRoom } from "@/components/RecentRoom";

const VISIBILITIES: readonly RoomVisibility[] = ["PUBLIC", "PRIVATE"];
const ALL = "" as const;

/**
 * Salons personnalisés (jamais classés) : « Jouer maintenant », salons publics, code d'un salon privé, création d'un salon
 * public (gratuit) ou privé (VIP), invitations reçues et dernières parties.
 */
export default function RoomsScreen() {
  const { me, loading } = useSession();
  const { onRoom } = useChat();
  const [data, setData] = useState<RoomsOverviewDto | null>(null);
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [rounds, setRounds] = useState<number>(ROOM_DEFAULT_ROUNDS);
  const [roundSec, setRoundSec] = useState<number>(ROOM_DEFAULT_TIME);
  const [suddenDeath, setSuddenDeath] = useState(true);
  const [mode, setMode] = useState<RoomMode>("CLASSIC");
  const [visibility, setVisibility] = useState<RoomVisibility>("PUBLIC");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!me) return;
    api.rooms().then(setData, () => setData((d) => d ?? { canHostPrivate: false, current: null, invites: [], recent: [] }));
  }, [me]);
  useFocusEffect(load);
  useEffect(() => onRoom(load), [onRoom, load]);

  const open = (id: string) => router.push({ pathname: "/rooms/[id]", params: { id } });

  const join = async (value: string) => {
    if (busy) return;
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
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      open((await api.createRoom({ game, visibility, rounds, roundSec, suddenDeath, ...modeSettings(mode) })).id);
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
        <LoginRequired text="Connecte-toi pour jouer dans un salon. Rejoindre un salon est gratuit." />
      </View>
    );
  }
  if (!data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Muted>
        Jusqu&apos;à {ROOM_MAX_PLAYERS} joueurs devinent le même clip au même moment. Parties personnalisées : de l&apos;XP, mais jamais de points
        au classement compétitif (réservé aux duels au hasard).
      </Muted>

      {data.current && (
        <Card style={{ gap: 10, borderColor: colors.neon }}>
          <Hud>{ROOM_STATUS_LABEL[data.current.status]} · {ROOM_VISIBILITY_LABEL[data.current.visibility]}</Hud>
          <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>
            Salon de {data.current.host} · {data.current.game.name} · {data.current.players}/{data.current.maxPlayers}
          </Text>
          <PrimaryButton label={data.current.status === "ACTIVE" ? "Reprendre la partie" : "Retourner au salon"} onPress={() => open(data.current!.id)} />
        </Card>
      )}

      {data.invites.map((i) => (
        <Card key={i.roomId} style={{ gap: 10 }}>
          <Hud>{i.rematch ? "Revanche" : "Invitation"}</Hud>
          <Text style={{ color: colors.ink }}>
            <Text style={{ fontWeight: "700" }}>{i.from}</Text> {i.rematch ? "propose une revanche" : "t'invite"} sur {i.game.name} · {i.players}/{i.maxPlayers} joueurs
          </Text>
          <PrimaryButton label={i.rematch ? "Accepter la revanche" : "Rejoindre"} disabled={busy} onPress={() => join(i.code)} />
          <GhostButton label="Ignorer" onPress={() => void api.declineRoomInvite(i.roomId).catch(() => undefined).then(load)} />
        </Card>
      ))}

      <QuickPlay />

      <PublicRooms onOpen={open} />

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Rejoindre avec un code</Text>
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
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Créer un salon</Text>
        <Hud>Visibilité</Hud>
        <Chips value={visibility} options={VISIBILITIES} onChange={setVisibility} label={(v) => (v === "PRIVATE" ? "Privé · VIP" : "Public · gratuit")} />
        <Muted>{ROOM_VISIBILITY_HINT[visibility]}</Muted>
        <Hud>Mode</Hud>
        <Chips value={mode} options={ROOM_MODES} onChange={setMode} label={(m) => ROOM_MODE_LABEL[m]} />
        {mode === "IMPOSTOR" && <Muted>Un joueur reçoit un autre clip sans le savoir ; après les réponses, tout le monde vote pour le démasquer. 4 joueurs minimum.</Muted>}
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
        {visibility === "PUBLIC" || data.canHostPrivate ? (
          <PrimaryButton label={busy ? "Création…" : visibility === "PUBLIC" ? "Créer le salon public" : "Créer le salon privé"} disabled={busy} onPress={create} />
        ) : (
          <View style={{ gap: 10, borderWidth: 1, borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}14`, borderRadius: 12, padding: 12 }}>
            <Text style={{ color: colors.ink, lineHeight: 20 }}>
              Un salon privé est réservé aux joueurs VIP. Les salons publics restent gratuits, et tes amis rejoignent toujours sans VIP.
            </Text>
            <GhostButton label={Platform.OS === "android" ? "Devenir VIP" : "Mon VIP"} onPress={() => router.push("/shop")} />
          </View>
        )}
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      </Card>

      <Pressable onPress={() => router.push("/tournaments")} accessibilityRole="button" accessibilityLabel="Tournois privés">
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Tournois privés · 4 à 16 joueurs</Text>
            <Muted>Tableau à élimination directe entre amis. Seul le créateur doit être VIP.</Muted>
          </View>
          <Text style={{ color: colors.neon, fontSize: 20 }}>›</Text>
        </Card>
      </Pressable>

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {ROOM_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>

      <View style={{ gap: 8 }}>
        <Hud>Dernières parties</Hud>
        {data.recent.length ? data.recent.map((r) => <RecentRoom key={r.id} r={r} onOpen={open} />) : <Muted>Aucune partie terminée pour l&apos;instant.</Muted>}
        <GhostButton label="Historique et statistiques" onPress={() => router.push("/rooms/history")} />
      </View>
    </ScrollView>
  );
}

/** Salons publics : filtres jeu, mode et places disponibles ; actualisés en direct et toutes les 15 s. */
function PublicRooms({ onOpen }: { onOpen: (id: string) => void }) {
  const { onRoom } = useChat();
  const [game, setGame] = useState<GameSlug | typeof ALL>(ALL);
  const [mode, setMode] = useState<RoomMode | typeof ALL>(ALL);
  const [available, setAvailable] = useState(true);
  const [rooms, setRooms] = useState<PublicRoomDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(() => {
    api.publicRooms({ game: game || undefined, mode: mode || undefined, available }).then(
      (r) => { setRooms(r); setError(null); },
      (e) => setError(errorMessage(e, "La liste des salons n'a pas pu être chargée.")),
    );
  }, [game, mode, available]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    const off = onRoom(load);
    return () => { clearInterval(t); off(); };
  }, [load, onRoom]);

  const join = async (id: string) => {
    if (joining) return;
    setJoining(id);
    setError(null);
    try {
      onOpen((await api.joinPublicRoom(id)).id);
    } catch (e) {
      setError(errorMessage(e, "Impossible de rejoindre ce salon."));
      load();
    } finally {
      setJoining(null);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Salons publics</Text>
      <Hud>Jeu</Hud>
      <Chips value={game} options={[ALL, ...GAME_SLUGS]} onChange={setGame} label={(s) => (s ? GAME_NAMES[s] : "Tous")} />
      <Hud>Mode</Hud>
      <Chips value={mode} options={[ALL, ...ROOM_MODES]} onChange={setMode} label={(m) => (m ? ROOM_MODE_LABEL[m] : "Tous")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ color: colors.ink, flex: 1 }}>Places disponibles seulement</Text>
        <Switch value={available} onValueChange={setAvailable} trackColor={{ true: colors.violet, false: colors.line }} accessibilityLabel="Places disponibles seulement" />
      </View>
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      {!rooms ? (
        <Muted>Chargement des salons…</Muted>
      ) : rooms.length === 0 ? (
        <Muted>Aucun salon public ne correspond. Lance « Jouer maintenant » ou crée un salon public : il apparaîtra ici.</Muted>
      ) : (
        rooms.map((r) => (
          <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>{r.game.name} · {ROOM_MODE_LABEL[r.mode]}</Text>
              <Muted>Salon de {r.host} · {r.rounds} manches · {r.roundSec} s · {r.players}/{r.maxPlayers} · {ROOM_STATUS_LABEL[r.status]}</Muted>
            </View>
            {r.joinable ? (
              <GhostButton label={joining === r.id ? "…" : "Rejoindre"} onPress={() => void join(r.id)} />
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>{r.status === "ACTIVE" ? "En cours" : "Complet"}</Text>
            )}
          </View>
        ))
      )}
      <GhostButton label="Actualiser" onPress={load} />
    </Card>
  );
}
