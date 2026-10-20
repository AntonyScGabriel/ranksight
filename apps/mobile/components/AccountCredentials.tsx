import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";
import { ChangePasswordInput, Email, firstIssue } from "@ranksight/shared";
import { api, tokens } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colors } from "@/lib/theme";
import { errorMessage, Field } from "./AuthUi";
import { GhostButton, PrimaryButton } from "./ui";

type Open = "none" | "password" | "email";

/**
 * Profil : changer de mot de passe (l'actuel est demandé, toutes les sessions sont ensuite fermées) ou d'adresse email
 * (remplacée une fois la nouvelle confirmée par le lien qui lui est envoyé).
 */
export function AccountCredentials() {
  const { refresh } = useSession();
  const [open, setOpen] = useState<Open>("none");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const toggle = (o: Open) => {
    setOpen((v) => (v === o ? "none" : o));
    setCurrent("");
    setPassword("");
    setConfirmPw("");
    setEmail("");
    setNotice(null);
  };

  const changePassword = async () => {
    const parsed = ChangePasswordInput.safeParse({ currentPassword: current, password, passwordConfirm: confirmPw });
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    setPending(true);
    setNotice(null);
    try {
      await api.changePassword(parsed.data);
      // Toutes les sessions sont fermées : reconnexion avec le nouveau mot de passe
      await tokens.clear();
      await refresh();
      router.replace("/login");
      Alert.alert("Mot de passe modifié", "Reconnecte-toi avec ton nouveau mot de passe.");
    } catch (err) {
      setNotice({ text: errorMessage(err), ok: false });
      setPending(false);
    }
  };

  const changeEmail = async () => {
    const parsed = Email.safeParse(email);
    if (!parsed.success) return setNotice({ text: firstIssue(parsed.error), ok: false });
    if (!current) return setNotice({ text: "Indique ton mot de passe actuel.", ok: false });
    setPending(true);
    setNotice(null);
    try {
      const r = await api.changeEmail(parsed.data, current);
      setNotice({
        text: r.pending
          ? `Un lien de confirmation a été envoyé à ${parsed.data}. Ton adresse changera dès que tu l'auras ouvert.`
          : `Adresse corrigée : un lien de confirmation a été envoyé à ${parsed.data}.`,
        ok: true,
      });
      setCurrent("");
      setEmail("");
      if (!r.pending) await refresh();
    } catch (err) {
      setNotice({ text: errorMessage(err), ok: false });
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <GhostButton label="Changer de mot de passe" onPress={() => toggle("password")} />
      {open === "password" && (
        <View style={{ gap: 10 }}>
          <Field label="Mot de passe actuel" secureTextEntry autoCapitalize="none" autoComplete="current-password" value={current} onChangeText={setCurrent} />
          <Field label="Nouveau mot de passe" hint="8 caractères au moins, une lettre et un chiffre." secureTextEntry autoCapitalize="none" autoComplete="new-password" value={password} onChangeText={setPassword} />
          <Field label="Confirme le nouveau mot de passe" secureTextEntry autoCapitalize="none" autoComplete="new-password" value={confirmPw} onChangeText={setConfirmPw} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>Tous tes appareils seront déconnectés : tu te reconnecteras avec le nouveau mot de passe.</Text>
          <PrimaryButton label={pending ? "Enregistrement…" : "Enregistrer le mot de passe"} onPress={changePassword} disabled={pending} />
        </View>
      )}
      <GhostButton label="Changer d'email" onPress={() => toggle("email")} />
      {open === "email" && (
        <View style={{ gap: 10 }}>
          <Field label="Nouvelle adresse email" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} />
          <Field label="Mot de passe actuel" secureTextEntry autoCapitalize="none" autoComplete="current-password" value={current} onChangeText={setCurrent} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Compte Google ou Discord sans mot de passe : crée-en un d&apos;abord avec « Mot de passe oublié » sur l&apos;écran de connexion.
          </Text>
          <PrimaryButton label={pending ? "Envoi…" : "Envoyer le lien de confirmation"} onPress={changeEmail} disabled={pending} />
        </View>
      )}
      {notice && <Text style={{ color: notice.ok ? colors.success : colors.danger, fontSize: 13 }}>{notice.text}</Text>}
    </View>
  );
}
