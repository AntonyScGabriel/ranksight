import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  SUGGESTION_CATEGORY_LABEL, SUGGESTION_MAX_LENGTH, SUGGESTION_STATUS_LABEL, SUGGESTIONS_PER_DAY, SuggestionInput, firstIssue,
  type SuggestionCategory, type SuggestionDto, type SuggestionStatus,
} from "@ranksight/shared";
import { ApiError, api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { Card, Hud, Loading, LoginRequired, Message, PrimaryButton } from "@/components/ui";
import { KeyboardScroll } from "@/components/Keyboard";
import { Chips, Field, NoticeText, SmallButton, type Notice } from "@/components/admin/AdminUi";

const STATUS_COLOR: Record<SuggestionStatus, string> = {
  NEW: colors.muted,
  PLANNED: colors.violetSoft,
  DONE: colors.success,
  DECLINED: colors.danger,
};
const CATEGORIES = (Object.keys(SUGGESTION_CATEGORY_LABEL) as SuggestionCategory[]).map((c) => ({ value: c, label: SUGGESTION_CATEGORY_LABEL[c] }));

const readable = (e: unknown, fallback: string) => (e instanceof ApiError && e.message && !/^HTTP \d+$/.test(e.message) ? e.message : fallback);

/** Boîte à idées : le joueur propose des améliorations et suit leur traitement par l'équipe. */
export default function SuggestionsScreen() {
  const { me, loading } = useSession();
  const [list, setList] = useState<SuggestionDto[] | null>(null);
  const [category, setCategory] = useState<SuggestionCategory>("FEATURE");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(() => {
    if (!me) return;
    api.mySuggestions().then(setList).catch(() => setList([]));
  }, [me]);
  useFocusEffect(load);

  const send = async () => {
    const parsed = SuggestionInput.safeParse({ category, text });
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    setBusy(true);
    setNotice(null);
    try {
      await api.suggest(parsed.data);
      setText("");
      setNotice({ text: "Merci ! Ta suggestion a été transmise à l'équipe.", ok: true });
      load();
    } catch (e) {
      setNotice({ text: readable(e, "La suggestion n'a pas pu être envoyée, réessaie dans un instant."), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (s: SuggestionDto) => {
    const ok = await confirm({ title: "Retirer cette suggestion ?", message: "Elle sera supprimée définitivement.", confirmLabel: "Retirer", danger: true });
    if (ok === false) return;
    try {
      await api.withdrawSuggestion(s.id);
    } catch (e) {
      setNotice({ text: readable(e, "Impossible de retirer la suggestion."), ok: false });
    }
    load();
  };

  if (loading) return <Loading />;
  if (!me) return <View style={{ flex: 1, padding: 16 }}><LoginRequired text="Connecte-toi pour proposer une idée à l'équipe." /></View>;

  return (
    <KeyboardScroll contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <Text style={{ color: colors.muted, lineHeight: 20 }}>
        Une idée pour améliorer RankGuess ? Un mode de jeu, un jeu à ajouter, un détail à corriger : l&apos;équipe lit chaque suggestion et te répond ici.
      </Text>

      <Card style={{ gap: 12 }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Catégorie</Text>
        <Chips options={CATEGORIES} value={category} onChange={setCategory} />
        <Field
          label="Ton idée"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={SUGGESTION_MAX_LENGTH}
          style={{ minHeight: 110 }}
          placeholder="Ex. Ajouter un mode chronométré où chaque clip ne dure que 10 secondes."
          hint={`${text.length}/${SUGGESTION_MAX_LENGTH} · ${SUGGESTIONS_PER_DAY} suggestions maximum par 24 heures`}
        />
        <NoticeText notice={notice} onPress={() => setNotice(null)} />
        <PrimaryButton label={busy ? "Envoi…" : "Envoyer"} onPress={() => void send()} disabled={busy || text.trim().length < 10} />
      </Card>

      <Hud>Mes suggestions</Hud>
      {!list ? (
        <Loading />
      ) : list.length === 0 ? (
        <Message title="Aucune suggestion pour l'instant" text="Tes idées et les réponses de l'équipe apparaîtront ici." />
      ) : (
        list.map((s) => (
          <Card key={s.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
                {SUGGESTION_CATEGORY_LABEL[s.category]} · {new Date(s.createdAt).toLocaleDateString("fr-FR")}
              </Text>
              <Text style={{ color: STATUS_COLOR[s.status], fontWeight: "700", fontSize: 12 }}>{SUGGESTION_STATUS_LABEL[s.status]}</Text>
            </View>
            <Text style={{ color: colors.ink, lineHeight: 20 }}>{s.text}</Text>
            {s.reply ? (
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: `${colors.violet}55`, backgroundColor: `${colors.violet}1a`, padding: 10 }}>
                <Text style={{ color: colors.ink, lineHeight: 19 }}>
                  <Text style={{ fontWeight: "700" }}>Réponse de l&apos;équipe : </Text>
                  {s.reply}
                </Text>
              </View>
            ) : null}
            {s.status === "NEW" && !s.reply ? (
              <View style={{ flexDirection: "row" }}>
                <SmallButton label="Retirer" tone="danger" onPress={() => void withdraw(s)} />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </KeyboardScroll>
  );
}
