import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SLOW_MODE_CHOICES, isStaffRole, type GlobalMessageDto } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useStaffGuard } from "@/lib/staff";
import { colors, radius } from "@/lib/theme";
import { errorMessage } from "./AuthUi";

const MUTES: [number, string][] = [[1, "1 heure"], [24, "24 heures"], [24 * 7, "7 jours"]];

export const slowModeLabel = (sec: number) => (sec >= 60 ? `${sec / 60} min` : `${sec} s`);

/**
 * Actions de l'équipe sur un message du chat global (appui long) : supprimer le message,
 * couper le chat du joueur, effacer ses messages des dernières 24 heures.
 */
export function ModSheet({
  message, onClose, onDeleted, onNotice,
}: {
  message: GlobalMessageDto | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onNotice: (text: string, ok: boolean) => void;
}) {
  const confirm = useConfirm();
  const guard = useStaffGuard();
  const name = message?.author.displayName ?? "";
  const isTeam = message ? isStaffRole(message.author.role) : false;

  const run = async (action: () => Promise<string>) => {
    onClose();
    try {
      onNotice(await guard(action), true);
    } catch (e) {
      onNotice(errorMessage(e, "Action impossible."), false);
    }
  };

  const remove = () => {
    if (!message) return;
    const id = message.id;
    void run(async () => {
      await api.deleteGlobal(id);
      onDeleted(id);
      return "Message supprimé.";
    });
  };

  const mute = async (hours: number, label: string) => {
    if (!message) return;
    const userId = message.author.id;
    onClose();
    const ok = await confirm({ title: `Couper le chat de ${name} ?`, message: `${name} ne pourra plus écrire (chat global et messages privés) pendant ${label}.`, confirmLabel: "Couper le chat", danger: true });
    if (ok === false) return;
    await run(async () => {
      await api.muteUser(userId, hours);
      return `Chat de ${name} coupé pendant ${label}.`;
    });
  };

  const purge = async () => {
    if (!message) return;
    const userId = message.author.id;
    onClose();
    const ok = await confirm({ title: `Effacer les messages de ${name} ?`, message: "Tous ses messages du chat global des dernières 24 heures seront supprimés.", confirmLabel: "Effacer", danger: true });
    if (ok === false) return;
    await run(async () => {
      const r = await api.purgeMessages(userId, 24);
      return `${r.deleted} message${r.deleted > 1 ? "s" : ""} de ${name} effacé${r.deleted > 1 ? "s" : ""}.`;
    });
  };

  return (
    <Modal visible={!!message} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: 16, gap: 4 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginBottom: 2 }}>Modérer · {name}</Text>
          {message ? <Text numberOfLines={2} style={{ color: colors.muted, marginBottom: 8 }}>{message.body}</Text> : null}
          <Item label="Supprimer le message" onPress={remove} />
          {!isTeam && (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8 }}>COUPER LE CHAT</Text>
              {MUTES.map(([h, label]) => <Item key={h} label={label} onPress={() => void mute(h, label)} />)}
              <Item label="Effacer ses messages (24 h)" danger onPress={() => void purge()} />
            </>
          )}
          <Item label="Annuler" muted onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Item({ label, onPress, danger, muted }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: danger ? colors.danger : muted ? colors.muted : colors.ink, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** Réglage du mode lent depuis le chat (équipe) */
export function SlowModeBar({ value, onChange, onError }: { value: number; onChange: (v: number) => void; onError: (text: string) => void }) {
  const guard = useStaffGuard();
  const [pending, setPending] = useState(false);
  const set = async (sec: number) => {
    if (sec === value || pending) return;
    setPending(true);
    try {
      onChange((await guard(() => api.setSlowMode(sec))).slowModeSec);
    } catch (e) {
      onError(errorMessage(e, "Le mode lent n'a pas pu être modifié."));
    } finally {
      setPending(false);
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Mode lent</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {SLOW_MODE_CHOICES.map((s) => (
          <Pressable
            key={s}
            onPress={() => void set(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: s === value }}
            style={{ borderRadius: 999, borderWidth: 1, borderColor: s === value ? colors.neon : colors.line, paddingHorizontal: 10, paddingVertical: 4, opacity: pending ? 0.5 : 1 }}
          >
            <Text style={{ color: s === value ? colors.neon : colors.ink, fontSize: 12 }}>{s === 0 ? "Non" : slowModeLabel(s)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
