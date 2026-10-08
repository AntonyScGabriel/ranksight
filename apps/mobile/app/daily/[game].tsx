import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import type { PlayableClipDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { Round } from "@/components/Round";
import { GhostButton, Loading, Message, NoClip, PrimaryButton } from "@/components/ui";

type State = { kind: "loading" } | { kind: "ready"; clip: PlayableClipDto } | { kind: "none" } | { kind: "played"; message: string } | { kind: "error" };

/** Défi du jour d'un jeu : une seule tentative par jour. */
export default function DailyGameScreen() {
  const { game } = useLocalSearchParams<{ game: string }>();
  const navigation = useNavigation();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    api
      .daily(game)
      .then((clip) => {
        navigation.setOptions({ title: clip.game.name });
        setState({ kind: "ready", clip });
      })
      .catch((e: ApiError) =>
        setState(e.status === 409 ? { kind: "played", message: e.message } : e.status === 404 ? { kind: "none" } : { kind: "error" }),
      );
  }, [game, navigation]);

  useEffect(load, [load]);

  let content: React.ReactNode;
  if (state.kind === "loading") content = <Loading />;
  else if (state.kind === "none") content = <NoClip><GhostButton label="Défis du jour" onPress={() => router.back()} /></NoClip>;
  else if (state.kind === "played")
    content = (
      <Message title="Défi déjà joué" text={state.message}>
        <PrimaryButton label="Autres défis du jour" onPress={() => router.back()} />
      </Message>
    );
  else if (state.kind === "error")
    content = (
      <Message title="Connexion au serveur impossible" text="Vérifie ta connexion internet puis réessaie.">
        <GhostButton
          label="Réessayer"
          onPress={() => {
            setState({ kind: "loading" });
            load();
          }}
        />
      </Message>
    );
  else content = <Round clip={state.clip} onNext={() => router.back()} nextLabel="Défis du jour" />;

  return <View style={{ flex: 1, padding: 16 }}>{content}</View>;
}
