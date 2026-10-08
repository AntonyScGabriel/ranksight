import { useCallback, useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { ApiError, media } from "@/lib/api";
import { useStaffGuard } from "@/lib/staff";
import { colors, radius } from "@/lib/theme";

export type Notice = { text: string; ok: boolean } | null;

/** Message d'erreur lisible pour une action de l'administration */
export function adminError(e: unknown, fallback = "L'action n'a pas abouti, réessaie.") {
  if (e instanceof ApiError) {
    if (e.code === "CANCELLED") return null;
    if (e.status === 0 || (e.status < 500 && e.message && !/^HTTP \d+$/.test(e.message) && e.message !== e.code)) return e.message;
  }
  return fallback;
}

/**
 * Lance une action de l'administration : double authentification demandée si besoin (puis action relancée),
 * message de réussite ou d'erreur. Renvoie le résultat, ou undefined si l'action a échoué ou a été annulée.
 */
export function useAdminAction() {
  const guard = useStaffGuard();
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
      setBusy(true);
      setNotice(null);
      try {
        const r = await guard(action);
        if (success) setNotice({ text: typeof success === "function" ? success(r) : success, ok: true });
        return r;
      } catch (e) {
        const text = adminError(e);
        if (text) setNotice({ text, ok: false });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [guard],
  );
  return { run, notice, setNotice, busy };
}

export function NoticeText({ notice, onPress }: { notice: Notice; onPress?: () => void }) {
  if (!notice) return null;
  return (
    <Text
      onPress={onPress}
      accessibilityRole="alert"
      style={{
        color: notice.ok ? colors.success : colors.danger, backgroundColor: `${notice.ok ? colors.success : colors.danger}14`,
        borderRadius: 10, padding: 10, overflow: "hidden",
      }}
    >
      {notice.text}
    </Text>
  );
}

/** Choix parmi quelques options (onglets, durées, motifs…) */
export function Chips<T extends string | number>({
  options, value, onChange, wrap = true,
}: { options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; wrap?: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: wrap ? "wrap" : "nowrap", gap: 8 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={{
              borderWidth: 1.5, borderColor: active ? colors.neon : colors.line, backgroundColor: active ? `${colors.neon}14` : "transparent",
              borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
            }}
          >
            <Text style={{ color: active ? colors.neon : colors.ink, fontSize: 13, fontWeight: "600" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          { color: colors.ink, backgroundColor: colors.surface2, borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10 },
          props.multiline ? { minHeight: 70, textAlignVertical: "top" } : null,
          props.style,
        ]}
      />
      {hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

export function Tag({ label, color = colors.violetSoft }: { label: string; color?: string }) {
  return (
    <Text style={{ color, backgroundColor: `${color}1f`, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, fontSize: 11, fontWeight: "700", overflow: "hidden" }}>
      {label}
    </Text>
  );
}

/** Petit bouton d'action (liste de joueurs, signalements) */
export function SmallButton({ label, onPress, tone = "default", disabled }: { label: string; onPress: () => void; tone?: "default" | "danger" | "success"; disabled?: boolean }) {
  const color = tone === "danger" ? colors.danger : tone === "success" ? colors.success : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: tone === "default" ? colors.line : `${color}88`, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 8, opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: "45%", backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, padding: 12, gap: 4 }}>
      <Text style={{ color: colors.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: tone ?? colors.ink, fontSize: 22, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

/** Vidéo d'un clip à vérifier (lecture avec les commandes natives, son coupé au départ) */
export function AdminVideo({ url }: { url: string | null }) {
  const player = useVideoPlayer(url ? media(url) : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  if (!url) {
    return (
      <View style={{ aspectRatio: 16 / 9, borderRadius: radius.chip, backgroundColor: colors.abyss, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.muted }}>Vidéo indisponible</Text>
      </View>
    );
  }
  return (
    <View style={{ aspectRatio: 16 / 9, borderRadius: radius.chip, overflow: "hidden", backgroundColor: "black" }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture={false} />
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={{ color: colors.muted, textAlign: "center", marginTop: 40, lineHeight: 20 }}>{text}</Text>;
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
