import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { PlayableClipDto } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Round } from "@/components/Round";
import { Card, Hud, Loading, LoginRequired, Muted, NoClip, PrimaryButton } from "@/components/ui";

export default function InfiniteScreen() {
  const { me, loading } = useSession();
  const [runId, setRunId] = useState<string | null>(null);
  const [clip, setClip] = useState<PlayableClipDto | null>(null);
  const [run, setRun] = useState({ lives: 3, score: 0, ended: false });
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setEmpty(false);
    try {
      const r = await api.startRun();
      setRunId(r.id);
      setRun({ lives: r.lives, score: 0, ended: false });
      setClip(await api.nextInfinite(r.id));
    } catch (e) {
      setRunId(null);
      setClip(null);
      if (e instanceof ApiError && e.status === 404) setEmpty(true);
      else setError("Impossible de lancer la partie pour le moment.");
    }
  };

  const next = async () => {
    if (!runId) return;
    try {
      setClip(await api.nextInfinite(runId));
    } catch {
      setRun((r) => ({ ...r, ended: true }));
    }
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired /></View>;
  if (empty) return <View style={{ flex: 1, padding: 16 }}><NoClip><PrimaryButton label="Réessayer" onPress={start} /></NoClip></View>;

  if (!runId || !clip) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
        <Card style={{ gap: 12 }}>
          <Hud>Mode Infini</Hud>
          <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "700" }}>Jusqu&apos;où iras-tu ?</Text>
          <Muted>3 vies. Tu en perds une à 2 rangs d&apos;écart ou plus. La difficulté monte tous les 3 clips.</Muted>
          <PrimaryButton label="Lancer une partie" onPress={start} />
          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        </Card>
        <Pressable onPress={() => router.push("/higher-lower")} accessibilityRole="button" style={{ marginTop: 14 }}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>Plus haut / Plus bas</Text>
              <Muted>Le rang du clip suivant est-il plus haut ou plus bas ?</Muted>
            </View>
            <Text style={{ color: colors.neon, fontSize: 20 }}>›</Text>
          </Card>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.danger, fontSize: 18 }}>
          {"♥".repeat(Math.max(run.lives, 0))}
          <Text style={{ color: colors.muted }}>{"♡".repeat(Math.max(0, 3 - run.lives))}</Text>
        </Text>
        <Text style={{ color: colors.neon, fontWeight: "700" }}>{run.score} pts</Text>
      </View>
      {run.ended && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>Partie terminée : {run.score} pts</Text>
          <PrimaryButton label="Rejouer" onPress={start} />
        </Card>
      )}
      <Round
        key={clip.id}
        clip={clip}
        onResult={(r) => r.run && setRun({ lives: r.run.lives, score: r.run.score, ended: !!r.run.endedAt })}
        onNext={run.ended ? undefined : next}
      />
    </View>
  );
}
