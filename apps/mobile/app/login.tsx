import { useState } from "react";
import { Text } from "react-native";
import { Link, router } from "expo-router";
import { LoginInput, firstIssue } from "@ranksight/shared";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { PrimaryButton } from "@/components/ui";
import { Divider, Field, FormError, OAuthButtons, errorMessage } from "@/components/AuthUi";
import { KeyboardScroll } from "@/components/Keyboard";

export default function Login() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = async () => {
    await refresh();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const submit = async () => {
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setError(null);
    setPending(true);
    try {
      await api.login(parsed.data.email, parsed.data.password);
      await finish();
    } catch (e) {
      setError(errorMessage(e, "Connexion impossible, réessaie dans un instant."));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardScroll style={{ backgroundColor: colors.void }} contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", gap: 14 }}>
        <Text style={{ color: colors.ink, fontSize: 34, fontWeight: "800" }}>
          RANK<Text style={{ color: colors.neon }}>GUESS</Text>
        </Text>
        <Text style={{ color: colors.ink, fontSize: 24, fontWeight: "700" }}>Se connecter</Text>
        <Text style={{ color: colors.muted, marginBottom: 6 }}>Ta progression est la même sur l&apos;application et le site.</Text>

        <OAuthButtons onSuccess={finish} onError={setError} disabled={pending} />
        <Divider />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" textContentType="password" />
        <Link href="/forgot-password" style={{ color: colors.violetSoft, textAlign: "right" }}>Mot de passe oublié ?</Link>
        <FormError message={error} />
        <PrimaryButton label={pending ? "Connexion…" : "Se connecter"} onPress={submit} disabled={pending} />
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>
          Pas encore de compte ?{" "}
          <Link href="/signup" replace style={{ color: colors.violetSoft, fontWeight: "700" }}>Créer un compte</Link>
        </Text>
    </KeyboardScroll>
  );
}
