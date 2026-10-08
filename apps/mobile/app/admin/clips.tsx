import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { adminApi, type AdminClipRow } from "@/lib/admin";
import { colors, radius } from "@/lib/theme";
import { Loading } from "@/components/ui";
import { Chips, Empty, NoticeText, SmallButton, Tag, formatDateTime, useAdminAction } from "@/components/admin/AdminUi";

type View_ = "TRIAGED" | "UNTRIAGED";
const VIEWS = [
  { value: "TRIAGED", label: "Pré-triés" },
  { value: "UNTRIAGED", label: "Sans avis" },
] as const;

/** Clips proposés en attente de la décision finale (modération). Les clips pré-triés se confirment en un appui. */
export default function AdminClips() {
  const [view, setView] = useState<View_>("TRIAGED");
  const [items, setItems] = useState<AdminClipRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { run, notice, setNotice, busy } = useAdminAction();

  const load = useCallback(
    (v: View_, p = 1) => {
      void run(async () => {
        const r = await adminApi.clips(v, p);
        setItems((list) => (p === 1 ? r.items : [...(list ?? []), ...r.items]));
        setTotal(r.total);
        setPage(p);
      });
    },
    [run],
  );
  useFocusEffect(useCallback(() => load(view), [load, view]));

  const change = (v: View_) => {
    setView(v);
    setItems(null);
    load(v);
  };

  /** Confirme d'un coup les avis des trieurs affichés (50 au plus) */
  const confirmAll = async () => {
    const ids = (items ?? []).filter((c) => c.triageDecision).slice(0, 50).map((c) => c.id);
    if (!ids.length) return;
    const r = await run(() => adminApi.confirmTriage(ids), (res) => `${res.approved} validé(s), ${res.rejected} refusé(s).`);
    if (r) load(view);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, paddingBottom: 8, gap: 10 }}>
        <Chips options={VIEWS} value={view} onChange={change} />
        <NoticeText notice={notice} onPress={() => setNotice(null)} />
        {view === "TRIAGED" && !!items?.length && (
          <View style={{ flexDirection: "row" }}>
            <SmallButton label={`Confirmer les ${Math.min(items.length, 50)} avis affichés`} tone="success" onPress={() => void confirmAll()} disabled={busy} />
          </View>
        )}
      </View>
      {!items ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text={view === "TRIAGED" ? "Aucun clip pré-trié en attente." : "Aucun clip en attente sans avis."} />}
          ListFooterComponent={
            items.length < total ? (
              <SmallButton label={`Afficher plus (${total - items.length})`} onPress={() => load(view, page + 1)} disabled={busy} />
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/admin/clip/[id]", params: { id: item.id } })}
              style={({ pressed }) => ({ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 6, opacity: pressed ? 0.75 : 1 })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: colors.ink, fontWeight: "700", flex: 1 }}>
                  {item.game.name} · {item.rank.name}
                </Text>
                {item.triageDecision && (
                  <Tag label={item.triageDecision === "APPROVE" ? "Avis : valider" : "Avis : refuser"} color={item.triageDecision === "APPROVE" ? colors.success : colors.danger} />
                )}
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Proposé {item.uploader ? `par ${item.uploader.displayName} ` : ""}le {formatDateTime(item.createdAt)} · {Math.round(item.durationSec)} s
              </Text>
              {item.triageNote ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {item.triagedBy?.displayName ?? "Trieur"} : « {item.triageNote} »
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
