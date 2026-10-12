import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { DAILY_PER_GAME, type PlayableClipDto } from "@ranksight/shared";
import { api, type ApiError } from "@/lib/api";
import { Round } from "@/components/Round";
import { GhostButton, Loading, Message, NoClip, PrimaryButton } from "@/components/ui";

type State = { kind: "loading" } | { kind: "ready"; clip: PlayableClipDto & { slot: number }; next: number | null } | { kind: "none" } | { kind: "played"; message: string } | { kind: "error" };

/** Un des défis du jour d'un jeu (slot 1 à 3, sinon le premier pas encore joué) : une seule tentative par défi. */
export default function DailyGameScreen() {
  const params = useLocalSearchParams<{ game: string; slot?: string }>();
  const { game } = params;
  const requested = Number(params.slot);
  const [slot, setSlot] = useState<number | undefined>(Number.isInteger(requested) && requested >= 1 && requested <= DAILY_PER_GAME ? requested : undefined);
  const navigation = useNavigation();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    Promise.all([api.daily(game, slot), api.dailyOverview().catch(() => null)])
      .then(([clip, overview]) => {
        navigation.setOptions({ title: `${clip.game.name} · défi ${clip.slot}/${DAILY_PER_GAME}` });
        // Prochain défi de ce jeu encore à jouer
        const next = overview?.games.find((g) => g.game.slug === game)?.challenges.find((c) => c.status === "AVAILABLE" && c.slot !== clip.slot);
        setState({ kind: "ready", clip, next: next?.slot ?? null });
      })
      .catch((e: ApiError) =>
        setState(e.status === 409 ? { kind: "played", message: e.message } : e.status === 404 ? { kind: "none" } : { kind: "error" }),
      );
  }, [game, slot, navigation]);

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
  else {
    const { next } = state;
    content = (
      <Round
        key={state.clip.id}
        clip={state.clip}
        onNext={() => {
          if (next === null) return router.back();
          setState({ kind: "loading" });
          setSlot(next);
        }}
        nextLabel={next === null ? "Défis du jour" : "Défi suivant"}
      />
    );
  }

  return <View style={{ flex: 1, padding: 16 }}>{content}</View>;
}
