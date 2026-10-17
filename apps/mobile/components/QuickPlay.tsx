import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { GAME_NAMES, GAME_SLUGS, ROOM_MODES, ROOM_MODE_LABEL, type GameSlug, type RoomMode } from "@ranksight/shared";
import { api } from "@/lib/api";
import { colors } from "@/lib/theme";
import { errorMessage } from "@/components/AuthUi";
import { Chips } from "@/components/Chips";
import { Card, GhostButton, Hud, Muted, PrimaryButton } from "@/components/ui";

/** Attente : nouvelle recherche toutes les 5 secondes, pendant 2 minutes au plus */
const WAIT_EVERY_MS = 5_000;
const WAIT_MAX_MS = 120_000;

/**
 * « Jouer maintenant » (écran Salons) : rejoint aussitôt un salon public compatible (même jeu, même mode), salons gratuits
 * par défaut compris. Sans place libre : patienter, ou, pour un VIP, créer un salon public. Aucun point de classement.
 */
export function QuickPlay({ vip }: { vip: boolean }) {
  const [game, setGame] = useState<GameSlug>(GAME_SLUGS[0]);
  const [mode, setMode] = useState<RoomMode>("CLASSIC");
  const [state, setState] = useState<"idle" | "searching" | "none" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingSince = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const attempt = async (create: boolean) => {
    setError(null);
    try {
      const r = await api.quickPlay(game, mode, create);
      if (r.room) {
        setState("idle");
        router.push({ pathname: "/rooms/[id]", params: { id: r.room.id } });
        return true;
      }
      return false;
    } catch (e) {
      setError(errorMessage(e, "Impossible de trouver une partie pour le moment."));
      setState("idle");
      return true;
    }
  };

  const search = async () => {
    if (state === "searching") return;
    setState("searching");
    if (!(await attempt(false))) setState("none");
  };

  const wait = () => {
    setState("waiting");
    waitingSince.current = Date.now();
    const poll = async () => {
      if (await attempt(false)) return;
      if (Date.now() - waitingSince.current >= WAIT_MAX_MS) {
        setState("none");
        setError(vip
          ? "Toujours aucune place sur ce jeu et ce mode. Crée un salon public : les prochains joueurs te rejoindront."
          : "Toujours aucune place sur ce jeu et ce mode. Essaie un autre jeu ou un autre mode, ou réessaie dans un instant.");
        return;
      }
      timer.current = setTimeout(poll, WAIT_EVERY_MS);
    };
    timer.current = setTimeout(poll, WAIT_EVERY_MS);
  };

  const stopWaiting = () => {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
  };

  const create = async () => {
    stopWaiting();
    setState("searching");
    await attempt(true);
  };

  const locked = state === "searching" || state === "waiting";
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>Jouer maintenant</Text>
      <Muted>Rejoins tout de suite une partie publique, gratuitement. Partie personnalisée : de l&apos;XP, mais aucun point de classement.</Muted>
      <Hud>Jeu</Hud>
      <Chips value={game} options={GAME_SLUGS} onChange={(v) => { if (!locked) { setGame(v); setState("idle"); } }} label={(s) => GAME_NAMES[s]} />
      <Hud>Mode</Hud>
      <Chips value={mode} options={ROOM_MODES} onChange={(v) => { if (!locked) { setMode(v); setState("idle"); } }} label={(m) => ROOM_MODE_LABEL[m]} />
      {state === "none" ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink }}>Aucune place libre sur {GAME_NAMES[game]} en mode « {ROOM_MODE_LABEL[mode]} » pour l&apos;instant (salons gratuits complets ou en cours).</Text>
          {vip ? <PrimaryButton label="Créer un salon public" onPress={create} /> : <PrimaryButton label="Patienter" onPress={wait} />}
          {vip ? <GhostButton label="Patienter" onPress={wait} /> : <GhostButton label={Platform.OS === "android" ? "Créer un salon : VIP" : "Mon VIP"} onPress={() => router.push("/shop")} />}
        </View>
      ) : state === "waiting" ? (
        <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
          <Text style={{ color: colors.ink }}>Recherche d&apos;un salon… tu rejoindras le premier qui s&apos;ouvre.</Text>
          {vip && <GhostButton label="Créer plutôt" onPress={create} />}
          <GhostButton label="Arrêter" onPress={stopWaiting} />
        </View>
      ) : (
        <PrimaryButton label={state === "searching" ? "Recherche…" : "Jouer maintenant"} disabled={state === "searching"} onPress={search} />
      )}
      {error && <Text style={{ color: colors.danger }}>{error}</Text>}
    </Card>
  );
}
