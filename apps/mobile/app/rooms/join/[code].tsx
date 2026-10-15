import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ROOM_STATUS_LABEL, formatRoomCode, normalizeRoomCode, type RoomPreviewDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { GhostButton, Loading, LoginRequired, Message, Muted, PrimaryButton } from "@/components/ui";

/** Invitation : aperçu du salon, puis « Rejoindre » (gratuit). */
export default function JoinRoomScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeRoomCode(String(raw ?? ""));
  const { me, loading } = useSession();
  const [preview, setPreview] = useState<RoomPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || !code) return;
    api.roomPreview(code).then(
      (p) => (p.member && p.status !== "CLOSED" ? router.replace({ pathname: "/rooms/[id]", params: { id: p.id } }) : setPreview(p)),
      (e) => setError(errorMessage(e, "Aucun salon ouvert avec ce code.")),
    );
  }, [me, code]);

  if (loading) return <Loading />;
  if (!me) return <View style={{ padding: 16 }}><LoginRequired text="Connecte-toi (ou crée un compte gratuit) pour rejoindre ce salon. Pas besoin d'être VIP." /></View>;
  if (!code || (error && !preview)) {
    return (
      <View style={{ padding: 16 }}>
        <Message title={code ? "Salon introuvable" : "Code invalide"} text={error ?? "Le code d'un salon fait 8 caractères, lettres et chiffres."}>
          <GhostButton label="Salons privés" onPress={() => router.replace("/rooms")} />
        </Message>
      </View>
    );
  }
  if (!preview) return <Loading />;

  const open = preview.status === "LOBBY" && preview.players < preview.maxPlayers;
  return (
    <View style={{ padding: 16 }}>
      <Message title={`Salon de ${preview.host}`}>
        <Text style={{ color: colors.neon, fontSize: 22, letterSpacing: 4, textAlign: "center", fontWeight: "700" }}>{formatRoomCode(preview.code)}</Text>
        <Muted center>{preview.game.name} · {preview.rounds} manches · {preview.roundSec} s par manche</Muted>
        <Muted center>{preview.players}/{preview.maxPlayers} joueurs · {ROOM_STATUS_LABEL[preview.status]}</Muted>
        {open ? (
          <PrimaryButton
            label="Rejoindre gratuitement"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                const room = await api.joinRoom(preview.code);
                router.replace({ pathname: "/rooms/[id]", params: { id: room.id } });
              } catch (e) {
                setError(errorMessage(e, "Impossible de rejoindre ce salon."));
                setBusy(false);
              }
            }}
          />
        ) : (
          <Text style={{ color: colors.warn, textAlign: "center" }}>{preview.status === "LOBBY" ? "Ce salon est complet." : "La partie a déjà commencé ou est terminée."}</Text>
        )}
        {error && <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>}
      </Message>
    </View>
  );
}
