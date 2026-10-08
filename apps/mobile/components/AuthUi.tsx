import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { signIn } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { colors } from "@/lib/theme";

export const OAUTH_ERRORS: Record<string, string> = {
  expired: "La demande de connexion a expiré, réessaie.",
  disabled: "Ce compte est suspendu.",
  unavailable: "Ce mode de connexion n'est pas disponible pour le moment.",
  email_in_use: "Un compte RankGuess utilise déjà cette adresse email. Connecte-toi avec ton email et ton mot de passe.",
  failed: "La connexion a échoué, réessaie.",
};

export function errorMessage(err: unknown, fallback = "Une erreur est survenue, réessaie dans un instant.") {
  if (!(err instanceof ApiError)) return fallback;
  if (err.status === 429 && err.code !== "SLOW_DOWN") return "Trop de tentatives. Patiente quelques minutes avant de réessayer.";
  if (err.status >= 500) return fallback;
  if (err.message && !/^HTTP \d+$/.test(err.message) && err.message !== err.code) return err.message;
  return fallback;
}

/** Boutons Google et Discord, toujours affichés ; un message s'affiche si le fournisseur n'est pas activé sur le serveur. */
export function OAuthButtons({ onSuccess, onError, disabled }: { onSuccess: () => void; onError: (m: string | null) => void; disabled?: boolean }) {
  const [providers, setProviders] = useState<{ google: boolean; discord: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.providers().then(setProviders).catch(() => setProviders({ google: false, discord: false }));
  }, []);

  const go = async (p: "google" | "discord") => {
    onError(null);
    if (providers && !providers[p]) return onError(OAUTH_ERRORS.unavailable);
    setPending(true);
    try {
      const r = await signIn(p);
      if (r.status === "success") onSuccess();
      else if (r.status === "error") onError(OAUTH_ERRORS[r.reason] ?? OAUTH_ERRORS.failed);
    } catch {
      onError(OAUTH_ERRORS.failed);
    } finally {
      setPending(false);
    }
  };

  const off = disabled || pending;
  return (
    <View style={{ gap: 12 }}>
      <Pressable disabled={off} onPress={() => go("google")} style={{ backgroundColor: "white", padding: 16, borderRadius: 12, opacity: off ? 0.6 : 1 }} accessibilityRole="button">
        <Text style={{ color: "black", textAlign: "center", fontWeight: "700" }}>Continuer avec Google</Text>
      </Pressable>
      <Pressable disabled={off} onPress={() => go("discord")} style={{ backgroundColor: "#5865F2", padding: 16, borderRadius: 12, opacity: off ? 0.6 : 1 }} accessibilityRole="button">
        <Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>Continuer avec Discord</Text>
      </Pressable>
    </View>
  );
}

export function Divider() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      <Text style={{ color: colors.muted, fontSize: 12, letterSpacing: 2 }}>OU</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
    </View>
  );
}

export function Field({ label, error, hint, ...input }: { label: string; error?: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.ink, fontWeight: "600" }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        {...input}
        style={{
          color: colors.ink, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.line,
          borderWidth: 1, borderRadius: 12, padding: 14,
        }}
      />
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text accessibilityRole="alert" style={{ color: colors.danger, textAlign: "center" }}>{message}</Text>;
}
