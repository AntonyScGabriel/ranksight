import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { TOURNAMENT_STATUS_LABEL, formatRoomCode, normalizeRoomCode, type TournamentPreviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { GhostButton, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";

/** Invitation à un tournoi : aperçu, puis inscription gratuite. */
export default function JoinTournamentScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeRoomCode(String(raw ?? ""));
  const { me, loading } = useSession();
  const [preview, setPreview] = useState<TournamentPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || !code) return;
    api.tournamentPreview(code).then(
      (p) => (p.member ? router.replace({ pathname: "/tournaments/[id]", params: { id: p.id } }) : setPreview(p)),
      (e) => setError(errorMessage(e, "Aucun tournoi ouvert avec ce code.")),
    );
  }, [me, code]);

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi (ou crée un compte gratuit) pour t'inscrire à ce tournoi. Pas besoin d'être VIP." /></View>;
  if (!code || (error && !preview)) {
    return (
      <View style={{ padding: 16 }}>
        <Message title={code ? "Tournoi introuvable" : "Code invalide"} text={error ?? "Le code d'un tournoi fait 8 caractères, lettres et chiffres."}>
          <GhostButton label="Tournois" onPress={() => router.replace("/tournaments")} />
        </Message>
      </View>
    );
  }
  if (!preview) return <Loading />;

  const open = preview.status === "LOBBY" && preview.players < preview.capacity;
  return (
    <View style={{ padding: 16 }}>
      <Message title={`Tournoi de ${preview.host}`}>
        <Text style={{ color: colors.neon, fontSize: 22, letterSpacing: 4, textAlign: "center", fontWeight: "700" }}>{formatRoomCode(preview.code)}</Text>
        <Muted center>{preview.game.name} · {preview.rounds} manches par match</Muted>
        <Muted center>{preview.players}/{preview.capacity} inscrits · {TOURNAMENT_STATUS_LABEL[preview.status]}</Muted>
        {open ? (
          <PrimaryButton
            label="S'inscrire gratuitement"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                const t = await api.joinTournament(preview.code);
                router.replace({ pathname: "/tournaments/[id]", params: { id: t.id } });
              } catch (e) {
                setError(errorMessage(e, "Impossible de s'inscrire à ce tournoi."));
                setBusy(false);
              }
            }}
          />
        ) : (
          <Text style={{ color: colors.warn, textAlign: "center" }}>{preview.status === "LOBBY" ? "Ce tournoi est complet." : "Le tournoi a déjà commencé ou est terminé."}</Text>
        )}
        {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}
      </Message>
    </View>
  );
}
