import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CHAT_REPORT_REASON_LABEL, CHAT_REPORT_REASONS, type ChatReportReason } from "@ranksight/shared";
import { api } from "@/lib/api";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "./AuthUi";
import { GhostButton, PrimaryButton } from "./ui";
import { KeyboardView } from "@/components/Keyboard";

export interface ReportTarget {
  id: string;
  name: string;
  globalMessageId?: string;
  directMessageId?: string;
}

/** Signaler un joueur (et le message concerné) à l'équipe de modération. */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<{ pending?: boolean; done?: boolean; error?: string }>({});

  const close = () => {
    setReason(null);
    setDetails("");
    setState({});
    onClose();
  };

  const send = async () => {
    if (!target || !reason) return;
    setState({ pending: true });
    try {
      await api.reportPlayer({
        targetUserId: target.id, reason, details: details.trim() || undefined,
        globalMessageId: target.globalMessageId, directMessageId: target.directMessageId,
      });
      setState({ done: true });
    } catch (e) {
      setState({ error: errorMessage(e, "Le signalement n'a pas pu être envoyé.") });
    }
  };

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={close}>
      <KeyboardView style={{ backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 12, maxHeight: "85%" }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>Signaler {target?.name}</Text>
          {state.done ? (
            <>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Merci : l&apos;équipe de modération va examiner ton signalement. Tu peux aussi bloquer ce joueur depuis son profil.
              </Text>
              <PrimaryButton label="Fermer" onPress={close} />
            </>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
              {CHAT_REPORT_REASONS.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setReason(r)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === r }}
                  style={{ borderWidth: 1.5, borderColor: reason === r ? colors.violet : colors.line, borderRadius: 10, padding: 12 }}
                >
                  <Text style={{ color: colors.ink }}>{CHAT_REPORT_REASON_LABEL[r]}</Text>
                </Pressable>
              ))}
              <TextInput
                value={details}
                onChangeText={setDetails}
                maxLength={500}
                multiline
                placeholder="Précisions (facultatif)"
                placeholderTextColor={colors.muted}
                style={{ minHeight: 70, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, textAlignVertical: "top" }}
              />
              {state.error && <Text style={{ color: colors.danger }}>{state.error}</Text>}
              <PrimaryButton label={state.pending ? "Envoi…" : "Envoyer"} onPress={send} disabled={!reason || state.pending} />
              <GhostButton label="Annuler" onPress={close} />
            </ScrollView>
          )}
        </View>
      </KeyboardView>
    </Modal>
  );
}
