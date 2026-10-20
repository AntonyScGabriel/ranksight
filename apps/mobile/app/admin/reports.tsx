import { useCallback, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { CHAT_REPORT_REASON_LABEL, CLIP_REPORT_REASON_LABEL, isAdminRole, isStaffRole } from "@ranksight/shared";
import { adminApi, type ClipReport, type PlayerReport } from "@/lib/admin";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Loading } from "@/components/ui";
import { Chips, Empty, NoticeText, SmallButton, Tag, formatDateTime, useAdminAction } from "@/components/admin/AdminUi";

type Tab = "players" | "clips";
const MUTE_CHOICES = [
  { value: 0, label: "Pas de coupure" },
  { value: 1, label: "1 h" },
  { value: 24, label: "24 h" },
  { value: 168, label: "7 jours" },
] as const;

function PlayerReportCard({ report, canBan, busy, onResolve }: {
  report: PlayerReport;
  canBan: boolean;
  busy: boolean;
  onResolve: (r: PlayerReport, body: { status: "RESOLVED" | "DISMISSED"; deleteMessage: boolean; muteHours: number; ban: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState(!!report.globalMessage && !report.globalMessage.deletedAt);
  const [muteHours, setMuteHours] = useState<number>(0);
  const team = isStaffRole(report.target.role);
  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag label={CHAT_REPORT_REASON_LABEL[report.reason]} color={colors.danger} />
        <Text
          onPress={() => router.push({ pathname: "/player/[id]", params: { id: report.target.id } })}
          style={{ color: colors.ink, fontWeight: "700", textDecorationLine: "underline" }}
        >
          {report.target.displayName}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>signalé {report.target._count.chatReportsAbout} fois</Text>
      </View>
      {report.excerpt ? (
        <Text style={{ color: colors.ink, backgroundColor: colors.surface2, borderRadius: 8, padding: 8, overflow: "hidden" }}>
          « {report.excerpt} »{report.globalMessage?.deletedAt ? "  (déjà supprimé)" : ""}
        </Text>
      ) : null}
      {report.details ? <Text style={{ color: colors.muted }}>Précisions : {report.details}</Text> : null}
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Par {report.reporter.displayName} · {formatDateTime(report.createdAt)}
        {report.directMessageId ? " · message privé" : report.globalMessageId ? " · chat global" : report.gameMessageId ? " · tchat de salon ou tournoi" : ""}
      </Text>
      {open ? (
        <View style={{ gap: 10 }}>
          {report.globalMessage && !report.globalMessage.deletedAt && (
            <Chips
              options={[{ value: "yes", label: "Supprimer le message" }, { value: "no", label: "Garder le message" }]}
              value={deleteMessage ? "yes" : "no"}
              onChange={(v) => setDeleteMessage(v === "yes")}
            />
          )}
          {!team && <Chips options={MUTE_CHOICES} value={muteHours} onChange={setMuteHours} />}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <SmallButton label="Sanctionner" tone="danger" disabled={busy} onPress={() => onResolve(report, { status: "RESOLVED", deleteMessage, muteHours, ban: false })} />
            {canBan && !team && report.target.status === "ACTIVE" && (
              <SmallButton label="Bannir" tone="danger" disabled={busy} onPress={() => onResolve(report, { status: "RESOLVED", deleteMessage, muteHours: 0, ban: true })} />
            )}
            <SmallButton label="Annuler" disabled={busy} onPress={() => setOpen(false)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SmallButton label="Agir…" tone="danger" disabled={busy} onPress={() => setOpen(true)} />
          <SmallButton label="Classer sans suite" disabled={busy} onPress={() => onResolve(report, { status: "DISMISSED", deleteMessage: false, muteHours: 0, ban: false })} />
        </View>
      )}
    </View>
  );
}

/** Signalements ouverts : joueurs (chat, pseudo, photo) et clips. */
export default function AdminReports() {
  const { me } = useSession();
  const confirmBan = isAdminRole(me?.role);
  const [tab, setTab] = useState<Tab>("players");
  const [players, setPlayers] = useState<PlayerReport[] | null>(null);
  const [clips, setClips] = useState<ClipReport[] | null>(null);
  const [counts, setCounts] = useState({ players: 0, clips: 0 });
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(() => {
    void run(async () => {
      const [p, c] = await Promise.all([adminApi.playerReports(), adminApi.clipReports()]);
      setPlayers(p.items);
      setClips(c.items);
      setCounts({ players: p.total, clips: c.total });
    });
  }, [run]);
  useFocusEffect(load);

  const resolvePlayer = async (r: PlayerReport, body: { status: "RESOLVED" | "DISMISSED"; deleteMessage: boolean; muteHours: number; ban: boolean }) => {
    const ok = await run(async () => {
      await adminApi.resolvePlayerReport(r.id, body);
      return true;
    }, body.status === "DISMISSED" ? "Signalement classé sans suite." : body.ban ? `${r.target.displayName} est banni.` : "Signalement traité.");
    if (ok) load();
  };

  const resolveClip = async (r: ClipReport, status: "RESOLVED" | "DISMISSED", archiveClip: boolean) => {
    const ok = await run(async () => {
      await adminApi.resolveClipReport(r.id, { status, resolution: "", archiveClip });
      return true;
    }, archiveClip ? "Clip retiré du jeu." : status === "DISMISSED" ? "Signalement classé sans suite." : "Signalement traité.");
    if (ok) load();
  };

  const tabs = [
    { value: "players", label: `Joueurs (${counts.players})` },
    { value: "clips", label: `Clips (${counts.clips})` },
  ] as const;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
        <Chips options={tabs} value={tab} onChange={setTab} />
        <NoticeText notice={notice} onPress={() => setNotice(null)} />
      </View>
      {!players || !clips ? (
        <Loading />
      ) : tab === "players" ? (
        <FlatList
          data={players}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text="Aucun joueur signalé." />}
          renderItem={({ item }) => <PlayerReportCard report={item} canBan={confirmBan} busy={busy} onResolve={(r, b) => void resolvePlayer(r, b)} />}
        />
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text="Aucun clip signalé." />}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Tag label={CLIP_REPORT_REASON_LABEL[item.reason]} color={colors.danger} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>{item.clip.reportCount} signalement(s) sur ce clip</Text>
              </View>
              {item.details ? <Text style={{ color: colors.ink }}>{item.details}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 12 }}>Par {item.reporter.displayName} · {formatDateTime(item.createdAt)}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <SmallButton label="Voir le clip" onPress={() => router.push({ pathname: "/admin/clip/[id]", params: { id: item.clip.id } })} />
                <SmallButton label="Retirer le clip" tone="danger" disabled={busy} onPress={() => void resolveClip(item, "RESOLVED", true)} />
                <SmallButton label="Classer sans suite" disabled={busy} onPress={() => void resolveClip(item, "DISMISSED", false)} />
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
