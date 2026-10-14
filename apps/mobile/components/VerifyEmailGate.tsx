import { useEffect, useState } from "react";
import { AppState, Modal, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/lib/theme";
import { errorMessage, Field } from "./AuthUi";
import { GhostButton, PrimaryButton } from "./ui";

/**
 * Inscription par email : le compte est bloqué tant que l'adresse n'est pas confirmée. Le lien s'ouvre dans le
 * navigateur ; au retour dans l'application, l'état du compte est relu.
 */
export function VerifyEmailGate() {
  const { me, refresh, logout } = useSession();
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [changing, setChanging] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const waiting = !!me?.mustVerifyEmail;

  useEffect(() => {
    if (!waiting) return;
    const sub = AppState.addEventListener("change", (state) => state === "active" && void refresh());
    return () => sub.remove();
  }, [waiting, refresh]);

  if (!me || !me.mustVerifyEmail || !me.termsAccepted) return null;

  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ text: success, ok: true });
      return true;
    } catch (e) {
      setNotice({ text: errorMessage(e), ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    await refresh();
    setNotice({ text: "Adresse pas encore confirmée : ouvre le lien reçu par email, puis réessaie.", ok: false });
  };

  const change = async () => {
    const next = email.trim().toLowerCase();
    if (await act(() => api.changeEmail(next, password), `Adresse modifiée : un nouveau lien a été envoyé à ${next}.`)) {
      setChanging(false);
      setEmail("");
      setPassword("");
      await refresh();
    }
  };

  return (
    <Modal visible transparent animationType="fade">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
        style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 14 }}>
          <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>Confirme ton adresse email</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Un lien de confirmation a été envoyé à <Text style={{ color: colors.ink, fontWeight: "700" }}>{me.email}</Text>. Ouvre-le pour activer ton
            compte, puis reviens ici. Pense à regarder dans les courriers indésirables.
          </Text>
          {notice && <Text style={{ color: notice.ok ? colors.success : colors.danger }}>{notice.text}</Text>}
          {changing ? (
            <>
              <Field label="Nouvelle adresse email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <Field label="Mot de passe du compte" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
              <PrimaryButton label={busy ? "…" : "Envoyer le lien"} onPress={() => void change()} disabled={busy || !email.includes("@") || !password} />
              <GhostButton label="Annuler" onPress={() => setChanging(false)} />
            </>
          ) : (
            <>
              <PrimaryButton label="J'ai confirmé" onPress={() => void check()} disabled={busy} />
              <GhostButton label="Renvoyer l'email" onPress={() => void act(() => api.resendVerification(), `Nouveau lien envoyé à ${me.email}.`)} />
              {me.hasPassword && <GhostButton label="Mauvaise adresse ?" onPress={() => setChanging(true)} />}
            </>
          )}
          <GhostButton label="Se déconnecter" danger onPress={() => void logout()} />
        </View>
      </ScrollView>
    </Modal>
  );
}
