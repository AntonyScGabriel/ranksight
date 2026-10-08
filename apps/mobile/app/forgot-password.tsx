import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { ForgotPasswordInput, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { colors } from "@/lib/theme";
import { GhostButton, PrimaryButton } from "@/components/ui";
import { Field, FormError, errorMessage } from "@/components/AuthUi";
import { KeyboardScroll } from "@/components/Keyboard";

/** Mot de passe oublié : le lien reçu par email ouvre la page de réinitialisation du site. */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const parsed = ForgotPasswordInput.safeParse({ email });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setError(null);
    setPending(true);
    try {
      await api.forgotPassword(parsed.data.email);
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardScroll style={{ backgroundColor: colors.void }} contentContainerStyle={{ padding: 24, gap: 14 }}>
      {sent ? (
        <>
          <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Vérifie tes emails</Text>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>
            Si un compte existe avec l&apos;adresse {email.trim().toLowerCase()}, tu vas recevoir un lien pour choisir un nouveau mot de passe.
            Il est valable 1 heure.
          </Text>
          <GhostButton label="Retour à la connexion" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text style={{ color: colors.muted, lineHeight: 20 }}>Indique l&apos;email de ton compte : on t&apos;envoie un lien pour choisir un nouveau mot de passe.</Text>
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
          <FormError message={error} />
          <PrimaryButton label={pending ? "Envoi…" : "Recevoir le lien"} onPress={submit} disabled={pending} />
        </>
      )}
    </KeyboardScroll>
  );
}
