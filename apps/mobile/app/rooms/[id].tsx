import { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import {
  ROOM_MIN_PLAYERS, ROOM_RULES, formatRoomCode, type RoomDto, type RoomPlayerDto, type RoomRoundDto, type UserSummaryDto,
} from "@ranksight/shared";
import { api, WEB_URL } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useLiveRoom } from "@/lib/rooms";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { FlairBadge } from "@/components/Flair";
import { LiveRound, TimerBar } from "@/components/LiveRound";
import { RankEmblem } from "@/components/RankEmblem";
import { Avatar, Card, GhostButton, Hud, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";

/** Salon privé : salle d'attente, manches synchronisées, révélations, classement final. */
export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { me, loading } = useSession();
  const confirm = useConfirm();
  const live = useLiveRoom(id, !!me);
  const { room, phase } = live;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: room?.live ? `Manche ${room.live.round}/${room.rounds}` : room?.status === "LOBBY" ? "Salle d'attente" : "Salon privé" });
  }, [navigation, room]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "players" in r) live.apply(r as RoomDto);
      else live.load();
    } catch (e) {
      setError(errorMessage(e));
      live.load();
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour rejoindre ce salon. Pas besoin d'être VIP." /></View>;
  if (live.missing) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Salon introuvable" text="Ce salon n'existe pas ou tu n'en fais pas partie.">
          <GhostButton label="Salons privés" onPress={() => router.replace("/rooms")} />
        </Message>
      </View>
    );
  }
  if (!room) return <Loading />;

  const leave = async () => {
    const playing = room.status === "ACTIVE";
    const ok = await confirm({
      title: playing ? "Quitter la partie ?" : "Quitter le salon ?",
      message: playing ? "Tu gardes tes points, mais tu ne pourras plus répondre ni revenir dans la partie." : "Tu pourras revenir avec le code tant que la partie n'a pas commencé.",
      confirmLabel: "Quitter",
      danger: true,
    });
    if (ok === false) return;
    await act(async () => {
      await api.leaveRoom(id);
      if (!playing) router.replace("/rooms");
    });
  };
  const canLeave = (room.status === "LOBBY" || room.status === "ACTIVE") && !room.left;

  if (phase === "playing") {
    return (
      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        {live.clip ? (
          <LiveRound
            key={live.clip.playToken}
            clip={live.clip}
            secondsLeft={live.secondsLeft}
            progress={live.roundProgress}
            onSubmitted={() => live.markSubmitted(live.clip!.position)}
            onClosed={live.load}
          />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const lastRound = room.details.at(-1);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      {live.offline && <Text style={{ color: colors.warn, textAlign: "center" }}>Connexion perdue : reconnexion en cours…</Text>}
      {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}

      {phase === "lobby" && <Lobby room={room} meId={me.id} act={act} />}

      {phase === "countdown" && room.live && (
        <>
          {lastRound && <RoundReveal round={lastRound} players={room.players} meId={me.id} />}
          <Card style={{ alignItems: "center", gap: 4 }}>
            <Hud>{room.live.round === 1 ? "La partie commence" : `Manche ${room.live.round}/${room.rounds}`}</Hud>
            <Text style={{ color: colors.neon, fontSize: 56, ...font.display }}>{live.secondsLeft}</Text>
          </Card>
        </>
      )}

      {(phase === "answered" || phase === "timeout") && room.live && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            {phase === "timeout" && !room.live.answered ? "Temps écoulé !" : "Réponse envoyée"}
          </Text>
          <Muted center>
            {room.players.filter((p) => !p.left && p.answered).length}/{room.players.filter((p) => !p.left).length} joueurs ont répondu.
          </Muted>
          <TimerBar progress={live.roundProgress} />
        </Card>
      )}

      {phase === "left" && <Message title="Tu as quitté la partie" text="Tes points sont conservés. Le classement final s'affichera ici à la fin de la partie." />}

      {room.status === "ACTIVE" && <Scoreboard room={room} meId={me.id} />}

      {phase === "over" && <FinalResult room={room} meId={me.id} />}

      {canLeave && <GhostButton label="Quitter" danger onPress={leave} />}
    </ScrollView>
  );
}

function PlayerName({ p, meId }: { p: RoomPlayerDto; meId: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
      <Text style={{ flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>{p.id === meId ? "Toi" : p.displayName}</Text>
      <FlairBadge flair={p.flair} size={10} />
      {p.vip && <Text style={{ color: "black", backgroundColor: colors.warn, borderRadius: 3, paddingHorizontal: 4, fontSize: 9, fontWeight: "800", overflow: "hidden" }}>VIP</Text>}
      {p.isHost && <Text style={{ color: colors.warn, fontSize: 12 }} accessibilityLabel="Hôte du salon">★</Text>}
    </View>
  );
}

function Lobby({ room, meId, act }: { room: RoomDto; meId: string; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const [friends, setFriends] = useState<UserSummaryDto[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.friends().then(setFriends, () => setFriends([]));
  }, []);
  const active = room.players.filter((p) => !p.left);
  const free = room.maxPlayers - active.length;
  const invitable = friends.filter((f) => !room.players.some((p) => p.id === f.id));
  const host = room.players.find((p) => p.isHost);
  const code = formatRoomCode(room.code);

  return (
    <>
      <Card style={{ alignItems: "center", gap: 8 }}>
        <Hud>Code du salon</Hud>
        <Text selectable style={{ color: colors.neon, fontSize: 34, fontWeight: "700", letterSpacing: 5 }}>{code}</Text>
        <Muted center>{room.game.name} · {room.rounds} manches · {room.roundSec} s · rejoindre est gratuit</Muted>
        <View style={{ alignSelf: "stretch" }}>
          <GhostButton
            label="Partager l'invitation"
            onPress={() => void Share.share({ message: `Rejoins mon salon RankGuess sur ${room.game.name} : code ${code}\n${WEB_URL}/rooms/join/${code}` })}
          />
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Joueurs</Text>
          <Text style={{ color: colors.muted }}>{active.length}/{room.maxPlayers} · {free > 0 ? `${free} libre${free > 1 ? "s" : ""}` : "complet"}</Text>
        </View>
        {active.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={p.displayName} url={p.avatarUrl} size={34} frame={p.flair.frame} />
            <PlayerName p={p} meId={meId} />
            {room.isHost && p.id !== meId && (
              <Pressable onPress={() => act(() => api.kickFromRoom(room.id, p.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Retirer ${p.displayName}`}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Retirer</Text>
              </Pressable>
            )}
          </View>
        ))}
        {room.isHost ? (
          <>
            <PrimaryButton label="Lancer la partie" disabled={!room.canStart} onPress={() => act(() => api.startRoom(room.id))} />
            {!room.canStart && <Muted center>Il faut au moins {ROOM_MIN_PLAYERS} joueurs pour lancer la partie.</Muted>}
          </>
        ) : (
          <Muted center>En attente du lancement par {host?.displayName ?? "l'hôte"}…</Muted>
        )}
      </Card>

      {invitable.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Inviter des amis</Text>
          {invitable.map((f) => (
            <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Avatar name={f.displayName} url={f.avatarUrl} size={28} />
              <Text style={{ flex: 1, color: colors.ink }} numberOfLines={1}>{f.displayName}</Text>
              <Pressable
                disabled={invited.has(f.id) || free === 0}
                onPress={() => act(async () => {
                  await api.inviteToRoom(room.id, f.id);
                  setInvited((s) => new Set(s).add(f.id));
                })}
                style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, opacity: invited.has(f.id) || free === 0 ? 0.5 : 1 }}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{invited.has(f.id) ? "Invité ✓" : "Inviter"}</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
        {ROOM_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>
    </>
  );
}

function Scoreboard({ room, meId }: { room: RoomDto; meId: string }) {
  return (
    <Card style={{ gap: 8 }}>
      <Hud>{room.game.name} · classement en direct</Hud>
      {room.players.map((p, i) => (
        <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: p.left ? 0.5 : 1 }}>
          <Text style={{ width: 18, color: colors.muted, textAlign: "right" }}>{i + 1}</Text>
          <Avatar name={p.displayName} url={p.avatarUrl} size={26} frame={p.flair.frame} />
          <PlayerName p={p} meId={meId} />
          {p.left ? <Text style={{ color: colors.muted, fontSize: 12 }}>parti</Text> : p.answered ? <Text style={{ color: colors.success }}>✓</Text> : null}
          <Text style={{ width: 44, textAlign: "right", color: colors.ink, ...font.display }}>{p.score}</Text>
        </View>
      ))}
    </Card>
  );
}

function RoundReveal({ round, players, meId }: { round: RoomRoundDto; players: RoomPlayerDto[]; meId: string }) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ alignItems: "center", gap: 3 }}>
        <Hud>Manche {round.position} · rang réel</Hud>
        <RankEmblem rank={round.correctRank} size={56} />
        <Text style={{ color: round.correctRank.color, fontWeight: "800" }}>{round.correctRank.name}</Text>
      </View>
      {players.map((p) => {
        const a = round.answers.find((x) => x.userId === p.id);
        return (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <PlayerName p={p} meId={meId} />
            <Text style={{ color: colors.muted }} numberOfLines={1}>{a ? a.rank.name : "—"}</Text>
            <Text style={{ width: 44, textAlign: "right", color: a && a.score > 0 ? colors.success : colors.muted, fontWeight: "700" }}>+{a?.score ?? 0}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function FinalResult({ room, meId }: { room: RoomDto; meId: string }) {
  if (room.status === "CLOSED") {
    return (
      <Message title="Salon fermé" text="Ce salon a été fermé avant le lancement de la partie.">
        <PrimaryButton label="Salons privés" onPress={() => router.replace("/rooms")} />
      </Message>
    );
  }
  const me = room.players.find((p) => p.id === meId);
  const winners = room.players.filter((p) => p.placement === 1);
  return (
    <>
      <Card style={{ alignItems: "center", gap: 4 }}>
        <Hud>Partie terminée · {room.game.name}</Hud>
        <Text style={{ color: me?.placement === 1 ? colors.success : colors.ink, fontSize: 26, ...font.display }}>
          {me?.placement === 1 ? (winners.length > 1 ? "Victoire partagée !" : "Victoire !") : me?.placement ? `${me.placement}e place` : "Partie terminée"}
        </Text>
        <Muted center>{winners.length > 1 ? `Égalité en tête : ${winners.map((w) => w.displayName).join(", ")}` : `Vainqueur : ${winners[0]?.displayName ?? "—"}`}</Muted>
      </Card>
      <Card style={{ gap: 10 }}>
        {room.players.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => router.push({ pathname: "/player/[id]", params: { id: p.id } })}
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <Text style={{ width: 22, textAlign: "center", color: p.placement === 1 ? colors.neon : colors.muted, ...font.display }}>{p.placement ?? "—"}</Text>
            <Avatar name={p.displayName} url={p.avatarUrl} size={30} frame={p.flair.frame} />
            <PlayerName p={p} meId={meId} />
            <Text style={{ color: colors.ink, fontSize: 18, ...font.display }}>{p.score}</Text>
          </Pressable>
        ))}
      </Card>
      {room.details.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Manche par manche</Text>
          {room.details.map((d) => (
            <View key={d.position} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <RankEmblem rank={d.correctRank} size={26} />
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{d.position}. <Text style={{ color: d.correctRank.color }}>{d.correctRank.name}</Text></Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {room.players.map((p) => {
                  const a = d.answers.find((x) => x.userId === p.id);
                  return `${p.id === meId ? "Toi" : p.displayName} : ${a ? `${a.rank.name} (${a.score})` : "—"}`;
                }).join(" · ")}
              </Text>
            </View>
          ))}
        </Card>
      )}
      <PrimaryButton label="Nouveau salon" onPress={() => router.replace("/rooms")} />
    </>
  );
}
