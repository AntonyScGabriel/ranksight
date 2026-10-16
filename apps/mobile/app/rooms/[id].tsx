import { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import {
  DECIDED_BY_LABEL, IMPOSTOR_MIN_PLAYERS, IMPOSTOR_RULES, ROOM_MIN_PLAYERS, ROOM_RULES, SUDDEN_DEATH_RULES, TEAM_COLORS, TEAM_NAMES, TEAM_RULES, ROOM_MODE_LABEL, ROOM_VISIBILITY_LABEL, formatRoomCode, type RoomDto, type RoomPlayerDto, type RoomRoundDto, type UserSummaryDto,
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

/** Salon (public ou privé) : salle d'attente, manches synchronisées, révélations, classement final, revanche. */
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
          <GhostButton label="Salons" onPress={() => router.replace("/rooms")} />
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
            label={room.live?.suddenDeath ? "Mort subite" : undefined}
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
            <Hud>{room.live.round === 1 ? "La partie commence" : room.live.suddenDeath ? "Mort subite · manche décisive" : `Manche ${room.live.round}/${room.rounds}`}</Hud>
            <Text style={{ color: colors.neon, fontSize: 56, ...font.display }}>{live.secondsLeft}</Text>
            {room.live.suddenDeath && (
              <Muted center>Égalité en tête : {room.players.filter((p) => p.finalist).map((p) => (p.id === me.id ? "toi" : p.displayName)).join(" contre ")}.</Muted>
            )}
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

      {phase === "spectating" && room.live && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.warn, fontSize: 18, fontWeight: "700", textAlign: "center" }}>Mort subite</Text>
          <Muted center>{room.players.filter((p) => p.finalist).map((p) => p.displayName).join(" contre ")} se départagent : seuls les joueurs à égalité en tête répondent.</Muted>
          <TimerBar progress={live.roundProgress} />
        </Card>
      )}

      {phase === "voting" && room.live && <VotePanel room={room} meId={me.id} act={act} secondsLeft={live.secondsLeft} progress={live.roundProgress} />}

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
      {p.team ? <View accessibilityLabel={TEAM_NAMES[p.team]} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: TEAM_COLORS[p.team] }} /> : null}
      <Text style={{ flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>{p.id === meId ? "Toi" : p.displayName}</Text>
      <FlairBadge flair={p.flair} size={10} />
      {p.vip && <Text style={{ color: "black", backgroundColor: colors.warn, borderRadius: 3, paddingHorizontal: 4, fontSize: 9, fontWeight: "800", overflow: "hidden" }}>VIP</Text>}
      {p.isHost && <Text style={{ color: colors.warn, fontSize: 12 }} accessibilityLabel="Hôte du salon">★</Text>}
      {p.finalist && <Text style={{ color: colors.warn, fontSize: 10, fontWeight: "800" }} accessibilityLabel="Dispute la mort subite">MS</Text>}
    </View>
  );
}

function TeamTotals({ room }: { room: RoomDto }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignSelf: "stretch" }}>
      {room.teams.map((t) => (
        <View key={t.team} style={{ flex: 1, alignItems: "center", borderWidth: 1, borderColor: `${TEAM_COLORS[t.team]}88`, borderRadius: 10, padding: 8 }}>
          <Text style={{ color: TEAM_COLORS[t.team], fontSize: 12, fontWeight: "700" }}>{t.name}{t.placement === 1 && room.status === "FINISHED" ? " 🏆" : ""}</Text>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>{t.score}</Text>
        </View>
      ))}
    </View>
  );
}

function Lobby({ room, meId, act }: { room: RoomDto; meId: string; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const confirm = useConfirm();
  const kick = async (p: RoomPlayerDto) => {
    const ok = await confirm({ title: `Retirer ${p.displayName} ?`, message: "Ce joueur ne pourra plus revenir dans ce salon.", confirmLabel: "Retirer", danger: true });
    if (ok !== false) await act(() => api.kickFromRoom(room.id, p.id));
  };
  const close = async () => {
    const ok = await confirm({ title: "Fermer le salon ?", message: "Tous les joueurs sortiront de la salle d'attente.", confirmLabel: "Fermer", danger: true });
    if (ok === false) return;
    await act(async () => {
      await api.closeRoom(room.id);
      router.replace("/rooms");
    });
  };
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
        <Hud>Salon {ROOM_VISIBILITY_LABEL[room.visibility].toLowerCase()} · code</Hud>
        <Text selectable style={{ color: colors.neon, fontSize: 34, fontWeight: "700", letterSpacing: 5 }}>{code}</Text>
        <Muted center>{room.game.name} · {ROOM_MODE_LABEL[room.mode]} · {room.rounds} manches · {room.roundSec} s{room.suddenDeath ? " · mort subite" : ""} · rejoindre est gratuit</Muted>
        <Muted center>
          {room.visibility === "PUBLIC"
            ? "Visible dans la liste des salons publics : n'importe quel joueur peut rejoindre tant qu'il reste de la place."
            : "Invisible dans les listes : seuls tes amis invités et ceux qui ont le code peuvent entrer."} Partie non classée.
        </Muted>
        {room.vipOnly && <Text style={{ color: colors.warn, textAlign: "center" }}>Mode VIP (mort subite) : seuls les joueurs VIP peuvent rejoindre ce salon.</Text>}
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
        {room.teamSize ? ([1, 2] as const).map((t) => {
          const members = active.filter((p) => p.team === t);
          const mine = room.players.find((p) => p.id === meId)?.team;
          return (
            <View key={t} style={{ gap: 6, borderWidth: 1, borderColor: `${TEAM_COLORS[t]}88`, borderRadius: 12, padding: 10 }}>
              <Text style={{ color: TEAM_COLORS[t], fontWeight: "800" }}>{TEAM_NAMES[t]} · {members.length}/{room.teamSize}</Text>
              {members.map((p) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Avatar name={p.displayName} url={p.avatarUrl} size={28} frame={p.flair.frame} />
                  <PlayerName p={p} meId={meId} />
                  {room.isHost && p.id !== meId && (
                    <Pressable onPress={() => act(() => api.setRoomTeam(room.id, t === 1 ? 2 : 1, p.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Changer ${p.displayName} d'équipe`}>
                      <Text style={{ color: colors.muted }}>⇄</Text>
                    </Pressable>
                  )}
                </View>
              ))}
              {mine !== t && members.length < room.teamSize! && (
                <GhostButton label={`Rejoindre ${TEAM_NAMES[t]?.toLowerCase()}`} onPress={() => void act(() => api.setRoomTeam(room.id, t))} />
              )}
            </View>
          );
        }) : active.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={p.displayName} url={p.avatarUrl} size={34} frame={p.flair.frame} />
            <PlayerName p={p} meId={meId} />
            {room.isHost && p.id !== meId && (
              <Pressable onPress={() => void kick(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Retirer ${p.displayName}`}>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Retirer</Text>
              </Pressable>
            )}
          </View>
        ))}
        {room.isHost ? (
          <>
            <PrimaryButton label="Lancer la partie" disabled={!room.canStart} onPress={() => act(() => api.startRoom(room.id))} />
            <GhostButton label="Fermer le salon" danger onPress={() => void close()} />
            {!room.canStart && (
              <Muted center>
                {room.teamSize ? `Il faut ${room.teamSize} joueurs dans chaque équipe pour lancer la partie.` : `Il faut au moins ${room.impostor ? IMPOSTOR_MIN_PLAYERS : ROOM_MIN_PLAYERS} joueurs pour lancer la partie.`}
              </Muted>
            )}
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
        {[...ROOM_RULES, ...(room.impostor ? IMPOSTOR_RULES : []), ...(room.teamSize ? TEAM_RULES : []), ...(room.suddenDeath ? SUDDEN_DEATH_RULES : [])].map((r) => <Muted key={r}>• {r}</Muted>)}
      </Card>
    </>
  );
}

function Scoreboard({ room, meId }: { room: RoomDto; meId: string }) {
  return (
    <Card style={{ gap: 8 }}>
      <Hud>{room.game.name} · classement en direct</Hud>
      {room.teamSize ? <TeamTotals room={room} /> : null}
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

/** Mode Intrus : vote d'après les rangs proposés par chacun (sans rang réel ni points), jamais pour soi. */
function VotePanel({
  room, meId, act, secondsLeft, progress,
}: { room: RoomDto; meId: string; act: (a: () => Promise<unknown>) => Promise<void>; secondsLeft: number; progress: number }) {
  const live = room.live!;
  const inGame = room.players.filter((p) => !p.left);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Hud>Manche {live.round} · vote</Hud>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Qui a vu un autre clip ?</Text>
        </View>
        <Text style={{ color: secondsLeft <= 5 ? colors.danger : colors.ink, fontSize: 22, ...font.display }}>{secondsLeft} s</Text>
      </View>
      <TimerBar progress={progress} />
      <Muted>Compare les rangs proposés : l&apos;intrus a regardé un clip d&apos;un autre rang. {live.voted.length}/{inGame.length} votes.</Muted>
      {inGame.map((p) => {
        const g = live.guesses.find((x) => x.userId === p.id);
        const mine = live.myVote === p.id;
        return (
          <Pressable
            key={p.id}
            disabled={p.id === meId || !!live.myVote}
            onPress={() => act(() => api.voteInRoom(room.id, p.id))}
            accessibilityRole="button"
            accessibilityState={{ selected: mine, disabled: p.id === meId || !!live.myVote }}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: mine ? colors.neon : colors.line, backgroundColor: mine ? `${colors.neon}1A` : colors.surface2 }}
          >
            <Avatar name={p.displayName} url={p.avatarUrl} size={28} frame={p.flair.frame} />
            <PlayerName p={p} meId={meId} />
            {g ? <Text style={{ color: g.rank.color, fontWeight: "700" }}>{g.rank.name}</Text> : <Text style={{ color: colors.muted }}>—</Text>}
            {live.voted.includes(p.id) && <Text style={{ color: colors.success }}>✓</Text>}
          </Pressable>
        );
      })}
      <Muted>{live.myVote ? `Ton vote : ${room.players.find((p) => p.id === live.myVote)?.displayName ?? "?"}.` : "Choisis un joueur (pas toi). Un seul vote par manche."}</Muted>
    </Card>
  );
}

/** Mode Intrus : qui était l'intrus, son clip, les votes et les points du vote. */
function ImpostorReveal({ round, players, meId }: { round: RoomRoundDto; players: RoomPlayerDto[]; meId: string }) {
  const imp = round.impostor!;
  const nameOf = (id: string) => (id === meId ? "toi" : players.find((p) => p.id === id)?.displayName ?? "un joueur parti");
  const against = imp.votes.filter((v) => v.targetId === imp.userId).length;
  const pts = imp.bonuses[0]?.points ?? 0;
  return (
    <View style={{ gap: 4, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: imp.caught ? colors.success : colors.warn }}>
      <Text style={{ color: colors.ink, fontWeight: "700" }}>
        Intrus : {nameOf(imp.userId)} (clip <Text style={{ color: imp.rank.color }}>{imp.rank.name}</Text>, {against} vote{against > 1 ? "s" : ""})
      </Text>
      <Muted>
        {imp.caught ? `Démasqué : +${pts} pour ${imp.bonuses.map((b) => nameOf(b.userId)).join(", ")}.` : `Pas démasqué : +${pts} pour ${nameOf(imp.userId)}.`}
      </Muted>
    </View>
  );
}

function RoundReveal({ round, players, meId }: { round: RoomRoundDto; players: RoomPlayerDto[]; meId: string }) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ alignItems: "center", gap: 3 }}>
        <Hud>{round.suddenDeath ? "Mort subite" : `Manche ${round.position}`} · rang réel</Hud>
        <RankEmblem rank={round.correctRank} size={56} />
        <Text style={{ color: round.correctRank.color, fontWeight: "800" }}>{round.correctRank.name}</Text>
      </View>
      {round.impostor && <ImpostorReveal round={round} players={players} meId={meId} />}
      {players.filter((p) => !round.suddenDeath || p.finalist || round.answers.some((a) => a.userId === p.id)).map((p) => {
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
        <PrimaryButton label="Salons" onPress={() => router.replace("/rooms")} />
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
          {room.teamSize
            ? room.teams.every((t) => t.placement === 1) ? "Match nul" : me?.placement === 1 ? "Victoire de ton équipe !" : "Défaite de ton équipe"
            : me?.placement === 1 ? (winners.length > 1 ? "Victoire partagée !" : "Victoire !") : me?.placement ? `${me.placement}e place` : "Partie terminée"}
        </Text>
        {room.teamSize ? <TeamTotals room={room} /> : null}
        <Muted center>{winners.length > 1 ? `Égalité en tête : ${winners.map((w) => w.displayName).join(", ")}` : `Vainqueur : ${winners[0]?.displayName ?? "—"}`}</Muted>
        {room.decidedBy && room.decidedBy !== "POINTS" && <Text style={{ color: colors.warn, textAlign: "center" }}>{DECIDED_BY_LABEL[room.decidedBy]}</Text>}
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
                <Text style={{ color: colors.ink, fontWeight: "600" }}>{d.suddenDeath ? "Mort subite" : `${d.position}.`} <Text style={{ color: d.correctRank.color }}>{d.correctRank.name}</Text></Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {room.players.map((p) => {
                  const a = d.answers.find((x) => x.userId === p.id);
                  const bonus = d.impostor?.bonuses.find((b) => b.userId === p.id)?.points ?? 0;
                  const tag = d.impostor?.userId === p.id ? " [intrus]" : "";
                  return `${p.id === meId ? "Toi" : p.displayName}${tag} : ${a ? `${a.rank.name} (${a.score}${bonus ? ` +${bonus}` : ""})` : "—"}`;
                }).join(" · ")}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {room.tournamentId
        ? <PrimaryButton label="Retour au tournoi" onPress={() => router.replace({ pathname: "/tournaments/[id]", params: { id: room.tournamentId! } })} />
        : <Rematch room={room} />}
    </>
  );
}

/** Revanche : un joueur la propose (mêmes réglages, les autres sont invités) ; chacun confirme en la rejoignant. */
function Rematch({ room }: { room: RoomDto }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.rematchRoom(room.id);
      router.replace({ pathname: "/rooms/[id]", params: { id: next.id } });
    } catch (e) {
      setError(errorMessage(e, "La revanche n'a pas pu être lancée."));
    } finally {
      setBusy(false);
    }
  };
  const r = room.rematch;
  return (
    <Card style={{ gap: 10 }}>
      {r ? (
        <>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", textAlign: "center" }}>Revanche proposée par {r.host}</Text>
          <Muted center>{r.players}/{r.maxPlayers} joueurs l&apos;ont rejointe · {r.status === "LOBBY" ? "en salle d'attente" : r.status === "ACTIVE" ? "partie en cours" : "terminée"}</Muted>
          {r.joined ? (
            <PrimaryButton label="Aller à la revanche" onPress={() => router.replace({ pathname: "/rooms/[id]", params: { id: r.id } })} />
          ) : r.status === "LOBBY" ? (
            <PrimaryButton label={busy ? "Connexion…" : "Accepter la revanche"} disabled={busy} onPress={go} />
          ) : null}
        </>
      ) : room.canRematch ? (
        <>
          <Muted center>Même jeu, mêmes réglages : les autres joueurs reçoivent une invitation et confirment en rejoignant.</Muted>
          <PrimaryButton label={busy ? "Création…" : "Proposer une revanche"} disabled={busy} onPress={go} />
        </>
      ) : null}
      <GhostButton label="Autres salons" onPress={() => router.replace("/rooms")} />
      {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}
    </Card>
  );
}
