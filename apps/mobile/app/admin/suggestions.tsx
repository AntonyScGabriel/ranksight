import { useCallback, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  SUGGESTION_CATEGORY_LABEL, SUGGESTION_REPLY_MAX_LENGTH, SUGGESTION_STATUS_LABEL, isStaffRole,
  type AdminSuggestionDto, type AdminSuggestionsDto, type SuggestionStatus,
} from "@ranksight/shared";
import { adminApi } from "@/lib/admin";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { Loading } from "@/components/ui";
import { Chips, Empty, Field, NoticeText, SmallButton, Tag, formatDateTime, useAdminAction } from "@/components/admin/AdminUi";

const STATUSES = Object.keys(SUGGESTION_STATUS_LABEL) as SuggestionStatus[];
const STATUS_COLOR: Record<SuggestionStatus, string> = { NEW: colors.warn, PLANNED: colors.violetSoft, DONE: colors.success, DECLINED: colors.danger };

function SuggestionCard({ s, busy, onSave, onDelete }: {
  s: AdminSuggestionDto;
  busy: boolean;
  onSave: (s: AdminSuggestionDto, status: SuggestionStatus, reply: string) => Promise<boolean>;
  onDelete: (s: AdminSuggestionDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SuggestionStatus>(s.status === "NEW" ? "PLANNED" : s.status);
  const [reply, setReply] = useState(s.reply ?? "");
  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Tag label={SUGGESTION_STATUS_LABEL[s.status]} color={STATUS_COLOR[s.status]} />
        <Text style={{ color: colors.ink, fontWeight: "700" }}>{s.author.displayName}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{SUGGESTION_CATEGORY_LABEL[s.category]}</Text>
      </View>
      <Text style={{ color: colors.ink, lineHeight: 20 }}>{s.text}</Text>
      {s.reply && !open ? <Text style={{ color: colors.muted }}>Réponse{s.repliedBy ? ` de ${s.repliedBy}` : ""} : {s.reply}</Text> : null}
      <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDateTime(s.createdAt)}</Text>
      {open ? (
        <View style={{ gap: 10 }}>
          <Chips options={STATUSES.map((v) => ({ value: v, label: SUGGESTION_STATUS_LABEL[v] }))} value={status} onChange={setStatus} />
          <Field
            label="Réponse à l'auteur (facultative)"
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={SUGGESTION_REPLY_MAX_LENGTH}
            hint={`${reply.length}/${SUGGESTION_REPLY_MAX_LENGTH}`}
          />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <SmallButton label="Annuler" onPress={() => setOpen(false)} disabled={busy} />
            <SmallButton
              label="Enregistrer"
              tone="success"
              disabled={busy}
              onPress={() => void onSave(s, status, reply).then((ok) => ok && setOpen(false))}
            />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SmallButton label={s.status === "NEW" ? "Traiter" : "Modifier"} onPress={() => setOpen(true)} disabled={busy} />
          <SmallButton label="Supprimer" tone="danger" onPress={() => onDelete(s)} disabled={busy} />
        </View>
      )}
    </View>
  );
}

/** Suggestions des joueurs : statut (retenue, réalisée, non retenue) et réponse visible par l'auteur. */
export default function AdminSuggestions() {
  const { me } = useSession();
  const [tab, setTab] = useState<SuggestionStatus>("NEW");
  const [data, setData] = useState<AdminSuggestionsDto | null>(null);
  const { run, notice, setNotice, busy } = useAdminAction();
  const confirm = useConfirm();

  const load = useCallback(() => {
    void run(async () => setData(await adminApi.suggestions(tab)));
  }, [run, tab]);
  useFocusEffect(load);

  if (!isStaffRole(me?.role)) return <Empty text="Réservé à la modération." />;

  const save = async (s: AdminSuggestionDto, status: SuggestionStatus, reply: string) => {
    const r = await run(() => adminApi.reviewSuggestion(s.id, { status, reply: reply.trim() || null }), `Suggestion de ${s.author.displayName} enregistrée.`);
    if (r !== undefined) load();
    return r !== undefined;
  };

  const remove = async (s: AdminSuggestionDto) => {
    const ok = await confirm({
      title: "Supprimer cette suggestion ?",
      message: "À réserver aux messages hors sujet, abusifs ou en double : l'auteur ne la verra plus.",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok === false) return;
    const done = await run(async () => {
      await adminApi.deleteSuggestion(s.id);
      return true;
    }, "Suggestion supprimée.");
    if (done) load();
  };

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      data={data?.items ?? []}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Chips
            options={STATUSES.map((v) => ({ value: v, label: `${SUGGESTION_STATUS_LABEL[v]}${data ? ` (${data.counts[v]})` : ""}` }))}
            value={tab}
            onChange={(v) => {
              setData(null);
              setTab(v);
            }}
          />
          <NoticeText notice={notice} onPress={() => setNotice(null)} />
          {data && data.total > data.items.length ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>{data.items.length} sur {data.total} affichées : la liste complète est dans l&apos;administration web.</Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={data ? <Empty text={tab === "NEW" ? "Aucune suggestion en attente." : "Aucune suggestion ici."} /> : <Loading />}
      renderItem={({ item }) => <SuggestionCard key={`${item.id}-${item.status}-${item.reply ?? ""}`} s={item} busy={busy} onSave={save} onDelete={remove} />}
    />
  );
}
