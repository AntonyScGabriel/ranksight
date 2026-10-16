import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Share, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  STAGE_NAME, TOURNAMENT_DECIDED_BY_LABEL, TOURNAMENT_MIN_PLAYERS, TOURNAMENT_RULES, TOURNAMENT_STATUS_LABEL, formatRoomCode, stageCount,
  type TournamentDecidedBy, type TournamentDto, type TournamentMatchDto, type TournamentPlayerDto,
} from "@ranksight/shared";
import { api, ApiError, WEB_URL } from "@/lib/api";
import { useChat } from "@/lib/chat";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, font } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Avatar, Card, GhostButton, Hud, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";

/** Tournoi : inscriptions (code), match du joueur (« Je suis prêt »), tableau par tour, classement final. */
export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, loading } = useSession();
  const { onTournament } = useChat();
  const confirm = useConfirm();
  const [t, setT] = useState<TournamentDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const offset = useRef(0);
  const lastStatus = useRef<{ id: string; status: string } | null>(null);

  const apply = useCallback((d: TournamentDto) => {
    offset.current = new Date(d.serverNow).getTime() - Date.now();
    setT(d);
  }, []);
  const load = useCallback(() => {
    api.tournament(id).then(apply, (e) => e instanceof ApiError && e.status === 404 && setMissing(true));
  }, [id, apply]);

  useEffect(() => {
    if (!me) return;
    load();
    const off = onTournament((e) => e.id === id && load());
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => {
      off();
      sub.remove();
    };
  }, [me, id, load, onTournament]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => clearInterval(timer);
  }, []);

  const myMatch = t?.matches.find((m) => m.id === t.myMatch) ?? null;
  // Le salon du match vient d'être créé pendant que la page est ouverte (« prêt » → « en cours ») : direction le match.
  // Pas au premier affichage : un joueur qui revient d'un match terminé n'y est pas renvoyé.
  useEffect(() => {
    if (!myMatch) return;
    const before = lastStatus.current;
    lastStatus.current = { id: myMatch.id, status: myMatch.status };
    if (before?.id === myMatch.id && before.status === "READY" && myMatch.status === "PLAYING" && myMatch.roomId) {
      router.push({ pathname: "/rooms/[id]", params: { id: myMatch.roomId } });
    }
  }, [myMatch]);

  const deadline = myMatch?.deadlineAt ? new Date(myMatch.deadlineAt).getTime() : 0;
  const overdue = !!deadline && now > deadline + 4000;
  useEffect(() => {
    if (!overdue) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [overdue, load]);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      const r = await action();
      if (r && typeof r === "object" && "matches" in r) apply(r as TournamentDto);
      else load();
    } catch (e) {
      setError(errorMessage(e));
      load();
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi pour suivre ce tournoi. L'inscription est gratuite." /></View>;
  if (missing) {
    return (
      <View style={{ padding: 16 }}>
        <Message title="Tournoi introuvable" text="Ce tournoi n'existe pas ou tu n'y es pas inscrit.">
          <GhostButton label="Tournois" onPress={() => router.replace("/tournaments")} />
        </Message>
      </View>
    );
  }
  if (!t) return <Loading />;

  const name = (uid: string | null) => (uid ? (uid === me.id ? "Toi" : t.players.find((p) => p.id === uid)?.displayName ?? "?") : null);
  const meP = t.players.find((p) => p.id === me.id)!;
  const code = formatRoomCode(t.code);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Card style={{ gap: 6 }}>
        <Hud>{TOURNAMENT_STATUS_LABEL[t.status]}</Hud>
        <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>Tournoi · {t.game.name}</Text>
        <Muted>{t.rounds} manches par match · {t.roundSec} s par manche · {t.players.length}/{t.capacity} joueurs</Muted>
      </Card>
      {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}

      {t.status === "LOBBY" && (
        <>
          <Card style={{ alignItems: "center", gap: 8 }}>
            <Hud>Code du tournoi</Hud>
            <Text selectable style={{ color: colors.neon, fontSize: 32, fontWeight: "700", letterSpacing: 5 }}>{code}</Text>
            <View style={{ alignSelf: "stretch" }}>
              <GhostButton label="Partager l'invitation" onPress={() => void Share.share({ message: `Inscris-toi à mon tournoi RankGuess sur ${t.game.name} : code ${code}\n${WEB_URL}/tournaments/join/${code}` })} />
            </View>
          </Card>
          <Card style={{ gap: 10 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Inscrits</Text>
            {t.players.map((p) => (
              <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar name={p.displayName} url={p.avatarUrl} size={30} frame={p.flair.frame} />
                <PlayerName p={p} meId={me.id} />
              </View>
            ))}
            {t.isHost ? (
              <>
                <PrimaryButton label="Lancer le tournoi" disabled={!t.canStart} onPress={() => act(() => api.startTournament(id))} />
                {!t.canStart && <Muted center>Il faut au moins {TOURNAMENT_MIN_PLAYERS} inscrits pour lancer le tournoi.</Muted>}
              </>
            ) : (
              <Muted center>En attente du lancement par {t.players.find((p) => p.isHost)?.displayName ?? "l'hôte"}…</Muted>
            )}
          </Card>
        </>
      )}

      {t.status === "ACTIVE" && <MyMatch t={t} match={myMatch} me={meP} now={now} name={name} onReady={() => act(() => api.readyForMatch(id))} />}
      {t.status === "FINISHED" && <Standings t={t} meId={me.id} />}
      {t.status === "CLOSED" && <Message title="Tournoi fermé" text="Ce tournoi a été fermé avant son lancement." />}
      {t.bracketSize && <Bracket t={t} name={name} meId={me.id} />}

      {(t.status === "LOBBY" || t.status === "ACTIVE") && (
        <Card style={{ gap: 6 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "700" }}>Règles</Text>
          {TOURNAMENT_RULES.map((r) => <Muted key={r}>• {r}</Muted>)}
        </Card>
      )}

      {(t.status === "LOBBY" || t.status === "ACTIVE") && !t.left && (
        <GhostButton
          label="Quitter le tournoi"
          danger
          onPress={async () => {
            const ok = await confirm({
              title: "Quitter le tournoi ?",
              message: t.status === "ACTIVE" ? "Tu perdras ton match en cours ou à venir par forfait." : "Tu pourras te réinscrire avec le code tant que le tournoi n'a pas commencé.",
              confirmLabel: "Quitter",
              danger: true,
            });
            if (ok === false) return;
            await act(async () => {
              await api.leaveTournament(id);
              if (t.status === "LOBBY") router.replace("/tournaments");
            });
          }}
        />
      )}
    </ScrollView>
  );
}

function PlayerName({ p, meId }: { p: TournamentPlayerDto; meId: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 }}>
      <Text style={{ flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>{p.id === meId ? "Toi" : p.displayName}</Text>
      {p.vip && <Text style={{ color: "black", backgroundColor: colors.warn, borderRadius: 3, paddingHorizontal: 4, fontSize: 9, fontWeight: "800", overflow: "hidden" }}>VIP</Text>}
      {p.isHost && <Text style={{ color: colors.warn, fontSize: 12 }} accessibilityLabel="Hôte du tournoi">★</Text>}
    </View>
  );
}

function MyMatch({
  t, match, me, now, name, onReady,
}: { t: TournamentDto; match: TournamentMatchDto | null; me: TournamentPlayerDto; now: number; name: (id: string | null) => string | null; onReady: () => void }) {
  if (me.left) return <Message title="Tu as quitté le tournoi" text="Tu peux continuer à suivre le tableau." />;
  if (!match) {
    return <Message title={me.eliminated ? "Éliminé" : "Qualifié"} text={me.eliminated ? `Tu termines à la ${me.placement}e place.` : "En attente de la suite du tableau."} />;
  }
  const meFirst = match.player1 === me.id;
  const opponent = meFirst ? match.player2 : match.player1;
  const imReady = meFirst ? match.ready1 : match.ready2;
  const theyReady = meFirst ? match.ready2 : match.ready1;
  const left = match.deadlineAt ? Math.max(0, Math.ceil((new Date(match.deadlineAt).getTime() - now) / 1000)) : 0;
  return (
    <Card style={{ gap: 10, borderColor: colors.neon }}>
      <Hud>{STAGE_NAME(t.bracketSize!, match.stage)} · ton match</Hud>
      {match.status === "WAITING" ? (
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", textAlign: "center" }}>En attente de ton adversaire</Text>
      ) : match.status === "PLAYING" && match.roomId ? (
        <PrimaryButton label={`Rejoindre le match contre ${name(opponent)}`} onPress={() => router.push({ pathname: "/rooms/[id]", params: { id: match.roomId! } })} />
      ) : (
        <>
          <Text style={{ color: colors.ink, fontSize: 20, textAlign: "center", ...font.display }}>Toi contre {name(opponent)}</Text>
          <Muted center>
            {imReady ? (theyReady ? "Lancement du match…" : `En attente de ${name(opponent)}…`) : theyReady ? `${name(opponent)} est prêt et t'attend.` : "Le match démarre dès que vous êtes prêts tous les deux."}
          </Muted>
          <PrimaryButton label={imReady ? "Prêt ✓" : "Je suis prêt"} disabled={imReady} onPress={onReady} />
          {match.deadlineAt && (
            <Text style={{ color: left <= 60 ? colors.danger : colors.muted, textAlign: "center" }}>
              Heure limite dans {Math.floor(left / 60)} min {String(left % 60).padStart(2, "0")} s
            </Text>
          )}
        </>
      )}
    </Card>
  );
}

/** Tableau : les matchs tour par tour (plus lisible qu'un arbre sur un téléphone). */
function Bracket({ t, name, meId }: { t: TournamentDto; name: (id: string | null) => string | null; meId: string }) {
  const size = t.bracketSize!;
  const seed = (id: string | null) => t.players.find((p) => p.id === id)?.seed;
  const line = (m: TournamentMatchDto, n: 1 | 2) => {
    const pid = n === 1 ? m.player1 : m.player2;
    const score = n === 1 ? m.score1 : m.score2;
    const won = !!pid && m.winnerId === pid;
    const lost = !!pid && !!m.winnerId && !won;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, backgroundColor: pid === meId ? `${colors.violet}1A` : "transparent" }}>
        <Text style={{ width: 18, color: colors.muted, fontSize: 11, textAlign: "right" }}>{seed(pid) ?? ""}</Text>
        <Text style={{ flex: 1, color: lost ? colors.muted : colors.ink, fontWeight: won ? "700" : "400", textDecorationLine: lost ? "line-through" : "none" }} numberOfLines={1}>
          {name(pid) ?? (m.decidedBy === "BYE" ? "—" : "à venir")}
        </Text>
        {score !== null && <Text style={{ color: colors.ink, ...font.display }}>{score}</Text>}
        {won && <Text style={{ color: colors.success }}>✓</Text>}
      </View>
    );
  };
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Tableau</Text>
      {Array.from({ length: stageCount(size) }, (_, i) => i + 1).map((s) => (
        <View key={s} style={{ gap: 6 }}>
          <Hud>{STAGE_NAME(size, s)}</Hud>
          {t.matches.filter((m) => m.stage === s).map((m) => (
            <View key={m.id} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
              {line(m, 1)}
              {line(m, 2)}
              {m.decidedBy && m.decidedBy !== "POINTS" && m.decidedBy !== "BYE" && (
                <Text style={{ color: colors.muted, fontSize: 11 }}>{TOURNAMENT_DECIDED_BY_LABEL[m.decidedBy as TournamentDecidedBy]}</Text>
              )}
              {m.status === "PLAYING" && <Text style={{ color: colors.neon, fontSize: 11 }}>En cours</Text>}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

function Standings({ t, meId }: { t: TournamentDto; meId: string }) {
  const winner = t.players.find((p) => p.placement === 1);
  const me = t.players.find((p) => p.id === meId);
  return (
    <>
      <Card style={{ alignItems: "center", gap: 4 }}>
        <Hud>Tournoi terminé</Hud>
        <Text style={{ color: me?.placement === 1 ? colors.success : colors.ink, fontSize: 22, textAlign: "center", ...font.display }}>
          {me?.placement === 1 ? "Tu remportes le tournoi !" : `Vainqueur : ${winner?.displayName ?? "—"}`}
        </Text>
        {me?.placement && me.placement !== 1 && <Muted center>Tu termines à la {me.placement}e place.</Muted>}
      </Card>
      <Card style={{ gap: 8 }}>
        {t.players.map((p) => (
          <Pressable key={p.id} onPress={() => router.push({ pathname: "/player/[id]", params: { id: p.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ width: 22, textAlign: "center", color: p.placement === 1 ? colors.neon : colors.muted, ...font.display }}>{p.placement ?? "—"}</Text>
            <Avatar name={p.displayName} url={p.avatarUrl} size={28} frame={p.flair.frame} />
            <PlayerName p={p} meId={meId} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>{p.wins} V</Text>
            <Text style={{ width: 48, textAlign: "right", color: colors.ink, ...font.display }}>{p.points}</Text>
          </Pressable>
        ))}
      </Card>
    </>
  );
}
