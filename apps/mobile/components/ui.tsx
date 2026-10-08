import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type ViewProps } from "react-native";
import { NO_CLIP_MESSAGES, type CosmeticRefDto } from "@ranksight/shared";
import { useState } from "react";
import { media } from "@/lib/api";
import { colors, font, radius } from "@/lib/theme";
import { FrameRing } from "./Flair";

export function Card({ style, ...props }: ViewProps) {
  return <View style={[styles.card, style]} {...props} />;
}

export function Hud({ children }: { children: React.ReactNode }) {
  return <Text style={font.hud}>{children}</Text>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <Text style={{ color: colors.muted, textAlign: center ? "center" : "left", lineHeight: 20 }}>{children}</Text>;
}

export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <LinearGradient colors={[colors.violet, colors.neonBlue]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
        <Text style={styles.buttonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.7 }]}>
      <Text style={{ color: danger ? colors.danger : colors.ink, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** Avatar du joueur (photo ou initiale), entouré de son cadre équipé s'il en a un */
export function Avatar({ name, url, size = 36, frame }: { name: string; url: string | null; size?: number; frame?: CosmeticRefDto | null }) {
  // Photo introuvable (supprimée, lien externe expiré) : on revient à l'initiale
  const [failed, setFailed] = useState<string | null>(null);
  const inner = url && failed !== url ? (
    <Image source={{ uri: media(url) }} onError={() => setFailed(url)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.violet, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "white", fontWeight: "700", fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
  if (!frame) return inner;
  const ring = Math.max(2, Math.round(size / 14));
  return <FrameRing frame={frame} size={size + ring * 2} ring={ring}>{inner}</FrameRing>;
}

export function Loading() {
  return <ActivityIndicator color={colors.violet} style={{ marginTop: 80 }} />;
}

export function Message({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <Card style={{ marginTop: 40, gap: 14 }}>
      <Text style={[styles.title, { textAlign: "center" }]}>{title}</Text>
      {text ? <Muted center>{text}</Muted> : null}
      {children}
    </Card>
  );
}

export function NoClip({ children }: { children?: React.ReactNode }) {
  return <Message title={NO_CLIP_MESSAGES.title} text={NO_CLIP_MESSAGES.subtitle}>{children}</Message>;
}

export function LoginRequired({ text = "Connecte-toi pour jouer et garder ta progression." }: { text?: string }) {
  return (
    <Message title="Connexion requise" text={text}>
      <PrimaryButton label="Se connecter" onPress={() => router.push("/login")} />
    </Message>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 16 },
  title: { color: colors.ink, fontSize: 22, ...font.display },
  button: { borderRadius: radius.chip, paddingVertical: 15, alignItems: "center" },
  buttonText: { color: "white", fontSize: 15, ...font.display, textTransform: "uppercase" },
  ghost: { borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, paddingVertical: 13, alignItems: "center" },
});
