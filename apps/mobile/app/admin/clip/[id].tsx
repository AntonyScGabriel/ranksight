import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CLIP_REPORT_REASON_LABEL } from "@ranksight/shared";
import { adminApi, type AdminClipDetail } from "@/lib/admin";
import { colors } from "@/lib/theme";
import { Card, Hud, Loading, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { AdminVideo, Chips, NoticeText, SmallButton, Tag, formatDateTime, useAdminAction } from "@/components/admin/AdminUi";
import { ClipFacts, RejectForm } from "@/components/admin/ClipReview";

const STATUS_LABEL: Record<string, string> = { PENDING_REVIEW: "En attente", APPROVED: "Accepté", REJECTED: "Refusé", ARCHIVED: "Retiré" };
const DIFFICULTIES = [1, 2, 3, 4, 5].map((d) => ({ value: d, label: `${d}` }));

/** Décision finale sur un clip : accepter (rang corrigé et difficulté si besoin) ou refuser avec un motif. */
export default function AdminClipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [clip, setClip] = useState<AdminClipDetail | null>(null);
  const [rankId, setRankId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const { run, notice, setNotice, busy } = useAdminAction();

  useFocusEffect(
    useCallback(() => {
      void run(async () => {
        const c = await adminApi.clip(id);
        setClip(c);
        setRankId(c.rankId);
        setDifficulty(c.difficulty);
      });
    }, [run, id]),
  );

  const done = (text: string) => {
    setNotice({ text, ok: true });
    setTimeout(() => router.back(), 700);
  };

  const approve = async () => {
    if (!clip) return;
    const ok = await run(async () => {
      await adminApi.review(clip.id, {
        decision: "APPROVE",
        ...(rankId && rankId !== clip.rankId ? { rankId } : {}),
        ...(difficulty && difficulty !== clip.difficulty ? { difficulty } : {}),
      });
      return true;
    });
    if (ok) done("Clip accepté : il peut maintenant être proposé aux joueurs.");
  };

  const reject = async (reason: string) => {
    if (!clip) return;
    const ok = await run(async () => {
      await adminApi.review(clip.id, { decision: "REJECT", reason });
      return true;
    });
    if (ok) done("Clip refusé : le joueur est prévenu avec le motif.");
  };

  const confirmTriage = async () => {
    if (!clip) return;
    const r = await run(() => adminApi.confirmTriage([clip.id]));
    if (r) done(clip.triageDecision === "APPROVE" ? "Avis confirmé : clip accepté." : "Avis confirmé : clip refusé.");
  };

  if (!clip) return notice ? <View style={{ padding: 16 }}><NoticeText notice={notice} /></View> : <Loading />;
  const pending = clip.status === "PENDING_REVIEW";
  const selectedRank = clip.game.ranks.find((r) => r.id === rankId) ?? clip.rank;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Tag label={STATUS_LABEL[clip.status] ?? clip.status} color={pending ? colors.warn : clip.status === "APPROVED" ? colors.success : colors.danger} />
        <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }}>
          {clip.source === "ADMIN" ? "Ajouté par l'équipe" : `Proposé par ${clip.uploader?.displayName ?? "un joueur"}`} le {formatDateTime(clip.createdAt)}
        </Text>
      </View>
      <AdminVideo url={clip.previewUrl} />
      <NoticeText notice={notice} onPress={() => setNotice(null)} />

      <Card style={{ gap: 12 }}>
        <ClipFacts
          game={clip.game}
          rank={clip.rank}
          durationSec={clip.durationSec}
          proofUrl={clip.proofUrl}
          inGamePseudo={clip.inGamePseudo}
          platform={clip.platform}
          region={clip.region}
          submitterNote={clip.submitterNote}
        />
        {clip.rejectionReason ? <Text style={{ color: colors.danger }}>Motif du refus : {clip.rejectionReason}</Text> : null}
      </Card>

      {clip.triageDecision && (
        <Card style={{ gap: 8, borderColor: clip.triageDecision === "APPROVE" ? colors.success : colors.danger }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            Avis de {clip.triagedBy?.displayName ?? "un trieur"} : {clip.triageDecision === "APPROVE" ? "valider" : "refuser"}
          </Text>
          {clip.triageNote ? <Text style={{ color: colors.muted }}>« {clip.triageNote} »</Text> : null}
          {pending && (
            <View style={{ flexDirection: "row" }}>
              <SmallButton label="Confirmer cet avis" tone={clip.triageDecision === "APPROVE" ? "success" : "danger"} onPress={() => void confirmTriage()} disabled={busy} />
            </View>
          )}
        </Card>
      )}

      {clip.reports.length > 0 && (
        <Card style={{ gap: 6 }}>
          <Hud>Signalements ({clip.reports.length})</Hud>
          {clip.reports.map((r) => (
            <Text key={r.id} style={{ color: colors.muted }}>
              • {CLIP_REPORT_REASON_LABEL[r.reason]}
              {r.details ? ` — ${r.details}` : ""}
            </Text>
          ))}
        </Card>
      )}

      {pending && (
        <Card style={{ gap: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>Décision</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Rang du clip (corrige-le si le rang annoncé est faux)</Text>
          <Chips options={clip.game.ranks.map((r) => ({ value: r.id, label: r.name }))} value={rankId} onChange={setRankId} />
          {selectedRank.id !== clip.rankId && <Text style={{ color: colors.warn, fontSize: 12 }}>Rang corrigé : {selectedRank.name}</Text>}
          <Text style={{ color: colors.muted, fontSize: 13 }}>Difficulté (1 facile · 5 très difficile)</Text>
          <Chips options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
          {rejecting ? (
            <RejectForm busy={busy} onCancel={() => setRejecting(false)} onReject={(reason) => void reject(reason)} />
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton label={busy ? "…" : "Accepter le clip"} onPress={() => void approve()} disabled={busy} />
              <SmallButton label="Refuser…" tone="danger" onPress={() => setRejecting(true)} disabled={busy} />
            </View>
          )}
        </Card>
      )}
    </KeyboardScroll>
  );
}
