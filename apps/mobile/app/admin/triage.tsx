import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { TriageClipDto, TriageStatsDto } from "@ranksight/shared";
import { adminApi } from "@/lib/admin";
import { colors } from "@/lib/theme";
import { Card, Loading, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { AdminVideo, Empty, NoticeText, SmallButton, useAdminAction } from "@/components/admin/AdminUi";
import { ClipFacts, RejectForm } from "@/components/admin/ClipReview";

/**
 * Tri des clips proposés : un avis par clip (valider ou refuser avec un motif). La modération confirme ensuite l'avis
 * ou le contredit ; un trieur ne voit jamais ses propres clips ni l'identité de l'auteur de l'envoi.
 */
export default function TriageScreen() {
  const [queue, setQueue] = useState<TriageClipDto[] | null>(null);
  const [stats, setStats] = useState<TriageStatsDto | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(() => {
    void run(async () => {
      const [q, s] = await Promise.all([adminApi.triageQueue(), adminApi.triageStats()]);
      setQueue(q);
      setStats(s);
    });
  }, [run]);
  useFocusEffect(load);

  const clip = queue?.[0];

  const decide = async (decision: "APPROVE" | "REJECT", note?: string) => {
    if (!clip) return;
    const done = await run(
      async () => {
        await adminApi.triage(clip.id, decision === "APPROVE" ? { decision } : { decision, note: note ?? "" });
        return true;
      },
      decision === "APPROVE" ? "Avis enregistré : à valider." : "Avis enregistré : à refuser.",
    );
    if (!done) return;
    setRejecting(false);
    setStats((s) => (s ? { ...s, today: s.today + 1, total: s.total + 1, awaiting: s.awaiting + 1, queue: Math.max(0, s.queue - 1) } : s));
    const rest = (queue ?? []).slice(1);
    setQueue(rest);
    if (!rest.length) load();
  };

  if (!queue) return notice ? <View style={{ padding: 16 }}><NoticeText notice={notice} /></View> : <Loading />;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      {stats && (
        <Text style={{ color: colors.muted }}>
          Aujourd&apos;hui : <Text style={{ color: colors.ink, fontWeight: "700" }}>{stats.today}</Text> · en attente de confirmation :{" "}
          <Text style={{ color: colors.ink, fontWeight: "700" }}>{stats.awaiting}</Text> · reste à trier :{" "}
          <Text style={{ color: colors.neon, fontWeight: "700" }}>{stats.queue}</Text>
        </Text>
      )}
      <NoticeText notice={notice} onPress={() => setNotice(null)} />
      {!clip ? (
        <Empty text={"Aucun clip à trier pour le moment.\nReviens plus tard !"} />
      ) : (
        <>
          <AdminVideo key={clip.id} url={clip.previewUrl} />
          <Card style={{ gap: 12 }}>
            <ClipFacts
              game={clip.game}
              rank={clip.claimedRank}
              durationSec={clip.durationSec}
              proofUrl={clip.proofUrl}
              inGamePseudo={clip.inGamePseudo}
              platform={clip.platform}
              region={clip.region}
              submitterNote={clip.submitterNote}
            />
          </Card>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
            Le clip est-il jouable ? Rang et pseudo invisibles à l&apos;écran, assez d&apos;action pour deviner, rang annoncé crédible.
          </Text>
          {rejecting ? (
            <Card>
              <RejectForm busy={busy} onCancel={() => setRejecting(false)} onReject={(reason) => void decide("REJECT", reason)} />
            </Card>
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton label={busy ? "…" : "Valider"} onPress={() => void decide("APPROVE")} disabled={busy} />
              <SmallButton label="Refuser…" tone="danger" onPress={() => setRejecting(true)} disabled={busy} />
            </View>
          )}
        </>
      )}
    </KeyboardScroll>
  );
}
