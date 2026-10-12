import { useState } from "react";
import { Text } from "react-native";
import { Link, router } from "expo-router";
import { MIN_AGE, SignupInput, PSEUDO_RULE } from "@ranksight/shared";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { PrimaryButton } from "@/components/ui";
import { Checkbox, WebLink } from "@/components/Checkbox";
import { Divider, Field, FormError, OAuthButtons, errorMessage } from "@/components/AuthUi";
import { KeyboardScroll } from "@/components/Keyboard";

type Fields = "pseudo" | "email" | "password" | "passwordConfirm" | "acceptTerms";

export default function Signup() {
  const { refresh } = useSession();
  const [form, setForm] = useState({ pseudo: "", email: "", password: "", passwordConfirm: "" });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: Exclude<Fields, "acceptTerms">) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const finish = async () => {
    await refresh();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const submit = async () => {
    setError(null);
    const parsed = SignupInput.safeParse({ ...form, acceptTerms });
    if (!parsed.success) {
      const next: Partial<Record<Fields, string>> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as Fields] ??= issue.message;
      return setErrors(next);
    }
    setPending(true);
    try {
      await api.signup({ ...form, acceptTerms });
      await finish();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PSEUDO_TAKEN") setErrors({ pseudo: e.message });
      else if (e instanceof ApiError && e.code === "EMAIL_TAKEN") setErrors({ email: e.message });
      else setError(errorMessage(e, "Inscription impossible, réessaie dans un instant."));
    } finally {
      setPending(false);
    }
  };

  return (
    <KeyboardScroll style={{ backgroundColor: colors.void }} contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", gap: 14 }}>
        <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "800" }}>Créer un compte</Text>
        <Text style={{ color: colors.muted }}>Gratuit. Ton pseudo apparaît dans les classements et le chat.</Text>

        <OAuthButtons onSuccess={finish} onError={setError} disabled={pending} />
        <Divider />
        <Field label="Pseudo" value={form.pseudo} onChangeText={set("pseudo")} autoCapitalize="none" maxLength={20} error={errors.pseudo} hint={PSEUDO_RULE} textContentType="username" />
        <Field label="Email" value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" error={errors.email} textContentType="emailAddress" />
        <Field label="Mot de passe" value={form.password} onChangeText={set("password")} secureTextEntry autoCapitalize="none" error={errors.password} hint="8 caractères minimum, avec au moins une lettre et un chiffre" textContentType="newPassword" />
        <Field label="Confirmation du mot de passe" value={form.passwordConfirm} onChangeText={set("passwordConfirm")} secureTextEntry autoCapitalize="none" error={errors.passwordConfirm} textContentType="newPassword" />
        <Checkbox checked={acceptTerms} onChange={(v) => { setAcceptTerms(v); setErrors((e) => ({ ...e, acceptTerms: undefined })); }}>
          J&apos;ai {MIN_AGE} ans ou plus et j&apos;accepte les <WebLink path="/legal/cgu">conditions d&apos;utilisation</WebLink> et la{" "}
          <WebLink path="/legal/confidentialite">politique de confidentialité</WebLink>.
        </Checkbox>
        {errors.acceptTerms && <Text style={{ color: colors.danger, fontSize: 12 }}>{errors.acceptTerms}</Text>}
        <FormError message={error} />
        <PrimaryButton label={pending ? "Création…" : "Créer mon compte"} onPress={submit} disabled={pending} />
        <Text style={{ color: colors.muted, textAlign: "center", marginTop: 6 }}>
          Déjà un compte ?{" "}
          <Link href="/login" replace style={{ color: colors.violetSoft, fontWeight: "700" }}>Se connecter</Link>
        </Text>
    </KeyboardScroll>
  );
}
