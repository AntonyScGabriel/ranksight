import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import {
  GAME_PLATFORMS, InGamePseudo, PLATFORM_LABEL, REGION_LABEL, REGIONS, firstIssue,
  type GameDto, type GameSlug, type Platform, type Region,
} from "@ranksight/shared";
import { api, fileSize, uploadVideo } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/components/AuthUi";
import { colors } from "@/lib/theme";
import { Card, GhostButton, Hud, Message, Muted, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";

interface PickedVideo {
  uri: string;
  durationSec: number;
  size: number;
  mimeType: string;
}

export default function SubmitScreen() {
  const { me } = useSession();
  const [games, setGames] = useState<GameDto[]>([]);
  const [inGamePseudo, setInGamePseudo] = useState("");
  const [pseudoError, setPseudoError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [rankId, setRankId] = useState<string | null>(null);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [rights, setRights] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.games().then(setGames).catch(() => setError("Impossible de charger la liste des jeux."));
  }, []);

  const game = games.find((g) => g.id === gameId);
  const platforms = game ? GAME_PLATFORMS[game.slug as GameSlug] ?? [] : [];

  const chooseGame = (id: string) => {
    setGameId(id);
    setRankId(null);
    setPlatform(null);
    // Pré-remplit avec le dernier pseudo en jeu utilisé pour ce jeu (modifiable)
    const slug = games.find((g) => g.id === id)?.slug;
    const last = me?.inGamePseudos.find((p) => p.game.slug === slug)?.inGamePseudo;
    if (last && !inGamePseudo.trim()) setInGamePseudo(last);
  };

  const pick = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: false, quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const durationSec = (a.duration ?? 0) / 1000;
    const mimeType = a.mimeType === "video/webm" ? "video/webm" : "video/mp4";
    if (durationSec < 15 || durationSec > 30.5) return setError("Le clip doit durer entre 15 et 30 secondes.");
    if ((a.fileSize ?? 0) > 80 * 1024 * 1024) return setError("La vidéo dépasse 80 Mo.");
    setVideo({ uri: a.uri, durationSec, size: a.fileSize ?? 0, mimeType });
  };

  const submit = async () => {
    const pseudo = InGamePseudo.safeParse(inGamePseudo);
    if (!pseudo.success) return setPseudoError(firstIssue(pseudo.error));
    if (!game || !rankId || !video || !rights) return;
    setSending(true);
    setError(null);
    try {
      const size = await fileSize(video.uri);
      if (size > 80 * 1024 * 1024) {
        setError("La vidéo dépasse 80 Mo.");
        return;
      }
      const { key, url } = await api.uploadUrl(video.mimeType, size);
      await uploadVideo(url, video.uri, video.mimeType);
      await api.submitClip({
        gameId: game.id,
        rankId,
        inGamePseudo: pseudo.data,
        platform: platform ?? (platforms.length === 1 ? platforms[0] : undefined),
        region: region ?? undefined,
        storageKey: key,
        durationSec: video.durationSec,
        proofUrl: proofUrl.trim() || undefined,
        note: note.trim() || undefined,
        ownsRights: true,
      });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, "L'envoi a échoué, réessaie."));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Message title="Clip envoyé" text="Il est en attente de validation. Tu peux suivre son statut dans « Mes clips ».">
          <PrimaryButton label="Mes clips" onPress={() => router.replace("/my-clips")} />
        </Message>
      </View>
    );
  }

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Muted>Ton clip sera vérifié avant d&apos;être proposé aux autres joueurs.</Muted>

      <Card style={{ gap: 10 }}>
        <Hud>Jeu</Hud>
        <Chips items={games.map((g) => [g.id, g.name])} value={gameId} onChange={chooseGame} />
        <Hud>Clip vidéo</Hud>
        <GhostButton label={video ? `Vidéo choisie · ${Math.round(video.durationSec)} s` : "Choisir une vidéo (15 à 30 s)"} onPress={pick} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Hud>Pseudo en jeu *</Hud>
        <TextInput
          value={inGamePseudo}
          onChangeText={(v) => { setInGamePseudo(v); setPseudoError(null); }}
          placeholder="Ex. Player123#EUW"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          style={[inputStyle, pseudoError ? { borderWidth: 1, borderColor: colors.danger } : null]}
        />
        {pseudoError ? (
          <Text style={{ color: colors.danger, fontSize: 12 }}>{pseudoError}</Text>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Le pseudo du joueur dans la partie (Riot ID, nom Steam, Epic…). Ton pseudo RankGuess ({me?.displayName}) reste distinct.
          </Text>
        )}
        {game && (
          <>
            <Hud>Rang réel du joueur</Hud>
            <Chips items={game.ranks.map((r) => [r.id, r.name])} value={rankId} onChange={setRankId} />
          </>
        )}
        {platforms.length > 1 && (
          <>
            <Hud>Plateforme (facultatif)</Hud>
            <Chips items={platforms.map((p) => [p, PLATFORM_LABEL[p]])} value={platform} onChange={(v) => setPlatform(v === platform ? null : (v as Platform))} />
          </>
        )}
        <Hud>Région (facultatif)</Hud>
        <Chips items={REGIONS.map((r) => [r, REGION_LABEL[r]])} value={region} onChange={(v) => setRegion(v === region ? null : (v as Region))} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Hud>Informations complémentaires</Hud>
        <TextInput value={proofUrl} onChangeText={setProofUrl} placeholder="Preuve du rang (lien, facultatif)" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="url" style={inputStyle} />
        <TextInput value={note} onChangeText={setNote} placeholder="Contexte (facultatif)" placeholderTextColor={colors.muted} maxLength={300} multiline style={[inputStyle, { minHeight: 70 }]} />
      </Card>

      <Muted>Le pseudo, le rang et les indices de classement ne doivent pas être visibles.</Muted>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Switch value={rights} onValueChange={setRights} trackColor={{ true: colors.violet }} />
        <Text style={{ color: colors.ink, flex: 1 }}>Je suis l&apos;auteur de ce clip ou j&apos;ai l&apos;accord de son auteur.</Text>
      </View>
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
      <PrimaryButton label={sending ? "Envoi en cours…" : "Envoyer le clip"} onPress={submit} disabled={!game || !rankId || !video || !inGamePseudo.trim() || !rights || sending} />
    </KeyboardScroll>
  );
}

const inputStyle = { color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, padding: 12 } as const;

function Chips({ items, value, onChange }: { items: [string, string][]; value: string | null; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {items.map(([id, label]) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          style={{ borderRadius: 10, borderWidth: 1.5, borderColor: value === id ? colors.violet : colors.line, backgroundColor: value === id ? `${colors.violet}33` : colors.surface2, paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 13 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
