import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { RATING_UNCOUNTED_LABEL, VERSUS_STATUS_LABEL, ratingTier, type FlairDto, type VersusMatchDto, type VersusRoundDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { useLiveDuel } from "@/lib/versus";
import { errorMessage } from "@/components/AuthUi";
import { LiveRound, TimerBar } from "@/components/LiveRound";
import { RankEmblem } from "@/components/RankEmblem";
import { Avatar, Card, GhostButton, Hud, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";
import { FlairBadge, TitleText } from "@/components/Flair";

/** Duel en direct : attente de l'adversaire, manches synchronisées avec chrono, révélation des réponses, résultat. */
export default function VersusMatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { me, loading } = useSession();
  const confirm = useConfirm();
  const duel = useLiveDuel(id, !!me);
  const { match, phase } = duel;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: match?.live ? `Manche ${match.live.round}/${match.rounds}` : "Duel" });
  }, [navigation, match]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "status" in r) duel.apply(r as VersusMatchDto);
      else duel.load();
    } catch (e) {
      setError(errorMessage(e));
      duel.load();
    }
  };

  if (loading) return <Loading />;
  if (!me) {
    return (
      <View style={{ padding: 16 }}>
        <LoginRequired text="Connecte-toi pour rejoindre ce duel." />
      </View>
    );
  }
  if (duel.missing) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Duel introuvable" text="Ce duel n'existe pas ou ne te concerne pas.">
          <GhostButton label="Duels" onPress={() => router.replace("/versus")} />
        </Message>
      </View>
    );
  }
  if (!match) return <Loading />;

  const opp = match.opponent;
  const lastRound = match.details.at(-1);

  if (phase === "playing") {
    return (
      <View style={{ flex: 1, padding: 16, gap: 10 }}>
        <Scoreboard match={match} compact />
        {duel.clip ? (
          <LiveRound
            key={duel.clip.playToken}
            clip={duel.clip}
            secondsLeft={duel.secondsLeft}
            progress={duel.roundProgress}
            onSubmitted={() => duel.markSubmitted(duel.clip!.position)}
            onClosed={duel.load}
          />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Scoreboard match={match} />
      {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}

      {phase === "waiting" && (
        <Card style={{ gap: 12, alignItems: "center" }}>
          <ActivityIndicator color={colors.violet} />
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            {match.status === "OPEN" ? "Recherche d'un adversaire…" : `En attente de ${opp?.displayName ?? "ton ami"}…`}
          </Text>
          <Muted center>
            {match.status === "OPEN"
              ? "Le duel démarre dès qu'un autre joueur lance une recherche. Reste sur cet écran."
              : "Ton ami a reçu l'invitation. Le duel démarre dès qu'il accepte. Reste sur cet écran."}
          </Muted>
          <View style={{ alignSelf: "stretch" }}>
            <GhostButton label="Annuler" onPress={() => act(async () => { await api.cancelVersus(id); router.replace("/versus"); })} />
          </View>
        </Card>
      )}

      {phase === "invited" && (
        <Card style={{ gap: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            {opp?.displayName} te défie{match.game ? ` sur ${match.game.name}` : ""} !
          </Text>
          <Muted center>5 clips, 30 secondes par manche (plus pour un clip long), en même temps que ton adversaire.</Muted>
          <PrimaryButton label="Accepter et jouer" onPress={() => act(() => api.acceptVersus(id))} />
          <GhostButton label="Refuser" onPress={() => act(async () => { await api.declineVersus(id); router.replace("/versus"); })} />
        </Card>
      )}

      {phase === "countdown" && match.live && (
        <>
          {lastRound && <RoundReveal round={lastRound} opponentName={opp?.displayName ?? "Adversaire"} />}
          <Card style={{ alignItems: "center", gap: 4 }}>
            <Hud>{match.live.round === 1 ? "Le duel commence" : `Manche ${match.live.round}/${match.rounds}`}</Hud>
            <Text style={{ color: colors.neon, fontSize: 56, ...font.display }}>{duel.secondsLeft}</Text>
          </Card>
        </>
      )}

      {(phase === "answered" || phase === "timeout") && match.live && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            {phase === "timeout" && !match.live.answered ? "Temps écoulé !" : "Réponse envoyée"}
          </Text>
          <Muted center>
            {match.live.opponentAnswered ? `${opp?.displayName} a répondu aussi.` : `${opp?.displayName} réfléchit encore…`}
          </Muted>
          <TimerBar progress={duel.roundProgress} />
        </Card>
      )}

      {phase === "over" && <FinalResult match={match} />}

      {match.status === "ACTIVE" && (
        <GhostButton
          label="Abandonner"
          danger
          onPress={async () => {
            const ok = await confirm({ title: "Abandonner le duel ?", message: `${opp?.displayName ?? "Ton adversaire"} remportera la victoire.`, confirmLabel: "Abandonner", danger: true });
            if (ok !== false) void act(() => api.forfeitVersus(id));
          }}
        />
      )}
    </ScrollView>
  );
}

function Scoreboard({ match, compact }: { match: VersusMatchDto; compact?: boolean }) {
  const opp = match.opponent;
  const result = match.result === "me" ? "Victoire !" : match.result === "opponent" ? "Défaite" : match.result === "draw" ? "Égalité" : null;
  const color = match.result === "me" ? colors.success : match.result === "opponent" ? colors.danger : colors.ink;
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: compact ? 10 : 16 }}>
      <Side name="Toi" avatar={match.me.avatarUrl} display={match.me.displayName} score={match.me.score} compact={compact} flair={match.me.flair} />
      <View style={{ alignItems: "center", flex: 1 }}>
        {!compact && <Text style={{ color: colors.muted, fontSize: 12 }}>{match.game?.name ?? "Tous les jeux"}</Text>}
        <Text style={{ color, fontSize: compact ? 16 : 22, ...font.display }}>{result ?? "VS"}</Text>
        {!compact && <Text style={{ color: colors.muted, fontSize: 11 }}>{match.forfeit ? "Abandon" : VERSUS_STATUS_LABEL[match.status]}</Text>}
      </View>
      {opp ? (
        <Side id={opp.id} name={opp.displayName} avatar={opp.avatarUrl} display={opp.displayName} score={opp.score} compact={compact} flair={opp.flair} />
      ) : (
        <View style={{ width: 90, alignItems: "center" }}><Text style={{ color: colors.muted, fontSize: 24 }}>?</Text></View>
      )}
    </Card>
  );
}

function Side({
  id, name, avatar, display, score, compact, flair,
}: { id?: string; name: string; avatar: string | null; display: string; score: number; compact?: boolean; flair: FlairDto }) {
  return (
    <Pressable
      disabled={!id}
      onPress={() => id && router.push({ pathname: "/player/[id]", params: { id } })}
      style={{ width: 90, alignItems: "center", gap: 2 }}
    >
      {!compact && <Avatar name={display} url={avatar} size={44} frame={flair.frame} />}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" }}>
        <Text style={{ flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>{name}</Text>
        <FlairBadge flair={flair} size={10} />
      </View>
      {!compact && flair.title && <TitleText title={flair.title} size={9} />}
      <Text style={{ color: colors.ink, fontSize: compact ? 18 : 24, ...font.display }}>{score}</Text>
    </Pressable>
  );
}

/** Manche qui vient de se terminer : rang réel et réponses des deux joueurs. */
function RoundReveal({ round, opponentName }: { round: VersusRoundDto; opponentName: string }) {
  const answer = (a: VersusRoundDto["me"], who: string) => (
    <View style={{ flex: 1, alignItems: "center", gap: 3 }}>
      <Hud>{who}</Hud>
      {a ? <RankEmblem rank={a.rank} size={40} /> : <Text style={{ color: colors.muted, fontSize: 24 }}>—</Text>}
      <Text style={{ color: colors.ink, fontSize: 12 }} numberOfLines={1}>{a ? a.rank.name : "Pas de réponse"}</Text>
      <Text style={{ color: a && a.score > 0 ? colors.success : colors.muted, fontWeight: "700" }}>+{a?.score ?? 0}</Text>
    </View>
  );
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {answer(round.me, "Toi")}
      <View style={{ flex: 1.2, alignItems: "center", gap: 3 }}>
        <Hud>Rang réel</Hud>
        <RankEmblem rank={round.correctRank} size={60} />
        <Text style={{ color: round.correctRank.color, fontWeight: "800" }} numberOfLines={1}>{round.correctRank.name}</Text>
      </View>
      {answer(round.opponent, opponentName)}
    </Card>
  );
}

function FinalResult({ match }: { match: VersusMatchDto }) {
  const opp = match.opponent;
  if (match.status !== "FINISHED") {
    const text = match.status === "DECLINED" ? `${opp?.displayName ?? "Ton ami"} a refusé le duel.` : match.status === "EXPIRED" ? "Personne n'a rejoint ce duel à temps." : "Ce duel a été annulé.";
    return (
      <Message title={VERSUS_STATUS_LABEL[match.status]} text={text}>
        <PrimaryButton label="Lancer un autre duel" onPress={() => router.replace("/versus")} />
      </Message>
    );
  }
  return (
    <>
      {match.rating && (
        <Pressable onPress={() => router.push("/ranked")} accessibilityRole="button">
          <Card style={{ alignItems: "center", gap: 2 }}>
            <Hud>Classement compétitif{match.rating.scope !== "global" && match.game ? ` · ${match.game.name}` : ""}</Hud>
            {match.rating.counted ? (
              <>
                <Text style={{ color: match.rating.delta > 0 ? colors.success : match.rating.delta < 0 ? colors.danger : colors.muted, fontSize: 18, fontWeight: "800" }}>
                  {match.rating.delta > 0 ? "+" : ""}{match.rating.delta} point{Math.abs(match.rating.delta) > 1 ? "s" : ""}
                </Text>
                <Text style={{ color: colors.ink, fontSize: 20, ...font.display }}>
                  {match.rating.after} · <Text style={{ color: ratingTier(match.rating.after).color }}>{ratingTier(match.rating.after).name}</Text>
                </Text>
              </>
            ) : (
              <Muted center>{RATING_UNCOUNTED_LABEL[match.rating.reason ?? "PAIR_LIMIT"]}</Muted>
            )}
          </Card>
        </Pressable>
      )}
      {match.forfeit && <Muted center>{match.result === "me" ? `${opp?.displayName} a abandonné.` : "Tu as abandonné ce duel."}</Muted>}
      {match.details.length > 0 && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Manche par manche</Text>
          {match.details.map((d) => (
            <View key={d.position} style={{ flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
              <RankEmblem rank={d.correctRank} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontWeight: "600" }}>
                  {d.position}. <Text style={{ color: d.correctRank.color }}>{d.correctRank.name}</Text> · {d.game.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  Toi : {d.me ? `${d.me.rank.name} (${d.me.score})` : "—"} · {opp?.displayName ?? "Adversaire"} : {d.opponent ? `${d.opponent.rank.name} (${d.opponent.score})` : "—"}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}
      <PrimaryButton label="Nouveau duel" onPress={() => router.replace("/versus")} />
    </>
  );
}
